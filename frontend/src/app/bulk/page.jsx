'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardShell from '@/components/layout/DashboardShell';
import { clientsAPI, stocksAPI } from '@/lib/api';
import { fc, fp } from '@/lib/formatters';
import { getSession } from '@/lib/auth';
import toast from 'react-hot-toast';

const STRATS = [
  { id: 'aum',   label: 'AUM-Weighted' },
  { id: 'top30', label: 'Top 30% AUM'  },
  { id: 'equal', label: 'Equal Split'  }
];

function allocateForStock({ clients, stockClients, price, budget, strategy }) {
  const holdingMap = {};
  (stockClients || []).forEach(h => { holdingMap[h.client_id] = h; });

  const pool = clients.map(c => ({
    ...c,
    aum:    parseFloat(c.aum) || parseFloat(c.total_current) || 0,
    curVal: parseFloat((holdingMap[c.id] || {}).value) || 0,
    curQty: parseFloat((holdingMap[c.id] || {}).qty)   || 0
  })).filter(c => c.aum > 0);

  if (!pool.length) return [];

  const totalAUM = pool.reduce((s, c) => s + c.aum, 0);
  const sorted   = [...pool].sort((a, b) => b.aum - a.aum);
  const topN     = Math.max(1, Math.ceil(pool.length * 0.3));
  const topIds   = new Set(sorted.slice(0, topN).map(c => c.id));

  const weights = pool.map(c => {
    switch (strategy) {
      case 'aum':   return c.aum;
      case 'top30': return topIds.has(c.id) ? c.aum : 0;
      case 'equal': return 1;
      default:      return c.aum;
    }
  });

  const totalW = weights.reduce((s, w) => s + w, 0);
  if (!totalW) return [];

  return pool.map((c, i) => {
    const share        = weights[i] / totalW;
    const allocAmount  = share * budget;
    const buyQty       = price > 0 ? Math.floor(allocAmount / price) : 0;
    const actualAmount = buyQty * price;
    return { ...c, share, allocAmount, buyQty, actualAmount };
  }).filter(c => c.buyQty > 0);
}

const EMPTY_STOCK = () => ({ symbol: '', price: '', budget: '', data: null, fetching: false, results: null });

export default function BulkPage() {
  const router = useRouter();
  const [clients,  setClients]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [strategy, setStrategy] = useState('aum');
  const [stocks,   setStocks]   = useState([EMPTY_STOCK()]);

  useEffect(() => {
    const { token } = getSession();
    if (!token) { router.replace('/login'); return; }
    clientsAPI.list()
      .then(d => setClients(Array.isArray(d) ? d : []))
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  function updateStock(idx, patch) {
    setStocks(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  }

  function addRow() {
    setStocks(prev => [...prev, EMPTY_STOCK()]);
  }

  function removeRow(idx) {
    setStocks(prev => prev.filter((_, i) => i !== idx));
  }

  async function fetchStock(idx) {
    const sym = stocks[idx].symbol.trim().toUpperCase();
    if (!sym) { toast.error('Enter a symbol'); return; }
    updateStock(idx, { fetching: true, data: null, results: null });
    try {
      const d = await stocksAPI.get(sym);
      updateStock(idx, { symbol: d.symbol, data: d, fetching: false });
      toast.success(`Loaded ${d.symbol}`);
    } catch (e) {
      toast.error(e.message || 'Not found');
      updateStock(idx, { fetching: false });
    }
  }

  function runAll() {
    let anyRan = false;
    setStocks(prev => prev.map(s => {
      if (!s.data || !s.price || !s.budget) return s;
      const results = allocateForStock({
        clients,
        stockClients: s.data.clients || [],
        price:    parseFloat(s.price),
        budget:   parseFloat(s.budget),
        strategy
      });
      anyRan = true;
      return { ...s, results };
    }));
    if (!anyRan) toast.error('Load at least one stock with price and budget');
  }

  function exportCSV() {
    const ranStocks = stocks.filter(s => s.results);
    if (!ranStocks.length) return;

    // Build a unified client→stock matrix
    const clientMap = {};
    clients.forEach(c => { clientMap[c.id] = { name: c.name, aum: c.aum || c.total_current || 0 }; });

    const rows = [];
    const header = ['Client', 'AUM', ...ranStocks.map(s => `${s.symbol} Qty`), ...ranStocks.map(s => `${s.symbol} Amt`)];
    rows.push(header);

    const allClientIds = new Set();
    ranStocks.forEach(s => s.results.forEach(r => allClientIds.add(r.id)));

    allClientIds.forEach(cid => {
      const info = clientMap[cid] || {};
      const row  = [info.name || cid, (info.aum || 0).toFixed(0)];
      ranStocks.forEach(s => {
        const r = s.results.find(x => x.id === cid);
        row.push(r ? r.buyQty : 0);
      });
      ranStocks.forEach(s => {
        const r = s.results.find(x => x.id === cid);
        row.push(r ? r.actualAmount.toFixed(0) : 0);
      });
      rows.push(row);
    });

    const csv = rows.map(r => r.join(',')).join('\n');
    const a   = document.createElement('a');
    a.href    = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = `bulk_deploy_${strategy}.csv`;
    a.click();
  }

  // Summary totals per stock
  const stockTotals = stocks.map(s => ({
    symbol:      s.symbol,
    totalAmount: s.results?.reduce((sum, r) => sum + r.actualAmount, 0) || 0,
    totalQty:    s.results?.reduce((sum, r) => sum + r.buyQty, 0) || 0,
    clientCount: s.results?.length || 0
  }));
  const grandTotal = stockTotals.reduce((s, x) => s + x.totalAmount, 0);

  if (loading) return (
    <DashboardShell title="Bulk Deploy">
      <div style={{ padding: 48, textAlign: 'center' }}><div className="spin" /></div>
    </DashboardShell>
  );

  return (
    <DashboardShell title="Bulk Deploy" subtitle="Deploy multiple stocks across clients in one go">

      {/* Strategy + controls */}
      <div className="panel" style={{ padding: '14px 16px', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1 }}>Strategy:</span>
          {STRATS.map(s => (
            <button
              key={s.id} onClick={() => setStrategy(s.id)}
              style={{
                padding: '5px 14px', fontSize: 10, fontWeight: 600, cursor: 'pointer', borderRadius: 'var(--r)',
                background: strategy === s.id ? 'var(--gold)' : 'var(--sur)',
                color:      strategy === s.id ? '#000' : 'var(--ink3)',
                border:     strategy === s.id ? 'none' : '1px solid var(--bdr)'
              }}
            >
              {s.label}
            </button>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button
              onClick={runAll}
              style={{ padding: '6px 18px', background: '#1a5a2a', color: '#fff', border: 'none', borderRadius: 'var(--r)', fontWeight: 700, cursor: 'pointer', fontSize: 11 }}
            >
              Run All →
            </button>
            <button
              onClick={exportCSV}
              style={{ padding: '6px 14px', background: 'var(--sur)', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', fontWeight: 600, cursor: 'pointer', fontSize: 10, color: 'var(--ink2)' }}
            >
              ↓ CSV
            </button>
          </div>
        </div>

        {/* Stock rows */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr 1fr auto auto', gap: '8px 10px', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--ink4)', textTransform: 'uppercase', letterSpacing: 1 }}>Symbol</div>
          <div style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--ink4)', textTransform: 'uppercase', letterSpacing: 1 }}>Price (₹)</div>
          <div style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--ink4)', textTransform: 'uppercase', letterSpacing: 1 }}>Budget (₹)</div>
          <div />
          <div />
        </div>
        {stocks.map((s, idx) => (
          <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr 1fr auto auto', gap: '6px 10px', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                value={s.symbol} placeholder="e.g. HDFC"
                onChange={e => updateStock(idx, { symbol: e.target.value.toUpperCase(), data: null, results: null })}
                onKeyDown={e => e.key === 'Enter' && fetchStock(idx)}
                style={{ flex: 1, padding: '7px 10px', border: `1px solid ${s.data ? 'var(--grnbdr)' : 'var(--bdr)'}`, borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)', fontSize: 11, outline: 'none' }}
              />
              <button
                onClick={() => fetchStock(idx)} disabled={s.fetching}
                style={{ padding: '7px 10px', background: s.data ? '#1a5a2a' : 'var(--gold)', border: 'none', borderRadius: 'var(--r)', fontWeight: 700, cursor: 'pointer', fontSize: 11, color: s.data ? '#fff' : '#000' }}
              >
                {s.fetching ? '…' : s.data ? '✓' : 'Load'}
              </button>
            </div>
            <input
              type="number" min="0" step="0.05" value={s.price} placeholder="0.00"
              onChange={e => updateStock(idx, { price: e.target.value, results: null })}
              style={{ padding: '7px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)', fontSize: 11, outline: 'none' }}
            />
            <input
              type="number" min="0" value={s.budget} placeholder="0"
              onChange={e => updateStock(idx, { budget: e.target.value, results: null })}
              style={{ padding: '7px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)', fontSize: 11, outline: 'none' }}
            />
            <div style={{ fontSize: 10, color: s.results ? 'var(--green)' : 'var(--ink4)', fontWeight: 600, whiteSpace: 'nowrap' }}>
              {s.results
                ? `${s.results.length}c / ${fc(s.results.reduce((x, r) => x + r.actualAmount, 0))}`
                : s.data ? `${s.data.client_count} clients` : '—'
              }
            </div>
            <button
              onClick={() => removeRow(idx)}
              style={{ padding: '6px 8px', background: 'none', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', cursor: 'pointer', color: 'var(--red)', fontSize: 12, fontWeight: 700 }}
            >
              ×
            </button>
          </div>
        ))}
        <button
          onClick={addRow}
          style={{ marginTop: 4, padding: '6px 14px', background: 'var(--sur)', border: '1.5px dashed var(--bdr)', borderRadius: 'var(--r)', cursor: 'pointer', fontSize: 10, fontWeight: 600, color: 'var(--ink3)' }}
        >
          + Add Stock
        </button>
      </div>

      {/* Summary tiles */}
      {grandTotal > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 14 }}>
          <div className="panel" style={{ padding: '8px 12px' }}>
            <div style={{ fontSize: 8.5, color: 'var(--ink4)', marginBottom: 2 }}>Grand Total Outlay</div>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--gold)' }}>{fc(grandTotal)}</div>
          </div>
          <div className="panel" style={{ padding: '8px 12px' }}>
            <div style={{ fontSize: 8.5, color: 'var(--ink4)', marginBottom: 2 }}>Stocks Deployed</div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{stocks.filter(s => s.results).length}</div>
          </div>
          <div className="panel" style={{ padding: '8px 12px' }}>
            <div style={{ fontSize: 8.5, color: 'var(--ink4)', marginBottom: 2 }}>Strategy</div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{STRATS.find(s => s.id === strategy)?.label}</div>
          </div>
          <div className="panel" style={{ padding: '8px 12px' }}>
            <div style={{ fontSize: 8.5, color: 'var(--ink4)', marginBottom: 2 }}>Total Clients</div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{clients.length}</div>
          </div>
        </div>
      )}

      {/* Per-stock result tables */}
      {stocks.filter(s => s.results).map((s, idx) => (
        <div key={idx} className="tbl" style={{ marginBottom: 16 }}>
          <div className="tbl-hd">
            <span className="tbl-ht">{s.symbol} — {fc(s.results.reduce((x, r) => x + r.actualAmount, 0))} across {s.results.length} clients</span>
            <span style={{ fontSize: 10, color: 'var(--ink3)' }}>@ ₹{s.price} · Budget {fc(parseFloat(s.budget))}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Client</th>
                <th style={{ textAlign: 'right' }}>AUM</th>
                <th style={{ textAlign: 'right' }}>Cur Holding</th>
                <th style={{ textAlign: 'right' }}>Buy Qty</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th style={{ textAlign: 'right' }}>Weight</th>
              </tr>
            </thead>
            <tbody>
              {s.results.map((r, i) => (
                <tr key={r.id}>
                  <td style={{ color: 'var(--ink4)', fontWeight: 700 }}>{i + 1}</td>
                  <td style={{ fontWeight: 600 }}>{r.name}</td>
                  <td style={{ textAlign: 'right', color: 'var(--ink3)' }}>{fc(r.aum)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--ink3)' }}>{r.curVal > 0 ? fc(r.curVal) : '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--green)' }}>{r.buyQty.toLocaleString('en-IN')}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--gold)' }}>{fc(r.actualAmount)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--ink3)' }}>{fp(r.share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {!stocks.some(s => s.results) && (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink4)' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⊞</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Add stocks, set prices and budgets, then Run All</div>
          <div style={{ fontSize: 11, marginTop: 6 }}>Load symbol → enter price + budget → Run All</div>
        </div>
      )}
    </DashboardShell>
  );
}
