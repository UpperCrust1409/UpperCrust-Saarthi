'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardShell from '@/components/layout/DashboardShell';
import KPICard from '@/components/ui/KPICard';
import { clientsAPI, dashboardAPI } from '@/lib/api';
import { fc, fsp } from '@/lib/formatters';
import { getSession } from '@/lib/auth';
import toast from 'react-hot-toast';

export default function CapitalPage() {
  const router = useRouter();
  const [clients, setClients] = useState([]);
  const [sectors, setSectors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selClient, setSelClient] = useState('');
  const [newCapital, setNewCapital] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    const { token } = getSession();
    if (!token) { router.replace('/login'); return; }

    Promise.all([
      clientsAPI.list(),
      dashboardAPI.get()
    ]).then(([c, d]) => {
      setClients(c.clients || []);
      setSectors(d.sectors || []);
    }).catch(err => console.error(err)).finally(() => setLoading(false));
  }, []);

  const handleCalculate = () => {
    if (!selClient || !newCapital) {
      toast.error('Select client and enter capital');
      return;
    }

    const client = clients.find(c => c.id === selClient);
    if (!client) return;

    const capital = parseFloat(newCapital) || 0;
    const newPortfolio = (client.totalCurrent || 0) + capital;

    // Suggest allocation based on current sector weights
    const allocationSuggestions = sectors.map(s => {
      const currentWeight = s.pct || 0;
      const suggestedAmount = (currentWeight * capital);
      return { ...s, suggestedAmount };
    });

    setResult({
      clientName: client.name,
      currentPortfolio: client.totalCurrent || 0,
      newCapital: capital,
      newPortfolio,
      suggestions: allocationSuggestions.filter(s => s.suggestedAmount > 0)
    });
  };

  if (loading) return <DashboardShell title="Capital Deploy"><div style={{ padding: 48, textAlign: 'center' }}><div className="spin" /></div></DashboardShell>;

  return (
    <DashboardShell title="Capital Deploy" subtitle="Plan new capital allocation">
      {/* Input form */}
      <div className="panel" style={{ padding: '14px 16px', marginBottom: 20 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
          Deployment Calculator
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          <div>
            <label style={{ fontSize: 9, color: 'var(--ink3)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Client</label>
            <select
              value={selClient}
              onChange={e => setSelClient(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)' }}
            >
              <option value="">Select client</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name} ({fc(c.totalCurrent || 0)})</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 9, color: 'var(--ink3)', fontWeight: 600, display: 'block', marginBottom: 4 }}>New Capital Amount</label>
            <input
              type="number"
              value={newCapital}
              onChange={e => setNewCapital(e.target.value)}
              placeholder="0"
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)' }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button
              onClick={handleCalculate}
              style={{ width: '100%', padding: '8px 14px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 'var(--r)', fontWeight: 600, cursor: 'pointer' }}
            >
              Calculate
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      {result && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 20 }}>
            <KPICard label="Current Portfolio" value={fc(result.currentPortfolio)} />
            <KPICard label="New Capital" value={fc(result.newCapital)} variant="grn" />
            <KPICard label="New Portfolio Value" value={fc(result.newPortfolio)} />
          </div>

          <div className="panel" style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
              Suggested Allocation by Sector
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--bdr)' }}>
                    <th style={{ textAlign: 'left', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Sector</th>
                    <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>% of New Capital</th>
                    <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Amount</th>
                    <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>New % of Portfolio</th>
                  </tr>
                </thead>
                <tbody>
                  {result.suggestions.slice(0, 10).map((s, i) => {
                    const newWeight = (s.value + s.suggestedAmount) / result.newPortfolio;
                    return (
                      <tr key={i} style={{ borderBottom: i < Math.min(10, result.suggestions.length) - 1 ? '1px solid var(--bdr)' : 'none' }}>
                        <td style={{ padding: '6px 0', color: 'var(--ink2)' }}>{s.name}</td>
                        <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--ink3)' }}>{fsp(s.pct)}</td>
                        <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--gold)', fontWeight: 700 }}>{fc(s.suggestedAmount)}</td>
                        <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--ink2)' }}>{fsp(newWeight)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!result && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink4)' }}>
          Enter client and capital amount to see allocation suggestions
        </div>
      )}
    </DashboardShell>
  );
}
