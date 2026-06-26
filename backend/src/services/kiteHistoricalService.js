// ─────────────────────────────────────────────────────────────────
// kiteHistoricalService.js
// Kite for Indian indices + Yahoo Finance for commodities
// All prices consistent within each source
// ─────────────────────────────────────────────────────────────────
'use strict';

const { supabase } = require('../db/supabase');

const KITE_BASE = 'https://api.kite.trade';

// Kite instrument tokens for Indian indices
const KITE_TOKENS = {
  'NIFTY50':    256265,
  'NIFTY500':   259849,
  'SENSEX':     265,
  'NIFTY_BANK': 260105,
  'NIFTY_IT':   259849,
  'NIFTY_PHARMA': 260617,
  'NIFTY_AUTO': 261897,
  'NIFTY_FMCG': 261641,
  'NIFTY_METAL': 261385,
  'NIFTY_REALTY': 261657,
  'NIFTY_ENERGY': 260873,
};

// Yahoo Finance tickers for commodities (all USD)
const YAHOO_TICKERS = {
  'GOLD':        'GC=F',
  'SILVER':      'SI=F',
  'CRUDE_OIL':   'CL=F',
  'COPPER':      'HG=F',
  'NATURAL_GAS': 'NG=F',
  'PLATINUM':    'PL=F',
  'PALLADIUM':   'PA=F',
  'ALUMINIUM':   'ALI=F',
  'NICKEL':      'NI=F',
};

// All available instruments for UI
const ALL_INSTRUMENTS = {
  // Indian Indices (via Kite)
  'NIFTY50':      { label: 'Nifty 50',        source: 'kite',  currency: 'INR' },
  'NIFTY500':     { label: 'Nifty 500',        source: 'kite',  currency: 'INR' },
  'SENSEX':       { label: 'Sensex',           source: 'kite',  currency: 'INR' },
  'NIFTY_BANK':   { label: 'Nifty Bank',       source: 'kite',  currency: 'INR' },
  'NIFTY_IT':     { label: 'Nifty IT',         source: 'kite',  currency: 'INR' },
  'NIFTY_PHARMA': { label: 'Nifty Pharma',     source: 'kite',  currency: 'INR' },
  'NIFTY_AUTO':   { label: 'Nifty Auto',       source: 'kite',  currency: 'INR' },
  'NIFTY_FMCG':   { label: 'Nifty FMCG',      source: 'kite',  currency: 'INR' },
  'NIFTY_METAL':  { label: 'Nifty Metal',      source: 'kite',  currency: 'INR' },
  // Commodities (via Yahoo Finance, USD)
  'GOLD':         { label: 'Gold (USD/oz)',     source: 'yahoo', currency: 'USD' },
  'SILVER':       { label: 'Silver (USD/oz)',   source: 'yahoo', currency: 'USD' },
  'CRUDE_OIL':    { label: 'Crude Oil (USD/bbl)', source: 'yahoo', currency: 'USD' },
  'COPPER':       { label: 'Copper (USD/lb)',   source: 'yahoo', currency: 'USD' },
  'NATURAL_GAS':  { label: 'Natural Gas (USD)', source: 'yahoo', currency: 'USD' },
  'PLATINUM':     { label: 'Platinum (USD/oz)', source: 'yahoo', currency: 'USD' },
  'PALLADIUM':    { label: 'Palladium (USD/oz)', source: 'yahoo', currency: 'USD' },
  'ALUMINIUM':    { label: 'Aluminium (USD)',   source: 'yahoo', currency: 'USD' },
  'NICKEL':       { label: 'Nickel (USD)',      source: 'yahoo', currency: 'USD' },
};

// ── Kite token helper ─────────────────────────────────────────────
async function getKiteToken() {
  const { data } = await supabase
    .from('app_settings').select('value').eq('key', 'kite_access_token').single();
  if (!data?.value) return null;
  const parsed = JSON.parse(data.value);
  if (!parsed.token || new Date(parsed.expiry) <= new Date()) return null;
  return parsed.token;
}

// ── Fetch from Kite Historical API ───────────────────────────────
async function fetchKiteOHLC(symbol, fromDate, toDate) {
  const accessToken = await getKiteToken();
  const apiKey = process.env.KITE_API_KEY;
  if (!accessToken || !apiKey) return [];

  const instrumentToken = KITE_TOKENS[symbol];
  if (!instrumentToken) return [];

  const rows = [];
  let cur = new Date(fromDate);
  const endDate = new Date(toDate);

  while (cur <= endDate) {
    const chunkEnd = new Date(cur);
    chunkEnd.setFullYear(chunkEnd.getFullYear() + 1);
    if (chunkEnd > endDate) chunkEnd.setTime(endDate.getTime());

    const from = cur.toISOString().split('T')[0];
    const to   = chunkEnd.toISOString().split('T')[0];

    try {
      const url = `${KITE_BASE}/instruments/historical/${instrumentToken}/day?from=${from}&to=${to}&continuous=0&oi=0`;
      const r = await fetch(url, {
        headers: { 'Authorization': `token ${apiKey}:${accessToken}`, 'X-Kite-Version': '3' }
      });
      const json = await r.json();
      const candles = json.data?.candles || [];
      for (const c of candles) {
        rows.push({ symbol, date: c[0].split('T')[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] });
      }
    } catch(e) {
      console.error('[Kite OHLC] chunk error:', e.message);
    }

    await new Promise(r => setTimeout(r, 300));
    cur = new Date(chunkEnd);
    cur.setDate(cur.getDate() + 1);
  }

  return rows;
}

// ── Fetch from Yahoo Finance ──────────────────────────────────────
async function fetchYahooOHLC(symbol, fromDate, toDate) {
  const ticker = YAHOO_TICKERS[symbol];
  if (!ticker) return [];

  const from = Math.floor(new Date(fromDate).getTime() / 1000);
  const to   = Math.floor(new Date(toDate).getTime() / 1000);
  const url  = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${from}&period2=${to}&interval=1d&events=history`;

  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(15000)
    });
    const json = await r.json();
    const result = json.chart?.result?.[0];
    if (!result) return [];

    const timestamps = result.timestamp || [];
    const closes     = result.indicators?.quote?.[0]?.close || [];
    const opens      = result.indicators?.quote?.[0]?.open  || [];
    const highs      = result.indicators?.quote?.[0]?.high  || [];
    const lows       = result.indicators?.quote?.[0]?.low   || [];
    const volumes    = result.indicators?.quote?.[0]?.volume || [];

    return timestamps.map((ts, i) => ({
      symbol,
      date:   new Date(ts * 1000).toISOString().split('T')[0],
      open:   opens[i]   || closes[i],
      high:   highs[i]   || closes[i],
      low:    lows[i]    || closes[i],
      close:  closes[i],
      volume: volumes[i] || 0,
    })).filter(r => r.close && r.close > 0);
  } catch(e) {
    console.error('[Yahoo OHLC] error for', symbol, e.message);
    return [];
  }
}

// ── Main: getOHLC ─────────────────────────────────────────────────
async function getOHLC(symbol, fromDate, toDate) {
  // Check cache first
  const { data: cached } = await supabase
    .from('astro_ohlc_cache')
    .select('date, close')
    .eq('symbol', symbol)
    .gte('date', fromDate)
    .lte('date', toDate)
    .order('date', { ascending: true });

  // If >80% coverage, use cache
  const expectedDays = (new Date(toDate) - new Date(fromDate)) / 86400000 * 0.7; // ~70% of days are trading days
  if (cached && cached.length > expectedDays * 0.8) {
    return cached.map(r => ({ date: r.date, close: parseFloat(r.close) }));
  }

  const info = ALL_INSTRUMENTS[symbol];
  let rows = [];

  if (info?.source === 'yahoo') {
    console.log(`[OHLC] Fetching ${symbol} from Yahoo Finance`);
    rows = await fetchYahooOHLC(symbol, fromDate, toDate);
  } else {
    console.log(`[OHLC] Fetching ${symbol} from Kite`);
    rows = await fetchKiteOHLC(symbol, fromDate, toDate);
  }

  if (rows.length > 0) {
    await supabase.from('astro_ohlc_cache')
      .upsert(rows.filter(r => r.close), { onConflict: 'symbol,date' });
    console.log(`[OHLC] Cached ${rows.length} rows for ${symbol}`);
    return rows.map(r => ({ date: r.date, close: parseFloat(r.close) }));
  }

  return (cached || []).map(r => ({ date: r.date, close: parseFloat(r.close) }));
}

module.exports = { getOHLC, ALL_INSTRUMENTS, KITE_TOKENS, YAHOO_TICKERS };
