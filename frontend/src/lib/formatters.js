/**
 * Shared formatting utilities — mirrors the original HTML helpers.
 */

export function fc(n) {
  n = Number(n) || 0;
  if (Math.abs(n) >= 1e7) return '₹' + (n / 1e7).toFixed(2) + ' Cr';
  if (Math.abs(n) >= 1e5) return '₹' + (n / 1e5).toFixed(2) + ' L';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

export function fp(n) {
  return (Number(n) * 100).toFixed(2) + '%';
}

export function fsp(n) {
  n = Number(n) || 0;
  return (n >= 0 ? '+' : '') + (n * 100).toFixed(2) + '%';
}

export function fs(n) {
  n = Number(n) || 0;
  return (n >= 0 ? '+' : '') + fc(n);
}

export function colorClass(n) {
  n = Number(n) || 0;
  return n >= 0 ? 'pos' : 'neg';
}

export function colorStyle(n) {
  n = Number(n) || 0;
  return { color: n >= 0 ? 'var(--green)' : 'var(--red)' };
}

export function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function durStr(yrs) {
  if (!yrs) return '—';
  const y = Math.floor(yrs), m = Math.round((yrs - y) * 12);
  return y > 0 ? (y + 'y ' + (m > 0 ? m + 'm' : '')) : (m + 'm');
}

export function cagrStr(currentMV, invested, yrs) {
  if (!yrs || yrs < 0.08 || !invested || !currentMV) return null;
  return Math.pow(currentMV / invested, 1 / yrs) - 1;
}

// Sector colour map
export const SCOL = {
  'Defence Manufacturing': '#3a6a5a',
  'Base Metals':           '#8a6814',
  'Precious Metals':       '#b8922a',
  'BFSI':                  '#6b4c8a',
  'Energy':                '#c05a1a',
  'IT & Technology':       '#1a5a8a',
  'Capital Goods':         '#4a6a2a',
  'Infrastructure':        '#2a5a4a',
  'Agri / Commodity':      '#5a7a1a',
  'Liquid / Cash':         '#7a7a7a',
  'Other':                 '#5a5a5a',
  'Untagged':              '#c0382a'
};

export const CHART_PALETTE = [
  '#b8912a','#d4a82e','#8a6814','#c9a84c',
  '#6b5020','#4a7c6f','#3a6a5a','#c05a1a',
  '#6b4c8a','#2a6a9a'
];
