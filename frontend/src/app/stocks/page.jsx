'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardShell from '@/components/layout/DashboardShell';
import { stocksAPI } from '@/lib/api';
import { fc, fp, fsp, fs, colorClass } from '@/lib/formatters';

const SCOL_MAP = {
  'Defence Manufacturing': '#3a6a5a', 'Base Metals': '#8a6814',
  'Precious Metals': '#b8922a', 'BFSI': '#6b4c8a', 'Energy': '#c05a1a',
  'IT & Technology': '#1a5a8a', 'Capital Goods': '#4a6a2a',
  'Infrastructure': '#2a5a4a', 'Agri / Commodity': '#5a7a1a',
  'Liquid / Cash': '#7a7a7a', 'Other': '#5a5a5a', 'Untagged': '#c0382a'
};

export default function StocksPage() {
  const router  = useRouter();
  const [stocks,  setStocks]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [sort,    setSort]    = useState('value');
  const [dir,     setDir]     = useState('desc');

  function load() {
    setLoading(true);
    const params = { sort, dir };
    if (search) params.search = search;
    stocksAPI.list(params).then(setStocks).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [sort, dir]);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [search]);

  function toggleSort(col) {
    if (sort === col) setDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSort(col); setDir('desc'); }
  }

  const totalAUM = stocks.reduce((s, x) => s + (+x.total_value || 0), 0);

  return (
    <DashboardShell title="Stocks" subtitle={`${stocks.length} positions across portfolio`}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text" placeholder="Search symbol or name…"
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ padding: '7px 10px', border: '1.5px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', fontSize: 12, width: 240, fontFamily: 'Inter,sans-serif', outline: 'none' }}
        />
        {[['value','Value'],['pnl','P&L'],['pnlpct','Return'],['clients','Clients']].map(([col, label]) => (
          <button key={col} onClick={() => toggleSort(col)} className={`btn btn-xs ${sort === col ? 'btn-gold' : 'btn-ghost'}`}>
            {label} {sort === col ? (dir === 'asc' ? '↑' : '↓') : ''}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink3)' }}>
          Total: <b>{fc(totalAUM)}</b>
        </div>
      </div>

      <div className="tbl">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('symbol')}>Symbol</th>
              <th>Name</th>
              <th>Sector</th>
              <th>Cap</th>
              <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => toggleSort('value')}>Value</th>
              <th style={{ textAlign: 'right' }}>Cost</th>
              <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => toggleSort('pnl')}>P&amp;L</th>
              <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => toggleSort('pnlpct')}>Return</th>
              <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('clients')}>Clients</th>
              <th>Weight</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} style={{ textAlign: 'center', padding: 32 }}><div className="spin" /></td></tr>
            ) : stocks.filter(s => !s.hidden).map((s, i) => {
              const weight = totalAUM > 0 ? +s.total_value / totalAUM : 0;
              return (
                <tr key={s.symbol} className="tr-c" onClick={() => router.push(`/stocks/${s.symbol}`)}>
                  <td style={{ color: 'var(--ink4)', fontWeight: 700 }}>{i + 1}</td>
                  <td><b style={{ color: weight > 0.10 ? 'var(--red)' : 'var(--gold)' }}>{s.symbol}{weight > 0.10 ? ' ⚠' : ''}</b></td>
                  <td style={{ color: 'var(--ink3)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</td>
                  <td>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: (SCOL_MAP[s.sector] || '#888') + '22', color: SCOL_MAP[s.sector] || '#888', border: `1px solid ${(SCOL_MAP[s.sector] || '#888')}44` }}>
                      {s.sector || 'Untagged'}
                    </span>
                  </td>
                  <td style={{ fontSize: 10, color: 'var(--ink3)' }}>{s.mcap || '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{fc(s.total_value)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--ink3)' }}>{fc(s.total_cost)}</td>
                  <td style={{ textAlign: 'right' }} className={colorClass(s.pnl)}>{fs(s.pnl)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }} className={colorClass(s.pnl_pct)}>{fsp(s.pnl_pct)}</td>
                  <td style={{ color: 'var(--ink3)' }}>{s.client_count}</td>
                  <td>
                    <div className="pb">
                      <div className="pt"><div className={`pf ${weight > 0.10 ? 'pf-r' : 'pf-g'}`} style={{ width: `${Math.min(100, weight * 800)}%` }} /></div>
                      <b style={{ fontSize: 10, ...(weight > 0.10 ? { color: 'var(--red)' } : {}) }}>{fp(weight)}</b>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  );
}
