'use strict';
require('dotenv').config();
 
// Global safety nets — without these, an async error not wrapped in try/catch
// (or thrown outside any request handler) can crash the process with no clear log.
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason && reason.stack || reason);
});
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err && err.stack || err);
  // Process state may be corrupted after a truly uncaught exception — exit so
  // Railway restarts us cleanly rather than continuing in an unknown state.
  process.exit(1);
});
 
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
const { validate } = require('./validation/validate');
const schemas = require('./validation/schemas');
 
const JWT_SECRET       = process.env.JWT_SECRET;
const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_SVC_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
if (!process.env.SUPABASE_SERVICE_KEY) {
  console.error('⚠️  SUPABASE_SERVICE_KEY not set — falling back to anon key. RLS will block writes!');
  console.error('   Set SUPABASE_SERVICE_KEY in Railway environment variables.');
}
const KITE_API_KEY     = process.env.KITE_API_KEY;
const KITE_API_SECRET  = process.env.KITE_API_SECRET;
const KITE_BASE        = 'https://api.kite.trade';
const FRONTEND_URL     = process.env.FRONTEND_URL || 'https://uppercrustsaarthi.in';
const ANTHROPIC_KEY    = process.env.ANTHROPIC_API_KEY;
 
if (!JWT_SECRET)   throw new Error('JWT_SECRET env variable is required');
if (!SUPABASE_URL) throw new Error('SUPABASE_URL env variable is required');
 
const ws = require('ws');
const _supabase = createClient(SUPABASE_URL, SUPABASE_SVC_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { headers: { 'x-supabase-role': 'service_role' } },
  realtime: { transport: ws }
});
global._supabase = _supabase;
 
const _origCreateClient = require('@supabase/supabase-js').createClient;
require('@supabase/supabase-js').createClient = function(url, key, opts) {
  return _origCreateClient(url, SUPABASE_SVC_KEY, opts);
};
 
const app = express();
app.set('trust proxy', 1);
 
app.use(function(req, res, next) {
  req.supabase = _supabase;
  req.sb = _supabase;
  next();
});
 
app.use(cors({
  origin: (origin, cb) => {
    const allowed = [FRONTEND_URL, 'https://uppercrustsaarthi.in'];
    if (!origin || allowed.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  methods:     ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true,
}));
 
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-origin' },
  contentSecurityPolicy: false,
}));
 
const globalLimiter = rateLimit({ windowMs: 15*60*1000, max: 500, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests — slow down.' } });
const authLimiter   = rateLimit({ windowMs: 15*60*1000, max: 10,  message: { error: 'Too many login attempts. Try again in 15 minutes.' } });
const claudeLimiter = rateLimit({ windowMs: 60*1000,    max: 20,  message: { error: 'AI rate limit — max 20 requests/minute.' } });
 
app.use(globalLimiter);
app.use((req, res, next) => { if (req.headers['content-type']?.startsWith('multipart/form-data')) return next(); express.json({ limit: '50mb' })(req, res, next); });
app.use((req, res, next) => { if (req.headers['content-type']?.startsWith('multipart/form-data')) return next(); express.urlencoded({ extended: true, limit: '50mb' })(req, res, next); });
 
const _revokedTokens = new Set();
 
// Caches sessions_revoked_at per user (DB-backed, so admin-revoked sessions
// stay revoked across server restarts — unlike _revokedTokens above, which
// only covers single-device logout and is intentionally in-memory only).
const _revokedAtCache = new Map(); // userId -> { revokedAt, fetchedAt }
const REVOKED_CACHE_TTL_MS = 30 * 1000;
 
async function getSessionsRevokedAt(userId) {
  const cached = _revokedAtCache.get(userId);
  const now = Date.now();
  if (cached && (now - cached.fetchedAt) < REVOKED_CACHE_TTL_MS) return cached.revokedAt;
  const { data, error } = await _supabase.from('saarthi_users').select('sessions_revoked_at').eq('id', userId).single();
  const revokedAt = (!error && data) ? data.sessions_revoked_at : null;
  _revokedAtCache.set(userId, { revokedAt, fetchedAt: now });
  return revokedAt;
}
 
// Persistent per-token (single-device) logout, backed by the revoked_tokens
// table and keyed on the JWT's own `jti` claim — survives server restarts,
// unlike _revokedTokens above which is still kept as a same-process,
// zero-latency fast path (write-through on logout, see /api/auth/logout).
const _jtiRevokedCache = new Map(); // jti -> { revoked, fetchedAt }
const JTI_CACHE_TTL_MS = 60 * 1000;
 
async function isTokenRevoked(jti) {
  // Backward compatibility: tokens issued before this rollout have no jti.
  // They simply can't be checked against this table — they still get the
  // existing in-memory _revokedTokens check and the sessions_revoked_at
  // check, just not per-token DB persistence, until they naturally expire.
  if (!jti) return false;
  const cached = _jtiRevokedCache.get(jti);
  const now = Date.now();
  if (cached && (now - cached.fetchedAt) < JTI_CACHE_TTL_MS) return cached.revoked;
  const { data, error } = await _supabase.from('revoked_tokens').select('jti').eq('jti', jti).maybeSingle();
  // Fail-open on a DB error (per approved failure-mode design): the JWT
  // signature and expiry have already passed, so a transient DB issue here
  // must not lock out the whole team over a single unreachable lookup.
  const revoked = !error && !!data;
  _jtiRevokedCache.set(jti, { revoked, fetchedAt: now });
  return revoked;
}
 
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });
    const token = header.slice(7);
    if (_revokedTokens.has(token)) return res.status(401).json({ error: 'Session has been revoked. Please log in again.' });
    const payload = jwt.verify(token, JWT_SECRET);
    if (await isTokenRevoked(payload.jti)) {
      return res.status(401).json({ error: 'Session has been revoked. Please log in again.' });
    }
    const revokedAt = await getSessionsRevokedAt(payload.id);
    if (revokedAt && payload.iat * 1000 < new Date(revokedAt).getTime()) {
      return res.status(401).json({ error: 'Session has been revoked. Please log in again.' });
    }
    req.user = payload;
    req._token = token;
    next();
  } catch (err) { return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' }); }
}
 
function requireRole(...roles) {
  const allowed = roles.flat();
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!allowed.includes(req.user.role)) return res.status(403).json({ error: `Access denied. Required role: ${allowed.join(' or ')}` });
    next();
  };
}
 
function audit(userId, action, meta = {}) {
  _supabase.from('audit_log').insert({ user_id: userId, action, meta: JSON.stringify(meta), ip: meta._ip || null, created_at: new Date().toISOString() }).then(() => {}).catch(() => {});
}
 
// Logs the full error server-side (message + stack) and returns a generic,
// safe message for the client response — never leaks internal error detail.
function safeError(err, context) {
  console.error(`[ERROR]${context ? ' [' + context + ']' : ''}`, err && err.stack || err);
  return 'Something went wrong. Please try again.';
}
 
function injectSupabase(req, res, next) { req.supabase = _supabase; next(); }
 
app.get('/health', async (req, res) => {
  try {
    const { error } = await _supabase.from('app_settings').select('key').limit(1);
    if (error) throw error;
    res.json({ status: 'ok', db: 'connected', ts: new Date() });
  } catch (err) {
    console.error('[Health] Database check failed:', err && err.stack || err);
    res.status(503).json({ status: 'degraded', db: 'unreachable', ts: new Date() });
  }
});
 
app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const { data: authData, error: authError } = await _supabase.auth.signInWithPassword({ email: email.toLowerCase().trim(), password });
    if (authError || !authData?.user) return res.status(401).json({ error: 'Invalid credentials' });
    const user = authData.user;
    const { data: profile } = await _supabase.from('saarthi_users').select('role, name, active').eq('id', user.id).single();
    if (!profile || !profile.active) return res.status(403).json({ error: 'Account not active. Contact your administrator.' });
    const token = jwt.sign({ id: user.id, email: user.email, role: profile.role, name: profile.name, jti: crypto.randomUUID() }, JWT_SECRET, { expiresIn: '8h' });
    audit(user.id, 'LOGIN', { _ip: req.ip, email: user.email });
    res.json({ token, user: { id: user.id, email: user.email, role: profile.role, name: profile.name }, expiresIn: 8 * 3600 });
  } catch (err) { console.error('[login]', err.message); res.status(500).json({ error: 'Login failed. Please try again.' }); }
});
 
app.post('/api/auth/logout', requireAuth, async (req, res) => {
  audit(req.user.id, 'LOGOUT', { _ip: req.ip });
  // Same-process immediate fast path — unchanged from before.
  if (req._token) { _revokedTokens.add(req._token); setTimeout(() => _revokedTokens.delete(req._token), 8 * 3600 * 1000); }
  // Persistent, per-device revocation — survives restarts. Only possible for
  // tokens that have a jti (i.e. issued after this feature's rollout); older
  // tokens still in circulation fall back to the in-memory check above until
  // they naturally expire (max 8h), per the approved backward-compat design.
  if (req.user.jti) {
    const expiresAt = req.user.exp ? new Date(req.user.exp * 1000).toISOString() : new Date(Date.now() + 8 * 3600 * 1000).toISOString();
    _jtiRevokedCache.set(req.user.jti, { revoked: true, fetchedAt: Date.now() }); // write-through, immediate within this process
    const { error } = await _supabase.from('revoked_tokens').insert({ jti: req.user.jti, user_id: req.user.id, expires_at: expiresAt, reason: 'logout' });
    if (error) console.error('[logout] Failed to persist revocation:', error.message || error);
  }
  res.json({ ok: true });
});
 
app.post('/api/admin/revoke/:userId', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await _supabase.from('saarthi_users').update({ sessions_revoked_at: new Date().toISOString() }).eq('id', req.params.userId);
    audit(req.user.id, 'SESSION_REVOKE', { target: req.params.userId });
    res.json({ ok: true, message: 'User sessions revoked.' });
  } catch (err) { res.status(500).json({ error: safeError(err, 'admin_revoke') }); }
});
 
app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));
 
const uploadRouter = require('./routes/upload');
uploadRouter._supabase = null;
app.use('/api/upload', requireAuth, requireRole('admin'), (req, res, next) => { req.supabase = _supabase; next(); }, uploadRouter);
 
app.use('/api/clients',   requireAuth, injectSupabase, require('./routes/clients'));
app.use('/api/stocks',    requireAuth, injectSupabase, require('./routes/stocks'));
app.use('/api/dashboard', requireAuth, injectSupabase, require('./routes/dashboard'));
app.use('/api/risk',      requireAuth, injectSupabase, require('./routes/risk'));
app.use('/api/tags',      requireAuth, injectSupabase, require('./routes/tags'));
app.use('/api/holdings',  requireAuth, injectSupabase, require('./routes/holdings'));
app.use('/api/meta',      requireAuth, injectSupabase, require('./routes/meta'));
 
try {
  const computeRouter = require('./routes/compute');
  app.use('/api/compute', requireAuth, (req, res, next) => { req.supabase = _supabase; next(); }, computeRouter);
  console.log('[Compute] Server-side calculation routes registered');
} catch(e) { console.warn('[Compute] routes/compute.js not found — skipping.'); }
 
const registerFIFORoutes = require('./routes/fifo');
registerFIFORoutes(app, _supabase, requireAuth, requireRole);
 
// ─────────────────────────────────────────────
// ✦ ASTROQUANT ROUTES
// ─────────────────────────────────────────────
app.use('/api/astro', requireAuth, injectSupabase, require('./routes/astro'));
console.log('[AstroQuant] Routes registered');
 
// ─────────────────────────────────────────────
// ⚡ SAARTHI PULSE ROUTES
// ─────────────────────────────────────────────
app.use('/api/pulse', requireAuth, injectSupabase, require('./routes/pulse'));
app.use('/api/regime', requireAuth, require('./routes/regime'));
app.use('/api/tech-indicators', requireAuth, (req,res,next)=>{req.supabase=_supabase;req._kiteGet=_kiteGet;next();}, require('./routes/techIndicators'));
console.log('[Pulse] Routes registered');
 
// AstroQuant crons
if (process.env.ASTRO_BACKFILL_DONE === 'true') {
  require('./crons/dailyPlanetCron');
  require('./crons/sectorScoreCron');
  require('./crons/alertCron');
  console.log('[AstroQuant] Crons registered (backfill complete)');
} else {
  console.log('[AstroQuant] Crons SKIPPED — set ASTRO_BACKFILL_DONE=true after running backfill script');
}
 
app.post('/api/fifo/save-cache', requireAuth, requireRole('admin', 'manager'), validate(schemas.fifoSaveCacheSchema), async (req, res) => {
  try {
    const { cache, status } = req.body;
    if (!cache || typeof cache !== 'object') return res.status(400).json({ error: 'cache required' });
    const clients = Object.entries(cache);
    let saved = 0;
    for (const [clientName, data] of clients) {
      const { error } = await _supabase.from('fifo_lots').upsert({ client_name: clientName, lots: JSON.stringify(data.lots || {}), realized: JSON.stringify(data.realized || []), txn_count: data.txnCount || 0, raw_txns: JSON.stringify(data._rawTxns || []), updated_at: new Date().toISOString() }, { onConflict: 'client_name' });
      if (!error) saved++;
    }
    if (status) await _supabase.from('app_settings').upsert({ key: 'fifo_status', value: JSON.stringify(status) }, { onConflict: 'key' });
    res.json({ ok: true, saved, total: clients.length });
  } catch (err) { res.status(500).json({ error: safeError(err, 'fifo_save_cache') }); }
});
 
// Settings key access tiers, per approved Authorization Matrix.
// ADMIN_ONLY: read + write restricted to admin (credentials / core client financial truth data).
// MANAGER_PLUS: read + write restricted to manager or admin (policy / compliance-adjacent config).
// MANAGER_WRITE: read open to any logged-in user; write restricted to manager or admin (shared market-data caches).
// Anything not listed (e.g. upload_meta) remains open read+write to any logged-in user, unchanged.
const ADMIN_ONLY_SETTINGS_KEYS = new Set(['claude_api_key']); // nav_cashflows + trade_history: read=all, write=admin
const MANAGER_PLUS_SETTINGS_KEYS = new Set(['insider_map']); // exceptional_clients write stays manager+, but read is now open
const MANAGER_WRITE_SETTINGS_KEY_PREFIXES = ['corp_actions', 'gsec_data', 'n500_data', 'screener_data', 'regime_cache', 'pe_snapshot_', 'family_groups', 'custom_filters', 'call_log', 'custom_stocks', 'trade_groups', 'price_alerts', 'catd', 'client_invest', 'fl_cfg', 'fii_data', 'stock_limits'];
 
function isManagerWriteKey(key) {
  return MANAGER_WRITE_SETTINGS_KEY_PREFIXES.some(prefix => key === prefix || key.startsWith(prefix));
}
 
function settingsAccessDenied(key, role, forWrite) {
  if (ADMIN_ONLY_SETTINGS_KEYS.has(key)) return role !== 'admin';
  if (key === 'exceptional_clients') return forWrite ? (role !== 'admin' && role !== 'manager') : false;
  if (key === 'nav_cashflows' || key === 'trade_history') return forWrite ? role !== 'admin' : false; // read=all, write=admin only
  if (MANAGER_PLUS_SETTINGS_KEYS.has(key)) return role !== 'admin' && role !== 'manager';
  if (forWrite && isManagerWriteKey(key)) return role !== 'admin' && role !== 'manager';
  return false;
}
 
app.get('/api/settings/:key', requireAuth, async (req, res) => {
  try {
    if (settingsAccessDenied(req.params.key, req.user.role, false)) {
      return res.status(403).json({ error: 'Access denied for this settings key.' });
    }
    const { data, error } = await _supabase.from('app_settings').select('value').eq('key', req.params.key).single();
    if (error && error.code !== 'PGRST116') throw error;
    res.json({ value: data?.value ?? null });
  } catch (err) { res.status(500).json({ error: safeError(err, 'settings_get') }); }
});
 
app.post('/api/settings/:key', requireAuth, validate(schemas.settingsKeyParamSchema, 'params'), validate(schemas.settingsValueBodySchema), async (req, res) => {
  try {
    if (settingsAccessDenied(req.params.key, req.user.role, true)) {
      return res.status(403).json({ error: 'Access denied for this settings key.' });
    }
    const { value } = req.body;
    if (value === undefined) return res.status(400).json({ error: 'Value required' });
    const sb = global._supabase || _supabase;
    const key = req.params.key;
    const { error: rpcErr } = await sb.rpc('upsert_app_setting', { p_key: key, p_value: value });
    if (rpcErr) {
      const { error: upErr } = await sb.from('app_settings').update({ value, updated_at: new Date().toISOString() }).eq('key', key);
      if (upErr) {
        const { error: inErr } = await sb.from('app_settings').insert({ key, value, updated_at: new Date().toISOString() });
        if (inErr) { console.error('[Settings] all writes failed:', inErr.message, 'key:', key); throw inErr; }
      }
    }
    audit(req.user.id, 'SETTINGS_UPDATE', { key });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: safeError(err, 'settings_post') }); }
});
 
app.get('/api/meta/:key', requireAuth, async (req, res) => {
  try {
    const { data, error } = await _supabase.from('app_settings').select('value').eq('key', req.params.key).single();
    if (error && error.code !== 'PGRST116') throw error;
    res.json({ value: data?.value ?? null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
app.post('/api/meta/:key', requireAuth, async (req, res) => {
  try {
    const { value } = req.body;
    if (value === undefined) return res.status(400).json({ error: 'Value required' });
    const sb = global._supabase || _supabase;
    const { data: existing } = await sb.from('app_settings').select('key').eq('key', req.params.key).single();
    let error;
    if (existing) { ({ error } = await sb.from('app_settings').update({ value, updated_at: new Date().toISOString() }).eq('key', req.params.key)); }
    else { ({ error } = await sb.from('app_settings').insert({ key: req.params.key, value, updated_at: new Date().toISOString() })); }
    if (error) { console.error('[Settings] write error:', error.message, 'key:', req.params.key); throw error; }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
app.get('/api/memory', requireAuth, async (req, res) => {
  try {
    const { data, error } = await _supabase.from('saarthi_memory').select('*').eq('active', true).order('importance', { ascending: false }).order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ memories: data || [] });
  } catch (err) { res.status(500).json({ error: safeError(err, 'memory_get') }); }
});
 
app.post('/api/memory', requireAuth, validate(schemas.memoryCreateSchema), async (req, res) => {
  try {
    const { memories } = req.body;
    if (!memories?.length) return res.status(400).json({ error: 'Memories array required' });
    const rows = memories.map(m => ({ category: m.category || 'general', memory: m.memory, source: m.source || 'auto', importance: m.importance || 5, active: true, created_by: req.user.email, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }));
    const { data, error } = await _supabase.from('saarthi_memory').insert(rows).select();
    if (error) throw error;
    res.json({ ok: true, saved: data.length });
  } catch (err) { res.status(500).json({ error: safeError(err, 'memory_post') }); }
});
 
app.delete('/api/memory/:id', requireAuth, validate(schemas.memoryIdParamSchema, 'params'), async (req, res) => {
  try {
    const { data: existing, error: fetchErr } = await _supabase.from('saarthi_memory').select('created_by').eq('id', req.params.id).single();
    if (fetchErr) throw fetchErr;
    if (!existing) return res.status(404).json({ error: 'Memory not found' });
    if (existing.created_by !== req.user.email && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You can only delete your own memories.' });
    }
    const { error } = await _supabase.from('saarthi_memory').update({ active: false, updated_at: new Date().toISOString() }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: safeError(err, 'memory_delete') }); }
});
 
app.patch('/api/memory/:id', requireAuth, validate(schemas.memoryIdParamSchema, 'params'), validate(schemas.memoryUpdateSchema), async (req, res) => {
  try {
    const { data: existing, error: fetchErr } = await _supabase.from('saarthi_memory').select('created_by').eq('id', req.params.id).single();
    if (fetchErr) throw fetchErr;
    if (!existing) return res.status(404).json({ error: 'Memory not found' });
    if (existing.created_by !== req.user.email && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You can only edit your own memories.' });
    }
    const { importance, memory, active } = req.body;
    const updates = { updated_at: new Date().toISOString() };
    if (importance !== undefined) updates.importance = importance;
    if (memory     !== undefined) updates.memory = memory;
    if (active     !== undefined) updates.active = active;
    const { error } = await _supabase.from('saarthi_memory').update(updates).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: safeError(err, 'memory_patch') }); }
});
 
app.post('/api/claude', requireAuth, claudeLimiter, validate(schemas.claudeChatSchema), async (req, res) => {
  try {
    if (!ANTHROPIC_KEY) return res.status(503).json({ error: { message: 'AI not configured on server' } });
    const { system, messages, model, max_tokens } = req.body;
    if (!messages?.length) return res.status(400).json({ error: { message: 'messages required' } });
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: model || 'claude-haiku-4-5', max_tokens: max_tokens || 4096, system: system || '', messages }),
    });
    audit(req.user.id, 'CLAUDE_CALL', { model: model || 'claude-haiku-4-5' });
    const data = await response.json();
    res.status(response.ok ? 200 : response.status).json(data);
  } catch (err) { res.status(500).json({ error: { message: safeError(err, 'claude') } }); }
});
 
app.post('/api/claude/extract-memory', requireAuth, claudeLimiter, validate(schemas.claudeExtractMemorySchema), async (req, res) => {
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
  } catch (err) { res.status(500).json({ memories: [], error: safeError(err, 'claude_extract_memory') }); }
});
 
const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_EMAIL       = process.env.VAPID_EMAIL || 'mailto:admin@uppercrustsaarthi.in';
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) { webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY); }
 
async function sendPushToAll(title, body, url, opts = {}) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return 0;
  try {
    const { data: subs } = await _supabase.from('push_subscriptions').select('*').eq('active', true);
    if (!subs?.length) return 0;
    const payload = JSON.stringify({ title, body, url: url || FRONTEND_URL, tag: opts.tag || 'saarthi-' + Date.now(), priority: opts.priority || 'normal' });
    let sent = 0;
    const results = await Promise.allSettled(subs.map(sub => webpush.sendNotification({ endpoint: sub.endpoint, keys: { auth: sub.auth, p256dh: sub.p256dh } }, payload, { TTL: 3600 })));
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') { sent++; }
      else if ([404, 410].includes(r.reason?.statusCode)) { _supabase.from('push_subscriptions').update({ active: false }).eq('endpoint', subs[i].endpoint); }
    });
    return sent;
  } catch (err) { console.error('[Push]', err.message); return 0; }
}
 
app.get('/api/push/vapid-key', (req, res) => res.json({ publicKey: VAPID_PUBLIC_KEY || null }));
 
app.post('/api/push/subscribe', requireAuth, validate(schemas.pushSubscribeSchema), async (req, res) => {
  try {
    const { subscription, device } = req.body;
    if (!subscription?.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
    const { error } = await _supabase.from('push_subscriptions').upsert({ endpoint: subscription.endpoint, auth: subscription.keys?.auth, p256dh: subscription.keys?.p256dh, device: (device || 'unknown').slice(0, 200), user_id: req.user.id, active: true, updated_at: new Date().toISOString() }, { onConflict: 'endpoint' });
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: safeError(err, 'push_subscribe') }); }
});
 
app.post('/api/push/unsubscribe', requireAuth, validate(schemas.pushUnsubscribeSchema), async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
    const { data: sub, error: fetchErr } = await _supabase.from('push_subscriptions').select('user_id').eq('endpoint', endpoint).single();
    if (fetchErr && fetchErr.code !== 'PGRST116') throw fetchErr;
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });
    if (sub.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You can only unsubscribe your own devices.' });
    }
    const { error } = await _supabase.from('push_subscriptions').update({ active: false }).eq('endpoint', endpoint);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: safeError(err, 'push_unsubscribe') }); }
});
 
app.post('/api/push/queue', requireAuth, requireRole('admin', 'manager'), validate(schemas.pushQueueSchema), async (req, res) => {
  try {
    const { cat, title, body, url, priority } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const { error } = await _supabase.from('pending_notifications').insert({ cat: cat || 'general', title: title.slice(0, 100), body: (body || '').slice(0, 300), url: url || FRONTEND_URL, priority: priority || 'normal', sent: false, created_at: new Date().toISOString() });
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: safeError(err, 'push_queue') }); }
});
 
let _kiteToken = null;
let _kiteTokenExpiry = null;
 
async function _loadKiteToken() {
  try {
    const { data } = await _supabase.from('app_settings').select('value').eq('key', 'kite_access_token').single();
    if (data?.value) {
      const parsed = JSON.parse(data.value);
      if (parsed.token && parsed.expiry && new Date(parsed.expiry) > new Date()) { _kiteToken = parsed.token; _kiteTokenExpiry = parsed.expiry; }
    }
  } catch (e) {}
}
_loadKiteToken();
 
async function _saveKiteToken(token, expiry) {
  _kiteToken = token; _kiteTokenExpiry = expiry;
  await _supabase.from('app_settings').upsert({ key: 'kite_access_token', value: JSON.stringify({ token, expiry }), updated_at: new Date().toISOString() });
}
 
async function _kiteGet(endpoint) {
  if (!_kiteToken) return { error: 'not_authenticated' };
  const resp = await fetch(`${KITE_BASE}${endpoint}`, { headers: { 'Authorization': `token ${KITE_API_KEY}:${_kiteToken}`, 'X-Kite-Version': '3' } });
  return resp.json();
}
 
app.get('/api/kite/login-url', requireAuth, (req, res) => res.json({ url: `https://kite.zerodha.com/connect/login?v=3&api_key=${KITE_API_KEY}` }));
 
app.get('/api/kite/callback', async (req, res) => {
  const { request_token, status } = req.query;
  if (status !== 'success' || !request_token) return res.redirect(`${FRONTEND_URL}?kite_error=1`);
  try {
    const checksum = crypto.createHash('sha256').update(KITE_API_KEY + request_token + KITE_API_SECRET).digest('hex');
    const resp = await fetch(`${KITE_BASE}/session/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Kite-Version': '3' }, body: new URLSearchParams({ api_key: KITE_API_KEY, request_token, checksum }).toString() });
    const data = await resp.json();
    if (!resp.ok || !data.data?.access_token) return res.redirect(`${FRONTEND_URL}?kite_error=2`);
    const expiry = new Date(); expiry.setDate(expiry.getDate() + 1); expiry.setHours(6, 0, 0, 0);
    await _saveKiteToken(data.data.access_token, expiry.toISOString());
    res.redirect(`${FRONTEND_URL}?kite_auth=success`);
  } catch (err) { res.redirect(`${FRONTEND_URL}?kite_error=3`); }
});
 
app.get('/api/kite/status', requireAuth, (req, res) => res.json({ connected: !!_kiteToken && !!_kiteTokenExpiry && new Date(_kiteTokenExpiry) > new Date(), expiry: _kiteTokenExpiry, apiKey: KITE_API_KEY }));
app.get('/api/kite/quote',   requireAuth, async (req, res) => { try { const { symbols } = req.query; if (!symbols) return res.status(400).json({ error: 'symbols required' }); res.json(await _kiteGet(`/quote?i=${symbols.split(',').join('&i=')}`)); } catch (err) { res.status(500).json({ error: safeError(err, 'kite_quote') }); } });
app.get('/api/kite/ltp',     requireAuth, async (req, res) => { try { const { symbols } = req.query; if (!symbols) return res.status(400).json({ error: 'symbols required' }); res.json(await _kiteGet(`/quote/ltp?i=${symbols.split(',').join('&i=')}`)); } catch (err) { res.status(500).json({ error: safeError(err, 'kite_ltp') }); } });
app.get('/api/kite/ohlc',    requireAuth, async (req, res) => { try { const { symbols } = req.query; if (!symbols) return res.status(400).json({ error: 'symbols required' }); res.json(await _kiteGet(`/quote/ohlc?i=${symbols.split(',').join('&i=')}`)); } catch (err) { res.status(500).json({ error: safeError(err, 'kite_ohlc') }); } });
 
app.get('/api/kite/historical', requireAuth, async (req, res) => {
  try {
    const { symbol, interval, from, to } = req.query;
    if (!symbol) return res.status(400).json({ error: 'symbol required' });
    const quote = await _kiteGet(`/quote/ltp?i=${symbol}`);
    if (quote.error) return res.status(401).json(quote);
    const token = quote.data?.[symbol]?.instrument_token;
    if (!token) return res.status(404).json({ error: 'instrument not found' });
    res.json(await _kiteGet(`/instruments/historical/${token}/${interval || 'day'}?from=${from}&to=${to}&continuous=0&oi=0`));
  } catch (err) { res.status(500).json({ error: safeError(err, 'kite_historical') }); }
});
 
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
      try { const data = await _kiteGet(`/quote/ltp?i=${batch.join('&i=')}`); if (data.data) Object.assign(allData, data.data); } catch (e) {}
    }
    const result = symbols.map(s => {
      const nseQ = allData[`NSE:${s.symbol}`]; const bseQ = allData[`BSE:${s.symbol}`]; const liveQ = nseQ || bseQ;
      const ltp = liveQ?.last_price || s.avgCost || 0; const mv = ltp * (s.qty || 0); const cost = (s.avgCost || 0) * (s.qty || 0);
      return { symbol: s.symbol, qty: s.qty, avgCost: s.avgCost, ltp, marketValue: mv, cost, pnl: mv - cost, pnlPct: cost > 0 ? (mv - cost) / cost : 0, live: !!liveQ, exchange: nseQ ? 'NSE' : bseQ ? 'BSE' : '—' };
    });
    res.json({ connected: true, holdings: result, summary: { totalLive: result.reduce((s, r) => s + r.marketValue, 0), totalCost: result.reduce((s, r) => s + r.cost, 0), totalPnL: result.reduce((s, r) => s + r.pnl, 0) }, ts: new Date().toISOString() });
  } catch (err) { res.status(500).json({ error: safeError(err, 'kite_portfolio_live') }); }
});
 
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
  } catch (err) { res.json({ indices: [], source: 'Unavailable', error: safeError(err, 'world_indices') }); }
});
 
app.get('/api/admin/users', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { data, error } = await _supabase.from('saarthi_users').select('id, email, name, role, active, created_at');
    if (error) throw error;
    res.json({ users: data });
  } catch (err) { res.status(500).json({ error: safeError(err, 'admin_users_get') }); }
});
 
app.post('/api/admin/users', requireAuth, requireRole('admin'), validate(schemas.adminCreateUserSchema), async (req, res) => {
  try {
    const { email, name, role, password } = req.body;
    if (!email || !name || !role || !password) return res.status(400).json({ error: 'email, name, role, password required' });
    if (!['admin', 'manager', 'viewer'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    const { data: authUser, error: authErr } = await _supabase.auth.admin.createUser({ email, password, email_confirm: true });
    if (authErr) throw authErr;
    const { error: profErr } = await _supabase.from('saarthi_users').insert({ id: authUser.user.id, email, name, role, active: true, created_at: new Date().toISOString() });
    if (profErr) throw profErr;
    audit(req.user.id, 'USER_CREATED', { email, role });
    res.json({ ok: true, id: authUser.user.id });
  } catch (err) { res.status(500).json({ error: safeError(err, 'admin_users_post') }); }
});
 
app.patch('/api/admin/users/:id', requireAuth, requireRole('admin'), validate(schemas.adminUserIdParamSchema, 'params'), validate(schemas.adminUpdateUserSchema), async (req, res) => {
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
  } catch (err) { res.status(500).json({ error: safeError(err, 'admin_users_patch') }); }
});
 
app.get('/api/admin/audit', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { data, error } = await _supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    res.json({ logs: data });
  } catch (err) { res.status(500).json({ error: safeError(err, 'admin_audit_get') }); }
});
 
app.get('/sw.js', (req, res) => { res.setHeader('Content-Type', 'application/javascript'); res.setHeader('Service-Worker-Allowed', '/'); res.sendFile(path.join(__dirname, 'sw.js')); });
app.get('/manifest.json', (req, res) => { res.json({ name: 'Saarthi PMS', short_name: 'Saarthi', description: 'UpperCrust Wealth PMS Terminal', start_url: '/', display: 'standalone', background_color: '#0e0c07', theme_color: '#8a6814', icons: [{ src: '/favicon.ico', sizes: '192x192', type: 'image/png' }, { src: '/favicon.ico', sizes: '512x512', type: 'image/png' }] }); });
 
// ─────────────────────────────────────────────
// CRON JOBS
// ─────────────────────────────────────────────
cron.schedule('* * * * *', async () => {
  if (!VAPID_PUBLIC_KEY) return;
  try {
    const { data: pending } = await _supabase.from('pending_notifications').select('*').eq('sent', false).order('created_at', { ascending: true }).limit(20);
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
 
// ⚡ SAARTHI PULSE — daily intelligence briefing at 6:15 AM IST
cron.schedule('45 0 * * *', () => require('./crons/pulseCron').runPulseCron(), { timezone: 'Asia/Kolkata' });
 
cron.schedule('0 2 * * *', async () => {
  try {
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
    await _supabase.from('pending_notifications').delete().eq('sent', true).lt('created_at', cutoff);
    await _supabase.from('audit_log').delete().lt('created_at', new Date(Date.now() - 90 * 86400000).toISOString());
    await _supabase.from('revoked_tokens').delete().lt('expires_at', new Date().toISOString());
  } catch (err) { console.error('[Cron cleanup]', err.message); }
}, { timezone: 'Asia/Kolkata' });
 
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => { console.error('[ERROR]', err && err.stack || err.message); res.status(err.status || 500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message }); });
 
const PORT = process.env.PORT || 4000;
 
(async () => {
  try {
    const { error } = await _supabase.from('app_settings').upsert({ key: '_startup_test', value: 'ok', updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) { console.error('CRITICAL: RLS still blocking writes:', error.message); }
    else { console.log('✓ Supabase writes working'); }
  } catch(e) { console.error('Startup check failed:', e.message); }
})();
 
const server = app.listen(PORT, () => console.log(`Saarthi backend secured on :${PORT}`));
 
function gracefulShutdown(signal) {
  console.log(`[Shutdown] ${signal} received — closing server gracefully...`);
  server.close(() => {
    console.log('[Shutdown] HTTP server closed. No new connections accepted, in-flight requests completed.');
    process.exit(0);
  });
  // Safety net: force-exit if something keeps the server from closing in time
  // (e.g. a hung connection), so Railway doesn't wait forever on a stuck deploy.
  setTimeout(() => {
    console.error('[Shutdown] Forced exit — server did not close within 15s.');
    process.exit(1);
  }, 15000).unref();
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
 
module.exports = app;
