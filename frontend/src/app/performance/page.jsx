'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardShell from '@/components/layout/DashboardShell';
import KPICard from '@/components/ui/KPICard';
import { clientsAPI } from '@/lib/api';
import { fc, fp, fsp, colorStyle } from '@/lib/formatters';
import { getSession } from '@/lib/auth';

export default function PerformancePage() {
  const router = useRouter();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { token } = getSession();
    if (!token) { router.replace('/login'); return; }

    clientsAPI.list().then(d => {
      setClients(d.clients || []);
    }).catch(err => {
      console.error(err);
      setClients([]);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <DashboardShell title="Performance"><div style={{ padding: 48, textAlign: 'center' }}><div className="spin" /></div></DashboardShell>;

  const totalRealized = clients.reduce((sum, c) => sum + (c.realizedPnL || 0), 0);
  const totalUnrealized = clients.reduce((sum, c) => sum + (c.unrealizedPnL || 0), 0);
  const avgReturn = clients.length ? clients.reduce((sum, c) => sum + (c.returnPct || 0), 0) / clients.length : 0;

  const sorted = [...clients].sort((a, b) => (b.returnPct || 0) - (a.returnPct || 0));
  const top = sorted.slice(0, 5);
  const bottom = sorted.slice(-5).reverse();

  return (
    <DashboardShell title="Performance" subtitle="Client-level returns and P&L">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 18 }}>
        <KPICard label="Avg Return" value={fsp(avgReturn)} variant={avgReturn >= 0 ? 'grn' : 'red'} />
        <KPICard label="Total Realized P&L" value={fc(totalRealized)} variant={totalRealized >= 0 ? 'grn' : 'red'} />
        <KPICard label="Total Unrealized P&L" value={fc(totalUnrealized)} variant={totalUnrealized >= 0 ? 'grn' : 'red'} />
        <KPICard label="Clients" value={clients.length} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        {/* Top performers */}
        <div className="panel" style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            Top Performers
          </div>
          {top.map((c, i) => (
            <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: i < top.length - 1 ? '1px solid var(--bdr)' : 'none' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)' }}>{c.name}</div>
              <div style={{ ...colorStyle(c.returnPct), fontSize: 11, fontWeight: 700 }}>{fsp(c.returnPct)}</div>
            </div>
          ))}
        </div>

        {/* Bottom performers */}
        <div className="panel" style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            Bottom Performers
          </div>
          {bottom.map((c, i) => (
            <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: i < bottom.length - 1 ? '1px solid var(--bdr)' : 'none' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)' }}>{c.name}</div>
              <div style={{ ...colorStyle(c.returnPct), fontSize: 11, fontWeight: 700 }}>{fsp(c.returnPct)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* P&L breakdown */}
      <div className="panel" style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
          Realized vs Unrealized
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 700, ...colorStyle(totalRealized), marginBottom: 4 }}>
              {fc(totalRealized)}
            </div>
            <div style={{ fontSize: 10, color: 'var(--ink3)' }}>Realized P&L</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 700, ...colorStyle(totalUnrealized), marginBottom: 4 }}>
              {fc(totalUnrealized)}
            </div>
            <div style={{ fontSize: 10, color: 'var(--ink3)' }}>Unrealized P&L</div>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
