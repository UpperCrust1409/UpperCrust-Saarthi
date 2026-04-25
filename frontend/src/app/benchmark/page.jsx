'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardShell from '@/components/layout/DashboardShell';
import KPICard from '@/components/ui/KPICard';
import { clientsAPI } from '@/lib/api';
import { fsp, colorStyle } from '@/lib/formatters';
import { getSession } from '@/lib/auth';

export default function BenchmarkPage() {
  const router = useRouter();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [benchmarks, setBenchmarks] = useState({
    nifty50: 12.5,
    sensex: 13.2,
    custom: ''
  });
  const [form, setForm] = useState({ name: '', value: '' });

  useEffect(() => {
    const { token } = getSession();
    if (!token) { router.replace('/login'); return; }

    clientsAPI.list().then(c => {
      setClients(c.clients || []);
      // Load benchmarks from localStorage
      const saved = localStorage.getItem('saarthi_benchmarks');
      if (saved) {
        const parsed = JSON.parse(saved);
        setBenchmarks(prev => ({ ...prev, ...parsed }));
      }
    }).catch(err => console.error(err)).finally(() => setLoading(false));
  }, []);

  const handleAddBenchmark = () => {
    if (!form.name || !form.value) return;
    const updated = { ...benchmarks, [form.name]: parseFloat(form.value) };
    setBenchmarks(updated);
    localStorage.setItem('saarthi_benchmarks', JSON.stringify(updated));
    setForm({ name: '', value: '' });
  };

  if (loading) return <DashboardShell title="Benchmark Comparison"><div style={{ padding: 48, textAlign: 'center' }}><div className="spin" /></div></DashboardShell>;

  // Calculate alpha for each client
  const avgClientReturn = clients.length ? clients.reduce((sum, c) => sum + (c.returnPct || 0), 0) / clients.length : 0;
  const niftyBench = benchmarks.nifty50 || 0;
  const avgAlpha = avgClientReturn - niftyBench;

  return (
    <DashboardShell title="Benchmark Comparison" subtitle="Compare client returns against market benchmarks">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 18 }}>
        <KPICard label="Avg Client Return" value={fsp(avgClientReturn)} variant={avgClientReturn >= niftyBench ? 'grn' : 'red'} />
        <KPICard label="Nifty50 (Benchmark)" value={fsp(niftyBench)} />
        <KPICard label="Average Alpha" value={fsp(avgAlpha)} variant={avgAlpha >= 0 ? 'grn' : 'red'} />
        <KPICard label="Clients" value={clients.length} />
      </div>

      {/* Benchmark settings */}
      <div className="panel" style={{ padding: '14px 16px', marginBottom: 20 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
          Benchmark Inputs
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 9, color: 'var(--ink3)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Nifty50 Return %</label>
            <input
              type="number"
              step="0.01"
              value={benchmarks.nifty50}
              onChange={e => setBenchmarks(prev => ({ ...prev, nifty50: parseFloat(e.target.value) || 0 }))}
              style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)' }}
            />
          </div>
          <div>
            <label style={{ fontSize: 9, color: 'var(--ink3)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Sensex Return %</label>
            <input
              type="number"
              step="0.01"
              value={benchmarks.sensex}
              onChange={e => setBenchmarks(prev => ({ ...prev, sensex: parseFloat(e.target.value) || 0 }))}
              style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)' }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button
              onClick={() => localStorage.setItem('saarthi_benchmarks', JSON.stringify(benchmarks))}
              style={{ width: '100%', padding: '6px 10px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 'var(--r)', fontWeight: 600, cursor: 'pointer', fontSize: 10 }}
            >
              Save Benchmarks
            </button>
          </div>
        </div>

        {/* Add custom benchmark */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <input
            type="text"
            placeholder="Benchmark name"
            value={form.name}
            onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
            style={{ padding: '6px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)' }}
          />
          <input
            type="number"
            step="0.01"
            placeholder="Return %"
            value={form.value}
            onChange={e => setForm(prev => ({ ...prev, value: e.target.value }))}
            style={{ padding: '6px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)' }}
          />
          <button
            onClick={handleAddBenchmark}
            style={{ padding: '6px 10px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 'var(--r)', fontWeight: 600, cursor: 'pointer', fontSize: 10 }}
          >
            Add
          </button>
        </div>
      </div>

      {/* Client comparison table */}
      {clients.length > 0 ? (
        <div className="panel" style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            Client vs Benchmark
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 10 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--bdr)' }}>
                  <th style={{ textAlign: 'left', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Client</th>
                  <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Client Return %</th>
                  <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Nifty50 %</th>
                  <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Alpha vs Nifty50</th>
                  <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c, i) => {
                  const clientReturn = c.returnPct || 0;
                  const alpha = clientReturn - niftyBench;
                  const beat = alpha >= 0;

                  return (
                    <tr key={i} style={{ borderBottom: i < clients.length - 1 ? '1px solid var(--bdr)' : 'none' }}>
                      <td style={{ padding: '6px 0', color: 'var(--ink)', fontWeight: 600 }}>{c.name}</td>
                      <td style={{ padding: '6px 0', textAlign: 'right', ...colorStyle(clientReturn), fontWeight: 700 }}>
                        {fsp(clientReturn)}
                      </td>
                      <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--ink3)' }}>
                        {fsp(niftyBench)}
                      </td>
                      <td style={{ padding: '6px 0', textAlign: 'right', ...colorStyle(alpha), fontWeight: 700 }}>
                        {fsp(alpha)}
                      </td>
                      <td style={{ padding: '6px 0', textAlign: 'right' }}>
                        <span style={{ fontSize: 8, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: beat ? 'var(--grn2)' : 'var(--red2)', color: beat ? 'var(--green)' : 'var(--red)' }}>
                          {beat ? 'BEAT' : 'UNDERPERFORM'}
                        </span>
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
          No client data available
        </div>
      )}
    </DashboardShell>
  );
}
