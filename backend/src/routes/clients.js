const express = require('express');
const router = express.Router();
const { supabase } = require('../db/supabase');
 
// GET /clients — all clients summary
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('clients').select('*')
      .order('total_current', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
 
// GET /clients/:id — one client with all holdings
router.get('/:id', async (req, res) => {
  try {
    const { data: client, error: cErr } = await supabase
      .from('clients').select('*').eq('id', req.params.id).single();
    if (cErr) throw cErr;
 
    const { data: holdings, error: hErr } = await supabase
      .from('holdings').select('*').eq('client_id', req.params.id)
      .order('market_value', { ascending: false });
    if (hErr) throw hErr;
 
    res.json({ ...client, holdings: holdings || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
 
module.exports = router;
 
