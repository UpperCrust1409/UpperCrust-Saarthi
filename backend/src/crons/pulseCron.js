// ═══════════════════════════════════════════════════════════════
// pulseCron.js — Runs daily at 6:15 AM IST (00:45 UTC)
// After planet cron (6:00 AM) and sector cron (6:30 AM)
// ═══════════════════════════════════════════════════════════════
'use strict';

const { supabase } = require('../db/supabase');
const { runDailyPulseJob } = require('../services/pulseService');

async function runPulseCron() {
  console.log('[PulseCron] Starting daily pulse job');
  const today = new Date().toISOString().split('T')[0];

  try {
    // Load clients from Supabase (stored by the portfolio upload)
    const { data: portfolioData } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'portfolio_snapshot')
      .single();

    // Load screener data
    const { data: screenerData } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'screener_snapshot')
      .single();

    let clients = [];
    let screener = {};

    if (portfolioData?.value) {
      try { clients = JSON.parse(portfolioData.value) || []; } catch(e) {}
    }

    if (screenerData?.value) {
      try { screener = JSON.parse(screenerData.value) || {}; } catch(e) {}
    }

    console.log(`[PulseCron] Loaded ${clients.length} clients, ${Object.keys(screener).length} screener stocks`);

    await runDailyPulseJob({ clients, screenerData: screener, kiteQuotes: {} });
    console.log('[PulseCron] Done for', today);

  } catch(e) {
    console.error('[PulseCron] Error:', e.message);
  }
}

module.exports = { runPulseCron };
