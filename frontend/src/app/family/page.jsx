'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardShell from '@/components/layout/DashboardShell';
import KPICard from '@/components/ui/KPICard';
import { clientsAPI } from '@/lib/api';
import { fc, fsp } from '@/lib/formatters';
import { getSession } from '@/lib/auth';
import toast from 'react-hot-toast';

export default function FamilyPage() {
  const router = useRouter();
  const [families, setFamilies] = useState({});
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newFamilyName, setNewFamilyName] = useState('');
  const [selClient, setSelClient] = useState(null);
  const [selFamily, setSelFamily] = useState('');

  useEffect(() => {
    const { token } = getSession();
    if (!token) { router.replace('/login'); return; }

    // Load families from localStorage
    const saved = localStorage.getItem('saarthi_families');
    const parsed = saved ? JSON.parse(saved) : {};
    setFamilies(parsed);

    // Fetch clients
    clientsAPI.list().then(c => {
      setClients(c.clients || []);
    }).catch(err => console.error(err)).finally(() => setLoading(false));
  }, []);

  const handleAddFamily = () => {
    if (!newFamilyName.trim()) {
      toast.error('Family name required');
      return;
    }
    const updated = { ...families, [newFamilyName]: families[newFamilyName] || [] };
    setFamilies(updated);
    localStorage.setItem('saarthi_families', JSON.stringify(updated));
    setNewFamilyName('');
    toast.success('Family created');
  };

  const handleAssignClient = () => {
    if (!selFamily || !selClient) {
      toast.error('Select family and client');
      return;
    }
    const updated = { ...families };
    if (!updated[selFamily]) updated[selFamily] = [];
    if (!updated[selFamily].includes(selClient)) {
      updated[selFamily].push(selClient);
      setFamilies(updated);
      localStorage.setItem('saarthi_families', JSON.stringify(updated));
      toast.success('Client assigned to family');
    }
  };

  const handleRemoveClient = (familyName, clientId) => {
    const updated = { ...families };
    updated[familyName] = updated[familyName].filter(id => id !== clientId);
    setFamilies(updated);
    localStorage.setItem('saarthi_families', JSON.stringify(updated));
    toast.success('Client removed from family');
  };

  if (loading) return <DashboardShell title="Family View"><div style={{ padding: 48, textAlign: 'center' }}><div className="spin" /></div></DashboardShell>;

  const totalFamilies = Object.keys(families).length;
  const assignedClients = Object.values(families).reduce((sum, arr) => sum + arr.length, 0);

  // Calculate family totals
  const familyTotals = {};
  const familyPnL = {};
  Object.entries(families).forEach(([fname, clientIds]) => {
    const familyClients = clients.filter(c => clientIds.includes(c.id));
    familyTotals[fname] = familyClients.reduce((sum, c) => sum + (c.totalCurrent || 0), 0);
    familyPnL[fname] = familyClients.reduce((sum, c) => sum + ((c.unrealizedPnL || 0) + (c.realizedPnL || 0)), 0);
  });

  return (
    <DashboardShell title="Family View" subtitle="Group clients by family or entity">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 18 }}>
        <KPICard label="Families" value={totalFamilies} />
        <KPICard label="Assigned Clients" value={assignedClients} />
        <KPICard label="Unassigned Clients" value={clients.length - assignedClients} />
        <KPICard label="Total Families AUM" value={fc(Object.values(familyTotals).reduce((a, b) => a + b, 0))} />
      </div>

      {/* Add family form */}
      <div className="panel" style={{ padding: '14px 16px', marginBottom: 20 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
          Create Family Group
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            placeholder="Family name (e.g., Sharma Family)"
            value={newFamilyName}
            onChange={e => setNewFamilyName(e.target.value)}
            onKeyPress={e => e.key === 'Enter' && handleAddFamily()}
            style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)' }}
          />
          <button
            onClick={handleAddFamily}
            style={{ padding: '8px 14px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 'var(--r)', fontWeight: 600, cursor: 'pointer' }}
          >
            Create
          </button>
        </div>
      </div>

      {/* Assign client form */}
      <div className="panel" style={{ padding: '14px 16px', marginBottom: 20 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
          Assign Client to Family
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <select
            value={selFamily}
            onChange={e => setSelFamily(e.target.value)}
            style={{ padding: '8px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)' }}
          >
            <option value="">Select family</option>
            {Object.keys(families).map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <select
            value={selClient}
            onChange={e => setSelClient(e.target.value)}
            style={{ padding: '8px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)' }}
          >
            <option value="">Select client</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button
            onClick={handleAssignClient}
            style={{ padding: '8px 14px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 'var(--r)', fontWeight: 600, cursor: 'pointer' }}
          >
            Assign
          </button>
        </div>
      </div>

      {/* Family groups */}
      {Object.keys(families).length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 16 }}>
          {Object.entries(families).map(([fname, clientIds]) => (
            <div key={fname} className="panel" style={{ padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{fname}</div>
                  <div style={{ fontSize: 9, color: 'var(--ink4)', marginTop: 2 }}>{clientIds.length} clients</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold)' }}>{fc(familyTotals[fname])}</div>
                  <div style={{ fontSize: 9, color: 'var(--ink4)' }}>{fsp(familyPnL[fname] / (familyTotals[fname] || 1))}</div>
                </div>
              </div>
              <hr style={{ border: 'none', borderTop: '1px solid var(--bdr)', margin: '8px 0 10px' }} />
              <div style={{ display: 'grid', gap: 4 }}>
                {clientIds.map(cid => {
                  const client = clients.find(c => c.id === cid);
                  return (
                    <div key={cid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, padding: '4px 0' }}>
                      <div style={{ color: 'var(--ink2)' }}>{client?.name || cid}</div>
                      <button
                        onClick={() => handleRemoveClient(fname, cid)}
                        style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 9 }}
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink4)' }}>
          No families created yet. Create one to get started.
        </div>
      )}
    </DashboardShell>
  );
}
