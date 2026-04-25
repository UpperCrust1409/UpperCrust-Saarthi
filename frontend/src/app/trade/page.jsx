'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardShell from '@/components/layout/DashboardShell';
import { clientsAPI, stocksAPI } from '@/lib/api';
import { fc, fp } from '@/lib/formatters';
import { getSession } from '@/lib/auth';
import toast from 'react-hot-toast';

const STRATS = [
  { id: 'gap',    label: 'Gap-Based',    desc: 'Allocates most to clients furthest below target' },
  { id: 'aum',    label: 'AUM-Weighted', desc: 'Proportional to portfolio size' },
  { id: 'top30',  label: 'Top 30% AUM',  desc: 'Only the largest portfolios' },
  { id: 'hybrid', label: 'Hybrid Score', desc: '50% gap + 50% AUM weight' }
];

function computeAllocations({ clients, stockClients, price, budget, targetPct, strategy, excluded }) {
  const holdingMap = {};
  (stockClients || []).forEach(h => { holdingMap[h.client_id] = h; });

  const pool = clients
    .filter(c => !excluded.has(c.id))
    .map(c => {
      const h = holdingMap[c.id] || {};
      const aum = parseFloat(c.aum) || parseFloat(c.total_current) || 0;
      const curVal = parseFloat(h.value) || 0;
      const curPct = aum > 0 ? curVal / aum : 0;
      const gap = Math.max(0, targetPct - curPct);
      return { ...c, aum, curVal, curPct, gap, curQty: parseFloat(h.qty) || 0 };
    })
    .filter(c => c.aum > 0);

  if (!pool.length) return [];

  const totalAUM = pool.reduce((s, c) => s + c.aum, 0);
  const totalGap = pool.reduce((s, c) => s + c.gap, 0);
  const sorted = [...pool].sort((a, b) => b.aum - a.aum);
  const topN = Math.max(1, Math.ceil(pool.length * 0.3));
  const topIds = new Set(sorted.slice(0, topN).map(c => c.id));

  const weights = pool.map(c => {
    const aumW = totalAUM > 0 ? c.aum / totalAUM : 0;
    const gapW = totalGap > 0 ? c.gap / totalGap : 0;
    switch (strategy) {
      case 'gap':    return c.gap;
      case 'aum':    return c.aum;
      case 'top30':  return topIds.has(c.id) ? c.aum : 0;
      case 'hybrid': return 0.5 * aumW + 0.5 * gapW;
      default:       return c.aum;
    }
  });

  const totalW = weights.reduce((s, w) => s + w, 0);
  if (!totalW) return [];

  return pool.map((c, i) => {
    const share = weights[i] / totalW;
    const allocAmount = share * budget;
    const buyQty = price > 0 ? Math.floor(allocAmount / price) : 0;
    const actualAmount = buyQty * price;
    const newVal = c.curVal + actualAmount;
    const newPct = c.aum > 0 ? newVal / c.aum : 0;
    return { ...c, share, allocAmount, buyQty, actualAmount, newVal, newPct };
  }).filter(c => c.buyQty > 0);
}

export default function TradePage() {
  const router = useRouter();
  const [clients,     setClients]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [symbol,      setSymbol]      = useState('');
  const [price,       setPrice]       = useState('');
  const [budget,      setBudget]      = useState('');
  const [targetPct,   setTargetPct]   = useState('5');
  const [strategy,    setStrategy]    = useState('gap');
  const [excluded,    setExcluded]    = useState(new Set());
  const [stockData,   setStockData]   = useState(null);
  const [fetching,    setFetching]    = useState(false);
  const [results,     setResults]     = useState(null);
  const [showExclude, setShowExclude] = useState(false);

  useEffect(() => {
    const { token } = getSession();
    if (!token) { router.replace('/login'); return; }
    clientsAPI.list()
      .then(d => setClients(Array.isArray(d) ? d : []))
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  async function fetchStock() {
    if (!symbol.trim()) { toast.error('Enter a stock symbol'); return; }
    setFetching(true);
    setStockData(null);
    setResults(null);
    try {
      const d = await stocksAPI.get(symbol.trim().toUpperCase());
      setStockData(d);
      toast.success(`Loaded ${d.symbol}`);
    } catch (e) {
      toast.error(e.message || 'Stock not found');
    } finally {
      setFetching(false);
    }
  }

  function run() {
    if (!stockData)            { toast.error('Load a stock first'); return; }
    if (!price || +price <= 0) { toast.error('Enter a valid price'); return; }
    if (!budget || +budget <= 0){ toast.error('Enter a valid budget'); return; }
    const res = computeAllocations({
      clients,
      stockClients: stockData.clients || [],
      price:     parseFloat(price),
      budget:    parseFloat(budget),
      targetPct: parseFloat(targetPct) / 100,
      strategy,
      excluded
    });
    setResults(res);
    if (!res.length) toast.error('No allocations — increase budget or reduce target %');
  }

  function exportCSV() {
    if (!results) return;
    const header = ['#', 'Client', 'AUM', 'Cur Value', 'Cur %', 'Target %', 'Buy Qty', 'Amount (₹)', 'Post-Trade %'];
    const rows   = results.map((r, i) => [
      i + 1, r.name,
      r.aum.toFixed(0), r.curVal.toFixed(0),
      (r.curPct * 100).toFixed(2),
      targetPct,
      r.buyQty,
      r.actualAmount.toFixed(0),
      (r.newPct * 100).toFixed(2)
    ]);
    const csv = [header, ...rows].map(r => r.join(',')).join('\n');
    const a   = document.createElement('a');
    a.href    = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = `trade_${symbol}_${strategy}.csv`;
    a.click();
  }

  const totalQty    = results?.reduce((s, r) => s + r.buyQty, 0) || 0;
  const totalAmount = results?.reduce((s, r) => s + r.actualAmount, 0) || 0;

  if (loading) return (
    <DashboardShell title="Trade Engine">
      <div style={{ padding: 48, textAlign: 'center' }}><div className="spin" /></div>
    </DashboardShell>
  );

  return (
    <DashboardShell title="Trade Engine" subtitle="Allocate a stock buy order across clients using 4 strategies">

      {/* Controls */}
      <div className="panel" style={{ padding: '14px 16px', marginBottom: 14 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
          Trade Parameters
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr auto', gap: 10, alignItems: 'flex-end', marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 9, color: 'var(--ink3)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Symbol</label>
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                value={symbol}
                onChange={e => setSymbol(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && fetchStock()}
                placeholder="e.g. RELIANCE"
                style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)', fontSize: 11, outline: 'none' }}
              />
              <button
                onClick={fetchStock} disabled={fetching}
                style={{ padding: '7px 12px', background: 'var(--gold)', border: 'none', borderRadius: 'var(--r)', fontWeight: 700, cursor: 'pointer', fontSize: 11, color: '#000', whiteSpace: 'nowrap' }}
              >
                {fetching ? '…' : 'Load'}
              </button>
            </div>
          </div>

          <div>
            <label style={{ fontSize: 9, color: 'var(--ink3)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Market Price (₹)</label>
            <input
              type="number" min="0" step="0.05" value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00"
              style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)', fontSize: 11, outline: 'none' }}
            />
          </div>

          <div>
            <label style={{ fontSize: 9, color: 'var(--ink3)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Total Budget (₹)</label>
            <input
              type="number" min="0" value={budget} onChange={e => setBudget(e.target.value)} placeholder="0"
              style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)', fontSize: 11, outline: 'none' }}
            />
          </div>

          <div>
            <label style={{ fontSize: 9, color: 'var(--ink3)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Target % per client</label>
            <input
              type="number" min="0" max="100" step="0.5" value={targetPct} onChange={e => setTargetPct(e.target.value)} placeholder="5"
              style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)', fontSize: 11, outline: 'none' }}
            />
          </div>

          <button
            onClick={run}
            style={{ padding: '7px 20px', background: '#1a5a2a', color: '#fff', border: 'none', borderRadius: 'var(--r)', fontWeight: 700, cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' }}
          >
            Run →
          </button>
        </div>

        {/* Strategy tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {STRATS.map(s => (
            <button
              key={s.id} onClick={() => { setStrategy(s.id); setResults(null); }}
              title={s.desc}
              style={{
                padding: '5px 14px', fontSize: 10, fontWeight: 600, cursor: 'pointer', borderRadius: 'var(--r)',
                background: strategy === s.id ? 'var(--gold)' : 'var(--sur)',
                color:      strategy === s.id ? '#000' : 'var(--ink3)',
                border:     strategy === s.id ? 'none' : '1px solid var(--bdr)',
                transition: 'all .1s'
              }}
            >
              {s.label}
            </button>
          ))}
          {strategy && (
            <span style={{ fontSize: 9, color: 'var(--ink4)', alignSelf: 'center', marginLeft: 4 }}>
              {STRATS.find(s => s.id === strategy)?.desc}
            </span>
          )}
        </div>

        {/* Exclude clients */}
        <button
          onClick={() => setShowExclude(v => !v)}
          style={{ fontSize: 10, color: 'var(--ink3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 600 }}
        >
          {showExclude ? '▲' : '▼'} Exclude clients {excluded.size > 0 && `(${excluded.size} excluded)`}
        </button>
        {showExclude && (
          <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8, padding: '8px 10px', background: 'var(--sur)', borderRadius: 'var(--r)', border: '1px solid var(--bdr)' }}>
            {clients.map(c => (
              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, cursor: 'pointer', color: 'var(--ink2)' }}>
                <input
                  type="checkbox" checked={excluded.has(c.id)}
                  onChange={e => {
                    setExcluded(prev => {
                      const next = new Set(prev);
                      e.target.checked ? next.add(c.id) : next.delete(c.id);
                      return next;
                    });
                    setResults(null);
                  }}
                />
                {c.name}
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Stock info */}
      {stockData && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8, marginBottom: 14 }}>
          {[
            { label: 'Symbol',         val: stockData.symbol },
            { label: 'Current AUM',    val: fc(stockData.total_value) },
            { label: 'Clients',        val: stockData.client_count },
            { label: 'Sector',         val: stockData.sector || 'Untagged' },
            { label: 'Avg Cost',       val: fc(stockData.total_cost) }
          ].map(x => (
            <div key={x.label} className="panel" style={{ padding: '8px 12px' }}>
              <div style={{ fontSize: 8.5, color: 'var(--ink4)', marginBottom: 2 }}>{x.label}</div>
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)' }}>{x.val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Results */}
      {results && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 20 }}>
              <span style={{ fontSize: 11, color: 'var(--ink3)' }}>
                <b style={{ color: 'var(--ink)' }}>{results.length}</b> clients allocated
              </span>
              <span style={{ fontSize: 11, color: 'var(--ink3)' }}>
                Total outlay: <b style={{ color: 'var(--gold)' }}>{fc(totalAmount)}</b>
              </span>
              <span style={{ fontSize: 11, color: 'var(--ink3)' }}>
                Total qty: <b style={{ color: 'var(--ink)' }}>{totalQty.toLocaleString('en-IN')}</b>
              </span>
            </div>
            <button
              onClick={exportCSV}
              style={{ padding: '5px 14px', fontSize: 10, background: 'var(--sur)', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', cursor: 'pointer', fontWeight: 600, color: 'var(--ink2)' }}
            >
              ↓ CSV
            </button>
          </div>

          <div className="tbl">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Client</th>
                  <th style={{ textAlign: 'right' }}>AUM</th>
                  <th style={{ textAlign: 'right' }}>Cur Holding</th>
                  <th style={{ textAlign: 'right' }}>Cur %</th>
                  <th style={{ textAlign: 'right' }}>Target %</th>
                  <th style={{ textAlign: 'right' }}>Gap</th>
                  <th style={{ textAlign: 'right' }}>Buy Qty</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th style={{ textAlign: 'right' }}>Post %</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => {
                  const overLimit = r.newPct > 0.10;
                  return (
                    <tr key={r.id}>
                      <td style={{ color: 'var(--ink4)', fontWeight: 700 }}>{i + 1}</td>
                      <td style={{ fontWeight: 600, color: 'var(--ink)' }}>{r.name}</td>
                      <td style={{ textAlign: 'right', color: 'var(--ink3)' }}>{fc(r.aum)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--ink3)' }}>{r.curVal > 0 ? fc(r.curVal) : '—'}</td>
                      <td style={{ textAlign: 'right', color: 'var(--ink3)' }}>{fp(r.curPct)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--ink4)' }}>{targetPct}%</td>
                      <td style={{ textAlign: 'right', color: r.gap > 0 ? 'var(--gold)' : 'var(--ink4)' }}>{fp(r.gap)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--green)' }}>{r.buyQty.toLocaleString('en-IN')}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--gold)' }}>{fc(r.actualAmount)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: overLimit ? 'var(--red)' : 'var(--green)' }}>
                        {fp(r.newPct)}{overLimit ? ' ⚠' : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--bdr)', fontWeight: 700 }}>
                  <td colSpan={7} style={{ padding: '6px 0', color: 'var(--ink3)', fontSize: 10 }}>Total</td>
                  <td style={{ textAlign: 'right', color: 'var(--ink)' }}>{totalQty.toLocaleString('en-IN')}</td>
                  <td style={{ textAlign: 'right', color: 'var(--gold)' }}>{fc(totalAmount)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      {!results && !stockData && (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink4)' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚡</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Load a stock and configure parameters</div>
          <div style={{ fontSize: 11, marginTop: 6 }}>Enter symbol → Load → set price + budget → Run</div>
        </div>
      )}

      {!results && stockData && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink4)' }}>
          Set price, budget, target %, choose strategy and click Run
        </div>
      )}
    </DashboardShell>
  );
}
