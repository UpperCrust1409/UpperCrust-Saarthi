const express = require('express');
const router = express.Router();
const { supabase } = require('../db/supabase');

// GET /api/meta/:key
router.get('/:key', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('meta')
      .select('value')
      .eq('key', req.params.key)
      .single();

    if (error || !data) return res.json({ key: req.params.key, value: null });
    res.json({ key: req.params.key, value: data.value });
  } catch (e) {
    res.json({ key: req.params.key, value: null });
  }
});

// POST /api/meta/:key
router.post('/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    if (value === undefined) return res.status(400).json({ error: 'value required' });

    const { error } = await supabase
      .from('meta')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });

    if (error) throw error;
    console.log('[meta] Saved to Supabase:', key);
    res.json({ ok: true, key });
  } catch (e) {
    console.error('[meta] Save error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/meta/:key
router.delete('/:key', async (req, res) => {
  try {
    await supabase.from('meta').delete().eq('key', req.params.key);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
