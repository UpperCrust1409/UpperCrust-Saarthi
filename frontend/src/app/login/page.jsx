'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { authAPI } from '@/lib/api';
import { saveSession, getSession } from '@/lib/auth';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const router   = useRouter();
  const [email, setEmail]   = useState('');
  const [pass,  setPass]    = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const { token } = getSession();
    if (token) router.replace('/dashboard');
  }, []);

  async function handleLogin(e) {
    e.preventDefault();
    if (!email || !pass) return toast.error('Enter email and password');
    setLoading(true);
    try {
      const { token, user } = await authAPI.login({ email, password: pass });
      saveSession(token, user);
      toast.success(`Welcome, ${user.name}`);
      router.push('/dashboard');
    } catch (err) {
      toast.error(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#1a1610', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '2.5px', textTransform: 'uppercase', color: '#8a6814', marginBottom: 6 }}>
            Uppercrust Wealth
          </div>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 36, fontWeight: 700, color: '#f0d060', lineHeight: 1 }}>
            Saarthi
          </div>
          <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'rgba(255,255,255,.3)', marginTop: 6 }}>
            PMS Terminal
          </div>
        </div>

        {/* Card */}
        <div style={{ background: '#211d14', border: '1px solid rgba(138,104,20,.3)', borderRadius: 12, padding: '32px 28px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#f0d060', marginBottom: 4, fontFamily: "'Playfair Display',serif" }}>
            Sign In
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 24 }}>
            Enter your credentials to access the terminal
          </div>

          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.7px', color: 'rgba(255,255,255,.4)', marginBottom: 6 }}>
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@uppercrust.com"
                required
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 7,
                  border: '1.5px solid rgba(138,104,20,.3)',
                  background: 'rgba(255,255,255,.05)', color: '#fff',
                  fontSize: 13, outline: 'none', fontFamily: 'Inter,sans-serif'
                }}
                onFocus={e => e.target.style.borderColor = '#b8922a'}
                onBlur={e  => e.target.style.borderColor = 'rgba(138,104,20,.3)'}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.7px', color: 'rgba(255,255,255,.4)', marginBottom: 6 }}>
                Password
              </label>
              <input
                type="password"
                value={pass}
                onChange={e => setPass(e.target.value)}
                placeholder="••••••••"
                required
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 7,
                  border: '1.5px solid rgba(138,104,20,.3)',
                  background: 'rgba(255,255,255,.05)', color: '#fff',
                  fontSize: 13, outline: 'none', fontFamily: 'Inter,sans-serif'
                }}
                onFocus={e => e.target.style.borderColor = '#b8922a'}
                onBlur={e  => e.target.style.borderColor = 'rgba(138,104,20,.3)'}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%', padding: '12px', borderRadius: 7,
                background: loading ? '#6a5010' : '#8a6814',
                border: 'none', color: '#fff', fontSize: 13, fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontFamily: 'Inter,sans-serif', transition: 'background .15s'
              }}
            >
              {loading ? 'Signing in…' : 'Sign In →'}
            </button>
          </form>
        </div>

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 10, color: 'rgba(255,255,255,.2)' }}>
          UpperCrust Wealth Management · Internal Tool
        </div>
      </div>
    </div>
  );
}
