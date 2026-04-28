const express = require('express');
const router = express.Router();
const { supabase } = require('../db/supabase');
 
// GET /api/holdings — ALL holdings for ALL clients
// Paginates through Supabase to bypass 1000 row default limit
router.get('/', async (req, res) => {
  try {
    let allData = [];
    let from = 0;
    const pageSize = 1000;
 
    while (true) {
      const { data, error } = await supabase
        .from('holdings')
        .select('*')
        .order('client_id', { ascending: true })
        .range(from, from + pageSize - 1);
 
      if (error) throw error;
      if (!data || data.length === 0) break;
 
      allData = allData.concat(data);
      if (data.length < pageSize) break;
      from += pageSize;
    }
 
    res.json(allData);
  } catch (err) {
    console.error('Bulk holdings error:', err);
    res.status(500).json({ error: err.message });
  }
});
module.exports = router;
