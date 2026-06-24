// ─────────────────────────────────────────────────────────────────
// crons/dailyPlanetCron.js
// Runs 6:00 AM IST daily — planet positions + event detection
// ─────────────────────────────────────────────────────────────────
'use strict';
 
const cron = require('node-cron');
const { calcAllPlanetsForDate, detectEvents } = require('../services/ephemerisService');
const { supabase } = require('../db/supabase');
 
async function runDailyPlanetJob(dateStr) {
  dateStr = dateStr || new Date().toISOString().split('T')[0];
  console.log(`[PlanetCron] Running for ${dateStr}`);
 
  try {
    // Get yesterday for event detection
    const yesterday = new Date(dateStr);
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().split('T')[0];
 
    const todayPos   = calcAllPlanetsForDate(dateStr);
    const yesterdayPos = calcAllPlanetsForDate(yStr);
 
    // Upsert planet positions
    const rows = todayPos.map(p => ({ date: dateStr, ...p }));
    const { error } = await supabase
      .from('astro_planet_positions')
      .upsert(rows, { onConflict: 'date,planet' });
 
    if (error) console.error('[PlanetCron] DB error:', error.message);
 
    // Detect and store events
    const events = detectEvents(yesterdayPos, todayPos, dateStr);
    if (events.length) {
      await supabase.from('astro_planetary_events').upsert(events, { onConflict: 'event_date,event_type,planet' });
      console.log(`[PlanetCron] ${events.length} events detected`);
    }
 
    console.log(`[PlanetCron] Done — ${todayPos.length} positions stored`);
  } catch (e) {
    console.error('[PlanetCron] Error:', e.message);
  }
}
 
// Schedule: 6:00 AM IST = 0:30 UTC
cron.schedule('30 0 * * *', () => runDailyPlanetJob(), { timezone: 'UTC' });
 
module.exports = { runDailyPlanetJob };
