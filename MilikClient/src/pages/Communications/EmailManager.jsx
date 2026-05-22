import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  FaEnvelope, FaCheckDouble, FaExclamationCircle, FaClock, FaSpinner,
  FaSearch, FaSyncAlt, FaPaperPlane, FaTimesCircle, FaPlus,
  FaTimes, FaUsers, FaSms, FaCheckCircle,
} from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { adminRequests } from "../../utils/requestMethods";
import { getTenants } from "../../redux/tenantsRedux";

const TABS = [
  { key: "all",     label: "All",     count_key: "all" },
  { key: "sent",    label: "Sent",    count_key: "sent" },
  { key: "failed",  label: "Failed",  count_key: "failed" },
  { key: "pending", label: "Pending", count_key: "pending" },
];
const VALID_TABS = new Set(TABS.map(t => t.key));

const STATUS_META = {
  sent:      { label: "Sent",      cls: "bg-emerald-100 text-emerald-700" },
  delivered: { label: "Delivered", cls: "bg-teal-100 text-teal-700" },
  failed:    { label: "Failed",    cls: "bg-rose-100 text-rose-700" },
  error:     { label: "Error",     cls: "bg-rose-100 text-rose-700" },
  pending:   { label: "Pending",   cls: "bg-amber-100 text-amber-700" },
};

const fmtDateTime = (v) => {
  if (!v) return "—";
  const d = new Date(v); if (Number.isNaN(d.getTime())) return "—";
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
  const meta = STATUS_META[status] || { label: status || "Pending", cls: "bg-slate-100 text-slate-600" };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide ${meta.cls}`}>{meta.label}</span>;
};

// ── Compose panel ─────────────────────────────────────────────────────────────
const ComposePanel = ({ open, onClose, businessId, tenants, onSent }) => {
  const [selectedIds, setSelectedIds] = useState([]);
  const [subject, setSubject]         = useState("");
  const [body, setBody]               = useState("");
  const [sending, setSending]         = useState(false);
  const [tenantSearch, setTenantSearch] = useState("");

  const filteredTenants = useMemo(() => {
    const t = tenantSearch.trim().toLowerCase();
    return t ? tenants.filter(tn => (tn.name || "").toLowerCase().includes(t) || (tn.email || "").toLowerCase().includes(t)) : tenants;
  }, [tenants, tenantSearch]);

  const toggleTenant = (id) => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const reset = () => { setSelectedIds([]); setSubject(""); setBody(""); setTenantSearch(""); setSending(false); };
  const handleClose = () => { reset(); onClose(); };

  const handleSend = async () => {
    if (selectedIds.length === 0) { toast.error("Select at least one recipient."); return; }
    if (!subject.trim())          { toast.error("Subject is required."); return; }
    if (!body.trim())             { toast.error("Message body is required."); return; }
    setSending(true);
    try {
      await adminRequests.post("/communications/send", {
        business: businessId, contextType: "tenant_bulk", channel: "email",
        templateKey: "tenant_notice_email", recordIds: selectedIds,
        customBody: body.trim(), customSubject: subject.trim(),
      });
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
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleClose} />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-[560px] flex-col bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between bg-[#0B3B2E] px-5 py-4">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400">Compose</div>
            <div className="mt-0.5 text-base font-black text-white">New Email</div>
          </div>
          <button onClick={handleClose} className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-white/70 hover:bg-white/20">
            <FaTimes size={13} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Recipients */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <label className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500"><FaUsers className="inline mr-1" size={9} />Select Recipients</label>
              {selectedIds.length > 0 && (
                <>
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[9px] font-black text-blue-700">{selectedIds.length} selected</span>
                  <button onClick={() => setSelectedIds([])} className="ml-auto text-[10px] font-bold text-rose-500 hover:text-rose-700">Clear</button>
                </>
              )}
            </div>
            <div className="mb-2 flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
              <FaSearch size={11} className="text-slate-400 shrink-0" />
              <input value={tenantSearch} onChange={e => setTenantSearch(e.target.value)} placeholder="Search tenants by name or email…"
                className="flex-1 bg-transparent text-xs outline-none text-slate-700 placeholder-slate-400" />
            </div>
            <div className="max-h-[180px] overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
              {filteredTenants.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-400">No tenants found</div>
              ) : filteredTenants.map(tn => {
                const sel = selectedIds.includes(tn._id);
                return (
                  <button key={tn._id} onClick={() => toggleTenant(tn._id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition ${sel ? "bg-blue-50" : "hover:bg-slate-50"}`}
                  >
                    <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition ${sel ? "border-blue-600 bg-blue-600" : "border-slate-300"}`}>
                      {sel && <FaCheckCircle size={10} className="text-white" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`truncate text-xs font-semibold ${sel ? "text-blue-800" : "text-slate-800"}`}>{tn.name || "Tenant"}</div>
                      <div className="truncate text-[10px] text-slate-400">{tn.email || "No email"}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Subject */}
          <div>
            <label className="block text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 mb-1.5">Subject</label>
            <input
              value={subject} onChange={e => setSubject(e.target.value)} placeholder="Email subject…"
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {/* Body */}
          <div>
            <label className="block text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 mb-1.5">Message</label>
            <textarea
              value={body} onChange={e => setBody(e.target.value)} rows={8} placeholder="Write your email message here…"
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none resize-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 bg-slate-50 px-5 py-3 flex items-center justify-between">
          <button onClick={handleClose} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-100">Cancel</button>
          <button onClick={handleSend} disabled={sending || !subject.trim() || !body.trim() || selectedIds.length === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-700 px-5 py-2 text-xs font-black text-white transition hover:opacity-90 disabled:opacity-40">
            {sending ? <FaSpinner className="animate-spin" size={11} /> : <FaPaperPlane size={11} />}
            {sending ? "Sending…" : `Send Email${selectedIds.length > 1 ? ` (${selectedIds.length})` : ""}`}
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
      const res = await adminRequests.get(`/communications/sms-logs?business=${businessId}&limit=500&channel=email`);
      setLogs(res?.data?.logs || (Array.isArray(res?.data) ? res.data : []));
    } catch { setLogs([]); }
    finally { setLoading(false); }
  }, [businessId]);

  useEffect(() => {
    if (businessId) dispatch(getTenants({ business: businessId }));
  }, [businessId, dispatch]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const filtered = useMemo(() => {
    let list = logs;
    if (activeTab === "sent")    list = list.filter(l => l.status === "sent" || l.status === "delivered");
    if (activeTab === "failed")  list = list.filter(l => l.status === "failed" || l.status === "error");
    if (activeTab === "pending") list = list.filter(l => !l.status || l.status === "pending");
    if (search.trim()) {
      const t = search.trim().toLowerCase();
      list = list.filter(l => [l.recipient, l.to, l.recipientName, l.subject, l.body, l.message, l.templateName]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(t)));
    }
    return list;
  }, [logs, activeTab, search]);

  const counts = useMemo(() => ({
    all:     logs.length,
    sent:    logs.filter(l => l.status === "sent" || l.status === "delivered").length,
    failed:  logs.filter(l => l.status === "failed" || l.status === "error").length,
    pending: logs.filter(l => !l.status || l.status === "pending").length,
  }), [logs]);

  return (
    <DashboardLayout>
      <div className="flex h-full flex-col overflow-hidden">

        {/* ── Top bar ─────────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600 text-white">
              <FaEnvelope size={14} />
            </div>
            <div>
              <div className="text-sm font-extrabold text-slate-900 leading-none">Email Communications</div>
              <div className="mt-0.5 text-[10px] text-slate-500">{counts.all} email{counts.all !== 1 ? "s" : ""} · {businessId ? "Live" : "No company"}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => navigate("/communications/sms")}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50">
              <FaSms size={10} /> SMS Communications
            </button>
            <button onClick={fetchLogs} disabled={loading}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50">
              <FaSyncAlt size={10} className={loading ? "animate-spin" : ""} /> Refresh
            </button>
            <button onClick={() => setCompose(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-700 px-4 py-1.5 text-xs font-black text-white transition hover:opacity-90">
              <FaPlus size={10} /> Compose Email
            </button>
          </div>
        </div>

        {/* ── Stats strip ─────────────────────────────────────────────────── */}
        <div className="shrink-0 grid grid-cols-4 divide-x divide-slate-200 border-b border-slate-200 bg-slate-50/80">
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => switchTab(tab.key)}
              className={`flex flex-col items-center py-2.5 text-center transition hover:bg-white ${activeTab === tab.key ? "bg-white" : ""}`}>
              <span className="text-lg font-extrabold text-slate-900">{counts[tab.count_key]}</span>
              <span className={`text-[10px] font-black uppercase tracking-wide ${activeTab === tab.key ? "text-blue-700" : "text-slate-500"}`}>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* ── Toolbar ─────────────────────────────────────────────────────── */}
        <div className="shrink-0 flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
          <div className="flex items-center gap-1">
            {TABS.map(tab => (
              <button key={tab.key} onClick={() => switchTab(tab.key)}
                className={[
                  "rounded-lg px-3 py-1.5 text-[11px] font-black uppercase tracking-wide transition",
                  activeTab === tab.key
                    ? "bg-gradient-to-r from-[#F97316] to-[#16A34A] text-white shadow-sm"
                    : "text-slate-500 hover:bg-slate-100",
                ].join(" ")}>
                {tab.label}
                {counts[tab.count_key] > 0 && (
                  <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[9px] ${activeTab === tab.key ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"}`}>
                    {counts[tab.count_key]}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 min-w-[240px]">
            <FaSearch size={11} className="shrink-0 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search recipient, subject…"
              className="flex-1 bg-transparent text-xs text-slate-700 placeholder-slate-400 outline-none" />
            {search && <button onClick={() => setSearch("")}><FaTimesCircle size={12} className="text-slate-400 hover:text-slate-600" /></button>}
          </div>
        </div>

        {/* ── Table ───────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-20 text-sm text-slate-400">
              <FaSpinner className="animate-spin" size={16} /> Loading email logs…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-20">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-300">
                <FaEnvelope size={24} />
              </div>
              <p className="text-sm font-semibold text-slate-400">{search ? "No emails match your search." : "No emails sent yet. Compose one above."}</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-slate-200 bg-blue-900/5">
                  <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.18em] text-blue-900">Recipient</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.18em] text-blue-900">Subject</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.18em] text-blue-900">Preview</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.18em] text-blue-900">Status</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-black uppercase tracking-[0.18em] text-blue-900">Sent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((log, i) => {
                  const isExpanded = expandedId === (log._id || i);
                  return (
                    <React.Fragment key={log._id || i}>
                      <tr
                        onClick={() => setExpanded(isExpanded ? null : (log._id || i))}
                        className="cursor-pointer hover:bg-blue-50/30 transition-colors"
                      >
                        <td className="px-4 py-2.5">
                          <div className="font-semibold text-slate-900 text-xs">{log.recipientName || "—"}</div>
                          <div className="text-[10px] text-slate-400">{log.recipient || log.to || ""}</div>
                        </td>
                        <td className="px-4 py-2.5 max-w-[220px]">
                          <p className="truncate text-xs font-semibold text-slate-800">{log.subject || "—"}</p>
                        </td>
                        <td className="px-4 py-2.5 max-w-[280px]">
                          <p className="line-clamp-1 text-xs text-slate-500">{log.body || log.message || "—"}</p>
                        </td>
                        <td className="px-4 py-2.5"><StatusChip status={log.status} /></td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="text-xs font-semibold text-slate-700">{fmtRel(log.sentAt || log.createdAt)}</div>
                          <div className="text-[10px] text-slate-400">{fmtDateTime(log.sentAt || log.createdAt)}</div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-blue-50/20">
                          <td colSpan={5} className="px-4 py-3">
                            <div className="rounded-xl border border-blue-200 bg-white p-4 shadow-sm">
                              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-3">
                                {[
                                  { label: "Recipient", value: log.recipientName || "—" },
                                  { label: "Email", value: log.recipient || log.to || "—" },
                                  { label: "Template", value: log.templateName || "—" },
                                  { label: "Provider", value: log.provider || "SMTP" },
                                ].map(({ label, value }) => (
                                  <div key={label}>
                                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">{label}</p>
                                    <p className="mt-0.5 text-xs font-semibold text-slate-800">{value}</p>
                                  </div>
                                ))}
                              </div>
                              {log.subject && (
                                <div className="mb-3">
                                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400 mb-1">Subject</p>
                                  <p className="text-sm font-semibold text-slate-800">{log.subject}</p>
                                </div>
                              )}
                              <div>
                                <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400 mb-1">Message Body</p>
                                <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap line-clamp-6">{log.body || log.message || "—"}</p>
                              </div>
                              {log.error && (
                                <div className="mt-3 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2">
                                  <p className="text-[9px] font-black uppercase text-rose-500 mb-0.5">Error</p>
                                  <p className="text-xs text-rose-700">{log.error}</p>
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

        {/* Footer count */}
        {filtered.length > 0 && (
          <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-4 py-1.5 text-right">
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
