'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardShell from '@/components/layout/DashboardShell';
import { dashboardAPI, stocksAPI } from '@/lib/api';
import { fc, fsp, SCOL } from '@/lib/formatters';
import { getSession } from '@/lib/auth';

export default function SectorsPage() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [stocks, setStocks] = useState([]);
  const [selSector, setSelSector] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { token } = getSession();
    if (!token) { router.replace('/login'); return; }

    Promise.all([
      dashboardAPI.get(),
      stocksAPI.list()
    ]).then(([d, s]) => {
      setData(d);
      setStocks(s.stocks || []);
      if (d.sectors?.length) setSelSector(d.sectors[0].name);
    }).catch(err => console.error(err)).finally(() => setLoading(false));
  }, []);

  if (loading) return <DashboardShell title="Sectors"><div style={{ padding: 48, textAlign: 'center' }}><div className="spin" /></div></DashboardShell>;
  if (!data) return <DashboardShell title="Sectors"><div style={{ padding: 48, textAlign: 'center', color: 'var(--ink4)' }}>No data</div></DashboardShell>;

  const { sectors = [], summary = {} } = data;
  const selStocks = selSector ? stocks.filter(s => s.sector === selSector) : [];

  return (
    <DashboardShell title="Sectors" subtitle="Sector-level allocation and performance">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Sector grid */}
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
            Sector Breakdown
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {sectors.map(s => (
              <div
                key={s.name}
                onClick={() => setSelSector(s.name)}
                style={{
                  padding: '12px 14px', borderRadius: 'var(--r)',
                  border: `1.5px solid ${selSector === s.name ? 'var(--gold)' : 'var(--bdr)'}`,
                  background: selSector === s.name ? 'var(--glt)' : 'var(--sur)',
                  cursor: 'pointer', transition: 'all .12s'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ display: 'inline-block', width: 6, height: 6, background: SCOL[s.name] || '#5a5a5a', borderRadius: '50%' }} />
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)', flex: 1 }}>{s.name}</div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)', marginBottom: 2 }}>{fc(s.value)}</div>
                <div style={{ fontSize: 9, color: 'var(--ink3)' }}>{fsp(s.pct)} of AUM</div>
              </div>
            ))}
          </div>
        </div>

        {/* Detail panel */}
        <div>
          {selSector && (
            <>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                Holdings in {selSector}
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {selStocks.slice(0, 10).map(s => (
                  <div key={s.symbol} style={{ padding: '8px 12px', background: 'var(--sur)', borderRadius: 'var(--r)', border: '1px solid var(--bdr)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink)' }}>{s.symbol}</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gold)' }}>{fc(s.value)}</div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <div style={{ fontSize: 9, color: 'var(--ink4)' }}>{s.name}</div>
                      <div style={{ fontSize: 9, color: s.returnPct >= 0 ? 'var(--green)' : 'var(--red)' }}>{fsp(s.returnPct)}</div>
                    </div>
                  </div>
                ))}
                {selStocks.length > 10 && <div style={{ fontSize: 9, color: 'var(--ink4)', padding: '4px 0' }}>+{selStocks.length - 10} more</div>}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Sector limits reference */}
      <hr style={{ border: 'none', borderTop: '1px solid var(--bdr)', margin: '24px 0 16px' }} />
      <div className="panel" style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
          Sector Allocation Limits
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--bdr)' }}>
                <th style={{ textAlign: 'left', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Sector</th>
                <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Current %</th>
                <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Limit %</th>
              </tr>
            </thead>
            <tbody>
              {sectors.map((s, i) => (
                <tr key={i} style={{ borderBottom: i < sectors.length - 1 ? '1px solid var(--bdr)' : 'none' }}>
                  <td style={{ padding: '6px 0', color: 'var(--ink2)' }}>
                    <span style={{ display: 'inline-block', width: 6, height: 6, background: SCOL[s.name] || '#5a5a5a', borderRadius: '50%', marginRight: 6 }} />
                    {s.name}
                  </td>
                  <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--ink)' }}>{fsp(s.pct)}</td>
                  <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--gold)', fontWeight: 700 }}>25%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardShell>
  );
}
