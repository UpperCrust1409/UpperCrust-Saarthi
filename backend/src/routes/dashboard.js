const router = require('express').Router();
const db     = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { computeRisks } = require('../services/riskEngine');

// ── GET /api/dashboard ──
router.get('/', requireAuth, async (req, res) => {
  try {
    // 1. Get latest successful upload
    const { rows: [upload] } = await db.query(
      `SELECT * FROM upload_logs WHERE status='success' ORDER BY uploaded_at DESC LIMIT 1`
    );
    if (!upload) return res.json({ empty: true, message: 'No portfolio loaded yet' });

    const uid = upload.id;

    // 2. KPI aggregates
    const { rows: [kpi] } = await db.query(`
      SELECT
        SUM(total_current + cash)         AS total_aum,
        SUM(total_invested)               AS total_invested,
        SUM(total_pnl)                    AS total_pnl,
        SUM(cash)                         AS total_cash,
        COUNT(*)                          AS client_count
      FROM clients WHERE upload_id = $1
    `, [uid]);

    // 3. Sector allocation
    const { rows: sectors } = await db.query(`
      SELECT
        COALESCE(st.sector, sm.s, 'Untagged') AS sector,
        SUM(h.market_value) AS value
      FROM holdings h
      JOIN clients c ON c.id = h.client_id
      LEFT JOIN stock_tags st ON st.symbol = h.symbol
      LEFT JOIN LATERAL (
        SELECT s FROM (VALUES
          ('BEL','Defence Manufacturing'),('HAL','Defence Manufacturing'),
          ('MAZDOCK','Defence Manufacturing'),('GRSE','Defence Manufacturing'),
          ('HINDALCO','Base Metals'),('HINDCOPPER','Base Metals'),
          ('GOLDETF','Precious Metals'),('SETFGOLD','Precious Metals'),
          ('SILVERBEES','Precious Metals'),('SILVERETF','Precious Metals'),
          ('PFC','BFSI'),('MCX','BFSI'),('SHRIRAMFIN','BFSI'),
          ('NAGAROIL','Energy'),('POWERINDIA','Energy'),
          ('PGINVIT','Infrastructure'),('LIQUIDBEES','Liquid / Cash')
        ) AS t(sym, s) WHERE t.sym = h.symbol
      ) sm ON true
      WHERE h.upload_id = $1
        AND h.asset_class NOT ILIKE '%accrual%'
        AND h.asset_class NOT ILIKE '%bank%'
      GROUP BY 1
      ORDER BY 2 DESC
    `, [uid]);

    // 4. Top stocks
    const { rows: topStocks } = await db.query(`
      SELECT symbol, name, total_value, total_cost, client_count,
             CASE WHEN total_cost > 0 THEN (total_value - total_cost) / total_cost ELSE 0 END AS pnl_pct,
             (total_value - total_cost) AS pnl
      FROM stocks
      WHERE upload_id = $1
      ORDER BY total_value DESC LIMIT 15
    `, [uid]);

    // 5. Risks (need full client+holdings data)
    const { rows: clients } = await db.query(
      `SELECT * FROM clients WHERE upload_id = $1`, [uid]
    );
    const { rows: holdings } = await db.query(
      `SELECT * FROM holdings WHERE upload_id = $1`, [uid]
    );
    const { rows: tagsRows } = await db.query(`SELECT * FROM stock_tags`);
    const tags = tagsRows.reduce((m, t) => { m[t.symbol] = t; return m; }, {});

    const clientsWithHoldings = clients.map(c => ({
      ...c,
      holdings: holdings.filter(h => h.client_id === c.id).map(h => ({
        symbol: h.symbol, name: h.name, qty: +h.qty,
        unitCost: +h.unit_cost, totalCost: +h.total_cost,
        marketPrice: +h.market_price, marketValue: +h.market_value,
        pnl: +h.pnl, pnlPct: +h.pnl_pct, holdingPct: +h.holding_pct,
        assetClass: h.asset_class
      }))
    }));

    const risks  = computeRisks(clientsWithHoldings, tags);
    const breach = risks.filter(r => r.type === 'breach').length;
    const warn   = risks.filter(r => r.type === 'warning').length;

    res.json({
      uploadedAt:    upload.uploaded_at,
      uploadId:      uid,
      kpi: {
        totalAUM:      +kpi.total_aum,
        totalInvested: +kpi.total_invested,
        totalPnL:      +kpi.total_pnl,
        totalCash:     +kpi.total_cash,
        clientCount:   +kpi.client_count,
        pnlPct:        kpi.total_invested > 0 ? kpi.total_pnl / kpi.total_invested : 0,
        cashPct:       kpi.total_aum > 0 ? kpi.total_cash / kpi.total_aum : 0
      },
      risk:           { breach, warn },
      sectors:        sectors.map(s => ({ sector: s.sector, value: +s.value })),
      topStocks:      topStocks.map(s => ({
        symbol:      s.symbol,
        name:        s.name,
        totalValue:  +s.total_value,
        totalCost:   +s.total_cost,
        pnl:         +s.pnl,
        pnlPct:      +s.pnl_pct,
        clientCount: +s.client_count,
        weightPct:   kpi.total_aum > 0 ? +s.total_value / +kpi.total_aum : 0
      }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
