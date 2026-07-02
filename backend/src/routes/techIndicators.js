// ═══════════════════════════════════════════════════════════════
// Backend route: /api/tech-indicators
// Fetches 200-day candles for a batch of symbols, computes
// RSI/EMA/MACD/Bollinger, caches in Supabase for 24h
// ═══════════════════════════════════════════════════════════════
'use strict';
const express = require('express');
const router = express.Router();
const { computeAll } = require('../services/techIndicators');

// Fetch daily candles via Kite
async function fetchCandles(symbol, kiteGet) {
  try {
    const to = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - 280 * 86400000).toISOString().split('T')[0]; // 280 days
    const ltp = await kiteGet(`/quote/ltp?i=NSE:${symbol}`);
    const token = ltp.data?.[`NSE:${symbol}`]?.instrument_token;
    if (!token) return null;
    const hist = await kiteGet(`/instruments/historical/${token}/day?from=${from}&to=${to}&continuous=0&oi=0`);
    return hist.data?.candles || null;
  } catch(e) { return null; }
}

// GET /api/tech-indicators?symbols=RELIANCE,TCS,HDFCBANK
router.get('/', async (req, res) => {
  try {
    const { symbols } = req.query;
    if (!symbols) return res.status(400).json({ error: 'symbols required' });
    const symList = symbols.split(',').map(s => s.trim()).filter(Boolean).slice(0, 50); // max 50 per call

    const supabase = req.supabase;
    const kiteGet = req._kiteGet;
    if (!kiteGet) return res.status(503).json({ error: 'Kite not connected' });

    const today = new Date().toISOString().split('T')[0];
    const cacheKey = `tech_indicators_${today}`;

    // Load cache
    let cache = {};
    try {
      const { data } = await supabase.from('app_settings').select('value').eq('key', cacheKey).single();
      if (data?.value) cache = JSON.parse(data.value);
    } catch(e) {}

    const result = {};
    const toFetch = symList.filter(s => !cache[s]);

    // Fetch missing symbols in parallel (max 5 concurrent)
    for (let i = 0; i < toFetch.length; i += 5) {
      const batch = toFetch.slice(i, i + 5);
      const results = await Promise.all(batch.map(async sym => {
        const candles = await fetchCandles(sym, kiteGet);
        const indicators = candles ? computeAll(candles) : null;
        return { sym, indicators };
      }));
      results.forEach(({ sym, indicators }) => {
        if (indicators) cache[sym] = indicators;
        result[sym] = indicators;
      });
      if (i + 5 < toFetch.length) await new Promise(r => setTimeout(r, 300)); // rate limit
    }

    // Return cached for symbols already computed
    symList.filter(s => cache[s] && !result[s]).forEach(s => { result[s] = cache[s]; });

    // Save updated cache
    if (toFetch.length > 0) {
      await supabase.from('app_settings').upsert({
        key: cacheKey, value: JSON.stringify(cache), updated_at: new Date().toISOString()
      });
    }

    res.json({ ok: true, data: result, cached: symList.length - toFetch.length, fetched: toFetch.length });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
