const router = require('express').Router();
const db     = require('../config/db');
const { requireAuth } = require('../middleware/auth');

async function getLatestUploadId() {
  const { rows } = await db.query(
    `SELECT id FROM upload_logs WHERE status='success' ORDER BY uploaded_at DESC LIMIT 1`
  );
  return rows[0]?.id || null;
}

// ── GET /api/stocks ──
router.get('/', requireAuth, async (req, res) => {
  try {
    const uid = await getLatestUploadId();
    if (!uid) return res.json([]);

    const { search, sort = 'value', dir = 'desc' } = req.query;
    const SORT_MAP = {
      value:  's.total_value',
      pnl:    '(s.total_value - s.total_cost)',
      pnlpct: 'CASE WHEN s.total_cost > 0 THEN (s.total_value - s.total_cost) / s.total_cost ELSE 0 END',
      clients:'s.client_count',
      symbol: 's.symbol'
    };
    const sortCol = SORT_MAP[sort] || SORT_MAP.value;
    const sortDir = dir === 'asc' ? 'ASC' : 'DESC';

    let sql = `
      SELECT
        s.*,
        (s.total_value - s.total_cost) AS pnl,
        CASE WHEN s.total_cost > 0 THEN (s.total_value - s.total_cost) / s.total_cost ELSE 0 END AS pnl_pct,
        COALESCE(st.sector, 'Untagged') AS sector,
        COALESCE(st.mcap, 'Unknown')    AS mcap,
        COALESCE(st.hidden, false)      AS hidden
      FROM stocks s
      LEFT JOIN stock_tags st ON st.symbol = s.symbol
      WHERE s.upload_id = $1`;
    const params = [uid];

    if (search) {
      params.push(`%${search}%`);
      sql += ` AND (s.symbol ILIKE $${params.length} OR s.name ILIKE $${params.length})`;
    }

    sql += ` ORDER BY ${sortCol} ${sortDir}`;

    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/stocks/:symbol ──
router.get('/:symbol', requireAuth, async (req, res) => {
  try {
    const uid = await getLatestUploadId();
    if (!uid) return res.status(404).json({ error: 'No data loaded' });

    const { rows: [stock] } = await db.query(
      `SELECT * FROM stocks WHERE upload_id = $1 AND symbol = $2`,
      [uid, req.params.symbol]
    );
    if (!stock) return res.status(404).json({ error: 'Stock not found' });

    const { rows: clients } = await db.query(
      `SELECT sc.*, c.investment_date
       FROM stock_clients sc
       JOIN clients c ON c.id = sc.client_id
       WHERE sc.stock_id = $1
       ORDER BY sc.value DESC`,
      [stock.id]
    );

    res.json({ ...stock, clients });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
