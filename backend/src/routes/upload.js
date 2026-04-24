const router   = require('express').Router();
const db       = require('../config/db');
const upload   = require('../middleware/upload');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { parsePortfolioExcel } = require('../services/parser');

// ── POST /api/upload  (admin only) ──
router.post('/', requireAuth, requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const logId = await createLog(req.file.originalname, req.user.id);
  res.json({ message: 'Processing started', uploadId: logId });

  // Process async — don't block response
  processUpload(req.file.buffer, logId).catch(err => {
    console.error('[UPLOAD PROCESS ERROR]', err);
    markLogError(logId, err.message);
  });
});

// ── GET /api/upload/logs  (admin) ──
router.get('/logs', requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await db.query(
    `SELECT ul.*, u.name as uploader_name
     FROM upload_logs ul
     LEFT JOIN users u ON ul.uploaded_by = u.id
     ORDER BY ul.uploaded_at DESC LIMIT 30`
  );
  res.json(rows);
});

// ── GET /api/upload/status/:id ──
router.get('/status/:id', requireAuth, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM upload_logs WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Upload not found' });
  res.json(rows[0]);
});

// ── Helpers ──
async function createLog(filename, userId) {
  const { rows } = await db.query(
    `INSERT INTO upload_logs (filename, uploaded_by, status) VALUES ($1,$2,'processing') RETURNING id`,
    [filename, userId]
  );
  return rows[0].id;
}

async function markLogError(logId, msg) {
  await db.query(
    `UPDATE upload_logs SET status='error', error_message=$1 WHERE id=$2`,
    [msg, logId]
  );
}

async function processUpload(buffer, logId) {
  const dbClient = await db.getClient();
  try {
    await dbClient.query('BEGIN');

    // 1. Parse Excel
    const { clients, stocks } = parsePortfolioExcel(buffer);
    const clientList = Object.values(clients);
    const stockList  = Object.values(stocks);

    if (!clientList.length) throw new Error('No valid client sheets found in the file');

    // 2. Insert clients
    const clientIdMap = {};
    for (const c of clientList) {
      const { rows } = await dbClient.query(
        `INSERT INTO clients
           (name, sheet_name, total_invested, total_invested_holdings,
            total_current, total_current_holdings,
            total_pnl, total_pnl_pct, realized_gain, cash,
            has_true_cost, investment_date, upload_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING id`,
        [
          c.name, c.sn,
          c.totalInvested, c.totalInvestedHoldings,
          c.totalCurrent,  c.totalCurrentHoldings,
          c.totalPnL, c.totalPnLPct, c.realizedGain,
          c.cash, c.hasTrueCost,
          c.investmentDate || null,
          logId
        ]
      );
      clientIdMap[c.name] = rows[0].id;
    }

    // 3. Insert holdings
    for (const c of clientList) {
      const clientId = clientIdMap[c.name];
      for (const h of (c.holdings || [])) {
        await dbClient.query(
          `INSERT INTO holdings
             (client_id, symbol, name, qty, unit_cost, total_cost,
              market_price, market_value, pnl, pnl_pct, holding_pct, asset_class, upload_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            clientId, h.symbol, h.name, h.qty, h.unitCost, h.totalCost,
            h.marketPrice, h.marketValue, h.pnl, h.pnlPct, h.holdingPct,
            h.assetClass, logId
          ]
        );
      }
    }

    // 4. Insert stocks + stock_clients
    for (const s of stockList) {
      const tv = s.clients.reduce((a, c) => a + c.value, 0);
      const tc = s.clients.reduce((a, c) => a + c.cost,  0);
      const { rows } = await dbClient.query(
        `INSERT INTO stocks (symbol, name, total_value, total_cost, client_count, upload_id)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [s.symbol, s.name, tv, tc, s.clients.length, logId]
      );
      const stockId = rows[0].id;
      for (const sc of s.clients) {
        await dbClient.query(
          `INSERT INTO stock_clients
             (stock_id, client_id, client_name, qty, cost, value, pnl, pnl_pct, allocation_pct, upload_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            stockId, clientIdMap[sc.clientName], sc.clientName,
            sc.qty, sc.cost, sc.value, sc.pnl, sc.pnlPct, sc.allocationPct, logId
          ]
        );
      }
    }

    // 5. Mark log as success
    await dbClient.query(
      `UPDATE upload_logs SET status='success', client_count=$1, stock_count=$2 WHERE id=$3`,
      [clientList.length, stockList.length, logId]
    );

    await dbClient.query('COMMIT');
    console.log(`[UPLOAD] ${logId} done — ${clientList.length} clients, ${stockList.length} stocks`);
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
  }
}

module.exports = router;
