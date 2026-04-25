'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardShell from '@/components/layout/DashboardShell';
import KPICard from '@/components/ui/KPICard';
import { clientsAPI, stocksAPI } from '@/lib/api';
import { fc, fsp } from '@/lib/formatters';
import { getSession } from '@/lib/auth';
import toast from 'react-hot-toast';

export default function SimulatorPage() {
  const router = useRouter();
  const [clients, setClients] = useState([]);
  const [stocks, setStocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selClient, setSelClient] = useState('');
  const [symbol, setSymbol] = useState('');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [mode, setMode] = useState('BUY');
  const [result, setResult] = useState(null);

  useEffect(() => {
    const { token } = getSession();
    if (!token) { router.replace('/login'); return; }

    Promise.all([
      clientsAPI.list(),
      stocksAPI.list()
    ]).then(([c, s]) => {
      setClients(c.clients || []);
      setStocks(s.stocks || []);
    }).catch(err => console.error(err)).finally(() => setLoading(false));
  }, []);

  const handleSimulate = () => {
    if (!selClient || !symbol || !quantity || !price) {
      toast.error('All fields required');
      return;
    }

    const client = clients.find(c => c.id === selClient);
    if (!client) return;

    const qty = parseInt(quantity) || 0;
    const p = parseFloat(price) || 0;
    const tradeValue = qty * p;

    // Calculate new allocation
    const currentPort = client.totalCurrent || 0;
    const currentAlloc = (client.holdings?.find(h => h.symbol === symbol)?.value || 0) / currentPort;
    const newValue = currentAlloc + (mode === 'BUY' ? tradeValue : -tradeValue);
    const newAlloc = newValue / (currentPort + (mode === 'BUY' ? tradeValue : -tradeValue));

    // Check limit breach
    const maxAlloc = 0.10; // 10% per stock limit
    const breached = newAlloc > maxAlloc;

    setResult({
      symbol,
      mode,
      quantity: qty,
      price: p,
      tradeValue,
      currentAlloc: currentAlloc,
      newAlloc: newAlloc,
      breached,
      suggestion: breached ? `Exceeds 10% limit. Max quantity: ${Math.floor(currentPort * maxAlloc / p)}` : 'Within limits'
    });
  };

  if (loading) return <DashboardShell title="Pre-Trade Simulator"><div style={{ padding: 48, textAlign: 'center' }}><div className="spin" /></div></DashboardShell>;

  return (
    <DashboardShell title="Pre-Trade Simulator" subtitle="Test trades before execution">
      {/* Input form */}
      <div className="panel" style={{ padding: '14px 16px', marginBottom: 20 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
          Trade Parameters
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 9, color: 'var(--ink3)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Client</label>
            <select
              value={selClient}
              onChange={e => setSelClient(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)' }}
            >
              <option value="">Select client</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 9, color: 'var(--ink3)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Symbol</label>
            <input
              type="text"
              value={symbol}
              onChange={e => setSymbol(e.target.value.toUpperCase())}
              placeholder="e.g., RELIANCE"
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)' }}
            />
          </div>
          <div>
            <label style={{ fontSize: 9, color: 'var(--ink3)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Mode</label>
            <select
              value={mode}
              onChange={e => setMode(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)' }}
            >
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 9, color: 'var(--ink3)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Quantity</label>
            <input
              type="number"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              placeholder="0"
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)' }}
            />
          </div>
          <div>
            <label style={{ fontSize: 9, color: 'var(--ink3)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Price</label>
            <input
              type="number"
              step="0.01"
              value={price}
              onChange={e => setPrice(e.target.value)}
              placeholder="0.00"
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)' }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button
              onClick={handleSimulate}
              style={{ width: '100%', padding: '8px 14px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 'var(--r)', fontWeight: 600, cursor: 'pointer' }}
            >
              Simulate
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      {result && (
        <div className="panel" style={{ padding: '14px 16px', border: `1.5px solid ${result.breached ? 'var(--redbdr)' : 'var(--grnbdr)'}`, background: result.breached ? 'var(--red2)' : 'var(--grn2)' }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: result.breached ? 'var(--red)' : 'var(--green)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            {result.breached ? 'Limit Breach' : 'Within Limits'}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 9, color: 'var(--ink4)', marginBottom: 2 }}>Trade Value</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{fc(result.tradeValue)}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: 'var(--ink4)', marginBottom: 2 }}>Current Allocation</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{fsp(result.currentAlloc)}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: 'var(--ink4)', marginBottom: 2 }}>New Allocation</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: result.breached ? 'var(--red)' : 'var(--green)' }}>{fsp(result.newAlloc)}</div>
            </div>
          </div>

          <div style={{ fontSize: 11, color: 'var(--ink)', padding: '10px', background: 'rgba(0,0,0,.1)', borderRadius: 'var(--r)' }}>
            {result.suggestion}
          </div>
        </div>
      )}

      {!result && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink4)' }}>
          Enter trade parameters and click Simulate to see impact
        </div>
      )}
    </DashboardShell>
  );
}
