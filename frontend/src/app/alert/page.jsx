'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardShell from '@/components/layout/DashboardShell';
import { dashboardAPI, riskAPI } from '@/lib/api';
import { fc, fsp, colorStyle } from '@/lib/formatters';
import { getSession } from '@/lib/auth';
import toast from 'react-hot-toast';

export default function AlertPage() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [risks, setRisks] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { token } = getSession();
    if (!token) { router.replace('/login'); return; }

    Promise.all([
      dashboardAPI.get(),
      riskAPI.get()
    ]).then(([d, r]) => {
      setData(d);
      setRisks(r);
    }).catch(err => console.error(err)).finally(() => setLoading(false));
  }, []);

  const handlePrint = () => {
    window.print();
  };

  const handleCopyToClipboard = () => {
    if (!data || !risks) return;
    const text = `Morning Alert - ${new Date().toLocaleDateString('en-IN')}

Portfolio Summary:
Total AUM: ${fc(data.summary?.totalAUM || 0)}
Today's P&L: ${fc(data.summary?.realizedPnL || 0)}
Return: ${fsp(data.summary?.returnPct || 0)}

Top Risks:
${risks.risks?.slice(0, 5).map(r => `${r.type === 'breach' ? 'BREACH' : 'WARN'}: ${r.cat} ${r.name} - Current ${fsp(r.cur)} vs Limit ${fsp(r.lim)}`).join('\n')}

Top Movers:
${(data.topStocks || []).slice(0, 3).map(s => `${s.symbol}: ${fsp(s.returnPct)}`).join('\n')}`;

    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  if (loading) return <DashboardShell title="Morning Alert"><div style={{ padding: 48, textAlign: 'center' }}><div className="spin" /></div></DashboardShell>;
  if (!data || !risks) return <DashboardShell title="Morning Alert"><div style={{ padding: 48, textAlign: 'center', color: 'var(--ink4)' }}>No data</div></DashboardShell>;

  const breaches = risks.risks?.filter(r => r.type === 'breach') || [];
  const warnings = risks.risks?.filter(r => r.type === 'warning') || [];
  const topMovers = (data.topStocks || []).sort((a, b) => Math.abs((b.returnPct || 0)) - Math.abs((a.returnPct || 0))).slice(0, 5);

  return (
    <DashboardShell title="Morning Alert" subtitle={new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}>
      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          onClick={handleCopyToClipboard}
          style={{ padding: '8px 14px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 'var(--r)', fontWeight: 600, cursor: 'pointer', fontSize: 11 }}
        >
          Copy to Clipboard
        </button>
        <button
          onClick={handlePrint}
          style={{ padding: '8px 14px', background: 'var(--sur)', color: 'var(--ink)', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', fontWeight: 600, cursor: 'pointer', fontSize: 11 }}
        >
          Print / Save as PDF
        </button>
      </div>

      {/* Portfolio snapshot */}
      <div className="panel" style={{ padding: '14px 16px', marginBottom: 20 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
          Portfolio Snapshot
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <div>
            <div style={{ fontSize: 9, color: 'var(--ink4)', marginBottom: 4 }}>Total AUM</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--gold)' }}>{fc(data.summary?.totalAUM || 0)}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: 'var(--ink4)', marginBottom: 4 }}>P&L</div>
            <div style={{ fontSize: 16, fontWeight: 700, ...colorStyle(data.summary?.unrealizedPnL || 0) }}>
              {fc(data.summary?.unrealizedPnL || 0)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: 'var(--ink4)', marginBottom: 4 }}>Return</div>
            <div style={{ fontSize: 16, fontWeight: 700, ...colorStyle(data.summary?.returnPct || 0) }}>
              {fsp(data.summary?.returnPct || 0)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: 'var(--ink4)', marginBottom: 4 }}>Clients</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{data.summary?.clientCount || 0}</div>
          </div>
        </div>
      </div>

      {/* Risk alerts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        {/* Breaches */}
        <div className="panel" style={{ padding: '14px 16px', borderLeft: breaches.length > 0 ? '4px solid var(--red)' : '4px solid var(--green)' }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: breaches.length > 0 ? 'var(--red)' : 'var(--green)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
            Active Breaches {breaches.length > 0 ? `(${breaches.length})` : ''}
          </div>
          {breaches.length > 0 ? (
            breaches.slice(0, 5).map((r, i) => (
              <div key={i} style={{ padding: '6px 0', borderBottom: i < Math.min(5, breaches.length) - 1 ? '1px solid var(--bdr)' : 'none', fontSize: 10 }}>
                <div style={{ fontWeight: 700, color: 'var(--ink)', marginBottom: 2 }}>{r.cat}: {r.name}</div>
                <div style={{ color: 'var(--ink4)' }}>{r.sym} - Current {fsp(r.cur)} vs Limit {fsp(r.lim)}</div>
              </div>
            ))
          ) : (
            <div style={{ fontSize: 10, color: 'var(--green)', fontWeight: 600 }}>All portfolios within limits</div>
          )}
        </div>

        {/* Warnings */}
        <div className="panel" style={{ padding: '14px 16px', borderLeft: warnings.length > 0 ? '4px solid var(--amber)' : '4px solid var(--ink4)' }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: warnings.length > 0 ? 'var(--amber)' : 'var(--ink4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
            Near-Limit Warnings {warnings.length > 0 ? `(${warnings.length})` : ''}
          </div>
          {warnings.length > 0 ? (
            warnings.slice(0, 5).map((r, i) => (
              <div key={i} style={{ padding: '6px 0', borderBottom: i < Math.min(5, warnings.length) - 1 ? '1px solid var(--bdr)' : 'none', fontSize: 10 }}>
                <div style={{ fontWeight: 700, color: 'var(--ink)', marginBottom: 2 }}>{r.cat}: {r.name}</div>
                <div style={{ color: 'var(--ink4)' }}>{r.sym} - Current {fsp(r.cur)} vs Limit {fsp(r.lim)}</div>
              </div>
            ))
          ) : (
            <div style={{ fontSize: 10, color: 'var(--ink4)', fontWeight: 600 }}>No warnings</div>
          )}
        </div>
      </div>

      {/* Top movers */}
      <div className="panel" style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
          Top Movers
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 10 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--bdr)' }}>
                <th style={{ textAlign: 'left', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Symbol</th>
                <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Return</th>
                <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Value</th>
              </tr>
            </thead>
            <tbody>
              {topMovers.map((s, i) => (
                <tr key={i} style={{ borderBottom: i < topMovers.length - 1 ? '1px solid var(--bdr)' : 'none' }}>
                  <td style={{ padding: '6px 0', color: 'var(--ink)', fontWeight: 600 }}>{s.symbol}</td>
                  <td style={{ padding: '6px 0', textAlign: 'right', ...colorStyle(s.returnPct), fontWeight: 700 }}>{fsp(s.returnPct)}</td>
                  <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--ink2)' }}>{fc(s.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardShell>
  );
}
