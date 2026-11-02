import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useTabState } from "../../hooks/useTabState";
import { toast } from "react-toastify";
import { hasCompanyPermission } from "../../utils/permissions";
import { selectCurrentCompany, selectCurrentUser, selectAllProperties } from "../../redux/selectors";
import { getLiabilitySubledger, getLiabilitySubledgerAccounts } from "../../redux/apiCalls";
import AppSelect from "../../components/common/AppSelect";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { fmtDate } from "../../utils/dates";
import {
  FaBuilding, FaChevronDown, FaChevronRight, FaFileDownload, FaSyncAlt,
  FaLayerGroup, FaUser, FaCalendarAlt, FaExclamationTriangle,
} from "react-icons/fa";
import { hasCompanyModule } from "../../utils/companyModules";

const GRN = "#0B3B2E";
const RED = "#DC2626";

// `requiresModule` gates a sub-ledger to companies that actually have that module —
// deposits/landlord/unallocated are tenant- and landlord-specific concepts that make
// no sense for a Car Wash- or Property Sale-only company. Tax/WHT payable are left
// ungated: they're a shared, module-agnostic accounts concept (any company posting a
// Payment Voucher with withholding tax posts to 2141, regardless of which business
// modules it has — see paymentVoucher.js).
const TABS = [
  { key: "deposits",     label: "Tenant Deposits",     code: "2100", desc: "Deposits held on behalf of tenants",        requiresModule: "propertyManagement" },
  { key: "landlord",    label: "Landlord Payables",    code: "2110", desc: "Amounts owed to landlords",                 requiresModule: "propertyManagement" },
  { key: "unallocated", label: "Unallocated Receipts", code: "2130", desc: "Tenant overpayments / prepayments",         requiresModule: "propertyManagement" },
  { key: "tax",         label: "Tax Payable",          code: "2140", desc: "Output VAT / tax collected not yet remitted" },
  { key: "wht",         label: "WHT Payable",          code: "2141", desc: "Withholding tax not yet remitted" },
];

const today = () => new Date().toISOString().split("T")[0];

const fmt = (v) =>
  Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });


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
  } else if (tab === "wht") {
    lines.push(["Month", "Voucher #", "Vendor", "Property", "Narration", "Gross (KES)", "WHT Held (KES)"].join(","));
    groups.forEach((g) => {
      g.rows.forEach((r) => lines.push([q(g.monthLabel), q(r.voucherNo), q(r.vendor), q(r.property), q(r.narration), fmt(r.grossAmount), fmt(r.whtBalance)].join(",")));
      lines.push([`"${g.monthLabel} Subtotal"`, "", "", "", "", "", fmt(g.subtotal)].join(","));
    });
  } else {
    lines.push(["Month", "Source", "Narration", "Property", "Date", "Amount (KES)"].join(","));
    groups.forEach((g) => {
      g.rows.forEach((r) => lines.push([q(g.monthLabel), q(r.reference), q(r.narration), q(r.property), q(fmtDate(r.date)), fmt(r.amount)].join(",")));
      lines.push([`"${g.monthLabel} Subtotal"`, "", "", "", "", fmt(g.subtotal)].join(","));
    });
  }
  lines.push("", `"GRAND TOTAL","${fmt(total)}"`);

  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `liability-${accountCode}-${asOf || today()}.csv` });
  a.click();
  URL.revokeObjectURL(url);
};

// ─── TenantGroup (2100 / 2130) ───────────────────────────────────────────────
const TenantGroup = React.memo(({ group, tab }) => {
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
});

// ─── LandlordTable (2110) ─────────────────────────────────────────────────────
const LandlordTable = React.memo(({ groups }) => (
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
));

// ─── WHTGroup (2141) ──────────────────────────────────────────────────────────
const WHTGroup = React.memo(({ group }) => {
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
});

// ─── TaxGroup (2140) ─────────────────────────────────────────────────────────
const TaxGroup = React.memo(({ group }) => {
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
});

// ─── GenericGroup — any liability account beyond the five named tabs (Property Sale, Car Wash, HR,
// Inventory, …). Same shape as TaxGroup but with a neutral amount column, since the source document
// varies by module and isn't resolved to a specific reference/vendor here. ──────────────────────────
const GenericGroup = React.memo(({ group }) => {
  const [open, setOpen] = useTabState(`lsl:gen:${group.month}`, true);
  const cols = "140px 1fr 130px 90px 110px";
  const hdrs = ["Source", "Narration", "Property", "Date", "Amount (KES)"];

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
              <span className="truncate text-[10px] font-semibold capitalize text-[#0B3B2E]">{r.reference || "—"}</span>
              <span className="truncate pr-2 text-[11px] text-slate-600">{r.narration || "—"}</span>
              <span className="truncate text-[10px] text-slate-500">{r.property || "—"}</span>
              <span className="text-[10px] text-slate-500">{fmtDate(r.date)}</span>
              <span className="text-right font-mono text-[11px] font-bold tabular-nums" style={{ color: RED }}>
                {fmt(r.amount)}
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
});

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
  // Property scoping only makes sense for a company that actually runs Property Management — a
  // Car Wash- or Property Sale-only company has no properties, so the filter would just be empty clutter.
  const hasPM = hasCompanyModule(currentCompany, "propertyManagement");

  // Every other posting liability account this company has (Property Sale's Agent Commissions
  // Payable, Car Wash's Staff Commissions/Savings Payable, HR's PAYE/NHIF/NSSF/AHL/Net Salaries
  // Payable, Inventory's VAT Payable, …) — fetched once per company so no module's liabilities are
  // ever left off this page, without hardcoding any of their account codes here.
  const [extraAccounts, setExtraAccounts] = useState([]);
  const [extraAccountsLoaded, setExtraAccountsLoaded] = useState(false);
  useEffect(() => {
    if (!businessId) return;
    let live = true;
    setExtraAccountsLoaded(false);
    getLiabilitySubledgerAccounts({ business: businessId })
      .then((accounts) => { if (live) { setExtraAccounts(accounts); setExtraAccountsLoaded(true); } })
      .catch(() => { if (live) setExtraAccountsLoaded(true); });
    return () => { live = false; };
  }, [businessId]);

  const visibleTabs = useMemo(() => {
    const named = TABS.filter((t) => !t.requiresModule || hasCompanyModule(currentCompany, t.requiresModule));
    const generic = extraAccounts.map((a) => ({ key: a.code, label: a.name, code: a.code, desc: `Account ${a.code} · ${a.name}`, generic: true }));
    return [...named, ...generic];
  }, [currentCompany, extraAccounts]);

  const [tab,     setTab]     = useTabState("lsl:tab",     "deposits");
  const [filters, setFilters] = useTabState("lsl:filters", { asOf: today(), property: "" });
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef(null);

  // The persisted tab (from a previous visit, possibly on a different company) may no longer be
  // visible — e.g. "deposits" was open, then the user switched to a company without Property
  // Management, or the persisted tab was a generic account code from another company entirely. Falls
  // back to the first tab this company can actually see — but only once extraAccounts has actually
  // loaded, otherwise a persisted generic-account tab would get bumped before it ever had a chance
  // to be recognised as valid.
  useEffect(() => {
    if (!extraAccountsLoaded || visibleTabs.length === 0) return;
    if (!visibleTabs.some((t) => t.key === tab)) {
      setTab(visibleTabs[0].key);
    }
  }, [visibleTabs, extraAccountsLoaded, tab, setTab]);

  const activeProperties = useMemo(
    () => allProperties.filter((p) => String(p.status || "").toLowerCase() !== "archived"),
    [allProperties]
  );

  // Stable option array — avoids busting AppSelect's internal useMemo on every render
  const activePropertyOptions = useMemo(
    () => activeProperties.map((p) => ({ value: p._id, label: p.propertyName })),
    [activeProperties]
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

  const tabDef = visibleTabs.find((t) => t.key === tab) || visibleTabs[0] || TABS[0];
  const total  = data?.total   || 0;
  const groups = data?.groups  || [];
  const count  = groups.reduce((s, g) => s + (g.rows?.length ?? 1), 0);
  const isEmpty = !loading && groups.length === 0;

  return (
    <DashboardLayout lockContentScroll pageKey="acc-liability-subledger">
    <div className="flex h-full flex-col overflow-hidden">
    <div className="shrink-0">

      {/* ── Sticky toolbar ── */}
      <div className="border-b border-slate-200 bg-white px-4 py-2 shadow-sm">
        <div className="filter-bar flex items-center gap-1.5 overflow-x-auto">
          <span className="shrink-0 text-[10px] font-black uppercase tracking-[0.15em]" style={{ color: GRN }}>
            Liability Sub-Ledger
          </span>
          <div className="mx-1 h-4 w-px shrink-0 bg-slate-200" />
          <span className="shrink-0 text-[11px] text-slate-500">As at</span>
          <input
            type="date"
            value={filters.asOf}
            max={today()}
            onChange={(e) => setFilters((p) => ({ ...p, asOf: e.target.value }))}
            className="h-7 shrink-0 border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          />
          {hasPM && (
            <AppSelect
              value={filters.property}
              onChange={(v) => setFilters((p) => ({ ...p, property: v ?? '' }))}
              options={activePropertyOptions}
              placeholder="All properties"
              searchable
              clearable
              size="sm"
              className="shrink-0 w-36"
            />
          )}
          <span className="shrink-0 border border-slate-200 bg-slate-50 px-2 py-0.5 text-[9px] font-semibold text-slate-500">
            {businessName}
          </span>
          <span className="shrink-0 border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] text-amber-700">
            <FaExclamationTriangle size={7} className="mr-1 inline text-amber-500" />
            Total should match <span className="font-bold">{tabDef.code}</span> on your Balance Sheet
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => load(tab, filters)} disabled={loading}
              className="flex h-7 items-center gap-1.5 bg-blue-600 px-3 text-[11px] font-bold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <FaSyncAlt size={9} className={loading ? "animate-spin" : ""} />
              {loading ? "Loading…" : "Refresh"}
            </button>
            {canExport && !loading && groups.length > 0 && (
              <button
                onClick={() => exportCSV({ tab, groups, total, accountCode: data.accountCode, accountName: data.accountName, asOf: filters.asOf })}
                className="flex h-7 items-center gap-1.5 border border-[#FF8C00] bg-white px-3 text-[11px] font-bold text-[#FF8C00] hover:bg-orange-50"
              >
                <FaFileDownload size={9} /> CSV
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-0 overflow-x-auto border-b border-slate-200 bg-white">
        {visibleTabs.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              title={t.desc}
              className={`relative flex shrink-0 items-center gap-2 border-b-2 px-4 py-2 text-[11px] font-bold transition-all ${
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

      {/* ── Total strip ── */}
      <div className={`flex items-center gap-2 border-b border-slate-200 px-4 py-1.5 ${loading ? "bg-slate-50" : "bg-red-50"}`}>
        <span className="text-[9px] font-black uppercase tracking-[0.12em] text-red-600/70">{tabDef.code} · {tabDef.label}</span>
        <span className={`ml-auto font-mono text-sm font-black tabular-nums ${loading ? "text-slate-300" : "text-red-700"}`}>
          KES {fmt(total)}
        </span>
        <span className="text-[9px] font-medium text-red-600/50">{count} record{count !== 1 ? "s" : ""}</span>
      </div>

    </div>
    <div className="flex-1 overflow-y-auto p-3">

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

          {!["deposits", "unallocated", "landlord", "tax", "wht"].includes(tab) &&
            groups.map((g) => <GenericGroup key={g.month} group={g} />)}

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
    </div>
    </div>
    </DashboardLayout>
  );
};

export default LiabilitySubledger;
