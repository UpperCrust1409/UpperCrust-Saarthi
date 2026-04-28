const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const { supabase } = require('../db/supabase');
 
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
 
// ── Detect fund name from sheet rows ──
function detectFund(rows) {
  const FUND_MAP = {
    'wealth fund': 'Uppercrust Wealth Fund',
    'growth fund': 'Uppercrust Growth Fund',
    'prosperity fund': 'Uppercrust Prosperity Fund',
    'mucwf': 'Uppercrust Wealth Fund',
    'mugf': 'Uppercrust Growth Fund',
    'mupf': 'Uppercrust Prosperity Fund',
  };
  for (let i = 0; i < Math.min(25, rows.length); i++) {
    const joined = (rows[i] || []).join(' ').toLowerCase();
    for (const [key, fund] of Object.entries(FUND_MAP)) {
      if (joined.includes(key)) return fund;
    }
  }
  return 'Uppercrust Wealth Fund';
}
 
// ── Extract OFIN code from sheet content ──
function extractOFIN(rows) {
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const joined = (rows[i] || []).join(' ');
    const match = joined.match(/OFIN\s*Code\s*[:\-]\s*(\d+)/i);
    if (match) return match[1].trim();
  }
  return null;
}
 
// ── Parse investment date ──
function parseInvestDate(rows) {
  const MONTHS = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
  const DATE_PAT = /Date\s+of\s+Investment\s*[:\-]\s*(\d{1,2})[\/\-\s](\w{3,9})[\/\-\s](\d{4})/i;
  const DATE_PAT2 = /(\d{2})[\/\-](\w{3})[\/\-](\d{4})/;
  function tryParse(str) {
    if (!str) return null;
    let m = String(str).match(DATE_PAT);
    if (!m) m = String(str).match(DATE_PAT2);
    if (!m) return null;
    const d = parseInt(m[1]), monStr = m[2].toLowerCase().slice(0,3), y = parseInt(m[3]);
    const mon = MONTHS[monStr];
    if (isNaN(d) || mon === undefined || isNaN(y)) return null;
    return new Date(y, mon, d).toISOString();
  }
  for (let i = 0; i < Math.min(25, rows.length); i++) {
    const row = rows[i] || [];
    for (const v of row) {
      if (!v) continue;
      const vs = String(v);
      if (vs.toLowerCase().includes('investment')) {
        const dt = tryParse(vs);
        if (dt) return dt;
      }
    }
    const dt = tryParse(row.join(' '));
    if (dt && row.join(' ').toLowerCase().includes('investment')) return dt;
  }
  return null;
}
 
function nv(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v); return isNaN(n) ? null : n;
}
 
// ── Parse one sheet ──
function parseSheet(sheetName, rows) {
  let hr = -1;
  for (let i = 0; i < rows.length; i++) {
    const joined = (rows[i] || []).join(' ');
    if (joined.includes('Quantity') && joined.includes('Market Value')) { hr = i; break; }
  }
  if (hr === -1) return null;
 
  const fundName = detectFund(rows);
  const investDate = parseInvestDate(rows);
  const ofinCode = extractOFIN(rows);
 
  // Use OFIN code for unique identification, fall back to sheet name
  const baseName = sheetName.replace(/\(.*\)/, '').trim();
  // Unique name = "ClientName(OFINCode)" - ensures uniqueness across funds
  const uniqueName = ofinCode ? `${baseName}(${ofinCode})` : sheetName;
 
  const hdr = rows[hr];
  let cAC=-1,cD=-1,cQ=-1,cUC=-1,cTC=-1,cMP=-1,cMV=-1,cUG=-1,cHP=-1,cGP=-1;
  hdr.forEach((v,i) => {
    if (!v) return; const s = String(v).trim();
    if (s==='Asset Class') cAC=i; if (s==='Item Description') cD=i;
    if (s==='Quantity') cQ=i; if (s==='Unit Cost') cUC=i;
    if (s==='Total Cost') cTC=i; if (s==='Market Price') cMP=i;
    if (s==='Market Value') cMV=i; if (s==='Unrealized Gain') cUG=i;
    if (s==='Holding %') cHP=i; if (s==='% Gain To Cost') cGP=i;
  });
 
  const holdings = []; let curClass = '', cash = 0;
 
  for (let i = hr + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(v => v === null || v === '')) continue;
    const ac = cAC >= 0 ? row[cAC] : null;
    const desc = cD >= 0 ? row[cD] : null;
    if (ac && typeof ac === 'string' && ac.trim()) {
      const a = ac.trim();
      if (['Equity','Exchange Traded Fund','Hybrid Fund','Bank Balance','Accruals'].some(s => a.includes(s))) { curClass = a; continue; }
      if (a.includes('Total') || a.includes('Grand')) continue;
      if (a.includes('BALANCE WITH BANKS')) { cash = nv(row[cMV]) || nv(row[cTC]) || 0; continue; }
      const n = desc ? String(desc).trim() : a;
      const qty=nv(row[cQ]),tc=nv(row[cTC]),mp=nv(row[cMP]),mv=nv(row[cMV]),ug=nv(row[cUG]),hp=nv(row[cHP]),gp=nv(row[cGP]),uc=nv(row[cUC]);
      if (qty !== null && mv !== null && !curClass.includes('Accruals') && !curClass.includes('Bank'))
        holdings.push({ symbol:a, name:n, qty, unitCost:uc||0, totalCost:tc||0, marketPrice:mp||0, marketValue:mv||0, pnl:ug||0, pnlPct:gp||0, holdingPct:hp||0, assetClass:curClass });
    }
  }
 
  if (cash === 0) {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r) continue;
      if ((r||[]).join(' ').includes('BALANCE WITH BANKS')) {
        for (let j = 0; j < r.length; j++) {
          if (typeof r[j]==='number' && r[j]>0 && r[j]<1e9) { cash=r[j]; break; }
        }
      }
    }
  }
 
  // Parse true cost from summary
  let trueCost = null, trueCurrentVal = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]; if (!row) continue;
    for (let j = 0; j < row.length - 1; j++) {
      const cell = String(row[j] || '').trim().toLowerCase();
      const valCell = nv(row[j+1]) || nv(row[j+2]) || nv(row[j+3]);
      if (cell.includes('total cost of investment') && valCell !== null) trueCost = valCell;
      if (cell.includes('current value of investment') && valCell !== null) trueCurrentVal = valCell;
    }
  }
 
  const ti = holdings.reduce((s,h) => s + h.totalCost, 0);
  const tc2 = holdings.reduce((s,h) => s + h.marketValue, 0);
  const effectiveCost = trueCost !== null ? trueCost : ti;
  const effectiveCurrent = trueCurrentVal !== null ? trueCurrentVal : tc2;
  const pl = effectiveCurrent - effectiveCost;
 
  return {
    name: uniqueName,
    displayName: baseName,
    ofinCode,
    fundName,
    investDate,
    holdings,
    cash,
    totalInvested: effectiveCost,
    totalCurrent: effectiveCurrent,
    totalPnL: pl,
    totalPnLPct: effectiveCost > 0 ? pl / effectiveCost : 0
  };
}
 
// POST /api/upload
router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
 
    const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
 
    // Parse all sheets
    const clients = [];
    wb.SheetNames.forEach(sn => {
      const ws = wb.Sheets[sn];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
      const c = parseSheet(sn, rows);
      if (c && c.holdings.length > 0) clients.push(c);
    });
 
    if (!clients.length) return res.status(400).json({ error: 'No valid client sheets found' });
 
    // Clear existing data
    const { error: delH } = await supabase.from('holdings').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    const { error: delC } = await supabase.from('clients').delete().neq('id', '00000000-0000-0000-0000-000000000000');
 
    // Create upload record
    const { data: uploadRec, error: upErr } = await supabase
      .from('uploads').insert({ filename: req.file.originalname }).select().single();
    if (upErr) throw upErr;
 
    // Insert clients in batches
    const clientRecords = clients.map(c => ({
      name: c.name,
      fund_name: c.fundName,
      cash: c.cash || 0,
      total_invested: c.totalInvested || 0,
      total_current: c.totalCurrent || 0,
      total_pnl: c.totalPnL || 0,
      investment_date: c.investDate,
      upload_id: uploadRec.id
    }));
 
    const { data: insertedClients, error: cErr } = await supabase
      .from('clients').insert(clientRecords).select();
    if (cErr) throw cErr;
 
    // Build name → id map
    const clientIdMap = {};
    insertedClients.forEach(c => { clientIdMap[c.name] = c.id; });
 
    // Insert all holdings in batches of 500
    const allHoldings = [];
    clients.forEach(c => {
      const clientId = clientIdMap[c.name];
      if (!clientId) return;
      c.holdings.forEach(h => {
        allHoldings.push({
          client_id: clientId,
          symbol: h.symbol,
          name: h.name,
          qty: h.qty,
          unit_cost: h.unitCost,
          total_cost: h.totalCost,
          market_price: h.marketPrice,
          market_value: h.marketValue,
          pnl: h.pnl,
          pnl_pct: h.pnlPct,
          holding_pct: h.holdingPct,
          asset_class: h.assetClass
        });
      });
    });
 
    for (let i = 0; i < allHoldings.length; i += 500) {
      const batch = allHoldings.slice(i, i + 500);
      const { error: hErr } = await supabase.from('holdings').insert(batch);
      if (hErr) throw hErr;
    }
 
    const funds = [...new Set(clients.map(c => c.fundName))];
    res.json({
      success: true,
      message: `Uploaded ${clients.length} portfolios with ${allHoldings.length} holdings`,
      clients: clients.length,
      holdings: allHoldings.length,
      funds
    });
 
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});
 
module.exports = router;
