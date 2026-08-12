import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useEntityCache } from "../../hooks/useEntityCache";
import { useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import { FaCheckCircle, FaDownload, FaFileAlt, FaPrint, FaSyncAlt, FaTimes } from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { fmtDate } from "../../utils/dates";
import {
  approveStatement,
  createDraftStatement,
  getLandlords,
  getStatement,
} from "../../redux/apiCalls";
import { getProperties } from "../../redux/propertyRedux";
import { selectCurrentCompany, selectCurrentUser, selectAllProperties, selectAllLandlords } from "../../redux/selectors";
import { adminRequests } from "../../utils/requestMethods";
import { hasCompanyPermission } from "../../utils/permissions";
import useScopedSessionDraft, { buildScopedDraftKey } from "../../hooks/useScopedSessionDraft";

const _KES_FMT = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  minimumFractionDigits: 2,
});
const currency = (value) => _KES_FMT.format(Number(value || 0));

const depositMemoCurrency = (value) => currency(Math.abs(Number(value || 0)));

// Returns payment status for a single statement row.
const getRowPaymentStatus = (row) => {
  if (!row.tenantId || String(row.tenantName || "").toLowerCase() === "vacant") return "vacant";
  const invoiced = Number(row.invoicedRent || 0);
  if (invoiced === 0) return "nobill";
  const paid = Number(row.paidRent || 0);
  if (paid >= invoiced) return "paid";
  if (paid > 0) return "partial";
  return "unpaid";
};

const ROW_STATUS = {
  paid:    { border: "border-l-[3px] border-l-emerald-400", badge: "bg-emerald-100 text-emerald-700", label: "PAID",   textMuted: false },
  partial: { border: "border-l-[3px] border-l-amber-400",   badge: "bg-amber-100 text-amber-700",   label: "PART",   textMuted: false },
  unpaid:  { border: "border-l-[3px] border-l-red-400",     badge: "bg-red-100 text-red-700",       label: "UNPAID", textMuted: false },
  nobill:  { border: "border-l-[3px] border-l-slate-200",   badge: "",                               label: "",       textMuted: false },
  vacant:  { border: "border-l-[3px] border-l-slate-200",   badge: "",                               label: "",       textMuted: true  },
};


const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const buildStatementPeriodLabel = (workspace = {}, statement = {}) => {
  const explicit =
    workspace?.statementPeriodLabel ||
    workspace?.periodLabel ||
    "";

  if (String(explicit || "").trim()) {
    return String(explicit).trim();
  }

  const start = workspace?.statementPeriodStart || statement?.periodStart || null;
  const end = workspace?.statementPeriodEnd || statement?.periodEnd || null;
  const startLabel = fmtDate(start);
  const endLabel = fmtDate(end);

  if (startLabel && endLabel) return `${startLabel} - ${endLabel}`;
  return startLabel || endLabel || "-";
};

const sumSectionAmounts = (items = []) =>
  items.reduce((sum, item) => sum + Number(item?.amount || 0), 0);

const getStatementSettlement = (summary = {}) => {
  const netStatement = Number(summary?.netStatement || 0);
  const explicitRecovery = Math.max(
    Number(summary?.amountPayableByLandlordToManager || 0),
    0
  );
  const isNegative =
    Boolean(summary?.isNegativeStatement) || explicitRecovery > 0 || netStatement < 0;

  if (isNegative) {
    return {
      isNegative: true,
      label: summary?.settlementLabel || "Landlord owes manager",
      amount: explicitRecovery > 0 ? explicitRecovery : Math.abs(netStatement),
    };
  }

  return {
    isNegative: false,
    label: summary?.settlementLabel || "Net payable to landlord",
    amount: Number(
      summary?.amountPayableToLandlord ??
        summary?.netPayableToLandlord ??
        (netStatement > 0 ? netStatement : 0)
    ),
  };
};

const normalizeId = (value) => {
  if (!value) return "";
  if (typeof value === "object") return String(value._id || value.id || "");
  return String(value);
};

const monthOptions = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MONTH_SELECT_OPTIONS = monthOptions.map((label, index) => ({ value: String(index + 1), label }));

const toIsoDate = (date) => {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const resolveDayKey = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return toIsoDate(date);
};

const buildPeriod = (month, year) => {
  const monthIndex = Number(month) - 1;
  const y = Number(year);
  const start = new Date(y, monthIndex, 1);
  return {
    periodStart: toIsoDate(start),
    periodEnd: "",
  };
};

const getMonthEndDate = (month, year) => {
  const monthIndex = Number(month) - 1;
  const y = Number(year);
  return new Date(y, monthIndex + 1, 0, 23, 59, 59, 999);
};

const getDefaultPeriodStart = ({ month, year, latestProcessedCutoffAt, propertyDateAcquired, todayIso }) => {
  const fallback = buildPeriod(month, year).periodStart;

  if (latestProcessedCutoffAt) {
    const latestCutoff = new Date(latestProcessedCutoffAt);
    if (!Number.isNaN(latestCutoff.getTime())) {
      const nextStatementAnchor = new Date(latestCutoff.getTime() + 1);
      nextStatementAnchor.setHours(0, 0, 0, 0);
      return toIsoDate(nextStatementAnchor);
    }
  }

  if (propertyDateAcquired) {
    const acquiredDate = new Date(propertyDateAcquired);
    if (!Number.isNaN(acquiredDate.getTime())) {
      acquiredDate.setHours(0, 0, 0, 0);
      const todayStart = new Date(`${todayIso}T00:00:00`);
      return toIsoDate(acquiredDate.getTime() > todayStart.getTime() ? todayStart : acquiredDate);
    }
  }

  return fallback;
};

const isFutureIsoDate = (value, todayIso) => Boolean(value) && value > todayIso;

const isSameMonthAndYear = (value, month, year) => {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.getMonth() + 1 === Number(month) && date.getFullYear() === Number(year);
};

const getPropertyLabel = (property) => {
  const code = property?.propertyCode ? `[${property.propertyCode}] ` : "";
  return `${code}${property?.propertyName || property?.name || "Unnamed Property"}`;
};

const normalizeReopenDraftContext = (value = null) => {
  if (!value || typeof value !== "object") return null;

  const propertyId = normalizeId(value?.propertyId || value?.property || "");
  const landlordId = normalizeId(value?.landlordId || value?.landlord || "");
  const rawPeriodStart = value?.periodStart || value?.statementStartAt || value?.startAt || "";
  const rawPeriodEnd =
    value?.periodEnd ||
    value?.statementEndAt ||
    value?.cutoffAt ||
    value?.closedAt ||
    "";
  const periodStart = rawPeriodStart ? toIsoDate(rawPeriodStart) : "";
  const periodEnd = rawPeriodEnd ? toIsoDate(rawPeriodEnd) : "";

  if (!propertyId || !periodStart || !periodEnd) return null;

  return {
    propertyId,
    landlordId,
    statementType: String(value?.statementType || "provisional").toLowerCase(),
    periodStart,
    periodEnd,
  };
};

const resolveStatementType = (statement = null, fallback = "provisional") =>
  String(
    statement?.metadata?.statementType ||
      statement?.metadata?.workspace?.statementType ||
      fallback
  );

const buildStatementSelectionKey = ({
  companyId = "",
  propertyId = "",
  landlordId = "",
  statementType = "provisional",
  periodStart = "",
  periodEnd = "",
} = {}) =>
  [
    String(companyId || "").trim(),
    normalizeId(propertyId),
    normalizeId(landlordId),
    String(statementType || "provisional").trim().toLowerCase(),
    resolveDayKey(periodStart),
    resolveDayKey(periodEnd),
  ].join("|");


const toUtilityKey = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "other_utility";

const titleCase = (value = "") =>
  String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const normalizeRowUtilities = (row = {}) => {
  const map = {};

  if (row?.utilities && typeof row.utilities === "object") {
    Object.values(row.utilities).forEach((item) => {
      const key = toUtilityKey(item?.key || item?.label || "");
      map[key] = {
        key,
        label: item?.label || titleCase(key.replace(/_/g, " ")) || "Other Utility",
        invoiced: Number(item?.invoiced || 0),
        paid: Number(item?.paid || 0),
      };
    });
  }

  if (Number(row?.invoicedGarbage || 0) !== 0 || Number(row?.paidGarbage || 0) !== 0) {
    map.garbage = {
      key: "garbage",
      label: "Garbage",
      invoiced: Number(row?.invoicedGarbage || 0),
      paid: Number(row?.paidGarbage || 0),
    };
  }

  if (Number(row?.invoicedWater || 0) !== 0 || Number(row?.paidWater || 0) !== 0) {
    map.water = {
      key: "water",
      label: "Water",
      invoiced: Number(row?.invoicedWater || 0),
      paid: Number(row?.paidWater || 0),
    };
  }

  return map;
};

const buildUtilityColumns = (workspace = null, rows = []) => {
  if (Array.isArray(workspace?.utilityColumns) && workspace.utilityColumns.length > 0) {
    return workspace.utilityColumns.map((item) => ({
      key: toUtilityKey(item?.key || item?.label || ""),
      label: item?.label || titleCase(String(item?.key || item?.label || "").replace(/_/g, " ")),
      invoiced: Number(item?.invoiced || 0),
      paid: Number(item?.paid || 0),
    }));
  }

  const map = new Map();

  rows.forEach((row) => {
    Object.values(normalizeRowUtilities(row)).forEach((item) => {
      const key = toUtilityKey(item?.key || item?.label || "");
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: item?.label || titleCase(key.replace(/_/g, " ")) || "Other Utility",
          invoiced: 0,
          paid: 0,
        });
      }

      const entry = map.get(key);
      entry.invoiced += Number(item?.invoiced || 0);
      entry.paid += Number(item?.paid || 0);
    });
  });

  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
};

const buildStatementColumns = (workspace = null, utilityColumns = []) => {
  if (Array.isArray(workspace?.statementColumns) && workspace.statementColumns.length > 0) {
    return workspace.statementColumns.map((item) => ({
      key: String(item?.key || ''),
      label: item?.label || titleCase(String(item?.key || '').replace(/_/g, ' ')),
      sourceKeys: Array.isArray(item?.sourceKeys) && item.sourceKeys.length > 0 ? item.sourceKeys.map((value) => toUtilityKey(value)) : [toUtilityKey(item?.key || item?.label || '')],
      invoiced: Number(item?.invoiced || 0),
      paid: Number(item?.paid || 0),
      isGrouped: Boolean(item?.isGrouped),
      categoryType: item?.categoryType || 'utility',
    }));
  }

  if (utilityColumns.length <= 4) {
    return utilityColumns.map((item) => ({
      key: item.key,
      label: item.label,
      sourceKeys: [item.key],
      invoiced: Number(item?.invoiced || 0),
      paid: Number(item?.paid || 0),
      isGrouped: false,
      categoryType: item?.categoryType || 'utility',
    }));
  }

  const visible = utilityColumns.slice(0, 3).map((item) => ({
    key: item.key,
    label: item.label,
    sourceKeys: [item.key],
    invoiced: Number(item?.invoiced || 0),
    paid: Number(item?.paid || 0),
    isGrouped: false,
    categoryType: item?.categoryType || 'utility',
  }));
  const overflow = utilityColumns.slice(3);
  visible.push({
    key: 'other_charges',
    label: 'Other Charges',
    sourceKeys: overflow.map((item) => item.key),
    invoiced: overflow.reduce((sum, item) => sum + Number(item?.invoiced || 0), 0),
    paid: overflow.reduce((sum, item) => sum + Number(item?.paid || 0), 0),
    isGrouped: true,
    categoryType: 'mixed',
  });
  return visible;
};

const getUtilityValue = (row = {}, key = "", phase = "invoiced") =>
  Number(normalizeRowUtilities(row)?.[key]?.[phase] || 0);

const getPreparedUtilityValue = (row = {}, key = "", phase = "invoiced") =>
  Number(row?.__utilityMap?.[key]?.[phase] || 0);


const buildPreparedStatementColumnMap = (row = {}, statementColumns = []) => {
  const utilityMap = row?.__utilityMap && typeof row.__utilityMap === 'object' ? row.__utilityMap : normalizeRowUtilities(row);
  if (row?.statementColumns && typeof row.statementColumns === 'object') {
    return row.statementColumns;
  }
  return (Array.isArray(statementColumns) ? statementColumns : []).reduce((acc, column) => {
    const sourceKeys = Array.isArray(column?.sourceKeys) && column.sourceKeys.length > 0 ? column.sourceKeys : [column?.key];
    acc[column.key] = sourceKeys.reduce(
      (totals, sourceKey) => {
        totals.invoiced += Number(utilityMap?.[sourceKey]?.invoiced || 0);
        totals.paid += Number(utilityMap?.[sourceKey]?.paid || 0);
        return totals;
      },
      { invoiced: 0, paid: 0 }
    );
    return acc;
  }, {});
};

const getPreparedStatementColumnValue = (row = {}, key = '', phase = 'invoiced') =>
  Number(row?.__statementColumnMap?.[key]?.[phase] || row?.statementColumns?.[key]?.[phase] || 0);

const PDF_MODAL_KEYFRAMES = `
  @keyframes mlkPdfIn  { from { opacity:0; transform:scale(0.97) } to { opacity:1; transform:scale(1) } }
  @keyframes mlkPdfOut { from { opacity:1; transform:scale(1)    } to { opacity:0; transform:scale(0.97) } }
`;

const PdfElapsedTimer = () => {
  const [secs, setSecs] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="text-[10px] text-white/25">{secs > 0 ? `${secs}s elapsed` : "Starting…"}</span>
  );
};

const paidCellDisplay = (val, isVacant, isNoBill) => {
  if (isVacant || isNoBill) return { text: "—", cls: "text-slate-300" };
  const n = Number(val || 0);
  return n > 0.005
    ? { text: currency(n), cls: "text-emerald-700 font-medium" }
    : { text: "—", cls: "text-slate-300" };
};

const SearchableSelect = ({ value, onChange, options, placeholder = "Select..." }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef(null);

  const selected = options.find((o) => o.value === value) || null;
  const filtered = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleSelect = (opt) => {
    onChange(opt.value);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={containerRef} className="relative">
      <div
        onClick={() => { setOpen((prev) => !prev); setQuery(""); }}
        className={`flex h-8 w-full cursor-pointer items-center justify-between rounded-md border px-2.5 shadow-sm transition-colors ${
          open
            ? "border-orange-500 bg-white ring-1 ring-orange-400"
            : "border-orange-400 bg-orange-50 hover:border-orange-500"
        }`}
      >
        {open ? (
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            placeholder={selected?.label || placeholder}
            className="w-full bg-transparent text-xs font-semibold text-slate-800 outline-none placeholder:font-normal placeholder:text-slate-400"
            autoFocus
          />
        ) : (
          <span className={`truncate text-xs font-semibold ${selected ? "text-slate-800" : "text-slate-400"}`}>
            {selected?.label || placeholder}
          </span>
        )}
        <svg
          className={`ml-1 h-3 w-3 flex-shrink-0 text-orange-500 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.8"
        >
          <path d="M1 1l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-0.5 max-h-56 overflow-y-auto rounded-md border border-orange-200 bg-white shadow-xl">
          {filtered.length === 0 ? (
            <div className="px-3 py-2.5 text-xs text-slate-400">No matches</div>
          ) : (
            filtered.map((opt) => (
              <div
                key={opt.value}
                onMouseDown={(e) => { e.preventDefault(); handleSelect(opt); }}
                className={`cursor-pointer px-3 py-2 text-xs transition-colors hover:bg-orange-50 ${
                  opt.value === value ? "bg-orange-100 font-bold text-orange-700" : "text-slate-700"
                }`}
              >
                {opt.label}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

const PdfPreviewModal = React.memo(function PdfPreviewModal({
  open, statementId, propertyLabel, periodStart, periodEnd, onClose,
}) {
  const [phase, setPhase]           = useState("idle"); // idle | loading | ready
  const [blobUrl, setBlobUrl]       = useState(null);
  const [filename, setFilename]     = useState("");
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [closing, setClosing]       = useState(false);
  const iframeRef = useRef(null);
  // Cache last-fetched PDF blob so re-opening the same statement is instant
  const blobCacheRef = useRef({ id: null, url: null, filename: null });

  // Cleanup cached blob URL on unmount
  useEffect(() => () => {
    if (blobCacheRef.current.url) window.URL.revokeObjectURL(blobCacheRef.current.url);
  }, []);

  // Fetch PDF whenever the modal opens (cache hit = instant, cache miss = fetch)
  useEffect(() => {
    if (!open || !statementId) return;

    // Cache hit — same statement already fetched
    if (blobCacheRef.current.id === statementId && blobCacheRef.current.url) {
      setBlobUrl(blobCacheRef.current.url);
      setFilename(blobCacheRef.current.filename);
      setPhase("ready");
      setIframeLoaded(false);
      return;
    }

    let cancelled = false;
    setPhase("loading");
    setIframeLoaded(false);
    adminRequests
      .get(`/statements/${statementId}/pdf`, { responseType: "blob" })
      .then(({ data }) => {
        if (cancelled) return;
        // Revoke previous cached blob if different statement
        if (blobCacheRef.current.url && blobCacheRef.current.id !== statementId) {
          window.URL.revokeObjectURL(blobCacheRef.current.url);
        }
        const url = window.URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
        const period = (periodStart || "").slice(0, 7);
        const fname = `Statement-${(propertyLabel || "Property").replace(/\s+/g, "_")}-${period}.pdf`;
        blobCacheRef.current = { id: statementId, url, filename: fname };
        setBlobUrl(url);
        setFilename(fname);
        setPhase("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(err?.response?.data?.message || "Failed to load statement PDF");
        onClose();
      });
    return () => { cancelled = true; };
  }, [open, statementId]); // eslint-disable-line

  // Reset visual state when modal closes (keep blob alive in ref for re-open)
  useEffect(() => {
    if (open) return;
    setBlobUrl(null);
    setFilename("");
    setPhase("idle");
    setIframeLoaded(false);
    setClosing(false);
  }, [open]);

  // ESC key + body scroll lock
  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, 190);
  }, [closing, onClose]);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") handleClose(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [open, handleClose]);

  const handlePrint    = useCallback(() => iframeRef.current?.contentWindow?.print(), []);
  const handleDownload = useCallback(() => {
    if (!blobUrl) return;
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [blobUrl, filename]);

  const periodLabel = useMemo(
    () =>
      periodStart && periodEnd
        ? `${new Date(periodStart).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })} – ${new Date(periodEnd).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}`
        : "",
    [periodStart, periodEnd]
  );

  if (!open && !closing) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col"
      style={{ animation: `${closing ? "mlkPdfOut" : "mlkPdfIn"} 0.2s cubic-bezier(0.16,1,0.3,1) both` }}
    >
      <style>{PDF_MODAL_KEYFRAMES}</style>

      {/* Backdrop — click to close */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={handleClose} aria-hidden="true" />

      {/* Panel */}
      <div className="relative z-10 flex h-full flex-col">

        {/* Toolbar */}
        <div className="flex flex-none items-center gap-3 bg-[#0B3B2E] px-5 py-3 shadow-xl">
          <div className="flex min-w-0 flex-col">
            <span className="text-xs font-black uppercase tracking-widest text-white">Landlord Statement</span>
            {(propertyLabel || periodLabel) && (
              <span className="truncate text-[10px] text-white/50">
                {propertyLabel}{periodLabel ? ` · ${periodLabel}` : ""}
              </span>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              disabled={!iframeLoaded}
              title="Print"
              className="inline-flex items-center gap-1.5 rounded-md border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white transition-all hover:bg-white/20 disabled:opacity-35"
            >
              <FaPrint size={11} /> Print
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={phase !== "ready"}
              title="Save PDF to device"
              className="inline-flex items-center gap-1.5 rounded-md border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white transition-all hover:bg-white/20 disabled:opacity-35"
            >
              <FaDownload size={11} /> Save PDF
            </button>
            <div className="mx-1 h-5 w-px bg-white/15" />
            <button
              type="button"
              onClick={handleClose}
              title="Close (Esc)"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-white/50 transition-all hover:bg-white/15 hover:text-white"
            >
              <FaTimes size={14} />
            </button>
          </div>
        </div>

        {/* PDF area */}
        <div className="relative min-h-0 flex-1 bg-slate-900 p-3">
          {(phase === "loading" || (blobUrl && !iframeLoaded)) && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-slate-900">
              {/* Double-ring Milik loader */}
              <div className="relative h-10 w-10">
                <div
                  className="absolute inset-0 animate-spin"
                  style={{ border: "3px solid rgba(255,255,255,0.08)", borderTopColor: "#4ade80", borderRightColor: "#86efac", animationDuration: "0.9s" }}
                />
                <div
                  className="absolute inset-[9px] animate-spin"
                  style={{ border: "2px solid rgba(255,255,255,0.08)", borderBottomColor: "#4ade80", borderLeftColor: "#86efac", animationDuration: "0.6s", animationDirection: "reverse" }}
                />
              </div>
              <div className="flex flex-col items-center gap-1">
                <p className="text-[11px] font-semibold text-white/50">
                  {phase === "loading" ? "Generating PDF…" : "Loading preview…"}
                </p>
                {phase === "loading" && <PdfElapsedTimer />}
              </div>
            </div>
          )}
          {blobUrl && (
            <iframe
              ref={iframeRef}
              src={blobUrl}
              title="Statement PDF Preview"
              onLoad={() => setIframeLoaded(true)}
              className={`h-full w-full rounded-lg border-0 shadow-2xl transition-opacity duration-500 ${iframeLoaded ? "opacity-100" : "opacity-0"}`}
            />
          )}
        </div>
      </div>
    </div>
  );
});

const _TODAY = new Date();
const _INITIAL_MONTH = String(_TODAY.getMonth() + 1);
const _INITIAL_YEAR = String(_TODAY.getFullYear());
const _INITIAL_PERIOD = { ...buildPeriod(Number(_INITIAL_MONTH), Number(_INITIAL_YEAR)), periodEnd: toIsoDate(_TODAY) };

const Statements = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();

  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const properties = useSelector(selectAllProperties);
  const { propertiesLoaded } = useEntityCache(currentCompany?._id);
  const landlords = useSelector(selectAllLandlords);
  const { canCreateStatement, canApproveStatement, canExportStatement } = useMemo(() => ({
    canCreateStatement: hasCompanyPermission(currentUser || {}, currentCompany, "statements", "create", "propertyManagement"),
    canApproveStatement: hasCompanyPermission(currentUser || {}, currentCompany, "statements", "approve", "propertyManagement"),
    canExportStatement: hasCompanyPermission(currentUser || {}, currentCompany, "statements", "export", "propertyManagement"),
  }), [currentUser, currentCompany]);

  const statementDraftKey = buildScopedDraftKey({
    page: "landlord-statement",
    companyId: currentCompany?._id,
    userId: currentUser?._id || currentUser?.id || currentUser?.email,
  });
  const [statementDraft, setStatementDraft, clearStatementDraft] = useScopedSessionDraft(statementDraftKey, {
    statementType: "provisional",
    selectedPropertyId: "",
    month: _INITIAL_MONTH,
    year: _INITIAL_YEAR,
    periodStart: _INITIAL_PERIOD.periodStart,
    periodEnd: _INITIAL_PERIOD.periodEnd,
    periodEndIsCustom: false,
    draftStatement: null,
    activeTab: "workspace",
    collapseAdditionalUnitRows: false,
  });
  const statementType = statementDraft.statementType || "provisional";
  const setStatementType = (value) => setStatementDraft((prev) => ({ ...prev, statementType: typeof value === "function" ? value(prev.statementType || "provisional") : value }));
  const selectedPropertyId = statementDraft.selectedPropertyId || "";
  const setSelectedPropertyId = (value) => setStatementDraft((prev) => ({ ...prev, selectedPropertyId: typeof value === "function" ? value(prev.selectedPropertyId || "") : value }));
  const month = statementDraft.month || _INITIAL_MONTH;
  const setMonth = (value) => setStatementDraft((prev) => ({ ...prev, month: typeof value === "function" ? value(prev.month || _INITIAL_MONTH) : value }));
  const year = statementDraft.year || _INITIAL_YEAR;
  const setYear = (value) => setStatementDraft((prev) => ({ ...prev, year: typeof value === "function" ? value(prev.year || _INITIAL_YEAR) : value }));
  const periodStart = statementDraft.periodStart || _INITIAL_PERIOD.periodStart;
  const setPeriodStart = (value) => setStatementDraft((prev) => ({ ...prev, periodStart: typeof value === "function" ? value(prev.periodStart || _INITIAL_PERIOD.periodStart) : value }));
  const periodEnd = statementDraft.periodEnd || _INITIAL_PERIOD.periodEnd;
  const setPeriodEnd = (value) => setStatementDraft((prev) => ({ ...prev, periodEnd: typeof value === "function" ? value(prev.periodEnd || _INITIAL_PERIOD.periodEnd) : value }));
  const periodEndIsCustom = Boolean(statementDraft.periodEndIsCustom);
  const setPeriodEndIsCustom = (value) => setStatementDraft((prev) => ({ ...prev, periodEndIsCustom: Boolean(value) }));
  const draftStatement = statementDraft.draftStatement || null;
  const setDraftStatement = (value) => setStatementDraft((prev) => ({ ...prev, draftStatement: typeof value === "function" ? value(prev.draftStatement || null) : value }));
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [processing, setProcessing] = useState(false);
  const activeTab = statementDraft.activeTab || "workspace";
  const setActiveTab = (value) => setStatementDraft((prev) => ({ ...prev, activeTab: typeof value === "function" ? value(prev.activeTab || "workspace") : value }));
  const collapseAdditionalUnitRows = Boolean(statementDraft.collapseAdditionalUnitRows);
  const setCollapseAdditionalUnitRows = (value) => setStatementDraft((prev) => ({ ...prev, collapseAdditionalUnitRows: typeof value === "function" ? value(Boolean(prev.collapseAdditionalUnitRows)) : Boolean(value) }));
  const [processedStatements, setProcessedStatements] = useState([]);
  const [loadingProcessedContext, setLoadingProcessedContext] = useState(false);
  const [processedContextLoaded, setProcessedContextLoaded] = useState(false);
  const [pdfPreviewOpen, setPdfPreviewOpen]   = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const handlePdfPreviewClose = useCallback(() => setPdfPreviewOpen(false), []);
  const [statementNotes, setStatementNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);

  const autoDraftTimerRef = useRef(null);
  const lastAutoLoadedSelectionRef = useRef("");
  const inFlightSelectionRef = useRef("");
  const pendingReopenContextRef = useRef(null);
  const draftAbortControllerRef = useRef(null);
  const processedAbortControllerRef = useRef(null);
  // Track last context that triggered a period-date reset so user edits to
  // periodEnd do not cause the effect to re-run and reset back to today.
  const lastResetContextRef = useRef("");
  const periodStartRef = useRef(periodStart);
  const periodEndRef = useRef(periodEnd);
  // Read periodEndIsCustom in the effect without adding it to deps (avoids circular)
  const periodEndIsCustomRef = useRef(periodEndIsCustom);
  const monthRef = useRef(month);
  const yearRef = useRef(year);
  // Keep refs in sync on every render (cheap, no extra effect)
  periodStartRef.current = periodStart;
  periodEndRef.current = periodEnd;
  periodEndIsCustomRef.current = periodEndIsCustom;
  monthRef.current = month;
  yearRef.current = year;

  const todayIso = useMemo(() => toIsoDate(new Date()), []);

  useEffect(() => {
    if (!currentCompany?._id) return;
    if (!propertiesLoaded) dispatch(getProperties({ business: currentCompany._id }));
    if (!landlords?.length) dispatch(getLandlords({ company: currentCompany._id }));
  }, [currentCompany?._id]);  // eslint-disable-line react-hooks/exhaustive-deps

  const selectedProperty = useMemo(
    () => properties.find((item) => normalizeId(item?._id) === normalizeId(selectedPropertyId)) || null,
    [properties, selectedPropertyId]
  );

  const landlordId = useMemo(() => {
    const landlordsOnProperty = Array.isArray(selectedProperty?.landlords) ? selectedProperty.landlords : [];
    const primary = landlordsOnProperty.find((item) => item?.isPrimary && item?.landlordId);
    const fallback = landlordsOnProperty.find((item) => item?.landlordId);
    return normalizeId(primary?.landlordId || fallback?.landlordId);
  }, [selectedProperty]);

  const landlord = useMemo(
    () => landlords.find((item) => normalizeId(item?._id) === landlordId) || null,
    [landlords, landlordId]
  );

  const currentSelectionKey = useMemo(
    () =>
      buildStatementSelectionKey({
        companyId: currentCompany?._id || "",
        propertyId: selectedPropertyId,
        landlordId,
        statementType,
        periodStart,
        periodEnd,
      }),
    [currentCompany?._id, landlordId, periodEnd, periodStart, selectedPropertyId, statementType]
  );

  const draftSelectionKey = useMemo(
    () =>
      draftStatement?._id
        ? buildStatementSelectionKey({
            companyId: currentCompany?._id || "",
            propertyId: draftStatement?.property,
            landlordId: draftStatement?.landlord,
            statementType: resolveStatementType(draftStatement, statementType),
            periodStart: draftStatement?.periodStart,
            periodEnd: draftStatement?.periodEnd,
          })
        : "",
    [
      currentCompany?._id,
      draftStatement?._id,
      draftStatement?.property,
      draftStatement?.landlord,
      draftStatement?.periodStart,
      draftStatement?.periodEnd,
      draftStatement?.metadata?.statementType,
      draftStatement?.metadata?.workspace?.statementType,
      statementType,
    ]
  );

  const latestProcessedStatement = useMemo(
    () =>
      (Array.isArray(processedStatements) ? processedStatements : []).find(
        (item) => String(item?.status || "") !== "reversed"
      ) || null,
    [processedStatements]
  );

  const latestProcessedCutoffAt = useMemo(
    () =>
      latestProcessedStatement?.cutoffAt ||
      latestProcessedStatement?.closedAt ||
      latestProcessedStatement?.periodEnd ||
      "",
    [latestProcessedStatement]
  );

  useEffect(() => {
    const reopenDraftContext = normalizeReopenDraftContext(location.state?.reopenDraftContext);
    if (!reopenDraftContext) return;

    const reopenStartDate = new Date(`${reopenDraftContext.periodStart}T00:00:00`);
    const nextMonth = !Number.isNaN(reopenStartDate.getTime())
      ? String(reopenStartDate.getMonth() + 1)
      : monthRef.current;
    const nextYear = !Number.isNaN(reopenStartDate.getTime())
      ? String(reopenStartDate.getFullYear())
      : yearRef.current;

    pendingReopenContextRef.current = reopenDraftContext;
    lastAutoLoadedSelectionRef.current = "";
    inFlightSelectionRef.current = "";
    setDraftStatement(null);
    setStatementType(reopenDraftContext.statementType || "provisional");
    setSelectedPropertyId(reopenDraftContext.propertyId);
    setMonth(nextMonth);
    setYear(nextYear);
    setPeriodStart(reopenDraftContext.periodStart);
    setPeriodEnd(reopenDraftContext.periodEnd);

    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    if (!currentCompany?._id || !selectedPropertyId) {
      setProcessedStatements([]);
      setProcessedContextLoaded(false);
      return;
    }

    // Cancel any in-flight processed-context request before starting a new one
    if (processedAbortControllerRef.current) {
      processedAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    processedAbortControllerRef.current = controller;

    setLoadingProcessedContext(true);
    setProcessedContextLoaded(false);

    adminRequests
      .get(`/processed-statements/business/${currentCompany._id}`, {
        signal: controller.signal,
        params: {
          property: selectedPropertyId,
          ...(landlordId ? { landlord: landlordId } : {}),
          limit: 3,
        },
      })
      .then((response) => {
        setProcessedStatements(Array.isArray(response?.data?.statements) ? response.data.statements : []);
      })
      .catch((err) => {
        if (err?.name === "CanceledError" || err?.name === "AbortError") return;
        setProcessedStatements([]);
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setLoadingProcessedContext(false);
        setProcessedContextLoaded(true);
      });

    return () => {
      controller.abort();
    };
  }, [currentCompany?._id, selectedPropertyId, landlordId]);

  useEffect(() => {
    const pendingReopenContext = pendingReopenContextRef.current;
    if (pendingReopenContext) {
      // Use refs so we read current values without adding periodStart/periodEnd to deps
      const matchesPendingSelection =
        normalizeId(selectedPropertyId) === normalizeId(pendingReopenContext.propertyId) &&
        resolveDayKey(periodStartRef.current) === resolveDayKey(pendingReopenContext.periodStart) &&
        resolveDayKey(periodEndRef.current) === resolveDayKey(pendingReopenContext.periodEnd);

      if (!processedContextLoaded || matchesPendingSelection) {
        setDraftStatement(null);
        return;
      }

      pendingReopenContextRef.current = null;
    }

    // Build a key from the things that should trigger a period-date reset.
    // Does NOT include periodEnd/periodStart — those are user-controlled values.
    // The key also does NOT change when only processedContextLoaded flips,
    // because the loaded flag is handled separately below.
    const contextKey = `${selectedPropertyId}|${month}|${year}|${latestProcessedCutoffAt || ""}`;
    const contextChanged = lastResetContextRef.current !== contextKey;
    if (!contextChanged && lastResetContextRef.current !== "") {
      // Only periodEnd/periodStart or processedContextLoaded changed — don't reset dates.
      // Still update periodStart when processedContext finishes loading (so the locked
      // start date reflects the actual last-statement cutoff).
      if (processedContextLoaded && selectedPropertyId) {
        setPeriodStart(
          getDefaultPeriodStart({
            month,
            year,
            latestProcessedCutoffAt,
            propertyDateAcquired: selectedProperty?.dateAcquired,
            todayIso,
          })
        );
      }
      return;
    }
    lastResetContextRef.current = contextKey;

    if (!selectedPropertyId) {
      // No property — clear everything including custom flag
      setPeriodEndIsCustom(false);
      const nextPeriod = buildPeriod(month, year);
      setPeriodStart(nextPeriod.periodStart);
      setPeriodEnd("");
      setDraftStatement(null);
      return;
    }

    if (!processedContextLoaded) {
      // Context is still loading — set period start from month/year only,
      // do not reset periodEnd (preserve custom date from session draft).
      setPeriodStart(buildPeriod(month, year).periodStart);
      setDraftStatement(null);
      return;
    }

    // Context changed and loaded — recalculate period start.
    // Only reset periodEnd to today if the user hasn't set a custom close date.
    setPeriodEndIsCustom(false);
    setPeriodStart(
      getDefaultPeriodStart({
        month,
        year,
        latestProcessedCutoffAt,
        propertyDateAcquired: selectedProperty?.dateAcquired,
        todayIso,
      })
    );
    setPeriodEnd(todayIso);
    setDraftStatement(null);
  }, [month, year, selectedPropertyId, processedContextLoaded, latestProcessedCutoffAt, selectedProperty?.dateAcquired, todayIso, periodStart, periodEnd]);

  const workspace = draftStatement?.metadata?.workspace || null;
  const summary = workspace?.summary || {};
  const rows = workspace?.rows || [];
  const depositMemo = workspace?.depositMemo || {};
  const depositMemoRows = Array.isArray(depositMemo?.rows) ? depositMemo.rows : [];
  const depositMemoTotals = depositMemo?.totals || {};
  const depositSettlement = workspace?.depositSettlement || {};
  const depositSettlementRows = Array.isArray(depositSettlement?.rows)
    ? depositSettlement.rows
    : [];
  const depositSettlementTotals = depositSettlement?.totals || {};
  const statementPeriodLabel = useMemo(
    () => buildStatementPeriodLabel(workspace, draftStatement || {}),
    [draftStatement?._id, draftStatement?.periodStart, draftStatement?.periodEnd, workspace]
  );
  const broughtForwardCreditApplications = workspace?.broughtForwardCreditApplications || {};
  const broughtForwardCreditApplicationRows = Array.isArray(broughtForwardCreditApplications?.rows)
    ? broughtForwardCreditApplications.rows
    : [];
  const broughtForwardCreditApplicationTotals = broughtForwardCreditApplications?.totals || {};
  const totals = workspace?.totals || {};
  const expenseRows = workspace?.expenseRows || workspace?.deductionRows || [];
  const additionRows = workspace?.additionRows || [];
  const directToLandlordRows = workspace?.directToLandlordRows || [];
  const advanceRecoveryRows = workspace?.advanceRecoveryRows || [];
  const earlyPayoutRows = workspace?.earlyPayoutRows || [];
  const settlement = useMemo(() => getStatementSettlement(summary), [summary]);
  const {
    basisCollectionsLabel,
    basisCollectionsAmount,
    additionsAmount,
    commissionAmount,
    commissionTaxAmount,
    invoiceVatPassThroughLabel,
    invoiceVatPassThroughAmount,
    totalInvoiceVatReceived,
    nonCommissionDeductions,
    directToLandlordAmount,
    openingLandlordSettlementBalance,
  } = useMemo(() => {
    const commission = Number(summary?.commissionAmount || 0);
    return {
      basisCollectionsLabel: summary?.basisCollectionsLabel || "Collections",
      basisCollectionsAmount: Number(summary?.basisCollections ?? summary?.managerCollections ?? summary?.totalCollections ?? 0),
      additionsAmount: Number(summary?.additions ?? summary?.totalAdditions ?? sumSectionAmounts(additionRows)),
      commissionAmount: commission,
      commissionTaxAmount: Number(summary?.commissionTaxAmount || 0),
      invoiceVatPassThroughLabel: summary?.invoiceVatPassThroughLabel || "Invoice VAT (pass-through)",
      invoiceVatPassThroughAmount: Number(summary?.invoiceVatPassThroughAmount ?? summary?.totalInvoiceVatInvoiced ?? 0),
      totalInvoiceVatReceived: Number(summary?.totalInvoiceVatReceived ?? totals?.paidTax ?? 0),
      nonCommissionDeductions: Number(summary?.nonCommissionDeductions ?? summary?.totalExpenses ?? Math.max(sumSectionAmounts(expenseRows) - commission, 0)),
      directToLandlordAmount: Number(summary?.directToLandlordCollections ?? summary?.directToLandlordOffsets ?? summary?.totalDirectToLandlordCollections ?? sumSectionAmounts(directToLandlordRows)),
      openingLandlordSettlementBalance: Number(summary?.openingLandlordSettlementBalance ?? summary?.openingSettlementBalance ?? 0),
    };
  }, [summary, totals, additionRows, expenseRows, directToLandlordRows]);
  const utilityColumns = useMemo(() => buildUtilityColumns(workspace, rows), [workspace, rows]);
  const statementColumns = useMemo(
    () => buildStatementColumns(workspace, utilityColumns),
    [workspace, utilityColumns]
  );
  const preparedRows = useMemo(
    () =>
      rows.map((row) => {
        const utilityMap = normalizeRowUtilities(row);
        const enriched = {
          ...row,
          __utilityMap: utilityMap,
          __statementColumnMap: buildPreparedStatementColumnMap({ ...row, __utilityMap: utilityMap }, statementColumns),
        };
        return { ...enriched, __paymentStatus: getRowPaymentStatus(enriched) };
      }),
    [rows, statementColumns]
  );

  const tenantUnitMeta = useMemo(() => {
    const meta = new Map();

    preparedRows.forEach((row) => {
      const tenantKey = String(row?.tenantId || "");
      if (!tenantKey) return;
      const current = meta.get(tenantKey) || {
        count: 0,
        unitLabels: [],
      };
      current.count += 1;
      if (row?.unit && !current.unitLabels.includes(String(row.unit))) {
        current.unitLabels.push(String(row.unit));
      }
      meta.set(tenantKey, current);
    });

    return meta;
  }, [preparedRows]);

  const statementDisplayRows = useMemo(() => {
    if (!collapseAdditionalUnitRows) {
      return preparedRows.map((row) => {
        const tenantMeta = tenantUnitMeta.get(String(row?.tenantId || "")) || null;
        return {
          ...row,
          multiUnitCount: Number(tenantMeta?.count || 1),
          displayUnitLabel: row.unit,
          allUnitLabels: tenantMeta?.unitLabels || [row.unit].filter(Boolean),
        };
      });
    }

    const grouped = new Map();

    preparedRows.forEach((row) => {
      const tenantKey = String(row?.tenantId || "");
      if (!tenantKey) {
        const uniqueKey = `vacant:${row?.unitId || row?.unit || Math.random()}`;
        grouped.set(uniqueKey, {
          ...row,
          multiUnitCount: 1,
          displayUnitLabel: row.unit,
          allUnitLabels: [row.unit].filter(Boolean),
        });
        return;
      }

      const existing = grouped.get(tenantKey);
      if (!existing) {
        grouped.set(tenantKey, {
          ...row,
          multiUnitCount: 1,
          allUnitLabels: [row.unit].filter(Boolean),
          displayUnitLabel: row.unit,
          __utilityMap: { ...(row.__utilityMap || {}) },
        });
        return;
      }

      existing.multiUnitCount += 1;
      if (row?.unit && !existing.allUnitLabels.includes(String(row.unit))) {
        existing.allUnitLabels.push(String(row.unit));
      }

      [
        "openingBalance",
        "balanceBF",
        "invoicedRent",
        "invoicedTax",
        "paidRent",
        "paidTax",
        "totalPaid",
        "closingBalance",
        "balanceCF",
        "balance",
      ].forEach((field) => {
        existing[field] = Number(existing[field] || 0) + Number(row[field] || 0);
      });

      const utilityMap = existing.__utilityMap;
      Object.entries(row.__utilityMap || {}).forEach(([utilityKey, utilityPhases]) => {
        const curr = utilityMap[utilityKey];
        if (curr) {
          curr.invoiced += Number(utilityPhases?.invoiced || 0);
          curr.paid += Number(utilityPhases?.paid || 0);
          if (!curr.label) curr.label = utilityPhases?.label || utilityKey;
        } else {
          utilityMap[utilityKey] = {
            invoiced: Number(utilityPhases?.invoiced || 0),
            paid: Number(utilityPhases?.paid || 0),
            label: utilityPhases?.label || utilityKey,
          };
        }
      });
    });

    return Array.from(grouped.values())
      .map((row) => ({
        ...row,
        __statementColumnMap: buildPreparedStatementColumnMap(row, statementColumns),
        displayUnitLabel:
          row.allUnitLabels.length > 1
            ? `${row.allUnitLabels[0]} + ${row.allUnitLabels.length - 1} more`
            : row.allUnitLabels[0] || row.unit,
      }))
      .sort((a, b) =>
        String(a.displayUnitLabel || a.unit || "").localeCompare(
          String(b.displayUnitLabel || b.unit || ""),
          undefined,
          { numeric: true }
        )
      );
  }, [collapseAdditionalUnitRows, preparedRows, statementColumns, tenantUnitMeta]);
  const [rowFilter, setRowFilter] = useTabState(`${location.pathname}:rowFilter`, "all");
  const [kpiExpanded, setKpiExpanded] = useTabState(`${location.pathname}:kpiExpanded`, false);

  const collectionStats = useMemo(() => {
    if (!draftStatement || !preparedRows.length) return null;
    const totalInvoiced = Number(totals.invoicedRent || 0) +
      statementColumns.reduce((s, c) => s + Number(c.invoiced || 0), 0);
    const totalCollected = Number(totals.paidRent || 0) +
      statementColumns.reduce((s, c) => s + Number(c.paid || 0), 0);
    const rate = totalInvoiced > 0 ? Math.round((totalCollected / totalInvoiced) * 100) : null;
    let paidCount = 0, partialCount = 0, unpaidCount = 0, nobillCount = 0, vacantCount = 0;
    preparedRows.forEach((row) => {
      const s = row.__paymentStatus;
      if (s === "paid") paidCount++;
      else if (s === "partial") partialCount++;
      else if (s === "unpaid") unpaidCount++;
      else if (s === "nobill") nobillCount++;
      else vacantCount++;
    });
    return { totalInvoiced, totalCollected, rate, paid: paidCount, partial: partialCount, unpaid: unpaidCount, nobill: nobillCount, vacant: vacantCount, occupied: paidCount + partialCount + unpaidCount + nobillCount };
  }, [draftStatement, totals, statementColumns, preparedRows]);

  const filteredTableRows = useMemo(() => {
    if (rowFilter === "all") return statementDisplayRows;
    return statementDisplayRows.filter((r) => r.__paymentStatus === rowFilter);
  }, [statementDisplayRows, rowFilter]);

  const nonDepositAdditionRows = useMemo(
    () => additionRows.filter((item) => String(item?.category || "") !== "deposit_remittance"),
    [additionRows]
  );
  const nonDepositExpenseRows = useMemo(
    () => expenseRows.filter((item) => String(item?.category || "") !== "deposit_direct_offset"),
    [expenseRows]
  );
  const depositSettlementAdditionRows = useMemo(
    () =>
      depositSettlementRows.filter(
        (item) => String(item?.effect || "").toLowerCase() === "addition"
      ),
    [depositSettlementRows]
  );
  const depositSettlementOffsetRows = useMemo(
    () =>
      depositSettlementRows.filter(
        (item) => String(item?.effect || "").toLowerCase() === "offset"
      ),
    [depositSettlementRows]
  );
  const hasWorkspaceDetailSections =
    nonDepositExpenseRows.length > 0 ||
    nonDepositAdditionRows.length > 0 ||
    directToLandlordRows.length > 0 ||
    depositSettlementRows.length > 0 ||
    depositMemoRows.length > 0 ||
    broughtForwardCreditApplicationRows.length > 0 ||
    advanceRecoveryRows.length > 0 ||
    earlyPayoutRows.length > 0;
  const hasInvoiceVatColumn = useMemo(
    () =>
      Number(summary?.totalInvoiceVatInvoiced || 0) > 0 ||
      Number(summary?.totalInvoiceVatReceived || 0) > 0 ||
      preparedRows.some(
        (row) => Number(row?.invoicedTax || 0) > 0 || Number(row?.paidTax || 0) > 0
      ),
    [preparedRows, summary]
  );
  const statementColSpan = 7 + (hasInvoiceVatColumn ? 2 : 0) + statementColumns.length * 2;
  const hasFuturePeriodDate =
    isFutureIsoDate(periodStart, todayIso) || isFutureIsoDate(periodEnd, todayIso);
  const hasValidPeriodSelection =
    Boolean(periodStart) &&
    Boolean(periodEnd) &&
    !hasFuturePeriodDate &&
    new Date(periodStart) <= new Date(periodEnd);

  const loadDraftWorkspace = async (options = {}) => {
    const requestedSelectionKey =
      options.selectionKey ||
      buildStatementSelectionKey({
        companyId: currentCompany?._id || "",
        propertyId: selectedPropertyId,
        landlordId,
        statementType,
        periodStart,
        periodEnd,
      });

    if (!currentCompany?._id || !selectedPropertyId) {
      setDraftStatement(null);
      return;
    }

    if (!periodStart || !periodEnd) {
      setDraftStatement(null);
      return;
    }

    if (hasFuturePeriodDate) {
      toast.error("Statement dates cannot be in the future");
      setDraftStatement(null);
      return;
    }

    if (new Date(periodStart) > new Date(periodEnd)) {
      toast.error("Select a valid statement period");
      setDraftStatement(null);
      return;
    }

    // Cancel any previous in-flight draft generation
    if (draftAbortControllerRef.current) {
      draftAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    draftAbortControllerRef.current = controller;

    setLoadingDraft(true);
    try {
      const result = await dispatch(
        createDraftStatement({
          propertyId: selectedPropertyId,
          landlordId: landlordId || undefined,
          periodStart,
          periodEnd,
          statementType,
          notes: statementNotes || undefined,
          refresh: options.refresh !== false,
          _signal: controller.signal,
        })
      );

      if (controller.signal.aborted) return;

      // Backend now returns { statement, lines } in one call — no second getStatement needed.
      const nextStatement = result?.statement || null;

      const nextPeriodStart = nextStatement?.periodStart ? toIsoDate(nextStatement.periodStart) : periodStart;
      const nextPeriodEnd = nextStatement?.periodEnd ? toIsoDate(nextStatement.periodEnd) : periodEnd;
      const nextSelectionKey = buildStatementSelectionKey({
        companyId: currentCompany?._id || "",
        propertyId: nextStatement?.property || selectedPropertyId,
        landlordId: nextStatement?.landlord || landlordId,
        statementType: resolveStatementType(nextStatement, statementType),
        periodStart: nextPeriodStart,
        periodEnd: nextPeriodEnd,
      });

      lastAutoLoadedSelectionRef.current = nextSelectionKey || requestedSelectionKey;

      if (nextStatement?.periodStart && nextPeriodStart !== periodStart) {
        setPeriodStart(nextPeriodStart);
      }
      if (nextStatement?.periodEnd && nextPeriodEnd !== periodEnd) {
        setPeriodEnd(nextPeriodEnd);
      }

      pendingReopenContextRef.current = null;
      setDraftStatement(nextStatement);
      setStatementNotes(nextStatement?.notes || "");
    } catch (error) {
      if (error?.name === "CanceledError" || error?.name === "AbortError") return;
      lastAutoLoadedSelectionRef.current = requestedSelectionKey;
      pendingReopenContextRef.current = null;
      toast.error(error?.response?.data?.message || "Failed to load landlord statement workspace");
      setDraftStatement(null);
    } finally {
      if (controller.signal.aborted) return;
      if (inFlightSelectionRef.current === requestedSelectionKey) {
        inFlightSelectionRef.current = "";
      }
      setLoadingDraft(false);
    }
  };

  useEffect(() => {
    if (!selectedPropertyId || !processedContextLoaded || !hasValidPeriodSelection) {
      setDraftStatement(null);
      lastAutoLoadedSelectionRef.current = "";
      inFlightSelectionRef.current = "";
      if (autoDraftTimerRef.current) {
        window.clearTimeout(autoDraftTimerRef.current);
        autoDraftTimerRef.current = null;
      }
      return;
    }

    if (
      draftStatement?._id &&
      draftSelectionKey &&
      currentSelectionKey &&
      draftSelectionKey !== currentSelectionKey &&
      !loadingDraft
    ) {
      setDraftStatement(null);
    }
  }, [
    currentSelectionKey,
    draftSelectionKey,
    draftStatement?._id,
    hasValidPeriodSelection,
    loadingDraft,
    processedContextLoaded,
    selectedPropertyId,
  ]);

  useEffect(() => {
    if (!selectedPropertyId || !processedContextLoaded || !hasValidPeriodSelection || loadingDraft) {
      if (autoDraftTimerRef.current) {
        window.clearTimeout(autoDraftTimerRef.current);
        autoDraftTimerRef.current = null;
      }
      return undefined;
    }

    if (!currentSelectionKey) {
      return undefined;
    }

    if (draftStatement?._id && draftSelectionKey === currentSelectionKey) {
      return undefined;
    }

    if (
      inFlightSelectionRef.current === currentSelectionKey ||
      lastAutoLoadedSelectionRef.current === currentSelectionKey
    ) {
      return undefined;
    }

    if (autoDraftTimerRef.current) {
      window.clearTimeout(autoDraftTimerRef.current);
    }

    autoDraftTimerRef.current = window.setTimeout(async () => {
      inFlightSelectionRef.current = currentSelectionKey;
      await loadDraftWorkspace({ selectionKey: currentSelectionKey });
    }, 450);

    return () => {
      if (autoDraftTimerRef.current) {
        window.clearTimeout(autoDraftTimerRef.current);
        autoDraftTimerRef.current = null;
      }
    };
  }, [
    currentSelectionKey,
    draftSelectionKey,
    draftStatement?._id,
    hasValidPeriodSelection,
    loadingDraft,
    processedContextLoaded,
    selectedPropertyId,
  ]);

  const handleApprove = async () => {
    if (!canApproveStatement) {
      toast.warning("You do not have permission to approve landlord statements");
      return;
    }
    if (!draftStatement?._id) return;
    try {
      await dispatch(approveStatement(draftStatement._id, "Approved from landlord statement workspace"));
      const full = await dispatch(getStatement(draftStatement._id));
      const approvedStatement = full?.statement || null;
      setDraftStatement(approvedStatement);
      setStatementNotes(approvedStatement?.notes || "");
      toast.success("Statement approved successfully");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to approve statement");
    }
  };

  const handleSaveNotes = async () => {
    if (!draftStatement?._id) return;
    setSavingNotes(true);
    try {
      await adminRequests.patch(`/statements/${draftStatement._id}/notes`, { notes: statementNotes });
      setDraftStatement((prev) => prev ? { ...prev, notes: statementNotes } : prev);
      toast.success("Notes saved");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to save notes");
    } finally {
      setSavingNotes(false);
    }
  };

  const handleRegenerateDraft = async () => {
    if (!canCreateStatement) {
      toast.warning("You do not have permission to generate landlord statements");
      return;
    }
    if (!selectedPropertyId || !hasValidPeriodSelection) {
      toast.error("Select a valid statement period first");
      return;
    }
    try {
      await loadDraftWorkspace({ refresh: true });
      toast.success("Draft regenerated successfully");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to regenerate draft");
    }
  };

  const handlePreviewPdf = () => {
    if (!canExportStatement) {
      toast.warning("You do not have permission to view landlord statements");
      return;
    }
    if (draftStatement?._id) setPdfPreviewOpen(true);
  };

  const handleDownloadPdf = async () => {
    if (!canExportStatement) {
      toast.warning("You do not have permission to download landlord statements");
      return;
    }
    if (!draftStatement?._id || downloadingPdf) return;
    setDownloadingPdf(true);
    try {
      const { data } = await adminRequests.get(`/statements/${draftStatement._id}/pdf`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
      const propName = selectedProperty?.propertyName || selectedProperty?.name || "Property";
      const period = periodStart ? periodStart.slice(0, 7) : "";
      const a = document.createElement("a");
      a.href = url;
      a.download = `Statement-${propName.replace(/\s+/g, "_")}-${period}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to download statement PDF");
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleProcessStatement = async () => {
    if (!canApproveStatement) {
      toast.warning("You do not have permission to process landlord statements");
      return;
    }
    if (!draftStatement?._id || !selectedPropertyId) {
      toast.error("Generate a draft statement first");
      return;
    }

    if (!hasValidPeriodSelection) {
      toast.error("Select a valid statement period first");
      return;
    }

    setProcessing(true);
    try {
      await adminRequests.post("/processed-statements", {
        statementId: draftStatement._id,
        propertyId: selectedPropertyId,
        businessId: currentCompany?._id,
        periodStart,
        periodEnd,
      });
      toast.success("Statement processed successfully");
      clearStatementDraft();
      navigate("/landlord/processed-statements");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to process statement");
    } finally {
      setProcessing(false);
    }
  };

  const propertyOptions = useMemo(() => properties.map((p) => ({ value: p._id, label: getPropertyLabel(p) })), [properties]);

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-100">

        {/* ── TOP CONTROLS ─────────────────────────────────────────────── */}
        <div className="flex-shrink-0 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.08)]">
          <div className="h-0.5 bg-gradient-to-r from-[#0B3B2E] via-[#1a6b4e] to-[#0B3B2E]" />

          {/* Filter grid */}
          <div className="grid grid-cols-2 items-start gap-x-2 gap-y-1 px-3 py-1.5 sm:grid-cols-3 xl:grid-cols-7">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Statement Type</label>
              <SearchableSelect
                value={statementType}
                onChange={setStatementType}
                options={[
                  { value: "provisional", label: "Provisional" },
                  { value: "final", label: "Final" },
                ]}
                placeholder="Select type"
              />
            </div>

            <div className="col-span-2 xl:col-span-1">
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Property</label>
              <SearchableSelect
                value={selectedPropertyId}
                onChange={setSelectedPropertyId}
                options={propertyOptions}
                placeholder="Select property"
              />
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Month</label>
              <SearchableSelect
                value={month}
                onChange={setMonth}
                options={MONTH_SELECT_OPTIONS}
                placeholder="Select month"
              />
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Year</label>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="h-7 w-full rounded-md border border-orange-400 bg-orange-50 px-2 text-[11px] font-semibold text-slate-800 shadow-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/20"
              />
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Period Start
              </label>
              {latestProcessedCutoffAt ? (
                // Locked — must continue from the day after the last statement closed
                <div className="flex h-7 w-full items-center gap-1.5 rounded-md border border-slate-300 bg-slate-100 px-2 text-[11px] font-semibold text-slate-500">
                  <span className="truncate">{periodStart || "—"}</span>
                  <span className="ml-auto shrink-0 rounded bg-slate-200 px-1 py-0.5 text-[9px] font-bold uppercase text-slate-500">locked</span>
                </div>
              ) : (
                // First statement — freely editable
                <input
                  type="date"
                  value={periodStart}
                  max={todayIso}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  title="First statement — pick a start date"
                  className="h-7 w-full rounded-md border border-orange-400 bg-orange-50 px-2 text-[11px] font-semibold text-slate-800 shadow-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/20"
                />
              )}
            </div>

            <div>
              <label className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Period End
                {periodEnd && periodEnd !== todayIso && (
                  <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold text-amber-700 normal-case tracking-normal">
                    Custom
                  </span>
                )}
              </label>
              <input
                type="date"
                value={periodEnd}
                min={periodStart || undefined}
                max={todayIso}
                onChange={(e) => {
                  const v = e.target.value;
                  setPeriodEnd(v);
                  setPeriodEndIsCustom(v !== todayIso && v !== "");
                }}
                className="h-7 w-full rounded-md border border-orange-400 bg-orange-50 px-2 text-[11px] font-semibold text-slate-800 shadow-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/20"
                title="Defaults to today — change to close the period earlier"
              />
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-transparent select-none">·</label>
              <button
                type="button"
                onClick={() => loadDraftWorkspace({ refresh: true })}
                disabled={!canCreateStatement || !selectedPropertyId || loadingDraft || loadingProcessedContext || !hasValidPeriodSelection}
                className="inline-flex h-7 w-full items-center justify-center gap-1.5 rounded-lg bg-[#0B3B2E] px-4 text-[11px] font-bold text-white shadow-sm transition-colors hover:bg-[#0a3228] disabled:cursor-not-allowed disabled:opacity-55"
              >
                <FaSyncAlt className={loadingDraft ? "animate-spin" : ""} size={11} />
                {loadingDraft ? "Loading…" : loadingProcessedContext ? "Checking…" : "Generate"}
              </button>
            </div>
          </div>

          {/* Tabs + action buttons */}
          <div className="flex items-center justify-between border-t border-slate-100 px-3">
            <div className="flex items-center">
              {[
                { id: "workspace", label: "Workspace" },
                { id: "summary", label: "Summary" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative px-3 py-1.5 text-[11px] font-bold transition-colors ${
                    activeTab === tab.id ? "text-[#0B3B2E]" : "text-slate-400 hover:text-slate-600"
                  }`}
                >
                  {tab.label}
                  {activeTab === tab.id && (
                    <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-t-full bg-[#0B3B2E]" />
                  )}
                </button>
              ))}
              {draftStatement?.status && (
                <span className={`ml-2 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                  draftStatement.status === "approved" ? "bg-emerald-100 text-emerald-700" :
                  draftStatement.status === "sent"     ? "bg-sky-100 text-sky-700" :
                  "bg-amber-100 text-amber-700"
                }`}>
                  {draftStatement.status}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1 py-1">
              {/* Tertiary: Regenerate */}
              <button
                type="button"
                onClick={handleRegenerateDraft}
                disabled={!canCreateStatement || !selectedPropertyId || loadingDraft || loadingProcessedContext || !hasValidPeriodSelection}
                title="Regenerate draft from current ledger data"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-200 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-35"
              >
                <FaSyncAlt size={10} className={loadingDraft ? "animate-spin" : ""} />
              </button>

              {/* Print → opens preview modal */}
              <button
                type="button"
                onClick={handlePreviewPdf}
                disabled={!canExportStatement || !draftStatement?._id || pdfPreviewOpen}
                title="Preview & print statement"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-[#0B3B2E] disabled:opacity-35"
              >
                <FaPrint size={10} />
              </button>
              {/* Download → saves PDF directly, no modal */}
              <button
                type="button"
                onClick={handleDownloadPdf}
                disabled={!canExportStatement || !draftStatement?._id || downloadingPdf}
                title="Download PDF to device"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-[#0B3B2E] disabled:opacity-35"
              >
                <FaDownload size={10} className={downloadingPdf ? "animate-bounce" : ""} />
              </button>

              <div className="mx-1 h-5 w-px bg-slate-200" />

              {/* Secondary: Approve */}
              <button
                type="button"
                onClick={handleApprove}
                disabled={!canApproveStatement || !draftStatement?._id || draftStatement?.status === "approved"}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 text-[11px] font-bold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-35"
              >
                <FaCheckCircle size={9} />
                {draftStatement?.status === "approved" ? "Approved ✓" : "Approve"}
              </button>

              {/* Primary: Process */}
              <button
                type="button"
                onClick={handleProcessStatement}
                disabled={!canApproveStatement || !draftStatement?._id || processing || !hasValidPeriodSelection || draftStatement?.status !== "approved"}
                title={
                  !draftStatement?._id ? "Generate a draft first" :
                  draftStatement?.status !== "approved" ? "Approve the statement first to enable processing" :
                  !canApproveStatement ? "You do not have permission to process statements" :
                  "Finalise and post this statement to the landlord account"
                }
                className="inline-flex h-7 items-center gap-1.5 rounded-md bg-[#0B3B2E] px-4 text-[11px] font-bold text-white shadow-sm transition-colors hover:bg-[#0a3228] disabled:cursor-not-allowed disabled:opacity-35"
              >
                <FaFileAlt size={9} />
                {processing ? "Processing…" : "Process"}
              </button>
            </div>
          </div>
        </div>

        {/* ── MAIN CONTENT ─────────────────────────────────────────────── */}
        {!selectedPropertyId ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0B3B2E]/10">
              <FaFileAlt className="text-[#0B3B2E]" size={22} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-700">Select a Property</p>
              <p className="mt-1 max-w-xs text-xs text-slate-400">Choose a property from the filter above to load the landlord statement workspace.</p>
            </div>
          </div>
        ) : !draftStatement ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${loadingDraft ? "bg-[#0B3B2E]/10" : "bg-slate-200/60"}`}>
              <FaSyncAlt className={`${loadingDraft ? "animate-spin text-[#0B3B2E]" : "text-slate-400"}`} size={22} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-700">{loadingDraft ? "Building Statement…" : "No Statement Loaded"}</p>
              <p className="mt-1 max-w-xs text-xs text-slate-400">{loadingDraft ? "Compiling workspace from ledger data…" : "Click Generate to load the statement for this period."}</p>
            </div>
          </div>
        ) : (
          <>
            {activeTab === "summary" ? (

              /* ══════════ SUMMARY TAB ══════════ */
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {/* Header banner */}
                <div className="flex-shrink-0 bg-[#0B3B2E] px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-green-200/50">Landlord Statement · Summary</p>
                      <h3 className="mt-1 text-sm font-bold text-white">
                        {selectedProperty ? getPropertyLabel(selectedProperty) : "Statement Summary"}
                      </h3>
                      {landlord && (
                        <p className="mt-0.5 text-xs text-green-100/60">{landlord.name || landlord.fullName || ""}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-right">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-green-200/50">Period</p>
                        <p className="mt-0.5 text-xs font-bold text-white">{statementPeriodLabel}</p>
                      </div>
                      <div className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-right">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-green-200/50">Type</p>
                        <p className="mt-0.5 text-xs font-bold capitalize text-white">{statementType}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* KPI strip */}
                <div className="flex-shrink-0 grid grid-cols-2 divide-x divide-slate-100 border-b border-slate-200 bg-white md:grid-cols-5">
                  <div className="px-5 py-4">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Opening Balance</p>
                    <p className="mt-1.5 text-base font-bold text-slate-900">{currency(summary.openingBalance)}</p>
                  </div>
                  <div className="px-5 py-4">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Closing Balance</p>
                    <p className="mt-1.5 text-base font-bold text-slate-900">{currency(summary.closingBalance)}</p>
                  </div>
                  <div className="px-5 py-4">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Occupied Units</p>
                    <p className="mt-1.5 text-base font-bold text-slate-900">{Number(summary.occupiedUnits || 0)}</p>
                  </div>
                  <div className="px-5 py-4">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-amber-500">Unapplied Credits</p>
                    <p className="mt-1.5 text-base font-bold text-amber-700">{currency(summary.unappliedPayments || 0)}</p>
                  </div>
                  <div className={`px-5 py-4 ${settlement.isNegative ? "bg-red-50" : "bg-[#0B3B2E]"}`}>
                    <p className={`text-[9px] font-bold uppercase tracking-widest ${settlement.isNegative ? "text-red-500" : "text-green-200/60"}`}>
                      {settlement.label}
                    </p>
                    <p className={`mt-1.5 text-base font-bold ${settlement.isNegative ? "text-red-700" : "text-white"}`}>
                      {currency(settlement.amount)}
                    </p>
                  </div>
                </div>

                {/* Scrollable breakdown */}
                <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50">
                  {Number(summary.unappliedPayments || 0) > 0 && (
                    <div className="px-5 pt-4">
                      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                        <div className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-amber-400" />
                        <p className="text-xs text-amber-800">
                          Unapplied tenant credits are carried separately from allocated rent and utility receipts. They reduce the tenant net position but do not count as paid until allocated to actual bills.
                        </p>
                      </div>
                    </div>
                  )}
                  <div className="p-5">
                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                      <div className="border-b border-slate-100 bg-slate-50 px-5 py-2.5">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Settlement Breakdown</p>
                      </div>
                      <table className="min-w-full divide-y divide-slate-100 text-sm">
                        <tbody className="divide-y divide-slate-100 bg-white">
                          <tr className="transition-colors hover:bg-slate-50/60">
                            <td className="px-5 py-3 font-medium text-slate-700">Opening landlord settlement B/F</td>
                            <td className={`px-5 py-3 text-right font-semibold ${openingLandlordSettlementBalance < 0 ? "text-red-600" : "text-slate-900"}`}>
                              {currency(openingLandlordSettlementBalance)}
                            </td>
                          </tr>
                          <tr className="transition-colors hover:bg-slate-50/60">
                            <td className="px-5 py-3 font-medium text-slate-700">{basisCollectionsLabel}</td>
                            <td className="px-5 py-3 text-right font-semibold text-slate-900">{currency(basisCollectionsAmount)}</td>
                          </tr>
                          {Number(summary?.utilityPassThroughAmount || 0) > 0 && (
                            <tr className="transition-colors hover:bg-slate-50/60">
                              <td className="px-5 py-3 font-medium text-slate-700">{summary?.utilityPassThroughLabel || "Utilities (added as billed)"}</td>
                              <td className="px-5 py-3 text-right font-semibold text-slate-900">{currency(summary?.utilityPassThroughAmount || 0)}</td>
                            </tr>
                          )}
                          {invoiceVatPassThroughAmount > 0 && (
                            <tr className="transition-colors hover:bg-slate-50/60">
                              <td className="px-5 py-3 font-medium text-slate-700">{invoiceVatPassThroughLabel}</td>
                              <td className="px-5 py-3 text-right font-semibold text-slate-900">{currency(invoiceVatPassThroughAmount)}</td>
                            </tr>
                          )}
                          <tr className="transition-colors hover:bg-slate-50/60">
                            <td className="px-5 py-3 font-medium text-slate-700">Additions</td>
                            <td className="px-5 py-3 text-right font-semibold text-slate-900">{currency(additionsAmount)}</td>
                          </tr>
                          <tr className="transition-colors hover:bg-slate-50/60">
                            <td className="px-5 py-3 font-medium text-slate-700">Expenses &amp; other deductions</td>
                            <td className="px-5 py-3 text-right font-semibold text-slate-900">{currency(nonCommissionDeductions)}</td>
                          </tr>
                          <tr className="transition-colors hover:bg-slate-50/60">
                            <td className="px-5 py-3 font-medium text-slate-700">Commission</td>
                            <td className="px-5 py-3 text-right font-semibold text-slate-900">{currency(commissionAmount)}</td>
                          </tr>
                          {commissionTaxAmount > 0 && (
                            <tr className="transition-colors hover:bg-slate-50/60">
                              <td className="px-5 py-3 font-medium text-slate-700">VAT on commission</td>
                              <td className="px-5 py-3 text-right font-semibold text-slate-900">{currency(commissionTaxAmount)}</td>
                            </tr>
                          )}
                          <tr className="transition-colors hover:bg-slate-50/60">
                            <td className="px-5 py-3 font-medium text-slate-700">Direct to landlord collections</td>
                            <td className="px-5 py-3 text-right font-semibold text-slate-900">{currency(directToLandlordAmount)}</td>
                          </tr>
                          {Number(summary?.totalEarlyPayouts || 0) > 0 && (
                            <tr className="transition-colors hover:bg-slate-50/60">
                              <td className="px-5 py-3 font-medium text-slate-700">Early payout already paid to landlord</td>
                              <td className="px-5 py-3 text-right font-semibold text-amber-700">({currency(Number(summary?.totalEarlyPayouts || 0))})</td>
                            </tr>
                          )}
                          {Number(summary?.totalAdvanceRecoveries || 0) > 0 && (
                            <tr className="transition-colors hover:bg-slate-50/60">
                              <td className="px-5 py-3 font-medium text-slate-700">Advance recovery deduction</td>
                              <td className="px-5 py-3 text-right font-semibold text-red-600">({currency(Number(summary?.totalAdvanceRecoveries || 0))})</td>
                            </tr>
                          )}
                          <tr className={settlement.isNegative ? "bg-red-50" : "bg-[#0B3B2E]"}>
                            <td className={`px-5 py-4 text-sm font-bold ${settlement.isNegative ? "text-red-700" : "text-white"}`}>{settlement.label}</td>
                            <td className={`px-5 py-4 text-right text-sm font-bold ${settlement.isNegative ? "text-red-700" : "text-white"}`}>{currency(settlement.amount)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>

            ) : (

              /* ══════════ WORKSPACE TAB ══════════ */
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">

                {/* ── Compact workspace info bar ── */}
                <div className="flex-shrink-0 bg-[#0B3B2E] px-4 py-2">
                  <div className="flex items-center gap-3">

                    {/* Left: property name · landlord · period badge */}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-[11px] font-bold text-white">
                          {selectedProperty ? getPropertyLabel(selectedProperty) : "Statement Workspace"}
                        </span>
                        {landlord && (
                          <span className="text-[10px] text-green-200/55 truncate">
                            · {landlord.name || landlord.fullName || ""}
                          </span>
                        )}
                        <span className="rounded border border-white/20 bg-white/10 px-1.5 py-0.5 text-[9px] font-bold text-green-100/80">
                          {statementPeriodLabel}
                        </span>
                      </div>

                      {/* Mini collection bar + inline stats */}
                      {collectionStats && collectionStats.rate !== null && (
                        <div className="mt-1 flex items-center gap-2">
                          <div className="relative h-1.5 w-20 flex-shrink-0 overflow-hidden rounded-full bg-white/15">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                collectionStats.rate >= 80 ? "bg-emerald-400" :
                                collectionStats.rate >= 50 ? "bg-amber-400" : "bg-red-400/80"
                              }`}
                              style={{ width: `${Math.max(0.5, Math.min(100, collectionStats.rate))}%` }}
                            />
                          </div>
                          <span className={`text-[10px] font-bold tabular-nums ${
                            collectionStats.rate >= 80 ? "text-emerald-300" :
                            collectionStats.rate >= 50 ? "text-amber-300" : "text-red-300"
                          }`}>
                            {collectionStats.rate}%
                          </span>
                          <span className="text-[9px] text-green-200/50">
                            {collectionStats.occupied} occ
                            {collectionStats.vacant > 0 && ` · ${collectionStats.vacant} vac`}{collectionStats.nobill > 0 && ` · ${collectionStats.nobill} no bill`}
                            {collectionStats.unpaid > 0 && (
                              <span className="text-red-300/80"> · {collectionStats.unpaid} unpaid</span>
                            )}
                          </span>
                          <span className={`ml-auto text-[10px] font-bold tabular-nums ${
                            settlement.isNegative ? "text-red-300" : "text-emerald-300"
                          }`}>
                            {currency(settlement.amount)} net
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Right: filter chips + toggles */}
                    <div className="flex flex-shrink-0 items-center gap-1.5">

                      {/* Filter chips — styled for dark bar */}
                      {draftStatement && preparedRows.length > 0 && (
                        <div className="flex items-center gap-1">
                          {[
                            { key: "all",     label: `All·${preparedRows.length}`,                cls: "border-white/25 bg-white/10 text-white/80" },
                            { key: "unpaid",  label: `Unpaid·${collectionStats?.unpaid ?? 0}`,   cls: "border-red-400/50 bg-red-900/40 text-red-200" },
                            { key: "partial", label: `Partial·${collectionStats?.partial ?? 0}`, cls: "border-amber-400/50 bg-amber-900/40 text-amber-200" },
                            { key: "paid",    label: `Paid·${collectionStats?.paid ?? 0}`,       cls: "border-emerald-400/50 bg-emerald-900/40 text-emerald-200" },
                            { key: "nobill",  label: `No Bill·${collectionStats?.nobill ?? 0}`,  cls: "border-white/15 bg-white/5 text-slate-300" },
                            { key: "vacant",  label: `Vacant·${collectionStats?.vacant ?? 0}`,   cls: "border-white/15 bg-white/5 text-slate-300" },
                          ].map((chip) => (
                            <button
                              key={chip.key}
                              type="button"
                              onClick={() => setRowFilter(chip.key)}
                              className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold transition-colors ${chip.cls} ${
                                rowFilter === chip.key
                                  ? "ring-1 ring-white/60 opacity-100"
                                  : "opacity-50 hover:opacity-90"
                              }`}
                            >
                              {chip.label}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Separator */}
                      <div className="h-5 w-px bg-white/15" />

                      {/* Collapse multi-unit rows toggle */}
                      <button
                        type="button"
                        onClick={() => setCollapseAdditionalUnitRows(!collapseAdditionalUnitRows)}
                        title="Toggle multi-unit row collapsing"
                        className={`rounded border px-2 py-1 text-[9px] font-semibold transition-colors ${
                          collapseAdditionalUnitRows
                            ? "border-green-300/40 bg-green-500/30 text-white"
                            : "border-white/20 bg-white/10 text-green-100/60 hover:bg-white/20"
                        }`}
                      >
                        {collapseAdditionalUnitRows ? "Multi ▲" : "Multi ▼"}
                      </button>

                      {/* KPI details toggle */}
                      {collectionStats && (
                        <button
                          type="button"
                          onClick={() => setKpiExpanded((v) => !v)}
                          className="rounded border border-white/20 bg-white/10 px-2 py-1 text-[9px] font-semibold text-green-100/60 transition-colors hover:bg-white/20"
                        >
                          {kpiExpanded ? "Details ▲" : "Details ▼"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* ── Expandable KPI strip (collapsed by default) ── */}
                {kpiExpanded && collectionStats && (
                  <div className="flex-shrink-0 grid grid-cols-5 divide-x divide-slate-100 border-b border-slate-200 bg-white">
                    {[
                      {
                        label: "Units",
                        value: `${collectionStats.occupied} occ`,
                        sub: collectionStats.vacant > 0 ? `${collectionStats.vacant} vacant` : collectionStats.nobill > 0 ? `${collectionStats.nobill} no bill` : "fully occupied",
                        color: "text-slate-800",
                        subColor: collectionStats.vacant > 0 ? "text-amber-500" : collectionStats.nobill > 0 ? "text-slate-500" : "text-emerald-500",
                      },
                      { label: "Paid in Full", value: collectionStats.paid,   sub: "tenants", color: collectionStats.paid > 0    ? "text-emerald-700" : "text-slate-400", subColor: "text-slate-400" },
                      { label: "Partial",      value: collectionStats.partial, sub: "tenants", color: collectionStats.partial > 0 ? "text-amber-700"   : "text-slate-400", subColor: "text-slate-400" },
                      { label: "Not Paid",     value: collectionStats.unpaid,  sub: "tenants", color: collectionStats.unpaid > 0  ? "text-red-600"     : "text-slate-400", subColor: "text-slate-400" },
                      {
                        label: "Net to Landlord",
                        value: currency(settlement.amount),
                        sub: settlement.isNegative ? settlement.label : "Incl. b/f balances & adj.",
                        color: settlement.isNegative ? "text-red-700" : "text-[#0B3B2E]",
                        subColor: "text-slate-400",
                      },
                    ].map((kpi) => (
                      <div key={kpi.label} className="px-3 py-1.5">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{kpi.label}</p>
                        <p className={`mt-0.5 text-sm font-bold ${kpi.color}`}>{kpi.value}</p>
                        {kpi.sub && <p className={`text-[9px] ${kpi.subColor || "text-slate-400"}`}>{kpi.sub}</p>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Scrollable table + detail sections */}
                <div className="min-h-0 flex-1 overflow-auto bg-white">
                  <table className="min-w-max w-full whitespace-nowrap text-xs">
                    <thead className="sticky top-0 z-20">
                      {/* ── Row 1: Group span headers ── */}
                      <tr className="bg-[#0B3B2E]">
                        <th rowSpan={2} className="sticky left-0 z-30 w-[56px] min-w-[56px] max-w-[56px] overflow-hidden bg-[#0B3B2E] px-2 py-1 text-left align-bottom border-b border-white/10">
                          <div className="text-[11px] font-semibold text-white">Unit</div>
                        </th>
                        <th rowSpan={2} className="sticky left-[56px] z-30 w-[130px] min-w-[130px] max-w-[130px] overflow-hidden bg-[#0B3B2E] px-2 py-1 text-left align-bottom border-r border-white/10 border-b border-white/10">
                          <div className="text-[11px] font-semibold text-white">Tenant</div>
                        </th>
                        <th rowSpan={2} className="w-[88px] min-w-[88px] max-w-[88px] px-2 py-1 text-right align-bottom border-b border-white/10">
                          <div className="text-[8px] font-bold uppercase tracking-widest text-white/30 mb-0.5">Ledger</div>
                          <div className="text-[11px] font-semibold text-white">Bal B/F</div>
                        </th>
                        {/* INVOICED group */}
                        <th
                          colSpan={1 + (hasInvoiceVatColumn ? 1 : 0) + statementColumns.length}
                          className="border-l border-white/10 px-2 py-1 text-center"
                        >
                          <div className="text-[8px] font-bold uppercase tracking-widest text-white/40">Invoiced</div>
                        </th>
                        {/* PAID group */}
                        <th
                          colSpan={1 + (hasInvoiceVatColumn ? 1 : 0) + statementColumns.length}
                          className="border-l border-white/10 px-2 py-1 text-center"
                        >
                          <div className="text-[8px] font-bold uppercase tracking-widest text-emerald-300/70">Paid</div>
                        </th>
                        {/* SUMMARY group */}
                        <th
                          colSpan={2}
                          className="border-l border-white/10 px-2 py-1 text-center"
                        >
                          <div className="text-[8px] font-bold uppercase tracking-widest text-white/30">Summary</div>
                        </th>
                      </tr>
                      {/* ── Row 2: Individual column names ── */}
                      <tr className="bg-[#0B3B2E] border-t border-white/10">
                        {/* Invoiced sub-columns */}
                        <th className="w-[100px] min-w-[100px] max-w-[100px] border-l border-white/10 px-2 py-1 text-right">
                          <div className="text-[11px] font-semibold text-white/90">Rent</div>
                        </th>
                        {hasInvoiceVatColumn && (
                          <th className="w-[80px] min-w-[80px] max-w-[80px] px-2 py-1 text-right">
                            <div className="text-[11px] font-semibold text-white/70">VAT</div>
                          </th>
                        )}
                        {statementColumns.map((column) => (
                          <th key={`inv-head-${column.key}`} className="w-[100px] min-w-[100px] max-w-[100px] px-2 py-1 text-right" title={column.label}>
                            <div className="truncate text-[11px] font-semibold text-white/90">{column.label}</div>
                          </th>
                        ))}
                        {/* Paid sub-columns */}
                        <th className="w-[100px] min-w-[100px] max-w-[100px] border-l border-white/10 px-2 py-1 text-right">
                          <div className="text-[11px] font-semibold text-emerald-200/90">Rent</div>
                        </th>
                        {hasInvoiceVatColumn && (
                          <th className="w-[80px] min-w-[80px] max-w-[80px] px-2 py-1 text-right">
                            <div className="text-[11px] font-semibold text-emerald-200/70">VAT</div>
                          </th>
                        )}
                        {statementColumns.map((column) => (
                          <th key={`paid-head-${column.key}`} className="w-[100px] min-w-[100px] max-w-[100px] px-2 py-1 text-right" title={column.label}>
                            <div className="truncate text-[11px] font-semibold text-emerald-200/90">{column.label}</div>
                          </th>
                        ))}
                        {/* Summary sub-columns */}
                        <th className="w-[100px] min-w-[100px] max-w-[100px] border-l border-white/10 px-2 py-1 text-right">
                          <div className="text-[11px] font-semibold text-white/90">Total Paid</div>
                        </th>
                        <th className="w-[90px] min-w-[90px] max-w-[90px] px-2 py-1 text-right">
                          <div className="text-[11px] font-semibold text-white/90">Bal C/F</div>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white">
                      {filteredTableRows.length === 0 ? (
                        <tr>
                          <td colSpan={statementColSpan} className="px-4 py-10 text-center">
                            <div className="flex flex-col items-center gap-2">
                              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
                                <FaFileAlt className="text-slate-400" size={14} />
                              </div>
                              <p className="text-sm font-semibold text-slate-700">
                                {rowFilter === "all" ? "No rows generated" : `No ${rowFilter} tenants`}
                              </p>
                              {rowFilter !== "all" && (
                                <button type="button" onClick={() => setRowFilter("all")} className="text-xs text-[#0B3B2E] underline">Show all rows</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : (
                        filteredTableRows.map((row, index) => {
                          const closingBal = Number(row.closingBalance ?? row.balanceCF ?? row.balance ?? 0);
                          const status = row.__paymentStatus;
                          const st = ROW_STATUS[status] || ROW_STATUS.vacant;
                          const isVacant = status === "vacant";
                          const isNoBill = status === "nobill";
                          const isOdd = index % 2 !== 0;
                          const rowBase = isOdd ? "bg-slate-50" : "bg-white";

                          // Bal C/F: positive = tenant owes (arrears = red),
                          //          negative = tenant has credit (green),
                          //          zero = settled (muted).
                          const balCls = (isVacant || isNoBill) ? "text-slate-300"
                            : closingBal > 0.005  ? "text-red-600 font-semibold"
                            : closingBal < -0.005 ? "text-emerald-700 font-semibold"
                            : "text-slate-400";

                          const paidRentCell   = paidCellDisplay(row.paidRent, isVacant, isNoBill);
                          const paidTaxCell    = paidCellDisplay(row.paidTax, isVacant, isNoBill);
                          const totalPaidCell  = paidCellDisplay(row.totalPaid, isVacant, isNoBill);

                          // Only show the inline badge for PAID and PARTIAL — those are the meaningful exceptions.
                          const showBadge = status === "paid" || status === "partial";

                          return (
                            <tr
                              key={row.unitId ? `u-${row.unitId}` : row._id ? `d-${row._id}` : `n-${row.unitNumber || index}`}
                              className={`${rowBase} border-b border-slate-100 transition-colors hover:bg-orange-50/70`}
                            >
                              <td className={`sticky left-0 z-10 w-[56px] min-w-[56px] max-w-[56px] overflow-hidden ${rowBase} ${st.border} px-2 py-1 shadow-[2px_0_5px_-3px_rgba(0,0,0,0.07)]`}>
                                <div className={`truncate text-xs font-semibold ${isVacant ? "text-slate-400" : "text-slate-900"}`} title={row.displayUnitLabel || row.unit || row.unitNumber || ""}>{row.displayUnitLabel || row.unit || row.unitNumber || "—"}</div>
                              </td>
                              <td className={`sticky left-[56px] z-10 w-[130px] min-w-[130px] max-w-[130px] overflow-hidden ${rowBase} border-r border-slate-100 px-2 py-1 shadow-[2px_0_5px_-3px_rgba(0,0,0,0.07)]`}>
                                <div className="flex items-center gap-1.5">
                                  {showBadge && (
                                    <span className={`shrink-0 rounded px-1 py-px text-[8px] font-bold uppercase tracking-wide ${st.badge}`}>
                                      {st.label}
                                    </span>
                                  )}
                                  <div className={`truncate text-[11px] font-semibold ${isVacant ? "text-slate-400 italic" : "text-slate-800"}`}>
                                    {row.tenantName || "—"}
                                  </div>
                                </div>
                                {Number(row.multiUnitCount || 1) > 1 && (
                                  <div className="mt-0.5 inline-flex rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700">
                                    {row.multiUnitCount} units
                                  </div>
                                )}
                              </td>
                              {/* Bal B/F — muted, context only */}
                              <td className="px-2 py-1 text-right text-slate-400 text-[10px]">
                                {(isVacant || isNoBill) ? "—" : (Number(row.openingBalance ?? row.balanceBF ?? 0) !== 0 ? currency(row.openingBalance ?? row.balanceBF ?? 0) : "—")}
                              </td>
                              {/* ── INVOICED block ── */}
                              <td className={`border-l border-slate-100 px-2 py-1 text-right text-[11px] ${(isVacant || isNoBill) ? "text-slate-300" : "text-slate-700"}`}>
                                {(isVacant || isNoBill) ? "—" : currency(row.invoicedRent)}
                              </td>
                              {hasInvoiceVatColumn && (
                                <td className={`px-2 py-1 text-right text-[11px] ${(isVacant || isNoBill) ? "text-slate-300" : "text-slate-500"}`}>
                                  {(isVacant || isNoBill) ? "—" : currency(row.invoicedTax ?? 0)}
                                </td>
                              )}
                              {statementColumns.map((column) => {
                                const invVal = getPreparedStatementColumnValue(row, column.key, "invoiced");
                                return (
                                  <td key={`inv-${row.unitId || row.unitNumber || "row"}-${column.key}`} className={`px-2 py-1 text-right text-[11px] ${(isVacant || isNoBill) ? "text-slate-300" : "text-slate-700"}`}>
                                    {(isVacant || isNoBill) ? "—" : currency(invVal)}
                                  </td>
                                );
                              })}
                              {/* ── PAID block ── */}
                              <td className={`border-l border-slate-100 px-2 py-1 text-right text-[11px] ${paidRentCell.cls}`}>{paidRentCell.text}</td>
                              {hasInvoiceVatColumn && (
                                <td className={`px-2 py-1 text-right text-[11px] ${paidTaxCell.cls}`}>{paidTaxCell.text}</td>
                              )}
                              {statementColumns.map((column) => {
                                const padVal = paidCellDisplay(getPreparedStatementColumnValue(row, column.key, "paid"), isVacant, isNoBill);
                                return (
                                  <td key={`paid-${row.unitId || row.unitNumber || "row"}-${column.key}`} className={`px-2 py-1 text-right text-[11px] ${padVal.cls}`}>{padVal.text}</td>
                                );
                              })}
                              {/* Total Paid */}
                              <td className={`border-l border-slate-100 px-2 py-1 text-right text-[11px] ${totalPaidCell.cls}`}>{totalPaidCell.text}</td>
                              {/* Bal C/F — positive = arrears (red), negative = credit (green) */}
                              <td className={`px-2 py-1 text-right text-[11px] ${balCls}`}>
                                {(isVacant || isNoBill) ? "—" : closingBal !== 0 ? currency(closingBal) : "—"}
                              </td>
                            </tr>
                          );
                        })
                      )}
                      {/* Totals row */}
                      {preparedRows.length > 0 && (
                        <tr className="border-t-2 border-[#0B3B2E] bg-[#0B3B2E]">
                          <td className="sticky left-0 z-10 w-[56px] min-w-[56px] max-w-[56px] overflow-hidden bg-[#0B3B2E] px-2 py-1.5 text-[11px] font-bold text-white">Totals</td>
                          <td className="sticky left-[56px] z-10 w-[130px] min-w-[130px] max-w-[130px] overflow-hidden border-r border-white/10 bg-[#0B3B2E] px-2 py-1.5"></td>
                          <td className="px-2 py-1.5 text-right text-[11px] font-semibold text-white/80">{currency(totals.openingBalance ?? summary.openingBalance ?? 0)}</td>
                          {/* Invoiced totals */}
                          <td className="border-l border-white/10 px-2 py-1.5 text-right text-[11px] font-semibold text-white">{currency(totals.invoicedRent ?? summary.rentInvoiced ?? 0)}</td>
                          {hasInvoiceVatColumn && (
                            <td className="px-2 py-1.5 text-right text-[11px] font-semibold text-white/80">{currency(totals.invoicedTax ?? summary.totalInvoiceVatInvoiced ?? 0)}</td>
                          )}
                          {statementColumns.map((column) => (
                            <td key={`foot-inv-${column.key}`} className="px-2 py-1.5 text-right text-[11px] font-semibold text-white">{currency(Number(column?.invoiced || 0))}</td>
                          ))}
                          {/* Paid totals */}
                          <td className="border-l border-white/10 px-2 py-1.5 text-right text-[11px] font-bold text-white">{currency(totals.paidRent ?? summary.totalRentReceived ?? 0)}</td>
                          {hasInvoiceVatColumn && (
                            <td className="px-2 py-1.5 text-right text-[11px] font-semibold text-white/80">{currency(totals.paidTax ?? totalInvoiceVatReceived ?? 0)}</td>
                          )}
                          {statementColumns.map((column) => (
                            <td key={`foot-paid-${column.key}`} className="px-2 py-1.5 text-right text-[11px] font-bold text-white">{currency(Number(column?.paid || 0))}</td>
                          ))}
                          <td className="border-l border-white/10 px-2 py-1.5 text-right text-[11px] font-bold text-white">{currency(totals.totalPaid ?? 0)}</td>
                          <td className="px-2 py-1.5 text-right text-[11px] font-bold text-white">{currency(totals.closingBalance ?? summary.closingBalance ?? 0)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>

                  {/* Detail sections */}
                  {hasWorkspaceDetailSections && (
                    <div className="space-y-3 border-t border-slate-200 bg-slate-50 px-4 py-3">
                      {depositSettlementRows.length > 0 && (
                        <div>
                          <div className="mb-1.5 flex items-center gap-1">
                            <h4 className="border-l-2 border-[#0B3B2E] pl-2 text-[10px] font-bold uppercase tracking-widest text-[#0B3B2E]">Deposit Remittance</h4>
                            <div className="ml-auto flex items-center gap-3 rounded-md bg-white border border-slate-200 px-3 py-1 text-[11px]">
                              <span className="text-[9px] font-bold uppercase tracking-wide text-emerald-600">Added</span>
                              <span className="font-bold text-emerald-800">{currency(depositSettlementTotals.additions)}</span>
                              <span className="text-slate-200">|</span>
                              <span className="text-[9px] font-bold uppercase tracking-wide text-amber-600">Offsets</span>
                              <span className="font-bold text-amber-800">{currency(depositSettlementTotals.offsets)}</span>
                              <span className="text-slate-200">|</span>
                              <span className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Net</span>
                              <span className="font-bold text-slate-900">{currency(depositSettlementTotals.netImpact)}</span>
                            </div>
                          </div>
                          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                            <table className="min-w-full text-[11px]">
                              <thead>
                                <tr className="border-b border-slate-200 bg-slate-50">
                                  <th className="px-2 py-1 text-left text-[9px] font-bold uppercase tracking-wide text-slate-400">#</th>
                                  <th className="px-2 py-1 text-left text-[9px] font-bold uppercase tracking-wide text-slate-400">Description</th>
                                  <th className="px-2 py-1 text-left text-[9px] font-bold uppercase tracking-wide text-slate-400">Type</th>
                                  <th className="px-2 py-1 text-right text-[9px] font-bold uppercase tracking-wide text-slate-400">Amount</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {depositSettlementAdditionRows.map((item, index) => (
                                  <tr key={item._id || item.id || `deposit-settlement-add-${index}`} className="odd:bg-white even:bg-emerald-50/20 hover:bg-orange-50/50 transition-colors">
                                    <td className="px-2 py-0.5 text-[10px] text-slate-400">{index + 1}</td>
                                    <td className="px-2 py-0.5 text-slate-700">{item.description || "Deposit remittance"}</td>
                                    <td className="px-2 py-0.5"><span className="rounded bg-emerald-100 px-1 py-px text-[9px] font-semibold text-emerald-700">{item.holder === "landlord" ? "Landlord-held" : "Settlement"}</span></td>
                                    <td className="px-2 py-0.5 text-right font-semibold text-emerald-700">{currency(item.amount)}</td>
                                  </tr>
                                ))}
                                {depositSettlementOffsetRows.map((item, index) => (
                                  <tr key={item._id || item.id || `deposit-settlement-offset-${index}`} className="odd:bg-white even:bg-amber-50/20 hover:bg-orange-50/50 transition-colors">
                                    <td className="px-2 py-0.5 text-[10px] text-slate-400">{depositSettlementAdditionRows.length + index + 1}</td>
                                    <td className="px-2 py-0.5 text-slate-700">{item.description || "Deposit offset"}</td>
                                    <td className="px-2 py-0.5"><span className="rounded bg-amber-100 px-1 py-px text-[9px] font-semibold text-amber-700">Direct offset</span></td>
                                    <td className="px-2 py-0.5 text-right font-semibold text-amber-700">{currency(item.amount)}</td>
                                  </tr>
                                ))}
                                <tr className="border-t border-slate-200 bg-slate-50">
                                  <td colSpan={3} className="px-2 py-0.5 text-[10px] font-bold text-slate-700">Total Added to Landlord</td>
                                  <td className="px-2 py-0.5 text-right text-[11px] font-bold text-emerald-800">{currency(depositSettlementTotals.additions)}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {broughtForwardCreditApplicationRows.length > 0 && (
                        <div>
                          <div className="mb-1.5 flex items-center gap-1">
                            <h4 className="border-l-2 border-[#0B3B2E] pl-2 text-[10px] font-bold uppercase tracking-widest text-[#0B3B2E]">Brought Forward Credits</h4>
                            <div className="ml-auto flex items-center gap-3 rounded-md bg-white border border-slate-200 px-3 py-1 text-[11px]">
                              <span className="text-[9px] font-bold uppercase tracking-wide text-sky-600">Total</span>
                              <span className="font-bold text-sky-800">{currency(broughtForwardCreditApplicationTotals.totalApplied || 0)}</span>
                              {broughtForwardCreditApplicationTotals.rentApplied > 0 && <><span className="text-slate-200">|</span><span className="text-[9px] text-slate-500">Rent <span className="font-semibold text-slate-700">{currency(broughtForwardCreditApplicationTotals.rentApplied)}</span></span></>}
                              {broughtForwardCreditApplicationTotals.utilityApplied > 0 && <><span className="text-slate-200">|</span><span className="text-[9px] text-slate-500">Utils <span className="font-semibold text-slate-700">{currency(broughtForwardCreditApplicationTotals.utilityApplied)}</span></span></>}
                            </div>
                          </div>
                          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                            <table className="min-w-full text-[11px]">
                              <thead>
                                <tr className="border-b border-slate-200 bg-slate-50">
                                  <th className="px-2 py-1 text-left text-[9px] font-bold uppercase tracking-wide text-slate-400">#</th>
                                  <th className="px-2 py-1 text-left text-[9px] font-bold uppercase tracking-wide text-slate-400">Description</th>
                                  <th className="px-2 py-1 text-left text-[9px] font-bold uppercase tracking-wide text-slate-400">Receipt</th>
                                  <th className="px-2 py-1 text-left text-[9px] font-bold uppercase tracking-wide text-slate-400">Unit</th>
                                  <th className="px-2 py-1 text-right text-[9px] font-bold uppercase tracking-wide text-slate-400">Amount</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {broughtForwardCreditApplicationRows.map((item, index) => (
                                  <tr key={item._id || item.id || `bf-credit-${index}`} className="odd:bg-white even:bg-sky-50/20 hover:bg-orange-50/50 transition-colors">
                                    <td className="px-2 py-0.5 text-[10px] text-slate-400">{index + 1}</td>
                                    <td className="px-2 py-0.5 text-slate-700">{item.description || "B/F credit applied"}</td>
                                    <td className="px-2 py-0.5 text-slate-500">{item.receiptReference || "—"}</td>
                                    <td className="px-2 py-0.5 text-slate-500">{item.unit || "—"}</td>
                                    <td className="px-2 py-0.5 text-right font-semibold text-sky-700">{currency(item.amount)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {depositMemoRows.length > 0 && (
                        <div>
                          <h4 className="mb-1 border-l-2 border-[#0B3B2E] pl-2 text-[10px] font-bold uppercase tracking-widest text-[#0B3B2E]">Deposit Memorandum <span className="ml-1 text-[9px] font-normal normal-case tracking-normal text-slate-400">held positions — excluded from settlement</span></h4>
                          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                            <table className="min-w-full divide-y divide-slate-100 text-xs">
                              <thead className="bg-slate-50">
                                <tr>
                                  {["Holder", "Opening", "Billed / Adj.", "Received", "Closing"].map((h, i) => (
                                    <th key={h} className={`px-3 py-1.5 ${i === 0 ? "text-left" : "text-right"} font-semibold text-slate-600`}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 bg-white">
                                {depositMemoRows.map((item, index) => (
                                  <tr key={item._id || item.id || item.key || `deposit-memo-${index}`} className="hover:bg-slate-50/60 transition-colors">
                                    <td className="px-3 py-1.5 text-slate-700">{item.label || item.key || "Deposit memo"}</td>
                                    <td className="px-3 py-1.5 text-right text-slate-600">{depositMemoCurrency(item.openingBalance)}</td>
                                    <td className="px-3 py-1.5 text-right text-slate-600">{depositMemoCurrency(item.billed)}</td>
                                    <td className="px-3 py-1.5 text-right text-slate-600">{depositMemoCurrency(item.received)}</td>
                                    <td className="px-3 py-1.5 text-right font-semibold text-slate-900">{depositMemoCurrency(item.closingBalance)}</td>
                                  </tr>
                                ))}
                                <tr className="bg-slate-50 font-semibold">
                                  <td className="px-3 py-1.5 text-slate-700">Total</td>
                                  <td className="px-3 py-1.5 text-right text-slate-900">{depositMemoCurrency(depositMemoTotals.openingBalance)}</td>
                                  <td className="px-3 py-1.5 text-right text-slate-900">{depositMemoCurrency(depositMemoTotals.billed)}</td>
                                  <td className="px-3 py-1.5 text-right text-slate-900">{depositMemoCurrency(depositMemoTotals.received)}</td>
                                  <td className="px-3 py-1.5 text-right text-slate-900">{depositMemoCurrency(depositMemoTotals.closingBalance)}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {nonDepositExpenseRows.length > 0 && (
                        <div>
                          <h4 className="mb-1 border-l-2 border-[#0B3B2E] pl-2 text-[10px] font-bold uppercase tracking-widest text-[#0B3B2E]">Deductions / Expenses</h4>
                          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                            <table className="min-w-full text-[11px]">
                              <thead>
                                <tr className="border-b border-slate-200 bg-slate-50">
                                  <th className="px-2 py-1 text-left text-[9px] font-bold uppercase tracking-wide text-slate-400">#</th>
                                  <th className="px-2 py-1 text-left text-[9px] font-bold uppercase tracking-wide text-slate-400">Description</th>
                                  <th className="px-2 py-1 text-right text-[9px] font-bold uppercase tracking-wide text-slate-400">Amount</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {nonDepositExpenseRows.map((item, index) => (
                                  <tr key={item._id || item.id || `expense-${index}`} className="odd:bg-white even:bg-slate-50/60 hover:bg-orange-50/50 transition-colors">
                                    <td className="px-2 py-0.5 text-[10px] text-slate-400">{index + 1}</td>
                                    <td className="px-2 py-0.5 text-slate-700">{item.description || item.name || "Expense"}</td>
                                    <td className="px-2 py-0.5 text-right font-semibold text-slate-800">{currency(item.amount)}</td>
                                  </tr>
                                ))}
                                <tr className="border-t border-slate-200 bg-slate-50">
                                  <td colSpan={2} className="px-2 py-0.5 text-[10px] font-bold text-slate-700">Total</td>
                                  <td className="px-2 py-0.5 text-right text-[11px] font-bold text-slate-900">{currency(nonDepositExpenseRows.reduce((s, r) => s + Number(r.amount || 0), 0))}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {nonDepositAdditionRows.length > 0 && (
                        <div>
                          <h4 className="mb-1 border-l-2 border-[#0B3B2E] pl-2 text-[10px] font-bold uppercase tracking-widest text-[#0B3B2E]">Additions</h4>
                          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                            <table className="min-w-full text-[11px]">
                              <thead>
                                <tr className="border-b border-slate-200 bg-slate-50">
                                  <th className="px-2 py-1 text-left text-[9px] font-bold uppercase tracking-wide text-slate-400">#</th>
                                  <th className="px-2 py-1 text-left text-[9px] font-bold uppercase tracking-wide text-slate-400">Description</th>
                                  <th className="px-2 py-1 text-right text-[9px] font-bold uppercase tracking-wide text-slate-400">Amount</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {nonDepositAdditionRows.map((item, index) => (
                                  <tr key={item._id || item.id || `addition-${index}`} className="odd:bg-white even:bg-emerald-50/20 hover:bg-orange-50/50 transition-colors">
                                    <td className="px-2 py-0.5 text-[10px] text-slate-400">{index + 1}</td>
                                    <td className="px-2 py-0.5 text-slate-700">{item.description || item.name || "Addition"}</td>
                                    <td className="px-2 py-0.5 text-right font-semibold text-emerald-700">{currency(item.amount)}</td>
                                  </tr>
                                ))}
                                <tr className="border-t border-slate-200 bg-emerald-50/40">
                                  <td colSpan={2} className="px-2 py-0.5 text-[10px] font-bold text-emerald-800">Total</td>
                                  <td className="px-2 py-0.5 text-right text-[11px] font-bold text-emerald-800">{currency(nonDepositAdditionRows.reduce((s, r) => s + Number(r.amount || 0), 0))}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {earlyPayoutRows.length > 0 && (
                        <div>
                          <h4 className="mb-1 border-l-2 border-amber-400 pl-2 text-[10px] font-bold uppercase tracking-widest text-amber-700">Early Payouts to Landlord</h4>
                          <div className="overflow-hidden rounded-lg border border-amber-200 bg-white">
                            <table className="min-w-full text-[11px]">
                              <thead>
                                <tr className="border-b border-amber-200 bg-amber-50/60">
                                  <th className="px-2 py-1 text-left text-[9px] font-bold uppercase tracking-wide text-amber-600">#</th>
                                  <th className="px-2 py-1 text-left text-[9px] font-bold uppercase tracking-wide text-amber-600">Description</th>
                                  <th className="px-2 py-1 text-left text-[9px] font-bold uppercase tracking-wide text-amber-600">Date</th>
                                  <th className="px-2 py-1 text-right text-[9px] font-bold uppercase tracking-wide text-amber-600">Amount</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-amber-100">
                                {earlyPayoutRows.map((item, index) => (
                                  <tr key={item._id || item.id || `early-payout-${index}`} className="odd:bg-white even:bg-amber-50/30 hover:bg-orange-50/50 transition-colors">
                                    <td className="px-2 py-0.5 text-[10px] text-slate-400">{index + 1}</td>
                                    <td className="px-2 py-0.5 text-slate-700">{item.description || "Early payout"}</td>
                                    <td className="px-2 py-0.5 text-slate-500">{item.date ? new Date(item.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</td>
                                    <td className="px-2 py-0.5 text-right font-semibold text-amber-700">({currency(item.amount)})</td>
                                  </tr>
                                ))}
                                <tr className="border-t border-amber-200 bg-amber-50">
                                  <td colSpan={3} className="px-2 py-0.5 text-[10px] font-bold text-amber-800">Total</td>
                                  <td className="px-2 py-0.5 text-right text-[11px] font-bold text-amber-800">({currency(Number(summary?.totalEarlyPayouts || 0))})</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {advanceRecoveryRows.length > 0 && (
                        <div>
                          <h4 className="mb-1 border-l-2 border-red-400 pl-2 text-[10px] font-bold uppercase tracking-widest text-red-700">Advance Recoveries</h4>
                          <div className="overflow-hidden rounded-lg border border-red-200 bg-white">
                            <table className="min-w-full text-[11px]">
                              <thead>
                                <tr className="border-b border-red-200 bg-red-50/60">
                                  <th className="px-2 py-1 text-left text-[9px] font-bold uppercase tracking-wide text-red-600">#</th>
                                  <th className="px-2 py-1 text-left text-[9px] font-bold uppercase tracking-wide text-red-600">Description</th>
                                  <th className="px-2 py-1 text-left text-[9px] font-bold uppercase tracking-wide text-red-600">Date</th>
                                  <th className="px-2 py-1 text-right text-[9px] font-bold uppercase tracking-wide text-red-600">Amount</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-red-100">
                                {advanceRecoveryRows.map((item, index) => (
                                  <tr key={item._id || item.id || `advance-recovery-${index}`} className="odd:bg-white even:bg-red-50/30 hover:bg-orange-50/50 transition-colors">
                                    <td className="px-2 py-0.5 text-[10px] text-slate-400">{index + 1}</td>
                                    <td className="px-2 py-0.5 text-slate-700">{item.description || "Advance recovery"}</td>
                                    <td className="px-2 py-0.5 text-slate-500">{item.date ? new Date(item.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</td>
                                    <td className="px-2 py-0.5 text-right font-semibold text-red-600">({currency(item.amount)})</td>
                                  </tr>
                                ))}
                                <tr className="border-t border-red-200 bg-red-50">
                                  <td colSpan={3} className="px-2 py-0.5 text-[10px] font-bold text-red-800">Total</td>
                                  <td className="px-2 py-0.5 text-right text-[11px] font-bold text-red-800">({currency(Number(summary?.totalAdvanceRecoveries || 0))})</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {directToLandlordRows.length > 0 && (
                        <div>
                          <h4 className="mb-2 border-l-2 border-[#0B3B2E] pl-2.5 text-[10px] font-bold uppercase tracking-widest text-[#0B3B2E]">
                            Payments Collected Directly by Landlord
                          </h4>
                          <div className="overflow-hidden border border-[#0B3B2E]/20 bg-white">
                            <div className="grid grid-cols-[80px_60px_1fr_60px_80px_90px] gap-0 border-b border-slate-200 bg-slate-50 px-3 py-1.5">
                              {["Date", "Unit", "Tenant", "Type", "Reference", "Amount"].map((h) => (
                                <span key={h} className="text-[9px] font-black uppercase tracking-widest text-slate-500">{h}</span>
                              ))}
                            </div>
                            {directToLandlordRows.map((item, index) => (
                              <div key={item._id || item.id || `direct-${index}`} className={`grid grid-cols-[80px_60px_1fr_60px_80px_90px] gap-0 border-b border-slate-100 px-3 py-2 last:border-0 ${index % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}>
                                <span className="text-[10px] text-slate-600">
                                  {item.date ? new Date(item.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—"}
                                </span>
                                <span className="text-[10px] font-semibold text-slate-700">{item.unit || "—"}</span>
                                <div>
                                  <span className="block text-[10px] font-semibold text-slate-800">{item.tenantName || item.description || "—"}</span>
                                  {item.tenantCode && item.tenantCode !== "-" && (
                                    <span className="text-[9px] text-slate-400">{item.tenantCode}</span>
                                  )}
                                </div>
                                <span className={`text-[9px] font-black uppercase tracking-wide ${item.paymentType === "utility" ? "text-blue-600" : "text-[#0B3B2E]"}`}>
                                  {item.typeLabel || "Rent"}
                                </span>
                                <span className="text-[10px] text-slate-500 truncate">{item.receiptRef || "—"}</span>
                                <span className="text-[10px] font-bold text-slate-900 text-right">{currency(item.amount)}</span>
                              </div>
                            ))}
                            <div className="flex items-center justify-between border-t-2 border-[#0B3B2E]/20 bg-[#EDF5F1] px-3 py-2">
                              <span className="text-[10px] font-black uppercase tracking-wide text-[#0B3B2E]">Total received directly by landlord</span>
                              <span className="text-[10px] font-black text-[#0B3B2E]">{currency(directToLandlordAmount)}</span>
                            </div>
                          </div>
                          <p className="mt-1.5 text-[9px] italic text-slate-400 leading-4">
                            These payments were made directly to you by tenants and are NOT included in the manager&apos;s remittance transfer below.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Notes to landlord */}
                  {draftStatement && (
                    <div className="border-t border-slate-200 bg-slate-50 px-5 py-4">
                      <h4 className="mb-2 border-l-2 border-[#0B3B2E] pl-2.5 text-[10px] font-bold uppercase tracking-widest text-[#0B3B2E]">
                        Notes to Landlord
                      </h4>
                      <textarea
                        value={statementNotes}
                        onChange={(e) => setStatementNotes(e.target.value)}
                        placeholder="Add notes for the landlord — these will appear on the printed statement..."
                        rows={3}
                        className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-700 placeholder-slate-400 focus:border-[#0B3B2E] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/20"
                      />
                      <div className="mt-1.5 flex items-center justify-between">
                        <span className="text-[9px] text-slate-400">
                          {statementNotes.length > 0 ? `${statementNotes.length} characters` : "No notes added"}
                        </span>
                        <button
                          type="button"
                          onClick={handleSaveNotes}
                          disabled={savingNotes || !draftStatement?._id}
                          className="inline-flex items-center gap-1.5 rounded-md border border-[#0B3B2E] bg-[#0B3B2E] px-3 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-[#0a3328] disabled:opacity-40"
                        >
                          {savingNotes ? "Saving…" : "Save Notes"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* KPI footer */}
                <div className="flex-shrink-0 border-t border-slate-200 bg-white shadow-[0_-2px_6px_rgba(0,0,0,0.05)]">
                  <div className="grid grid-cols-2 divide-x divide-slate-100 md:grid-cols-5">
                    {/* Total Invoiced */}
                    <div className="px-3 py-2">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Total Invoiced</p>
                      <p className="mt-1 text-sm font-bold text-slate-700">{currency(collectionStats?.totalInvoiced ?? totals.invoicedRent)}</p>
                      {collectionStats?.rate !== null && collectionStats?.rate !== undefined && (
                        <p className={`mt-0.5 text-[10px] font-semibold ${
                          collectionStats.rate >= 80 ? "text-emerald-600" :
                          collectionStats.rate >= 50 ? "text-amber-600" :
                          collectionStats.rate > 0  ? "text-orange-500" : "text-slate-400"
                        }`}>
                          {collectionStats.rate > 0 ? `${collectionStats.rate}% collected` : "Nothing collected yet"}
                        </p>
                      )}
                    </div>
                    {/* Rent Collected */}
                    <div className="px-3 py-2">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Rent Collected</p>
                      <p className={`mt-1 text-sm font-bold ${Number(totals.rentPaid || 0) > 0 ? "text-emerald-700" : "text-slate-400"}`}>
                        {Number(totals.rentPaid || 0) > 0 ? currency(totals.rentPaid) : "—"}
                      </p>
                      {hasInvoiceVatColumn && Number(totalInvoiceVatReceived || 0) > 0 && (
                        <p className="mt-0.5 text-[10px] text-slate-400">VAT: {currency(totalInvoiceVatReceived)}</p>
                      )}
                    </div>
                    {/* Utilities Paid */}
                    <div className="px-3 py-2">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Utilities Paid</p>
                      <p className={`mt-1 text-sm font-bold ${Number(totals.utilityPaid || 0) > 0 ? "text-emerald-700" : "text-slate-400"}`}>
                        {Number(totals.utilityPaid || 0) > 0 ? currency(totals.utilityPaid) : "—"}
                      </p>
                    </div>
                    {/* Expenses */}
                    <div className="px-3 py-2">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Expenses</p>
                      <p className={`mt-1 text-sm font-bold ${Number(totals.expenses || 0) > 0 ? "text-amber-700" : "text-slate-400"}`}>
                        {Number(totals.expenses || 0) > 0 ? currency(totals.expenses) : "—"}
                      </p>
                    </div>
                    {/* Net to Landlord */}
                    <div className={`px-3 py-2 ${settlement.isNegative ? "bg-red-50" : "bg-[#0B3B2E]"}`}>
                      <p className={`text-[9px] font-bold uppercase tracking-widest ${settlement.isNegative ? "text-red-500" : "text-green-200/60"}`}>
                        Net to Landlord
                      </p>
                      <p className={`mt-1 text-base font-black ${settlement.isNegative ? "text-red-700" : "text-white"}`}>
                        {currency(settlement.amount)}
                      </p>
                      <p className={`text-[9px] ${settlement.isNegative ? "text-red-400" : "text-green-200/40"}`}>
                        {settlement.isNegative ? settlement.label : "Incl. b/f balances"}
                      </p>
                    </div>
                  </div>
                  {directToLandlordAmount > 0 && (
                    <div className="border-t border-[#0B3B2E]/20 bg-[#EDF5F1] px-3 py-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-4 text-xs">
                          <span className="text-slate-600">
                            Manager transfers: <strong className="text-slate-900">{currency(Math.max(0, settlement.amount))}</strong>
                          </span>
                          <span className="text-slate-400">+</span>
                          <span className="text-slate-600">
                            Already with you: <strong className="text-[#0B3B2E]">{currency(directToLandlordAmount)}</strong>
                          </span>
                        </div>
                        <div className="text-right">
                          <p className="text-[9px] font-black uppercase tracking-widest text-[#0B3B2E]">Total Income This Period</p>
                          <p className="text-base font-black text-[#0B3B2E]">{currency(Math.max(0, settlement.amount) + directToLandlordAmount)}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

            )}
          </>
        )}
      </div>

      <PdfPreviewModal
        open={pdfPreviewOpen}
        statementId={draftStatement?._id || ""}
        propertyLabel={selectedProperty ? getPropertyLabel(selectedProperty) : ""}
        periodStart={periodStart}
        periodEnd={periodEnd}
        onClose={handlePdfPreviewClose}
      />
    </DashboardLayout>
  );
};

export default Statements;