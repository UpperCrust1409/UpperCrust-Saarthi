'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardShell from '@/components/layout/DashboardShell';
import KPICard from '@/components/ui/KPICard';
import { stocksAPI, clientsAPI } from '@/lib/api';
import { fc, fsp } from '@/lib/formatters';
import { getSession } from '@/lib/auth';

export default function BullionPage() {
  const router = useRouter();
  const [bullion, setBullion] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { token } = getSession();
    if (!token) { router.replace('/login'); return; }

    Promise.all([
      stocksAPI.list(),
      clientsAPI.list()
    ]).then(([s, c]) => {
      const bullionSymbols = ['GOLD', 'SILVER', 'SILVERBEES', 'SETFGOLD', 'GOLDBEES'];
      const filtered = (s.stocks || []).filter(st =>
        bullionSymbols.some(b => st.symbol.includes(b))
      );
      setBullion(filtered);
      setClients(c.clients || []);
    }).catch(err => console.error(err)).finally(() => setLoading(false));
  }, []);

  if (loading) return <DashboardShell title="Bullion Tracker"><div style={{ padding: 48, textAlign: 'center' }}><div className="spin" /></div></DashboardShell>;

  const goldTotal = bullion.filter(b => b.symbol.includes('GOLD')).reduce((sum, b) => sum + (b.value || 0), 0);
  const silverTotal = bullion.filter(b => b.symbol.includes('SILVER')).reduce((sum, b) => sum + (b.value || 0), 0);
  const portfolioTotal = clients.reduce((sum, c) => sum + (c.totalCurrent || 0), 0);

  return (
    <DashboardShell title="Bullion Tracker" subtitle="Gold and silver holdings">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 18 }}>
        <KPICard label="Gold Exposure" value={fc(goldTotal)} sub={fsp(portfolioTotal ? goldTotal / portfolioTotal : 0)} />
        <KPICard label="Silver Exposure" value={fc(silverTotal)} sub={fsp(portfolioTotal ? silverTotal / portfolioTotal : 0)} />
        <KPICard label="Total Bullion" value={fc(goldTotal + silverTotal)} sub={fsp(portfolioTotal ? (goldTotal + silverTotal) / portfolioTotal : 0)} />
        <KPICard label="Holdings" value={bullion.length} />
      </div>

      {/* Bullion breakdown */}
      <div className="panel" style={{ padding: '14px 16px', marginBottom: 20 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
          Bullion Holdings
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--bdr)' }}>
                <th style={{ textAlign: 'left', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Symbol</th>
                <th style={{ textAlign: 'left', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Type</th>
                <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Value</th>
                <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>% of Bullion</th>
              </tr>
            </thead>
            <tbody>
              {bullion.map((b, i) => {
                const pct = (goldTotal + silverTotal) ? b.value / (goldTotal + silverTotal) : 0;
                const type = b.symbol.includes('GOLD') ? 'Gold' : 'Silver';
                return (
                  <tr key={i} style={{ borderBottom: i < bullion.length - 1 ? '1px solid var(--bdr)' : 'none' }}>
                    <td style={{ padding: '6px 0', color: 'var(--ink)', fontWeight: 600 }}>{b.symbol}</td>
                    <td style={{ padding: '6px 0', color: 'var(--ink3)' }}>{type}</td>
                    <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--ink2)' }}>{fc(b.value)}</td>
                    <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--gold)', fontWeight: 700 }}>{fsp(pct)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Client holdings */}
      <div className="panel" style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
          Clients with Bullion
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }}>
          {clients.filter(c => (c.bullionExposure || 0) > 0).slice(0, 10).map(c => (
            <div key={c.id} style={{ padding: '8px 12px', background: 'var(--sur)', borderRadius: 'var(--r)', border: '1px solid var(--bdr)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink)', marginBottom: 2 }}>{c.name}</div>
              <div style={{ fontSize: 10, color: 'var(--ink3)' }}>{fc(c.bullionExposure)} ({fsp(c.bullionExposure / (c.totalCurrent || 1))})</div>
            </div>
          ))}
        </div>
      </div>
    </DashboardShell>
  );
}
