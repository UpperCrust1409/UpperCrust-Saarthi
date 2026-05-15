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
 
// POST /clients/net-cash — store Net Investible Surplus per client
// Body: { netCashMap: { "CLIENT NAME(00012345)": 1481430, ... } }
router.post('/net-cash', async (req, res) => {
  try {
    const { netCashMap } = req.body;
    if (!netCashMap || typeof netCashMap !== 'object') {
      return res.status(400).json({ error: 'netCashMap required' });
    }
 
    let updated = 0;
    const errors = [];
 
    for (const [clientName, netCash] of Object.entries(netCashMap)) {
      if (typeof netCash !== 'number' || netCash < 0) continue;
 
      // Try exact match first, then strip OFIN code suffix e.g. "(00012345)"
      const cleanName = clientName.replace(/\(\d+\)\s*$/, '').trim();
 
      const { data: clients, error: fetchErr } = await supabase
        .from('clients')
        .select('id, name')
        .or(`name.eq.${clientName},name.ilike.${cleanName}%`)
        .limit(5);
 
      if (fetchErr || !clients?.length) continue;
 
      for (const client of clients) {
        const { error: updateErr } = await supabase
          .from('clients')
          .update({ net_cash: Math.round(netCash) })
          .eq('id', client.id);
 
        if (!updateErr) updated++;
        else errors.push(client.name + ': ' + updateErr.message);
      }
    }
 
    res.json({ ok: true, updated, errors: errors.slice(0, 5) });
  } catch (err) {
    console.error('[net-cash]', err);
    res.status(500).json({ error: err.message });
  }
});
 
module.exports = router;
