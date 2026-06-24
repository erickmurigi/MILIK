import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  FaEnvelope, FaSpinner, FaSearch, FaSyncAlt, FaPaperPlane,
  FaTimesCircle, FaPlus, FaTimes, FaUsers, FaSms, FaCheckCircle,
  FaAt,
} from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { adminRequests } from "../../utils/requestMethods";
import { getTenants } from "../../redux/tenantsRedux";

const TABS = [
  { key: "all",     label: "ALL",     count_key: "all" },
  { key: "sent",    label: "SENT",    count_key: "sent" },
  { key: "failed",  label: "FAILED",  count_key: "failed" },
  { key: "pending", label: "PENDING", count_key: "pending" },
];
const VALID_TABS = new Set(TABS.map(t => t.key));

const STATUS_META = {
  sent:      { label: "Sent",      cls: "border-emerald-300 bg-emerald-50 text-emerald-700" },
  delivered: { label: "Delivered", cls: "border-teal-300 bg-teal-50 text-teal-700" },
  opened:    { label: "Opened",    cls: "border-sky-300 bg-sky-50 text-sky-700" },
  failed:    { label: "Failed",    cls: "border-rose-300 bg-rose-50 text-rose-700" },
  error:     { label: "Error",     cls: "border-rose-300 bg-rose-50 text-rose-700" },
  pending:   { label: "Pending",   cls: "border-amber-300 bg-amber-50 text-amber-700" },
  bounced:   { label: "Bounced",   cls: "border-orange-300 bg-orange-50 text-orange-700" },
};

const fmtDateTime = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
const fmtRel = (v) => {
  if (!v) return "";
  const d = new Date(v); if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime(), m = Math.floor(diff / 60000);
  if (m < 1) return "just now"; if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

const StatusChip = ({ status }) => {
  const meta = STATUS_META[status] || { label: status || "Pending", cls: "border-slate-300 bg-slate-50 text-slate-600" };
  return (
    <span className={`inline-flex items-center border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${meta.cls}`}>
      {meta.label}
    </span>
  );
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
        await adminRequests.post("/communications/test-email", { business: businessId, email: manualEmail.trim(), subject: subject.trim(), body: body.trim() });
      } else {
        await adminRequests.post("/communications/send", {
          business: businessId, contextType: "tenant_bulk", channel: "email",
          templateKey: "tenant_notice_email", recordIds: selectedIds, customSubject: subject.trim(), customBody: body.trim(),
        });
      }
      toast.success("Email sent successfully.");
      onSent();
      handleClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to send email.");
    } finally { setSending(false); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex">
      <div className="absolute inset-0 bg-black/40" onClick={handleClose} />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-[500px] flex-col bg-white shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between bg-[#0B3B2E] px-5 py-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#B7C9C0]">Compose</div>
            <div className="mt-0.5 text-sm font-extrabold text-white">New Email</div>
          </div>
          <button onClick={handleClose} className="flex h-7 w-7 items-center justify-center bg-white/10 text-white/80 hover:bg-white/20">
            <FaTimes size={12} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Recipient mode toggle */}
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
                value={manualEmail} onChange={e => setManualEmail(e.target.value)}
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

          {/* Subject */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">Subject</label>
            <input
              value={subject} onChange={e => setSubject(e.target.value)}
              placeholder="Email subject…"
              className="w-full border border-slate-300 px-3 py-2 text-xs outline-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
            />
          </div>

          {/* Body */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">Message</label>
            <textarea
              value={body} onChange={e => setBody(e.target.value)} rows={6} placeholder="Type your email message here…"
              className="w-full border border-slate-300 px-3 py-2.5 text-xs outline-none resize-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-5 py-3 flex items-center justify-end gap-2">
          <button onClick={handleClose} className="border border-slate-300 bg-white px-4 py-2 text-[11px] font-bold text-slate-600 transition hover:bg-slate-100">Cancel</button>
          <button onClick={handleSend} disabled={sending || !subject.trim() || !body.trim()}
            className="inline-flex items-center gap-2 bg-[#FF8C00] px-5 py-2 text-[11px] font-bold text-white transition hover:bg-[#E67E00] disabled:opacity-40">
            {sending ? <FaSpinner className="animate-spin" size={11} /> : <FaPaperPlane size={11} />}
            {sending ? "Sending…" : "Send Email"}
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
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentUser } = useSelector(s => s.auth || {});
  const { currentCompany } = useSelector(s => s.company || {});
  const rawTenants = useSelector(s => s.tenant?.tenants);

  const businessId = currentCompany?._id ||
    (typeof currentUser?.company === "string" ? currentUser.company : currentUser?.company?._id) || "";

  const tenants = useMemo(() => {
    const arr = Array.isArray(rawTenants) ? rawTenants : rawTenants?.data || rawTenants?.tenants || [];
    return Array.isArray(arr) ? arr : [];
  }, [rawTenants]);

  const activeTab = VALID_TABS.has(searchParams.get("tab")) ? searchParams.get("tab") : "all";
  const switchTab = (key) => setSearchParams({ tab: key }, { replace: true });

  const [logs, setLogs]           = useState([]);
  const [loading, setLoading]     = useState(false);
  const [search, setSearch]       = useState("");
  const [compose, setCompose]     = useState(false);
  const [expandedId, setExpanded] = useState(null);

  const fetchLogs = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await adminRequests.get(`/communications/email-logs?business=${businessId}&limit=500&channel=email`);
      setLogs(res?.data?.logs || (Array.isArray(res?.data) ? res.data : []));
    } catch { setLogs([]); }
    finally { setLoading(false); }
  }, [businessId]);

  useEffect(() => { if (businessId) dispatch(getTenants({ business: businessId })); }, [businessId, dispatch]);
  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const filtered = useMemo(() => {
    let list = logs;
    if (activeTab === "sent")    list = list.filter(l => l.status === "sent" || l.status === "delivered" || l.status === "opened");
    if (activeTab === "failed")  list = list.filter(l => l.status === "failed" || l.status === "error" || l.status === "bounced");
    if (activeTab === "pending") list = list.filter(l => !l.status || l.status === "pending");
    if (search.trim()) {
      const t = search.trim().toLowerCase();
      list = list.filter(l => [l.recipient, l.to, l.recipientName, l.subject, l.body, l.message, l.type, l.templateName]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(t)));
    }
    return list;
  }, [logs, activeTab, search]);

  const counts = useMemo(() => ({
    all:     logs.length,
    sent:    logs.filter(l => l.status === "sent" || l.status === "delivered" || l.status === "opened").length,
    failed:  logs.filter(l => l.status === "failed" || l.status === "error" || l.status === "bounced").length,
    pending: logs.filter(l => !l.status || l.status === "pending").length,
  }), [logs]);

  return (
    <DashboardLayout>
      <div className="flex h-full flex-col overflow-hidden bg-slate-50">

        {/* ── Channel nav bar ──────────────────────────────────────────────── */}
        <div className="shrink-0 flex items-center justify-between gap-3 bg-[#0B3B2E] px-4 py-2">
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigate("/communications/sms")}
              className="inline-flex items-center gap-2 border-b-2 border-transparent px-3 py-1.5 text-[11px] font-bold text-[#B7C9C0] transition hover:text-white"
            >
              <FaSms size={11} /> SMS
            </button>
            <button
              className="inline-flex items-center gap-2 border-b-2 border-[#FF8C00] bg-transparent px-3 py-1.5 text-[11px] font-bold text-white"
            >
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

        {/* ── Page header + stat tiles ─────────────────────────────────────── */}
        <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex h-7 w-7 items-center justify-center bg-[#0B3B2E] text-white">
              <FaEnvelope size={12} />
            </div>
            <div>
              <div className="text-[11px] font-extrabold text-slate-900 leading-none">Email Communications</div>
              <div className="mt-0.5 text-[10px] text-slate-500">{counts.all} email{counts.all !== 1 ? "s" : ""} · {businessId ? "Live" : "No company"}</div>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {TABS.map(tab => (
              <button key={tab.key} onClick={() => switchTab(tab.key)}
                className={`border px-3 py-2.5 text-center transition ${activeTab === tab.key ? "border-[#0B3B2E] bg-[#EDF5F1]" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
                <div className={`text-base font-extrabold ${activeTab === tab.key ? "text-[#0B3B2E]" : "text-slate-900"}`}>{counts[tab.count_key]}</div>
                <div className={`text-[10px] font-bold uppercase tracking-wide ${activeTab === tab.key ? "text-[#0B3B2E]" : "text-slate-500"}`}>{tab.label}</div>
              </button>
            ))}
          </div>
        </div>

        {/* ── Filter + search bar ──────────────────────────────────────────── */}
        <div className="shrink-0 flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
          <div className="flex items-center gap-0">
            {TABS.map(tab => (
              <button key={tab.key} onClick={() => switchTab(tab.key)}
                className={[
                  "px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition border-b-2",
                  activeTab === tab.key
                    ? "border-[#FF8C00] bg-[#EDF5F1] text-[#0B3B2E]"
                    : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50",
                ].join(" ")}>
                {tab.label}
                {counts[tab.count_key] > 0 && (
                  <span className={`ml-1 border px-1.5 py-0.5 text-[9px] font-bold ${activeTab === tab.key ? "border-[#0B3B2E]/30 bg-[#0B3B2E]/10 text-[#0B3B2E]" : "border-slate-200 bg-slate-100 text-slate-500"}`}>
                    {counts[tab.count_key]}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2 border border-slate-300 bg-white px-3 py-1.5 min-w-[220px]">
            <FaSearch size={10} className="shrink-0 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search recipient, subject…"
              className="flex-1 bg-transparent text-[11px] text-slate-700 placeholder-slate-400 outline-none" />
            {search && <button onClick={() => setSearch("")}><FaTimesCircle size={11} className="text-slate-400 hover:text-slate-600" /></button>}
          </div>
        </div>

        {/* ── Table ───────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-20 text-xs text-slate-400">
              <FaSpinner className="animate-spin" size={14} /> Loading email logs…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-20">
              <FaEnvelope size={32} className="text-slate-200" />
              <p className="text-xs font-semibold text-slate-400">{search ? "No emails match your search." : "No emails yet. Compose one above."}</p>
            </div>
          ) : (
            <table className="w-full min-w-[640px] text-[11px] border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#0B3B2E] text-white">
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Recipient</th>
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Subject</th>
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Type</th>
                  <th className="px-3 py-1 text-center font-bold border-r border-white/10">Status</th>
                  <th className="px-3 py-1 text-right font-bold">Sent</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((log, i) => {
                  const rowKey = log._id || i;
                  const isExpanded = expandedId === rowKey;
                  return (
                    <React.Fragment key={rowKey}>
                      <tr
                        onClick={() => setExpanded(isExpanded ? null : rowKey)}
                        className={`border-b border-gray-100 cursor-pointer transition ${i % 2 === 0 ? "bg-white hover:bg-[#EDF5F1]" : "bg-slate-50/60 hover:bg-[#EDF5F1]"}`}
                      >
                        <td className="px-3 py-1 border-r border-gray-100">
                          <div className="font-bold text-slate-900">{log.recipientName || "—"}</div>
                          <div className="text-[10px] text-slate-400">{log.recipient || log.to || ""}</div>
                        </td>
                        <td className="px-3 py-1 border-r border-gray-100 max-w-[300px]">
                          <p className="line-clamp-1 font-semibold text-slate-800">{log.subject || "—"}</p>
                          <p className="line-clamp-1 text-slate-500">{log.body || log.message || ""}</p>
                        </td>
                        <td className="px-3 py-1 border-r border-gray-100">
                          <span className="border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">{log.templateName || log.type || "—"}</span>
                        </td>
                        <td className="px-3 py-1 border-r border-gray-100 text-center"><StatusChip status={log.status} /></td>
                        <td className="px-3 py-1 text-right">
                          <div className="font-semibold text-slate-700">{fmtRel(log.sentAt || log.createdAt)}</div>
                          <div className="text-[10px] text-slate-400">{fmtDateTime(log.sentAt || log.createdAt)}</div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-[#EDF5F1]">
                          <td colSpan={5} className="px-4 py-3">
                            <div className="border border-slate-200 bg-white p-4">
                              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-3">
                                {[
                                  { label: "Recipient", value: log.recipientName || "—" },
                                  { label: "Email",     value: log.recipient || log.to || "—" },
                                  { label: "Provider",  value: log.provider || "—" },
                                  { label: "Subject",   value: log.subject || "—" },
                                ].map(({ label, value }) => (
                                  <div key={label}>
                                    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
                                    <p className="mt-0.5 text-[11px] font-semibold text-slate-800 truncate">{value}</p>
                                  </div>
                                ))}
                              </div>
                              <div>
                                <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400 mb-1">Message Body</p>
                                <p className="text-[11px] text-slate-700 leading-relaxed whitespace-pre-wrap">{log.body || log.message || "—"}</p>
                              </div>
                              {log.error && (
                                <div className="mt-3 border border-rose-200 bg-rose-50 px-3 py-2">
                                  <p className="text-[9px] font-bold uppercase text-rose-500 mb-0.5">Error</p>
                                  <p className="text-[11px] text-rose-700">{log.error}</p>
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

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        {filtered.length > 0 && (
          <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-1.5">
            <span className="text-[10px] text-slate-400">Showing {filtered.length} of {logs.length} email{logs.length !== 1 ? "s" : ""}</span>
          </div>
        )}
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
