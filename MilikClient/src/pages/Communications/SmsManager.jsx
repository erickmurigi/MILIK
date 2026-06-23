import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  FaSms, FaSpinner, FaSearch, FaSyncAlt, FaPaperPlane,
  FaTimesCircle, FaPlus, FaTimes, FaUsers, FaCheckCircle,
  FaChevronDown, FaChevronRight, FaEnvelope, FaExclamationTriangle,
  FaInbox, FaTrash,
} from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { adminRequests } from "../../utils/requestMethods";
import { hasCompanyModule } from "../../utils/companyModules";
import { carWashApi } from "../../services/carWashApi";
import { saleApi } from "../../services/propertySaleApi";
import { inventoryApi } from "../../services/inventoryApi";

const PAGE_SIZE = 50;

const TABS = [
  { key: "",        label: "All",     countKey: "all" },
  { key: "sent",    label: "Sent",    countKey: "sent" },
  { key: "failed",  label: "Failed",  countKey: "failed" },
  { key: "pending", label: "Pending", countKey: "pending" },
];

const STATUS_META = {
  sent:    { label: "Sent",    cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  failed:  { label: "Failed",  cls: "border-rose-200 bg-rose-50 text-rose-700" },
  pending: { label: "Pending", cls: "border-amber-200 bg-amber-50 text-amber-700" },
};

const TEMPLATE_LABELS = {
  carwash_job_manual:     "Job SMS",
  carwash_loyalty_manual: "Loyalty",
  carwash_loyalty_stamp:  "Stamp",
  carwash_loyalty_reward: "Reward",
  carwash_payment:        "Payment",
  carwash_job_ready:      "Ready",
  carwash_c2b_reply:      "C2B Reply",
  test_hashed_sms:        "Test",
  adhoc:                  "Ad-hoc",
  adhoc_masked:           "Ad-hoc",
  tenant_notice_sms:      "Notice",
  invoice_reminder:       "Invoice",
};

const lc  = "mb-1 block text-[10px] font-extrabold uppercase tracking-widest text-slate-500";
const ic  = "h-9 w-full border border-slate-300 bg-white px-2.5 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/20 transition";

const fmtTemplate = (key) => TEMPLATE_LABELS[key] || (key ? key.replace(/_/g, " ") : "—");

const fmtDateTime = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

const fmtRel = (v) => {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

const StatusChip = ({ status }) => {
  const meta = STATUS_META[status] || { label: status || "Unknown", cls: "border-slate-200 bg-slate-50 text-slate-500" };
  return (
    <span className={`inline-flex items-center border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${meta.cls}`}>
      {meta.label}
    </span>
  );
};

// Registry of all selectable contact types — built per-company based on enabled modules
const buildContactTypes = ({ hasPM, hasCarWash, hasHR, hasPropertySale, hasInventory }) => {
  const types = [];
  if (hasPM) {
    types.push({ key: "tenants",   label: "Tenants",        singular: "Tenant",   contextType: "tenant_bulk",          templateKey: "tenant_notice_sms",      phoneKey: "phone",  nameKey: "name" });
    types.push({ key: "landlords", label: "Landlords",      singular: "Landlord", contextType: "landlord_bulk",        templateKey: "landlord_notice_sms",    phoneKey: "phoneNumber", nameKey: "landlordName" });
  }
  if (hasCarWash)       types.push({ key: "cw_customers", label: "Car Wash Customers", singular: "Customer", contextType: "carwash_customer_bulk", templateKey: "carwash_notice_sms",     phoneKey: "phone",  nameKey: "name" });
  if (hasHR)            types.push({ key: "employees",    label: "Employees",          singular: "Employee", contextType: "hr_employee_bulk",      templateKey: "hr_employee_notice_sms", phoneKey: "phoneNumber", nameKey: "_fullName" });
  if (hasPropertySale) {
    types.push({ key: "buyers", label: "Property Buyers", singular: "Buyer", contextType: "sale_buyer_bulk",  templateKey: "sale_buyer_notice_sms",  phoneKey: "phone", nameKey: "fullName" });
    types.push({ key: "agents", label: "Sales Agents",    singular: "Agent", contextType: "sale_agent_bulk",  templateKey: "sale_agent_notice_sms",  phoneKey: "phone", nameKey: "fullName" });
  }
  if (hasInventory) types.push({ key: "suppliers", label: "Suppliers", singular: "Supplier", contextType: "inv_supplier_bulk", templateKey: "inv_supplier_notice_sms", phoneKey: "phone", nameKey: "name" });
  return types;
};

// Server-side search for each contact type (100 results per request)
const fetchContacts = async (key, businessId, search = "") => {
  const p = { limit: 100, ...(search ? { search } : {}) };
  switch (key) {
    case "tenants": {
      const res = await adminRequests.get("/tenants", { params: { business: businessId, ...p } });
      return Array.isArray(res?.data?.tenants) ? res.data.tenants : Array.isArray(res?.data) ? res.data : [];
    }
    case "landlords": {
      const res = await adminRequests.get("/landlords", { params: { business: businessId, ...p } });
      return Array.isArray(res?.data?.landlords) ? res.data.landlords : Array.isArray(res?.data) ? res.data : [];
    }
    case "cw_customers": {
      const res = await carWashApi.listLoyaltyCustomers(p);
      return Array.isArray(res?.customers) ? res.customers : Array.isArray(res) ? res : [];
    }
    case "employees": {
      const res = await adminRequests.get("/hr/employees", { params: p });
      const list = Array.isArray(res?.data?.employees) ? res.data.employees : Array.isArray(res?.data) ? res.data : [];
      return list.map(e => ({ ...e, _fullName: [e.name, e.surname].filter(Boolean).join(" ") }));
    }
    case "buyers": {
      const res = await saleApi.listBuyers(p);
      return Array.isArray(res?.data) ? res.data : [];
    }
    case "agents": {
      const res = await saleApi.listAgents(p);
      return Array.isArray(res?.data) ? res.data : [];
    }
    case "suppliers": {
      const res = await inventoryApi.listSuppliers(p);
      return Array.isArray(res) ? res : [];
    }
    default: return [];
  }
};

// ── Compose slide panel ────────────────────────────────────────────────────────
const ComposePanel = ({ open, onClose, businessId, hasPM, hasCarWash, hasHR, hasPropertySale, hasInventory, onSent }) => {
  const contactTypes = useMemo(
    () => buildContactTypes({ hasPM, hasCarWash, hasHR, hasPropertySale, hasInventory }),
    [hasPM, hasCarWash, hasHR, hasPropertySale, hasInventory]
  );

  const [selectedType,    setSelectedType]    = useState("manual");
  const [selectedIds,     setSelectedIds]     = useState([]);
  const [manualPhone,     setManualPhone]     = useState("");
  const [body,            setBody]            = useState("");
  const [sending,         setSending]         = useState(false);
  const [contactSearch,   setContactSearch]   = useState("");
  const [contacts,        setContacts]        = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);

  // Session-level cache: avoids re-fetching the same contact list if user switches type and back
  const cache = React.useRef(new Map());

  // Reset on panel open; clear cache so data is fresh each time panel opens
  useEffect(() => {
    if (open) {
      cache.current.clear();
      const first = contactTypes.length > 0 ? contactTypes[0].key : "manual";
      setSelectedType(first);
      setSelectedIds([]);
      setContactSearch("");
      setContacts([]);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load initial list when type changes (uses cache to avoid duplicate requests)
  useEffect(() => {
    if (!open || selectedType === "manual" || !businessId) return;
    setContactSearch("");
    setSelectedIds([]);

    const cached = cache.current.get(selectedType);
    if (cached) { setContacts(cached); return; }

    let mounted = true;
    setContactsLoading(true);
    setContacts([]);
    fetchContacts(selectedType, businessId)
      .then(list => {
        if (!mounted) return;
        cache.current.set(selectedType, list);
        setContacts(list);
      })
      .catch(() => { if (mounted) setContacts([]); })
      .finally(() => { if (mounted) setContactsLoading(false); });
    return () => { mounted = false; };
  }, [open, selectedType, businessId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced server-side search — runs on every search keystroke after 300ms
  useEffect(() => {
    if (selectedType === "manual" || !businessId) return;
    const q = contactSearch.trim();

    if (!q) {
      // Search cleared → restore cached initial list
      const cached = cache.current.get(selectedType);
      if (cached) setContacts(cached);
      return;
    }

    let mounted = true;
    const timer = setTimeout(() => {
      setContactsLoading(true);
      fetchContacts(selectedType, businessId, q)
        .then(list => { if (mounted) setContacts(list); })
        .catch(() => { if (mounted) setContacts([]); })
        .finally(() => { if (mounted) setContactsLoading(false); });
    }, 300);
    return () => { mounted = false; clearTimeout(timer); };
  }, [contactSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeTypeDef = contactTypes.find(t => t.key === selectedType);
  const nameKey       = activeTypeDef?.nameKey  || "name";
  const phoneKey      = activeTypeDef?.phoneKey || "phone";
  const singular      = activeTypeDef?.singular || "Contact";

  // Select-all helpers
  const allIds       = contacts.map(c => c._id);
  const allSelected  = allIds.length > 0 && allIds.every(id => selectedIds.includes(id));
  const someSelected = allIds.some(id => selectedIds.includes(id));
  const toggleAll    = () => {
    if (allSelected) setSelectedIds(prev => prev.filter(id => !allIds.includes(id)));
    else             setSelectedIds(prev => [...new Set([...prev, ...allIds])]);
  };

  const toggle = (id) => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const reset = () => { setSelectedIds([]); setManualPhone(""); setBody(""); setContactSearch(""); setSending(false); };
  const handleClose = () => { reset(); onClose(); };

  const smsCount         = Math.ceil(body.length / 160) || 1;
  const noPhoneCount     = selectedIds.filter(id => { const c = contacts.find(x => x._id === id); return c && !String(c[phoneKey] || "").trim(); }).length;

  const handleSend = async () => {
    if (!body.trim()) { toast.error("Message body is required."); return; }
    if (selectedType === "manual" && !manualPhone.trim()) { toast.error("Enter a phone number."); return; }
    if (selectedType !== "manual" && selectedIds.length === 0) { toast.error(`Select at least one ${singular.toLowerCase()}.`); return; }
    setSending(true);
    try {
      if (selectedType === "manual") {
        await adminRequests.post("/communications/test-sms", { business: businessId, phone: manualPhone.trim(), message: body.trim() });
      } else {
        await adminRequests.post("/communications/send", {
          business: businessId,
          contextType: activeTypeDef.contextType,
          channel: "sms",
          templateKey: activeTypeDef.templateKey,
          recordIds: selectedIds,
          customBody: body.trim(),
        });
      }
      toast.success("SMS sent successfully.");
      onSent();
      handleClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to send SMS.");
    } finally { setSending(false); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex">
      <div className="absolute inset-0 bg-black/40" onClick={handleClose} />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-[480px] flex-col bg-white shadow-2xl">

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between bg-[#0B3B2E] px-5 py-3.5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#B7C9C0]">Compose</p>
            <p className="mt-0.5 text-sm font-extrabold text-white">New SMS</p>
          </div>
          <button onClick={handleClose} className="flex h-7 w-7 items-center justify-center bg-white/10 text-white/80 hover:bg-white/20 transition">
            <FaTimes size={12} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* Send To dropdown — scales to any number of modules */}
          <div>
            <label className={lc}>Send To</label>
            <div className="relative">
              <select
                value={selectedType}
                onChange={e => setSelectedType(e.target.value)}
                className="h-9 w-full appearance-none border border-slate-300 bg-white pl-3 pr-8 text-xs font-bold text-slate-800 focus:border-[#0B3B2E] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/20 transition"
              >
                {contactTypes.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                <option value="manual">Manual Phone Number</option>
              </select>
              <FaChevronDown size={9} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
          </div>

          {selectedType === "manual" ? (
            <div>
              <label className={lc}>Phone Number</label>
              <input value={manualPhone} onChange={e => setManualPhone(e.target.value)}
                placeholder="+254 7XX XXX XXX" className={ic} />
            </div>
          ) : (
            <div>
              {/* Header row: label + select-all + count + clear */}
              <div className="flex items-center gap-2 mb-1.5">
                <button
                  onClick={toggleAll}
                  disabled={contacts.length === 0 || contactsLoading}
                  className={`flex h-5 w-5 shrink-0 items-center justify-center border-2 transition disabled:opacity-30 ${
                    allSelected ? "border-[#0B3B2E] bg-[#0B3B2E]" : someSelected ? "border-[#0B3B2E] bg-[#0B3B2E]/20" : "border-slate-300"
                  }`}
                  title={allSelected ? "Deselect all" : "Select all"}
                >
                  {allSelected && <FaCheckCircle size={9} className="text-white" />}
                </button>
                <label className={lc + " mb-0 cursor-pointer"} onClick={toggleAll}>{singular}s</label>
                {selectedIds.length > 0 && (
                  <>
                    <span className="border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9px] font-bold text-emerald-700">
                      {selectedIds.length} selected
                    </span>
                    <button onClick={() => setSelectedIds([])} className="ml-auto text-[10px] font-bold text-rose-500 hover:text-rose-700">
                      Clear
                    </button>
                  </>
                )}
              </div>

              {/* Search — debounced, server-side */}
              <div className="mb-2 flex items-center gap-2 border border-slate-300 px-3 py-2">
                <FaSearch size={10} className="text-slate-400 shrink-0" />
                <input
                  value={contactSearch}
                  onChange={e => setContactSearch(e.target.value)}
                  placeholder={`Search ${singular.toLowerCase()}s…`}
                  className="flex-1 bg-transparent text-xs outline-none text-slate-700 placeholder-slate-400"
                />
                {contactSearch && (
                  <button onClick={() => setContactSearch("")} className="text-slate-400 hover:text-slate-600">
                    <FaTimesCircle size={10} />
                  </button>
                )}
                {contactsLoading && <FaSpinner size={10} className="animate-spin text-slate-400 shrink-0" />}
              </div>

              {/* Contact list */}
              <div className="max-h-[200px] overflow-y-auto border border-slate-200 divide-y divide-slate-100">
                {!contactsLoading && contacts.length === 0 ? (
                  <div className="py-5 text-center text-xs text-slate-400">
                    {contactSearch ? `No ${singular.toLowerCase()}s matching "${contactSearch}"` : `No ${singular.toLowerCase()}s found`}
                  </div>
                ) : contacts.map(c => {
                  const id    = c._id;
                  const name  = String(c[nameKey] || singular);
                  const phone = String(c[phoneKey] || "").trim();
                  const sel   = selectedIds.includes(id);
                  return (
                    <button key={id} onClick={() => toggle(id)}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-left transition ${sel ? "bg-[#EDF5F1]" : "hover:bg-slate-50"}`}
                    >
                      <div className={`flex h-5 w-5 shrink-0 items-center justify-center border-2 transition ${sel ? "border-[#0B3B2E] bg-[#0B3B2E]" : "border-slate-300"}`}>
                        {sel && <FaCheckCircle size={9} className="text-white" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className={`truncate text-[11px] font-bold ${sel ? "text-[#0B3B2E]" : "text-slate-800"}`}>{name}</div>
                        {phone
                          ? <div className="text-[10px] text-slate-400">{phone}</div>
                          : <div className="text-[10px] font-semibold text-amber-600">No phone — will be blocked</div>
                        }
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* No-phone warning */}
              {noPhoneCount > 0 && (
                <p className="mt-1.5 text-[10px] font-semibold text-amber-600">
                  {noPhoneCount} selected {noPhoneCount === 1 ? "contact has" : "contacts have"} no phone and will be skipped.
                </p>
              )}
            </div>
          )}

          {/* Message body */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={lc + " mb-0"}>Message</label>
              <span className={`text-[10px] font-bold ${body.length > 160 ? "text-amber-600" : "text-slate-400"}`}>
                {body.length} chars · {smsCount} SMS part{smsCount > 1 ? "s" : ""}
              </span>
            </div>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={5}
              placeholder="Type your message here…"
              className="w-full border border-slate-300 px-3 py-2.5 text-xs outline-none resize-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20 transition" />
            {body.length > 160 && (
              <p className="mt-1 text-[10px] text-amber-600">Messages over 160 characters are sent as {smsCount} parts and may incur extra cost.</p>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-5 py-3 flex items-center justify-end gap-2">
          <button onClick={handleClose} className="border border-slate-300 bg-white px-4 py-2 text-[11px] font-bold text-slate-600 transition hover:bg-slate-100">
            Cancel
          </button>
          <button onClick={handleSend} disabled={sending || !body.trim()}
            className="inline-flex items-center gap-2 bg-[#FF8C00] px-5 py-2 text-[11px] font-bold text-white transition hover:bg-[#E67E00] disabled:opacity-40">
            {sending ? <FaSpinner className="animate-spin" size={11} /> : <FaPaperPlane size={11} />}
            {sending ? "Sending…" : selectedIds.length > 0 ? `Send to ${selectedIds.length}` : "Send SMS"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────
const SmsManager = () => {
  const navigate    = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const { currentUser }    = useSelector(s => s.auth || {});
  const { currentCompany } = useSelector(s => s.company || {});

  const businessId = currentCompany?._id ||
    (typeof currentUser?.company === "string" ? currentUser.company : currentUser?.company?._id) || "";

  const hasPM           = hasCompanyModule(currentCompany, "propertyManagement");
  const hasCarWash      = hasCompanyModule(currentCompany, "carwash");
  const hasHR           = hasCompanyModule(currentCompany, "hr");
  const hasPropertySale = hasCompanyModule(currentCompany, "propertySale");
  const hasInventory    = hasCompanyModule(currentCompany, "inventory");

  // ── URL-driven state ──────────────────────────────────────────────────────
  const activeStatus = searchParams.get("status") || "";
  const urlPage      = Math.max(Number(searchParams.get("page") || 1), 1);

  const setStatus = (s) => setSearchParams({ status: s, page: "1" }, { replace: true });
  const setPage   = (p) => setSearchParams({ status: activeStatus, page: String(p) }, { replace: true });

  // ── Local state ───────────────────────────────────────────────────────────
  const [search,         setSearch]         = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [compose,        setCompose]        = useState(false);
  const [expandedId,     setExpanded]       = useState(null);
  const [loading,        setLoading]        = useState(false);
  const [deletingId,     setDeletingId]     = useState(null);
  const [data, setData] = useState({
    logs: [],
    pagination: { page: 1, limit: PAGE_SIZE, total: 0, pages: 1 },
    counts: { all: 0, sent: 0, failed: 0, pending: 0 },
  });

  // Debounce search → reset to page 1
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      if (search !== debouncedSearch) setSearchParams({ status: activeStatus, page: "1" }, { replace: true });
    }, 400);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchLogs = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ business: businessId, channel: "sms", limit: PAGE_SIZE, page: urlPage });
      if (activeStatus)    params.set("status", activeStatus);
      if (debouncedSearch) params.set("search", debouncedSearch);
      const res = await adminRequests.get(`/communications/sms-logs?${params}`);
      const payload = res?.data;
      if (payload?.logs && payload?.pagination) {
        setData(payload);
      } else {
        // Legacy flat array fallback
        const arr = Array.isArray(payload) ? payload : payload?.logs || [];
        setData(d => ({ ...d, logs: arr, pagination: { ...d.pagination, total: arr.length, pages: 1 } }));
      }
    } catch {
      toast.error("Failed to load SMS logs");
    } finally {
      setLoading(false);
    }
  }, [businessId, urlPage, activeStatus, debouncedSearch]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const handleDeleteLog = async (logId) => {
    if (!window.confirm("Delete this log entry? This cannot be undone.")) return;
    setDeletingId(logId);
    try {
      await adminRequests.delete(`/communications/sms-logs/${logId}`);
      toast.success("Log entry deleted.");
      setExpanded(null);
      fetchLogs();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to delete log entry.");
    } finally {
      setDeletingId(null);
    }
  };

  const { logs, pagination, counts } = data;
  const { page: currentPage, total, pages } = pagination;

  const fromRow = total === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const toRow   = Math.min(currentPage * PAGE_SIZE, total);

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full flex-col overflow-hidden bg-slate-50">

        {/* ── Header (nav + filter bar) ─────────────────────────────────────── */}
        <div className="shrink-0">

          {/* Nav bar */}
          <div className="flex items-center justify-between gap-3 bg-[#0B3B2E] px-4 py-2">
            <div className="flex items-center gap-0.5">
              <button className="inline-flex items-center gap-1.5 border-b-2 border-[#FF8C00] px-3 py-1.5 text-[11px] font-bold text-white">
                <FaSms size={11} /> SMS
              </button>
              <button onClick={() => navigate("/communications/email")}
                className="inline-flex items-center gap-1.5 border-b-2 border-transparent px-3 py-1.5 text-[11px] font-bold text-[#B7C9C0] transition hover:text-white">
                <FaEnvelope size={11} /> Email
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={fetchLogs} disabled={loading}
                className="inline-flex items-center gap-1.5 border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-white/20 disabled:opacity-50">
                <FaSyncAlt size={10} className={loading ? "animate-spin" : ""} /> Refresh
              </button>
              <button onClick={() => setCompose(true)}
                className="inline-flex items-center gap-1.5 bg-[#FF8C00] px-4 py-1.5 text-[11px] font-bold text-white transition hover:bg-[#E67E00]">
                <FaPlus size={10} /> Compose SMS
              </button>
            </div>
          </div>

          {/* Filter bar */}
          <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
            <div className="flex items-center gap-0">
            {TABS.map(tab => {
              const count  = counts[tab.countKey] ?? 0;
              const active = activeStatus === tab.key;
              return (
                <button key={tab.key} onClick={() => setStatus(tab.key)}
                  className={[
                    "px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition border-b-2",
                    active ? "border-[#FF8C00] bg-[#EDF5F1] text-[#0B3B2E]" : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50",
                  ].join(" ")}>
                  {tab.label}
                  {count > 0 && (
                    <span className={`ml-1.5 border px-1.5 py-0.5 text-[9px] font-bold ${active ? "border-[#0B3B2E]/20 bg-[#0B3B2E]/10 text-[#0B3B2E]" : "border-slate-200 bg-slate-100 text-slate-500"}`}>
                      {count.toLocaleString()}
                    </span>
                  )}
                </button>
              );
            })}
            </div>

            <div className="ml-auto flex items-center gap-2 border border-slate-300 bg-white px-3 py-1.5 min-w-[240px]">
            <FaSearch size={10} className="shrink-0 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name, phone, message…"
              className="flex-1 bg-transparent text-[11px] text-slate-700 placeholder-slate-400 outline-none"
            />
            {search && (
              <button onClick={() => { setSearch(""); setDebouncedSearch(""); }}>
                <FaTimesCircle size={11} className="text-slate-400 hover:text-slate-600" />
              </button>
            )}
            </div>
          </div>
        </div>{/* end header */}
        
        {/* ── Table ────────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-slate-400">
              <FaSpinner className="animate-spin" size={20} />
              <p className="text-xs font-semibold">Loading SMS logs…</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24">
              <div className="flex h-14 w-14 items-center justify-center bg-slate-100">
                <FaInbox size={24} className="text-slate-300" />
              </div>
              <p className="text-xs font-semibold text-slate-400">
                {debouncedSearch ? `No messages match "${debouncedSearch}"` : "No SMS messages yet."}
              </p>
              {debouncedSearch && (
                <button onClick={() => { setSearch(""); setDebouncedSearch(""); }}
                  className="text-[11px] font-bold text-[#0B3B2E] hover:underline">
                  Clear search
                </button>
              )}
            </div>
          ) : (
            <table className="w-full min-w-[700px] text-xs">
              <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                <tr>
                  <th className="w-6 px-3 py-2.5" />
                  <th className="px-3 py-2.5 text-left font-bold uppercase tracking-wide">Recipient</th>
                  <th className="px-3 py-2.5 text-left font-bold uppercase tracking-wide">Phone</th>
                  <th className="px-3 py-2.5 text-left font-bold uppercase tracking-wide">Type</th>
                  <th className="px-3 py-2.5 text-left font-bold uppercase tracking-wide">Message</th>
                  <th className="px-3 py-2.5 text-center font-bold uppercase tracking-wide">Status</th>
                  <th className="px-3 py-2.5 text-right font-bold uppercase tracking-wide">Sent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map((log, i) => {
                  const rowKey   = log._id || i;
                  const expanded = expandedId === rowKey;
                  return (
                    <React.Fragment key={rowKey}>
                      <tr
                        onClick={() => setExpanded(expanded ? null : rowKey)}
                        className={`cursor-pointer transition ${expanded ? "bg-[#EDF5F1]" : "bg-white hover:bg-slate-50"}`}
                      >
                        <td className="px-3 py-2 text-slate-400">
                          {expanded ? <FaChevronDown size={9} /> : <FaChevronRight size={9} />}
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-bold text-slate-900">{log.recipientName || "—"}</span>
                        </td>
                        <td className="px-3 py-2 text-slate-500 font-mono text-[11px]">
                          {log.to || log.recipient || "—"}
                        </td>
                        <td className="px-3 py-2">
                          <span className="border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                            {fmtTemplate(log.templateKey || log.templateName || log.type)}
                          </span>
                        </td>
                        <td className="px-3 py-2 max-w-[260px]">
                          <p className="truncate text-slate-600">{log.body || log.message || "—"}</p>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <StatusChip status={log.status} />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <p className="font-semibold text-slate-700">{fmtRel(log.sentAt || log.createdAt)}</p>
                          <p className="text-[10px] text-slate-400">{fmtDateTime(log.sentAt || log.createdAt)}</p>
                        </td>
                      </tr>

                      {expanded && (
                        <tr className="bg-[#EDF5F1]">
                          <td colSpan={7} className="px-4 pb-4 pt-1">
                            <div className="border border-[#B7C9C0] bg-white p-4 shadow-sm">
                              <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 mb-4">
                                {[
                                  { label: "Recipient",  value: log.recipientName || "—" },
                                  { label: "Phone",      value: log.to || log.recipient || "—" },
                                  { label: "Provider",   value: log.provider || log.profileName || "—" },
                                  { label: "Cost",       value: log.costLabel || "—" },
                                  { label: "Template",   value: fmtTemplate(log.templateKey || log.type) },
                                  { label: "Context",    value: log.contextType || "—" },
                                  { label: "Message ID", value: log.providerMessageId || "—" },
                                  { label: "Sent at",    value: fmtDateTime(log.sentAt || log.createdAt) },
                                ].map(({ label, value }) => (
                                  <div key={label}>
                                    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
                                    <p className="mt-0.5 text-[11px] font-semibold text-slate-800 break-all">{value}</p>
                                  </div>
                                ))}
                              </div>
                              <div>
                                <p className="mb-1 text-[9px] font-bold uppercase tracking-wide text-slate-400">Full Message</p>
                                <p className="rounded border border-slate-200 bg-slate-50 px-3 py-2.5 text-[11px] leading-relaxed text-slate-700 whitespace-pre-wrap">
                                  {log.body || log.message || "—"}
                                </p>
                              </div>
                              {log.error && (
                                <div className="mt-3 flex items-start gap-2 border border-rose-200 bg-rose-50 px-3 py-2.5">
                                  <FaExclamationTriangle size={11} className="mt-0.5 shrink-0 text-rose-500" />
                                  <div>
                                    <p className="text-[9px] font-bold uppercase tracking-wide text-rose-500">Error</p>
                                    <p className="mt-0.5 text-[11px] text-rose-700">{log.error}</p>
                                  </div>
                                </div>
                              )}
                              {/* Delete — only on failed or test entries; sent messages are audit trail */}
                              {(log.status !== "sent" || log.isTest) && (
                                <div className="mt-3 flex justify-end">
                                  <button
                                    onClick={e => { e.stopPropagation(); handleDeleteLog(log._id); }}
                                    disabled={deletingId === log._id}
                                    className="inline-flex items-center gap-1.5 border border-rose-300 bg-rose-50 px-3 py-1.5 text-[10px] font-bold text-rose-600 transition hover:bg-rose-100 disabled:opacity-50"
                                  >
                                    {deletingId === log._id
                                      ? <FaSpinner size={9} className="animate-spin" />
                                      : <FaTrash size={9} />}
                                    {deletingId === log._id ? "Deleting…" : "Delete Entry"}
                                  </button>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Pagination footer ─────────────────────────────────────────────── */}
        <div className="flex-shrink-0 flex min-h-9 items-center justify-between border-t border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-slate-500 normal-case">
              {loading ? "Loading…" : `Showing ${fromRow.toLocaleString()}–${toRow.toLocaleString()} of ${total.toLocaleString()}`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage(currentPage - 1)}
              disabled={currentPage <= 1 || loading}
              className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:cursor-not-allowed disabled:opacity-45">
              Previous
            </button>
            <span>Page {currentPage} of {pages}</span>
            <button
              type="button"
              onClick={() => setPage(currentPage + 1)}
              disabled={currentPage >= pages || loading}
              className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:cursor-not-allowed disabled:opacity-45">
              Next
            </button>
          </div>
        </div>
      </div>

      <ComposePanel
        open={compose}
        onClose={() => setCompose(false)}
        businessId={businessId}
        hasPM={hasPM}
        hasCarWash={hasCarWash}
        hasHR={hasHR}
        hasPropertySale={hasPropertySale}
        hasInventory={hasInventory}
        onSent={fetchLogs}
      />
    </DashboardLayout>
  );
};

export default SmsManager;
