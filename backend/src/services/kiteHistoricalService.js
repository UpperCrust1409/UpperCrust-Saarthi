// ─────────────────────────────────────────────────────────────────
// kiteHistoricalService.js
// Kite Connect OHLC — fetches directly using stored Kite token
// ─────────────────────────────────────────────────────────────────
'use strict';

const { supabase } = require('../db/supabase');

const KITE_BASE = 'https://api.kite.trade';

// Instrument tokens for indices (Kite instrument_token numbers)
const INDEX_INSTRUMENT_TOKENS = {
  'NIFTY50':       256265,
  'NIFTY500':      259849,
  'SENSEX':        265,
  'NIFTY_BANK':    260105,
  'NIFTY_IT':      259849,
  'NIFTY_PHARMA':  260617,
  'NIFTY_AUTO':    261897,
  'NIFTY_FMCG':    261641,
  'NIFTY_METAL':   261385,
  'NIFTY_REALTY':  261657,
  'NIFTY_ENERGY':  260873,
};

// NSE symbols for index OHLC via ltp endpoint
const INDEX_SYMBOLS = {
  'NIFTY50':       'NSE:NIFTY 50',
  'NIFTY500':      'NSE:NIFTY 500',
  'SENSEX':        'BSE:SENSEX',
  'NIFTY_BANK':    'NSE:NIFTY BANK',
  'NIFTY_IT':      'NSE:NIFTY IT',
  'NIFTY_PHARMA':  'NSE:NIFTY PHARMA',
  'NIFTY_AUTO':    'NSE:NIFTY AUTO',
  'NIFTY_FMCG':    'NSE:NIFTY FMCG',
  'NIFTY_METAL':   'NSE:NIFTY METAL',
  'NIFTY_REALTY':  'NSE:NIFTY REALTY',
  'NIFTY_ENERGY':  'NSE:NIFTY ENERGY',
};

async function getKiteToken() {
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'kite_access_token')
    .single();
  if (!data?.value) return null;
  const parsed = JSON.parse(data.value);
  if (!parsed.token || new Date(parsed.expiry) <= new Date()) return null;
  return parsed.token;
}

async function fetchFromKite(instrumentToken, fromDate, toDate, apiKey, accessToken) {
  const url = `${KITE_BASE}/instruments/historical/${instrumentToken}/day?from=${fromDate}&to=${toDate}&continuous=0&oi=0`;
  const r = await fetch(url, {
    headers: {
      'Authorization': `token ${apiKey}:${accessToken}`,
      'X-Kite-Version': '3'
    }
  });
  const json = await r.json();
  return json.data?.candles || [];
}

async function getOHLC(symbol, fromDate, toDate) {
  // Check cache first
  const { data: cached } = await supabase
    .from('astro_ohlc_cache')
    .select('date, close')
    .eq('symbol', symbol)
    .gte('date', fromDate)
    .lte('date', toDate)
    .order('date', { ascending: true });

  if (cached && cached.length > 50) {
    return cached.map(r => ({ date: r.date, close: parseFloat(r.close) }));
  }

  // Get Kite token
  const accessToken = await getKiteToken();
  const apiKey = process.env.KITE_API_KEY;
  if (!accessToken || !apiKey) {
    return (cached || []).map(r => ({ date: r.date, close: parseFloat(r.close) }));
  }

  const instrumentToken = INDEX_INSTRUMENT_TOKENS[symbol];
  if (!instrumentToken) {
    console.error('[KiteHistorical] No instrument token for', symbol);
    return (cached || []).map(r => ({ date: r.date, close: parseFloat(r.close) }));
  }

  try {
    // Kite limits to 2000 candles per request — split into yearly chunks
    const rows = [];
    let cur = new Date(fromDate);
    const endDate = new Date(toDate);

    while (cur <= endDate) {
      const chunkEnd = new Date(cur);
      chunkEnd.setFullYear(chunkEnd.getFullYear() + 1);
      if (chunkEnd > endDate) chunkEnd.setTime(endDate.getTime());

      const from = cur.toISOString().split('T')[0];
      const to   = chunkEnd.toISOString().split('T')[0];

      const candles = await fetchFromKite(instrumentToken, from, to, apiKey, accessToken);
      for (const c of candles) {
        rows.push({
          symbol,
          date:   c[0].split('T')[0],
          open:   c[1], high: c[2], low: c[3], close: c[4], volume: c[5]
        });
      }
      cur = new Date(chunkEnd);
      cur.setDate(cur.getDate() + 1);
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 300));
    }

    if (rows.length) {
      await supabase.from('astro_ohlc_cache')
        .upsert(rows, { onConflict: 'symbol,date' });
      console.log(`[KiteHistorical] Fetched ${rows.length} candles for ${symbol}`);
      return rows.map(r => ({ date: r.date, close: parseFloat(r.close) }));
    }
  } catch(e) {
    console.error('[KiteHistorical] Error:', e.message);
  }

  return (cached || []).map(r => ({ date: r.date, close: parseFloat(r.close) }));
}

module.exports = { getOHLC, INDEX_SYMBOLS, INDEX_INSTRUMENT_TOKENS };
