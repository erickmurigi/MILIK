import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useLocation } from "react-router-dom";
import { useSelector } from "react-redux";
import { selectCurrentCompany } from "../../redux/selectors";
import useCarWashPermission from "../../hooks/useCarWashPermission";
import { FaCamera, FaChevronDown, FaChevronRight, FaEdit, FaExpand, FaFilePdf, FaMobileAlt, FaMoneyBillWave, FaPlus, FaPrint, FaRedoAlt, FaSearch, FaSms, FaTimes, FaTimesCircle, FaTrashAlt, FaUndoAlt } from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, getActiveBranchId, normalizeListPayload, photoUrl, todayISO } from "../../services/carWashApi";
import CarpetCameraModal from "../../components/common/CarpetCameraModal";
import CarWashShell from "./CarWashShell";
import { useConfirm } from "../../context/ConfirmContext";
import CwSmsModal from "./CwSmsModal";
import { clearDraft, readDraft, writeDraft } from "../../hooks/useFormDraft";
import { useTabState } from "../../hooks/useTabState";
import PaginationBar from "../../components/PaginationBar";

const Lightbox = ({ src, onClose }) => (
  <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 p-4" onClick={onClose}>
    <button type="button" onClick={onClose} className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
      <FaTimesCircle size={20} />
    </button>
    <img src={src} alt="Carpet" className="max-h-[90vh] max-w-[90vw] rounded object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
  </div>
);

const emptyPaymentForm = {
  job: "",
  amount: "",
  discountAmount: "",
  method: "cash",
  cashbookAccount: "",
  receivedFromPhone: "",
  paymentDate: todayISO(),
  reference: "",
};

const defaultFilters = {
  search: "",
  customer: "",
  service: "",
  staff: "",
  status: "",
  paymentStatus: "",
  jobType: "",
  dateFrom: todayISO(),
  dateTo: todayISO(),
};

const getWeekBounds = (offset = 0) => {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7) + offset * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    from: monday.toISOString().slice(0, 10),
    to: sunday.toISOString().slice(0, 10),
  };
};

const getMonthBounds = () => {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    from: first.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  };
};

const statuses = ["waiting", "washing", "drying", "ready", "done", "paid", "cancelled"];
const paymentMethods = ["cash", "mpesa", "bank", "card", "other"];
const DEFAULT_PAGE_SIZE = 25;

const statusLabels = {
  waiting:  "Waiting",
  washing:  "Washing",
  drying:   "Drying/Detailing",
  ready:    "Ready",
  done:     "Done",
  paid:     "Paid",
  cancelled:"Cancelled",
};

const getJobStatusLabel = (status, jobType) => {
  if (jobType === "carpet") {
    if (status === "washing") return "Processing";
    if (status === "ready") return "Ready";
    if (status === "done") return "Collected";
  }
  return statusLabels[status] || status;
};

const paymentBadgeClass = {
  paid: "border-emerald-200 bg-emerald-50 text-emerald-700",
  partial: "border-orange-200 bg-orange-50 text-orange-700",
  unpaid: "border-slate-200 bg-slate-50 text-slate-700",
};

const inputClass = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const labelClass = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";

// Returns the configured default cashbook for the given method.
// Falls back to regex guessing if no default is configured.
const preferredCashbookForMethod = (cashbooks = [], method = "cash", defaults = {}) => {
  if (defaults[method]) return defaults[method];
  const haystack = (item) => `${item?.name || ""} ${item?.code || ""}`.toLowerCase();
  if (method === "mpesa") return cashbooks.find((item) => /m-?pesa|mpesa/.test(haystack(item)))?._id || "";
  if (method === "bank" || method === "card") return cashbooks.find((item) => /bank/.test(haystack(item)))?._id || "";
  if (method === "cash") return cashbooks.find((item) => /cash|hand|safe/.test(haystack(item)))?._id || "";
  return cashbooks[0]?._id || "";
};

const Modal = ({ title, subtitle, children, footer, onClose }) => (
  <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/45 backdrop-blur-[2px] sm:items-center sm:p-4">
    <div className="flex w-full flex-col bg-white shadow-2xl sm:max-w-3xl sm:border sm:border-slate-200 max-h-[92dvh] sm:max-h-[90vh] rounded-t-2xl sm:rounded-none">
      <div className="flex-shrink-0 flex items-start justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white rounded-t-2xl sm:rounded-none">
        <div>
          <h2 className="text-sm font-extrabold uppercase tracking-wide">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs font-semibold text-emerald-50">{subtitle}</p>}
        </div>
        <button type="button" onClick={onClose} className="p-1 text-white/80 hover:bg-white/10 hover:text-white" title="Close">
          <FaTimes />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">{children}</div>
      {footer && <div className="flex-shrink-0 flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">{footer}</div>}
    </div>
  </div>
);

const EmptyRow = ({ colSpan, text }) => (
  <tr>
    <td colSpan={colSpan} className="px-3 py-10 text-center text-xs font-semibold text-slate-500">
      {text}
    </td>
  </tr>
);

// ─── Service / staff display helpers ─────────────────────────────────────────
const getServiceDisplay = (job) => {
  if (Array.isArray(job.serviceLines) && job.serviceLines.length > 1) {
    return `${job.serviceLines[0].serviceName} +${job.serviceLines.length - 1}`;
  }
  if (Array.isArray(job.serviceLines) && job.serviceLines.length === 1) return job.serviceLines[0].serviceName;
  return job.serviceName || "-";
};

const getStaffDisplay = (job) => {
  const list = Array.isArray(job.assignedStaff) ? job.assignedStaff : (job.assignedStaff ? [job.assignedStaff] : []);
  if (!list.length) return "-";
  if (list.length === 1) return list[0]?.name || "-";
  return `${list[0]?.name || "?"} +${list.length - 1}`;
};

const PhoneDisplay = ({ phone, maskedMsisdn }) =>
  phone ? phone
  : maskedMsisdn ? <span className="font-semibold text-emerald-600">M-Pesa · SMS ready</span>
  : <span className="italic text-slate-400">via M-Pesa on payment</span>;

const MobileJobCard = React.memo(({
  job, expanded, selected, jobPaymentsEntry,
  canUpdateJob, canRecordPayment,
  onToggleExpand, onToggleSelect, onUpdateStatus, onOpenPayment, onOpenSms, onReversePayment, onNavigateEdit, onPrint, onDownloadPdf,
}) => {
  const canDelete = job.paymentStatus === "unpaid" && job.status !== "paid";
  return (
    <div className="p-3">
      <div className="flex items-start gap-2">
        <input type="checkbox" className="mt-1 shrink-0" checked={selected} onChange={() => onToggleSelect(job._id)} disabled={!canDelete} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-extrabold text-slate-900">{job.jobNumber}</span>
            {job.jobType === "carpet" && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-700">Carpet</span>}
            <span className={`inline-flex border px-1.5 py-0.5 text-[10px] font-bold uppercase ${paymentBadgeClass[job.paymentStatus] || paymentBadgeClass.unpaid}`}>{job.paymentStatus || "unpaid"}</span>
          </div>
          <div className="mt-0.5 text-sm font-extrabold uppercase text-slate-900">
            {job.jobType === "carpet" ? <span className="font-semibold normal-case text-slate-700">{job.itemDescription || "-"}</span> : (job.plateNumber || "-")}
          </div>
          {job.customerName && <div className="text-xs text-slate-500">{job.customerName}</div>}
          <div className="text-xs text-slate-400">{getServiceDisplay(job)} · {getStaffDisplay(job)}</div>
        </div>
        <div className="flex-shrink-0 text-right">
          {Number(job.discountAmount) > 0 ? (
            <div>
              <div className="text-[10px] text-slate-400 line-through">{formatMoney(job.price)}</div>
              <div className="font-extrabold text-slate-900">{formatMoney(Math.max(0, job.price - job.discountAmount))}</div>
            </div>
          ) : <span className="font-extrabold text-slate-900">{formatMoney(job.price)}</span>}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <select
          className="h-7 border border-slate-300 bg-white px-2 text-[11px] font-bold text-slate-700 focus:outline-none"
          value={job.status}
          onChange={(e) => onUpdateStatus(job, e.target.value)}
        >
          {statuses.filter((s) => job.status === "paid" ? s === "paid" : s !== "paid").map((s) => (
            <option key={s} value={s}>{getJobStatusLabel(s, job.jobType)}</option>
          ))}
        </select>
        {job.status === "waiting" && (
          <button
            type="button"
            onClick={() => onUpdateStatus(job, "washing")}
            className="h-7 whitespace-nowrap border border-blue-300 bg-blue-50 px-2.5 text-[11px] font-bold text-blue-700 hover:bg-blue-100"
          >
            → Wash
          </button>
        )}
        {job.status === "washing" && (
          <button
            type="button"
            onClick={() => onUpdateStatus(job, "drying")}
            className="h-7 whitespace-nowrap border border-purple-300 bg-purple-50 px-2.5 text-[11px] font-bold text-purple-700 hover:bg-purple-100"
          >
            → Dry
          </button>
        )}
        {job.status === "drying" && (
          <button
            type="button"
            onClick={() => onUpdateStatus(job, "ready")}
            className="h-7 whitespace-nowrap border border-emerald-300 bg-emerald-50 px-2.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100"
          >
            → Ready
          </button>
        )}
        {job.status === "ready" && (
          <button
            type="button"
            onClick={() => onUpdateStatus(job, "done")}
            className="h-7 whitespace-nowrap border border-teal-300 bg-teal-50 px-2.5 text-[11px] font-bold text-teal-700 hover:bg-teal-100"
          >
            → Done
          </button>
        )}
        {canUpdateJob && (
          <button type="button" onClick={() => onNavigateEdit(job._id)} disabled={job.status === "cancelled"} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 py-1 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:opacity-40">
            <FaEdit className="text-[9px]" /> Edit
          </button>
        )}
        {canRecordPayment && (
          <button type="button" onClick={() => onOpenPayment(job)} disabled={job.paymentStatus === "paid"} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 py-1 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:opacity-50">
            Pay
          </button>
        )}
        {(job.phone || job.maskedMsisdn) && job.status === "ready" && job.paymentStatus !== "paid" && (
          <button type="button" onClick={() => onOpenSms(job, "ready")} className="inline-flex items-center gap-1 border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
            <FaSms /> Ready
          </button>
        )}
        {(job.phone || job.maskedMsisdn) && (
          <button type="button" onClick={() => onOpenSms(job)} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 py-1 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaSms /> SMS
          </button>
        )}
        <button type="button" onClick={() => onPrint(job)} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 py-1 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
          <FaPrint className="text-[9px]" /> Print
        </button>
        <button type="button" onClick={() => onDownloadPdf(job)} className="inline-flex items-center gap-1 border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-100">
          <FaFilePdf className="text-[9px]" /> PDF
        </button>
        <button type="button" onClick={() => onToggleExpand(job._id)} className="ml-auto inline-flex items-center gap-1 border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-500">
          {expanded ? <FaChevronDown className="text-[9px]" /> : <FaChevronRight className="text-[9px]" />} Details
        </button>
      </div>
      {expanded && (
        <div className="mt-2 space-y-1 rounded border border-slate-200 bg-[#F8FBF9] p-2 text-[11px] text-slate-600">
          <div><span className="font-extrabold uppercase text-slate-500">Time:</span> {job.createdAt ? new Date(job.createdAt).toLocaleString("en-KE") : "-"}</div>
          <div><span className="font-extrabold uppercase text-slate-500">Phone:</span>{" "}<PhoneDisplay phone={job.phone} maskedMsisdn={job.maskedMsisdn} /></div>
          {job.notes && <div><span className="font-extrabold uppercase text-slate-500">Notes:</span> {job.notes}</div>}
          <div>
            <span className="font-extrabold uppercase text-slate-500">Payments:</span>
            {jobPaymentsEntry?.loading && <span className="ml-1 italic text-slate-400">Loading…</span>}
            {!jobPaymentsEntry?.loading && !jobPaymentsEntry?.list?.length && <span className="ml-1 italic text-slate-400">None recorded</span>}
            {!jobPaymentsEntry?.loading && jobPaymentsEntry?.list?.length > 0 && (
              <div className="mt-1 space-y-1">
                {jobPaymentsEntry.list.map((pmt) => (
                  <div key={pmt._id} className="flex items-center justify-between rounded bg-white px-2 py-1">
                    <span>{pmt.method?.toUpperCase()} · {pmt.paymentDate ? new Date(pmt.paymentDate).toLocaleDateString("en-KE") : "—"}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-bold">{formatMoney(pmt.amount)}</span>
                      <button type="button" onClick={() => onReversePayment(pmt._id, job._id)} className="text-red-500 hover:text-red-700" title="Reverse"><FaUndoAlt className="text-[9px]" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

const DesktopJobRow = React.memo(({
  job, expanded, selected, jobPaymentsEntry, jobPhotosList, isCameraOpen,
  isConsolidated, canUpdateJob, canRecordPayment,
  onToggleExpand, onToggleSelect, onUpdateStatus, onOpenPayment, onOpenSms, onReversePayment, onNavigateEdit,
  onSetPhotos, onSetCameraJobId, onSetLightboxSrc, onPrint, onDownloadPdf,
}) => {
  const canDelete = job.paymentStatus === "unpaid" && job.status !== "paid";
  return (
    <React.Fragment>
      <tr className="border-b border-slate-200 hover:bg-slate-50">
        <td className="px-2 py-1">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(job._id)}
            disabled={!canDelete}
            title={canDelete ? "Select job" : "Only unpaid jobs with no payments can be deleted"}
          />
        </td>
        <td className="px-2 py-1">
          <button type="button" onClick={() => onToggleExpand(job._id)} className="text-[#0B3B2E] hover:text-[#FF8C00]" title={expanded ? "Hide details" : "Show details"}>
            {expanded ? <FaChevronDown /> : <FaChevronRight />}
          </button>
        </td>
        <td className="px-2 py-1 font-extrabold text-slate-900">
          {job.jobNumber}
          {job.jobType === "carpet" && (
            <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold uppercase text-amber-700">Carpet</span>
          )}
        </td>
        <td className="px-2 py-1 font-extrabold uppercase text-slate-900">
          {job.jobType === "carpet"
            ? <span className="font-semibold normal-case text-slate-700">{job.itemDescription || "-"}</span>
            : job.plateNumber || "-"}
        </td>
        <td className="px-2 py-1 font-semibold text-slate-800">{job.customerName || "-"}</td>
        <td className="px-2 py-1 text-slate-700">{getServiceDisplay(job)}</td>
        <td className="px-2 py-1 text-slate-700">{getStaffDisplay(job)}</td>
        {isConsolidated && <td className="px-2 py-1 text-slate-600">{job.branch?.name || <span className="text-slate-400">—</span>}</td>}
        <td className="px-2 py-1">
          <div className="flex items-center gap-1">
            <select
              className="h-6 max-w-[76px] border border-slate-300 bg-white px-1 text-[11px] font-bold text-slate-700"
              value={job.status}
              onChange={(event) => onUpdateStatus(job, event.target.value)}
            >
              {statuses
                .filter((status) => job.status === "paid" ? status === "paid" : status !== "paid" || job.paymentStatus === "paid")
                .map((status) => (
                  <option key={status} value={status}>
                    {getJobStatusLabel(status, job.jobType)}
                  </option>
                ))}
            </select>
            {job.status === "waiting" && (
              <button
                type="button"
                title="Move to Washing"
                onClick={() => onUpdateStatus(job, "washing")}
                className="h-6 whitespace-nowrap border border-blue-300 bg-blue-50 px-2 text-[10px] font-bold text-blue-700 hover:bg-blue-100"
              >
                → Wash
              </button>
            )}
            {job.status === "washing" && (
              <button
                type="button"
                title="Move to Drying/Detailing"
                onClick={() => onUpdateStatus(job, "drying")}
                className="h-6 whitespace-nowrap border border-purple-300 bg-purple-50 px-2 text-[10px] font-bold text-purple-700 hover:bg-purple-100"
              >
                → Dry
              </button>
            )}
            {job.status === "drying" && (
              <button
                type="button"
                title="Mark as Ready"
                onClick={() => onUpdateStatus(job, "ready")}
                className="h-6 whitespace-nowrap border border-emerald-300 bg-emerald-50 px-2 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100"
              >
                → Ready
              </button>
            )}
            {job.status === "ready" && (
              <button
                type="button"
                title="Mark as Done (Collected)"
                onClick={() => onUpdateStatus(job, "done")}
                className="h-6 whitespace-nowrap border border-teal-300 bg-teal-50 px-2 text-[10px] font-bold text-teal-700 hover:bg-teal-100"
              >
                → Done
              </button>
            )}
          </div>
        </td>
        <td className="px-2 py-1">
          <span className={`inline-flex border px-2 py-0.5 text-[11px] font-bold uppercase ${paymentBadgeClass[job.paymentStatus] || paymentBadgeClass.unpaid}`}>
            {job.paymentStatus || "unpaid"}
          </span>
        </td>
        <td className="px-2 py-1 text-right font-extrabold text-slate-900">
          {Number(job.discountAmount) > 0 ? (
            <span className="flex flex-col items-end gap-0.5">
              <span className="text-[10px] text-slate-400 line-through">{formatMoney(job.price)}</span>
              <span>{formatMoney(Math.max(0, job.price - job.discountAmount))}</span>
            </span>
          ) : formatMoney(job.price)}
        </td>
        <td className="px-2 py-1 text-right">
          <div className="inline-flex items-center gap-1">
            {canUpdateJob && (
              <button
                type="button"
                onClick={() => onNavigateEdit(job._id)}
                disabled={job.status === "cancelled"}
                className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:cursor-not-allowed disabled:opacity-40"
                title="Edit job"
              >
                <FaEdit className="text-[9px]" /> Edit
              </button>
            )}
            {canRecordPayment && (
              <button
                type="button"
                onClick={() => onOpenPayment(job)}
                disabled={job.paymentStatus === "paid"}
                className="border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Pay
              </button>
            )}
            {(job.phone || job.maskedMsisdn) && job.status === "ready" && job.paymentStatus !== "paid" && (
              <button
                type="button"
                onClick={() => onOpenSms(job, "ready")}
                className="inline-flex items-center gap-1 border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100"
                title="Notify customer — job ready for collection"
              >
                <FaSms /> Ready
              </button>
            )}
            {(job.phone || job.maskedMsisdn) && (
              <button
                type="button"
                onClick={() => onOpenSms(job)}
                className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
                title={job.phone ? `Send SMS to ${job.phone}` : "Send SMS via M-Pesa masked number"}
              >
                <FaSms /> SMS
              </button>
            )}
            <button
              type="button"
              onClick={() => onPrint(job)}
              className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
              title="Print receipt"
            >
              <FaPrint className="text-[9px]" /> Print
            </button>
            <button
              type="button"
              onClick={() => onDownloadPdf(job)}
              className="inline-flex items-center gap-1 border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700 hover:bg-red-100"
              title="Download PDF receipt"
            >
              <FaFilePdf className="text-[9px]" /> PDF
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-slate-200 bg-[#F8FBF9]">
          <td colSpan={isConsolidated ? 12 : 11} className="px-10 py-3">
            <div className="grid gap-3 text-[11px] text-slate-600 md:grid-cols-5">
              <div><span className="font-extrabold uppercase text-slate-500">Time:</span> {job.createdAt ? new Date(job.createdAt).toLocaleString("en-KE") : "-"}</div>
              <div>
                <span className="font-extrabold uppercase text-slate-500">Phone:</span>{" "}
                <PhoneDisplay phone={job.phone} maskedMsisdn={job.maskedMsisdn} />
              </div>
              {job.jobType === "carpet" ? (
                <div><span className="font-extrabold uppercase text-slate-500">Ready By:</span> {job.expectedReadyAt ? new Date(job.expectedReadyAt).toLocaleDateString("en-KE") : "-"}</div>
              ) : (
                <div><span className="font-extrabold uppercase text-slate-500">Vehicle:</span> {job.serviceLines?.[0]?.vehicleType || job.vehicleType || "-"}</div>
              )}
              <div>
                <span className="font-extrabold uppercase text-slate-500">Staff:</span>{" "}
                {Array.isArray(job.assignedStaff) && job.assignedStaff.length
                  ? job.assignedStaff.map((s) => s?.name || s).join(", ")
                  : "-"}
              </div>
              <div><span className="font-extrabold uppercase text-slate-500">Delete:</span> {canDelete ? "Safe" : "Locked"}</div>
              {Array.isArray(job.serviceLines) && job.serviceLines.length > 1 && (
                <div className="md:col-span-5">
                  <span className="font-extrabold uppercase text-slate-500">Service Lines:</span>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {job.serviceLines.map((line, li) => (
                      <span key={li} className="inline-flex items-center gap-1 border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                        {line.serviceName} — {formatMoney(line.price)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="md:col-span-5"><span className="font-extrabold uppercase text-slate-500">Notes:</span> {job.notes || "-"}</div>
              {job.jobType === "carpet" && (() => {
                const photos = jobPhotosList ?? (Array.isArray(job.photos) ? job.photos : []);
                const handleCapture = async (file) => {
                  if (photos.length >= 5) { toast.error("Max 5 photos per job"); return; }
                  try {
                    const result = await carWashApi.uploadJobPhotos(job._id, [file]);
                    onSetPhotos(job._id, result?.photos || photos);
                    toast.success("Photo added");
                  } catch { toast.error("Upload failed"); }
                };
                const handleDelete = async (url) => {
                  try {
                    const result = await carWashApi.deleteJobPhoto(job._id, url);
                    onSetPhotos(job._id, result?.photos || photos.filter((p) => p !== url));
                  } catch { toast.error("Delete failed"); }
                };
                return (
                  <div className="md:col-span-5">
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="font-extrabold uppercase text-slate-500">Carpet Photos:</span>
                      {photos.length < 5 && (
                        <button type="button" onClick={() => onSetCameraJobId(job._id)} className="inline-flex items-center gap-1 rounded border border-[#B7C9C0] bg-white px-2 py-0.5 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                          <FaCamera size={8} /> Take Photo
                        </button>
                      )}
                      {isCameraOpen && (
                        <CarpetCameraModal
                          onCapture={handleCapture}
                          onClose={() => onSetCameraJobId(null)}
                        />
                      )}
                    </div>
                    {photos.length === 0 ? (
                      <span className="italic text-slate-400">No photos — click "Take Photo" to add one</span>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {photos.map((url) => (
                          <div key={url} className="group relative h-20 w-20 overflow-hidden rounded border border-slate-200 bg-slate-100">
                            <img src={photoUrl(url)} alt="Carpet" className="h-full w-full cursor-pointer object-cover" onClick={() => onSetLightboxSrc(photoUrl(url))} />
                            <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/0 opacity-0 transition-all group-hover:bg-black/30 group-hover:opacity-100">
                              <button type="button" onClick={() => onSetLightboxSrc(photoUrl(url))} className="rounded-full bg-white/80 p-1 text-slate-700"><FaExpand size={9} /></button>
                              <button type="button" onClick={() => handleDelete(url)} className="rounded-full bg-red-500/90 p-1 text-white"><FaTimesCircle size={9} /></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
              <div className="md:col-span-5">
                <span className="font-extrabold uppercase text-slate-500">Payments:</span>
                {jobPaymentsEntry?.loading && (
                  <span className="ml-2 italic text-slate-400">Loading…</span>
                )}
                {!jobPaymentsEntry?.loading && jobPaymentsEntry?.list?.length === 0 && (
                  <span className="ml-2 italic text-slate-400">No payments recorded</span>
                )}
                {!jobPaymentsEntry?.loading && jobPaymentsEntry?.list?.length > 0 && (
                  <div className="mt-1.5 overflow-x-auto">
                    <table className="min-w-[520px] text-[11px]">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500">
                          <th className="pb-1 pr-4 text-left font-extrabold uppercase">Date</th>
                          <th className="pb-1 pr-4 text-left font-extrabold uppercase">Method</th>
                          <th className="pb-1 pr-4 text-left font-extrabold uppercase">Reference</th>
                          <th className="pb-1 pr-4 text-right font-extrabold uppercase">Amount</th>
                          <th className="pb-1 text-right font-extrabold uppercase">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {jobPaymentsEntry.list.map((pmt) => (
                          <tr key={pmt._id} className="border-b border-slate-100">
                            <td className="py-1 pr-4 text-slate-600">
                              {pmt.paymentDate ? new Date(pmt.paymentDate).toLocaleDateString("en-KE") : "—"}
                            </td>
                            <td className="py-1 pr-4 font-bold uppercase text-slate-700">{pmt.method}</td>
                            <td className="py-1 pr-4 text-slate-500">{pmt.reference || "—"}</td>
                            <td className="py-1 pr-4 text-right font-extrabold text-slate-900">{formatMoney(pmt.amount)}</td>
                            <td className="py-1 text-right">
                              <button
                                type="button"
                                onClick={() => onReversePayment(pmt._id, job._id)}
                                className="inline-flex items-center gap-1 border border-red-200 bg-white px-2 py-0.5 text-[10px] font-bold text-red-600 hover:bg-red-50"
                                title="Reverse this payment"
                              >
                                <FaUndoAlt className="text-[8px]" /> Reverse
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  );
});

const CarWashJobs = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const confirm = useConfirm();
  const currentCompany = useSelector(selectCurrentCompany);
  const isConsolidated = !getActiveBranchId();
  const [jobs, setJobs] = useState([]);

  // Reference data — cached across navigations; avoids refetch on every mount
  const { data: servicesRaw } = useQuery({
    queryKey: ["cw-services-ref"],
    queryFn: () => carWashApi.listServices({ active: true, limit: 500 }),
    staleTime: 5 * 60_000,
    select: (data) => normalizeListPayload(data, "services"),
  });
  const services = servicesRaw ?? [];

  const { data: staffRaw } = useQuery({
    queryKey: ["cw-staff-ref"],
    queryFn: () => carWashApi.listStaff({ active: true }),
    staleTime: 5 * 60_000,
    select: (data) => normalizeListPayload(data, "staff"),
  });
  const staff = staffRaw ?? [];

  const { data: cashbooksRaw } = useQuery({
    queryKey: ["cw-job-cashbooks", currentCompany?._id],
    queryFn: () => carWashApi.listChartOfAccounts({ business: currentCompany._id, type: "asset", moduleScope: "carwash", search: "Cashbooks" }),
    enabled: !!currentCompany?._id,
    staleTime: 5 * 60_000,
    select: (data) => Array.isArray(data) ? data : [],
  });
  const cashbooks = cashbooksRaw ?? [];

  const { data: settingsAndBranch } = useQuery({
    queryKey: ["cw-job-defaults", currentCompany?._id],
    queryFn: () => Promise.allSettled([
      carWashApi.getCarWashSettings(),
      carWashApi.getActiveBranch(),
    ]).then(([s, b]) => ({ settings: s.value ?? null, branch: b.value ?? null })),
    enabled: !!currentCompany?._id,
    staleTime: 5 * 60_000,
  });

  const cashbookDefaults = useMemo(() => {
    const companyDefaults = settingsAndBranch?.settings?.defaultCashbooks || {};
    const branchDefaults  = settingsAndBranch?.branch?.defaultCashbooks   || {};
    const defs = {};
    ["cash", "mpesa", "bank", "card", "other"].forEach((m) => {
      const branch  = branchDefaults[m]?._id  || branchDefaults[m]  || "";
      const company = companyDefaults[m]?._id || companyDefaults[m] || "";
      defs[m] = branch || company;
    });
    return defs;
  }, [settingsAndBranch]);
  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm);
  const [filters, setFilters] = useTabState("/carwash/jobs:filters", () => {
    const p      = new URLSearchParams(location.search);
    const plate  = p.get("plate");
    const status = p.get("status");
    const from   = p.get("dateFrom");
    const to     = p.get("dateTo");
    if (plate)  return { ...defaultFilters, search: plate, dateFrom: "", dateTo: "" };
    if (status || from) return { ...defaultFilters, status: status || "", dateFrom: from || defaultFilters.dateFrom, dateTo: to || defaultFilters.dateTo };
    return defaultFilters;
  });
  const [appliedFilters, setAppliedFilters] = useTabState("/carwash/jobs:appliedFilters", () => {
    const p      = new URLSearchParams(location.search);
    const plate  = p.get("plate");
    const status = p.get("status");
    const from   = p.get("dateFrom");
    const to     = p.get("dateTo");
    if (plate)  return { ...defaultFilters, search: plate, dateFrom: "", dateTo: "" };
    if (status || from) return { ...defaultFilters, status: status || "", dateFrom: from || defaultFilters.dateFrom, dateTo: to || defaultFilters.dateTo };
    return defaultFilters;
  });
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentJobPaidSoFar, setPaymentJobPaidSoFar] = useState(0);
  const [plateCredit, setPlateCredit] = useState(null); // { creditBalance, credits, customer }
  const [applyCredit, setApplyCredit] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [expandedIds, setExpandedIds] = useState([]);
  const [pageSize, setPageSize] = useTabState("/carwash/jobs:pageSize", DEFAULT_PAGE_SIZE);
  const [page, setPage] = useTabState("/carwash/jobs:page", 1);
  const [pagination, setPagination] = useState({ page: 1, limit: DEFAULT_PAGE_SIZE, total: 0, pages: 1 });
  const [loading, setLoading] = useState(false);
  const [modalUnpaidJobs, setModalUnpaidJobs] = useState([]);
  const [smsTarget, setSmsTarget] = useState(null);
  const [smsBody, setSmsBody] = useState("");
  const [smsSending, setSmsSending] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [jobPhotos, setJobPhotos]     = useState({});    // { [jobId]: string[] }
  const [cameraJobId, setCameraJobId] = useState(null);  // jobId that has camera open
  const [stkPushing, setStkPushing] = useState(false);
  const [submittingPayment, setSubmittingPayment] = useState(false);
  // job-level payments: { [jobId]: { loading: bool, list: [] } }
  const [jobPayments, setJobPayments] = useState({});

  const canCreateJob     = useCarWashPermission("carwash-jobs", "create");
  const canUpdateJob     = useCarWashPermission("carwash-jobs", "update");
  const canRecordPayment = useCarWashPermission("carwash-payments", "record");

  const { jobStats, safeVisibleJobIds } = useMemo(() => {
    let unpaid = 0, washing = 0, done = 0;
    const safeIds = [];
    for (const job of jobs) {
      if (job.paymentStatus !== "paid") unpaid++;
      if (job.paymentStatus === "unpaid" && job.status !== "paid") safeIds.push(job._id);
      if (job.status === "washing" || job.status === "drying") washing++;
      if (job.status === "done") done++;
    }
    return { jobStats: { unpaid, washing, done }, safeVisibleJobIds: safeIds };
  }, [jobs]);
  const allPaymentJobs = useMemo(() => {
    const seen = new Set();
    return [...modalUnpaidJobs, ...jobs].filter((j) => { if (seen.has(j._id)) return false; seen.add(j._id); return true; });
  }, [modalUnpaidJobs, jobs]);
  const selectedPaymentJob = useMemo(() => allPaymentJobs.find((job) => job._id === paymentForm.job), [allPaymentJobs, paymentForm.job]);
  const selectedCashbook = useMemo(() => cashbooks.find((item) => item._id === paymentForm.cashbookAccount), [cashbooks, paymentForm.cashbookAccount]);
  const outstandingForModal = useMemo(() => {
    const net = Math.max(0, Number(selectedPaymentJob?.price || 0) - Number(selectedPaymentJob?.discountAmount || 0));
    return Math.max(0, net - paymentJobPaidSoFar);
  }, [selectedPaymentJob, paymentJobPaidSoFar]);

  const writeOffHeadroom = useMemo(() => {
    const maxPct = Number(settingsAndBranch?.settings?.discountMaxPercent ?? 0);
    if (!maxPct || !selectedPaymentJob) return null;
    const cap        = Math.round(Number(selectedPaymentJob.price || 0) * maxPct / 100 * 100) / 100;
    const jobDiscount = Number(selectedPaymentJob.discountAmount || 0);
    return Math.max(0, cap - jobDiscount);
  }, [settingsAndBranch, selectedPaymentJob]);

  const dateBounds = useMemo(() => ({
    today: todayISO(),
    week:  getWeekBounds(0),
    lweek: getWeekBounds(-1),
    month: getMonthBounds(),
  }), []);

  const quickPickActive = useMemo(() => {
    const { today, week, lweek, month } = dateBounds;
    if (filters.dateFrom === today      && filters.dateTo === today)     return "today";
    if (filters.dateFrom === week.from  && filters.dateTo === week.to)   return "thisWeek";
    if (filters.dateFrom === lweek.from && filters.dateTo === lweek.to)  return "lastWeek";
    if (filters.dateFrom === month.from && filters.dateTo === month.to)  return "month";
    return "";
  }, [filters.dateFrom, filters.dateTo, dateBounds]);

  // Refs let stable useCallback closures always read latest state without being re-created
  const jobsRef = useRef(jobs);
  useEffect(() => { jobsRef.current = jobs; }, [jobs]);
  const jobPaymentsRef = useRef(jobPayments);
  useEffect(() => { jobPaymentsRef.current = jobPayments; }, [jobPayments]);
  const cashbooksRef = useRef(cashbooks);
  useEffect(() => { cashbooksRef.current = cashbooks; }, [cashbooks]);
  const cashbookDefaultsRef = useRef(cashbookDefaults);
  useEffect(() => { cashbookDefaultsRef.current = cashbookDefaults; }, [cashbookDefaults]);
  const loadJobsRef = useRef(null);
  const updatingJobsRef = useRef(new Set());

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const jobPayload = await carWashApi.listJobs({
        dateFrom: appliedFilters.dateFrom || undefined,
        dateTo: appliedFilters.dateTo || undefined,
        search: appliedFilters.search || undefined,
        customer: appliedFilters.customer || undefined,
        service: appliedFilters.service || undefined,
        staff: appliedFilters.staff || undefined,
        status: appliedFilters.status || undefined,
        paymentStatus: appliedFilters.paymentStatus || undefined,
        jobType: appliedFilters.jobType || undefined,
        limit: pageSize,
        page,
      });
      setJobs(normalizeListPayload(jobPayload, "jobs"));
      setPagination(jobPayload?.pagination || { page, limit: pageSize, total: normalizeListPayload(jobPayload, "jobs").length, pages: 1 });
      setSelectedIds([]);
      setExpandedIds([]);
    } catch {
      toast.error("Failed to load Car Wash jobs");
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, page, pageSize]);
  useEffect(() => { loadJobsRef.current = loadJobs; }, [loadJobs]);

  const load = useCallback(() => loadJobsRef.current?.(), []);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  useEffect(() => {
    if (!selectedPaymentJob) return;
    setPaymentForm((prev) => ({
      ...prev,
      amount: prev.amount || String(outstandingForModal || selectedPaymentJob.price || ""),
    }));
  }, [selectedPaymentJob, outstandingForModal]);

  useEffect(() => {
    if (!cashbooks.length || paymentForm.cashbookAccount) return;
    setPaymentForm((prev) => ({ ...prev, cashbookAccount: preferredCashbookForMethod(cashbooks, prev.method, cashbookDefaults) }));
  }, [cashbooks, paymentForm.cashbookAccount]);

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => jobs.some((job) => job._id === id)));
    setExpandedIds((prev) => prev.filter((id) => jobs.some((job) => job._id === id)));
  }, [jobs]);

  const closePaymentModal = () => {
    clearDraft("cw-payment-form");
    setShowPaymentModal(false);
    setPaymentForm(emptyPaymentForm);
    setModalUnpaidJobs([]);
    setPaymentJobPaidSoFar(0);
    setPlateCredit(null);
    setApplyCredit(false);
  };

  // Auto-save payment form draft (non-computed fields only)
  useEffect(() => {
    if (!showPaymentModal) return;
    const { job, method, cashbookAccount, discountAmount, reference, receivedFromPhone, paymentDate } = paymentForm;
    const t = setTimeout(() => writeDraft("cw-payment-form", { job, method, cashbookAccount, discountAmount, reference, receivedFromPhone, paymentDate }), 400);
    return () => clearTimeout(t);
  }, [paymentForm.job, paymentForm.method, paymentForm.cashbookAccount, paymentForm.discountAmount, paymentForm.reference, paymentForm.receivedFromPhone, paymentForm.paymentDate, showPaymentModal]);

  const openPaymentModal = useCallback(async (job = null) => {
    const draft = readDraft("cw-payment-form");
    const useDraft = draft?.job === job?._id;
    const cachedList = job?._id ? jobPaymentsRef.current[job._id]?.list : null;
    const cachedPaid = cachedList
      ? cachedList.reduce((s, p) => s + Number(p.amount || 0) + Number(p.discountAmount || 0), 0)
      : 0;
    const initialOutstanding = Math.max(0, Number(job?.price || 0) - Number(job?.discountAmount || 0) - cachedPaid);
    setPaymentJobPaidSoFar(cachedPaid);
    setPaymentForm({
      ...emptyPaymentForm,
      job: job?._id || "",
      amount: job ? String(initialOutstanding) : "",
      method:            useDraft ? draft.method            : emptyPaymentForm.method,
      cashbookAccount:   useDraft ? draft.cashbookAccount   : preferredCashbookForMethod(cashbooksRef.current, emptyPaymentForm.method, cashbookDefaultsRef.current),
      discountAmount:    useDraft ? draft.discountAmount     : "",
      reference:         useDraft ? draft.reference          : "",
      receivedFromPhone: useDraft ? draft.receivedFromPhone  : String(job?.phone || "").trim(),
      paymentDate:       useDraft ? draft.paymentDate        : todayISO(),
    });
    setModalUnpaidJobs(jobsRef.current.filter((j) => j.paymentStatus !== "paid"));
    setShowPaymentModal(true);
    setPlateCredit(null);
    setApplyCredit(false);
    try {
      const needsPayments = job?._id && !cachedList;
      const plate = job?.plateNumber;
      const [jobsPayload, pmtsPayload, creditPayload] = await Promise.all([
        carWashApi.listJobs({ limit: 100 }),
        needsPayments ? carWashApi.listPayments({ job: job._id, limit: 20 }) : Promise.resolve(null),
        plate ? carWashApi.getCreditByPlate(plate).catch(() => null) : Promise.resolve(null),
      ]);
      setModalUnpaidJobs(normalizeListPayload(jobsPayload, "jobs").filter((j) => j.paymentStatus !== "paid"));
      if (pmtsPayload && job) {
        const list = normalizeListPayload(pmtsPayload, "payments");
        const paid = list.reduce((s, p) => s + Number(p.amount || 0) + Number(p.discountAmount || 0), 0);
        const precise = Math.max(0, Number(job.price || 0) - Number(job.discountAmount || 0) - paid);
        setPaymentJobPaidSoFar(paid);
        setPaymentForm((prev) => prev.job === job._id ? { ...prev, amount: String(precise) } : prev);
      }
      if (creditPayload?.creditBalance > 0.01) {
        setPlateCredit(creditPayload);
      }
    } catch { /* modal already seeded from page jobs above */ }
  }, []);

  const recordPayment = async (event) => {
    event.preventDefault();
    if (submittingPayment) return;
    if (paymentForm.method === "mpesa" && !paymentForm.reference?.trim()) {
      toast.error("M-Pesa transaction code is required");
      return;
    }
    setSubmittingPayment(true);
    try {
      const res = await carWashApi.recordPayment({
        ...paymentForm,
        amount: Number(paymentForm.amount || 0),
        discountAmount: Number(paymentForm.discountAmount || 0),
      });
      // Apply ALL active credits if cashier toggled it (customer must have asked)
      if (applyCredit && plateCredit?.credits?.length) {
        const results = await Promise.allSettled(
          plateCredit.credits.map((cr) => carWashApi.applyCredit(cr._id, paymentForm.job))
        );
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed === results.length) {
          toast.warn("Payment recorded but credit application failed — apply manually from Credit Balances");
        } else {
          toast.success(`Credit applied (${results.length - failed}/${results.length})`);
        }
      } else if (res?.creditCreated && res?.creditAmount > 0) {
        toast.info(`KES ${res.creditAmount.toLocaleString()} credit added to customer account`);
      }
      setJobPayments((prev) => { const n = { ...prev }; delete n[paymentForm.job]; return n; });
      closePaymentModal();
      await loadJobsRef.current?.();
      toast.success("Payment recorded");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to record payment");
    } finally {
      setSubmittingPayment(false);
    }
  };

  const sendStkPush = async () => {
    const phone = paymentForm.receivedFromPhone?.trim();
    const amount = Number(paymentForm.amount || 0);
    if (!phone) { toast.error("Enter customer phone number first"); return; }
    if (amount <= 0) { toast.error("Enter payment amount first"); return; }
    setStkPushing(true);
    try {
      const job = allPaymentJobs.find((j) => j._id === paymentForm.job);
      await carWashApi.initiateStkPush({
        phone,
        amount,
        jobId: paymentForm.job,
        accountRef: job?.plateNumber || job?.jobNumber || "CarWash",
      });
      toast.success(`M-Pesa payment request sent to ${phone} — ask customer to check their phone`);
    } catch (error) {
      toast.error(error?.response?.data?.message || "M-Pesa push failed");
    } finally {
      setStkPushing(false);
    }
  };

  const updateStatus = useCallback(async (job, status) => {
    if (updatingJobsRef.current.has(job._id)) return;
    updatingJobsRef.current.add(job._id);
    const previous = job.status;
    setJobs((prev) => prev.map((j) => (j._id === job._id ? { ...j, status } : j)));
    try {
      await carWashApi.updateJobStatus(job._id, status);
    } catch (error) {
      setJobs((prev) => prev.map((j) => (j._id === job._id ? { ...j, status: previous } : j)));
      toast.error(error?.response?.data?.message || "Unable to update job status");
    } finally {
      updatingJobsRef.current.delete(job._id);
    }
  }, []);

  const toggleSelected = useCallback((id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }, []);

  const loadJobPayments = useCallback(async (jobId) => {
    setJobPayments((prev) => {
      if (prev[jobId]) return prev; // already loaded
      return { ...prev, [jobId]: { loading: true, list: [] } };
    });
    try {
      const payload = await carWashApi.listPayments({ job: jobId, limit: 20 });
      const list = normalizeListPayload(payload, "payments");
      setJobPayments((prev) => ({ ...prev, [jobId]: { loading: false, list } }));
    } catch {
      setJobPayments((prev) => ({ ...prev, [jobId]: { loading: false, list: [] } }));
    }
  }, []);

  const toggleExpanded = useCallback((id) => {
    setExpandedIds((prev) => {
      const expanding = !prev.includes(id);
      if (expanding) loadJobPayments(id);
      return expanding ? [...prev, id] : prev.filter((item) => item !== id);
    });
  }, [loadJobPayments]);

  const reversePayment = useCallback(async (paymentId, jobId) => {
    const confirmed = await confirm({
      title: "Reverse Payment",
      message: "This deletes the payment record, reverts the job payment status, and cancels any unpaid commissions. This action cannot be undone.",
      confirmText: "Reverse",
      isDangerous: true,
    });
    if (!confirmed) return;
    try {
      await carWashApi.deletePayment(paymentId);
      await loadJobsRef.current?.();
      setJobPayments((prev) => { const next = { ...prev }; delete next[jobId]; return next; });
      toast.success("Payment reversed");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to reverse payment");
    }
  }, [confirm]);

  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      const allSelected = safeVisibleJobIds.length > 0 && safeVisibleJobIds.every((id) => prev.includes(id));
      if (allSelected) return prev.filter((id) => !safeVisibleJobIds.includes(id));
      return Array.from(new Set([...prev, ...safeVisibleJobIds]));
    });
  };

  const deleteSelectedJobs = async () => {
    if (!selectedIds.length) return;
    const confirmed = await confirm({ title: "Delete Jobs", message: "Delete selected unpaid jobs? Jobs with payments cannot be deleted.", confirmText: "Delete", isDangerous: true });
    if (!confirmed) return;
    try {
      const result = await carWashApi.deleteJobs(selectedIds);
      await load();
      const skipped = result?.skipped?.length || 0;
      if (skipped) toast.warn(`${result?.deletedCount || 0} jobs deleted. ${skipped} locked jobs were skipped.`);
      else toast.success(`${result?.deletedCount || selectedIds.length} jobs deleted`);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to delete selected jobs");
    }
  };

  const buildJobTemplates = (job) => {
    const name = job.customerName || "Customer";
    const num  = job.jobNumber || "";
    const type = job.jobType === "carpet" ? "item" : "car";
    return [
      { label: "Job Created",   color: "blue",   body: `Hi ${name}, your ${type} wash job ${num} has been received. We'll notify you when it's ready. Thank you!` },
      { label: "Job Ready",     color: "green",  body: `Hi ${name}, your ${type} wash (${num}) is done and ready for collection. Please come pick it up. Thank you!` },
      { label: "Status Update", color: "slate",  body: `Hi ${name}, your car wash job ${num} is currently ${statusLabels[job.status] || job.status}. Thank you for your patience!` },
      { label: "Pay Reminder",  color: "amber",  body: `Hi ${name}, kindly note that car wash job ${num} (KES ${formatMoney(job.price)}) is still unpaid. Please visit us to complete payment. Thank you!` },
    ];
  };

  const openSmsModal = useCallback((job, type) => {
    setSmsTarget(job);
    const name = job.customerName || "Customer";
    const num  = job.jobNumber || "";
    const itemType = job.jobType === "carpet" ? "item" : "car";
    if (type === "ready") {
      setSmsBody(`Hi ${name}, your ${itemType} wash (${num}) is done and ready for collection. Please come pick it up. Thank you!`);
    } else {
      setSmsBody(`Hi ${name}, your car wash job ${num} is ${statusLabels[job.status] || job.status}. Thank you!`);
    }
  }, []);

  const printJobReceipt = useCallback((job) => {
    const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const fmtDate = (d) => d ? new Date(d).toLocaleString("en-KE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
    const fmtAmt = (n) => Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const co = currentCompany?.name || "";
    const branch = settingsAndBranch?.branch?.name || "";
    const isCarpet = job.jobType === "carpet";
    const price = Number(job.price || 0);
    const discount = Number(job.discountAmount || 0);
    const total = Math.max(0, price - discount);
    const taxAmt = Number(job.taxAmount || 0);
    const staff = Array.isArray(job.assignedStaff) && job.assignedStaff.length
      ? job.assignedStaff.map((s) => s?.name || s).join(", ")
      : "—";

    const serviceRows = Array.isArray(job.serviceLines) && job.serviceLines.length > 1
      ? job.serviceLines.map((l) => `<tr><td>${esc(l.serviceName || "—")}</td><td class="amt">${fmtAmt(l.price)}</td></tr>`).join("")
      : `<tr><td>${esc(Array.isArray(job.serviceLines) && job.serviceLines.length === 1 ? job.serviceLines[0].serviceName : (job.serviceName || "—"))}</td><td class="amt">${fmtAmt(price)}</td></tr>`;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Receipt ${esc(job.jobNumber)}</title>
<style>
@page{size:A5;margin:12mm}
*{box-sizing:border-box}
body{font-family:Arial,sans-serif;font-size:12px;color:#111;margin:0;padding:0;print-color-adjust:exact;-webkit-print-color-adjust:exact}
.c{text-align:center}.h1{font-size:18px;font-weight:bold;margin:0 0 2px}.sub{font-size:11px;color:#555;margin:0}
hr{border:none;margin:8px 0}.s{border-top:1px solid #ccc}.d{border-top:1px dashed #ccc}
.title{font-size:13px;font-weight:bold;text-align:center;text-transform:uppercase;letter-spacing:1px;margin:6px 0}
.row{display:flex;justify-content:space-between;margin:4px 0}.lbl{font-weight:bold;color:#555}
table{width:100%;border-collapse:collapse;margin:4px 0}
th{text-align:left;font-size:11px;color:#555;border-bottom:1px solid #ccc;padding:3px 4px}
td{padding:3px 4px}.amt{text-align:right}
.tot td{font-weight:bold;border-top:2px solid #111;padding-top:5px}
.dis td{color:#b45309}.vat td{color:#1d4ed8;font-size:11px}
.badge{display:inline-block;padding:2px 8px;font-size:11px;font-weight:bold;border-radius:2px}
.paid{background:#d1fae5;color:#065f46}.unpaid{background:#fee2e2;color:#991b1b}
.ft{text-align:center;font-size:10px;color:#888;margin-top:12px}
</style></head><body>
<div class="c"><div class="h1">${esc(co)}</div>${branch ? `<div class="sub">${esc(branch)}</div>` : ""}</div>
<hr class="s"/><div class="title">Car Wash Receipt</div><hr class="s"/>
<div class="row"><span class="lbl">Job No.:</span><span><strong>${esc(job.jobNumber)}</strong></span></div>
<div class="row"><span class="lbl">Date:</span><span>${fmtDate(job.createdAt)}</span></div>
<div class="row"><span class="lbl">${isCarpet ? "Item:" : "Plate No.:"}</span><span>${esc(isCarpet ? (job.itemDescription || "—") : (job.plateNumber || "—"))}</span></div>
${job.customerName ? `<div class="row"><span class="lbl">Customer:</span><span>${esc(job.customerName)}</span></div>` : ""}
${job.phone ? `<div class="row"><span class="lbl">Phone:</span><span>${esc(job.phone)}</span></div>` : ""}
<hr class="d"/>
<table><thead><tr><th>Service</th><th class="amt">KES</th></tr></thead><tbody>
${serviceRows}
${discount > 0 ? `<tr class="dis"><td>Discount</td><td class="amt">- ${fmtAmt(discount)}</td></tr>` : ""}
${taxAmt > 0 ? `<tr class="vat"><td>VAT (incl.)</td><td class="amt">${fmtAmt(taxAmt)}</td></tr>` : ""}
<tr class="tot"><td>TOTAL</td><td class="amt">${fmtAmt(total)}</td></tr>
</tbody></table>
<hr class="s"/>
<div class="row"><span class="lbl">Staff:</span><span>${esc(staff)}</span></div>
<div class="row"><span class="lbl">Payment:</span><span><span class="badge ${job.paymentStatus === "paid" ? "paid" : "unpaid"}">${(job.paymentStatus || "unpaid").toUpperCase()}</span></span></div>
<hr class="s"/><div class="ft">Thank you for visiting us!</div>
</body></html>`;

    const w = window.open("", "_blank", "width=600,height=800");
    if (!w) return;
    w.onload = () => { w.focus(); w.print(); };
    w.document.write(html);
    w.document.close();
  }, [currentCompany, settingsAndBranch]);

  const downloadJobPdf = useCallback(async (job) => {
    try {
      const response = await carWashApi.downloadJobPdf(job._id);
      const url = window.URL.createObjectURL(new Blob([response], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `receipt-${job.plateNumber || job.jobNumber || job._id}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error("Failed to download PDF receipt");
    }
  }, []);

  const onSetPhotos = useCallback((jobId, photos) => {
    setJobPhotos((prev) => ({ ...prev, [jobId]: photos }));
  }, []);

  const handleNavigateEdit = useCallback((id) => navigate(`/carwash/jobs/${id}/edit`), [navigate]);

  const sendSms = async (phone, body) => {
    if (!smsTarget) return;
    setSmsSending(true);
    try {
      // phone is null in masked-MSISDN mode — backend falls back to job.maskedMsisdn
      await carWashApi.sendJobSms(smsTarget._id, { ...(phone ? { phone } : {}), body });
      toast.success("SMS sent successfully");
      setSmsTarget(null);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to send SMS");
    } finally {
      setSmsSending(false);
    }
  };

  const applyFilters = (event) => {
    event.preventDefault();
    setPage(1);
    setAppliedFilters({ ...filters });
  };

  const resetFilters = () => {
    setFilters(defaultFilters);
    setPage(1);
    setAppliedFilters(defaultFilters);
  };

  const setFilterValue = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <CarWashShell
      title="Jobs Register"
      action={
        <>
          <button
            type="button"
            onClick={load}
            className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
          >
            <FaRedoAlt className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
          {canRecordPayment && (
            <button
              type="button"
              onClick={() => openPaymentModal()}
              className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-3 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
            >
              <FaMoneyBillWave />
              Record Payment
            </button>
          )}
          {canUpdateJob && (
            <button
              type="button"
              onClick={deleteSelectedJobs}
              disabled={!selectedIds.length}
              className="inline-flex h-8 items-center gap-1.5 border border-red-200 bg-white px-3 text-xs font-bold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-45"
              title="Deletes unpaid jobs only. Paid or payment-linked jobs are locked."
            >
              <FaTrashAlt />
              Delete Selected
            </button>
          )}
          {canCreateJob && (
            <button
              type="button"
              onClick={() => navigate("/carwash/jobs/new")}
              className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-3 text-xs font-bold text-white shadow-sm hover:bg-[#0A3127]"
            >
              <FaPlus />
              New Job
            </button>
          )}
        </>
      }
    >
      <form onSubmit={applyFilters} className="mb-1 flex-shrink-0 flex flex-wrap items-center gap-1 border border-slate-200 bg-white px-2 py-1 shadow-sm">
        {/* Text search */}
        <input
          className="h-7 w-[120px] grow border border-slate-300 px-2 text-xs text-slate-700 placeholder:text-slate-400 focus:border-[#0B3B2E] focus:outline-none"
          placeholder="Job # / plate"
          value={filters.search}
          onChange={(e) => setFilterValue("search", e.target.value)}
        />
        <input
          className="h-7 w-[130px] grow border border-slate-300 px-2 text-xs text-slate-700 placeholder:text-slate-400 focus:border-[#0B3B2E] focus:outline-none"
          placeholder="Customer / phone"
          value={filters.customer}
          onChange={(e) => setFilterValue("customer", e.target.value)}
        />
        {/* Category dropdowns */}
        <select className="h-7 w-[110px] grow border border-[#B7C9C0] bg-[#F1F6F3] px-1.5 text-xs font-semibold text-[#0B3B2E] focus:border-[#0B3B2E] focus:outline-none"
          value={filters.service} onChange={(e) => setFilterValue("service", e.target.value)}>
          <option value="">All Services</option>
          {services.map((s) => <option key={s._id} value={s._id}>{s.category ? `${s.category} — ${s.name}` : s.name}</option>)}
        </select>
        <select className="h-7 w-[100px] grow border border-[#B7C9C0] bg-[#F1F6F3] px-1.5 text-xs font-semibold text-[#0B3B2E] focus:border-[#0B3B2E] focus:outline-none"
          value={filters.staff} onChange={(e) => setFilterValue("staff", e.target.value)}>
          <option value="">All Staff</option>
          {staff.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
        </select>
        <select className="h-7 w-[100px] grow border border-slate-300 bg-white px-1.5 text-xs text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          value={filters.status} onChange={(e) => setFilterValue("status", e.target.value)}>
          <option value="">All Statuses</option>
          {statuses.map((s) => <option key={s} value={s}>{getJobStatusLabel(s, filters.jobType)}</option>)}
        </select>
        <select className="h-7 w-[100px] grow border border-slate-300 bg-white px-1.5 text-xs text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          value={filters.paymentStatus} onChange={(e) => setFilterValue("paymentStatus", e.target.value)}>
          <option value="">All Payments</option>
          <option value="unpaid">Unpaid</option>
          <option value="partial">Partial</option>
          <option value="paid">Paid</option>
        </select>
        <select className="h-7 w-[88px] grow border border-slate-300 bg-white px-1.5 text-xs text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          value={filters.jobType} onChange={(e) => setFilterValue("jobType", e.target.value)}>
          <option value="">All Types</option>
          <option value="vehicle">Vehicle</option>
          <option value="carpet">Carpet</option>
        </select>
        {/* Date preset */}
        <select value={quickPickActive}
          onChange={(e) => {
            const v = e.target.value;
            const { today, week, lweek, month } = dateBounds;
            if (v === "today")    setFilters((p) => ({ ...p, dateFrom: today,      dateTo: today     }));
            if (v === "thisWeek") setFilters((p) => ({ ...p, dateFrom: week.from,  dateTo: week.to   }));
            if (v === "lastWeek") setFilters((p) => ({ ...p, dateFrom: lweek.from, dateTo: lweek.to  }));
            if (v === "month")    setFilters((p) => ({ ...p, dateFrom: month.from, dateTo: month.to  }));
          }}
          className="h-7 w-[100px] shrink-0 border border-slate-200 bg-white px-1.5 text-xs text-slate-700 focus:border-[#0B3B2E] focus:outline-none">
          <option value="">Quick pick…</option>
          <option value="today">Today</option>
          <option value="thisWeek">This Week</option>
          <option value="lastWeek">Last Week</option>
          <option value="month">This Month</option>
        </select>
        {/* Date range */}
        <input type="date" title="From"
          className="h-7 w-[120px] shrink-0 border border-slate-300 px-1 text-xs text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          value={filters.dateFrom} onChange={(e) => setFilterValue("dateFrom", e.target.value)} />
        <span className="shrink-0 text-[10px] text-slate-400">—</span>
        <input type="date" title="To"
          className="h-7 w-[120px] shrink-0 border border-slate-300 px-1 text-xs text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          value={filters.dateTo} onChange={(e) => setFilterValue("dateTo", e.target.value)} />
        {/* Actions */}
        <button type="submit" className="inline-flex h-7 shrink-0 items-center gap-1 bg-[#FF8C00] px-3 text-xs font-bold text-white hover:bg-[#E67E00]">
          <FaSearch size={9} /> Search
        </button>
        <button type="button" onClick={resetFilters} className="inline-flex h-7 shrink-0 items-center gap-1 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#0A3127]">
          <FaRedoAlt size={9} /> Reset
        </button>
      </form>

      <div className="flex flex-col flex-1 min-h-0 border border-slate-200 bg-white shadow-sm">
        <div className="flex-shrink-0 flex flex-wrap items-center gap-x-4 gap-y-0.5 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
          <span>Showing <strong className="text-[#0B3B2E]">{jobs.length}</strong>/{pagination.total}</span>
          <span>Page <strong className="text-[#0B3B2E]">{pagination.page}</strong>/{pagination.pages}</span>
          <span>Unpaid <strong className="text-[#FF8C00]">{jobStats.unpaid}</strong></span>
          <span>Washing <strong className="text-slate-700">{jobStats.washing}</strong></span>
          <span>Done <strong className="text-slate-700">{jobStats.done}</strong></span>
          {selectedIds.length > 0 && <span>Selected <strong className="text-[#0B3B2E]">{selectedIds.length}</strong></span>}
        </div>

        {/* ── Mobile card list ─────────────────────────────────────────── */}
        <div className="sm:hidden flex-1 min-h-0 overflow-y-auto divide-y divide-slate-200">
          {jobs.length ? jobs.map((job) => (
            <MobileJobCard
              key={job._id}
              job={job}
              expanded={expandedIds.includes(job._id)}
              selected={selectedIds.includes(job._id)}
              jobPaymentsEntry={jobPayments[job._id]}
              canUpdateJob={canUpdateJob}
              canRecordPayment={canRecordPayment}
              onToggleExpand={toggleExpanded}
              onToggleSelect={toggleSelected}
              onUpdateStatus={updateStatus}
              onOpenPayment={openPaymentModal}
              onOpenSms={openSmsModal}
              onReversePayment={reversePayment}
              onNavigateEdit={handleNavigateEdit}
              onPrint={printJobReceipt}
              onDownloadPdf={downloadJobPdf}
            />
          )) : (
            <div className="py-10 text-center text-xs font-semibold text-slate-500">No Car Wash jobs recorded for this date.</div>
          )}
        </div>

        {/* ── Desktop table ─────────────────────────────────────────────── */}
        <div className="hidden sm:flex sm:flex-col sm:flex-1 sm:min-h-0 sm:overflow-hidden">
        <div className="flex-1 overflow-y-auto overflow-x-auto">
        <table className="w-full min-w-[1120px] text-xs">
          <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
            <tr>
              <th className="w-8 px-2 py-1.5 text-left">
                <input
                  type="checkbox"
                  checked={safeVisibleJobIds.length > 0 && safeVisibleJobIds.every((id) => selectedIds.includes(id))}
                  onChange={toggleSelectAllVisible}
                  disabled={!safeVisibleJobIds.length}
                  title="Select visible unpaid jobs"
                />
              </th>
              <th className="w-8 px-2 py-1.5 text-left" />
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Job</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Plate / Item</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Customer</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Service</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Staff</th>
              {isConsolidated && <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Branch</th>}
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Status</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Payment</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Price</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Action</th>
            </tr>
          </thead>
          <tbody>
            {jobs.length ? (
              jobs.map((job) => (
                <DesktopJobRow
                  key={job._id}
                  job={job}
                  expanded={expandedIds.includes(job._id)}
                  selected={selectedIds.includes(job._id)}
                  jobPaymentsEntry={jobPayments[job._id]}
                  jobPhotosList={jobPhotos[job._id]}
                  isCameraOpen={cameraJobId === job._id}
                  isConsolidated={isConsolidated}
                  canUpdateJob={canUpdateJob}
                  canRecordPayment={canRecordPayment}
                  onToggleExpand={toggleExpanded}
                  onToggleSelect={toggleSelected}
                  onUpdateStatus={updateStatus}
                  onOpenPayment={openPaymentModal}
                  onOpenSms={openSmsModal}
                  onReversePayment={reversePayment}
                  onNavigateEdit={handleNavigateEdit}
                  onSetPhotos={onSetPhotos}
                  onSetCameraJobId={setCameraJobId}
                  onSetLightboxSrc={setLightboxSrc}
                  onPrint={printJobReceipt}
                  onDownloadPdf={downloadJobPdf}
                />
              ))
            ) : (
              <EmptyRow colSpan={isConsolidated ? 12 : 11} text="No Car Wash jobs recorded for this date." />
            )}
          </tbody>
        </table>
        </div>{/* end scroll */}
        </div>{/* end desktop table wrapper */}
        <PaginationBar
          page={pagination.page}
          pages={pagination.pages}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          loading={loading}
        />
      </div>

      {showPaymentModal && (
        <Modal
          title="Record Car Wash Payment"
          subtitle="Record payment for an open Car Wash job."
          onClose={closePaymentModal}
          footer={
            <>
              <button type="button" onClick={closePaymentModal} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">
                Cancel
              </button>
              {canRecordPayment && (
                <button type="submit" form="carwash-payment-form" disabled={submittingPayment} className="bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60">
                  {submittingPayment ? "Saving…" : "Record Payment"}
                </button>
              )}
            </>
          }
        >
          {/* Balance strip */}
          {selectedPaymentJob && (
            <div className="mb-3 grid grid-cols-3 divide-x divide-slate-200 rounded border border-slate-200 bg-slate-50 text-center text-[11px]">
              <div className="px-3 py-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Job Total</p>
                {Number(selectedPaymentJob.discountAmount) > 0 ? (
                  <p className="mt-0.5 tabular-nums">
                    <span className="text-[9px] text-slate-400 line-through block">{formatMoney(selectedPaymentJob.price)}</span>
                    <span className="font-black text-slate-700">{formatMoney(Math.max(0, selectedPaymentJob.price - selectedPaymentJob.discountAmount))}</span>
                  </p>
                ) : (
                  <p className="mt-0.5 font-black text-slate-700 tabular-nums">{formatMoney(selectedPaymentJob.price)}</p>
                )}
              </div>
              <div className="px-3 py-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Already Paid</p>
                <p className="mt-0.5 font-black text-emerald-700 tabular-nums">{formatMoney(paymentJobPaidSoFar)}</p>
              </div>
              <div className="px-3 py-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Outstanding</p>
                <p className={`mt-0.5 font-black tabular-nums ${outstandingForModal > 0 ? "text-red-600" : "text-emerald-600"}`}>
                  {formatMoney(outstandingForModal)}
                </p>
              </div>
            </div>
          )}

          {/* Customer credit notice — only shown when the plate has an active credit */}
          {plateCredit && plateCredit.creditBalance > 0.01 && (
            <div className="mb-3 rounded border border-emerald-300 bg-emerald-50 px-3 py-2.5 flex items-start gap-2.5 text-xs">
              <span className="text-emerald-600 mt-0.5 flex-shrink-0">💰</span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-emerald-800">
                  {plateCredit.customer?.name || "This customer"} has a credit of {formatMoney(plateCredit.creditBalance)}
                </p>
                <p className="text-[10px] text-emerald-700 mt-0.5">
                  Only apply if the customer asks. The credit will reduce what they owe today.
                </p>
              </div>
              <label className="flex items-center gap-1.5 flex-shrink-0 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={applyCredit}
                  onChange={(e) => setApplyCredit(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-emerald-400 text-emerald-600 focus:ring-emerald-500"
                />
                <span className="text-[11px] font-semibold text-emerald-700">Apply credit</span>
              </label>
            </div>
          )}
          <form id="carwash-payment-form" onSubmit={recordPayment} className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className={labelClass}>Job *</label>
              <select
                className={inputClass}
                value={paymentForm.job}
                onChange={async (event) => {
                  const jobId = event.target.value;
                  setPaymentForm((prev) => ({ ...prev, job: jobId, amount: "" }));
                  setPaymentJobPaidSoFar(0);
                  if (!jobId) return;
                  const cached = jobPayments[jobId]?.list;
                  if (cached) {
                    setPaymentJobPaidSoFar(cached.reduce((s, p) => s + Number(p.amount || 0) + Number(p.discountAmount || 0), 0));
                  } else {
                    try {
                      const pl = await carWashApi.listPayments({ job: jobId, limit: 20 });
                      const paid = normalizeListPayload(pl, "payments").reduce((s, p) => s + Number(p.amount || 0) + Number(p.discountAmount || 0), 0);
                      setPaymentJobPaidSoFar(paid);
                    } catch { /* keep 0 */ }
                  }
                }}
                required
              >
                <option value="">Select job</option>
                {allPaymentJobs.filter((j) => j.paymentStatus !== "paid").map((job) => (
                  <option key={job._id} value={job._id}>
                    {job.jobNumber} - {job.jobType === "carpet" ? job.itemDescription : job.plateNumber} - {formatMoney(job.price)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className={labelClass} style={{ marginBottom: 0 }}>Amount Received *</label>
                {outstandingForModal > 0 && (() => {
                  const netDue = Math.max(0, outstandingForModal - Number(paymentForm.discountAmount || 0));
                  return (
                    <button
                      type="button"
                      onClick={() => setPaymentForm((prev) => ({ ...prev, amount: String(netDue) }))}
                      className="text-[9px] font-black uppercase tracking-wide text-[#0B3B2E] underline hover:text-[#FF8C00]"
                    >
                      Pay in Full ({formatMoney(netDue)})
                    </button>
                  );
                })()}
              </div>
              <input
                className={inputClass}
                type="number"
                min="1"
                max={Math.max(0, outstandingForModal - Number(paymentForm.discountAmount || 0)) || undefined}
                step="1"
                value={paymentForm.amount}
                onChange={(event) => setPaymentForm((prev) => ({ ...prev, amount: event.target.value }))}
                required
              />
              {/* Live remaining preview */}
              {selectedPaymentJob && Number(paymentForm.amount) > 0 && (() => {
                const netDue    = Math.max(0, outstandingForModal - Number(paymentForm.discountAmount || 0));
                const paying    = Number(paymentForm.amount || 0);
                const remaining = Math.max(0, netDue - paying);
                const overPay   = paying > netDue + 0.01;
                if (overPay) return <p className="mt-0.5 text-[10px] font-bold text-red-600">Exceeds outstanding balance by {formatMoney(paying - netDue)}</p>;
                if (remaining === 0) return <p className="mt-0.5 text-[10px] font-bold text-emerald-700">Job will be fully paid ✓</p>;
                return <p className="mt-0.5 text-[10px] text-slate-500">Remaining after payment: <strong>{formatMoney(remaining)}</strong></p>;
              })()}
            </div>
            <div>
              <label className={labelClass}>
                Discount
                {writeOffHeadroom !== null ? (
                  writeOffHeadroom === 0
                    ? <span className="ml-1 font-normal normal-case text-rose-400">(no headroom — job discount at cap)</span>
                    : <span className="ml-1 font-normal normal-case text-slate-400">(write-off, max KES {writeOffHeadroom})</span>
                ) : (
                  <span className="ml-1 font-normal normal-case text-slate-400">(write-off, optional)</span>
                )}
              </label>
              <input
                className={inputClass}
                type="number"
                min="0"
                max={writeOffHeadroom !== null ? writeOffHeadroom : undefined}
                disabled={writeOffHeadroom === 0}
                value={paymentForm.discountAmount}
                onChange={(event) => {
                  const raw  = Number(event.target.value || 0);
                  const disc = writeOffHeadroom !== null ? String(Math.min(raw, writeOffHeadroom)) : event.target.value;
                  setPaymentForm((prev) => {
                    const netDue = Math.max(0, outstandingForModal - Number(disc || 0));
                    return { ...prev, discountAmount: disc, amount: String(netDue) };
                  });
                }}
                placeholder="0"
              />
            </div>
            <div>
              <label className={labelClass}>Method</label>
              <select className={inputClass} value={paymentForm.method} onChange={(event) => setPaymentForm((prev) => ({ ...prev, method: event.target.value, cashbookAccount: preferredCashbookForMethod(cashbooks, event.target.value, cashbookDefaults) }))}>
                {paymentMethods.map((method) => (
                  <option key={method} value={method}>
                    {method.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Payment Date *</label>
              <input className={inputClass} type="date" value={paymentForm.paymentDate} onChange={(event) => setPaymentForm((prev) => ({ ...prev, paymentDate: event.target.value }))} required />
            </div>
            <div>
              <label className={labelClass}>Cashbook *</label>
              <select className={inputClass} value={paymentForm.cashbookAccount} onChange={(event) => setPaymentForm((prev) => ({ ...prev, cashbookAccount: event.target.value }))} required>
                <option value="">Select cashbook</option>
                {cashbooks.map((account) => (
                  <option key={account._id} value={account._id}>
                    {account.code} - {account.name}
                  </option>
                ))}
              </select>
            </div>
            <div className={paymentForm.method === "mpesa" ? "" : "md:col-span-2"}>
              <label className={labelClass}>
                {paymentForm.method === "mpesa" ? "M-Pesa Transaction Code" : "Reference"}
                {paymentForm.method === "mpesa" && <span className="ml-1 font-bold text-red-500">*</span>}
              </label>
              <input
                className={`${inputClass} ${paymentForm.method === "mpesa" && !paymentForm.reference?.trim() ? "border-red-300 focus:border-red-500" : ""}`}
                value={paymentForm.reference}
                onChange={(event) => setPaymentForm((prev) => ({ ...prev, reference: event.target.value }))}
                placeholder={paymentForm.method === "mpesa" ? "e.g. QJK1234ABC" : paymentForm.method === "cash" ? "Optional cash receipt note" : "Bank ref, card ref..."}
                required={paymentForm.method === "mpesa"}
              />
              {paymentForm.method === "mpesa" && !paymentForm.reference?.trim() && (
                <p className="mt-0.5 text-[10px] font-bold text-red-500">Required for M-Pesa payments</p>
              )}
            </div>
            {paymentForm.method === "mpesa" && (
              <div className="md:col-span-2">
                <div className="mb-1 flex items-center justify-between">
                  <label className={labelClass}>
                    Customer Phone
                    <span className="ml-1 font-normal normal-case text-emerald-700">(for STK push &amp; SMS)</span>
                  </label>
                  {(() => {
                    const jobPhone  = String(selectedPaymentJob?.phone || "").trim();
                    const formPhone = String(paymentForm.receivedFromPhone || "").trim();
                    if (jobPhone && formPhone === jobPhone)  return <span className="text-[9px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">From job record</span>;
                    if (formPhone && formPhone !== jobPhone) return <span className="text-[9px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">Edited</span>;
                    return null;
                  })()}
                </div>
                <div className="flex gap-2">
                  <input
                    className={`${inputClass} flex-1`}
                    type="tel"
                    value={paymentForm.receivedFromPhone}
                    onChange={(event) => setPaymentForm((prev) => ({ ...prev, receivedFromPhone: event.target.value }))}
                    placeholder="e.g. 0712345678"
                  />
                  <button
                    type="button"
                    onClick={sendStkPush}
                    disabled={stkPushing || !paymentForm.receivedFromPhone?.trim() || !Number(paymentForm.amount)}
                    className="inline-flex shrink-0 items-center gap-1.5 border border-emerald-300 bg-emerald-50 px-3 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Send M-Pesa payment prompt to customer's phone"
                  >
                    <FaMobileAlt />
                    {stkPushing ? "Sending…" : "Push"}
                  </button>
                </div>
                <p className="mt-0.5 text-[10px] text-slate-400">
                  {paymentForm.receivedFromPhone?.trim()
                    ? `Push sends M-Pesa prompt to ${paymentForm.receivedFromPhone.trim()} — customer pays KES ${Number(paymentForm.amount || 0).toLocaleString()} on their phone.`
                    : "Enter phone number to enable STK push. Saved to job and customer record."}
                </p>
              </div>
            )}
            <div className="md:col-span-2 border border-[#B7C9C0] bg-[#EDF5F1] px-3 py-2 text-xs font-bold text-[#0B3B2E]">
              Cashbook: {selectedCashbook ? `${selectedCashbook.code} - ${selectedCashbook.name}` : "Select where this payment was received"}
            </div>
          </form>
        </Modal>
      )}

      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}

      {smsTarget && (
        <CwSmsModal
          target={{ _id: smsTarget._id, name: smsTarget.customerName, phone: smsTarget.phone, maskedMsisdn: smsTarget.maskedMsisdn }}
          defaultBody={smsBody}
          templates={buildJobTemplates(smsTarget)}
          context={smsTarget.jobNumber}
          onSend={sendSms}
          onClose={() => setSmsTarget(null)}
          sending={smsSending}
        />
      )}
    </CarWashShell>
  );
};

export default CarWashJobs;
