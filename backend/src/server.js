'use strict';
require('dotenv').config();
 
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const path       = require('path');
const webpush    = require('web-push');
const cron       = require('node-cron');
const jwt        = require('jsonwebtoken');
const crypto     = require('crypto');
const { createClient } = require('@supabase/supabase-js');
 
// ─────────────────────────────────────────────
// ENVIRONMENT — all secrets from env only
// ─────────────────────────────────────────────
const JWT_SECRET       = process.env.JWT_SECRET;
const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_SVC_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const KITE_API_KEY     = process.env.KITE_API_KEY;
const KITE_API_SECRET  = process.env.KITE_API_SECRET;
const KITE_BASE        = 'https://api.kite.trade';
const FRONTEND_URL     = process.env.FRONTEND_URL || 'https://uppercrustsaarthi.in';
const ANTHROPIC_KEY    = process.env.ANTHROPIC_API_KEY; // ONLY on server — never sent to browser
 
if (!JWT_SECRET)   throw new Error('JWT_SECRET env variable is required');
if (!SUPABASE_URL) throw new Error('SUPABASE_URL env variable is required');
 
const _supabase = createClient(SUPABASE_URL, SUPABASE_SVC_KEY);
 
// ─────────────────────────────────────────────
// APP
// ─────────────────────────────────────────────
const app = express();
app.set('trust proxy', 1);
 
// ── CORS — locked to your domain only ──
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, curl) only in dev
    // In production: only your domain
    const allowed = [FRONTEND_URL, 'https://uppercrustsaarthi.in'];
    if (!origin || allowed.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  methods:     ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true,
}));
 
// ── Security headers ──
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-origin' },
  contentSecurityPolicy: false,
}));
 
// ── Rate limiters ──
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 500,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests — slow down.' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});
const claudeLimiter = rateLimit({
  windowMs: 60 * 1000, max: 20,
  message: { error: 'AI rate limit — max 20 requests/minute.' },
});
 
app.use(globalLimiter);
app.use((req, res, next) => {
  // Skip JSON parsing for multipart uploads — let multer handle those
  if (req.headers['content-type']?.startsWith('multipart/form-data')) return next();
  express.json({ limit: '50mb' })(req, res, next);
});
app.use((req, res, next) => {
  if (req.headers['content-type']?.startsWith('multipart/form-data')) return next();
  express.urlencoded({ extended: true, limit: '50mb' })(req, res, next);
});
 
// ─────────────────────────────────────────────
// AUTH MIDDLEWARE — every protected route uses this
// ─────────────────────────────────────────────
// In-memory token blacklist (survives until server restart — sufficient for most cases)
// For production: store in Redis or Supabase
const _revokedTokens = new Set();
 
function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const token = header.slice(7);
    // Check blacklist
    if (_revokedTokens.has(token)) {
      return res.status(401).json({ error: 'Session has been revoked. Please log in again.' });
    }
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    req._token = token; // store for logout
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
  }
}
 
// Role guard — usage: requireRole('admin') or requireRole(['admin','manager'])
function requireRole(...roles) {
  const allowed = roles.flat();
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({ error: `Access denied. Required role: ${allowed.join(' or ')}` });
    }
    next();
  };
}
 
// Audit log — fire-and-forget
function audit(userId, action, meta = {}) {
  _supabase.from('audit_log').insert({
    user_id: userId,
    action,
    meta: JSON.stringify(meta),
    ip: meta._ip || null,
    created_at: new Date().toISOString(),
  }).then(() => {}).catch(() => {});
}
 
// ─────────────────────────────────────────────
// HEALTH CHECK (public — no auth)
// ─────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date() }));
 
// ─────────────────────────────────────────────
// AUTH ROUTES — login, logout, me
// ─────────────────────────────────────────────
app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
 
    // Authenticate via Supabase Auth
    const { data: authData, error: authError } = await _supabase.auth.signInWithPassword({
      email: email.toLowerCase().trim(),
      password,
    });
 
    if (authError || !authData?.user) {
      // Generic message — don't reveal whether email exists
      return res.status(401).json({ error: 'Invalid credentials' });
    }
 
    const user = authData.user;
 
    // Fetch role from our users table (managed by admin)
    const { data: profile } = await _supabase
      .from('saarthi_users')
      .select('role, name, active')
      .eq('id', user.id)
      .single();
 
    if (!profile || !profile.active) {
      return res.status(403).json({ error: 'Account not active. Contact your administrator.' });
    }
 
    // Issue our own JWT — short-lived, in-memory on client
    const token = jwt.sign(
      { id: user.id, email: user.email, role: profile.role, name: profile.name },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
 
    audit(user.id, 'LOGIN', { _ip: req.ip, email: user.email });
 
    res.json({
      token,
      user: { id: user.id, email: user.email, role: profile.role, name: profile.name },
      expiresIn: 8 * 3600,
    });
  } catch (err) {
    console.error('[login]', err.message);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});
 
app.post('/api/auth/logout', requireAuth, (req, res) => {
  audit(req.user.id, 'LOGOUT', { _ip: req.ip });
  // Blacklist this token immediately — instant revocation
  if (req._token) {
    _revokedTokens.add(req._token);
    // Clean up expired tokens from blacklist hourly
    setTimeout(() => _revokedTokens.delete(req._token), 8 * 3600 * 1000);
  }
  res.json({ ok: true });
});
 
// ── Admin: revoke any user's sessions ──
app.post('/api/admin/revoke/:userId', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    // Mark user as having sessions revoked (future tokens checked against this)
    await _supabase.from('saarthi_users')
      .update({ sessions_revoked_at: new Date().toISOString() })
      .eq('id', req.params.userId);
    audit(req.user.id, 'SESSION_REVOKE', { target: req.params.userId });
    res.json({ ok: true, message: 'User sessions revoked. They will be logged out within minutes.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});
 
// ─────────────────────────────────────────────
// PROTECTED ROUTE GROUPS
// All routes below require valid JWT
// ─────────────────────────────────────────────
 
// Apply auth middleware globally from here
// (public routes above are already registered)
// Pass service-key supabase to upload route so it bypasses RLS
const uploadRouter = require('./routes/upload');
uploadRouter._supabase = null; // will be set below after _supabase is created
app.use('/api/upload', requireAuth, (req, res, next) => {
  req.supabase = _supabase; // inject service key client
  next();
}, uploadRouter);
app.use('/api/clients',   requireAuth, require('./routes/clients'));
app.use('/api/stocks',    requireAuth, require('./routes/stocks'));
app.use('/api/dashboard', requireAuth, require('./routes/dashboard'));
app.use('/api/risk',      requireAuth, require('./routes/risk'));
app.use('/api/tags',      requireAuth, require('./routes/tags'));
app.use('/api/holdings',  requireAuth, require('./routes/holdings'));
app.use('/api/meta',      requireAuth, require('./routes/meta'));
 
// ── LEVEL 1+2: Compute routes (server-side calculations) ──
try {
  const computeRouter = require('./routes/compute');
  app.use('/api/compute', requireAuth, (req, res, next) => {
    req.supabase = _supabase;
    next();
  }, computeRouter);
  console.log('[Compute] Server-side calculation routes registered');
} catch(e) {
  console.warn('[Compute] routes/compute.js not found — skipping. Upload and deploy compute.js to enable.');
}
 
// FIFO routes
const registerFIFORoutes = require('./routes/fifo');
registerFIFORoutes(app, _supabase, requireAuth);
 
// ─────────────────────────────────────────────
// APP SETTINGS (protected)
// ─────────────────────────────────────────────
app.get('/api/settings/:key', requireAuth, async (req, res) => {
  try {
    const { data, error } = await _supabase
      .from('app_settings').select('value').eq('key', req.params.key).single();
    if (error && error.code !== 'PGRST116') throw error;
    res.json({ value: data?.value || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
app.post('/api/settings/:key', requireAuth, async (req, res) => {
  try {
    const { value } = req.body;
    if (value === undefined) return res.status(400).json({ error: 'Value required' });
    const { error } = await _supabase.from('app_settings').upsert({
      key: req.params.key, value, updated_at: new Date().toISOString()
    });
    if (error) throw error;
    audit(req.user.id, 'SETTINGS_UPDATE', { key: req.params.key });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
// ─────────────────────────────────────────────
// SAARTHI MEMORY (protected)
// ─────────────────────────────────────────────
app.get('/api/memory', requireAuth, async (req, res) => {
  try {
    const { data, error } = await _supabase.from('saarthi_memory')
      .select('*').eq('active', true)
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ memories: data || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
app.post('/api/memory', requireAuth, async (req, res) => {
  try {
    const { memories } = req.body;
    if (!memories?.length) return res.status(400).json({ error: 'Memories array required' });
    const rows = memories.map(m => ({
      category: m.category || 'general', memory: m.memory,
      source: m.source || 'auto', importance: m.importance || 5,
      active: true, created_by: req.user.email,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }));
    const { data, error } = await _supabase.from('saarthi_memory').insert(rows).select();
    if (error) throw error;
    res.json({ ok: true, saved: data.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
app.delete('/api/memory/:id', requireAuth, async (req, res) => {
  try {
    const { error } = await _supabase.from('saarthi_memory')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
app.patch('/api/memory/:id', requireAuth, async (req, res) => {
  try {
    const { importance, memory, active } = req.body;
    const updates = { updated_at: new Date().toISOString() };
    if (importance !== undefined) updates.importance = importance;
    if (memory     !== undefined) updates.memory = memory;
    if (active     !== undefined) updates.active = active;
    const { error } = await _supabase.from('saarthi_memory').update(updates).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
// ─────────────────────────────────────────────
// CLAUDE AI PROXY (protected + server-side key)
// The API key NEVER leaves the server.
// Browser sends the conversation — server adds the key.
// ─────────────────────────────────────────────
app.post('/api/claude', requireAuth, claudeLimiter, async (req, res) => {
  try {
    if (!ANTHROPIC_KEY) return res.status(503).json({ error: { message: 'AI not configured on server' } });
    const { system, messages, model, max_tokens } = req.body;
    if (!messages?.length) return res.status(400).json({ error: { message: 'messages required' } });
 
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       ANTHROPIC_KEY,       // ← key on server only
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      model      || 'claude-haiku-4-5',
        max_tokens: max_tokens || 4096,
        system:     system     || '',
        messages,
      }),
    });
 
    audit(req.user.id, 'CLAUDE_CALL', { model: model || 'claude-haiku-4-5' });
    const data = await response.json();
    res.status(response.ok ? 200 : response.status).json(data);
  } catch (err) { res.status(500).json({ error: { message: err.message } }); }
});
 
app.post('/api/claude/extract-memory', requireAuth, claudeLimiter, async (req, res) => {
  try {
    if (!ANTHROPIC_KEY) return res.json({ memories: [] });
    const { conversation, existing_memories } = req.body;
    const extractPrompt = `You are a memory extraction system for Saarthi PMS AI.\nAnalyze this conversation and extract ONLY genuinely new, important learnings.\nEXISTING MEMORIES (do NOT re-extract):\n${existing_memories || 'None'}\nCONVERSATION:\n${conversation}\nReturn ONLY a JSON array (no other text):\n[{"category":"philosophy|preference|decision|client|market|correction","memory":"exact string","importance":1-10}]\nReturn [] if nothing important. Be selective.`;
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 500, messages: [{ role: 'user', content: extractPrompt }] }),
    });
    const data = await response.json();
    const text = data.content?.[0]?.text || '[]';
    let memories = [];
    try { const m = text.match(/\[[\s\S]*\]/); if (m) memories = JSON.parse(m[0]); } catch (e) {}
    res.json({ memories });
  } catch (err) { res.status(500).json({ memories: [], error: err.message }); }
});
 
// ─────────────────────────────────────────────
// PUSH NOTIFICATIONS (protected writes)
// ─────────────────────────────────────────────
const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_EMAIL       = process.env.VAPID_EMAIL || 'mailto:admin@uppercrustsaarthi.in';
 
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}
 
async function sendPushToAll(title, body, url, opts = {}) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return 0;
  try {
    const { data: subs } = await _supabase.from('push_subscriptions').select('*').eq('active', true);
    if (!subs?.length) return 0;
    const payload = JSON.stringify({ title, body, url: url || FRONTEND_URL, tag: opts.tag || 'saarthi-' + Date.now(), priority: opts.priority || 'normal' });
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
    return sent;
  } catch (err) { console.error('[Push]', err.message); return 0; }
}
 
// VAPID public key is public — OK without auth
app.get('/api/push/vapid-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY || null });
});
 
app.post('/api/push/subscribe', requireAuth, async (req, res) => {
  try {
    const { subscription, device } = req.body;
    if (!subscription?.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
    const { error } = await _supabase.from('push_subscriptions').upsert({
      endpoint: subscription.endpoint, auth: subscription.keys?.auth, p256dh: subscription.keys?.p256dh,
      device: (device || 'unknown').slice(0, 200), user_id: req.user.id,
      active: true, updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' });
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
app.post('/api/push/unsubscribe', requireAuth, async (req, res) => {
  try {
    const { endpoint } = req.body;
    await _supabase.from('push_subscriptions').update({ active: false }).eq('endpoint', endpoint);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
app.post('/api/push/queue', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { cat, title, body, url, priority } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const { error } = await _supabase.from('pending_notifications').insert({
      cat: cat || 'general', title: title.slice(0, 100), body: (body || '').slice(0, 300),
      url: url || FRONTEND_URL, priority: priority || 'normal',
      sent: false, created_at: new Date().toISOString(),
    });
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
// ─────────────────────────────────────────────
// KITE / ZERODHA (protected)
// ─────────────────────────────────────────────
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
      }
    }
  } catch (e) {}
}
_loadKiteToken();
 
async function _saveKiteToken(token, expiry) {
  _kiteToken = token;
  _kiteTokenExpiry = expiry;
  await _supabase.from('app_settings').upsert({
    key: 'kite_access_token',
    value: JSON.stringify({ token, expiry }),
    updated_at: new Date().toISOString(),
  });
}
 
async function _kiteGet(endpoint) {
  if (!_kiteToken) return { error: 'not_authenticated' };
  const resp = await fetch(`${KITE_BASE}${endpoint}`, {
    headers: { 'Authorization': `token ${KITE_API_KEY}:${_kiteToken}`, 'X-Kite-Version': '3' }
  });
  return resp.json();
}
 
// Login URL — public (needed before auth)
app.get('/api/kite/login-url', requireAuth, (req, res) => {
  res.json({ url: `https://kite.zerodha.com/connect/login?v=3&api_key=${KITE_API_KEY}` });
});
 
// Kite OAuth callback — public (Zerodha redirects here)
app.get('/api/kite/callback', async (req, res) => {
  const { request_token, status } = req.query;
  if (status !== 'success' || !request_token) return res.redirect(`${FRONTEND_URL}?kite_error=1`);
  try {
    const checksum = crypto.createHash('sha256')
      .update(KITE_API_KEY + request_token + KITE_API_SECRET).digest('hex');
    const resp = await fetch(`${KITE_BASE}/session/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Kite-Version': '3' },
      body: new URLSearchParams({ api_key: KITE_API_KEY, request_token, checksum }).toString(),
    });
    const data = await resp.json();
    if (!resp.ok || !data.data?.access_token) return res.redirect(`${FRONTEND_URL}?kite_error=2`);
    const expiry = new Date(); expiry.setDate(expiry.getDate() + 1); expiry.setHours(6, 0, 0, 0);
    await _saveKiteToken(data.data.access_token, expiry.toISOString());
    res.redirect(`${FRONTEND_URL}?kite_auth=success`);
  } catch (err) { res.redirect(`${FRONTEND_URL}?kite_error=3`); }
});
 
app.get('/api/kite/status', requireAuth, (req, res) => {
  res.json({
    connected:  !!_kiteToken && !!_kiteTokenExpiry && new Date(_kiteTokenExpiry) > new Date(),
    expiry:     _kiteTokenExpiry,
    apiKey:     KITE_API_KEY,
  });
});
 
app.get('/api/kite/quote',   requireAuth, async (req, res) => {
  try {
    const { symbols } = req.query;
    if (!symbols) return res.status(400).json({ error: 'symbols required' });
    res.json(await _kiteGet(`/quote?i=${symbols.split(',').join('&i=')}`));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
app.get('/api/kite/ltp',     requireAuth, async (req, res) => {
  try {
    const { symbols } = req.query;
    if (!symbols) return res.status(400).json({ error: 'symbols required' });
    res.json(await _kiteGet(`/quote/ltp?i=${symbols.split(',').join('&i=')}`));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
app.get('/api/kite/ohlc',    requireAuth, async (req, res) => {
  try {
    const { symbols } = req.query;
    if (!symbols) return res.status(400).json({ error: 'symbols required' });
    res.json(await _kiteGet(`/quote/ohlc?i=${symbols.split(',').join('&i=')}`));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
app.get('/api/kite/historical', requireAuth, async (req, res) => {
  try {
    const { symbol, interval, from, to } = req.query;
    if (!symbol) return res.status(400).json({ error: 'symbol required' });
    const quote = await _kiteGet(`/quote/ltp?i=${symbol}`);
    if (quote.error) return res.status(401).json(quote);
    const token = quote.data?.[symbol]?.instrument_token;
    if (!token) return res.status(404).json({ error: 'instrument not found' });
    res.json(await _kiteGet(`/instruments/historical/${token}/${interval || 'day'}?from=${from}&to=${to}&continuous=0&oi=0`));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
const BSE_KEYWORDS = ['BEES','GOLDETF','SILVERBEES','LIQUIDBEES','GOLDBEES','NIFTYBEES','BANKBEES','JUNIORBEES','MON100','CPSEETF','BHARAT22','CPSE','SETFGOLD','SETF','ICICILIQ','HDFCLIQ','SBIETF','KOTAKGOLD','AXISGOLD','MAFSETF','ICICIPHD'];
 
app.post('/api/kite/portfolio-live', requireAuth, async (req, res) => {
  try {
    if (!_kiteToken) return res.json({ error: 'not_authenticated', connected: false });
    const { symbols } = req.body;
    if (!symbols?.length) return res.status(400).json({ error: 'symbols array required' });
    const allSyms = [];
    symbols.forEach(s => { allSyms.push(`NSE:${s.symbol}`); allSyms.push(`BSE:${s.symbol}`); });
    const allData = {};
    for (let i = 0; i < allSyms.length; i += 500) {
      const batch = allSyms.slice(i, i + 500);
      try {
        const data = await _kiteGet(`/quote/ltp?i=${batch.join('&i=')}`);
        if (data.data) Object.assign(allData, data.data);
      } catch (e) {}
    }
    const result = symbols.map(s => {
      const nseQ = allData[`NSE:${s.symbol}`];
      const bseQ = allData[`BSE:${s.symbol}`];
      const liveQ = nseQ || bseQ;
      const ltp  = liveQ?.last_price || s.avgCost || 0;
      const mv   = ltp * (s.qty || 0);
      const cost = (s.avgCost || 0) * (s.qty || 0);
      return { symbol: s.symbol, qty: s.qty, avgCost: s.avgCost, ltp, marketValue: mv, cost, pnl: mv - cost, pnlPct: cost > 0 ? (mv - cost) / cost : 0, live: !!liveQ, exchange: nseQ ? 'NSE' : bseQ ? 'BSE' : '—' };
    });
    res.json({ connected: true, holdings: result, summary: { totalLive: result.reduce((s, r) => s + r.marketValue, 0), totalCost: result.reduce((s, r) => s + r.cost, 0), totalPnL: result.reduce((s, r) => s + r.pnl, 0) }, ts: new Date().toISOString() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
// ─────────────────────────────────────────────
// WORLD INDICES (protected)
// ─────────────────────────────────────────────
app.get('/api/world-indices', requireAuth, async (req, res) => {
  try {
    const symbols = ['^GSPC','^IXIC','^DJI','^FTSE','^GDAXI','^N225','^HSI','000001.SS','^VIX'];
    const url = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${symbols.map(s => encodeURIComponent(s)).join(',')}&range=1d&interval=1d`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) });
    if (!resp.ok) throw new Error('Yahoo Finance error: ' + resp.status);
    const data = await resp.json();
    const map = { '^GSPC': { label: 'S&P 500', region: '🇺🇸 USA' }, '^IXIC': { label: 'NASDAQ', region: '🇺🇸 USA' }, '^DJI': { label: 'Dow Jones', region: '🇺🇸 USA' }, '^FTSE': { label: 'FTSE 100', region: '🇬🇧 UK' }, '^GDAXI': { label: 'DAX', region: '🇩🇪 Germany' }, '^N225': { label: 'Nikkei 225', region: '🇯🇵 Japan' }, '^HSI': { label: 'Hang Seng', region: '🇭🇰 HK' }, '000001.SS': { label: 'Shanghai', region: '🇨🇳 China' }, '^VIX': { label: 'VIX Fear', region: '🌐 Global' } };
    const spark = data?.spark?.result || [];
    const indices = spark.map(item => {
      const info = map[item.symbol]; if (!info) return null;
      const quotes = item.response?.[0]?.indicators?.quote?.[0]?.close || [];
      const prev = quotes[quotes.length - 2] || 0, curr = quotes[quotes.length - 1] || 0;
      const chgPct = prev > 0 ? (curr - prev) / prev : 0;
      return { label: info.label, region: info.region, val: curr ? curr.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—', raw: curr, chg: curr ? (chgPct >= 0 ? '+' : '') + (chgPct * 100).toFixed(2) + '%' : '—', chgPct, live: curr > 0 };
    }).filter(Boolean);
    res.json({ indices, source: 'Delayed · Yahoo Finance', ts: new Date().toISOString() });
  } catch (err) {
    res.json({ indices: [], source: 'Unavailable', error: err.message });
  }
});
 
// ─────────────────────────────────────────────
// USER MANAGEMENT (admin only)
// ─────────────────────────────────────────────
app.get('/api/admin/users', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { data, error } = await _supabase.from('saarthi_users').select('id, email, name, role, active, created_at');
    if (error) throw error;
    res.json({ users: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
app.post('/api/admin/users', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { email, name, role, password } = req.body;
    if (!email || !name || !role || !password) return res.status(400).json({ error: 'email, name, role, password required' });
    if (!['admin', 'manager', 'viewer'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
 
    // Create in Supabase Auth
    const { data: authUser, error: authErr } = await _supabase.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (authErr) throw authErr;
 
    // Insert profile
    const { error: profErr } = await _supabase.from('saarthi_users').insert({
      id: authUser.user.id, email, name, role, active: true,
      created_at: new Date().toISOString(),
    });
    if (profErr) throw profErr;
 
    audit(req.user.id, 'USER_CREATED', { email, role });
    res.json({ ok: true, id: authUser.user.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
app.patch('/api/admin/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { role, active, name } = req.body;
    const updates = { updated_at: new Date().toISOString() };
    if (role   !== undefined) updates.role   = role;
    if (active !== undefined) updates.active = active;
    if (name   !== undefined) updates.name   = name;
    const { error } = await _supabase.from('saarthi_users').update(updates).eq('id', req.params.id);
    if (error) throw error;
    audit(req.user.id, 'USER_UPDATED', { target: req.params.id, updates });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
// ─────────────────────────────────────────────
// AUDIT LOG (admin only)
// ─────────────────────────────────────────────
app.get('/api/admin/audit', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { data, error } = await _supabase.from('audit_log')
      .select('*').order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    res.json({ logs: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
// ─────────────────────────────────────────────
// PWA / SERVICE WORKER (public)
// ─────────────────────────────────────────────
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, 'sw.js'));
});
 
app.get('/manifest.json', (req, res) => {
  res.json({
    name: 'Saarthi PMS', short_name: 'Saarthi',
    description: 'UpperCrust Wealth PMS Terminal',
    start_url: '/', display: 'standalone',
    background_color: '#0e0c07', theme_color: '#8a6814',
    icons: [
      { src: '/favicon.ico', sizes: '192x192', type: 'image/png' },
      { src: '/favicon.ico', sizes: '512x512', type: 'image/png' },
    ],
  });
});
 
// ─────────────────────────────────────────────
// CRON JOBS
// ─────────────────────────────────────────────
cron.schedule('* * * * *', async () => {
  if (!VAPID_PUBLIC_KEY) return;
  try {
    const { data: pending } = await _supabase.from('pending_notifications')
      .select('*').eq('sent', false).order('created_at', { ascending: true }).limit(20);
    if (!pending?.length) return;
    for (const n of pending) {
      const sent = await sendPushToAll(n.title, n.body || '', n.url, { tag: (n.cat || 'g') + '_' + n.id, priority: n.priority });
      await _supabase.from('pending_notifications').update({ sent: true, sent_at: new Date().toISOString(), sent_to: sent }).eq('id', n.id);
    }
  } catch (err) { console.error('[Cron queue]', err.message); }
});
 
cron.schedule('30 8 * * 1-5', async () => {
  try {
    const { data: clients } = await _supabase.from('clients').select('name, total_pnl, total_invested');
    if (!clients?.length) return;
    const aum = clients.reduce((s, c) => s + (c.total_invested || 0) + (c.total_pnl || 0), 0);
    const winners = clients.filter(c => (c.total_pnl || 0) > 0).length;
    await sendPushToAll('🌅 Good Morning — UpperCrust PMS', `AUM: ₹${(aum / 10000000).toFixed(2)}Cr · ${winners}/${clients.length} clients in profit`, FRONTEND_URL, { tag: 'morning_' + new Date().toDateString() });
  } catch (err) { console.error('[Cron morning]', err.message); }
}, { timezone: 'Asia/Kolkata' });
 
cron.schedule('45 15 * * 1-5', async () => {
  try {
    const { data: clients } = await _supabase.from('clients').select('total_pnl, total_invested');
    if (!clients?.length) return;
    const pnl = clients.reduce((s, c) => s + (c.total_pnl || 0), 0);
    const inv = clients.reduce((s, c) => s + (c.total_invested || 0), 0);
    const sign = pnl >= 0 ? '+' : '';
    await sendPushToAll('📊 Pre-Close — UpperCrust PMS', `P&L: ${sign}₹${(Math.abs(pnl) / 100000).toFixed(1)}L (${sign}${inv > 0 ? (pnl / inv * 100).toFixed(2) : 0}%)`, FRONTEND_URL, { tag: 'evening_' + new Date().toDateString() });
  } catch (err) { console.error('[Cron evening]', err.message); }
}, { timezone: 'Asia/Kolkata' });
 
cron.schedule('0 9 * * *', async () => {
  try {
    const { data: clients } = await _supabase.from('clients').select('name, investment_date, total_pnl, total_invested');
    if (!clients?.length) return;
    const today = new Date();
    for (const c of clients) {
      if (!c.investment_date) continue;
      const start = new Date(c.investment_date);
      const milestone = [1, 2, 3, 5, 7, 10].find(m => { const md = new Date(start); md.setFullYear(start.getFullYear() + m); return Math.abs(md - today) / 86400000 <= 1; });
      if (!milestone) continue;
      const name = (c.name || '').replace(/\(.*\)/, '').trim().split(' ')[0];
      const retPct = c.total_invested > 0 ? ((c.total_pnl || 0) / c.total_invested * 100).toFixed(1) : null;
      await sendPushToAll(`🎂 ${milestone}Y Anniversary: ${name}`, retPct ? `${milestone} years · Return: +${retPct}%` : `${milestone}-year milestone`, FRONTEND_URL, { tag: `anni_${c.name}_${milestone}`, priority: 'high' });
    }
  } catch (err) { console.error('[Cron anniversary]', err.message); }
}, { timezone: 'Asia/Kolkata' });
 
cron.schedule('0 9 * * 1', async () => {
  try {
    const { data: clients } = await _supabase.from('clients').select('name, total_pnl, total_invested');
    if (!clients?.length) return;
    const sorted = clients.filter(c => c.total_invested > 0).map(c => ({ name: (c.name || '').replace(/\(.*\)/, '').trim().split(' ')[0], pct: (c.total_pnl || 0) / c.total_invested * 100 })).sort((a, b) => b.pct - a.pct);
    if (!sorted.length) return;
    const top = sorted[0], bot = sorted[sorted.length - 1];
    await sendPushToAll('📈 Weekly Digest — UpperCrust PMS', `Best: ${top.name} +${top.pct.toFixed(1)}% · Review: ${bot.name} ${bot.pct.toFixed(1)}%`, FRONTEND_URL, { tag: 'weekly_' + new Date().toDateString() });
  } catch (err) { console.error('[Cron weekly]', err.message); }
}, { timezone: 'Asia/Kolkata' });
 
cron.schedule('0 2 * * *', async () => {
  try {
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
    await _supabase.from('pending_notifications').delete().eq('sent', true).lt('created_at', cutoff);
    await _supabase.from('audit_log').delete().lt('created_at', new Date(Date.now() - 90 * 86400000).toISOString());
  } catch (err) { console.error('[Cron cleanup]', err.message); }
}, { timezone: 'Asia/Kolkata' });
 
// ─────────────────────────────────────────────
// ERROR HANDLERS
// ─────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});
 
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Saarthi backend secured on :${PORT}`));
module.exports = app;
