import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { selectCurrentCompany } from "../../redux/selectors";
import useCarWashPermission from "../../hooks/useCarWashPermission";
import { FaCamera, FaChevronDown, FaChevronRight, FaEdit, FaExpand, FaMobileAlt, FaMoneyBillWave, FaPlus, FaRedoAlt, FaSearch, FaSms, FaTimes, FaTimesCircle, FaTrashAlt, FaUndoAlt } from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, getActiveBranchId, normalizeListPayload, photoUrl, todayISO } from "../../services/carWashApi";
import CarpetCameraModal from "../../components/common/CarpetCameraModal";
import CarWashShell from "./CarWashShell";
import { useConfirm } from "../../context/ConfirmContext";
import CwSmsModal from "./CwSmsModal";
import { clearDraft, readDraft, writeDraft } from "../../hooks/useFormDraft";

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

const statuses = ["waiting", "washing", "done", "paid", "cancelled"];
const paymentMethods = ["cash", "mpesa", "bank", "card", "other"];
const DEFAULT_PAGE_SIZE = 25;

const statusLabels = {
  waiting: "Waiting",
  washing: "Washing",
  done: "Done",
  paid: "Paid",
  cancelled: "Cancelled",
};

const getJobStatusLabel = (status, jobType) => {
  if (jobType === "carpet") {
    if (status === "washing") return "Processing";
    if (status === "done") return "Ready";
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
  <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
    <div className="w-full max-w-3xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
        <div>
          <h2 className="text-sm font-extrabold uppercase tracking-wide">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs font-semibold text-emerald-50">{subtitle}</p>}
        </div>
        <button type="button" onClick={onClose} className="p-1 text-white/80 hover:bg-white/10 hover:text-white" title="Close">
          <FaTimes />
        </button>
      </div>
      <div className="p-4">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">{footer}</div>}
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

const CarWashJobs = () => {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const currentCompany = useSelector(selectCurrentCompany);
  const isConsolidated = !getActiveBranchId();
  const [jobs, setJobs] = useState([]);
  const [services, setServices] = useState([]);
  const [staff, setStaff] = useState([]);
  const [cashbooks, setCashbooks] = useState([]);
  const [cashbookDefaults, setCashbookDefaults] = useState({});
  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm);
  const [filters, setFilters] = useState(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState(defaultFilters);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentJobPaidSoFar, setPaymentJobPaidSoFar] = useState(0);
  const [selectedIds, setSelectedIds] = useState([]);
  const [expandedIds, setExpandedIds] = useState([]);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);
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
  // job-level payments: { [jobId]: { loading: bool, list: [] } }
  const [jobPayments, setJobPayments] = useState({});

  const canCreateJob     = useCarWashPermission("carwash-jobs", "create");
  const canUpdateJob     = useCarWashPermission("carwash-jobs", "update");
  const canRecordPayment = useCarWashPermission("carwash-payments", "record");

  const unpaidJobs = useMemo(() => jobs.filter((job) => job.paymentStatus !== "paid"), [jobs]);
  const jobStats = useMemo(() => {
    let unpaid = 0, washing = 0, done = 0;
    jobs.forEach((job) => {
      if (job.paymentStatus !== "paid") unpaid++;
      if (job.status === "washing") washing++;
      if (job.status === "done") done++;
    });
    return { unpaid, washing, done };
  }, [jobs]);
  const safeVisibleJobIds = useMemo(
    () => jobs.filter((job) => job.paymentStatus === "unpaid" && job.status !== "paid").map((job) => job._id),
    [jobs]
  );
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

  const loadReferenceData = async () => {
    try {
      const [servicePayload, staffPayload, cashbookPayload, settingsPayload, branchData] = await Promise.all([
        carWashApi.listServices({ active: true }),
        carWashApi.listStaff({ active: true }),
        currentCompany?._id
          ? carWashApi.listChartOfAccounts({ business: currentCompany._id, type: "asset", moduleScope: "carwash", search: "Cashbooks" })
          : Promise.resolve([]),
        carWashApi.getCarWashSettings().catch(() => null),
        carWashApi.getActiveBranch().catch(() => null),
      ]);
      setServices(normalizeListPayload(servicePayload, "services"));
      setStaff(normalizeListPayload(staffPayload, "staff"));
      setCashbooks(Array.isArray(cashbookPayload) ? cashbookPayload : []);
      // Branch cashbooks take priority over company-wide defaults
      const companyDefaults = settingsPayload?.defaultCashbooks || {};
      const branchDefaults  = branchData?.defaultCashbooks || {};
      const defs = {};
      ["cash","mpesa","bank","card","other"].forEach((m) => {
        const branch  = branchDefaults[m]?._id  || branchDefaults[m]  || "";
        const company = companyDefaults[m]?._id || companyDefaults[m] || "";
        defs[m] = branch || company;
      });
      setCashbookDefaults(defs);
    } catch {
      toast.error("Failed to load reference data");
    }
  };

  const loadJobs = async () => {
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
  };

  const load = async () => {
    await Promise.all([loadJobs(), loadReferenceData()]);
  };

  useEffect(() => { loadReferenceData(); }, []);
  useEffect(() => { loadJobs(); }, [appliedFilters, page, pageSize]);

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
  };

  // Auto-save payment form draft (non-computed fields only)
  useEffect(() => {
    if (!showPaymentModal) return;
    const { job, method, cashbookAccount, discountAmount, reference, receivedFromPhone, paymentDate } = paymentForm;
    const t = setTimeout(() => writeDraft("cw-payment-form", { job, method, cashbookAccount, discountAmount, reference, receivedFromPhone, paymentDate }), 400);
    return () => clearTimeout(t);
  }, [paymentForm.job, paymentForm.method, paymentForm.cashbookAccount, paymentForm.discountAmount, paymentForm.reference, paymentForm.receivedFromPhone, paymentForm.paymentDate, showPaymentModal]);

  const openPaymentModal = async (job = null) => {
    const draft = readDraft("cw-payment-form");
    const useDraft = draft?.job === job?._id;

    // Compute paid-so-far from cache if available, otherwise start at 0 and refine async
    const cachedList = job?._id ? jobPayments[job._id]?.list : null;
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
      cashbookAccount:   useDraft ? draft.cashbookAccount   : preferredCashbookForMethod(cashbooks, emptyPaymentForm.method, cashbookDefaults),
      discountAmount:    useDraft ? draft.discountAmount     : "",
      reference:         useDraft ? draft.reference          : "",
      receivedFromPhone: useDraft ? draft.receivedFromPhone  : String(job?.phone || "").trim(),
      paymentDate:       useDraft ? draft.paymentDate        : todayISO(),
    });
    setShowPaymentModal(true);

    try {
      // Fetch the full jobs list for the dropdown and (if needed) this job's payments
      const needsPayments = job?._id && !cachedList;
      const [jobsPayload, pmtsPayload] = await Promise.all([
        carWashApi.listJobs({ limit: 100 }),
        needsPayments ? carWashApi.listPayments({ job: job._id, limit: 20 }) : Promise.resolve(null),
      ]);
      setModalUnpaidJobs(normalizeListPayload(jobsPayload, "jobs").filter((j) => j.paymentStatus !== "paid"));

      if (pmtsPayload && job) {
        const list = normalizeListPayload(pmtsPayload, "payments");
        const paid = list.reduce((s, p) => s + Number(p.amount || 0) + Number(p.discountAmount || 0), 0);
        const precise = Math.max(0, Number(job.price || 0) - Number(job.discountAmount || 0) - paid);
        setPaymentJobPaidSoFar(paid);
        // Only update amount if user hasn't started typing yet
        setPaymentForm((prev) => prev.job === job._id ? { ...prev, amount: String(precise) } : prev);
      }
    } catch {
      setModalUnpaidJobs(jobs.filter((j) => j.paymentStatus !== "paid"));
    }
  };

  const recordPayment = async (event) => {
    event.preventDefault();
    try {
      await carWashApi.recordPayment({
        ...paymentForm,
        amount: Number(paymentForm.amount || 0),
        discountAmount: Number(paymentForm.discountAmount || 0),
      });
      closePaymentModal();
      await loadJobs();
      toast.success("Payment recorded");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to record payment");
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

  const updateStatus = async (job, status) => {
    const previous = job.status;
    setJobs((prev) => prev.map((j) => (j._id === job._id ? { ...j, status } : j)));
    try {
      await carWashApi.updateJobStatus(job._id, status);
    } catch (error) {
      setJobs((prev) => prev.map((j) => (j._id === job._id ? { ...j, status: previous } : j)));
      toast.error(error?.response?.data?.message || "Unable to update job status");
    }
  };

  const toggleSelected = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

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

  const toggleExpanded = (id) => {
    setExpandedIds((prev) => {
      const expanding = !prev.includes(id);
      if (expanding) loadJobPayments(id);
      return expanding ? [...prev, id] : prev.filter((item) => item !== id);
    });
  };

  const reversePayment = async (paymentId, jobId) => {
    const confirmed = await confirm({
      title: "Reverse Payment",
      message: "This deletes the payment record, reverts the job payment status, and cancels any unpaid commissions. This action cannot be undone.",
      confirmText: "Reverse",
      isDangerous: true,
    });
    if (!confirmed) return;
    try {
      await carWashApi.deletePayment(paymentId);
      await loadJobs();
      // Clear cached payments so the list reloads on next expand
      setJobPayments((prev) => { const next = { ...prev }; delete next[jobId]; return next; });
      toast.success("Payment reversed");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to reverse payment");
    }
  };

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

  const openSmsModal = (job, type) => {
    setSmsTarget(job);
    const name = job.customerName || "Customer";
    const num  = job.jobNumber || "";
    const itemType = job.jobType === "carpet" ? "item" : "car";
    if (type === "ready") {
      setSmsBody(`Hi ${name}, your ${itemType} wash (${num}) is done and ready for collection. Please come pick it up. Thank you!`);
    } else {
      setSmsBody(`Hi ${name}, your car wash job ${num} is ${statusLabels[job.status] || job.status}. Thank you!`);
    }
  };

  const sendSms = async (phone, body) => {
    if (!smsTarget) return;
    setSmsSending(true);
    try {
      await carWashApi.sendJobSms(smsTarget._id, { phone, body });
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
      <form onSubmit={applyFilters} className="mb-2 grid gap-2 border border-slate-200 bg-white p-2 shadow-sm grid-cols-1 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_0.9fr_0.9fr_0.8fr_0.8fr_0.65fr_0.85fr_auto_auto]">
        <input
          className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          placeholder="Job # / plate"
          value={filters.search}
          onChange={(event) => setFilterValue("search", event.target.value)}
        />
        <input
          className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          placeholder="Customer / phone"
          value={filters.customer}
          onChange={(event) => setFilterValue("customer", event.target.value)}
        />
        <select
          className="h-8 border border-[#B7C9C0] bg-[#F1F6F3] px-2 text-xs font-bold text-[#0B3B2E] focus:border-[#0B3B2E] focus:outline-none"
          value={filters.service}
          onChange={(event) => setFilterValue("service", event.target.value)}
        >
          <option value="">Service</option>
          {services.map((service) => (
            <option key={service._id} value={service._id}>
              {service.name}
            </option>
          ))}
        </select>
        <select
          className="h-8 border border-[#B7C9C0] bg-[#F1F6F3] px-2 text-xs font-bold text-[#0B3B2E] focus:border-[#0B3B2E] focus:outline-none"
          value={filters.staff}
          onChange={(event) => setFilterValue("staff", event.target.value)}
        >
          <option value="">Staff</option>
          {staff.map((item) => (
            <option key={item._id} value={item._id}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          value={filters.status}
          onChange={(event) => setFilterValue("status", event.target.value)}
        >
          <option value="">Status</option>
          {statuses.map((status) => (
            <option key={status} value={status}>
              {getJobStatusLabel(status, filters.jobType)}
            </option>
          ))}
        </select>
        <select
          className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          value={filters.paymentStatus}
          onChange={(event) => setFilterValue("paymentStatus", event.target.value)}
        >
          <option value="">Payment</option>
          <option value="unpaid">Unpaid</option>
          <option value="partial">Partial</option>
          <option value="paid">Paid</option>
        </select>
        <select
          className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          value={filters.jobType}
          onChange={(event) => setFilterValue("jobType", event.target.value)}
        >
          <option value="">All Types</option>
          <option value="vehicle">Vehicle</option>
          <option value="carpet">Carpet</option>
        </select>
        {/* Date presets */}
        {[
          { label: "Today",      action: () => { const d = todayISO(); setFilters((p) => ({ ...p, dateFrom: d, dateTo: d })); } },
          { label: "This Week",  action: () => { const { from, to } = getWeekBounds(0);  setFilters((p) => ({ ...p, dateFrom: from, dateTo: to })); } },
          { label: "Last Week",  action: () => { const { from, to } = getWeekBounds(-1); setFilters((p) => ({ ...p, dateFrom: from, dateTo: to })); } },
          { label: "This Month", action: () => { const { from, to } = getMonthBounds();  setFilters((p) => ({ ...p, dateFrom: from, dateTo: to })); } },
        ].map(({ label, action }) => (
          <button
            key={label}
            type="button"
            onClick={action}
            className="h-8 border border-slate-300 bg-white px-2.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50 whitespace-nowrap"
          >
            {label}
          </button>
        ))}
        <input
          type="date"
          title="From"
          className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          value={filters.dateFrom}
          onChange={(e) => setFilterValue("dateFrom", e.target.value)}
        />
        <span className="text-xs font-bold text-slate-400">→</span>
        <input
          type="date"
          title="To"
          className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          value={filters.dateTo}
          onChange={(e) => setFilterValue("dateTo", e.target.value)}
        />
        <button type="submit" className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#FF8C00] px-4 text-xs font-bold text-white hover:bg-[#E67E00]">
          <FaSearch />
          Search
        </button>
        <button type="button" onClick={resetFilters} className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-bold text-white hover:bg-[#0A3127]">
          <FaRedoAlt />
          Reset
        </button>
      </form>

      <div className="min-h-[calc(100vh-14rem)] overflow-x-auto border border-slate-200 bg-white shadow-sm">
        <div className="flex min-h-8 flex-wrap items-center gap-x-5 gap-y-1 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <span>Showing: <strong className="text-[#0B3B2E]">{jobs.length}</strong> / {pagination.total}</span>
          <span>Page: <strong className="text-[#0B3B2E]">{pagination.page}</strong> / {pagination.pages}</span>
          <span>Unpaid: <strong className="text-[#FF8C00]">{jobStats.unpaid}</strong></span>
          <span>Washing: <strong className="text-slate-900">{jobStats.washing}</strong></span>
          <span>Done: <strong className="text-slate-900">{jobStats.done}</strong></span>
          <span>Selected: <strong className="text-[#0B3B2E]">{selectedIds.length}</strong></span>
        </div>
        <table className="w-full min-w-[1120px] text-xs">
          <thead className="bg-[#0B3B2E] text-white">
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
              jobs.map((job) => {
                const canDelete = job.paymentStatus === "unpaid" && job.status !== "paid";
                const expanded = expandedIds.includes(job._id);
                return (
                  <React.Fragment key={job._id}>
                    <tr className="border-b border-slate-200 hover:bg-slate-50">
                      <td className="px-2 py-1">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(job._id)}
                          onChange={() => toggleSelected(job._id)}
                          disabled={!canDelete}
                          title={canDelete ? "Select job" : "Only unpaid jobs with no payments can be deleted"}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <button type="button" onClick={() => toggleExpanded(job._id)} className="text-[#0B3B2E] hover:text-[#FF8C00]" title={expanded ? "Hide details" : "Show details"}>
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
                        <select
                          className="h-6 border border-slate-300 bg-white px-2 text-[11px] font-bold text-slate-700"
                          value={job.status}
                          onChange={(event) => updateStatus(job, event.target.value)}
                        >
                          {statuses
                            .filter((status) => status !== "paid" || job.paymentStatus === "paid")
                            .map((status) => (
                              <option key={status} value={status}>
                                {getJobStatusLabel(status, job.jobType)}
                              </option>
                            ))}
                        </select>
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
                              onClick={() => navigate(`/carwash/jobs/${job._id}/edit`)}
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
                              onClick={() => openPaymentModal(job)}
                              disabled={job.paymentStatus === "paid"}
                              className="border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Pay
                            </button>
                          )}
                          {job.phone && job.status === "done" && job.paymentStatus !== "paid" && (
                            <button
                              type="button"
                              onClick={() => openSmsModal(job, "ready")}
                              className="inline-flex items-center gap-1 border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100"
                              title="Notify customer — job ready"
                            >
                              <FaSms /> Ready
                            </button>
                          )}
                          {job.phone && (
                            <button
                              type="button"
                              onClick={() => openSmsModal(job)}
                              className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
                              title={`Send SMS to ${job.phone}`}
                            >
                              <FaSms /> SMS
                            </button>
                          )}
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
                              {job.phone ? job.phone : <span className="text-slate-400 italic">via M-Pesa on payment</span>}
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

                            {/* Carpet photo gallery */}
                            {job.jobType === "carpet" && (() => {
                              const photos = jobPhotos[job._id] ?? (Array.isArray(job.photos) ? job.photos : []);
                              const handleCapture = async (file) => {
                                if (photos.length >= 5) { toast.error("Max 5 photos per job"); return; }
                                try {
                                  const result = await carWashApi.uploadJobPhotos(job._id, [file]);
                                  setJobPhotos((prev) => ({ ...prev, [job._id]: result?.photos || photos }));
                                  toast.success("Photo added");
                                } catch { toast.error("Upload failed"); }
                              };
                              const handleDelete = async (url) => {
                                try {
                                  const result = await carWashApi.deleteJobPhoto(job._id, url);
                                  setJobPhotos((prev) => ({ ...prev, [job._id]: result?.photos || photos.filter((p) => p !== url) }));
                                } catch { toast.error("Delete failed"); }
                              };
                              return (
                                <div className="md:col-span-5">
                                  <div className="mb-1.5 flex items-center gap-2">
                                    <span className="font-extrabold uppercase text-slate-500">Carpet Photos:</span>
                                    {photos.length < 5 && (
                                      <button type="button" onClick={() => setCameraJobId(job._id)} className="inline-flex items-center gap-1 rounded border border-[#B7C9C0] bg-white px-2 py-0.5 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                                        <FaCamera size={8} /> Take Photo
                                      </button>
                                    )}
                                    {cameraJobId === job._id && (
                                      <CarpetCameraModal
                                        onCapture={handleCapture}
                                        onClose={() => setCameraJobId(null)}
                                      />
                                    )}
                                  </div>
                                  {photos.length === 0 ? (
                                    <span className="italic text-slate-400">No photos — click "Take Photo" to add one</span>
                                  ) : (
                                    <div className="flex flex-wrap gap-2">
                                      {photos.map((url) => (
                                        <div key={url} className="group relative h-20 w-20 overflow-hidden rounded border border-slate-200 bg-slate-100">
                                          <img src={photoUrl(url)} alt="Carpet" className="h-full w-full cursor-pointer object-cover" onClick={() => setLightboxSrc(photoUrl(url))} />
                                          <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/0 opacity-0 transition-all group-hover:bg-black/30 group-hover:opacity-100">
                                            <button type="button" onClick={() => setLightboxSrc(photoUrl(url))} className="rounded-full bg-white/80 p-1 text-slate-700"><FaExpand size={9} /></button>
                                            <button type="button" onClick={() => handleDelete(url)} className="rounded-full bg-red-500/90 p-1 text-white"><FaTimesCircle size={9} /></button>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}

                            {/* Payments sub-section */}
                            <div className="md:col-span-5">
                              <span className="font-extrabold uppercase text-slate-500">Payments:</span>
                              {jobPayments[job._id]?.loading && (
                                <span className="ml-2 italic text-slate-400">Loading…</span>
                              )}
                              {!jobPayments[job._id]?.loading && jobPayments[job._id]?.list?.length === 0 && (
                                <span className="ml-2 italic text-slate-400">No payments recorded</span>
                              )}
                              {!jobPayments[job._id]?.loading && jobPayments[job._id]?.list?.length > 0 && (
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
                                      {jobPayments[job._id].list.map((pmt) => (
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
                                              onClick={() => reversePayment(pmt._id, job._id)}
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
              })
            ) : (
              <EmptyRow colSpan={isConsolidated ? 12 : 11} text="No Car Wash jobs recorded for this date." />
            )}
          </tbody>
        </table>
        <div className="flex min-h-9 items-center justify-between border-t border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-slate-500 normal-case">Per page:</span>
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="h-7 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-bold text-slate-700 focus:border-emerald-400 focus:outline-none transition normal-case"
            >
              {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
              disabled={page <= 1 || loading}
              className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:cursor-not-allowed disabled:opacity-45"
            >
              Previous
            </button>
            <span>Page {pagination.page} of {pagination.pages}</span>
            <button
              type="button"
              onClick={() => setPage((prev) => Math.min(prev + 1, pagination.pages))}
              disabled={page >= pagination.pages || loading}
              className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:cursor-not-allowed disabled:opacity-45"
            >
              Next
            </button>
          </div>
        </div>
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
                <button type="submit" form="carwash-payment-form" className="bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127]">
                  Record Payment
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
                {outstandingForModal > 0 && (
                  <button
                    type="button"
                    onClick={() => setPaymentForm((prev) => ({ ...prev, amount: String(outstandingForModal) }))}
                    className="text-[9px] font-black uppercase tracking-wide text-[#0B3B2E] underline hover:text-[#FF8C00]"
                  >
                    Pay in Full ({formatMoney(outstandingForModal)})
                  </button>
                )}
              </div>
              <input
                className={inputClass}
                type="number"
                min="1"
                max={outstandingForModal || undefined}
                step="1"
                value={paymentForm.amount}
                onChange={(event) => setPaymentForm((prev) => ({ ...prev, amount: event.target.value }))}
                required
              />
              {/* Live remaining preview */}
              {selectedPaymentJob && Number(paymentForm.amount) > 0 && (() => {
                const paying    = Number(paymentForm.amount || 0) + Number(paymentForm.discountAmount || 0);
                const remaining = Math.max(0, outstandingForModal - paying);
                const overPay   = paying > outstandingForModal + 0.01;
                if (overPay) return <p className="mt-0.5 text-[10px] font-bold text-red-600">Exceeds outstanding balance by {formatMoney(paying - outstandingForModal)}</p>;
                if (remaining === 0) return <p className="mt-0.5 text-[10px] font-bold text-emerald-700">Job will be fully paid ✓</p>;
                return <p className="mt-0.5 text-[10px] text-slate-500">Remaining after payment: <strong>{formatMoney(remaining)}</strong></p>;
              })()}
            </div>
            <div>
              <label className={labelClass}>
                Discount
                <span className="ml-1 font-normal normal-case text-slate-400">(write-off, optional)</span>
              </label>
              <input
                className={inputClass}
                type="number"
                min="0"
                value={paymentForm.discountAmount}
                onChange={(event) => setPaymentForm((prev) => ({ ...prev, discountAmount: event.target.value }))}
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
              <label className={labelClass}>{paymentForm.method === "mpesa" ? "M-Pesa Transaction Code" : "Reference"}</label>
              <input className={inputClass} value={paymentForm.reference} onChange={(event) => setPaymentForm((prev) => ({ ...prev, reference: event.target.value }))} placeholder={paymentForm.method === "mpesa" ? "e.g. QJK1234ABC" : paymentForm.method === "cash" ? "Optional cash receipt note" : "Bank ref, card ref..."} />
            </div>
            {paymentForm.method === "mpesa" && (
              <div className="md:col-span-2">
                <div className="mb-1 flex items-center justify-between">
                  <label className={labelClass}>
                    Customer Phone
                    <span className="ml-1 font-normal normal-case text-emerald-700">(for STK push &amp; SMS)</span>
                  </label>
                  {(() => {
                    const jobPhone = String(allPaymentJobs.find((j) => j._id === paymentForm.job)?.phone || "").trim();
                    const formPhone = String(paymentForm.receivedFromPhone || "").trim();
                    if (jobPhone && formPhone === jobPhone) {
                      return <span className="text-[9px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">From job record</span>;
                    }
                    if (formPhone && formPhone !== jobPhone) {
                      return <span className="text-[9px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">Edited</span>;
                    }
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
          target={{ _id: smsTarget._id, name: smsTarget.customerName, phone: smsTarget.phone }}
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
