const express = require('express');
const router = express.Router();
const { supabase } = require('../db/supabase');

// GET /api/holdings — ALL holdings for ALL clients in one request
// This replaces 100 individual /api/clients/:id calls — critical for mobile performance
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('holdings')
      .select('*')
      .order('client_id', { ascending: true })

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Bulk holdings error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
