
const express = require('express');
const router = express.Router();
const { supabase } = require('../db/supabase');
const { validate } = require('../validation/validate');
const { tagSchema, tagBulkSchema, tagSymbolParamSchema } = require('../validation/schemas');
 
// requireAuth already runs upstream (mounted in server.js), so req.user is populated.
// This just adds a role check for the one route in this file that needs it.
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Access denied. Admin role required.' });
  next();
}
 
// GET /api/tags — all tags
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('tags')
      .select('*')
      .order('symbol');
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Tags GET error:', err);
    res.status(500).json({ error: err.message });
  }
});
 
// POST /api/tags — upsert a single tag
router.post('/', validate(tagSchema), async (req, res) => {
  try {
    const { symbol, sector, mcap, asset_type, max_alloc, hidden } = req.body;
    if (!symbol) return res.status(400).json({ error: 'symbol required' });
    const isSectorLimit = symbol.trim().startsWith('__SECLIMIT__');
    const cleanSymbol = isSectorLimit ? symbol.trim() : symbol.trim().toUpperCase();
    const { data, error } = await supabase
      .from('tags')
      .upsert({
        symbol: cleanSymbol,
        sector: sector || null,
        mcap: mcap || null,
        asset_type: asset_type || null,
        max_alloc: max_alloc !== undefined ? max_alloc : null,
        hidden: hidden !== undefined ? hidden : false,
        updated_at: new Date().toISOString()
      }, { onConflict: 'symbol' })
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, tag: data });
  } catch (err) {
    console.error('Tags POST error:', err);
    res.status(500).json({ error: err.message });
  }
});
 
// DELETE /api/tags/:symbol — reset a tag
router.delete('/:symbol', validate(tagSymbolParamSchema, 'params'), async (req, res) => {
  try {
    const { error } = await supabase
      .from('tags')
      .delete()
      .eq('symbol', req.params.symbol.trim().toUpperCase());
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('Tags DELETE error:', err);
    res.status(500).json({ error: err.message });
  }
});
 
// POST /api/tags/bulk — save all tags at once (admin only — overwrites the entire sector/tag table)
router.post('/bulk', requireAdmin, validate(tagBulkSchema), async (req, res) => {
  try {
    const { tags } = req.body;
    if (!Array.isArray(tags) || !tags.length) return res.status(400).json({ error: 'tags array required' });
    const records = tags.map(t => {
      // __SECLIMIT__ rows store a sector NAME after the prefix (e.g.
      // "__SECLIMIT__Defence"), not a real stock symbol — sector names are
      // mixed-case everywhere else in the app (gm().sector, RR.sector_max),
      // so uppercasing them here silently breaks the round-trip: the saved
      // limit becomes unreachable under its real-case key after reload.
      // Only real stock symbols get uppercased.
      const isSectorLimit = t.symbol.trim().startsWith('__SECLIMIT__');
      const cleanSymbol = isSectorLimit ? t.symbol.trim() : t.symbol.trim().toUpperCase();
      return {
        symbol: cleanSymbol,
        sector: t.sector || null,
        mcap: t.mcap || null,
        asset_type: t.asset_type || null,
        max_alloc: t.max_alloc !== undefined ? t.max_alloc : null,
        hidden: t.hidden !== undefined ? t.hidden : false,
        updated_at: new Date().toISOString()
      };
    });
    const { error } = await supabase
      .from('tags')
      .upsert(records, { onConflict: 'symbol' });
    if (error) throw error;
    res.json({ success: true, count: records.length });
  } catch (err) {
    console.error('Tags BULK error:', err);
    res.status(500).json({ error: err.message });
  }
});
 
module.exports = router;
