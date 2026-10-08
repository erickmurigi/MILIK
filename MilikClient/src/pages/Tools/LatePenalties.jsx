import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import PaginationBar from '../../components/PaginationBar';
import ListToolbar from '../../components/common/ListToolbar';
import MilikTable from '../../components/common/MilikTable';
import { useConfirm } from "../../context/ConfirmContext";
import { fmtDate } from "../../utils/dates";
import { getErrorMessage } from "../../utils/requestMethods";
import {
  FaCheckSquare,
  FaExclamationTriangle,
  FaEye,
  FaTrash,
} from "react-icons/fa";
import { useSelector } from "react-redux";
import { selectCurrentCompany } from "../../redux/selectors";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import AppSelect from "../../components/common/AppSelect";
import CommunicationComposerModal from "../../components/Communications/CommunicationComposerModal";
import StatusBadge from "../../components/common/StatusBadge";
import {
  deleteLatePenaltiesBatch,
  deleteLatePenaltyBatch,
  getLatePenaltyBatches,
  getLatePenaltyRules,
  previewLatePenalties,
  processLatePenalties,
  reverseLatePenalty,
} from "../../redux/apiCalls";

// Rules and batches are local component state, not Redux, so they'd normally be
// refetched from scratch every time this tab remounts. Two tiny module-level caches
// (outside React, so they survive unmount), kept separate since they load
// independently, give the same "instant on revisit" behavior as useEntityCache.
const STALE_MS = 30_000;
const rulesCache = new Map();
const batchesCache = new Map();

const formatCurrency = (value) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 2,
  }).format(Number(value || 0));


const PENALTY_STATUS_MAP = {
  processed:      "border-emerald-200 bg-emerald-50 text-emerald-700",
  reversed:       "border-amber-200 bg-amber-50 text-amber-700",
  deleted:        "border-rose-200 bg-rose-50 text-rose-700",
  failed:         "border-rose-200 bg-rose-50 text-rose-700",
  partial:        "border-orange-200 bg-orange-50 text-orange-700",
  reversed_ready: "border-blue-200 bg-blue-50 text-blue-700",
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
  const [pageSize, setPageSize] = useState(50);
  const confirm = useConfirm();
  const currentCompany = useSelector(selectCurrentCompany);
  const businessId = currentCompany?._id || "";

  const [rules, setRules] = useState([]);
  const [batches, setBatches] = useState([]);
  const [selectedRuleId, setSelectedRuleId] = useTabState("/invoices/late-penalties:selectedRuleId", "");
  const [runDate, setRunDate] = useState(new Date().toISOString().slice(0, 10));
  const [preview, setPreview] = useState(null);
  const [selectedRows, setSelectedRows] = useState({});
  const [loading, setLoading] = useState(false);
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

  const loadRules = useCallback(
    async (preferredRuleId = "", { force = false } = {}) => {
      if (!businessId) {
        setRules([]);
        return [];
      }

      const cached = rulesCache.get(businessId);
      if (!force && cached && Date.now() - cached.loadedAt < STALE_MS) {
        setRules(cached.rules);
        const preferred = preferredRuleId || selectedRuleId;
        if (preferred && cached.rules.some((rule) => String(rule._id) === String(preferred))) {
          setSelectedRuleId(preferred);
        } else if (cached.rules[0]?._id) {
          setSelectedRuleId(cached.rules[0]._id);
        } else {
          setSelectedRuleId("");
        }
        return cached.rules;
      }

      const res = await getLatePenaltyRules(businessId);
      const rows = Array.isArray(res?.rules) ? res.rules : [];
      setRules(rows);
      rulesCache.set(businessId, { rules: rows, loadedAt: Date.now() });

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

  const loadBatches = useCallback(async ({ force = false } = {}) => {
    if (!businessId) {
      setBatches([]);
      return [];
    }
    const cached = batchesCache.get(businessId);
    if (!force && cached && Date.now() - cached.loadedAt < STALE_MS) {
      setBatches(cached.batches);
      return cached.batches;
    }
    const res = await getLatePenaltyBatches(businessId);
    const rows = Array.isArray(res?.batches) ? res.batches : [];
    setBatches(rows);
    batchesCache.set(businessId, { batches: rows, loadedAt: Date.now() });
    return rows;
  }, [businessId]);

  useEffect(() => {
    loadRules().catch((error) => toast.error(getErrorMessage(error, "Failed to load late penalty rules.")));
    loadBatches().catch((error) => toast.error(getErrorMessage(error, "Failed to load late penalty batches.")));
  }, [loadRules, loadBatches]);

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

  const processedPenaltyTotalPages = Math.max(1, Math.ceil(filteredProcessedPenaltyRows.length / pageSize));
  const safeProcessedPenaltyPage = Math.min(processedPenaltyPage, processedPenaltyTotalPages);
  const processedPenaltyStartIndex = filteredProcessedPenaltyRows.length ? (safeProcessedPenaltyPage - 1) * pageSize : 0;
  const currentProcessedPenaltyRows = filteredProcessedPenaltyRows.slice(
    processedPenaltyStartIndex,
    processedPenaltyStartIndex + pageSize
  );

  const processedBatchTotalPages = Math.max(1, Math.ceil(filteredBatches.length / pageSize));
  const safeProcessedBatchPage = Math.min(processedBatchPage, processedBatchTotalPages);
  const processedBatchStartIndex = filteredBatches.length ? (safeProcessedBatchPage - 1) * pageSize : 0;
  const currentProcessedBatchRows = filteredBatches.slice(
    processedBatchStartIndex,
    processedBatchStartIndex + pageSize
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
      await loadBatches({ force: true });
      if (res?.batch?._id) {
        setWorkspaceView("processed_batches");
        setBatchSearch(res?.batch?.batchName || "");
      }
      await handlePreview();
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to process late penalties."));
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
      await loadBatches({ force: true });
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to delete late penalty batch."));
    } finally {
      setLoading(false);
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
      await loadBatches({ force: true });
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
      const res = await deleteLatePenaltiesBatch({
        business: businessId,
        itemIds,
      });
      toast.success(res?.message || "Selected late penalties deleted successfully.");
      setSelectedBatchRows({});
      await loadBatches({ force: true });
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
          <ListToolbar>
            <AppSelect
              value={workspaceView}
              onChange={(v) => { setWorkspaceView(v ?? "processed_penalties"); setSelectedBatchRows({}); }}
              options={[
                { value: "processed_penalties", label: "Processed penalties" },
                { value: "processed_batches", label: "Processed batches" },
                { value: "rules", label: "Rules / preview / process" },
              ]}
              compact
            />
            <ListToolbar.Divider />
            {[
              { label: "Processed", value: processedPenaltyStats.totalRows },
              { label: "Active", value: processedPenaltyStats.activeRows },
              { label: "Reversed", value: processedPenaltyStats.reversedRows },
              { label: "Deleted", value: processedPenaltyStats.deletedRows },
              { label: "Amount", value: formatCurrency(processedPenaltyStats.activeAmount) },
            ].map((item) => (
              <span key={item.label} className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                {item.label}: {item.value}
              </span>
            ))}
            {workspaceView === "processed_penalties" && (
              <>
                  <ListToolbar.Input
                    width="w-44"
                    value={penaltySearch}
                    onChange={(e) => setPenaltySearch(e.target.value)}
                    placeholder="Batch, tenant, penalty invoice, property, unit"
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
                  <ListToolbar.Divider />
                  <ListToolbar.Button
                    variant="outline"
                    onClick={() => runReverseForItems(selectedProcessedItemIds)}
                    disabled={processingBatchAction || selectedProcessedItemIds.length === 0}
                  >
                    Reverse selected
                  </ListToolbar.Button>
                  <ListToolbar.Button
                    variant="danger"
                    onClick={() => runDeleteForItems(selectedProcessedItemIds)}
                    disabled={processingBatchAction || selectedProcessedItemIds.length === 0}
                  >
                    Delete selected
                  </ListToolbar.Button>
                  <ListToolbar.Button
                    variant="outline"
                    onClick={() => setCommunicationModal({ contextType: "penalty_invoice", recordIds: selectedProcessedItemIds, title: `Notify ${selectedProcessedItemIds.length} Tenant${selectedProcessedItemIds.length !== 1 ? "s" : ""}`, subtitle: "Send late penalty notice via SMS.", allowedChannels: ["sms", "email"], defaultChannel: "sms" })}
                    disabled={selectedProcessedItemIds.length === 0}
                  >
                    SMS
                  </ListToolbar.Button>
                  <ListToolbar.Button
                    variant="outline"
                    onClick={() => setCommunicationModal({ contextType: "penalty_invoice", recordIds: selectedProcessedItemIds, title: `Email ${selectedProcessedItemIds.length} Tenant${selectedProcessedItemIds.length !== 1 ? "s" : ""}`, subtitle: "Send late penalty notice via email.", allowedChannels: ["email"], defaultChannel: "email" })}
                    disabled={selectedProcessedItemIds.length === 0}
                  >
                    Email
                  </ListToolbar.Button>
              </>
            )}
            {workspaceView === "processed_batches" && (
              <>
                <ListToolbar.Input
                  width="w-44"
                  value={batchSearch}
                  onChange={(e) => setBatchSearch(e.target.value)}
                  placeholder="Batch name, rule, status"
                />
                <AppSelect
                  value={batchStatusFilter !== "all" ? batchStatusFilter : ""}
                  onChange={(v) => setBatchStatusFilter(v ?? "all")}
                  options={[
                    { value: "processed", label: "Processed" },
                    { value: "partial", label: "Partial" },
                    { value: "failed", label: "Failed" },
                    { value: "reversed_ready", label: "Reversed ready" },
                  ]}
                  placeholder="All batch statuses"
                  clearable
                  compact
                />
              </>
            )}
            {workspaceView === "rules" && (
              <>
                <AppSelect
                  value={selectedRuleId}
                  onChange={(v) => setSelectedRuleId(v ?? "")}
                  options={rules.map((rule) => ({ value: rule._id, label: rule.ruleName }))}
                  placeholder="Select rule"
                  searchable
                  clearable
                  compact
                />
                <ListToolbar.Input
                  type="date"
                  width="w-28"
                  value={runDate}
                  onChange={(e) => setRunDate(e.target.value)}
                />
                <span className="shrink-0 border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                  {selectedCount} row(s) · {formatCurrency(selectedPenaltyAmount)}
                </span>
                <ListToolbar.Divider />
                <ListToolbar.Button icon={FaEye} onClick={handlePreview} disabled={loading}>
                  Preview
                </ListToolbar.Button>
                <ListToolbar.Button
                  icon={FaCheckSquare}
                  variant="accent"
                  onClick={handleProcess}
                  disabled={loading || selectedCount === 0}
                >
                  Process Selected
                </ListToolbar.Button>
              </>
            )}
          </ListToolbar>
          <div className="flex min-h-0 flex-1 flex-col">
            {workspaceView === "processed_penalties" ? (
              <>

                <MilikTable
                  columns={[
                    { label: "Batch", width: "15%" },
                    { label: "Tenant", width: "15%" },
                    { label: "Property / Unit", width: "15%" },
                    { label: "Penalty invoice", width: "14%" },
                    { label: "Penalty", align: "right", width: "9%" },
                    { label: "Run date", align: "center", width: "9%" },
                    { label: "Status", align: "center", width: "8%" },
                    { label: "Reason", width: "15%" },
                  ]}
                  rows={currentProcessedPenaltyRows}
                  rowKey="_id"
                  loading={loading && currentProcessedPenaltyRows.length === 0}
                  empty="No processed late penalties match the current filters."
                  checkboxes
                  allChecked={allProcessedRowsSelected}
                  someChecked={selectedProcessedItemIds.length > 0 && !allProcessedRowsSelected}
                  onCheckAll={toggleAllProcessedPenaltyRows}
                  isChecked={(row) => !!selectedBatchRows[String(row._id)]}
                  isSelected={(row) => !!selectedBatchRows[String(row._id)]}
                  onCheckRow={(row) => String(row?.displayStatus || "").toLowerCase() === "processed" && toggleProcessedPenaltyRow(String(row._id))}
                  onRowClick={(row) => String(row?.displayStatus || "").toLowerCase() === "processed" && toggleProcessedPenaltyRow(String(row._id))}
                  renderRow={(row) => (
                    <>
                      <td className="px-3 py-1.5 border-r border-gray-100">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setWorkspaceView("processed_batches"); setBatchSearch(row.batchName); }}
                          className="font-bold text-[#0B3B2E] hover:underline"
                        >
                          {row.batchName}
                        </button>
                        <span className="ml-2 text-[10px] text-slate-500">{row.ruleName}</span>
                      </td>
                      <td className="px-3 py-1.5 border-r border-gray-100">
                        <span className="font-semibold text-slate-900">{row.tenantName}</span>
                        <span className="ml-2 text-[10px] text-slate-500">{row.tenantCode || "-"}</span>
                      </td>
                      <td className="px-3 py-1.5 border-r border-gray-100 font-semibold text-slate-900">
                        {row.propertyName}
                        <span className="ml-1.5 font-normal text-slate-500">· {row.unitNumber}</span>
                      </td>
                      <td className="px-3 py-1.5 border-r border-gray-100 font-semibold text-slate-900">
                        {row.penaltyInvoiceNumber}
                        {row.sourceInvoiceNumber && <span className="ml-1.5 font-normal text-slate-500">from {row.sourceInvoiceNumber}</span>}
                      </td>
                      <td className="px-3 py-1.5 border-r border-gray-100 text-right font-semibold tabular-nums text-slate-900">{formatCurrency(row.calculatedPenalty)}</td>
                      <td className="px-3 py-1.5 border-r border-gray-100 text-center text-slate-700">{fmtDate(row.batchRunDate)}</td>
                      <td className="px-3 py-1.5 border-r border-gray-100 text-center">
                        <StatusBadge status={row.displayStatus} map={PENALTY_STATUS_MAP} />
                      </td>
                      <td className="px-3 py-1.5 text-slate-600">{row.reason || "-"}</td>
                    </>
                  )}
                />

                <PaginationBar
                  page={safeProcessedPenaltyPage}
                  pages={processedPenaltyTotalPages}
                  total={filteredProcessedPenaltyRows.length}
                  pageSize={pageSize}
                  onPageChange={setProcessedPenaltyPage}
                  onPageSizeChange={(n) => { setPageSize(n); setProcessedPenaltyPage(1); }}
                  loading={loading}
                  label="penalties"
                />
              </>
            ) : null}

            {workspaceView === "processed_batches" ? (
              <>
                <MilikTable
                  columns={[
                    { label: "Batch", width: "20%" },
                    { label: "Rule", width: "14%" },
                    { label: "Run date", align: "center", width: "9%" },
                    { label: "Invoices", align: "right", width: "8%" },
                    { label: "Amount", align: "right", width: "12%" },
                    { label: "Status", align: "center", width: "9%" },
                    { label: "Delete status", width: "16%" },
                  ]}
                  rows={currentProcessedBatchRows}
                  rowKey="_id"
                  loading={loading && currentProcessedBatchRows.length === 0}
                  empty="No late penalty batches match the current filters."
                  onRowClick={(batch) => { setWorkspaceView("processed_penalties"); setPenaltySearch(batch.batchName || ""); }}
                  actionsWidth="90px"
                  renderRow={(batch) => (
                    <>
                      <td className="px-3 py-1.5 border-r border-gray-100">
                        <p className="font-bold text-[#0B3B2E]">{batch.batchName}</p>
                        <p className="mt-0.5 text-[10px] text-slate-500">
                          {(Array.isArray(batch?.items) ? batch.items.length : 0).toLocaleString()} penalty rows
                        </p>
                      </td>
                      <td className="px-3 py-1.5 border-r border-gray-100 font-semibold text-slate-900">{batch.ruleName || batch.rule?.ruleName || "-"}</td>
                      <td className="px-3 py-1.5 border-r border-gray-100 text-center text-slate-700">{fmtDate(batch.runDate)}</td>
                      <td className="px-3 py-1.5 border-r border-gray-100 text-right font-semibold text-slate-800">{Number(batch.invoicesCreatedCount || 0)}</td>
                      <td className="px-3 py-1.5 border-r border-gray-100 text-right font-semibold text-slate-900">{formatCurrency(batch.totalPenaltyAmount)}</td>
                      <td className="px-3 py-1.5 border-r border-gray-100 text-center">
                        <StatusBadge status={batch.status || "processed"} map={PENALTY_STATUS_MAP} />
                      </td>
                      <td className="px-3 py-1.5 text-slate-600">
                        {batch?.canDeleteBatch ? (
                          <span className="font-medium text-emerald-700">Ready to delete</span>
                        ) : (
                          <span className="text-amber-700">{batchDeleteSummary(batch) || "Clear linked invoices first."}</span>
                        )}
                      </td>
                    </>
                  )}
                  renderActions={(batch) => (
                    <button
                      type="button"
                      onClick={() => handleDeleteBatch(batch)}
                      disabled={!batch?.canDeleteBatch}
                      className={`h-6 border px-2 text-[10px] font-bold ${
                        batch?.canDeleteBatch
                          ? "border-rose-300 bg-white text-rose-600 hover:bg-rose-50"
                          : "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
                      }`}
                    >
                      <FaTrash className="inline" size={8} /> Delete
                    </button>
                  )}
                />

                <PaginationBar
                  page={safeProcessedBatchPage}
                  pages={processedBatchTotalPages}
                  total={filteredBatches.length}
                  pageSize={pageSize}
                  onPageChange={setProcessedBatchPage}
                  onPageSizeChange={(n) => { setPageSize(n); setProcessedBatchPage(1); }}
                  loading={loading}
                  label="batches"
                />
              </>
            ) : null}

            {workspaceView === "rules" ? (
              <MilikTable
                columns={[
                  { label: "Source invoice", width: "13%" },
                  { label: "Tenant", width: "15%" },
                  { label: "Property", width: "13%" },
                  { label: "Unit", width: "8%" },
                  { label: "Overdue days", align: "center", width: "9%" },
                  { label: "Outstanding", align: "right", width: "12%" },
                  { label: "Penalty", align: "right", width: "12%" },
                  { label: "Status / reason", width: "18%" },
                ]}
                rows={preview?.rows || []}
                rowKey="sourceInvoiceId"
                loading={loading && !(preview?.rows?.length)}
                empty={
                  <>
                    No preview yet. Select a rule and click <span className="font-semibold">Preview</span>.
                  </>
                }
                checkboxes
                allChecked={allPreviewRowsSelected}
                someChecked={selectedCount > 0 && !allPreviewRowsSelected}
                onCheckAll={() => {
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
                isChecked={(row) => !!selectedRows[row.sourceInvoiceId]}
                isSelected={(row) => !!selectedRows[row.sourceInvoiceId]}
                onCheckRow={(row) => !row.skippedReason && togglePreviewRow(row.sourceInvoiceId)}
                rowClassName={(row) => (row.skippedReason ? "opacity-60" : "")}
                renderRow={(row) => (
                  <>
                    <td className="px-3 py-1.5 border-r border-gray-100 font-semibold text-slate-900">{row.sourceInvoiceNumber}</td>
                    <td className="px-3 py-1.5 border-r border-gray-100">
                      <span className="font-semibold text-slate-900">{row.tenantName}</span>
                      <span className="ml-2 text-[10px] text-slate-500">{row.tenantCode || "-"}</span>
                    </td>
                    <td className="px-3 py-1.5 border-r border-gray-100 font-semibold text-slate-800">{row.propertyName}</td>
                    <td className="px-3 py-1.5 border-r border-gray-100 text-slate-700">{row.unitNumber}</td>
                    <td className="px-3 py-1.5 border-r border-gray-100 text-center text-slate-700">{row.overdueDays}</td>
                    <td className="px-3 py-1.5 border-r border-gray-100 text-right font-semibold text-slate-900">{formatCurrency(row.outstandingBalance)}</td>
                    <td className="px-3 py-1.5 border-r border-gray-100 text-right font-semibold text-slate-900">{formatCurrency(row.calculatedPenalty)}</td>
                    <td className="px-3 py-1.5">
                      {row.skippedReason ? (
                        <span className="inline-flex items-center gap-1.5 border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                          <FaExclamationTriangle size={8} /> {row.skippedReason}
                        </span>
                      ) : (
                        <span className="inline-flex border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                          Ready
                        </span>
                      )}
                    </td>
                  </>
                )}
              />
            ) : null}
          </div>
        </div>
      </div>

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
