import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
  selectAllProperties, selectAllUnits,
} from '../../redux/selectors';
import {
  normalizeId, normalizeText,
  classifyUnit,
  fmtKES,
} from './dashboardUtils';
import { useTerms } from '../../hooks/useTerm';

// ─── Health colour ────────────────────────────────────────────────────────────
const health = (pct) => pct >= 80 ? '#0B3B2E' : pct >= 50 ? '#C8511A' : '#DC2626';

// ─── Occupancy SVG ring ───────────────────────────────────────────────────────
const OccupancyRing = React.memo(({ pct }) => {
  const r    = 18;
  const cx   = 22;
  const circ = 2 * Math.PI * r;
  const col  = health(pct);
  return (
    <svg width={44} height={44} className="shrink-0">
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="#E2E8F0" strokeWidth={4} />
      <circle
        cx={cx} cy={cx} r={r} fill="none"
        stroke={col} strokeWidth={4}
        strokeDasharray={`${circ * Math.min(pct, 100) / 100} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cx})`}
      />
      <text x={cx} y={cx + 4} textAnchor="middle" fontSize={9} fontWeight="800" fill={col}>
        {Math.round(pct)}%
      </text>
    </svg>
  );
});

// ─── Property tile ────────────────────────────────────────────────────────────
const PropertyTile = React.memo(({ property }) => {
  const navigate  = useNavigate();
  const collColor = health(property.collectionRate);
  const invoiced  = property.expectedRevenue > 0;

  return (
    <button
      type="button"
      onClick={() => navigate('/tenants', { state: { propertyFilter: property.name } })}
      className="group flex w-44 shrink-0 flex-col gap-2 border border-slate-200 bg-white p-3 text-left transition-all hover:border-[#0B3B2E] hover:shadow-sm"
    >
      {/* Ring + name */}
      <div className="flex items-center gap-2">
        <OccupancyRing pct={property.occupancyRate} />
        <div className="min-w-0">
          <p className="truncate text-[10px] font-black leading-tight text-slate-800" title={property.name}>
            {property.name}
          </p>
          <p className="text-[9px] font-semibold text-slate-400">{property.code}</p>
          <p className="mt-0.5 text-[9px] font-bold text-slate-500">
            {property.occupiedUnits}/{property.totalUnits} units
          </p>
        </div>
      </div>

      {/* Collection — hidden when not yet invoiced this month */}
      {invoiced ? (
        <div>
          <div className="mb-0.5 flex items-center justify-between">
            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Collection</span>
            <span className="text-[9px] font-black" style={{ color: collColor }}>
              {Math.min(Math.round(property.collectionRate), 100)}%
              {property.collectionRate > 100 && <span className="ml-0.5 text-[8px] font-bold text-emerald-600">+arr</span>}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.min(property.collectionRate, 100)}%`, backgroundColor: collColor }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[9px] text-slate-400">KES {fmtKES(property.monthlyCollection, false)}</span>
            <span className="text-[9px] text-slate-300">/ {fmtKES(property.expectedRevenue, false)}</span>
          </div>
        </div>
      ) : (
        <p className="text-[9px] italic text-slate-400">Not invoiced this month</p>
      )}

      {/* Vacancy badge */}
      {property.vacantUnits > 0 ? (
        <div className="rounded bg-amber-50 px-1.5 py-0.5">
          <span className="text-[9px] font-black text-amber-700">{property.vacantUnits} vacant</span>
        </div>
      ) : (
        <div className="rounded bg-emerald-50 px-1.5 py-0.5">
          <span className="text-[9px] font-black text-emerald-700">Fully occupied</span>
        </div>
      )}
    </button>
  );
});

// ─── Summary pane (left anchor) ───────────────────────────────────────────────
const SummaryPane = React.memo(({ occupancy, collection, total, navigate }) => (
  <div className="flex w-36 shrink-0 flex-col justify-between gap-3 border-r border-slate-200 bg-[#0B3B2E] p-3">
    <div>
      <p className="text-[9px] font-black uppercase tracking-widest text-white/50">Portfolio</p>
      <p className="mt-0.5 text-[10px] font-black text-white">{total} Propert{total === 1 ? 'y' : 'ies'}</p>
    </div>
    <div className="space-y-3">
      {[
        { label: 'Occupancy',  value: occupancy,  barCls: 'bg-white/80' },
        { label: 'Collection', value: collection, barCls: 'bg-[#C8511A]' },
      ].map(({ label, value, barCls }) => (
        <div key={label}>
          <p className="text-[9px] font-bold uppercase tracking-widest text-white/50">{label}</p>
          <p className="mt-0.5 text-2xl font-black leading-none text-white">{Math.min(value, 100).toFixed(1)}%</p>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/20">
            <div className={`h-full rounded-full ${barCls}`} style={{ width: `${Math.min(value, 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
    <button
      type="button"
      onClick={() => navigate('/properties')}
      className="text-left text-[9px] font-extrabold uppercase tracking-widest text-white/60 transition hover:text-white"
    >
      View all →
    </button>
  </div>
));

// ─── Main component ───────────────────────────────────────────────────────────
// Collection data comes from summaryData.propertyStats (server-aggregated) — no invoice iteration.
// Occupancy rings use units/tenants from Redux (loaded in Phase 2).
// tenantsByUnit, maintByUnit, today are computed ONCE in Dashboard.jsx — no duplicate Map-building.
const PropertiesOverview = ({
  summaryData   = {},
  tenantsByUnit = new Map(),
  maintByUnit   = new Map(),
  today         = new Date(),
}) => {
  const { property: termProperty, properties: termProperties, unit: termUnit, units: termUnits } = useTerms("property", "properties", "unit", "units");
  const navigate   = useNavigate();
  const properties = useSelector(selectAllProperties);
  const units      = useSelector(selectAllUnits);
  const loading    = useSelector((s) => s.property?.loading || s.property?.isFetching);

  // Server-computed per-property collection stats — O(1) lookup by propertyId
  const propStatsMap = useMemo(() => {
    const map = new Map();
    (summaryData.propertyStats || []).forEach((ps) => map.set(String(ps.propertyId), ps));
    return map;
  }, [summaryData.propertyStats]);

  const activeProperties = useMemo(
    () => properties.filter((p) => !p?.status || normalizeText(p.status) === 'active'),
    [properties],
  );

  const propertiesWithStats = useMemo(() => {
    return activeProperties.map((property) => {
      const pid    = String(property._id || '');
      const pUnits = units.filter((u) => String(normalizeId(u.property) || '') === pid);

      // Occupancy — uses pre-built Maps from Dashboard (no re-iteration)
      let occupied = 0, vacant = 0;
      pUnits.forEach((unit) => {
        const status = classifyUnit(unit, tenantsByUnit, maintByUnit, today);
        if (status === 'off_market' || status === 'maintenance' || status === 'reserved') return;
        if (status === 'occupied') { occupied++; } else { vacant++; }
      });

      // Collection — from server-aggregated stats (no invoice/payment iteration)
      const ps = propStatsMap.get(pid) || { expectedThisMonth: 0, collectedThisMonth: 0 };
      const expectedRevenue   = ps.expectedThisMonth;
      const monthlyCollection = ps.collectedThisMonth;
      const collectionRate    = expectedRevenue > 0 ? (monthlyCollection / expectedRevenue) * 100 : 0;

      const totalUnits    = pUnits.length;
      const occupancyRate = totalUnits > 0 ? (occupied / totalUnits) * 100 : 0;

      return {
        id:           pid,
        name:         property.propertyName || property.name || 'Unnamed',
        code:         property.propertyCode || '---',
        totalUnits, occupiedUnits: occupied, vacantUnits: vacant,
        occupancyRate, expectedRevenue, monthlyCollection, collectionRate,
      };
    }).sort((a, b) => b.occupancyRate - a.occupancyRate);
  }, [activeProperties, units, propStatsMap, tenantsByUnit, maintByUnit, today]);

  // Portfolio-level summary — occupancy from server, collection from propertyStats
  const portfolioOccupancy = Number(summaryData?.occupancyRate || 0);
  const portfolioCollection = useMemo(() => {
    const stats = summaryData.propertyStats || [];
    const exp = stats.reduce((s, ps) => s + ps.expectedThisMonth, 0);
    const col = stats.reduce((s, ps) => s + ps.collectedThisMonth, 0);
    return exp > 0 ? (col / exp) * 100 : 0;
  }, [summaryData.propertyStats]);

  if (loading && propertiesWithStats.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center border border-slate-200 bg-white">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#0B3B2E] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="overflow-hidden border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5">
        <h2 className="text-[10px] font-black uppercase tracking-widest text-[#0B3B2E]">{termProperties} Pulse</h2>
        <span className="text-[10px] font-semibold text-slate-400">
          {new Date().toLocaleString('en-KE', { month: 'long', year: 'numeric' })} · {propertiesWithStats.length} {propertiesWithStats.length === 1 ? termProperty : termProperties}
        </span>
      </div>
      <div className="flex overflow-x-auto">
        <SummaryPane
          occupancy={portfolioOccupancy}
          collection={portfolioCollection}
          total={propertiesWithStats.length}
          navigate={navigate}
        />
        {propertiesWithStats.length === 0 ? (
          <div className="flex flex-1 items-center justify-center py-10 text-xs font-semibold text-slate-400">
            No active {termProperties.toLowerCase()} found.
          </div>
        ) : (
          <div className="flex divide-x divide-slate-100">
            {propertiesWithStats.map((property) => (
              <PropertyTile
                key={property.id}
                property={property}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default React.memo(PropertiesOverview);
