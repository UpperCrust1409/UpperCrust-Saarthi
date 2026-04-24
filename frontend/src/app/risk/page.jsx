'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardShell from '@/components/layout/DashboardShell';
import KPICard from '@/components/ui/KPICard';
import { riskAPI } from '@/lib/api';
import { fp } from '@/lib/formatters';

export default function RiskPage() {
  const router = useRouter();
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [selClient, setSelClient] = useState(null);

  useEffect(() => {
    riskAPI.get().then(d => { setData(d); if (d.risks?.length) setSelClient(d.risks[0].client); }).finally(() => setLoading(false));
  }, []);

  if (loading) return <DashboardShell title="Risk / Alerts"><div style={{ padding: 48, textAlign: 'center' }}><div className="spin" /></div></DashboardShell>;
  if (!data || data.empty) return <DashboardShell title="Risk / Alerts"><div style={{ padding: 48, textAlign: 'center', color: 'var(--ink4)' }}>No portfolio loaded</div></DashboardShell>;

  const { risks = [], summary = {} } = data;
  const breaches = risks.filter(r => r.type === 'breach');
  const warnings = risks.filter(r => r.type === 'warning');

  // Group by client
  const clientMap = {};
  risks.forEach(r => {
    if (!clientMap[r.client]) clientMap[r.client] = { breaches: [], warnings: [] };
    r.type === 'breach' ? clientMap[r.client].breaches.push(r) : clientMap[r.client].warnings.push(r);
  });
  const ranked = Object.entries(clientMap).sort((a, b) => (b[1].breaches.length * 100 + b[1].warnings.length) - (a[1].breaches.length * 100 + a[1].warnings.length));

  const selRisks = selClient ? risks.filter(r => r.client === selClient) : [];

  return (
    <DashboardShell title="Risk / Alerts" subtitle="Client-level limit breach monitor">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 18 }}>
        <KPICard label="Active Breaches"     value={<span style={{ color: summary.breach ? 'var(--red)' : 'var(--green)' }}>{summary.breach || 0}</span>} sub={summary.breach ? 'Immediate action' : 'All within limits'} variant={summary.breach ? 'red' : 'grn'} />
        <KPICard label="Near-Limit Warnings" value={<span style={{ color: summary.warning ? 'var(--amber)' : 'var(--ink3)' }}>{summary.warning || 0}</span>} variant={summary.warning ? 'amb' : ''} />
        <KPICard label="Clients at Risk"     value={summary.atRisk || 0} sub={`of ${summary.clients || 0}`} />
        <KPICard label="Clean Portfolios"    value={<span className="pos">{(summary.clients || 0) - (summary.atRisk || 0)}</span>} sub="No alerts" variant="grn" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16, alignItems: 'start' }}>
        {/* Client list */}
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            {ranked.length} clients flagged
          </div>
          {ranked.map(([name, cr]) => (
            <div
              key={name}
              onClick={() => setSelClient(name)}
              style={{ cursor: 'pointer', padding: '11px 14px', marginBottom: 6, borderRadius: 'var(--r)', border: `1.5px solid ${cr.breaches.length ? 'var(--redbdr)' : selClient === name ? 'var(--gold)' : 'var(--ambbdr)'}`, background: cr.breaches.length ? 'var(--red2)' : selClient === name ? 'var(--glt)' : 'var(--amb2)', transition: 'all .12s' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{name}</div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  {cr.breaches.length > 0 && <span style={{ fontSize: 9, fontWeight: 700, background: 'var(--red)', color: '#fff', padding: '2px 6px', borderRadius: 3 }}>{cr.breaches.length} BREACH</span>}
                  {cr.warnings.length > 0 && <span style={{ fontSize: 9, fontWeight: 700, background: 'var(--amber)', color: '#fff', padding: '2px 6px', borderRadius: 3 }}>{cr.warnings.length} WARN</span>}
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink3)' }}>
                {[...cr.breaches, ...cr.warnings].slice(0, 2).map(r => r.sym + ' ' + fp(r.cur)).join(' · ')}
                {cr.breaches.length + cr.warnings.length > 2 ? ' +more' : ''}
              </div>
            </div>
          ))}
        </div>

        {/* Detail panel */}
        <div>
          {selClient ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>{selClient}</div>
                {clientMap[selClient]?.breaches.length > 0 && <span style={{ background: 'var(--red)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 3 }}>{clientMap[selClient].breaches.length} BREACH</span>}
              </div>
              {selRisks.map((r, i) => (
                <div key={i} className={`ra ${r.type}`} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{r.type === 'breach' ? '🚨' : '⚠️'}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>{r.cat}: {r.name}</div>
                    <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 8 }}>
                      <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: r.type === 'breach' ? 'var(--red2)' : 'var(--amb2)', color: r.type === 'breach' ? 'var(--red)' : 'var(--amber)', border: `1px solid ${r.type === 'breach' ? 'var(--redbdr)' : 'var(--ambbdr)'}` }}>Current {fp(r.cur)}</span>
                      <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: 'var(--grn2)', color: 'var(--green)', border: '1px solid var(--grnbdr)' }}>Limit {fp(r.lim)}</span>
                      {r.type === 'breach' && <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: 'var(--red2)', color: 'var(--red)', border: '1px solid var(--redbdr)' }}>+{fp(r.excess)} over</span>}
                    </div>
                    <div className="pb" style={{ maxWidth: 360, marginBottom: 8 }}>
                      <div className="pt" style={{ height: 6 }}><div className={`pf ${r.type === 'breach' ? 'pf-r' : 'pf-a'}`} style={{ width: `${Math.min(100, r.ratio * 100)}%` }} /></div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: r.type === 'breach' ? 'var(--red)' : 'var(--amber)' }}>{(r.ratio * 100).toFixed(0)}%</span>
                    </div>
                    {r.suggest && <div className="rsug">→ {r.suggest}</div>}
                  </div>
                </div>
              ))}
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--ink4)' }}>Select a client to see risk details</div>
          )}
        </div>
      </div>

      {/* Reference table */}
      <hr style={{ border: 'none', borderTop: '1px solid var(--bdr)', margin: '24px 0 16px' }} />
      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Risk Limit Reference</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
        {[
          { title: 'Stock', rows: [['Per stock (per client & PMS)', '10%']] },
          { title: 'Sector', rows: [['Defence Manufacturing','25%'],['Precious Metals','25%'],['BFSI','20%'],['Energy','20%'],['Others','15%']] },
          { title: 'Precious Metals', rows: [['Gold ETF','25%'],['Silver ETF','15%'],['Min Cash','₹1.5L']] }
        ].map(({ title, rows }) => (
          <div className="panel" key={title} style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{title}</div>
            {rows.map(([n, v]) => (
              <div key={n} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, padding: '3px 0', borderBottom: '1px solid var(--bdr)' }}>
                <span style={{ color: 'var(--ink2)', fontWeight: 600 }}>{n}</span>
                <b style={{ color: 'var(--gold)' }}>{v}</b>
              </div>
            ))}
          </div>
        ))}
      </div>
    </DashboardShell>
  );
}
