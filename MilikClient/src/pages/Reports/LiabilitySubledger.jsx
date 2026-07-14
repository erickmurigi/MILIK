import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useTabState } from "../../hooks/useTabState";
import { toast } from "react-toastify";
import { hasCompanyPermission } from "../../utils/permissions";
import { selectCurrentCompany, selectCurrentUser, selectAllProperties } from "../../redux/selectors";
import { getLiabilitySubledger } from "../../redux/apiCalls";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import {
  FaBuilding, FaChevronDown, FaChevronRight, FaFileDownload, FaSyncAlt,
  FaLayerGroup, FaUser, FaCalendarAlt, FaExclamationTriangle,
} from "react-icons/fa";

const GRN = "#0B3B2E";
const RED = "#DC2626";

const TABS = [
  { key: "deposits",     label: "Tenant Deposits",     code: "2100", desc: "Deposits held on behalf of tenants" },
  { key: "landlord",    label: "Landlord Payables",    code: "2110", desc: "Amounts owed to landlords" },
  { key: "unallocated", label: "Unallocated Receipts", code: "2130", desc: "Tenant overpayments / prepayments" },
  { key: "tax",         label: "Tax Payable",          code: "2140", desc: "Output VAT / tax collected not yet remitted" },
  { key: "wht",         label: "WHT Payable",          code: "2141", desc: "Withholding tax not yet remitted" },
];

const today = () => new Date().toISOString().split("T")[0];

const fmt = (v) =>
  Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d) => {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" });
};

// ─── CSV ──────────────────────────────────────────────────────────────────────
const exportCSV = ({ tab, groups, total, accountCode, accountName, asOf }) => {
  const q = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const lines = [
    `"Liability Sub-Ledger — ${accountCode} ${accountName}"`,
    `"As at ${asOf || today()}"`,
    "",
  ];

  if (tab === "deposits" || tab === "unallocated") {
    const cols = tab === "deposits"
      ? ["Property", "Unit", "Tenant", "Invoice #", "Invoice Date", "Balance (KES)"]
      : ["Property", "Unit", "Tenant", "Balance (KES)"];
    lines.push(cols.join(","));
    groups.forEach((g) => {
      g.rows.forEach((r) => {
        const row = [q(g.propertyName), q(r.unitNumber), q(r.tenantName)];
        if (tab === "deposits") { row.push(q(r.invoiceNumber)); row.push(q(fmtDate(r.invoiceDate))); }
        row.push(fmt(r.balance));
        lines.push(row.join(","));
      });
      lines.push([`"Subtotal — ${g.propertyName}"`, "", "", tab === "deposits" ? "" : "", tab === "deposits" ? "" : "", fmt(g.subtotal)].filter((_, i) => !(tab !== "deposits" && i > 2 && i < 5)).join(","));
    });
  } else if (tab === "landlord") {
    lines.push(["Code", "Property", "Landlord", "Balance (KES)"].join(","));
    groups.forEach((g) => lines.push([q(g.propertyCode), q(g.propertyName), q(g.landlordName), fmt(g.balance)].join(",")));
  } else if (tab === "tax") {
    lines.push(["Month", "Reference", "Narration", "Property", "Date", "VAT (KES)"].join(","));
    groups.forEach((g) => {
      g.rows.forEach((r) => lines.push([q(g.monthLabel), q(r.reference), q(r.narration), q(r.property), q(fmtDate(r.date)), fmt(r.vatBalance)].join(",")));
      lines.push([`"${g.monthLabel} Subtotal"`, "", "", "", "", fmt(g.subtotal)].join(","));
    });
  } else {
    lines.push(["Month", "Voucher #", "Vendor", "Property", "Narration", "Gross (KES)", "WHT Held (KES)"].join(","));
    groups.forEach((g) => {
      g.rows.forEach((r) => lines.push([q(g.monthLabel), q(r.voucherNo), q(r.vendor), q(r.property), q(r.narration), fmt(r.grossAmount), fmt(r.whtBalance)].join(",")));
      lines.push([`"${g.monthLabel} Subtotal"`, "", "", "", "", "", fmt(g.subtotal)].join(","));
    });
  }
  lines.push("", `"GRAND TOTAL","${fmt(total)}"`);

  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `liability-${accountCode}-${asOf || today()}.csv` });
  a.click();
  URL.revokeObjectURL(url);
};

// ─── TenantGroup (2100 / 2130) ───────────────────────────────────────────────
const TenantGroup = ({ group, tab }) => {
  const [open, setOpen] = useTabState(`lsl:grp:${group.propertyId}`, true);
  const cols = tab === "deposits"
    ? "1fr 72px 100px 90px 110px"
    : "1fr 72px 130px";
  const hdrs = tab === "deposits"
    ? ["Tenant", "Unit", "Invoice #", "Inv. Date", "Balance"]
    : ["Tenant", "Unit", "Balance"];

  return (
    <div className="mb-1.5 overflow-hidden rounded border border-slate-200 bg-white shadow-sm">
      {/* Group header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 border-l-[3px] bg-slate-50 px-3 py-2.5 text-left transition-colors hover:bg-slate-100"
        style={{ borderLeftColor: GRN }}
      >
        <span className="text-slate-300">{open ? <FaChevronDown size={9} /> : <FaChevronRight size={9} />}</span>
        <FaBuilding size={10} className="shrink-0 text-slate-400" />
        <span className="flex-1 truncate text-[11px] font-bold text-slate-700">{group.propertyName}</span>
        <span className="mr-3 rounded-full bg-slate-200 px-2 py-0.5 text-[9px] font-bold text-slate-500">
          {group.rows.length}
        </span>
        <span className="w-32 text-right font-mono text-[12px] font-black tabular-nums" style={{ color: RED }}>
          {fmt(group.subtotal)}
        </span>
      </button>

      {open && (
        <>
          {/* Column headers */}
          <div
            className="grid border-b border-slate-100 bg-[#0B3B2E]/[0.03] px-4 py-1.5"
            style={{ gridTemplateColumns: cols }}
          >
            {hdrs.map((h, i) => (
              <span
                key={h}
                className={`text-[8px] font-bold uppercase tracking-[0.14em] text-slate-400 ${i === hdrs.length - 1 ? "text-right" : ""}`}
              >
                {h}
              </span>
            ))}
          </div>

          {/* Rows */}
          {group.rows.map((r, ri) => (
            <div
              key={r.tenantId}
              className={`grid items-center border-b border-slate-50 px-4 py-2 last:border-0 hover:bg-slate-50/80 ${ri % 2 !== 0 ? "bg-slate-50/30" : ""}`}
              style={{ gridTemplateColumns: cols }}
            >
              <span className="flex items-center gap-1.5 truncate text-[11px] text-slate-700">
                <FaUser size={8} className="shrink-0 text-slate-300" />
                {r.tenantName}
              </span>
              <span className="font-mono text-[10px] text-slate-500">{r.unitNumber || "—"}</span>
              {tab === "deposits" && (
                <>
                  <span className="font-mono text-[10px] text-slate-500">{r.invoiceNumber || "—"}</span>
                  <span className="text-[10px] text-slate-500">{fmtDate(r.invoiceDate)}</span>
                </>
              )}
              <span className="text-right font-mono text-[11px] font-bold tabular-nums" style={{ color: RED }}>
                {fmt(r.balance)}
              </span>
            </div>
          ))}

          {/* Subtotal */}
          <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-1.5">
            <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">
              Subtotal
            </span>
            <span className="font-mono text-[11px] font-black tabular-nums" style={{ color: RED }}>
              KES {fmt(group.subtotal)}
            </span>
          </div>
        </>
      )}
    </div>
  );
};

// ─── LandlordTable (2110) ─────────────────────────────────────────────────────
const LandlordTable = ({ groups }) => (
  <div className="overflow-hidden rounded border border-slate-200 bg-white shadow-sm">
    <div
      className="grid px-4 py-2.5"
      style={{ background: GRN, gridTemplateColumns: "56px 1fr 1fr 150px" }}
    >
      {["Code", "Property", "Primary Landlord", "Balance (KES)"].map((h, i) => (
        <span key={h} className={`text-[9px] font-bold uppercase tracking-[0.14em] text-white/70 ${i === 3 ? "text-right" : ""}`}>
          {h}
        </span>
      ))}
    </div>
    {groups.map((g, i) => (
      <div
        key={g.propertyId}
        className={`grid items-center border-b border-slate-50 px-4 py-3 last:border-0 hover:bg-slate-50 ${i % 2 !== 0 ? "bg-slate-50/40" : ""}`}
        style={{ gridTemplateColumns: "56px 1fr 1fr 150px" }}
      >
        <span className="font-mono text-[10px] text-slate-400">{g.propertyCode || "—"}</span>
        <div className="flex items-center gap-1.5">
          <FaBuilding size={9} className="shrink-0 text-slate-300" />
          <span className="text-[11px] font-semibold text-slate-700">{g.propertyName}</span>
        </div>
        <span className="text-[11px] text-slate-500">
          {g.landlordName || <em className="text-slate-300">No landlord linked</em>}
        </span>
        <span className="text-right font-mono text-[12px] font-black tabular-nums" style={{ color: RED }}>
          KES {fmt(g.balance)}
        </span>
      </div>
    ))}
  </div>
);

// ─── WHTGroup (2141) ──────────────────────────────────────────────────────────
const WHTGroup = ({ group }) => {
  const [open, setOpen] = useTabState(`lsl:wht:${group.month}`, true);
  const cols = "88px 1fr 130px 90px 110px 110px";
  const hdrs = ["Voucher #", "Narration / Vendor", "Property", "Date", "Gross (KES)", "WHT Held"];

  return (
    <div className="mb-1.5 overflow-hidden rounded border border-slate-200 bg-white shadow-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 border-l-[3px] bg-slate-50 px-3 py-2.5 text-left transition-colors hover:bg-slate-100"
        style={{ borderLeftColor: RED }}
      >
        <span className="text-slate-300">{open ? <FaChevronDown size={9} /> : <FaChevronRight size={9} />}</span>
        <FaCalendarAlt size={10} className="shrink-0 text-slate-400" />
        <span className="flex-1 text-[11px] font-bold text-slate-700">{group.monthLabel}</span>
        <span className="mr-3 rounded-full bg-slate-200 px-2 py-0.5 text-[9px] font-bold text-slate-500">
          {group.rows.length}
        </span>
        <span className="w-32 text-right font-mono text-[12px] font-black tabular-nums" style={{ color: RED }}>
          {fmt(group.subtotal)}
        </span>
      </button>

      {open && (
        <>
          <div className="grid border-b border-slate-100 bg-[#0B3B2E]/[0.03] px-4 py-1.5" style={{ gridTemplateColumns: cols }}>
            {hdrs.map((h, i) => (
              <span key={h} className={`text-[8px] font-bold uppercase tracking-[0.14em] text-slate-400 ${i >= 4 ? "text-right" : ""}`}>
                {h}
              </span>
            ))}
          </div>
          {group.rows.map((r, ri) => (
            <div
              key={r.sourceId}
              className={`grid items-center border-b border-slate-50 px-4 py-2 last:border-0 hover:bg-slate-50/80 ${ri % 2 !== 0 ? "bg-slate-50/30" : ""}`}
              style={{ gridTemplateColumns: cols }}
            >
              <span className="font-mono text-[10px] font-semibold text-[#0B3B2E]">{r.voucherNo}</span>
              <div className="min-w-0 pr-2">
                <div className="truncate text-[11px] text-slate-700">{r.narration || "—"}</div>
                {r.vendor && <div className="truncate text-[9px] text-slate-400">{r.vendor}</div>}
              </div>
              <span className="truncate text-[10px] text-slate-500">{r.property || "—"}</span>
              <span className="text-[10px] text-slate-500">{fmtDate(r.date)}</span>
              <span className="text-right font-mono text-[10px] tabular-nums text-slate-500">{fmt(r.grossAmount)}</span>
              <span className="text-right font-mono text-[11px] font-bold tabular-nums" style={{ color: RED }}>
                {fmt(r.whtBalance)}
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-1.5">
            <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Subtotal</span>
            <span className="font-mono text-[11px] font-black tabular-nums" style={{ color: RED }}>
              KES {fmt(group.subtotal)}
            </span>
          </div>
        </>
      )}
    </div>
  );
};

// ─── TaxGroup (2140) ─────────────────────────────────────────────────────────
const TaxGroup = ({ group }) => {
  const [open, setOpen] = useTabState(`lsl:tax:${group.month}`, true);
  const cols = "100px 1fr 130px 90px 110px";
  const hdrs = ["Reference", "Narration", "Property", "Date", "VAT (KES)"];

  return (
    <div className="mb-1.5 overflow-hidden rounded border border-slate-200 bg-white shadow-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 border-l-[3px] bg-slate-50 px-3 py-2.5 text-left transition-colors hover:bg-slate-100"
        style={{ borderLeftColor: RED }}
      >
        <span className="text-slate-300">{open ? <FaChevronDown size={9} /> : <FaChevronRight size={9} />}</span>
        <FaCalendarAlt size={10} className="shrink-0 text-slate-400" />
        <span className="flex-1 text-[11px] font-bold text-slate-700">{group.monthLabel}</span>
        <span className="mr-3 rounded-full bg-slate-200 px-2 py-0.5 text-[9px] font-bold text-slate-500">
          {group.rows.length}
        </span>
        <span className="w-32 text-right font-mono text-[12px] font-black tabular-nums" style={{ color: RED }}>
          {fmt(group.subtotal)}
        </span>
      </button>

      {open && (
        <>
          <div className="grid border-b border-slate-100 bg-[#0B3B2E]/[0.03] px-4 py-1.5" style={{ gridTemplateColumns: cols }}>
            {hdrs.map((h, i) => (
              <span key={h} className={`text-[8px] font-bold uppercase tracking-[0.14em] text-slate-400 ${i === 4 ? "text-right" : ""}`}>
                {h}
              </span>
            ))}
          </div>
          {group.rows.map((r, ri) => (
            <div
              key={r.sourceId || ri}
              className={`grid items-center border-b border-slate-50 px-4 py-2 last:border-0 hover:bg-slate-50/80 ${ri % 2 !== 0 ? "bg-slate-50/30" : ""}`}
              style={{ gridTemplateColumns: cols }}
            >
              <span className="font-mono text-[10px] font-semibold text-[#0B3B2E]">{r.reference || "—"}</span>
              <span className="truncate pr-2 text-[11px] text-slate-600">{r.narration || "—"}</span>
              <span className="truncate text-[10px] text-slate-500">{r.property || "—"}</span>
              <span className="text-[10px] text-slate-500">{fmtDate(r.date)}</span>
              <span className="text-right font-mono text-[11px] font-bold tabular-nums" style={{ color: RED }}>
                {fmt(r.vatBalance)}
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-1.5">
            <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Subtotal</span>
            <span className="font-mono text-[11px] font-black tabular-nums" style={{ color: RED }}>
              KES {fmt(group.subtotal)}
            </span>
          </div>
        </>
      )}
    </div>
  );
};

// ─── Main ─────────────────────────────────────────────────────────────────────
const LiabilitySubledger = () => {
  const currentUser    = useSelector(selectCurrentUser);
  const currentCompany = useSelector(selectCurrentCompany);
  const allProperties  = useSelector(selectAllProperties);
  const canExport      = hasCompanyPermission(currentUser || {}, currentCompany, "financialReports", "export", "accounts");

  const businessId = useMemo(() => {
    const activeId   = localStorage.getItem("milik_active_company_id");
    const storedUser = (() => { try { return JSON.parse(localStorage.getItem("milik_user") || "null"); } catch { return null; } })();
    return (
      currentCompany?._id || currentUser?.company?._id || currentUser?.company ||
      currentUser?.businessId || activeId || storedUser?.company?._id ||
      storedUser?.company || storedUser?.businessId || ""
    );
  }, [currentCompany?._id, currentUser?.company, currentUser?.businessId]);

  const businessName = currentCompany?.companyName || currentUser?.company?.companyName || "";

  const [tab,     setTab]     = useTabState("lsl:tab",     "deposits");
  const [filters, setFilters] = useTabState("lsl:filters", { asOf: today(), property: "" });
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef(null);

  const activeProperties = useMemo(
    () => allProperties.filter((p) => String(p.status || "").toLowerCase() !== "archived"),
    [allProperties]
  );

  const load = useCallback(async (currentTab, currentFilters) => {
    if (!businessId) return;
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setData(null);
    try {
      const params = { business: businessId, tab: currentTab };
      if (currentFilters.asOf)     params.asOf     = currentFilters.asOf;
      if (currentFilters.property) params.property = currentFilters.property;
      setData(await getLiabilitySubledger(params));
    } catch (err) {
      if (err?.name !== "CanceledError" && err?.code !== "ERR_CANCELED") {
        toast.error(err?.response?.data?.message || "Failed to load liability sub-ledger.");
      }
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { load(tab, filters); }, [tab, filters, load]);

  const tabDef = TABS.find((t) => t.key === tab) || TABS[0];
  const total  = data?.total   || 0;
  const groups = data?.groups  || [];
  const count  = groups.reduce((s, g) => s + (g.rows?.length ?? 1), 0);
  const isEmpty = !loading && groups.length === 0;

  return (
    <DashboardLayout pageKey="acc-liability-subledger">

      {/* ── Header banner ── */}
      <div
        className="mb-4 rounded px-5 py-4"
        style={{ background: GRN }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[13px] font-black uppercase tracking-[0.08em] text-white/80">
              Liability Sub-Ledger
            </h1>
            <p className="mt-0.5 text-[11px] text-white/50">
              {businessName} · Reconcile Balance Sheet liabilities to individual records
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end">
            <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-white/40">
              {tabDef.code} · {loading ? "loading…" : "total balance"}
            </span>
            <span className={`font-mono text-[22px] font-black tabular-nums ${loading ? "text-white/20" : "text-red-400"}`}>
              KES {fmt(total)}
            </span>
            <span className="text-[9px] text-white/40">
              {tabDef.desc} · {count} record{count !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="mb-3 flex gap-0 border-b border-slate-200">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`relative flex items-center gap-2 border-b-2 px-4 py-2 text-[11px] font-bold transition-all ${
                active
                  ? "border-[#0B3B2E] text-[#0B3B2E]"
                  : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
            >
              <span
                className={`rounded px-1 py-0.5 font-mono text-[8px] font-bold ${
                  active ? "bg-[#0B3B2E] text-white" : "bg-slate-100 text-slate-400"
                }`}
              >
                {t.code}
              </span>
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ── Filter bar ── */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2">
        <FaCalendarAlt size={10} className="shrink-0 text-slate-400" />
        <span className="text-[11px] text-slate-500">As at</span>
        <input
          type="date"
          value={filters.asOf}
          max={today()}
          onChange={(e) => setFilters((p) => ({ ...p, asOf: e.target.value }))}
          className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] focus:border-[#0B3B2E] focus:outline-none"
        />

        <div className="mx-1 h-4 w-px bg-slate-200" />

        <span className="text-[11px] text-slate-500">Property</span>
        <select
          value={filters.property}
          onChange={(e) => setFilters((p) => ({ ...p, property: e.target.value }))}
          className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] focus:border-[#0B3B2E] focus:outline-none"
        >
          <option value="">All properties</option>
          {activeProperties.map((p) => (
            <option key={p._id} value={p._id}>{p.propertyName}</option>
          ))}
        </select>

        <button
          onClick={() => load(tab, filters)}
          disabled={loading}
          className="flex h-7 items-center gap-1.5 rounded border border-slate-200 bg-white px-2.5 text-[11px] text-slate-600 transition hover:bg-slate-100 disabled:opacity-40"
        >
          <FaSyncAlt size={9} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>

        {/* Reconciliation note */}
        <div className="ml-auto flex items-center gap-1.5 rounded border border-amber-200 bg-amber-50 px-2.5 py-1">
          <FaExclamationTriangle size={8} className="shrink-0 text-amber-500" />
          <span className="text-[10px] text-amber-700">
            Total should match <span className="font-bold">{tabDef.code}</span> on your Balance Sheet
          </span>
        </div>

        {/* Export */}
        {canExport && !loading && groups.length > 0 && (
          <button
            onClick={() => exportCSV({ tab, groups, total, accountCode: data.accountCode, accountName: data.accountName, asOf: filters.asOf })}
            className="flex h-7 items-center gap-1.5 rounded px-2.5 text-[11px] text-white transition hover:opacity-90"
            style={{ background: GRN }}
          >
            <FaFileDownload size={9} /> Export CSV
          </button>
        )}
      </div>

      {/* ── Loading ── */}
      {loading && (
        <div className="flex flex-col items-center justify-center gap-2 py-20 text-slate-400">
          <FaSyncAlt className="animate-spin" size={18} />
          <span className="text-[12px]">Loading {tabDef.label}…</span>
        </div>
      )}

      {/* ── Empty ── */}
      {!loading && isEmpty && (
        <div className="flex flex-col items-center justify-center gap-3 rounded border border-dashed border-slate-200 py-20 text-center">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-full"
            style={{ background: `${GRN}12` }}
          >
            <FaLayerGroup size={20} style={{ color: GRN, opacity: 0.35 }} />
          </div>
          <div>
            <p className="text-[13px] font-bold text-slate-400">No balances on {tabDef.code}</p>
            <p className="mt-0.5 text-[11px] text-slate-300">
              {tabDef.label} · {tabDef.desc}{filters.asOf ? ` · as at ${filters.asOf}` : ""}
            </p>
          </div>
        </div>
      )}

      {/* ── Content ── */}
      {!loading && !isEmpty && (
        <div>
          {(tab === "deposits" || tab === "unallocated") &&
            groups.map((g) => <TenantGroup key={g.propertyId} group={g} tab={tab} />)}

          {tab === "landlord" && <LandlordTable groups={groups} />}

          {tab === "tax" &&
            groups.map((g) => <TaxGroup key={g.month} group={g} />)}

          {tab === "wht" &&
            groups.map((g) => <WHTGroup key={g.month} group={g} />)}

          {/* Grand total */}
          <div
            className="mt-4 flex items-center justify-between rounded border border-slate-200 px-4 py-3"
            style={{ background: `${GRN}08` }}
          >
            <span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
              Grand Total · {data?.accountCode} {data?.accountName}
            </span>
            <span className="font-mono text-[15px] font-black tabular-nums" style={{ color: RED }}>
              KES {fmt(total)}
            </span>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default LiabilitySubledger;
