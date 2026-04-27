const express = require('express');
const router = express.Router();
const { supabase } = require('../db/supabase');
 
// GET /dashboard — summary numbers for the top KPI cards
router.get('/', async (req, res) => {
  try {
    const { data: clients, error } = await supabase.from('clients').select('*');
    if (error) throw error;
 
    const totalAUM      = clients.reduce((s,c) => s + (c.total_current||0) + (c.cash||0), 0);
    const totalInvested = clients.reduce((s,c) => s + (c.total_invested||0), 0);
    const totalPnL      = clients.reduce((s,c) => s + (c.total_pnl||0), 0);
    const totalCash     = clients.reduce((s,c) => s + (c.cash||0), 0);
 
    const { data: holdings } = await supabase.from('holdings').select('symbol');
    const uniqueStocks = new Set((holdings||[]).map(h => h.symbol)).size;
 
    // Last upload
    const { data: lastUp } = await supabase
      .from('uploads').select('filename,uploaded_at')
      .order('uploaded_at', { ascending: false }).limit(1).single();
 
    res.json({
      totalAUM,
      totalInvested,
      totalPnL,
      totalPnLPct:  totalInvested > 0 ? totalPnL / totalInvested : 0,
      totalCash,
      cashPct:      totalAUM > 0 ? totalCash / totalAUM : 0,
      clientCount:  clients.length,
      stockCount:   uniqueStocks,
      lastUpload:   lastUp || null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
 
module.exports = router;
