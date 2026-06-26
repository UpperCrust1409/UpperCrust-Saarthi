// ─────────────────────────────────────────────────────────────────
// backtestService.js
// Historical backtest engine: astro event × OHLC → statistics
// ─────────────────────────────────────────────────────────────────
'use strict';

const { supabase } = require('../db/supabase');
const { getOHLC } = require('./kiteHistoricalService');

const CACHE_TTL_DAYS = 7; // Re-run backtest if older than N days

/**
 * Run a backtest.
 * @param {string} event_type - e.g. 'MERCURY_RETROGRADE', 'JUPITER_SIGN_CHANGE'
 * @param {string} instrument - e.g. 'NIFTY50', 'NIFTY_BANK', 'RELIANCE'
 * @param {number} window_days - holding period after event (default 30)
 * @param {string} date_from
 * @param {string} date_to
 */
async function runBacktest({ event_type, instrument, window_days = 30, date_from, date_to }) {
  // Check cache first
  const { data: cached } = await supabase
    .from('astro_backtests')
    .select('*')
    .eq('event_type', event_type)
    .eq('instrument', instrument)
    .eq('window_days', window_days)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (cached) {
    const ageDays = (Date.now() - new Date(cached.created_at).getTime()) / 86400000;
    if (ageDays < CACHE_TTL_DAYS) return formatResult(cached);
  }

  // Fetch events
  let eventsQuery = supabase
    .from('astro_planetary_events')
    .select('event_date, planet, planet2, description')
    .order('event_date', { ascending: true });

  // Map event_type to DB filter — complete planet-specific mapping
  if (event_type === 'MERCURY_RETROGRADE') {
    eventsQuery = eventsQuery.eq('event_type', 'RETROGRADE_START').eq('planet', 'Mercury');
  } else if (event_type === 'VENUS_RETROGRADE') {
    eventsQuery = eventsQuery.eq('event_type', 'RETROGRADE_START').eq('planet', 'Venus');
  } else if (event_type === 'MARS_RETROGRADE') {
    eventsQuery = eventsQuery.eq('event_type', 'RETROGRADE_START').eq('planet', 'Mars');
  } else if (event_type === 'JUPITER_SIGN_CHANGE') {
    eventsQuery = eventsQuery.eq('event_type', 'SIGN_CHANGE').eq('planet', 'Jupiter');
  } else if (event_type === 'SATURN_SIGN_CHANGE') {
    eventsQuery = eventsQuery.eq('event_type', 'SIGN_CHANGE').eq('planet', 'Saturn');
  } else if (event_type === 'RAHU_SIGN_CHANGE') {
    eventsQuery = eventsQuery.eq('event_type', 'SIGN_CHANGE').eq('planet', 'Rahu');
  } else if (event_type === 'MARS_SIGN_CHANGE') {
    eventsQuery = eventsQuery.eq('event_type', 'SIGN_CHANGE').eq('planet', 'Mars');
  } else if (event_type === 'MERCURY_SIGN_CHANGE') {
    eventsQuery = eventsQuery.eq('event_type', 'SIGN_CHANGE').eq('planet', 'Mercury');
  } else if (event_type === 'VENUS_SIGN_CHANGE') {
    eventsQuery = eventsQuery.eq('event_type', 'SIGN_CHANGE').eq('planet', 'Venus');
  } else if (event_type === 'ECLIPSE_SOLAR') {
    eventsQuery = eventsQuery.eq('event_type', 'ECLIPSE_SOLAR');
  } else if (event_type === 'ECLIPSE_LUNAR') {
    eventsQuery = eventsQuery.eq('event_type', 'ECLIPSE_LUNAR');
  } else if (event_type === 'JUPITER_SATURN_CONJUNCTION') {
    eventsQuery = eventsQuery.eq('event_type', 'CONJUNCTION').eq('planet', 'Jupiter').eq('planet2', 'Saturn');
  } else if (event_type === 'CONJUNCTION') {
    eventsQuery = eventsQuery.eq('event_type', 'CONJUNCTION');
  } else if (event_type === 'RETROGRADE_START') {
    eventsQuery = eventsQuery.eq('event_type', 'RETROGRADE_START');
  } else if (event_type === 'SIGN_CHANGE') {
    eventsQuery = eventsQuery.eq('event_type', 'SIGN_CHANGE').in('planet', ['Jupiter','Saturn','Rahu','Mars']);
  } else {
    eventsQuery = eventsQuery.eq('event_type', event_type);
  }

  if (date_from) eventsQuery = eventsQuery.gte('event_date', date_from);
  if (date_to)   eventsQuery = eventsQuery.lte('event_date', date_to);

  const { data: events } = await eventsQuery;
  if (!events || !events.length) {
    return { error: 'No events found for this filter', n_observations: 0 };
  }

  // Fetch OHLC for the full range + window
  const allFrom = events[0].event_date;
  const lastEvent = events[events.length - 1].event_date;
  const allTo = addDays(lastEvent, window_days + 10);

  const ohlc = await getOHLC(instrument, allFrom, allTo);
  if (!ohlc || ohlc.length < 5) {
    return { error: 'Insufficient OHLC data — check Kite connection', n_observations: 0 };
  }

  // Build date → close map
  const priceMap = {};
  for (const row of ohlc) priceMap[row.date] = parseFloat(row.close);

  // Calculate return for each event
  const observations = [];
  for (const ev of events) {
    const entryClose = findClosestPrice(priceMap, ev.event_date);
    const exitDate   = addDays(ev.event_date, window_days);
    const exitClose  = findClosestPrice(priceMap, exitDate);

    if (!entryClose || !exitClose) continue;

    const ret = (exitClose - entryClose) / entryClose * 100;

    // Max drawdown within window
    let mdd = 0, peak = entryClose;
    for (let d = 0; d <= window_days; d++) {
      const dt = addDays(ev.event_date, d);
      const p = findClosestPrice(priceMap, dt);
      if (!p) continue;
      if (p > peak) peak = p;
      const dd = (p - peak) / peak * 100;
      if (dd < mdd) mdd = dd;
    }

    observations.push({
      date: ev.event_date,
      label: ev.description || event_type,
      return_pct: Math.round(ret * 100) / 100,
      drawdown_pct: Math.round(mdd * 100) / 100,
      entry: entryClose,
      exit: exitClose,
    });
  }

  if (!observations.length) return { error: 'No complete observations', n_observations: 0 };

  // Statistics
  const returns = observations.map(o => o.return_pct);
  const n = returns.length;
  const avg_return_pct = mean(returns);
  const win_rate_pct   = (returns.filter(r => r > 0).length / n) * 100;
  const max_drawdown_pct = Math.min(...observations.map(o => o.drawdown_pct));

  // CAGR: annualise based on window
  const cagr_pct = Math.pow(1 + avg_return_pct / 100, 365 / window_days) * 100 - 100;

  // Sharpe (simplified, risk-free = 6% annualised)
  const rfDaily = 6 / 365;
  const rfPeriod = rfDaily * window_days;
  const excessReturns = returns.map(r => r - rfPeriod);
  const sharpe_ratio = stdev(returns) > 0
    ? (mean(excessReturns) / stdev(returns)) * Math.sqrt(252 / window_days)
    : 0;

  const result = {
    event_type, instrument, window_days,
    date_from: date_from || allFrom,
    date_to: date_to || lastEvent,
    n_observations: n,
    avg_return_pct: round4(avg_return_pct),
    cagr_pct: round4(cagr_pct),
    win_rate_pct: round4(win_rate_pct),
    max_drawdown_pct: round4(max_drawdown_pct),
    sharpe_ratio: round4(sharpe_ratio),
    results_json: observations,
  };

  // Persist to cache
  await supabase.from('astro_backtests').upsert([result], { onConflict: 'event_type,instrument,window_days' });

  return formatResult(result);
}

function formatResult(r) {
  return {
    event_type: r.event_type,
    instrument: r.instrument,
    window_days: r.window_days,
    n_observations: r.n_observations,
    avg_return_pct: r.avg_return_pct,
    cagr_pct: r.cagr_pct,
    win_rate_pct: r.win_rate_pct,
    max_drawdown_pct: r.max_drawdown_pct,
    sharpe_ratio: r.sharpe_ratio,
    observations: r.results_json || [],
  };
}

// ── Helpers ──────────────────────────────────────────────────────
function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function findClosestPrice(map, dateStr) {
  if (map[dateStr]) return map[dateStr];
  // Look ±5 days for the nearest trading day
  for (let i = 1; i <= 5; i++) {
    const fwd = addDays(dateStr, i);
    const bck = addDays(dateStr, -i);
    if (map[fwd]) return map[fwd];
    if (map[bck]) return map[bck];
  }
  return null;
}

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function stdev(arr) {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((a, b) => a + Math.pow(b - m, 2), 0) / arr.length);
}
function round4(n) { return Math.round(n * 10000) / 10000; }

module.exports = { runBacktest };
