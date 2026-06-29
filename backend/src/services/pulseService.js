// ═══════════════════════════════════════════════════════════════
// pulseService.js — Saarthi Pulse daily intelligence engine
// Runs at 6:00 AM IST after planet cron and sector cron
// ═══════════════════════════════════════════════════════════════
'use strict';

const { supabase } = require('../db/supabase');

const TODAY = () => new Date().toISOString().split('T')[0];
const NDAYS_AGO = (n) => { const d = new Date(); d.setDate(d.getDate()-n); return d.toISOString().split('T')[0]; };

// ── 1. Snapshot portfolio scores for ALL clients ─────────────────
async function snapshotPortfolioScores(clients) {
  if (!clients || !clients.length) return;
  const today = TODAY();

  const rows = clients.map(c => {
    const score = c._score || { health: 0, hygiene: 0, total: 0 };
    const bucket = c._bucket || { label: 'E' };
    const aum = c.totalCurrent || 0;
    const inv = c.totalInvested || aum;
    const returnPct = inv > 0 ? (aum - inv) / inv : 0;

    return {
      snapshot_date: today,
      client_name: c.name,
      fund: c.fund || 'UCWF',
      health_score: score.health || 0,
      hygiene_score: score.hygiene || 0,
      total_score: score.total || 0,
      bucket: bucket.label || 'E',
      aum: Math.round(aum),
      return_pct: parseFloat(returnPct.toFixed(6)),
      flags: JSON.stringify(score.hFlags || []),
      strengths: JSON.stringify(score.hStrengths || [])
    };
  });

  // Upsert all client scores
  const { error } = await supabase.from('pulse_score_snapshot')
    .upsert(rows, { onConflict: 'snapshot_date,client_name,fund' });

  if (error) console.error('[Pulse] Score snapshot error:', error.message);
  else console.log(`[Pulse] Snapshotted ${rows.length} client scores for ${today}`);
}

// ── 2. Snapshot fund-level aggregates ────────────────────────────
async function snapshotFundScores(clients) {
  const today = TODAY();
  const funds = ['UCWF', 'UCGF', 'UCPF'];

  for (const fund of funds) {
    const fc = clients.filter(c => (c.fund || 'UCWF') === fund && c._score);
    if (!fc.length) continue;

    const avgHealth  = fc.reduce((s, c) => s + (c._score?.health || 0), 0) / fc.length;
    const avgHygiene = fc.reduce((s, c) => s + (c._score?.hygiene || 0), 0) / fc.length;
    const avgTotal   = fc.reduce((s, c) => s + (c._score?.total || 0), 0) / fc.length;
    const totalAum   = fc.reduce((s, c) => s + (c.totalCurrent || 0), 0);

    await supabase.from('pulse_score_snapshot').upsert([{
      snapshot_date: today,
      client_name: null,
      fund,
      health_score:  parseFloat(avgHealth.toFixed(1)),
      hygiene_score: parseFloat(avgHygiene.toFixed(1)),
      total_score:   parseFloat(avgTotal.toFixed(1)),
      bucket: avgTotal >= 70 ? 'A' : avgTotal >= 45 ? 'B' : 'C',
      aum: Math.round(totalAum),
      return_pct: 0,
      flags: '[]',
      strengths: '[]'
    }], { onConflict: 'snapshot_date,client_name,fund' });
  }
  console.log('[Pulse] Fund aggregates snapshotted');
}

// ── 3. Generate client risk flags ─────────────────────────────────
async function generateClientFlags(clients, screenerData = {}) {
  const today = TODAY();
  const flags = [];

  for (const c of clients) {
    const aum = c.totalCurrent || 0;
    if (!aum || !c.holdings?.length) continue;

    const holdings = c.holdings.slice().sort((a, b) => b.marketValue - a.marketValue);

    // FLAG 1: Single stock concentration > 20%
    const topStock = holdings[0];
    if (topStock) {
      const pct = topStock.marketValue / aum;
      if (pct > 0.20) {
        flags.push({
          flag_date: today, client_name: c.name,
          flag_type: 'CONCENTRATION',
          severity: pct > 0.35 ? 'HIGH' : 'MEDIUM',
          detail: `${topStock.symbol} is ${(pct*100).toFixed(1)}% of portfolio — single stock concentration risk`,
          value: parseFloat((pct*100).toFixed(2)),
          threshold: 20
        });
      }
    }

    // FLAG 2: Cash idle > 15%
    const cashPct = (c.cash || 0) / aum;
    if (cashPct > 0.15) {
      flags.push({
        flag_date: today, client_name: c.name,
        flag_type: 'CASH_IDLE',
        severity: cashPct > 0.30 ? 'HIGH' : 'MEDIUM',
        detail: `${(cashPct*100).toFixed(1)}% idle cash — deploy opportunity missed`,
        value: parseFloat((cashPct*100).toFixed(2)),
        threshold: 15
      });
    }

    // FLAG 3: Portfolio underperformance
    const bucket = c._bucket || {};
    if (bucket.label === 'C') {
      const ret = bucket.twr ?? bucket.pnlPct ?? 0;
      flags.push({
        flag_date: today, client_name: c.name,
        flag_type: 'UNDERPERFORM',
        severity: ret < -0.05 ? 'HIGH' : 'MEDIUM',
        detail: `Returns at ${((ret||0)*100).toFixed(1)}% — ${bucket.desc || 'below benchmark'}`,
        value: parseFloat(((ret||0)*100).toFixed(2)),
        threshold: 12
      });
    }

    // FLAG 4: High PE exposure
    const highPeCount = holdings.filter(h => {
      const s = screenerData[h.symbol];
      return s && s.pe && s.pe > 60;
    }).length;
    const highPePct = highPeCount / holdings.length;
    if (highPePct > 0.4) {
      flags.push({
        flag_date: today, client_name: c.name,
        flag_type: 'HIGH_PE',
        severity: 'MEDIUM',
        detail: `${highPeCount} of ${holdings.length} stocks have PE > 60 — elevated valuation risk`,
        value: parseFloat((highPePct*100).toFixed(1)),
        threshold: 40
      });
    }

    // FLAG 5: Stale portfolio — no trades in 90+ days
    const lastTrade = c._lastTradeDate;
    if (lastTrade) {
      const daysSince = (new Date() - new Date(lastTrade)) / 86400000;
      if (daysSince > 90) {
        flags.push({
          flag_date: today, client_name: c.name,
          flag_type: 'STALE',
          severity: daysSince > 180 ? 'HIGH' : 'MEDIUM',
          detail: `No portfolio activity in ${Math.round(daysSince)} days — review needed`,
          value: Math.round(daysSince),
          threshold: 90
        });
      }
    }
  }

  if (flags.length) {
    // Delete today's existing flags and reinsert
    await supabase.from('pulse_client_flags').delete().eq('flag_date', today);
    const { error } = await supabase.from('pulse_client_flags').insert(flags);
    if (error) console.error('[Pulse] Flag insert error:', error.message);
    else console.log(`[Pulse] ${flags.length} client flags generated`);
  }

  return flags;
}

// ── 4. Track pick performance ─────────────────────────────────────
async function trackPickPerformance(kiteQuotes = {}) {
  const today = TODAY();
  const cutoff = NDAYS_AGO(365);

  // Get all open picks from last 365 days
  const { data: picks } = await supabase.from('pulse_picks_log')
    .select('*')
    .gte('pick_date', cutoff)
    .eq('signal_type', 'BUY');

  if (!picks?.length) return;

  const perfs = [];
  for (const pick of picks) {
    const quote = kiteQuotes[pick.symbol];
    if (!quote) continue;

    const currentPrice = quote.last_price || quote.close;
    if (!currentPrice || !pick.entry_price) continue;

    const returnPct = (currentPrice - pick.entry_price) / pick.entry_price;
    const holdingDays = Math.round((new Date() - new Date(pick.pick_date)) / 86400000);
    const outcome = holdingDays > 30
      ? (returnPct > 0 ? 'HIT' : 'MISS')
      : 'OPEN';

    perfs.push({
      pick_id: pick.id,
      symbol: pick.symbol,
      pick_date: pick.pick_date,
      tracking_date: today,
      entry_price: pick.entry_price,
      current_price: currentPrice,
      return_pct: parseFloat(returnPct.toFixed(6)),
      holding_days: holdingDays,
      outcome
    });
  }

  if (perfs.length) {
    await supabase.from('pulse_pick_performance')
      .upsert(perfs, { onConflict: 'pick_id,tracking_date' });
    console.log(`[Pulse] Tracked ${perfs.length} pick performances`);
  }
}

// ── 5. Snapshot screener metrics ──────────────────────────────────
async function snapshotScreenerMetrics(screenerData = {}) {
  const today = TODAY();
  const symbols = Object.keys(screenerData);
  if (!symbols.length) return;

  const metrics = ['pe', 'pb', 'roe', 'roce', 'debtEq', 'peg', 'evEbitda'];
  const rows = [];

  for (const metric of metrics) {
    const values = symbols.map(s => screenerData[s]?.[metric]).filter(v => v && isFinite(v) && v > 0);
    if (!values.length) continue;

    values.sort((a, b) => a - b);
    const median = values[Math.floor(values.length / 2)];
    const mean = values.reduce((s, v) => s + v, 0) / values.length;

    rows.push({
      snapshot_date: today,
      metric: `universe_${metric}`,
      value: parseFloat(mean.toFixed(4)),
      universe: 'ALL',
      sector: null,
      percentile_1y: null, percentile_3y: null, percentile_5y: null
    });
  }

  if (rows.length) {
    await supabase.from('pulse_screener_snapshot')
      .upsert(rows, { onConflict: 'snapshot_date,metric,universe,sector' });
    console.log(`[Pulse] ${rows.length} screener metrics snapshotted`);
  }
}

// ── 6. Compute win rate stats ─────────────────────────────────────
async function computeWinRates() {
  const today = TODAY();
  const d7 = NDAYS_AGO(7);
  const d30 = NDAYS_AGO(30);

  const { data: perf30 } = await supabase.from('pulse_pick_performance')
    .select('outcome, return_pct')
    .gte('pick_date', d30)
    .in('outcome', ['HIT', 'MISS']);

  const { data: perf7 } = await supabase.from('pulse_pick_performance')
    .select('outcome, return_pct')
    .gte('pick_date', d7)
    .in('outcome', ['HIT', 'MISS']);

  const winRate = (arr) => !arr?.length ? null :
    parseFloat((arr.filter(p => p.outcome === 'HIT').length / arr.length * 100).toFixed(1));

  return {
    win_rate_7d: winRate(perf7),
    win_rate_30d: winRate(perf30),
    avg_return_7d: perf7?.length ? parseFloat((perf7.reduce((s,p)=>s+p.return_pct,0)/perf7.length*100).toFixed(2)) : null,
    avg_return_30d: perf30?.length ? parseFloat((perf30.reduce((s,p)=>s+p.return_pct,0)/perf30.length*100).toFixed(2)) : null,
  };
}

// ── 7. Main daily pulse job ───────────────────────────────────────
async function runDailyPulseJob(payload = {}) {
  const today = TODAY();
  console.log(`[Pulse] Running for ${today}`);

  const { clients = [], screenerData = {}, kiteQuotes = {} } = payload;

  try {
    // Score snapshots
    if (clients.length) {
      await snapshotPortfolioScores(clients);
      await snapshotFundScores(clients);
      await generateClientFlags(clients, screenerData);
    }

    // Screener snapshot
    if (Object.keys(screenerData).length) {
      await snapshotScreenerMetrics(screenerData);
    }

    // Pick tracking
    if (Object.keys(kiteQuotes).length) {
      await trackPickPerformance(kiteQuotes);
    }

    // Compute win rates and save report metadata
    const winRates = await computeWinRates();

    // Get today's flag count
    const { count: flagCount } = await supabase.from('pulse_client_flags')
      .select('id', { count: 'exact' }).eq('flag_date', today).eq('resolved', false);

    // Get score comparison
    const { data: todayScore } = await supabase.from('pulse_score_snapshot')
      .select('total_score').is('client_name', null).eq('fund', 'UCWF').eq('snapshot_date', today).single();

    const { data: score7d } = await supabase.from('pulse_score_snapshot')
      .select('total_score').is('client_name', null).eq('fund', 'UCWF').eq('snapshot_date', NDAYS_AGO(7)).single();

    const { data: score30d } = await supabase.from('pulse_score_snapshot')
      .select('total_score').is('client_name', null).eq('fund', 'UCWF').eq('snapshot_date', NDAYS_AGO(30)).single();

    await supabase.from('pulse_report').upsert([{
      report_date: today,
      pick_win_rate_7d: winRates.win_rate_7d,
      pick_win_rate_30d: winRates.win_rate_30d,
      avg_score_today: todayScore?.total_score || null,
      avg_score_7d_ago: score7d?.total_score || null,
      avg_score_30d_ago: score30d?.total_score || null,
      clients_flagged: flagCount || 0,
      summary_json: JSON.stringify({
        winRates,
        generated: new Date().toISOString()
      })
    }], { onConflict: 'report_date' });

    console.log(`[Pulse] Done — ${flagCount} flags, ${winRates.win_rate_30d}% 30d win rate`);
  } catch(e) {
    console.error('[Pulse] Error:', e.message);
  }
}

// ── 8. Log a pick (called from picks cron) ────────────────────────
async function logPick({ date, symbol, company, fund, signalType, entryPrice, rationale, factorScores, sector }) {
  const { error } = await supabase.from('pulse_picks_log').insert([{
    pick_date: date || TODAY(),
    symbol, company_name: company, fund: fund || 'ALL',
    signal_type: signalType || 'BUY',
    entry_price: entryPrice,
    rationale, factor_scores: factorScores || {},
    sector
  }]);
  if (error) console.error('[Pulse] logPick error:', error.message);
}

module.exports = { runDailyPulseJob, logPick, snapshotPortfolioScores, generateClientFlags, trackPickPerformance };
