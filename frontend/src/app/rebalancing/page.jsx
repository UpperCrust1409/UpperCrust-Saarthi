'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardShell from '@/components/layout/DashboardShell';
import KPICard from '@/components/ui/KPICard';
import { clientsAPI } from '@/lib/api';
import { fc, fsp } from '@/lib/formatters';
import { getSession } from '@/lib/auth';

export default function RebalancingPage() {
  const router = useRouter();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { token } = getSession();
    if (!token) { router.replace('/login'); return; }

    clientsAPI.list().then(c => {
      setClients(c.clients || []);
    }).catch(err => console.error(err)).finally(() => setLoading(false));
  }, []);

  if (loading) return <DashboardShell title="Rebalancing"><div style={{ padding: 48, textAlign: 'center' }}><div className="spin" /></div></DashboardShell>;

  // Identify clients needing rebalancing
  const needsRebalancing = clients.filter(c => {
    const holdings = c.holdings || [];
    return holdings.some(h => {
      const alloc = h.value / (c.totalCurrent || 1);
      return alloc > 0.10; // 10% limit per stock
    });
  });

  const countAtLimit = needsRebalancing.length;

  return (
    <DashboardShell title="Rebalancing" subtitle="Identify and execute rebalancing trades">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 18 }}>
        <KPICard label="Portfolios Needing Rebalance" value={countAtLimit} variant={countAtLimit > 0 ? 'amb' : 'grn'} />
        <KPICard label="Total Clients" value={clients.length} />
        <KPICard label="Balanced Portfolios" value={clients.length - countAtLimit} variant="grn" />
        <KPICard label="Rebalancing %" value={countAtLimit > 0 ? ((countAtLimit / clients.length) * 100).toFixed(0) + '%' : '0%'} />
      </div>

      {/* Clients needing rebalancing */}
      {needsRebalancing.length > 0 ? (
        <div style={{ display: 'grid', gap: 16 }}>
          {needsRebalancing.map(c => {
            const holdings = c.holdings || [];
            const overweight = holdings.filter(h => (h.value / (c.totalCurrent || 1)) > 0.10);

            return (
              <div key={c.id} className="panel" style={{ padding: '14px 16px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)', marginBottom: 10 }}>
                  {c.name}
                  <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 700, background: 'var(--amb2)', color: 'var(--amber)', padding: '2px 6px', borderRadius: 3 }}>
                    {overweight.length} overweight
                  </span>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', fontSize: 10 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--bdr)' }}>
                        <th style={{ textAlign: 'left', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Symbol</th>
                        <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Current Value</th>
                        <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Current %</th>
                        <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Target %</th>
                        <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {holdings.map((h, i) => {
                        const alloc = h.value / (c.totalCurrent || 1);
                        const targetAlloc = 0.05; // Target 5% for each
                        const action = alloc > 0.10 ? 'SELL' : alloc < targetAlloc ? 'BUY' : 'HOLD';
                        const actionColor = action === 'SELL' ? 'var(--red)' : action === 'BUY' ? 'var(--green)' : 'var(--ink4)';

                        return (
                          <tr key={i} style={{ borderBottom: i < holdings.length - 1 ? '1px solid var(--bdr)' : 'none' }}>
                            <td style={{ padding: '6px 0', color: 'var(--ink)', fontWeight: 600 }}>{h.symbol}</td>
                            <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--ink2)' }}>{fc(h.value)}</td>
                            <td style={{ padding: '6px 0', textAlign: 'right', color: alloc > 0.10 ? 'var(--red)' : 'var(--ink3)' }}>{fsp(alloc)}</td>
                            <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--ink3)' }}>{fsp(targetAlloc)}</td>
                            <td style={{ padding: '6px 0', textAlign: 'right', fontWeight: 700, color: actionColor }}>{action}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink4)' }}>
          All portfolios are balanced and within limits
        </div>
      )}
    </DashboardShell>
  );
}
