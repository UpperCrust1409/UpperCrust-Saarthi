const express = require('express');
const router = express.Router();
const { supabase } = require('../db/supabase');
 
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
router.post('/', async (req, res) => {
  try {
    const { symbol, sector, mcap, asset_type, max_alloc, hidden } = req.body;
    if (!symbol) return res.status(400).json({ error: 'symbol required' });
    const { data, error } = await supabase
      .from('tags')
      .upsert({
        symbol: symbol.trim().toUpperCase(),
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
router.delete('/:symbol', async (req, res) => {
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
 
// POST /api/tags/bulk — save all tags at once
router.post('/bulk', async (req, res) => {
  try {
    const { tags } = req.body;
    if (!Array.isArray(tags) || !tags.length) return res.status(400).json({ error: 'tags array required' });
    const records = tags.map(t => ({
      symbol: t.symbol.trim().toUpperCase(),
      sector: t.sector || null,
      mcap: t.mcap || null,
      asset_type: t.asset_type || null,
      max_alloc: t.max_alloc !== undefined ? t.max_alloc : null,
      hidden: t.hidden !== undefined ? t.hidden : false,
      updated_at: new Date().toISOString()
    }));
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
