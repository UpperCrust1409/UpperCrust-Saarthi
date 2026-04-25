'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardShell from '@/components/layout/DashboardShell';
import KPICard from '@/components/ui/KPICard';
import { getSession } from '@/lib/auth';
import { fc } from '@/lib/formatters';
import toast from 'react-hot-toast';

export default function OnboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    name: '',
    email: '',
    mobile: '',
    investmentAmount: '',
    riskProfile: 'Moderate',
    investmentDate: new Date().toISOString().split('T')[0]
  });
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    const { token } = getSession();
    if (!token) { router.replace('/login'); return; }
    setLoading(false);
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.mobile || !form.investmentAmount) {
      toast.error('All fields required');
      return;
    }

    setSummary({
      ...form,
      investmentAmount: parseFloat(form.investmentAmount)
    });
  };

  const handleCopyToClipboard = () => {
    if (!summary) return;
    const text = `New Client Onboarding Summary
Client Name: ${summary.name}
Email: ${summary.email}
Mobile: ${summary.mobile}
Investment Amount: ${fc(summary.investmentAmount)}
Risk Profile: ${summary.riskProfile}
Investment Date: ${summary.investmentDate}`;

    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  if (loading) return <DashboardShell title="New Client Onboarding"><div style={{ padding: 48, textAlign: 'center' }}><div className="spin" /></div></DashboardShell>;

  return (
    <DashboardShell title="New Client Onboarding" subtitle="Intake form for new investors">
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>
        {/* Form */}
        <div className="panel" style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            Client Information
          </div>
          <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
            <div>
              <label style={{ fontSize: 9, color: 'var(--ink3)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Full Name</label>
              <input
                type="text"
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder="Client name"
                style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ fontSize: 9, color: 'var(--ink3)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Email</label>
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                placeholder="client@example.com"
                style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ fontSize: 9, color: 'var(--ink3)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Mobile</label>
              <input
                type="tel"
                name="mobile"
                value={form.mobile}
                onChange={handleChange}
                placeholder="+91 9999999999"
                style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ fontSize: 9, color: 'var(--ink3)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Investment Amount</label>
              <input
                type="number"
                name="investmentAmount"
                value={form.investmentAmount}
                onChange={handleChange}
                placeholder="0"
                step="100000"
                style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ fontSize: 9, color: 'var(--ink3)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Risk Profile</label>
              <select
                name="riskProfile"
                value={form.riskProfile}
                onChange={handleChange}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)', boxSizing: 'border-box' }}
              >
                <option value="Conservative">Conservative</option>
                <option value="Moderate">Moderate</option>
                <option value="Aggressive">Aggressive</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: 9, color: 'var(--ink3)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Investment Date</label>
              <input
                type="date"
                name="investmentDate"
                value={form.investmentDate}
                onChange={handleChange}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)', boxSizing: 'border-box' }}
              />
            </div>

            <button
              type="submit"
              style={{ padding: '10px 14px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 'var(--r)', fontWeight: 600, cursor: 'pointer', marginTop: 6 }}
            >
              Generate Summary
            </button>
          </form>
        </div>

        {/* Summary */}
        <div>
          {summary ? (
            <>
              <div className="panel" style={{ padding: '14px 16px', marginBottom: 12 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
                  Onboarding Summary
                </div>
                <div style={{ display: 'grid', gap: 8, fontSize: 10 }}>
                  <div>
                    <div style={{ color: 'var(--ink4)', marginBottom: 2 }}>Name</div>
                    <div style={{ color: 'var(--ink)', fontWeight: 600 }}>{summary.name}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--ink4)', marginBottom: 2 }}>Email</div>
                    <div style={{ color: 'var(--ink)', fontWeight: 600, wordBreak: 'break-all' }}>{summary.email}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--ink4)', marginBottom: 2 }}>Mobile</div>
                    <div style={{ color: 'var(--ink)', fontWeight: 600 }}>{summary.mobile}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--ink4)', marginBottom: 2 }}>Investment Amount</div>
                    <div style={{ color: 'var(--gold)', fontWeight: 700, fontSize: 12 }}>{fc(summary.investmentAmount)}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--ink4)', marginBottom: 2 }}>Risk Profile</div>
                    <div style={{ color: 'var(--ink)', fontWeight: 600 }}>{summary.riskProfile}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--ink4)', marginBottom: 2 }}>Investment Date</div>
                    <div style={{ color: 'var(--ink)', fontWeight: 600 }}>{summary.investmentDate}</div>
                  </div>
                </div>
              </div>

              <button
                onClick={handleCopyToClipboard}
                style={{ width: '100%', padding: '8px 14px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 'var(--r)', fontWeight: 600, cursor: 'pointer' }}
              >
                Copy to Clipboard
              </button>
            </>
          ) : (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink4)' }}>
              Fill form to generate summary
            </div>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
