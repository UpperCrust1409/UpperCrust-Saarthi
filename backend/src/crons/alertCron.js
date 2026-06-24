// ─────────────────────────────────────────────────────────────────
// crons/alertCron.js
// Runs 7:00 AM IST Mon/Wed/Fri — generate alerts with evidence
// ─────────────────────────────────────────────────────────────────
'use strict';

const cron = require('node-cron');
const { supabase } = require('../db/supabase');

async function runAlertJob() {
  const today = new Date().toISOString().split('T')[0];
  console.log(`[AlertCron] Running for ${today}`);

  try {
    // Expire old alerts
    await supabase.from('astro_alerts')
      .update({ is_active: false })
      .lt('expires_at', today);

    const alerts = [];

    // Get current positions
    const { data: positions } = await supabase
      .from('astro_planet_positions')
      .select('*')
      .eq('date', today);

    if (!positions) return;

    const posMap = Object.fromEntries(positions.map(p => [p.planet, p]));

    // Alert 1: Active retrogrades
    const retroPlanets = positions.filter(p => p.retrograde && !['Rahu','Ketu'].includes(p.planet));
    for (const p of retroPlanets) {
      // Check if alert already active
      const { data: existing } = await supabase
        .from('astro_alerts')
        .select('id')
        .eq('is_active', true)
        .like('title', `%${p.planet} Retrograde%`)
        .limit(1);

      if (!existing || !existing.length) {
        // Fetch historical backtest evidence
        const { data: bt } = await supabase
          .from('astro_backtests')
          .select('avg_return_pct, win_rate_pct, n_observations')
          .eq('event_type', `${p.planet.toUpperCase()}_RETROGRADE`)
          .eq('instrument', 'NIFTY50')
          .limit(1)
          .single();

        const evidence = bt
          ? `During ${bt.n_observations} ${p.planet} retrogrades since 2005, Nifty 50 averaged ${bt.avg_return_pct > 0 ? '+' : ''}${bt.avg_return_pct?.toFixed(2)}% over 30 days (${bt.win_rate_pct?.toFixed(0)}% win rate).`
          : `Historical data for ${p.planet} retrograde being compiled — check Backtest Lab.`;

        alerts.push({
          alert_type: 'RETROGRADE',
          title: `${p.planet} Retrograde Active`,
          description: `${p.planet} is currently retrograde in ${p.sign}. Sectors ruled by ${p.planet} may see heightened sensitivity.`,
          historical_evidence: evidence,
          confidence: bt ? (bt.n_observations >= 5 ? 70 : 50) : 35,
          planets_involved: [p.planet],
          expires_at: addDays(today, 14),
          is_active: true
        });
      }
    }

    // Alert 2: High volatility regime
    const { data: regime } = await supabase
      .from('astro_market_regime')
      .select('*')
      .eq('date', today)
      .single();

    if (regime && regime.volatility_score > 65) {
      alerts.push({
        alert_type: 'VOLATILITY',
        title: 'High Volatility Astro Regime',
        description: `Volatility score is ${regime.volatility_score?.toFixed(0)}/100. Moon instability + elevated Rahu influence detected.`,
        historical_evidence: 'Historically, high astro-volatility regimes have coincided with above-average intraday swings. Exercise position-size discipline.',
        confidence: Math.min(80, regime.volatility_score),
        planets_involved: ['Moon', 'Rahu'],
        expires_at: addDays(today, 3),
        is_active: true
      });
    }

    // Alert 3: Strong Jupiter (favorable for BFSI/Banking)
    const ju = posMap['Jupiter'];
    if (ju && ju.strength > 70 && !ju.retrograde) {
      alerts.push({
        alert_type: 'FAVORABLE_CYCLE',
        title: 'Favorable Jupiter Cycle',
        description: `Jupiter strength at ${ju.strength?.toFixed(0)}/100 in ${ju.sign}. Banking and Financial Services sectors historically benefit during strong Jupiter periods.`,
        historical_evidence: 'Sectors mapped to Jupiter (Banking, Financial Services) have shown above-average astro scores during Jupiter strength > 70 in the last 5 years.',
        confidence: 62,
        planets_involved: ['Jupiter'],
        expires_at: addDays(today, 7),
        is_active: true
      });
    }

    // Upcoming event alerts (next 7 days)
    const { data: upcoming } = await supabase
      .from('astro_planetary_events')
      .select('*')
      .gte('event_date', today)
      .lte('event_date', addDays(today, 7))
      .in('event_type', ['RETROGRADE_START', 'SIGN_CHANGE', 'ECLIPSE_SOLAR', 'ECLIPSE_LUNAR']);

    for (const ev of (upcoming || [])) {
      alerts.push({
        alert_type: 'UPCOMING_EVENT',
        title: `Upcoming: ${ev.description}`,
        description: `${ev.event_type.replace('_', ' ')} on ${ev.event_date}. Watch sectors mapped to ${ev.planet}.`,
        historical_evidence: 'Check the Backtest Lab for historical market behavior around this event type.',
        confidence: 55,
        planets_involved: [ev.planet, ev.planet2].filter(Boolean),
        expires_at: addDays(ev.event_date, 1),
        is_active: true
      });
    }

    if (alerts.length) {
      await supabase.from('astro_alerts').insert(alerts);
      console.log(`[AlertCron] Generated ${alerts.length} alerts`);
    } else {
      console.log('[AlertCron] No new alerts generated');
    }
  } catch (e) {
    console.error('[AlertCron] Error:', e.message);
  }
}

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

// 7:00 AM IST = 1:30 UTC, Mon/Wed/Fri
cron.schedule('30 1 * * 1,3,5', () => runAlertJob(), { timezone: 'UTC' });

module.exports = { runAlertJob };
