'use client';
import { usePathname, useRouter } from 'next/navigation';
import { clearSession, getSession } from '@/lib/auth';
import toast from 'react-hot-toast';

const NAV = [
  {
    group: 'Monitor',
    items: [
      { id: 'dashboard',  label: 'Dashboard',   icon: '◉', href: '/dashboard' },
      { id: 'perf',       label: 'Performance',  icon: '◈', href: '/performance' }
    ]
  },
  {
    group: 'Portfolio',
    items: [
      { id: 'clients', label: 'Clients', icon: '◈', href: '/clients' },
      { id: 'stocks',  label: 'Stocks',  icon: '◇', href: '/stocks' },
      { id: 'sectors', label: 'Sectors', icon: '⬡', href: '/sectors' }
    ]
  },
  {
    group: 'Intelligence',
    items: [
      { id: 'risk',        label: 'Risk / Alerts',  icon: '⚡', href: '/risk' },
      { id: 'attribution', label: 'P&L Attribution', icon: '📊', href: '/attribution' },
      { id: 'health',      label: 'Portfolio Health', icon: '🩺', href: '/health' }
    ]
  },
  {
    group: 'Execute',
    items: [
      { id: 'sim',    label: 'Pre-Trade Sim',   icon: '◎', href: '/simulator' },
      { id: 'rebal',  label: 'Rebalancing',     icon: '⟳', href: '/rebalancing' },
      { id: 'capital',label: 'Capital Deploy',  icon: '◈', href: '/capital' },
      { id: 'onboard',label: 'New Client',      icon: '➕', href: '/onboard' }
    ]
  }
];

export default function Sidebar({ riskSummary }) {
  const pathname = usePathname();
  const router   = useRouter();
  const { user } = getSession();

  function logout() {
    clearSession();
    toast.success('Signed out');
    router.push('/login');
  }

  return (
    <aside style={{
      background: '#1a1610', color: '#fff',
      display: 'flex', flexDirection: 'column',
      height: '100vh', overflow: 'hidden',
      borderRight: '1px solid rgba(255,255,255,.05)',
      width: 'var(--sb-w)', flexShrink: 0
    }}>
      {/* Logo */}
      <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid rgba(255,255,255,.07)', flexShrink: 0 }}>
        <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '2.5px', textTransform: 'uppercase', color: '#8a6814', marginBottom: 2 }}>
          Uppercrust Wealth
        </div>
        <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 21, fontWeight: 700, color: '#f0d060', lineHeight: 1, letterSpacing: '-.3px' }}>
          Saarthi
        </div>
        <span style={{ fontSize: 8, fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'rgba(255,255,255,.28)', display: 'block', marginTop: 1 }}>
          PMS Terminal
        </span>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '6px 0 8px' }}>
        {NAV.map(({ group, items }) => (
          <div key={group}>
            <div style={{ padding: '10px 16px 4px', fontSize: 8.5, fontWeight: 700, letterSpacing: '1.8px', textTransform: 'uppercase', color: 'rgba(255,255,255,.28)' }}>
              {group}
            </div>
            {items.map(item => {
              const active = pathname === item.href || pathname?.startsWith(item.href + '/');
              const isRisk = item.id === 'risk';
              return (
                <div
                  key={item.id}
                  onClick={() => router.push(item.href)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 9,
                    padding: '7px 14px 7px 16px', cursor: 'pointer',
                    color: active ? '#f0d060' : 'rgba(255,255,255,.55)',
                    fontWeight: active ? 600 : 500, fontSize: 12,
                    background: active ? 'rgba(138,104,20,.22)' : 'transparent',
                    position: 'relative', transition: 'all .12s',
                    borderLeft: active ? '3px solid #b8922a' : '3px solid transparent'
                  }}
                  onMouseEnter={e => !active && (e.currentTarget.style.background = 'rgba(255,255,255,.055)')}
                  onMouseLeave={e => !active && (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ fontSize: 12, width: 18, textAlign: 'center', flexShrink: 0 }}>{item.icon}</span>
                  <span>{item.label}</span>
                  {isRisk && riskSummary?.breach > 0 && (
                    <span style={{ marginLeft: 'auto', fontSize: 8.5, fontWeight: 700, background: '#c0382a', color: '#fff', padding: '1px 5px', borderRadius: 10 }}>
                      {riskSummary.breach}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Bottom */}
      <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,.07)', flexShrink: 0 }}>
        {user?.role === 'admin' && (
          <button
            onClick={() => router.push('/upload')}
            style={{ width: '100%', justifyContent: 'center', marginBottom: 6, display: 'flex', background: '#2a2415', color: '#f0d060', border: '1.5px solid #3a3020', borderRadius: 7, padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            ⊕ Upload Data
          </button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px' }}>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.name || 'User'}
            </div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,.3)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
              {user?.role}
            </div>
          </div>
          <button onClick={logout} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.3)', cursor: 'pointer', fontSize: 11, fontWeight: 600, padding: '3px 6px' }}>
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}
