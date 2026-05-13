// ══════════════════════════════════════════════════════════════
// FIFO Tax Engine — Backend Routes
// Add to your Railway server.js
//
// npm install multer xlsx
//
// Wire: registerFIFORoutes(app, supabase);  // before app.listen()
// ══════════════════════════════════════════════════════════════

const multer = require('multer');
const XLSX   = require('xlsx');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

const TAX = { stcg: 0.20, ltcg: 0.125, ltcgDays: 365 };

function parseSheet(ws) {
  const txns = [];
  let section = 'Equity';
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  for (const row of rows) {
    const v = row.map(x => String(x ?? '').trim());
    if (v.length < 17) continue;
    const line = v.slice(0, 12).join(',');
    if (line.includes('Exchange Traded Fund')) { section = 'ETF'; continue; }
    if (line.includes('Hybrid Fund'))          { section = 'Hybrid'; continue; }
    const [,,,dateStr,isin,,,scrip,,txnType,,,,,qtyStr,netRate,trdRate] = v;
    if (!['Purchase','Sale','Capital In','Capital Out'].includes(txnType)) continue;
    if (!dateStr || !isin || !qtyStr) continue;
    if (dateStr.length < 8 || dateStr[2] !== '-') continue;
    const qty = parseFloat(qtyStr);
    const rate = parseFloat(netRate) || parseFloat(trdRate) || 0;
    if (isNaN(qty) || qty <= 0 || rate <= 0) continue;
    const [dd,mm,yyyy] = dateStr.split('-');
    txns.push({
      date: `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`,
      isin, scrip,
      type: (txnType === 'Purchase' || txnType === 'Capital In') ? 'BUY' : 'SELL',
      qty, rate, section
    });
  }
  return txns.sort((a,b) => a.date.localeCompare(b.date));
}

function buildFIFO(txns) {
  const lots = {};
  const realized = [];
  for (const t of txns) {
    if (!lots[t.isin]) lots[t.isin] = [];
    if (t.type === 'BUY') {
      lots[t.isin].push({ date:t.date, rate:t.rate, qty:t.qty, remainQty:t.qty, scrip:t.scrip, section:t.section });
    } else {
      let remain = t.qty;
      for (const lot of lots[t.isin]) {
        if (remain <= 0) break;
        if (lot.remainQty <= 0) continue;
        const use = Math.min(lot.remainQty, remain);
        const days = Math.round((new Date(t.date) - new Date(lot.date)) / 86400000);
        const isLT = days >= TAX.ltcgDays;
        const gain = parseFloat(((t.rate - lot.rate) * use).toFixed(2));
        const taxRate = isLT ? TAX.ltcg : TAX.stcg;
        const taxAmt = gain > 0 ? parseFloat((gain * taxRate).toFixed(2)) : 0;
        realized.push({ isin:t.isin, scrip:t.scrip||lot.scrip, buyDate:lot.date, sellDate:t.date,
          buyRate:lot.rate, sellRate:t.rate, qty:use, gain, isLT, holdDays:days, taxRate, taxAmt, section:t.section });
        lot.remainQty = parseFloat((lot.remainQty - use).toFixed(4));
        remain = parseFloat((remain - use).toFixed(4));
      }
    }
  }
  const openLots = {};
  for (const [isin, ls] of Object.entries(lots)) {
    const open = ls.filter(l => l.remainQty > 0);
    if (open.length) openLots[isin] = open;
  }
  return { lots: openLots, realized };
}

function extractClientName(sheetName) {
  return sheetName.replace(/\(\d+\)\s*$/, '').replace(/\(\d*\s*$/, '').trim();
}

async function upsertClientFIFO(supabase, clientName, sheetName, data, txnCount) {
  const { error } = await supabase.from('client_fifo').upsert(
    { client_name: clientName, sheet_name: sheetName, data, txn_count: txnCount, updated_at: new Date().toISOString() },
    { onConflict: 'client_name' }
  );
  if (error) throw new Error(`${clientName}: ${error.message}`);
}

async function getClientFIFO(supabase, clientName) {
  let { data } = await supabase.from('client_fifo').select('client_name,data,txn_count,updated_at')
    .eq('client_name', clientName).single();
  if (!data) {
    const words = clientName.trim().split(/\s+/).slice(0,2).join(' ');
    const res = await supabase.from('client_fifo').select('client_name,data,txn_count,updated_at')
      .ilike('client_name', `${words}%`).limit(1).single();
    data = res.data;
  }
  return data;
}

module.exports = function registerFIFORoutes(app, supabase) {

  // POST /api/fifo/upload — master XLS with all client sheets
  app.post('/api/fifo/upload', upload.single('file'), async (req, res) => {
    try {
      const mode = req.body.mode || 'merge';
      if (!req.file) return res.status(400).json({ error: 'No file' });
      const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: false });
      if (mode === 'full') {
        const { error } = await supabase.from('client_fifo').delete().neq('id', 0);
        if (error) throw new Error('Delete failed: ' + error.message);
      }
      let processed = 0, totalTxns = 0;
      const errors = [];
      for (const sheetName of wb.SheetNames) {
        try {
          const txns = parseSheet(wb.Sheets[sheetName]);
          if (!txns.length) continue;
          const { lots, realized } = buildFIFO(txns);
          const clientName = extractClientName(sheetName);
          await upsertClientFIFO(supabase, clientName, sheetName, { lots, realized }, txns.length);
          processed++; totalTxns += txns.length;
        } catch(e) { errors.push({ sheet: sheetName, error: e.message }); }
      }
      res.json({ ok: true, clients: processed, totalTxns, errors: errors.slice(0,5) });
    } catch(err) { console.error('[fifo/upload]', err); res.status(500).json({ error: err.message }); }
  });

  // GET /api/fifo/client?name=...
  app.get('/api/fifo/client', async (req, res) => {
    try {
      const name = req.query.name;
      if (!name) return res.status(400).json({ error: 'name required' });
      const row = await getClientFIFO(supabase, name);
      res.json({ ok: true, data: row?.data || null, matchedName: row?.client_name });
    } catch(err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/fifo/status
  app.get('/api/fifo/status', async (req, res) => {
    try {
      const { data: latest } = await supabase.from('client_fifo').select('updated_at')
        .order('updated_at', { ascending: false }).limit(1);
      const { count } = await supabase.from('client_fifo').select('id', { count: 'exact', head: true });
      const { data: txnRows } = await supabase.from('client_fifo').select('txn_count');
      const totalTxns = txnRows ? txnRows.reduce((s,r) => s + (r.txn_count||0), 0) : 0;
      res.json({ ok:true, clients: count||0, totalTxns, uploadedAt: latest?.[0]?.updated_at||null });
    } catch(err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/fifo/tax-preview?client=&isin=&qty=&sellPrice=
  app.get('/api/fifo/tax-preview', async (req, res) => {
    try {
      const { client, isin, qty, sellPrice } = req.query;
      if (!client||!isin||!qty||!sellPrice) return res.status(400).json({ error: 'client, isin, qty, sellPrice required' });
      const row = await getClientFIFO(supabase, client);
      if (!row?.data) return res.json({ ok:true, noData:true });
      const lots = (row.data.lots[isin]||[]).filter(l=>l.remainQty>0);
      let remain=parseFloat(qty),stcgG=0,ltcgG=0,stcgT=0,ltcgT=0,used=[];
      for (const lot of lots) {
        if (remain<=0) break;
        const use=Math.min(lot.remainQty,remain);
        const days=Math.round((Date.now()-new Date(lot.date))/86400000);
        const isLT=days>=TAX.ltcgDays;
        const gain=(parseFloat(sellPrice)-lot.rate)*use;
        if(isLT){ltcgG+=gain;ltcgT+=gain>0?gain*TAX.ltcg:0;}else{stcgG+=gain;stcgT+=gain>0?gain*TAX.stcg:0;}
        used.push({buyDate:lot.date,buyRate:lot.rate,qty:use,days,isLT,gain});
        remain-=use;
      }
      res.json({ ok:true, stcgGain:stcgG, ltcgGain:ltcgG, stcgTax:stcgT, ltcgTax:ltcgT, totalTax:stcgT+ltcgT, lotsUsed:used });
    } catch(err) { res.status(500).json({ error: err.message }); }
  });
};
