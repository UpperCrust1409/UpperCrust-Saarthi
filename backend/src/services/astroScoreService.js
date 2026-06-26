// ─────────────────────────────────────────────────────────────────
// astroScoreService.js
// Planet positions → sector astro scores + market regime
// ─────────────────────────────────────────────────────────────────
'use strict';

const { supabase } = require('../db/supabase');

// Combustion: planet within N° of Sun → weakened
const COMBUST_ORB = { Mercury: 14, Mars: 17, Jupiter: 11, Venus: 10, Saturn: 15 };

function lonDiff(a, b) {
  const d = Math.abs(a - b);
  return Math.min(d, 360 - d);
}

function isCombust(planetName, planetLon, sunLon) {
  const orb = COMBUST_ORB[planetName];
  if (!orb) return false;
  return lonDiff(planetLon, sunLon) <= orb;
}

/**
 * Compute sector astro scores from planet positions.
 * Returns { sectorScores: [...], regime: {...} }
 */
async function computeScores(dateStr, positions) {
  // Load sector-planet mapping
  const { data: maps } = await supabase
    .from('astro_sector_planet_map')
    .select('*');

  if (!maps || !maps.length) throw new Error('No sector-planet mapping found');

  const posMap = Object.fromEntries(positions.map(p => [p.planet, p]));
  const sunPos = posMap['Sun'];

  // Adjust planet strengths for combustion
  const adjStrength = {};
  for (const pos of positions) {
    let s = pos.strength;
    if (sunPos && isCombust(pos.planet, pos.longitude, sunPos.longitude)) s -= 10;
    adjStrength[pos.planet] = Math.max(0, Math.min(100, s));
  }

  // Group maps by sector
  const bySector = {};
  for (const m of maps) {
    if (!bySector[m.sector]) bySector[m.sector] = [];
    bySector[m.sector].push(m);
  }

  const sectorScores = [];
  for (const [sector, mappings] of Object.entries(bySector)) {
    let weightedScore = 0;
    let totalWeight = 0;
    let retrogradeActive = false;
    const factors = {};
    let primaryPlanet = mappings[0].planet;
    let maxWeight = 0;

    for (const m of mappings) {
      const p = posMap[m.planet];
      if (!p) continue;
      const s = adjStrength[m.planet] || 50;
      weightedScore += s * m.weight;
      totalWeight += parseFloat(m.weight);
      if (p.retrograde) retrogradeActive = true;
      factors[m.planet] = { strength: s, weight: m.weight, retrograde: p.retrograde, sign: p.sign };
      if (parseFloat(m.weight) > maxWeight) { maxWeight = parseFloat(m.weight); primaryPlanet = m.planet; }
    }

    let astro_score = totalWeight > 0 ? weightedScore / totalWeight : 50;
    if (retrogradeActive) astro_score -= 15;
    astro_score = Math.max(0, Math.min(100, Math.round(astro_score * 10) / 10));

    // Dynamic confidence based on planet state quality
    let confidence = 50;
    // Base confidence from planet strength
    const avgStrength = Object.values(factors).reduce((s,f)=>s+(f.strength||50),0) / Math.max(Object.keys(factors).length,1);
    confidence = Math.round(40 + (avgStrength / 100) * 40); // 40-80 range
    // Retrograde penalty
    if (retrogradeActive) confidence = Math.round(confidence * 0.75);
    // Exaltation boost — if primary planet is in exaltation sign, higher confidence
    const primPos = posMap[primaryPlanet];
    if (primPos && primPos.strength > 70) confidence = Math.min(85, confidence + 10);
    if (primPos && primPos.strength < 40) confidence = Math.max(30, confidence - 10);
    confidence = Math.max(30, Math.min(85, confidence));

    sectorScores.push({
      date: dateStr, sector, astro_score,
      primary_planet: primaryPlanet,
      planet_strength: adjStrength[primaryPlanet] || 50,
      retrograde_active: retrogradeActive,
      confidence,
      factors
    });
  }

  // Market regime scores
  const ju = adjStrength['Jupiter'] || 50;
  const su = adjStrength['Sun'] || 50;
  const ma = adjStrength['Mars'] || 50;
  const mo = adjStrength['Moon'] || 50;
  const me = adjStrength['Mercury'] || 50;
  const ve = adjStrength['Venus'] || 50;
  const ra = adjStrength['Rahu'] || 50;

  const risk_appetite    = Math.round((ju * 0.4 + su * 0.3 + ma * 0.3) * 10) / 10;
  const volatility_score = Math.round(((100 - mo) * 0.5 + ra * 0.3 + ma * 0.2) * 10) / 10;
  const liquidity_score  = Math.round((me * 0.6 + ve * 0.4) * 10) / 10;
  const sentiment_score  = Math.round((ju * 0.5 + ve * 0.3 + mo * 0.2) * 10) / 10;

  let regime_label = 'NEUTRAL';
  if (risk_appetite > 65 && sentiment_score > 60) regime_label = 'BULLISH_ASTRO';
  else if (risk_appetite < 40 || volatility_score > 65) regime_label = 'VOLATILE';
  else if (sentiment_score < 40) regime_label = 'BEARISH_ASTRO';

  const regime = {
    date: dateStr,
    risk_appetite: Math.max(0, Math.min(100, risk_appetite)),
    volatility_score: Math.max(0, Math.min(100, volatility_score)),
    liquidity_score: Math.max(0, Math.min(100, liquidity_score)),
    sentiment_score: Math.max(0, Math.min(100, sentiment_score)),
    regime_label
  };

  return { sectorScores, regime };
}

module.exports = { computeScores };
