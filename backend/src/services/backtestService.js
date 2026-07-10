// ─────────────────────────────────────────────────────────────────
// backtestService.js
// Historical backtest engine: astro event × OHLC → statistics
//
// Beyond point-estimate stats (avg return, win rate), this computes:
//   - baseline: unconditional N-day returns over the same period, so
//     "60% win rate" can be judged against what happens on ANY day
//   - significance: Welch's t-test, event returns vs baseline
//   - consistency: split-half (first half vs second half of history)
//     — a real pattern should hold in both, not just the full sample
//   - staleness: last-5-years vs all-time — flags decayed effects
//   - decay curve: return at 7/15/30/60/90 days, not one fixed window
// ─────────────────────────────────────────────────────────────────
'use strict';
 
const { supabase } = require('../db/supabase');
const { getOHLC } = require('./kiteHistoricalService');
const { computePanchangRange } = require('./panchangService');
const { kpSubLord } = require('./dashaService');
 
function norm360(x) { return ((x % 360) + 360) % 360; }
function julianDay(year, month, day, hour = 12) {
  if (month <= 2) { year--; month += 12; }
  const A = Math.floor(year / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + B - 1524.5 + hour / 24;
}
function T(jd) { return (jd - 2451545.0) / 36525; }
function lahiriAyanamsha(jd) { return 23.85 + T(jd) * (50.3/3600) * 100; }
function moonLongitudeTropical(jd) {
  const t = T(jd);
  const L  = norm360(218.3165 + 481267.8813 * t);
  const M  = norm360(357.5291 + 35999.0503  * t) * Math.PI/180;
  const Mm = norm360(134.9634 + 477198.8676 * t) * Math.PI/180;
  const D  = norm360(297.8502 + 445267.1115 * t) * Math.PI/180;
  const F  = norm360(93.2721  + 483202.0175 * t) * Math.PI/180;
  return norm360(L + 6.2886*Math.sin(Mm) + 1.2740*Math.sin(2*D-Mm) + 0.6583*Math.sin(2*D)
    + 0.2136*Math.sin(2*Mm) - 0.1851*Math.sin(M) - 0.1143*Math.sin(2*F)
    + 0.0588*Math.sin(2*D-2*Mm) + 0.0572*Math.sin(2*D-M-Mm) + 0.0533*Math.sin(2*D+Mm));
}
function moonSubLordForDate(dateStr) {
  const [y,m,d] = dateStr.split('-').map(Number);
  const jd = julianDay(y, m, d, 12);
  const sidereal = norm360(moonLongitudeTropical(jd) - lahiriAyanamsha(jd));
  return kpSubLord(sidereal).subLord;
}
 
const CACHE_TTL_DAYS = 7;
const DECAY_WINDOWS = [7, 15, 30, 60, 90];
 
async function runBacktest({ event_type, instrument, window_days = 30, date_from, date_to, cache_only = false }) {
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
  if (cache_only) return { error: 'Not cached yet', n_observations: 0 };
 
  const events = await fetchEvents(event_type, date_from, date_to);
  if (!events || !events.length) return { error: 'No events found for this filter', n_observations: 0 };
 
  const allFrom = events[0].event_date;
  const lastEvent = events[events.length - 1].event_date;
  const allTo = addDays(lastEvent, Math.max(...DECAY_WINDOWS) + 10);
 
  const ohlc = await getOHLC(instrument, allFrom, allTo);
  if (!ohlc || ohlc.length < 30) {
    return { error: 'Insufficient OHLC data — check Kite connection', n_observations: 0 };
  }
 
  const priceMap = {};
  const sortedDates = [];
  for (const row of ohlc) { priceMap[row.date] = parseFloat(row.close); sortedDates.push(row.date); }
  sortedDates.sort();
 
  // ── Event-conditioned observations at the requested window, plus the
  // full decay curve (7/15/30/60/90d) computed from the SAME price map. ──
  const observations = [];
  for (const ev of events) {
    const entryClose = findClosestPrice(priceMap, ev.event_date);
    if (!entryClose) continue;
    const exitClose = findClosestPrice(priceMap, addDays(ev.event_date, window_days));
    if (!exitClose) continue;
    const ret = (exitClose - entryClose) / entryClose * 100;
 
    let mdd = 0, peak = entryClose;
    for (let d = 0; d <= window_days; d++) {
      const p = findClosestPrice(priceMap, addDays(ev.event_date, d));
      if (!p) continue;
      if (p > peak) peak = p;
      const dd = (p - peak) / peak * 100;
      if (dd < mdd) mdd = dd;
    }
 
    const decay = {};
    for (const w of DECAY_WINDOWS) {
      const exitW = findClosestPrice(priceMap, addDays(ev.event_date, w));
      decay[w] = exitW ? Math.round((exitW - entryClose) / entryClose * 10000) / 100 : null;
    }
 
    observations.push({
      date: ev.event_date, label: ev.description || event_type,
      return_pct: Math.round(ret * 100) / 100, drawdown_pct: Math.round(mdd * 100) / 100,
      entry: entryClose, exit: exitClose, decay,
    });
  }
  if (!observations.length) return { error: 'No complete observations', n_observations: 0 };
 
  // ── Baseline: unconditional N-day rolling returns, sampled every 5
  // trading days across the SAME price series and date range. This is
  // what "any random day" would have returned — the null to compare
  // the event-conditioned returns against. ──
  const baselineReturns = [];
  for (let i = 0; i < sortedDates.length; i += 5) {
    const d0 = sortedDates[i];
    const p0 = priceMap[d0];
    const p1 = findClosestPrice(priceMap, addDays(d0, window_days));
    if (p0 && p1) baselineReturns.push((p1 - p0) / p0 * 100);
  }
 
  const returns = observations.map(o => o.return_pct);
  const stats = computeStats(returns, baselineReturns, window_days);
 
  // ── Split-half consistency: does the effect hold in the first half
  // of history AND the second half independently, or is it only an
  // artifact of the full-sample average? ──
  const mid = Math.floor(observations.length / 2);
  const firstHalf = returns.slice(0, mid);
  const secondHalf = returns.slice(mid);
  const consistency = (firstHalf.length >= 3 && secondHalf.length >= 3) ? {
    firstHalfAvg: round4(mean(firstHalf)), secondHalfAvg: round4(mean(secondHalf)),
    sameDirection: Math.sign(mean(firstHalf)) === Math.sign(mean(secondHalf)) && mean(firstHalf) !== 0,
    n1: firstHalf.length, n2: secondHalf.length,
  } : null;
 
  // ── Staleness: last 5 years of occurrences vs all-time. A real edge
  // shouldn't vanish recently — if it did, the pattern has decayed. ──
  const fiveYearsAgo = addDays(new Date().toISOString().slice(0,10), -5*365);
  const recentObs = observations.filter(o => o.date >= fiveYearsAgo);
  const staleness = recentObs.length >= 3 ? {
    recentAvg: round4(mean(recentObs.map(o=>o.return_pct))),
    recentWinRate: round4(recentObs.filter(o=>o.return_pct>0).length/recentObs.length*100),
    recentN: recentObs.length,
    fullAvg: round4(mean(returns)),
    stale: Math.sign(mean(recentObs.map(o=>o.return_pct))) !== Math.sign(mean(returns)),
  } : { insufficientRecentData: true, recentN: recentObs.length };
 
  // ── Decay curve aggregated across all observations ──
  const decayCurve = DECAY_WINDOWS.map(w => {
    const vals = observations.map(o => o.decay[w]).filter(v => v != null);
    return vals.length ? { window: w, avg_return_pct: round4(mean(vals)), win_rate_pct: round4(vals.filter(v=>v>0).length/vals.length*100), n: vals.length } : { window: w, avg_return_pct: null, win_rate_pct: null, n: 0 };
  });
 
  const result = {
    event_type, instrument, window_days,
    date_from: date_from || allFrom, date_to: date_to || lastEvent,
    n_observations: observations.length,
    avg_return_pct: round4(stats.avg), cagr_pct: round4(stats.cagr),
    win_rate_pct: round4(stats.winRate), max_drawdown_pct: round4(Math.min(...observations.map(o=>o.drawdown_pct))),
    sharpe_ratio: round4(stats.sharpe),
    baseline_avg_return_pct: round4(stats.baselineAvg), baseline_win_rate_pct: round4(stats.baselineWinRate),
    t_stat: round4(stats.tStat), p_value: round4(stats.pValue), significant: stats.pValue != null && stats.pValue < 0.05,
    consistency, staleness, decay_curve: decayCurve,
    results_json: observations,
  };
 
  try {
    await supabase.from('astro_backtests').delete().eq('event_type', event_type).eq('instrument', instrument).eq('window_days', window_days);
    await supabase.from('astro_backtests').insert([result]);
  } catch (e) {
    console.warn('[Backtest] Cache write failed (migration 003 may not have run yet):', e.message);
  }
 
  return formatResult(result);
}
 
// ── Fetch events for a given event_type key (unchanged mapping logic) ──
async function fetchEvents(event_type, date_from, date_to) {
  // Panchang-based events (Bhadra, Panchak) are pure date arithmetic —
  // computed on the fly across the requested range, no dependency on
  // the astro_planetary_events backfill.
  if (event_type.startsWith('MOON_SUBLORD_')) {
    const targetLord = event_type.replace('MOON_SUBLORD_', '');
    const from = date_from || '2015-01-01';
    const to = date_to || new Date().toISOString().slice(0,10);
    const days = Math.min(Math.round((new Date(to) - new Date(from)) / 86400000) + 1, 4000);
    const out = [];
    const start = new Date(from);
    for (let i = 0; i < days; i++) {
      const dt = new Date(start.getTime() + i*86400000);
      const ds = dt.toISOString().slice(0,10);
      if (moonSubLordForDate(ds) === targetLord) out.push({ event_date: ds, description: 'Moon sub-lord: '+targetLord });
    }
    return out;
  }
 
  if (event_type === 'BHADRA_DAY' || event_type === 'PANCHAK_DAY') {
    const from = date_from || '2015-01-01';
    const to = date_to || new Date().toISOString().slice(0,10);
    const days = Math.round((new Date(to) - new Date(from)) / 86400000);
    const panchang = computePanchangRange(from, Math.min(days+1, 4000)); // cap to avoid runaway compute
    const filterFn = event_type === 'BHADRA_DAY' ? p => p.isBhadra : p => p.isPanchak;
    return panchang.filter(filterFn).map(p => ({
      event_date: p.date,
      description: event_type === 'BHADRA_DAY' ? 'Bhadra (Vishti Karana)' : 'Panchak',
    }));
  }
 
  let q = supabase.from('astro_planetary_events').select('event_date, planet, planet2, description').order('event_date', { ascending: true });
 
  if (event_type === 'MERCURY_RETROGRADE') q = q.eq('event_type', 'RETROGRADE_START').eq('planet', 'Mercury');
  else if (event_type === 'VENUS_RETROGRADE') q = q.eq('event_type', 'RETROGRADE_START').eq('planet', 'Venus');
  else if (event_type === 'MARS_RETROGRADE') q = q.eq('event_type', 'RETROGRADE_START').eq('planet', 'Mars');
  else if (event_type === 'JUPITER_SIGN_CHANGE') q = q.eq('event_type', 'SIGN_CHANGE').eq('planet', 'Jupiter');
  else if (event_type === 'SATURN_SIGN_CHANGE') q = q.eq('event_type', 'SIGN_CHANGE').eq('planet', 'Saturn');
  else if (event_type === 'RAHU_SIGN_CHANGE') q = q.eq('event_type', 'SIGN_CHANGE').eq('planet', 'Rahu');
  else if (event_type === 'MARS_SIGN_CHANGE') q = q.eq('event_type', 'SIGN_CHANGE').eq('planet', 'Mars');
  else if (event_type === 'MERCURY_SIGN_CHANGE') q = q.eq('event_type', 'SIGN_CHANGE').eq('planet', 'Mercury');
  else if (event_type === 'VENUS_SIGN_CHANGE') q = q.eq('event_type', 'SIGN_CHANGE').eq('planet', 'Venus');
  else if (event_type === 'ECLIPSE_SOLAR') q = q.eq('event_type', 'ECLIPSE_SOLAR');
  else if (event_type === 'ECLIPSE_LUNAR') q = q.eq('event_type', 'ECLIPSE_LUNAR');
  else if (event_type === 'JUPITER_SATURN_CONJUNCTION') q = q.eq('event_type', 'CONJUNCTION').eq('planet', 'Jupiter').eq('planet2', 'Saturn');
  else if (event_type === 'CONJUNCTION') q = q.eq('event_type', 'CONJUNCTION');
  else if (event_type === 'RETROGRADE_START') q = q.eq('event_type', 'RETROGRADE_START');
  else if (event_type.startsWith('RETROGRADE_END_')) q = q.eq('event_type', 'RETROGRADE_END').eq('planet', event_type.replace('RETROGRADE_END_', ''));
  else if (event_type === 'SIGN_CHANGE') q = q.eq('event_type', 'SIGN_CHANGE').in('planet', ['Jupiter','Saturn','Rahu','Mars']);
  else if (event_type.startsWith('CONJUNCTION_')) {
    const toTitle = s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    const raw = event_type.replace('CONJUNCTION_', '');
    const PLANETS = ['JUPITER','SATURN','MARS','MERCURY','VENUS','SUN','MOON','RAHU','KETU'];
    let p1='', p2='';
    for (const p of PLANETS) { if (raw.startsWith(p+'_')) { p1=p; p2=raw.slice(p.length+1); break; } }
    if (!p1) { const parts=raw.split('_'); p1=parts[0]; p2=parts.slice(1).join('_'); }
    q = q.eq('event_type', 'CONJUNCTION').or(`and(planet.eq.${toTitle(p1)},planet2.eq.${toTitle(p2)}),and(planet.eq.${toTitle(p2)},planet2.eq.${toTitle(p1)})`);
  } else q = q.eq('event_type', event_type);
 
  if (date_from) q = q.gte('event_date', date_from);
  if (date_to) q = q.lte('event_date', date_to);
  const { data } = await q;
  return data;
}
 
// ── Core statistics: point estimates + baseline + significance ──
function computeStats(returns, baselineReturns, window_days) {
  const avg = mean(returns);
  const winRate = returns.filter(r => r > 0).length / returns.length * 100;
  const cagr = Math.pow(1 + avg / 100, 365 / window_days) * 100 - 100;
  const rfPeriod = (6/365) * window_days;
  const excess = returns.map(r => r - rfPeriod);
  const sharpe = stdev(returns) > 0 ? (mean(excess) / stdev(returns)) * Math.sqrt(252 / window_days) : 0;
 
  const baselineAvg = baselineReturns.length ? mean(baselineReturns) : null;
  const baselineWinRate = baselineReturns.length ? baselineReturns.filter(r=>r>0).length/baselineReturns.length*100 : null;
 
  // Welch's t-test: event returns vs baseline returns (unequal variance)
  let tStat = null, pValue = null;
  if (baselineReturns.length >= 5 && returns.length >= 3) {
    const m1 = avg, m2 = baselineAvg;
    const v1 = variance(returns), v2 = variance(baselineReturns);
    const n1 = returns.length, n2 = baselineReturns.length;
    const se = Math.sqrt(v1/n1 + v2/n2);
    if (se > 0) {
      tStat = (m1 - m2) / se;
      const df = Math.pow(v1/n1 + v2/n2, 2) / (Math.pow(v1/n1,2)/(n1-1) + Math.pow(v2/n2,2)/(n2-1));
      pValue = 2 * (1 - studentTCDF(Math.abs(tStat), df));
    }
  }
 
  return { avg, winRate, cagr, sharpe, baselineAvg, baselineWinRate, tStat, pValue };
}
 
// ── Student's t CDF approximation (via incomplete beta function) ──
function studentTCDF(t, df) {
  const x = df / (df + t*t);
  const ib = incompleteBeta(x, df/2, 0.5);
  return 1 - 0.5 * ib;
}
function incompleteBeta(x, a, b) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a+b) - logGamma(a) - logGamma(b) + a*Math.log(x) + b*Math.log(1-x));
  if (x < (a+1)/(a+b+2)) return bt * betaContinuedFraction(x,a,b) / a;
  return 1 - bt * betaContinuedFraction(1-x,b,a) / b;
}
function betaContinuedFraction(x,a,b) {
  const MAXIT=200, EPS=3e-9, FPMIN=1e-30;
  let qab=a+b, qap=a+1, qam=a-1, c=1, d=1-qab*x/qap;
  if (Math.abs(d)<FPMIN) d=FPMIN;
  d=1/d; let h=d;
  for (let m=1;m<=MAXIT;m++) {
    const m2=2*m;
    let aa=m*(b-m)*x/((qam+m2)*(a+m2));
    d=1+aa*d; if(Math.abs(d)<FPMIN)d=FPMIN;
    c=1+aa/c; if(Math.abs(c)<FPMIN)c=FPMIN;
    d=1/d; h*=d*c;
    aa=-(a+m)*(qab+m)*x/((a+m2)*(qap+m2));
    d=1+aa*d; if(Math.abs(d)<FPMIN)d=FPMIN;
    c=1+aa/c; if(Math.abs(c)<FPMIN)c=FPMIN;
    d=1/d; const del=d*c; h*=del;
    if (Math.abs(del-1)<EPS) break;
  }
  return h;
}
function logGamma(x) {
  const cof=[76.18009172947146,-86.50532032941677,24.01409824083091,-1.231739572450155,0.1208650973866179e-2,-0.5395239384953e-5];
  let y=x, tmp=x+5.5; tmp-=(x+0.5)*Math.log(tmp);
  let ser=1.000000000190015;
  for (let j=0;j<6;j++){ y++; ser+=cof[j]/y; }
  return -tmp+Math.log(2.5066282746310005*ser/x);
}
 
function formatResult(r) {
  return {
    event_type: r.event_type, instrument: r.instrument, window_days: r.window_days,
    n_observations: r.n_observations, avg_return_pct: r.avg_return_pct, cagr_pct: r.cagr_pct,
    win_rate_pct: r.win_rate_pct, max_drawdown_pct: r.max_drawdown_pct, sharpe_ratio: r.sharpe_ratio,
    baseline_avg_return_pct: r.baseline_avg_return_pct, baseline_win_rate_pct: r.baseline_win_rate_pct,
    t_stat: r.t_stat, p_value: r.p_value, significant: r.significant,
    consistency: r.consistency, staleness: r.staleness, decay_curve: r.decay_curve,
    observations: r.results_json || [],
  };
}
 
function addDays(dateStr, n) { const d = new Date(dateStr); d.setDate(d.getDate() + n); return d.toISOString().split('T')[0]; }
function findClosestPrice(map, dateStr) {
  if (map[dateStr]) return map[dateStr];
  for (let i = 1; i <= 5; i++) {
    const fwd = addDays(dateStr, i), bck = addDays(dateStr, -i);
    if (map[fwd]) return map[fwd];
    if (map[bck]) return map[bck];
  }
  return null;
}
function mean(arr) { return arr.reduce((a,b)=>a+b,0) / arr.length; }
function variance(arr) { const m = mean(arr); return arr.reduce((a,b)=>a+Math.pow(b-m,2),0) / (arr.length-1); }
function stdev(arr) { return Math.sqrt(variance(arr)); }
function round4(n) { return n == null ? null : Math.round(n * 10000) / 10000; }
 
module.exports = { runBacktest };
