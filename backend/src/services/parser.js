/**
 * Portfolio Excel Parser
 * Ported 1:1 from the original Saarthi HTML frontend logic.
 * Input : Buffer or binary string of the Excel file
 * Output: { clients: {}, stocks: {} }
 */
const XLSX = require('xlsx');

// ── Number value helper ──
function nv(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

// ── Date parsing ──
const MONTHS = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
const DATE_PAT  = /Date\s+of\s+Investment\s*[:\-]\s*(\d{1,2})[\/\-\s](\w{3,9})[\/\-\s](\d{4})/i;
const DATE_PAT2 = /(\d{2})[\/\-](\w{3})[\/\-](\d{4})/;

function tryParseDate(str) {
  if (!str) return null;
  let m = String(str).match(DATE_PAT);
  if (!m) m = String(str).match(DATE_PAT2);
  if (!m) return null;
  const d = parseInt(m[1]), monStr = m[2].toLowerCase().slice(0, 3), y = parseInt(m[3]);
  const mon = MONTHS[monStr];
  if (isNaN(d) || mon === undefined || isNaN(y) || y < 2000 || y > 2100) return null;
  return new Date(y, mon, d);
}

// ── Parse a single sheet ──
function parseSheet(sn, rows) {
  // Find header row (contains both "Quantity" and "Market Value")
  let hr = -1;
  for (let i = 0; i < rows.length; i++) {
    const joined = (rows[i] || []).join(' ');
    if (joined.includes('Quantity') && joined.includes('Market Value')) { hr = i; break; }
  }
  if (hr === -1) return null;

  // Extract investment date from header rows
  let investmentDate = null;
  outer: for (let i = 0; i < Math.min(hr + 1, 20); i++) {
    const row = rows[i] || [];
    for (let j = 0; j < row.length; j++) {
      const v = row[j]; if (!v) continue;
      const vs = String(v);
      if (vs.toLowerCase().includes('investment') || vs.toLowerCase().includes('date of')) {
        const dt = tryParseDate(vs);
        if (dt) { investmentDate = dt; break outer; }
      }
    }
    const joined = row.join(' ');
    const dt = tryParseDate(joined);
    if (dt && joined.toLowerCase().includes('investment')) { investmentDate = dt; break; }
  }

  // Map column indices
  const hdr = rows[hr];
  let cAC = -1, cD = -1, cQ = -1, cUC = -1, cTC = -1, cMP = -1, cMV = -1, cUG = -1, cHP = -1, cGP = -1;
  hdr.forEach((v, i) => {
    if (!v) return;
    const s = String(v).trim();
    if (s === 'Asset Class')   cAC = i;
    if (s === 'Item Description') cD = i;
    if (s === 'Quantity')      cQ  = i;
    if (s === 'Unit Cost')     cUC = i;
    if (s === 'Total Cost')    cTC = i;
    if (s === 'Market Price')  cMP = i;
    if (s === 'Market Value')  cMV = i;
    if (s === 'Unrealized Gain') cUG = i;
    if (s === 'Holding %')     cHP = i;
    if (s === '% Gain To Cost') cGP = i;
  });

  const holdings = [];
  let curClass = '', cash = 0;
  const name = sn.replace(/\(.*\)/, '').trim();

  for (let i = hr + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(v => v === null || v === '')) continue;
    const ac   = cAC >= 0 ? row[cAC] : null;
    const desc = cD  >= 0 ? row[cD]  : null;

    if (ac && typeof ac === 'string' && ac.trim()) {
      const a = ac.trim();
      if (['Equity', 'Exchange Traded Fund', 'Hybrid Fund', 'Bank Balance', 'Accruals'].some(s => a.includes(s))) {
        curClass = a; continue;
      }
      if (a.includes('Total') || a.includes('Grand')) continue;
      if (a.includes('BALANCE WITH BANKS')) {
        cash = nv(row[cMV]) || nv(row[cTC]) || 0; continue;
      }
      const n   = desc ? String(desc).trim() : a;
      const qty = nv(row[cQ]),  tc = nv(row[cTC]), mp = nv(row[cMP]),
            mv  = nv(row[cMV]), ug = nv(row[cUG]), hp = nv(row[cHP]),
            gp  = nv(row[cGP]), uc = nv(row[cUC]);
      if (qty !== null && mv !== null && !curClass.includes('Accruals') && !curClass.includes('Bank')) {
        holdings.push({
          symbol: a, name: n, qty, unitCost: uc || 0, totalCost: tc || 0,
          marketPrice: mp || 0, marketValue: mv || 0, pnl: ug || 0,
          pnlPct: gp || 0, holdingPct: hp || 0, assetClass: curClass
        });
      }
    }
  }

  // Fallback cash scan
  if (cash === 0) {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]; if (!r) continue;
      if ((r || []).join(' ').includes('BALANCE WITH BANKS')) {
        for (let j = 0; j < r.length; j++) {
          if (typeof r[j] === 'number' && r[j] > 0 && r[j] < 1e9) { cash = r[j]; break; }
        }
      }
    }
  }

  // Investment Summary section — true cost / current value
  let trueCost = null, trueCurrentVal = null, realizedGain = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]; if (!row) continue;
    for (let j = 0; j < row.length - 1; j++) {
      const cell = String(row[j] || '').trim().toLowerCase();
      const valCell = nv(row[j + 1]) || nv(row[j + 2]) || nv(row[j + 3]);
      if (cell.includes('total cost of investment') && valCell !== null)    trueCost      = valCell;
      if (cell.includes('current value of investment') && valCell !== null) trueCurrentVal = valCell;
      if (cell.includes('realized gain') || cell.includes('realised gain')) {
        for (let k = j + 1; k < row.length; k++) { const v = nv(row[k]); if (v !== null) { realizedGain = v; break; } }
      }
    }
  }

  const ti  = holdings.reduce((s, h) => s + h.totalCost,    0);
  const tc2 = holdings.reduce((s, h) => s + h.marketValue, 0);
  const effectiveCost    = trueCost    !== null ? trueCost    : ti;
  const effectiveCurrent = trueCurrentVal !== null ? trueCurrentVal : tc2;
  const pl = effectiveCurrent - effectiveCost;

  return {
    name, sn, holdings, cash,
    totalInvested:          effectiveCost,
    totalInvestedHoldings:  ti,
    totalCurrent:           effectiveCurrent,
    totalCurrentHoldings:   tc2,
    totalPnL:               pl,
    realizedGain:           realizedGain || 0,
    totalPnLPct:            effectiveCost > 0 ? pl / effectiveCost : 0,
    investmentDate,
    hasTrueCost:            trueCost !== null
  };
}

// ── Main entry: parse full workbook ──
function parsePortfolioExcel(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, cellNF: false, cellText: false });
  const clients = {}, stocks = {};

  wb.SheetNames.forEach(sn => {
    const ws   = wb.Sheets[sn];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    const c    = parseSheet(sn, rows);
    if (!c) return;

    clients[c.name] = c;
    c.holdings.forEach(h => {
      const sym = h.symbol;
      if (!stocks[sym]) stocks[sym] = { name: h.name, symbol: sym, clients: [] };
      stocks[sym].clients.push({
        clientName:    c.name,
        qty:           h.qty,
        cost:          h.totalCost,
        value:         h.marketValue,
        pnl:           h.pnl,
        pnlPct:        h.pnlPct,
        allocationPct: h.holdingPct
      });
    });
  });

  return { clients, stocks };
}

module.exports = { parsePortfolioExcel, parseSheet };
