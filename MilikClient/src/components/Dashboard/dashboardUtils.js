// Shared utilities for all Dashboard components.
// Single source of truth — edit predicates/formatters here, nowhere else.

// ─── Primitive helpers ────────────────────────────────────────────────────────
export const normalizeId   = (v) => (!v ? '' : typeof v === 'string' ? v : v?._id || v?.id || '');
export const normalizeText = (v) => String(v || '').trim().toLowerCase();
export const parseDate     = (v) => { const d = v ? new Date(v) : null; return d && !isNaN(d.getTime()) ? d : null; };

// ─── Unit predicates ──────────────────────────────────────────────────────────
export const isOffMarketUnit   = (s) => ['off_market', 'inactive', 'archived', 'disabled'].includes(normalizeText(s));
export const isMaintenanceUnit = (s) => ['maintenance', 'under_maintenance'].includes(normalizeText(s));
export const isReservedUnit    = (s) => normalizeText(s) === 'reserved';

// ─── Entity predicates ────────────────────────────────────────────────────────
export const isOpenMaintenance = (s) => !['completed', 'cancelled', 'resolved', 'closed'].includes(normalizeText(s));
export const isActiveTenant    = (t) => !['inactive', 'terminated', 'evicted', 'moved_out'].includes(normalizeText(t?.status));
export const isActiveInvoice   = (inv) => !['cancelled', 'reversed'].includes(normalizeText(inv?.status));
export const isActivePayment   = (p) =>
  p?.isConfirmed === true && !p?.reversalOf && !p?.isReversed && !p?.isCancelled
  && normalizeText(p?.postingStatus) !== 'reversed';
export const isSnapshotInvoice = (inv) =>
  ['RENT_CHARGE', 'UTILITY_CHARGE'].includes(String(inv?.category || '').toUpperCase());

// ─── Invoice helpers ──────────────────────────────────────────────────────────
export const invoiceGross = (inv) => Number(inv?.adjustedAmount ?? inv?.netAmount ?? inv?.amount ?? 0);
export const invoiceNet   = (inv) =>
  Math.max(0, Number(inv?.adjustedAmount ?? inv?.amount ?? 0) - Number(inv?.taxSnapshot?.taxAmount ?? 0));
export const invoiceDate  = (inv) => parseDate(inv?.bookingDate || inv?.invoiceDate || inv?.createdAt);
export const invoiceOutstanding = (inv) => {
  const snap = Number(inv?.outstanding ?? inv?.remainingCreditableAmount ?? 0);
  if (snap > 0) return snap;
  if (['pending', 'partially_paid', 'part_paid'].includes(normalizeText(inv?.status)))
    return Math.max(0, invoiceGross(inv));
  return 0;
};

// ─── Unit classifier ──────────────────────────────────────────────────────────
// Returns 'off_market' | 'maintenance' | 'reserved' | 'occupied' | 'vacant'
export const classifyUnit = (unit, tenantsByUnit, maintByUnit, today) => {
  const uid = normalizeId(unit?._id);
  const raw = normalizeText(unit?.status);
  if (isOffMarketUnit(raw))  return 'off_market';
  if (isMaintenanceUnit(raw) || (maintByUnit.get(uid) || []).length > 0) return 'maintenance';
  if (isReservedUnit(raw))   return 'reserved';
  const tenant  = unit?.currentTenant || (tenantsByUnit.get(uid) || [])[0] || null;
  const moveOut = parseDate(tenant?.moveOutDate || tenant?.terminationDate || tenant?.noticeDate);
  if (moveOut && moveOut >= today)     return 'occupied'; // notice given, future move-out
  if (tenant || raw === 'occupied' || unit?.isVacant === false || normalizeText(unit?.tenantName))
    return 'occupied';
  return 'vacant';
};

// ─── Map builders (called once in Dashboard, passed as stable props) ──────────
export const buildTenantsByUnit = (tenants) => {
  const map = new Map();
  tenants.forEach((t) => {
    if (!isActiveTenant(t)) return;
    [normalizeId(t?.unit), ...(t?.additionalUnits || []).map(normalizeId)]
      .filter(Boolean)
      .forEach((uid) => { if (!map.has(uid)) map.set(uid, []); map.get(uid).push(t); });
  });
  return map;
};

export const buildMaintByUnit = (maintenances) => {
  const map = new Map();
  maintenances.forEach((m) => {
    if (!isOpenMaintenance(m?.status)) return;
    const uid = normalizeId(m?.unit);
    if (uid) { if (!map.has(uid)) map.set(uid, []); map.get(uid).push(m); }
  });
  return map;
};

// ─── Money formatter ──────────────────────────────────────────────────────────
// prefix = true → "KSh 1.2M", false → "1.2M"
export const fmtKES = (v, prefix = true) => {
  const n   = Number(v || 0);
  const pfx = prefix ? 'KSh ' : '';
  if (n >= 1_000_000) return `${pfx}${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${pfx}${(n / 1_000).toFixed(1)}K`;
  return `${pfx}${Math.round(n).toLocaleString()}`;
};

// Compact no-prefix for chart Y-axis ticks
export const shortKES = (v) => fmtKES(v, false);

// Full precision for tooltip
export const fullKES = (v) => `KES ${Number(v || 0).toLocaleString('en-KE')}`;
