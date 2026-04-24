'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import DashboardShell from '@/components/layout/DashboardShell';
import { uploadAPI } from '@/lib/api';
import { getSession } from '@/lib/auth';
import toast from 'react-hot-toast';
import { formatDate } from '@/lib/formatters';

export default function UploadPage() {
  const router   = useRouter();
  const fileRef  = useRef();
  const [logs,    setLogs]    = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadId,  setUploadId]  = useState(null);
  const [status,    setStatus]    = useState(null);
  const [dragging,  setDragging]  = useState(false);
  const pollRef = useRef(null);

  useEffect(() => {
    const { user } = getSession();
    if (user?.role !== 'admin') { router.replace('/dashboard'); return; }
    uploadAPI.logs().then(setLogs).catch(() => {});
  }, []);

  useEffect(() => {
    if (!uploadId) return;
    pollRef.current = setInterval(async () => {
      try {
        const s = await uploadAPI.status(uploadId);
        setStatus(s);
        if (s.status === 'success') {
          clearInterval(pollRef.current);
          toast.success(`${s.client_count} clients loaded!`);
          uploadAPI.logs().then(setLogs);
        }
        if (s.status === 'error') {
          clearInterval(pollRef.current);
          toast.error(s.error_message || 'Parse failed');
        }
      } catch {}
    }, 1500);
    return () => clearInterval(pollRef.current);
  }, [uploadId]);

  async function handleFile(file) {
    if (!file) return;
    if (!file.name.match(/\.(xls|xlsx)$/i)) { toast.error('Only .xls/.xlsx allowed'); return; }
    setUploading(true);
    setStatus(null);
    try {
      const res = await uploadAPI.upload(file);
      setUploadId(res.uploadId);
      toast.success('File received, parsing…');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUploading(false);
    }
  }

  function onDrop(e) {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  return (
    <DashboardShell title="Upload Portfolio Data" subtitle="Admin only — upload daily Excel file">
      <div style={{ maxWidth: 560 }}>
        {/* Drop zone */}
        <div
          className={`upz${dragging ? ' over' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
        >
          <input type="file" ref={fileRef} accept=".xls,.xlsx" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
          <div style={{ fontSize: 48, marginBottom: 16 }}>📂</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>
            {uploading ? 'Uploading…' : 'Click or drag to upload'}
          </div>
          <div style={{ color: 'var(--ink3)', fontSize: 12, marginBottom: 20 }}>
            Multi-sheet Excel (.xls / .xlsx) · Each sheet = one client
          </div>
          {!uploading && (
            <div className="btn btn-gold" style={{ display: 'inline-flex', pointerEvents: 'none' }}>Browse File</div>
          )}
          {uploading && <div className="spin" />}
        </div>

        {/* Status */}
        {status && (
          <div className="panel" style={{ marginTop: 14 }}>
            {status.status === 'processing' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="spin" />
                <span style={{ color: 'var(--ink3)', fontSize: 12 }}>Parsing {status.filename}…</span>
              </div>
            )}
            {status.status === 'success' && (
              <>
                <div style={{ color: 'var(--green)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>✓ Loaded</div>
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{status.filename}</div>
                <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 12 }}>{status.client_count} portfolios · {status.stock_count} stocks</div>
                <button className="btn btn-gold btn-sm" onClick={() => router.push('/dashboard')}>Open Dashboard →</button>
              </>
            )}
            {status.status === 'error' && (
              <div style={{ color: 'var(--red)' }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Parse Error</div>
                <div style={{ fontSize: 11 }}>{status.error_message}</div>
              </div>
            )}
          </div>
        )}

        {/* Upload history */}
        {logs.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Upload History</div>
            <div className="tbl">
              <table>
                <thead><tr><th>File</th><th>Clients</th><th>Stocks</th><th>Status</th><th>Uploaded By</th><th>When</th></tr></thead>
                <tbody>
                  {logs.map(l => (
                    <tr key={l.id}>
                      <td style={{ fontWeight: 600 }}>{l.filename}</td>
                      <td>{l.client_count}</td>
                      <td>{l.stock_count}</td>
                      <td>
                        <span className={`bdg ${l.status === 'success' ? 'bdg-grn' : l.status === 'error' ? 'bdg-red' : 'bdg-amb'}`}>
                          {l.status}
                        </span>
                      </td>
                      <td style={{ color: 'var(--ink3)' }}>{l.uploader_name || '—'}</td>
                      <td style={{ color: 'var(--ink3)', fontSize: 11 }}>{formatDate(l.uploaded_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
