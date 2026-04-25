'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardShell from '@/components/layout/DashboardShell';
import { clientsAPI, stocksAPI } from '@/lib/api';
import { fc, fp } from '@/lib/formatters';
import { getSession } from '@/lib/auth';
import toast from 'react-hot-toast';

// Given a client's portfolio, compute buy/sell for each target stock
function computeClientPlan(client, targetStocks) {
  const aum = parseFloat(client.aum) || parseFloat(client.total_current) || 0;
  if (!aum) return [];
  return targetStocks.map(t => {
    const curVal  = parseFloat((t.holdingMap || {})[client.id]?.value) || 0;
    const curPct  = aum > 0 ? curVal / aum : 0;
    const tgtPct  = parseFloat(t.targetPct) / 100;
    const tgtVal  = tgtPct * aum;
    const diff    = tgtVal - curVal;
    const buyQty  = t.price > 0 ? Math.round(Math.abs(diff) / t.price) : 0;
    const action  = diff > 0 ? 'BUY' : diff < 0 ? 'SELL' : 'HOLD';
    const amount  = buyQty * t.price;
    return { symbol: t.symbol, curVal, curPct, tgtPct, tgtVal, diff, action, buyQty, amount };
  });
}

const EMPTY_TARGET = () => ({ symbol: '', price: '', targetPct: '5', data: null, fetching: false, holdingMap: {} });

export default function DeployPage() {
  const router = useRouter();
  const [clients,  setClients]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [targets,  setTargets]  = useState([EMPTY_TARGET()]);
  const [plan,     setPlan]     = useState(null);
  const [selClients, setSelClients] = useState(new Set());
  const [showClientFilter, setShowClientFilter] = useState(false);

  useEffect(() => {
    const { token } = getSession();
    if (!token) { router.replace('/login'); return; }
    clientsAPI.list()
      .then(d => {
        const arr = Array.isArray(d) ? d : [];
        setClients(arr);
        setSelClients(new Set(arr.map(c => c.id)));
      })
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  function updateTarget(idx, patch) {
    setTargets(prev => prev.map((t, i) => i === idx ? { ...t, ...patch } : t));
    setPlan(null);
  }

  function addTarget() {
    setTargets(prev => [...prev, EMPTY_TARGET()]);
  }

  function removeTarget(idx) {
    setTargets(prev => prev.filter((_, i) => i !== idx));
    setPlan(null);
  }

  async function fetchStock(idx) {
    const sym = targets[idx].symbol.trim().toUpperCase();
    if (!sym) { toast.error('Enter symbol'); return; }
    updateTarget(idx, { fetching: true, data: null, holdingMap: {} });
    try {
      const d = await stocksAPI.get(sym);
      const holdingMap = {};
      (d.clients || []).forEach(h => { holdingMap[h.client_id] = h; });
      updateTarget(idx, { symbol: d.symbol, data: d, holdingMap, fetching: false });
      toast.success(`Loaded ${d.symbol}`);
    } catch (e) {
      toast.error(e.message || 'Not found');
      updateTarget(idx, { fetching: false });
    }
  }

  function runPlan() {
    const ready = targets.filter(t => t.data && t.price && t.targetPct);
    if (!ready.length) { toast.error('Load at least one stock with price and target %'); return; }

    const activeClients = clients.filter(c => selClients.has(c.id));
    const result = activeClients.map(client => {
      const items = computeClientPlan(client, ready);
      const totalBuy  = items.filter(x => x.action === 'BUY').reduce((s, x) => s + x.amount, 0);
      const totalSell = items.filter(x => x.action === 'SELL').reduce((s, x) => s + x.amount, 0);
      return { ...client, items, totalBuy, totalSell, netCash: totalSell - totalBuy };
    }).filter(c => c.items.some(x => x.action !== 'HOLD'));

    setPlan(result);
    if (!result.length) toast.error('No trades needed — all clients already at targets');
  }

  function exportCSV() {
    if (!plan) return;
    const ready = targets.filter(t => t.data && t.price && t.targetPct);
    const header = ['Client', 'AUM', ...ready.flatMap(t => [`${t.symbol} Cur%`, `${t.symbol} Tgt%`, `${t.symbol} Action`, `${t.symbol} Qty`, `${t.symbol} Amt`])];
    const rows = plan.map(c => [
      c.name,
      (parseFloat(c.aum) || 0).toFixed(0),
      ...c.items.flatMap(x => [
        (x.curPct * 100).toFixed(2),
        (x.tgtPct * 100).toFixed(2),
        x.action,
        x.buyQty,
        x.amount.toFixed(0)
      ])
    ]);
    const csv = [header, ...rows].map(r => r.join(',')).join('\n');
    const a   = document.createElement('a');
    a.href    = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = 'deploy_plan.csv';
    a.click();
  }

  const totalBuyOutlay = plan?.reduce((s, c) => s + c.totalBuy, 0) || 0;
  const ready          = targets.filter(t => t.data && t.price && t.targetPct);

  if (loading) return (
    <DashboardShell title="Deploy Planner">
      <div style={{ padding: 48, textAlign: 'center' }}><div className="spin" /></div>
    </DashboardShell>
  );

  return (
    <DashboardShell title="Deploy Planner" subtitle="Set target allocations per stock — get client-wise buy/sell plan">

      {/* Target stocks */}
      <div className="panel" style={{ padding: '14px 16px', marginBottom: 14 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
          Target Stocks
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr 1fr auto auto', gap: '6px 10px', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--ink4)', textTransform: 'uppercase', letterSpacing: 1 }}>Symbol</div>
          <div style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--ink4)', textTransform: 'uppercase', letterSpacing: 1 }}>Current Price (₹)</div>
          <div style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--ink4)', textTransform: 'uppercase', letterSpacing: 1 }}>Target % of Portfolio</div>
          <div />
          <div />
        </div>

        {targets.map((t, idx) => (
          <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr 1fr auto auto', gap: '6px 10px', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                value={t.symbol} placeholder="e.g. INFY"
                onChange={e => updateTarget(idx, { symbol: e.target.value.toUpperCase(), data: null, holdingMap: {} })}
                onKeyDown={e => e.key === 'Enter' && fetchStock(idx)}
                style={{ flex: 1, padding: '7px 10px', border: `1px solid ${t.data ? 'var(--grnbdr)' : 'var(--bdr)'}`, borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)', fontSize: 11, outline: 'none' }}
              />
              <button
                onClick={() => fetchStock(idx)} disabled={t.fetching}
                style={{ padding: '7px 10px', background: t.data ? '#1a5a2a' : 'var(--gold)', border: 'none', borderRadius: 'var(--r)', fontWeight: 700, cursor: 'pointer', fontSize: 11, color: t.data ? '#fff' : '#000' }}
              >
                {t.fetching ? '…' : t.data ? '✓' : 'Load'}
              </button>
            </div>
            <input
              type="number" min="0" step="0.05" value={t.price} placeholder="0.00"
              onChange={e => updateTarget(idx, { price: e.target.value })}
              style={{ padding: '7px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)', fontSize: 11, outline: 'none' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="number" min="0" max="100" step="0.5" value={t.targetPct} placeholder="5"
                onChange={e => updateTarget(idx, { targetPct: e.target.value })}
                style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)', fontSize: 11, outline: 'none' }}
              />
              <span style={{ fontSize: 10, color: 'var(--ink4)' }}>%</span>
            </div>
            <div style={{ fontSize: 9, color: 'var(--ink4)', whiteSpace: 'nowrap' }}>
              {t.data ? `${t.data.client_count} clients` : '—'}
            </div>
            <button
              onClick={() => removeTarget(idx)}
              style={{ padding: '6px 8px', background: 'none', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', cursor: 'pointer', color: 'var(--red)', fontSize: 12, fontWeight: 700 }}
            >
              ×
            </button>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            onClick={addTarget}
            style={{ padding: '6px 14px', background: 'var(--sur)', border: '1.5px dashed var(--bdr)', borderRadius: 'var(--r)', cursor: 'pointer', fontSize: 10, fontWeight: 600, color: 'var(--ink3)' }}
          >
            + Add Stock
          </button>

          {/* Client filter */}
          <button
            onClick={() => setShowClientFilter(v => !v)}
            style={{ padding: '6px 14px', background: 'var(--sur)', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', cursor: 'pointer', fontSize: 10, fontWeight: 600, color: 'var(--ink3)' }}
          >
            {showClientFilter ? '▲' : '▼'} Clients ({selClients.size}/{clients.length})
          </button>

          <button
            onClick={runPlan}
            style={{ marginLeft: 'auto', padding: '6px 20px', background: '#1a5a2a', color: '#fff', border: 'none', borderRadius: 'var(--r)', fontWeight: 700, cursor: 'pointer', fontSize: 11 }}
          >
            Generate Plan →
          </button>
          {plan && (
            <button
              onClick={exportCSV}
              style={{ padding: '6px 14px', background: 'var(--sur)', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', fontWeight: 600, cursor: 'pointer', fontSize: 10, color: 'var(--ink2)' }}
            >
              ↓ CSV
            </button>
          )}
        </div>

        {showClientFilter && (
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8, padding: '8px 10px', background: 'var(--sur)', borderRadius: 'var(--r)', border: '1px solid var(--bdr)' }}>
            <button
              onClick={() => setSelClients(new Set(clients.map(c => c.id)))}
              style={{ padding: '3px 10px', fontSize: 9, fontWeight: 700, background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 'var(--r)', cursor: 'pointer' }}
            >
              All
            </button>
            <button
              onClick={() => setSelClients(new Set())}
              style={{ padding: '3px 10px', fontSize: 9, fontWeight: 700, background: 'var(--sur2)', color: 'var(--ink3)', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', cursor: 'pointer' }}
            >
              None
            </button>
            {clients.map(c => (
              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, cursor: 'pointer', color: 'var(--ink2)' }}>
                <input
                  type="checkbox" checked={selClients.has(c.id)}
                  onChange={e => {
                    setSelClients(prev => {
                      const next = new Set(prev);
                      e.target.checked ? next.add(c.id) : next.delete(c.id);
                      return next;
                    });
                    setPlan(null);
                  }}
                />
                {c.name}
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Plan summary */}
      {plan && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 14 }}>
          <div className="panel" style={{ padding: '8px 12px' }}>
            <div style={{ fontSize: 8.5, color: 'var(--ink4)', marginBottom: 2 }}>Total Buy Outlay</div>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--gold)' }}>{fc(totalBuyOutlay)}</div>
          </div>
          <div className="panel" style={{ padding: '8px 12px' }}>
            <div style={{ fontSize: 8.5, color: 'var(--ink4)', marginBottom: 2 }}>Clients with Trades</div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{plan.length}</div>
          </div>
          <div className="panel" style={{ padding: '8px 12px' }}>
            <div style={{ fontSize: 8.5, color: 'var(--ink4)', marginBottom: 2 }}>Stocks Targeted</div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{ready.length}</div>
          </div>
          <div className="panel" style={{ padding: '8px 12px' }}>
            <div style={{ fontSize: 8.5, color: 'var(--ink4)', marginBottom: 2 }}>Total Sell Proceeds</div>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--green)' }}>{fc(plan.reduce((s, c) => s + c.totalSell, 0))}</div>
          </div>
        </div>
      )}

      {/* Per-client plan */}
      {plan && plan.map((client, ci) => (
        <div key={client.id} className="panel" style={{ padding: '14px 16px', marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div>
              <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--ink)' }}>{client.name}</span>
              <span style={{ marginLeft: 10, fontSize: 9, color: 'var(--ink4)' }}>AUM: {fc(parseFloat(client.aum) || 0)}</span>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              {client.totalBuy > 0 && (
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--green)' }}>
                  Buy {fc(client.totalBuy)}
                </span>
              )}
              {client.totalSell > 0 && (
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--red)' }}>
                  Sell {fc(client.totalSell)}
                </span>
              )}
              <span style={{ fontSize: 10, fontWeight: 700, color: client.netCash >= 0 ? 'var(--green)' : 'var(--red)' }}>
                Net {client.netCash >= 0 ? '+' : ''}{fc(client.netCash)}
              </span>
            </div>
          </div>
          <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--bdr)' }}>
                <th style={{ textAlign: 'left', padding: '4px 0', fontWeight: 700, color: 'var(--ink3)', fontSize: 9 }}>Stock</th>
                <th style={{ textAlign: 'right', padding: '4px 0', fontWeight: 700, color: 'var(--ink3)', fontSize: 9 }}>Cur Value</th>
                <th style={{ textAlign: 'right', padding: '4px 0', fontWeight: 700, color: 'var(--ink3)', fontSize: 9 }}>Cur %</th>
                <th style={{ textAlign: 'right', padding: '4px 0', fontWeight: 700, color: 'var(--ink3)', fontSize: 9 }}>Target %</th>
                <th style={{ textAlign: 'right', padding: '4px 0', fontWeight: 700, color: 'var(--ink3)', fontSize: 9 }}>Action</th>
                <th style={{ textAlign: 'right', padding: '4px 0', fontWeight: 700, color: 'var(--ink3)', fontSize: 9 }}>Qty</th>
                <th style={{ textAlign: 'right', padding: '4px 0', fontWeight: 700, color: 'var(--ink3)', fontSize: 9 }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {client.items.map((item, ii) => (
                <tr key={ii} style={{ borderBottom: ii < client.items.length - 1 ? '1px solid var(--bdr)' : 'none' }}>
                  <td style={{ padding: '5px 0', fontWeight: 600, color: 'var(--gold)' }}>{item.symbol}</td>
                  <td style={{ padding: '5px 0', textAlign: 'right', color: 'var(--ink3)' }}>{item.curVal > 0 ? fc(item.curVal) : '—'}</td>
                  <td style={{ padding: '5px 0', textAlign: 'right', color: 'var(--ink3)' }}>{fp(item.curPct)}</td>
                  <td style={{ padding: '5px 0', textAlign: 'right', color: 'var(--ink4)' }}>{fp(item.tgtPct)}</td>
                  <td style={{ padding: '5px 0', textAlign: 'right' }}>
                    <span style={{
                      fontWeight: 700,
                      padding: '2px 8px', borderRadius: 10, fontSize: 9,
                      background: item.action === 'BUY' ? 'var(--grn2)' : item.action === 'SELL' ? 'var(--red2)' : 'var(--sur2)',
                      color:      item.action === 'BUY' ? 'var(--green)' : item.action === 'SELL' ? 'var(--red)' : 'var(--ink4)'
                    }}>
                      {item.action}
                    </span>
                  </td>
                  <td style={{ padding: '5px 0', textAlign: 'right', fontWeight: 700, color: item.action === 'BUY' ? 'var(--green)' : 'var(--red)' }}>
                    {item.action !== 'HOLD' ? item.buyQty.toLocaleString('en-IN') : '—'}
                  </td>
                  <td style={{ padding: '5px 0', textAlign: 'right', fontWeight: 700, color: 'var(--ink)' }}>
                    {item.action !== 'HOLD' ? fc(item.amount) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {!plan && (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink4)' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>◎</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Configure target stocks and generate plan</div>
          <div style={{ fontSize: 11, marginTop: 6 }}>Load symbols → set prices + target % → Generate Plan</div>
        </div>
      )}
    </DashboardShell>
  );
}
