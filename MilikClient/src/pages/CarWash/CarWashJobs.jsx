import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { FaChevronDown, FaChevronRight, FaMoneyBillWave, FaPlus, FaRedoAlt, FaSearch, FaTimes, FaTrashAlt } from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, normalizeListPayload, todayISO } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";
import { useConfirm } from "../../context/ConfirmContext";

const emptyJobForm = {
  customerName: "",
  phone: "",
  plateNumber: "",
  service: "",
  serviceName: "",
  vehicleType: "",
  price: "",
  assignedStaff: "",
  notes: "",
};

const emptyPaymentForm = {
  job: "",
  amount: "",
  method: "cash",
  cashbookAccount: "",
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
  date: todayISO(),
};

const statuses = ["waiting", "washing", "done", "paid", "cancelled"];
const paymentMethods = ["cash", "mpesa", "bank", "card", "other"];
const PAGE_SIZE = 30;

const statusLabels = {
  waiting: "Waiting",
  washing: "Washing",
  done: "Done",
  paid: "Paid",
  cancelled: "Cancelled",
};

const paymentBadgeClass = {
  paid: "border-emerald-200 bg-emerald-50 text-emerald-700",
  partial: "border-orange-200 bg-orange-50 text-orange-700",
  unpaid: "border-slate-200 bg-slate-50 text-slate-700",
};

const inputClass = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const labelClass = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";

const preferredCashbookForMethod = (cashbooks = [], method = "cash") => {
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

const CarWashJobs = () => {
  const confirm = useConfirm();
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const [jobs, setJobs] = useState([]);
  const [services, setServices] = useState([]);
  const [staff, setStaff] = useState([]);
  const [cashbooks, setCashbooks] = useState([]);
  const [jobForm, setJobForm] = useState(emptyJobForm);
  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm);
  const [filters, setFilters] = useState(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState(defaultFilters);
  const [showJobModal, setShowJobModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [expandedIds, setExpandedIds] = useState([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: PAGE_SIZE, total: 0, pages: 1 });
  const [loading, setLoading] = useState(false);

  const unpaidJobs = useMemo(() => jobs.filter((job) => job.paymentStatus !== "paid"), [jobs]);
  const safeVisibleJobIds = useMemo(
    () => jobs.filter((job) => job.paymentStatus === "unpaid" && job.status !== "paid").map((job) => job._id),
    [jobs]
  );
  const selectedService = useMemo(() => services.find((item) => item._id === jobForm.service), [jobForm.service, services]);
  const selectedPaymentJob = useMemo(() => jobs.find((job) => job._id === paymentForm.job), [jobs, paymentForm.job]);
  const selectedCashbook = useMemo(() => cashbooks.find((item) => item._id === paymentForm.cashbookAccount), [cashbooks, paymentForm.cashbookAccount]);

  const load = async () => {
    setLoading(true);
    try {
      const [jobPayload, servicePayload, staffPayload, cashbookPayload] = await Promise.all([
        carWashApi.listJobs({
          date: appliedFilters.date,
          search: appliedFilters.search || undefined,
          customer: appliedFilters.customer || undefined,
          service: appliedFilters.service || undefined,
          staff: appliedFilters.staff || undefined,
          status: appliedFilters.status || undefined,
          paymentStatus: appliedFilters.paymentStatus || undefined,
          limit: PAGE_SIZE,
          page,
        }),
        carWashApi.listServices({ active: true }),
        carWashApi.listStaff({ active: true }),
        currentCompany?._id
          ? carWashApi.listChartOfAccounts({ business: currentCompany._id, type: "asset", moduleScope: "carwash", search: "Cashbooks" })
          : Promise.resolve([]),
      ]);
      setJobs(normalizeListPayload(jobPayload, "jobs"));
      setPagination(jobPayload?.pagination || { page, limit: PAGE_SIZE, total: normalizeListPayload(jobPayload, "jobs").length, pages: 1 });
      setSelectedIds([]);
      setExpandedIds([]);
      setServices(normalizeListPayload(servicePayload, "services"));
      setStaff(normalizeListPayload(staffPayload, "staff"));
      setCashbooks(Array.isArray(cashbookPayload) ? cashbookPayload : []);
    } catch {
      toast.error("Failed to load Car Wash jobs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [appliedFilters, page]);

  useEffect(() => {
    if (!selectedService) return;
    setJobForm((prev) => ({
      ...prev,
      serviceName: selectedService.name || "",
      vehicleType: selectedService.vehicleType || prev.vehicleType,
      price: selectedService.defaultPrice || "",
    }));
  }, [selectedService]);

  useEffect(() => {
    if (!selectedPaymentJob) return;
    setPaymentForm((prev) => ({
      ...prev,
      amount: prev.amount || selectedPaymentJob.price || "",
    }));
  }, [selectedPaymentJob]);

  useEffect(() => {
    if (!cashbooks.length || paymentForm.cashbookAccount) return;
    setPaymentForm((prev) => ({ ...prev, cashbookAccount: preferredCashbookForMethod(cashbooks, prev.method) }));
  }, [cashbooks, paymentForm.cashbookAccount]);

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => jobs.some((job) => job._id === id)));
    setExpandedIds((prev) => prev.filter((id) => jobs.some((job) => job._id === id)));
  }, [jobs]);

  const closeJobModal = () => {
    setShowJobModal(false);
    setJobForm(emptyJobForm);
  };

  const closePaymentModal = () => {
    setShowPaymentModal(false);
    setPaymentForm(emptyPaymentForm);
  };

  const openPaymentModal = (job = null) => {
    setPaymentForm({
      ...emptyPaymentForm,
      job: job?._id || "",
      amount: job?.price || "",
      cashbookAccount: preferredCashbookForMethod(cashbooks, emptyPaymentForm.method),
    });
    setShowPaymentModal(true);
  };

  const createJob = async (event) => {
    event.preventDefault();
    try {
      await carWashApi.createJob({
        ...jobForm,
        price: Number(jobForm.price || 0),
        assignedStaff: jobForm.assignedStaff || null,
      });
      closeJobModal();
      await load();
      toast.success("Job created");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to create job");
    }
  };

  const recordPayment = async (event) => {
    event.preventDefault();
    try {
      await carWashApi.recordPayment({
        ...paymentForm,
        amount: Number(paymentForm.amount || 0),
      });
      closePaymentModal();
      await load();
      toast.success("Payment recorded");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to record payment");
    }
  };

  const updateStatus = async (job, status) => {
    try {
      await carWashApi.updateJobStatus(job._id, status);
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to update job status");
    }
  };

  const toggleSelected = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const toggleExpanded = (id) => {
    setExpandedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
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
    const confirmed = await confirm({ title: "Delete Car Wash Jobs", message: "Delete selected unpaid Car Wash jobs? Jobs with payments cannot be deleted.", confirmText: "Delete", isDangerous: true });
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
          <button
            type="button"
            onClick={() => openPaymentModal()}
            className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-3 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
          >
            <FaMoneyBillWave />
            Record Payment
          </button>
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
          <button
            type="button"
            onClick={() => setShowJobModal(true)}
            className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-3 text-xs font-bold text-white shadow-sm hover:bg-[#0A3127]"
          >
            <FaPlus />
            New Job
          </button>
        </>
      }
    >
      <form onSubmit={applyFilters} className="mb-2 grid gap-2 border border-slate-200 bg-white p-2 shadow-sm xl:grid-cols-[1fr_1fr_0.9fr_0.9fr_0.8fr_0.8fr_0.85fr_auto_auto]">
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
              {statusLabels[status]}
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
        <input
          type="date"
          className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          value={filters.date}
          onChange={(event) => setFilterValue("date", event.target.value)}
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

      <div className="min-h-[calc(100vh-14rem)] overflow-auto border border-slate-200 bg-white shadow-sm">
        <div className="flex min-h-8 flex-wrap items-center gap-x-5 gap-y-1 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <span>Showing: <strong className="text-[#0B3B2E]">{jobs.length}</strong> / {pagination.total}</span>
          <span>Page: <strong className="text-[#0B3B2E]">{pagination.page}</strong> / {pagination.pages}</span>
          <span>Unpaid: <strong className="text-[#FF8C00]">{jobs.filter((job) => job.paymentStatus !== "paid").length}</strong></span>
          <span>Washing: <strong className="text-slate-900">{jobs.filter((job) => job.status === "washing").length}</strong></span>
          <span>Done: <strong className="text-slate-900">{jobs.filter((job) => job.status === "done").length}</strong></span>
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
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Plate</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Customer</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Service</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Staff</th>
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
                      <td className="px-2 py-1 font-extrabold text-slate-900">{job.jobNumber}</td>
                      <td className="px-2 py-1 font-extrabold uppercase text-slate-900">{job.plateNumber || "-"}</td>
                      <td className="px-2 py-1 font-semibold text-slate-800">{job.customerName || "-"}</td>
                      <td className="px-2 py-1 text-slate-700">{job.serviceName || "-"}</td>
                      <td className="px-2 py-1 text-slate-700">{job.assignedStaff?.name || "-"}</td>
                      <td className="px-2 py-1">
                        <select
                          className="h-6 border border-slate-300 bg-white px-2 text-[11px] font-bold text-slate-700"
                          value={job.status}
                          onChange={(event) => updateStatus(job, event.target.value)}
                        >
                          {statuses.map((status) => (
                            <option key={status} value={status}>
                              {statusLabels[status]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1">
                        <span className={`inline-flex border px-2 py-0.5 text-[11px] font-bold uppercase ${paymentBadgeClass[job.paymentStatus] || paymentBadgeClass.unpaid}`}>
                          {job.paymentStatus || "unpaid"}
                        </span>
                      </td>
                      <td className="px-2 py-1 text-right font-extrabold text-slate-900">{formatMoney(job.price)}</td>
                      <td className="px-2 py-1 text-right">
                        <button
                          type="button"
                          onClick={() => openPaymentModal(job)}
                          disabled={job.paymentStatus === "paid"}
                          className="border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Pay
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-slate-200 bg-[#F8FBF9]">
                        <td colSpan={11} className="px-10 py-2">
                          <div className="grid gap-3 text-[11px] text-slate-600 md:grid-cols-5">
                            <div><span className="font-extrabold uppercase text-slate-500">Time:</span> {job.createdAt ? new Date(job.createdAt).toLocaleString("en-KE") : "-"}</div>
                            <div><span className="font-extrabold uppercase text-slate-500">Phone:</span> {job.phone || "-"}</div>
                            <div><span className="font-extrabold uppercase text-slate-500">Vehicle:</span> {job.vehicleType || "-"}</div>
                            <div><span className="font-extrabold uppercase text-slate-500">Staff Phone:</span> {job.assignedStaff?.phone || "-"}</div>
                            <div><span className="font-extrabold uppercase text-slate-500">Delete:</span> {canDelete ? "Safe" : "Locked"}</div>
                            <div className="md:col-span-5"><span className="font-extrabold uppercase text-slate-500">Notes:</span> {job.notes || "-"}</div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
              );
              })
            ) : (
              <EmptyRow colSpan={11} text="No Car Wash jobs recorded for this date." />
            )}
          </tbody>
        </table>
        <div className="flex min-h-9 items-center justify-between border-t border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <span>Rows per page: {PAGE_SIZE}</span>
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

      {showJobModal && (
        <Modal
          title="Create Car Wash Job"
          subtitle="Capture the vehicle, service, price and assigned staff."
          onClose={closeJobModal}
          footer={
            <>
              <button type="button" onClick={closeJobModal} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">
                Cancel
              </button>
              <button type="submit" form="carwash-job-form" className="bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127]">
                Save Job
              </button>
            </>
          }
        >
          <form id="carwash-job-form" onSubmit={createJob} className="grid gap-3 md:grid-cols-2">
            <div>
              <label className={labelClass}>Plate Number</label>
              <input className={inputClass} value={jobForm.plateNumber} onChange={(event) => setJobForm((prev) => ({ ...prev, plateNumber: event.target.value }))} required autoFocus />
            </div>
            <div>
              <label className={labelClass}>Customer</label>
              <input className={inputClass} value={jobForm.customerName} onChange={(event) => setJobForm((prev) => ({ ...prev, customerName: event.target.value }))} />
            </div>
            <div>
              <label className={labelClass}>Phone</label>
              <input className={inputClass} value={jobForm.phone} onChange={(event) => setJobForm((prev) => ({ ...prev, phone: event.target.value }))} />
            </div>
            <div>
              <label className={labelClass}>Service</label>
              <select className={inputClass} value={jobForm.service} onChange={(event) => setJobForm((prev) => ({ ...prev, service: event.target.value }))}>
                <option value="">Select service</option>
                {services.map((item) => (
                  <option key={item._id} value={item._id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Service Name</label>
              <input className={inputClass} value={jobForm.serviceName} onChange={(event) => setJobForm((prev) => ({ ...prev, serviceName: event.target.value }))} required={!jobForm.service} />
            </div>
            <div>
              <label className={labelClass}>Vehicle Type</label>
              <input className={inputClass} value={jobForm.vehicleType} onChange={(event) => setJobForm((prev) => ({ ...prev, vehicleType: event.target.value }))} />
            </div>
            <div>
              <label className={labelClass}>Price</label>
              <input className={inputClass} type="number" min="0" value={jobForm.price} onChange={(event) => setJobForm((prev) => ({ ...prev, price: event.target.value }))} required />
            </div>
            <div>
              <label className={labelClass}>Assigned Staff</label>
              <select className={inputClass} value={jobForm.assignedStaff} onChange={(event) => setJobForm((prev) => ({ ...prev, assignedStaff: event.target.value }))}>
                <option value="">Assign staff</option>
                {staff.map((item) => (
                  <option key={item._id} value={item._id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className={labelClass}>Notes</label>
              <textarea className="min-h-20 w-full border border-slate-300 px-2 py-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none" value={jobForm.notes} onChange={(event) => setJobForm((prev) => ({ ...prev, notes: event.target.value }))} />
            </div>
          </form>
        </Modal>
      )}

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
              <button type="submit" form="carwash-payment-form" className="bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127]">
                Record Payment
              </button>
            </>
          }
        >
          <form id="carwash-payment-form" onSubmit={recordPayment} className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className={labelClass}>Job</label>
              <select className={inputClass} value={paymentForm.job} onChange={(event) => setPaymentForm((prev) => ({ ...prev, job: event.target.value, amount: "" }))} required>
                <option value="">Select job</option>
                {unpaidJobs.map((job) => (
                  <option key={job._id} value={job._id}>
                    {job.jobNumber} - {job.plateNumber} - {formatMoney(job.price)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Amount</label>
              <input className={inputClass} type="number" min="1" value={paymentForm.amount} onChange={(event) => setPaymentForm((prev) => ({ ...prev, amount: event.target.value }))} required />
            </div>
            <div>
              <label className={labelClass}>Method</label>
              <select className={inputClass} value={paymentForm.method} onChange={(event) => setPaymentForm((prev) => ({ ...prev, method: event.target.value, cashbookAccount: preferredCashbookForMethod(cashbooks, event.target.value) }))}>
                {paymentMethods.map((method) => (
                  <option key={method} value={method}>
                    {method.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Payment Date</label>
              <input className={inputClass} type="date" value={paymentForm.paymentDate} onChange={(event) => setPaymentForm((prev) => ({ ...prev, paymentDate: event.target.value }))} required />
            </div>
            <div>
              <label className={labelClass}>Cashbook</label>
              <select className={inputClass} value={paymentForm.cashbookAccount} onChange={(event) => setPaymentForm((prev) => ({ ...prev, cashbookAccount: event.target.value }))} required>
                <option value="">Select cashbook</option>
                {cashbooks.map((account) => (
                  <option key={account._id} value={account._id}>
                    {account.code} - {account.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className={labelClass}>Reference</label>
              <input className={inputClass} value={paymentForm.reference} onChange={(event) => setPaymentForm((prev) => ({ ...prev, reference: event.target.value }))} placeholder={paymentForm.method === "cash" ? "Optional cash receipt note" : "M-Pesa code, bank ref, card ref..."} />
            </div>
            <div className="md:col-span-2 border border-[#B7C9C0] bg-[#EDF5F1] px-3 py-2 text-xs font-bold text-[#0B3B2E]">
              Cashbook: {selectedCashbook ? `${selectedCashbook.code} - ${selectedCashbook.name}` : "Select where this payment was received"}
            </div>
          </form>
        </Modal>
      )}
    </CarWashShell>
  );
};

export default CarWashJobs;
