import React, { useEffect, useMemo, useState } from "react";
import {
  FaCalendarAlt,
  FaCheck,
  FaChevronDown,
  FaEdit,
  FaPause,
  FaPlay,
  FaPlus,
  FaSave,
  FaSearch,
  FaStop,
  FaTimes,
  FaTrash,
} from "react-icons/fa";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import {
  createLandlordStandingOrder,
  deleteLandlordStandingOrder,
  getLandlordStandingOrders,
  getLandlords,
  runLandlordStandingOrder,
  updateLandlordStandingOrder,
  updateLandlordStandingOrderStatus,
} from "../../redux/apiCalls";
import { getProperties } from "../../redux/propertyRedux";
import { propertyBelongsToLandlord } from "./propertyUtils";

const todayIso = () => new Date().toISOString().split("T")[0];

const blankForm = {
  landlord: "",
  property: "",
  title: "",
  narration: "",
  amount: "",
  frequency: "monthly",
  startDate: todayIso(),
  endDate: "",
  paymentMethod: "bank_transfer",
  status: "draft",
};

const statusPills = {
  draft: "bg-slate-100 text-slate-700",
  active: "bg-emerald-100 text-emerald-700",
  paused: "bg-amber-100 text-amber-700",
  stopped: "bg-rose-100 text-rose-700",
};

const money = (value) => `KES ${Number(value || 0).toLocaleString()}`;
const formatDate = (value) => (value ? new Date(value).toLocaleDateString() : "-");

const LandlordStandingOrders = () => {
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
  const [filters, setFilters] = useState({ search: "", status: "all", landlordId: "all" });
  const [form, setForm] = useState(blankForm);
  const [runModal, setRunModal] = useState({ open: false, row: null, periodKey: "", amount: "", note: "" });
  const [expandedId, setExpandedId] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkRunning, setBulkRunning] = useState(false);

  useEffect(() => {
    if (!currentCompany?._id) return;
    dispatch(getLandlords({ company: currentCompany._id }));
    dispatch(getProperties({ business: currentCompany._id }));
  }, [dispatch, currentCompany?._id]);

  const loadRows = async () => {
    if (!currentCompany?._id) return;
    setLoading(true);
    try {
      const data = await getLandlordStandingOrders({
        business: currentCompany._id,
        company: currentCompany._id,
        ...filters,
      });
      setRows(Array.isArray(data) ? data : []);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load standing orders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
  }, [currentCompany?._id, filters.search, filters.status, filters.landlordId]);

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => rows.some((row) => String(row._id) === String(id) && (row.eligiblePeriods || []).length > 0)));
  }, [rows]);

  const stats = useMemo(
    () => ({
      total: rows.length,
      active: rows.filter((row) => row.status === "active").length,
      processed: rows.reduce((sum, row) => sum + Number(row.totalProcessedAmount || 0), 0),
      pendingPeriods: rows.reduce((sum, row) => sum + Number(row.unprocessedPeriodsCount || 0), 0),
    }),
    [rows]
  );

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
      frequency: row.frequency === "annually" ? "yearly" : row.frequency || "monthly",
      startDate: row.startDate ? new Date(row.startDate).toISOString().split("T")[0] : todayIso(),
      endDate: row.endDate ? new Date(row.endDate).toISOString().split("T")[0] : "",
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

  const filteredProperties = useMemo(() => {
    if (!form.landlord) return activeProperties;
    const selectedLandlord = activeLandlords.find((item) => String(item._id) === String(form.landlord));
    return activeProperties.filter((property) =>
      propertyBelongsToLandlord(property, form.landlord, selectedLandlord?.landlordName)
    );
  }, [activeLandlords, activeProperties, form.landlord]);

  const handleSave = async () => {
    if (!form.landlord) return toast.warning("Landlord is required");
    if (!form.property) return toast.warning("Property is required");
    if (!form.title.trim()) return toast.warning("Standing order title is required");
    if (!Number(form.amount || 0) || Number(form.amount) <= 0) return toast.warning("Valid amount is required");
    setSaving(true);
    try {
      const payload = {
        ...form,
        amount: Number(form.amount),
        business: currentCompany?._id,
        company: currentCompany?._id,
      };
      const saved = editingId
        ? await updateLandlordStandingOrder(editingId, payload)
        : await createLandlordStandingOrder(payload);
      setRows((prev) => (editingId ? prev.map((row) => (row._id === editingId ? saved : row)) : [saved, ...prev]));
      setShowModal(false);
      setEditingId("");
      setForm(blankForm);
      toast.success(`Standing order ${editingId ? "updated" : "saved"}`);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to save standing order");
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (row, status) => {
    try {
      const saved = await updateLandlordStandingOrderStatus(row._id, {
        status,
        business: currentCompany?._id,
        company: currentCompany?._id,
      });
      setRows((prev) => prev.map((item) => (item._id === row._id ? saved : item)));
      toast.success(`Standing order marked ${status}`);
    } catch (error) {
      toast.error(error?.response?.data?.message || `Failed to mark standing order ${status}`);
    }
  };

  const openRunModal = (row) => {
    const firstPeriod = row?.eligiblePeriods?.[0] || null;
    if (!firstPeriod) {
      toast.info("No eligible period is available to run. Future periods and already processed periods are blocked.");
      return;
    }
    setRunModal({
      open: true,
      row,
      periodKey: firstPeriod.periodKey,
      amount: String(Number(row.amount || firstPeriod.scheduledAmount || 0)),
      note: row.narration || row.title || "",
    });
  };

  const selectedRunPeriod = useMemo(() => {
    if (!runModal?.row) return null;
    return (runModal.row.eligiblePeriods || []).find((item) => item.periodKey === runModal.periodKey) || null;
  }, [runModal]);

  const handleRun = async () => {
    if (!runModal?.row?._id || !runModal.periodKey) return toast.warning("Select a valid eligible period");
    try {
      const saved = await runLandlordStandingOrder(runModal.row._id, {
        business: currentCompany?._id,
        company: currentCompany?._id,
        periodKey: runModal.periodKey,
        amount: Number(runModal.amount || runModal.row.amount || 0),
        note: runModal.note,
      });
      setRows((prev) => prev.map((item) => (item._id === runModal.row._id ? saved : item)));
      setRunModal({ open: false, row: null, periodKey: "", amount: "", note: "" });
      toast.success("Standing order processed successfully");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to process standing order");
    }
  };



  const selectableRowIds = useMemo(
    () => rows.filter((row) => (row.eligiblePeriods || []).length > 0).map((row) => String(row._id)),
    [rows]
  );

  const allSelectableChecked =
    selectableRowIds.length > 0 && selectableRowIds.every((id) => selectedIds.includes(id));

  const toggleSelectAll = () => {
    if (allSelectableChecked) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds(selectableRowIds);
  };

  const toggleRowSelection = (rowId) => {
    const normalizedId = String(rowId || "");
    if (!normalizedId) return;
    setSelectedIds((prev) =>
      prev.includes(normalizedId) ? prev.filter((id) => id !== normalizedId) : [...prev, normalizedId]
    );
  };


  const handleRunSelected = async () => {
    if (!selectedIds.length) {
      toast.info("Select at least one eligible standing order first.");
      return;
    }

    const selectedRows = rows.filter((row) => selectedIds.includes(String(row._id)));
    const runnableRows = selectedRows.filter((row) => (row.eligiblePeriods || []).length > 0);
    if (!runnableRows.length) {
      toast.info("None of the selected standing orders has an eligible period to run.");
      return;
    }

    if (!window.confirm(`Run the next eligible period for ${runnableRows.length} selected standing order(s)?`)) {
      return;
    }

    setBulkRunning(true);
    let successCount = 0;
    let failureCount = 0;
    const updatedRows = new Map();

    for (const row of runnableRows) {
      const nextPeriod = row?.eligiblePeriods?.[0] || null;
      if (!nextPeriod?.periodKey) {
        failureCount += 1;
        continue;
      }

      try {
        const saved = await runLandlordStandingOrder(row._id, {
          business: currentCompany?._id,
          company: currentCompany?._id,
          periodKey: nextPeriod.periodKey,
          amount: Number(row.amount || 0),
          note: row.narration || row.title || "",
        });
        updatedRows.set(String(row._id), saved);
        successCount += 1;
      } catch (error) {
        failureCount += 1;
        toast.error(
          error?.response?.data?.message ||
            `Failed to process ${row.standingOrderNo || row.referenceNo || "a selected standing order"}`
        );
      }
    }

    if (updatedRows.size > 0) {
      setRows((prev) => prev.map((row) => updatedRows.get(String(row._id)) || row));
    }

    setSelectedIds([]);
    setBulkRunning(false);

    if (successCount > 0 && failureCount === 0) {
      toast.success(`Processed ${successCount} standing order period${successCount === 1 ? "" : "s"}.`);
      return;
    }

    if (successCount > 0 || failureCount > 0) {
      toast.info(`Bulk run complete. Success: ${successCount}. Failed: ${failureCount}.`);
    }
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete standing order ${row.standingOrderNo || row.referenceNo}?`)) return;
    try {
      await deleteLandlordStandingOrder(row._id, { business: currentCompany?._id, company: currentCompany?._id });
      setRows((prev) => prev.filter((item) => item._id !== row._id));
      toast.success("Standing order deleted");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to delete standing order");
    }
  };

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="mx-auto max-w-[96%] space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-[#0B3B2E]">Landlord Payments</p>
                <h1 className="mt-1 text-2xl font-black text-slate-900">Landlord Standing Orders</h1>
                <p className="mt-1 text-sm text-slate-500">
                  Standing orders now post as landlord statement deductions when processed. Future periods, duplicate runs, and closed statement periods are blocked.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleRunSelected}
                  disabled={bulkRunning || selectedIds.length === 0}
                  className="inline-flex items-center gap-2 rounded-xl border border-indigo-300 bg-indigo-50 px-4 py-3 text-sm font-black text-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <FaCheck /> {bulkRunning ? "Running..." : `Run Selected${selectedIds.length ? ` (${selectedIds.length})` : ""}`}
                </button>
                <button
                  onClick={openCreate}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#0B3B2E] px-4 py-3 text-sm font-black text-white hover:bg-[#0A3127]"
                >
                  <FaPlus /> Add Standing Order
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Orders</p><p className="mt-2 text-2xl font-black text-slate-900">{stats.total}</p></div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-600">Active</p><p className="mt-2 text-2xl font-black text-emerald-700">{stats.active}</p></div>
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">Processed Value</p><p className="mt-2 text-2xl font-black text-blue-700">{money(stats.processed)}</p></div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.18em] text-amber-600">Pending Eligible Periods</p><p className="mt-2 text-2xl font-black text-amber-700">{stats.pendingPeriods}</p></div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50">
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
                <div className="relative lg:col-span-2">
                  <FaSearch className="absolute left-3 top-3.5 text-slate-400" />
                  <input
                    value={filters.search}
                    onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                    placeholder="Search order number, title, narration"
                    className="w-full px-3 py-3 pl-10 border border-slate-300 rounded-md text-sm"
                  />
                </div>
                <div>
                  <select
                    value={filters.landlordId}
                    onChange={(e) => setFilters((prev) => ({ ...prev, landlordId: e.target.value }))}
                    className="w-full px-3 py-3 border border-slate-300 rounded-md text-sm"
                  >
                    <option value="all">All Landlords</option>
                    {activeLandlords.map((landlord) => (
                      <option key={landlord._id} value={landlord._id}>
                        {landlord.landlordName || `${landlord.firstName || ""} ${landlord.lastName || ""}`.trim()}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <select
                    value={filters.status}
                    onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
                    className="w-full px-3 py-3 border border-slate-300 rounded-md text-sm"
                  >
                    <option value="all">All Statuses</option>
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="stopped">Stopped</option>
                  </select>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={handleRunSelected}
                  disabled={bulkRunning || selectedIds.length === 0}
                  className="px-3 py-1.5 text-xs rounded-md bg-green-600 hover:bg-green-700 text-white font-semibold flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FaCheck /> {bulkRunning ? "Running..." : `Run Selected${selectedIds.length ? ` (${selectedIds.length})` : ""}`}
                </button>
                <button
                  onClick={openCreate}
                  className="px-3 py-1.5 text-xs rounded-md bg-[#0B3B2E] hover:bg-[#0A3127] text-white font-semibold flex items-center gap-2"
                >
                  <FaPlus /> Add Standing Order
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
                    <th className="px-3 py-2 text-left font-semibold">
                      <input
                        type="checkbox"
                        checked={allSelectableChecked}
                        onChange={toggleSelectAll}
                        disabled={selectableRowIds.length === 0}
                        className="h-4 w-4 rounded border-slate-300 text-[#0B3B2E] focus:ring-[#0B3B2E]"
                      />
                    </th>
                    <th className="px-3 py-2 text-left font-semibold">Order</th>
                    <th className="px-3 py-2 text-left font-semibold">Landlord / Property</th>
                    <th className="px-3 py-2 text-left font-semibold">Schedule</th>
                    <th className="px-3 py-2 text-right font-semibold">Amount</th>
                    <th className="px-3 py-2 text-left font-semibold">Status</th>
                    <th className="px-3 py-2 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {!loading && rows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500">No standing orders found.</td>
                    </tr>
                  )}
                  {rows.map((row, index) => {
                    const expanded = expandedId === row._id;
                    return (
                      <React.Fragment key={row._id}>
                        <tr className={`border-t border-slate-100 ${index % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}>
                          <td className="px-4 py-3 align-top">
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(String(row._id))}
                              onChange={() => toggleRowSelection(row._id)}
                              disabled={(row.eligiblePeriods || []).length === 0}
                              className="mt-1 h-4 w-4 rounded border-slate-300 text-[#0B3B2E] focus:ring-[#0B3B2E] disabled:cursor-not-allowed disabled:opacity-50"
                              title={(row.eligiblePeriods || []).length === 0 ? "No eligible period available" : "Select this standing order for bulk run"}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-black text-slate-900">{row.standingOrderNo || row.referenceNo}</div>
                            <div className="text-xs text-slate-500">{row.title}</div>
                            <button
                              type="button"
                              onClick={() => setExpandedId((prev) => (prev === row._id ? "" : row._id))}
                              className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-[#0B3B2E]"
                            >
                              <FaChevronDown className={`transition ${expanded ? "rotate-180" : ""}`} />
                              {expanded ? "Hide period schedule" : "View period schedule"}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            <div>{row.landlord?.landlordName || `${row.landlord?.firstName || ""} ${row.landlord?.lastName || ""}`.trim() || "Landlord"}</div>
                            <div className="text-xs text-slate-500">{row.property?.propertyName || row.property?.name || "No property"}</div>
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            <div className="font-semibold capitalize">{String(row.frequency || "monthly").replace(/_/g, " ")}</div>
                            <div className="text-xs text-slate-500">Next eligible: {row.nextEligiblePeriod?.periodLabel || "No open period"}</div>
                            <div className="text-xs text-slate-500">Processed {row.processedPeriodsCount || 0} • Pending {row.unprocessedPeriodsCount || 0}</div>
                          </td>
                          <td className="px-4 py-3 text-right font-black text-slate-900">{money(row.amount)}</td>
                          <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${statusPills[row.status] || statusPills.draft}`}>{row.status}</span></td>
                          <td className="px-4 py-3 text-right">
                            <div className="inline-flex flex-wrap justify-end gap-2">
                              <button onClick={() => openEdit(row)} className="inline-flex items-center gap-1 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700"><FaEdit /> Edit</button>
                              {row.status !== "active" && <button onClick={() => handleStatus(row, "active")} className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700"><FaPlay /> Activate</button>}
                              {row.status === "active" && <button onClick={() => handleStatus(row, "paused")} className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-black text-amber-700"><FaPause /> Pause</button>}
                              {row.status !== "stopped" && <button onClick={() => handleStatus(row, "stopped")} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-xs font-black text-slate-700"><FaStop /> Stop</button>}
                              <button onClick={() => openRunModal(row)} className="inline-flex items-center gap-1 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-700"><FaCalendarAlt /> Run</button>
                              <button onClick={() => handleDelete(row)} className="inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700"><FaTrash /> Delete</button>
                            </div>
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="border-t border-slate-100 bg-slate-50">
                            <td colSpan={7} className="px-4 py-4">
                              <div className="grid gap-4 lg:grid-cols-2">
                                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Eligible periods to run</p>
                                  <div className="mt-3 space-y-2">
                                    {(row.eligiblePeriods || []).length === 0 && <p className="text-sm text-slate-500">No eligible periods. Already processed periods, future periods, and closed statement periods are blocked.</p>}
                                    {(row.eligiblePeriods || []).map((item) => (
                                      <div key={item.periodKey} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-sm">
                                        <div>
                                          <div className="font-bold text-slate-800">{item.periodLabel}</div>
                                          <div className="text-xs text-slate-500">Due {formatDate(item.dueDate)}</div>
                                        </div>
                                        <button onClick={() => openRunModal({ ...row, eligiblePeriods: [item, ...(row.eligiblePeriods || []).filter((entry) => entry.periodKey !== item.periodKey)] })} className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-700">Run this period</button>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Processed periods</p>
                                  <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
                                    {(row.processedPeriods || []).length === 0 && <p className="text-sm text-slate-500">No processed periods yet.</p>}
                                    {(row.processedPeriods || []).map((item) => (
                                      <div key={item.referenceNo || item.periodKey} className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
                                        <div className="flex items-center justify-between gap-2">
                                          <div className="font-bold text-emerald-800">{item.periodLabel || item.periodKey}</div>
                                          <div className="font-black text-emerald-900">{money(item.amount)}</div>
                                        </div>
                                        <div className="mt-1 text-xs text-emerald-700">Processed {formatDate(item.runDate)} • Ref {item.referenceNo || "-"}</div>
                                      </div>
                                    ))}
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
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-100">Landlord Standing Order</p>
                <h3 className="text-xl font-black">{editingId ? "Edit Standing Order" : "Add Standing Order"}</h3>
              </div>
              <button onClick={() => setShowModal(false)} className="rounded-full border border-white/30 p-2 hover:bg-white/10"><FaTimes /></button>
            </div>
            <div className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-3">
              <label className="block"><span className="text-sm font-bold text-slate-700">Landlord</span><select value={form.landlord} onChange={(e) => setForm((prev) => ({ ...prev, landlord: e.target.value, property: "" }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"><option value="">Select landlord</option>{activeLandlords.map((landlord) => <option key={landlord._id} value={landlord._id}>{landlord.landlordName || `${landlord.firstName || ""} ${landlord.lastName || ""}`.trim()}</option>)}</select></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Property</span><select value={form.property} onChange={(e) => setForm((prev) => ({ ...prev, property: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"><option value="">Select property</option>{filteredProperties.map((property) => <option key={property._id} value={property._id}>{property.propertyCode ? `[${property.propertyCode}] ` : ""}{property.propertyName || property.name}</option>)}</select></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Amount</span><input type="number" value={form.amount} onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
              <label className="block xl:col-span-2"><span className="text-sm font-bold text-slate-700">Title</span><input value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Frequency</span><select value={form.frequency} onChange={(e) => setForm((prev) => ({ ...prev, frequency: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Start Date</span><input type="date" value={form.startDate} onChange={(e) => setForm((prev) => ({ ...prev, startDate: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">End Date</span><input type="date" value={form.endDate} onChange={(e) => setForm((prev) => ({ ...prev, endDate: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Payment Method</span><select value={form.paymentMethod} onChange={(e) => setForm((prev) => ({ ...prev, paymentMethod: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"><option value="bank_transfer">Bank Transfer</option><option value="mpesa">M-Pesa</option><option value="cheque">Cheque</option><option value="cash">Cash</option><option value="other">Other</option></select></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Initial Status</span><select value={form.status} onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"><option value="draft">Draft</option><option value="active">Active</option><option value="paused">Paused</option></select></label>
              <label className="block xl:col-span-3"><span className="text-sm font-bold text-slate-700">Narration</span><textarea rows={3} value={form.narration} onChange={(e) => setForm((prev) => ({ ...prev, narration: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <button onClick={() => setShowModal(false)} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-black text-slate-700">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-[#0B3B2E] px-4 py-3 text-sm font-black text-white disabled:opacity-60"><FaSave /> {saving ? "Saving..." : editingId ? "Update Order" : "Save Order"}</button>
            </div>
          </div>
        </div>
      )}

      {runModal.open && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/55 p-4">
          <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-indigo-600 px-6 py-4 text-white">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-100">Standing Order Run</p>
                <h3 className="text-xl font-black">Choose eligible period</h3>
              </div>
              <button onClick={() => setRunModal({ open: false, row: null, periodKey: "", amount: "", note: "" })} className="rounded-full border border-white/30 p-2 hover:bg-white/10"><FaTimes /></button>
            </div>
            <div className="space-y-4 p-6">
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-900">
                <div className="font-black">{runModal.row?.title}</div>
                <div className="mt-1">Only current or skipped eligible periods can be processed. Future periods and duplicate month/period runs are blocked by the backend.</div>
              </div>
              <label className="block">
                <span className="text-sm font-bold text-slate-700">Eligible period</span>
                <select value={runModal.periodKey} onChange={(e) => setRunModal((prev) => ({ ...prev, periodKey: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
                  {(runModal.row?.eligiblePeriods || []).map((item) => (
                    <option key={item.periodKey} value={item.periodKey}>{item.periodLabel} • Due {formatDate(item.dueDate)}</option>
                  ))}
                </select>
              </label>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-bold text-slate-700">Amount</span>
                  <input type="number" value={runModal.amount} onChange={(e) => setRunModal((prev) => ({ ...prev, amount: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
                </label>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  <div className="font-black text-slate-900">Selected period</div>
                  <div className="mt-2">{selectedRunPeriod?.periodLabel || "-"}</div>
                  <div className="text-xs text-slate-500">Statement window: {formatDate(selectedRunPeriod?.periodStart)} - {formatDate(selectedRunPeriod?.periodEnd)}</div>
                </div>
              </div>
              <label className="block">
                <span className="text-sm font-bold text-slate-700">Narration</span>
                <textarea rows={3} value={runModal.note} onChange={(e) => setRunModal((prev) => ({ ...prev, note: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
              </label>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <button onClick={() => setRunModal({ open: false, row: null, periodKey: "", amount: "", note: "" })} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-black text-slate-700">Cancel</button>
              <button onClick={handleRun} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-black text-white"><FaCheck /> Run selected period</button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default LandlordStandingOrders;
