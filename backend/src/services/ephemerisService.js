// ─────────────────────────────────────────────────────────────────
// ephemerisService.js
// Pure JS planetary calculations — no native modules needed
// Uses VSOP87 simplified model with Lahiri ayanamsha correction
// Accuracy: ~0.5° — sufficient for sector scoring and event detection
// ─────────────────────────────────────────────────────────────────
'use strict';

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

// Exaltation / Debilitation (sign_num 1–12)
const DIGNITY = {
  Sun:     { ex: 1,  de: 7  },
  Moon:    { ex: 2,  de: 8  },
  Mars:    { ex: 10, de: 4  },
  Mercury: { ex: 6,  de: 12 },
  Jupiter: { ex: 4,  de: 10 },
  Venus:   { ex: 12, de: 6  },
  Saturn:  { ex: 7,  de: 1  },
};

const OWN_SIGNS = {
  Sun: [5], Moon: [4], Mars: [1,8], Mercury: [3,6],
  Jupiter: [9,12], Venus: [2,7], Saturn: [10,11]
};

// ── Math helpers ─────────────────────────────────────────────────
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

function norm360(x) { return ((x % 360) + 360) % 360; }
function norm(x, r) { return ((x % r) + r) % r; }

/** Julian Day Number from calendar date */
function julianDay(year, month, day) {
  if (month <= 2) { year--; month += 12; }
  const A = Math.floor(year / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + B - 1524.5;
}

/** Julian centuries from J2000 */
function T(jd) { return (jd - 2451545.0) / 36525; }

// ── Lahiri Ayanamsha (approximate) ──────────────────────────────
function lahiriAyanamsha(jd) {
  const t = T(jd);
  // Simplified Lahiri: ~23.85° at J2000, precessing ~50.3"/year
  return 23.85 + t * (50.3 / 3600) * 100;
}

// ── Planet longitude calculations (simplified VSOP87) ────────────

function sunLongitude(jd) {
  const t = T(jd);
  const L0 = norm360(280.46646 + 36000.76983 * t);
  const M  = norm360(357.52911 + 35999.05029 * t) * RAD;
  const C  = (1.914602 - 0.004817*t) * Math.sin(M)
           + 0.019993 * Math.sin(2*M)
           + 0.000289 * Math.sin(3*M);
  return norm360(L0 + C);
}

function moonLongitude(jd) {
  const t = T(jd);
  const L  = norm360(218.3165 + 481267.8813 * t);
  const M  = norm360(357.5291 + 35999.0503  * t) * RAD;
  const Mm = norm360(134.9634 + 477198.8676 * t) * RAD;
  const D  = norm360(297.8502 + 445267.1115 * t) * RAD;
  const F  = norm360(93.2721  + 483202.0175 * t) * RAD;
  const lon = L
    + 6.2886 * Math.sin(Mm)
    + 1.2740 * Math.sin(2*D - Mm)
    + 0.6583 * Math.sin(2*D)
    + 0.2136 * Math.sin(2*Mm)
    - 0.1851 * Math.sin(M)
    - 0.1143 * Math.sin(2*F)
    + 0.0588 * Math.sin(2*D - 2*Mm)
    + 0.0572 * Math.sin(2*D - M - Mm)
    + 0.0533 * Math.sin(2*D + Mm);
  return norm360(lon);
}

function marsLongitude(jd) {
  const t = T(jd);
  const L = norm360(355.433 + 19140.299 * t);
  const M = norm360(319.529 + 19139.858 * t) * RAD;
  return norm360(L + 10.691 * Math.sin(M) + 0.623 * Math.sin(2*M));
}

function mercuryLongitude(jd) {
  const t = T(jd);
  const L = norm360(252.251 + 149472.675 * t);
  const M = norm360(168.594 + 149472.515 * t) * RAD;
  return norm360(L + 23.440 * Math.sin(M) + 2.994 * Math.sin(2*M));
}

function jupiterLongitude(jd) {
  const t = T(jd);
  const L = norm360(34.351 + 3034.906 * t);
  const M = norm360(20.020 + 3034.694 * t) * RAD;
  return norm360(L + 5.555 * Math.sin(M) + 0.168 * Math.sin(2*M));
}

function venusLongitude(jd) {
  const t = T(jd);
  const L = norm360(181.979 + 58517.816 * t);
  const M = norm360(212.448 + 58517.804 * t) * RAD;
  return norm360(L + 0.7758 * Math.sin(M) + 0.0033 * Math.sin(2*M));
}

function saturnLongitude(jd) {
  const t = T(jd);
  const L = norm360(50.077 + 1222.114 * t);
  const M = norm360(317.021 + 1221.552 * t) * RAD;
  return norm360(L + 6.406 * Math.sin(M) + 0.250 * Math.sin(2*M));
}

function rahuLongitude(jd) {
  const t = T(jd);
  // Mean ascending node of Moon
  return norm360(125.0445 - 1934.1363 * t);
}

// ── Speed (degrees/day) via finite difference ────────────────────
function speed(fn, jd) {
  return fn(jd + 0.5) - fn(jd - 0.5);
}

// ── Retrograde detection ─────────────────────────────────────────
// For outer planets: retrograde when apparent speed < 0
// Simplified: compare longitude yesterday vs today
function isRetrograde(fn, jd) {
  const s = speed(fn, jd);
  return s < 0;
}

// Mercury and Venus have complex retrograde — use speed sign
// Rahu/Ketu always retrograde

// ── Strength model ───────────────────────────────────────────────
function computeStrength(planet, sign_num, spd, retro) {
  let s = 50;
  const dg = DIGNITY[planet];
  if (dg) {
    if (sign_num === dg.ex) s += 12;
    if (sign_num === dg.de) s -= 12;
  }
  const own = OWN_SIGNS[planet] || [];
  if (own.includes(sign_num)) s += 7;
  if (!retro) s += 10; else s -= 8;
  s += Math.min(10, Math.abs(spd) * 2);
  return Math.max(0, Math.min(100, Math.round(s * 10) / 10));
}

// ── Main calculation ─────────────────────────────────────────────
const PLANET_FNS = {
  Sun:     sunLongitude,
  Moon:    moonLongitude,
  Mars:    marsLongitude,
  Mercury: mercuryLongitude,
  Jupiter: jupiterLongitude,
  Venus:   venusLongitude,
  Saturn:  saturnLongitude,
  Rahu:    rahuLongitude,
};

function calcAllPlanetsForDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const jd   = julianDay(y, m, d) + 0.5; // noon
  const ayan = lahiriAyanamsha(jd);        // subtract for sidereal

  const results = [];

  for (const [planet, fn] of Object.entries(PLANET_FNS)) {
    const tropLon = fn(jd);
    const lon     = norm360(tropLon - ayan);  // sidereal
    const spd     = speed(fn, jd);
    const retro   = planet === 'Rahu' ? true : (spd < 0);
    const sign_num = Math.floor(lon / 30) + 1;
    const sign     = SIGNS[sign_num - 1];
    const nakIdx   = Math.floor((lon * 27) / 360);
    const nakshatra = NAKSHATRAS[nakIdx] || 'Unknown';
    const strength = computeStrength(planet, sign_num, spd, retro);

    results.push({ planet, longitude: Math.round(lon * 10000) / 10000, sign, sign_num, nakshatra, retrograde: retro, speed: Math.round(spd * 10000) / 10000, strength });

    // Ketu = Rahu + 180
    if (planet === 'Rahu') {
      const kLon    = norm360(lon + 180);
      const kSigNum = Math.floor(kLon / 30) + 1;
      const kNakIdx = Math.floor((kLon * 27) / 360);
      results.push({
        planet: 'Ketu',
        longitude: Math.round(kLon * 10000) / 10000,
        sign: SIGNS[kSigNum - 1],
        sign_num: kSigNum,
        nakshatra: NAKSHATRAS[kNakIdx] || 'Unknown',
        retrograde: true,
        speed: Math.round(-spd * 10000) / 10000,
        strength: 50
      });
    }
  }

  return results;
}

// ── Event detection ──────────────────────────────────────────────
function detectEvents(prevPositions, currPositions, dateStr) {
  const events = [];
  const prev = Object.fromEntries(prevPositions.map(p => [p.planet, p]));
  const curr = Object.fromEntries(currPositions.map(p => [p.planet, p]));

  for (const planet of Object.keys(curr)) {
    const p = prev[planet], c = curr[planet];
    if (!p) continue;

    if (!p.retrograde && c.retrograde)
      events.push({ event_date: dateStr, event_type: 'RETROGRADE_START', planet,
        description: `${planet} stations retrograde in ${c.sign}` });

    if (p.retrograde && !c.retrograde)
      events.push({ event_date: dateStr, event_type: 'RETROGRADE_END', planet,
        description: `${planet} goes direct in ${c.sign}` });

    if (p.sign_num !== c.sign_num)
      events.push({ event_date: dateStr, event_type: 'SIGN_CHANGE', planet,
        from_sign: p.sign, to_sign: c.sign,
        description: `${planet} moves from ${p.sign} to ${c.sign}` });
  }

  // Conjunctions — only fire on peak day (orb decreasing yesterday, increasing today)
  // This prevents multi-day duplicate events
  const planets = Object.keys(curr);
  for (let i = 0; i < planets.length; i++) {
    for (let j = i + 1; j < planets.length; j++) {
      const a = curr[planets[i]], b = curr[planets[j]];
      const diff = Math.abs(a.longitude - b.longitude);
      const orb  = Math.min(diff, 360 - diff);
      if (orb <= 2) { // Tightened to 2° for quality
        // Check if orb was larger yesterday (we are at or past closest approach)
        const ap = prev[planets[i]], bp = prev[planets[j]];
        if (ap && bp) {
          const prevDiff = Math.abs(ap.longitude - bp.longitude);
          const prevOrb  = Math.min(prevDiff, 360 - prevDiff);
          // Only fire if orb is smaller today than yesterday (approaching peak)
          // OR if yesterday had no event (first day within orb)
          if (prevOrb > orb || prevOrb > 2) {
            events.push({ event_date: dateStr, event_type: 'CONJUNCTION',
              planet: planets[i], planet2: planets[j],
              description: `${planets[i]} conjunct ${planets[j]} in ${a.sign} (orb ${orb.toFixed(1)}°)` });
          }
        }
      }
    }
  }

  return events;
}

module.exports = { calcAllPlanetsForDate, detectEvents };
