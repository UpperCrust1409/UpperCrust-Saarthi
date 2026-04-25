'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardShell from '@/components/layout/DashboardShell';
import KPICard from '@/components/ui/KPICard';
import { stocksAPI } from '@/lib/api';
import { fc, fsp, colorStyle } from '@/lib/formatters';
import { getSession } from '@/lib/auth';
import toast from 'react-hot-toast';

export default function ConvictionPage() {
  const router = useRouter();
  const [convictions, setConvictions] = useState([]);
  const [stocks, setStocks] = useState({});
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ symbol: '', thesis: '', targetPrice: '', level: 'Medium' });

  useEffect(() => {
    const { token } = getSession();
    if (!token) { router.replace('/login'); return; }

    // Load convictions from localStorage
    const saved = localStorage.getItem('saarthi_convictions');
    const parsed = saved ? JSON.parse(saved) : [];
    setConvictions(parsed);

    // Fetch stock data
    stocksAPI.list().then(s => {
      const map = {};
      (s.stocks || []).forEach(st => map[st.symbol] = st);
      setStocks(map);
    }).catch(err => console.error(err)).finally(() => setLoading(false));
  }, []);

  const handleAdd = () => {
    if (!form.symbol.trim()) {
      toast.error('Symbol required');
      return;
    }
    const newConviction = {
      id: Date.now(),
      symbol: form.symbol.toUpperCase(),
      thesis: form.thesis,
      targetPrice: parseFloat(form.targetPrice) || 0,
      level: form.level,
      addedAt: new Date().toISOString()
    };
    const updated = [...convictions, newConviction];
    setConvictions(updated);
    localStorage.setItem('saarthi_convictions', JSON.stringify(updated));
    setForm({ symbol: '', thesis: '', targetPrice: '', level: 'Medium' });
    toast.success('Added to conviction list');
  };

  const handleRemove = (id) => {
    const updated = convictions.filter(c => c.id !== id);
    setConvictions(updated);
    localStorage.setItem('saarthi_convictions', JSON.stringify(updated));
    toast.success('Removed from conviction list');
  };

  if (loading) return <DashboardShell title="Conviction Tracker"><div style={{ padding: 48, textAlign: 'center' }}><div className="spin" /></div></DashboardShell>;

  const highCount = convictions.filter(c => c.level === 'High').length;
  const mediumCount = convictions.filter(c => c.level === 'Medium').length;
  const lowCount = convictions.filter(c => c.level === 'Low').length;

  return (
    <DashboardShell title="Conviction Tracker" subtitle="Track high-conviction stock ideas">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 18 }}>
        <KPICard label="High Conviction" value={highCount} variant="grn" />
        <KPICard label="Medium Conviction" value={mediumCount} variant="amb" />
        <KPICard label="Low Conviction" value={lowCount} />
        <KPICard label="Total Ideas" value={convictions.length} />
      </div>

      {/* Add form */}
      <div className="panel" style={{ padding: '14px 16px', marginBottom: 20 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
          Add Conviction
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 10 }}>
          <input
            type="text"
            placeholder="Symbol"
            value={form.symbol}
            onChange={e => setForm({...form, symbol: e.target.value})}
            style={{ padding: '6px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)' }}
          />
          <input
            type="text"
            placeholder="Thesis"
            value={form.thesis}
            onChange={e => setForm({...form, thesis: e.target.value})}
            style={{ gridColumn: 'span 2', padding: '6px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)' }}
          />
          <select
            value={form.level}
            onChange={e => setForm({...form, level: e.target.value})}
            style={{ padding: '6px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)' }}
          >
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
          <input
            type="number"
            placeholder="Target Price"
            value={form.targetPrice}
            onChange={e => setForm({...form, targetPrice: e.target.value})}
            style={{ padding: '6px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)' }}
          />
          <button
            onClick={handleAdd}
            style={{ gridColumn: 'span 4', padding: '8px 12px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 'var(--r)', fontWeight: 600, cursor: 'pointer' }}
          >
            Add to Tracker
          </button>
        </div>
      </div>

      {/* Convictions table */}
      {convictions.length > 0 ? (
        <div className="panel" style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            Conviction List
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 10 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--bdr)' }}>
                  <th style={{ textAlign: 'left', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Symbol</th>
                  <th style={{ textAlign: 'left', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Thesis</th>
                  <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Current Price</th>
                  <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Target</th>
                  <th style={{ textAlign: 'center', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Level</th>
                  <th style={{ textAlign: 'center', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Return</th>
                  <th style={{ textAlign: 'center', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {convictions.map((c, i) => {
                  const stock = stocks[c.symbol];
                  const targetReturn = c.targetPrice ? (c.targetPrice - (stock?.price || 0)) / (stock?.price || 1) : 0;
                  return (
                    <tr key={i} style={{ borderBottom: i < convictions.length - 1 ? '1px solid var(--bdr)' : 'none' }}>
                      <td style={{ padding: '6px 0', color: 'var(--ink)', fontWeight: 600 }}>{c.symbol}</td>
                      <td style={{ padding: '6px 0', color: 'var(--ink3)', fontSize: 9 }}>{c.thesis}</td>
                      <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--ink2)' }}>₹{stock?.price?.toFixed(2) || '—'}</td>
                      <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--ink2)' }}>₹{c.targetPrice || '—'}</td>
                      <td style={{ padding: '6px 0', textAlign: 'center' }}>
                        <span style={{ fontSize: 8, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: c.level === 'High' ? 'var(--grn2)' : c.level === 'Medium' ? 'var(--amb2)' : 'var(--sur)', color: c.level === 'High' ? 'var(--green)' : c.level === 'Medium' ? 'var(--amber)' : 'var(--ink3)' }}>
                          {c.level}
                        </span>
                      </td>
                      <td style={{ padding: '6px 0', textAlign: 'center', ...colorStyle(targetReturn), fontWeight: 600, fontSize: 9 }}>
                        {fsp(targetReturn)}
                      </td>
                      <td style={{ padding: '6px 0', textAlign: 'center' }}>
                        <button
                          onClick={() => handleRemove(c.id)}
                          style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontWeight: 600, fontSize: 10 }}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink4)' }}>
          No conviction stocks tracked yet
        </div>
      )}
    </DashboardShell>
  );
}
