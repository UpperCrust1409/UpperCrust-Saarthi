'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardShell from '@/components/layout/DashboardShell';
import KPICard from '@/components/ui/KPICard';
import { clientsAPI, stocksAPI } from '@/lib/api';
import { fc, fsp } from '@/lib/formatters';
import { getSession } from '@/lib/auth';
import toast from 'react-hot-toast';

export default function FiltersPage() {
  const router = useRouter();
  const [filters, setFilters] = useState([]);
  const [clients, setClients] = useState([]);
  const [stocks, setStocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newFilter, setNewFilter] = useState({
    name: '',
    type: 'stock_max',
    target: '',
    threshold: ''
  });
  const [breaches, setBreaches] = useState([]);

  useEffect(() => {
    const { token } = getSession();
    if (!token) { router.replace('/login'); return; }

    // Load filters from localStorage
    const saved = localStorage.getItem('saarthi_filters');
    const parsed = saved ? JSON.parse(saved) : [];
    setFilters(parsed);

    // Fetch clients and stocks
    Promise.all([
      clientsAPI.list(),
      stocksAPI.list()
    ]).then(([c, s]) => {
      setClients(c.clients || []);
      setStocks(s.stocks || []);
    }).catch(err => console.error(err)).finally(() => setLoading(false));
  }, []);

  const evaluateFilters = (filtersToEval) => {
    const breachList = [];
    filtersToEval.forEach(f => {
      clients.forEach(c => {
        let isBreach = false;
        let currentValue = 0;

        if (f.type === 'stock_max') {
          const holding = c.holdings?.find(h => h.symbol === f.target);
          currentValue = holding ? (holding.value / (c.totalCurrent || 1)) : 0;
          isBreach = currentValue > (parseFloat(f.threshold) || 0) / 100;
        } else if (f.type === 'sector_max') {
          // Simplified sector allocation
          currentValue = 0.15; // Placeholder
          isBreach = currentValue > (parseFloat(f.threshold) || 0) / 100;
        } else if (f.type === 'cash_min') {
          currentValue = c.cash / (c.totalCurrent || 1);
          isBreach = currentValue < (parseFloat(f.threshold) || 0) / 100;
        } else if (f.type === 'cash_max') {
          currentValue = c.cash / (c.totalCurrent || 1);
          isBreach = currentValue > (parseFloat(f.threshold) || 0) / 100;
        } else if (f.type === 'top5_conc') {
          const top5 = (c.holdings || []).sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, 5);
          currentValue = top5.reduce((sum, h) => sum + (h.pct || 0), 0);
          isBreach = currentValue > (parseFloat(f.threshold) || 0) / 100;
        } else if (f.type === 'min_stocks') {
          currentValue = c.holdings?.length || 0;
          isBreach = currentValue < parseInt(f.threshold);
        } else if (f.type === 'drawdown_max') {
          currentValue = Math.abs((c.drawdown || 0) * 100);
          isBreach = currentValue > parseFloat(f.threshold);
        }

        if (isBreach) {
          breachList.push({
            filterName: f.name,
            client: c.name,
            currentValue: typeof currentValue === 'number' ? currentValue : 0,
            threshold: f.threshold,
            type: f.type
          });
        }
      });
    });
    setBreaches(breachList);
  };

  const handleAddFilter = () => {
    if (!newFilter.name || !newFilter.target || !newFilter.threshold) {
      toast.error('All fields required');
      return;
    }
    const updated = [...filters, { id: Date.now(), ...newFilter }];
    setFilters(updated);
    localStorage.setItem('saarthi_filters', JSON.stringify(updated));
    setNewFilter({ name: '', type: 'stock_max', target: '', threshold: '' });
    toast.success('Filter added');
    evaluateFilters(updated);
  };

  const handleRemoveFilter = (id) => {
    const updated = filters.filter(f => f.id !== id);
    setFilters(updated);
    localStorage.setItem('saarthi_filters', JSON.stringify(updated));
    toast.success('Filter removed');
    evaluateFilters(updated);
  };

  const applyQuickPreset = (presetName) => {
    let newFilters = [...filters];
    if (presetName === 'conservative') {
      newFilters.push(
        { id: Date.now(), name: 'Stock Limit 5%', type: 'stock_max', target: 'ANY', threshold: '5' },
        { id: Date.now() + 1, name: 'Min Cash 10%', type: 'cash_min', target: 'N/A', threshold: '10' },
        { id: Date.now() + 2, name: 'Max Top5 60%', type: 'top5_conc', target: 'N/A', threshold: '60' }
      );
    } else if (presetName === 'moderate') {
      newFilters.push(
        { id: Date.now(), name: 'Stock Limit 10%', type: 'stock_max', target: 'ANY', threshold: '10' },
        { id: Date.now() + 1, name: 'Min Cash 5%', type: 'cash_min', target: 'N/A', threshold: '5' },
        { id: Date.now() + 2, name: 'Max Top5 75%', type: 'top5_conc', target: 'N/A', threshold: '75' }
      );
    }
    setFilters(newFilters);
    localStorage.setItem('saarthi_filters', JSON.stringify(newFilters));
    evaluateFilters(newFilters);
    toast.success('Preset applied');
  };

  if (loading) return <DashboardShell title="Risk Filters"><div style={{ padding: 48, textAlign: 'center' }}><div className="spin" /></div></DashboardShell>;

  const filterCount = filters.length;
  const breachCount = breaches.length;

  return (
    <DashboardShell title="Risk Filters" subtitle="Custom portfolio constraint rules">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 18 }}>
        <KPICard label="Active Filters" value={filterCount} />
        <KPICard label="Breaches Detected" value={breachCount} variant={breachCount > 0 ? 'amb' : 'grn'} />
        <KPICard label="Clients" value={clients.length} />
        <KPICard label="Evaluation Status" value={filterCount > 0 ? 'Active' : 'None'} />
      </div>

      {/* Left panel: Add filter */}
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20 }}>
        {/* Add filter form */}
        <div className="panel" style={{ padding: '14px 16px', height: 'fit-content' }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            Add Filter
          </div>
          <div style={{ display: 'grid', gap: 10, marginBottom: 12 }}>
            <input
              type="text"
              placeholder="Filter name"
              value={newFilter.name}
              onChange={e => setNewFilter(prev => ({ ...prev, name: e.target.value }))}
              style={{ padding: '6px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)', fontSize: 10 }}
            />
            <select
              value={newFilter.type}
              onChange={e => setNewFilter(prev => ({ ...prev, type: e.target.value }))}
              style={{ padding: '6px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)', fontSize: 10 }}
            >
              <option value="stock_max">Stock Max %</option>
              <option value="sector_max">Sector Max %</option>
              <option value="cash_min">Min Cash %</option>
              <option value="cash_max">Max Cash %</option>
              <option value="top5_conc">Top5 Concentration %</option>
              <option value="min_stocks">Min Stocks</option>
              <option value="drawdown_max">Max Drawdown %</option>
            </select>
            <input
              type="text"
              placeholder="Target (symbol/sector)"
              value={newFilter.target}
              onChange={e => setNewFilter(prev => ({ ...prev, target: e.target.value }))}
              style={{ padding: '6px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)', fontSize: 10 }}
            />
            <input
              type="text"
              placeholder="Threshold value"
              value={newFilter.threshold}
              onChange={e => setNewFilter(prev => ({ ...prev, threshold: e.target.value }))}
              style={{ padding: '6px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)', fontSize: 10 }}
            />
            <button
              onClick={handleAddFilter}
              style={{ padding: '6px 10px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 'var(--r)', fontWeight: 600, cursor: 'pointer', fontSize: 10 }}
            >
              Add Filter
            </button>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--bdr)', margin: '12px 0' }} />

          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Quick Presets
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            <button
              onClick={() => applyQuickPreset('conservative')}
              style={{ padding: '6px 10px', background: 'var(--sur)', color: 'var(--ink)', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', fontWeight: 600, cursor: 'pointer', fontSize: 9 }}
            >
              Conservative
            </button>
            <button
              onClick={() => applyQuickPreset('moderate')}
              style={{ padding: '6px 10px', background: 'var(--sur)', color: 'var(--ink)', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', fontWeight: 600, cursor: 'pointer', fontSize: 9 }}
            >
              Moderate
            </button>
          </div>
        </div>

        {/* Right panel: Active filters and breaches */}
        <div style={{ display: 'grid', gap: 20 }}>
          {/* Active filters */}
          {filters.length > 0 && (
            <div className="panel" style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                Active Filters ({filters.length})
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {filters.map(f => (
                  <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px', background: 'var(--sur)', borderRadius: 'var(--r)', fontSize: 10 }}>
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--ink)', marginBottom: 2 }}>{f.name}</div>
                      <div style={{ color: 'var(--ink4)' }}>{f.type} = {f.threshold}</div>
                    </div>
                    <button
                      onClick={() => handleRemoveFilter(f.id)}
                      style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontWeight: 600 }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Breaches */}
          {breaches.length > 0 && (
            <div className="panel" style={{ padding: '14px 16px', borderLeft: '4px solid var(--amber)' }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                Breach Results ({breaches.length})
              </div>
              <div style={{ overflowX: 'auto', maxHeight: '300px', overflowY: 'auto' }}>
                <table style={{ width: '100%', fontSize: 9 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--bdr)' }}>
                      <th style={{ textAlign: 'left', padding: '4px', fontWeight: 700, color: 'var(--ink)' }}>Filter</th>
                      <th style={{ textAlign: 'left', padding: '4px', fontWeight: 700, color: 'var(--ink)' }}>Client</th>
                      <th style={{ textAlign: 'right', padding: '4px', fontWeight: 700, color: 'var(--ink)' }}>Current</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breaches.slice(0, 10).map((b, i) => (
                      <tr key={i} style={{ borderBottom: i < Math.min(10, breaches.length) - 1 ? '1px solid var(--bdr)' : 'none' }}>
                        <td style={{ padding: '4px', color: 'var(--ink)' }}>{b.filterName}</td>
                        <td style={{ padding: '4px', color: 'var(--ink2)' }}>{b.client}</td>
                        <td style={{ padding: '4px', textAlign: 'right', color: 'var(--amber)', fontWeight: 700 }}>
                          {typeof b.currentValue === 'number' ? (b.currentValue * 100).toFixed(1) : b.currentValue}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {filters.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink4)' }}>
              No filters configured. Add one to get started.
            </div>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
