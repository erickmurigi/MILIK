import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import {
  FaExclamationTriangle,
  FaSearch, FaRedoAlt, FaTimes, FaLink, FaBan, FaUndo, FaUpload,
  FaFileAlt, FaReceipt, FaUser, FaTrash, FaSpinner,
  FaChevronDown, FaChevronUp, FaChevronLeft, FaChevronRight, FaPaste,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { adminRequests } from "../../utils/requestMethods";
import { selectCurrentCompany } from "../../redux/selectors";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { useTabState } from "../../hooks/useTabState";
import AppSelect from "../../components/common/AppSelect";

const PAGE_SIZE   = 50;
const AUTO_RELOAD = 30; // seconds

const todayISO          = () => new Date().toISOString().slice(0, 10);
const threeMonthsAgoISO = () => { const d = new Date(); d.setMonth(d.getMonth() - 3); return d.toISOString().slice(0, 10); };
const formatMoney = (v) => `Ksh ${Number(v || 0).toLocaleString()}`;
const fmtDate     = (v) =>
  v ? new Date(v).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

const getTenantLabel = (t) => t?.name || "—";
const getUnitLabel   = (t) => [t?.unit?.unitNumber, t?.unit?.property?.propertyName].filter(Boolean).join(" · ") || "";

const STATUS_META = {
  unmatched:  { label: "Unmatched", pill: "bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-300",      chip: { dot: "bg-amber-400",   text: "text-amber-700",   bg: "bg-amber-50",   border: "border-amber-300",   accent: "border-l-amber-400"   }, sub: "pending action"    },
  captured:   { label: "Captured",  pill: "bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-300", chip: { dot: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-300", accent: "border-l-emerald-500" }, sub: ""                  },
  duplicate:  { label: "Duplicate", pill: "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-300",      chip: { dot: "bg-slate-400",   text: "text-slate-600",   bg: "bg-white",      border: "border-slate-300",   accent: "border-l-slate-400"   }, sub: "already processed" },
  ignored:    { label: "Ignored",   pill: "bg-red-100 text-red-800 ring-1 ring-inset ring-red-300",            chip: { dot: "bg-red-400",     text: "text-red-700",     bg: "bg-red-50",     border: "border-red-300",     accent: "border-l-red-400"     }, sub: "excluded"          },
  // legacy — old DB records; treated as unmatched
  matched_tenant: { label: "Unmatched", pill: "bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-300", chip: { dot: "bg-amber-400", text: "text-amber-700", bg: "bg-amber-50", border: "border-amber-300", accent: "border-l-amber-400" }, sub: "pending action" },
};

const StatusBadge = ({ status }) => {
  const m = STATUS_META[status] || STATUS_META.unmatched;
  return (
    <div className="flex flex-col gap-px">
      <span className={`inline-flex items-center rounded px-1.5 py-px text-[9px] font-black uppercase tracking-wide ${m.pill}`}>
        {m.label}
      </span>
      {m.sub && <span className="text-[8px] italic text-slate-400 leading-tight">{m.sub}</span>}
    </div>
  );
};

// ─── Countdown refresh button — isolated so per-second ticks don't re-render the page ──
const CountdownButton = React.memo(function CountdownButton({ onRefresh, loading }) {
  const [countdown, setCountdown] = useState(AUTO_RELOAD);
  useEffect(() => {
    setCountdown(AUTO_RELOAD);
    const tick = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { onRefresh(true); return AUTO_RELOAD; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [onRefresh]);
  return (
    <button type="button" onClick={() => onRefresh()}
      className="inline-flex h-[20px] items-center gap-0.5 border border-slate-300 bg-white px-1.5 text-[9px] font-bold text-slate-700 hover:bg-slate-50"
      title={`Auto-refreshes in ${countdown}s`}>
      {loading ? <FaSpinner size={7} className="animate-spin" /> : <FaRedoAlt size={7} />}
      <span>{loading ? "Loading" : `${countdown}s`}</span>
    </button>
  );
});

// ─── Assign Tenant Modal ──────────────────────────────────────────────────────
function AssignTenantModal({ notif, businessId, onClose, onAssigned }) {
  const [search,    setSearch]    = useState(notif?.accountReference || "");
  const [tenants,   setTenants]   = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected,  setSelected]  = useState(null);
  const [saving,    setSaving]    = useState(false);
  const inputRef    = useRef(null);
  const debounceRef = useRef(null);

  const doSearch = useCallback(async (q) => {
    const term = (q ?? search).trim();
    if (!term) return;
    setSearching(true); setSelected(null);
    try {
      const res  = await adminRequests.get("/tenants", { params: { business: businessId, search: term, limit: 20 } });
      const list = Array.isArray(res?.data?.data) ? res.data.data : [];
      setTenants(list);
    } catch { toast.error("Tenant search failed"); }
    finally   { setSearching(false); }
  }, [businessId, search]);

  useEffect(() => {
    inputRef.current?.focus();
    if (notif?.accountReference) doSearch(notif.accountReference);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearch(val);
    clearTimeout(debounceRef.current);
    if (val.trim().length >= 2) {
      debounceRef.current = setTimeout(() => doSearch(val), 350);
    }
  };

  // One-click assign — clicking a tenant immediately calls the API
  const handleAssignTenant = async (t) => {
    if (saving) return;
    setSelected(t);
    setSaving(true);
    try {
      const res     = await adminRequests.post(`/mpesa-collections/${notif._id}/assign-tenant`, { tenantId: t._id, business: businessId });
      const updated = res?.data?.data || res?.data;
      const autoCaptured = updated?.matchingStatus === "captured" && updated?.matchedReceipt;
      toast.success(autoCaptured ? `Receipt recorded for ${t.name}` : `Assigned to ${t.name}`);
      onAssigned(updated, t, autoCaptured);
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Assignment failed");
      setSelected(null);
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between bg-[#0B3B2E] px-4 py-3">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-white">Assign to Tenant</p>
            <p className="text-[11px] text-emerald-200">
              {formatMoney(notif.amount)} · ref: <span className="font-mono">{notif.accountReference || notif.billRefNumber || "—"}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white"><FaTimes size={14} /></button>
        </div>

        <div className="border-b border-amber-100 bg-amber-50 px-4 py-2.5 text-[11px] text-amber-800">
          <FaExclamationTriangle className="mr-1.5 inline text-amber-500" size={11} />
          Customer typed <strong className="font-mono">&ldquo;{notif.accountReference || notif.billRefNumber}&rdquo;</strong> as ref — search to find the correct tenant.
        </div>

        <div className="px-4 pb-2 pt-3">
          <div className="flex gap-2">
            <input ref={inputRef}
              className="h-9 flex-1 border border-slate-300 px-3 text-xs font-semibold placeholder:font-normal focus:border-[#0B3B2E] focus:outline-none"
              placeholder="Name, tenant code, phone, or ID"
              value={search} onChange={handleSearchChange}
              onKeyDown={e => e.key === "Enter" && doSearch()} />
            <button type="button" onClick={() => doSearch()} disabled={searching}
              className="inline-flex h-9 items-center gap-1.5 bg-[#FF8C00] px-4 text-xs font-bold text-white hover:bg-[#E67E00] disabled:opacity-50">
              {searching ? <FaSpinner size={10} className="animate-spin" /> : <FaSearch size={10} />}
              Search
            </button>
          </div>
        </div>

        <div className="max-h-64 overflow-y-auto border-t border-slate-100">
          {searching && <p className="px-4 py-6 text-center text-xs text-slate-400">Searching…</p>}
          {!searching && tenants.length === 0 && search.trim() && (
            <p className="px-4 py-6 text-center text-xs text-slate-400">No tenants found. Try name, TT code, phone, or ID number.</p>
          )}
          {!searching && tenants.length === 0 && !search.trim() && (
            <p className="px-4 py-6 text-center text-xs text-slate-400">Type a name, code, or phone to search.</p>
          )}
          {!searching && tenants.map(t => {
            const isAssigning = saving && selected?._id === t._id;
            const inactive    = t.status && t.status !== "active";
            return (
              <button key={t._id} type="button" onClick={() => handleAssignTenant(t)}
                disabled={saving}
                className={`flex w-full items-center gap-3 border-b border-slate-100 px-4 py-2.5 text-left transition-colors disabled:cursor-wait ${isAssigning ? "bg-emerald-50" : "hover:bg-blue-50/60"}`}>
                <span className="shrink-0">
                  {isAssigning
                    ? <FaSpinner size={12} className="animate-spin text-emerald-600" />
                    : <FaUser size={12} className="text-slate-400" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-extrabold ${isAssigning ? "text-emerald-700" : "text-slate-900"}`}>{t.name}</span>
                    <span className="font-mono text-[10px] text-slate-500">{t.tenantCode}</span>
                    {inactive && (
                      <span className="rounded-full bg-red-100 px-1.5 py-px text-[9px] font-black uppercase text-red-600">{t.status}</span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
                    <span>{getUnitLabel(t)}{t.phone ? ` · ${t.phone}` : ""}</span>
                    {t.balance > 0.009 && (
                      <span className="font-bold text-amber-600">· Bal: {formatMoney(t.balance)}</span>
                    )}
                  </div>
                </div>
                {isAssigning
                  ? <span className="shrink-0 text-[10px] font-bold text-emerald-600">Assigning…</span>
                  : <FaLink size={10} className="shrink-0 text-slate-300" />}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-2.5">
          <span className="text-[10px] text-slate-400">Click a tenant to assign instantly</span>
          <button onClick={onClose} className="inline-flex h-7 items-center px-3 text-xs font-bold text-slate-500 hover:text-slate-800">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Ignore Modal ─────────────────────────────────────────────────────────────
function IgnoreModal({ notif, businessId, onClose, onIgnored }) {
  const [notes,  setNotes]  = useState("");
  const [saving, setSaving] = useState(false);

  const handleConfirm = async () => {
    setSaving(true);
    try {
      const res = await adminRequests.post(`/mpesa-collections/${notif._id}/ignore`, { notes: notes.trim(), business: businessId });
      toast.success("Collection marked as ignored");
      onIgnored(res?.data?.data || res?.data);
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to ignore collection");
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between bg-red-700 px-4 py-3">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-white">Ignore Collection</p>
            <p className="text-[11px] text-red-200">{formatMoney(notif.amount)} · <span className="font-mono">{notif.transactionCode || "—"}</span></p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white"><FaTimes size={14} /></button>
        </div>
        <div className="space-y-3 p-4">
          <p className="text-sm text-slate-700">Mark this M-Pesa payment as ignored? It will be excluded from all future auto-matching.</p>
          <p className="text-[11px] text-slate-500">Use this for wrong paybill payments, test transactions, or non-rent receipts.</p>
          <div>
            <label className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Reason (optional)</label>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Wrong paybill, test payment…"
              className="h-9 w-full border border-slate-300 px-3 text-xs text-slate-700 focus:border-red-500 focus:outline-none"
              autoFocus />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
          <button onClick={onClose} className="inline-flex h-8 items-center px-3 text-xs font-bold text-slate-600 hover:text-slate-900">Cancel</button>
          <button onClick={handleConfirm} disabled={saving}
            className="inline-flex h-8 items-center gap-1.5 bg-red-600 px-4 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50">
            <FaBan size={10} /> {saving ? "Saving…" : "Mark as Ignored"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────
const parseClientCsv = (text) => {
  const rows = [];
  for (const line of text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    if (!line.trim()) continue;
    const cells = []; let cur = ""; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else { inQ = !inQ; } }
      else if (ch === "," && !inQ) { cells.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
    cells.push(cur.trim());
    rows.push(cells);
  }
  return rows;
};

const normH = (h) => String(h || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const detectCsvFormat = (headers) => {
  const nh = headers.map(normH);
  if (nh.includes("receiptno") || nh.includes("paidin") || nh.includes("amountpaidin")) return "portal";
  if (nh.includes("transid")   || nh.includes("billrefnumber"))                          return "daraja";
  return null;
};

const RESULT_META = {
  matched:   { label: "Matched",   cls: "bg-emerald-50 border-emerald-200 text-emerald-700" },
  duplicate: { label: "Duplicate", cls: "bg-slate-50 border-slate-200 text-slate-500"       },
  unmatched: { label: "Unmatched", cls: "bg-amber-50 border-amber-200 text-amber-700"       },
  skipped:   { label: "Skipped",   cls: "bg-slate-50 border-slate-200 text-slate-500"       },
  error:     { label: "Error",     cls: "bg-red-50 border-red-200 text-red-700"             },
};

const ImportResultsSummary = ({ results, onClose }) => (
  <>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {[
        { label: "Matched",   value: results.summary.matched,   cls: "bg-emerald-50 border-emerald-300 text-emerald-700" },
        { label: "Duplicate", value: results.summary.duplicate, cls: "bg-slate-50 border-slate-200 text-slate-500"       },
        { label: "Unmatched", value: results.summary.unmatched, cls: "bg-amber-50 border-amber-200 text-amber-700"       },
        { label: "Total",     value: results.summary.total,     cls: "bg-white border-slate-200 text-slate-700"          },
      ].map(({ label, value, cls }) => (
        <div key={label} className={`rounded border px-3 py-2 text-center ${cls}`}>
          <p className="text-xl font-black leading-none">{value}</p>
          <p className="mt-0.5 text-[9px] font-black uppercase tracking-wide opacity-70">{label}</p>
        </div>
      ))}
    </div>
    <div className="overflow-x-auto rounded border border-slate-200">
      <table className="w-full text-[11px] border-collapse">
        <thead className="bg-[#0B3B2E] text-white">
          <tr>
            <th className="px-3 py-1 text-left font-bold border-r border-white/10">Status</th>
            <th className="px-3 py-1 text-left font-bold border-r border-white/10">Transaction Code</th>
            <th className="px-3 py-1 text-left font-bold border-r border-white/10">Ref / Account</th>
            <th className="px-3 py-1 text-right font-bold border-r border-white/10">Amount</th>
            <th className="px-3 py-1 text-left font-bold">Tenant</th>
          </tr>
        </thead>
        <tbody>
          {results.items.map((item, i) => {
            const s    = item.matchingStatus || (item.wasDuplicate ? "duplicate" : "unmatched");
            const meta = RESULT_META[s === "captured" ? "matched" : s === "ignored" ? "skipped" : "unmatched"] || RESULT_META.unmatched;
            return (
              <tr key={i} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                <td className="px-3 py-1 border-r border-gray-100"><span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-black ${meta.cls}`}>{item.wasDuplicate ? "Duplicate" : meta.label}</span></td>
                <td className="px-3 py-1 border-r border-gray-100 font-mono text-slate-700">{item.transactionCode || "—"}</td>
                <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-800">{item.accountReference || item.billRefNumber || "—"}</td>
                <td className="px-3 py-1 border-r border-gray-100 text-right font-bold text-slate-700">{item.amount > 0 ? formatMoney(item.amount) : "—"}</td>
                <td className="px-3 py-1 text-slate-600">
                  {getTenantLabel(item.tenant) !== "—"
                    ? <span className="font-bold text-[#0B3B2E]">{getTenantLabel(item.tenant)}</span>
                    : <span className="italic text-slate-400">Unmatched</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </>
);

// ─── Upload / Import Modal ────────────────────────────────────────────────────
function UploadModal({ businessId, paybills = [], onClose, onUploaded }) {
  const fileInputRef                = useRef(null);
  const [tab,              setTab]              = useState("csv");
  const [file,             setFile]             = useState(null);
  const [preview,          setPreview]          = useState(null);
  const [pasteText,        setPasteText]        = useState("");
  const [processing,       setProcessing]       = useState(false);
  const [results,          setResults]          = useState(null);
  const [dragOver,         setDragOver]         = useState(false);
  const [selectedShortCode, setSelectedShortCode] = useState("");

  const processItems = (items) => {
    const matched   = items.filter(i => i.matchingStatus === "captured").length;
    const duplicate = items.filter(i => i.wasDuplicate).length;
    const unmatched = items.filter(i => i.matchingStatus !== "captured" && !i.wasDuplicate).length;
    setResults({ summary: { matched, duplicate, unmatched, total: items.length }, items });
    if (matched > 0) onUploaded?.();
  };

  const loadFile = (f) => {
    if (!f) return;
    if (f.name.split(".").pop().toLowerCase() !== "csv") { toast.error("Only CSV files are supported"); return; }
    setFile(f); setResults(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const rows = parseClientCsv(e.target.result);
      if (rows.length < 2) { toast.error("File appears empty"); return; }
      const format = detectCsvFormat(rows[0]);
      if (!format) { toast.error("Unrecognised format. Expected M-Pesa Business Portal or Daraja C2B export."); setFile(null); return; }
      setPreview({ headers: rows[0], rows: rows.slice(1, 51), total: rows.length - 1, format });
    };
    reader.readAsText(f);
  };

  const handleDrop = (e) => { e.preventDefault(); setDragOver(false); loadFile(e.dataTransfer.files?.[0]); };

  const handleProcessCsv = async () => {
    if (!file) return;
    setProcessing(true);
    try {
      const text  = await file.text();
      const rows  = parseClientCsv(text).slice(1);
      const lines = rows.map(c => c.filter(Boolean).join("\t")).filter(Boolean);
      const res   = await adminRequests.post("/mpesa-collections/import-batch", { business: businessId, rawText: lines.join("\n"), ...(selectedShortCode ? { shortCode: selectedShortCode } : {}) });
      processItems(res?.data?.data?.items || []);
    } catch (err) { toast.error(err?.response?.data?.message || "Upload failed"); }
    finally      { setProcessing(false); }
  };

  const handleProcessPaste = async () => {
    const lines = pasteText.trim().split("\n").map(l => l.trim()).filter(Boolean);
    if (!lines.length) { toast.error("Paste at least one transaction line"); return; }
    setProcessing(true);
    try {
      const res = await adminRequests.post("/mpesa-collections/import-batch", { business: businessId, rawText: lines.join("\n"), ...(selectedShortCode ? { shortCode: selectedShortCode } : {}) });
      processItems(res?.data?.data?.items || []);
    } catch (err) { toast.error(err?.response?.data?.message || "Import failed"); }
    finally      { setProcessing(false); }
  };

  const previewCols = preview?.format === "portal"
    ? [{ label: "Receipt No.", key: "receiptno" }, { label: "Date", key: "completiontime" }, { label: "Reference", key: "details" }, { label: "Amount", key: "paidin" }, { label: "Status", key: "transactionstatus" }]
    : [{ label: "TransID", key: "transid" }, { label: "Date", key: "transtime" }, { label: "BillRefNumber", key: "billrefnumber" }, { label: "Amount", key: "transamount" }, { label: "MSISDN", key: "msisdn" }];
  const headerIdxMap = preview ? Object.fromEntries(preview.headers.map((h, i) => [normH(h), i])) : {};
  const getCell = (cells, key) => { const i = headerIdxMap[key] ?? -1; return i >= 0 ? (cells[i] || "—") : "—"; };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex w-full max-w-3xl flex-col border border-slate-200 bg-white shadow-xl" style={{ maxHeight: "90vh" }}>

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between bg-[#0B3B2E] px-4 py-3">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-white">Import M-Pesa Transactions</p>
            <p className="text-[11px] text-emerald-200">Match payments to tenants and record rent receipts</p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white"><FaTimes size={14} /></button>
        </div>

        {/* Tabs — only when no results yet */}
        {!results && (
          <div className="flex shrink-0 border-b border-slate-200 bg-slate-50">
            {[
              { id: "csv",   label: "Upload CSV",    icon: FaFileAlt },
              { id: "paste", label: "Paste Lines",   icon: FaPaste   },
            ].map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" onClick={() => { setTab(id); setFile(null); setPreview(null); }}
                className={`inline-flex items-center gap-2 border-b-2 px-5 py-2.5 text-xs font-bold transition-colors ${tab === id ? "border-[#0B3B2E] text-[#0B3B2E]" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
                <Icon size={11} /> {label}
              </button>
            ))}
          </div>
        )}

        {/* Paybill selector — shown when company has multiple paybills */}
        {!results && paybills.length > 1 && (
          <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-black uppercase tracking-wide text-slate-500">Paybill</span>
              <AppSelect
                value={selectedShortCode}
                onChange={(v) => setSelectedShortCode(v ?? "")}
                options={paybills.map((pb) => ({ value: pb.shortCode, label: pb.name ? `${pb.name} (${pb.shortCode})` : pb.shortCode }))}
                placeholder="Auto-detect (primary paybill)"
                searchable
                clearable
                size="sm"
              />
            </div>
          </div>
        )}

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">

          {/* ── CSV tab ── */}
          {tab === "csv" && !results && (
            <>
              {!preview && (
                <>
                  <div
                    onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)} onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded border-2 border-dashed py-12 transition-colors ${dragOver ? "border-[#0B3B2E] bg-[#EDF5F1]" : "border-slate-300 hover:border-slate-400"}`}>
                    <FaFileAlt size={32} className="text-slate-300" />
                    <div className="text-center">
                      <p className="text-sm font-bold text-slate-600">Drop CSV here, or click to browse</p>
                      <p className="mt-1 text-[11px] text-slate-400">M-Pesa Business Portal export or Daraja C2B format</p>
                    </div>
                    <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={e => loadFile(e.target.files?.[0])} />
                  </div>
                  <div className="rounded border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
                    <p className="mb-1.5 font-black uppercase tracking-wide text-slate-500">Supported Formats</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div><p className="font-bold text-slate-700">M-Pesa Business Portal</p><p className="text-slate-500">Headers: Receipt No., Completion Time, Details, Transaction Status, Paid In</p></div>
                      <div><p className="font-bold text-slate-700">Safaricom Daraja C2B</p><p className="text-slate-500">Headers: TransID, TransTime, TransAmount, BillRefNumber, MSISDN</p></div>
                    </div>
                  </div>
                </>
              )}
              {preview && (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-slate-800">{file.name}</p>
                      <p className="text-[11px] text-slate-500">{preview.total} row{preview.total !== 1 ? "s" : ""} · Format: <span className="font-bold text-[#0B3B2E]">{preview.format === "portal" ? "M-Pesa Business Portal" : "Safaricom Daraja C2B"}</span></p>
                    </div>
                    <button onClick={() => { setFile(null); setPreview(null); }} className="text-[11px] font-bold text-slate-400 hover:text-red-500">Change file</button>
                  </div>
                  <div className="overflow-x-auto rounded border border-slate-200">
                    <table className="w-full min-w-[500px] text-[11px] border-collapse">
                      <thead className="bg-[#0B3B2E] text-white">
                        <tr>
                          <th className="px-2 py-1 text-left font-bold border-r border-white/10">#</th>
                          {previewCols.map(c => <th key={c.key} className="px-3 py-1 text-left font-bold border-r border-white/10">{c.label}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rows.map((cells, i) => (
                          <tr key={i} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                            <td className="px-2 py-1 border-r border-gray-100 font-mono text-[10px] text-slate-400">{i + 2}</td>
                            {previewCols.map(c => <td key={c.key} className="max-w-[160px] truncate px-3 py-1 border-r border-gray-100 text-slate-700" title={getCell(cells, c.key)}>{getCell(cells, c.key)}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {preview.total > 50 && <p className="border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-[10px] text-slate-500">Showing first 50 of {preview.total} rows — all rows will be processed</p>}
                  </div>
                </>
              )}
            </>
          )}

          {/* ── Paste tab ── */}
          {tab === "paste" && !results && (
            <>
              <div className="rounded border border-slate-200 bg-amber-50 p-3 text-[11px] text-amber-800">
                <p className="mb-1 font-black uppercase tracking-wide text-amber-700">Format — one transaction per line:</p>
                <p className="font-mono text-[10px]">DD/MM/YYYY TXN_CODE Payer Name MSISDN TenantCode KES Amount</p>
                <p className="mt-1 text-slate-500">Example: <span className="font-mono">04/06/2026 RGF12K9P1D John Doe 254712345678 TT0004 KES 12,000</span></p>
              </div>
              <textarea
                className="w-full rounded border border-slate-300 p-3 font-mono text-xs text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
                rows={10}
                placeholder={"04/06/2026 RGF12K9P1D John Doe 254712345678 TT0004 KES 12,000\n05/06/2026 SDF89X3Q2A Jane Smith 254700111222 TT0007 KES 18,500"}
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
              />
              <p className="text-[11px] text-slate-500">{pasteText.trim().split("\n").filter(Boolean).length} line{pasteText.trim().split("\n").filter(Boolean).length !== 1 ? "s" : ""} ready to process</p>
            </>
          )}

          {/* ── Results ── */}
          {results && <ImportResultsSummary results={results} onClose={onClose} />}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3">
          {results
            ? <span className="text-[11px] text-slate-500">{results.summary.matched} payment{results.summary.matched !== 1 ? "s" : ""} matched · {results.summary.total} total</span>
            : tab === "csv" && preview
              ? <span className="text-[11px] text-slate-500">{preview.total} rows will be processed</span>
              : tab === "paste"
                ? <span className="text-[11px] text-slate-500">{pasteText.trim().split("\n").filter(Boolean).length} lines</span>
                : <span className="text-[11px] text-slate-400">Select a file to begin</span>}
          <div className="flex gap-2">
            {results
              ? <button onClick={onClose} className="inline-flex h-8 items-center px-4 text-xs font-bold text-slate-600 hover:text-slate-900">Close</button>
              : <>
                  <button onClick={onClose} className="inline-flex h-8 items-center px-3 text-xs font-bold text-slate-600 hover:text-slate-900">Cancel</button>
                  {tab === "csv" && preview && (
                    <button onClick={handleProcessCsv} disabled={processing}
                      className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-bold text-white hover:bg-[#0A3127] disabled:opacity-50">
                      {processing ? <FaSpinner size={10} className="animate-spin" /> : <FaUpload size={10} />}
                      {processing ? "Processing…" : `Process ${preview.total} row${preview.total !== 1 ? "s" : ""}`}
                    </button>
                  )}
                  {tab === "paste" && pasteText.trim() && (
                    <button onClick={handleProcessPaste} disabled={processing}
                      className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-bold text-white hover:bg-[#0A3127] disabled:opacity-50">
                      {processing ? <FaSpinner size={10} className="animate-spin" /> : <FaPaste size={10} />}
                      {processing ? "Processing…" : `Import ${pasteText.trim().split("\n").filter(Boolean).length} line${pasteText.trim().split("\n").filter(Boolean).length !== 1 ? "s" : ""}`}
                    </button>
                  )}
                </>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function PmsMpesaNotifications() {
  const navigate       = useNavigate();
  const currentCompany = useSelector(selectCurrentCompany);
  const businessId     = String(currentCompany?._id || currentCompany?.id || "");
  const paybills       = currentCompany?.paymentIntegration?.mpesaPaybills || [];

  const [notifications, setNotifications] = useState([]);
  const [summary,       setSummary]       = useState([]);
  const [pagination,    setPagination]    = useState({ page: 1, limit: PAGE_SIZE, total: 0, pages: 1 });
  const [loading,       setLoading]       = useState(false);
  const [expanded,      setExpanded]      = useState(null);
  const [assignTarget,  setAssignTarget]  = useState(null);
  const [ignoreTarget,  setIgnoreTarget]  = useState(null);
  const [showUpload,    setShowUpload]    = useState(false);
  const [deletingId,    setDeletingId]    = useState(null);
  const [unignoringId,  setUnignoringId]  = useState(null);

  const [filters, setFilters] = useTabState("/receipts/mpesa-collections:filters", () => ({ status: "", shortCode: "", ref: "", search: "", dateFrom: threeMonthsAgoISO(), dateTo: todayISO() }));
  const [applied, setApplied] = useTabState("/receipts/mpesa-collections:applied", () => ({ status: "", shortCode: "", ref: "", search: "", dateFrom: threeMonthsAgoISO(), dateTo: todayISO() }));
  const [page,    setPage]    = useTabState("/receipts/mpesa-collections:page", 1);

  const load = useCallback(async (silent = false) => {
    if (!businessId) return;
    if (!silent) setLoading(true);
    try {
      const res = await adminRequests.get("/mpesa-collections", {
        params: {
          business:  businessId,
          status:    applied.status    || undefined,
          shortCode: applied.shortCode || undefined,
          search:    applied.search    || applied.ref || undefined,
          dateFrom:  applied.dateFrom  || undefined,
          dateTo:    applied.dateTo    || undefined,
          page, limit: PAGE_SIZE,
        },
      });
      const payload = res?.data;
      setNotifications(payload?.data || []);
      setPagination(payload?.pagination || { page: 1, limit: PAGE_SIZE, total: 0, pages: 1 });
      setSummary(Array.isArray(payload?.summary) ? payload.summary : []);
    } catch { if (!silent) toast.error("Failed to load M-Pesa collections"); }
    finally  { if (!silent) setLoading(false); }
  }, [businessId, applied, page]);

  // Initial + filter/page load
  useEffect(() => { load(); }, [load]);

  const apply = (e) => { e.preventDefault(); setPage(1); setApplied({ ...filters }); };
  const reset = () => {
    const d = { status: "", shortCode: "", ref: "", search: "", dateFrom: threeMonthsAgoISO(), dateTo: todayISO() };
    setFilters(d); setApplied(d); setPage(1);
  };

  // Clicking a summary chip quick-filters by that status
  const quickFilter = (status) => {
    const next = { ...filters, status };
    setFilters(next); setApplied(next); setPage(1);
  };

  const handleUpdate = useCallback((updated) => {
    if (!updated) { load(); return; }
    setNotifications(prev => prev.map(n => n._id === updated._id ? { ...n, ...updated } : n));
  }, [load]);

  const handleDelete = useCallback(async (id) => {
    if (!window.confirm("Delete this M-Pesa collection record? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      await adminRequests.delete(`/mpesa-collections/${id}`, { params: { business: businessId } });
      toast.success("Collection record deleted.");
      setExpanded(null); load();
    } catch (err) { toast.error(err?.response?.data?.message || "Delete failed"); }
    finally      { setDeletingId(null); }
  }, [businessId, load]);

  const handleUnignore = useCallback(async (id) => {
    setUnignoringId(id);
    try {
      const res = await adminRequests.post(`/mpesa-collections/${id}/unignore`, { business: businessId });
      toast.success("Collection restored");
      handleUpdate(res?.data?.data);
    } catch (err) { toast.error(err?.response?.data?.message || "Failed to restore"); }
    finally      { setUnignoringId(null); }
  }, [businessId, handleUpdate]);

  const summaryMap = useMemo(
    () => Object.fromEntries(summary.map(s => [s._id, s])),
    [summary]
  );

  const SUMMARY_CHIPS = useMemo(() => {
    const countUnmatched = (summaryMap.unmatched?.count || 0) + (summaryMap.matched_tenant?.count || 0);
    const countCaptured  = summaryMap.captured?.count       || 0;
    const countDuplicate = summaryMap.duplicate?.count      || 0;
    const countIgnored   = summaryMap.ignored?.count        || 0;
    const amountCaptured = summaryMap.captured?.totalAmount || 0;
    return [
      { key: "captured",  value: countCaptured,  sub: formatMoney(amountCaptured) },
      { key: "unmatched", value: countUnmatched, sub: "pending action"            },
      { key: "duplicate", value: countDuplicate, sub: "already processed"         },
      { key: "ignored",   value: countIgnored,   sub: "excluded"                  },
    ];
  }, [summaryMap]);

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full flex-col overflow-hidden bg-slate-50">

        {/* Modals */}
        {showUpload && <UploadModal businessId={businessId} paybills={paybills} onClose={() => { setShowUpload(false); load(); }} onUploaded={load} />}
        {assignTarget && (
          <AssignTenantModal notif={assignTarget} businessId={businessId}
            onClose={() => setAssignTarget(null)}
            onAssigned={(u) => {
              handleUpdate(u);
              setAssignTarget(null);
              load();
            }} />
        )}
        {ignoreTarget && (
          <IgnoreModal notif={ignoreTarget} businessId={businessId}
            onClose={() => setIgnoreTarget(null)}
            onIgnored={(u) => { handleUpdate(u); setIgnoreTarget(null); }} />
        )}

        {/* Summary chips — clickable quick-filters */}
        <div className="shrink-0 flex items-center gap-1.5 border-b border-slate-200 bg-white px-3 py-1.5 overflow-x-auto">
          {SUMMARY_CHIPS.map(({ key, value, sub }) => {
            const meta   = STATUS_META[key];
            const active = applied.status === key;
            return (
              <button key={key} type="button" onClick={() => quickFilter(active ? "" : key)}
                title={`Filter by ${meta.label}`}
                className={`inline-flex items-center gap-1.5 border-l-[3px] border border-r px-2 py-1 text-left transition-all whitespace-nowrap
                  ${meta.chip.accent} ${meta.chip.border}
                  ${active ? `${meta.chip.bg} ring-1 ring-inset ring-[#0B3B2E]/25` : `bg-white hover:${meta.chip.bg}`}`}>
                <span className={`text-sm font-black tabular-nums ${meta.chip.text}`}>{value}</span>
                <span className="text-[9px] font-black uppercase tracking-wide text-slate-500">{meta.label}</span>
                {sub && <span className="text-[9px] text-slate-400">· {sub}</span>}
                {active && <FaTimes size={7} className="shrink-0 text-slate-400" />}
              </button>
            );
          })}
          <div className="inline-flex items-center gap-1.5 border border-slate-200 bg-slate-50 px-2 py-1 whitespace-nowrap">
            <span className="text-sm font-black tabular-nums text-slate-700">{pagination.total}</span>
            <span className="text-[9px] font-black uppercase tracking-wide text-slate-500">Total</span>
            <span className="text-[9px] text-slate-400">· in filter</span>
          </div>
        </div>

        {/* Filter bar */}
        <form onSubmit={apply} className="shrink-0 flex items-center gap-0.5 overflow-x-auto border-b border-slate-200 bg-white px-2 py-1">
          <AppSelect
            value={filters.status}
            onChange={(v) => setFilters(p => ({ ...p, status: v ?? "" }))}
            options={["unmatched", "captured", "duplicate", "ignored"].map(k => ({ value: k, label: STATUS_META[k].label }))}
            placeholder="All statuses"
            clearable
            compact
          />
          {paybills.length > 1 && (
            <AppSelect
              value={filters.shortCode}
              onChange={(v) => setFilters(p => ({ ...p, shortCode: v ?? "" }))}
              options={paybills.map((pb) => ({ value: pb.shortCode, label: `${pb.name || pb.shortCode} (${pb.shortCode})` }))}
              placeholder="All paybills"
              searchable
              clearable
              compact
            />
          )}
          <input
            className="h-[20px] border border-slate-300 px-1.5 text-[9px] font-semibold text-slate-700 placeholder:font-normal focus:border-[#0B3B2E] focus:outline-none"
            placeholder="Account ref / tenant code"
            value={filters.ref} onChange={e => setFilters(p => ({ ...p, ref: e.target.value }))} />
          <div className="relative flex items-center">
            <FaSearch size={9} className="pointer-events-none absolute left-2 text-slate-400" />
            <input
              className="h-[20px] w-40 border border-slate-300 pl-6 pr-2 text-[9px] font-semibold text-slate-700 placeholder:font-normal focus:border-[#0B3B2E] focus:outline-none"
              placeholder="Txn ID or payer name"
              value={filters.search} onChange={e => setFilters(p => ({ ...p, search: e.target.value }))} />
          </div>
          <input type="date" value={filters.dateFrom} onChange={e => setFilters(p => ({ ...p, dateFrom: e.target.value }))}
            className="h-[20px] w-[5.5rem] border border-slate-300 px-1 text-[9px] font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none" />
          <span className="text-[9px] font-bold text-slate-400">→</span>
          <input type="date" value={filters.dateTo} onChange={e => setFilters(p => ({ ...p, dateTo: e.target.value }))}
            className="h-[20px] w-[5.5rem] border border-slate-300 px-1 text-[9px] font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none" />
          <button type="submit" className="inline-flex h-[20px] items-center gap-0.5 bg-[#FF8C00] px-1.5 text-[9px] font-bold text-white hover:bg-[#E67E00]">
            <FaSearch size={7} /> Search
          </button>
          <button type="button" onClick={reset} className="inline-flex h-[20px] items-center gap-0.5 bg-[#0B3B2E] px-1.5 text-[9px] font-bold text-white hover:bg-[#0A3127]">
            <FaRedoAlt size={7} /> Reset
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={() => setShowUpload(true)}
              className="inline-flex h-[20px] items-center gap-0.5 border border-slate-300 bg-white px-1.5 text-[9px] font-bold text-slate-700 hover:bg-slate-50">
              <FaUpload size={7} /> Import
            </button>
            <CountdownButton onRefresh={load} loading={loading} />
          </div>
        </form>

        {/* Table area */}
        <div className="relative flex-1 overflow-auto">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60">
              <div className="relative h-10 w-10">
                <div className="absolute inset-0 animate-spin" style={{ border: "3px solid #e2e8f0", borderTopColor: "#027333", borderRightColor: "#0B3B2E", animationDuration: "0.9s" }} />
                <div className="absolute inset-[9px] animate-spin" style={{ border: "2px solid #e2e8f0", borderBottomColor: "#027333", borderLeftColor: "#0B3B2E", animationDuration: "0.6s", animationDirection: "reverse" }} />
              </div>
            </div>
          )}

          <table className="w-full min-w-[1200px] text-[11px] border-collapse">
            <thead className="sticky top-0 z-[5] bg-[#0B3B2E] text-white">
              <tr>
                <th className="px-2 py-1.5 text-left font-bold border-r border-white/10 whitespace-nowrap">Time</th>
                <th className="px-2 py-1.5 text-left font-bold border-r border-white/10">Status</th>
                <th className="px-2 py-1.5 text-left font-bold border-r border-white/10">Account Ref</th>
                <th className="px-2 py-1.5 text-right font-bold border-r border-white/10">Amount</th>
                <th className="px-2 py-1.5 text-left font-bold border-r border-white/10">Payer</th>
                <th className="px-2 py-1.5 text-left font-bold border-r border-white/10">Txn Code</th>
                <th className="px-2 py-1.5 text-left font-bold border-r border-white/10">Paybill Config</th>
                <th className="px-2 py-1.5 text-left font-bold border-r border-white/10">Tenant</th>
                <th className="px-2 py-1.5 text-left font-bold border-r border-white/10">Property</th>
                <th className="px-2 py-1.5 text-left font-bold border-r border-white/10">Unit</th>
                <th className="px-2 py-1.5 text-left font-bold border-r border-white/10">Receipt</th>
                <th className="px-2 py-1.5 text-center font-bold">Action</th>
              </tr>
            </thead>
            <tbody>
              {!loading && notifications.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <FaSearch size={28} className="text-slate-200" />
                      <p className="text-sm font-bold text-slate-400">No collections found</p>
                      <p className="text-[11px] text-slate-400">
                        {applied.status || applied.ref || applied.search
                          ? "Try adjusting your filters or click a status chip above to clear"
                          : "No M-Pesa transactions for today. Upload a CSV or wait for callbacks."}
                      </p>
                      {(applied.status || applied.ref || applied.search) && (
                        <button onClick={reset} className="mt-1 inline-flex items-center gap-1.5 border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                          <FaRedoAlt size={9} /> Clear filters
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )}

              {notifications.map((n, index) => {
                const isUnmatched = n.matchingStatus === "unmatched" || n.matchingStatus === "matched_tenant";
                const canAssign = isUnmatched && !n.tenant && !n.matchedReceipt;
                const canRecord = isUnmatched && !!n.tenant && !n.matchedReceipt;
                const canIgnore = isUnmatched && !n.matchedReceipt;
                const isIgnored = n.matchingStatus === "ignored";
                const isOpen    = expanded === n._id;

                return (
                  <React.Fragment key={n._id}>
                    <tr
                      onClick={() => setExpanded(isOpen ? null : n._id)}
                      className={`cursor-pointer border-b border-gray-100 transition-colors ${isIgnored ? "opacity-60 bg-red-50/20 hover:bg-red-50/40" : index % 2 === 0 ? "bg-white hover:bg-blue-50/30" : "bg-slate-50/40 hover:bg-blue-50/30"}`}>
                      <td className="px-2 py-1 border-r border-gray-100 text-[10px] text-slate-400 whitespace-nowrap tabular-nums">{fmtDate(n.transactionDate || n.createdAt)}</td>
                      <td className="px-2 py-1 border-r border-gray-100"><StatusBadge status={n.matchingStatus} /></td>
                      <td className="px-2 py-1 border-r border-gray-100">
                        <div className="font-extrabold tracking-wider text-slate-900 leading-tight">{n.accountReference || "—"}</div>
                        {n.billRefNumber && n.billRefNumber !== n.accountReference && (
                          <div className="text-[9px] text-slate-400 font-mono leading-tight">↳ {n.billRefNumber}</div>
                        )}
                      </td>
                      <td className={`px-2 py-1 border-r border-gray-100 text-right font-extrabold tabular-nums ${n.matchingStatus === "captured" ? "text-emerald-700" : "text-slate-700"}`}>
                        {n.amount > 0 ? formatMoney(n.amount) : "—"}
                      </td>
                      <td className="px-2 py-1 border-r border-gray-100">
                        <div className="font-semibold text-slate-700 leading-tight">{n.payerName || <span className="font-normal italic text-slate-400">—</span>}</div>
                      </td>
                      <td className="px-2 py-1 border-r border-gray-100 font-mono text-[10px] text-slate-700 whitespace-nowrap">{n.transactionCode || "—"}</td>
                      <td className="px-2 py-1 border-r border-gray-100 text-[10px] font-semibold text-slate-800 leading-tight">
                        {n.configName || "—"}
                      </td>
                      {/* Tenant */}
                      <td className="px-2 py-1 border-r border-gray-100">
                        {n.tenant
                          ? (
                            <div className="leading-tight">
                              <span className="font-bold text-[#0B3B2E]">{getTenantLabel(n.tenant)}</span>
                              {n.metadata?.manualAssignment?.assignedByName && (
                                <div className="mt-0.5 inline-flex items-center gap-1">
                                  <span className="inline-flex items-center rounded px-1 py-px text-[8px] font-black uppercase tracking-wide bg-orange-100 text-orange-700 ring-1 ring-inset ring-orange-300 whitespace-nowrap">
                                    ✎ {n.metadata.manualAssignment.assignedByName}
                                  </span>
                                </div>
                              )}
                            </div>
                          )
                          : <span className="italic text-[9px] text-slate-400">{n.notes || "—"}</span>}
                      </td>
                      {/* Property */}
                      <td className="px-2 py-1 border-r border-gray-100 text-[10px] text-slate-600 leading-tight">
                        {n.tenant?.unit?.property?.propertyName || n.tenant?.property?.propertyName || "—"}
                      </td>
                      {/* Unit */}
                      <td className="px-2 py-1 border-r border-gray-100 text-[10px] font-semibold text-slate-700 leading-tight whitespace-nowrap">
                        {n.tenant?.unit?.unitName || n.tenant?.unit?.unitNumber || n.tenant?.unit?.name || "—"}
                      </td>
                      {/* Receipt */}
                      <td className="px-2 py-1 border-r border-gray-100 text-[10px] font-mono leading-tight">
                        {n.matchedReceipt
                          ? <span className="font-bold text-emerald-700">{n.matchedReceipt.receiptNumber || n.matchedReceipt.referenceNumber || "linked"}</span>
                          : canRecord
                            ? (
                              <div className="flex flex-col gap-px">
                                <span className="inline-flex items-center rounded px-1 py-px text-[8px] font-black uppercase tracking-wide bg-blue-50 text-blue-600 ring-1 ring-inset ring-blue-200 whitespace-nowrap">Awaiting Record</span>
                                {n.metadata?.autoReceiptSkipReason && (
                                  <span className="text-[8px] text-amber-600 leading-tight" title={n.metadata.autoReceiptSkipReason}>
                                    ⚠ {n.metadata.autoReceiptSkipReason}
                                  </span>
                                )}
                              </div>
                            )
                            : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-2 py-1 text-center" onClick={e => e.stopPropagation()}>
                        <div className="flex flex-wrap items-center justify-center gap-1">
                          {canAssign && (
                            <button type="button" onClick={() => setAssignTarget(n)}
                              className="inline-flex items-center gap-1 border border-amber-300 bg-amber-50 px-2 py-px text-[10px] font-bold text-amber-700 hover:bg-amber-100">
                              <FaLink size={8} /> Assign
                            </button>
                          )}
                          {canRecord && (
                            <button type="button"
                              onClick={() => {
                                const pb = paybills.find(p => String(p.shortCode || "") === String(n.shortCode || "")) || paybills[0];
                                const cbParam = pb?.defaultCashbookAccountId ? `&cashbookAccountId=${pb.defaultCashbookAccountId}` : "";
                                navigate(`/receipts/new?tenant=${n.tenant?._id}&amount=${n.amount}&reference=${n.transactionCode}&collectionId=${n._id}&paymentMethod=mpesa&payerName=${encodeURIComponent(n.payerName || "")}&msisdn=${encodeURIComponent(n.msisdn || "")}${cbParam}`);
                              }}
                              className="inline-flex items-center gap-1 border border-emerald-300 bg-emerald-50 px-2 py-px text-[10px] font-bold text-emerald-700 hover:bg-emerald-100">
                              <FaReceipt size={8} /> Record
                            </button>
                          )}
                          {canIgnore && (
                            <button type="button" onClick={() => setIgnoreTarget(n)}
                              className="inline-flex items-center gap-1 border border-red-200 bg-red-50 px-2 py-px text-[10px] font-bold text-red-600 hover:bg-red-100">
                              <FaBan size={8} /> Ignore
                            </button>
                          )}
                          {isIgnored && (
                            <button type="button" onClick={() => handleUnignore(n._id)} disabled={unignoringId === n._id}
                              className="inline-flex items-center gap-1 border border-slate-300 bg-white px-2 py-px text-[10px] font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50">
                              <FaUndo size={8} /> {unignoringId === n._id ? "…" : "Restore"}
                            </button>
                          )}
                          <span className="text-slate-300">{isOpen ? <FaChevronUp size={8} /> : <FaChevronDown size={8} />}</span>
                        </div>
                      </td>
                    </tr>

                    {isOpen && (
                      <tr className="border-b border-slate-200 bg-slate-50/80">
                        <td colSpan={12} className="px-4 py-2.5">
                          <div className="mb-2.5 grid grid-cols-3 gap-x-5 gap-y-1.5 sm:grid-cols-6">
                            {[
                              { label: "Payer",        value: n.payerName || "—"                                                     },
                              { label: "Phone",        value: n.msisdn || "—"                                                        },
                              { label: "Txn Code",     value: n.transactionCode || "—"                                               },
                              { label: "Amount",       value: n.amount > 0 ? formatMoney(n.amount) : "—"                            },
                              { label: "Account Ref",  value: n.accountReference || "—"                                              },
                              { label: "Bill Ref",     value: n.billRefNumber || "—"                                                 },
                              { label: "Source",       value: n.source || "—"                                                        },
                              { label: "Short Code",   value: n.shortCode || "—"                                                     },
                              { label: "Txn Date",     value: n.transactionDate ? new Date(n.transactionDate).toLocaleString("en-KE") : "—" },
                              { label: "Config",       value: n.configName || "—"                                                    },
                              { label: "Org Balance",  value: n.orgAccountBalance || "—"                                             },
                              { label: "Status",       value: n.matchingStatus || "—"                                                },
                              ...(n.metadata?.manualAssignment ? [
                                { label: "Assigned By",  value: n.metadata.manualAssignment.assignedByName || "—"                   },
                                { label: "Assigned At",  value: n.metadata.manualAssignment.assignedAt ? new Date(n.metadata.manualAssignment.assignedAt).toLocaleString("en-KE") : "—" },
                              ] : []),
                            ].map(({ label, value }) => (
                              <div key={label}>
                                <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">{label}</p>
                                <p className="mt-px break-all text-[10px] font-semibold text-slate-800">{value}</p>
                              </div>
                            ))}
                          </div>
                          {n.notes && (
                            <div className="mb-2 flex items-start gap-2 border border-amber-200 bg-amber-50 px-3 py-2">
                              <span className="text-[10px] font-bold uppercase text-amber-700">Notes:</span>
                              <span className="text-[10px] text-amber-800">{n.notes}</span>
                            </div>
                          )}
                          {n.rawPayload && (
                            <>
                              <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-400">Raw Safaricom Payload</p>
                              <pre className="max-h-40 overflow-auto rounded border border-slate-200 bg-white p-3 text-[10px] font-mono text-slate-700">
                                {JSON.stringify(n.rawPayload, null, 2)}
                              </pre>
                            </>
                          )}
                          {!n.matchedReceipt && (
                            <div className="mt-3 flex justify-end">
                              <button onClick={() => handleDelete(n._id)} disabled={deletingId === n._id}
                                className="inline-flex items-center gap-1.5 border border-rose-300 bg-rose-50 px-3 py-1.5 text-[10px] font-bold text-rose-600 hover:bg-rose-100 disabled:opacity-50">
                                {deletingId === n._id ? <FaSpinner size={9} className="animate-spin" /> : <FaTrash size={9} />}
                                {deletingId === n._id ? "Deleting…" : "Delete Record"}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>

          {/* Pagination footer */}
          <div className="flex-shrink-0 sticky bottom-0 z-20 bg-white border-t border-gray-200 px-2 py-1 flex items-center justify-between">
            <div className="text-xs font-bold text-gray-600">
              Showing <strong>{notifications.length}</strong> of <strong>{pagination.total}</strong> · {PAGE_SIZE} per page
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500">Page {pagination.page} of {pagination.pages || 1}</span>
              <button disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}
                className="p-1 hover:bg-gray-100 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-gray-700">
                <FaChevronLeft size={12} />
              </button>
              <button disabled={page >= (pagination.pages || 1) || loading} onClick={() => setPage(p => p + 1)}
                className="p-1 hover:bg-gray-100 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-gray-700">
                <FaChevronRight size={12} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
