export function formatDate(dateStr) {
  if (!dateStr || dateStr === 'TBD') return 'TBD';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 'TBD';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatDateTime(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}

export function isOverdue(dateStr, readiness) {
  if (!dateStr || dateStr === 'TBD' || (readiness ?? 0) >= 100) return false;
  const target = new Date(dateStr);
  return !isNaN(target.getTime()) && target < new Date();
}

export function isUpcoming(dateStr, reminderDays = 5) {
  if (!dateStr || dateStr === 'TBD') return false;
  const target = new Date(dateStr);
  if (isNaN(target.getTime())) return false;
  const now = new Date();
  const diffDays = (target - now) / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= reminderDays;
}

export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  if (isNaN(target.getTime())) return null;
  return Math.ceil((target - new Date()) / (1000 * 60 * 60 * 24));
}

export function daysOverdue(dateStr) {
  if (!dateStr) return 0;
  const target = new Date(dateStr);
  if (isNaN(target.getTime())) return 0;
  const diff = Math.ceil((new Date() - target) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 0;
}
