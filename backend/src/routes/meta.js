// Add this to your backend Express app (backend/routes/meta.js or add to main server file)
// This handles GET/POST for key-value metadata (benchmark data, health stocks, client investments)

const express = require('express');
const router = express.Router();

// In-memory store (survives server restarts via DB if you have one)
// For Supabase: create a table called "meta" with columns: key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMP
// For now using in-memory with JSON file fallback

const fs = require('fs');
const path = require('path');
const META_FILE = path.join(__dirname, '../data/meta.json');

let metaStore = {};

// Load from file on startup
try {
  if (fs.existsSync(META_FILE)) {
    metaStore = JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
    console.log('[meta] Loaded', Object.keys(metaStore).length, 'keys from file');
  }
} catch(e) { console.warn('[meta] Load failed:', e.message); }

function saveMeta() {
  try {
    const dir = path.dirname(META_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(META_FILE, JSON.stringify(metaStore));
  } catch(e) { console.warn('[meta] Save failed:', e.message); }
}

// GET /api/meta/:key
router.get('/:key', (req, res) => {
  const { key } = req.params;
  if (metaStore[key] !== undefined) {
    res.json({ key, value: metaStore[key], updated: metaStore[key + '_ts'] || null });
  } else {
    res.json({ key, value: null });
  }
});

// POST /api/meta/:key  { value: <any JSON> }
router.post('/:key', (req, res) => {
  const { key } = req.params;
  const { value } = req.body;
  if (value === undefined) return res.status(400).json({ error: 'value required' });
  metaStore[key] = value;
  metaStore[key + '_ts'] = new Date().toISOString();
  saveMeta();
  res.json({ ok: true, key, updated: metaStore[key + '_ts'] });
});

// DELETE /api/meta/:key
router.delete('/:key', (req, res) => {
  delete metaStore[req.params.key];
  delete metaStore[req.params.key + '_ts'];
  saveMeta();
  res.json({ ok: true });
});

module.exports = router;
