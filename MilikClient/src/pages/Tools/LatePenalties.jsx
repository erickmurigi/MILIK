import React, { useCallback, useEffect, useMemo, useState } from "react";
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
} from "react-icons/fa";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import CommunicationComposerModal from "../../components/Communications/CommunicationComposerModal";
import {
  createLatePenaltyRule,
  getLatePenaltyBatch,
  getLatePenaltyBatches,
  getLatePenaltyPostingAccounts,
  getLatePenaltyRules,
  processLatePenalties,
  previewLatePenalties,
  updateLatePenaltyRule,
} from "../../redux/apiCalls";

const cardClass = "rounded-3xl border border-slate-200 bg-white shadow-sm";
const inputClass = "w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 shadow-sm transition focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100";
const labelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500";

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

const ruleModeLabels = {
  rent_only: "Rent only",
  current_period_rent_only: "Current period rent only",
  current_period_bill_balance_only: "Current period bill balance only",
  all_arrears: "All arrears",
  outstanding_invoice_balance: "Outstanding invoice balance",
};

const calcTypeLabels = {
  flat_amount: "Flat amount",
  percentage_overdue_balance: "Percentage of overdue balance",
  daily_fixed_amount: "Daily fixed amount",
  daily_percentage: "Daily percentage",
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

const LatePenalties = () => {
  const { currentCompany } = useSelector((state) => state.company || {});

  const businessId = currentCompany?._id || "";
  const [accounts, setAccounts] = useState([]);
  const [rules, setRules] = useState([]);
  const [batches, setBatches] = useState([]);
  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [ruleForm, setRuleForm] = useState(defaultRuleForm);
  const [editingRuleId, setEditingRuleId] = useState("");
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [runDate, setRunDate] = useState(new Date().toISOString().slice(0, 10));
  const [preview, setPreview] = useState(null);
  const [selectedRows, setSelectedRows] = useState({});
  const [loading, setLoading] = useState(false);
  const [savingRule, setSavingRule] = useState(false);
  const [batchDetail, setBatchDetail] = useState(null);
  const [workspaceView, setWorkspaceView] = useState("operations");
  const [communicationModal, setCommunicationModal] = useState(null);

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
      return;
    }
    const res = await getLatePenaltyBatches(businessId);
    setBatches(Array.isArray(res?.batches) ? res.batches : []);
  }, [businessId]);

  const loadAccounts = useCallback(async () => {
    if (!businessId) {
      setAccounts([]);
      return;
    }

    const res = await getLatePenaltyPostingAccounts(businessId);
    const rows = Array.isArray(res)
      ? res
      : Array.isArray(res?.accounts)
      ? res.accounts
      : [];
    setAccounts(rows);
  }, [businessId]);

  useEffect(() => {
    loadRules().catch((error) => toast.error(error?.response?.data?.message || error.message || "Failed to load late penalty rules."));
    loadBatches().catch((error) => toast.error(error?.response?.data?.message || error.message || "Failed to load late penalty batches."));
    loadAccounts().catch((error) => toast.error(error?.response?.data?.message || error.message || "Failed to load late penalty posting accounts."));
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

  const selectedCount = useMemo(() => Object.values(selectedRows).filter(Boolean).length, [selectedRows]);
  const selectedPenaltyAmount = useMemo(() => {
    if (!preview?.rows) return 0;
    return preview.rows
      .filter((row) => selectedRows[row.sourceInvoiceId])
      .reduce((sum, row) => sum + Number(row.calculatedPenalty || 0), 0);
  }, [preview, selectedRows]);

  const toggleRow = (rowId) => setSelectedRows((prev) => ({ ...prev, [rowId]: !prev[rowId] }));

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
      toast.error(error?.response?.data?.message || error.message || "Failed to preview late penalties.");
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
        setWorkspaceView("operations");
        await openBatch(res.batch._id);
      } else {
        setBatchDetail(res?.batch || null);
      }
      await handlePreview();
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message || "Failed to process late penalties.");
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
      if (savedRuleId) {
        setSelectedRuleId(savedRuleId);
      }
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message || "Failed to save late penalty rule.");
    } finally {
      setSavingRule(false);
    }
  };

  const openBatch = async (batchId) => {
    try {
      setLoading(true);
      setWorkspaceView("operations");
      const res = await getLatePenaltyBatch(batchId, businessId);
      setBatchDetail(res?.batch || null);
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message || "Failed to load late penalty batch.");
    } finally {
      setLoading(false);
    }
  };


const allPreviewRowsSelected = !!preview?.rows?.length && preview.rows.every((row) => row.skippedReason || selectedRows[row.sourceInvoiceId]);

return (
  <DashboardLayout>
    <div className="space-y-4">
      <div className={`${cardClass} px-4 py-4 md:px-5`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.24em] text-slate-500">Late penalty workspace</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Late Penalties</h1>
            <p className="mt-1 text-sm text-slate-500">
              Operational batch review is the default workspace. Switch to rules, preview, and process only when you need to prepare a run.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setWorkspaceView("operations")}
              className={`rounded-lg border px-3 py-2 text-xs font-bold transition ${
                workspaceView === "operations"
                  ? "border-[#0B3B2E] bg-[#E7F5EC] text-[#0B3B2E]"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              Invoices / Batch History / Batch Detail
            </button>
            <button
              type="button"
              onClick={() => setWorkspaceView("rules")}
              className={`rounded-lg border px-3 py-2 text-xs font-bold transition ${
                workspaceView === "rules"
                  ? "border-orange-300 bg-orange-50 text-orange-700"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              Rules / Preview / Process
            </button>
            <button
              type="button"
              onClick={openNewRuleModal}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              <FaPlus /> Add Rule
            </button>
            <button
              type="button"
              onClick={loadBatches}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              <FaHistory /> Refresh Batches
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Saved rules</p>
            <p className="mt-1 text-xl font-bold text-slate-900">{rules.length}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Processed batches</p>
            <p className="mt-1 text-xl font-bold text-slate-900">{batches.length}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Selected rule</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{selectedRule?.ruleName || "No rule selected"}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Run date</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{formatDate(runDate)}</p>
          </div>
        </div>
      </div>

      {workspaceView === "operations" ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(320px,0.92fr)_minmax(0,1.58fr)]">
          <div className={`${cardClass} p-4`}>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Processed batch history</h2>
                <p className="text-xs text-slate-500">Open a processed batch to inspect the invoices that make up that run.</p>
              </div>
              <FaHistory className="text-slate-500" />
            </div>

            <div className="max-h-[calc(100vh-250px)] overflow-y-auto rounded-2xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 font-bold uppercase tracking-[0.16em] text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Batch</th>
                    <th className="px-3 py-2 text-left">Rule / Date</th>
                    <th className="px-3 py-2 text-right">Invoices</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {batches.map((batch) => (
                    <tr
                      key={batch._id}
                      onClick={() => openBatch(batch._id)}
                      className={`cursor-pointer transition ${
                        String(batchDetail?._id || "") === String(batch._id)
                          ? "bg-orange-50/80"
                          : "hover:bg-slate-50"
                      }`}
                    >
                      <td className="px-3 py-2 align-top">
                        <p className="font-semibold text-slate-900">{batch.batchName}</p>
                        <p className="text-[11px] text-slate-500">{batch.status || "processed"}</p>
                      </td>
                      <td className="px-3 py-2 align-top text-[11px] text-slate-600">
                        <p className="font-medium text-slate-700">{batch.ruleName || batch.rule?.ruleName || "-"}</p>
                        <p>{formatDate(batch.runDate)}</p>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-700">{Number(batch.invoicesCreatedCount || 0)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-900">{formatCurrency(batch.totalPenaltyAmount)}</td>
                    </tr>
                  ))}
                  {!batches.length ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-8 text-center text-sm text-slate-500">No late penalty batches processed yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className={`${cardClass} p-4`}>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Batch detail</h2>
                <p className="text-xs text-slate-500">Compact invoice-level review with direct communication actions where the penalty invoice exists.</p>
              </div>
              <FaEye className="text-slate-500" />
            </div>

            {batchDetail ? (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Batch</p>
                    <p className="mt-1 font-semibold text-slate-900">{batchDetail.batchName}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Rule</p>
                    <p className="mt-1 font-semibold text-slate-900">{batchDetail.ruleName || batchDetail.rule?.ruleName || "-"}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Status</p>
                    <p className="mt-1 font-semibold text-slate-900">{batchDetail.status}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Total amount</p>
                    <p className="mt-1 font-semibold text-slate-900">{formatCurrency(batchDetail.totalPenaltyAmount)}</p>
                  </div>
                </div>

                <div className="max-h-[calc(100vh-320px)] overflow-auto rounded-2xl border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-xs">
                    <thead className="sticky top-0 z-10 bg-slate-50 font-bold uppercase tracking-[0.16em] text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-left">Source Invoice</th>
                        <th className="px-3 py-2 text-left">Tenant / Property / Unit</th>
                        <th className="px-3 py-2 text-left">Penalty Invoice</th>
                        <th className="px-3 py-2 text-right">Amount</th>
                        <th className="px-3 py-2 text-left">Status</th>
                        <th className="px-3 py-2 text-left">Reason</th>
                        <th className="px-3 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {(batchDetail.items || []).map((item) => (
                        <tr key={item._id} className="align-top hover:bg-slate-50">
                          <td className="px-3 py-2 font-semibold text-slate-900">{item.sourceInvoiceNumber || item?.sourceInvoice?.invoiceNumber || "-"}</td>
                          <td className="px-3 py-2 text-[11px] text-slate-600">
                            <p className="font-medium text-slate-800">{item.tenant?.name || item.tenantName || "-"}</p>
                            <p>{item.property?.propertyName || "-"} / {item.unit?.unitNumber || "-"}</p>
                          </td>
                          <td className="px-3 py-2 text-[11px] text-slate-600">{item?.penaltyInvoice?.invoiceNumber || "-"}</td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-900">{formatCurrency(item.calculatedPenalty)}</td>
                          <td className="px-3 py-2 text-[11px] text-slate-600">{item.status || "-"}</td>
                          <td className="px-3 py-2 text-[11px] text-slate-600">{item.reason || "-"}</td>
                          <td className="px-3 py-2">
                            {item?.penaltyInvoice?._id ? (
                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => setCommunicationModal({
                                    contextType: "penalty_invoice",
                                    recordIds: [item.penaltyInvoice._id],
                                    title: "Send Penalty Notice SMS",
                                    subtitle: "Preview the final penalty notice SMS before sending.",
                                    allowedChannels: ["sms"],
                                    defaultChannel: "sms",
                                  })}
                                  className="inline-flex items-center gap-1 rounded-lg bg-orange-500 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-orange-600"
                                >
                                  <FaSms /> SMS
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setCommunicationModal({
                                    contextType: "penalty_invoice",
                                    recordIds: [item.penaltyInvoice._id],
                                    title: "Send Penalty Notice Email",
                                    subtitle: "Preview the final penalty notice email before sending.",
                                    allowedChannels: ["email"],
                                    defaultChannel: "email",
                                  })}
                                  className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-700"
                                >
                                  <FaEnvelope /> Email
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {!(batchDetail.items || []).length ? (
                        <tr>
                          <td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-500">This batch has no processed items.</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-16 text-center text-sm text-slate-500">
                Click a processed batch to view the invoices that make up that batch.
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className={`${cardClass} p-4 md:p-5`}>
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Rules and run setup</h2>
                <p className="text-xs text-slate-500">Choose the rule, inspect its setup, then preview or process using the selected run date.</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={selectedRuleId}
                  onChange={(e) => setSelectedRuleId(e.target.value)}
                  className={`${inputClass} min-w-[240px]`}
                >
                  <option value="">Select a rule</option>
                  {rules.map((rule) => (
                    <option key={rule._id} value={rule._id}>
                      {rule.ruleName}
                    </option>
                  ))}
                </select>
                <div className="min-w-[180px]">
                  <label className={labelClass}>Run date</label>
                  <input type="date" className={inputClass} value={runDate} onChange={(e) => setRunDate(e.target.value)} />
                </div>
                {selectedRule ? (
                  <button
                    type="button"
                    onClick={() => openEditRuleModal(selectedRule)}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                  >
                    <FaPen /> Edit Selected Rule
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={handlePreview}
                  disabled={loading || !selectedRuleId}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <FaEye /> Preview Penalties
                </button>
                <button
                  type="button"
                  onClick={handleProcess}
                  disabled={loading || !selectedCount}
                  className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-3 py-2 text-xs font-bold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <FaCheckSquare /> Process Selected
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Eligible rows</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{preview?.summary?.eligibleCount || 0}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Skipped rows</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{preview?.summary?.skippedCount || 0}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected count</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{selectedCount}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected penalty</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{formatCurrency(selectedPenaltyAmount)}</p>
              </div>
            </div>
          </div>

          <div className={`${cardClass} p-4 md:p-5`}>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Saved penalty rules</h2>
                <p className="text-xs text-slate-500">Click a rule tile to make it active for preview and processing.</p>
              </div>
              <FaCalendarAlt className="text-slate-500" />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {rules.map((rule) => {
                const active = String(selectedRuleId) === String(rule._id);
                return (
                  <button
                    key={rule._id}
                    onClick={() => setSelectedRuleId(rule._id)}
                    className={`rounded-3xl border p-5 text-left transition ${
                      active
                        ? "border-orange-300 bg-gradient-to-br from-orange-50 via-white to-emerald-50 shadow-md"
                        : "border-slate-200 bg-white hover:border-orange-200 hover:shadow-sm"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-base font-semibold text-slate-900">{rule.ruleName}</p>
                        <p className="mt-1 text-sm text-slate-500">{ruleModeLabels[rule.penalizeItem] || "Rule"}</p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${rule.active !== false ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                        {rule.active !== false ? "Active" : "Inactive"}
                      </span>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-600">
                      <div className="rounded-2xl bg-slate-50 px-3 py-2">
                        <p className="text-xs uppercase tracking-wide text-slate-500">Calculation</p>
                        <p className="mt-1 font-semibold text-slate-800">{calcTypeLabels[rule.calculationType] || "-"}</p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 px-3 py-2">
                        <p className="text-xs uppercase tracking-wide text-slate-500">Rate / amount</p>
                        <p className="mt-1 font-semibold text-slate-800">{Number(rule.rateOrAmount || 0)}</p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 px-3 py-2">
                        <p className="text-xs uppercase tracking-wide text-slate-500">Grace days</p>
                        <p className="mt-1 font-semibold text-slate-800">{Number(rule.graceDays || 0)}</p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 px-3 py-2">
                        <p className="text-xs uppercase tracking-wide text-slate-500">Min overdue</p>
                        <p className="mt-1 font-semibold text-slate-800">{Number(rule.minimumOverdueDays || 0)}</p>
                      </div>
                    </div>
                    <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                      <span>Effective {formatDate(rule.effectiveFrom)}</span>
                      <span>{rule.repeatFrequency || "manual"}</span>
                    </div>
                  </button>
                );
              })}
              {!rules.length ? (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center text-sm text-slate-500 md:col-span-2">
                  No rules saved yet. Click <span className="font-semibold text-slate-700">Add Rule</span> to create your first late penalty rule.
                </div>
              ) : null}
            </div>
          </div>

          <div className={`${cardClass} p-4 md:p-5`}>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Preview and process</h2>
                <p className="text-xs text-slate-500">Full-width preview workspace with more room for review before posting penalty invoices.</p>
              </div>
              <FaBolt className="text-slate-500" />
            </div>

            <div className="overflow-x-auto rounded-3xl border border-slate-200">
              <table className="min-w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-600">
                    <th className="sticky left-0 z-10 border-b border-slate-200 bg-slate-50 px-3 py-2 text-left">
                      <input
                        type="checkbox"
                        checked={allPreviewRowsSelected}
                        onChange={() => {
                          const next = {};
                          const shouldSelectAll = !allPreviewRowsSelected;
                          (preview?.rows || []).forEach((row) => {
                            if (!row.skippedReason && Number(row.calculatedPenalty || 0) > 0) next[row.sourceInvoiceId] = shouldSelectAll;
                          });
                          setSelectedRows(next);
                        }}
                      />
                    </th>
                    {["Source Invoice", "Tenant", "Property / Unit", "Due Date", "Overdue Days", "Outstanding", "Calculated Penalty", "Skipped / Reason"].map((label) => (
                      <th key={label} className="border-b border-slate-200 px-3 py-2 text-left font-semibold">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(preview?.rows || []).map((row) => {
                    const selected = !!selectedRows[row.sourceInvoiceId];
                    return (
                      <tr
                        key={row.sourceInvoiceId}
                        onClick={() => !row.skippedReason && toggleRow(row.sourceInvoiceId)}
                        className={`cursor-pointer border-b border-slate-100 ${selected ? "bg-orange-50" : "hover:bg-slate-50"}`}
                      >
                        <td className="sticky left-0 z-10 border-b border-slate-100 bg-inherit px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={!!row.skippedReason}
                            onChange={() => toggleRow(row.sourceInvoiceId)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2 font-semibold text-slate-900">{row.sourceInvoiceNumber}</td>
                        <td className="border-b border-slate-100 px-3 py-2">{row.tenantName}</td>
                        <td className="border-b border-slate-100 px-3 py-2">{row.propertyName} / {row.unitNumber}</td>
                        <td className="border-b border-slate-100 px-3 py-2">{formatDate(row.dueDate)}</td>
                        <td className="border-b border-slate-100 px-3 py-2">{row.overdueDays}</td>
                        <td className="border-b border-slate-100 px-3 py-2">{formatCurrency(row.outstandingBalance)}</td>
                        <td className="border-b border-slate-100 px-3 py-2 font-semibold text-slate-900">{formatCurrency(row.calculatedPenalty)}</td>
                        <td className="border-b border-slate-100 px-3 py-2">
                          {row.skippedReason ? (
                            <span className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                              <FaExclamationTriangle /> {row.skippedReason}
                            </span>
                          ) : (
                            <span className="text-emerald-700">Ready</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {!preview?.rows?.length ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                        No preview yet. Select a rule and click <span className="font-semibold">Preview Penalties</span>.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>

      {showRuleModal ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/20 px-4 py-6 backdrop-blur-[10px]">
          <div className="relative max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-[32px] border border-white/40 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 bg-gradient-to-r from-[#0B3B2E] via-slate-900 to-orange-500 px-6 py-5 text-white">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-orange-100">Milik rule setup</p>
                <h2 className="mt-2 text-2xl font-bold">{editingRuleId ? "Edit late penalty rule" : "Add late penalty rule"}</h2>
                <p className="mt-1 text-sm text-slate-200">A focused modal for quick setup without leaving the penalties workspace.</p>
              </div>
              <button
                onClick={() => !savingRule && setShowRuleModal(false)}
                className="rounded-2xl border border-white/15 bg-white/10 p-3 text-white hover:bg-white/20"
                type="button"
              >
                <FaTimes />
              </button>
            </div>

            <div className="max-h-[calc(92vh-100px)] overflow-y-auto px-6 py-6">
              <div className="mb-5 grid grid-cols-1 gap-3 lg:grid-cols-3">
                <div className="rounded-2xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm text-slate-700">
                  <p className="font-semibold text-slate-900">Grace days</p>
                  <p className="mt-1">Days allowed after due date before penalty counting begins.</p>
                </div>
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-slate-700">
                  <p className="font-semibold text-slate-900">Minimum overdue days</p>
                  <p className="mt-1">Extra threshold after grace. The row must still reach this number to qualify.</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
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
                      <select
                        className={inputClass}
                        value={ruleForm.postingAccount}
                        onChange={(e) => setRuleForm((prev) => ({ ...prev, postingAccount: e.target.value }))}
                      >
                        <option value="">Select account</option>
                        {incomeAccounts.map((account) => (
                          <option key={account._id} value={account._id}>
                            {account.code ? `${account.code} · ` : ""}
                            {account.name}
                          </option>
                        ))}
                      </select>
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
                    <select className={inputClass} value={ruleForm.penalizeItem} onChange={(e) => setRuleForm((prev) => ({ ...prev, penalizeItem: e.target.value }))}>
                      <option value="rent_only">Rent only</option>
                      <option value="current_period_rent_only">Current period rent only</option>
                      <option value="current_period_bill_balance_only">Current period bill balance only</option>
                      <option value="all_arrears">All arrears</option>
                      <option value="outstanding_invoice_balance">Outstanding invoice balance</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Calculation type</label>
                      <select className={inputClass} value={ruleForm.calculationType} onChange={(e) => setRuleForm((prev) => ({ ...prev, calculationType: e.target.value }))}>
                        <option value="flat_amount">Flat amount</option>
                        <option value="percentage_overdue_balance">Percentage of overdue balance</option>
                        <option value="daily_fixed_amount">Daily fixed amount</option>
                        <option value="daily_percentage">Daily percentage</option>
                      </select>
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

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Repeat frequency</label>
                      <select className={inputClass} value={ruleForm.repeatFrequency} onChange={(e) => setRuleForm((prev) => ({ ...prev, repeatFrequency: e.target.value }))}>
                        <option value="manual">Manual</option>
                        <option value="daily">Daily</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>Rule status</label>
                      <select className={inputClass} value={ruleForm.active ? "yes" : "no"} onChange={(e) => setRuleForm((prev) => ({ ...prev, active: e.target.value === "yes" }))}>
                        <option value="yes">Active</option>
                        <option value="no">Inactive</option>
                      </select>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <label className="flex items-center gap-3 text-sm font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={false}
                        disabled
                        readOnly
                      />
                      Apply automatically when scheduled
                    </label>
                    <p className="mt-2 text-xs text-slate-500">
                      Scheduled automation is not active yet. Rules save and run manually from this workspace.
                    </p>
                  </div>

                  <div>
                    <label className={labelClass}>Notes</label>
                    <textarea
                      rows="6"
                      className={`${inputClass} resize-none`}
                      value={ruleForm.notes}
                      onChange={(e) => setRuleForm((prev) => ({ ...prev, notes: e.target.value }))}
                      placeholder="Optional internal note for staff using this rule"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-6 flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-500">
                  Save will keep the current page intact and refresh the rule list using the active company context.
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => setShowRuleModal(false)}
                    disabled={savingRule}
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-2.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    <FaTimes /> Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveRule}
                    disabled={savingRule || !incomeAccounts.length}
                    className="inline-flex items-center gap-2 rounded-2xl bg-orange-500 px-4 py-2.5 font-semibold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <FaSave /> {savingRule ? "Saving..." : editingRuleId ? "Update rule" : "Save rule"}
                  </button>
                </div>
              </div>
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
