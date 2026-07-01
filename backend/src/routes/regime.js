'use strict';
// ══════════════════════════════════════════════════════════════
// Regime Framework — Auto-detect India macro regime
// Inflation × Growth → Asset class + Sector bias
// ══════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();

// ── Regime matrix ──────────────────────────────────────────────
const REGIME_MATRIX = {
  high: {
    high: {
      label: 'Inflationary Boom',
      macro: 'Strong growth but elevated inflation — risk of overheating. RBI under pressure to tighten.',
      assets: { gold: 'OVERWEIGHT', equity: 'NEUTRAL', debt: 'UNDERWEIGHT' },
      assetRationale: 'Gold hedges inflation. Equity stretched on valuations but earnings hold. Debt suffers in rising rate environment.',
      sectors: ['Metals & Mining','Energy','Commodities','Real Estate','Industrials'],
      avoidSectors: ['IT','FMCG','Pharma','Long Duration Bonds'],
      sectorRationale: 'Hard assets and commodity producers outperform. Rate-sensitive and defensive growth sectors lag.',
    },
    normal: {
      label: 'Overheating',
      macro: 'Growth normalising but inflation still elevated — central bank likely tightening aggressively.',
      assets: { gold: 'OVERWEIGHT', equity: 'UNDERWEIGHT', debt: 'NEUTRAL' },
      assetRationale: 'RBI tightening hurts equities on multiple compression. Gold is preferred inflation hedge. Short duration debt safe.',
      sectors: ['Energy','Metals','FMCG Staples','Healthcare','Short Duration Debt'],
      avoidSectors: ['Real Estate','NBFCs','Auto','IT'],
      sectorRationale: 'Defensive sectors + inflation beneficiaries. Avoid rate-sensitive and leveraged sectors.',
    },
    low: {
      label: 'Stagflation',
      macro: 'Worst macro scenario — high inflation with slowing growth. RBI in a dilemma.',
      assets: { gold: 'OVERWEIGHT', equity: 'UNDERWEIGHT', debt: 'UNDERWEIGHT' },
      assetRationale: 'Gold is the only clear winner. Equities suffer on margin compression. Bonds hurt by high rates.',
      sectors: ['Gold ETFs','Healthcare','FMCG Staples','Utilities','Cash'],
      avoidSectors: ['Capital Goods','Real Estate','Auto','IT','PSU Banks'],
      sectorRationale: 'Only defensives and inflation stores of value hold up. Preserve capital.',
    },
  },
  normal: {
    high: {
      label: 'Healthy Expansion',
      macro: 'Best environment — strong growth with controlled inflation. Earnings upgrades likely.',
      assets: { gold: 'NEUTRAL', equity: 'OVERWEIGHT', debt: 'UNDERWEIGHT' },
      assetRationale: 'Equities in sweet spot with earnings growth and stable rates. Gold less needed. Debt unattractive vs equity.',
      sectors: ['Banking & Finance','Capital Goods','Auto','IT','Consumer Discretionary','Infrastructure'],
      avoidSectors: ['Utilities','Gold','Long Duration Bonds'],
      sectorRationale: 'Cyclicals and growth sectors thrive. Capex cycle and credit growth in full swing.',
    },
    normal: {
      label: 'Balanced Expansion',
      macro: 'Steady state — moderate growth and moderate inflation. Earnings growth consistent.',
      assets: { gold: 'NEUTRAL', equity: 'OVERWEIGHT', debt: 'NEUTRAL' },
      assetRationale: 'Equities broadly positive with room for re-rating. Balanced portfolio works well here.',
      sectors: ['Banking','IT','FMCG','Pharma','Capital Goods','Consumption'],
      avoidSectors: ['Pure Commodities','Highly Leveraged Sectors'],
      sectorRationale: 'Broad-based equity participation. Quality and growth both work. Diversify across sectors.',
    },
    low: {
      label: 'Late Cycle',
      macro: 'Growth losing momentum — early slowdown signals. Earnings downgrades beginning.',
      assets: { gold: 'OVERWEIGHT', equity: 'NEUTRAL', debt: 'UNDERWEIGHT' },
      assetRationale: 'Rotate to defensives and gold. Reduce cyclical equity exposure. Not time to exit equities fully.',
      sectors: ['Healthcare','FMCG Staples','IT (export earners)','Gold','Pharma'],
      avoidSectors: ['Auto','Capital Goods','Real Estate','PSU Banks','Metals'],
      sectorRationale: 'Defensive rotation. Export-oriented IT benefits from potential rupee weakness. Avoid cyclicals.',
    },
  },
  low: {
    high: {
      label: 'Goldilocks Economy',
      macro: 'Ideal — strong growth with very low inflation. RBI accommodative or neutral.',
      assets: { gold: 'UNDERWEIGHT', equity: 'OVERWEIGHT', debt: 'NEUTRAL' },
      assetRationale: 'No inflation hedge needed. Equities re-rate on P/E expansion. Bonds benefit from low rates too.',
      sectors: ['Banking','NBFC','Real Estate','Auto','Capital Goods','Consumer Discretionary','Small & Mid Caps'],
      avoidSectors: ['Gold','Defensive Utilities'],
      sectorRationale: 'Rate-sensitive sectors boom. Consumer leverage increases. Broad bull market — own cyclicals.',
    },
    normal: {
      label: 'Soft Landing',
      macro: 'Economy decelerating gently with benign inflation. RBI likely cutting rates.',
      assets: { gold: 'NEUTRAL', equity: 'NEUTRAL', debt: 'OVERWEIGHT' },
      assetRationale: 'RBI cutting rates — bonds rally strongly. Equity mixed but quality holds. Gold neutral.',
      sectors: ['Banking (rate cut play)','IT','Pharma','FMCG','Long Duration Bonds'],
      avoidSectors: ['Metals','Energy','Deep Cyclicals'],
      sectorRationale: 'Rate cut beneficiaries lead. Quality large-caps outperform. Bond duration extension rewarding.',
    },
    low: {
      label: 'Slowdown / Recession Risk',
      macro: 'Economy contracting with deflation risk — capital preservation critical.',
      assets: { gold: 'OVERWEIGHT', equity: 'UNDERWEIGHT', debt: 'OVERWEIGHT' },
      assetRationale: 'Capital preservation mode. Long bonds rally on rate cuts. Gold as safe haven. Avoid equity risk.',
      sectors: ['Healthcare','FMCG Staples','IT (services)','Gold ETFs','Long Duration G-Sec'],
      avoidSectors: ['PSU Banks','Auto','Capital Goods','Real Estate','Metals','Mid & Small Caps'],
      sectorRationale: 'Only defensives and safe havens. Avoid cyclicals entirely until recovery signals emerge.',
    },
  },
};

function classifyInflation(cpiYoy) {
  if (cpiYoy == null) return 'normal';
  if (cpiYoy >= 6.0) return 'high';
  if (cpiYoy <= 3.5) return 'low';
  return 'normal';
}

function classifyGrowth(iipYoy, nifty3mChg) {
  const signal = iipYoy != null ? iipYoy : nifty3mChg;
  if (signal == null) return 'normal';
  if (signal >= 6.0) return 'high';
  if (signal <= 2.0) return 'low';
  return 'normal';
}

async function fetchCPI() {
  try {
    const url = 'https://api.worldbank.org/v2/country/IN/indicator/FP.CPI.TOTL.ZG?format=json&mrv=3&per_page=3';
    const r = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!r.ok) throw new Error('WB CPI ' + r.status);
    const d = await r.json();
    const entries = (d[1] || []).filter(e => e.value != null);
    if (!entries.length) throw new Error('No data');
    return { value: parseFloat(entries[0].value.toFixed(2)), year: entries[0].date, source: 'World Bank' };
  } catch (e) {
    console.warn('[Regime] CPI:', e.message);
    return null;
  }
}

async function fetchGDP() {
  try {
    // India GDP growth rate (annual %)
    const url = 'https://api.worldbank.org/v2/country/IN/indicator/NY.GDP.MKTP.KD.ZG?format=json&mrv=3&per_page=3';
    const r = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!r.ok) throw new Error('WB GDP ' + r.status);
    const d = await r.json();
    const entries = (d[1] || []).filter(e => e.value != null);
    if (!entries.length) throw new Error('No data');
    return { value: parseFloat(entries[0].value.toFixed(2)), year: entries[0].date, source: 'World Bank' };
  } catch (e) {
    console.warn('[Regime] GDP:', e.message);
    return null;
  }
}

async function fetchNifty3M() {
  try {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/%5ECRSLDX?interval=1mo&range=4mo';
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error('Yahoo ' + r.status);
    const d = await r.json();
    const closes = (d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []).filter(Boolean);
    if (closes.length < 2) throw new Error('Insufficient data');
    const chg = (closes[closes.length-1] - closes[0]) / closes[0] * 100;
    return { value: parseFloat(chg.toFixed(2)), source: 'Yahoo Finance', note: 'Nifty 500 3M price change %' };
  } catch (e) {
    console.warn('[Regime] Nifty3M:', e.message);
    return null;
  }
}

router.get('/', async (req, res) => {
  try {
    const [cpiData, gdpData, niftyData] = await Promise.all([fetchCPI(), fetchGDP(), fetchNifty3M()]);

    const cpiYoy = cpiData?.value ?? null;
    const gdpYoy = gdpData?.value ?? null;
    const nifty3m = niftyData?.value ?? null;

    const inflationTier = classifyInflation(cpiYoy);
    // GDP preferred for growth classification; fall back to Nifty 3M
    const growthTier = classifyGrowth(gdpYoy, nifty3m);

    const regime = REGIME_MATRIX[inflationTier][growthTier];

    res.json({
      ok: true,
      regime: { ...regime, inflationTier, growthTier },
      inputs: { cpi: cpiData, gdp: gdpData, nifty3m: niftyData, cpiYoy, gdpYoy, nifty3m },
      ts: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Regime]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
