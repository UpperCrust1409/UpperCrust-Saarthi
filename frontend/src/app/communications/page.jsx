'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardShell from '@/components/layout/DashboardShell';
import { clientsAPI } from '@/lib/api';
import { fc, fsp, colorStyle } from '@/lib/formatters';
import { getSession } from '@/lib/auth';
import toast from 'react-hot-toast';

export default function CommunicationsPage() {
  const router = useRouter();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selClient, setSelClient] = useState('');
  const [template, setTemplate] = useState('whatsapp');
  const [content, setContent] = useState('');

  useEffect(() => {
    const { token } = getSession();
    if (!token) { router.replace('/login'); return; }

    clientsAPI.list().then(c => {
      setClients(c.clients || []);
    }).catch(err => console.error(err)).finally(() => setLoading(false));
  }, []);

  const generateMessage = () => {
    const client = clients.find(c => c.id === selClient);
    if (!client) {
      toast.error('Select a client');
      return;
    }

    const holdings = client.holdings || [];
    const topHoldings = holdings.sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, 5);

    if (template === 'whatsapp') {
      const msg = `Hi ${client.name.split(' ')[0]},

Your portfolio update as on ${new Date().toLocaleDateString('en-IN')}:

Portfolio Value: ${fc(client.totalCurrent || 0)}
Return: ${fsp(client.returnPct || 0)}
P&L: ${fc((client.unrealizedPnL || 0) + (client.realizedPnL || 0))}

Top Holdings:
${topHoldings.map((h, i) => `${i + 1}. ${h.symbol}: ${fc(h.value)} (${fsp(h.pct || 0)})`).join('\n')}

Need assistance? Reply or call.`;
      setContent(msg);
    } else if (template === 'email') {
      const msg = `Subject: Portfolio Update - ${new Date().toLocaleDateString('en-IN')}

Dear ${client.name},

We are pleased to provide you with your portfolio update as of ${new Date().toLocaleDateString('en-IN')}.

Portfolio Summary:
- Total Value: ${fc(client.totalCurrent || 0)}
- Return: ${fsp(client.returnPct || 0)}
- Unrealized P&L: ${fc(client.unrealizedPnL || 0)}
- Realized P&L: ${fc(client.realizedPnL || 0)}

Top 5 Holdings:
${topHoldings.map((h, i) => `${i + 1}. ${h.symbol}: ${fc(h.value)} (${fsp(h.pct || 0)})`).join('\n')}

Thank you for your continued trust.

Best regards,
Saarthi PMS Terminal`;
      setContent(msg);
    }
  };

  const handleCopyToClipboard = () => {
    if (!content) {
      toast.error('Generate a message first');
      return;
    }
    navigator.clipboard.writeText(content);
    toast.success('Copied to clipboard');
  };

  if (loading) return <DashboardShell title="Communications"><div style={{ padding: 48, textAlign: 'center' }}><div className="spin" /></div></DashboardShell>;

  return (
    <DashboardShell title="Communications" subtitle="Generate client reports and messages">
      {/* Generator */}
      <div className="panel" style={{ padding: '14px 16px', marginBottom: 20 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
          Message Generator
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 9, color: 'var(--ink3)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Client</label>
            <select
              value={selClient}
              onChange={e => setSelClient(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)' }}
            >
              <option value="">Select client</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 9, color: 'var(--ink3)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Template</label>
            <select
              value={template}
              onChange={e => setTemplate(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', background: 'var(--sur)', color: 'var(--ink)' }}
            >
              <option value="whatsapp">WhatsApp Message</option>
              <option value="email">Email Template</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button
              onClick={generateMessage}
              style={{ width: '100%', padding: '8px 14px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 'var(--r)', fontWeight: 600, cursor: 'pointer' }}
            >
              Generate
            </button>
          </div>
        </div>
      </div>

      {/* Content display */}
      {content && (
        <div className="panel" style={{ padding: '14px 16px', marginBottom: 12 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
            Generated {template === 'whatsapp' ? 'WhatsApp Message' : 'Email'}
          </div>
          <div style={{
            padding: '12px', background: 'var(--sur)', borderRadius: 'var(--r)',
            fontSize: 10, lineHeight: 1.5, color: 'var(--ink)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            maxHeight: '400px', overflowY: 'auto',
            border: '1px solid var(--bdr)'
          }}>
            {content}
          </div>
        </div>
      )}

      {/* Actions */}
      {content && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleCopyToClipboard}
            style={{ padding: '8px 14px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 'var(--r)', fontWeight: 600, cursor: 'pointer' }}
          >
            Copy to Clipboard
          </button>
          <button
            onClick={() => setContent('')}
            style={{ padding: '8px 14px', background: 'var(--sur)', color: 'var(--ink)', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', fontWeight: 600, cursor: 'pointer' }}
          >
            Clear
          </button>
        </div>
      )}

      {!content && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink4)' }}>
          Select a client and template to generate a message
        </div>
      )}
    </DashboardShell>
  );
}
