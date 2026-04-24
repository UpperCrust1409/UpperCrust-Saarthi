'use client';

export function saveSession(token, user) {
  localStorage.setItem('saarthi_token', token);
  localStorage.setItem('saarthi_user', JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem('saarthi_token');
  localStorage.removeItem('saarthi_user');
}

export function getSession() {
  if (typeof window === 'undefined') return { token: null, user: null };
  const token = localStorage.getItem('saarthi_token');
  try {
    const user = JSON.parse(localStorage.getItem('saarthi_user') || 'null');
    return { token, user };
  } catch {
    return { token, user: null };
  }
}

export function isAdmin() {
  const { user } = getSession();
  return user?.role === 'admin';
}
