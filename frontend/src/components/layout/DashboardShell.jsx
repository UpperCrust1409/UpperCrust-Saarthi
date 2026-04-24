'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSession } from '@/lib/auth';
import Sidebar from './Sidebar';
import { riskAPI } from '@/lib/api';

export default function DashboardShell({ children, title, subtitle }) {
  const router = useRouter();
  const [riskSummary, setRiskSummary] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const { token } = getSession();
    if (!token) { router.replace('/login'); return; }
    setReady(true);
    // Fetch risk summary for sidebar badge
    riskAPI.get().then(d => setRiskSummary(d.summary)).catch(() => {});
  }, []);

  if (!ready) {
    return (
      <div style={{ minHeight: '100vh', background: '#1a1610', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spin" />
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'var(--sb-w) 1fr', height: '100vh', overflow: 'hidden' }}>
      <Sidebar riskSummary={riskSummary} />
      <main style={{ display: 'flex', flexDirection: 'column', height: '100vh', minHeight: 0, overflow: 'hidden', background: 'var(--bg)' }}>
        {/* Page header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', height: 'var(--hdr-h)', background: 'var(--sur)', borderBottom: '1.5px solid var(--bdr)', flexShrink: 0, boxShadow: '0 1px 0 rgba(0,0,0,.04)' }}>
          <div>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>
              {title}
            </div>
            {subtitle && (
              <div style={{ fontSize: 11, color: 'var(--ink4)', marginTop: 1 }}>{subtitle}</div>
            )}
          </div>
        </div>
        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '18px 20px 24px', minHeight: 0 }}>
          {children}
        </div>
      </main>
    </div>
  );
}
