// ─────────────────────────────────────────────────────────────────
// backfill_runner.js
// ONE-TIME script: generates planet positions 2005-01-01 → today
// Run locally: node backfill_runner.js
// Set ASTRO_BACKFILL_DONE=true in Railway env after this completes
// ─────────────────────────────────────────────────────────────────
'use strict';
 
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
 
// Inline supabase client (don't depend on app structure)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
);
 
const { calcAllPlanetsForDate, detectEvents } = require('../src/services/ephemerisService');
const { computeScores } = require('../src/services/astroScoreService');
 
async function main() {
  const FROM = process.argv[2] || '2005-01-01';
  const TO   = process.argv[3] || new Date().toISOString().split('T')[0];
 
  console.log(`\n🪐 AstroQuant Backfill — ${FROM} to ${TO}\n`);
 
  const cur  = new Date(FROM);
  const end  = new Date(TO);
  let prev   = null;
  let count  = 0;
  let errors = 0;
 
  while (cur <= end) {
    const dateStr = cur.toISOString().split('T')[0];
 
    try {
      // 1. Planet positions
      const positions = calcAllPlanetsForDate(dateStr);
      const rows = positions.map(p => ({ date: dateStr, ...p }));
      await supabase.from('astro_planet_positions').upsert(rows, { onConflict: 'date,planet' });
 
      // 2. Event detection
      if (prev) {
        const events = detectEvents(prev, positions, dateStr);
        if (events.length) {
          await supabase.from('astro_planetary_events')
            .upsert(events, { onConflict: 'event_date,event_type,planet' });
        }
      }
      prev = positions;
 
      // 3. Sector scores + regime
      const { sectorScores, regime } = await computeScores(dateStr, positions);
      await supabase.from('astro_sector_scores').upsert(sectorScores, { onConflict: 'date,sector' });
      await supabase.from('astro_market_regime').upsert([regime], { onConflict: 'date' });
 
      count++;
      if (count % 100 === 0) {
        const pct = ((cur - new Date(FROM)) / (end - new Date(FROM)) * 100).toFixed(1);
        console.log(`  ✓ ${dateStr} — ${count} days done (${pct}%)`);
      }
    } catch(e) {
      errors++;
      console.error(`  ✗ ${dateStr} — ${e.message}`);
    }
 
    cur.setDate(cur.getDate() + 1);
  }
 
  console.log(`\n✓ Backfill complete: ${count} days, ${errors} errors`);
  console.log('Set ASTRO_BACKFILL_DONE=true in Railway environment variables.\n');
}
 
main().catch(e => { console.error('Fatal:', e); process.exit(1); });
