const router = require('express').Router();
const db     = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// ── GET /api/tags ──
router.get('/', requireAuth, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM stock_tags ORDER BY symbol');
  res.json(rows);
});

// ── PUT /api/tags/:symbol  (admin only) ──
router.put('/:symbol', requireAuth, requireAdmin, async (req, res) => {
  const { sector, mcap, hidden } = req.body;
  const sym = req.params.symbol;
  try {
    const { rows } = await db.query(
      `INSERT INTO stock_tags (symbol, sector, mcap, hidden, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (symbol) DO UPDATE
         SET sector = EXCLUDED.sector, mcap = EXCLUDED.mcap,
             hidden = EXCLUDED.hidden, updated_at = NOW()
       RETURNING *`,
      [sym, sector || null, mcap || null, !!hidden]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── DELETE /api/tags/:symbol  (admin only) ──
router.delete('/:symbol', requireAuth, requireAdmin, async (req, res) => {
  await db.query('DELETE FROM stock_tags WHERE symbol = $1', [req.params.symbol]);
  res.json({ message: 'Tag removed' });
});

// ── GET /api/tags/sector-limits ──
router.get('/sector-limits', requireAuth, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM sector_limits');
  res.json(rows);
});

// ── PUT /api/tags/sector-limits/:sector  (admin only) ──
router.put('/sector-limits/:sector', requireAuth, requireAdmin, async (req, res) => {
  const { pct } = req.body;
  if (typeof pct !== 'number' || pct <= 0 || pct > 1)
    return res.status(400).json({ error: 'pct must be a number 0–1' });
  const { rows } = await db.query(
    `INSERT INTO sector_limits (sector, pct, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (sector) DO UPDATE SET pct = EXCLUDED.pct, updated_at = NOW()
     RETURNING *`,
    [req.params.sector, pct]
  );
  res.json(rows[0]);
});

module.exports = router;
