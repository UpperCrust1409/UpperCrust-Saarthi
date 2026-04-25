'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardShell from '@/components/layout/DashboardShell';
import KPICard from '@/components/ui/KPICard';
import { tagsAPI } from '@/lib/api';
import { fsp } from '@/lib/formatters';
import { getSession } from '@/lib/auth';
import toast from 'react-hot-toast';

const SECTORS = ['Defence Manufacturing','Base Metals','Precious Metals','BFSI','Energy','IT & Technology','Capital Goods','Infrastructure','Agri / Commodity','Liquid / Cash','Other'];
const ASSET_TYPES = ['Equity','Gold ETF','Silver ETF','Debt ETF','InvIT / REIT','Hybrid','Commodity','Other'];
const DEFAULT_LIMITS = {
  'Defence Manufacturing': 0.25,
  'Precious Metals': 0.25,
  'BFSI': 0.20,
  'Energy': 0.20,
  'Infrastructure': 0.20,
  'Other': 0.15
};

export default function TagsPage() {
  const router = useRouter();
  const [tags, setTags] = useState([]);
  const [sectorLimits, setSectorLimits] = useState(DEFAULT_LIMITS);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');
  const [editingSector, setEditingSector] = useState(null);
  const [editingLimitValue, setEditingLimitValue] = useState('');

  useEffect(() => {
    const { token } = getSession();
    if (!token) { router.replace('/login'); return; }

    Promise.all([
      tagsAPI.list(),
      tagsAPI.sectorLimits()
    ]).then(([t, l]) => {
      setTags(t.tags || []);
      if (l.limits) {
        const merged = { ...DEFAULT_LIMITS, ...l.limits };
        setSectorLimits(merged);
      }
    }).catch(err => console.error(err)).finally(() => setLoading(false));
  }, []);

  const handleTagUpdate = async (symbol, updates) => {
    try {
      await tagsAPI.update(symbol, updates);
      setTags(prev => prev.map(t => t.symbol === symbol ? { ...t, ...updates } : t));
      toast.success(`${symbol} updated`);
    } catch (err) {
      toast.error('Failed to update tag');
      console.error(err);
    }
  };

  const handleSectorLimitUpdate = async (sector, pct) => {
    try {
      await tagsAPI.updateSectorLimit(sector, pct);
      setSectorLimits(prev => ({ ...prev, [sector]: pct }));
      toast.success(`${sector} limit updated`);
    } catch (err) {
      toast.error('Failed to update sector limit');
      console.error(err);
    }
  };

  const handleResetAll = () => {
    if (!window.confirm('Reset all tags to untagged? This cannot be undone.')) return;
    // Reset would be done via API in production
    toast.info('Reset functionality would be implemented via API');
  };

  if (loading) return <DashboardShell title="Tag Manager"><div style={{ padding: 48, textAlign: 'center' }}><div className="spin" /></div></DashboardShell>;

  const untagged = tags.filter(t => !t.sector || t.sector === 'Untagged').length;
  const tagged = tags.length - untagged;
  const total = tags.length;

  // Filter logic
  let filtered = [...tags];
  if (filter === 'Untagged') filtered = filtered.filter(t => !t.sector || t.sector === 'Untagged');
  if (filter === 'Tagged') filtered = filtered.filter(t => t.sector && t.sector !== 'Untagged');
  if (search) filtered = filtered.filter(t => t.symbol.toLowerCase().includes(search.toLowerCase()) || (t.name || '').toLowerCase().includes(search.toLowerCase()));

  return (
    <DashboardShell title="Tag Manager" subtitle="Manage stock classifications and sector limits">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 18 }}>
        <KPICard label="Untagged" value={untagged} variant={untagged > 0 ? 'amb' : 'grn'} />
        <KPICard label="Tagged" value={tagged} variant="gold" />
        <KPICard label="Total Stocks" value={total} />
        <KPICard label="Coverage" value={fsp(tagged / (total || 1))} />
      </div>

      {untagged > 0 && (
        <div style={{ padding: '10px 12px', background: 'var(--amb2)', border: '1px solid var(--ambbdr)', borderRadius: 'var(--r)', marginBottom: 16, fontSize: 10, color: 'var(--amber)', fontWeight: 600 }}>
          Warning: {untagged} stocks are untagged and may not be tracked properly
        </div>
      )}

      {/* Search and filters */}
      <div className="panel" style={{ padding: '14px 16px', marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px 150px', gap: 10 }}>
          <input
            type="text"
            placeholder="Search by symbol or name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ padding: '8px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)' }}
          />
          <select
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{ padding: '8px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)' }}
          >
            <option value="All">All Stocks</option>
            <option value="Untagged">Untagged</option>
            <option value="Tagged">Tagged</option>
          </select>
          <button
            onClick={handleResetAll}
            style={{ padding: '8px 10px', background: 'var(--red2)', color: 'var(--red)', border: 'none', borderRadius: 'var(--r)', fontWeight: 600, cursor: 'pointer', fontSize: 10 }}
          >
            Reset All
          </button>
        </div>
      </div>

      {/* Tags table */}
      <div className="panel" style={{ padding: '14px 16px', marginBottom: 20 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
          Stock Tags ({filtered.length})
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 9 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--bdr)' }}>
                <th style={{ textAlign: 'left', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Symbol</th>
                <th style={{ textAlign: 'left', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Name</th>
                <th style={{ textAlign: 'left', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Sector</th>
                <th style={{ textAlign: 'left', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Asset Type</th>
                <th style={{ textAlign: 'center', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Max %</th>
                <th style={{ textAlign: 'center', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Hidden</th>
                <th style={{ textAlign: 'center', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Status</th>
                <th style={{ textAlign: 'center', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 50).map((t, i) => (
                <tr key={i} style={{ borderBottom: i < Math.min(50, filtered.length) - 1 ? '1px solid var(--bdr)' : 'none' }}>
                  <td style={{ padding: '6px 0', color: 'var(--ink)', fontWeight: 600 }}>{t.symbol}</td>
                  <td style={{ padding: '6px 0', color: 'var(--ink2)', fontSize: 8 }}>{t.name || '—'}</td>
                  <td style={{ padding: '6px 0' }}>
                    <select
                      value={t.sector || ''}
                      onChange={e => handleTagUpdate(t.symbol, { sector: e.target.value })}
                      style={{ padding: '4px 6px', border: '1px solid var(--bdr)', borderRadius: 3, background: 'var(--sur)', color: 'var(--ink)', fontSize: 8 }}
                    >
                      <option value="">Untagged</option>
                      {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: '6px 0' }}>
                    <select
                      value={t.assetType || ''}
                      onChange={e => handleTagUpdate(t.symbol, { assetType: e.target.value })}
                      style={{ padding: '4px 6px', border: '1px solid var(--bdr)', borderRadius: 3, background: 'var(--sur)', color: 'var(--ink)', fontSize: 8 }}
                    >
                      <option value="">—</option>
                      {ASSET_TYPES.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: '6px 0', textAlign: 'center' }}>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={(t.maxAlloc || 10) * 100}
                      onChange={e => handleTagUpdate(t.symbol, { maxAlloc: parseFloat(e.target.value) / 100 })}
                      style={{ width: 40, padding: '2px 4px', border: '1px solid var(--bdr)', borderRadius: 3, background: 'var(--sur)', color: 'var(--ink)', fontSize: 8, textAlign: 'center' }}
                    />
                  </td>
                  <td style={{ padding: '6px 0', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={t.hidden || false}
                      onChange={e => handleTagUpdate(t.symbol, { hidden: e.target.checked })}
                      style={{ cursor: 'pointer' }}
                    />
                  </td>
                  <td style={{ padding: '6px 0', textAlign: 'center' }}>
                    <span style={{ fontSize: 7, fontWeight: 700, padding: '2px 4px', borderRadius: 2, background: t.sector ? 'var(--grn2)' : 'var(--red2)', color: t.sector ? 'var(--green)' : 'var(--red)' }}>
                      {t.sector ? 'TAGGED' : 'UNTAGGED'}
                    </span>
                  </td>
                  <td style={{ padding: '6px 0', textAlign: 'center' }}>
                    <button
                      onClick={() => handleTagUpdate(t.symbol, { sector: '', assetType: '' })}
                      style={{ background: 'none', border: 'none', color: 'var(--ink3)', cursor: 'pointer', fontSize: 8, fontWeight: 600 }}
                    >
                      Reset
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length > 50 && <div style={{ fontSize: 9, color: 'var(--ink4)', marginTop: 8 }}>Showing 50 of {filtered.length}</div>}
      </div>

      {/* Sector allocation limits */}
      <div className="panel" style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
          Sector Allocation Limits
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 10 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--bdr)' }}>
                <th style={{ textAlign: 'left', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Sector</th>
                <th style={{ textAlign: 'center', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Default Limit</th>
                <th style={{ textAlign: 'center', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Override</th>
                <th style={{ textAlign: 'center', padding: '6px 0', fontWeight: 700, color: 'var(--ink)' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {SECTORS.map((sector, i) => {
                const defaultLimit = DEFAULT_LIMITS[sector] || 0.15;
                const currentLimit = sectorLimits[sector] || defaultLimit;
                const isOverridden = currentLimit !== defaultLimit;

                return (
                  <tr key={i} style={{ borderBottom: i < SECTORS.length - 1 ? '1px solid var(--bdr)' : 'none' }}>
                    <td style={{ padding: '6px 0', color: 'var(--ink2)', fontWeight: 600 }}>{sector}</td>
                    <td style={{ padding: '6px 0', textAlign: 'center', color: 'var(--ink3)' }}>{fsp(defaultLimit)}</td>
                    <td style={{ padding: '6px 0', textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'center', alignItems: 'center' }}>
                        {editingSector === sector ? (
                          <>
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="1"
                              value={editingLimitValue * 100}
                              onChange={e => setEditingLimitValue(parseFloat(e.target.value) / 100)}
                              style={{ width: 50, padding: '4px 6px', border: '1px solid var(--bdr)', borderRadius: 3, background: 'var(--sur)', color: 'var(--ink)', fontSize: 9 }}
                            />
                            <button
                              onClick={() => {
                                handleSectorLimitUpdate(sector, editingLimitValue);
                                setEditingSector(null);
                              }}
                              style={{ padding: '2px 6px', background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 8, fontWeight: 600 }}
                            >
                              Save
                            </button>
                          </>
                        ) : (
                          <div
                            onClick={() => { setEditingSector(sector); setEditingLimitValue(currentLimit); }}
                            style={{ cursor: 'pointer', color: isOverridden ? 'var(--gold)' : 'var(--ink3)', fontWeight: isOverridden ? 700 : 400 }}
                          >
                            {fsp(currentLimit)}
                          </div>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '6px 0', textAlign: 'center' }}>
                      {isOverridden && (
                        <button
                          onClick={() => handleSectorLimitUpdate(sector, defaultLimit)}
                          style={{ background: 'none', border: 'none', color: 'var(--ink3)', cursor: 'pointer', fontSize: 8, fontWeight: 600 }}
                        >
                          Reset
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardShell>
  );
}
