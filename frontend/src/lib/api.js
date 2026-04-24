/**
 * Centralised API client.
 * Reads token from localStorage and handles 401 auto-logout.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('saarthi_token');
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    localStorage.removeItem('saarthi_token');
    localStorage.removeItem('saarthi_user');
    window.location.href = '/login';
    throw new Error('Session expired');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── Auth ──
export const authAPI = {
  login:          (body)    => request('/api/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  me:             ()        => request('/api/auth/me'),
  createUser:     (body)    => request('/api/auth/create-user', { method: 'POST', body: JSON.stringify(body) }),
  changePassword: (body)    => request('/api/auth/change-password', { method: 'POST', body: JSON.stringify(body) })
};

// ── Dashboard ──
export const dashboardAPI = {
  get: () => request('/api/dashboard')
};

// ── Clients ──
export const clientsAPI = {
  list: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/clients${qs ? '?' + qs : ''}`);
  },
  get: (id) => request(`/api/clients/${id}`)
};

// ── Stocks ──
export const stocksAPI = {
  list: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/stocks${qs ? '?' + qs : ''}`);
  },
  get: (symbol) => request(`/api/stocks/${symbol}`)
};

// ── Risk ──
export const riskAPI = {
  get: () => request('/api/risk')
};

// ── Upload ──
export const uploadAPI = {
  upload: async (file) => {
    const token = getToken();
    const form  = new FormData();
    form.append('file', file);
    const res = await fetch(`${BASE}/api/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    return data;
  },
  status: (id)  => request(`/api/upload/status/${id}`),
  logs:   ()    => request('/api/upload/logs')
};

// ── Tags ──
export const tagsAPI = {
  list:             ()             => request('/api/tags'),
  update:           (sym, body)    => request(`/api/tags/${sym}`, { method: 'PUT', body: JSON.stringify(body) }),
  remove:           (sym)          => request(`/api/tags/${sym}`, { method: 'DELETE' }),
  sectorLimits:     ()             => request('/api/tags/sector-limits'),
  updateSectorLimit:(sector, pct)  => request(`/api/tags/sector-limits/${encodeURIComponent(sector)}`, { method: 'PUT', body: JSON.stringify({ pct }) })
};
