const express = require('express');
const router = express.Router();
 
// POST /api/auth/login
// Reads credentials from USERS_CONFIG env var: "Admin:pass1,Durgesh:pass2,Dhruv:pass3"
router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
 
    // Parse USERS_CONFIG from env
    const config = process.env.USERS_CONFIG || '';
    const users = {};
    config.split(',').forEach(pair => {
      const idx = pair.indexOf(':');
      if (idx > 0) {
        const u = pair.slice(0, idx).trim();
        const p = pair.slice(idx + 1).trim();
        users[u] = p;
      }
    });
 
    if (users[username] && users[username] === password) {
      // Admin is first user in config, everyone else is viewer
      const firstUser = config.split(',')[0]?.split(':')[0]?.trim();
      const role = username === firstUser ? 'admin' : 'viewer';
      return res.json({ success: true, username, role });
    }
 
    return res.status(401).json({ error: 'Invalid username or password' });
 
  } catch (err) {
    console.error('Auth error:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
});
 
module.exports = router;
