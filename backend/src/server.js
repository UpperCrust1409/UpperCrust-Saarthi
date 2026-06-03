require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const authRoutes      = require('./routes/auth');
const uploadRoutes    = require('./routes/upload');
const clientRoutes    = require('./routes/clients');
const stockRoutes     = require('./routes/stocks');
const dashboardRoutes = require('./routes/dashboard');
const riskRoutes      = require('./routes/risk');
const tagsRoutes      = require('./routes/tags');
const holdingsRoutes  = require('./routes/holdings');
const metaRoutes      = require('./routes/meta');
const registerFIFORoutes = require('./routes/fifo');
 
const app = express();
app.set('trust proxy', 1);
 
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
 
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }));
 
const limiter = rateLimit({ windowMs: 15*60*1000, max: 2000, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 20, message: { error: 'Too many login attempts.' } });
 
app.use(limiter);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
 
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date() }));
 
app.use('/api/auth',      authLimiter, authRoutes);
app.use('/api/upload',    uploadRoutes);
app.use('/api/clients',   clientRoutes);
app.use('/api/stocks',    stockRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/risk',      riskRoutes);
app.use('/api/tags',      tagsRoutes);
app.use('/api/holdings',  holdingsRoutes);
app.use('/api/meta',      metaRoutes);
 
// ── Supabase ──
const { createClient } = require('@supabase/supabase-js');
const _supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
);
registerFIFORoutes(app, _supabase);
 
// ── App Settings ──
app.get('/api/settings/:key', async (req, res) => {
  try {
    const { data, error } = await _supabase.from('app_settings').select('value').eq('key', req.params.key).single();
    if (error && error.code !== 'PGRST116') throw error;
    res.json({ value: data?.value || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
app.post('/api/settings/:key', async (req, res) => {
  try {
    const { value } = req.body;
    if (value === undefined) return res.status(400).json({ error: 'Value required' });
    const { error } = await _supabase.from('app_settings').upsert({ key: req.params.key, value, updated_at: new Date().toISOString() });
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
// ── Saarthi Memory ──
app.get('/api/memory', async (req, res) => {
  try {
    const { data, error } = await _supabase.from('saarthi_memory').select('*').eq('active', true).order('importance', { ascending: false }).order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ memories: data || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
app.post('/api/memory', async (req, res) => {
  try {
    const { memories } = req.body;
    if (!memories || !memories.length) return res.status(400).json({ error: 'Memories array required' });
    const rows = memories.map(m => ({ category: m.category||'general', memory: m.memory, source: m.source||'auto', importance: m.importance||5, active: true, created_by: m.created_by||'system', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }));
    const { data, error } = await _supabase.from('saarthi_memory').insert(rows).select();
    if (error) throw error;
    res.json({ ok: true, saved: data.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
app.delete('/api/memory/:id', async (req, res) => {
  try {
    const { error } = await _supabase.from('saarthi_memory').update({ active: false, updated_at: new Date().toISOString() }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
app.patch('/api/memory/:id', async (req, res) => {
  try {
    const { importance, memory, active } = req.body;
    const updates = { updated_at: new Date().toISOString() };
    if (importance !== undefined) updates.importance = importance;
    if (memory !== undefined) updates.memory = memory;
    if (active !== undefined) updates.active = active;
    const { error } = await _supabase.from('saarthi_memory').update(updates).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
// ── Claude AI Proxy ──
app.post('/api/claude', async (req, res) => {
  try {
    const { apiKey, system, messages } = req.body;
    if (!apiKey || !apiKey.startsWith('sk-ant-')) return res.status(400).json({ error: { message: 'Invalid API key' } });
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 4096, system: system||'', messages }),
    });
    const data = await response.json();
    res.status(response.ok ? 200 : response.status).json(data);
  } catch (err) { res.status(500).json({ error: { message: err.message } }); }
});
 
app.post('/api/claude/extract-memory', async (req, res) => {
  try {
    const { apiKey, conversation, existing_memories } = req.body;
    if (!apiKey || !apiKey.startsWith('sk-ant-')) return res.status(400).json({ memories: [] });
    const extractPrompt = `You are a memory extraction system for Saarthi PMS AI.\nAnalyze this conversation and extract ONLY genuinely new, important learnings.\nEXISTING MEMORIES (do NOT re-extract):\n${existing_memories||'None'}\nCONVERSATION:\n${conversation}\nReturn ONLY a JSON array (no other text):\n[{"category":"philosophy|preference|decision|client|market|correction","memory":"exact string","importance":1-10}]\nReturn [] if nothing important. Be selective.`;
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 500, messages: [{ role: 'user', content: extractPrompt }] }),
    });
    const data = await response.json();
    const text = data.content?.[0]?.text || '[]';
    let memories = [];
    try { const match = text.match(/\[[\s\S]*\]/); if (match) memories = JSON.parse(match[0]); } catch(e) {}
    res.json({ memories });
  } catch (err) { res.status(500).json({ memories: [], error: err.message }); }
});
 
// ════════════════════════════════════════════════════════════════
//  KITE LIVE DATA — Zerodha API Integration
// ════════════════════════════════════════════════════════════════
const KITE_API_KEY    = process.env.KITE_API_KEY    || 'bj9g3wng1t91splw';
const KITE_API_SECRET = process.env.KITE_API_SECRET || '08f2h7jfdl50d127dzynuq43a8y5f66e';
const KITE_BASE       = 'https://api.kite.trade';
 
// In-memory token store (also persisted to Supabase)
let _kiteToken = null;
let _kiteTokenExpiry = null;
 
// Load token from Supabase on startup
async function _loadKiteToken() {
  try {
    const { data } = await _supabase.from('app_settings').select('value').eq('key', 'kite_access_token').single();
    if (data?.value) {
      const parsed = JSON.parse(data.value);
      if (parsed.token && parsed.expiry && new Date(parsed.expiry) > new Date()) {
        _kiteToken = parsed.token;
        _kiteTokenExpiry = parsed.expiry;
        console.log('[Kite] Token loaded from Supabase, expires:', parsed.expiry);
      }
    }
  } catch(e) { /* no token yet */ }
}
_loadKiteToken();
 
async function _saveKiteToken(token, expiry) {
  _kiteToken = token;
  _kiteTokenExpiry = expiry;
  await _supabase.from('app_settings').upsert({
    key: 'kite_access_token',
    value: JSON.stringify({ token, expiry }),
    updated_at: new Date().toISOString()
  });
}
 
// ── Step 1: Generate Kite login URL ──
app.get('/api/kite/login-url', (req, res) => {
  const url = `https://kite.zerodha.com/connect/login?v=3&api_key=${KITE_API_KEY}`;
  res.json({ url });
});
 
// ── Step 2: Callback — exchange request_token for access_token ──
app.get('/api/kite/callback', async (req, res) => {
  const { request_token, status } = req.query;
  if (status !== 'success' || !request_token) {
    return res.redirect('https://uppercrustsaarthi.in?kite_error=1');
  }
  try {
    const crypto = require('crypto');
    const checksum = crypto.createHash('sha256')
      .update(KITE_API_KEY + request_token + KITE_API_SECRET)
      .digest('hex');
 
    const resp = await fetch(`${KITE_BASE}/session/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Kite-Version': '3' },
      body: new URLSearchParams({ api_key: KITE_API_KEY, request_token, checksum }).toString(),
    });
 
    const data = await resp.json();
    if (!resp.ok || !data.data?.access_token) {
      console.error('[Kite callback]', data);
      return res.redirect('https://uppercrustsaarthi.in?kite_error=2');
    }
 
    const token = data.data.access_token;
    // Token expires at 6 AM next day IST
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 1);
    expiry.setHours(6, 0, 0, 0);
 
    await _saveKiteToken(token, expiry.toISOString());
    console.log('[Kite] New token saved, expires:', expiry.toISOString());
 
    res.redirect('https://uppercrustsaarthi.in?kite_auth=success');
  } catch (err) {
    console.error('[Kite callback error]', err);
    res.redirect('https://uppercrustsaarthi.in?kite_error=3');
  }
});
 
// ── Kite API proxy helper ──
async function _kiteGet(path) {
  if (!_kiteToken) return { error: 'not_authenticated' };
  const resp = await fetch(`${KITE_BASE}${path}`, {
    headers: { 'Authorization': `token ${KITE_API_KEY}:${_kiteToken}`, 'X-Kite-Version': '3' }
  });
  return resp.json();
}
 
// ── GET /api/kite/status — is Kite connected? ──
app.get('/api/kite/status', (req, res) => {
  const connected = !!_kiteToken && !!_kiteTokenExpiry && new Date(_kiteTokenExpiry) > new Date();
  res.json({
    connected,
    expiry: _kiteTokenExpiry,
    apiKey: KITE_API_KEY,
  });
});
 
// ── GET /api/kite/quote?symbols=NSE:RELIANCE,NSE:TCS ──
app.get('/api/kite/quote', async (req, res) => {
  try {
    const { symbols } = req.query;
    if (!symbols) return res.status(400).json({ error: 'symbols required' });
    const data = await _kiteGet(`/quote?i=${symbols.split(',').join('&i=')}`);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
// ── GET /api/kite/ltp?symbols=NSE:RELIANCE,NSE:TCS ──
app.get('/api/kite/ltp', async (req, res) => {
  try {
    const { symbols } = req.query;
    if (!symbols) return res.status(400).json({ error: 'symbols required' });
    const data = await _kiteGet(`/quote/ltp?i=${symbols.split(',').join('&i=')}`);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
// ── GET /api/kite/ohlc?symbols=NSE:RELIANCE ──
app.get('/api/kite/ohlc', async (req, res) => {
  try {
    const { symbols } = req.query;
    if (!symbols) return res.status(400).json({ error: 'symbols required' });
    const data = await _kiteGet(`/quote/ohlc?i=${symbols.split(',').join('&i=')}`);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
// ── GET /api/kite/historical?symbol=NSE:RELIANCE&interval=day&from=2024-01-01&to=2024-12-31 ──
app.get('/api/kite/historical', async (req, res) => {
  try {
    const { symbol, interval, from, to } = req.query;
    if (!symbol) return res.status(400).json({ error: 'symbol required' });
 
    // Get instrument token first
    const quote = await _kiteGet(`/quote/ltp?i=${symbol}`);
    if (quote.error) return res.status(401).json(quote);
    const token = quote.data?.[symbol]?.instrument_token;
    if (!token) return res.status(404).json({ error: 'instrument not found' });
 
    const data = await _kiteGet(`/instruments/historical/${token}/${interval||'day'}?from=${from}&to=${to}&continuous=0&oi=0`);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
// ── GET /api/kite/portfolio-live — live value of all PMS holdings ──
// Accepts: holdings array in body as JSON query param
app.post('/api/kite/portfolio-live', async (req, res) => {
  try {
    if (!_kiteToken) return res.json({ error: 'not_authenticated', connected: false });
 
    const { symbols } = req.body; // array of {symbol, exchange, qty, avgCost}
    if (!symbols || !symbols.length) return res.status(400).json({ error: 'symbols array required' });
 
    // Build exchange:symbol list (default NSE, BSE for ETFs)
    const kiteSymbols = symbols.map(s => {
      const exch = s.exchange || (s.symbol.endsWith('BEES') || s.symbol.endsWith('ETF') ? 'BSE' : 'NSE');
      return `${exch}:${s.symbol}`;
    });
 
    // Batch in groups of 500 (Kite limit)
    const batches = [];
    for (let i = 0; i < kiteSymbols.length; i += 500) {
      batches.push(kiteSymbols.slice(i, i + 500));
    }
 
    const allData = {};
    for (const batch of batches) {
      const data = await _kiteGet(`/quote/ltp?i=${batch.join('&i=')}`);
      if (data.data) Object.assign(allData, data.data);
    }
 
    // Compute live P&L for each holding
    const result = symbols.map(s => {
      const key = `${s.exchange || 'NSE'}:${s.symbol}`;
      const bseKey = `BSE:${s.symbol}`;
      const liveData = allData[key] || allData[bseKey];
      const ltp = liveData?.last_price || s.avgCost; // fallback to cost if not found
      const marketValue = ltp * s.qty;
      const cost = s.avgCost * s.qty;
      const pnl = marketValue - cost;
      return {
        symbol: s.symbol,
        qty: s.qty,
        avgCost: s.avgCost,
        ltp,
        marketValue,
        cost,
        pnl,
        pnlPct: cost > 0 ? pnl / cost : 0,
        live: !!liveData,
      };
    });
 
    const totalLive = result.reduce((s, r) => s + r.marketValue, 0);
    const totalCost = result.reduce((s, r) => s + r.cost, 0);
    const totalPnL  = result.reduce((s, r) => s + r.pnl, 0);
 
    res.json({
      connected: true,
      holdings: result,
      summary: { totalLive, totalCost, totalPnL, pnlPct: totalCost > 0 ? totalPnL / totalCost : 0 },
      ts: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Kite portfolio-live]', err);
    res.status(500).json({ error: err.message });
  }
});
 
// ── GET /api/kite/search?q=RELIANCE — search instruments ──
app.get('/api/kite/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ results: [] });
    // Use NSE and BSE instruments dump (Kite doesn't have search, so we use a simple approach)
    // Return common format
    const data = await _kiteGet(`/instruments?exchange=NSE`);
    // This is large — for now return empty and let frontend use symbol directly
    res.json({ results: [], note: 'Use direct symbol with exchange prefix e.g. NSE:RELIANCE' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
 
// ── World Indices (proxied to avoid CORS) ──
app.get('/api/world-indices', async (req, res) => {
  try {
    const symbols = ['^GSPC','^IXIC','^DJI','^FTSE','^GDAXI','^N225','^HSI','000001.SS','^VIX'];
    const url = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${symbols.map(s=>encodeURIComponent(s)).join(',')}&range=1d&interval=1d`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) throw new Error('Yahoo Finance error: '+resp.status);
    const data = await resp.json();
    const map = {
      '^GSPC': {label:'S&P 500',   region:'🇺🇸 USA'},
      '^IXIC': {label:'NASDAQ',    region:'🇺🇸 USA'},
      '^DJI':  {label:'Dow Jones', region:'🇺🇸 USA'},
      '^FTSE': {label:'FTSE 100',  region:'🇬🇧 UK'},
      '^GDAXI':{label:'DAX',       region:'🇩🇪 Germany'},
      '^N225': {label:'Nikkei 225',region:'🇯🇵 Japan'},
      '^HSI':  {label:'Hang Seng', region:'🇭🇰 HK'},
      '000001.SS':{label:'Shanghai',region:'🇨🇳 China'},
      '^VIX':  {label:'VIX Fear',  region:'🌐 Global'},
    };
    const spark = data?.spark?.result || [];
    const indices = spark.map(item => {
      const info = map[item.symbol];
      if (!info) return null;
      const quotes = item.response?.[0]?.indicators?.quote?.[0]?.close || [];
      const prev = quotes[quotes.length - 2] || 0;
      const curr = quotes[quotes.length - 1] || 0;
      const chgPct = prev > 0 ? (curr - prev) / prev : 0;
      return {
        label: info.label,
        region: info.region,
        val: curr ? curr.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—',
        raw: curr,
        chg: curr ? (chgPct >= 0 ? '+' : '') + (chgPct * 100).toFixed(2) + '%' : '—',
        chgPct,
        live: curr > 0,
      };
    }).filter(Boolean);
 
    res.json({ indices, source: 'Delayed · Yahoo Finance', ts: new Date().toISOString() });
  } catch (err) {
    console.error('[world-indices]', err.message);
    // Return empty on error
    res.json({ indices: [], source: 'Unavailable', error: err.message });
  }
});
 
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message, err.stack);
  res.status(err.status || 500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message });
});
 
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Saarthi backend running on :${PORT}`));
module.exports = app;
