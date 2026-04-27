const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const { supabase } = require('../db/supabase');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ══════════════════════════════════════
//  EXCEL PARSER — mirrors your HTML tool exactly
// ══════════════════════════════════════
function nv(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function tryParseDate(str) {
  if (!str) return null;
  const MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
  const DATE_PAT = /Date\s+of\s+Investment\s*[:\-]\s*(\d{1,2})[\/\-\s](\w{3,9})[\/\-\s](\d{4})/i;
  const DATE_PAT2 = /(\d{2})[\/\-](\w{3})[\/\-](\d{4})/;
  let m = String(str).match(DATE_PAT);
  if (!m) m = String(str).match(DATE_PAT2);
  if (!m) return null;
  const d = parseInt(m[1]), monStr = m[2].toLowerCase().slice(0,3), y = parseInt(m[3]);
  const mon = MONTHS[monStr];
  if (isNaN(d) || mon === undefined || isNaN(y) || y < 2000 || y > 2100) return null;
  return new Date(y, mon, d);
}

function parseSheet(sheetName, rows) {
  // Find header row containing "Quantity" AND "Market Value"
  let hr = -1;
  for (let i = 0; i < rows.length; i++) {
    const joined = (rows[i] || []).join(' ');
    if (joined.includes('Quantity') && joined.includes('Market Value')) { hr = i; break; }
  }
  if (hr === -1) return null;

  // Extract investment date from top rows
  let investmentDate = null;
  for (let i = 0; i < Math.min(hr + 1, 20); i++) {
    const row = rows[i] || [];
    for (let j = 0; j < row.length; j++) {
      const v = row[j]; if (!v) continue;
      const vs = String(v);
      if (vs.toLowerCase().includes('investment') || vs.toLowerCase().includes('date of')) {
        const dt = tryParseDate(vs);
        if (dt) { investmentDate = dt; break; }
      }
    }
    if (investmentDate) break;
    const joined = row.join(' ');
    if (joined.toLowerCase().includes('investment')) {
      const dt = tryParseDate(joined);
      if (dt) { investmentDate = dt; break; }
    }
  }

  // Map column indices
  const hdr = rows[hr];
  let cAC=-1, cD=-1, cQ=-1, cUC=-1, cTC=-1, cMP=-1, cMV=-1, cUG=-1, cHP=-1, cGP=-1;
  hdr.forEach((v, i) => {
    if (!v) return;
    const s = String(v).trim();
    if (s === 'Asset Class')      cAC = i;
    if (s === 'Item Description') cD  = i;
    if (s === 'Quantity')         cQ  = i;
    if (s === 'Unit Cost')        cUC = i;
    if (s === 'Total Cost')       cTC = i;
    if (s === 'Market Price')     cMP = i;
    if (s === 'Market Value')     cMV = i;
    if (s === 'Unrealized Gain')  cUG = i;
    if (s === 'Holding %')        cHP = i;
    if (s === '% Gain To Cost')   cGP = i;
  });

  const holdings = [];
  let curClass = '', cash = 0;
  const name = sheetName.replace(/\(.*\)/, '').trim();

  for (let i = hr + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(v => v === null || v === '')) continue;
    const ac = cAC >= 0 ? row[cAC] : null;
    if (!ac || typeof ac !== 'string' || !ac.trim()) continue;

    const a = ac.trim();
    if (['Equity','Exchange Traded Fund','Hybrid Fund','Bank Balance','Accruals'].some(s => a.includes(s))) {
      curClass = a; continue;
    }
    if (a.includes('Total') || a.includes('Grand')) continue;
    if (a.includes('BALANCE WITH BANKS')) {
      cash = nv(row[cMV]) || nv(row[cTC]) || 0;
      continue;
    }

    const desc = cD >= 0 ? row[cD] : null;
    const n = desc ? String(desc).trim() : a;
    const qty = nv(row[cQ]);
    const mv  = nv(row[cMV]);

    if (qty !== null && mv !== null && !curClass.includes('Accruals') && !curClass.includes('Bank')) {
      holdings.push({
        symbol:     a,
        name:       n,
        qty:        qty,
        unitCost:   nv(row[cUC]) || 0,
        totalCost:  nv(row[cTC]) || 0,
        marketPrice:nv(row[cMP]) || 0,
        marketValue:mv,
        pnl:        nv(row[cUG]) || 0,
        pnlPct:     nv(row[cGP]) || 0,
        holdingPct: nv(row[cHP]) || 0,
        assetClass: curClass
      });
    }
  }

  // Extract true cost from summary section
  let trueCost = null, trueCurrentVal = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]; if (!row) continue;
    for (let j = 0; j < row.length - 1; j++) {
      const cell = String(row[j] || '').trim().toLowerCase();
      const val  = nv(row[j+1]) ?? nv(row[j+2]) ?? nv(row[j+3]);
      if (cell.includes('total cost of investment') && val !== null)   trueCost = val;
      if (cell.includes('current value of investment') && val !== null) trueCurrentVal = val;
    }
  }

  const effectiveCost    = trueCost       !== null ? trueCost       : holdings.reduce((s,h) => s+h.totalCost,   0);
  const effectiveCurrent = trueCurrentVal !== null ? trueCurrentVal : holdings.reduce((s,h) => s+h.marketValue, 0);
  const pl = effectiveCurrent - effectiveCost;

  return {
    name,
    holdings,
    cash,
    totalInvested:  effectiveCost,
    totalCurrent:   effectiveCurrent,
    totalPnL:       pl,
    totalPnLPct:    effectiveCost > 0 ? pl / effectiveCost : 0,
    investmentDate,
    hasTrueCost:    trueCost !== null
  };
}

function parsePortfolioExcel(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const clients = [];
  wb.SheetNames.forEach(sn => {
    const ws   = wb.Sheets[sn];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    const c    = parseSheet(sn, rows);
    if (c) clients.push(c);
  });
  return clients;
}

// ══════════════════════════════════════
//  POST /upload
// ══════════════════════════════════════
router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // Parse Excel
    const clients = parsePortfolioExcel(req.file.buffer);
    if (!clients.length) return res.status(400).json({ error: 'No valid client sheets found in this file' });

    // 1. Create upload log
    const { data: uploadRecord, error: upErr } = await supabase
      .from('uploads')
      .insert({ filename: req.file.originalname })
      .select()
      .single();
    if (upErr) throw upErr;

    // 2. Wipe old data (clean re-upload — always fresh)
    const { data: oldClients } = await supabase.from('clients').select('id');
    if (oldClients && oldClients.length > 0) {
      const oldIds = oldClients.map(c => c.id);
      await supabase.from('holdings').delete().in('client_id', oldIds);
      await supabase.from('clients').delete().in('id', oldIds);
    }

    // 3. Insert fresh data
    let totalHoldings = 0;
    for (const c of clients) {
      const { data: clientRow, error: cErr } = await supabase
        .from('clients')
        .insert({
          upload_id:       uploadRecord.id,
          name:            c.name,
          total_invested:  c.totalInvested,
          total_current:   c.totalCurrent,
          total_pnl:       c.totalPnL,
          cash:            c.cash,
          investment_date: c.investmentDate
            ? c.investmentDate.toISOString().split('T')[0]
            : null
        })
        .select()
        .single();
      if (cErr) throw cErr;

      if (c.holdings.length > 0) {
        const rows = c.holdings.map(h => ({
          client_id:    clientRow.id,
          symbol:       h.symbol,
          name:         h.name,
          qty:          h.qty,
          unit_cost:    h.unitCost,
          total_cost:   h.totalCost,
          market_price: h.marketPrice,
          market_value: h.marketValue,
          pnl:          h.pnl,
          pnl_pct:      h.pnlPct,
          holding_pct:  h.holdingPct,
          asset_class:  h.assetClass
        }));
        const { error: hErr } = await supabase.from('holdings').insert(rows);
        if (hErr) throw hErr;
        totalHoldings += rows.length;
      }
    }

    res.json({
      success:  true,
      clients:  clients.length,
      holdings: totalHoldings,
      uploadId: uploadRecord.id,
      message:  `Successfully loaded ${clients.length} clients and ${totalHoldings} holdings`
    });

  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
