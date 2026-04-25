'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardShell from '@/components/layout/DashboardShell';
import KPICard from '@/components/ui/KPICard';
import { clientsAPI } from '@/lib/api';
import { fc, fsp } from '@/lib/formatters';
import { getSession } from '@/lib/auth';

export default function HealthPage() {
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

  if (loading) return <DashboardShell title="Portfolio Health"><div style={{ padding: 48, textAlign: 'center' }}><div className="spin" /></div></DashboardShell>;

  // Calculate health scores
  const scores = clients.map(c => {
    let divScore = 0, sectorScore = 0, cashScore = 0;
    const holdingCount = c.holdings?.length || 0;

    // Diversification: more holdings = better (target 20+)
    divScore = Math.min(100, (holdingCount / 20) * 100);

    // Sector balance: less concentration = better (estimate from available data)
    sectorScore = 60; // Placeholder

    // Cash ratio (ideally 5-10% of portfolio)
    const cashRatio = c.cash / (c.totalCurrent || 1);
    if (cashRatio >= 0.05 && cashRatio <= 0.10) {
      cashScore = 100;
    } else if (cashRatio >= 0.03 || cashRatio <= 0.15) {
      cashScore = 75;
    } else {
      cashScore = 40;
    }

    const overallScore = (divScore + sectorScore + cashScore) / 3;
    const status = overallScore >= 75 ? 'Excellent' : overallScore >= 60 ? 'Good' : overallScore >= 45 ? 'Fair' : 'At Risk';

    return { ...c, divScore, sectorScore, cashScore, overallScore, status };
  });

  const avgOverall = scores.length ? scores.reduce((s, c) => s + c.overallScore, 0) / scores.length : 0;
  const healthyCount = scores.filter(c => c.status === 'Excellent' || c.status === 'Good').length;

  return (
    <DashboardShell title="Portfolio Health" subtitle="Diversification, sector balance, and cash ratio analysis">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 18 }}>
        <KPICard label="Avg Health Score" value={avgOverall.toFixed(0)} sub="/100" />
        <KPICard label="Healthy Portfolios" value={healthyCount} sub={`of ${scores.length}`} variant="grn" />
        <KPICard label="At Risk" value={scores.filter(c => c.status === 'At Risk').length} variant={scores.filter(c => c.status === 'At Risk').length > 0 ? 'red' : 'grn'} />
        <KPICard label="Portfolios" value={scores.length} />
      </div>

      {/* Health breakdown by client */}
      <div className="panel" style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
          Client Health Scores
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 10 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--bdr)' }}>
                <th style={{ textAlign: 'left', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Client</th>
                <th style={{ textAlign: 'center', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Holdings</th>
                <th style={{ textAlign: 'center', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Diversif.</th>
                <th style={{ textAlign: 'center', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Sector Bal.</th>
                <th style={{ textAlign: 'center', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Cash %</th>
                <th style={{ textAlign: 'center', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Overall Score</th>
                <th style={{ textAlign: 'center', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((c, i) => {
                const statusColor = c.status === 'Excellent' ? 'var(--green)' : c.status === 'Good' ? 'var(--gold)' : c.status === 'Fair' ? 'var(--amber)' : 'var(--red)';
                const statusBg = c.status === 'Excellent' ? 'var(--grn2)' : c.status === 'Good' ? 'var(--glt)' : c.status === 'Fair' ? 'var(--amb2)' : 'var(--red2)';
                return (
                  <tr key={i} style={{ borderBottom: i < scores.length - 1 ? '1px solid var(--bdr)' : 'none' }}>
                    <td style={{ padding: '6px 0', color: 'var(--ink)', fontWeight: 600 }}>{c.name}</td>
                    <td style={{ padding: '6px 0', textAlign: 'center', color: 'var(--ink3)' }}>{c.holdings?.length || 0}</td>
                    <td style={{ padding: '6px 0', textAlign: 'center', color: 'var(--ink3)' }}>{c.divScore.toFixed(0)}</td>
                    <td style={{ padding: '6px 0', textAlign: 'center', color: 'var(--ink3)' }}>{c.sectorScore.toFixed(0)}</td>
                    <td style={{ padding: '6px 0', textAlign: 'center', color: 'var(--ink3)' }}>{fsp(c.cash / (c.totalCurrent || 1))}</td>
                    <td style={{ padding: '6px 0', textAlign: 'center', fontWeight: 700, color: statusColor }}>{c.overallScore.toFixed(0)}</td>
                    <td style={{ padding: '6px 0', textAlign: 'center' }}>
                      <span style={{ fontSize: 8, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: statusBg, color: statusColor }}>
                        {c.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Health summary by status */}
      <hr style={{ border: 'none', borderTop: '1px solid var(--bdr)', margin: '24px 0 16px' }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
        {[
          { status: 'Excellent', color: 'var(--green)', bg: 'var(--grn2)' },
          { status: 'Good', color: 'var(--gold)', bg: 'var(--glt)' },
          { status: 'Fair', color: 'var(--amber)', bg: 'var(--amb2)' },
          { status: 'At Risk', color: 'var(--red)', bg: 'var(--red2)' }
        ].map(s => (
          <div key={s.status} style={{ padding: '12px 14px', background: s.bg, border: `1px solid ${s.color}`, borderRadius: 'var(--r)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: s.color, marginBottom: 4 }}>{s.status}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{scores.filter(c => c.status === s.status).length}</div>
          </div>
        ))}
      </div>
    </DashboardShell>
  );
}
