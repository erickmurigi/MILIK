import React, { useEffect, useMemo, useState } from "react";
import {
  FaCalendarAlt,
  FaCheck,
  FaChevronDown,
  FaEdit,
  FaPause,
  FaPlay,
  FaPlus,
  FaPrint,
  FaSave,
  FaSearch,
  FaTimes,
  FaTrash,
  FaUndo,
} from "react-icons/fa";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import {
  cancelLandlordAdvancementRecovery,
  createLandlordAdvancement,
  deleteLandlordAdvancement,
  getLandlordAdvancements,
  getLandlords,
  processLandlordAdvancementRecovery,
  updateLandlordAdvancement,
  updateLandlordAdvancementStatus,
} from "../../redux/apiCalls";
import { getProperties } from "../../redux/propertyRedux";
import { propertyBelongsToLandlord } from "./propertyUtils";

const todayIso = () => new Date().toISOString().split("T")[0];
const money = (value) => `KES ${Number(value || 0).toLocaleString()}`;
const formatDate = (value) => (value ? new Date(value).toLocaleDateString() : "-");

const addMonths = (dateValue, months = 0) => {
  if (!dateValue) return null;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  const safeMonths = Math.max(0, Number(months || 0));
  const originalDay = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + safeMonths);
  const maxDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(originalDay, maxDay));
  return date;
};

const computeRecoveryEndDate = ({ startDate, periodMonths, gracePeriodMonths }) => {
  const safePeriodMonths = Math.max(0, Number(periodMonths || 0));
  if (!startDate || safePeriodMonths <= 0) return "";
  const effectiveStart = addMonths(startDate, gracePeriodMonths || 0);
  if (!effectiveStart) return "";
  const endDate = new Date(effectiveStart.getFullYear(), effectiveStart.getMonth() + safePeriodMonths, 0);
  return Number.isNaN(endDate.getTime()) ? "" : endDate.toISOString().split("T")[0];
};

const blankForm = {
  landlord: "",
  property: "",
  title: "",
  narration: "",
  amount: "",
  interestRate: "",
  interestType: "simple_flat",
  disbursementDate: todayIso(),
  startDate: todayIso(),
  endDate: todayIso(),
  periodMonths: "",
  gracePeriodMonths: 0,
  frequency: "monthly",
  paymentMethod: "bank_transfer",
  status: "draft",
};

const statusPills = {
  draft: "bg-slate-100 text-slate-700",
  active: "bg-emerald-100 text-emerald-700",
  paused: "bg-amber-100 text-amber-700",
  completed: "bg-blue-100 text-blue-700",
  cancelled: "bg-rose-100 text-rose-700",
};

const escapeHtml = (value = "") =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");

const LandlordAdvancements = () => {
  const dispatch = useDispatch();
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const landlords = useSelector((state) => state.landlord?.landlords || []);
  const properties = useSelector((state) => state.property?.properties || []);
  const activeLandlords = useMemo(() => landlords.filter((item) => String(item?.status || "active").toLowerCase() !== "archived"), [landlords]);
  const activeProperties = useMemo(() => properties.filter((item) => String(item?.status || "active").toLowerCase() !== "archived"), [properties]);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [expandedId, setExpandedId] = useState("");
  const [filters, setFilters] = useState({ search: "", status: "all", landlordId: "all" });
  const [form, setForm] = useState(blankForm);
  const [recoveryModal, setRecoveryModal] = useState({ open: false, row: null, periodKey: "", amount: "", note: "" });

  useEffect(() => {
    if (!currentCompany?._id) return;
    dispatch(getLandlords({ company: currentCompany._id }));
    dispatch(getProperties({ business: currentCompany._id }));
  }, [dispatch, currentCompany?._id]);

  const loadRows = async () => {
    if (!currentCompany?._id) return;
    setLoading(true);
    try {
      const data = await getLandlordAdvancements({
        business: currentCompany._id,
        company: currentCompany._id,
        ...filters,
      });
      setRows(Array.isArray(data) ? data : []);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load landlord advancements");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
  }, [currentCompany?._id, filters.search, filters.status, filters.landlordId]);

  useEffect(() => {
    if (!showModal) return;
    if (!Number(form.periodMonths || 0) || !form.startDate) return;

    const computedEndDate = computeRecoveryEndDate({
      startDate: form.startDate,
      periodMonths: form.periodMonths,
      gracePeriodMonths: form.gracePeriodMonths,
    });

    if (computedEndDate && computedEndDate !== form.endDate) {
      setForm((prev) => ({ ...prev, endDate: computedEndDate }));
    }
  }, [showModal, form.startDate, form.periodMonths, form.gracePeriodMonths, form.endDate]);

  const stats = useMemo(
    () => ({
      total: rows.length,
      disbursed: rows.reduce((sum, row) => sum + Number(row.amount || 0), 0),
      recovered: rows.reduce((sum, row) => sum + Number(row.totalRecoveredAmount || (Number(row.recoveredAmount || 0) + Number(row.interestRecoveredAmount || 0))), 0),
      interestRecovered: rows.reduce((sum, row) => sum + Number(row.interestRecoveredAmount || 0), 0),
      outstanding: rows.reduce((sum, row) => sum + Number(row.balanceOutstanding || 0), 0),
    }),
    [rows]
  );

  const filteredProperties = useMemo(() => {
    if (!form.landlord) return activeProperties;
    const selectedLandlord = activeLandlords.find((item) => String(item._id) === String(form.landlord));
    return activeProperties.filter((property) =>
      propertyBelongsToLandlord(property, form.landlord, selectedLandlord?.landlordName)
    );
  }, [activeLandlords, activeProperties, form.landlord]);

  const openCreate = () => {
    setEditingId("");
    setForm(blankForm);
    setShowModal(true);
  };

  const openEdit = (row) => {
    setEditingId(row._id);
    setForm({
      landlord: row.landlord?._id || row.landlord || "",
      property: row.property?._id || row.property || "",
      title: row.title || "",
      narration: row.narration || "",
      amount: row.amount || "",
      interestRate: row.interestRate || "",
      interestType: row.interestType || "simple_flat",
      disbursementDate: row.disbursementDate ? new Date(row.disbursementDate).toISOString().split("T")[0] : todayIso(),
      startDate: row.startDate ? new Date(row.startDate).toISOString().split("T")[0] : todayIso(),
      endDate: row.endDate ? new Date(row.endDate).toISOString().split("T")[0] : todayIso(),
      periodMonths: row.periodMonths || "",
      gracePeriodMonths: Number(row.gracePeriodMonths || 0),
      frequency: row.frequency === "annually" ? "yearly" : row.frequency || "monthly",
      paymentMethod:
        row.paymentMethod === "mobile_money"
          ? "mpesa"
          : row.paymentMethod === "check"
          ? "cheque"
          : row.paymentMethod || "bank_transfer",
      status: row.status || "draft",
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.landlord) return toast.warning("Landlord is required");
    if (!form.property) return toast.warning("Property is required");
    if (!form.title.trim()) return toast.warning("Title is required");
    if (!Number(form.amount || 0) || Number(form.amount) <= 0) return toast.warning("Valid advancement amount is required");
    if (!form.startDate) return toast.warning("Recovery start date is required");
    if (!form.endDate && !Number(form.periodMonths || 0)) return toast.warning("Recovery end date is required");

    setSaving(true);
    try {
      const payload = {
        ...form,
        amount: Number(form.amount),
        interestRate: form.interestRate ? Number(form.interestRate) : 0,
        interestType: form.interestType || "simple_flat",
        periodMonths: form.periodMonths ? Number(form.periodMonths) : null,
        gracePeriodMonths: Number(form.gracePeriodMonths || 0),
        business: currentCompany?._id,
        company: currentCompany?._id,
      };
      const saved = editingId
        ? await updateLandlordAdvancement(editingId, payload)
        : await createLandlordAdvancement(payload);
      setRows((prev) => (editingId ? prev.map((row) => (row._id === editingId ? saved : row)) : [saved, ...prev]));
      setShowModal(false);
      setEditingId("");
      setForm(blankForm);
      toast.success(`Landlord advancement ${editingId ? "updated" : "saved"}`);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to save landlord advancement");
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (row, status) => {
    try {
      const saved = await updateLandlordAdvancementStatus(row._id, {
        status,
        business: currentCompany?._id,
        company: currentCompany?._id,
      });
      setRows((prev) => prev.map((item) => (item._id === row._id ? saved : item)));
      toast.success(`Advancement marked ${status}`);
    } catch (error) {
      toast.error(error?.response?.data?.message || `Failed to mark advancement ${status}`);
    }
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete advancement ${row.referenceNo}?`)) return;
    try {
      await deleteLandlordAdvancement(row._id, { business: currentCompany?._id, company: currentCompany?._id });
      setRows((prev) => prev.filter((item) => item._id !== row._id));
      toast.success("Landlord advancement deleted");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to delete landlord advancement");
    }
  };

  const openRecoveryModal = (row) => {
    const firstPeriod = row?.eligibleRecoveryPeriods?.[0] || null;
    if (!firstPeriod) {
      toast.info("No eligible recovery period is available. Future periods and already processed periods are blocked.");
      return;
    }
    setRecoveryModal({
      open: true,
      row,
      periodKey: firstPeriod.periodKey,
      amount: String(Number(firstPeriod.scheduledAmount || 0)),
      note: row.narration || row.title || "",
    });
  };

  const selectedRecoveryPeriod = useMemo(() => {
    if (!recoveryModal?.row) return null;
    return (recoveryModal.row.eligibleRecoveryPeriods || []).find((item) => item.periodKey === recoveryModal.periodKey) || null;
  }, [recoveryModal]);

  const handleProcessRecovery = async () => {
    if (!recoveryModal?.row?._id || !recoveryModal.periodKey) return toast.warning("Select a valid recovery period");
    try {
      const saved = await processLandlordAdvancementRecovery(recoveryModal.row._id, {
        business: currentCompany?._id,
        company: currentCompany?._id,
        periodKey: recoveryModal.periodKey,
        amount: Number(recoveryModal.amount || 0),
        note: recoveryModal.note,
      });
      setRows((prev) => prev.map((item) => (item._id === recoveryModal.row._id ? saved : item)));
      setRecoveryModal({ open: false, row: null, periodKey: "", amount: "", note: "" });
      toast.success("Advancement recovery processed successfully");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to process advancement recovery");
    }
  };

  const handleCancelRecovery = async (row, period) => {
    if (!row?._id || !period?.recoveryId) return;
    const periodLabel = period?.periodLabel || period?.periodKey || "this recovery period";
    if (!window.confirm(`Cancel processed recovery for ${periodLabel}?`)) return;

    const reason = window.prompt(
      "Cancellation reason (required for audit trail)",
      `Cancelled recovery for ${periodLabel}`
    );
    if (reason === null) return;
    if (!String(reason || "").trim()) {
      toast.warning("Cancellation reason is required.");
      return;
    }

    try {
      const saved = await cancelLandlordAdvancementRecovery(row._id, period.recoveryId, {
        business: currentCompany?._id,
        company: currentCompany?._id,
        periodKey: period.periodKey,
        reason,
      });
      setRows((prev) => prev.map((item) => (item._id === row._id ? saved : item)));
      toast.success(`Recovery for ${periodLabel} cancelled successfully`);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to cancel advancement recovery");
    }
  };

  const printableRows = useMemo(() => {
    if (filters.landlordId === "all") return rows;
    return rows.filter((row) => String(row.landlord?._id || row.landlord || "") === String(filters.landlordId));
  }, [rows, filters.landlordId]);

  const handlePrint = () => {
    if (filters.landlordId === "all") {
      toast.info("Filter by landlord first to print a landlord-specific advancement report.");
      return;
    }

    const selectedLandlord = landlords.find((item) => String(item._id) === String(filters.landlordId));
    const title = selectedLandlord?.landlordName || "Landlord Advancement Report";
    const printedOn = new Date().toLocaleString();

    const cards = printableRows
      .map((row) => {
        const scheduleRows = (row.amortizationSchedule || [])
          .map(
            (item) => `
              <tr>
                <td>${escapeHtml(item.periodLabel || item.periodKey || "-")}</td>
                <td>${escapeHtml(formatDate(item.periodStart))}</td>
                <td>${escapeHtml(formatDate(item.periodEnd))}</td>
                <td class="money">${escapeHtml(money(item.scheduledAmount))}</td>
                <td>${item.processed ? "Processed" : "Pending"}</td>
              </tr>
            `
          )
          .join("");

        return `
          <section class="card">
            <div class="card-head">
              <div>
                <h3>${escapeHtml(row.title || row.referenceNo)}</h3>
                <p>${escapeHtml(row.referenceNo)} • ${escapeHtml(row.property?.propertyName || row.property?.name || "Property")}</p>
              </div>
              <div class="pill">${escapeHtml(row.status || "draft")}</div>
            </div>
            <div class="meta-grid">
              <div><span>Amount</span><strong>${escapeHtml(money(row.amount))}</strong></div>
              <div><span>Recovered</span><strong>${escapeHtml(money(row.recoveredAmount))}</strong></div>
              <div><span>Outstanding</span><strong>${escapeHtml(money(row.balanceOutstanding))}</strong></div>
              <div><span>Disbursed</span><strong>${escapeHtml(formatDate(row.disbursementDate))}</strong></div>
            </div>
            <table>
              <thead>
                <tr><th>Period</th><th>Start</th><th>End</th><th>Amount</th><th>Status</th></tr>
              </thead>
              <tbody>${scheduleRows || `<tr><td colspan="5">No amortization schedule available.</td></tr>`}</tbody>
            </table>
          </section>
        `;
      })
      .join("");

    const printWindow = window.open("", "_blank", "width=1200,height=900");
    if (!printWindow) return toast.error("Unable to open print preview.");

    printWindow.document.write(`
      <html>
        <head>
          <title>${escapeHtml(title)} - Landlord Advancement Report</title>
          <style>
            body { font-family: Arial, sans-serif; color: #0f172a; margin: 24px; }
            .header { border: 1px solid #cbd5e1; border-radius: 20px; padding: 20px; margin-bottom: 20px; }
            .header h1 { margin: 0; font-size: 24px; }
            .header p { margin: 6px 0 0; color: #475569; }
            .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 16px; }
            .summary .box { border: 1px solid #cbd5e1; border-radius: 16px; padding: 14px; }
            .summary span { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.16em; color: #64748b; }
            .summary strong { display: block; margin-top: 8px; font-size: 20px; }
            .card { border: 1px solid #cbd5e1; border-radius: 18px; padding: 18px; margin-bottom: 18px; page-break-inside: avoid; }
            .card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 14px; }
            .card-head h3 { margin: 0; font-size: 18px; }
            .card-head p { margin: 4px 0 0; color: #475569; }
            .pill { border-radius: 999px; border: 1px solid #cbd5e1; padding: 6px 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; }
            .meta-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px; }
            .meta-grid span { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.16em; color: #64748b; }
            .meta-grid strong { display: block; margin-top: 6px; }
            table { width: 100%; border-collapse: collapse; }
            th, td { border-bottom: 1px solid #e2e8f0; padding: 10px 8px; text-align: left; font-size: 12px; }
            th { background: #f8fafc; font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em; color: #475569; }
            .money { text-align: right; white-space: nowrap; }
            @media print { body { margin: 10mm; } }
          </style>
        </head>
        <body>
          <section class="header">
            <h1>${escapeHtml(title)} - Landlord Advancement Report</h1>
            <p>Printed on ${escapeHtml(printedOn)}</p>
            <div class="summary">
              <div class="box"><span>Total advanced</span><strong>${escapeHtml(money(printableRows.reduce((sum, row) => sum + Number(row.amount || 0), 0)))}</strong></div>
              <div class="box"><span>Total recovered</span><strong>${escapeHtml(money(printableRows.reduce((sum, row) => sum + Number(row.recoveredAmount || 0), 0)))}</strong></div>
              <div class="box"><span>Outstanding</span><strong>${escapeHtml(money(printableRows.reduce((sum, row) => sum + Number(row.balanceOutstanding || 0), 0)))}</strong></div>
            </div>
          </section>
          ${cards || `<p>No records available for the selected landlord.</p>`}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 300);
  };

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="mx-auto max-w-[96%] space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-[#0B3B2E]">Landlord Payments</p>
                <h1 className="mt-1 text-2xl font-black text-slate-900">Landlord Advancement</h1>
                <p className="mt-1 text-sm text-slate-500">Manage landlord loans/advances, track amortization periods, and process only eligible current or skipped recoveries.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={handlePrint} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-3 text-sm font-black text-slate-700 hover:bg-slate-50"><FaPrint /> Print landlord report</button>
                <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-xl bg-[#0B3B2E] px-4 py-3 text-sm font-black text-white hover:bg-[#0A3127]"><FaPlus /> Add Advancement</button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Loans</p><p className="mt-2 text-2xl font-black text-slate-900">{stats.total}</p></div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-600">Disbursed</p><p className="mt-2 text-2xl font-black text-emerald-700">{money(stats.disbursed)}</p></div>
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">Recovered</p><p className="mt-2 text-2xl font-black text-blue-700">{money(stats.recovered)}</p></div>
            <div className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50 p-4 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.18em] text-fuchsia-600">Interest Recovered</p><p className="mt-2 text-2xl font-black text-fuchsia-700">{money(stats.interestRecovered)}</p></div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.18em] text-amber-600">Outstanding</p><p className="mt-2 text-2xl font-black text-amber-700">{money(stats.outstanding)}</p></div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50">
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
                <div className="relative lg:col-span-2">
                  <FaSearch className="absolute left-3 top-3.5 text-slate-400" />
                  <input value={filters.search} onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))} placeholder="Search reference, title, narration" className="w-full px-3 py-3 pl-10 border border-slate-300 rounded-md text-sm" />
                </div>
                <div>
                  <select value={filters.landlordId} onChange={(e) => setFilters((prev) => ({ ...prev, landlordId: e.target.value }))} className="w-full px-3 py-3 border border-slate-300 rounded-md text-sm">
                    <option value="all">All Landlords</option>
                    {activeLandlords.map((landlord) => <option key={landlord._id} value={landlord._id}>{landlord.landlordName || `${landlord.firstName || ""} ${landlord.lastName || ""}`.trim()}</option>)}
                  </select>
                </div>
                <div>
                  <select value={filters.status} onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))} className="w-full px-3 py-3 border border-slate-300 rounded-md text-sm">
                    <option value="all">All Statuses</option>
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={openCreate}
                  className="px-3 py-1.5 text-xs rounded-md bg-[#0B3B2E] hover:bg-[#0A3127] text-white font-semibold flex items-center gap-2"
                >
                  <FaPlus /> Add Advancement
                </button>
                <button
                  onClick={() => setFilters({ search: "", status: "all", landlordId: "all" })}
                  className="px-3 py-1.5 text-xs rounded-md bg-slate-500 hover:bg-slate-600 text-white font-semibold"
                >
                  Reset Filters
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1200px] text-xs">
                <thead>
                  <tr className="bg-[#0B3B2E] text-white">
                    <th className="px-3 py-2 text-left font-semibold">Advancement</th>
                    <th className="px-3 py-2 text-left font-semibold">Landlord / Property</th>
                    <th className="px-3 py-2 text-left font-semibold">Amortization</th>
                    <th className="px-3 py-2 text-right font-semibold">Outstanding</th>
                    <th className="px-3 py-2 text-left font-semibold">Status</th>
                    <th className="px-3 py-2 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {!loading && rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No landlord advancements found.</td></tr>}
                  {rows.map((row, index) => {
                    const expanded = expandedId === row._id;
                    return (
                      <React.Fragment key={row._id}>
                        <tr className={`border-t border-slate-100 ${index % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}>
                          <td className="px-4 py-3">
                            <div className="font-black text-slate-900">{row.referenceNo}</div>
                            <div className="text-xs text-slate-500">{row.title}</div>
                            <button type="button" onClick={() => setExpandedId((prev) => (prev === row._id ? "" : row._id))} className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-[#0B3B2E]"><FaChevronDown className={`transition ${expanded ? "rotate-180" : ""}`} />{expanded ? "Hide amortization" : "View amortization"}</button>
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            <div>{row.landlord?.landlordName || `${row.landlord?.firstName || ""} ${row.landlord?.lastName || ""}`.trim() || "Landlord"}</div>
                            <div className="text-xs text-slate-500">{row.property?.propertyName || row.property?.name || "No property"}</div>
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            <div className="font-semibold capitalize">{String(row.frequency || "monthly").replace(/_/g, " ")}</div>
                            <div className="text-xs text-slate-500">Processed {row.processedPeriodsCount || 0} • Pending {row.unprocessedPeriodsCount || 0} • Cancelled {row.cancelledPeriodsCount || 0}</div>
                            <div className="text-xs text-slate-500">Next eligible recovery: {row.nextEligibleRecoveryPeriod?.periodLabel || "No open period"}</div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="font-black text-slate-900">{money(row.balanceOutstanding)}</div>
                            <div className="text-xs text-slate-500">Principal {money(row.amount)} • Interest {money(row.scheduledInterestTotal)}</div>
                            <div className="text-xs text-slate-500">Recovered {money(row.totalRecoveredAmount || (Number(row.recoveredAmount || 0) + Number(row.interestRecoveredAmount || 0)))}</div>
                          </td>
                          <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${statusPills[row.status] || statusPills.draft}`}>{row.status}</span></td>
                          <td className="px-4 py-3 text-right">
                            <div className="inline-flex flex-wrap justify-end gap-2">
                              <button onClick={() => openEdit(row)} className="inline-flex items-center gap-1 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700"><FaEdit /> Edit</button>
                              {row.status !== "active" && row.status !== "completed" && <button onClick={() => handleStatus(row, "active")} className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700"><FaPlay /> Activate</button>}
                              {row.status === "active" && <button onClick={() => handleStatus(row, "paused")} className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-black text-amber-700"><FaPause /> Pause</button>}
                              <button onClick={() => openRecoveryModal(row)} className="inline-flex items-center gap-1 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-700"><FaCalendarAlt /> Process recovery</button>
                              <button onClick={() => handleDelete(row)} className="inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700"><FaTrash /> Delete</button>
                            </div>
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="border-t border-slate-100 bg-slate-50">
                            <td colSpan={6} className="px-4 py-4">
                              <div className="grid gap-4 xl:grid-cols-3">
                                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Eligible recovery periods</p>
                                  <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
                                    {(row.eligibleRecoveryPeriods || []).length === 0 && <p className="text-sm text-slate-500">No eligible recovery periods. Future and already processed periods are blocked.</p>}
                                    {(row.eligibleRecoveryPeriods || []).map((item) => (
                                      <div key={item.periodKey} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
                                        <div className="flex items-start justify-between gap-3">
                                          <div>
                                            <div className="font-bold text-slate-800">{item.periodLabel}</div>
                                            <div className="text-xs text-slate-500">{formatDate(item.periodStart)} - {formatDate(item.periodEnd)}</div>
                                            <div className="mt-1 text-[11px] text-slate-500">Principal {money(item.scheduledPrincipalAmount)} • Interest {money(item.scheduledInterestAmount)}</div>
                                          </div>
                                          <div className="font-black text-slate-900">{money(item.scheduledAmount)}</div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                  <div className="flex items-center justify-between gap-3">
                                    <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Processed recovery history</p>
                                    <span className="text-[11px] font-bold text-slate-500">{(row.processedPeriods || []).length} active • {(row.cancelledPeriods || []).length} cancelled</span>
                                  </div>
                                  <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
                                    {(row.processedPeriods || []).length === 0 && <p className="text-sm text-slate-500">No processed recovery periods yet.</p>}
                                    {(row.processedPeriods || []).map((item) => (
                                      <div key={item.recoveryId || item.periodKey} className="rounded-xl border border-slate-200 px-3 py-3 text-sm">
                                        <div className="flex items-start justify-between gap-3">
                                          <div>
                                            <div className="font-bold text-slate-800">{item.periodLabel || item.periodKey}</div>
                                            <div className="text-xs text-slate-500">Processed {formatDate(item.processedAt)}</div>
                                            <div className="mt-1 text-[11px] text-slate-500">{item.note || item.referenceNo || "No note"}</div>
                                          </div>
                                          <div className="text-right">
                                            <div className="font-black text-slate-900">{money(item.amount)}</div>
                                            <button
                                              type="button"
                                              onClick={() => handleCancelRecovery(row, item)}
                                              className="mt-2 inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-black text-amber-700"
                                            >
                                              <FaUndo /> Cancel period
                                            </button>
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                    {(row.cancelledPeriods || []).length > 0 && (
                                      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3">
                                        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Cancelled recovery audit</p>
                                        <div className="mt-2 space-y-2">
                                          {(row.cancelledPeriods || []).map((item) => (
                                            <div key={`cancelled-${item.recoveryId || item.periodKey}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-600">
                                              <div className="flex items-center justify-between gap-2">
                                                <span className="font-bold text-slate-800">{item.periodLabel || item.periodKey}</span>
                                                <span>{money(item.amount)}</span>
                                              </div>
                                              <div className="mt-1">Cancelled {formatDate(item.cancelledAt)}{item.cancellationReason ? ` • ${item.cancellationReason}` : ""}</div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Full amortization schedule</p>
                                  <div className="mt-3 max-h-64 overflow-y-auto rounded-xl border border-slate-200">
                                    <table className="min-w-full text-xs">
                                      <thead className="bg-slate-100 text-left text-slate-600">
                                        <tr><th className="px-3 py-2">Period</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Status</th></tr>
                                      </thead>
                                      <tbody>
                                        {(row.amortizationSchedule || []).map((item) => (
                                          <tr key={item.periodKey} className="border-t border-slate-100">
                                            <td className="px-3 py-2">{item.periodLabel}</td>
                                            <td className="px-3 py-2 text-right font-bold">{money(item.scheduledAmount)}</td>
                                            <td className="px-3 py-2">{item.processed ? `Processed ${formatDate(item.processedAt)}` : "Pending"}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-[#0B3B2E] px-6 py-4 text-white">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-100">Landlord Advancement</p>
                <h3 className="text-xl font-black">{editingId ? "Edit Advancement" : "Add Advancement"}</h3>
              </div>
              <button onClick={() => setShowModal(false)} className="rounded-full border border-white/30 p-2 hover:bg-white/10"><FaTimes /></button>
            </div>
            <div className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-3">
              <label className="block"><span className="text-sm font-bold text-slate-700">Landlord</span><select value={form.landlord} onChange={(e) => setForm((prev) => ({ ...prev, landlord: e.target.value, property: "" }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"><option value="">Select landlord</option>{activeLandlords.map((landlord) => <option key={landlord._id} value={landlord._id}>{landlord.landlordName || `${landlord.firstName || ""} ${landlord.lastName || ""}`.trim()}</option>)}</select></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Property</span><select value={form.property} onChange={(e) => setForm((prev) => ({ ...prev, property: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"><option value="">Select property</option>{filteredProperties.map((property) => <option key={property._id} value={property._id}>{property.propertyCode ? `[${property.propertyCode}] ` : ""}{property.propertyName || property.name}</option>)}</select></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Principal Amount</span><input type="number" value={form.amount} onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Interest Rate (%) per recovery period</span><input type="number" min="0" step="0.01" value={form.interestRate} onChange={(e) => setForm((prev) => ({ ...prev, interestRate: e.target.value }))} placeholder="Optional" className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Interest Method</span><select value={form.interestType} onChange={(e) => setForm((prev) => ({ ...prev, interestType: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"><option value="simple_flat">Flat on principal</option><option value="reducing_balance">Reducing balance</option></select></label>
              <label className="block xl:col-span-2"><span className="text-sm font-bold text-slate-700">Title</span><input value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Disbursement Date</span><input type="date" value={form.disbursementDate} onChange={(e) => setForm((prev) => ({ ...prev, disbursementDate: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Recovery Start Date</span><input type="date" value={form.startDate} onChange={(e) => setForm((prev) => ({ ...prev, startDate: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Period (Months)</span><input type="number" min="1" value={form.periodMonths} onChange={(e) => setForm((prev) => ({ ...prev, periodMonths: e.target.value }))} placeholder="Optional" className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Grace Period (Months)</span><input type="number" min="0" value={form.gracePeriodMonths} onChange={(e) => setForm((prev) => ({ ...prev, gracePeriodMonths: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Recovery End Date</span><input type="date" value={form.endDate} onChange={(e) => setForm((prev) => ({ ...prev, endDate: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Frequency</span><select value={form.frequency} onChange={(e) => setForm((prev) => ({ ...prev, frequency: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Payment Method</span><select value={form.paymentMethod} onChange={(e) => setForm((prev) => ({ ...prev, paymentMethod: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"><option value="bank_transfer">Bank Transfer</option><option value="mpesa">M-Pesa</option><option value="cheque">Cheque</option><option value="cash">Cash</option><option value="other">Other</option></select></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Initial Status</span><select value={form.status} onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"><option value="draft">Draft</option><option value="active">Active / Disburse now</option><option value="paused">Paused</option></select></label>
              <label className="block xl:col-span-3"><span className="text-sm font-bold text-slate-700">Narration</span><textarea rows={3} value={form.narration} onChange={(e) => setForm((prev) => ({ ...prev, narration: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <button onClick={() => setShowModal(false)} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-black text-slate-700">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-[#0B3B2E] px-4 py-3 text-sm font-black text-white disabled:opacity-60"><FaSave /> {saving ? "Saving..." : editingId ? "Update Advancement" : "Save Advancement"}</button>
            </div>
          </div>
        </div>
      )}

      {recoveryModal.open && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/55 p-4">
          <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-indigo-600 px-6 py-4 text-white">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-100">Advancement Recovery</p>
                <h3 className="text-xl font-black">Choose eligible recovery period</h3>
              </div>
              <button onClick={() => setRecoveryModal({ open: false, row: null, periodKey: "", amount: "", note: "" })} className="rounded-full border border-white/30 p-2 hover:bg-white/10"><FaTimes /></button>
            </div>
            <div className="space-y-4 p-6">
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-900">
                <div className="font-black">{recoveryModal.row?.title}</div>
                <div className="mt-1">Recoveries post as landlord statement deductions and cannot be run for future or already processed periods.</div>
              </div>
              <label className="block">
                <span className="text-sm font-bold text-slate-700">Eligible recovery period</span>
                <select value={recoveryModal.periodKey} onChange={(e) => setRecoveryModal((prev) => ({ ...prev, periodKey: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
                  {(recoveryModal.row?.eligibleRecoveryPeriods || []).map((item) => (
                    <option key={item.periodKey} value={item.periodKey}>{item.periodLabel} • {money(item.scheduledAmount)} (P {money(item.scheduledPrincipalAmount)} / I {money(item.scheduledInterestAmount)})</option>
                  ))}
                </select>
              </label>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-bold text-slate-700">Amount</span>
                  <input type="number" value={recoveryModal.amount} onChange={(e) => setRecoveryModal((prev) => ({ ...prev, amount: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
                </label>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  <div className="font-black text-slate-900">Selected recovery period</div>
                  <div className="mt-2">{selectedRecoveryPeriod?.periodLabel || "-"}</div>
                  <div className="text-xs text-slate-500">Window: {formatDate(selectedRecoveryPeriod?.periodStart)} - {formatDate(selectedRecoveryPeriod?.periodEnd)}</div>
                </div>
              </div>
              <label className="block">
                <span className="text-sm font-bold text-slate-700">Narration</span>
                <textarea rows={3} value={recoveryModal.note} onChange={(e) => setRecoveryModal((prev) => ({ ...prev, note: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
              </label>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <button onClick={() => setRecoveryModal({ open: false, row: null, periodKey: "", amount: "", note: "" })} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-black text-slate-700">Cancel</button>
              <button onClick={handleProcessRecovery} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-black text-white"><FaCheck /> Process recovery</button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default LandlordAdvancements;
