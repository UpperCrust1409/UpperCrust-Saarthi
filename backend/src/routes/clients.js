const router = require('express').Router();
const db     = require('../config/db');
const { requireAuth } = require('../middleware/auth');

async function getLatestUploadId() {
  const { rows } = await db.query(
    `SELECT id FROM upload_logs WHERE status='success' ORDER BY uploaded_at DESC LIMIT 1`
  );
  return rows[0]?.id || null;
}

// ── GET /api/clients ──
router.get('/', requireAuth, async (req, res) => {
  try {
    const uid = await getLatestUploadId();
    if (!uid) return res.json([]);

    const { search, sort = 'aum', dir = 'desc' } = req.query;
    const SORT_MAP = {
      aum:    '(c.total_current + c.cash)',
      pnl:    'c.total_pnl',
      pnlpct: 'c.total_pnl_pct',
      name:   'c.name'
    };
    const sortCol = SORT_MAP[sort] || SORT_MAP.aum;
    const sortDir = dir === 'asc' ? 'ASC' : 'DESC';

    let sql = `
      SELECT
        c.id, c.name, c.sheet_name,
        c.total_invested, c.total_current, c.total_pnl, c.total_pnl_pct,
        c.cash, c.realized_gain, c.investment_date, c.has_true_cost,
        (c.total_current + c.cash) AS aum,
        COUNT(h.id)::int AS holding_count
      FROM clients c
      LEFT JOIN holdings h ON h.client_id = c.id
      WHERE c.upload_id = $1`;
    const params = [uid];

    if (search) {
      params.push(`%${search}%`);
      sql += ` AND c.name ILIKE $${params.length}`;
    }

    sql += ` GROUP BY c.id ORDER BY ${sortCol} ${sortDir}`;

    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/clients/:id ──
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { rows: [client] } = await db.query(
      `SELECT * FROM clients WHERE id = $1`, [req.params.id]
    );
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { rows: holdings } = await db.query(
      `SELECT * FROM holdings WHERE client_id = $1 ORDER BY market_value DESC`,
      [client.id]
    );

    res.json({ ...client, holdings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
