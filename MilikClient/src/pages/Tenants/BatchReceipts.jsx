import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import {
  FaArrowLeft,
  FaBolt,
  FaCheckCircle,
  FaCheckSquare,
  FaListAlt,
  FaMobileAlt,
  FaReceipt,
  FaSpinner,
  FaSquare,
  FaTimesCircle,
} from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { adminRequests } from "../../utils/requestMethods";
import { getTenants, getChartOfAccounts } from "../../redux/apiCalls";
import { getProperties } from "../../redux/propertyRedux";
import { useTabState } from "../../hooks/useTabState";

const MONTHS = [
  { value: 1,  label: "January"   }, { value: 2,  label: "February"  }, { value: 3,  label: "March"     },
  { value: 4,  label: "April"     }, { value: 5,  label: "May"        }, { value: 6,  label: "June"      },
  { value: 7,  label: "July"      }, { value: 8,  label: "August"     }, { value: 9,  label: "September" },
  { value: 10, label: "October"   }, { value: 11, label: "November"   }, { value: 12, label: "December"  },
];

const METHODS = [
  { value: "mobile_money", label: "M-Pesa / Mobile Money" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "cash",          label: "Cash" },
  { value: "check",         label: "Cheque" },
];

const fmt = (v) =>
  Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");

const today = new Date();
const DEFAULT_SHARED = {
  cashbook:             "",
  paymentMethod:        "mobile_money",
  paymentDate:          today.toISOString().slice(0, 10),
  month:                today.getMonth() + 1,
  year:                 today.getFullYear(),
  paidDirectToLandlord: false,
};

// ─── Main ──────────────────────────────────────────────────────────────────────
const BatchReceipts = () => {
  const dispatch      = useDispatch();
  const navigate      = useNavigate();
  const company       = useSelector((s) => s.company?.currentCompany);
  const allTenants    = useSelector((s) => s.tenant?.tenants || []);
  const allProperties = useSelector((s) => s.property?.properties || []);
  const businessId    = company?._id;

  // ── Tab ───────────────────────────────────────────────────────────────────────
  const [tab, setTab] = useTabState("/receipts/batch:tab", "mpesa");

  // ── Shared fields ─────────────────────────────────────────────────────────────
  const [shared, setShared]           = useState(DEFAULT_SHARED);
  const [cashbookOptions, setCashbookOptions] = useState([]);
  const setSharedField = useCallback((f, v) => setShared((p) => ({ ...p, [f]: v })), []);

  // ── M-Pesa state ──────────────────────────────────────────────────────────────
  const [collections, setCollections] = useState([]);
  const [colLoading,  setColLoading]  = useState(false);
  const [mpesaSel,    setMpesaSel]    = useState(new Set());
  const [mpesaDateFrom, setMpesaDateFrom]         = useState("");
  const [mpesaDateTo,   setMpesaDateTo]           = useState("");
  const [mpesaPropertyFilter, setMpesaPropertyFilter] = useState("");

  // ── Manual state ──────────────────────────────────────────────────────────────
  const [propertyId,  setPropertyId]  = useTabState("/receipts/batch:property", "");
  const [manualRows,  setManualRows]  = useState({});

  // ── Submission ────────────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [results,    setResults]    = useState(null);

  // ── Bootstrap data ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!businessId) return;
    getChartOfAccounts({ business: businessId, type: "asset", isPosting: true })
      .then((list) => setCashbookOptions(list.filter((a) => !a.isHeader)))
      .catch(() => {});
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return;
    if (!allTenants.length)    getTenants(dispatch, businessId, "active");
    if (!allProperties.length) dispatch(getProperties({ business: businessId }));
  }, [businessId, dispatch, allTenants.length, allProperties.length]);

  // ── Fetch M-Pesa collections ──────────────────────────────────────────────────
  const loadCollections = useCallback(async () => {
    if (!businessId) return;
    setColLoading(true);
    try {
      const params = new URLSearchParams({ business: businessId, matchingStatus: "matched_tenant", limit: "200" });
      if (mpesaDateFrom) params.set("dateFrom", mpesaDateFrom);
      if (mpesaDateTo)   params.set("dateTo",   mpesaDateTo);
      const { data } = await adminRequests.get(`/mpesa-collections?${params}`);
      const rows = data?.collections || data?.data || [];
      setCollections(rows);
      setMpesaSel(new Set(rows.map((r) => String(r._id))));
    } catch {
      toast.error("Failed to load M-Pesa collections.");
    } finally {
      setColLoading(false);
    }
  }, [businessId, mpesaDateFrom, mpesaDateTo]);

  useEffect(() => { if (tab === "mpesa") loadCollections(); }, [tab, loadCollections]);

  // ── Derived: unique properties from M-Pesa collection tenants ────────────────
  const mpesaPropertyOptions = useMemo(() => {
    const seen = new Map();
    collections.forEach((c) => {
      const t = c.tenant;
      if (!t) return;
      const propId   = t.unit?.property?._id || t.unit?.property;
      const propName = t.unit?.property?.propertyName || t.unit?.property?.name;
      if (propId && propName && !seen.has(String(propId))) seen.set(String(propId), propName);
    });
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [collections]);

  const filteredCollections = useMemo(() => {
    if (!mpesaPropertyFilter) return collections;
    return collections.filter((c) => {
      const pid = c.tenant?.unit?.property?._id || c.tenant?.unit?.property;
      return String(pid) === mpesaPropertyFilter;
    });
  }, [collections, mpesaPropertyFilter]);

  // ── Tenants for manual property ───────────────────────────────────────────────
  const propertyTenants = useMemo(() => {
    if (!propertyId) return [];
    return allTenants.filter((t) => {
      const pid = t.unit?.property?._id || t.unit?.property;
      return String(pid) === String(propertyId);
    });
  }, [allTenants, propertyId]);

  useEffect(() => { setManualRows({}); }, [propertyId]);

  // ── M-Pesa toggle ─────────────────────────────────────────────────────────────
  const toggleMpesa = useCallback((id) => {
    setMpesaSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleAllMpesa = useCallback(() => {
    const eligible = filteredCollections.map((c) => String(c._id));
    const allSel   = eligible.length > 0 && eligible.every((id) => mpesaSel.has(id));
    setMpesaSel((prev) => {
      const next = new Set(prev);
      if (allSel) eligible.forEach((id) => next.delete(id));
      else        eligible.forEach((id) => next.add(id));
      return next;
    });
  }, [filteredCollections, mpesaSel]);

  // ── Manual toggle ─────────────────────────────────────────────────────────────
  const setManualRow = useCallback((tenantId, field, value) => {
    setManualRows((prev) => ({
      ...prev,
      [tenantId]: { checked: false, amount: "", refNumber: "", notes: "", ...prev[tenantId], [field]: value },
    }));
  }, []);

  const toggleManualRow = useCallback((id) => {
    setManualRows((prev) => ({
      ...prev,
      [id]: { amount: "", refNumber: "", notes: "", ...prev[id], checked: !prev[id]?.checked },
    }));
  }, []);

  const toggleAllManual = useCallback(() => {
    const anyChecked = propertyTenants.some((t) => manualRows[String(t._id)]?.checked);
    setManualRows((prev) => {
      const next = { ...prev };
      propertyTenants.forEach((t) => {
        const id = String(t._id);
        next[id] = { amount: "", refNumber: "", notes: "", ...next[id], checked: !anyChecked };
      });
      return next;
    });
  }, [propertyTenants, manualRows]);

  // Quick-fill all outstanding balances and select tenants
  const quickFillBalance = useCallback(() => {
    let filled = 0;
    setManualRows((prev) => {
      const next = { ...prev };
      propertyTenants.forEach((t) => {
        const id      = String(t._id);
        const balance = Number(t.balance || 0);
        if (balance > 0.009) {
          next[id] = { refNumber: "", notes: "", ...next[id], checked: true, amount: String(balance.toFixed(2)) };
          filled++;
        }
      });
      return next;
    });
    if (filled > 0)
      toast.info(`Filled ${filled} tenant${filled !== 1 ? "s" : ""} with outstanding balance. Add reference numbers to post.`);
    else
      toast.info("No tenants with outstanding balance found.");
  }, [propertyTenants]);

  const fillOneBalance = useCallback((id, amount) => {
    setManualRows((prev) => ({
      ...prev,
      [id]: { refNumber: "", notes: "", ...prev[id], checked: true, amount: String(amount) },
    }));
  }, []);

  // ── Derived summary ───────────────────────────────────────────────────────────
  const mpesaSelected = useMemo(
    () => collections.filter((c) => mpesaSel.has(String(c._id))),
    [collections, mpesaSel]
  );
  const mpesaTotal = useMemo(
    () => collections.reduce((s, c) => s + Number(c.amount || 0), 0),
    [collections]
  );

  const manualSelected = useMemo(
    () => propertyTenants.filter((t) => {
      const r = manualRows[String(t._id)];
      return r?.checked && Number(r?.amount) > 0 && r?.refNumber?.trim();
    }),
    [propertyTenants, manualRows]
  );

  const selectedCount = tab === "mpesa" ? mpesaSelected.length : manualSelected.length;
  const selectedTotal = tab === "mpesa"
    ? mpesaSelected.reduce((s, c) => s + Number(c.amount || 0), 0)
    : manualSelected.reduce((s, t) => s + Number(manualRows[String(t._id)]?.amount || 0), 0);

  // ── Build items ───────────────────────────────────────────────────────────────
  const buildItems = () => {
    if (tab === "mpesa") {
      return mpesaSelected.map((col) => {
        const t = col.tenant;
        return {
          tenant:          t?._id || t,
          unit:            t?.unit?._id || t?.unit,
          amount:          col.amount,
          referenceNumber: col.transactionCode || String(col._id),
          collectionId:    col._id,
          description:     `M-Pesa: ${col.payerName || col.msisdn || ""}`.trim(),
        };
      });
    }
    return manualSelected.map((t) => {
      const row = manualRows[String(t._id)];
      const item = {
        tenant:          t._id,
        unit:            t.unit?._id || t.unit,
        amount:          Number(row.amount),
        referenceNumber: row.refNumber.trim(),
        description:     row.notes || "",
      };
      if (row.directToLandlord != null) item.paidDirectToLandlord = !!row.directToLandlord;
      return item;
    });
  };

  // ── Submit ────────────────────────────────────────────────────────────────────
  const handlePost = async () => {
    if (!shared.paidDirectToLandlord && !shared.cashbook) return toast.warn("Select a cashbook account.");
    if (!shared.paymentDate) return toast.warn("Payment date is required.");
    if (!selectedCount)      return toast.warn("No valid items selected.");
    setSubmitting(true);
    setResults(null);
    try {
      const { data } = await adminRequests.post("/rent-payments/batch", { ...shared, items: buildItems() });
      setResults(data);
      if (data.totalPosted > 0) {
        toast.success(`${data.totalPosted} receipt(s) posted successfully.`);
        if (tab === "mpesa") {
          const posted = new Set(data.succeeded.map((s) => s.referenceNumber));
          setCollections((prev) => prev.filter((c) => !posted.has(c.transactionCode)));
          setMpesaSel(new Set());
        } else {
          const posted = new Set(data.succeeded.map((s) => s.tenantId));
          setManualRows((prev) => {
            const next = { ...prev };
            posted.forEach((id) => delete next[id]);
            return next;
          });
        }
      }
      if (data.totalFailed > 0) toast.warn(`${data.totalFailed} item(s) failed — see results below.`);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Batch posting failed.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Derived booleans ──────────────────────────────────────────────────────────
  const allFilteredSel  = filteredCollections.length > 0 && filteredCollections.every((c) => mpesaSel.has(String(c._id)));
  const allManualChecked = propertyTenants.length > 0 && propertyTenants.every((t) => manualRows[String(t._id)]?.checked);
  const postedTotal     = results?.succeeded.reduce((s, r) => s + (r.amount || 0), 0) || 0;

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <DashboardLayout>
      <div className="flex flex-col">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <button
            onClick={() => navigate("/receipts")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition"
          >
            <FaArrowLeft size={11} />
          </button>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">Receipts · Batch Entry</p>
            <h1 className="text-[18px] font-black leading-tight text-slate-900">Batch Receipt Entry</h1>
          </div>
        </div>

        {/* ── Shared defaults bar ──────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-slate-50/70 px-4 py-2.5">
          <span className="shrink-0 text-[10px] font-black uppercase tracking-widest text-slate-400">Defaults</span>

          {!shared.paidDirectToLandlord ? (
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] font-semibold text-slate-500">Cashbook</label>
              <select
                value={shared.cashbook}
                onChange={(e) => setSharedField("cashbook", e.target.value)}
                className={`h-7 rounded border px-2 text-[11px] text-slate-800 focus:outline-none focus:border-emerald-500 ${
                  !shared.cashbook ? "border-rose-300 bg-rose-50/50" : "border-slate-200 bg-white"
                }`}
              >
                <option value="">— Required —</option>
                {cashbookOptions.map((a) => <option key={a._id} value={a.name}>{a.name}</option>)}
              </select>
            </div>
          ) : (
            <span className="rounded border border-[#0B3B2E]/20 bg-[#0B3B2E]/8 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[#0B3B2E]">
              Direct to Landlord — no cashbook entry
            </span>
          )}

          <div className="flex items-center gap-1.5">
            <label className="text-[10px] font-semibold text-slate-500">Method</label>
            <select
              value={shared.paymentMethod}
              onChange={(e) => setSharedField("paymentMethod", e.target.value)}
              className="h-7 rounded border border-slate-200 bg-white px-2 text-[11px] text-slate-800 focus:border-emerald-500 focus:outline-none"
            >
              {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <label className="text-[10px] font-semibold text-slate-500">Date</label>
            <input
              type="date"
              value={shared.paymentDate}
              onChange={(e) => setSharedField("paymentDate", e.target.value)}
              className="h-7 rounded border border-slate-200 bg-white px-2 text-[11px] text-slate-800 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <label className="text-[10px] font-semibold text-slate-500">Period</label>
            <select
              value={shared.month}
              onChange={(e) => setSharedField("month", Number(e.target.value))}
              className="h-7 rounded border border-slate-200 bg-white px-2 text-[11px] text-slate-800 focus:border-emerald-500 focus:outline-none"
            >
              {MONTHS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <input
              type="number"
              value={shared.year}
              min={2000} max={2099}
              onChange={(e) => setSharedField("year", Number(e.target.value))}
              className="h-7 w-20 rounded border border-slate-200 bg-white px-2 text-[11px] text-slate-800 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <label className="ml-auto flex cursor-pointer items-center gap-2 text-[11px] font-bold text-slate-600">
            <input
              type="checkbox"
              checked={!!shared.paidDirectToLandlord}
              onChange={(e) =>
                setShared((prev) => ({
                  ...prev,
                  paidDirectToLandlord: e.target.checked,
                  cashbook: e.target.checked ? "" : prev.cashbook,
                }))
              }
              className="h-3.5 w-3.5 rounded border-slate-300 text-[#0B3B2E] focus:ring-[#0B3B2E]"
            />
            Direct to Landlord
          </label>
        </div>

        {/* ── Tab bar ──────────────────────────────────────────────────────── */}
        <div className="border-b border-slate-200 bg-white px-4">
          <div className="flex">
            {[
              { key: "mpesa",  icon: <FaMobileAlt size={10} />, label: "M-Pesa Collections", count: collections.length },
              { key: "manual", icon: <FaListAlt   size={10} />, label: "Manual / Cash Entry",  count: propertyId ? propertyTenants.length : null },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => { setTab(t.key); setResults(null); }}
                className={`relative flex items-center gap-2 px-4 py-3 text-[12px] font-bold transition-colors ${
                  tab === t.key
                    ? "text-[#0B3B2E] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-[#0B3B2E] after:content-['']"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {t.icon}
                {t.label}
                {t.count != null && t.count > 0 && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-black leading-none ${
                    tab === t.key ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"
                  }`}>
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* ── Page content ─────────────────────────────────────────────────── */}
        <div className="px-4 py-4">

          {/* ─── M-Pesa tab ───────────────────────────────────────────────── */}
          {tab === "mpesa" && (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">

              {/* Filter bar */}
              <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
                <div className="flex items-center gap-1.5">
                  <label className="text-[10px] font-semibold text-slate-500">From</label>
                  <input type="date" value={mpesaDateFrom} onChange={(e) => setMpesaDateFrom(e.target.value)}
                    className="h-7 rounded border border-slate-200 bg-white px-2 text-[11px] focus:border-emerald-500 focus:outline-none" />
                </div>
                <div className="flex items-center gap-1.5">
                  <label className="text-[10px] font-semibold text-slate-500">To</label>
                  <input type="date" value={mpesaDateTo} onChange={(e) => setMpesaDateTo(e.target.value)}
                    className="h-7 rounded border border-slate-200 bg-white px-2 text-[11px] focus:border-emerald-500 focus:outline-none" />
                </div>
                {mpesaPropertyOptions.length > 1 && (
                  <select
                    value={mpesaPropertyFilter}
                    onChange={(e) => setMpesaPropertyFilter(e.target.value)}
                    className="h-7 rounded border border-slate-200 bg-white px-2 text-[11px] text-slate-700 focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="">All Properties</option>
                    {mpesaPropertyOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )}
                <button
                  onClick={loadCollections}
                  disabled={colLoading}
                  className="flex h-7 items-center gap-1.5 rounded border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition"
                >
                  {colLoading && <FaSpinner className="animate-spin" size={9} />}
                  {colLoading ? "Loading…" : "Refresh"}
                </button>
                <span className="ml-auto text-[11px] text-slate-400">
                  Showing tenant-matched rows.{" "}
                  <button onClick={() => navigate("/receipts/mpesa-collections")} className="text-emerald-700 hover:underline">
                    Assign unmatched →
                  </button>
                </span>
              </div>

              {/* Stats strip */}
              {!colLoading && collections.length > 0 && (
                <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-2 text-[12px]">
                  <span className="text-slate-600">
                    <span className="font-bold text-slate-900">{collections.length}</span> available
                  </span>
                  <span className="text-slate-300">·</span>
                  <span className="text-slate-600">
                    KES <span className="font-bold text-slate-900">{fmt(mpesaTotal)}</span>
                  </span>
                  {mpesaSelected.length > 0 && (
                    <>
                      <span className="text-slate-300">·</span>
                      <span className="font-black text-emerald-700">
                        {mpesaSelected.length} selected · KES {fmt(selectedTotal)}
                      </span>
                      <button
                        onClick={() => setMpesaSel(new Set())}
                        className="ml-auto text-[11px] text-slate-400 hover:text-rose-500 hover:underline"
                      >
                        Clear selection
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[780px] border-collapse text-[12px]">
                  <thead>
                    <tr className="bg-[#0B3B2E] text-[11px] text-white">
                      <th className="w-10 px-3 py-2 text-left">
                        <button onClick={toggleAllMpesa} className="text-white/70 hover:text-white">
                          {allFilteredSel ? <FaCheckSquare size={13} /> : <FaSquare size={13} />}
                        </button>
                      </th>
                      <th className="border-r border-white/10 px-3 py-2 text-left font-bold">Date</th>
                      <th className="border-r border-white/10 px-3 py-2 text-right font-bold">Amount</th>
                      <th className="border-r border-white/10 px-3 py-2 text-left font-bold">M-Pesa Code</th>
                      <th className="border-r border-white/10 px-3 py-2 text-left font-bold">Payer</th>
                      <th className="border-r border-white/10 px-3 py-2 text-left font-bold">Account Ref</th>
                      <th className="border-r border-white/10 px-3 py-2 text-left font-bold">Property</th>
                      <th className="px-3 py-2 text-left font-bold">Tenant · Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {colLoading ? (
                      <tr>
                        <td colSpan={8} className="py-14 text-center text-slate-400">
                          <FaSpinner className="inline animate-spin mr-2" size={14} /> Loading M-Pesa collections…
                        </td>
                      </tr>
                    ) : filteredCollections.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-14 text-center">
                          <p className="text-[13px] font-bold text-slate-400">
                            {collections.length > 0 ? "No collections match the filter." : "No matched M-Pesa transactions."}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-400">
                            Assign incoming M-Pesa payments to tenants first, then return here to batch-receipt.
                          </p>
                          <button
                            onClick={() => navigate("/receipts/mpesa-collections")}
                            className="mt-3 rounded-lg bg-[#0B3B2E] px-4 py-1.5 text-[11px] font-bold text-white hover:bg-[#0d4a38]"
                          >
                            Go to M-Pesa Collections →
                          </button>
                        </td>
                      </tr>
                    ) : (
                      filteredCollections.map((col, idx) => {
                        const id      = String(col._id);
                        const sel     = mpesaSel.has(id);
                        const tenant  = col.tenant;
                        const propName = tenant?.unit?.property?.propertyName || tenant?.unit?.property?.name || "—";
                        const unitNo   = tenant?.unit?.unitNumber || "";
                        return (
                          <tr
                            key={id}
                            onClick={() => toggleMpesa(id)}
                            className={`cursor-pointer border-b border-gray-100 transition-colors ${
                              sel
                                ? "bg-emerald-50/85 shadow-[inset_4px_0_0_0_#0B3B2E] hover:bg-emerald-50"
                                : idx % 2 === 0 ? "bg-white hover:bg-blue-50/30" : "bg-slate-50/50 hover:bg-blue-50/30"
                            }`}
                          >
                            <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                              <button onClick={() => toggleMpesa(id)}>
                                {sel ? <FaCheckSquare className="text-emerald-700" size={13} /> : <FaSquare className="text-slate-300" size={13} />}
                              </button>
                            </td>
                            <td className="whitespace-nowrap border-r border-gray-100 px-3 py-1.5 text-slate-600">{fmtDate(col.transactionDate)}</td>
                            <td className="border-r border-gray-100 px-3 py-1.5 text-right font-mono font-black text-slate-900">{fmt(col.amount)}</td>
                            <td className="border-r border-gray-100 px-3 py-1.5">
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-700">
                                {col.transactionCode || "—"}
                              </span>
                            </td>
                            <td className="border-r border-gray-100 px-3 py-1.5 text-slate-700">{col.payerName || col.msisdn || "—"}</td>
                            <td className="border-r border-gray-100 px-3 py-1.5 text-slate-500">{col.accountReference || col.billRefNumber || "—"}</td>
                            <td className="border-r border-gray-100 px-3 py-1.5 text-slate-600">{propName}</td>
                            <td className="px-3 py-1.5">
                              {tenant ? (
                                <span>
                                  <span className="font-semibold text-slate-900">{tenant.name || "—"}</span>
                                  {unitNo && <span className="ml-1.5 text-[10px] text-slate-400">· {unitNo}</span>}
                                </span>
                              ) : (
                                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-600">
                                  Unmatched
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ─── Manual tab ───────────────────────────────────────────────── */}
          {tab === "manual" && (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">

              {/* Toolbar */}
              <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
                <select
                  value={propertyId}
                  onChange={(e) => setPropertyId(e.target.value)}
                  className="h-7 rounded border border-slate-200 bg-white px-2 text-[11px] text-slate-800 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="">— Select Property —</option>
                  {allProperties.map((p) => (
                    <option key={p._id} value={p._id}>{p.propertyName || p.name}</option>
                  ))}
                </select>

                {propertyId && propertyTenants.length > 0 && (
                  <button
                    onClick={quickFillBalance}
                    className="flex h-7 items-center gap-1.5 rounded border border-amber-300 bg-amber-50 px-3 text-[11px] font-bold text-amber-800 hover:bg-amber-100 transition"
                  >
                    <FaBolt size={9} /> Select All + Fill Balance
                  </button>
                )}

                {propertyId && (
                  <span className="text-[11px] text-slate-400">
                    {propertyTenants.length} tenant{propertyTenants.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>

              {/* Stats strip */}
              {propertyId && manualSelected.length > 0 && (
                <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-2 text-[12px]">
                  <span className="font-black text-emerald-700">
                    {manualSelected.length} selected · KES {fmt(selectedTotal)}
                  </span>
                  <button
                    onClick={() => setManualRows({})}
                    className="ml-auto text-[11px] text-slate-400 hover:text-rose-500 hover:underline"
                  >
                    Clear all
                  </button>
                </div>
              )}

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] border-collapse text-[12px]">
                  <thead>
                    <tr className="bg-[#0B3B2E] text-[11px] text-white">
                      <th className="w-10 px-3 py-2 text-left">
                        <button onClick={toggleAllManual} disabled={!propertyTenants.length} className="text-white/70 hover:text-white disabled:opacity-30">
                          {allManualChecked ? <FaCheckSquare size={13} /> : <FaSquare size={13} />}
                        </button>
                      </th>
                      <th className="border-r border-white/10 px-3 py-2 text-left font-bold">Unit</th>
                      <th className="border-r border-white/10 px-3 py-2 text-left font-bold">Tenant</th>
                      <th className="border-r border-white/10 px-3 py-2 text-right font-bold">Balance</th>
                      <th className="w-32 border-r border-white/10 px-3 py-2 text-right font-bold">Amount *</th>
                      <th className="w-44 border-r border-white/10 px-3 py-2 text-left font-bold">Reference No. *</th>
                      <th className="border-r border-white/10 px-3 py-2 text-left font-bold">Notes</th>
                      <th className="w-20 px-3 py-2 text-center font-bold" title="Direct to Landlord">→ LL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!propertyId ? (
                      <tr>
                        <td colSpan={8} className="py-14 text-center">
                          <p className="text-[13px] font-bold text-slate-400">Select a property to load tenants</p>
                          <p className="mt-1 text-[11px] text-slate-400">Choose from the dropdown above to see active tenants.</p>
                        </td>
                      </tr>
                    ) : propertyTenants.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-10 text-center text-[12px] text-slate-400">
                          No active tenants for this property.
                        </td>
                      </tr>
                    ) : (
                      propertyTenants.map((t, idx) => {
                        const id      = String(t._id);
                        const row     = manualRows[id] || {};
                        const checked = !!row.checked;
                        const balance = Number(t.balance || 0);
                        const amtErr  = checked && !Number(row.amount);
                        const refErr  = checked && !row.refNumber?.trim();
                        return (
                          <tr
                            key={id}
                            className={`border-b border-gray-100 transition-colors ${
                              checked
                                ? "bg-emerald-50/85 shadow-[inset_4px_0_0_0_#0B3B2E]"
                                : idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"
                            }`}
                          >
                            <td className="px-3 py-1.5">
                              <button onClick={() => toggleManualRow(id)}>
                                {checked
                                  ? <FaCheckSquare className="text-emerald-700" size={13} />
                                  : <FaSquare className="text-slate-300" size={13} />}
                              </button>
                            </td>
                            <td className="border-r border-gray-100 px-3 py-1.5 font-mono text-[11px] font-bold text-slate-600">
                              {t.unit?.unitNumber || "—"}
                            </td>
                            <td className="border-r border-gray-100 px-3 py-1.5 font-semibold text-slate-900">{t.name}</td>
                            <td className="border-r border-gray-100 px-3 py-1.5 text-right">
                              {balance > 0.009 ? (
                                <button
                                  onClick={() => fillOneBalance(id, balance.toFixed(2))}
                                  title="Click to fill this amount"
                                  className="font-mono text-[11px] font-black text-rose-600 hover:text-rose-700 hover:underline"
                                >
                                  {fmt(balance)}
                                </button>
                              ) : balance < -0.009 ? (
                                <span className="font-mono text-[11px] font-bold text-emerald-600">
                                  CR {fmt(Math.abs(balance))}
                                </span>
                              ) : (
                                <span className="text-[11px] text-slate-400">—</span>
                              )}
                            </td>
                            <td className="border-r border-gray-100 px-3 py-1.5">
                              <input
                                type="number"
                                min={0}
                                placeholder="0.00"
                                value={row.amount || ""}
                                onChange={(e) => setManualRow(id, "amount", e.target.value)}
                                onFocus={() => !checked && toggleManualRow(id)}
                                className={`w-full rounded border px-2 py-1 text-right font-mono text-[12px] focus:outline-none transition ${
                                  amtErr ? "border-rose-300 bg-rose-50/50 focus:border-rose-400" : "border-slate-200 focus:border-emerald-500"
                                }`}
                              />
                            </td>
                            <td className="border-r border-gray-100 px-3 py-1.5">
                              <input
                                type="text"
                                placeholder="Ref / Cheque no."
                                value={row.refNumber || ""}
                                onChange={(e) => setManualRow(id, "refNumber", e.target.value)}
                                onFocus={() => !checked && toggleManualRow(id)}
                                className={`w-full rounded border px-2 py-1 text-[12px] focus:outline-none transition ${
                                  refErr ? "border-rose-300 bg-rose-50/50 focus:border-rose-400" : "border-slate-200 focus:border-emerald-500"
                                }`}
                              />
                            </td>
                            <td className="border-r border-gray-100 px-3 py-1.5">
                              <input
                                type="text"
                                placeholder="Optional"
                                value={row.notes || ""}
                                onChange={(e) => setManualRow(id, "notes", e.target.value)}
                                className="w-full rounded border border-slate-200 px-2 py-1 text-[12px] focus:border-emerald-500 focus:outline-none"
                              />
                            </td>
                            <td className="px-3 py-1.5 text-center">
                              <input
                                type="checkbox"
                                checked={!!row.directToLandlord}
                                onChange={(e) => setManualRow(id, "directToLandlord", e.target.checked)}
                                title="Mark this receipt as Direct to Landlord"
                                className="h-3.5 w-3.5 rounded border-slate-300 text-[#0B3B2E] focus:ring-[#0B3B2E]"
                              />
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ─── Results panel ────────────────────────────────────────────── */}
          {results && (
            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className={`flex items-center gap-3 border-b px-4 py-3 ${
                results.totalFailed === 0 ? "border-emerald-100 bg-emerald-50" : "border-amber-100 bg-amber-50"
              }`}>
                {results.totalFailed === 0
                  ? <FaCheckCircle className="shrink-0 text-emerald-600" size={15} />
                  : <FaTimesCircle className="shrink-0 text-amber-600" size={15} />}
                <p className="font-bold text-slate-900">
                  {results.totalPosted} receipt{results.totalPosted !== 1 ? "s" : ""} posted
                  {results.totalFailed > 0 ? `, ${results.totalFailed} failed` : " successfully"}
                </p>
                <span className="ml-auto font-black text-[13px] text-[#0B3B2E]">
                  KES {fmt(postedTotal)}
                </span>
              </div>

              {results.failed.length > 0 && (
                <div className="border-b border-slate-100 px-4 py-3">
                  <p className="mb-2 text-[10px] font-black uppercase tracking-wider text-rose-600">Failed Items</p>
                  <div className="divide-y divide-rose-50 rounded-lg border border-rose-100 bg-rose-50/50 text-[12px]">
                    {results.failed.map((f, i) => (
                      <div key={i} className="flex items-start gap-2 px-3 py-1.5">
                        <FaTimesCircle className="mt-0.5 shrink-0 text-rose-400" size={11} />
                        <span className="font-mono text-rose-800">{f.referenceNumber || `Item ${f.index + 1}`}</span>
                        <span className="text-rose-600">— {f.error}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {results.succeeded.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[12px]">
                    <thead>
                      <tr className="bg-[#0B3B2E] text-[11px] text-white">
                        <th className="border-r border-white/10 px-3 py-2 text-left font-bold">Receipt No.</th>
                        <th className="border-r border-white/10 px-3 py-2 text-left font-bold">Reference</th>
                        <th className="border-r border-white/10 px-3 py-2 text-left font-bold">Tenant</th>
                        <th className="px-3 py-2 text-right font-bold">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.succeeded.map((s, i) => (
                        <tr key={i} className={`border-b border-gray-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}>
                          <td className="border-r border-gray-100 px-3 py-1.5 font-mono font-black text-emerald-700">{s.receiptNumber}</td>
                          <td className="border-r border-gray-100 px-3 py-1.5 font-mono text-slate-600">{s.referenceNumber}</td>
                          <td className="border-r border-gray-100 px-3 py-1.5 font-semibold text-slate-900">{s.tenantName}</td>
                          <td className="px-3 py-1.5 text-right font-mono font-black text-slate-900">{fmt(s.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Sticky action bar ────────────────────────────────────────────── */}
        <div className="sticky bottom-0 z-10 flex items-center justify-between border-t border-slate-200 bg-white px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
          <div className="flex items-center gap-4">
            {selectedCount > 0 ? (
              <>
                <span className="text-[13px] font-bold text-slate-700">
                  {selectedCount} receipt{selectedCount !== 1 ? "s" : ""} ready
                </span>
                <span className="text-[15px] font-black text-[#0B3B2E]">KES {fmt(selectedTotal)}</span>
              </>
            ) : (
              <span className="text-[12px] text-slate-400">
                {tab === "mpesa" ? "Select M-Pesa rows above to receipt" : "Select tenants and fill amounts to post"}
              </span>
            )}
          </div>
          <button
            onClick={handlePost}
            disabled={submitting || selectedCount === 0 || (!shared.paidDirectToLandlord && !shared.cashbook)}
            className="flex items-center gap-2 rounded-lg bg-[#0B3B2E] px-6 py-2 text-[13px] font-black text-white shadow hover:bg-[#0d4a38] disabled:cursor-not-allowed disabled:opacity-40 transition"
          >
            {submitting
              ? <><FaSpinner className="animate-spin" size={11} /> Posting…</>
              : <><FaReceipt size={11} /> Post {selectedCount > 0 ? selectedCount : ""} Receipt{selectedCount !== 1 ? "s" : ""}</>
            }
          </button>
        </div>

      </div>
    </DashboardLayout>
  );
};

export default BatchReceipts;
