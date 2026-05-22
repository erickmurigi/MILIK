import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  FaEnvelope,
  FaSms,
  FaCheckCircle,
  FaExclamationCircle,
  FaSpinner,
  FaClock,
} from "react-icons/fa";
import { adminRequests } from "../../utils/requestMethods";

const TABS = [
  { id: "sms", label: "SMS Sent", icon: <FaSms size={11} />, channel: "sms" },
  { id: "email", label: "Email Sent", icon: <FaEnvelope size={11} />, channel: "email" },
];

const formatRelativeDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return mins <= 1 ? "Just now" : `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
};

const StatusIcon = ({ status }) => {
  if (status === "sent" || status === "delivered")
    return <FaCheckCircle size={10} className="text-emerald-500 shrink-0" title={status} />;
  if (status === "failed" || status === "error")
    return <FaExclamationCircle size={10} className="text-rose-500 shrink-0" title={status} />;
  return <FaClock size={10} className="text-amber-500 shrink-0" title={status || "pending"} />;
};

const CommunicationHub = ({ darkMode }) => {
  const navigate = useNavigate();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const currentUser = useSelector((s) => s.auth?.currentUser);

  const businessId = useMemo(
    () =>
      currentCompany?._id ||
      currentUser?.company?._id ||
      (typeof currentUser?.company === "string" ? currentUser.company : ""),
    [currentCompany?._id, currentUser?.company]
  );

  const [activeTab, setActiveTab] = useState("sms");
  const [logs, setLogs] = useState({ sms: [], email: [] });
  const [loading, setLoading] = useState(false);

  const fetchLogs = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const [smsRes, emailRes] = await Promise.allSettled([
        adminRequests.get(`/communications/sms-logs?business=${businessId}&limit=20&channel=sms`),
        adminRequests.get(`/communications/sms-logs?business=${businessId}&limit=20&channel=email`),
      ]);
      setLogs({
        sms: smsRes.status === "fulfilled" ? (smsRes.value?.data?.logs || smsRes.value?.data || []) : [],
        email: emailRes.status === "fulfilled" ? (emailRes.value?.data?.logs || emailRes.value?.data || []) : [],
      });
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const currentLogs = logs[activeTab] || [];

  return (
    <div
      className={`dashboard-panel rounded-xl shadow-md border p-4 ${
        darkMode ? "bg-gray-800 border-gray-700" : "bg-[#f8faf9] border-[#31694E]/10"
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className={`font-extrabold text-sm tracking-tight uppercase ${darkMode ? "text-white" : "text-[#1f4a35]"}`}>
            Communications
          </h3>
          <p className={`mt-1 text-xs font-medium ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
            Recent sent messages. Send SMS/emails from Tenants or Invoices.
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => navigate("/tenants")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50 transition"
          >
            <FaSms size={9} /> Tenants
          </button>
          <button
            type="button"
            onClick={() => navigate("/invoices/rental")}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B3B2E] px-3 py-1.5 text-[11px] font-bold text-white hover:bg-[#0A3127] transition"
          >
            <FaEnvelope size={9} /> Invoices
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-3 rounded-lg bg-slate-100/80 p-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-bold transition ${
              activeTab === tab.id
                ? "bg-white shadow text-[#0B3B2E]"
                : darkMode
                ? "text-gray-400 hover:text-white"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Log list */}
      <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-0.5">
        {loading ? (
          <div className="flex items-center justify-center py-8 gap-2 text-slate-400 text-xs">
            <FaSpinner className="animate-spin" size={12} /> Loading…
          </div>
        ) : currentLogs.length === 0 ? (
          <div className="py-8 text-center text-[11px] text-slate-400">
            No {activeTab === "sms" ? "SMS" : "email"} messages sent yet.
          </div>
        ) : (
          currentLogs.map((log, i) => (
            <div
              key={log._id || i}
              className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 ${
                darkMode ? "border-gray-700 bg-gray-700/30" : "border-slate-200 bg-white"
              }`}
            >
              <StatusIcon status={log.status} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className={`truncate text-xs font-semibold ${darkMode ? "text-white" : "text-slate-900"}`}>
                    {log.recipient || log.to || log.recipientName || "—"}
                  </p>
                  <span className="shrink-0 text-[10px] text-slate-400">{formatRelativeDate(log.sentAt || log.createdAt)}</span>
                </div>
                <p className={`mt-0.5 line-clamp-1 text-[10px] ${darkMode ? "text-gray-400" : "text-slate-500"}`}>
                  {log.body || log.subject || log.message || "—"}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

    </div>
  );
};

export default CommunicationHub;
