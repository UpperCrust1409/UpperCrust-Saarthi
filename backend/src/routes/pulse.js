// ═══════════════════════════════════════════════════════════════
// pulse.js — Saarthi Pulse API routes
// Mount: app.use('/api/pulse', requireAuth, injectSupabase, require('./routes/pulse'))
// ═══════════════════════════════════════════════════════════════
'use strict';
 
const router = require('express').Router();
const { supabase } = require('../db/supabase');
const { validate } = require('../validation/validate');
const { pulseLogPickSchema, pulseResolveFlagSchema } = require('../validation/schemas');
 
// requireAuth already runs upstream (mounted in server.js), so req.user is populated.
function requireManagerPlus(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.user.role !== 'admin' && req.user.role !== 'manager') {
    return res.status(403).json({ error: 'Access denied. Manager or admin role required.' });
  }
  next();
}
 
const TODAY = () => new Date().toISOString().split('T')[0];
const NDAYS_AGO = (n) => { const d=new Date(); d.setDate(d.getDate()-n); return d.toISOString().split('T')[0]; };
 
// ── GET /api/pulse/report — full daily report data ───────────────
router.get('/report', async (req, res) => {
  try {
    const today = TODAY();
    const d7   = NDAYS_AGO(7);
    const d30  = NDAYS_AGO(30);
    const d180 = NDAYS_AGO(180);
    const d365 = NDAYS_AGO(365);
 
    const [
      reportMeta,
      todayPicks,
      pickPerf7d,
      pickPerf30d,
      pickPerf180d,
      fundScores,
      fundScores7d,
      fundScores30d,
      fundScores180d,
      clientFlags,
      screenerToday,
      screener30d,
      astroSignals,
      bucketToday,
      bucket7d,
      bucket30d,
    ] = await Promise.all([
      supabase.from('pulse_report').select('*').eq('report_date', today).single(),
      supabase.from('pulse_picks_log').select('*').eq('pick_date', today).order('created_at', { ascending: false }),
      supabase.from('pulse_pick_performance').select('*, pulse_picks_log(symbol,company_name,sector,fund,rationale,entry_price)').gte('pick_date', d7).order('pick_date', { ascending: false }),
      supabase.from('pulse_pick_performance').select('*, pulse_picks_log(symbol,company_name,sector,fund,rationale)').gte('pick_date', d30).order('pick_date', { ascending: false }),
      supabase.from('pulse_pick_performance').select('*, pulse_picks_log(symbol,company_name,sector)').gte('pick_date', d180).order('pick_date', { ascending: false }),
      supabase.from('pulse_score_snapshot').select('*').is('client_name', null).eq('snapshot_date', today),
      supabase.from('pulse_score_snapshot').select('*').is('client_name', null).eq('snapshot_date', d7),
      supabase.from('pulse_score_snapshot').select('*').is('client_name', null).eq('snapshot_date', d30),
      supabase.from('pulse_score_snapshot').select('*').is('client_name', null).eq('snapshot_date', d180),
      supabase.from('pulse_client_flags').select('*').eq('flag_date', today).eq('resolved', false).order('severity'),
      supabase.from('pulse_screener_snapshot').select('*').eq('snapshot_date', today),
      supabase.from('pulse_screener_snapshot').select('*').eq('snapshot_date', d30),
      supabase.from('pulse_astro_accuracy').select('*').gte('signal_date', d180).order('signal_date', { ascending: false }),
      supabase.from('pulse_score_snapshot').select('bucket, count:id').not('client_name', 'is', null).eq('snapshot_date', today),
      supabase.from('pulse_score_snapshot').select('bucket, count:id').not('client_name', 'is', null).eq('snapshot_date', d7),
      supabase.from('pulse_score_snapshot').select('bucket, count:id').not('client_name', 'is', null).eq('snapshot_date', d30),
    ]);
 
    // Compute win rates
    const calcWinRate = (perfs) => {
      const closed = (perfs?.data || []).filter(p => p.outcome !== 'OPEN');
      const wins = closed.filter(p => p.return_pct > 0);
      return closed.length ? { rate: +(wins.length/closed.length*100).toFixed(1), n: closed.length, avgReturn: +(closed.reduce((s,p)=>s+p.return_pct,0)/closed.length*100).toFixed(2) } : null;
    };
 
    // Count buckets
    const countBuckets = (data) => {
      const m = { A: 0, B: 0, C: 0, E: 0 };
      (data?.data || []).forEach(r => { if(r.bucket) m[r.bucket] = (m[r.bucket]||0)+1; });
      return m;
    };
 
    // Screener percentile context
    const metricContext = {};
    (screenerToday?.data || []).forEach(s => {
      const hist = (screener30d?.data || []).find(h => h.metric === s.metric);
      metricContext[s.metric] = { today: s.value, d30: hist?.value || null, change: hist ? +(s.value - hist.value).toFixed(4) : null };
    });
 
    // AstroQuant accuracy summary
    const astroStats = {};
    (astroSignals?.data || []).filter(s => s.outcome !== 'OPEN').forEach(s => {
      const k = s.event_type;
      if (!astroStats[k]) astroStats[k] = { hits: 0, total: 0 };
      astroStats[k].total++;
      if (s.outcome === 'HIT') astroStats[k].hits++;
    });
 
    res.json({
      date: today,
      meta: reportMeta?.data || {},
      picks: {
        today: todayPicks?.data || [],
        perf7d: pickPerf7d?.data || [],
        perf30d: pickPerf30d?.data || [],
        perf180d: pickPerf180d?.data || [],
        winRate7d: calcWinRate(pickPerf7d),
        winRate30d: calcWinRate(pickPerf30d),
        winRate180d: calcWinRate(pickPerf180d),
      },
      funds: {
        today: fundScores?.data || [],
        d7: fundScores7d?.data || [],
        d30: fundScores30d?.data || [],
        d180: fundScores180d?.data || [],
      },
      clients: {
        flags: clientFlags?.data || [],
        bucketToday: countBuckets(bucketToday),
        bucket7d: countBuckets(bucket7d),
        bucket30d: countBuckets(bucket30d),
      },
      screener: metricContext,
      astro: { signals: astroSignals?.data || [], stats: astroStats },
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});
 
// ── GET /api/pulse/score-history?client=NAME&days=90 ─────────────
router.get('/score-history', async (req, res) => {
  try {
    const { client, fund = 'UCWF', days = 90 } = req.query;
    const cutoff = NDAYS_AGO(parseInt(days));
    let q = supabase.from('pulse_score_snapshot').select('snapshot_date,health_score,hygiene_score,total_score,bucket,aum,return_pct')
      .gte('snapshot_date', cutoff).order('snapshot_date', { ascending: true });
    if (client) q = q.eq('client_name', client);
    else q = q.is('client_name', null).eq('fund', fund);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ history: data || [] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
 
// ── GET /api/pulse/client-flags?days=30 ──────────────────────────
router.get('/client-flags', async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const { data, error } = await supabase.from('pulse_client_flags')
      .select('*').gte('flag_date', NDAYS_AGO(parseInt(days)))
      .eq('resolved', false).order('severity').order('flag_date', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ flags: data || [] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
 
// ── POST /api/pulse/log-pick ──────────────────────────────────────
router.post('/log-pick', requireManagerPlus, validate(pulseLogPickSchema), async (req, res) => {
  try {
    const { symbol, company, fund, signalType, entryPrice, rationale, factorScores, sector, date } = req.body;
    if (!symbol) return res.status(400).json({ error: 'symbol required' });
    const { error } = await supabase.from('pulse_picks_log').insert([{
      pick_date: date || TODAY(),
      symbol, company_name: company, fund: fund || 'ALL',
      signal_type: signalType || 'BUY',
      entry_price: entryPrice,
      rationale, factor_scores: factorScores || {}, sector
    }]);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
 
// ── POST /api/pulse/resolve-flag ──────────────────────────────────
router.post('/resolve-flag', requireManagerPlus, validate(pulseResolveFlagSchema), async (req, res) => {
  try {
    const { id } = req.body;
    await supabase.from('pulse_client_flags').update({ resolved: true }).eq('id', id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
 
// ── GET /api/pulse/picks-history?days=180 ────────────────────────
router.get('/picks-history', async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const { data, error } = await supabase.from('pulse_pick_performance')
      .select('*, pulse_picks_log(symbol,company_name,sector,fund,rationale,entry_price,signal_type)')
      .gte('pick_date', NDAYS_AGO(parseInt(days)))
      .order('pick_date', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ picks: data || [] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
 
module.exports = router;
