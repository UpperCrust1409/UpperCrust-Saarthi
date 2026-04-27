const express = require('express');
const router = express.Router();
const { supabase } = require('../db/supabase');
 
// GET /stocks — all stocks grouped by symbol with client breakdown
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('holdings')
      .select('symbol, name, market_value, total_cost, pnl, qty, pnl_pct, asset_class, client_id, clients(id, name)');
    if (error) throw error;
 
    // Group by symbol
    const stockMap = {};
    (data || []).forEach(h => {
      if (!stockMap[h.symbol]) {
        stockMap[h.symbol] = {
          symbol:     h.symbol,
          name:       h.name,
          assetClass: h.asset_class,
          totalValue: 0,
          totalCost:  0,
          totalPnl:   0,
          clients:    []
        };
      }
      stockMap[h.symbol].totalValue += h.market_value || 0;
      stockMap[h.symbol].totalCost  += h.total_cost   || 0;
      stockMap[h.symbol].totalPnl   += h.pnl          || 0;
      stockMap[h.symbol].clients.push({
        clientId:   h.clients?.id,
        clientName: h.clients?.name,
        value:      h.market_value,
        cost:       h.total_cost,
        qty:        h.qty,
        pnl:        h.pnl
      });
    });
 
    const result = Object.values(stockMap)
      .sort((a, b) => b.totalValue - a.totalValue);
 
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
 
module.exports = router;
 


