'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardShell from '@/components/layout/DashboardShell';
import KPICard from '@/components/ui/KPICard';
import { dashboardAPI } from '@/lib/api';
import { fc, fsp } from '@/lib/formatters';
import { getSession } from '@/lib/auth';

export default function ScenariosPage() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selScenario, setSelScenario] = useState('crash');

  useEffect(() => {
    const { token } = getSession();
    if (!token) { router.replace('/login'); return; }

    dashboardAPI.get().then(d => {
      setData(d);
    }).catch(err => console.error(err)).finally(() => setLoading(false));
  }, []);

  if (loading) return <DashboardShell title="Scenario Analysis"><div style={{ padding: 48, textAlign: 'center' }}><div className="spin" /></div></DashboardShell>;
  if (!data) return <DashboardShell title="Scenario Analysis"><div style={{ padding: 48, textAlign: 'center', color: 'var(--ink4)' }}>No data</div></DashboardShell>;

  const scenarios = {
    crash: {
      name: 'Market Crash -20%',
      description: 'Broad market decline across all equities',
      impact: -0.20,
      color: 'var(--red)'
    },
    goldRally: {
      name: 'Gold Rally +15%',
      description: 'Risk-off environment, gold appreciation',
      impact: 0.15,
      color: 'var(--gold)'
    },
    defenceDown: {
      name: 'Defence Sector Correction -10%',
      description: 'Valuation correction in defence stocks',
      impact: -0.10,
      color: 'var(--red)'
    },
    rateCut: {
      name: 'Rate Cut (BFSI +8%)',
      description: 'RBI rate cut lifts financial stocks',
      impact: 0.08,
      color: 'var(--green)'
    }
  };

  const scenario = scenarios[selScenario];
  const { summary = {} } = data;
  const currentAUM = summary.totalAUM || 0;
  const currentPnL = (summary.realizedPnL || 0) + (summary.unrealizedPnL || 0);
  const currentReturn = currentAUM ? currentPnL / (currentAUM - currentPnL) : 0;

  // Apply scenario impact
  const impactedAUM = currentAUM * (1 + scenario.impact);
  const impactedPnL = impactedAUM - (currentAUM - currentPnL);
  const impactedReturn = currentAUM ? impactedPnL / (currentAUM - impactedPnL) : 0;

  return (
    <DashboardShell title="Scenario Analysis" subtitle="Model portfolio impact under different market scenarios">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 20, marginBottom: 20 }}>
        {/* Scenario selector */}
        <div style={{ display: 'grid', gap: 8 }}>
          {Object.entries(scenarios).map(([key, s]) => (
            <div
              key={key}
              onClick={() => setSelScenario(key)}
              style={{
                padding: '10px 12px', borderRadius: 'var(--r)',
                border: `1.5px solid ${selScenario === key ? s.color : 'var(--bdr)'}`,
                background: selScenario === key ? (s.impact > 0 ? 'var(--grn2)' : 'var(--red2)') : 'var(--sur)',
                cursor: 'pointer', transition: 'all .12s'
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: selScenario === key ? s.color : 'var(--ink)', marginBottom: 2 }}>
                {s.name}
              </div>
              <div style={{ fontSize: 9, color: 'var(--ink4)' }}>{s.description}</div>
            </div>
          ))}
        </div>

        {/* Impact summary */}
        <div className="panel" style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            Scenario Impact
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            <div>
              <div style={{ fontSize: 9, color: 'var(--ink4)', marginBottom: 2 }}>Market Change</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: scenario.color }}>
                {scenario.impact > 0 ? '+' : ''}{fsp(scenario.impact)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: 'var(--ink4)', marginBottom: 2 }}>AUM Impact</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
                {fc(currentAUM)} {String.fromCharCode(8594)} {fc(impactedAUM)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: 'var(--ink4)', marginBottom: 2 }}>Portfolio Return</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: scenario.color }}>
                {fsp(currentReturn)} {String.fromCharCode(8594)} {fsp(impactedReturn)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Before/After table */}
      <div className="panel" style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
          Before vs After
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--bdr)' }}>
                <th style={{ textAlign: 'left', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Metric</th>
                <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Current</th>
                <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>After Scenario</th>
                <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Change</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px solid var(--bdr)' }}>
                <td style={{ padding: '6px 0', color: 'var(--ink2)' }}>Total AUM</td>
                <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--ink2)' }}>{fc(currentAUM)}</td>
                <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--ink2)' }}>{fc(impactedAUM)}</td>
                <td style={{ padding: '6px 0', textAlign: 'right', color: scenario.color, fontWeight: 700 }}>
                  {fc(impactedAUM - currentAUM)}
                </td>
              </tr>
              <tr style={{ borderBottom: '1px solid var(--bdr)' }}>
                <td style={{ padding: '6px 0', color: 'var(--ink2)' }}>Total P&L</td>
                <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--ink2)' }}>{fc(currentPnL)}</td>
                <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--ink2)' }}>{fc(impactedPnL)}</td>
                <td style={{ padding: '6px 0', textAlign: 'right', color: scenario.color, fontWeight: 700 }}>
                  {fc(impactedPnL - currentPnL)}
                </td>
              </tr>
              <tr>
                <td style={{ padding: '6px 0', color: 'var(--ink2)' }}>Return %</td>
                <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--ink2)' }}>{fsp(currentReturn)}</td>
                <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--ink2)' }}>{fsp(impactedReturn)}</td>
                <td style={{ padding: '6px 0', textAlign: 'right', color: scenario.color, fontWeight: 700 }}>
                  {fsp(impactedReturn - currentReturn)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </DashboardShell>
  );
}
