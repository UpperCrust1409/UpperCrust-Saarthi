// ─────────────────────────────────────────────────────────────────
// ephemerisService.js
// Swiss Ephemeris wrapper — Lahiri ayanamsha (Indian sidereal)
// ─────────────────────────────────────────────────────────────────
'use strict';

let swisseph;
try {
  swisseph = require('swisseph');
} catch(e) {
  console.error('[Ephemeris] swisseph not installed. Run: npm install swisseph');
  throw e;
}

const PLANET_IDS = {
  Sun:     swisseph.SE_SUN,
  Moon:    swisseph.SE_MOON,
  Mars:    swisseph.SE_MARS,
  Mercury: swisseph.SE_MERCURY,
  Jupiter: swisseph.SE_JUPITER,
  Venus:   swisseph.SE_VENUS,
  Saturn:  swisseph.SE_SATURN,
  Rahu:    swisseph.SE_TRUE_NODE,
};

const SIGNS = [
  'Aries','Taurus','Gemini','Cancer','Leo','Virgo',
  'Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces'
];

const NAKSHATRAS = [
  'Ashwini','Bharani','Krittika','Rohini','Mrigashira','Ardra',
  'Punarvasu','Pushya','Ashlesha','Magha','Purva Phalguni','Uttara Phalguni',
  'Hasta','Chitra','Swati','Vishakha','Anuradha','Jyeshtha',
  'Moola','Purva Ashadha','Uttara Ashadha','Shravana','Dhanishtha',
  'Shatabhisha','Purva Bhadrapada','Uttara Bhadrapada','Revati'
];

// Exaltation / debilitation signs (sign_num 1–12)
const DIGNITY = {
  Sun:     { ex: 1,  de: 7  },  // Aries / Libra
  Moon:    { ex: 2,  de: 8  },  // Taurus / Scorpio
  Mars:    { ex: 10, de: 4  },  // Capricorn / Cancer
  Mercury: { ex: 6,  de: 12 },  // Virgo / Pisces
  Jupiter: { ex: 4,  de: 10 },  // Cancer / Capricorn
  Venus:   { ex: 12, de: 6  },  // Pisces / Virgo
  Saturn:  { ex: 7,  de: 1  },  // Libra / Aries
};

// Own signs (mooltrikona / domicile)
const OWN_SIGNS = {
  Sun: [5], Moon: [4], Mars: [1,8], Mercury: [3,6],
  Jupiter: [9,12], Venus: [2,7], Saturn: [10,11]
};

function normalizeLon(lon) {
  return ((lon % 360) + 360) % 360;
}

function getSignFromLon(lon) {
  const n = Math.floor(normalizeLon(lon) / 30);
  return { sign: SIGNS[n], sign_num: n + 1 };
}

function getNakshatra(lon) {
  const idx = Math.floor((normalizeLon(lon) * 27) / 360);
  return NAKSHATRAS[idx] || 'Unknown';
}

function computeStrength(planet, lon, speed, retrograde, sign_num) {
  let s = 50;
  const dg = DIGNITY[planet];
  if (dg) {
    if (sign_num === dg.ex) s += 12;
    if (sign_num === dg.de) s -= 12;
  }
  const own = OWN_SIGNS[planet] || [];
  if (own.includes(sign_num)) s += 7;
  if (!retrograde) s += 10;
  else s -= 8;
  // Speed bonus (faster = more active)
  const absSpeed = Math.abs(speed || 0);
  s += Math.min(10, absSpeed * 3);
  return Math.max(0, Math.min(100, Math.round(s * 10) / 10));
}

/**
 * Calculate all planet positions for a given date string (YYYY-MM-DD).
 * Returns array of planet data objects.
 */
function calcAllPlanetsForDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const jd = swisseph.swe_julday(y, m, d, 12.0, swisseph.SE_GREG_CAL);
  swisseph.swe_set_sid_mode(swisseph.SE_SIDM_LAHIRI, 0, 0);
  const flag = swisseph.SEFLG_SIDEREAL | swisseph.SEFLG_SPEED;

  const results = [];

  for (const [planet, planetId] of Object.entries(PLANET_IDS)) {
    const r = swisseph.swe_calc_ut(jd, planetId, flag);
    if (!r || r.flag === swisseph.ERR) continue;

    let lon = normalizeLon(r.longitude);
    // Ketu = Rahu + 180
    const speed = r.longitudeSpeed;
    const retrograde = speed < 0;
    const { sign, sign_num } = getSignFromLon(lon);
    const nakshatra = getNakshatra(lon);
    const strength = computeStrength(planet, lon, speed, retrograde, sign_num);

    results.push({ planet, longitude: lon, sign, sign_num, nakshatra, retrograde, speed, strength });

    // Add Ketu automatically when we process Rahu
    if (planet === 'Rahu') {
      const ketuLon = normalizeLon(lon + 180);
      const { sign: ks, sign_num: ksn } = getSignFromLon(ketuLon);
      results.push({
        planet: 'Ketu',
        longitude: ketuLon,
        sign: ks, sign_num: ksn,
        nakshatra: getNakshatra(ketuLon),
        retrograde: true,
        speed: -speed,
        strength: computeStrength('Saturn', ketuLon, speed, true, ksn) // Saturn-like behavior
      });
    }
  }

  return results;
}

/**
 * Detect discrete events by comparing yesterday vs today.
 */
function detectEvents(prevPositions, currPositions, dateStr) {
  const events = [];
  const prev = Object.fromEntries(prevPositions.map(p => [p.planet, p]));
  const curr = Object.fromEntries(currPositions.map(p => [p.planet, p]));

  for (const planet of Object.keys(curr)) {
    const p = prev[planet];
    const c = curr[planet];
    if (!p) continue;

    // Retrograde start/end
    if (!p.retrograde && c.retrograde) {
      events.push({ event_date: dateStr, event_type: 'RETROGRADE_START', planet,
        description: `${planet} stations retrograde in ${c.sign}` });
    }
    if (p.retrograde && !c.retrograde) {
      events.push({ event_date: dateStr, event_type: 'RETROGRADE_END', planet,
        description: `${planet} goes direct in ${c.sign}` });
    }

    // Sign change
    if (p.sign_num !== c.sign_num) {
      events.push({ event_date: dateStr, event_type: 'SIGN_CHANGE', planet,
        from_sign: p.sign, to_sign: c.sign,
        description: `${planet} moves from ${p.sign} to ${c.sign}` });
    }
  }

  // Check conjunctions (within 3°)
  const planets = Object.keys(curr);
  for (let i = 0; i < planets.length; i++) {
    for (let j = i + 1; j < planets.length; j++) {
      const a = curr[planets[i]], b = curr[planets[j]];
      const diff = Math.abs(a.longitude - b.longitude);
      const orb = Math.min(diff, 360 - diff);
      if (orb <= 3) {
        events.push({ event_date: dateStr, event_type: 'CONJUNCTION',
          planet: planets[i], planet2: planets[j],
          description: `${planets[i]} conjunct ${planets[j]} at ${a.sign} (orb ${orb.toFixed(1)}°)` });
      }
    }
  }

  return events;
}

module.exports = { calcAllPlanetsForDate, detectEvents, PLANET_IDS };
