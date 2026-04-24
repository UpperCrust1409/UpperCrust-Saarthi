'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import DashboardShell from '@/components/layout/DashboardShell';
import { clientsAPI } from '@/lib/api';
import { fc, fp, fsp, fs, colorClass, formatDate } from '@/lib/formatters';

export default function ClientDetailPage() {
  const { id }  = useParams();
  const router  = useRouter();
  const [client, setClient]   = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    clientsAPI.get(id).then(setClient).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <DashboardShell title="Client Detail"><div style={{ padding: 48, textAlign: 'center' }}><div className="spin" /></div></DashboardShell>;
  if (!client) return <DashboardShell title="Client Detail"><div style={{ padding: 48, textAlign: 'center', color: 'var(--red)' }}>Client not found</div></DashboardShell>;

  const aum = (+client.total_current || 0) + (+client.cash || 0);
  const holdings = client.holdings || [];

  return (
    <DashboardShell title={client.name} subtitle={`${holdings.length} holdings · AUM ${fc(aum)}`}>
      <button className="btn btn-ghost btn-xs" onClick={() => router.back()} style={{ marginBottom: 16 }}>← Back</button>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10, marginBottom: 16 }}>
        <div className="kc gold"><div className="kc-lbl">AUM</div><div className="kc-val">{fc(aum)}</div></div>
        <div className="kc"><div className="kc-lbl">Invested</div><div className="kc-val">{fc(client.total_invested)}</div></div>
        <div className={`kc ${+client.total_pnl >= 0 ? 'grn' : 'red'}`}>
          <div className="kc-lbl">P&amp;L</div>
          <div className="kc-val"><span className={colorClass(client.total_pnl)}>{fs(client.total_pnl)}</span></div>
          <div className={`kc-sub ${colorClass(client.total_pnl_pct)}`}>{fsp(client.total_pnl_pct)}</div>
        </div>
        <div className="kc"><div className="kc-lbl">Cash</div><div className="kc-val">{fc(client.cash)}</div><div className="kc-sub neu">{fp(aum > 0 ? client.cash / aum : 0)}</div></div>
        <div className="kc"><div className="kc-lbl">Since</div><div className="kc-val" style={{ fontSize: 13 }}>{client.investment_date ? formatDate(client.investment_date) : '—'}</div></div>
      </div>

      {/* Holdings table */}
      <div className="tbl">
        <div className="tbl-hd"><span className="tbl-ht">Holdings</span><span style={{ fontSize: 10, color: 'var(--ink4)' }}>{holdings.length} positions</span></div>
        <table>
          <thead>
            <tr>
              <th>Symbol</th><th>Name</th><th style={{ textAlign: 'right' }}>Qty</th>
              <th style={{ textAlign: 'right' }}>Avg Cost</th><th style={{ textAlign: 'right' }}>Market Price</th>
              <th style={{ textAlign: 'right' }}>Value</th><th style={{ textAlign: 'right' }}>P&amp;L</th>
              <th style={{ textAlign: 'right' }}>Return</th><th>Weight</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map(h => (
              <tr key={h.id} className="tr-c" onClick={() => router.push(`/stocks/${h.symbol}`)}>
                <td><b style={{ color: 'var(--gold)' }}>{h.symbol}</b></td>
                <td style={{ color: 'var(--ink3)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.name}</td>
                <td style={{ textAlign: 'right' }}>{(+h.qty).toLocaleString('en-IN')}</td>
                <td style={{ textAlign: 'right', color: 'var(--ink3)' }}>₹{(+h.unit_cost).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                <td style={{ textAlign: 'right' }}>₹{(+h.market_price).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{fc(h.market_value)}</td>
                <td style={{ textAlign: 'right' }} className={colorClass(h.pnl)}>{fs(h.pnl)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }} className={colorClass(h.pnl_pct)}>{fsp(h.pnl_pct)}</td>
                <td>
                  <div className="pb">
                    <div className="pt"><div className="pf pf-g" style={{ width: `${Math.min(100, +h.holding_pct * 100 * 4)}%` }} /></div>
                    <span style={{ fontSize: 10, fontWeight: 700 }}>{fp(h.holding_pct)}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  );
}
