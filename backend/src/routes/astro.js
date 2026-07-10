// ─────────────────────────────────────────────────────────────────
// routes/astro.js — All /api/astro/* endpoints
// Mount in server.js: app.use('/api/astro', require('./routes/astro'));
// ─────────────────────────────────────────────────────────────────
'use strict';
 
const express = require('express');
const router  = express.Router();
const { supabase } = require('../db/supabase');
const { requireAuth } = require('../middleware/auth');
const { runBacktest } = require('../services/backtestService');
const { answerQuery, SUGGESTED_QUESTIONS } = require('../services/astroAIService');
const { runDailyPlanetJob } = require('../crons/dailyPlanetCron');
const { runSectorScoreJob } = require('../crons/sectorScoreCron');
const { validate } = require('../validation/validate');
const { astroBacktestSchema, astroAIQuerySchema, astroRunCronSchema, astroBackfillSchema } = require('../validation/schemas');
const { getIndiaDasha, getCurrentDashaLords, kpSubLord } = require('../services/dashaService');
const { computePanchangRange } = require('../services/panchangService');
 
// All routes require auth
router.use(requireAuth);
 
// ── GET /api/astro/india-dasha ─────────────────────────────────────
// India's national chart (15 Aug 1947, 00:00 IST, Delhi) Vimshottari
// Mahadasha/Antardasha timeline — deterministic Parashari arithmetic,
// no interpretation. Cross-checked against published reference dates
// (Venus 1989-2009, Sun 2009-15, Moon 2015-25, Mars 2025-32 — all match).
router.get('/india-dasha', async (req, res) => {
  try {
    const dasha = getIndiaDasha();
    const current = getCurrentDashaLords(dasha);
    res.json({ ...dasha, current });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
// ── GET /api/astro/panchang?days=30 ────────────────────────────────
// Tithi, Karana (Bhadra/Vishti), Panchak calendar — the classical
// Teji-Mandi (Argha Martand) financial timing filters. Pure arithmetic
// from Sun-Moon angular difference.
router.get('/panchang', async (req, res) => {
  try {
    const days = Math.min(60, parseInt(req.query.days) || 30);
    const today = new Date().toISOString().slice(0,10);
    res.json({ days: computePanchangRange(today, days) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
// ── GET /api/astro/kp-sublords ──────────────────────────────────────
// KP sub-lord for every planet today — reuses today's already-computed
// sidereal positions (astro_planet_positions), just adds the sub-lord
// layer. Scoped to planetary positions, not house cusps (see comment
// in dashaService.js for why).
router.get('/kp-sublords', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { data: planets, error } = await supabase.from('astro_planet_positions').select('*').eq('date', today).order('planet');
    if (error) throw error;
    const result = (planets||[]).map(p => ({
      planet: p.planet, sign: p.sign, nakshatra: p.nakshatra, longitude: p.longitude,
      ...kpSubLord(p.longitude),
    }));
    res.json({ date: today, planets: result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
// ── GET /api/astro/commodity?ticker=GOLD&range=6mo ─────────────────
// Yahoo Finance's unofficial v8 chart endpoint — no official API since
// 2017, but the endpoint that powers their own site still works, free,
// no key. Same reliability class as any unofficial scrape (can break
// without notice) — whitelisted tickers only, fails gracefully.
const COMMODITY_TICKERS = {
  GOLD: 'GC=F', SILVER: 'SI=F', CRUDE: 'CL=F', COPPER: 'HG=F',
  NATGAS: 'NG=F', CORN: 'ZC=F', COTTON: 'CT=F', SOYBEAN: 'ZS=F',
};
router.get('/commodity', async (req, res) => {
  try {
    const key = (req.query.ticker || '').toUpperCase();
    const ticker = COMMODITY_TICKERS[key];
    if (!ticker) return res.status(400).json({ error: 'Unknown ticker. Use one of: ' + Object.keys(COMMODITY_TICKERS).join(', ') });
    const range = ['1mo','3mo','6mo','1y'].includes(req.query.range) ? req.query.range : '6mo';
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=1d`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
    if (!resp.ok) return res.status(502).json({ error: 'Yahoo Finance returned ' + resp.status + ' — unofficial endpoint may be temporarily unavailable' });
    const data = await resp.json();
    const result = data?.chart?.result?.[0];
    if (!result) return res.status(502).json({ error: 'Unexpected response shape from Yahoo Finance' });
    const ts = result.timestamp || [];
    const q = result.indicators?.quote?.[0] || {};
    const candles = ts.map((t,i) => ({
      date: new Date(t*1000).toISOString().slice(0,10),
      open: q.open?.[i], high: q.high?.[i], low: q.low?.[i], close: q.close?.[i],
    })).filter(c => c.close != null);
    res.json({ ticker, name: key, currency: result.meta?.currency, candles });
  } catch (err) { res.status(500).json({ error: 'Yahoo Finance fetch failed: ' + err.message }); }
});
 
// ── GET /api/astro/dashboard ──────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
 
    const [{ data: planets }, { data: regime }, { data: events }] = await Promise.all([
      supabase.from('astro_planet_positions').select('*').eq('date', today).order('planet'),
      supabase.from('astro_market_regime').select('*').eq('date', today).single(),
      supabase.from('astro_planetary_events')
        .select('event_date, event_type, planet, description')
        .gte('event_date', today)
        .order('event_date').limit(8)
    ]);
 
    res.json({ date: today, planets: planets || [], regime: regime || {}, upcomingEvents: events || [] });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});
 
// ── GET /api/astro/sectors ────────────────────────────────────────
router.get('/sectors', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
 
    const { data: scores } = await supabase
      .from('astro_sector_scores')
      .select('*')
      .eq('date', date)
      .order('astro_score', { ascending: false });
 
    // Also return 90-day history for trend
    const from90 = new Date();
    from90.setDate(from90.getDate() - 90);
    const { data: history } = await supabase
      .from('astro_sector_scores')
      .select('date, sector, astro_score')
      .gte('date', from90.toISOString().split('T')[0])
      .order('date');
 
    res.json({ date, scores: scores || [], history: history || [] });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});
 
// ── GET /api/astro/events ─────────────────────────────────────────
router.get('/events', async (req, res) => {
  try {
    const from = req.query.from || new Date().toISOString().split('T')[0];
    const to   = req.query.to   || (() => { const d = new Date(); d.setDate(d.getDate()+90); return d.toISOString().split('T')[0]; })();
 
    const { data: events } = await supabase
      .from('astro_planetary_events')
      .select('*')
      .gte('event_date', from)
      .lte('event_date', to)
      .order('event_date');
 
    res.json({ events: events || [] });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});
 
// ── GET /api/astro/alerts ─────────────────────────────────────────
router.get('/alerts', async (req, res) => {
  try {
    const { data: alerts } = await supabase
      .from('astro_alerts')
      .select('*')
      .eq('is_active', true)
      .order('generated_at', { ascending: false });
 
    res.json({ alerts: alerts || [] });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});
 
// ── GET /api/astro/regime/history ────────────────────────────────
router.get('/regime/history', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 365;
    const from = new Date();
    from.setDate(from.getDate() - days);
 
    const { data } = await supabase
      .from('astro_market_regime')
      .select('date, risk_appetite, volatility_score, liquidity_score, sentiment_score, regime_label')
      .gte('date', from.toISOString().split('T')[0])
      .order('date');
 
    res.json({ history: data || [] });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});
 
// ── POST /api/astro/backtest ──────────────────────────────────────
router.post('/backtest', validate(astroBacktestSchema), async (req, res) => {
  try {
    const { event_type, instrument, window_days, date_from, date_to } = req.body;
    if (!event_type || !instrument) return res.status(400).json({ error: 'event_type and instrument required' });
 
    const result = await runBacktest({ event_type, instrument, window_days: window_days || 30, date_from, date_to });
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});
 
// ── POST /api/astro/ai-query ──────────────────────────────────────
router.post('/ai-query', validate(astroAIQuerySchema), async (req, res) => {
  try {
    const { question } = req.body;
    if (!question || question.trim().length < 5) return res.status(400).json({ error: 'Question too short' });
    const result = await answerQuery(question.trim());
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});
 
// ── GET /api/astro/ai-query/suggestions ──────────────────────────
router.get('/ai-query/suggestions', (req, res) => {
  res.json({ suggestions: SUGGESTED_QUESTIONS });
});
 
// requireAuth already runs for every route in this file (router.use(requireAuth)
// above), so req.user is always populated by the time this runs. This ensures
// authorization is enforced via middleware — before validate() — rather than as
// an inline check inside the handler body.
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}
 
// ── POST /api/astro/admin/run-cron (admin only, for manual trigger) ──
router.post('/admin/run-cron', requireAdmin, validate(astroRunCronSchema), async (req, res) => {
  const { job, date } = req.body;
  try {
    if (job === 'planets') await runDailyPlanetJob(date);
    else if (job === 'scores') await runSectorScoreJob(date);
    else return res.status(400).json({ error: 'Unknown job' });
    res.json({ ok: true, job, date });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});
 
// ── One-time historical backfill (admin only) ─────────────────────
router.post('/admin/backfill', requireAdmin, validate(astroBackfillSchema), async (req, res) => {
  // Fire async, return immediately
  res.json({ ok: true, message: 'Backfill started in background. Monitor Railway logs.' });
 
  setImmediate(async () => {
    const { calcAllPlanetsForDate, detectEvents } = require('../services/ephemerisService');
    const { computeScores } = require('../services/astroScoreService');
 
    const from = new Date(req.body.from || '2005-01-01');
    const to   = new Date(req.body.to   || new Date().toISOString().split('T')[0]);
 
    let prev = null;
    const cur = new Date(from);
    let count = 0;
 
    while (cur <= to) {
      const dateStr = cur.toISOString().split('T')[0];
      try {
        const positions = calcAllPlanetsForDate(dateStr);
        const rows = positions.map(p => ({ date: dateStr, ...p }));
        await supabase.from('astro_planet_positions').upsert(rows, { onConflict: 'date,planet' });
 
        if (prev) {
          const events = detectEvents(prev, positions, dateStr);
          if (events.length) {
            await supabase.from('astro_planetary_events').upsert(events, { onConflict: 'event_date,event_type,planet' });
          }
        }
        prev = positions;
 
        const { sectorScores, regime } = await computeScores(dateStr, positions);
        await supabase.from('astro_sector_scores').upsert(sectorScores, { onConflict: 'date,sector' });
        await supabase.from('astro_market_regime').upsert([regime], { onConflict: 'date' });
 
        count++;
        if (count % 100 === 0) console.log(`[Backfill] ${dateStr} — ${count} days done`);
      } catch(e) {
        console.error(`[Backfill] Error on ${dateStr}:`, e.message);
      }
      cur.setDate(cur.getDate() + 1);
    }
    console.log(`[Backfill] Complete — ${count} days processed`);
  });
});
 
 
// ── Bulk backtest cache fetch (for Signal Hub / Front-Test) ──────
router.get('/backtests/bulk', async (req, res) => {
  try {
    const { instrument, window_days = 30 } = req.query;
    const { supabase } = require('../db/supabase');
    let query = supabase
      .from('astro_backtests')
      .select('event_type, instrument, window_days, n_observations, avg_return_pct, win_rate_pct, cagr_pct, sharpe_ratio, date_from, date_to')
      .eq('window_days', parseInt(window_days))
      .gt('n_observations', 3);
    if (instrument) query = query.eq('instrument', instrument);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ backtests: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
 
router.get('/backtests/bulk-all', async (req, res) => {
  try {
    const { window_days = 30 } = req.query;
    const { supabase } = require('../db/supabase');
    const { data, error } = await supabase
      .from('astro_backtests')
      .select('event_type, instrument, window_days, n_observations, avg_return_pct, win_rate_pct, cagr_pct, sharpe_ratio, date_from, date_to')
      .eq('window_days', parseInt(window_days))
      .gt('n_observations', 3)
      .order('avg_return_pct', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ backtests: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
 
module.exports = router;
