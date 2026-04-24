/**
 * Risk Engine — ported 1:1 from original Saarthi HTML frontend.
 * Accepts the same data structures returned by the DB query helpers.
 */

// ── Default risk rules ──
const DEFAULT_RR = {
  stock_max:  0.10,
  gold_max:   0.25,
  silver_max: 0.15,
  sector_max: {
    'Defence Manufacturing': 0.25,
    'Precious Metals':       0.25,
    'Infrastructure':        0.20,
    'BFSI':                  0.20,
    'Energy':                0.20,
    'default':               0.15
  }
};

// ── Static sector / mcap metadata ──
const SMETA = {
  BEL:       { s: 'Defence Manufacturing', m: 'Large Cap' },
  HAL:       { s: 'Defence Manufacturing', m: 'Large Cap' },
  MAZDOCK:   { s: 'Defence Manufacturing', m: 'Mid Cap'   },
  GRSE:      { s: 'Defence Manufacturing', m: 'Small Cap' },
  COCHINSHIP:{ s: 'Defence Manufacturing', m: 'Small Cap' },
  MTARTECH:  { s: 'Defence Manufacturing', m: 'Small Cap' },
  ZENTEC:    { s: 'Defence Manufacturing', m: 'Small Cap' },
  DATAPATTNS:{ s: 'Defence Manufacturing', m: 'Small Cap' },
  'FUTURISTIC OFFSHORE': { s: 'Defence Manufacturing', m: 'Small Cap' },
  HINDALCO:  { s: 'Base Metals', m: 'Large Cap'  },
  HINDCOPPER:{ s: 'Base Metals', m: 'Mid Cap'    },
  NATIONALUM:{ s: 'Base Metals', m: 'Mid Cap'    },
  LLOYDSME:  { s: 'Base Metals', m: 'Small Cap'  },
  IMFA:      { s: 'Base Metals', m: 'Small Cap'  },
  GRAVITA:   { s: 'Base Metals', m: 'Small Cap'  },
  GOLDETF:   { s: 'Precious Metals', m: 'ETF' }, SETFGOLD: { s: 'Precious Metals', m: 'ETF' },
  GOLDEES:   { s: 'Precious Metals', m: 'ETF' }, HDFCMFGETF:{ s: 'Precious Metals', m: 'ETF' },
  GOLDIETF:  { s: 'Precious Metals', m: 'ETF' }, AXISGOLD:  { s: 'Precious Metals', m: 'ETF' },
  KOTAKGOLD: { s: 'Precious Metals', m: 'ETF' }, BSLGOLDETF:{ s: 'Precious Metals', m: 'ETF' },
  NIPGOLDBEES:{ s: 'Precious Metals', m: 'ETF'}, SBIGOLD:   { s: 'Precious Metals', m: 'ETF' },
  RELIANCEGOLD:{ s:'Precious Metals', m: 'ETF'}, IDBISGOLD: { s: 'Precious Metals', m: 'ETF' },
  SILVERBEES: { s: 'Precious Metals', m: 'ETF' }, SILVERETF: { s: 'Precious Metals', m: 'ETF' },
  SILVRETF:   { s: 'Precious Metals', m: 'ETF' }, KOTAKSILVER:{ s:'Precious Metals', m: 'ETF' },
  ICICISILVER:{ s: 'Precious Metals', m: 'ETF' }, HDFCSILVER:{ s: 'Precious Metals', m: 'ETF' },
  PFC:        { s: 'BFSI', m: 'Large Cap' }, MCX:    { s: 'BFSI', m: 'Mid Cap' },
  SHRIRAMFIN: { s: 'BFSI', m: 'Large Cap' }, BSE:    { s: 'BFSI', m: 'Mid Cap' },
  TATAINVEST: { s: 'BFSI', m: 'Mid Cap'   }, LTF:    { s: 'BFSI', m: 'Mid Cap' },
  'NAM-INDIA':{ s: 'BFSI', m: 'Mid Cap'   },
  'HDFC SECURITIES LIMI': { s: 'BFSI', m: 'Mid Cap' },
  NAGAROIL:   { s: 'Energy', m: 'Small Cap' },
  'NAYARA ENERGY LIMITE': { s: 'Energy', m: 'Large Cap' },
  POWERINDIA: { s: 'Energy', m: 'Mid Cap'   },
  SYRMA:      { s: 'IT & Technology', m: 'Small Cap' },
  CUMMINSIND: { s: 'Capital Goods',   m: 'Mid Cap'   },
  PGINVIT:    { s: 'Infrastructure',  m: 'Mid Cap'   },
  LIQUIDBEES: { s: 'Liquid / Cash',   m: 'ETF'       },
  '509627':   { s: 'Other', m: 'Small Cap' },
  '570003':   { s: 'Other', m: 'Small Cap' },
  'SURYA AGROILS LIMITE': { s: 'Agri / Commodity', m: 'Small Cap' }
};

/**
 * Resolve sector + mcap for a symbol.
 * tags: map of symbol -> { sector, mcap, hidden } from DB
 * holdings: flat array of holding rows (for fallback detection)
 */
function getMetadata(sym, tags = {}, holdings = []) {
  const t = tags[sym];
  if (t?.sector) return { sector: t.sector, mcap: t.mcap || 'Unknown', hidden: !!t.hidden };
  if (t?.s)      return { sector: t.s,      mcap: t.m   || 'Unknown' };
  if (SMETA[sym]) return SMETA[sym];

  const sl = sym.toLowerCase();
  if (sl.includes('gold'))   return { sector: 'Precious Metals', mcap: 'ETF' };
  if (sl.includes('silver')) return { sector: 'Precious Metals', mcap: 'ETF' };

  const h = holdings.find(x => x.symbol === sym);
  if (h) {
    const ac = (h.assetClass || '').toLowerCase();
    const nm = (h.name || '').toLowerCase();
    if (nm.includes('gold') || nm.includes('silver')) return { sector: 'Precious Metals', mcap: 'ETF' };
    if (ac.includes('etf') || ac.includes('exchange traded')) return { sector: 'ETF / Other', mcap: 'ETF' };
    if (ac.includes('invit')) return { sector: 'Infrastructure', mcap: 'Other' };
  }

  return { sector: 'Untagged', mcap: 'Unknown' };
}

function isGoldSym(sym, name) {
  const s = (sym + ' ' + (name || '')).toLowerCase();
  return s.includes('gold') || s.includes('goldetf') || s.includes('setfgold') || s.includes('goldees');
}
function isSilverSym(sym, name) {
  const s = (sym + ' ' + (name || '')).toLowerCase();
  return s.includes('silver') || s.includes('silverbees') || s.includes('silvretf');
}
function fp(n) { return (n * 100).toFixed(2) + '%'; }

/**
 * Compute all risk alerts.
 * @param {Object[]} clients  - array of client objects with .holdings[]
 * @param {Object}   tags     - symbol -> tag map
 * @param {Object}   rr       - risk rules (falls back to DEFAULT_RR)
 * @returns {Object[]}        - array of risk alerts sorted by severity
 */
function computeRisks(clients, tags = {}, rr = DEFAULT_RR) {
  const risks = [];
  const SKIP  = new Set(['ETF / Other', 'Liquid / Cash', 'Untagged', 'Other']);
  const totalAUM = clients.reduce((s, c) => s + (c.totalCurrent || 0) + (c.cash || 0), 0);

  // Flatten holdings for fallback metadata lookup
  const allHoldings = clients.flatMap(c => c.holdings || []);
  const stockMap    = {};
  const pmsSecMap   = {};

  // ── Per-client stock & sector checks ──
  clients.forEach(c => {
    const aum = (c.totalCurrent || 0) + (c.cash || 0);
    const sm  = {};

    (c.holdings || []).forEach(h => {
      const alloc = aum > 0 ? h.marketValue / aum : 0;
      const lim   = rr.stock_max;
      if (alloc / lim >= 0.8) {
        risks.push({
          cat:     'Stock',
          type:    alloc >= lim ? 'breach' : 'warning',
          client:  c.name,
          sym:     h.symbol,
          name:    h.name,
          cur:     alloc,
          lim,
          excess:  alloc - lim,
          ratio:   alloc / lim,
          suggest: alloc >= lim
            ? `Reduce ${h.symbol} by ${fp(alloc - lim)} — sell ~${Math.ceil((alloc - lim) * aum / (h.marketPrice || 1))} shares`
            : null
        });
      }
      if (!stockMap[h.symbol]) stockMap[h.symbol] = { value: 0 };
      stockMap[h.symbol].value += h.marketValue;

      const sec = getMetadata(h.symbol, tags, allHoldings).sector;
      if (!SKIP.has(sec)) {
        sm[sec]       = (sm[sec]       || 0) + h.marketValue;
        pmsSecMap[sec] = (pmsSecMap[sec] || 0) + h.marketValue;
      }
    });

    // Sector per client
    Object.entries(sm).forEach(([sec, val]) => {
      if (SKIP.has(sec)) return;
      const alloc = aum > 0 ? val / aum : 0;
      const lim   = (rr.sector_max || {})[sec] || rr.sector_max?.default || 0.15;
      if (alloc / lim >= 0.8) {
        risks.push({
          cat: 'Sector', type: alloc >= lim ? 'breach' : 'warning',
          client: c.name, sym: sec, name: 'Sector: ' + sec,
          cur: alloc, lim, excess: alloc - lim, ratio: alloc / lim,
          suggest: alloc >= lim ? `Reduce ${sec} by ${fp(alloc - lim)} to meet ${fp(lim)} cap` : null
        });
      }
    });

    // Precious metals per client
    const goldH   = (c.holdings || []).filter(h => getMetadata(h.symbol, tags, allHoldings).sector === 'Precious Metals' && isGoldSym(h.symbol, h.name));
    const silverH = (c.holdings || []).filter(h => getMetadata(h.symbol, tags, allHoldings).sector === 'Precious Metals' && isSilverSym(h.symbol, h.name));

    const gv = goldH.reduce((s, h) => s + h.marketValue, 0);
    if (gv > 0) {
      const alloc = aum > 0 ? gv / aum : 0, lim = rr.gold_max;
      if (alloc / lim >= 0.8) {
        const syms = goldH.map(h => h.symbol).join('+');
        risks.push({ cat:'Asset', type: alloc>=lim?'breach':'warning', client:c.name, sym:syms, name:`Gold ETF (${syms})`, cur:alloc, lim, excess:alloc-lim, ratio:alloc/lim, suggest:alloc>=lim?`Reduce ${syms} by ${fp(alloc-lim)}`:null });
      }
    }
    const sv = silverH.reduce((s, h) => s + h.marketValue, 0);
    if (sv > 0) {
      const alloc = aum > 0 ? sv / aum : 0, lim = rr.silver_max;
      if (alloc / lim >= 0.8) {
        const syms = silverH.map(h => h.symbol).join('+');
        risks.push({ cat:'Asset', type: alloc>=lim?'breach':'warning', client:c.name, sym:syms, name:`Silver ETF (${syms})`, cur:alloc, lim, excess:alloc-lim, ratio:alloc/lim, suggest:alloc>=lim?`Reduce ${syms} by ${fp(alloc-lim)}`:null });
      }
    }
  });

  // ── Overall PMS stock concentration ──
  Object.entries(stockMap).forEach(([sym, data]) => {
    const alloc = totalAUM > 0 ? data.value / totalAUM : 0;
    const lim   = rr.stock_max;
    if (alloc / lim >= 0.8) {
      risks.push({ cat:'Stock', type:alloc>=lim?'breach':'warning', client:'Overall PMS', sym, name:sym, cur:alloc, lim, excess:alloc-lim, ratio:alloc/lim, suggest:null });
    }
  });

  // ── Overall PMS sector concentration ──
  Object.entries(pmsSecMap).forEach(([sec, val]) => {
    if (SKIP.has(sec)) return;
    const alloc = totalAUM > 0 ? val / totalAUM : 0;
    const lim   = (rr.sector_max || {})[sec] || rr.sector_max?.default || 0.15;
    if (alloc / lim >= 0.8) {
      risks.push({ cat:'Sector', type:alloc>=lim?'breach':'warning', client:'Overall PMS', sym:sec, name:'Sector: '+sec, cur:alloc, lim, excess:alloc-lim, ratio:alloc/lim, suggest:null });
    }
  });

  // De-duplicate
  const seen = new Set();
  return risks
    .filter(r => { const k = r.client + '|' + r.sym + '|' + r.cat; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b.ratio - a.ratio);
}

module.exports = { computeRisks, getMetadata, SMETA, DEFAULT_RR };
