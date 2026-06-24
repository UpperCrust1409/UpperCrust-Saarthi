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

// All routes require auth
router.use(requireAuth);

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
router.post('/backtest', async (req, res) => {
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
router.post('/ai-query', async (req, res) => {
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

// ── POST /api/astro/admin/run-cron (admin only, for manual trigger) ──
router.post('/admin/run-cron', requireAuth, async (req, res) => {
  const { user } = req;
  if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
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
router.post('/admin/backfill', requireAuth, async (req, res) => {
  const { user } = req;
  if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

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

module.exports = router;
