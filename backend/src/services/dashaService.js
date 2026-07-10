// ─────────────────────────────────────────────────────────────────
// dashaService.js — Vimshottari Dasha (Parashari system)
// Deterministic: given a birth moment's Moon longitude, generates the
// full 120-year Mahadasha/Antardasha sequence. No interpretation, pure
// arithmetic — the same math every Vedic astrology software uses.
//
// Reuses ephemerisService's existing planetary math (moonLongitude,
// julianDay, lahiriAyanamsha) — no new astronomical calculation, only
// the Dasha-period arithmetic layered on top.
// ─────────────────────────────────────────────────────────────────
'use strict';
 
// Minimal moon+ayanamsha math duplicated here (kept identical to
// ephemerisService.js) so this module can compute at an exact birth
// moment, not just noon-of-date like the shared date-only wrapper.
function norm360(x) { return ((x % 360) + 360) % 360; }
function julianDay(year, month, day, hour = 0) {
  if (month <= 2) { year--; month += 12; }
  const A = Math.floor(year / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + B - 1524.5 + hour / 24;
}
function T(jd) { return (jd - 2451545.0) / 36525; }
function lahiriAyanamsha(jd) {
  const t = T(jd);
  return 23.85 + t * (50.3 / 3600) * 100;
}
function moonLongitude(jd) {
  const t = T(jd);
  const L  = norm360(218.3165 + 481267.8813 * t);
  const M  = norm360(357.5291 + 35999.0503  * t) * Math.PI / 180;
  const Mm = norm360(134.9634 + 477198.8676 * t) * Math.PI / 180;
  const D  = norm360(297.8502 + 445267.1115 * t) * Math.PI / 180;
  const F  = norm360(93.2721  + 483202.0175 * t) * Math.PI / 180;
  const lon = L
    + 6.2886 * Math.sin(Mm) + 1.2740 * Math.sin(2*D - Mm) + 0.6583 * Math.sin(2*D)
    + 0.2136 * Math.sin(2*Mm) - 0.1851 * Math.sin(M) - 0.1143 * Math.sin(2*F)
    + 0.0588 * Math.sin(2*D - 2*Mm) + 0.0572 * Math.sin(2*D - M - Mm) + 0.0533 * Math.sin(2*D + Mm);
  return norm360(lon);
}
function siderealMoonLongitude(y, m, d, hourUTC) {
  const jd = julianDay(y, m, d, hourUTC);
  return norm360(moonLongitude(jd) - lahiriAyanamsha(jd));
}
 
// ── Vimshottari constants ──────────────────────────────────────────
const NAK_SPAN = 360 / 27; // 13°20'
const LORD_ORDER = ['Ketu','Venus','Sun','Moon','Mars','Rahu','Jupiter','Saturn','Mercury'];
const LORD_YEARS = { Ketu:7, Venus:20, Sun:6, Moon:10, Mars:7, Rahu:18, Jupiter:16, Saturn:19, Mercury:17 };
const TOTAL_YEARS = 120;
const YEAR_MS = 365.25 * 24 * 3600 * 1000;
 
/**
 * Generate the full Vimshottari Mahadasha/Antardasha timeline for a
 * given birth moment. Returns Mahadasha list (each with nested
 * Antardashas), spanning 120 years from birth.
 */
function computeVimshottariDasha({ year, month, day, hourUTC, label }) {
  const moonLon = siderealMoonLongitude(year, month, day, hourUTC);
  const nakIdx = Math.floor(moonLon / NAK_SPAN); // 0-26
  const elapsedInNak = moonLon - nakIdx * NAK_SPAN;
  const fractionElapsed = elapsedInNak / NAK_SPAN;
  const startLordIdx = nakIdx % 9;
  const startLord = LORD_ORDER[startLordIdx];
 
  // Balance of the first (birth) Mahadasha remaining
  const firstFullYears = LORD_YEARS[startLord];
  const firstRemainingYears = firstFullYears * (1 - fractionElapsed);
 
  const birthDate = new Date(Date.UTC(year, month - 1, day, hourUTC));
  const mahadashas = [];
  let cursor = new Date(birthDate.getTime() - (firstFullYears - firstRemainingYears) * YEAR_MS);
 
  for (let i = 0; i < LORD_ORDER.length + 1; i++) {
    const lordIdx = (startLordIdx + i) % 9;
    const lord = LORD_ORDER[lordIdx];
    const years = LORD_YEARS[lord];
    const start = new Date(cursor.getTime());
    const end = new Date(cursor.getTime() + years * YEAR_MS);
 
    // Antardashas within this Mahadasha — same 9-lord order, starting
    // from the Mahadasha's own lord, each sized proportionally.
    const antardashas = [];
    let subCursor = new Date(start.getTime());
    for (let j = 0; j < 9; j++) {
      const subLordIdx = (lordIdx + j) % 9;
      const subLord = LORD_ORDER[subLordIdx];
      const subYears = years * (LORD_YEARS[subLord] / TOTAL_YEARS);
      const subStart = new Date(subCursor.getTime());
      const subEnd = new Date(subCursor.getTime() + subYears * YEAR_MS);
      antardashas.push({ lord: subLord, start: subStart.toISOString().slice(0,10), end: subEnd.toISOString().slice(0,10) });
      subCursor = subEnd;
    }
 
    mahadashas.push({ lord, years, start: start.toISOString().slice(0,10), end: end.toISOString().slice(0,10), antardashas });
    cursor = end;
  }
 
  return { label, natalMoonLongitude: Math.round(moonLon*10000)/10000, natalNakshatra: nakIdx, mahadashas };
}
 
// India's national chart — 15 August 1947, 00:00 IST, Delhi (IST = UTC+5:30,
// so 00:00 IST on the 15th = 18:30 UTC on the 14th). Standard mundane
// astrology reference date used across the literature (Pt. Suryanarayan
// Vyas's chosen muhurta, Taurus Lagna rising).
const INDIA_CHART = { year: 1947, month: 8, day: 14, hourUTC: 18.5, label: 'India (Independence, 15 Aug 1947 00:00 IST, Delhi)' };
 
// Other asset "first-trade" charts — same classical mundane-astrology
// technique (an exchange/index's launch moment treated as its own
// birth chart). Only assets with a VERIFIED exact date — Dasha math
// needs day precision, and Crude Oil/Natural Gas launch dates only
// have year-level confirmation in public sources, so they're not
// included here rather than guessing a day.
const ASSET_CHARTS = {
  NIFTY50: { year: 1996, month: 4, day: 22, hourUTC: 3.75, label: 'Nifty 50 (launched 22 Apr 1996, 09:15 IST, NSE Mumbai)' },
  GOLD:    { year: 2003, month: 11, day: 10, hourUTC: 4.75, label: 'MCX Gold (exchange launch 10 Nov 2003, 10:15 IST, Mumbai)' },
  SILVER:  { year: 2003, month: 11, day: 10, hourUTC: 4.75, label: 'MCX Silver (exchange launch 10 Nov 2003, 10:15 IST, Mumbai)' },
};
 
function getAssetDasha(assetKey) {
  const chart = ASSET_CHARTS[assetKey];
  if (!chart) return null;
  return computeVimshottariDasha(chart);
}
 
function getIndiaDasha() {
  return computeVimshottariDasha(INDIA_CHART);
}
 
function getCurrentDashaLords(dashaData, atDate = new Date()) {
  const ts = atDate.getTime();
  const maha = dashaData.mahadashas.find(m => new Date(m.start).getTime() <= ts && ts < new Date(m.end).getTime());
  if (!maha) return null;
  const antar = maha.antardashas.find(a => new Date(a.start).getTime() <= ts && ts < new Date(a.end).getTime());
  return { mahadasha: maha, antardasha: antar };
}
 
module.exports = { computeVimshottariDasha, getIndiaDasha, getCurrentDashaLords, getAssetDasha, ASSET_CHARTS, INDIA_CHART };
 
// ─────────────────────────────────────────────────────────────────
// KP Sub-Lord — Krishnamurti Paddhati's core innovation. Each 13°20'
// nakshatra is further divided into 9 unequal parts, proportional to
// the SAME Vimshottari dasha-year ratios, starting from the
// nakshatra's own lord. This pinpoints a "sub-lord" for any exact
// degree — the fine-grained layer KP adds on top of the coarser
// sign/nakshatra system.
//
// Scoped to planetary positions only (not house cusps) — a proper KP
// cuspal analysis needs exact birth time + location + Placidus house
// math, which isn't reliably verifiable with the ephemeris precision
// here (~0.5°). Claiming cuspal sub-lords at that precision would be
// presenting shaky math as certain, so this stays at the planet-
// position layer, which is exact regardless of location/time.
// ─────────────────────────────────────────────────────────────────
function kpSubLord(siderealLongitude) {
  const nakSpan = 360 / 27;
  const nakIdx = Math.floor(siderealLongitude / nakSpan);
  const nakLordIdx = nakIdx % 9;
  const degInNak = siderealLongitude - nakIdx * nakSpan;
 
  let cursor = 0;
  for (let i = 0; i < 9; i++) {
    const subLordIdx = (nakLordIdx + i) % 9;
    const subLord = LORD_ORDER[subLordIdx];
    const subSpan = nakSpan * (LORD_YEARS[subLord] / TOTAL_YEARS);
    if (degInNak >= cursor && degInNak < cursor + subSpan) {
      return { nakshatraLord: LORD_ORDER[nakLordIdx], subLord, degInNak: Math.round(degInNak*1000)/1000 };
    }
    cursor += subSpan;
  }
  return { nakshatraLord: LORD_ORDER[nakLordIdx], subLord: LORD_ORDER[nakLordIdx], degInNak: Math.round(degInNak*1000)/1000 };
}
 
module.exports.kpSubLord = kpSubLord;
