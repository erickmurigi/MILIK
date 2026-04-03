import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { FaCheckCircle, FaDownload, FaFileAlt, FaPrint, FaSyncAlt } from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import {
  approveStatement,
  createDraftStatement,
  getLandlords,
  getStatement,
} from "../../redux/apiCalls";
import { getProperties } from "../../redux/propertyRedux";
import { adminRequests } from "../../utils/requestMethods";

const currency = (value) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 2,
  }).format(Number(value || 0));

const formatDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const sumSectionAmounts = (items = []) =>
  items.reduce((sum, item) => sum + Number(item?.amount || 0), 0);

const getStatementSettlement = (summary = {}) => {
  const netStatement = Number(summary?.netStatement || 0);
  const explicitRecovery = Math.max(
    Number(summary?.amountPayableByLandlordToManager || 0),
    0
  );
  const isNegative =
    Boolean(summary?.isNegativeStatement) || explicitRecovery > 0 || netStatement < 0;

  if (isNegative) {
    return {
      isNegative: true,
      label: summary?.settlementLabel || "Landlord owes manager",
      amount: explicitRecovery > 0 ? explicitRecovery : Math.abs(netStatement),
    };
  }

  return {
    isNegative: false,
    label: summary?.settlementLabel || "Net payable to landlord",
    amount: Number(
      summary?.amountPayableToLandlord ??
        summary?.netPayableToLandlord ??
        (netStatement > 0 ? netStatement : 0)
    ),
  };
};

const normalizeId = (value) => {
  if (!value) return "";
  if (typeof value === "object") return String(value._id || value.id || "");
  return String(value);
};

const monthOptions = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const toIsoDate = (date) => {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const buildPeriod = (month, year) => {
  const monthIndex = Number(month) - 1;
  const y = Number(year);
  const start = new Date(y, monthIndex, 1);
  return {
    periodStart: toIsoDate(start),
    periodEnd: "",
  };
};

const getMonthEndDate = (month, year) => {
  const monthIndex = Number(month) - 1;
  const y = Number(year);
  return new Date(y, monthIndex + 1, 0, 23, 59, 59, 999);
};

const getDefaultPeriodStart = ({ month, year, latestProcessedCutoffAt, propertyDateAcquired, todayIso }) => {
  const fallback = buildPeriod(month, year).periodStart;

  if (latestProcessedCutoffAt) {
    const latestCutoff = new Date(latestProcessedCutoffAt);
    if (!Number.isNaN(latestCutoff.getTime())) {
      return toIsoDate(latestCutoff);
    }
  }

  if (propertyDateAcquired) {
    const acquiredDate = new Date(propertyDateAcquired);
    if (!Number.isNaN(acquiredDate.getTime())) {
      acquiredDate.setHours(0, 0, 0, 0);
      const todayStart = new Date(`${todayIso}T00:00:00`);
      return toIsoDate(acquiredDate.getTime() > todayStart.getTime() ? todayStart : acquiredDate);
    }
  }

  return fallback;
};

const isFutureIsoDate = (value, todayIso) => Boolean(value) && value > todayIso;

const isSameMonthAndYear = (value, month, year) => {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.getMonth() + 1 === Number(month) && date.getFullYear() === Number(year);
};

const getPropertyLabel = (property) => {
  const code = property?.propertyCode ? `[${property.propertyCode}] ` : "";
  return `${code}${property?.propertyName || property?.name || "Unnamed Property"}`;
};


const toUtilityKey = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "other_utility";

const titleCase = (value = "") =>
  String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const normalizeRowUtilities = (row = {}) => {
  const map = {};

  if (row?.utilities && typeof row.utilities === "object") {
    Object.values(row.utilities).forEach((item) => {
      const key = toUtilityKey(item?.key || item?.label || "");
      map[key] = {
        key,
        label: item?.label || titleCase(key.replace(/_/g, " ")) || "Other Utility",
        invoiced: Number(item?.invoiced || 0),
        paid: Number(item?.paid || 0),
      };
    });
  }

  if (Number(row?.invoicedGarbage || 0) !== 0 || Number(row?.paidGarbage || 0) !== 0) {
    map.garbage = {
      key: "garbage",
      label: "Garbage",
      invoiced: Number(row?.invoicedGarbage || 0),
      paid: Number(row?.paidGarbage || 0),
    };
  }

  if (Number(row?.invoicedWater || 0) !== 0 || Number(row?.paidWater || 0) !== 0) {
    map.water = {
      key: "water",
      label: "Water",
      invoiced: Number(row?.invoicedWater || 0),
      paid: Number(row?.paidWater || 0),
    };
  }

  return map;
};

const buildUtilityColumns = (workspace = null, rows = []) => {
  if (Array.isArray(workspace?.utilityColumns) && workspace.utilityColumns.length > 0) {
    return workspace.utilityColumns.map((item) => ({
      key: toUtilityKey(item?.key || item?.label || ""),
      label: item?.label || titleCase(String(item?.key || item?.label || "").replace(/_/g, " ")),
      invoiced: Number(item?.invoiced || 0),
      paid: Number(item?.paid || 0),
    }));
  }

  const map = new Map();

  rows.forEach((row) => {
    Object.values(normalizeRowUtilities(row)).forEach((item) => {
      const key = toUtilityKey(item?.key || item?.label || "");
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: item?.label || titleCase(key.replace(/_/g, " ")) || "Other Utility",
          invoiced: 0,
          paid: 0,
        });
      }

      const entry = map.get(key);
      entry.invoiced += Number(item?.invoiced || 0);
      entry.paid += Number(item?.paid || 0);
    });
  });

  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
};

const getUtilityValue = (row = {}, key = "", phase = "invoiced") =>
  Number(normalizeRowUtilities(row)?.[key]?.[phase] || 0);

const getPreparedUtilityValue = (row = {}, key = "", phase = "invoiced") =>
  Number(row?.__utilityMap?.[key]?.[phase] || 0);

const Statements = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const properties = useSelector((state) => state.property?.properties || []);
  const landlords = useSelector((state) => state.landlord?.landlords || []);

  const today = new Date();
  const todayIso = toIsoDate(today);
  const initialPeriod = buildPeriod(today.getMonth() + 1, today.getFullYear());
  const [statementType, setStatementType] = useState("provisional");
  const [selectedPropertyId, setSelectedPropertyId] = useState("");
  const [month, setMonth] = useState(String(today.getMonth() + 1));
  const [year, setYear] = useState(String(today.getFullYear()));
  const [periodStart, setPeriodStart] = useState(initialPeriod.periodStart);
  const [periodEnd, setPeriodEnd] = useState(initialPeriod.periodEnd);
  const [draftStatement, setDraftStatement] = useState(null);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState("workspace");
  const [processedStatements, setProcessedStatements] = useState([]);
  const [loadingProcessedContext, setLoadingProcessedContext] = useState(false);
  const [processedContextLoaded, setProcessedContextLoaded] = useState(false);

  useEffect(() => {
    if (!currentCompany?._id) return;
    dispatch(getProperties({ business: currentCompany._id }));
    dispatch(getLandlords({ company: currentCompany._id }));
  }, [dispatch, currentCompany?._id]);

  const selectedProperty = useMemo(
    () => properties.find((item) => normalizeId(item?._id) === normalizeId(selectedPropertyId)) || null,
    [properties, selectedPropertyId]
  );

  const landlordId = useMemo(() => {
    const landlordsOnProperty = Array.isArray(selectedProperty?.landlords) ? selectedProperty.landlords : [];
    const primary = landlordsOnProperty.find((item) => item?.isPrimary && item?.landlordId);
    const fallback = landlordsOnProperty.find((item) => item?.landlordId);
    return normalizeId(primary?.landlordId || fallback?.landlordId);
  }, [selectedProperty]);

  const landlord = useMemo(
    () => landlords.find((item) => normalizeId(item?._id) === landlordId) || null,
    [landlords, landlordId]
  );

  const latestProcessedStatement = useMemo(
    () =>
      (Array.isArray(processedStatements) ? processedStatements : []).find(
        (item) => String(item?.status || "") !== "reversed"
      ) || null,
    [processedStatements]
  );

  const latestProcessedCutoffAt = useMemo(
    () =>
      latestProcessedStatement?.cutoffAt ||
      latestProcessedStatement?.closedAt ||
      latestProcessedStatement?.periodEnd ||
      "",
    [latestProcessedStatement]
  );

  useEffect(() => {
    if (!currentCompany?._id || !selectedPropertyId) {
      setProcessedStatements([]);
      setProcessedContextLoaded(false);
      return;
    }

    let cancelled = false;
    setLoadingProcessedContext(true);
    setProcessedContextLoaded(false);

    adminRequests
      .get(`/processed-statements/business/${currentCompany._id}`, {
        params: {
          property: selectedPropertyId,
          ...(landlordId ? { landlord: landlordId } : {}),
        },
      })
      .then((response) => {
        if (cancelled) return;
        setProcessedStatements(Array.isArray(response?.data?.statements) ? response.data.statements : []);
      })
      .catch(() => {
        if (cancelled) return;
        setProcessedStatements([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingProcessedContext(false);
        setProcessedContextLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [currentCompany?._id, selectedPropertyId, landlordId]);

  useEffect(() => {
    if (!selectedPropertyId) {
      const nextPeriod = buildPeriod(month, year);
      setPeriodStart(nextPeriod.periodStart);
      setPeriodEnd("");
      setDraftStatement(null);
      return;
    }

    if (!processedContextLoaded) {
      return;
    }

    setPeriodStart(
      getDefaultPeriodStart({
        month,
        year,
        latestProcessedCutoffAt,
        propertyDateAcquired: selectedProperty?.dateAcquired,
        todayIso,
      })
    );
    setPeriodEnd("");
    setDraftStatement(null);
  }, [month, year, selectedPropertyId, processedContextLoaded, latestProcessedCutoffAt, selectedProperty?.dateAcquired, todayIso]);

  const workspace = draftStatement?.metadata?.workspace || null;
  const summary = workspace?.summary || {};
  const rows = workspace?.rows || [];
  const depositMemo = workspace?.depositMemo || {};
  const depositMemoRows = Array.isArray(depositMemo?.rows) ? depositMemo.rows : [];
  const depositMemoTotals = depositMemo?.totals || {};
  const depositSettlement = workspace?.depositSettlement || {};
  const depositSettlementRows = Array.isArray(depositSettlement?.rows)
    ? depositSettlement.rows
    : [];
  const depositSettlementTotals = depositSettlement?.totals || {};
  const totals = workspace?.totals || {};
  const expenseRows = workspace?.expenseRows || workspace?.deductionRows || [];
  const additionRows = workspace?.additionRows || [];
  const directToLandlordRows = workspace?.directToLandlordRows || [];
  const settlement = useMemo(() => getStatementSettlement(summary), [summary]);
  const basisCollectionsLabel = summary?.basisCollectionsLabel || "Collections";
  const basisCollectionsAmount = Number(
    summary?.basisCollections ?? summary?.managerCollections ?? summary?.totalCollections ?? 0
  );
  const additionsAmount = Number(
    summary?.additions ?? summary?.totalAdditions ?? sumSectionAmounts(additionRows)
  );
  const commissionAmount = Number(summary?.commissionAmount || 0);
  const nonCommissionDeductions = Number(
    summary?.nonCommissionDeductions ??
      summary?.totalExpenses ??
      Math.max(sumSectionAmounts(expenseRows) - commissionAmount, 0)
  );
  const directToLandlordAmount = Number(
    summary?.directToLandlordCollections ??
      summary?.directToLandlordOffsets ??
      summary?.totalDirectToLandlordCollections ??
      sumSectionAmounts(directToLandlordRows)
  );
  const openingLandlordSettlementBalance = Number(
    summary?.openingLandlordSettlementBalance ?? summary?.openingSettlementBalance ?? 0
  );
  const utilityColumns = useMemo(() => buildUtilityColumns(workspace, rows), [workspace, rows]);
  const preparedRows = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        __utilityMap: normalizeRowUtilities(row),
      })),
    [rows]
  );
  const nonDepositAdditionRows = useMemo(
    () => additionRows.filter((item) => String(item?.category || "") !== "deposit_remittance"),
    [additionRows]
  );
  const nonDepositExpenseRows = useMemo(
    () => expenseRows.filter((item) => String(item?.category || "") !== "deposit_direct_offset"),
    [expenseRows]
  );
  const depositSettlementAdditionRows = useMemo(
    () =>
      depositSettlementRows.filter(
        (item) => String(item?.effect || "").toLowerCase() === "addition"
      ),
    [depositSettlementRows]
  );
  const depositSettlementOffsetRows = useMemo(
    () =>
      depositSettlementRows.filter(
        (item) => String(item?.effect || "").toLowerCase() === "offset"
      ),
    [depositSettlementRows]
  );
  const hasWorkspaceDetailSections =
    nonDepositExpenseRows.length > 0 ||
    nonDepositAdditionRows.length > 0 ||
    directToLandlordRows.length > 0 ||
    depositSettlementRows.length > 0 ||
    depositMemoRows.length > 0;
  const statementColSpan = 7 + utilityColumns.length * 2;
  const hasFuturePeriodDate =
    isFutureIsoDate(periodStart, todayIso) || isFutureIsoDate(periodEnd, todayIso);
  const hasValidPeriodSelection =
    Boolean(periodStart) &&
    Boolean(periodEnd) &&
    !hasFuturePeriodDate &&
    new Date(periodStart) <= new Date(periodEnd);

  const loadDraftWorkspace = async (options = {}) => {
    if (!currentCompany?._id || !selectedPropertyId) {
      setDraftStatement(null);
      return;
    }

    if (!periodStart || !periodEnd) {
      setDraftStatement(null);
      return;
    }

    if (hasFuturePeriodDate) {
      toast.error("Statement dates cannot be in the future");
      setDraftStatement(null);
      return;
    }

    if (new Date(periodStart) > new Date(periodEnd)) {
      toast.error("Select a valid statement period");
      setDraftStatement(null);
      return;
    }

    setLoadingDraft(true);
    try {
      const created = await dispatch(
        createDraftStatement({
          propertyId: selectedPropertyId,
          landlordId: landlordId || undefined,
          periodStart,
          periodEnd,
          notes: `${statementType} statement workspace`,
          refresh: options.refresh === true,
        })
      );
      const full = await dispatch(getStatement(created._id));
      setDraftStatement(full?.statement || null);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load landlord statement workspace");
      setDraftStatement(null);
    } finally {
      setLoadingDraft(false);
    }
  };

  useEffect(() => {
    if (!selectedPropertyId) {
      setDraftStatement(null);
      return;
    }

    if (!processedContextLoaded || !hasValidPeriodSelection) {
      setDraftStatement(null);
      return;
    }

    loadDraftWorkspace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedPropertyId,
    landlordId,
    periodStart,
    periodEnd,
    statementType,
    currentCompany?._id,
    processedContextLoaded,
    hasValidPeriodSelection,
  ]);

  const handleApprove = async () => {
    if (!draftStatement?._id) return;
    try {
      await dispatch(approveStatement(draftStatement._id, "Approved from landlord statement workspace"));
      const full = await dispatch(getStatement(draftStatement._id));
      setDraftStatement(full?.statement || null);
      toast.success("Statement approved successfully");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to approve statement");
    }
  };

  const handleRegenerateDraft = async () => {
    if (!selectedPropertyId || !hasValidPeriodSelection) {
      toast.error("Select a valid statement period first");
      return;
    }
    try {
      await loadDraftWorkspace({ refresh: true });
      toast.success("Draft regenerated successfully");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to regenerate draft");
    }
  };

  const handleDownload = async () => {
    if (!draftStatement?._id) return;
    try {
      const response = await adminRequests.get(`/statements/${draftStatement._id}/pdf`, {
        responseType: "blob",
      });
      const blob = new Blob([response.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${getPropertyLabel(selectedProperty)}-${workspace?.periodLabel || "statement"}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to download statement PDF");
    }
  };

  const handlePrint = async () => {
    if (!draftStatement?._id) return;

    try {
      const response = await adminRequests.get(`/statements/${draftStatement._id}/pdf`, {
        responseType: "blob",
      });
      const blob = new Blob([response.data], { type: "application/pdf" });
      const blobUrl = window.URL.createObjectURL(blob);
      const printWindow = window.open(blobUrl, "_blank");

      if (!printWindow) {
        window.URL.revokeObjectURL(blobUrl);
        toast.error("Popup blocked. Allow popups to print the statement.");
        return;
      }

      const tryPrint = () => {
        try {
          printWindow.focus();
          printWindow.print();
        } catch {
          // ignore cross-window timing issues
        }
      };

      printWindow.onload = tryPrint;
      setTimeout(tryPrint, 1200);
      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 15000);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to print statement PDF");
    }
  };

  const handleProcessStatement = async () => {
    if (!draftStatement?._id || !selectedPropertyId) {
      toast.error("Generate a draft statement first");
      return;
    }

    if (!hasValidPeriodSelection) {
      toast.error("Select a valid statement period first");
      return;
    }

    setProcessing(true);
    try {
      await adminRequests.post("/processed-statements", {
        statementId: draftStatement._id,
        propertyId: selectedPropertyId,
        businessId: currentCompany?._id,
        periodStart,
        periodEnd,
      });
      toast.success("Statement processed successfully");
      navigate("/landlord/processed-statements");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to process statement");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50 px-3 py-5 sm:px-4 lg:px-5">
        <div className="mx-auto w-full max-w-[98%] space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">Landlord Statements</h1>
              <p className="mt-1 text-sm text-slate-600">
                Generate, preview, approve, print, and process statements per property.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => navigate("/landlord/processed-statements")}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
              >
                <FaFileAlt />
                Processed statements
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-slate-900">Statement Workspace</h2>
            </div>

            <div className="grid grid-cols-1 gap-4 px-6 py-5 md:grid-cols-2 xl:grid-cols-7">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Statement Type</label>
                <select
                  value={statementType}
                  onChange={(e) => setStatementType(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"
                >
                  <option value="provisional">Provisional</option>
                  <option value="final">Final</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Property</label>
                <select
                  value={selectedPropertyId}
                  onChange={(e) => setSelectedPropertyId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"
                >
                  <option value="">Select property</option>
                  {properties.map((property) => (
                    <option key={property._id} value={property._id}>
                      {getPropertyLabel(property)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Month</label>
                <select
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"
                >
                  {monthOptions.map((label, index) => (
                    <option key={label} value={String(index + 1)}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Year</label>
                <input
                  type="number"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Period Start</label>
                <input
                  type="date"
                  value={periodStart}
                  max={todayIso}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Period End</label>
                <input
                  type="date"
                  value={periodEnd}
                  min={periodStart || undefined}
                  max={todayIso}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"
                />
              </div>

              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => loadDraftWorkspace({ refresh: true })}
                  disabled={!selectedPropertyId || loadingDraft || loadingProcessedContext || !hasValidPeriodSelection}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <FaSyncAlt className={loadingDraft ? "animate-spin" : ""} />
                  {loadingDraft ? "Loading..." : loadingProcessedContext ? "Checking period..." : "Generate / Refresh"}
                </button>
              </div>
            </div>


            <div className="px-6 pb-5">
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <p className="font-medium">Statement period rules</p>
                <p className="mt-1">
                  The first statement defaults its start date to the property acquisition date. After a statement is processed, the next statement starts immediately after the last processed cut-off timestamp, so any transaction posted moments later flows into the next statement automatically. Period end does not auto-fill and cannot be in the future.
                </p>
                {latestProcessedCutoffAt ? (
                  <p className="mt-2 text-amber-900">
                    Latest processed cut-off for this property: <span className="font-semibold">{formatDateTime(latestProcessedCutoffAt)}</span>
                  </p>
                ) : selectedProperty?.dateAcquired ? (
                  <p className="mt-2 text-amber-900">
                    First statement start anchor: <span className="font-semibold">{formatDate(selectedProperty.dateAcquired)}</span>
                  </p>
                ) : null}
              </div>
            </div>
            <div className="border-t border-slate-200 px-6 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab("workspace")}
                    className={`rounded-lg px-4 py-2 text-sm font-medium ${
                      activeTab === "workspace"
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    Workspace
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("summary")}
                    className={`rounded-lg px-4 py-2 text-sm font-medium ${
                      activeTab === "summary"
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    Summary
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleRegenerateDraft}
                    disabled={!selectedPropertyId || loadingDraft || loadingProcessedContext || !hasValidPeriodSelection}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    <FaSyncAlt />
                    Regenerate Draft
                  </button>

                  <button
                    type="button"
                    onClick={handleApprove}
                    disabled={!draftStatement?._id}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    <FaCheckCircle />
                    Approve
                  </button>

                  <button
                    type="button"
                    onClick={handlePrint}
                    disabled={!draftStatement?._id}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    <FaPrint />
                    Print
                  </button>

                  <button
                    type="button"
                    onClick={handleDownload}
                    disabled={!draftStatement?._id}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    <FaDownload />
                    PDF
                  </button>

                  <button
                    type="button"
                    onClick={handleProcessStatement}
                    disabled={!draftStatement?._id || processing || !hasValidPeriodSelection}
                    className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    <FaFileAlt />
                    {processing ? "Processing..." : "Process Statement"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {!selectedPropertyId ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500 shadow-sm">
              Select a property to load the landlord statement workspace.
            </div>
          ) : !draftStatement ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500 shadow-sm">
              {loadingDraft ? "Loading statement workspace..." : "No draft statement loaded for this selection."}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-sm text-slate-500">Property</p>
                  <p className="mt-2 text-base font-semibold text-slate-900">{getPropertyLabel(selectedProperty)}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-sm text-slate-500">Landlord</p>
                  <p className="mt-2 text-base font-semibold text-slate-900">
                    {landlord
                      ? `${landlord.firstName || ""} ${landlord.lastName || ""}`.trim() || landlord.email || "Linked landlord"
                      : "Derived from property"}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-sm text-slate-500">Period</p>
                  <p className="mt-2 text-base font-semibold text-slate-900">{`${formatDate(draftStatement?.periodStart || periodStart)} - ${formatDate(draftStatement?.periodEnd || periodEnd)}`}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-sm text-slate-500">Statement Number</p>
                  <p className="mt-2 text-base font-semibold text-slate-900">{draftStatement.statementNumber || "-"}</p>
                </div>
              </div>

              {activeTab === "summary" ? (
                <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-200 px-6 py-4">
                    <h3 className="text-lg font-semibold text-slate-900">Statement Summary</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      This preview now uses the same stored statement summary as the PDF output.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-4 px-6 py-5 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-xl bg-slate-50 p-4">
                      <p className="text-sm text-slate-500">Opening Balance</p>
                      <p className="mt-2 text-lg font-semibold text-slate-900">{currency(summary.openingBalance)}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-4">
                      <p className="text-sm text-slate-500">Closing Balance</p>
                      <p className="mt-2 text-lg font-semibold text-slate-900">{currency(summary.closingBalance)}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-4">
                      <p className="text-sm text-slate-500">Occupied Units</p>
                      <p className="mt-2 text-lg font-semibold text-slate-900">{Number(summary.occupiedUnits || 0)}</p>
                    </div>
                    <div className={`rounded-xl p-4 ${settlement.isNegative ? "bg-red-50" : "bg-slate-900 text-white"}`}>
                      <p className={`text-sm ${settlement.isNegative ? "text-red-600" : "text-slate-200"}`}>{settlement.label}</p>
                      <p className={`mt-2 text-lg font-semibold ${settlement.isNegative ? "text-red-700" : "text-white"}`}>{currency(settlement.amount)}</p>
                    </div>
                  </div>

                  <div className="px-6 pb-6">
                    <div className="overflow-hidden rounded-2xl border border-slate-200">
                      <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <tbody className="divide-y divide-slate-200 bg-white">
                          <tr>
                            <td className="px-4 py-3 font-semibold text-slate-700">Opening landlord settlement B/F</td>
                            <td className={`px-4 py-3 text-right font-medium ${openingLandlordSettlementBalance < 0 ? "text-red-700" : "text-slate-900"}`}>
                              {currency(openingLandlordSettlementBalance)}
                            </td>
                          </tr>
                          <tr>
                            <td className="px-4 py-3 font-semibold text-slate-700">{basisCollectionsLabel}</td>
                            <td className="px-4 py-3 text-right font-medium text-slate-900">{currency(basisCollectionsAmount)}</td>
                          </tr>
                          <tr>
                            <td className="px-4 py-3 font-semibold text-slate-700">Additions</td>
                            <td className="px-4 py-3 text-right font-medium text-slate-900">{currency(additionsAmount)}</td>
                          </tr>
                          <tr>
                            <td className="px-4 py-3 font-semibold text-slate-700">Expenses &amp; other deductions</td>
                            <td className="px-4 py-3 text-right font-medium text-slate-900">{currency(nonCommissionDeductions)}</td>
                          </tr>
                          <tr>
                            <td className="px-4 py-3 font-semibold text-slate-700">Commission</td>
                            <td className="px-4 py-3 text-right font-medium text-slate-900">{currency(commissionAmount)}</td>
                          </tr>
                          <tr>
                            <td className="px-4 py-3 font-semibold text-slate-700">Direct to landlord collections</td>
                            <td className="px-4 py-3 text-right font-medium text-slate-900">{currency(directToLandlordAmount)}</td>
                          </tr>
                          <tr className={settlement.isNegative ? "bg-red-50" : "bg-slate-900 text-white"}>
                            <td className={`px-4 py-4 text-base font-bold ${settlement.isNegative ? "text-red-700" : "text-white"}`}>{settlement.label}</td>
                            <td className={`px-4 py-4 text-right text-base font-bold ${settlement.isNegative ? "text-red-700" : "text-white"}`}>{currency(settlement.amount)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-200 px-6 py-4">
                    <h3 className="text-lg font-semibold text-slate-900">Statement Workspace Preview</h3>
                  </div>

                  <div className="overflow-auto rounded-b-2xl">
                    <table className="min-w-[1400px] w-full divide-y divide-slate-200 text-sm whitespace-nowrap">
                      <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                        <tr>
                          <th className="sticky left-0 z-20 bg-[#0B3B2E] px-4 py-3 text-left font-semibold text-white">Unit</th>
                          <th className="sticky left-[120px] z-20 bg-[#0B3B2E] px-4 py-3 text-left font-semibold text-white">Tenant</th>
                          <th className="px-4 py-3 text-right font-semibold text-white">Balance B/F</th>
                          <th className="px-4 py-3 text-right font-semibold text-white">Rent Invoiced</th>
                          <th className="px-4 py-3 text-right font-semibold text-white">Rent Paid</th>
                          {utilityColumns.map((column) => (
                            <React.Fragment key={`head-${column.key}`}>
                              <th className="px-4 py-3 text-right font-semibold text-white">
                                {column.label} Invoiced
                              </th>
                              <th className="px-4 py-3 text-right font-semibold text-white">
                                {column.label} Paid
                              </th>
                            </React.Fragment>
                          ))}
                          <th className="px-4 py-3 text-right font-semibold text-white">Total Paid</th>
                          <th className="px-4 py-3 text-right font-semibold text-white">Balance C/F</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 bg-white">
                        {preparedRows.length === 0 ? (
                          <tr>
                            <td colSpan={statementColSpan} className="px-4 py-8 text-center text-slate-500">
                              No tenant or unit rows were generated for this period. Adjust the date range and regenerate the draft.
                            </td>
                          </tr>
                        ) : (
                          preparedRows.map((row, index) => (
                            <tr key={`${row.unitId || row.unitNumber || "row"}-${index}`}>
                              <td className="sticky left-0 z-10 bg-white px-4 py-3 text-slate-700">{row.unit || row.unitNumber || "-"}</td>
                              <td className="sticky left-[120px] z-10 bg-white px-4 py-3 text-slate-700">{row.tenantName || "-"}</td>
                              <td className="px-4 py-3 text-right text-slate-700">{currency(row.openingBalance ?? row.balanceBF ?? 0)}</td>
                              <td className="px-4 py-3 text-right text-slate-700">{currency(row.invoicedRent)}</td>
                              <td className="px-4 py-3 text-right text-slate-700">{currency(row.paidRent)}</td>
                              {utilityColumns.map((column) => (
                                <React.Fragment key={`${row.unitId || row.unitNumber || "row"}-${column.key}`}>
                                  <td className="px-4 py-3 text-right text-slate-700">
                                    {currency(getPreparedUtilityValue(row, column.key, "invoiced"))}
                                  </td>
                                  <td className="px-4 py-3 text-right text-slate-700">
                                    {currency(getPreparedUtilityValue(row, column.key, "paid"))}
                                  </td>
                                </React.Fragment>
                              ))}
                              <td className="px-4 py-3 text-right font-medium text-slate-900">{currency(row.totalPaid)}</td>
                              <td className="px-4 py-3 text-right font-medium text-slate-900">{currency(row.closingBalance ?? row.balanceCF ?? row.balance ?? 0)}</td>
                            </tr>
                          ))
                        )}
                        {preparedRows.length > 0 ? (
                          <tr className="bg-slate-50">
                            <td colSpan={2} className="px-4 py-3 font-semibold text-slate-700">Total</td>
                            <td className="px-4 py-3 text-right font-semibold text-slate-900">{currency(totals.openingBalance ?? summary.openingBalance ?? 0)}</td>
                            <td className="px-4 py-3 text-right font-semibold text-slate-900">{currency(totals.invoicedRent ?? summary.rentInvoiced ?? 0)}</td>
                            <td className="px-4 py-3 text-right font-semibold text-slate-900">{currency(totals.paidRent ?? summary.totalRentReceived ?? 0)}</td>
                            {utilityColumns.map((column) => (
                              <React.Fragment key={`foot-${column.key}`}>
                                <td className="px-4 py-3 text-right font-semibold text-slate-900">{currency(Number(column?.invoiced || 0))}</td>
                                <td className="px-4 py-3 text-right font-semibold text-slate-900">{currency(Number(column?.paid || 0))}</td>
                              </React.Fragment>
                            ))}
                            <td className="px-4 py-3 text-right font-semibold text-slate-900">{currency(totals.totalPaid ?? 0)}</td>
                            <td className="px-4 py-3 text-right font-semibold text-slate-900">{currency(totals.closingBalance ?? summary.closingBalance ?? 0)}</td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>

                  {hasWorkspaceDetailSections && (
                    <div className="space-y-6 border-t border-slate-200 px-6 py-5">
                      {depositSettlementRows.length > 0 && (
                        <div>
                          <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">
                            Deposit Remittance
                          </h4>
                          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                            <div className="rounded-lg bg-emerald-50 px-4 py-3">
                              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                                Added to landlord
                              </p>
                              <p className="mt-2 text-lg font-semibold text-emerald-900">
                                {currency(depositSettlementTotals.additions)}
                              </p>
                            </div>
                            <div className="rounded-lg bg-amber-50 px-4 py-3">
                              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                                Direct receipt offsets
                              </p>
                              <p className="mt-2 text-lg font-semibold text-amber-900">
                                {currency(depositSettlementTotals.offsets)}
                              </p>
                            </div>
                            <div className="rounded-lg bg-slate-50 px-4 py-3">
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                                Net settlement impact
                              </p>
                              <p className="mt-2 text-lg font-semibold text-slate-900">
                                {currency(depositSettlementTotals.netImpact)}
                              </p>
                            </div>
                          </div>

                          <div className="mt-4 space-y-2">
                            {depositSettlementAdditionRows.map((item, index) => (
                              <div key={`deposit-settlement-add-${index}`} className="flex items-center justify-between rounded-lg bg-emerald-50/70 px-4 py-3">
                                <div>
                                  <p className="text-slate-700">{item.description || "Deposit remittance"}</p>
                                  <p className="text-xs text-slate-500">{item.holder === "landlord" ? "Landlord-held deposit" : "Deposit settlement"}</p>
                                </div>
                                <span className="font-medium text-emerald-900">{currency(item.amount)}</span>
                              </div>
                            ))}
                            {depositSettlementOffsetRows.map((item, index) => (
                              <div key={`deposit-settlement-offset-${index}`} className="flex items-center justify-between rounded-lg bg-amber-50/80 px-4 py-3">
                                <div>
                                  <p className="text-slate-700">{item.description || "Deposit offset"}</p>
                                  <p className="text-xs text-slate-500">Shown as both addition and deduction for direct landlord deposit receipts</p>
                                </div>
                                <span className="font-medium text-amber-900">{currency(item.amount)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {depositMemoRows.length > 0 && (
                        <div>
                          <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">
                            Deposit Memorandum
                          </h4>
                          <div className="overflow-x-auto rounded-xl border border-slate-200">
                            <table className="min-w-full divide-y divide-slate-200 text-sm">
                              <thead className="bg-slate-50">
                                <tr>
                                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Holder</th>
                                  <th className="px-4 py-3 text-right font-semibold text-slate-700">Opening</th>
                                  <th className="px-4 py-3 text-right font-semibold text-slate-700">Billed / Adj.</th>
                                  <th className="px-4 py-3 text-right font-semibold text-slate-700">Received</th>
                                  <th className="px-4 py-3 text-right font-semibold text-slate-700">Closing</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200 bg-white">
                                {depositMemoRows.map((item, index) => (
                                  <tr key={`deposit-memo-${index}`}>
                                    <td className="px-4 py-3 text-slate-700">{item.label || item.key || "Deposit memo"}</td>
                                    <td className="px-4 py-3 text-right text-slate-700">{currency(item.openingBalance)}</td>
                                    <td className="px-4 py-3 text-right text-slate-700">{currency(item.billed)}</td>
                                    <td className="px-4 py-3 text-right text-slate-700">{currency(item.received)}</td>
                                    <td className="px-4 py-3 text-right font-medium text-slate-900">{currency(item.closingBalance)}</td>
                                  </tr>
                                ))}
                                <tr className="bg-slate-50">
                                  <td className="px-4 py-3 font-semibold text-slate-700">Total</td>
                                  <td className="px-4 py-3 text-right font-semibold text-slate-900">{currency(depositMemoTotals.openingBalance)}</td>
                                  <td className="px-4 py-3 text-right font-semibold text-slate-900">{currency(depositMemoTotals.billed)}</td>
                                  <td className="px-4 py-3 text-right font-semibold text-slate-900">{currency(depositMemoTotals.received)}</td>
                                  <td className="px-4 py-3 text-right font-semibold text-slate-900">{currency(depositMemoTotals.closingBalance)}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {nonDepositExpenseRows.length > 0 && (
                        <div>
                          <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">
                            Deductions / Expenses
                          </h4>
                          <div className="space-y-2">
                            {nonDepositExpenseRows.map((item, index) => (
                              <div key={`expense-${index}`} className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
                                <span className="text-slate-700">{item.description || item.name || "Expense"}</span>
                                <span className="font-medium text-slate-900">{currency(item.amount)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {nonDepositAdditionRows.length > 0 && (
                        <div>
                          <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">
                            Additions
                          </h4>
                          <div className="space-y-2">
                            {nonDepositAdditionRows.map((item, index) => (
                              <div key={`addition-${index}`} className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
                                <span className="text-slate-700">{item.description || item.name || "Addition"}</span>
                                <span className="font-medium text-slate-900">{currency(item.amount)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {directToLandlordRows.length > 0 && (
                        <div>
                          <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">
                            Direct to Landlord Receipts
                          </h4>
                          <div className="space-y-2">
                            {directToLandlordRows.map((item, index) => (
                              <div key={`direct-${index}`} className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
                                <span className="text-slate-700">
                                  {item.description || item.referenceNumber || item.receiptNumber || "Direct receipt"}
                                </span>
                                <span className="font-medium text-slate-900">{currency(item.amount)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="border-t border-slate-200 px-6 py-5">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-xl bg-slate-50 p-4">
                        <p className="text-sm text-slate-500">Rent Paid</p>
                        <p className="mt-2 text-lg font-semibold text-slate-900">{currency(totals.rentPaid)}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-4">
                        <p className="text-sm text-slate-500">Utilities Paid</p>
                        <p className="mt-2 text-lg font-semibold text-slate-900">{currency(totals.utilityPaid)}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-4">
                        <p className="text-sm text-slate-500">Expenses</p>
                        <p className="mt-2 text-lg font-semibold text-slate-900">{currency(totals.expenses)}</p>
                      </div>
                      <div className={`rounded-xl p-4 ${settlement.isNegative ? "bg-red-50" : "bg-slate-900 text-white"}`}>
                        <p className={`text-sm ${settlement.isNegative ? "text-red-600" : "text-slate-200"}`}>{settlement.label}</p>
                        <p className={`mt-2 text-lg font-semibold ${settlement.isNegative ? "text-red-700" : "text-white"}`}>{currency(settlement.amount)}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Statements;