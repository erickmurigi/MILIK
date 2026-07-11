import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FaCar, FaCarSide, FaClock, FaCommentDots, FaEdit,
  FaExclamationTriangle, FaIdCard, FaMobileAlt, FaMoneyBillWave,
  FaPhone, FaPrint, FaRedoAlt, FaSearch, FaTimes, FaUser, FaPiggyBank,
  FaDownload, FaFilter, FaStar, FaCheckSquare, FaSquare, FaCodeBranch,
  FaSortUp, FaSortDown, FaSort, FaChevronDown, FaChevronUp,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { useNavigate } from "react-router-dom";
import { FaBalanceScale } from "react-icons/fa";
import { carWashApi, formatMoney, normalizeListPayload, todayISO } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";
import CwSmsModal from "./CwSmsModal";
import useCarWashPermission from "../../hooks/useCarWashPermission";
import { useTabState } from "../../hooks/useTabState";

const GRN = "#0B3B2E";
const fmt = formatMoney;
const fmtDate = (v) =>
  v ? new Date(v).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const acctTypePill = {
  credit:  "bg-purple-100 text-purple-700 border-purple-200",
  monthly: "bg-blue-100 text-blue-700 border-blue-200",
};

const inputCls = "h-9 w-full border border-slate-300 bg-white px-2.5 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/20";
const labelCls = "mb-1 block text-[10px] font-extrabold uppercase tracking-widest text-slate-500";

// ── Last visit recency colour ──────────────────────────────────────────────────
const lastVisitClass = (lastVisit) => {
  if (!lastVisit) return "text-slate-300";
  const days = (Date.now() - new Date(lastVisit).getTime()) / 86_400_000;
  if (days < 14)  return "text-emerald-600 font-semibold";
  if (days < 60)  return "text-amber-600";
  return "text-red-500";
};
const lastVisitDot = (lastVisit) => {
  if (!lastVisit) return "bg-slate-200";
  const days = (Date.now() - new Date(lastVisit).getTime()) / 86_400_000;
  if (days < 14)  return "bg-emerald-400";
  if (days < 60)  return "bg-amber-400";
  return "bg-red-400";
};

// ─── Inline modal ──────────────────────────────────────────────────────────────
const Modal = ({ title, children, footer, onClose, wide = false }) => (
  <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/45 backdrop-blur-[2px] sm:items-center sm:p-4">
    <div className={`flex w-full flex-col bg-white shadow-2xl sm:border sm:border-slate-200 max-h-[92dvh] sm:max-h-[88vh] rounded-t-2xl sm:rounded-none ${wide ? "sm:max-w-2xl" : "sm:max-w-lg"}`}>
      <div className="flex-shrink-0 flex items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white rounded-t-2xl sm:rounded-none">
        <h2 className="text-sm font-extrabold uppercase tracking-wide">{title}</h2>
        <button type="button" onClick={onClose} className="p-1 text-white/80 hover:bg-white/10 hover:text-white rounded">
          <FaTimes />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">{children}</div>
      {footer && (
        <div className="flex-shrink-0 flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">{footer}</div>
      )}
    </div>
  </div>
);

// ─── Compact stamp dots ────────────────────────────────────────────────────────
const StampBar = React.memo(({ card, program }) => {
  if (!card) return <span className="text-slate-300 text-[10px]">—</span>;
  const required = program?.stampsRequired || card?.program?.stampsRequired || 10;
  const current = card.currentStamps || 0;
  const pending = card.pendingRewards || 0;
  if (required > 12) {
    const pct = Math.min(100, Math.round((current / required) * 100));
    return (
      <div className="flex items-center gap-1.5">
        <div className="relative h-1.5 w-14 flex-shrink-0 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full rounded-full bg-amber-400 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-[9px] font-bold tabular-nums text-slate-500">{current}/{required}</span>
        {pending > 0 && <span className="rounded-full bg-amber-100 px-1 py-0.5 text-[8px] font-bold text-amber-700 border border-amber-200">{pending}×</span>}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-0.5">
      {Array.from({ length: required }, (_, i) => (
        <div key={i} className={`flex h-3 w-3 items-center justify-center rounded-full border-[1.5px] transition-all ${i < current ? "border-amber-500 bg-amber-500" : "border-slate-200 bg-white"}`}>
          {i < current && <div className="h-1 w-1 rounded-full bg-white" />}
        </div>
      ))}
      <span className="ml-0.5 text-[9px] font-bold tabular-nums text-slate-500">{current}/{required}</span>
      {pending > 0 && <span className="ml-0.5 rounded-full bg-amber-100 px-1 py-0.5 text-[8px] font-bold text-amber-700 border border-amber-200">{pending}×</span>}
    </div>
  );
});

// ─── Print statement ───────────────────────────────────────────────────────────
const printStatement = (customer, jobs, totals) => {
  const fmtKES = (v) => `KES ${Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtD   = (v) => v ? new Date(v).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";
  const rows = jobs.map((j) => `
    <tr>
      <td>${fmtD(j.date)}</td><td>${j.jobNumber}</td><td><b>${j.plateNumber}</b></td>
      <td>${j.serviceName}</td><td class="num">${fmtKES(j.charge)}</td>
      <td class="num">${fmtKES(j.paid)}</td>
      <td class="num ${j.balance > 0 ? "red" : "grn"}">${fmtKES(j.balance)}</td>
    </tr>`).join("");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Statement · ${customer.name}</title>
  <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;color:#1a1a1a;padding:24px}
  h1{font-size:15px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#0B3B2E}.sub{font-size:10px;color:#666;margin-top:2px}
  .meta{display:flex;gap:32px;margin:16px 0 12px;border-top:2px solid #0B3B2E;padding-top:10px}
  .meta-item label{display:block;font-size:9px;font-weight:700;text-transform:uppercase;color:#999;letter-spacing:.5px}
  .meta-item span{font-size:11px;font-weight:600;color:#1a1a1a}table{width:100%;border-collapse:collapse;margin-top:8px}
  thead tr{background:#0B3B2E;color:#fff}th{padding:6px 8px;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px}
  th.num,td.num{text-align:right}td{padding:5px 8px;border-bottom:1px solid #f0f0f0;font-size:10px}
  tr:nth-child(even) td{background:#f8faf9}.red{color:#dc2626;font-weight:700}.grn{color:#16a34a;font-weight:600}
  tfoot td{border-top:2px solid #0B3B2E;font-weight:700;padding:6px 8px;font-size:11px;background:#f4f7f5}
  .footer{margin-top:24px;font-size:9px;color:#aaa;text-align:center}@media print{body{padding:12px}}</style>
  </head><body><h1>Customer Statement</h1>
  <div class="sub">${customer.name}${customer.phone ? " · " + customer.phone : ""}${(customer.plates||[]).length ? " · Plates: " + customer.plates.join(", ") : ""}</div>
  <div class="meta">
    <div class="meta-item"><label>Generated</label><span>${new Date().toLocaleDateString("en-KE",{day:"2-digit",month:"short",year:"numeric"})}</span></div>
    <div class="meta-item"><label>Total Invoiced</label><span>${fmtKES(totals.invoiced)}</span></div>
    <div class="meta-item"><label>Total Paid</label><span style="color:#16a34a">${fmtKES(totals.paid)}</span></div>
    <div class="meta-item"><label>Outstanding</label><span style="color:${totals.outstanding>0?"#dc2626":"#16a34a"}">${fmtKES(totals.outstanding)}</span></div>
  </div>
  <table><thead><tr><th>Date</th><th>Job #</th><th>Plate</th><th>Service</th><th class="num">Charge</th><th class="num">Paid</th><th class="num">Balance</th></tr></thead>
  <tbody>${rows||"<tr><td colspan='7' style='text-align:center;color:#999;padding:16px'>No jobs on record</td></tr>"}</tbody>
  <tfoot><tr><td colspan="4">TOTALS</td><td class="num">${fmtKES(totals.invoiced)}</td><td class="num">${fmtKES(totals.paid)}</td>
  <td class="num ${totals.outstanding>0?"red":"grn"}">${fmtKES(totals.outstanding)}</td></tr></tfoot></table>
  <div class="footer">Computer-generated statement · ${window.location.hostname}</div>
  <script>window.onload=()=>window.print()</script></body></html>`;
  const win = window.open("", "_blank", "width=800,height=700");
  if (win) { win.document.write(html); win.document.close(); }
};

const STMT_TH = "px-3 py-1.5 text-left text-[9px] font-bold uppercase tracking-widest text-white/80";
const STMT_TD = "px-3 py-1.5 text-[11px] text-slate-700";
const FMT_DATE_OPTS = { day: "2-digit", month: "short", year: "numeric" };

// ─── Expanded detail row ───────────────────────────────────────────────────────
const CustomerDetail = React.memo(({ customer, program, colSpan = 10 }) => {
  const { data: stmtData, isLoading: loading, isError } = useQuery({
    queryKey: ["cw-customer-stmt", String(customer._id)],
    queryFn: () => carWashApi.getCustomerStatement(customer._id),
    staleTime: 60_000,
  });
  const card   = customer.loyaltyCard;
  const acc    = customer.creditAccount;
  const totals = stmtData?.totals || { invoiced: 0, paid: 0, outstanding: 0 };
  const jobs = useMemo(() =>
    (stmtData?.jobs || []).map((j) => ({ ...j, dateFmt: j.date ? new Date(j.date).toLocaleDateString("en-KE", FMT_DATE_OPTS) : "—" })),
  [stmtData]);
  return (
    <tr>
      <td colSpan={colSpan} className="bg-[#F4F7F5]/60 border-b border-slate-200 px-4 py-3">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex flex-wrap items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1 text-slate-500"><FaPhone size={9} className="text-slate-300" />{customer.phone || "No phone"}</span>
            <span className="flex flex-wrap gap-1">
              {(customer.plates || []).map((p) => (
                <span key={p} className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-mono font-bold text-slate-700">{p}</span>
              ))}
            </span>
            {card && <StampBar card={card} program={program} />}
            {acc && (
              <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-semibold ${acctTypePill[acc.accountType] || "bg-slate-100 text-slate-600 border-slate-200"}`}>
                <FaIdCard size={8} />{acc.accountNumber} · {acc.accountType}
              </span>
            )}
          </div>
          <button onClick={() => printStatement(customer, jobs, totals)} disabled={loading || !jobs.length}
            className="flex items-center gap-1.5 border border-slate-300 bg-white px-2.5 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40">
            <FaPrint size={9} /> Print
          </button>
        </div>
        {loading ? (
          <div className="py-4 text-center text-[11px] text-slate-400">Loading statement…</div>
        ) : isError ? (
          <div className="py-4 text-center text-[11px] text-red-400">Failed to load statement</div>
        ) : !jobs.length ? (
          <div className="py-4 text-center text-[11px] text-slate-400">No job history on record</div>
        ) : (
          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="w-full min-w-[520px] border-collapse text-xs">
              <thead>
                <tr className="bg-[#0B3B2E]">
                  <th className={STMT_TH}>Date</th><th className={STMT_TH}>Job #</th><th className={STMT_TH}>Plate</th>
                  <th className={STMT_TH}>Service</th><th className={`${STMT_TH} text-right`}>Charge</th>
                  <th className={`${STMT_TH} text-right`}>Paid</th><th className={`${STMT_TH} text-right`}>Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {jobs.map((j, i) => (
                  <tr key={String(j._id)} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/60"}>
                    <td className={STMT_TD}>{j.dateFmt}</td>
                    <td className={`${STMT_TD} font-mono text-[10px] text-slate-500`}>{j.jobNumber}</td>
                    <td className={STMT_TD}><span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono font-bold text-slate-700 text-[10px]">{j.plateNumber}</span></td>
                    <td className={`${STMT_TD} max-w-[160px] truncate`}>{j.serviceName}</td>
                    <td className={`${STMT_TD} text-right tabular-nums`}>{fmt(j.charge)}</td>
                    <td className={`${STMT_TD} text-right tabular-nums text-emerald-700`}>{j.paid > 0 ? fmt(j.paid) : <span className="text-slate-300">—</span>}</td>
                    <td className={`${STMT_TD} text-right tabular-nums font-bold ${j.balance > 0.005 ? "text-red-600" : "text-slate-400"}`}>{fmt(j.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-100 border-t-2 border-slate-300">
                  <td colSpan={4} className="px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-widest text-slate-500">Totals</td>
                  <td className="px-3 py-1.5 text-right text-[11px] font-bold tabular-nums text-slate-700">{fmt(totals.invoiced)}</td>
                  <td className="px-3 py-1.5 text-right text-[11px] font-bold tabular-nums text-emerald-700">{fmt(totals.paid)}</td>
                  <td className={`px-3 py-1.5 text-right text-[11px] font-extrabold tabular-nums ${totals.outstanding > 0.005 ? "text-red-600" : "text-slate-400"}`}>{fmt(totals.outstanding)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </td>
    </tr>
  );
});

// ─── Row action icon button ────────────────────────────────────────────────────
const ACTN_COLORS = {
  slate: "border-slate-200 text-slate-500 hover:border-slate-400 hover:text-slate-700 hover:bg-slate-50",
  green: "border-slate-200 text-slate-500 hover:border-[#0B3B2E] hover:text-[#0B3B2E] hover:bg-[#F1F6F3]",
  amber: "border-slate-200 text-slate-500 hover:border-amber-400 hover:text-amber-700 hover:bg-amber-50",
  blue:  "border-slate-200 text-slate-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50",
  red:   "border-red-200 text-red-400 hover:border-red-400 hover:text-red-700 hover:bg-red-50",
};
const ActionBtn = React.memo(({ icon: Icon, title, onClick, color = "slate", disabled = false }) => (
  <button type="button" title={title} onClick={onClick} disabled={disabled}
    className={`h-6 w-6 flex-shrink-0 flex items-center justify-center rounded border text-[10px] transition-colors ${disabled ? "border-slate-200 bg-slate-100 text-slate-300 cursor-not-allowed" : ACTN_COLORS[color] || ACTN_COLORS.slate}`}>
    <Icon size={10} />
  </button>
));

// ─── Sort header button ────────────────────────────────────────────────────────
const SortTh = React.memo(({ label, field, sortBy, sortDir, onSort, className = "" }) => {
  const active = sortBy === field;
  return (
    <th className={`px-4 py-1.5 text-left font-bold uppercase tracking-wide cursor-pointer select-none group whitespace-nowrap ${className}`}
      onClick={() => onSort(field)}>
      <div className="flex items-center gap-1">
        {label}
        <span className={`transition-opacity ${active ? "opacity-100" : "opacity-0 group-hover:opacity-50"}`}>
          {active ? (sortDir === "asc" ? <FaSortUp size={9} /> : <FaSortDown size={9} />) : <FaSort size={9} />}
        </span>
      </div>
    </th>
  );
});

// ─── Merge duplicates modal ────────────────────────────────────────────────────
const MergeDuplicatesModal = ({ onClose, onDone }) => {
  const [groups, setGroups]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [merging, setMerging]   = useState(false);
  const [keepIds, setKeepIds]   = useState({});   // plate → keepId

  useEffect(() => {
    carWashApi.findDuplicateCustomers()
      .then((r) => {
        setGroups(r?.data || []);
        const defaults = {};
        for (const g of (r?.data || [])) {
          if (g.customers?.[0]) defaults[g.plate] = String(g.customers[0]._id);
        }
        setKeepIds(defaults);
      })
      .catch((e) => toast.error(e?.message || "Failed to load duplicates"))
      .finally(() => setLoading(false));
  }, []);

  const handleMerge = async (group) => {
    const keepId = keepIds[group.plate];
    if (!keepId) return;
    const mergeIds = group.customers.map((c) => String(c._id)).filter((id) => id !== keepId);
    if (!mergeIds.length) return;
    setMerging(true);
    try {
      const r = await carWashApi.mergeCustomers({ keepId, mergeIds });
      toast.success(r?.message || "Merged");
      setGroups((prev) => prev.filter((g) => g.plate !== group.plate));
      onDone?.();
    } catch (e) {
      toast.error(e?.message || "Merge failed");
    } finally {
      setMerging(false);
    }
  };

  return (
    <Modal title="Merge Duplicate Customers" onClose={onClose} wide>
      {loading ? (
        <p className="py-8 text-center text-sm text-slate-400">Scanning for duplicates…</p>
      ) : !groups.length ? (
        <div className="py-8 text-center">
          <FaCodeBranch className="mx-auto mb-2 text-emerald-400" size={28} />
          <p className="text-sm font-semibold text-slate-600">No duplicates found</p>
          <p className="text-xs text-slate-400 mt-1">All plates are linked to a unique customer</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">{groups.length} plate{groups.length !== 1 ? "s" : ""} appear in more than one customer record. Select which record to keep — the other(s) will be merged into it.</p>
          {groups.map((group) => (
            <div key={group.plate} className="rounded border border-amber-200 bg-amber-50 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="rounded border border-slate-200 bg-white px-2 py-0.5 font-mono text-xs font-bold text-slate-700">{group.plate}</span>
                <button
                  type="button"
                  onClick={() => handleMerge(group)}
                  disabled={merging}
                  className="border border-[#0B3B2E] bg-[#0B3B2E] px-3 py-1 text-[10px] font-bold text-white hover:bg-[#0A3127] disabled:opacity-50"
                >
                  {merging ? "Merging…" : "Merge"}
                </button>
              </div>
              <div className="space-y-1">
                {group.customers.map((c) => (
                  <label key={String(c._id)} className={`flex items-center gap-2 rounded border p-2 cursor-pointer text-xs transition-colors ${keepIds[group.plate] === String(c._id) ? "border-[#0B3B2E] bg-white" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                    <input type="radio" name={`keep-${group.plate}`} value={String(c._id)}
                      checked={keepIds[group.plate] === String(c._id)}
                      onChange={() => setKeepIds((prev) => ({ ...prev, [group.plate]: String(c._id) }))}
                      className="accent-[#0B3B2E]"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-800 truncate">{c.name || <span className="italic text-slate-400">Unnamed</span>}</p>
                      <p className="text-[10px] text-slate-400">{c.phone || "No phone"} · Plates: {(c.plates || []).join(", ")}</p>
                    </div>
                    {keepIds[group.plate] === String(c._id) && (
                      <span className="rounded bg-[#0B3B2E] px-1.5 py-0.5 text-[9px] font-bold text-white">KEEP</span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
};

// ─── Main component ────────────────────────────────────────────────────────────
export default function CarWashCustomers() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canManage = useCarWashPermission("carwash-loyalty", "manage");

  // ── Pagination / search ──
  const [page, setPage]           = useTabState("/carwash/customers:page", 1);
  const [limit, setLimit]         = useTabState("/carwash/customers:limit", 25);
  const [search, setSearch]       = useTabState("/carwash/customers:search", "");
  const [debouncedSearch, setDebouncedSearch] = useTabState("/carwash/customers:debouncedSearch", "");
  const searchRef  = useRef(null);
  const debounceRef = useRef(null);

  // ── Basic filters ──
  const [filterOutstanding, setFilterOutstanding] = useTabState("/carwash/customers:filterOutstanding", false);
  const [filterCredit, setFilterCredit]           = useTabState("/carwash/customers:filterCredit", false);

  // ── Advanced filters ──
  const [filtersOpen, setFiltersOpen]   = useState(false);
  const [dormantDays, setDormantDays]   = useTabState("/carwash/customers:dormantDays", 0);
  const [loyaltyFilter, setLoyaltyFilter] = useTabState("/carwash/customers:loyaltyFilter", "");
  const [minSpend, setMinSpend]         = useTabState("/carwash/customers:minSpend", "");
  const [maxSpend, setMaxSpend]         = useTabState("/carwash/customers:maxSpend", "");

  // ── Sort ──
  const [sortBy, setSortBy]   = useTabState("/carwash/customers:sortBy", "name");
  const [sortDir, setSortDir] = useTabState("/carwash/customers:sortDir", "asc");

  const handleSort = useCallback((field) => {
    setSortBy((prev) => {
      if (prev === field) {
        setSortDir((d) => d === "asc" ? "desc" : "asc");
        return field;
      }
      setSortDir(field === "name" ? "asc" : "desc");
      return field;
    });
    setPage(1);
  }, []);

  // ── Bulk selection ──
  const [selectedIds, setSelectedIds] = useState(new Set());
  const toggleSelect = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);
  const toggleSelectAll = useCallback((ids) => {
    setSelectedIds((prev) => {
      const allSelected = ids.every((id) => prev.has(id));
      if (allSelected) return new Set();
      return new Set(ids);
    });
  }, []);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // ── Misc UI state ──
  const [syncing, setSyncing]       = useState(false);
  const [exporting, setExporting]   = useState(false);
  const [expandedId, setExpandedId] = useTabState("/carwash/customers:expandedId", null);

  // ── Edit modal ──
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm]     = useState({ name: "", phone: "" });
  const [editSaving, setEditSaving] = useState(false);

  // ── SMS modal (single) ──
  const [smsTarget, setSmsTarget]   = useState(null);
  const [smsSending, setSmsSending] = useState(false);

  // ── Bulk SMS modal ──
  const [bulkSmsOpen, setBulkSmsOpen]   = useState(false);
  const [bulkSmsBody, setBulkSmsBody]   = useState("");
  const [bulkSmsSending, setBulkSmsSending] = useState(false);

  // ── Merge duplicates modal ──
  const [showMerge, setShowMerge] = useState(false);

  // ── Settle / payment modal ──
  const [payTarget, setPayTarget]           = useState(null);
  const [payJobs, setPayJobs]               = useState([]);
  const [payJobsLoading, setPayJobsLoading] = useState(false);
  const [payForm, setPayForm]               = useState({ job: "", amount: "", method: "cash", cashbookAccount: "", paymentDate: todayISO(), reference: "", phone: "" });
  const [paying, setPaying]                 = useState(false);
  const [stkPushing, setStkPushing]         = useState(false);

  // ── Derived filter state ──
  const hasAdvancedFilters = dormantDays > 0 || loyaltyFilter || minSpend || maxSpend;
  const activeFilterCount  = [filterOutstanding, filterCredit, dormantDays > 0, !!loyaltyFilter, !!minSpend, !!maxSpend].filter(Boolean).length;

  const customerQueryKey = [
    "cw-customers", page, limit, debouncedSearch,
    filterOutstanding, filterCredit, dormantDays, loyaltyFilter,
    minSpend, maxSpend, sortBy, sortDir,
  ];

  const { data: customersData, isLoading: loading, error } = useQuery({
    queryKey: customerQueryKey,
    queryFn: () => carWashApi.listCustomersEnriched({
      page, limit,
      search: debouncedSearch,
      ...(filterOutstanding && { hasOutstanding: "true" }),
      ...(filterCredit      && { hasCredit: "true" }),
      ...(dormantDays > 0   && { dormantDays }),
      ...(loyaltyFilter     && { loyaltyFilter }),
      ...(minSpend          && { minSpend }),
      ...(maxSpend          && { maxSpend }),
      sortBy,
      sortDir,
    }),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
  useEffect(() => { if (error) toast.error(error?.message || "Failed to load customers"); }, [error]);

  const customers       = useMemo(() => Array.isArray(customersData) ? customersData : (customersData?.data ?? []), [customersData]);
  const total           = Array.isArray(customersData) ? customersData.length : (customersData?.total ?? customers.length);
  const loyaltyProgram  = Array.isArray(customersData) ? null : (customersData?.loyaltyProgram ?? null);
  const globalStats     = !Array.isArray(customersData) ? (customersData?.globalStats ?? null) : null;

  const { data: cashbooksRaw } = useQuery({
    queryKey: ["cw-customer-cashbooks"],
    queryFn: () => carWashApi.listCashbooks(),
    staleTime: 5 * 60_000,
  });
  const cashbooks = cashbooksRaw ?? [];

  const displayed = customers;
  const displayedIds = useMemo(() => displayed.map((c) => String(c._id)), [displayed]);

  // Clear stale selections whenever the page/filter result set changes
  useEffect(() => { setSelectedIds(new Set()); }, [customersData]);

  const summaryStats = useMemo(() => {
    let withOutstanding = 0, withCredit = 0, withLoyalty = 0, pageOutstanding = 0, pageCredit = 0;
    for (const c of displayed) {
      if (c.outstanding > 0.01) { withOutstanding++; pageOutstanding += c.outstanding; }
      if (c.creditBalance > 0.01) { withCredit++; pageCredit += c.creditBalance; }
      if (c.loyaltyCard) withLoyalty++;
    }
    return {
      withOutstanding,
      totalOutstanding: globalStats?.totalOutstanding ?? pageOutstanding,
      withCredit,
      totalCredit:      globalStats?.totalCreditBalance ?? pageCredit,
      creditCount:      globalStats?.creditCount ?? withCredit,
      withLoyalty,
      isGlobal: globalStats != null,
    };
  }, [displayed, globalStats]);

  const pages = Math.max(Math.ceil(total / limit), 1);

  const handleSearch = (val) => {
    setSearch(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setPage(1); setDebouncedSearch(val); }, 350);
  };

  const resetFilters = () => {
    setFilterOutstanding(false);
    setFilterCredit(false);
    setDormantDays(0);
    setLoyaltyFilter("");
    setMinSpend("");
    setMaxSpend("");
    setPage(1);
  };

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const res = await carWashApi.exportCustomersCsv({
        search: debouncedSearch,
        ...(filterOutstanding && { hasOutstanding: "true" }),
        ...(filterCredit      && { hasCredit: "true" }),
        ...(dormantDays > 0   && { dormantDays }),
        ...(loyaltyFilter     && { loyaltyFilter }),
        ...(minSpend          && { minSpend }),
        ...(maxSpend          && { maxSpend }),
        sortBy, sortDir,
      });
      const url  = URL.createObjectURL(new Blob([res.data], { type: "text/csv" }));
      const link = document.createElement("a");
      link.href  = url;
      link.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e?.message || "Export failed");
    } finally {
      setExporting(false);
    }
  };

  // ── Edit save ──
  const saveEdit = async (e) => {
    e.preventDefault();
    if (!editTarget) return;
    setEditSaving(true);
    try {
      await carWashApi.updateLoyaltyCustomer(editTarget._id, { name: editForm.name.trim(), phone: editForm.phone.trim() });
      queryClient.invalidateQueries({ queryKey: ["cw-customers"] });
      toast.success("Customer updated");
      setEditTarget(null);
    } catch (err) { toast.error(err?.message || "Failed to update customer"); }
    finally { setEditSaving(false); }
  };

  // ── SMS send ──
  const sendSms = async (payload) => {
    if (!smsTarget) return;
    setSmsSending(true);
    try {
      await carWashApi.sendCustomerSms(smsTarget._id, payload);
      toast.success("SMS sent");
      setSmsTarget(null);
    } catch (err) { toast.error(err?.message || "Failed to send SMS"); }
    finally { setSmsSending(false); }
  };

  // ── Bulk SMS send ──
  const sendBulkSms = async () => {
    if (!bulkSmsBody.trim()) { toast.error("Enter a message"); return; }
    setBulkSmsSending(true);
    try {
      const r = await carWashApi.bulkSendCustomerSms({ customerIds: [...selectedIds], body: bulkSmsBody });
      toast.success(r?.message || "SMS sent");
      setBulkSmsOpen(false);
      setBulkSmsBody("");
      clearSelection();
    } catch (e) { toast.error(e?.message || "Failed to send bulk SMS"); }
    finally { setBulkSmsSending(false); }
  };

  const sendStkPush = async () => {
    const phone = payForm.phone?.trim();
    const amount = Number(payForm.amount || 0);
    if (!phone)           { toast.error("Enter customer phone number first"); return; }
    if (amount <= 0)      { toast.error("Enter payment amount first"); return; }
    if (!payForm.job)     { toast.error("Select a job first"); return; }
    setStkPushing(true);
    try {
      const job = payJobs.find((j) => j._id === payForm.job);
      await carWashApi.initiateStkPush({ phone, amount, jobId: payForm.job, accountRef: job?.plateNumber || job?.jobNumber || "CarWash" });
      toast.success(`M-Pesa prompt sent to ${phone} — ask customer to check their phone`);
    } catch (err) { toast.error(err?.response?.data?.message || "M-Pesa push failed"); }
    finally { setStkPushing(false); }
  };

  const openEdit   = useCallback((e, c) => { e.stopPropagation(); setEditTarget(c); setEditForm({ name: c.name || "", phone: c.phone || "" }); }, []);
  const openSms    = useCallback((e, c) => { e.stopPropagation(); setSmsTarget(c); }, []);
  const viewJobs   = useCallback((e, c) => { e.stopPropagation(); const plate = (c.plates || [])[0] || c.name || ""; navigate(plate ? `/carwash/jobs?search=${encodeURIComponent(plate)}` : "/carwash/jobs"); }, [navigate]);
  const toggleExpand = useCallback((id) => setExpandedId((prev) => prev === id ? null : id), []);

  const openSettle = useCallback(async (e, c) => {
    e.stopPropagation();
    setPayTarget(c);
    setPayJobs([]);
    setPayForm({ job: "", amount: "", method: "cash", cashbookAccount: cashbooks[0]?._id || "", paymentDate: todayISO(), reference: "", phone: c.phone || "" });
    if (!(c.plates || []).length) return;
    setPayJobsLoading(true);
    try {
      const searches = await Promise.all(
        (c.plates || []).map((plate) => carWashApi.listJobs({ search: plate, limit: 50 }).then((r) => normalizeListPayload(r, "jobs")).catch(() => []))
      );
      const seen = new Set();
      const all = searches.flat().filter((j) => { if (seen.has(j._id)) return false; seen.add(j._id); return true; });
      const unpaid = all.filter((j) => j.paymentStatus !== "paid");
      setPayJobs(unpaid);
      if (unpaid.length === 1) {
        const j = unpaid[0];
        const charged = Math.max(0, Number(j.price || 0) - Number(j.discountAmount || 0));
        let outstanding = charged;
        if (j.paymentStatus === "partial") {
          try {
            const pmtsRes = await carWashApi.listPayments({ job: j._id, limit: 50 });
            const pmtList = normalizeListPayload(pmtsRes, "payments");
            const paid = pmtList.reduce((s, p) => s + Number(p.amount || 0) + Number(p.discountAmount || 0), 0);
            outstanding = Math.max(0, charged - paid);
          } catch { /* leave as full price */ }
        }
        setPayForm((f) => ({ ...f, job: j._id, amount: String(outstanding) }));
      }
    } catch { toast.error("Could not load unpaid jobs"); }
    finally { setPayJobsLoading(false); }
  }, [cashbooks]);

  const submitPayment = async (e) => {
    e.preventDefault();
    if (!payForm.job)           { toast.error("Select a job"); return; }
    if (!payForm.cashbookAccount) { toast.error("Select a cashbook"); return; }
    setPaying(true);
    try {
      await carWashApi.recordPayment({ job: payForm.job, amount: Number(payForm.amount || 0), method: payForm.method, cashbookAccount: payForm.cashbookAccount, paymentDate: payForm.paymentDate, reference: payForm.reference, discountAmount: 0 });
      toast.success("Payment recorded successfully");
      setPayTarget(null);
      queryClient.invalidateQueries({ queryKey: ["cw-customers"] });
    } catch (err) { toast.error(err?.message || err?.response?.data?.message || "Failed to record payment"); }
    finally { setPaying(false); }
  };

  return (
    <CarWashShell>
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden bg-white">

        {/* ── Header ──────────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-2 py-1">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <div className="min-w-0">
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Car Wash</p>
              <h2 className="text-sm font-bold text-slate-800 truncate leading-tight">Customers</h2>
            </div>

            {/* Actions toolbar */}
            <div className="flex flex-wrap items-center gap-1">
              {/* Search */}
              <div className="relative">
                <FaSearch className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" size={9} />
                <input ref={searchRef} type="text" placeholder="Name / phone / plate..." value={search}
                  onChange={(e) => handleSearch(e.target.value)}
                  className="h-7 w-36 rounded border border-slate-300 bg-white pl-6 pr-6 text-xs focus:border-[#0B3B2E] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/20 sm:w-48 transition-all"
                />
                {search && (
                  <button type="button" onClick={() => handleSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><FaTimes size={9} /></button>
                )}
              </div>

              {/* Outstanding toggle */}
              <button type="button" onClick={() => { setFilterOutstanding((v) => !v); setPage(1); }}
                className={`flex items-center gap-1 h-7 rounded border px-2 text-xs font-semibold transition-colors ${filterOutstanding ? "border-red-200 bg-red-50 text-red-700" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}>
                <FaExclamationTriangle size={9} /><span className="hidden sm:inline">Outstanding only</span><span className="sm:hidden">Unpaid</span>
              </button>

              {/* Credit toggle */}
              <button type="button" onClick={() => { setFilterCredit((v) => !v); setPage(1); }}
                className={`flex items-center gap-1 h-7 rounded border px-2 text-xs font-semibold transition-colors ${filterCredit ? "border-emerald-600 bg-emerald-50 text-emerald-700" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}>
                <FaPiggyBank size={9} /><span className="hidden sm:inline">With credit</span>
              </button>

              {/* Advanced filters toggle */}
              <button type="button" onClick={() => setFiltersOpen((v) => !v)}
                className={`flex items-center gap-1 h-7 rounded border px-2 text-xs font-semibold transition-colors ${hasAdvancedFilters ? "border-violet-400 bg-violet-50 text-violet-700" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}>
                <FaFilter size={9} />
                <span className="hidden sm:inline">Filters</span>
                {activeFilterCount > 0 && <span className="rounded-full bg-violet-500 text-white text-[9px] font-bold px-1 leading-none py-0.5">{activeFilterCount}</span>}
                {filtersOpen ? <FaChevronUp size={8} /> : <FaChevronDown size={8} />}
              </button>

              {/* Export CSV */}
              <button type="button" onClick={handleExportCsv} disabled={exporting || loading}
                className="flex items-center gap-1 h-7 rounded border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors">
                <FaDownload size={9} className={exporting ? "animate-bounce" : ""} />
                <span className="hidden sm:inline">{exporting ? "Exporting…" : "Export"}</span>
              </button>

              {/* Opening Balances */}
              <button type="button" onClick={() => navigate("/carwash/customers/opening-balances")}
                className="flex items-center gap-1 h-7 rounded border border-amber-300 bg-amber-50 px-2 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition-colors">
                <FaBalanceScale size={9} /><span className="hidden sm:inline">Opening Balances</span>
              </button>

              {/* Merge Duplicates */}
              {canManage && (
                <button type="button" onClick={() => setShowMerge(true)}
                  className="flex items-center gap-1 h-7 rounded border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                  title="Find and merge duplicate customer records">
                  <FaCodeBranch size={9} /><span className="hidden lg:inline">Duplicates</span>
                </button>
              )}

              {/* Sync */}
              {canManage && (
                <button type="button" onClick={async () => {
                  setSyncing(true);
                  try {
                    const r = await carWashApi.backfillCustomersAndStamps();
                    toast.success(`Sync done — ${r?.customersCreated ?? 0} created, ${r?.stampsAwarded ?? 0} stamps`);
                    queryClient.invalidateQueries({ queryKey: ["cw-customers"] });
                  } catch (err) { toast.error(err?.message || "Sync failed"); }
                  finally { setSyncing(false); }
                }} disabled={syncing || loading}
                  className="flex items-center gap-1 h-7 rounded border border-emerald-300 bg-emerald-50 px-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 transition-colors">
                  <FaRedoAlt size={9} className={syncing ? "animate-spin" : ""} />
                  <span className="hidden sm:inline">{syncing ? "Syncing..." : "Sync Jobs"}</span>
                </button>
              )}

              {/* Refresh */}
              <button type="button" onClick={() => queryClient.invalidateQueries({ queryKey: ["cw-customers"] })} disabled={loading}
                className="flex items-center gap-1 h-7 rounded border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors">
                <FaRedoAlt size={9} className={loading ? "animate-spin" : ""} />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            </div>
          </div>

          {/* ── Advanced filter panel ──────────────────────────────────────── */}
          {filtersOpen && (
            <div className="mt-2 rounded border border-violet-200 bg-violet-50/50 p-3">
              <div className="flex flex-wrap gap-3">
                {/* Dormant */}
                <div className="min-w-[140px]">
                  <label className="mb-1 block text-[9px] font-bold uppercase tracking-widest text-violet-600">Not visited in</label>
                  <select value={dormantDays} onChange={(e) => { setDormantDays(Number(e.target.value)); setPage(1); }}
                    className="h-7 w-full rounded border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 focus:border-violet-400 focus:outline-none">
                    <option value={0}>Any time</option>
                    <option value={30}>30+ days</option>
                    <option value={60}>60+ days</option>
                    <option value={90}>90+ days</option>
                    <option value={180}>180+ days</option>
                    <option value={365}>1+ year</option>
                  </select>
                </div>

                {/* Loyalty */}
                <div className="min-w-[160px]">
                  <label className="mb-1 block text-[9px] font-bold uppercase tracking-widest text-violet-600">Loyalty</label>
                  <select value={loyaltyFilter} onChange={(e) => { setLoyaltyFilter(e.target.value); setPage(1); }}
                    className="h-7 w-full rounded border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 focus:border-violet-400 focus:outline-none">
                    <option value="">All customers</option>
                    <option value="member">Loyalty members</option>
                    <option value="near_reward">Near reward (≤2 stamps away)</option>
                    <option value="has_reward">Has pending reward</option>
                    <option value="no_stamps">No stamps yet</option>
                  </select>
                </div>

                {/* Spend range */}
                <div className="flex items-end gap-1">
                  <div>
                    <label className="mb-1 block text-[9px] font-bold uppercase tracking-widest text-violet-600">Min spend</label>
                    <input type="number" value={minSpend} onChange={(e) => { setMinSpend(e.target.value); setPage(1); }} placeholder="0"
                      className="h-7 w-24 rounded border border-slate-300 bg-white px-2 text-xs focus:border-violet-400 focus:outline-none" />
                  </div>
                  <span className="pb-1 text-slate-400 text-xs">–</span>
                  <div>
                    <label className="mb-1 block text-[9px] font-bold uppercase tracking-widest text-violet-600">Max spend</label>
                    <input type="number" value={maxSpend} onChange={(e) => { setMaxSpend(e.target.value); setPage(1); }} placeholder="∞"
                      className="h-7 w-24 rounded border border-slate-300 bg-white px-2 text-xs focus:border-violet-400 focus:outline-none" />
                  </div>
                </div>

                {/* Clear */}
                {hasAdvancedFilters && (
                  <div className="flex items-end">
                    <button type="button" onClick={resetFilters}
                      className="h-7 flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 text-[11px] font-semibold text-red-600 hover:bg-red-100">
                      <FaTimes size={8} /> Clear all
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Summary strip */}
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
            <span className="font-semibold text-slate-700">{total} customer{total !== 1 ? "s" : ""}</span>
            {summaryStats.totalOutstanding > 0.01 && (
              <span className="flex items-center gap-1 text-red-600">
                <FaExclamationTriangle size={8} />
                <strong>{fmt(summaryStats.totalOutstanding)}</strong> outstanding{summaryStats.isGlobal ? " (all)" : ""}
              </span>
            )}
            {summaryStats.totalCredit > 0.01 && (
              <button type="button" onClick={() => navigate("/carwash/customers/credit-balances")} className="flex items-center gap-1 text-emerald-700 hover:underline">
                <FaPiggyBank size={8} /><strong>{fmt(summaryStats.totalCredit)}</strong> credit{summaryStats.isGlobal ? " (all)" : ""}
              </button>
            )}
            {summaryStats.withLoyalty > 0 && (
              <span className="text-amber-600">{summaryStats.withLoyalty} loyalty member{summaryStats.withLoyalty !== 1 ? "s" : ""}</span>
            )}
          </div>
        </div>

        {/* ── Bulk action bar ──────────────────────────────────────────────── */}
        {selectedIds.size > 0 && (
          <div className="flex-shrink-0 flex items-center gap-2 border-b border-violet-200 bg-violet-50 px-3 py-1.5">
            <span className="text-xs font-bold text-violet-700">{selectedIds.size} selected</span>
            <button type="button" onClick={() => setBulkSmsOpen(true)}
              className="flex items-center gap-1 h-6 rounded border border-violet-400 bg-violet-100 px-2 text-[11px] font-semibold text-violet-700 hover:bg-violet-200">
              <FaCommentDots size={9} /> SMS Selected
            </button>
            <button type="button" onClick={clearSelection}
              className="flex items-center gap-1 h-6 rounded border border-slate-300 bg-white px-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
              <FaTimes size={9} /> Clear
            </button>
          </div>
        )}

        {/* ── Data area ──────────────────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 overflow-auto">

          {/* Mobile cards */}
          <div className="sm:hidden divide-y divide-slate-100">
            {loading && !customers.length ? (
              <p className="py-16 text-center text-sm text-slate-400">Loading…</p>
            ) : !displayed.length ? (
              <div className="py-16 text-center px-6">
                <FaUser className="mx-auto mb-2 text-slate-300" size={28} />
                <p className="text-sm font-semibold text-slate-500">{search ? "No customers match" : "No customers yet"}</p>
                <p className="text-xs text-slate-400 mt-1">Customers are created automatically when jobs are opened</p>
              </div>
            ) : displayed.map((c) => {
              const isExpanded = expandedId === String(c._id);
              const hasOutstanding = c.outstanding > 0.01;
              const hasCreditBal   = (c.creditBalance || 0) > 0.01;
              const hasPlates      = (c.plates || []).length > 0;
              const card = c.loyaltyCard;
              const acc  = c.creditAccount;
              const isSelected = selectedIds.has(String(c._id));
              return (
                <div key={String(c._id)} className={`p-3 space-y-2 ${hasOutstanding ? "border-l-[3px] border-red-400" : hasCreditBal ? "border-l-[3px] border-emerald-400" : ""} ${isSelected ? "bg-violet-50" : ""}`}>
                  <div className="flex items-start justify-between gap-2 cursor-pointer" onClick={() => toggleExpand(String(c._id))}>
                    <div className="flex items-start gap-2 min-w-0">
                      <button type="button" onClick={(e) => { e.stopPropagation(); toggleSelect(String(c._id)); }} className="mt-0.5 flex-shrink-0 text-violet-400 hover:text-violet-600">
                        {isSelected ? <FaCheckSquare size={14} /> : <FaSquare size={14} className="text-slate-300" />}
                      </button>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">{c.name || <span className="text-slate-400 italic">Unnamed</span>}</p>
                        <p className="text-[10px] text-slate-400">{c.phone || "—"}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {hasOutstanding && <span className="text-xs font-bold text-red-600">{fmt(c.outstanding)}</span>}
                      {hasCreditBal && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); navigate("/carwash/customers/credit-balances"); }}
                          className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-200">
                          <FaPiggyBank size={8} />{fmt(c.creditBalance)}
                        </button>
                      )}
                      <span className="text-slate-400 text-[10px]">{isExpanded ? "▾" : "▸"}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(c.plates || []).map((p) => <span key={p} className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-mono font-bold text-slate-700">{p}</span>)}
                    {!hasPlates && <span className="text-[9px] italic text-slate-400">No plates</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
                    <span className="flex items-center gap-1"><FaCarSide size={9} className="text-slate-400" />{c.totalJobs || 0} visits</span>
                    {c.lastVisit && <span className={`flex items-center gap-1 ${lastVisitClass(c.lastVisit)}`}><FaClock size={9} />{fmtDate(c.lastVisit)}</span>}
                    {card && <StampBar card={card} program={loyaltyProgram} />}
                    {acc && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); navigate("/carwash/customers/credit-accounts"); }}
                        className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-semibold ${acctTypePill[acc.accountType] || "bg-slate-100 text-slate-600 border-slate-200"} hover:opacity-80`}>
                        <FaIdCard size={8} />{acc.accountType}
                      </button>
                    )}
                  </div>
                  {isExpanded && (
                    <div className="rounded border border-slate-200 bg-slate-50 p-3 space-y-3 text-xs">
                      <div className="space-y-1">
                        {[
                          { label: "Total Invoiced", val: fmt(c.totalInvoiced), cls: "text-slate-700" },
                          { label: "Total Paid", val: fmt(c.totalPaid), cls: "text-emerald-700 font-semibold" },
                          { label: "Outstanding", val: fmt(c.outstanding), cls: c.outstanding > 0 ? "text-red-600 font-bold" : "text-slate-400" },
                          ...(hasCreditBal ? [{ label: "Credit Balance", val: fmt(c.creditBalance), cls: "text-emerald-700 font-semibold" }] : []),
                        ].map(({ label, val, cls }) => (
                          <div key={label} className="flex items-center justify-between">
                            <span className="text-[10px] text-slate-500">{label}</span>
                            <span className={`tabular-nums ${cls}`}>{val}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 pt-1">
                    <ActionBtn icon={FaCar} title="View Jobs" color="green" onClick={(e) => viewJobs(e, c)} disabled={!hasPlates} />
                    {canManage && <ActionBtn icon={FaEdit} title="Edit customer" color="amber" onClick={(e) => openEdit(e, c)} />}
                    {c.phone && <ActionBtn icon={FaCommentDots} title="Send SMS" color="blue" onClick={(e) => openSms(e, c)} />}
                    {hasOutstanding && canManage && hasPlates && <ActionBtn icon={FaMoneyBillWave} title="Settle outstanding" color="red" onClick={(e) => openSettle(e, c)} />}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block min-w-full">
            <table className="w-full text-xs">
              <colgroup>
                <col className="w-7" />
                <col className="w-8" />
                <col className="min-w-[160px]" />
                <col className="hidden md:table-column min-w-[120px]" />
                <col className="hidden md:table-column w-16" />
                <col className="hidden lg:table-column w-28" />
                <col className="hidden xl:table-column w-28" />
                <col className="w-24" />
                <col className="hidden xl:table-column min-w-[130px]" />
                <col className="hidden xl:table-column w-24" />
                <col className="w-28" />
              </colgroup>
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#0B3B2E] text-white text-[10px]">
                  {/* Select-all checkbox */}
                  <th className="px-2 py-1.5 w-7">
                    <button type="button" onClick={() => toggleSelectAll(displayedIds)} className="text-white/70 hover:text-white transition-colors">
                      {displayedIds.length > 0 && displayedIds.every((id) => selectedIds.has(id))
                        ? <FaCheckSquare size={11} />
                        : <FaSquare size={11} />}
                    </button>
                  </th>
                  <th className="px-2 py-1.5 w-8" />
                  <SortTh label="Customer"       field="name"        sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                  <th className="hidden md:table-cell px-4 py-1.5 text-left font-bold uppercase tracking-wide">Plates</th>
                  <SortTh label="Visits"         field="visits"      sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="hidden md:table-cell" />
                  <SortTh label="Last Visit"     field="lastVisit"   sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="hidden lg:table-cell" />
                  <SortTh label="Lifetime Spend" field="spend"       sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="hidden xl:table-cell" />
                  <SortTh label="Outstanding"    field="outstanding" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="text-red-300" />
                  <th className="hidden xl:table-cell px-4 py-1.5 text-left font-bold uppercase tracking-wide">Loyalty</th>
                  <th className="hidden xl:table-cell px-4 py-1.5 text-left font-bold uppercase tracking-wide">Account</th>
                  <th className="px-3 py-1.5 text-right font-bold uppercase tracking-wide text-white/70">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && !customers.length ? (
                  <tr><td colSpan={11} className="py-16 text-center text-sm text-slate-400">Loading customers…</td></tr>
                ) : !displayed.length ? (
                  <tr><td colSpan={11} className="py-16 text-center">
                    <FaUser className="mx-auto mb-2 text-slate-300" size={24} />
                    <p className="text-sm font-semibold text-slate-500">{search ? "No customers match your search" : "No customers yet"}</p>
                    <p className="text-xs text-slate-400 mt-1">Customers are auto-created when jobs are opened</p>
                  </td></tr>
                ) : displayed.map((c, idx) => {
                  const isExpanded     = expandedId === String(c._id);
                  const isSelected     = selectedIds.has(String(c._id));
                  const rowBg          = isSelected ? "bg-violet-50" : idx % 2 === 0 ? "bg-white" : "bg-slate-50/60";
                  const hasOutstanding = c.outstanding > 0.01;
                  const hasCreditBal   = (c.creditBalance || 0) > 0.01;
                  const hasPlates      = (c.plates || []).length > 0;
                  const card = c.loyaltyCard;
                  const acc  = c.creditAccount;
                  return (
                    <React.Fragment key={String(c._id)}>
                      <tr className={`${rowBg} transition-colors hover:bg-emerald-50/30 cursor-pointer group`} onClick={() => toggleExpand(String(c._id))}>
                        {/* Checkbox */}
                        <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                          <button type="button" onClick={() => toggleSelect(String(c._id))} className={`text-violet-400 hover:text-violet-600 transition-colors ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                            {isSelected ? <FaCheckSquare size={11} /> : <FaSquare size={11} className="text-slate-300" />}
                          </button>
                        </td>

                        {/* Expand */}
                        <td className={`px-2 py-2 ${hasOutstanding ? "border-l-[3px] border-red-400" : hasCreditBal ? "border-l-[3px] border-emerald-400" : "border-l-[3px] border-transparent"}`}>
                          <div className="flex items-center gap-1">
                            {c.lastVisit && <div className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${lastVisitDot(c.lastVisit)}`} title={`Last visit: ${fmtDate(c.lastVisit)}`} />}
                            <span className="text-slate-300 group-hover:text-slate-500 text-[10px] transition-colors">{isExpanded ? "▾" : "▸"}</span>
                          </div>
                        </td>

                        {/* Customer */}
                        <td className="px-4 py-2">
                          <div className="font-semibold text-slate-800 truncate max-w-[180px]">
                            {c.name || <span className="italic text-slate-400 font-normal">Unnamed</span>}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                            {c.phone ? <><FaPhone size={8} className="text-slate-300" /> {c.phone}</> : <span className="italic">No phone</span>}
                          </div>
                        </td>

                        {/* Plates */}
                        <td className="hidden md:table-cell px-4 py-2">
                          <div className="flex flex-wrap gap-1">
                            {(c.plates || []).slice(0, 2).map((p) => (
                              <span key={p} className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-mono font-bold text-slate-700">{p}</span>
                            ))}
                            {(c.plates || []).length > 2 && (
                              <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500" title={(c.plates || []).slice(2).join(", ")}>+{c.plates.length - 2}</span>
                            )}
                          </div>
                        </td>

                        {/* Visits */}
                        <td className="hidden md:table-cell px-4 py-2 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <FaCarSide size={9} className="text-slate-300" />
                            <span className="font-semibold tabular-nums text-slate-700">{c.totalJobs || 0}</span>
                          </div>
                        </td>

                        {/* Last visit — colour-coded */}
                        <td className="hidden lg:table-cell px-4 py-2 text-right">
                          <div className={`flex items-center justify-end gap-1 text-[11px] ${lastVisitClass(c.lastVisit)}`}>
                            <FaClock size={8} className="opacity-60 flex-shrink-0" />
                            <span className="tabular-nums">{fmtDate(c.lastVisit)}</span>
                          </div>
                        </td>

                        {/* Lifetime spend */}
                        <td className="hidden xl:table-cell px-4 py-2 text-right tabular-nums font-medium text-slate-700 text-[11px]">
                          {c.totalPaid > 0 ? fmt(c.totalPaid) : <span className="text-slate-300">—</span>}
                        </td>

                        {/* Outstanding / Credit */}
                        <td className="px-4 py-2 text-right tabular-nums text-[11px]">
                          <div className="flex flex-col items-end gap-0.5">
                            {hasOutstanding
                              ? <span className="font-bold text-red-600">{fmt(c.outstanding)}</span>
                              : <span className="text-slate-200">—</span>}
                            {hasCreditBal && (
                              <button type="button" onClick={(e) => { e.stopPropagation(); navigate("/carwash/customers/credit-balances"); }}
                                className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700 hover:bg-emerald-200">
                                <FaPiggyBank size={7} />{fmt(c.creditBalance)}
                              </button>
                            )}
                          </div>
                        </td>

                        {/* Loyalty */}
                        <td className="hidden xl:table-cell px-4 py-2">
                          <StampBar card={card} program={loyaltyProgram} />
                        </td>

                        {/* Account */}
                        <td className="hidden xl:table-cell px-4 py-2" onClick={(e) => e.stopPropagation()}>
                          {acc ? (
                            <button type="button" onClick={() => navigate("/carwash/customers/credit-accounts")}
                              className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-semibold ${acctTypePill[acc.accountType] || "bg-slate-100 text-slate-600 border-slate-200"} hover:opacity-80`}>
                              <FaIdCard size={8} />{acc.accountType}
                            </button>
                          ) : <span className="text-slate-200 text-[10px]">—</span>}
                        </td>

                        {/* Actions */}
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <ActionBtn icon={FaCar} title="View jobs" color="green" onClick={(e) => viewJobs(e, c)} disabled={!hasPlates} />
                            {canManage && <ActionBtn icon={FaEdit} title="Edit customer" color="amber" onClick={(e) => openEdit(e, c)} />}
                            {c.phone && <ActionBtn icon={FaCommentDots} title="Send SMS" color="blue" onClick={(e) => openSms(e, c)} />}
                            {hasOutstanding && canManage && hasPlates && (
                              <ActionBtn icon={FaMoneyBillWave} title={`Settle ${fmt(c.outstanding)}`} color="red" onClick={(e) => openSettle(e, c)} />
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && <CustomerDetail customer={c} program={loyaltyProgram} colSpan={11} />}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Pagination ─────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 flex min-h-8 items-center justify-between border-t border-slate-200 bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-slate-500 normal-case">Per page:</span>
            <select value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}
              className="h-7 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-bold text-slate-700 focus:border-emerald-400 focus:outline-none transition normal-case">
              {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setPage((p) => Math.max(p - 1, 1))} disabled={page <= 1}
              className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:cursor-not-allowed disabled:opacity-45">
              Previous
            </button>
            <span>Page {page} of {pages}</span>
            <button type="button" onClick={() => setPage((p) => Math.min(p + 1, pages))} disabled={page >= pages}
              className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:cursor-not-allowed disabled:opacity-45">
              Next
            </button>
          </div>
        </div>
      </div>

      {/* ── Bulk SMS modal ─────────────────────────────────────────────────── */}
      {bulkSmsOpen && (
        <Modal title={`SMS to ${selectedIds.size} customer${selectedIds.size !== 1 ? "s" : ""}`} onClose={() => setBulkSmsOpen(false)}
          footer={
            <>
              <button type="button" onClick={() => setBulkSmsOpen(false)} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={sendBulkSms} disabled={bulkSmsSending || !bulkSmsBody.trim()}
                className="bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127] disabled:opacity-50">
                {bulkSmsSending ? "Sending…" : `Send to ${selectedIds.size}`}
              </button>
            </>
          }>
          <div className="space-y-3">
            <div className="rounded border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-700">
              This will send an SMS to {selectedIds.size} selected customer{selectedIds.size !== 1 ? "s" : ""} who have a phone number. Customers without a phone are skipped automatically.
            </div>
            <div>
              <label className={labelCls}>Message</label>
              <textarea value={bulkSmsBody} onChange={(e) => setBulkSmsBody(e.target.value)} rows={4}
                placeholder="Type your message here…"
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/20 resize-none" />
              <p className="mt-1 text-right text-[10px] text-slate-400">{bulkSmsBody.length} chars</p>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Settle / payment modal ─────────────────────────────────────────── */}
      {payTarget && (() => {
        const selectedJob  = payJobs.find((j) => j._id === payForm.job);
        const outstanding  = selectedJob ? Math.max(0, Number(selectedJob.price || 0) - Number(selectedJob.discountAmount || 0)) : 0;
        const paying_amt   = Number(payForm.amount || 0);
        const remaining    = Math.max(0, outstanding - paying_amt);
        const overPay      = paying_amt > outstanding + 0.01 && outstanding > 0;
        return (
          <Modal title={`Record Payment — ${payTarget.name || "Customer"}`} onClose={() => setPayTarget(null)}
            footer={
              <>
                <button type="button" onClick={() => setPayTarget(null)} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
                <button type="submit" form="cw-settle-form" disabled={paying || payJobsLoading || !payForm.job || !payForm.cashbookAccount}
                  className="bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127] disabled:opacity-50">
                  {paying ? "Recording…" : "Record Payment"}
                </button>
              </>
            }>
            <div className="mb-4 flex items-start gap-3 rounded border border-slate-200 bg-slate-50 p-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-slate-800">{payTarget.name || "Unknown Customer"}</p>
                <p className="text-[10px] text-slate-400">{payTarget.phone || "No phone"}</p>
              </div>
              {payTarget.outstanding > 0 && (
                <div className="flex-shrink-0 text-right">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Total Outstanding</p>
                  <p className="text-sm font-black text-red-600">{fmt(payTarget.outstanding)}</p>
                </div>
              )}
            </div>
            {payJobsLoading ? (
              <p className="py-6 text-center text-xs text-slate-400">Loading unpaid jobs…</p>
            ) : payJobs.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-sm font-semibold text-slate-500">No unpaid jobs found</p>
                <p className="mt-1 text-xs text-slate-400">All jobs for this customer are marked as paid</p>
              </div>
            ) : (
              <form id="cw-settle-form" onSubmit={submitPayment} className="space-y-3">
                <div>
                  <label className={labelCls}>Select Job *</label>
                  <select className={inputCls} value={payForm.job}
                    onChange={(e) => {
                      const j = payJobs.find((x) => x._id === e.target.value);
                      const amt = j ? Math.max(0, Number(j.price || 0) - Number(j.discountAmount || 0)) : 0;
                      setPayForm((f) => ({ ...f, job: e.target.value, amount: String(amt) }));
                    }} required>
                    <option value="">— Select unpaid job —</option>
                    {payJobs.map((j) => (
                      <option key={j._id} value={j._id}>
                        {j.jobNumber} · {j.plateNumber || j.itemDescription || "—"} · {fmt(j.price)}
                        {j.paymentStatus === "partial" ? " (partial)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                {selectedJob && (
                  <div className="flex flex-wrap gap-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px]">
                    <div><span className="text-slate-500">Price: </span><strong className="text-slate-700">{fmt(selectedJob.price)}</strong></div>
                    {selectedJob.discountAmount > 0 && <div><span className="text-slate-500">Discount: </span><strong className="text-slate-700">{fmt(selectedJob.discountAmount)}</strong></div>}
                    <div><span className="text-slate-500">Outstanding: </span><strong className="text-red-600">{fmt(outstanding)}</strong></div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <label className={labelCls} style={{ marginBottom: 0 }}>Amount *</label>
                      {outstanding > 0 && (
                        <button type="button" onClick={() => setPayForm((f) => ({ ...f, amount: String(outstanding) }))}
                          className="text-[9px] font-black text-[#0B3B2E] underline hover:text-orange-500">Pay in full</button>
                      )}
                    </div>
                    <input className={inputCls} type="number" min="1" step="1" value={payForm.amount}
                      onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))} required />
                    {selectedJob && paying_amt > 0 && (
                      overPay
                        ? <p className="mt-0.5 text-[10px] font-bold text-red-600">Exceeds outstanding by {fmt(paying_amt - outstanding)}</p>
                        : remaining === 0
                          ? <p className="mt-0.5 text-[10px] font-bold text-emerald-700">Job will be fully settled ✓</p>
                          : <p className="mt-0.5 text-[10px] text-slate-500">Remaining: <strong>{fmt(remaining)}</strong></p>
                    )}
                  </div>
                  <div>
                    <label className={labelCls}>Method</label>
                    <select className={inputCls} value={payForm.method} onChange={(e) => setPayForm((f) => ({ ...f, method: e.target.value }))}>
                      {["cash", "mpesa", "bank", "card", "other"].map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Cashbook *</label>
                    <select className={inputCls} value={payForm.cashbookAccount} onChange={(e) => setPayForm((f) => ({ ...f, cashbookAccount: e.target.value }))} required>
                      <option value="">— Select —</option>
                      {cashbooks.map((cb) => <option key={cb._id} value={cb._id}>{cb.code ? `${cb.code} - ` : ""}{cb.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Payment Date *</label>
                    <input className={inputCls} type="date" value={payForm.paymentDate} onChange={(e) => setPayForm((f) => ({ ...f, paymentDate: e.target.value }))} required />
                  </div>
                </div>
                {payForm.method === "mpesa" ? (
                  <div className="space-y-3">
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <label className={labelCls} style={{ marginBottom: 0 }}>Customer Phone <span className="ml-1 font-normal normal-case text-emerald-700">(STK push)</span></label>
                        {payTarget?.phone && payForm.phone === payTarget.phone && (
                          <span className="text-[9px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">From customer</span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <input className={`${inputCls} flex-1`} type="tel" value={payForm.phone}
                          onChange={(e) => setPayForm((f) => ({ ...f, phone: e.target.value }))} placeholder="e.g. 0712345678" />
                        <button type="button" onClick={sendStkPush}
                          disabled={stkPushing || !payForm.phone?.trim() || !Number(payForm.amount) || !payForm.job}
                          className="inline-flex shrink-0 items-center gap-1.5 border border-emerald-300 bg-emerald-50 px-3 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50">
                          <FaMobileAlt size={11} />{stkPushing ? "Sending…" : "Push"}
                        </button>
                      </div>
                      <p className="mt-0.5 text-[10px] text-slate-400">
                        {payForm.phone?.trim()
                          ? `Sends a KES ${Number(payForm.amount || 0).toLocaleString()} M-Pesa prompt to ${payForm.phone.trim()} — customer pays on their phone.`
                          : "Enter phone to enable STK push — customer gets a payment prompt instantly."}
                      </p>
                    </div>
                    <div>
                      <label className={labelCls}>M-Pesa Transaction Code</label>
                      <input className={inputCls} value={payForm.reference} onChange={(e) => setPayForm((f) => ({ ...f, reference: e.target.value }))} placeholder="e.g. QJK1234ABC — enter after customer pays" />
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className={labelCls}>Reference</label>
                    <input className={inputCls} value={payForm.reference} onChange={(e) => setPayForm((f) => ({ ...f, reference: e.target.value }))}
                      placeholder={payForm.method === "cash" ? "Receipt note (optional)" : "Bank / card reference"} />
                  </div>
                )}
              </form>
            )}
          </Modal>
        );
      })()}

      {/* ── Edit customer modal ─────────────────────────────────────────────── */}
      {editTarget && (
        <Modal title="Edit Customer" onClose={() => setEditTarget(null)}
          footer={
            <>
              <button type="button" onClick={() => setEditTarget(null)} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="submit" form="cw-edit-customer-form" disabled={editSaving}
                className="bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127] disabled:opacity-50">
                {editSaving ? "Saving…" : "Save Changes"}
              </button>
            </>
          }>
          <form id="cw-edit-customer-form" onSubmit={saveEdit} className="space-y-4">
            {(editTarget.plates || []).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {editTarget.plates.map((p) => (
                  <span key={p} className="rounded border border-slate-200 bg-[#F4F7F5] px-2.5 py-1 text-[10px] font-mono font-bold text-slate-700">{p}</span>
                ))}
              </div>
            )}
            <div>
              <label className={labelCls}>Full Name</label>
              <input className={inputCls} value={editForm.name} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. John Kamau" autoFocus />
            </div>
            <div>
              <label className={labelCls}>Phone Number</label>
              <input className={inputCls} value={editForm.phone} onChange={(e) => setEditForm((p) => ({ ...p, phone: e.target.value }))} placeholder="e.g. 0712345678" type="tel" />
              <p className="mt-1 text-[10px] text-slate-400">Used for SMS notifications and customer lookup</p>
            </div>
          </form>
        </Modal>
      )}

      {/* ── SMS modal (single) ──────────────────────────────────────────────── */}
      {smsTarget && (
        <CwSmsModal
          target={{ _id: smsTarget._id, name: smsTarget.name, phone: smsTarget.phone || "" }}
          context="customer" onSend={sendSms} onClose={() => setSmsTarget(null)} sending={smsSending}
        />
      )}

      {/* ── Merge duplicates modal ──────────────────────────────────────────── */}
      {showMerge && (
        <MergeDuplicatesModal
          onClose={() => setShowMerge(false)}
          onDone={() => queryClient.invalidateQueries({ queryKey: ["cw-customers"] })}
        />
      )}
    </CarWashShell>
  );
}
