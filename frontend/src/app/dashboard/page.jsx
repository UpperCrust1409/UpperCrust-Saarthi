'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Chart as ChartJS, ArcElement, BarElement, CategoryScale,
  LinearScale, Tooltip, Legend
} from 'chart.js';
import { Doughnut, Bar } from 'react-chartjs-2';
import DashboardShell from '@/components/layout/DashboardShell';
import KPICard from '@/components/ui/KPICard';
import { dashboardAPI } from '@/lib/api';
import { fc, fp, fsp, fs, colorClass, formatDate, SCOL, CHART_PALETTE } from '@/lib/formatters';

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

const RR_STOCK_MAX = 0.10;

export default function DashboardPage() {
  const router = useRouter();
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    dashboardAPI.get()
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <DashboardShell title="Dashboard" subtitle="Loading portfolio…">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
        <div className="spin" />
      </div>
    </DashboardShell>
  );

  if (error) return (
    <DashboardShell title="Dashboard">
      <div style={{ textAlign: 'center', padding: 60, color: 'var(--red)' }}>{error}</div>
    </DashboardShell>
  );

  if (data?.empty) return (
    <DashboardShell title="Dashboard">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 16 }}>
        <div style={{ fontSize: 48 }}>📊</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink2)' }}>No portfolio loaded yet</div>
        <div style={{ fontSize: 12, color: 'var(--ink3)' }}>An admin needs to upload the Excel file first</div>
      </div>
    </DashboardShell>
  );

  const { kpi, risk, sectors, topStocks, uploadedAt } = data;
  const totalAUM = kpi.totalAUM;

  // Chart data
  const sectorChartData = {
    labels:   sectors.map(s => s.sector),
    datasets: [{ data: sectors.map(s => s.value), backgroundColor: sectors.map(s => SCOL[s.sector] || '#888'), borderWidth: 2, borderColor: '#fff', hoverOffset: 6 }]
  };
  const topStocksData = {
    labels:   topStocks.slice(0, 8).map(s => s.symbol),
    datasets: [{ data: topStocks.slice(0, 8).map(s => s.totalValue / 1e5), backgroundColor: topStocks.slice(0, 8).map(s => s.weightPct > RR_STOCK_MAX ? 'rgba(192,56,42,.75)' : 'rgba(138,104,20,.75)'), borderRadius: 3 }]
  };

  const chartOptions = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => '₹' + ctx.raw.toFixed(1) + ' L' } } },
    scales: { x: { grid: { display: false }, ticks: { color: '#7a7060', font: { size: 9 } } }, y: { grid: { color: 'rgba(0,0,0,.05)' }, ticks: { color: '#7a7060', font: { size: 9 }, callback: v => '₹' + v + 'L' } } }
  };

  return (
    <DashboardShell
      title="Dashboard"
      subtitle={uploadedAt ? `Last updated: ${formatDate(uploadedAt)}` : ''}
    >
      {/* KPI Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10, marginBottom: 16 }}>
        <KPICard label="Total AUM"     value={fc(kpi.totalAUM)}      sub={`${kpi.clientCount} clients`}         variant="gold" />
        <KPICard label="Invested"      value={fc(kpi.totalInvested)}  sub="Cost basis"                           />
        <KPICard label="Unrealised P&L" value={<span className={colorClass(kpi.totalPnL)}>{fs(kpi.totalPnL)}</span>} sub={<span className={colorClass(kpi.totalPnL)}>{fsp(kpi.pnlPct)}</span>} variant={kpi.totalPnL >= 0 ? 'grn' : 'red'} />
        <KPICard label="Cash"          value={fc(kpi.totalCash)}      sub={<span className={kpi.cashPct > .15 ? 'gld' : 'neu'}>{fp(kpi.cashPct)}{kpi.cashPct > .15 ? ' — deploy?' : ''}</span>} variant={kpi.cashPct > .15 ? 'amb' : ''} />
        <KPICard
          label="Risk Status"
          value={<span style={{ color: risk.breach > 0 ? 'var(--red)' : 'var(--green)' }}>{risk.breach > 0 ? risk.breach + ' Breach' + (risk.breach > 1 ? 'es' : '') : 'Clear'}</span>}
          sub={<span style={{ color: risk.breach > 0 ? 'var(--red)' : 'var(--green)' }}>{risk.breach > 0 ? 'Fix now →' : risk.warn + ' warnings'}</span>}
          variant={risk.breach > 0 ? 'red' : 'grn'}
          onClick={() => router.push('/risk')}
        />
      </div>

      {/* Charts Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div className="panel" style={{ padding: '12px 14px' }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--ink4)', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            Sector Allocation
            <span style={{ cursor: 'pointer', color: 'var(--gold)', fontSize: 9 }} onClick={() => router.push('/sectors')}>Drill →</span>
          </div>
          <div style={{ height: 185 }}>
            <Doughnut
              data={sectorChartData}
              options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#3a3020', font: { family: 'Inter', size: 10, weight: '600' }, boxWidth: 10, padding: 7 } }, tooltip: { callbacks: { label: ctx => ctx.label + ': ' + fc(ctx.raw) + ' (' + (totalAUM > 0 ? (ctx.raw / totalAUM * 100).toFixed(1) : 0) + '%)' } } } }}
            />
          </div>
        </div>
        <div className="panel" style={{ padding: '12px 14px' }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--ink4)', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            Top Stock Exposure (₹L)
            <span style={{ cursor: 'pointer', color: 'var(--gold)', fontSize: 9 }} onClick={() => router.push('/stocks')}>All →</span>
          </div>
          <div style={{ height: 185 }}>
            <Bar data={topStocksData} options={chartOptions} />
          </div>
        </div>
      </div>

      {/* Top Holdings Table */}
      <div className="tbl">
        <div className="tbl-hd">
          <span className="tbl-ht">Top Holdings</span>
          <button className="btn btn-ghost btn-xs" onClick={() => router.push('/stocks')}>All Stocks →</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Symbol</th><th>Name</th><th style={{ textAlign: 'right' }}>Value</th>
              <th style={{ textAlign: 'right' }}>P&amp;L</th><th>Weight</th><th>Clients</th>
            </tr>
          </thead>
          <tbody>
            {topStocks.slice(0, 12).map(s => (
              <tr key={s.symbol} className="tr-c" onClick={() => router.push(`/stocks/${s.symbol}`)}>
                <td><b style={{ color: s.weightPct > RR_STOCK_MAX ? 'var(--red)' : 'var(--gold)' }}>{s.symbol}{s.weightPct > RR_STOCK_MAX ? ' ⚠' : ''}</b></td>
                <td style={{ color: 'var(--ink3)', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{fc(s.totalValue)}</td>
                <td style={{ textAlign: 'right' }} className={colorClass(s.pnl)}>
                  {fs(s.pnl)} <span style={{ color: 'var(--ink3)' }}>{fsp(s.pnlPct)}</span>
                </td>
                <td>
                  <div className="pb">
                    <div className="pt">
                      <div className={`pf ${s.weightPct > RR_STOCK_MAX ? 'pf-r' : 'pf-g'}`} style={{ width: `${Math.min(100, s.weightPct * 800)}%` }} />
                    </div>
                    <b style={s.weightPct > RR_STOCK_MAX ? { color: 'var(--red)' } : {}}>{fp(s.weightPct)}</b>
                  </div>
                </td>
                <td style={{ color: 'var(--ink3)' }}>{s.clientCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  );
}
