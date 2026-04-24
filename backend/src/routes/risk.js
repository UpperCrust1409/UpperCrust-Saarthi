const router = require('express').Router();
const db     = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { computeRisks } = require('../services/riskEngine');

// ── GET /api/risk ──
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows: [upload] } = await db.query(
      `SELECT id FROM upload_logs WHERE status='success' ORDER BY uploaded_at DESC LIMIT 1`
    );
    if (!upload) return res.json({ risks: [], empty: true });
    const uid = upload.id;

    const [{ rows: clients }, { rows: holdings }, { rows: tagsRows }, { rows: limitsRows }] =
      await Promise.all([
        db.query(`SELECT * FROM clients WHERE upload_id = $1`, [uid]),
        db.query(`SELECT * FROM holdings WHERE upload_id = $1`, [uid]),
        db.query(`SELECT * FROM stock_tags`),
        db.query(`SELECT * FROM sector_limits`)
      ]);

    const tags   = tagsRows.reduce((m, t) => { m[t.symbol] = t; return m; }, {});
    const limits = limitsRows.reduce((m, l) => { m[l.sector] = +l.pct; return m; }, {});

    const rr = {
      stock_max:  0.10,
      gold_max:   0.25,
      silver_max: 0.15,
      sector_max: { ...limits }
    };

    const clientsWithHoldings = clients.map(c => ({
      ...c, totalCurrent: +c.total_current, cash: +c.cash,
      holdings: holdings.filter(h => h.client_id === c.id).map(h => ({
        symbol: h.symbol, name: h.name, qty: +h.qty,
        unitCost: +h.unit_cost, totalCost: +h.total_cost,
        marketPrice: +h.market_price, marketValue: +h.market_value,
        pnl: +h.pnl, pnlPct: +h.pnl_pct, holdingPct: +h.holding_pct,
        assetClass: h.asset_class
      }))
    }));

    const risks   = computeRisks(clientsWithHoldings, tags, rr);
    const breach  = risks.filter(r => r.type === 'breach');
    const warning = risks.filter(r => r.type === 'warning');

    res.json({
      risks,
      summary: {
        breach:  breach.length,
        warning: warning.length,
        clients: clientsWithHoldings.length,
        atRisk:  new Set(risks.map(r => r.client)).size
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
