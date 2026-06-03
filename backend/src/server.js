require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const webpush = require('web-push');
const cron = require('node-cron');

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
//  SERVICE WORKER + PWA MANIFEST
// ════════════════════════════════════════════════════════════════
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, 'sw.js'));
});

app.get('/manifest.json', (req, res) => {
  res.json({
    name: 'Saarthi PMS',
    short_name: 'Saarthi',
    description: 'UpperCrust Wealth PMS Terminal',
    start_url: '/',
    display: 'standalone',
    background_color: '#0e0c07',
    theme_color: '#8a6814',
    icons: [
      { src: '/favicon.ico', sizes: '192x192', type: 'image/png' },
      { src: '/favicon.ico', sizes: '512x512', type: 'image/png' }
    ]
  });
});

// ════════════════════════════════════════════════════════════════
//  PUSH NOTIFICATIONS
// ════════════════════════════════════════════════════════════════
const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_EMAIL       = process.env.VAPID_EMAIL || 'mailto:admin@uppercrustsaarthi.in';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  console.log('[Push] VAPID configured ✓');
} else {
  console.warn('[Push] VAPID keys missing — push disabled. Run: npx web-push generate-vapid-keys');
}

async function sendPushToAll(title, body, url, opts = {}) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return 0;
  try {
    const { data: subs } = await _supabase.from('push_subscriptions').select('*').eq('active', true);
    if (!subs?.length) return 0;
    const payload = JSON.stringify({ title, body, url: url || 'https://uppercrustsaarthi.in', tag: opts.tag || 'saarthi-' + Date.now(), priority: opts.priority || 'normal' });
    let sent = 0;
    const results = await Promise.allSettled(subs.map(sub =>
      webpush.sendNotification({ endpoint: sub.endpoint, keys: { auth: sub.auth, p256dh: sub.p256dh } }, payload, { TTL: 3600 })
    ));
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') { sent++; }
      else if ([404, 410].includes(r.reason?.statusCode)) {
        _supabase.from('push_subscriptions').update({ active: false }).eq('endpoint', subs[i].endpoint);
      }
    });
    console.log(`[Push] "${title}" → ${sent}/${subs.length} devices`);
    return sent;
  } catch (err) { console.error('[Push]', err.message); return 0; }
}

app.get('/api/push/vapid-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY || null });
});

app.post('/api/push/subscribe', async (req, res) => {
  try {
    const { subscription, device } = req.body;
    if (!subscription?.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
    const { error } = await _supabase.from('push_subscriptions').upsert({
      endpoint: subscription.endpoint, auth: subscription.keys?.auth, p256dh: subscription.keys?.p256dh,
      device: (device || 'unknown').slice(0, 200), active: true, updated_at: new Date().toISOString()
    }, { onConflict: 'endpoint' });
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/push/unsubscribe', async (req, res) => {
  try {
    const { endpoint } = req.body;
    await _supabase.from('push_subscriptions').update({ active: false }).eq('endpoint', endpoint);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/push/queue', async (req, res) => {
  try {
    const { cat, title, body, url, priority } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const { error } = await _supabase.from('pending_notifications').insert({
      cat: cat || 'general', title: title.slice(0, 100), body: (body || '').slice(0, 300),
      url: url || 'https://uppercrustsaarthi.in', priority: priority || 'normal',
      sent: false, created_at: new Date().toISOString()
    });
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Drain queue every minute ──
cron.schedule('* * * * *', async () => {
  if (!VAPID_PUBLIC_KEY) return;
  try {
    const { data: pending } = await _supabase.from('pending_notifications').select('*').eq('sent', false).order('created_at', { ascending: true }).limit(20);
    if (!pending?.length) return;
    for (const n of pending) {
      const sent = await sendPushToAll(n.title, n.body || '', n.url, { tag: (n.cat||'g')+'_'+n.id, priority: n.priority });
      await _supabase.from('pending_notifications').update({ sent: true, sent_at: new Date().toISOString(), sent_to: sent }).eq('id', n.id);
    }
  } catch (err) { console.error('[Cron queue]', err.message); }
});

// ── Morning digest 8:30am weekdays ──
cron.schedule('30 8 * * 1-5', async () => {
  try {
    const { data: clients } = await _supabase.from('clients').select('name, total_pnl, total_invested');
    if (!clients?.length) return;
    const aum = clients.reduce((s, c) => s + (c.total_invested||0) + (c.total_pnl||0), 0);
    const winners = clients.filter(c => (c.total_pnl||0) > 0).length;
    await sendPushToAll('🌅 Good Morning — UpperCrust PMS', `AUM: ₹${(aum/10000000).toFixed(2)}Cr · ${winners}/${clients.length} clients in profit`, 'https://uppercrustsaarthi.in', { tag: 'morning_'+new Date().toDateString() });
  } catch (err) { console.error('[Cron morning]', err.message); }
}, { timezone: 'Asia/Kolkata' });

// ── Evening summary 3:45pm weekdays ──
cron.schedule('45 15 * * 1-5', async () => {
  try {
    const { data: clients } = await _supabase.from('clients').select('total_pnl, total_invested');
    if (!clients?.length) return;
    const pnl = clients.reduce((s, c) => s + (c.total_pnl||0), 0);
    const inv = clients.reduce((s, c) => s + (c.total_invested||0), 0);
    const sign = pnl >= 0 ? '+' : '';
    await sendPushToAll('📊 Pre-Close — UpperCrust PMS', `P&L: ${sign}₹${(Math.abs(pnl)/100000).toFixed(1)}L (${sign}${inv>0?(pnl/inv*100).toFixed(2):0}%) · 15min to close`, 'https://uppercrustsaarthi.in', { tag: 'evening_'+new Date().toDateString() });
  } catch (err) { console.error('[Cron evening]', err.message); }
}, { timezone: 'Asia/Kolkata' });

// ── Anniversary check 9am daily ──
cron.schedule('0 9 * * *', async () => {
  try {
    const { data: clients } = await _supabase.from('clients').select('name, investment_date, total_pnl, total_invested');
    if (!clients?.length) return;
    const today = new Date();
    for (const c of clients) {
      if (!c.investment_date) continue;
      const start = new Date(c.investment_date);
      const milestone = [1,2,3,5,7,10].find(m => {
        const md = new Date(start); md.setFullYear(start.getFullYear()+m);
        return Math.abs(md-today)/86400000 <= 1;
      });
      if (!milestone) continue;
      const name = (c.name||'').replace(/\(.*\)/,'').trim().split(' ')[0];
      const retPct = c.total_invested > 0 ? ((c.total_pnl||0)/c.total_invested*100).toFixed(1) : null;
      await sendPushToAll(`🎂 ${milestone}Y Anniversary: ${name}`, retPct ? `${milestone} years · Total return: +${retPct}% · Send client report!` : `${milestone}-year milestone · Send report`, 'https://uppercrustsaarthi.in', { tag: `anni_${c.name}_${milestone}`, priority: 'high' });
    }
  } catch (err) { console.error('[Cron anniversary]', err.message); }
}, { timezone: 'Asia/Kolkata' });

// ── Weekly digest Monday 9am ──
cron.schedule('0 9 * * 1', async () => {
  try {
    const { data: clients } = await _supabase.from('clients').select('name, total_pnl, total_invested');
    if (!clients?.length) return;
    const sorted = clients.filter(c=>c.total_invested>0).map(c=>({ name:(c.name||'').replace(/\(.*\)/,'').trim().split(' ')[0], pct:(c.total_pnl||0)/c.total_invested*100 })).sort((a,b)=>b.pct-a.pct);
    if (!sorted.length) return;
    const top = sorted[0], bot = sorted[sorted.length-1];
    await sendPushToAll('📈 Weekly Digest — UpperCrust PMS', `Best: ${top.name} +${top.pct.toFixed(1)}% · Review: ${bot.name} ${bot.pct.toFixed(1)}%`, 'https://uppercrustsaarthi.in', { tag: 'weekly_'+new Date().toDateString() });
  } catch (err) { console.error('[Cron weekly]', err.message); }
}, { timezone: 'Asia/Kolkata' });

// ── Cleanup sent notifications 2am daily ──
cron.schedule('0 2 * * *', async () => {
  try {
    const cutoff = new Date(Date.now() - 7*86400000).toISOString();
    await _supabase.from('pending_notifications').delete().eq('sent', true).lt('created_at', cutoff);
  } catch (err) { console.error('[Cron cleanup]', err.message); }
}, { timezone: 'Asia/Kolkata' });

console.log('[Cron] Scheduled: 8:30am, 15:45, 9:00am daily, Monday 9am, 2am cleanup');

// ════════════════════════════════════════════════════════════════
//  KITE LIVE DATA — Zerodha API Integration
// ════════════════════════════════════════════════════════════════
const KITE_API_KEY    = process.env.KITE_API_KEY    || 'bj9g3wng1t91splw';
const KITE_API_SECRET = process.env.KITE_API_SECRET || '08f2h7jfdl50d127dzynuq43a8y5f66e';
const KITE_BASE       = 'https://api.kite.trade';

let _kiteToken = null;
let _kiteTokenExpiry = null;

async function _loadKiteToken() {
  try {
    const { data } = await _supabase.from('app_settings').select('value').eq('key', 'kite_access_token').single();
    if (data?.value) {
      const parsed = JSON.parse(data.value);
      if (parsed.token && parsed.expiry && new Date(parsed.expiry) > new Date()) {
        _kiteToken = parsed.token;
        _kiteTokenExpiry = parsed.expiry;
        console.log('[Kite] Token loaded, expires:', parsed.expiry);
      }
    }
  } catch(e) { /* no token yet */ }
}
_loadKiteToken();

async function _saveKiteToken(token, expiry) {
  _kiteToken = token;
  _kiteTokenExpiry = expiry;
  await _supabase.from('app_settings').upsert({ key: 'kite_access_token', value: JSON.stringify({ token, expiry }), updated_at: new Date().toISOString() });
}

app.get('/api/kite/login-url', (req, res) => {
  res.json({ url: `https://kite.zerodha.com/connect/login?v=3&api_key=${KITE_API_KEY}` });
});

app.get('/api/kite/callback', async (req, res) => {
  const { request_token, status } = req.query;
  if (status !== 'success' || !request_token) return res.redirect('https://uppercrustsaarthi.in?kite_error=1');
  try {
    const crypto = require('crypto');
    const checksum = crypto.createHash('sha256').update(KITE_API_KEY + request_token + KITE_API_SECRET).digest('hex');
    const resp = await fetch(`${KITE_BASE}/session/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Kite-Version': '3' },
      body: new URLSearchParams({ api_key: KITE_API_KEY, request_token, checksum }).toString(),
    });
    const data = await resp.json();
    if (!resp.ok || !data.data?.access_token) { console.error('[Kite callback]', data); return res.redirect('https://uppercrustsaarthi.in?kite_error=2'); }
    const token = data.data.access_token;
    const expiry = new Date(); expiry.setDate(expiry.getDate()+1); expiry.setHours(6,0,0,0);
    await _saveKiteToken(token, expiry.toISOString());
    console.log('[Kite] New token saved, expires:', expiry.toISOString());
    res.redirect('https://uppercrustsaarthi.in?kite_auth=success');
  } catch (err) { console.error('[Kite callback error]', err); res.redirect('https://uppercrustsaarthi.in?kite_error=3'); }
});

async function _kiteGet(path) {
  if (!_kiteToken) return { error: 'not_authenticated' };
  const resp = await fetch(`${KITE_BASE}${path}`, { headers: { 'Authorization': `token ${KITE_API_KEY}:${_kiteToken}`, 'X-Kite-Version': '3' } });
  return resp.json();
}

app.get('/api/kite/status', (req, res) => {
  res.json({ connected: !!_kiteToken && !!_kiteTokenExpiry && new Date(_kiteTokenExpiry) > new Date(), expiry: _kiteTokenExpiry, apiKey: KITE_API_KEY });
});

app.get('/api/kite/quote', async (req, res) => {
  try {
    const { symbols } = req.query;
    if (!symbols) return res.status(400).json({ error: 'symbols required' });
    const data = await _kiteGet(`/quote?i=${symbols.split(',').join('&i=')}`);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/kite/ltp', async (req, res) => {
  try {
    const { symbols } = req.query;
    if (!symbols) return res.status(400).json({ error: 'symbols required' });
    const data = await _kiteGet(`/quote/ltp?i=${symbols.split(',').join('&i=')}`);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/kite/ohlc', async (req, res) => {
  try {
    const { symbols } = req.query;
    if (!symbols) return res.status(400).json({ error: 'symbols required' });
    const data = await _kiteGet(`/quote/ohlc?i=${symbols.split(',').join('&i=')}`);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/kite/historical', async (req, res) => {
  try {
    const { symbol, interval, from, to } = req.query;
    if (!symbol) return res.status(400).json({ error: 'symbol required' });
    const quote = await _kiteGet(`/quote/ltp?i=${symbol}`);
    if (quote.error) return res.status(401).json(quote);
    const token = quote.data?.[symbol]?.instrument_token;
    if (!token) return res.status(404).json({ error: 'instrument not found' });
    const data = await _kiteGet(`/instruments/historical/${token}/${interval||'day'}?from=${from}&to=${to}&continuous=0&oi=0`);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Portfolio live — with NSE/BSE fallback for ETFs ──────────────
const BSE_KEYWORDS = ['BEES','GOLDETF','SILVERBEES','LIQUIDBEES','GOLDBEES','NIFTYBEES','BANKBEES','JUNIORBEES','MON100','CPSEETF','BHARAT22','CPSE','SETFGOLD','SETF'];
function guessExchange(sym) {
  const u = (sym||'').toUpperCase();
  if (BSE_KEYWORDS.some(k => u.includes(k))) return 'BSE';
  return 'NSE';
}

app.post('/api/kite/portfolio-live', async (req, res) => {
  try {
    if (!_kiteToken) return res.json({ error: 'not_authenticated', connected: false });
    const { symbols } = req.body;
    if (!symbols || !symbols.length) return res.status(400).json({ error: 'symbols array required' });

    const kiteSymbols = symbols.map(s => `${s.exchange || guessExchange(s.symbol)}:${s.symbol}`);
    const batches = [];
    for (let i = 0; i < kiteSymbols.length; i += 500) batches.push(kiteSymbols.slice(i, i+500));

    const allData = {};
    for (const batch of batches) {
      const data = await _kiteGet(`/quote/ltp?i=${batch.join('&i=')}`);
      if (data.data) Object.assign(allData, data.data);
    }

    // Retry not-found symbols on the other exchange
    const notFound = symbols.filter(s => !allData[`${s.exchange || guessExchange(s.symbol)}:${s.symbol}`]);
    if (notFound.length) {
      const retrySyms = notFound.map(s => { const orig = s.exchange || guessExchange(s.symbol); return `${orig==='NSE'?'BSE':'NSE'}:${s.symbol}`; });
      const retryData = await _kiteGet(`/quote/ltp?i=${retrySyms.join('&i=')}`);
      if (retryData.data) Object.assign(allData, retryData.data);
    }

    const result = symbols.map(s => {
      const exch = s.exchange || guessExchange(s.symbol);
      const liveQ = allData[`${exch}:${s.symbol}`] || allData[`${exch==='NSE'?'BSE':'NSE'}:${s.symbol}`];
      const ltp = liveQ?.last_price || s.avgCost || 0;
      const mv = ltp * (s.qty||0);
      const cost = (s.avgCost||0) * (s.qty||0);
      return { symbol: s.symbol, qty: s.qty, avgCost: s.avgCost, ltp, marketValue: mv, cost, pnl: mv-cost, pnlPct: cost>0?(mv-cost)/cost:0, live: !!liveQ };
    });

    res.json({
      connected: true, holdings: result,
      summary: { totalLive: result.reduce((s,r)=>s+r.marketValue,0), totalCost: result.reduce((s,r)=>s+r.cost,0), totalPnL: result.reduce((s,r)=>s+r.pnl,0) },
      ts: new Date().toISOString()
    });
  } catch (err) { console.error('[portfolio-live]', err); res.status(500).json({ error: err.message }); }
});

app.get('/api/kite/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ results: [] });
    res.json({ results: [], note: 'Use direct symbol with exchange prefix e.g. NSE:RELIANCE' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── World Indices ──
app.get('/api/world-indices', async (req, res) => {
  try {
    const symbols = ['^GSPC','^IXIC','^DJI','^FTSE','^GDAXI','^N225','^HSI','000001.SS','^VIX'];
    const url = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${symbols.map(s=>encodeURIComponent(s)).join(',')}&range=1d&interval=1d`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) });
    if (!resp.ok) throw new Error('Yahoo Finance error: '+resp.status);
    const data = await resp.json();
    const map = { '^GSPC':{label:'S&P 500',region:'🇺🇸 USA'},'^IXIC':{label:'NASDAQ',region:'🇺🇸 USA'},'^DJI':{label:'Dow Jones',region:'🇺🇸 USA'},'^FTSE':{label:'FTSE 100',region:'🇬🇧 UK'},'^GDAXI':{label:'DAX',region:'🇩🇪 Germany'},'^N225':{label:'Nikkei 225',region:'🇯🇵 Japan'},'^HSI':{label:'Hang Seng',region:'🇭🇰 HK'},'000001.SS':{label:'Shanghai',region:'🇨🇳 China'},'^VIX':{label:'VIX Fear',region:'🌐 Global'} };
    const spark = data?.spark?.result || [];
    const indices = spark.map(item => {
      const info = map[item.symbol]; if (!info) return null;
      const quotes = item.response?.[0]?.indicators?.quote?.[0]?.close || [];
      const prev = quotes[quotes.length-2]||0, curr = quotes[quotes.length-1]||0;
      const chgPct = prev>0?(curr-prev)/prev:0;
      return { label:info.label, region:info.region, val:curr?curr.toLocaleString('en-US',{maximumFractionDigits:0}):'—', raw:curr, chg:curr?(chgPct>=0?'+':'')+(chgPct*100).toFixed(2)+'%':'—', chgPct, live:curr>0 };
    }).filter(Boolean);
    res.json({ indices, source: 'Delayed · Yahoo Finance', ts: new Date().toISOString() });
  } catch (err) {
    console.error('[world-indices]', err.message);
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
