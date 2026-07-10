// ─────────────────────────────────────────────────────────────────
// panchangService.js — Tithi, Karana (Bhadra), Panchak
// Classical Indian financial-timing filters (Argha Martand's Teji-
// Mandi method uses exactly these three). Deterministic arithmetic
// from Sun/Moon sidereal longitude — reuses ephemerisService's math,
// no new astronomical model.
// ─────────────────────────────────────────────────────────────────
'use strict';
 
function norm360(x) { return ((x % 360) + 360) % 360; }
function julianDay(year, month, day, hour = 12) {
  if (month <= 2) { year--; month += 12; }
  const A = Math.floor(year / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + B - 1524.5 + hour / 24;
}
function T(jd) { return (jd - 2451545.0) / 36525; }
const RAD = Math.PI / 180;
 
function sunLongitude(jd) {
  const t = T(jd);
  const L0 = norm360(280.46646 + 36000.76983 * t);
  const M  = norm360(357.52911 + 35999.05029 * t) * RAD;
  const C  = (1.914602 - 0.004817*t) * Math.sin(M) + 0.019993 * Math.sin(2*M) + 0.000289 * Math.sin(3*M);
  return norm360(L0 + C);
}
function moonLongitude(jd) {
  const t = T(jd);
  const L  = norm360(218.3165 + 481267.8813 * t);
  const M  = norm360(357.5291 + 35999.0503  * t) * RAD;
  const Mm = norm360(134.9634 + 477198.8676 * t) * RAD;
  const D  = norm360(297.8502 + 445267.1115 * t) * RAD;
  const F  = norm360(93.2721  + 483202.0175 * t) * RAD;
  const lon = L + 6.2886*Math.sin(Mm) + 1.2740*Math.sin(2*D-Mm) + 0.6583*Math.sin(2*D)
    + 0.2136*Math.sin(2*Mm) - 0.1851*Math.sin(M) - 0.1143*Math.sin(2*F)
    + 0.0588*Math.sin(2*D-2*Mm) + 0.0572*Math.sin(2*D-M-Mm) + 0.0533*Math.sin(2*D+Mm);
  return norm360(lon);
}
// Lahiri ayanamsha not needed here — Tithi/Karana are defined by the
// Sun-Moon ANGULAR DIFFERENCE, which is identical in tropical or
// sidereal frames (the ayanamsha cancels out in a difference).
 
const TITHI_NAMES = ['Pratipada','Dwitiya','Tritiya','Chaturthi','Panchami','Shashthi','Saptami','Ashtami','Navami','Dashami','Ekadashi','Dwadashi','Trayodashi','Chaturdashi','Purnima/Amavasya'];
const KARANA_MOVABLE = ['Bava','Balava','Kaulava','Taitila','Gara','Vanija','Vishti'];
const KARANA_FIXED_START = ['Kimstughna'];
const KARANA_FIXED_END = ['Shakuni','Chatushpada','Naga'];
 
function karanaName(karanaIdx) {
  // 60 karanas per lunar month (0-59). #0 = Kimstughna (fixed).
  // #57,58,59 = Shakuni, Chatushpada, Naga (fixed).
  // #1-56 = the 7 movable karanas repeating 8x.
  if (karanaIdx === 0) return KARANA_FIXED_START[0];
  if (karanaIdx >= 57) return KARANA_FIXED_END[karanaIdx - 57];
  return KARANA_MOVABLE[(karanaIdx - 1) % 7];
}
 
function computePanchang(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const jd = julianDay(y, m, d, 12);
  const sunLon = sunLongitude(jd);
  const moonLon = moonLongitude(jd);
  const diff = norm360(moonLon - sunLon);
 
  const tithiNum = Math.floor(diff / 12) + 1; // 1-30
  const paksha = tithiNum <= 15 ? 'Shukla (waxing)' : 'Krishna (waning)';
  const tithiInPaksha = tithiNum <= 15 ? tithiNum : tithiNum - 15;
  const tithiName = TITHI_NAMES[Math.min(tithiInPaksha - 1, 14)];
 
  const karanaIdx = Math.floor(diff / 6); // 0-59
  const karana = karanaName(karanaIdx);
  const isBhadra = karana === 'Vishti';
 
  // Panchak: Moon in the last quarter of Dhanishtha through Revati
  // (sidereal nakshatra indices 22-26, with 22 only valid in its 2nd
  // half — using tropical Moon here since Panchak is nakshatra-based
  // and needs sidereal; approximate with a fixed ayanamsha offset for
  // this check only, ±0.5° tolerance noted).
  const ayan = 23.85 + T(jd) * (50.3/3600) * 100;
  const siderealMoon = norm360(moonLon - ayan);
  const nakIdx = Math.floor(siderealMoon / (360/27));
  const nakDeg = siderealMoon - nakIdx * (360/27);
  const isPanchak = (nakIdx === 22 && nakDeg >= (360/27)/2) || (nakIdx >= 23 && nakIdx <= 26);
 
  return {
    date: dateStr, tithiNum, tithiName, paksha, karana, isBhadra, isPanchak,
    caution: isBhadra || isPanchak,
  };
}
 
function computePanchangRange(startDateStr, days) {
  const out = [];
  const [y,m,d] = startDateStr.split('-').map(Number);
  for (let i = 0; i < days; i++) {
    const dt = new Date(Date.UTC(y, m-1, d + i));
    const ds = dt.toISOString().slice(0,10);
    out.push(computePanchang(ds));
  }
  return out;
}
 
module.exports = { computePanchang, computePanchangRange };
