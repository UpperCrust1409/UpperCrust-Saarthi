// ─────────────────────────────────────────────────────────────────
// crons/sectorScoreCron.js
// Runs 6:30 AM IST daily — sector scores + market regime
// ─────────────────────────────────────────────────────────────────
'use strict';

const cron = require('node-cron');
const { computeScores } = require('../services/astroScoreService');
const { supabase } = require('../db/supabase');

async function runSectorScoreJob(dateStr) {
  dateStr = dateStr || new Date().toISOString().split('T')[0];
  console.log(`[SectorCron] Running for ${dateStr}`);

  try {
    const { data: positions } = await supabase
      .from('astro_planet_positions')
      .select('*')
      .eq('date', dateStr);

    if (!positions || !positions.length) {
      console.log('[SectorCron] No positions found — planet cron may not have run yet');
      return;
    }

    const { sectorScores, regime } = await computeScores(dateStr, positions);

    await supabase.from('astro_sector_scores')
      .upsert(sectorScores, { onConflict: 'date,sector' });

    await supabase.from('astro_market_regime')
      .upsert([regime], { onConflict: 'date' });

    console.log(`[SectorCron] Done — ${sectorScores.length} sectors scored, regime: ${regime.regime_label}`);
  } catch (e) {
    console.error('[SectorCron] Error:', e.message);
  }
}

// Schedule: 6:30 AM IST = 1:00 UTC
cron.schedule('0 1 * * *', () => runSectorScoreJob(), { timezone: 'UTC' });

module.exports = { runSectorScoreJob };
