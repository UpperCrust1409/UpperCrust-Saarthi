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
 
const app = express();
 
// ── Trust proxy (required for Railway / reverse proxies) ──
app.set('trust proxy', 1);
 
// ── Security middleware ──
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
 
// ── Rate limiting ──
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
 
// ── Body parsing ──
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
 
// ── Health check ──
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date() }));
 
// ── Routes ──
app.use('/api/auth',      authLimiter, authRoutes);
app.use('/api/upload',    uploadRoutes);
app.use('/api/clients',   clientRoutes);
app.use('/api/stocks',    stockRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/risk',      riskRoutes);
app.use('/api/tags',      tagsRoutes);
app.use('/api/holdings',  holdingsRoutes);
 
// ── 404 ──
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
 
// ── Global error handler ──
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message, err.stack);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});
 
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Saarthi backend running on :${PORT}`));
module.exports = app;
