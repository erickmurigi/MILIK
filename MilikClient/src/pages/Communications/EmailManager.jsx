import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  FaEnvelope, FaSearch, FaSyncAlt, FaPaperPlane,
  FaTimesCircle, FaPlus, FaTimes, FaUsers, FaCheckCircle,
  FaChevronDown, FaChevronRight, FaExclamationTriangle, FaInbox,
  FaTrash, FaAt, FaSms,
} from "react-icons/fa";
import StatusBadge from "../../components/common/StatusBadge";
import Spinner from "../../components/common/Spinner";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { adminRequests } from "../../utils/requestMethods";
import PaginationBar from "../../components/PaginationBar";
import MilikTable from "../../components/common/MilikTable";
import { useConfirm } from "../../context/ConfirmContext";
import { getTenants } from "../../redux/tenantsRedux";
import { fmtDateTime } from "../../utils/dates";

const DEFAULT_PAGE_SIZE = 50;

const TABS = [
  { key: "",        label: "ALL",     countKey: "all" },
  { key: "sent",    label: "SENT",    countKey: "sent" },
  { key: "failed",  label: "FAILED",  countKey: "failed" },
  { key: "pending", label: "PENDING", countKey: "pending" },
];

const STATUS_MAP = {
  sent:      "border-emerald-300 bg-emerald-50 text-emerald-700",
  delivered: "border-teal-300 bg-teal-50 text-teal-700",
  opened:    "border-sky-300 bg-sky-50 text-sky-700",
  failed:    "border-rose-300 bg-rose-50 text-rose-700",
  error:     "border-rose-300 bg-rose-50 text-rose-700",
  pending:   "border-amber-300 bg-amber-50 text-amber-700",
  bounced:   "border-orange-300 bg-orange-50 text-orange-700",
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


// ── Compose slide panel ────────────────────────────────────────────────────────
const ComposePanel = ({ open, onClose, businessId, tenants, onSent }) => {
  const [recipientMode, setRecipientMode] = useState("select");
  const [selectedIds, setSelectedIds]     = useState([]);
  const [manualEmail, setManualEmail]     = useState("");
  const [subject, setSubject]             = useState("");
  const [body, setBody]                   = useState("");
  const [sending, setSending]             = useState(false);
  const [tenantSearch, setTenantSearch]   = useState("");

  const filteredTenants = useMemo(() => {
    const t = tenantSearch.trim().toLowerCase();
    return t ? tenants.filter(tn => (tn.name || "").toLowerCase().includes(t) || (tn.email || "").toLowerCase().includes(t)) : tenants;
  }, [tenants, tenantSearch]);

  const toggleTenant = (id) => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const reset = () => { setSelectedIds([]); setManualEmail(""); setSubject(""); setBody(""); setTenantSearch(""); setSending(false); };
  const handleClose = () => { reset(); onClose(); };

  const handleSend = async () => {
    if (!subject.trim()) { toast.error("Subject is required."); return; }
    if (!body.trim()) { toast.error("Message body is required."); return; }
    if (recipientMode === "select" && selectedIds.length === 0) { toast.error("Select at least one recipient."); return; }
    if (recipientMode === "manual" && !manualEmail.trim()) { toast.error("Enter an email address."); return; }
    setSending(true);
    try {
      if (recipientMode === "manual") {
        await adminRequests.post("/communications/test-email", {
          business: businessId,
          email: manualEmail.trim(),
          subject: subject.trim(),
          body: body.trim(),
        });
      } else {
        await adminRequests.post("/communications/send", {
          business: businessId,
          contextType: "tenant_bulk",
          channel: "email",
          templateKey: "tenant_notice_email",
          recordIds: selectedIds,
          customSubject: subject.trim(),
          customBody: body.trim(),
        });
      }
      toast.success("Email sent successfully.");
      onSent();
      handleClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to send email.");
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex">
      <div className="absolute inset-0 bg-black/40" onClick={handleClose} />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-[500px] flex-col bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between bg-[#0B3B2E] px-5 py-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#B7C9C0]">Compose</div>
            <div className="mt-0.5 text-sm font-extrabold text-white">New Email</div>
          </div>
          <button onClick={handleClose} className="flex h-7 w-7 items-center justify-center bg-white/10 text-white/80 hover:bg-white/20">
            <FaTimes size={12} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">Recipients</label>
            <div className="flex border border-slate-300 text-xs font-bold overflow-hidden">
              <button
                onClick={() => setRecipientMode("select")}
                className={`flex-1 py-2 transition ${recipientMode === "select" ? "bg-[#0B3B2E] text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                <FaUsers className="inline mr-1.5" size={10} /> Select Tenants
              </button>
              <button
                onClick={() => setRecipientMode("manual")}
                className={`flex-1 py-2 transition border-l border-slate-300 ${recipientMode === "manual" ? "bg-[#0B3B2E] text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                <FaAt className="inline mr-1.5" size={10} /> Manual Email
              </button>
            </div>
          </div>

          {recipientMode === "manual" ? (
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">Email Address</label>
              <input
                type="email"
                value={manualEmail}
                onChange={e => setManualEmail(e.target.value)}
                placeholder="recipient@example.com"
                className="w-full border border-slate-300 px-3 py-2 text-xs outline-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
              />
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Select Tenants</label>
                {selectedIds.length > 0 && (
                  <span className="border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9px] font-bold text-emerald-700">
                    {selectedIds.length} selected
                  </span>
                )}
                {selectedIds.length > 0 && (
                  <button onClick={() => setSelectedIds([])} className="ml-auto text-[10px] font-bold text-rose-500 hover:text-rose-700">Clear</button>
                )}
              </div>
              <div className="mb-2 flex items-center gap-2 border border-slate-300 px-3 py-2">
                <FaSearch size={10} className="text-slate-400 shrink-0" />
                <input value={tenantSearch} onChange={e => setTenantSearch(e.target.value)} placeholder="Search tenants…"
                  className="flex-1 bg-transparent text-xs outline-none text-slate-700 placeholder-slate-400" />
              </div>
              <div className="max-h-[180px] overflow-y-auto border border-slate-200 divide-y divide-slate-100">
                {filteredTenants.length === 0 ? (
                  <div className="py-5 text-center text-xs text-slate-400">No tenants found</div>
                ) : filteredTenants.map(tn => {
                  const sel = selectedIds.includes(tn._id);
                  return (
                    <button key={tn._id} onClick={() => toggleTenant(tn._id)}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-left transition ${sel ? "bg-[#EDF5F1]" : "hover:bg-slate-50"}`}
                    >
                      <div className={`flex h-5 w-5 shrink-0 items-center justify-center border-2 transition ${sel ? "border-[#0B3B2E] bg-[#0B3B2E]" : "border-slate-300"}`}>
                        {sel && <FaCheckCircle size={9} className="text-white" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className={`truncate text-[11px] font-bold ${sel ? "text-[#0B3B2E]" : "text-slate-800"}`}>{tn.name || "Tenant"}</div>
                        <div className="truncate text-[10px] text-slate-400">{tn.email || "No email"}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">Subject</label>
            <input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Email subject…"
              className="w-full border border-slate-300 px-3 py-2 text-xs outline-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">Message</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={6}
              placeholder="Type your email message here…"
              className="w-full border border-slate-300 px-3 py-2.5 text-xs outline-none resize-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
            />
          </div>
        </div>

        <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-5 py-3 flex items-center justify-end gap-2">
          <button onClick={handleClose} className="border border-slate-300 bg-white px-4 py-2 text-[11px] font-bold text-slate-600 transition hover:bg-slate-100">Cancel</button>
          <button onClick={handleSend} disabled={sending || !subject.trim() || !body.trim()}
            className="inline-flex items-center gap-2 bg-[#FF8C00] px-5 py-2 text-[11px] font-bold text-white transition hover:bg-[#E67E00] disabled:opacity-40">
            {sending ? <Spinner size="sm" /> : <FaPaperPlane size={11} />}
            {sending ? "Sending…" : recipientMode === "select" && selectedIds.length > 0 ? `Send to ${selectedIds.length}` : "Send Email"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────
const EmailManager = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const confirm  = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();

  const { currentUser }    = useSelector(s => s.auth || {});
  const { currentCompany } = useSelector(s => s.company || {});
  const rawTenants = useSelector(s => s.tenant?.tenants);

  const businessId = currentCompany?._id ||
    (typeof currentUser?.company === "string" ? currentUser.company : currentUser?.company?._id) || "";

  const tenants = useMemo(() => {
    const arr = Array.isArray(rawTenants) ? rawTenants : rawTenants?.data || rawTenants?.tenants || [];
    return Array.isArray(arr) ? arr : [];
  }, [rawTenants]);

  const activeStatus = searchParams.get("status") || "";
  const urlPage      = Math.max(Number(searchParams.get("page") || 1), 1);

  const setStatus = (s) => setSearchParams({ status: s, page: "1" }, { replace: true });
  const setPage   = (p) => setSearchParams({ status: activeStatus, page: String(p) }, { replace: true });

  const [search, setSearch]                   = useTabState("/communications/email:search", "");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [compose, setCompose]                 = useState(false);
  const [expandedId, setExpanded]             = useState(null);
  const [loading, setLoading]                 = useState(false);
  const [deletingId, setDeletingId]           = useState(null);
  const [pageSize, setPageSize]               = useTabState("/communications/email:pageSize", DEFAULT_PAGE_SIZE);
  const [data, setData] = useState({
    logs: [],
    pagination: { page: 1, limit: DEFAULT_PAGE_SIZE, total: 0, pages: 1 },
    counts: { all: 0, sent: 0, failed: 0, pending: 0 },
  });

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      if (search !== debouncedSearch) setSearchParams({ status: activeStatus, page: "1" }, { replace: true });
    }, 400);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchLogs = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ business: businessId, limit: pageSize, page: urlPage });
      if (activeStatus)    params.set("status",  activeStatus);
      if (debouncedSearch) params.set("search",  debouncedSearch);
      const res = await adminRequests.get(`/communications/email-logs?${params}`);
      const payload = res?.data;
      if (payload?.logs && payload?.pagination) {
        setData(payload);
      } else {
        const arr = Array.isArray(payload) ? payload : payload?.logs || [];
        setData(d => ({ ...d, logs: arr, pagination: { ...d.pagination, total: arr.length, pages: 1 } }));
      }
    } catch {
      toast.error("Failed to load email logs");
    } finally {
      setLoading(false);
    }
  }, [businessId, urlPage, activeStatus, debouncedSearch, pageSize]);

  useEffect(() => { if (businessId) dispatch(getTenants({ business: businessId })); }, [businessId, dispatch]);
  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const handleDeleteLog = async (logId) => {
    if (!(await confirm({ title: 'Delete Log Entry', message: 'Delete this log entry? This cannot be undone.', confirmText: 'Delete', isDangerous: true }))) return;
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

  const fromRow = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const toRow   = Math.min(currentPage * pageSize, total);

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full flex-col overflow-hidden bg-slate-50">

        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div className="shrink-0">

          {/* Nav bar */}
          <div className="flex items-center justify-between gap-3 bg-[#0B3B2E] px-4 py-2">
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => navigate("/communications/sms")}
                className="inline-flex items-center gap-1.5 border-b-2 border-transparent px-3 py-1.5 text-[11px] font-bold text-[#B7C9C0] transition hover:text-white"
              >
                <FaSms size={11} /> SMS
              </button>
              <button className="inline-flex items-center gap-1.5 border-b-2 border-[#FF8C00] px-3 py-1.5 text-[11px] font-bold text-white">
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
                <FaPlus size={10} /> Compose Email
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
                placeholder="Search name, email, subject…"
                className="flex-1 bg-transparent text-[11px] text-slate-700 placeholder-slate-400 outline-none"
              />
              {search && (
                <button onClick={() => { setSearch(""); setDebouncedSearch(""); }}>
                  <FaTimesCircle size={11} className="text-slate-400 hover:text-slate-600" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Table ────────────────────────────────────────────────────────── */}
        <MilikTable
          columns={[
            { label: "Recipient" },
            { label: "Email" },
            { label: "Subject" },
            { label: "Type" },
            { label: "Status", align: "center" },
            { label: "Sent", align: "right" },
          ]}
          rows={logs}
          rowKey="_id"
          loading={loading}
          empty={debouncedSearch ? `No emails match "${debouncedSearch}"` : "No email messages yet."}
          minWidth="700px"
          renderRow={(log) => (
            <>
              <td className="px-3 py-2">
                <span className="font-bold text-slate-900">{log.recipientName || "—"}</span>
              </td>
              <td className="px-3 py-2 text-slate-500 font-mono text-[11px]">
                {log.to || log.recipient || "—"}
              </td>
              <td className="px-3 py-2 max-w-[220px]">
                <p className="truncate text-slate-700 font-semibold">{log.subject || "—"}</p>
              </td>
              <td className="px-3 py-2">
                <span className="border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  {(log.templateKey || log.templateName || log.type || "email").replace(/_/g, " ")}
                </span>
              </td>
              <td className="px-3 py-2 text-center">
                <StatusBadge status={log.status} map={STATUS_MAP} />
              </td>
              <td className="px-3 py-2 text-right">
                <p className="font-semibold text-slate-700">{fmtRel(log.sentAt || log.createdAt)}</p>
                <p className="text-[10px] text-slate-400">{fmtDateTime(log.sentAt || log.createdAt)}</p>
              </td>
            </>
          )}
          renderExpanded={(log) => (
            <div className="border border-[#B7C9C0] bg-white p-4 shadow-sm">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 mb-4">
                {[
                  { label: "Recipient",  value: log.recipientName || "—" },
                  { label: "Email",      value: log.to || log.recipient || "—" },
                  { label: "Provider",   value: log.provider || log.profileName || "—" },
                  { label: "Subject",    value: log.subject || "—" },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
                    <p className="mt-0.5 text-[11px] font-semibold text-slate-800 truncate">{value}</p>
                  </div>
                ))}
              </div>
              {log.body && (
                <div className="mb-3">
                  <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400 mb-1">Message Body</p>
                  <p className="text-[11px] text-slate-700 leading-relaxed whitespace-pre-wrap">{log.body}</p>
                </div>
              )}
              {log.error && (
                <div className="flex items-start gap-2 border border-rose-200 bg-rose-50 px-3 py-2.5">
                  <FaExclamationTriangle size={11} className="mt-0.5 shrink-0 text-rose-500" />
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-wide text-rose-500">Error</p>
                    <p className="mt-0.5 text-[11px] text-rose-700">{log.error}</p>
                  </div>
                </div>
              )}
              {(log.status !== "sent" || log.isTest) && (
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={e => { e.stopPropagation(); handleDeleteLog(log._id); }}
                    disabled={deletingId === log._id}
                    className="inline-flex items-center gap-1.5 border border-rose-300 bg-rose-50 px-3 py-1.5 text-[10px] font-bold text-rose-600 transition hover:bg-rose-100 disabled:opacity-50"
                  >
                    {deletingId === log._id ? <Spinner size="sm" /> : <FaTrash size={9} />}
                    {deletingId === log._id ? "Deleting…" : "Delete Entry"}
                  </button>
                </div>
              )}
            </div>
          )}
        />

        {/* ── Pagination footer ─────────────────────────────────────────────── */}
        <PaginationBar
          page={currentPage}
          pages={pages}
          total={total}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(n) => { setPageSize(n); setSearchParams({ status: activeStatus, page: "1" }, { replace: true }); }}
          loading={loading}
          label="emails"
        />
      </div>

      <ComposePanel
        open={compose}
        onClose={() => setCompose(false)}
        businessId={businessId}
        tenants={tenants}
        onSent={fetchLogs}
      />
    </DashboardLayout>
  );
};

export default EmailManager;
