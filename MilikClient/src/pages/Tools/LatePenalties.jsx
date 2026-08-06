import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useConfirm } from "../../context/ConfirmContext";
import {
  FaBolt,
  FaCalendarAlt,
  FaCheckSquare,
  FaEnvelope,
  FaExclamationTriangle,
  FaEye,
  FaHistory,
  FaPen,
  FaPlus,
  FaSave,
  FaSms,
  FaTimes,
  FaTrash,
} from "react-icons/fa";
import { useSelector } from "react-redux";
import { selectCurrentCompany } from "../../redux/selectors";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import AppSelect from "../../components/common/AppSelect";
import CommunicationComposerModal from "../../components/Communications/CommunicationComposerModal";
import {
  createLatePenaltyRule,
  deleteLatePenalty,
  deleteLatePenaltyBatch,
  getLatePenaltyBatch,
  getLatePenaltyBatches,
  getLatePenaltyPostingAccounts,
  getLatePenaltyRules,
  previewLatePenalties,
  processLatePenalties,
  reverseLatePenalty,
  updateLatePenaltyRule,
} from "../../redux/apiCalls";

const MILIK_GREEN = "#0B3B2E";
const pageShellClass =
  "overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm";
const pillTabClass = (active, tone = "green") => {
  if (active && tone === "orange") return "border-orange-300 bg-orange-50 text-orange-700";
  if (active && tone === "slate") return "border-slate-400 bg-slate-100 text-slate-800";
  return active
    ? "border-[#0B3B2E] bg-[#E7F5EC] text-[#0B3B2E]"
    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50";
};
const inputClass =
  "h-8 w-full border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 shadow-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/10";
const labelClass = "mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500";
const ITEMS_PER_PAGE = 50;

const getErrorMessage = (error, fallback) =>
  error?.response?.data?.message || error?.message || fallback;

const defaultRuleForm = {
  ruleName: "",
  effectiveFrom: new Date().toISOString().slice(0, 10),
  active: true,
  postingAccount: "",
  graceDays: 0,
  minimumOverdueDays: 1,
  penalizeItem: "outstanding_invoice_balance",
  calculationType: "percentage_overdue_balance",
  rateOrAmount: 5,
  minimumBalance: 0,
  maximumBalance: 0,
  maximumPenaltyCap: 0,
  applyAutomatically: false,
  repeatFrequency: "manual",
  notes: "",
};

const formatCurrency = (value) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 2,
  }).format(Number(value || 0));

const formatDate = (value) => {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleDateString();
};

const mapRuleToForm = (rule) => ({
  ruleName: rule?.ruleName || "",
  effectiveFrom: rule?.effectiveFrom ? new Date(rule.effectiveFrom).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
  active: rule?.active !== false,
  postingAccount: rule?.postingAccount?._id || rule?.postingAccount || "",
  graceDays: Number(rule?.graceDays || 0),
  minimumOverdueDays: Number(rule?.minimumOverdueDays || 0),
  penalizeItem: rule?.penalizeItem || "outstanding_invoice_balance",
  calculationType: rule?.calculationType || "percentage_overdue_balance",
  rateOrAmount: Number(rule?.rateOrAmount || 0),
  minimumBalance: Number(rule?.minimumBalance || 0),
  maximumBalance: Number(rule?.maximumBalance || 0),
  maximumPenaltyCap: Number(rule?.maximumPenaltyCap || 0),
  applyAutomatically: false,
  repeatFrequency: rule?.repeatFrequency || "manual",
  notes: rule?.notes || "",
});

const statusBadgeClass = (status = "") => {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "processed") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (normalized === "reversed") return "bg-amber-50 text-amber-700 border-amber-200";
  if (normalized === "deleted") return "bg-rose-50 text-rose-700 border-rose-200";
  if (normalized === "failed") return "bg-rose-50 text-rose-700 border-rose-200";
  if (normalized === "partial") return "bg-orange-50 text-orange-700 border-orange-200";
  if (normalized === "reversed_ready") return "bg-blue-50 text-blue-700 border-blue-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
};

const batchDeleteSummary = (batch) => {
  const blockers = Array.isArray(batch?.deleteBlockers) ? batch.deleteBlockers : [];
  if (!blockers.length) return "";
  const first = blockers[0];
  if (!first?.invoiceNumber) return "Active penalty invoices still exist in this batch.";
  return blockers.length === 1
    ? `Active penalty invoice still exists: ${first.invoiceNumber}.`
    : `Active penalty invoices still exist, starting with ${first.invoiceNumber}.`;
};

const LatePenalties = () => {
  const confirm = useConfirm();
  const currentCompany = useSelector(selectCurrentCompany);
  const businessId = currentCompany?._id || "";

  const [accounts, setAccounts] = useState([]);
  const [rules, setRules] = useState([]);
  const [batches, setBatches] = useState([]);
  const [selectedRuleId, setSelectedRuleId] = useTabState("/invoices/late-penalties:selectedRuleId", "");
  const [ruleForm, setRuleForm] = useState(defaultRuleForm);
  const [editingRuleId, setEditingRuleId] = useState("");
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [runDate, setRunDate] = useState(new Date().toISOString().slice(0, 10));
  const [preview, setPreview] = useState(null);
  const [selectedRows, setSelectedRows] = useState({});
  const [loading, setLoading] = useState(false);
  const [savingRule, setSavingRule] = useState(false);
  const [batchDetail, setBatchDetail] = useState(null);
  const [workspaceView, setWorkspaceView] = useTabState("/invoices/late-penalties:workspaceView", "processed_penalties");
  const [communicationModal, setCommunicationModal] = useState(null);
  const [selectedBatchRows, setSelectedBatchRows] = useState({});
  const [processingBatchAction, setProcessingBatchAction] = useState(false);
  const [penaltySearch, setPenaltySearch] = useTabState("/invoices/late-penalties:penaltySearch", "");
  const [penaltyStatusFilter, setPenaltyStatusFilter] = useTabState("/invoices/late-penalties:penaltyStatusFilter", "all");
  const [penaltyRuleFilter, setPenaltyRuleFilter] = useTabState("/invoices/late-penalties:penaltyRuleFilter", "all");
  const [penaltyPropertyFilter, setPenaltyPropertyFilter] = useTabState("/invoices/late-penalties:penaltyPropertyFilter", "all");
  const [batchSearch, setBatchSearch] = useTabState("/invoices/late-penalties:batchSearch", "");
  const [batchStatusFilter, setBatchStatusFilter] = useTabState("/invoices/late-penalties:batchStatusFilter", "all");
  const [processedPenaltyPage, setProcessedPenaltyPage] = useTabState("/invoices/late-penalties:processedPenaltyPage", 1);
  const [processedBatchPage, setProcessedBatchPage] = useTabState("/invoices/late-penalties:processedBatchPage", 1);

  const incomeAccounts = useMemo(
    () => (Array.isArray(accounts) ? accounts.filter((account) => String(account?.type || "").toLowerCase() === "income") : []),
    [accounts]
  );

  const selectedRule = useMemo(
    () => rules.find((rule) => String(rule._id) === String(selectedRuleId)) || null,
    [rules, selectedRuleId]
  );

  const loadRules = useCallback(
    async (preferredRuleId = "") => {
      if (!businessId) {
        setRules([]);
        return [];
      }

      const res = await getLatePenaltyRules(businessId);
      const rows = Array.isArray(res?.rules) ? res.rules : [];
      setRules(rows);

      const preferred = preferredRuleId || selectedRuleId;
      if (preferred && rows.some((rule) => String(rule._id) === String(preferred))) {
        setSelectedRuleId(preferred);
      } else if (rows[0]?._id) {
        setSelectedRuleId(rows[0]._id);
      } else {
        setSelectedRuleId("");
      }

      return rows;
    },
    [businessId, selectedRuleId]
  );

  const loadBatches = useCallback(async () => {
    if (!businessId) {
      setBatches([]);
      return [];
    }
    const res = await getLatePenaltyBatches(businessId);
    const rows = Array.isArray(res?.batches) ? res.batches : [];
    setBatches(rows);
    return rows;
  }, [businessId]);

  const loadAccounts = useCallback(async () => {
    if (!businessId) {
      setAccounts([]);
      return;
    }

    const res = await getLatePenaltyPostingAccounts(businessId);
    const rows = Array.isArray(res) ? res : Array.isArray(res?.accounts) ? res.accounts : [];
    setAccounts(rows);
  }, [businessId]);

  useEffect(() => {
    loadRules().catch((error) => toast.error(getErrorMessage(error, "Failed to load late penalty rules.")));
    loadBatches().catch((error) => toast.error(getErrorMessage(error, "Failed to load late penalty batches.")));
    loadAccounts().catch((error) => toast.error(getErrorMessage(error, "Failed to load late penalty posting accounts.")));
  }, [loadRules, loadBatches, loadAccounts]);

  useEffect(() => {
    if (!selectedRuleId) return;
    const selected = rules.find((rule) => String(rule._id) === String(selectedRuleId));
    if (selected) {
      setRuleForm(mapRuleToForm(selected));
      setEditingRuleId(selected._id);
    }
  }, [selectedRuleId, rules]);

  useEffect(() => {
    if (!showRuleModal) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !savingRule) setShowRuleModal(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showRuleModal, savingRule]);

  const processedPenaltyRows = useMemo(() => {
    const rows = [];
    batches.forEach((batch) => {
      (Array.isArray(batch?.items) ? batch.items : []).forEach((item) => {
        const normalizedStatus = String(item?.status || "").toLowerCase();
        const include =
          Boolean(item?.penaltyInvoice?._id || item?.penaltyInvoice) ||
          normalizedStatus === "processed" ||
          normalizedStatus === "reversed" ||
          normalizedStatus === "deleted";

        if (!include) return;

        rows.push({
          ...item,
          batchId: batch._id,
          batchName: batch.batchName || "Late Penalty Batch",
          batchStatus: batch.status || "processed",
          batchRunDate: batch.runDate,
          ruleName: batch.ruleName || batch.rule?.ruleName || "-",
          penaltyInvoiceNumber: item?.penaltyInvoice?.invoiceNumber || item?.penaltyInvoiceNumber || "-",
          sourceInvoiceNumber: item?.sourceInvoiceNumber || item?.sourceInvoice?.invoiceNumber || "-",
          tenantName: item?.tenant?.name || item?.tenantName || "-",
          tenantCode: item?.tenant?.tenantCode || "",
          propertyName: item?.property?.propertyName || item?.propertyName || "-",
          unitNumber: item?.unit?.unitNumber || item?.unitNumber || "-",
          displayStatus: item?.isDeleted ? "deleted" : item?.reversedAt ? "reversed" : normalizedStatus || "processed",
        });
      });
    });

    return rows.sort((a, b) => new Date(b.batchRunDate || 0).getTime() - new Date(a.batchRunDate || 0).getTime());
  }, [batches]);

  const processedPenaltyRuleOptions = useMemo(
    () => Array.from(new Set(processedPenaltyRows.map((row) => String(row?.ruleName || "").trim()).filter(Boolean))).sort(),
    [processedPenaltyRows]
  );

  const processedPenaltyPropertyOptions = useMemo(
    () => Array.from(new Set(processedPenaltyRows.map((row) => String(row?.propertyName || "").trim()).filter(Boolean))).sort(),
    [processedPenaltyRows]
  );

  const filteredProcessedPenaltyRows = useMemo(() => {
    return processedPenaltyRows.filter((row) => {
      if (penaltyStatusFilter !== "all" && String(row?.displayStatus || "").toLowerCase() !== penaltyStatusFilter) {
        return false;
      }
      if (penaltyRuleFilter !== "all" && String(row?.ruleName || "") !== String(penaltyRuleFilter)) return false;
      if (penaltyPropertyFilter !== "all" && String(row?.propertyName || "") !== String(penaltyPropertyFilter)) return false;

      if (!penaltySearch.trim()) return true;
      const haystack = [
        row?.batchName,
        row?.ruleName,
        row?.sourceInvoiceNumber,
        row?.penaltyInvoiceNumber,
        row?.tenantName,
        row?.tenantCode,
        row?.propertyName,
        row?.unitNumber,
        row?.reason,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(penaltySearch.trim().toLowerCase());
    });
  }, [processedPenaltyRows, penaltySearch, penaltyStatusFilter, penaltyRuleFilter, penaltyPropertyFilter]);

  const filteredBatches = useMemo(() => {
    return batches.filter((batch) => {
      if (batchStatusFilter !== "all" && String(batch?.status || "").toLowerCase() !== batchStatusFilter) return false;
      if (!batchSearch.trim()) return true;

      const haystack = [
        batch?.batchName,
        batch?.ruleName,
        batch?.rule?.ruleName,
        batch?.status,
        batchDeleteSummary(batch),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(batchSearch.trim().toLowerCase());
    });
  }, [batches, batchSearch, batchStatusFilter]);

  const processedPenaltyTotalPages = Math.max(1, Math.ceil(filteredProcessedPenaltyRows.length / ITEMS_PER_PAGE));
  const safeProcessedPenaltyPage = Math.min(processedPenaltyPage, processedPenaltyTotalPages);
  const processedPenaltyStartIndex = filteredProcessedPenaltyRows.length ? (safeProcessedPenaltyPage - 1) * ITEMS_PER_PAGE : 0;
  const currentProcessedPenaltyRows = filteredProcessedPenaltyRows.slice(
    processedPenaltyStartIndex,
    processedPenaltyStartIndex + ITEMS_PER_PAGE
  );

  const processedBatchTotalPages = Math.max(1, Math.ceil(filteredBatches.length / ITEMS_PER_PAGE));
  const safeProcessedBatchPage = Math.min(processedBatchPage, processedBatchTotalPages);
  const processedBatchStartIndex = filteredBatches.length ? (safeProcessedBatchPage - 1) * ITEMS_PER_PAGE : 0;
  const currentProcessedBatchRows = filteredBatches.slice(
    processedBatchStartIndex,
    processedBatchStartIndex + ITEMS_PER_PAGE
  );

  const selectableProcessedRows = useMemo(
    () =>
      currentProcessedPenaltyRows.filter((row) => {
        const normalizedStatus = String(row?.displayStatus || "").toLowerCase();
        return normalizedStatus !== "deleted" && normalizedStatus !== "reversed" && !row?.isDeleted && !row?.reversedAt;
      }),
    [currentProcessedPenaltyRows]
  );

  const selectedProcessedItemIds = useMemo(
    () =>
      selectableProcessedRows
        .filter((row) => selectedBatchRows[String(row._id)])
        .map((row) => String(row._id)),
    [selectableProcessedRows, selectedBatchRows]
  );

  const allProcessedRowsSelected =
    selectableProcessedRows.length > 0 &&
    selectableProcessedRows.every((row) => selectedBatchRows[String(row._id)]);

  const processedPenaltyStats = useMemo(() => {
    const activeRows = processedPenaltyRows.filter((row) => String(row?.displayStatus || "").toLowerCase() === "processed");
    const reversedRows = processedPenaltyRows.filter((row) => String(row?.displayStatus || "").toLowerCase() === "reversed");
    const deletedRows = processedPenaltyRows.filter((row) => String(row?.displayStatus || "").toLowerCase() === "deleted");
    return {
      totalRows: processedPenaltyRows.length,
      activeRows: activeRows.length,
      reversedRows: reversedRows.length,
      deletedRows: deletedRows.length,
      activeAmount: activeRows.reduce((sum, row) => sum + Number(row?.calculatedPenalty || 0), 0),
    };
  }, [processedPenaltyRows]);

  useEffect(() => {
    setProcessedPenaltyPage(1);
  }, [penaltySearch, penaltyStatusFilter, penaltyRuleFilter, penaltyPropertyFilter]);

  useEffect(() => {
    setProcessedBatchPage(1);
  }, [batchSearch, batchStatusFilter]);

  const selectedCount = useMemo(() => Object.values(selectedRows).filter(Boolean).length, [selectedRows]);
  const selectedPenaltyAmount = useMemo(() => {
    if (!preview?.rows) return 0;
    return preview.rows
      .filter((row) => selectedRows[row.sourceInvoiceId])
      .reduce((sum, row) => sum + Number(row.calculatedPenalty || 0), 0);
  }, [preview, selectedRows]);

  const batchItems = Array.isArray(batchDetail?.items) ? batchDetail.items : [];
  const selectableBatchItems = useMemo(
    () =>
      batchItems.filter((item) => {
        const normalizedStatus = String(item?.status || "").toLowerCase();
        return !item?.isDeleted && !item?.reversedAt && normalizedStatus !== "deleted" && normalizedStatus !== "reversed";
      }),
    [batchItems]
  );
  const selectedModalBatchItemIds = useMemo(
    () =>
      selectableBatchItems
        .filter((item) => selectedBatchRows[String(item._id)])
        .map((item) => String(item._id)),
    [selectableBatchItems, selectedBatchRows]
  );
  const allModalBatchRowsSelected =
    selectableBatchItems.length > 0 &&
    selectableBatchItems.every((item) => selectedBatchRows[String(item._id)]);

  const togglePreviewRow = (rowId) => setSelectedRows((prev) => ({ ...prev, [rowId]: !prev[rowId] }));

  const toggleProcessedPenaltyRow = (itemId) =>
    setSelectedBatchRows((prev) => ({
      ...prev,
      [itemId]: !prev[itemId],
    }));

  const toggleAllProcessedPenaltyRows = () => {
    if (!selectableProcessedRows.length) {
      setSelectedBatchRows({});
      return;
    }

    if (allProcessedRowsSelected) {
      const next = { ...selectedBatchRows };
      selectableProcessedRows.forEach((row) => {
        delete next[String(row._id)];
      });
      setSelectedBatchRows(next);
      return;
    }

    const next = { ...selectedBatchRows };
    selectableProcessedRows.forEach((row) => {
      next[String(row._id)] = true;
    });
    setSelectedBatchRows(next);
  };

  const toggleAllModalBatchRows = () => {
    if (!selectableBatchItems.length) {
      setSelectedBatchRows({});
      return;
    }

    if (allModalBatchRowsSelected) {
      const next = { ...selectedBatchRows };
      selectableBatchItems.forEach((item) => {
        delete next[String(item._id)];
      });
      setSelectedBatchRows(next);
      return;
    }

    const next = { ...selectedBatchRows };
    selectableBatchItems.forEach((item) => {
      next[String(item._id)] = true;
    });
    setSelectedBatchRows(next);
  };

  const handlePreview = async () => {
    if (!selectedRuleId) {
      toast.error("Select a late penalty rule first.");
      return;
    }
    try {
      setLoading(true);
      const res = await previewLatePenalties({ business: businessId, ruleId: selectedRuleId, runDate });
      setPreview(res);
      const defaults = {};
      (res?.rows || []).forEach((row) => {
        if (!row.skippedReason && Number(row.calculatedPenalty || 0) > 0) defaults[row.sourceInvoiceId] = true;
      });
      setSelectedRows(defaults);
      toast.success("Late penalty preview ready.");
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to preview late penalties."));
    } finally {
      setLoading(false);
    }
  };

  const handleProcess = async () => {
    const selectedSourceInvoiceIds = Object.keys(selectedRows).filter((key) => selectedRows[key]);
    if (!selectedRuleId || selectedSourceInvoiceIds.length === 0) {
      toast.error("Preview first, then keep at least one row selected.");
      return;
    }

    try {
      setLoading(true);
      const res = await processLatePenalties({
        business: businessId,
        ruleId: selectedRuleId,
        runDate,
        selectedSourceInvoiceIds,
        batchName: `Late Penalties ${runDate}`,
      });
      toast.success(res?.message || "Late penalties processed successfully.");
      await loadBatches();
      if (res?.batch?._id) {
        setWorkspaceView("processed_batches");
        await openBatch(res.batch._id);
      }
      await handlePreview();
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to process late penalties."));
    } finally {
      setLoading(false);
    }
  };

  const openNewRuleModal = () => {
    setEditingRuleId("");
    setRuleForm(defaultRuleForm);
    setShowRuleModal(true);
  };

  const openEditRuleModal = (rule) => {
    if (!rule) return;
    setEditingRuleId(rule._id || "");
    setSelectedRuleId(rule._id || "");
    setRuleForm(mapRuleToForm(rule));
    setShowRuleModal(true);
  };

  const handleSaveRule = async () => {
    if (!businessId) {
      toast.error("Active business context is required.");
      return;
    }

    if (!String(ruleForm.ruleName || "").trim()) {
      toast.error("Rule name is required.");
      return;
    }

    if (!ruleForm.postingAccount) {
      toast.error("Posting account is required.");
      return;
    }

    try {
      setSavingRule(true);
      let savedRuleId = editingRuleId;

      if (editingRuleId) {
        const res = await updateLatePenaltyRule(editingRuleId, { business: businessId, ...ruleForm });
        savedRuleId = res?.rule?._id || editingRuleId;
        toast.success(res?.message || "Late penalty rule updated.");
      } else {
        const res = await createLatePenaltyRule({ business: businessId, ...ruleForm });
        savedRuleId = res?.rule?._id || "";
        toast.success(res?.message || "Late penalty rule created.");
      }

      await loadRules(savedRuleId);
      setShowRuleModal(false);
      if (savedRuleId) setSelectedRuleId(savedRuleId);
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to save late penalty rule."));
    } finally {
      setSavingRule(false);
    }
  };

  const openBatch = async (batchId) => {
    try {
      setLoading(true);
      setSelectedBatchRows({});
      const res = await getLatePenaltyBatch(batchId, businessId);
      setBatchDetail(res?.batch || null);
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to load late penalty batch."));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteBatch = async (batch) => {
    if (!batch?._id) return;

    if (!batch?.canDeleteBatch) {
      toast.error(batchDeleteSummary(batch) || "Cannot delete batch until all linked penalty invoices are cleared.");
      return;
    }

    const confirmed = await confirm({
      title: "Delete Penalty Batch",
      message: `Delete late penalty batch "${batch.batchName || batch._id}"? This will remove the batch record because all linked penalty invoices have already been cleared.`,
      confirmText: "Delete",
      isDangerous: true,
    });
    if (!confirmed) return;

    try {
      setLoading(true);
      const res = await deleteLatePenaltyBatch(batch._id, businessId);
      toast.success(res?.message || "Late penalty batch deleted successfully.");
      if (String(batchDetail?._id || "") === String(batch._id)) {
        setBatchDetail(null);
      }
      await loadBatches();
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to delete late penalty batch."));
    } finally {
      setLoading(false);
    }
  };

  const refreshOpenBatch = async () => {
    await loadBatches();
    if (batchDetail?._id) {
      await openBatch(batchDetail._id);
    }
  };

  const runReverseForItems = async (itemIds) => {
    if (!itemIds.length) {
      toast.error("Select at least one late penalty row to reverse.");
      return;
    }

    try {
      setProcessingBatchAction(true);
      const res = await reverseLatePenalty({
        business: businessId,
        itemIds,
      });
      toast.success(res?.message || "Selected late penalties reversed successfully.");
      setSelectedBatchRows({});
      await refreshOpenBatch();
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to reverse selected late penalties."));
    } finally {
      setProcessingBatchAction(false);
    }
  };

  const runDeleteForItems = async (itemIds) => {
    if (!itemIds.length) {
      toast.error("Select at least one late penalty row to delete.");
      return;
    }

    const confirmed = await confirm({
      title: "Delete Late Penalties",
      message: itemIds.length === 1
        ? "Delete the selected late penalty? This only works when no journal entry exists."
        : `Delete ${itemIds.length} selected late penalties? This only works when no journal entry exists.`,
      confirmText: "Delete",
      isDangerous: true,
    });
    if (!confirmed) return;

    try {
      setProcessingBatchAction(true);
      for (const itemId of itemIds) {
        // eslint-disable-next-line no-await-in-loop
        await deleteLatePenalty(itemId, { business: businessId });
      }
      toast.success(
        itemIds.length === 1
          ? "Late penalty deleted successfully."
          : "Selected late penalties deleted successfully."
      );
      setSelectedBatchRows({});
      await refreshOpenBatch();
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to delete selected late penalties."));
    } finally {
      setProcessingBatchAction(false);
    }
  };

  const allPreviewRowsSelected =
    !!preview?.rows?.length && preview.rows.every((row) => row.skippedReason || selectedRows[row.sourceInvoiceId]);

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-br from-slate-100 via-slate-50 to-white p-2 md:p-3">
        <div className="mx-auto flex w-full max-w-none min-h-0 flex-1 flex-col gap-2">
          <div className={`${pageShellClass} flex-shrink-0`}>
            <div className="flex items-center gap-0.5 overflow-x-auto border-b border-slate-200 bg-white px-2 py-1 shadow-sm">
              <button
                type="button"
                onClick={() => { setWorkspaceView("processed_penalties"); setSelectedBatchRows({}); }}
                className={`h-[20px] shrink-0 flex items-center border px-1.5 text-[9px] font-bold transition ${pillTabClass(workspaceView === "processed_penalties", "green")}`}
              >
                Processed Penalties
              </button>
              <button
                type="button"
                onClick={() => { setWorkspaceView("processed_batches"); setSelectedBatchRows({}); }}
                className={`h-[20px] shrink-0 flex items-center border px-1.5 text-[9px] font-bold transition ${pillTabClass(workspaceView === "processed_batches", "slate")}`}
              >
                Processed Batches
              </button>
              <button
                type="button"
                onClick={() => { setWorkspaceView("rules"); setSelectedBatchRows({}); }}
                className={`h-[20px] shrink-0 flex items-center border px-1.5 text-[9px] font-bold transition ${pillTabClass(workspaceView === "rules", "orange")}`}
              >
                Rules / Preview / Process
              </button>
              <div className="mx-1 h-3 w-px shrink-0 bg-slate-200" />
              {[
                { label: "Processed", value: processedPenaltyStats.totalRows, accent: "text-slate-900" },
                { label: "Active", value: processedPenaltyStats.activeRows, accent: "text-emerald-700" },
                { label: "Reversed", value: processedPenaltyStats.reversedRows, accent: "text-amber-700" },
                { label: "Deleted", value: processedPenaltyStats.deletedRows, accent: "text-rose-700" },
                { label: "Amount", value: formatCurrency(processedPenaltyStats.activeAmount), accent: "text-slate-900" },
              ].map((item) => (
                <span key={item.label} className="shrink-0 inline-flex h-7 items-center gap-1 border border-slate-200 bg-white px-1 text-[8px] font-bold uppercase tracking-[0.08em] text-slate-500">
                  {item.label} <span className={`normal-case tracking-normal ${item.accent}`}>{item.value}</span>
                </span>
              ))}
              <div className="mx-1 h-3 w-px shrink-0 bg-slate-200" />
              <button
                type="button"
                onClick={openNewRuleModal}
                className="h-[20px] shrink-0 flex items-center gap-0.5 bg-[#0B3B2E] px-1.5 text-[9px] font-bold text-white hover:bg-[#0A3127]"
              >
                <FaPlus size={7} /> Add Rule
              </button>
            </div>
          </div>

          <div className={`${pageShellClass} flex min-h-0 flex-1 flex-col`}>
            {workspaceView === "processed_penalties" ? (
              <>
                <div className="flex-none sticky top-0 z-20 border-b border-slate-200 bg-white shadow-sm">
                  <div className="filter-bar flex items-center gap-0.5 overflow-x-auto px-2 py-1">
                    <input
                      value={penaltySearch}
                      onChange={(e) => setPenaltySearch(e.target.value)}
                      placeholder="Batch, tenant, penalty invoice, property, unit"
                      className="h-[20px] w-44 shrink-0 border border-slate-200 bg-white px-1.5 text-[9px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/20"
                    />
                    <AppSelect
                      value={penaltyStatusFilter !== "all" ? penaltyStatusFilter : ""}
                      onChange={(v) => setPenaltyStatusFilter(v ?? "all")}
                      options={[{ value: "processed", label: "Processed" }, { value: "reversed", label: "Reversed" }, { value: "deleted", label: "Deleted" }]}
                      placeholder="All statuses"
                      clearable
                      compact
                    />
                    <AppSelect
                      value={penaltyRuleFilter !== "all" ? penaltyRuleFilter : ""}
                      onChange={(v) => setPenaltyRuleFilter(v ?? "all")}
                      options={processedPenaltyRuleOptions.map((ruleName) => ({ value: ruleName, label: ruleName }))}
                      placeholder="All rules"
                      searchable
                      clearable
                      compact
                    />
                    <AppSelect
                      value={penaltyPropertyFilter !== "all" ? penaltyPropertyFilter : ""}
                      onChange={(v) => setPenaltyPropertyFilter(v ?? "all")}
                      options={processedPenaltyPropertyOptions.map((propertyName) => ({ value: propertyName, label: propertyName }))}
                      placeholder="All properties"
                      searchable
                      clearable
                      compact
                    />
                    <div className="mx-1 h-3 w-px shrink-0 bg-slate-200" />
                    <button
                      type="button"
                      onClick={() => runReverseForItems(selectedProcessedItemIds)}
                      disabled={processingBatchAction || selectedProcessedItemIds.length === 0}
                      className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] font-bold text-white ${
                        selectedProcessedItemIds.length > 0 ? "bg-orange-500 hover:bg-orange-600" : "bg-slate-400 cursor-not-allowed"
                      }`}
                    >
                      <FaCheckSquare size={7} /> Reverse Selected
                    </button>
                    <button
                      type="button"
                      onClick={() => runDeleteForItems(selectedProcessedItemIds)}
                      disabled={processingBatchAction || selectedProcessedItemIds.length === 0}
                      className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] font-bold text-white ${
                        selectedProcessedItemIds.length > 0 ? "bg-rose-600 hover:bg-rose-700" : "bg-slate-400 cursor-not-allowed"
                      }`}
                    >
                      <FaTrash size={7} /> Delete Selected
                    </button>
                    <button
                      type="button"
                      onClick={() => setCommunicationModal({ contextType: "penalty_invoice", recordIds: selectedProcessedItemIds, title: `Notify ${selectedProcessedItemIds.length} Tenant${selectedProcessedItemIds.length !== 1 ? "s" : ""}`, subtitle: "Send late penalty notice via SMS.", allowedChannels: ["sms", "email"], defaultChannel: "sms" })}
                      disabled={selectedProcessedItemIds.length === 0}
                      title={selectedProcessedItemIds.length === 0 ? "Select penalties to SMS tenants" : `SMS ${selectedProcessedItemIds.length} tenant${selectedProcessedItemIds.length !== 1 ? "s" : ""}`}
                      className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] font-bold text-white ${selectedProcessedItemIds.length > 0 ? "bg-teal-600 hover:bg-teal-700" : "bg-slate-400 cursor-not-allowed"}`}
                    >
                      <FaSms size={7} /> SMS
                    </button>
                    <button
                      type="button"
                      onClick={() => setCommunicationModal({ contextType: "penalty_invoice", recordIds: selectedProcessedItemIds, title: `Email ${selectedProcessedItemIds.length} Tenant${selectedProcessedItemIds.length !== 1 ? "s" : ""}`, subtitle: "Send late penalty notice via email.", allowedChannels: ["email"], defaultChannel: "email" })}
                      disabled={selectedProcessedItemIds.length === 0}
                      title={selectedProcessedItemIds.length === 0 ? "Select penalties to email tenants" : `Email ${selectedProcessedItemIds.length} tenant${selectedProcessedItemIds.length !== 1 ? "s" : ""}`}
                      className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] font-bold text-white ${selectedProcessedItemIds.length > 0 ? "bg-blue-600 hover:bg-blue-700" : "bg-slate-400 cursor-not-allowed"}`}
                    >
                      <FaEnvelope size={7} /> Email
                    </button>
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-auto">
                  <table className="w-full min-w-[1500px] text-[11px] border-collapse">
                    <thead className="sticky top-0 z-10 shadow-sm">
                      <tr className="bg-[#0B3B2E] text-white">
                        <th className="px-3 py-1 text-left font-bold border-r border-white/10">
                          <input
                            type="checkbox"
                            checked={selectableProcessedRows.length > 0 && allProcessedRowsSelected}
                            onChange={toggleAllProcessedPenaltyRows}
                          />
                        </th>
                        <th className="px-3 py-1 text-left font-bold border-r border-white/10">Batch</th>
                        <th className="px-3 py-1 text-left font-bold border-r border-white/10">Source Invoice</th>
                        <th className="px-3 py-1 text-left font-bold border-r border-white/10">Penalty Invoice</th>
                        <th className="px-3 py-1 text-left font-bold border-r border-white/10">Tenant</th>
                        <th className="px-3 py-1 text-left font-bold border-r border-white/10">Property</th>
                        <th className="px-3 py-1 text-left font-bold border-r border-white/10">Unit</th>
                        <th className="px-3 py-1 text-right font-bold border-r border-white/10">Penalty</th>
                        <th className="px-3 py-1 text-center font-bold border-r border-white/10">Run Date</th>
                        <th className="px-3 py-1 text-center font-bold border-r border-white/10">Status</th>
                        <th className="px-3 py-1 text-left font-bold">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentProcessedPenaltyRows.length === 0 ? (
                        <tr>
                          <td colSpan={11} className="px-4 py-10 text-center text-slate-500">
                            No processed late penalties match the current filters.
                          </td>
                        </tr>
                      ) : (
                        currentProcessedPenaltyRows.map((row, index) => {
                          const selectable = String(row?.displayStatus || "").toLowerCase() === "processed";
                          const isSelected = !!selectedBatchRows[String(row._id)];
                          return (
                            <tr
                              key={row._id}
                              className={`border-b border-gray-100 transition-colors ${
                                isSelected
                                  ? "bg-emerald-50/85 shadow-[inset_4px_0_0_0_#0B3B2E] hover:bg-emerald-50"
                                  : index % 2 === 0
                                  ? "bg-white hover:bg-blue-50/40"
                                  : "bg-slate-50/60 hover:bg-blue-50/40"
                              }`}
                            >
                              <td className="px-3 py-1 border-r border-gray-100">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  disabled={!selectable}
                                  onChange={() => toggleProcessedPenaltyRow(String(row._id))}
                                />
                              </td>
                              <td className="px-3 py-1 border-r border-gray-100">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setWorkspaceView("processed_batches");
                                    openBatch(row.batchId);
                                  }}
                                  className="font-bold text-blue-700 hover:underline"
                                >
                                  {row.batchName}
                                </button>
                                <p className="mt-1 text-[11px] text-slate-500">{row.ruleName}</p>
                              </td>
                              <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900">{row.sourceInvoiceNumber}</td>
                              <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900">{row.penaltyInvoiceNumber}</td>
                              <td className="px-3 py-1 border-r border-gray-100">
                                <p className="font-semibold text-slate-900">{row.tenantName}</p>
                                <p className="mt-0.5 text-[10px] text-slate-500">{row.tenantCode || "-"}</p>
                              </td>
                              <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-800">{row.propertyName}</td>
                              <td className="px-3 py-1 border-r border-gray-100 text-slate-700">{row.unitNumber}</td>
                              <td className="px-3 py-1 border-r border-gray-100 text-right font-semibold text-slate-900">{formatCurrency(row.calculatedPenalty)}</td>
                              <td className="px-3 py-1 border-r border-gray-100 text-center text-slate-700">{formatDate(row.batchRunDate)}</td>
                              <td className="px-3 py-1 border-r border-gray-100 text-center">
                                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusBadgeClass(row.displayStatus)}`}>
                                  {row.displayStatus}
                                </span>
                              </td>
                              <td className="px-3 py-1 text-slate-600">{row.reason || "-"}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-3 py-1 text-xs text-slate-700">
                  <p>
                    <span className="font-semibold">Showing:</span> {filteredProcessedPenaltyRows.length === 0 ? 0 : processedPenaltyStartIndex + 1}
                    {" - "}
                    {Math.min(processedPenaltyStartIndex + ITEMS_PER_PAGE, filteredProcessedPenaltyRows.length)} of {filteredProcessedPenaltyRows.length} penalty row(s)
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setProcessedPenaltyPage((prev) => Math.max(1, prev - 1))}
                      disabled={safeProcessedPenaltyPage === 1}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1 font-semibold text-slate-700">
                      Page {safeProcessedPenaltyPage} of {processedPenaltyTotalPages} · {ITEMS_PER_PAGE} per page
                    </span>
                    <button
                      type="button"
                      onClick={() => setProcessedPenaltyPage((prev) => Math.min(processedPenaltyTotalPages, prev + 1))}
                      disabled={safeProcessedPenaltyPage === processedPenaltyTotalPages}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            ) : null}

            {workspaceView === "processed_batches" ? (
              <>
                <div className="flex-none sticky top-0 z-20 border-b border-slate-200 bg-white shadow-sm">
                  <div className="filter-bar flex items-center gap-0.5 overflow-x-auto px-2 py-1">
                    <input
                      value={batchSearch}
                      onChange={(e) => setBatchSearch(e.target.value)}
                      placeholder="Batch name, rule, status"
                      className="h-[20px] w-40 shrink-0 border border-slate-200 bg-white px-1.5 text-[9px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/20"
                    />
                    <AppSelect
                      value={batchStatusFilter !== "all" ? batchStatusFilter : ""}
                      onChange={(v) => setBatchStatusFilter(v ?? "all")}
                      options={[{ value: "processed", label: "Processed" }, { value: "partial", label: "Partial" }, { value: "failed", label: "Failed" }, { value: "reversed_ready", label: "Reversed ready" }]}
                      placeholder="All batch statuses"
                      clearable
                      compact
                    />
                    <span className="shrink-0 text-[9px] text-slate-500">Click a row to open details.</span>
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-auto">
                  <table className="w-full min-w-[1200px] text-[11px] border-collapse">
                    <thead className="sticky top-0 z-10 shadow-sm">
                      <tr className="bg-[#0B3B2E] text-white">
                        <th className="px-3 py-1 text-left font-bold border-r border-white/10">Batch</th>
                        <th className="px-3 py-1 text-left font-bold border-r border-white/10">Rule</th>
                        <th className="px-3 py-1 text-center font-bold border-r border-white/10">Run Date</th>
                        <th className="px-3 py-1 text-right font-bold border-r border-white/10">Invoices</th>
                        <th className="px-3 py-1 text-right font-bold border-r border-white/10">Amount</th>
                        <th className="px-3 py-1 text-center font-bold border-r border-white/10">Status</th>
                        <th className="px-3 py-1 text-left font-bold border-r border-white/10">Delete Rule</th>
                        <th className="px-3 py-1 text-right font-bold">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentProcessedBatchRows.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                            No late penalty batches match the current filters.
                          </td>
                        </tr>
                      ) : (
                        currentProcessedBatchRows.map((batch, index) => (
                          <tr
                            key={batch._id}
                            className={`cursor-pointer border-b border-gray-100 transition-colors ${
                              index % 2 === 0 ? "bg-white hover:bg-blue-50/40" : "bg-slate-50/60 hover:bg-blue-50/40"
                            }`}
                            onClick={() => openBatch(batch._id)}
                          >
                            <td className="px-3 py-1 border-r border-gray-100">
                              <p className="font-bold text-blue-700">{batch.batchName}</p>
                              <p className="mt-0.5 text-[10px] text-slate-500">
                                {(Array.isArray(batch?.items) ? batch.items.length : 0).toLocaleString()} penalty rows
                              </p>
                            </td>
                            <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900">{batch.ruleName || batch.rule?.ruleName || "-"}</td>
                            <td className="px-3 py-1 border-r border-gray-100 text-center text-slate-700">{formatDate(batch.runDate)}</td>
                            <td className="px-3 py-1 border-r border-gray-100 text-right font-semibold text-slate-800">{Number(batch.invoicesCreatedCount || 0)}</td>
                            <td className="px-3 py-1 border-r border-gray-100 text-right font-semibold text-slate-900">{formatCurrency(batch.totalPenaltyAmount)}</td>
                            <td className="px-3 py-1 border-r border-gray-100 text-center">
                              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusBadgeClass(batch.status)}`}>
                                {batch.status || "processed"}
                              </span>
                            </td>
                            <td className="px-3 py-1 border-r border-gray-100 text-slate-600">
                              {batch?.canDeleteBatch ? (
                                <span className="font-medium text-emerald-700">Ready to delete</span>
                              ) : (
                                <span className="text-amber-700">{batchDeleteSummary(batch) || "Clear linked invoices first."}</span>
                              )}
                            </td>
                            <td className="px-3 py-1 text-right">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleDeleteBatch(batch);
                                }}
                                disabled={!batch?.canDeleteBatch}
                                className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold text-white ${
                                  batch?.canDeleteBatch ? "bg-rose-600 hover:bg-rose-700" : "bg-slate-400 cursor-not-allowed"
                                }`}
                              >
                                <FaTrash /> Delete Batch
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-3 py-1 text-xs text-slate-700">
                  <p>
                    <span className="font-semibold">Showing:</span> {filteredBatches.length === 0 ? 0 : processedBatchStartIndex + 1}
                    {" - "}
                    {Math.min(processedBatchStartIndex + ITEMS_PER_PAGE, filteredBatches.length)} of {filteredBatches.length} batch(es)
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setProcessedBatchPage((prev) => Math.max(1, prev - 1))}
                      disabled={safeProcessedBatchPage === 1}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1 font-semibold text-slate-700">
                      Page {safeProcessedBatchPage} of {processedBatchTotalPages} · {ITEMS_PER_PAGE} per page
                    </span>
                    <button
                      type="button"
                      onClick={() => setProcessedBatchPage((prev) => Math.min(processedBatchTotalPages, prev + 1))}
                      disabled={safeProcessedBatchPage === processedBatchTotalPages}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            ) : null}

            {workspaceView === "rules" ? (
              <div className="grid flex-1 min-h-0 grid-cols-1 gap-4 p-3 md:p-5 xl:grid-cols-[340px_minmax(0,1fr)]">
                <div className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white">
                  <div className="border-b border-slate-200 px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-base font-semibold text-slate-900">Saved rules</h2>
                        <p className="text-xs text-slate-500">Pick a rule, edit it, then preview the current run.</p>
                      </div>
                      <FaBolt className="text-[#0B3B2E]" />
                    </div>
                  </div>

                  <div className="flex-1 overflow-auto p-3">
                    <div className="space-y-3">
                      {rules.map((rule) => {
                        const active = String(rule._id) === String(selectedRuleId);
                        return (
                          <button
                            key={rule._id}
                            type="button"
                            onClick={() => {
                              setSelectedRuleId(rule._id);
                              setEditingRuleId(rule._id);
                            }}
                            className={`w-full rounded-xl border px-4 py-3 text-left shadow-sm transition ${
                              active
                                ? "border-[#0B3B2E] bg-[#E7F5EC]"
                                : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-semibold text-slate-900">{rule.ruleName}</p>
                                <p className="mt-1 text-xs text-slate-500">
                                  {rule.postingAccount?.code ? `${rule.postingAccount.code} · ` : ""}
                                  {rule.postingAccount?.name || "Posting account not loaded"}
                                </p>
                              </div>
                              <span className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold ${statusBadgeClass(rule.active ? "processed" : "failed")}`}>
                                {rule.active ? "Active" : "Inactive"}
                              </span>
                            </div>
                            <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
                              <span>{rule.repeatFrequency || "manual"}</span>
                              <span>{rule.calculationType || "percentage_overdue_balance"}</span>
                            </div>
                            <div className="mt-3">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openEditRuleModal(rule);
                                }}
                                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                              >
                                <FaPen /> Edit Rule
                              </button>
                            </div>
                          </button>
                        );
                      })}
                      {!rules.length ? (
                        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                          No late penalty rules have been configured yet.
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white">
                  <div className="flex-none sticky top-0 z-10 border-b border-slate-200 bg-white shadow-sm">
                    <div className="filter-bar flex items-center gap-0.5 overflow-x-auto px-2 py-1">
                      <AppSelect
                        value={selectedRuleId}
                        onChange={(v) => setSelectedRuleId(v ?? "")}
                        options={rules.map((rule) => ({ value: rule._id, label: rule.ruleName }))}
                        placeholder="Select rule"
                        searchable
                        clearable
                        compact
                      />
                      <input
                        type="date"
                        className="h-[20px] w-[5.5rem] shrink-0 border border-slate-200 bg-white px-1 text-[9px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                        value={runDate}
                        onChange={(e) => setRunDate(e.target.value)}
                      />
                      <span className="shrink-0 border border-slate-200 bg-slate-50 px-1 py-0.5 text-[8px] font-bold text-slate-700">
                        {selectedCount} row(s) · {formatCurrency(selectedPenaltyAmount)}
                      </span>
                      <div className="mx-1 h-3 w-px shrink-0 bg-slate-200" />
                      <button
                        type="button"
                        onClick={handlePreview}
                        disabled={loading}
                        className="h-[20px] shrink-0 flex items-center gap-0.5 bg-[#0B3B2E] px-1.5 text-[9px] font-bold text-white hover:bg-[#0A3127] disabled:opacity-60"
                      >
                        <FaEye size={7} /> Preview
                      </button>
                      <button
                        type="button"
                        onClick={handleProcess}
                        disabled={loading || selectedCount === 0}
                        className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] font-bold text-white ${
                          selectedCount > 0 ? "bg-orange-500 hover:bg-orange-600" : "bg-slate-400 cursor-not-allowed"
                        }`}
                      >
                        <FaCheckSquare size={7} /> Process Selected
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 min-h-0 overflow-auto">
                    <table className="w-full min-w-[1400px] text-[11px] border-collapse">
                      <thead className="sticky top-0 z-10 shadow-sm">
                        <tr className="bg-[#0B3B2E] text-white">
                          <th className="px-3 py-1 text-left font-bold border-r border-white/10">
                            <input
                              type="checkbox"
                              checked={allPreviewRowsSelected}
                              onChange={() => {
                                if (!preview?.rows?.length) return;
                                if (allPreviewRowsSelected) {
                                  setSelectedRows({});
                                  return;
                                }
                                const next = {};
                                preview.rows.forEach((row) => {
                                  if (!row.skippedReason && Number(row.calculatedPenalty || 0) > 0) {
                                    next[row.sourceInvoiceId] = true;
                                  }
                                });
                                setSelectedRows(next);
                              }}
                            />
                          </th>
                          <th className="px-3 py-1 text-left font-bold border-r border-white/10">Source Invoice</th>
                          <th className="px-3 py-1 text-left font-bold border-r border-white/10">Tenant</th>
                          <th className="px-3 py-1 text-left font-bold border-r border-white/10">Property</th>
                          <th className="px-3 py-1 text-left font-bold border-r border-white/10">Unit</th>
                          <th className="px-3 py-1 text-center font-bold border-r border-white/10">Overdue Days</th>
                          <th className="px-3 py-1 text-right font-bold border-r border-white/10">Outstanding</th>
                          <th className="px-3 py-1 text-right font-bold border-r border-white/10">Penalty</th>
                          <th className="px-3 py-1 text-left font-bold">Status / Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview?.rows?.length ? (
                          preview.rows.map((row, index) => {
                            const selected = !!selectedRows[row.sourceInvoiceId];
                            return (
                              <tr
                                key={`${row.sourceInvoiceId}-${index}`}
                                className={`border-b border-gray-100 transition-colors ${
                                  selected
                                    ? "bg-emerald-50/85 shadow-[inset_4px_0_0_0_#0B3B2E]"
                                    : index % 2 === 0
                                    ? "bg-white hover:bg-blue-50/40"
                                    : "bg-slate-50/60 hover:bg-blue-50/40"
                                }`}
                              >
                                <td className="px-3 py-1 border-r border-gray-100">
                                  <input
                                    type="checkbox"
                                    checked={selected}
                                    disabled={Boolean(row.skippedReason)}
                                    onChange={() => togglePreviewRow(row.sourceInvoiceId)}
                                  />
                                </td>
                                <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900">{row.sourceInvoiceNumber}</td>
                                <td className="px-3 py-1 border-r border-gray-100">
                                  <p className="font-semibold text-slate-900">{row.tenantName}</p>
                                  <p className="mt-0.5 text-[10px] text-slate-500">{row.tenantCode || "-"}</p>
                                </td>
                                <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-800">{row.propertyName}</td>
                                <td className="px-3 py-1 border-r border-gray-100 text-slate-700">{row.unitNumber}</td>
                                <td className="px-3 py-1 border-r border-gray-100 text-center text-slate-700">{row.overdueDays}</td>
                                <td className="px-3 py-1 border-r border-gray-100 text-right font-semibold text-slate-900">{formatCurrency(row.outstandingBalance)}</td>
                                <td className="px-3 py-1 border-r border-gray-100 text-right font-semibold text-slate-900">{formatCurrency(row.calculatedPenalty)}</td>
                                <td className="px-3 py-1">
                                  {row.skippedReason ? (
                                    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                                      <FaExclamationTriangle size={8} /> {row.skippedReason}
                                    </span>
                                  ) : (
                                    <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                                      Ready
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                              No preview yet. Select a rule and click <span className="font-semibold">Preview Penalties</span>.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {batchDetail ? (
        <div className="fixed inset-0 z-[58] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
          <div className="flex max-h-[90vh] w-full max-w-7xl flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">
            <div className="flex flex-shrink-0 flex-col border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-black uppercase tracking-wide">{batchDetail.batchName}</p>
                  <p className="mt-0.5 text-xs text-white/60">
                    {batchDetail.ruleName || batchDetail.rule?.ruleName || "-"} · {formatDate(batchDetail.runDate)} · {batchDetail.status}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => runReverseForItems(selectedModalBatchItemIds)}
                    disabled={processingBatchAction || selectedModalBatchItemIds.length === 0}
                    className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold text-white ${
                      selectedModalBatchItemIds.length > 0 ? "bg-orange-500 hover:bg-orange-600" : "bg-slate-400 cursor-not-allowed"
                    }`}
                  >
                    <FaCheckSquare /> Reverse Selected
                  </button>
                  <button
                    type="button"
                    onClick={() => runDeleteForItems(selectedModalBatchItemIds)}
                    disabled={processingBatchAction || selectedModalBatchItemIds.length === 0}
                    className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold text-white ${
                      selectedModalBatchItemIds.length > 0 ? "bg-rose-600 hover:bg-rose-700" : "bg-slate-400 cursor-not-allowed"
                    }`}
                  >
                    <FaTrash /> Delete Selected
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteBatch(batchDetail)}
                    disabled={!batchDetail?.canDeleteBatch}
                    className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold text-white ${
                      batchDetail?.canDeleteBatch ? "bg-rose-700 hover:bg-rose-800" : "bg-slate-400 cursor-not-allowed"
                    }`}
                  >
                    <FaTrash /> Delete Batch
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedBatchRows({});
                      setBatchDetail(null);
                    }}
                    className="text-white/70 transition-colors hover:text-white"
                  >
                    <FaTimes />
                  </button>
                </div>
              </div>
              {!batchDetail?.canDeleteBatch ? (
                <p className="mt-2 text-xs text-white/60">{batchDeleteSummary(batchDetail) || "This batch still has active linked penalty invoices."}</p>
              ) : (
                <p className="mt-2 text-xs text-white/60">All linked penalty invoices have been cleared. This batch can now be deleted safely.</p>
              )}
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
              <div className="grid gap-4 border-b border-slate-200 bg-slate-50 px-3 py-2 md:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Status</p>
                  <p className="mt-1 text-base font-semibold text-slate-900">{batchDetail.status}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Invoices</p>
                  <p className="mt-1 text-base font-semibold text-slate-900">{Number(batchDetail.invoicesCreatedCount || 0)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Penalty amount</p>
                  <p className="mt-1 text-base font-semibold text-slate-900">{formatCurrency(batchDetail.totalPenaltyAmount)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Rule</p>
                  <p className="mt-1 text-base font-semibold text-slate-900">{batchDetail.ruleName || batchDetail.rule?.ruleName || "-"}</p>
                </div>
              </div>

              <div className="overflow-auto">
                <table className="w-full min-w-[1450px] text-[11px] border-collapse">
                <thead className="sticky top-0 z-10 shadow-sm">
                  <tr className="bg-[#0B3B2E] text-white">
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">
                      <input
                        type="checkbox"
                        checked={selectableBatchItems.length > 0 && allModalBatchRowsSelected}
                        onChange={toggleAllModalBatchRows}
                      />
                    </th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Source Invoice</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Tenant</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Property</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Penalty Invoice</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">Penalty</th>
                    <th className="px-3 py-1 text-center font-bold border-r border-white/10">Status</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Reason</th>
                    <th className="px-3 py-1 text-right font-bold">Communication</th>
                  </tr>
                </thead>
                <tbody>
                  {batchItems.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                        This batch has no processed items.
                      </td>
                    </tr>
                  ) : (
                    batchItems.map((item, index) => {
                      const normalizedStatus = item?.isDeleted ? "deleted" : item?.reversedAt ? "reversed" : String(item?.status || "").toLowerCase();
                      const isSelected = !!selectedBatchRows[String(item._id)];
                      const rowSelectable = normalizedStatus !== "deleted" && normalizedStatus !== "reversed";
                      return (
                        <tr
                          key={item._id}
                          className={`border-b border-gray-100 transition-colors ${
                            isSelected
                              ? "bg-emerald-50/85 shadow-[inset_4px_0_0_0_#0B3B2E]"
                              : index % 2 === 0
                              ? "bg-white hover:bg-blue-50/40"
                              : "bg-slate-50/60 hover:bg-blue-50/40"
                          }`}
                        >
                          <td className="px-3 py-1 border-r border-gray-100">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={!rowSelectable}
                              onChange={() => toggleProcessedPenaltyRow(String(item._id))}
                            />
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900">{item.sourceInvoiceNumber || item?.sourceInvoice?.invoiceNumber || "-"}</td>
                          <td className="px-3 py-1 border-r border-gray-100">
                            <p className="font-semibold text-slate-900">{item.tenant?.name || item.tenantName || "-"}</p>
                            <p className="mt-0.5 text-[10px] text-slate-500">{item.property?.propertyName || "-"} / {item.unit?.unitNumber || "-"}</p>
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-800">{item.property?.propertyName || "-"}</td>
                          <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900">{item?.penaltyInvoice?.invoiceNumber || "-"}</td>
                          <td className="px-3 py-1 border-r border-gray-100 text-right font-semibold text-slate-900">{formatCurrency(item.calculatedPenalty)}</td>
                          <td className="px-3 py-1 border-r border-gray-100 text-center">
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusBadgeClass(normalizedStatus)}`}>
                              {normalizedStatus}
                            </span>
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100 text-slate-600">{item.reason || "-"}</td>
                          <td className="px-3 py-1 text-right">
                            {item?.penaltyInvoice?._id ? (
                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCommunicationModal({
                                      contextType: "penalty_invoice",
                                      recordIds: [item.penaltyInvoice._id],
                                      title: "Send Penalty Notice SMS",
                                      subtitle: "Preview the final penalty notice SMS before sending.",
                                      allowedChannels: ["sms"],
                                      defaultChannel: "sms",
                                    })
                                  }
                                  className="inline-flex items-center gap-1 rounded-lg bg-orange-500 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-orange-600"
                                >
                                  <FaSms /> SMS
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCommunicationModal({
                                      contextType: "penalty_invoice",
                                      recordIds: [item.penaltyInvoice._id],
                                      title: "Send Penalty Notice Email",
                                      subtitle: "Preview the final penalty notice email before sending.",
                                      allowedChannels: ["email"],
                                      defaultChannel: "email",
                                    })
                                  }
                                  className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-700"
                                >
                                  <FaEnvelope /> Email
                                </button>
                              </div>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showRuleModal ? (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">
            <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
              <h2 className="text-sm font-black uppercase tracking-wide">
                {editingRuleId ? "Edit late penalty rule" : "Add late penalty rule"}
              </h2>
              <button
                onClick={() => !savingRule && setShowRuleModal(false)}
                className="text-white/70 transition-colors hover:text-white"
                type="button"
              >
                <FaTimes />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-white px-5 py-4">
              <div className="mb-5 grid grid-cols-1 gap-3 lg:grid-cols-3">
                <div className="rounded-xl border border-orange-100 bg-orange-50 px-4 py-2 text-xs text-slate-700">
                  <p className="font-semibold text-slate-900">Grace days</p>
                  <p className="mt-1">Days allowed after due date before penalty counting begins.</p>
                </div>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-2 text-xs text-slate-700">
                  <p className="font-semibold text-slate-900">Minimum overdue days</p>
                  <p className="mt-1">Extra threshold after grace. The row must still reach this number to qualify.</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-700">
                  <p className="font-semibold text-slate-900">Posting account</p>
                  <p className="mt-1">This is the income ledger the late penalty invoice will credit.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="space-y-4">
                  <div>
                    <label className={labelClass}>Rule name</label>
                    <input
                      className={inputClass}
                      value={ruleForm.ruleName}
                      onChange={(e) => setRuleForm((prev) => ({ ...prev, ruleName: e.target.value }))}
                      placeholder="Example: Standard monthly arrears penalty"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Effective from</label>
                      <input
                        type="date"
                        className={inputClass}
                        value={ruleForm.effectiveFrom}
                        onChange={(e) => setRuleForm((prev) => ({ ...prev, effectiveFrom: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Posting account</label>
                      <AppSelect
                        value={ruleForm.postingAccount}
                        onChange={(v) => setRuleForm((prev) => ({ ...prev, postingAccount: v ?? "" }))}
                        options={incomeAccounts.map((account) => ({ value: account._id, label: `${account.code ? account.code + " · " : ""}${account.name}` }))}
                        placeholder="Select account"
                        searchable
                        clearable
                        size="md"
                        className="w-full"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Grace days</label>
                      <input
                        type="number"
                        min="0"
                        className={inputClass}
                        value={ruleForm.graceDays}
                        onChange={(e) => setRuleForm((prev) => ({ ...prev, graceDays: Number(e.target.value || 0) }))}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Min overdue days</label>
                      <input
                        type="number"
                        min="0"
                        className={inputClass}
                        value={ruleForm.minimumOverdueDays}
                        onChange={(e) => setRuleForm((prev) => ({ ...prev, minimumOverdueDays: Number(e.target.value || 0) }))}
                      />
                    </div>
                  </div>

                  <div>
                    <label className={labelClass}>Penalize item</label>
                    <AppSelect
                      value={ruleForm.penalizeItem}
                      onChange={(v) => setRuleForm((prev) => ({ ...prev, penalizeItem: v ?? "outstanding_invoice_balance" }))}
                      options={[
                        { value: "rent_only", label: "Rent only" },
                        { value: "current_period_rent_only", label: "Current period rent only" },
                        { value: "current_period_bill_balance_only", label: "Current period bill balance only" },
                        { value: "all_arrears", label: "All arrears" },
                        { value: "outstanding_invoice_balance", label: "Outstanding invoice balance" },
                      ]}
                      size="md"
                      className="w-full"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Calculation type</label>
                      <AppSelect
                        value={ruleForm.calculationType}
                        onChange={(v) => setRuleForm((prev) => ({ ...prev, calculationType: v ?? "percentage_overdue_balance" }))}
                        options={[
                          { value: "flat_amount", label: "Flat amount" },
                          { value: "percentage_overdue_balance", label: "Percentage of overdue balance" },
                          { value: "daily_fixed_amount", label: "Daily fixed amount" },
                          { value: "daily_percentage", label: "Daily percentage" },
                        ]}
                        size="md"
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Rate / amount</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className={inputClass}
                        value={ruleForm.rateOrAmount}
                        onChange={(e) => setRuleForm((prev) => ({ ...prev, rateOrAmount: Number(e.target.value || 0) }))}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className={labelClass}>Min balance</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className={inputClass}
                        value={ruleForm.minimumBalance}
                        onChange={(e) => setRuleForm((prev) => ({ ...prev, minimumBalance: Number(e.target.value || 0) }))}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Max balance</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className={inputClass}
                        value={ruleForm.maximumBalance}
                        onChange={(e) => setRuleForm((prev) => ({ ...prev, maximumBalance: Number(e.target.value || 0) }))}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Penalty cap</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className={inputClass}
                        value={ruleForm.maximumPenaltyCap}
                        onChange={(e) => setRuleForm((prev) => ({ ...prev, maximumPenaltyCap: Number(e.target.value || 0) }))}
                      />
                    </div>
                  </div>

                  <div>
                    <label className={labelClass}>Repeat frequency</label>
                    <AppSelect
                      value={ruleForm.repeatFrequency}
                      onChange={(v) => setRuleForm((prev) => ({ ...prev, repeatFrequency: v ?? "manual" }))}
                      options={[{ value: "manual", label: "Manual" }, { value: "monthly", label: "Monthly" }]}
                      size="md"
                      className="w-full"
                    />
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <label className={labelClass}>Notes</label>
                    <textarea
                      rows={8}
                      className={`${inputClass} min-h-[180px]`}
                      value={ruleForm.notes}
                      onChange={(e) => setRuleForm((prev) => ({ ...prev, notes: e.target.value }))}
                      placeholder="Optional internal guidance for the team."
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <button
                type="button"
                onClick={() => setShowRuleModal(false)}
                className="inline-flex items-center gap-2 border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                <FaTimes /> Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveRule}
                disabled={savingRule || !incomeAccounts.length}
                className="inline-flex items-center gap-2 bg-[#0B3B2E] px-4 py-2 text-xs font-black uppercase tracking-wide text-white hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <FaSave /> {savingRule ? "Saving..." : editingRuleId ? "Update Rule" : "Save Rule"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <CommunicationComposerModal
        open={Boolean(communicationModal)}
        onClose={() => setCommunicationModal(null)}
        businessId={businessId}
        contextType={communicationModal?.contextType || "penalty_invoice"}
        recordIds={communicationModal?.recordIds || []}
        title={communicationModal?.title || "Penalty Notice Communication"}
        subtitle={communicationModal?.subtitle || "Preview the final penalty notice before sending."}
        allowedChannels={communicationModal?.allowedChannels || ["sms", "email"]}
        defaultChannel={communicationModal?.defaultChannel || "sms"}
      />
    </DashboardLayout>
  );
};

export default LatePenalties;
