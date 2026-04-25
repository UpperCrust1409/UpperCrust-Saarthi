'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardShell from '@/components/layout/DashboardShell';
import KPICard from '@/components/ui/KPICard';
import { dashboardAPI } from '@/lib/api';
import { fc, fsp, colorStyle, SCOL } from '@/lib/formatters';
import { getSession } from '@/lib/auth';

export default function AttributionPage() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { token } = getSession();
    if (!token) { router.replace('/login'); return; }

    dashboardAPI.get().then(d => {
      setData(d);
    }).catch(err => {
      console.error(err);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <DashboardShell title="P&L Attribution"><div style={{ padding: 48, textAlign: 'center' }}><div className="spin" /></div></DashboardShell>;
  if (!data) return <DashboardShell title="P&L Attribution"><div style={{ padding: 48, textAlign: 'center', color: 'var(--ink4)' }}>No data available</div></DashboardShell>;

  const { sectors = [], topStocks = [], summary = {} } = data;
  const totalPnL = (summary.realizedPnL || 0) + (summary.unrealizedPnL || 0);
  const topGainers = (topStocks || []).filter(s => (s.unrealizedPnL || 0) > 0).slice(0, 5);
  const topLosers = (topStocks || []).filter(s => (s.unrealizedPnL || 0) < 0).slice(0, 5);

  return (
    <DashboardShell title="P&L Attribution" subtitle="Sector and stock-level contribution analysis">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 18 }}>
        <KPICard label="Total P&L" value={fc(totalPnL)} variant={totalPnL >= 0 ? 'grn' : 'red'} />
        <KPICard label="Realized" value={fc(summary.realizedPnL || 0)} variant={(summary.realizedPnL || 0) >= 0 ? 'grn' : 'red'} />
        <KPICard label="Unrealized" value={fc(summary.unrealizedPnL || 0)} variant={(summary.unrealizedPnL || 0) >= 0 ? 'grn' : 'red'} />
      </div>

      {/* Sector breakdown */}
      <div className="panel" style={{ padding: '14px 16px', marginBottom: 20 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
          P&L by Sector
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--bdr)' }}>
                <th style={{ textAlign: 'left', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Sector</th>
                <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Value</th>
                <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>% of AUM</th>
                <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Est. P&L</th>
              </tr>
            </thead>
            <tbody>
              {sectors.map((s, i) => {
                const estPnL = (s.value || 0) * ((s.returnPct || 0) / 100);
                return (
                  <tr key={i} style={{ borderBottom: i < sectors.length - 1 ? '1px solid var(--bdr)' : 'none' }}>
                    <td style={{ padding: '6px 0', color: 'var(--ink2)' }}>
                      <span style={{ display: 'inline-block', width: 8, height: 8, background: SCOL[s.name] || '#5a5a5a', borderRadius: 2, marginRight: 6 }} />
                      {s.name}
                    </td>
                    <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--ink2)' }}>{fc(s.value)}</td>
                    <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--ink3)' }}>{fsp(s.pct)}</td>
                    <td style={{ padding: '6px 0', textAlign: 'right', ...colorStyle(estPnL), fontWeight: 700 }}>{fc(estPnL)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Gainers and losers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Top gainers */}
        <div className="panel" style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            Top Gainers
          </div>
          {topGainers.map((s, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < topGainers.length - 1 ? '1px solid var(--bdr)' : 'none' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)' }}>{s.symbol}</div>
                <div style={{ fontSize: 9, color: 'var(--ink4)' }}>{s.name}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)' }}>{fc(s.unrealizedPnL)}</div>
                <div style={{ fontSize: 9, color: 'var(--green)' }}>{fsp(s.returnPct)}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Top losers */}
        <div className="panel" style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            Top Losers
          </div>
          {topLosers.map((s, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < topLosers.length - 1 ? '1px solid var(--bdr)' : 'none' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)' }}>{s.symbol}</div>
                <div style={{ fontSize: 9, color: 'var(--ink4)' }}>{s.name}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--red)' }}>{fc(s.unrealizedPnL)}</div>
                <div style={{ fontSize: 9, color: 'var(--red)' }}>{fsp(s.returnPct)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </DashboardShell>
  );
}
