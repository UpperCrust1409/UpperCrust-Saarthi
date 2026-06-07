'use strict';
/**
 * /api/compute — Server-side financial calculations
 * Keeps all business logic server-side — hidden from browser
 */
const express = require('express');
const router = express.Router();

// ── XIRR (Newton-Raphson) ──
function _xirr(cashflows, guess) {
  guess = guess || 0.1;
  if (!cashflows || cashflows.length < 2) return null;
  const d0 = new Date(cashflows[0].date).getTime();
  const eps = 1e-7;
  for (let iter = 0; iter < 200; iter++) {
    let npv = 0, dnpv = 0;
    for (const cf of cashflows) {
      const t = (new Date(cf.date).getTime() - d0) / (365.25 * 24 * 3600 * 1000);
      const v = Math.pow(1 + guess, t);
      if (!isFinite(v) || v === 0) continue;
      npv  += cf.amount / v;
      dnpv -= t * cf.amount / (v * (1 + guess));
    }
    if (Math.abs(dnpv) < eps) break;
    const next = guess - npv / dnpv;
    if (Math.abs(next - guess) < eps) { guess = next; break; }
    guess = next <= -1 ? -0.9999 : next > 10 ? 10 : next;
  }
  return (guess > -1 && guess < 100) ? guess : null;
}

// ── PORTFOLIO HEALTH SCORE (hidden algorithm) ──
function computeHealthScore(client) {
  const holdings = client.holdings || [];
  const totalInvested = client.total_invested || 0;
  const totalCurrent  = client.total_current  || 0;
  const totalPnL      = client.total_pnl      || 0;
  const cash          = client.cash || 0;
  const aum = totalCurrent + cash;
  if (!aum || aum <= 0) return null;
  const scores = {};
  const nStocks = holdings.filter(h => (h.asset_class||'') !== 'Exchange Traded Fund').length;
  scores.diversification = Math.min(100, (nStocks / 25) * 100);
  const topH = holdings.reduce((mx, h) => Math.max(mx, (h.market_value||0)/aum), 0);
  scores.concentration = topH <= 0.12 ? 100 : topH <= 0.20 ? 80 : topH <= 0.30 ? 55 : 25;
  const cp = cash / aum;
  scores.cash = cp >= 0.02 && cp <= 0.08 ? 100 : cp < 0.02 ? (cp/0.02)*100 : cp <= 0.15 ? 100-((cp-0.08)/0.07)*50 : 25;
  const pnlPct = totalInvested > 0 ? totalPnL / totalInvested : 0;
  scores.returns = pnlPct >= 0.30 ? 100 : pnlPct >= 0.15 ? 78 : pnlPct >= 0.05 ? 55 : pnlPct >= 0 ? 40 : 20;
  const invDate = client.investment_date ? new Date(client.investment_date) : null;
  const yrs = invDate ? (Date.now() - invDate.getTime()) / (365.25*24*3600*1000) : null;
  scores.tenure = yrs === null ? 50 : yrs >= 2 ? 100 : yrs >= 1 ? 75 : yrs >= 0.5 ? 50 : 30;
  const W = { diversification:0.20, concentration:0.25, cash:0.15, returns:0.25, tenure:0.15 };
  const total = Object.keys(scores).reduce((s,k) => s + scores[k]*W[k], 0);
  return {
    score: Math.round(total),
    grade: total >= 80 ? 'A' : total >= 65 ? 'B' : total >= 50 ? 'C' : 'D',
    subScores: scores,
  };
}

// ── BREACH DETECTION ──
function evaluateBreaches(client, filters) {
  const aum = (client.total_current||0) + (client.cash||0);
  if (!aum) return [];
  const breaches = [];
  for (const f of filters) {
    if (!f.active) continue;
    let val = null, breached = false, suggest = '';
    if (f.type === 'stock_max') {
      const h = client.holdings.find(x => x.symbol === f.target);
      val = h ? (h.market_value||0)/aum : 0;
      breached = val > f.threshold/100;
      suggest = breached ? `Reduce ${f.target} from ${(val*100).toFixed(1)}% to below ${f.threshold}%` : '';
    } else if (f.type === 'sector_max') {
      const sv = client.holdings.filter(h=>(h.sector_tag||h.asset_class||'')===f.target).reduce((s,h)=>s+(h.market_value||0),0);
      val = sv/aum; breached = val>f.threshold/100;
      suggest = breached ? `Reduce ${f.target} from ${(val*100).toFixed(1)}%` : '';
    } else if (f.type === 'cash_min') {
      val = (client.cash||0)/aum; breached = val<f.threshold/100;
      suggest = breached ? `Cash at ${(val*100).toFixed(1)}%, needs ${f.threshold}% minimum` : '';
    } else if (f.type === 'stock_min') {
      const h = client.holdings.find(x=>x.symbol===f.target);
      val = h ? (h.market_value||0)/aum : 0; breached = val<f.threshold/100&&val>0;
    } else if (f.type === 'sector_min') {
      const sv = client.holdings.filter(h=>(h.sector_tag||'')===f.target).reduce((s,h)=>s+(h.market_value||0),0);
      val = sv/aum; breached = val<f.threshold/100&&val>0;
    }
    if (breached) breaches.push({ filter:f.name, type:f.type, target:f.target, value:val, threshold:f.threshold/100, suggest });
  }
  return breaches;
}

// ── POST /xirr ──
router.post('/xirr', (req, res) => {
  try {
    const { cashflows } = req.body;
    if (!Array.isArray(cashflows) || cashflows.length < 2)
      return res.status(400).json({ error: 'cashflows array required' });
    const result = _xirr(cashflows);
    res.json({ xirr: result, xirrPct: result !== null ? result*100 : null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /health ──
router.post('/health', (req, res) => {
  try {
    const { client } = req.body;
    if (!client) return res.status(400).json({ error: 'client required' });
    res.json(computeHealthScore(client) || { error: 'Cannot compute' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /health/batch ──
router.post('/health/batch', async (req, res) => {
  try {
    const sb = req.supabase;
    const { data: clients } = await sb.from('clients').select('id,name,total_invested,total_current,total_pnl,cash,investment_date');
    const { data: holdings } = await sb.from('holdings').select('client_id,symbol,market_value,asset_class');
    const hMap = {}; for (const h of holdings||[]) { (hMap[h.client_id]=hMap[h.client_id]||[]).push(h); }
    const scores = {};
    for (const c of clients||[]) scores[c.name] = computeHealthScore({...c, holdings:hMap[c.id]||[]});
    res.json({ scores });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /breaches/batch ──
router.post('/breaches/batch', async (req, res) => {
  try {
    const { filters } = req.body;
    if (!Array.isArray(filters)) return res.status(400).json({ error: 'filters required' });
    const sb = req.supabase;
    const { data: clients } = await sb.from('clients').select('id,name,total_current,cash');
    const { data: holdings } = await sb.from('holdings').select('client_id,symbol,market_value,asset_class,sector_tag');
    const hMap = {}; for (const h of holdings||[]) { (hMap[h.client_id]=hMap[h.client_id]||[]).push(h); }
    const allBreaches = {};
    for (const c of clients||[]) {
      const b = evaluateBreaches({...c, holdings:hMap[c.id]||[]}, filters);
      if (b.length) allBreaches[c.name] = b;
    }
    res.json({ totalBreaches: Object.values(allBreaches).reduce((s,b)=>s+b.length,0), clientsAffected: Object.keys(allBreaches).length, breaches: allBreaches });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── LEVEL 2: GET /client-index (names + IDs only, no holdings) ──
router.get('/client-index', async (req, res) => {
  try {
    const { data, error } = await req.supabase.from('clients')
      .select('id,name,fund_name,investment_date,total_pnl,total_invested,total_current,cash')
      .order('total_invested', { ascending: false });
    if (error) throw error;
    res.json({
      clients: (data||[]).map(c => ({
        id: c.id,
        name: c.name,
        displayName: c.name.replace(/\(.*\)/, '').trim(),
        fund: c.fund_name,
        investmentDate: c.investment_date,
        totalPnL: c.total_pnl,
        totalInvested: c.total_invested,
        totalCurrent: c.total_current,
        cash: c.cash,
      })),
      count: data?.length || 0,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── LEVEL 2: GET /client/:name (full detail on-demand) ──
router.get('/client/:name', async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const sb = req.supabase;
    const { data: clients } = await sb.from('clients').select('*').eq('name', name).limit(1);
    if (!clients?.length) return res.status(404).json({ error: 'Client not found' });
    const client = clients[0];
    const { data: holdings } = await sb.from('holdings').select('*').eq('client_id', client.id);
    const health = computeHealthScore({ ...client, holdings: holdings||[] });
    // Audit log
    if (req.user) {
      sb.from('audit_log').insert({
        user_id: req.user.id, action: 'CLIENT_VIEW',
        meta: JSON.stringify({ client: name }), created_at: new Date().toISOString(),
      }).catch(()=>{});
    }
    res.json({
      client: {
        id: client.id, name: client.name, fund: client.fund_name,
        cash: client.cash, netCash: client.net_cash||client.cash,
        totalInvested: client.total_invested, totalCurrent: client.total_current,
        totalPnL: client.total_pnl, investmentDate: client.investment_date,
      },
      holdings: (holdings||[]).map(h => ({
        symbol: h.symbol, name: h.name, qty: h.qty,
        unitCost: h.unit_cost, totalCost: h.total_cost,
        marketPrice: h.market_price, marketValue: h.market_value,
        pnl: h.pnl, pnlPct: h.pnl_pct, holdingPct: h.holding_pct,
        assetClass: h.asset_class,
      })),
      health,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
