// ─────────────────────────────────────────────────────────────────
// kiteHistoricalService.js
// Kite Connect OHLC — fetches & caches in astro_ohlc_cache
// ─────────────────────────────────────────────────────────────────
'use strict';

const { supabase } = require('../db/supabase');
const KITE_BACKEND = process.env.KITE_BACKEND_URL || 'https://uppercrust-saarthi-production.up.railway.app';

// NSE instrument tokens for indices (Kite format)
const INDEX_TOKENS = {
  'NIFTY50':   'NSE:NIFTY 50',
  'NIFTY500':  'NSE:NIFTY 500',
  'SENSEX':    'BSE:SENSEX',
  'GOLD':      'MCX:GOLD',
  'SILVER':    'MCX:SILVER',
  // Sector indices
  'NIFTY_BANK':    'NSE:NIFTY BANK',
  'NIFTY_IT':      'NSE:NIFTY IT',
  'NIFTY_PHARMA':  'NSE:NIFTY PHARMA',
  'NIFTY_AUTO':    'NSE:NIFTY AUTO',
  'NIFTY_FMCG':    'NSE:NIFTY FMCG',
  'NIFTY_METAL':   'NSE:NIFTY METAL',
  'NIFTY_REALTY':  'NSE:NIFTY REALTY',
  'NIFTY_ENERGY':  'NSE:NIFTY ENERGY',
  'NIFTY_INFRA':   'NSE:NIFTY INFRA',
  'NIFTY_DEFENCE': 'NSE:NIFTY INDIA DEFENCE',
};

/**
 * Get OHLC data for a symbol between dates.
 * First checks local cache, then fetches from Kite backend.
 */
async function getOHLC(symbol, fromDate, toDate) {
  // Check cache
  const { data: cached } = await supabase
    .from('astro_ohlc_cache')
    .select('date, close')
    .eq('symbol', symbol)
    .gte('date', fromDate)
    .lte('date', toDate)
    .order('date', { ascending: true });

  // If we have full coverage, return cached
  if (cached && cached.length > 10) {
    return cached.map(r => ({ date: r.date, close: r.close }));
  }

  // Fetch from Kite backend
  try {
    const instrument = INDEX_TOKENS[symbol] || `NSE:${symbol}`;
    const url = `${KITE_BACKEND}/api/kite/historical?instrument=${encodeURIComponent(instrument)}&from=${fromDate}&to=${toDate}&interval=day`;
    const r = await fetch(url, {
      headers: { 'x-internal': process.env.INTERNAL_SECRET || 'saarthi_internal' }
    });
    if (!r.ok) throw new Error(`Kite historical fetch failed: ${r.status}`);
    const json = await r.json();
    const candles = json.data || json.candles || [];

    if (candles.length) {
      // Cache in DB (upsert)
      const rows = candles.map(c => ({
        symbol,
        date: Array.isArray(c) ? c[0].split('T')[0] : c.date,
        open:   Array.isArray(c) ? c[1] : c.open,
        high:   Array.isArray(c) ? c[2] : c.high,
        low:    Array.isArray(c) ? c[3] : c.low,
        close:  Array.isArray(c) ? c[4] : c.close,
        volume: Array.isArray(c) ? c[5] : c.volume,
      }));
      await supabase.from('astro_ohlc_cache').upsert(rows, { onConflict: 'symbol,date' });
      return rows.map(r => ({ date: r.date, close: r.close }));
    }
  } catch(e) {
    console.error('[KiteHistorical] Error fetching', symbol, e.message);
  }

  // Fall back to whatever we have in cache
  return (cached || []).map(r => ({ date: r.date, close: r.close }));
}

/**
 * Check if symbol is a known index or treat as NSE equity.
 */
function resolveInstrument(symbol) {
  return INDEX_TOKENS[symbol] || `NSE:${symbol}`;
}

module.exports = { getOHLC, resolveInstrument, INDEX_TOKENS };
