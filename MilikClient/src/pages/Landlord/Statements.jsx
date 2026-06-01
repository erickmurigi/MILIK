import React, { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
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
import { selectCurrentCompany, selectCurrentUser, selectAllProperties, selectAllLandlords } from "../../redux/selectors";
import { adminRequests } from "../../utils/requestMethods";
import { hasCompanyPermission } from "../../utils/permissions";
import useScopedSessionDraft, { buildScopedDraftKey } from "../../hooks/useScopedSessionDraft";

const currency = (value) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 2,
  }).format(Number(value || 0));

const depositMemoCurrency = (value) => currency(Math.abs(Number(value || 0)));

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

const buildStatementPeriodLabel = (workspace = {}, statement = {}) => {
  const explicit =
    workspace?.statementPeriodLabel ||
    workspace?.periodLabel ||
    "";

  if (String(explicit || "").trim()) {
    return String(explicit).trim();
  }

  const start = workspace?.statementPeriodStart || statement?.periodStart || null;
  const end = workspace?.statementPeriodEnd || statement?.periodEnd || null;
  const startLabel = formatDate(start);
  const endLabel = formatDate(end);

  if (startLabel && endLabel) return `${startLabel} - ${endLabel}`;
  return startLabel || endLabel || "-";
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

const resolveDayKey = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return toIsoDate(date);
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
      const nextStatementAnchor = new Date(latestCutoff.getTime() + 1);
      nextStatementAnchor.setHours(0, 0, 0, 0);
      return toIsoDate(nextStatementAnchor);
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

const normalizeReopenDraftContext = (value = null) => {
  if (!value || typeof value !== "object") return null;

  const propertyId = normalizeId(value?.propertyId || value?.property || "");
  const landlordId = normalizeId(value?.landlordId || value?.landlord || "");
  const rawPeriodStart = value?.periodStart || value?.statementStartAt || value?.startAt || "";
  const rawPeriodEnd =
    value?.periodEnd ||
    value?.statementEndAt ||
    value?.cutoffAt ||
    value?.closedAt ||
    "";
  const periodStart = rawPeriodStart ? toIsoDate(rawPeriodStart) : "";
  const periodEnd = rawPeriodEnd ? toIsoDate(rawPeriodEnd) : "";

  if (!propertyId || !periodStart || !periodEnd) return null;

  return {
    propertyId,
    landlordId,
    statementType: String(value?.statementType || "provisional").toLowerCase(),
    periodStart,
    periodEnd,
  };
};

const resolveStatementType = (statement = null, fallback = "provisional") =>
  String(
    statement?.metadata?.statementType ||
      statement?.metadata?.workspace?.statementType ||
      fallback
  );

const buildStatementSelectionKey = ({
  companyId = "",
  propertyId = "",
  landlordId = "",
  statementType = "provisional",
  periodStart = "",
  periodEnd = "",
} = {}) =>
  [
    String(companyId || "").trim(),
    normalizeId(propertyId),
    normalizeId(landlordId),
    String(statementType || "provisional").trim().toLowerCase(),
    resolveDayKey(periodStart),
    resolveDayKey(periodEnd),
  ].join("|");


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

const buildStatementColumns = (workspace = null, utilityColumns = []) => {
  if (Array.isArray(workspace?.statementColumns) && workspace.statementColumns.length > 0) {
    return workspace.statementColumns.map((item) => ({
      key: String(item?.key || ''),
      label: item?.label || titleCase(String(item?.key || '').replace(/_/g, ' ')),
      sourceKeys: Array.isArray(item?.sourceKeys) && item.sourceKeys.length > 0 ? item.sourceKeys.map((value) => toUtilityKey(value)) : [toUtilityKey(item?.key || item?.label || '')],
      invoiced: Number(item?.invoiced || 0),
      paid: Number(item?.paid || 0),
      isGrouped: Boolean(item?.isGrouped),
      categoryType: item?.categoryType || 'utility',
    }));
  }

  if (utilityColumns.length <= 4) {
    return utilityColumns.map((item) => ({
      key: item.key,
      label: item.label,
      sourceKeys: [item.key],
      invoiced: Number(item?.invoiced || 0),
      paid: Number(item?.paid || 0),
      isGrouped: false,
      categoryType: item?.categoryType || 'utility',
    }));
  }

  const visible = utilityColumns.slice(0, 3).map((item) => ({
    key: item.key,
    label: item.label,
    sourceKeys: [item.key],
    invoiced: Number(item?.invoiced || 0),
    paid: Number(item?.paid || 0),
    isGrouped: false,
    categoryType: item?.categoryType || 'utility',
  }));
  const overflow = utilityColumns.slice(3);
  visible.push({
    key: 'other_charges',
    label: 'Other Charges',
    sourceKeys: overflow.map((item) => item.key),
    invoiced: overflow.reduce((sum, item) => sum + Number(item?.invoiced || 0), 0),
    paid: overflow.reduce((sum, item) => sum + Number(item?.paid || 0), 0),
    isGrouped: true,
    categoryType: 'mixed',
  });
  return visible;
};

const getUtilityValue = (row = {}, key = "", phase = "invoiced") =>
  Number(normalizeRowUtilities(row)?.[key]?.[phase] || 0);

const getPreparedUtilityValue = (row = {}, key = "", phase = "invoiced") =>
  Number(row?.__utilityMap?.[key]?.[phase] || 0);


const buildPreparedStatementColumnMap = (row = {}, statementColumns = []) => {
  const utilityMap = row?.__utilityMap && typeof row.__utilityMap === 'object' ? row.__utilityMap : normalizeRowUtilities(row);
  if (row?.statementColumns && typeof row.statementColumns === 'object') {
    return row.statementColumns;
  }
  return (Array.isArray(statementColumns) ? statementColumns : []).reduce((acc, column) => {
    const sourceKeys = Array.isArray(column?.sourceKeys) && column.sourceKeys.length > 0 ? column.sourceKeys : [column?.key];
    acc[column.key] = sourceKeys.reduce(
      (totals, sourceKey) => {
        totals.invoiced += Number(utilityMap?.[sourceKey]?.invoiced || 0);
        totals.paid += Number(utilityMap?.[sourceKey]?.paid || 0);
        return totals;
      },
      { invoiced: 0, paid: 0 }
    );
    return acc;
  }, {});
};

const getPreparedStatementColumnValue = (row = {}, key = '', phase = 'invoiced') =>
  Number(row?.__statementColumnMap?.[key]?.[phase] || row?.statementColumns?.[key]?.[phase] || 0);

const SearchableSelect = ({ value, onChange, options, placeholder = "Select..." }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef(null);

  const selected = options.find((o) => o.value === value) || null;
  const filtered = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleSelect = (opt) => {
    onChange(opt.value);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={containerRef} className="relative">
      <div
        onClick={() => { setOpen((prev) => !prev); setQuery(""); }}
        className={`flex h-8 w-full cursor-pointer items-center justify-between rounded-md border px-2.5 shadow-sm transition-colors ${
          open
            ? "border-orange-500 bg-white ring-1 ring-orange-400"
            : "border-orange-400 bg-orange-50 hover:border-orange-500"
        }`}
      >
        {open ? (
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            placeholder={selected?.label || placeholder}
            className="w-full bg-transparent text-xs font-semibold text-slate-800 outline-none placeholder:font-normal placeholder:text-slate-400"
            autoFocus
          />
        ) : (
          <span className={`truncate text-xs font-semibold ${selected ? "text-slate-800" : "text-slate-400"}`}>
            {selected?.label || placeholder}
          </span>
        )}
        <svg
          className={`ml-1 h-3 w-3 flex-shrink-0 text-orange-500 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.8"
        >
          <path d="M1 1l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-0.5 max-h-56 overflow-y-auto rounded-md border border-orange-200 bg-white shadow-xl">
          {filtered.length === 0 ? (
            <div className="px-3 py-2.5 text-xs text-slate-400">No matches</div>
          ) : (
            filtered.map((opt) => (
              <div
                key={opt.value}
                onMouseDown={(e) => { e.preventDefault(); handleSelect(opt); }}
                className={`cursor-pointer px-3 py-2 text-xs transition-colors hover:bg-orange-50 ${
                  opt.value === value ? "bg-orange-100 font-bold text-orange-700" : "text-slate-700"
                }`}
              >
                {opt.label}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

const Statements = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();

  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const properties = useSelector(selectAllProperties);
  const landlords = useSelector(selectAllLandlords);
  const canCreateStatement = hasCompanyPermission(currentUser || {}, currentCompany, "statements", "create", "propertyManagement");
  const canApproveStatement = hasCompanyPermission(currentUser || {}, currentCompany, "statements", "approve", "propertyManagement");
  const canExportStatement = hasCompanyPermission(currentUser || {}, currentCompany, "statements", "export", "propertyManagement");

  const today = new Date();
  const todayIso = toIsoDate(today);
  const initialPeriod = buildPeriod(today.getMonth() + 1, today.getFullYear());
  const statementDraftKey = buildScopedDraftKey({
    page: "landlord-statement",
    companyId: currentCompany?._id,
    userId: currentUser?._id || currentUser?.id || currentUser?.email,
  });
  const [statementDraft, setStatementDraft, clearStatementDraft] = useScopedSessionDraft(statementDraftKey, {
    statementType: "provisional",
    selectedPropertyId: "",
    month: String(today.getMonth() + 1),
    year: String(today.getFullYear()),
    periodStart: initialPeriod.periodStart,
    periodEnd: initialPeriod.periodEnd,
    draftStatement: null,
    activeTab: "workspace",
    collapseAdditionalUnitRows: false,
  });
  const statementType = statementDraft.statementType || "provisional";
  const setStatementType = (value) => setStatementDraft((prev) => ({ ...prev, statementType: typeof value === "function" ? value(prev.statementType || "provisional") : value }));
  const selectedPropertyId = statementDraft.selectedPropertyId || "";
  const setSelectedPropertyId = (value) => setStatementDraft((prev) => ({ ...prev, selectedPropertyId: typeof value === "function" ? value(prev.selectedPropertyId || "") : value }));
  const month = statementDraft.month || String(today.getMonth() + 1);
  const setMonth = (value) => setStatementDraft((prev) => ({ ...prev, month: typeof value === "function" ? value(prev.month || String(today.getMonth() + 1)) : value }));
  const year = statementDraft.year || String(today.getFullYear());
  const setYear = (value) => setStatementDraft((prev) => ({ ...prev, year: typeof value === "function" ? value(prev.year || String(today.getFullYear())) : value }));
  const periodStart = statementDraft.periodStart || initialPeriod.periodStart;
  const setPeriodStart = (value) => setStatementDraft((prev) => ({ ...prev, periodStart: typeof value === "function" ? value(prev.periodStart || initialPeriod.periodStart) : value }));
  const periodEnd = statementDraft.periodEnd || initialPeriod.periodEnd;
  const setPeriodEnd = (value) => setStatementDraft((prev) => ({ ...prev, periodEnd: typeof value === "function" ? value(prev.periodEnd || initialPeriod.periodEnd) : value }));
  const draftStatement = statementDraft.draftStatement || null;
  const setDraftStatement = (value) => setStatementDraft((prev) => ({ ...prev, draftStatement: typeof value === "function" ? value(prev.draftStatement || null) : value }));
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [processing, setProcessing] = useState(false);
  const activeTab = statementDraft.activeTab || "workspace";
  const setActiveTab = (value) => setStatementDraft((prev) => ({ ...prev, activeTab: typeof value === "function" ? value(prev.activeTab || "workspace") : value }));
  const collapseAdditionalUnitRows = Boolean(statementDraft.collapseAdditionalUnitRows);
  const setCollapseAdditionalUnitRows = (value) => setStatementDraft((prev) => ({ ...prev, collapseAdditionalUnitRows: typeof value === "function" ? value(Boolean(prev.collapseAdditionalUnitRows)) : Boolean(value) }));
  const [processedStatements, setProcessedStatements] = useState([]);
  const [loadingProcessedContext, setLoadingProcessedContext] = useState(false);
  const [processedContextLoaded, setProcessedContextLoaded] = useState(false);
  const [loadingPdfPreview, setLoadingPdfPreview] = useState(false);

  const autoDraftTimerRef = useRef(null);
  const lastAutoLoadedSelectionRef = useRef("");
  const inFlightSelectionRef = useRef("");
  const pendingReopenContextRef = useRef(null);
  const draftAbortControllerRef = useRef(null);
  const processedAbortControllerRef = useRef(null);

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

  const currentSelectionKey = useMemo(
    () =>
      buildStatementSelectionKey({
        companyId: currentCompany?._id || "",
        propertyId: selectedPropertyId,
        landlordId,
        statementType,
        periodStart,
        periodEnd,
      }),
    [currentCompany?._id, landlordId, periodEnd, periodStart, selectedPropertyId, statementType]
  );

  const draftSelectionKey = useMemo(
    () =>
      draftStatement?._id
        ? buildStatementSelectionKey({
            companyId: currentCompany?._id || "",
            propertyId: draftStatement?.property,
            landlordId: draftStatement?.landlord,
            statementType: resolveStatementType(draftStatement, statementType),
            periodStart: draftStatement?.periodStart,
            periodEnd: draftStatement?.periodEnd,
          })
        : "",
    [
      currentCompany?._id,
      draftStatement?._id,
      draftStatement?.property,
      draftStatement?.landlord,
      draftStatement?.periodStart,
      draftStatement?.periodEnd,
      draftStatement?.metadata?.statementType,
      draftStatement?.metadata?.workspace?.statementType,
      statementType,
    ]
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
    const reopenDraftContext = normalizeReopenDraftContext(location.state?.reopenDraftContext);
    if (!reopenDraftContext) return;

    const reopenStartDate = new Date(`${reopenDraftContext.periodStart}T00:00:00`);
    const nextMonth = !Number.isNaN(reopenStartDate.getTime())
      ? String(reopenStartDate.getMonth() + 1)
      : month;
    const nextYear = !Number.isNaN(reopenStartDate.getTime())
      ? String(reopenStartDate.getFullYear())
      : year;

    pendingReopenContextRef.current = reopenDraftContext;
    lastAutoLoadedSelectionRef.current = "";
    inFlightSelectionRef.current = "";
    setDraftStatement(null);
    setStatementType(reopenDraftContext.statementType || "provisional");
    setSelectedPropertyId(reopenDraftContext.propertyId);
    setMonth(nextMonth);
    setYear(nextYear);
    setPeriodStart(reopenDraftContext.periodStart);
    setPeriodEnd(reopenDraftContext.periodEnd);

    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, month, navigate, year]);

  useEffect(() => {
    if (!currentCompany?._id || !selectedPropertyId) {
      setProcessedStatements([]);
      setProcessedContextLoaded(false);
      return;
    }

    // Cancel any in-flight processed-context request before starting a new one
    if (processedAbortControllerRef.current) {
      processedAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    processedAbortControllerRef.current = controller;

    setLoadingProcessedContext(true);
    setProcessedContextLoaded(false);

    adminRequests
      .get(`/processed-statements/business/${currentCompany._id}`, {
        signal: controller.signal,
        params: {
          property: selectedPropertyId,
          ...(landlordId ? { landlord: landlordId } : {}),
        },
      })
      .then((response) => {
        setProcessedStatements(Array.isArray(response?.data?.statements) ? response.data.statements : []);
      })
      .catch((err) => {
        if (err?.name === "CanceledError" || err?.name === "AbortError") return;
        setProcessedStatements([]);
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setLoadingProcessedContext(false);
        setProcessedContextLoaded(true);
      });

    return () => {
      controller.abort();
    };
  }, [currentCompany?._id, selectedPropertyId, landlordId]);

  useEffect(() => {
    const pendingReopenContext = pendingReopenContextRef.current;
    if (pendingReopenContext) {
      const matchesPendingSelection =
        normalizeId(selectedPropertyId) === normalizeId(pendingReopenContext.propertyId) &&
        resolveDayKey(periodStart) === resolveDayKey(pendingReopenContext.periodStart) &&
        resolveDayKey(periodEnd) === resolveDayKey(pendingReopenContext.periodEnd);

      if (!processedContextLoaded || matchesPendingSelection) {
        setDraftStatement(null);
        return;
      }

      pendingReopenContextRef.current = null;
    }

    if (!selectedPropertyId) {
      const nextPeriod = buildPeriod(month, year);
      setPeriodStart(nextPeriod.periodStart);
      setPeriodEnd("");
      setDraftStatement(null);
      return;
    }

    if (!processedContextLoaded) {
      setPeriodEnd(todayIso);
      setDraftStatement(null);
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
    setPeriodEnd(todayIso);
    setDraftStatement(null);
  }, [month, year, selectedPropertyId, processedContextLoaded, latestProcessedCutoffAt, selectedProperty?.dateAcquired, todayIso, periodStart, periodEnd]);

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
  const statementPeriodLabel = buildStatementPeriodLabel(workspace, draftStatement || {});
  const broughtForwardCreditApplications = workspace?.broughtForwardCreditApplications || {};
  const broughtForwardCreditApplicationRows = Array.isArray(broughtForwardCreditApplications?.rows)
    ? broughtForwardCreditApplications.rows
    : [];
  const broughtForwardCreditApplicationTotals = broughtForwardCreditApplications?.totals || {};
  const totals = workspace?.totals || {};
  const expenseRows = workspace?.expenseRows || workspace?.deductionRows || [];
  const additionRows = workspace?.additionRows || [];
  const directToLandlordRows = workspace?.directToLandlordRows || [];
  const advanceRecoveryRows = workspace?.advanceRecoveryRows || [];
  const earlyPayoutRows = workspace?.earlyPayoutRows || [];
  const settlement = useMemo(() => getStatementSettlement(summary), [summary]);
  const {
    basisCollectionsLabel,
    basisCollectionsAmount,
    additionsAmount,
    commissionAmount,
    commissionTaxAmount,
    invoiceVatPassThroughLabel,
    invoiceVatPassThroughAmount,
    totalInvoiceVatReceived,
    nonCommissionDeductions,
    directToLandlordAmount,
    openingLandlordSettlementBalance,
  } = useMemo(() => {
    const commission = Number(summary?.commissionAmount || 0);
    return {
      basisCollectionsLabel: summary?.basisCollectionsLabel || "Collections",
      basisCollectionsAmount: Number(summary?.basisCollections ?? summary?.managerCollections ?? summary?.totalCollections ?? 0),
      additionsAmount: Number(summary?.additions ?? summary?.totalAdditions ?? sumSectionAmounts(additionRows)),
      commissionAmount: commission,
      commissionTaxAmount: Number(summary?.commissionTaxAmount || 0),
      invoiceVatPassThroughLabel: summary?.invoiceVatPassThroughLabel || "Invoice VAT (pass-through)",
      invoiceVatPassThroughAmount: Number(summary?.invoiceVatPassThroughAmount ?? summary?.totalInvoiceVatInvoiced ?? 0),
      totalInvoiceVatReceived: Number(summary?.totalInvoiceVatReceived ?? totals?.paidTax ?? 0),
      nonCommissionDeductions: Number(summary?.nonCommissionDeductions ?? summary?.totalExpenses ?? Math.max(sumSectionAmounts(expenseRows) - commission, 0)),
      directToLandlordAmount: Number(summary?.directToLandlordCollections ?? summary?.directToLandlordOffsets ?? summary?.totalDirectToLandlordCollections ?? sumSectionAmounts(directToLandlordRows)),
      openingLandlordSettlementBalance: Number(summary?.openingLandlordSettlementBalance ?? summary?.openingSettlementBalance ?? 0),
    };
  }, [summary, totals, additionRows, expenseRows, directToLandlordRows]);
  const utilityColumns = useMemo(() => buildUtilityColumns(workspace, rows), [workspace, rows]);
  const statementColumns = useMemo(
    () => buildStatementColumns(workspace, utilityColumns),
    [workspace, utilityColumns]
  );
  const preparedRows = useMemo(
    () =>
      rows.map((row) => {
        const utilityMap = normalizeRowUtilities(row);
        return {
          ...row,
          __utilityMap: utilityMap,
          __statementColumnMap: buildPreparedStatementColumnMap({ ...row, __utilityMap: utilityMap }, statementColumns),
        };
      }),
    [rows, statementColumns]
  );

  const tenantUnitMeta = useMemo(() => {
    const meta = new Map();

    preparedRows.forEach((row) => {
      const tenantKey = String(row?.tenantId || "");
      if (!tenantKey) return;
      const current = meta.get(tenantKey) || {
        count: 0,
        unitLabels: [],
      };
      current.count += 1;
      if (row?.unit && !current.unitLabels.includes(String(row.unit))) {
        current.unitLabels.push(String(row.unit));
      }
      meta.set(tenantKey, current);
    });

    return meta;
  }, [preparedRows]);

  const statementDisplayRows = useMemo(() => {
    if (!collapseAdditionalUnitRows) {
      return preparedRows.map((row) => {
        const tenantMeta = tenantUnitMeta.get(String(row?.tenantId || "")) || null;
        return {
          ...row,
          multiUnitCount: Number(tenantMeta?.count || 1),
          displayUnitLabel: row.unit,
          allUnitLabels: tenantMeta?.unitLabels || [row.unit].filter(Boolean),
        };
      });
    }

    const grouped = new Map();

    preparedRows.forEach((row) => {
      const tenantKey = String(row?.tenantId || "");
      if (!tenantKey) {
        const uniqueKey = `vacant:${row?.unitId || row?.unit || Math.random()}`;
        grouped.set(uniqueKey, {
          ...row,
          multiUnitCount: 1,
          displayUnitLabel: row.unit,
          allUnitLabels: [row.unit].filter(Boolean),
        });
        return;
      }

      const existing = grouped.get(tenantKey);
      if (!existing) {
        grouped.set(tenantKey, {
          ...row,
          multiUnitCount: 1,
          allUnitLabels: [row.unit].filter(Boolean),
          displayUnitLabel: row.unit,
          __utilityMap: { ...(row.__utilityMap || {}) },
        });
        return;
      }

      existing.multiUnitCount += 1;
      if (row?.unit && !existing.allUnitLabels.includes(String(row.unit))) {
        existing.allUnitLabels.push(String(row.unit));
      }

      [
        "openingBalance",
        "balanceBF",
        "invoicedRent",
        "invoicedTax",
        "paidRent",
        "paidTax",
        "totalPaid",
        "closingBalance",
        "balanceCF",
        "balance",
      ].forEach((field) => {
        existing[field] = Number(existing[field] || 0) + Number(row[field] || 0);
      });

      const utilityMap = existing.__utilityMap;
      Object.entries(row.__utilityMap || {}).forEach(([utilityKey, utilityPhases]) => {
        const curr = utilityMap[utilityKey];
        if (curr) {
          curr.invoiced += Number(utilityPhases?.invoiced || 0);
          curr.paid += Number(utilityPhases?.paid || 0);
          if (!curr.label) curr.label = utilityPhases?.label || utilityKey;
        } else {
          utilityMap[utilityKey] = {
            invoiced: Number(utilityPhases?.invoiced || 0),
            paid: Number(utilityPhases?.paid || 0),
            label: utilityPhases?.label || utilityKey,
          };
        }
      });
    });

    return Array.from(grouped.values())
      .map((row) => ({
        ...row,
        __statementColumnMap: buildPreparedStatementColumnMap(row, statementColumns),
        displayUnitLabel:
          row.allUnitLabels.length > 1
            ? `${row.allUnitLabels[0]} + ${row.allUnitLabels.length - 1} more`
            : row.allUnitLabels[0] || row.unit,
      }))
      .sort((a, b) =>
        String(a.displayUnitLabel || a.unit || "").localeCompare(
          String(b.displayUnitLabel || b.unit || ""),
          undefined,
          { numeric: true }
        )
      );
  }, [collapseAdditionalUnitRows, preparedRows, statementColumns, tenantUnitMeta]);
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
    depositMemoRows.length > 0 ||
    broughtForwardCreditApplicationRows.length > 0 ||
    advanceRecoveryRows.length > 0 ||
    earlyPayoutRows.length > 0;
  const hasInvoiceVatColumn = useMemo(
    () =>
      Number(summary?.totalInvoiceVatInvoiced || 0) > 0 ||
      Number(summary?.totalInvoiceVatReceived || 0) > 0 ||
      preparedRows.some(
        (row) => Number(row?.invoicedTax || 0) > 0 || Number(row?.paidTax || 0) > 0
      ),
    [preparedRows, summary]
  );
  const statementColSpan = 7 + statementColumns.length * 2 + (hasInvoiceVatColumn ? 2 : 0);
  const hasFuturePeriodDate =
    isFutureIsoDate(periodStart, todayIso) || isFutureIsoDate(periodEnd, todayIso);
  const hasValidPeriodSelection =
    Boolean(periodStart) &&
    Boolean(periodEnd) &&
    !hasFuturePeriodDate &&
    new Date(periodStart) <= new Date(periodEnd);

  const loadDraftWorkspace = async (options = {}) => {
    const requestedSelectionKey =
      options.selectionKey ||
      buildStatementSelectionKey({
        companyId: currentCompany?._id || "",
        propertyId: selectedPropertyId,
        landlordId,
        statementType,
        periodStart,
        periodEnd,
      });

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

    // Cancel any previous in-flight draft generation
    if (draftAbortControllerRef.current) {
      draftAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    draftAbortControllerRef.current = controller;

    setLoadingDraft(true);
    try {
      const created = await dispatch(
        createDraftStatement({
          propertyId: selectedPropertyId,
          landlordId: landlordId || undefined,
          periodStart,
          periodEnd,
          statementType,
          notes: `${statementType} statement workspace`,
          refresh: options.refresh !== false,
          _signal: controller.signal,
        })
      );

      if (controller.signal.aborted) return;

      const full = await dispatch(getStatement(created._id));
      const nextStatement = full?.statement || null;

      const nextPeriodStart = nextStatement?.periodStart ? toIsoDate(nextStatement.periodStart) : periodStart;
      const nextPeriodEnd = nextStatement?.periodEnd ? toIsoDate(nextStatement.periodEnd) : periodEnd;
      const nextSelectionKey = buildStatementSelectionKey({
        companyId: currentCompany?._id || "",
        propertyId: nextStatement?.property || selectedPropertyId,
        landlordId: nextStatement?.landlord || landlordId,
        statementType: resolveStatementType(nextStatement, statementType),
        periodStart: nextPeriodStart,
        periodEnd: nextPeriodEnd,
      });

      lastAutoLoadedSelectionRef.current = nextSelectionKey || requestedSelectionKey;

      if (nextStatement?.periodStart && nextPeriodStart !== periodStart) {
        setPeriodStart(nextPeriodStart);
      }
      if (nextStatement?.periodEnd && nextPeriodEnd !== periodEnd) {
        setPeriodEnd(nextPeriodEnd);
      }

      pendingReopenContextRef.current = null;
      setDraftStatement(nextStatement);
    } catch (error) {
      if (error?.name === "CanceledError" || error?.name === "AbortError") return;
      lastAutoLoadedSelectionRef.current = requestedSelectionKey;
      pendingReopenContextRef.current = null;
      toast.error(error?.response?.data?.message || "Failed to load landlord statement workspace");
      setDraftStatement(null);
    } finally {
      if (controller.signal.aborted) return;
      if (inFlightSelectionRef.current === requestedSelectionKey) {
        inFlightSelectionRef.current = "";
      }
      setLoadingDraft(false);
    }
  };

  useEffect(() => {
    if (!selectedPropertyId || !processedContextLoaded || !hasValidPeriodSelection) {
      setDraftStatement(null);
      lastAutoLoadedSelectionRef.current = "";
      inFlightSelectionRef.current = "";
      if (autoDraftTimerRef.current) {
        window.clearTimeout(autoDraftTimerRef.current);
        autoDraftTimerRef.current = null;
      }
      return;
    }

    if (
      draftStatement?._id &&
      draftSelectionKey &&
      currentSelectionKey &&
      draftSelectionKey !== currentSelectionKey &&
      !loadingDraft
    ) {
      setDraftStatement(null);
    }
  }, [
    currentSelectionKey,
    draftSelectionKey,
    draftStatement?._id,
    hasValidPeriodSelection,
    loadingDraft,
    processedContextLoaded,
    selectedPropertyId,
  ]);

  useEffect(() => {
    if (!selectedPropertyId || !processedContextLoaded || !hasValidPeriodSelection || loadingDraft) {
      if (autoDraftTimerRef.current) {
        window.clearTimeout(autoDraftTimerRef.current);
        autoDraftTimerRef.current = null;
      }
      return undefined;
    }

    if (!currentSelectionKey) {
      return undefined;
    }

    if (draftStatement?._id && draftSelectionKey === currentSelectionKey) {
      return undefined;
    }

    if (
      inFlightSelectionRef.current === currentSelectionKey ||
      lastAutoLoadedSelectionRef.current === currentSelectionKey
    ) {
      return undefined;
    }

    if (autoDraftTimerRef.current) {
      window.clearTimeout(autoDraftTimerRef.current);
    }

    autoDraftTimerRef.current = window.setTimeout(async () => {
      inFlightSelectionRef.current = currentSelectionKey;
      await loadDraftWorkspace({ selectionKey: currentSelectionKey });
    }, 450);

    return () => {
      if (autoDraftTimerRef.current) {
        window.clearTimeout(autoDraftTimerRef.current);
        autoDraftTimerRef.current = null;
      }
    };
  }, [
    currentSelectionKey,
    draftSelectionKey,
    draftStatement?._id,
    hasValidPeriodSelection,
    loadingDraft,
    processedContextLoaded,
    selectedPropertyId,
  ]);

  const handleApprove = async () => {
    if (!canApproveStatement) {
      toast.warning("You do not have permission to approve landlord statements");
      return;
    }
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
    if (!canCreateStatement) {
      toast.warning("You do not have permission to generate landlord statements");
      return;
    }
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

  const printBlobInHiddenFrame = (blobUrl) => {
    const frame = document.createElement("iframe");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    frame.setAttribute("aria-hidden", "true");

    const cleanup = () => {
      window.setTimeout(() => {
        try {
          frame.remove();
        } catch {}
        window.URL.revokeObjectURL(blobUrl);
      }, 1500);
    };

    frame.onload = () => {
      window.setTimeout(() => {
        try {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
        } catch {
          cleanup();
          return;
        }

        cleanup();
      }, 250);
    };

    frame.src = blobUrl;
    document.body.appendChild(frame);
  };

  const handleOpenPdf = async () => {
    if (!canExportStatement) {
      toast.warning("You do not have permission to view landlord statements");
      return;
    }
    if (!draftStatement?._id) return;
    setLoadingPdfPreview(true);
    try {
      const response = await adminRequests.get(`/statements/${draftStatement._id}/pdf`, {
        responseType: "blob",
      });
      const blob = new Blob([response.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      const tab = window.open(url, "_blank");
      // Revoke the object URL after the tab has loaded it
      if (tab) {
        tab.addEventListener("load", () => window.URL.revokeObjectURL(url), { once: true });
        setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
      } else {
        window.URL.revokeObjectURL(url);
        toast.warning("Pop-up blocked. Please allow pop-ups for this site to open PDFs in a new tab.");
      }
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to open statement PDF");
    } finally {
      setLoadingPdfPreview(false);
    }
  };

  const handlePrint = async () => {
    if (!canExportStatement) {
      toast.warning("You do not have permission to print landlord statements");
      return;
    }
    if (!draftStatement?._id) return;

    setLoadingPdfPreview(true);

    try {
      const response = await adminRequests.get(`/statements/${draftStatement._id}/pdf`, {
        responseType: "blob",
      });

      const blob = new Blob([response.data], { type: "application/pdf" });
      const blobUrl = window.URL.createObjectURL(blob);
      printBlobInHiddenFrame(blobUrl);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to print statement PDF");
    } finally {
      setLoadingPdfPreview(false);
    }
  };

  const handleProcessStatement = async () => {
    if (!canApproveStatement) {
      toast.warning("You do not have permission to process landlord statements");
      return;
    }
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
      clearStatementDraft();
      navigate("/landlord/processed-statements");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to process statement");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-100">

        {/* ── TOP CONTROLS ─────────────────────────────────────────────── */}
        <div className="flex-shrink-0 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.08)]">
          <div className="h-0.5 bg-gradient-to-r from-[#0B3B2E] via-[#1a6b4e] to-[#0B3B2E]" />

          {/* Filter grid */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-3 xl:grid-cols-7">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Statement Type</label>
              <SearchableSelect
                value={statementType}
                onChange={setStatementType}
                options={[
                  { value: "provisional", label: "Provisional" },
                  { value: "final", label: "Final" },
                ]}
                placeholder="Select type"
              />
            </div>

            <div className="col-span-2 xl:col-span-1">
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Property</label>
              <SearchableSelect
                value={selectedPropertyId}
                onChange={setSelectedPropertyId}
                options={properties.map((p) => ({ value: p._id, label: getPropertyLabel(p) }))}
                placeholder="Select property"
              />
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Month</label>
              <SearchableSelect
                value={month}
                onChange={setMonth}
                options={monthOptions.map((label, index) => ({ value: String(index + 1), label }))}
                placeholder="Select month"
              />
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Year</label>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="h-8 w-full rounded-md border border-orange-400 bg-orange-50 px-2.5 text-xs font-semibold text-slate-800 shadow-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-400"
              />
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Period Start</label>
              <input
                type="date"
                value={periodStart}
                max={todayIso}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="h-8 w-full rounded-md border border-orange-400 bg-orange-50 px-2.5 text-xs font-semibold text-slate-800 shadow-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-400"
              />
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Period End</label>
              <input
                type="date"
                value={periodEnd}
                min={periodStart || undefined}
                max={todayIso}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="h-8 w-full rounded-md border border-orange-400 bg-orange-50 px-2.5 text-xs font-semibold text-slate-800 shadow-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-400"
              />
            </div>

            <div className="flex items-end">
              <button
                type="button"
                onClick={() => loadDraftWorkspace({ refresh: true })}
                disabled={!canCreateStatement || !selectedPropertyId || loadingDraft || loadingProcessedContext || !hasValidPeriodSelection}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#0a3228] disabled:cursor-not-allowed disabled:opacity-55"
              >
                <FaSyncAlt className={loadingDraft ? "animate-spin" : ""} size={11} />
                {loadingDraft ? "Loading…" : loadingProcessedContext ? "Checking…" : "Generate"}
              </button>
            </div>
          </div>

          {/* Tabs + action buttons */}
          <div className="flex items-center justify-between border-t border-slate-100 px-4">
            <div className="flex items-center">
              {[
                { id: "workspace", label: "Workspace" },
                { id: "summary", label: "Summary" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative px-4 py-2.5 text-xs font-bold transition-colors ${
                    activeTab === tab.id ? "text-[#0B3B2E]" : "text-slate-400 hover:text-slate-600"
                  }`}
                >
                  {tab.label}
                  {activeTab === tab.id && (
                    <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-t-full bg-[#0B3B2E]" />
                  )}
                </button>
              ))}
              {draftStatement?.status && (
                <span className={`ml-3 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                  draftStatement.status === "approved"
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-amber-100 text-amber-700"
                }`}>
                  {draftStatement.status}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 py-2">
              <button
                type="button"
                onClick={handleRegenerateDraft}
                disabled={!canCreateStatement || !selectedPropertyId || loadingDraft || loadingProcessedContext || !hasValidPeriodSelection}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:opacity-40"
              >
                <FaSyncAlt size={9} />
                Regenerate
              </button>
              <button
                type="button"
                onClick={handleApprove}
                disabled={!canApproveStatement || !draftStatement?._id}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-[11px] font-bold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-40"
              >
                <FaCheckCircle size={9} />
                Approve
              </button>
              <button
                type="button"
                onClick={handlePrint}
                disabled={!canExportStatement || !draftStatement?._id || loadingPdfPreview}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:opacity-40"
              >
                <FaPrint size={9} className={loadingPdfPreview ? "animate-pulse" : ""} />
                Print
              </button>
              <button
                type="button"
                onClick={handleOpenPdf}
                disabled={!canExportStatement || !draftStatement?._id || loadingPdfPreview}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:opacity-40"
              >
                <FaDownload size={9} className={loadingPdfPreview ? "animate-pulse" : ""} />
                PDF
              </button>
              <button
                type="button"
                onClick={handleProcessStatement}
                disabled={!canApproveStatement || !draftStatement?._id || processing || !hasValidPeriodSelection}
                className="inline-flex h-7 items-center gap-1.5 rounded-md bg-[#0B3B2E] px-3 text-[11px] font-bold text-white transition-colors hover:bg-[#0a3228] disabled:opacity-40"
              >
                <FaFileAlt size={9} />
                {processing ? "Processing…" : "Process"}
              </button>
            </div>
          </div>
        </div>

        {/* ── MAIN CONTENT ─────────────────────────────────────────────── */}
        {!selectedPropertyId ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0B3B2E]/10">
              <FaFileAlt className="text-[#0B3B2E]" size={22} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-700">Select a Property</p>
              <p className="mt-1 max-w-xs text-xs text-slate-400">Choose a property from the filter above to load the landlord statement workspace.</p>
            </div>
          </div>
        ) : !draftStatement ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${loadingDraft ? "bg-[#0B3B2E]/10" : "bg-slate-200/60"}`}>
              <FaSyncAlt className={`${loadingDraft ? "animate-spin text-[#0B3B2E]" : "text-slate-400"}`} size={22} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-700">{loadingDraft ? "Building Statement…" : "No Statement Loaded"}</p>
              <p className="mt-1 max-w-xs text-xs text-slate-400">{loadingDraft ? "Compiling workspace from ledger data…" : "Click Generate to load the statement for this period."}</p>
            </div>
          </div>
        ) : (
          <>
            {activeTab === "summary" ? (

              /* ══════════ SUMMARY TAB ══════════ */
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {/* Header banner */}
                <div className="flex-shrink-0 bg-[#0B3B2E] px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-green-200/50">Landlord Statement · Summary</p>
                      <h3 className="mt-1 text-sm font-bold text-white">
                        {selectedProperty ? getPropertyLabel(selectedProperty) : "Statement Summary"}
                      </h3>
                      {landlord && (
                        <p className="mt-0.5 text-xs text-green-100/60">{landlord.name || landlord.fullName || ""}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-right">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-green-200/50">Period</p>
                        <p className="mt-0.5 text-xs font-bold text-white">{statementPeriodLabel}</p>
                      </div>
                      <div className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-right">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-green-200/50">Type</p>
                        <p className="mt-0.5 text-xs font-bold capitalize text-white">{statementType}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* KPI strip */}
                <div className="flex-shrink-0 grid grid-cols-2 divide-x divide-slate-100 border-b border-slate-200 bg-white md:grid-cols-5">
                  <div className="px-5 py-4">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Opening Balance</p>
                    <p className="mt-1.5 text-base font-bold text-slate-900">{currency(summary.openingBalance)}</p>
                  </div>
                  <div className="px-5 py-4">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Closing Balance</p>
                    <p className="mt-1.5 text-base font-bold text-slate-900">{currency(summary.closingBalance)}</p>
                  </div>
                  <div className="px-5 py-4">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Occupied Units</p>
                    <p className="mt-1.5 text-base font-bold text-slate-900">{Number(summary.occupiedUnits || 0)}</p>
                  </div>
                  <div className="px-5 py-4">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-amber-500">Unapplied Credits</p>
                    <p className="mt-1.5 text-base font-bold text-amber-700">{currency(summary.unappliedPayments || 0)}</p>
                  </div>
                  <div className={`px-5 py-4 ${settlement.isNegative ? "bg-red-50" : "bg-[#0B3B2E]"}`}>
                    <p className={`text-[9px] font-bold uppercase tracking-widest ${settlement.isNegative ? "text-red-500" : "text-green-200/60"}`}>
                      {settlement.label}
                    </p>
                    <p className={`mt-1.5 text-base font-bold ${settlement.isNegative ? "text-red-700" : "text-white"}`}>
                      {currency(settlement.amount)}
                    </p>
                  </div>
                </div>

                {/* Scrollable breakdown */}
                <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50">
                  {Number(summary.unappliedPayments || 0) > 0 && (
                    <div className="px-5 pt-4">
                      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                        <div className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-amber-400" />
                        <p className="text-xs text-amber-800">
                          Unapplied tenant credits are carried separately from allocated rent and utility receipts. They reduce the tenant net position but do not count as paid until allocated to actual bills.
                        </p>
                      </div>
                    </div>
                  )}
                  <div className="p-5">
                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                      <div className="border-b border-slate-100 bg-slate-50 px-5 py-2.5">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Settlement Breakdown</p>
                      </div>
                      <table className="min-w-full divide-y divide-slate-100 text-sm">
                        <tbody className="divide-y divide-slate-100 bg-white">
                          <tr className="transition-colors hover:bg-slate-50/60">
                            <td className="px-5 py-3 font-medium text-slate-700">Opening landlord settlement B/F</td>
                            <td className={`px-5 py-3 text-right font-semibold ${openingLandlordSettlementBalance < 0 ? "text-red-600" : "text-slate-900"}`}>
                              {currency(openingLandlordSettlementBalance)}
                            </td>
                          </tr>
                          <tr className="transition-colors hover:bg-slate-50/60">
                            <td className="px-5 py-3 font-medium text-slate-700">{basisCollectionsLabel}</td>
                            <td className="px-5 py-3 text-right font-semibold text-slate-900">{currency(basisCollectionsAmount)}</td>
                          </tr>
                          {Number(summary?.utilityPassThroughAmount || 0) > 0 && (
                            <tr className="transition-colors hover:bg-slate-50/60">
                              <td className="px-5 py-3 font-medium text-slate-700">{summary?.utilityPassThroughLabel || "Utilities (added as billed)"}</td>
                              <td className="px-5 py-3 text-right font-semibold text-slate-900">{currency(summary?.utilityPassThroughAmount || 0)}</td>
                            </tr>
                          )}
                          {invoiceVatPassThroughAmount > 0 && (
                            <tr className="transition-colors hover:bg-slate-50/60">
                              <td className="px-5 py-3 font-medium text-slate-700">{invoiceVatPassThroughLabel}</td>
                              <td className="px-5 py-3 text-right font-semibold text-slate-900">{currency(invoiceVatPassThroughAmount)}</td>
                            </tr>
                          )}
                          <tr className="transition-colors hover:bg-slate-50/60">
                            <td className="px-5 py-3 font-medium text-slate-700">Additions</td>
                            <td className="px-5 py-3 text-right font-semibold text-slate-900">{currency(additionsAmount)}</td>
                          </tr>
                          <tr className="transition-colors hover:bg-slate-50/60">
                            <td className="px-5 py-3 font-medium text-slate-700">Expenses &amp; other deductions</td>
                            <td className="px-5 py-3 text-right font-semibold text-slate-900">{currency(nonCommissionDeductions)}</td>
                          </tr>
                          <tr className="transition-colors hover:bg-slate-50/60">
                            <td className="px-5 py-3 font-medium text-slate-700">Commission</td>
                            <td className="px-5 py-3 text-right font-semibold text-slate-900">{currency(commissionAmount)}</td>
                          </tr>
                          {commissionTaxAmount > 0 && (
                            <tr className="transition-colors hover:bg-slate-50/60">
                              <td className="px-5 py-3 font-medium text-slate-700">VAT on commission</td>
                              <td className="px-5 py-3 text-right font-semibold text-slate-900">{currency(commissionTaxAmount)}</td>
                            </tr>
                          )}
                          <tr className="transition-colors hover:bg-slate-50/60">
                            <td className="px-5 py-3 font-medium text-slate-700">Direct to landlord collections</td>
                            <td className="px-5 py-3 text-right font-semibold text-slate-900">{currency(directToLandlordAmount)}</td>
                          </tr>
                          {Number(summary?.totalEarlyPayouts || 0) > 0 && (
                            <tr className="transition-colors hover:bg-slate-50/60">
                              <td className="px-5 py-3 font-medium text-slate-700">Early payout already paid to landlord</td>
                              <td className="px-5 py-3 text-right font-semibold text-amber-700">({currency(Number(summary?.totalEarlyPayouts || 0))})</td>
                            </tr>
                          )}
                          {Number(summary?.totalAdvanceRecoveries || 0) > 0 && (
                            <tr className="transition-colors hover:bg-slate-50/60">
                              <td className="px-5 py-3 font-medium text-slate-700">Advance recovery deduction</td>
                              <td className="px-5 py-3 text-right font-semibold text-red-600">({currency(Number(summary?.totalAdvanceRecoveries || 0))})</td>
                            </tr>
                          )}
                          <tr className={settlement.isNegative ? "bg-red-50" : "bg-[#0B3B2E]"}>
                            <td className={`px-5 py-4 text-sm font-bold ${settlement.isNegative ? "text-red-700" : "text-white"}`}>{settlement.label}</td>
                            <td className={`px-5 py-4 text-right text-sm font-bold ${settlement.isNegative ? "text-red-700" : "text-white"}`}>{currency(settlement.amount)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>

            ) : (

              /* ══════════ WORKSPACE TAB ══════════ */
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {/* Header banner */}
                <div className="flex-shrink-0 flex flex-wrap items-center justify-between gap-3 bg-[#0B3B2E] px-5 py-3">
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-green-200/50">Workspace Preview</p>
                    <h3 className="mt-1 text-sm font-bold text-white">
                      {selectedProperty ? getPropertyLabel(selectedProperty) : "Statement Workspace"}
                    </h3>
                    {landlord && (
                      <p className="mt-0.5 text-xs text-green-100/60">{landlord.name || landlord.fullName || ""}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-right">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-green-200/50">Period</p>
                      <p className="mt-0.5 text-xs font-bold text-white">{statementPeriodLabel}</p>
                    </div>
                    <div className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-right">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-green-200/50">Rows</p>
                      <p className="mt-0.5 text-xs font-bold text-white">{statementDisplayRows.length}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCollapseAdditionalUnitRows(!collapseAdditionalUnitRows)}
                      className={`rounded-lg border px-3 py-1.5 text-[10px] font-semibold transition-colors ${
                        collapseAdditionalUnitRows
                          ? "border-green-300/40 bg-green-500/30 text-white"
                          : "border-white/20 bg-white/10 text-green-100/80 hover:bg-white/20"
                      }`}
                    >
                      {collapseAdditionalUnitRows ? "Multi-Unit: Collapsed" : "Collapse Multi-Unit"}
                    </button>
                  </div>
                </div>

                {/* Scrollable table + detail sections */}
                <div className="min-h-0 flex-1 overflow-auto bg-white">
                  <table className="min-w-max w-full whitespace-nowrap text-xs">
                    <thead className="sticky top-0 z-20">
                      <tr className="bg-[#0B3B2E]">
                        {/* Sticky: Unit */}
                        <th className="sticky left-0 z-30 w-[88px] min-w-[88px] bg-[#0B3B2E] px-3 py-3 text-left">
                          <div className="text-[8px] font-bold uppercase tracking-widest text-white/30 mb-0.5">—</div>
                          <div className="text-[11px] font-semibold text-white">Unit</div>
                        </th>
                        {/* Sticky: Tenant */}
                        <th className="sticky left-[88px] z-30 w-[155px] min-w-[155px] bg-[#0B3B2E] px-3 py-3 text-left border-r border-white/10">
                          <div className="text-[8px] font-bold uppercase tracking-widest text-white/30 mb-0.5">—</div>
                          <div className="text-[11px] font-semibold text-white">Tenant</div>
                        </th>
                        {/* Ledger group */}
                        <th className="px-3 py-3 text-right">
                          <div className="text-[8px] font-bold uppercase tracking-widest text-white/30 mb-0.5">Ledger</div>
                          <div className="text-[11px] font-semibold text-white">Bal B/F</div>
                        </th>
                        {/* Rent group */}
                        <th className="border-l border-white/10 px-3 py-3 text-right">
                          <div className="text-[8px] font-bold uppercase tracking-widest text-white/30 mb-0.5">Rent</div>
                          <div className="text-[11px] font-semibold text-white">Invoiced</div>
                        </th>
                        {hasInvoiceVatColumn && (
                          <th className="px-3 py-3 text-right">
                            <div className="text-[8px] font-bold uppercase tracking-widest text-white/30 mb-0.5">Rent</div>
                            <div className="text-[11px] font-semibold text-white">VAT Inv.</div>
                          </th>
                        )}
                        <th className="px-3 py-3 text-right">
                          <div className="text-[8px] font-bold uppercase tracking-widest text-white/30 mb-0.5">Rent</div>
                          <div className="text-[11px] font-semibold text-white">Paid</div>
                        </th>
                        {hasInvoiceVatColumn && (
                          <th className="px-3 py-3 text-right">
                            <div className="text-[8px] font-bold uppercase tracking-widest text-white/30 mb-0.5">Rent</div>
                            <div className="text-[11px] font-semibold text-white">VAT Pd.</div>
                          </th>
                        )}
                        {/* Utility groups */}
                        {statementColumns.map((column) => (
                          <React.Fragment key={`head-${column.key}`}>
                            <th className="border-l border-white/10 px-3 py-3 text-right">
                              <div className="mb-0.5 max-w-[90px] truncate text-[8px] font-bold uppercase tracking-widest text-white/30">{column.label}</div>
                              <div className="text-[11px] font-semibold text-white">Invoiced</div>
                            </th>
                            <th className="px-3 py-3 text-right">
                              <div className="mb-0.5 max-w-[90px] truncate text-[8px] font-bold uppercase tracking-widest text-white/30">{column.label}</div>
                              <div className="text-[11px] font-semibold text-white">Paid</div>
                            </th>
                          </React.Fragment>
                        ))}
                        {/* Summary group */}
                        <th className="border-l border-white/10 px-3 py-3 text-right">
                          <div className="text-[8px] font-bold uppercase tracking-widest text-white/30 mb-0.5">Summary</div>
                          <div className="text-[11px] font-semibold text-white">Total Paid</div>
                        </th>
                        <th className="px-3 py-3 text-right">
                          <div className="text-[8px] font-bold uppercase tracking-widest text-white/30 mb-0.5">Summary</div>
                          <div className="text-[11px] font-semibold text-white">Bal C/F</div>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white">
                      {statementDisplayRows.length === 0 ? (
                        <tr>
                          <td colSpan={statementColSpan} className="px-4 py-14 text-center">
                            <div className="flex flex-col items-center gap-3">
                              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100">
                                <FaFileAlt className="text-slate-400" size={16} />
                              </div>
                              <div>
                                <p className="text-sm font-semibold text-slate-700">No rows generated</p>
                                <p className="mt-0.5 text-xs text-slate-400">Adjust the date range and regenerate the draft.</p>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        statementDisplayRows.map((row, index) => {
                          const closingBal = Number(row.closingBalance ?? row.balanceCF ?? row.balance ?? 0);
                          const isOdd = index % 2 !== 0;
                          const rowBase = isOdd ? "bg-slate-50" : "bg-white";
                          return (
                            <tr
                              key={`${row.unitId || row.unitNumber || "row"}-${index}`}
                              className={`${rowBase} border-b border-slate-100 transition-colors hover:bg-orange-50/30`}
                            >
                              <td className={`sticky left-0 z-10 w-[88px] min-w-[88px] ${rowBase} px-3 py-2.5 shadow-[2px_0_5px_-3px_rgba(0,0,0,0.1)]`}>
                                <div className="text-xs font-semibold text-slate-900">{row.displayUnitLabel || row.unit || row.unitNumber || "—"}</div>
                                {Array.isArray(row.allUnitLabels) && row.allUnitLabels.length > 1 && (
                                  <div className="mt-0.5 text-[10px] text-slate-400 truncate max-w-[76px]">{row.allUnitLabels.join(", ")}</div>
                                )}
                              </td>
                              <td className={`sticky left-[88px] z-10 w-[155px] min-w-[155px] ${rowBase} border-r border-slate-100 px-3 py-2.5 shadow-[2px_0_5px_-3px_rgba(0,0,0,0.1)]`}>
                                <div className="max-w-[135px] truncate text-xs font-medium text-slate-800">{row.tenantName || "—"}</div>
                                {Number(row.multiUnitCount || 1) > 1 && (
                                  <div className="mt-1 inline-flex rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700">
                                    {row.multiUnitCount} units
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-right text-slate-500">{currency(row.openingBalance ?? row.balanceBF ?? 0)}</td>
                              <td className="border-l border-slate-100 px-3 py-2.5 text-right text-slate-700">{currency(row.invoicedRent)}</td>
                              {hasInvoiceVatColumn && (
                                <td className="px-3 py-2.5 text-right text-slate-500">{currency(row.invoicedTax ?? 0)}</td>
                              )}
                              <td className="px-3 py-2.5 text-right font-medium text-emerald-700">{currency(row.paidRent)}</td>
                              {hasInvoiceVatColumn && (
                                <td className="px-3 py-2.5 text-right text-emerald-600">{currency(row.paidTax ?? 0)}</td>
                              )}
                              {statementColumns.map((column) => (
                                <React.Fragment key={`${row.unitId || row.unitNumber || "row"}-${column.key}`}>
                                  <td className="border-l border-slate-100 px-3 py-2.5 text-right text-slate-700">
                                    {currency(getPreparedStatementColumnValue(row, column.key, "invoiced"))}
                                  </td>
                                  <td className="px-3 py-2.5 text-right font-medium text-emerald-700">
                                    {currency(getPreparedStatementColumnValue(row, column.key, "paid"))}
                                  </td>
                                </React.Fragment>
                              ))}
                              <td className="border-l border-slate-100 px-3 py-2.5 text-right font-semibold text-slate-900">{currency(row.totalPaid)}</td>
                              <td className={`px-3 py-2.5 text-right font-semibold ${
                                closingBal < 0 ? "text-red-600" : closingBal > 0 ? "text-emerald-700" : "text-slate-400"
                              }`}>
                                {currency(closingBal)}
                              </td>
                            </tr>
                          );
                        })
                      )}
                      {/* Totals row */}
                      {preparedRows.length > 0 && (
                        <tr className="border-t-2 border-[#0B3B2E] bg-[#0B3B2E]">
                          <td className="sticky left-0 z-10 w-[88px] min-w-[88px] bg-[#0B3B2E] px-3 py-3 text-xs font-bold text-white">Totals</td>
                          <td className="sticky left-[88px] z-10 w-[155px] min-w-[155px] border-r border-white/10 bg-[#0B3B2E] px-3 py-3"></td>
                          <td className="px-3 py-3 text-right text-xs font-semibold text-white/80">{currency(totals.openingBalance ?? summary.openingBalance ?? 0)}</td>
                          <td className="border-l border-white/10 px-3 py-3 text-right text-xs font-semibold text-white">{currency(totals.invoicedRent ?? summary.rentInvoiced ?? 0)}</td>
                          {hasInvoiceVatColumn && (
                            <td className="px-3 py-3 text-right text-xs font-semibold text-white/80">{currency(totals.invoicedTax ?? summary.totalInvoiceVatInvoiced ?? 0)}</td>
                          )}
                          <td className="px-3 py-3 text-right text-xs font-bold text-white">{currency(totals.paidRent ?? summary.totalRentReceived ?? 0)}</td>
                          {hasInvoiceVatColumn && (
                            <td className="px-3 py-3 text-right text-xs font-semibold text-white/80">{currency(totals.paidTax ?? totalInvoiceVatReceived ?? 0)}</td>
                          )}
                          {statementColumns.map((column) => (
                            <React.Fragment key={`foot-${column.key}`}>
                              <td className="border-l border-white/10 px-3 py-3 text-right text-xs font-semibold text-white">{currency(Number(column?.invoiced || 0))}</td>
                              <td className="px-3 py-3 text-right text-xs font-bold text-white">{currency(Number(column?.paid || 0))}</td>
                            </React.Fragment>
                          ))}
                          <td className="border-l border-white/10 px-3 py-3 text-right text-xs font-bold text-white">{currency(totals.totalPaid ?? 0)}</td>
                          <td className="px-3 py-3 text-right text-xs font-bold text-white">{currency(totals.closingBalance ?? summary.closingBalance ?? 0)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>

                  {/* Detail sections */}
                  {hasWorkspaceDetailSections && (
                    <div className="space-y-5 border-t border-slate-200 bg-slate-50 px-5 py-5">
                      {depositSettlementRows.length > 0 && (
                        <div>
                          <h4 className="mb-3 border-l-2 border-[#0B3B2E] pl-2.5 text-[10px] font-bold uppercase tracking-widest text-[#0B3B2E]">
                            Deposit Remittance
                          </h4>
                          <div className="mb-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                            <div className="rounded-xl bg-emerald-50 px-4 py-3.5">
                              <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-600">Added to landlord</p>
                              <p className="mt-1.5 text-base font-bold text-emerald-900">{currency(depositSettlementTotals.additions)}</p>
                            </div>
                            <div className="rounded-xl bg-amber-50 px-4 py-3.5">
                              <p className="text-[10px] font-bold uppercase tracking-wide text-amber-600">Direct receipt offsets</p>
                              <p className="mt-1.5 text-base font-bold text-amber-900">{currency(depositSettlementTotals.offsets)}</p>
                            </div>
                            <div className="rounded-xl bg-white px-4 py-3.5 border border-slate-200">
                              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Net settlement impact</p>
                              <p className="mt-1.5 text-base font-bold text-slate-900">{currency(depositSettlementTotals.netImpact)}</p>
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            {depositSettlementAdditionRows.map((item, index) => (
                              <div key={`deposit-settlement-add-${index}`} className="flex items-center justify-between rounded-lg border border-emerald-100 bg-emerald-50/70 px-4 py-2.5">
                                <div>
                                  <p className="text-xs text-slate-700">{item.description || "Deposit remittance"}</p>
                                  <p className="mt-0.5 text-[10px] text-slate-400">{item.holder === "landlord" ? "Landlord-held deposit" : "Deposit settlement"}</p>
                                </div>
                                <span className="text-xs font-semibold text-emerald-800">{currency(item.amount)}</span>
                              </div>
                            ))}
                            {depositSettlementOffsetRows.map((item, index) => (
                              <div key={`deposit-settlement-offset-${index}`} className="flex items-center justify-between rounded-lg border border-amber-100 bg-amber-50/70 px-4 py-2.5">
                                <div>
                                  <p className="text-xs text-slate-700">{item.description || "Deposit offset"}</p>
                                  <p className="mt-0.5 text-[10px] text-slate-400">Shown as both addition and deduction for direct landlord deposit receipts</p>
                                </div>
                                <span className="text-xs font-semibold text-amber-800">{currency(item.amount)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {broughtForwardCreditApplicationRows.length > 0 && (
                        <div>
                          <h4 className="mb-3 border-l-2 border-[#0B3B2E] pl-2.5 text-[10px] font-bold uppercase tracking-widest text-[#0B3B2E]">
                            Brought Forward Credits Applied
                          </h4>
                          <div className="mb-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <div className="rounded-xl bg-sky-50 px-4 py-3.5">
                              <p className="text-[10px] font-bold uppercase tracking-wide text-sky-600">Total applied</p>
                              <p className="mt-1.5 text-base font-bold text-sky-900">{currency(broughtForwardCreditApplicationTotals.totalApplied || 0)}</p>
                            </div>
                            {[
                              { label: "Rent portion", val: broughtForwardCreditApplicationTotals.rentApplied || 0 },
                              { label: "Utility portion", val: broughtForwardCreditApplicationTotals.utilityApplied || 0 },
                              { label: "VAT portion", val: broughtForwardCreditApplicationTotals.taxApplied || 0 },
                            ].map(({ label, val }) => (
                              <div key={label} className="rounded-xl border border-slate-200 bg-white px-4 py-3.5">
                                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
                                <p className="mt-1.5 text-base font-bold text-slate-900">{currency(val)}</p>
                              </div>
                            ))}
                          </div>
                          <div className="space-y-1.5">
                            {broughtForwardCreditApplicationRows.map((item, index) => (
                              <div key={`bf-credit-${index}`} className="flex items-start justify-between gap-3 rounded-lg border border-sky-100 bg-sky-50/60 px-4 py-2.5">
                                <div>
                                  <p className="text-xs text-slate-700">{item.description || "Brought forward credit applied"}</p>
                                  <p className="mt-0.5 text-[10px] text-slate-400">
                                    Receipt {item.receiptReference || "—"}
                                    {item.chargeReference ? ` · Applied to ${item.chargeReference}` : ""}
                                    {item.unit ? ` · Unit ${item.unit}` : ""}
                                  </p>
                                </div>
                                <span className="flex-shrink-0 text-xs font-semibold text-sky-800">{currency(item.amount)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {depositMemoRows.length > 0 && (
                        <div>
                          <h4 className="mb-1 border-l-2 border-[#0B3B2E] pl-2.5 text-[10px] font-bold uppercase tracking-widest text-[#0B3B2E]">
                            Deposit Memorandum
                          </h4>
                          <p className="mb-3 text-[11px] text-slate-500">
                            Held deposit positions shown as positive values for readability — excluded from settlement.
                          </p>
                          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                            <table className="min-w-full divide-y divide-slate-100 text-xs">
                              <thead className="bg-slate-50">
                                <tr>
                                  {["Holder", "Opening", "Billed / Adj.", "Received", "Closing"].map((h, i) => (
                                    <th key={h} className={`px-4 py-2.5 ${i === 0 ? "text-left" : "text-right"} font-semibold text-slate-600`}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 bg-white">
                                {depositMemoRows.map((item, index) => (
                                  <tr key={`deposit-memo-${index}`} className="hover:bg-slate-50/60 transition-colors">
                                    <td className="px-4 py-2.5 text-slate-700">{item.label || item.key || "Deposit memo"}</td>
                                    <td className="px-4 py-2.5 text-right text-slate-600">{depositMemoCurrency(item.openingBalance)}</td>
                                    <td className="px-4 py-2.5 text-right text-slate-600">{depositMemoCurrency(item.billed)}</td>
                                    <td className="px-4 py-2.5 text-right text-slate-600">{depositMemoCurrency(item.received)}</td>
                                    <td className="px-4 py-2.5 text-right font-semibold text-slate-900">{depositMemoCurrency(item.closingBalance)}</td>
                                  </tr>
                                ))}
                                <tr className="bg-slate-50 font-semibold">
                                  <td className="px-4 py-2.5 text-slate-700">Total</td>
                                  <td className="px-4 py-2.5 text-right text-slate-900">{depositMemoCurrency(depositMemoTotals.openingBalance)}</td>
                                  <td className="px-4 py-2.5 text-right text-slate-900">{depositMemoCurrency(depositMemoTotals.billed)}</td>
                                  <td className="px-4 py-2.5 text-right text-slate-900">{depositMemoCurrency(depositMemoTotals.received)}</td>
                                  <td className="px-4 py-2.5 text-right text-slate-900">{depositMemoCurrency(depositMemoTotals.closingBalance)}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {nonDepositExpenseRows.length > 0 && (
                        <div>
                          <h4 className="mb-2 border-l-2 border-[#0B3B2E] pl-2.5 text-[10px] font-bold uppercase tracking-widest text-[#0B3B2E]">
                            Deductions / Expenses
                          </h4>
                          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                            {nonDepositExpenseRows.map((item, index) => (
                              <div key={`expense-${index}`} className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 last:border-0 odd:bg-white even:bg-slate-50/60">
                                <span className="text-xs text-slate-700">{item.description || item.name || "Expense"}</span>
                                <span className="text-xs font-semibold text-slate-900">{currency(item.amount)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {nonDepositAdditionRows.length > 0 && (
                        <div>
                          <h4 className="mb-2 border-l-2 border-[#0B3B2E] pl-2.5 text-[10px] font-bold uppercase tracking-widest text-[#0B3B2E]">
                            Additions
                          </h4>
                          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                            {nonDepositAdditionRows.map((item, index) => (
                              <div key={`addition-${index}`} className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 last:border-0 odd:bg-white even:bg-slate-50/60">
                                <span className="text-xs text-slate-700">{item.description || item.name || "Addition"}</span>
                                <span className="text-xs font-semibold text-emerald-700">{currency(item.amount)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {earlyPayoutRows.length > 0 && (
                        <div>
                          <h4 className="mb-1 border-l-2 border-amber-400 pl-2.5 text-[10px] font-bold uppercase tracking-widest text-amber-700">
                            Early Payouts to Landlord
                          </h4>
                          <p className="mb-2 text-[11px] text-slate-500">Advances already paid against future remittances. Deducted from settlement.</p>
                          <div className="overflow-hidden rounded-xl border border-amber-200 bg-white">
                            {earlyPayoutRows.map((item, index) => (
                              <div key={`early-payout-${index}`} className="flex items-center justify-between border-b border-amber-100 px-4 py-2.5 last:border-0 odd:bg-white even:bg-amber-50/40">
                                <div>
                                  <span className="text-xs text-slate-700">{item.description || "Early payout"}</span>
                                  {item.date && <span className="ml-2 text-[10px] text-slate-400">{new Date(item.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>}
                                </div>
                                <span className="text-xs font-semibold text-amber-700">({currency(item.amount)})</span>
                              </div>
                            ))}
                            <div className="flex items-center justify-between border-t border-amber-200 bg-amber-50 px-4 py-2.5">
                              <span className="text-xs font-bold text-amber-800">Total early payouts</span>
                              <span className="text-xs font-bold text-amber-800">({currency(earlyPayoutRows.reduce((s, r) => s + Number(r.amount || 0), 0))})</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {advanceRecoveryRows.length > 0 && (
                        <div>
                          <h4 className="mb-1 border-l-2 border-red-400 pl-2.5 text-[10px] font-bold uppercase tracking-widest text-red-700">
                            Advance Recoveries
                          </h4>
                          <p className="mb-2 text-[11px] text-slate-500">Landlord advances being recovered through this statement period.</p>
                          <div className="overflow-hidden rounded-xl border border-red-200 bg-white">
                            {advanceRecoveryRows.map((item, index) => (
                              <div key={`advance-recovery-${index}`} className="flex items-center justify-between border-b border-red-100 px-4 py-2.5 last:border-0 odd:bg-white even:bg-red-50/40">
                                <div>
                                  <span className="text-xs text-slate-700">{item.description || "Advance recovery"}</span>
                                  {item.date && <span className="ml-2 text-[10px] text-slate-400">{new Date(item.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>}
                                </div>
                                <span className="text-xs font-semibold text-red-600">({currency(item.amount)})</span>
                              </div>
                            ))}
                            <div className="flex items-center justify-between border-t border-red-200 bg-red-50 px-4 py-2.5">
                              <span className="text-xs font-bold text-red-800">Total advance recoveries</span>
                              <span className="text-xs font-bold text-red-800">({currency(advanceRecoveryRows.reduce((s, r) => s + Number(r.amount || 0), 0))})</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {directToLandlordRows.length > 0 && (
                        <div>
                          <h4 className="mb-2 border-l-2 border-[#0B3B2E] pl-2.5 text-[10px] font-bold uppercase tracking-widest text-[#0B3B2E]">
                            Payments Collected Directly by Landlord
                          </h4>
                          <div className="overflow-hidden border border-[#0B3B2E]/20 bg-white">
                            <div className="grid grid-cols-[80px_60px_1fr_60px_80px_90px] gap-0 border-b border-slate-200 bg-slate-50 px-3 py-1.5">
                              {["Date", "Unit", "Tenant", "Type", "Reference", "Amount"].map((h) => (
                                <span key={h} className="text-[9px] font-black uppercase tracking-widest text-slate-500">{h}</span>
                              ))}
                            </div>
                            {directToLandlordRows.map((item, index) => (
                              <div key={`direct-${index}`} className={`grid grid-cols-[80px_60px_1fr_60px_80px_90px] gap-0 border-b border-slate-100 px-3 py-2 last:border-0 ${index % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}>
                                <span className="text-[10px] text-slate-600">
                                  {item.date ? new Date(item.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—"}
                                </span>
                                <span className="text-[10px] font-semibold text-slate-700">{item.unit || "—"}</span>
                                <div>
                                  <span className="block text-[10px] font-semibold text-slate-800">{item.tenantName || item.description || "—"}</span>
                                  {item.tenantCode && item.tenantCode !== "-" && (
                                    <span className="text-[9px] text-slate-400">{item.tenantCode}</span>
                                  )}
                                </div>
                                <span className={`text-[9px] font-black uppercase tracking-wide ${item.paymentType === "utility" ? "text-blue-600" : "text-[#0B3B2E]"}`}>
                                  {item.typeLabel || "Rent"}
                                </span>
                                <span className="text-[10px] text-slate-500 truncate">{item.receiptRef || "—"}</span>
                                <span className="text-[10px] font-bold text-slate-900 text-right">{currency(item.amount)}</span>
                              </div>
                            ))}
                            <div className="flex items-center justify-between border-t-2 border-[#0B3B2E]/20 bg-[#EDF5F1] px-3 py-2">
                              <span className="text-[10px] font-black uppercase tracking-wide text-[#0B3B2E]">Total received directly by landlord</span>
                              <span className="text-[10px] font-black text-[#0B3B2E]">{currency(directToLandlordAmount)}</span>
                            </div>
                          </div>
                          <p className="mt-1.5 text-[9px] italic text-slate-400 leading-4">
                            These payments were made directly to you by tenants and are NOT included in the manager&apos;s remittance transfer below.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* KPI footer */}
                <div className="flex-shrink-0 border-t border-slate-200 bg-white shadow-[0_-2px_6px_rgba(0,0,0,0.05)]">
                  <div className="grid grid-cols-2 divide-x divide-slate-100 md:grid-cols-4">
                    <div className="px-5 py-3.5">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Rent Collected</p>
                      <p className="mt-1.5 text-sm font-bold text-slate-900">{currency(totals.rentPaid)}</p>
                      {hasInvoiceVatColumn && (
                        <p className="mt-0.5 text-[10px] text-slate-400">VAT: {currency(totalInvoiceVatReceived)}</p>
                      )}
                    </div>
                    <div className="px-5 py-3.5">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Utilities Paid</p>
                      <p className="mt-1.5 text-sm font-bold text-slate-900">{currency(totals.utilityPaid)}</p>
                    </div>
                    <div className="px-5 py-3.5">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Expenses</p>
                      <p className={`mt-1.5 text-sm font-bold ${Number(totals.expenses || 0) > 0 ? "text-amber-700" : "text-slate-900"}`}>
                        {currency(totals.expenses)}
                      </p>
                    </div>
                    <div className={`px-5 py-3.5 ${settlement.isNegative ? "bg-red-50" : "bg-[#0B3B2E]"}`}>
                      <p className={`text-[9px] font-bold uppercase tracking-widest ${settlement.isNegative ? "text-red-500" : "text-green-200/60"}`}>
                        {settlement.label}
                      </p>
                      <p className={`mt-1.5 text-sm font-bold ${settlement.isNegative ? "text-red-700" : "text-white"}`}>
                        {currency(settlement.amount)}
                      </p>
                    </div>
                  </div>
                  {directToLandlordAmount > 0 && (
                    <div className="border-t border-[#0B3B2E]/20 bg-[#EDF5F1] px-4 py-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-4 text-xs">
                          <span className="text-slate-600">
                            Manager transfers: <strong className="text-slate-900">{currency(Math.max(0, settlement.amount))}</strong>
                          </span>
                          <span className="text-slate-400">+</span>
                          <span className="text-slate-600">
                            Already with you: <strong className="text-[#0B3B2E]">{currency(directToLandlordAmount)}</strong>
                          </span>
                        </div>
                        <div className="text-right">
                          <p className="text-[9px] font-black uppercase tracking-widest text-[#0B3B2E]">Total Income This Period</p>
                          <p className="text-base font-black text-[#0B3B2E]">{currency(Math.max(0, settlement.amount) + directToLandlordAmount)}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
};

export default Statements;