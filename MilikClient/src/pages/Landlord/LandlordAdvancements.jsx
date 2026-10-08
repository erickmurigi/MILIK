
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useEntityCache } from "../../hooks/useEntityCache";
import useDebounce from "../../hooks/useDebounce";
import { useTabState } from "../../hooks/useTabState";
import {
  FaBook,
  FaCheck,
  FaChevronDown,
  FaClock,
  FaEdit,
  FaExclamationTriangle,
  FaMoneyBillWave,
  FaPaperPlane,
  FaPause,
  FaPlay,
  FaPlus,
  FaSave,
  FaSearch,
  FaTimes,
  FaTrash,
  FaUndo,
} from "react-icons/fa";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import JournalEntriesDrawer from "../../components/Accounting/JournalEntriesDrawer";
import AppSelect from "../../components/common/AppSelect";
import { useConfirm } from "../../context/ConfirmContext";
import { fmtDate } from "../../utils/dates";
import {
  cancelLandlordAdvancementRecovery,
  deleteLandlordAdvancement,
  getLandlordAdvancements,
  getLandlords,
  processLandlordAdvancementRecovery,
  updateLandlordAdvancementStatus,
} from "../../redux/apiCalls";
import { getProperties } from "../../redux/propertyRedux";
import { selectCurrentCompany, selectCurrentUser, selectAllLandlords, selectAllProperties } from "../../redux/selectors";
import { hasCompanyPermission } from "../../utils/permissions";

const todayIso = () => new Date().toISOString().split("T")[0];
const money = (value) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const formInputClass = "h-7 w-full border border-slate-300 bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";
const formLabelClass = "mb-1 block text-xs font-bold text-slate-900";
const FormSection = ({ title, children }) => (
  <div className="border border-slate-200 bg-white">
    <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5">
      <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-800">{title}</h3>
    </div>
    <div className="p-2.5">{children}</div>
  </div>
);


const defaultTitleForType = (advanceType) =>
  advanceType === "against_payable"
    ? "Landlord Advance - Early Payout"
    : "Landlord Advance - Recover from Next Statement";

const STATUS_STYLES = {
  draft: "bg-slate-100 text-slate-700",
  submitted: "bg-indigo-100 text-indigo-700",
  approved: "bg-blue-100 text-blue-700",
  disbursed: "bg-emerald-100 text-emerald-700",
  recovering: "bg-amber-100 text-amber-700",
  paused: "bg-yellow-100 text-yellow-800",
  cleared: "bg-teal-100 text-teal-700",
  cancelled: "bg-rose-100 text-rose-700",
  rejected: "bg-rose-100 text-rose-700",
  reversed: "bg-zinc-200 text-zinc-700",
};

import PaginationBar from "../../components/PaginationBar";
import MilikTable from "../../components/common/MilikTable";
import ListToolbar from "../../components/common/ListToolbar";


const TYPE_OPTIONS = [
  {
    value: "against_payable",
    label: "Advance against current payable",
    hint: "Early payout. This reduces what is currently payable to the landlord and is not recovered later.",
  },
  {
    value: "future_recoverable",
    label: "Future recoverable advance",
    hint: "Pay now and recover from upcoming landlord statement(s).",
  },
];

const statusLabel = (value) =>
  String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Draft";

// Module-scope — stable reference avoids busting AppSelect's internal useMemo every render
const STATUS_FILTER_OPTIONS = ["draft", "submitted", "approved", "disbursed", "recovering", "paused", "cleared", "cancelled", "rejected", "reversed"].map((s) => ({ value: s, label: statusLabel(s) }));

const rowTitle = (row) => row?.title || defaultTitleForType(row?.advanceType);

const LandlordAdvancements = () => {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const landlords = useSelector(selectAllLandlords);
  const { propertiesLoaded } = useEntityCache(currentCompany?._id);
  const properties = useSelector(selectAllProperties);

  const activeLandlords = useMemo(
    () => landlords.filter((item) => String(item?.status || "active").toLowerCase() !== "archived"),
    [landlords]
  );
  const activeProperties = useMemo(
    () => properties.filter((item) => String(item?.status || "active").toLowerCase() !== "archived"),
    [properties]
  );
  // Stable option arrays — avoids busting AppSelect's internal useMemo on every render
  const activeLandlordOptions = useMemo(
    () => activeLandlords.map((l) => ({ value: l._id, label: l.landlordName || l.firstName || l.email || "Landlord" })),
    [activeLandlords]
  );

  const [rows, setRows] = useState([]);
  const [serverTotal, setServerTotal] = useState(0);
  const [serverPages, setServerPages] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [glAdvancement, setGlAdvancement] = useState(null);
  const [currentPage, setCurrentPage] = useTabState("/landlords/advancement:currentPage", 1);
  const [filters, setFilters] = useTabState("/landlords/advancement:filters", { search: "", status: "all", landlordId: "all", advanceType: "all" });
  const setFilter = (key) => (e) => setFilters((prev) => ({ ...prev, [key]: e.target.value }));
  const debouncedSearch = useDebounce(filters.search, 400);

  const canWrite = hasCompanyPermission(currentUser, currentCompany, "landlordAdvancements", "create", "accounts");

  const [recoveryModal, setRecoveryModal] = useState({
    open: false,
    row: null,
    periodKey: "",
    amount: "",
    note: "",
  });

  useEffect(() => {
    if (!currentCompany?._id) return;
    if (!landlords?.length) dispatch(getLandlords({ company: currentCompany._id }));
    if (!propertiesLoaded) dispatch(getProperties({ business: currentCompany._id }));
  }, [dispatch, currentCompany?._id, landlords?.length, propertiesLoaded]);

  const loadRows = useCallback(async () => {
    if (!currentCompany?._id) return;
    setLoading(true);
    try {
      const result = await getLandlordAdvancements({
        business: currentCompany._id,
        company: currentCompany._id,
        status: filters.status,
        landlordId: filters.landlordId,
        advanceType: filters.advanceType,
        search: debouncedSearch,
        page: currentPage,
        limit: pageSize,
      });
      setRows(Array.isArray(result.data) ? result.data : []);
      setServerTotal(result.total ?? 0);
      setServerPages(result.pages ?? 1);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load landlord advances");
    } finally {
      setLoading(false);
    }
  }, [currentCompany?._id, debouncedSearch, filters.status, filters.landlordId, filters.advanceType, currentPage, pageSize]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const safeCurrentPage = Math.min(currentPage, serverPages);

  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, filters.status, filters.landlordId, filters.advanceType]);

  const selectedRecoveryPeriod = useMemo(() => {
    const periods = recoveryModal.row?.eligibleRecoveryPeriods || [];
    return periods.find((item) => item.periodKey === recoveryModal.periodKey) || periods[0] || null;
  }, [recoveryModal.row, recoveryModal.periodKey]);

  const openCreate = () => {
    if (!canWrite) { toast.warning("You don't have permission to create landlord advancements"); return; }
    navigate("/landlords/advancement/new");
  };

  const openEdit = (row) => {
    if (!canWrite) { toast.warning("You don't have permission to edit landlord advancements"); return; }
    navigate(`/landlords/advancement/${row._id}/edit`);
  };

  const submitAction = async (fn) => {
    setSaving(true);
    try {
      await fn();
      await loadRows();
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (row, status, successMessage = "") => {
    await submitAction(async () => {
      try {
        await updateLandlordAdvancementStatus(row._id, {
          business: currentCompany?._id,
          company: currentCompany?._id,
          status,
        });
        toast.success(successMessage || `Landlord advance marked ${statusLabel(status).toLowerCase()}`);
      } catch (error) {
        toast.error(error?.response?.data?.message || `Failed to ${statusLabel(status).toLowerCase()} landlord advance`);
      }
    });
  };

  const handleDelete = async (row) => {
    if (!canWrite) { toast.warning("You don't have permission to delete landlord advancements"); return; }
    if (!await confirm({ title: "Delete Advance", message: `Delete ${row.referenceNo || "this landlord advance"}?`, confirmText: "Delete", isDangerous: true })) return;
    await submitAction(async () => {
      try {
        await deleteLandlordAdvancement(row._id, { business: currentCompany?._id, company: currentCompany?._id });
        toast.success("Landlord advance deleted");
      } catch (error) {
        toast.error(error?.response?.data?.message || "Failed to delete landlord advance");
      }
    });
  };

  // Default narration names the reference and the period being recovered (e.g. "Recovery
  // of landlord advance LADV0001 for Oct 2026") so the GL/statement trail reads cleanly
  // without the preparer having to type it out every time.
  const buildRecoveryNarration = (row, period) =>
    period ? `Recovery of landlord advance ${row?.referenceNo || ""} for ${period.periodLabel}`.replace(/\s+/g, " ").trim() : "";

  const openRecoveryModal = (row) => {
    const firstPeriod = row?.eligibleRecoveryPeriods?.[0] || null;
    setRecoveryModal({
      open: true,
      row,
      periodKey: firstPeriod?.periodKey || "",
      amount: firstPeriod?.scheduledAmount ? String(firstPeriod.scheduledAmount) : "",
      note: buildRecoveryNarration(row, firstPeriod),
    });
  };

  const closeRecoveryModal = () => {
    setRecoveryModal({ open: false, row: null, periodKey: "", amount: "", note: "" });
  };

  const handleProcessRecovery = async () => {
    if (!recoveryModal.row?._id) return;
    if (!selectedRecoveryPeriod?.periodKey) return toast.warning("Select the recovery period");
    if (!Number(recoveryModal.amount || 0) || Number(recoveryModal.amount) <= 0) {
      return toast.warning("Enter a valid recovery amount");
    }

    await submitAction(async () => {
      try {
        await processLandlordAdvancementRecovery(recoveryModal.row._id, {
          business: currentCompany?._id,
          company: currentCompany?._id,
          periodKey: selectedRecoveryPeriod.periodKey,
          amount: Number(recoveryModal.amount),
          note: recoveryModal.note?.trim() || "",
        });
        toast.success("Recoverable advance applied to statement");
        closeRecoveryModal();
      } catch (error) {
        toast.error(error?.response?.data?.message || "Failed to process advance recovery");
      }
    });
  };

  const handleCancelRecovery = async (row, recoveryId) => {
    if (!await confirm({ title: "Cancel Recovery", message: "Cancel this processed recovery? This action cannot be undone.", confirmText: "Cancel Recovery", isDangerous: true })) return;
    await submitAction(async () => {
      try {
        await cancelLandlordAdvancementRecovery(row._id, recoveryId, {
          business: currentCompany?._id,
          company: currentCompany?._id,
        });
        toast.success("Recovery cancelled");
      } catch (error) {
        toast.error(error?.response?.data?.message || "Failed to cancel recovery");
      }
    });
  };

  const ACTION_BTN = "inline-flex h-6 items-center gap-1 border border-slate-300 bg-white px-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50";
  const ACTION_BTN_DANGER = "inline-flex h-6 items-center gap-1 border border-red-300 bg-white px-2 text-[11px] font-bold text-red-600 hover:bg-red-50";

  const renderActions = (row) => {
    const actions = [];

    if (["draft", "rejected"].includes(row.status)) {
      actions.push(
        <button key="submit" onClick={() => handleStatus(row, "submitted", "Landlord advance submitted")} className={ACTION_BTN}>
          <FaPaperPlane size={10} /> Submit
        </button>
      );
      actions.push(
        <button key="approve" onClick={() => handleStatus(row, "approved", "Landlord advance approved")} className={ACTION_BTN}>
          <FaCheck size={10} /> Approve
        </button>
      );
    }

    if (["submitted", "approved", "draft"].includes(row.status)) {
      actions.push(
        <button key="disburse" onClick={() => handleStatus(row, "disbursed", "Landlord advance disbursed")} className={ACTION_BTN}>
          <FaMoneyBillWave size={10} /> Disburse
        </button>
      );
    }

    if (row.advanceType === "future_recoverable" && ["recovering", "disbursed", "paused"].includes(row.status) && (row.eligibleRecoveryPeriods || []).length > 0) {
      actions.push(
        <button key="recover" onClick={() => openRecoveryModal(row)} className={ACTION_BTN}>
          <FaClock size={10} /> Recover now
        </button>
      );
    }

    if (row.advanceType === "future_recoverable" && row.status === "recovering") {
      actions.push(
        <button key="pause" onClick={() => handleStatus(row, "paused", "Recoverable advance paused")} className={ACTION_BTN}>
          <FaPause size={10} /> Pause
        </button>
      );
    }

    if (row.advanceType === "future_recoverable" && row.status === "paused") {
      actions.push(
        <button key="resume" onClick={() => handleStatus(row, "recovering", "Recoverable advance resumed")} className={ACTION_BTN}>
          <FaPlay size={10} /> Resume
        </button>
      );
    }

    if (!["reversed", "cancelled", "cleared"].includes(row.status) && row.disbursedAt) {
      actions.push(
        <button key="reverse" onClick={() => handleStatus(row, "reversed", "Landlord advance reversed")} className={ACTION_BTN_DANGER}>
          <FaUndo size={10} /> Reverse
        </button>
      );
    }

    if (!row.disbursedAt && !["cancelled", "rejected", "submitted", "approved", "reversed"].includes(row.status)) {
      actions.push(
        <button key="cancel" onClick={() => handleStatus(row, "cancelled", "Landlord advance cancelled")} className={ACTION_BTN_DANGER}>
          <FaTimes size={10} /> Cancel
        </button>
      );
    }

    if (!row.disbursedAt && !["cancelled", "reversed"].includes(row.status) && canWrite) {
      actions.push(
        <button key="edit" onClick={() => openEdit(row)} className={ACTION_BTN}>
          <FaEdit size={10} /> Edit
        </button>
      );
    }

    if (!row.disbursedAt && canWrite) {
      actions.push(
        <button key="delete" onClick={() => handleDelete(row)} className={ACTION_BTN_DANGER}>
          <FaTrash size={10} /> Delete
        </button>
      );
    }

    actions.push(
      <button key="gl" onClick={() => setGlAdvancement(row)} className={ACTION_BTN} title="View GL Entries">
        <FaBook size={10} /> GL
      </button>
    );

    return actions;
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 p-2">
        <div className="mx-auto flex w-full max-w-full min-h-0 flex-1 flex-col gap-2">
        <ListToolbar>
          <div className="relative shrink-0">
            <FaSearch className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[8px] text-slate-400" />
            <ListToolbar.Input value={filters.search} onChange={setFilter("search")} placeholder="Reference, title…" width="w-32" className="pl-5" />
          </div>
          <AppSelect
            value={filters.status}
            onChange={(v) => setFilters((prev) => ({ ...prev, status: v ?? "all" }))}
            options={STATUS_FILTER_OPTIONS}
            placeholder="All statuses"
            searchable
            clearable
            compact
          />
          <AppSelect
            value={filters.landlordId}
            onChange={(v) => setFilters((prev) => ({ ...prev, landlordId: v ?? "all" }))}
            options={activeLandlordOptions}
            placeholder="All landlords"
            searchable
            clearable
            compact
          />
          <AppSelect
            value={filters.advanceType}
            onChange={(v) => setFilters((prev) => ({ ...prev, advanceType: v ?? "all" }))}
            options={TYPE_OPTIONS}
            placeholder="All types"
            clearable
            compact
          />
          <ListToolbar.Divider />
          <ListToolbar.Button icon={FaPlus} disabled={!canWrite} onClick={openCreate}>New Advance</ListToolbar.Button>
        </ListToolbar>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden  border border-slate-200 bg-white shadow-sm">
          <MilikTable
            columns={[
              { label: "Reference" },
              { label: "Landlord / Property" },
              { label: "Type" },
              { label: "Amount", align: "right" },
              { label: "Date" },
              { label: "Status" },
            ]}
            rows={rows}
            rowKey="_id"
            loading={loading && rows.length === 0}
            empty="No landlord advances found."
            renderExpanded={(row) => {
              if (row.advanceType !== "future_recoverable") {
                return (
                  <div className="border border-slate-200 bg-white">
                    <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5">
                      <p className="text-[11px] font-black uppercase tracking-wide text-slate-700">Early Payout Details</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 p-2.5 text-[11px] md:grid-cols-4">
                      <div><span className="font-bold text-slate-900">Cashbook:</span> <span className="text-slate-600">{row?.cashbook?.name || row?.cashbook?.accountName || "System default"}</span></div>
                      <div><span className="font-bold text-slate-900">Already paid:</span> <span className="text-slate-600">{money(row.alreadyPaidToLandlord)}</span></div>
                      <div><span className="font-bold text-slate-900">Narration:</span> <span className="text-slate-600">{row.narration || "—"}</span></div>
                      <div><span className="font-bold text-slate-900">Notes:</span> <span className="text-slate-600">{row.notes || "—"}</span></div>
                    </div>
                  </div>
                );
              }

              const scheduleRows = row.amortizationSchedule || [];
              return (
                <div className="border border-slate-200 bg-white">
                  <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5">
                    <p className="text-[11px] font-black uppercase tracking-wide text-slate-700">
                      {statusLabel(row.frequency)} Recovery Schedule · {fmtDate(row.computedRecoveryStartDate)} – {fmtDate(row.computedRecoveryEndDate)}
                    </p>
                  </div>
                  {scheduleRows.length === 0 ? (
                    <p className="px-3 py-2.5 text-xs text-slate-500">No scheduled periods.</p>
                  ) : (
                    <div className="max-h-80 overflow-y-auto">
                      <table className="w-full text-[11px]">
                        <thead className="sticky top-0">
                          <tr className="border-b border-slate-200 bg-slate-50">
                            <th className="px-3 py-1 text-left font-bold uppercase tracking-wide text-slate-500">Period</th>
                            <th className="px-3 py-1 text-left font-bold uppercase tracking-wide text-slate-500">Due</th>
                            <th className="px-3 py-1 text-right font-bold uppercase tracking-wide text-slate-500">Amount</th>
                            <th className="px-3 py-1 text-center font-bold uppercase tracking-wide text-slate-500">Status</th>
                            <th className="px-3 py-1 text-right font-bold uppercase tracking-wide text-slate-500">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {scheduleRows.map((item) => {
                            const statusTxt = item.processed ? "Recovered" : item.isEligible ? "Due" : "Upcoming";
                            const statusCls = item.processed
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : item.isEligible
                              ? "border-amber-200 bg-amber-50 text-amber-700"
                              : "border-slate-200 bg-slate-50 text-slate-400";
                            return (
                              <tr key={item.periodKey} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                                <td className="px-3 py-1.5 font-semibold text-slate-900 border-r border-gray-100">{item.periodLabel}</td>
                                <td className="px-3 py-1.5 text-slate-600 border-r border-gray-100">{fmtDate(item.dueDate)}</td>
                                <td className="px-3 py-1.5 text-right font-bold tabular-nums border-r border-gray-100 text-slate-900">
                                  {money(item.processed ? item.processedAmount : item.scheduledAmount)}
                                </td>
                                <td className="px-3 py-1.5 text-center border-r border-gray-100">
                                  <span className={`inline-flex border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${statusCls}`}>{statusTxt}</span>
                                </td>
                                <td className="px-3 py-1.5 text-right">
                                  {item.processed ? (
                                    <button
                                      onClick={() => handleCancelRecovery(row, item.recoveryId)}
                                      className="inline-flex h-6 items-center gap-1 border border-red-300 bg-white px-2 text-[11px] font-bold text-red-600 hover:bg-red-50"
                                    >
                                      <FaUndo size={9} /> Cancel
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() =>
                                        item.isEligible &&
                                        openRecoveryModal({
                                          ...row,
                                          eligibleRecoveryPeriods: [item, ...(row.eligibleRecoveryPeriods || []).filter((entry) => entry.periodKey !== item.periodKey)],
                                        })
                                      }
                                      disabled={!item.isEligible}
                                      title={!item.isEligible ? "Not yet due" : undefined}
                                      className="inline-flex h-6 items-center gap-1 border border-slate-300 bg-white px-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
                                    >
                                      <FaClock size={9} /> Recover
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            }}
            renderRow={(row) => {
              const landlordLabel = row?.landlord?.landlordName || [row?.landlord?.firstName, row?.landlord?.lastName].filter(Boolean).join(" ") || row?.landlord?.email || "Landlord";
              const propertyLabel = row?.property?.propertyName || row?.property?.name || row?.property?.propertyCode || "Property";
              return (
                <>
                  <td className="px-3 py-1.5 border-r border-gray-100 font-black text-slate-900 whitespace-nowrap">{row.referenceNo}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 overflow-hidden">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="shrink-0 font-semibold text-slate-900 truncate max-w-[60%]">{landlordLabel}</span>
                      <span className="min-w-0 truncate text-[10px] text-slate-500">{propertyLabel}</span>
                    </div>
                  </td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-slate-700 overflow-hidden"><span className="truncate block">{TYPE_OPTIONS.find((item) => item.value === row.advanceType)?.label || statusLabel(row.advanceType)}</span></td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-right font-black text-slate-900 whitespace-nowrap">{money(row.amount)}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-slate-700 whitespace-nowrap">{fmtDate(row.disbursementDate)}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100"><span className={`inline-flex px-2 py-0.5 text-[10px] font-bold border ${STATUS_STYLES[row.status] || STATUS_STYLES.draft}`}>{statusLabel(row.status)}</span></td>
                </>
              );
            }}
            renderActions={(row) => (
              <div className="inline-flex flex-wrap justify-end gap-1">{renderActions(row)}</div>
            )}
          />
          <PaginationBar
            page={safeCurrentPage}
            pages={serverPages}
            total={serverTotal}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            onPageSizeChange={(n) => { setPageSize(n); setCurrentPage(1); }}
            loading={loading}
            label="advances"
          />
        </div>
      </div>
      </div>

      {recoveryModal.open && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/45 p-4">
          <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-[#0B3B2E] px-4 py-3 text-white">
              <h2 className="text-sm font-black uppercase tracking-wide">Apply Recovery</h2>
              <button onClick={closeRecoveryModal} className="text-white/70 transition-colors hover:text-white">
                <FaTimes size={14} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-white px-5 py-4">
              <FormSection title={rowTitle(recoveryModal.row)}>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                  <div className="col-span-2">
                    <label className={formLabelClass}>Eligible statement period</label>
                    <AppSelect
                      value={recoveryModal.periodKey || null}
                      onChange={(v) => {
                        const periods = recoveryModal.row?.eligibleRecoveryPeriods || [];
                        const selected = periods.find((item) => item.periodKey === v);
                        setRecoveryModal((prev) => {
                          const previouslySelected = periods.find((item) => item.periodKey === prev.periodKey);
                          const noteIsStillDefault = prev.note === buildRecoveryNarration(prev.row, previouslySelected);
                          return {
                            ...prev,
                            periodKey: v ?? "",
                            amount: selected?.scheduledAmount ? String(selected.scheduledAmount) : prev.amount,
                            note: noteIsStillDefault ? buildRecoveryNarration(prev.row, selected) : prev.note,
                          };
                        });
                      }}
                      options={(recoveryModal.row?.eligibleRecoveryPeriods || []).map((item) => ({
                        value: item.periodKey,
                        label: `${item.periodLabel} · Scheduled ${money(item.scheduledAmount)}`,
                      }))}
                      size="md"
                    />
                    {selectedRecoveryPeriod && (
                      <p className="mt-1 text-[10px] text-slate-500">
                        Window: {fmtDate(selectedRecoveryPeriod.periodStart)} – {fmtDate(selectedRecoveryPeriod.periodEnd)} · Outstanding: {money(recoveryModal.row?.outstandingRecoverableAmount)}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className={formLabelClass}>Recovery amount</label>
                    <input
                      type="number"
                      value={recoveryModal.amount}
                      onChange={(e) => setRecoveryModal((prev) => ({ ...prev, amount: e.target.value }))}
                      className={formInputClass}
                    />
                  </div>

                  <div className="col-span-2">
                    <label className={formLabelClass}>Narration <span className="font-normal text-slate-400">(optional)</span></label>
                    <textarea
                      rows={2}
                      value={recoveryModal.note}
                      onChange={(e) => setRecoveryModal((prev) => ({ ...prev, note: e.target.value }))}
                      className="w-full resize-none border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                    />
                  </div>
                </div>
              </FormSection>

              <p className="mt-2 text-[10px] text-slate-400">
                Recoveries post separately on the landlord statement and reduce the outstanding recoverable advance balance.
              </p>
            </div>

            <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <button onClick={closeRecoveryModal} className="h-8 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button
                onClick={handleProcessRecovery}
                disabled={saving}
                className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60"
              >
                <FaCheck size={11} /> {saving ? "Processing…" : "Post Recovery"}
              </button>
            </div>
          </div>
        </div>
      )}
      <JournalEntriesDrawer
        open={!!glAdvancement}
        onClose={() => setGlAdvancement(null)}
        title="Landlord Advancement"
        transactionRef={glAdvancement?.referenceNo}
        date={glAdvancement ? new Date(glAdvancement.disbursementDate || glAdvancement.createdAt).toLocaleDateString("en-GB") : ""}
        amount={glAdvancement?.amount}
        status={glAdvancement?.status}
        statusColors={
          glAdvancement?.status === "disbursed" || glAdvancement?.status === "recovering" ? "bg-emerald-100 text-emerald-700 border-emerald-200"
          : glAdvancement?.status === "reversed" ? "bg-amber-100 text-amber-700 border-amber-200"
          : "bg-slate-100 text-slate-700 border-slate-200"
        }
        contextFields={glAdvancement ? [
          { label: "Landlord", value: glAdvancement.landlord?.landlordName || [glAdvancement.landlord?.firstName, glAdvancement.landlord?.lastName].filter(Boolean).join(" ") },
          { label: "Property", value: glAdvancement.property?.propertyName || glAdvancement.property?.name },
          { label: "Type", value: TYPE_OPTIONS.find((o) => o.value === glAdvancement.advanceType)?.label || glAdvancement.advanceType },
          { label: "Narration", value: glAdvancement.narration },
        ].filter((f) => f.value) : []}
        businessId={currentCompany?._id}
        sourceType="advance"
        sourceId={glAdvancement?._id}
        scheduleTitle="Recovery Schedule"
        scheduleColumns={[
          { key: "periodLabel", label: "Period", bold: true },
          { key: "amount",         label: "Amount (KES)",    align: "right" },
          { key: "principalAmount",label: "Principal (KES)", align: "right" },
          { key: "interestAmount", label: "Interest (KES)",  align: "right" },
          { key: "referenceNo",    label: "Ref #" },
          { key: "_status",        label: "Status", align: "center" },
        ]}
        schedule={(glAdvancement?.recoveryHistory || []).map((r) => ({
          ...r,
          amount:          Number(r.amount || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          principalAmount: Number(r.principalAmount || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          interestAmount:  Number(r.interestAmount || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          _status: r.cancelledAt ? "Cancelled" : r.processedAt ? "Processed" : "Pending",
          _rowClass: r.cancelledAt ? "opacity-50 line-through" : r.processedAt ? "text-emerald-700" : "",
        }))}
        scheduleSummary={glAdvancement ? [
          { label: "Advanced",    value: `KES ${Number(glAdvancement.amount || 0).toLocaleString()}`, color: "blue" },
          { label: "Recovered",   value: `KES ${Number(glAdvancement.totalRecoveredAmount || 0).toLocaleString()}`, color: "emerald" },
          { label: "Outstanding", value: `KES ${Number(glAdvancement.outstandingRecoverableAmount || 0).toLocaleString()}`, color: "amber" },
        ] : []}
      />

    </DashboardLayout>
  );
};

export default LandlordAdvancements;
