'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardShell from '@/components/layout/DashboardShell';
import { clientsAPI } from '@/lib/api';
import { fc, fp, fsp, fs, colorClass, formatDate, durStr } from '@/lib/formatters';

export default function ClientsPage() {
  const router  = useRouter();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [sort,    setSort]    = useState('aum');
  const [dir,     setDir]     = useState('desc');

  function load() {
    setLoading(true);
    const params = { sort, dir };
    if (search) params.search = search;
    clientsAPI.list(params)
      .then(setClients)
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [sort, dir]);
  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [search]);

  function toggleSort(col) {
    if (sort === col) setDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSort(col); setDir('desc'); }
  }

  const totalAUM = clients.reduce((s, c) => s + (+c.aum || 0), 0);

  return (
    <DashboardShell title="Clients" subtitle={`${clients.length} portfolios`}>
      {/* Search + Controls */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search clients…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding: '7px 10px', border: '1.5px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', fontSize: 12, width: 240, fontFamily: 'Inter,sans-serif', outline: 'none' }}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[['aum','AUM'],['pnl','P&L'],['pnlpct','Return']].map(([col, label]) => (
            <button
              key={col}
              onClick={() => toggleSort(col)}
              className={`btn btn-xs ${sort === col ? 'btn-gold' : 'btn-ghost'}`}
            >
              {label} {sort === col ? (dir === 'asc' ? '↑' : '↓') : ''}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink3)' }}>
          Total AUM: <b style={{ color: 'var(--ink)' }}>{fc(totalAUM)}</b>
        </div>
      </div>

      {/* Table */}
      <div className="tbl">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('name')}>Client</th>
              <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => toggleSort('aum')}>AUM</th>
              <th style={{ textAlign: 'right' }}>Invested</th>
              <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => toggleSort('pnl')}>P&amp;L</th>
              <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => toggleSort('pnlpct')}>Return</th>
              <th style={{ textAlign: 'right' }}>Cash</th>
              <th style={{ textAlign: 'right' }}>Holdings</th>
              <th>Since</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: 32 }}><div className="spin" /></td></tr>
            ) : clients.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: 32, color: 'var(--ink4)' }}>No clients found</td></tr>
            ) : clients.map((c, i) => {
              const yrs = c.investment_date ? (new Date() - new Date(c.investment_date)) / (1000 * 60 * 60 * 24 * 365.25) : null;
              return (
                <tr key={c.id} className="tr-c" onClick={() => router.push(`/clients/${c.id}`)}>
                  <td style={{ color: 'var(--ink4)', fontWeight: 700 }}>{i + 1}</td>
                  <td><b>{c.name}</b></td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{fc(c.aum)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--ink3)' }}>{fc(c.total_invested)}</td>
                  <td style={{ textAlign: 'right' }} className={colorClass(c.total_pnl)}>{fs(c.total_pnl)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }} className={colorClass(c.total_pnl_pct)}>{fsp(c.total_pnl_pct)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--ink3)' }}>{fc(c.cash)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--ink3)' }}>{c.holding_count}</td>
                  <td style={{ color: 'var(--ink3)', fontSize: 11 }}>
                    {c.investment_date
                      ? <><div>{formatDate(c.investment_date)}</div><div style={{ color: 'var(--gold3)', fontWeight: 700 }}>{durStr(yrs)}</div></>
                      : <span style={{ color: 'var(--ink4)' }}>—</span>}
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
