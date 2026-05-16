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
 
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false
}));
 
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false
});
 
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts. Try again later.' }
});
 
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
 
// ── FIFO Tax Engine ──
const { createClient } = require('@supabase/supabase-js');
const _supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
);
registerFIFORoutes(app, _supabase);
 
// ── App Settings ──
app.get('/api/settings/:key', async (req, res) => {
  try {
    const { data, error } = await _supabase
      .from('app_settings')
      .select('value')
      .eq('key', req.params.key)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    res.json({ value: data?.value || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
 
app.post('/api/settings/:key', async (req, res) => {
  try {
    const { value } = req.body;
    if (value === undefined) return res.status(400).json({ error: 'Value required' });
    const { error } = await _supabase
      .from('app_settings')
      .upsert({ key: req.params.key, value, updated_at: new Date().toISOString() });
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
 
// ── Saarthi Memory ──
// GET all active memories
app.get('/api/memory', async (req, res) => {
  try {
    const { data, error } = await _supabase
      .from('saarthi_memory')
      .select('*')
      .eq('active', true)
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ memories: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
 
// POST save new memory (or batch of memories)
app.post('/api/memory', async (req, res) => {
  try {
    const { memories } = req.body; // array of {category, memory, source, importance, created_by}
    if (!memories || !memories.length) return res.status(400).json({ error: 'Memories array required' });
    const rows = memories.map(m => ({
      category:   m.category || 'general',
      memory:     m.memory,
      source:     m.source || 'auto',
      importance: m.importance || 5,
      active:     true,
      created_by: m.created_by || 'system',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
    const { data, error } = await _supabase.from('saarthi_memory').insert(rows).select();
    if (error) throw error;
    res.json({ ok: true, saved: data.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
 
// DELETE (soft delete) a memory
app.delete('/api/memory/:id', async (req, res) => {
  try {
    const { error } = await _supabase
      .from('saarthi_memory')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
 
// PATCH update importance
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
 
// ── Claude AI Proxy ──
app.post('/api/claude', async (req, res) => {
  try {
    const { apiKey, system, messages } = req.body;
    if (!apiKey || !apiKey.startsWith('sk-ant-'))
      return res.status(400).json({ error: { message: 'Invalid API key' } });
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 4096,
        system: system || '',
        messages: messages,
      }),
    });
    const data = await response.json();
    res.status(response.ok ? 200 : response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});
 
// ── Claude Memory Extraction ──
// After a conversation, extract learnings automatically
app.post('/api/claude/extract-memory', async (req, res) => {
  try {
    const { apiKey, conversation, existing_memories } = req.body;
    if (!apiKey || !apiKey.startsWith('sk-ant-')) return res.status(400).json({ memories: [] });
 
    const extractPrompt = `You are a memory extraction system for a PMS (Portfolio Management Service) AI advisor called Saarthi.
 
Analyze this conversation and extract ONLY genuinely new, important learnings that should be permanently remembered.
 
EXISTING MEMORIES (do NOT re-extract these):
${existing_memories || 'None yet'}
 
CONVERSATION:
${conversation}
 
Extract memories that are:
- Preferences the fund manager expressed ("I prefer...", "we never...", "our philosophy is...")
- Corrections to wrong assumptions ("no, we don't own...", "that's not our style")
- Decisions made ("we decided to...", "going forward...")
- Client-specific notes ("client X is conservative")
- Market views shared ("I'm bearish on X")
- Important facts about UpperCrust's style or approach
 
Return ONLY a JSON array (no other text):
[
  {"category": "philosophy|preference|decision|client|market|correction", "memory": "exact memory string", "importance": 1-10},
  ...
]
 
Return empty array [] if nothing important to remember. Be selective — only extract genuinely new, lasting insights. NOT transient data questions.`;
 
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 800,
        messages: [{ role: 'user', content: extractPrompt }],
      }),
    });
    const data = await response.json();
    const text = data.content?.[0]?.text || '[]';
    let memories = [];
    try {
      const match = text.match(/\[[\s\S]*\]/);
      if (match) memories = JSON.parse(match[0]);
    } catch(e) { memories = []; }
    res.json({ memories });
  } catch (err) {
    res.status(500).json({ memories: [], error: err.message });
  }
});
 
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
 
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message, err.stack);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});
 
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Saarthi backend running on :${PORT}`));
module.exports = app;
