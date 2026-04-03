import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import {
  FaArrowLeft,
  FaFileInvoice,
  FaDownload,
  FaPrint,
  FaEye,
  FaArrowRight,
  FaSearch,
  FaRedoAlt,
  FaEdit,
  FaTrash,
  FaPlus,
} from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import JournalEntriesDrawer from "../../components/Accounting/JournalEntriesDrawer";
import { getTenants } from "../../redux/tenantsRedux";
import { getProperties } from "../../redux/propertyRedux";
import { getUnits } from "../../redux/unitRedux";
import { getRentPayments, getChartOfAccounts } from "../../redux/apiCalls";
import {
  createTenantInvoice,
  createTenantInvoicesBatch,
  getTenantInvoices,
  deleteTenantInvoice,
} from "../../redux/invoiceApi";
import { adminRequests } from "../../utils/requestMethods";
import {
  buildTaxPreviewForComponents,
  getActiveTaxCodes,
  getTaxCodeLabel,
  normalizeCompanyTaxConfig,
  resolveTaxSelectionPayload,
} from "./invoiceTaxUtils";

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";
const MILIK_ORANGE = "bg-[#FF8C00]";
const MILIK_ORANGE_HOVER = "hover:bg-[#e67e00]";
const ITEMS_PER_PAGE = 50;

const INVOICE_REVENUE_ACCOUNT_MAP = {
  utility: { code: "4102", name: "Utility Recharge Income", category: "UTILITY_CHARGE" },
  rent: { code: "4100", name: "Rent Income", category: "RENT_CHARGE" },
  combined: { code: "4100", name: "Rent Income", category: "RENT_CHARGE" },
};

const MONTH_OPTIONS = [
  { value: 0, label: "January" },
  { value: 1, label: "February" },
  { value: 2, label: "March" },
  { value: 3, label: "April" },
  { value: 4, label: "May" },
  { value: 5, label: "June" },
  { value: 6, label: "July" },
  { value: 7, label: "August" },
  { value: 8, label: "September" },
  { value: 9, label: "October" },
  { value: 10, label: "November" },
  { value: 11, label: "December" },
];

const emptyFilters = {
  status: "ACTIVE",
  fromDate: "",
  toDate: "",
  property: "any",
  tenantName: "",
  unit: "any",
  invoiceNo: "",
};

const getTenantDisplayName = (tenant) => {
  const fullName = `${tenant?.firstName || ""} ${tenant?.lastName || ""}`.trim();
  return fullName || tenant?.tenantName || tenant?.name || "N/A";
};

const getUnitDisplayName = (tenant) => {
  return (
    tenant?.unit?.unitName ||
    tenant?.unit?.name ||
    tenant?.unit?.unitNumber ||
    tenant?.unitName ||
    "N/A"
  );
};

const formatDateDisplay = (dateValue, options = {}) => {
  if (!dateValue) return "-";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-GB", options);
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");


const ensureArray = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.tenants)) return value.tenants;
  return [];
};

const formatPeriodLabel = (month, year) => {
  const date = new Date(year, month, 1);
  return `${date.toLocaleString("en-US", { month: "short" })} ${String(year).slice(-2)}`;
};

const toPeriodDateString = (year, month, day) => {
  const safeYear = Number(year);
  const safeMonth = Number(month);
  const safeDay = Number(day);
  return `${String(safeYear).padStart(4, "0")}-${String(safeMonth + 1).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
};

const getStartOfPeriod = (month, year) => toPeriodDateString(year, month, 1);
const getEndOfPeriod = (month, year) => toPeriodDateString(year, month, 5);
const isFutureBillingPeriod = (month, year) => {
  const parsedMonth = Number(month);
  const parsedYear = Number(year);
  if (!Number.isFinite(parsedMonth) || !Number.isFinite(parsedYear)) return false;

  const selectedPeriodStart = new Date(parsedYear, parsedMonth, 1, 0, 0, 0, 0);
  if (Number.isNaN(selectedPeriodStart.getTime())) return false;

  const now = new Date();
  const currentPeriodStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  return selectedPeriodStart.getTime() > currentPeriodStart.getTime();
};

const clampBillingPeriod = (month, year) => {
  const now = new Date();
  const fallback = { month: now.getMonth(), year: now.getFullYear() };
  const parsedMonth = Number(month);
  const parsedYear = Number(year);

  if (!Number.isFinite(parsedMonth) || !Number.isFinite(parsedYear)) {
    return fallback;
  }

  if (isFutureBillingPeriod(parsedMonth, parsedYear)) {
    return fallback;
  }

  return {
    month: parsedMonth,
    year: parsedYear,
  };
};

const buildCombinedInvoiceMetadata = ({ utilityAmount = 0, utilityLabel = "", periodLabel = "" } = {}) => {
  const normalizedUtilityLabel = String(utilityLabel || "").trim() || "Utility";
  return {
    billItemKey: "rent_utility:combined",
    billItemLabel: "Combined Rent + Utilities",
    invoicePriorityCategory: "rent",
    sourceTransactionType: "rental_invoice_combined",
    utilityBreakdown:
      Number(utilityAmount || 0) > 0
        ? [
            {
              label: normalizedUtilityLabel,
              amount: Number(utilityAmount || 0),
              periodLabel,
            },
          ]
        : [],
  };
};

const buildUtilityInvoiceMetadata = (utilityLabel = "") => {
  const normalizedUtilityLabel = String(utilityLabel || "").trim();
  if (!normalizedUtilityLabel) return undefined;

  return {
    utilityType: normalizedUtilityLabel,
    meterUtilityType: normalizedUtilityLabel,
    statementUtilityType: normalizedUtilityLabel,
  };
};

const normalizeInvoiceStatus = (status = "") => String(status || "").trim().toLowerCase();
const isActiveInvoiceStatus = (status = "") => !["cancelled", "reversed"].includes(normalizeInvoiceStatus(status));

const normalizeUtilityConflictKey = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const getInvoiceConflictBucket = ({ category, metadata = {} } = {}) => {
  const normalizedCategory = String(category || "").trim().toUpperCase();

  if (normalizedCategory === "RENT_CHARGE") {
    return String(metadata?.billItemKey || "").trim().toLowerCase() === "rent_utility:combined"
      ? "combined"
      : "rent";
  }

  if (normalizedCategory === "UTILITY_CHARGE") {
    const utilityKey = normalizeUtilityConflictKey(
      metadata?.utilityType ||
        metadata?.meterUtilityType ||
        metadata?.statementUtilityType ||
        metadata?.utilityName ||
        metadata?.utility ||
        ""
    );

    return utilityKey ? `utility:${utilityKey}` : "utility";
  }

  return "";
};

const isUtilityConflictBucket = (bucket = "") =>
  bucket === "utility" || String(bucket || "").startsWith("utility:");

const doInvoiceConflictBucketsOverlap = (requestedBucket = "", existingBucket = "") => {
  if (!requestedBucket || !existingBucket) return false;

  if (requestedBucket === "combined") {
    return existingBucket === "combined" || existingBucket === "rent" || isUtilityConflictBucket(existingBucket);
  }

  if (requestedBucket === "rent") {
    return existingBucket === "combined" || existingBucket === "rent";
  }

  if (isUtilityConflictBucket(requestedBucket)) {
    if (existingBucket === "combined") return true;
    if (!isUtilityConflictBucket(existingBucket)) return false;
    if (requestedBucket === "utility" || existingBucket === "utility") return true;
    return requestedBucket === existingBucket;
  }

  return false;
};

const isInvoiceInBillingPeriod = (dateRef, month, year) => {
  if (!dateRef) return false;
  const dt = new Date(dateRef);
  if (Number.isNaN(dt.getTime())) return false;
  return dt.getMonth() === Number(month) && dt.getFullYear() === Number(year);
};

const getActiveInvoicesForTenantPeriod = ({ invoices = [], tenantId, month, year }) =>
  invoices.filter((invoice) => {
    const invoiceTenantId = String(invoice?.tenant?._id || invoice?.tenant || "");
    if (invoiceTenantId !== String(tenantId || "")) return false;
    if (!isActiveInvoiceStatus(invoice?.status)) return false;

    return isInvoiceInBillingPeriod(invoice?.invoiceDate || invoice?.createdAt, month, year);
  });

const hasBlockingInvoiceForRequest = ({
  invoices = [],
  tenantId,
  month,
  year,
  category,
  metadata,
}) => {
  const requestedBucket = getInvoiceConflictBucket({ category, metadata });
  if (!requestedBucket) return false;

  return getActiveInvoicesForTenantPeriod({ invoices, tenantId, month, year }).some((invoice) => {
    const existingBucket = getInvoiceConflictBucket({
      category: invoice?.category,
      metadata: invoice?.metadata || {},
    });

    return doInvoiceConflictBucketsOverlap(requestedBucket, existingBucket);
  });
};

const getBookingTaxSelection = (form = {}) => ({
  handling: form?.taxHandling || "company_default",
  taxCodeKey: form?.taxCodeKey || "vat_standard",
  taxMode: form?.taxMode || "company_default",
});

const resolveTenantPropertyName = (tenant, unitsFromStore = [], propertiesFromStore = []) => {
  const directPropertyName =
    tenant?.unit?.property?.propertyName ||
    tenant?.property?.propertyName ||
    tenant?.propertyName;
  if (directPropertyName) return directPropertyName;

  const tenantUnitId = tenant?.unit?._id || tenant?.unit;
  const tenantUnitIdStr = tenantUnitId ? String(tenantUnitId) : "";
  const matchedUnit = unitsFromStore.find((unit) => String(unit?._id || "") === tenantUnitIdStr);

  const propertyIdFromUnit = matchedUnit?.property?._id || matchedUnit?.property;
  const propertyIdFromTenant = tenant?.property?._id || tenant?.property;
  const resolvedPropertyId = propertyIdFromUnit || propertyIdFromTenant;
  const resolvedPropertyIdStr = resolvedPropertyId ? String(resolvedPropertyId) : "";

  const matchedProperty = propertiesFromStore.find(
    (property) => String(property?._id || "") === resolvedPropertyIdStr
  );

  return (
    matchedUnit?.property?.propertyName ||
    matchedProperty?.propertyName ||
    matchedProperty?.name ||
    "N/A"
  );
};

const buildJournalEntriesForInvoice = (invoice) => {
  const amount = Number(invoice?.amount || 0);
  const chargeType = String(invoice?.chargeType || "combined").toLowerCase();
  const revenueAccount =
    INVOICE_REVENUE_ACCOUNT_MAP[chargeType] || INVOICE_REVENUE_ACCOUNT_MAP.combined;
  const narration = `Invoice ${invoice?.id || ""} ${chargeType} charge for ${invoice?.period || "period"}`;

  return [
    {
      accountCode: "1200",
      accountName: "Tenant Receivables",
      debit: amount,
      credit: 0,
      narration,
    },
    {
      accountCode: revenueAccount.code,
      accountName: revenueAccount.name,
      debit: 0,
      credit: amount,
      narration,
    },
  ];
};

const RentalInvoices = () => {
  const { id: tenantId } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const [refreshTick, setRefreshTick] = useState(0);
  const [draftFilters, setDraftFilters] = useState(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState(emptyFilters);
  const [selectedInvoices, setSelectedInvoices] = useState([]);
  const [selectAll, setSelectAll] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [bookingAction, setBookingAction] = useState("");
  const [showSingleBooking, setShowSingleBooking] = useState(false);
  const [showBatchBooking, setShowBatchBooking] = useState(false);
  const [journalDrawerOpen, setJournalDrawerOpen] = useState(false);
  const [journalContext, setJournalContext] = useState({});
  const [journalLines, setJournalLines] = useState([]);
  const [tenantInvoicesFromApi, setTenantInvoicesFromApi] = useState([]);
  const [invoiceRevenueAccounts, setInvoiceRevenueAccounts] = useState([]);
  const [deletingInvoiceIds, setDeletingInvoiceIds] = useState([]);
  const [submittingSingleBooking, setSubmittingSingleBooking] = useState(false);
  const [submittingBatchBooking, setSubmittingBatchBooking] = useState(false);
  const currentDate = new Date();
  const currentBookingMonth = currentDate.getMonth();
  const currentBookingYear = currentDate.getFullYear();

  const [singleBookingForm, setSingleBookingForm] = useState({
    tenantId: tenantId || "",
    month: currentBookingMonth,
    year: currentBookingYear,
    billingMode: "combined",
    taxHandling: "company_default",
    taxCodeKey: "vat_standard",
    taxMode: "company_default",
  });

  const [batchBookingForm, setBatchBookingForm] = useState({
    propertyId: "all",
    month: currentBookingMonth,
    year: currentBookingYear,
    billingMode: "combined",
    taxHandling: "company_default",
    taxCodeKey: "vat_standard",
    taxMode: "company_default",
  });

  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const currentUser = useSelector((state) => state.auth?.currentUser || state.auth?.user || null );
  const rawTenantsFromStore = useSelector((state) => state.tenant?.tenants);
  const propertiesFromStore = useSelector((state) => state.property?.properties || []);
  const unitsFromStore = useSelector((state) => state.unit?.units || []);
  const tenantsFromStore = useMemo(() => ensureArray(rawTenantsFromStore), [rawTenantsFromStore]);
  const rentPayments = useSelector((state) => state.rentPayment?.rentPayments || []);
  const hasLoadedInitialDataRef = useRef(false);
  const [companyTaxConfig, setCompanyTaxConfig] = useState(null);

  const normalizedTaxConfig = useMemo(
    () => normalizeCompanyTaxConfig(companyTaxConfig),
    [companyTaxConfig]
  );
  const activeTaxCodes = useMemo(
    () => getActiveTaxCodes(normalizedTaxConfig),
    [normalizedTaxConfig]
  );
  const companyTaxEnabled = Boolean(normalizedTaxConfig?.taxSettings?.enabled);

  useEffect(() => {
    if (!currentCompany?._id) return;

    dispatch(getTenants({ business: currentCompany._id }));
    dispatch(getProperties({ business: currentCompany._id }));
    dispatch(getUnits({ business: currentCompany._id }));
    getRentPayments(dispatch, currentCompany._id);
  }, [dispatch, currentCompany?._id]);

  useEffect(() => {
    if (!tenantId) return;
    setSingleBookingForm((prev) => ({ ...prev, tenantId }));
  }, [tenantId]);

  useEffect(() => {
    if (!isFutureBillingPeriod(singleBookingForm.month, singleBookingForm.year)) return;

    setSingleBookingForm((prev) => ({
      ...prev,
      month: currentBookingMonth,
      year: currentBookingYear,
    }));
  }, [singleBookingForm.month, singleBookingForm.year, currentBookingMonth, currentBookingYear]);

  useEffect(() => {
    if (!isFutureBillingPeriod(batchBookingForm.month, batchBookingForm.year)) return;

    setBatchBookingForm((prev) => ({
      ...prev,
      month: currentBookingMonth,
      year: currentBookingYear,
    }));
  }, [batchBookingForm.month, batchBookingForm.year, currentBookingMonth, currentBookingYear]);

  useEffect(() => {
    if (!currentCompany?._id) {
      setCompanyTaxConfig(null);
      return;
    }

    let isMounted = true;
    const loadCompanyTaxConfig = async () => {
      try {
        const res = await adminRequests.get(`/company-settings/${currentCompany._id}`);
        if (!isMounted) return;
        setCompanyTaxConfig(res.data || null);
        const defaultTaxCodeKey =
          res?.data?.taxSettings?.defaultTaxCodeKey || "vat_standard";
        setSingleBookingForm((prev) => ({
          ...prev,
          taxCodeKey: prev.taxCodeKey || defaultTaxCodeKey,
        }));
        setBatchBookingForm((prev) => ({
          ...prev,
          taxCodeKey: prev.taxCodeKey || defaultTaxCodeKey,
        }));
      } catch (error) {
        if (isMounted) {
          setCompanyTaxConfig(null);
        }
      }
    };

    loadCompanyTaxConfig();
    return () => {
      isMounted = false;
    };
  }, [currentCompany?._id]);

  useEffect(() => {
    if (!currentCompany?._id) return;

    const loadInvoiceSupportData = async () => {
      try {
        // Your backend chart-of-accounts endpoint appears to require a code.
        // So fetch the known revenue accounts one by one instead of trying to load all income accounts.
        const account4100 = await getChartOfAccounts({
          business: currentCompany._id,
          code: "4100",
        });

        const account4102 = await getChartOfAccounts({
          business: currentCompany._id,
          code: "4102",
        });

        const normalized = [
          ...(Array.isArray(account4100) ? account4100 : []),
          ...(Array.isArray(account4102) ? account4102 : []),
        ];

        const deduped = normalized.filter(
          (acc, index, arr) =>
            acc?._id && arr.findIndex((x) => String(x?._id) === String(acc?._id)) === index
        );

        setInvoiceRevenueAccounts(deduped);
      } catch (error) {
        console.error("Failed to load chart of accounts:", error);
        setInvoiceRevenueAccounts([]);
      }
    };

    loadInvoiceSupportData();
  }, [currentCompany?._id]);

  useEffect(() => {
    if (!currentCompany?._id || tenantsFromStore.length === 0) return;

    const loadInvoices = async () => {
      try {
        let rows = [];

        if (tenantId) {
          rows = await getTenantInvoices({
            tenantId,
            business: currentCompany._id,
          });
        } else {
          rows = await getTenantInvoices({
            business: currentCompany._id,
          });
        }

        setTenantInvoicesFromApi(Array.isArray(rows) ? rows : []);
        hasLoadedInitialDataRef.current = true;
      } catch (error) {
        console.error("Failed to load tenant invoices:", error);
        setTenantInvoicesFromApi([]);
      }
    };

    loadInvoices();
  }, [currentCompany?._id, tenantsFromStore.length, tenantId, refreshTick]);

  const uniqueProperties = useMemo(() => {
    return [
      "any",
      ...Array.from(
        new Set(propertiesFromStore.map((property) => property?.propertyName).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b)),
    ];
  }, [propertiesFromStore]);

  const unitsForSelectedProperty = useMemo(() => {
    let scopedUnits = unitsFromStore;

    if (draftFilters.property !== "any") {
      const selectedProperty = propertiesFromStore.find(
        (property) => property?.propertyName === draftFilters.property
      );
      const selectedPropertyId = selectedProperty?._id;

      scopedUnits = unitsFromStore.filter((unit) => {
        const unitPropertyId = unit?.property?._id || unit?.property;
        const unitPropertyName = unit?.property?.propertyName || unit?.propertyName;

        if (selectedPropertyId) {
          return String(unitPropertyId) === String(selectedPropertyId);
        }
        return unitPropertyName === draftFilters.property;
      });
    }

    return [
      "any",
      ...Array.from(
        new Set(
          scopedUnits
            .map((unit) => unit?.unitNumber || unit?.unitName || unit?.name)
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b)),
    ];
  }, [unitsFromStore, propertiesFromStore, draftFilters.property]);

  const tenantLookup = useMemo(() => {
    const lookup = {};
    tenantsFromStore.forEach((tenant) => {
      lookup[tenant._id] = tenant;
    });
    return lookup;
  }, [tenantsFromStore]);

  const getTenantPricing = (tenant) => {
    const baseRent =
      Number(
        tenant?.lease?.rentAmount ||
          tenant?.rent ||
          tenant?.unit?.rent ||
          tenant?.unit?.monthlyRent ||
          0
      ) || 0;

    const tenantUnitId = tenant?.unit?._id || tenant?.unit;
    const matchedUnit = unitsFromStore.find(
      (unit) => String(unit?._id) === String(tenantUnitId)
    );

    const tenantUtilityRows = Array.isArray(tenant?.utilities) ? tenant.utilities : [];
    const unitUtilityRows = Array.isArray(matchedUnit?.utilities) ? matchedUnit.utilities : [];
    const selectedUtilityRows = tenantUtilityRows.length > 0 ? tenantUtilityRows : unitUtilityRows;
    const billableUtilityRows = selectedUtilityRows.filter((utility) => utility?.isIncluded !== true);

    const utilitiesFromTenant = tenantUtilityRows.reduce((sum, utility) => {
      if (utility?.isIncluded === true) return sum;
      return sum + (Number(utility?.unitCharge || utility?.amount || 0) || 0);
    }, 0);

    const utilitiesFromUnit = unitUtilityRows.reduce((sum, utility) => {
      if (utility?.isIncluded === true) return sum;
      return sum + (Number(utility?.unitCharge || utility?.amount || 0) || 0);
    }, 0);

    const serviceCharge = Number(tenant?.serviceCharge || 0) || 0;
    const utilityAmount =
      utilitiesFromTenant > 0
        ? utilitiesFromTenant + serviceCharge
        : utilitiesFromUnit + serviceCharge;

    const singleUtilityLabel =
      serviceCharge === 0 && billableUtilityRows.length === 1
        ? String(
            billableUtilityRows[0]?.utilityLabel ||
              billableUtilityRows[0]?.utility ||
              ""
          ).trim()
        : "";

    return {
      rentAmount: baseRent,
      utilityAmount,
      utilityLabel: singleUtilityLabel,
      total: baseRent + utilityAmount,
    };
  };

  const getTenantPropertyId = (tenant) => {
    const directPropertyId = tenant?.property?._id || tenant?.property;
    if (directPropertyId) return directPropertyId;

    const tenantUnitId = tenant?.unit?._id || tenant?.unit;
    const matchedUnit = unitsFromStore.find(
      (unit) => String(unit?._id) === String(tenantUnitId)
    );
    return matchedUnit?.property?._id || matchedUnit?.property || null;
  };

  const activeProperties = useMemo(() => {
    return propertiesFromStore.filter((property) => {
      const propertyStatus = String(property?.status || "active").toLowerCase();
      return propertyStatus === "active";
    });
  }, [propertiesFromStore]);

  const singleBookingTenantOptions = useMemo(() => {
    return tenantsFromStore
      .filter((tenant) => String(tenant?.status || "active").toLowerCase() === "active")
      .map((tenant) => ({
        id: tenant._id,
        name: getTenantDisplayName(tenant),
        propertyName: resolveTenantPropertyName(tenant, unitsFromStore, propertiesFromStore),
        unitName: getUnitDisplayName(tenant),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [tenantsFromStore, unitsFromStore, propertiesFromStore]);

  const selectedSingleBookingTenant = useMemo(() => {
    return tenantLookup[singleBookingForm.tenantId] || null;
  }, [tenantLookup, singleBookingForm.tenantId]);

  const selectedSingleBookingPreview = useMemo(() => {
    if (!selectedSingleBookingTenant) return null;
    const pricing = getTenantPricing(selectedSingleBookingTenant);
    return {
      periodLabel: formatPeriodLabel(Number(singleBookingForm.month), Number(singleBookingForm.year)),
      rentAmount: pricing.rentAmount,
      utilityAmount: pricing.utilityAmount,
      totalAmount: pricing.total,
      propertyName: resolveTenantPropertyName(
        selectedSingleBookingTenant,
        unitsFromStore,
        propertiesFromStore
      ),
      unitName: getUnitDisplayName(selectedSingleBookingTenant),
    };
  }, [
    singleBookingForm.month,
    singleBookingForm.year,
    selectedSingleBookingTenant,
    unitsFromStore,
    propertiesFromStore,
  ]);

  const selectedSingleBookingTaxPreview = useMemo(() => {
    if (!selectedSingleBookingPreview) return null;

    const components =
      singleBookingForm.billingMode === "combined"
        ? [{ category: "RENT_CHARGE", amount: selectedSingleBookingPreview.totalAmount }]
        : [
            selectedSingleBookingPreview.rentAmount > 0
              ? { category: "RENT_CHARGE", amount: selectedSingleBookingPreview.rentAmount }
              : null,
            selectedSingleBookingPreview.utilityAmount > 0
              ? { category: "UTILITY_CHARGE", amount: selectedSingleBookingPreview.utilityAmount }
              : null,
          ].filter(Boolean);

    return buildTaxPreviewForComponents({
      components,
      companyTaxConfig: normalizedTaxConfig,
      selection: getBookingTaxSelection(singleBookingForm),
    });
  }, [selectedSingleBookingPreview, singleBookingForm, normalizedTaxConfig]);

  const batchBookingScopeTenants = useMemo(() => {
    return tenantsFromStore.filter((tenant) => {
      const tenantStatus = String(tenant?.status || "active").toLowerCase();
      if (tenantStatus !== "active") return false;

      const tenantPropertyId = getTenantPropertyId(tenant);
      if (!tenantPropertyId) return false;

      if (batchBookingForm.propertyId === "all") {
        return activeProperties.some(
          (property) => String(property?._id) === String(tenantPropertyId)
        );
      }

      return String(tenantPropertyId) === String(batchBookingForm.propertyId);
    });
  }, [tenantsFromStore, batchBookingForm.propertyId, activeProperties]);

  const batchBookingScopeCount = batchBookingScopeTenants.length;

  const batchBookingTaxPreview = useMemo(() => {
    const components = batchBookingScopeTenants.flatMap((tenant) => {
      const pricing = getTenantPricing(tenant);
      if (batchBookingForm.billingMode === "combined") {
        return pricing.total > 0 ? [{ category: "RENT_CHARGE", amount: pricing.total }] : [];
      }

      return [
        pricing.rentAmount > 0 ? { category: "RENT_CHARGE", amount: pricing.rentAmount } : null,
        pricing.utilityAmount > 0 ? { category: "UTILITY_CHARGE", amount: pricing.utilityAmount } : null,
      ].filter(Boolean);
    });

    return buildTaxPreviewForComponents({
      components,
      companyTaxConfig: normalizedTaxConfig,
      selection: getBookingTaxSelection(batchBookingForm),
    });
  }, [batchBookingForm, batchBookingScopeTenants, normalizedTaxConfig]);

  const invoiceRows = useMemo(() => {
    const confirmedReceiptsByTenant = {};

    (rentPayments || [])
      .filter(
        (payment) =>
          payment?.ledgerType === "receipts" &&
          payment?.isConfirmed === true &&
          payment?.isCancelled !== true &&
          payment?.isReversed !== true &&
          !payment?.reversalOf &&
          String(payment?.postingStatus || "").toLowerCase() !== "reversed"
      )
      .forEach((payment) => {
        const tenantRef = payment?.tenant?._id || payment?.tenant;
        const tenantKey = String(tenantRef || "");
        if (!tenantKey) return;

        if (!confirmedReceiptsByTenant[tenantKey]) {
          confirmedReceiptsByTenant[tenantKey] = [];
        }

        confirmedReceiptsByTenant[tenantKey].push({
          amount: Math.abs(Number(payment?.amount || 0)),
          paymentDate: payment?.paymentDate || payment?.createdAt,
        });
      });

    Object.values(confirmedReceiptsByTenant).forEach((rows) => {
      rows.sort((a, b) => new Date(a.paymentDate).getTime() - new Date(b.paymentDate).getTime());
    });

    const tenantPaidAllocation = {};
    Object.keys(confirmedReceiptsByTenant).forEach((tenantKey) => {
      tenantPaidAllocation[tenantKey] = confirmedReceiptsByTenant[tenantKey].reduce(
        (sum, row) => sum + Number(row.amount || 0),
        0
      );
    });

    const sortedInvoices = [...tenantInvoicesFromApi].sort((a, b) => {
      const aTime = a?.invoiceDate ? new Date(a.invoiceDate).getTime() : new Date(a?.createdAt || 0).getTime();
      const bTime = b?.invoiceDate ? new Date(b.invoiceDate).getTime() : new Date(b?.createdAt || 0).getTime();
      return aTime - bTime;
    });

    return sortedInvoices
      .map((invoice, idx) => {
        const invoiceTenantId = String(invoice?.tenant?._id || invoice?.tenant || "");
        const tenant = tenantLookup[invoiceTenantId] || invoice?.tenant || {};
        const invoiceAmount = Number(invoice?.amount || 0);
        const allocatedPaid = Math.min(invoiceAmount, Math.max(0, tenantPaidAllocation[invoiceTenantId] || 0));
        tenantPaidAllocation[invoiceTenantId] = Math.max(
          0,
          Number(tenantPaidAllocation[invoiceTenantId] || 0) - allocatedPaid
        );

        const rawStatus = String(invoice?.status || "").toLowerCase();
        const derivedStatus =
          rawStatus === "paid"
            ? "Paid"
            : rawStatus === "partially_paid"
            ? "Issued"
            : rawStatus === "cancelled"
            ? "Cancelled"
            : rawStatus === "reversed"
            ? "Reversed"
            : allocatedPaid >= invoiceAmount
            ? "Paid"
            : "Issued";

        const invoiceDate = invoice?.invoiceDate || invoice?.createdAt;
        const parsedDate = invoiceDate ? new Date(invoiceDate) : new Date();
        const month = parsedDate.getMonth();
        const year = parsedDate.getFullYear();

        const propertyName =
          invoice?.property?.propertyName ||
          invoice?.propertyName ||
          resolveTenantPropertyName(tenant, unitsFromStore, propertiesFromStore);

        const unitName =
          invoice?.unit?.unitNumber ||
          invoice?.unit?.unitName ||
          invoice?.unitName ||
          getUnitDisplayName(tenant);

        const normalizedCategory = String(invoice?.category || "").toUpperCase();
        const isCombinedInvoice =
          normalizedCategory === "RENT_CHARGE" &&
          String(invoice?.metadata?.billItemKey || "").toLowerCase() === "rent_utility:combined";
        const chargeType =
          isCombinedInvoice
            ? "combined"
            : normalizedCategory === "DEPOSIT_CHARGE"
            ? "deposit"
            : normalizedCategory === "UTILITY_CHARGE"
            ? "utility"
            : "rent";

        return {
          key: `${invoice?._id || idx}`,
          _id: invoice?._id,
          id: invoice?.invoiceNumber || invoice?._id,
          period: formatPeriodLabel(month, year),
          storagePeriodKey: formatPeriodLabel(month, year),
          chargeType,
          tenantId: invoiceTenantId,
          tenantName: invoice?.tenant?.name || getTenantDisplayName(tenant),
          propertyName,
          unitName,
          amount: invoiceAmount,
          status: derivedStatus,
          createdAt: invoice?.createdAt || invoice?.invoiceDate,
          createdDate: formatDateDisplay(invoice?.createdAt || invoice?.invoiceDate),
          originalInvoice: invoice,
        };
      })
      .sort((a, b) => {
        const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bDate - aDate;
      });
  }, [tenantInvoicesFromApi, rentPayments, tenantLookup, unitsFromStore, propertiesFromStore]);

  const filteredInvoices = useMemo(() => {
    return invoiceRows.filter((invoice) => {
      if (deletingInvoiceIds.includes(invoice._id)) return false;
      if (appliedFilters.status === "ACTIVE") {
        if (!["Issued", "Paid"].includes(invoice.status)) return false;
      } else if (appliedFilters.status !== "ALL" && invoice.status !== appliedFilters.status) {
        return false;
      }
      if (appliedFilters.property !== "any" && invoice.propertyName !== appliedFilters.property) return false;
      if (appliedFilters.unit !== "any" && invoice.unitName !== appliedFilters.unit) return false;

      if (
        appliedFilters.tenantName &&
        !invoice.tenantName.toLowerCase().includes(appliedFilters.tenantName.toLowerCase())
      ) {
        return false;
      }

      if (
        appliedFilters.invoiceNo &&
        !String(invoice.id).toLowerCase().includes(appliedFilters.invoiceNo.toLowerCase())
      ) {
        return false;
      }

      if (appliedFilters.fromDate || appliedFilters.toDate) {
        if (!invoice.createdAt) return false;
        const invoiceDate = new Date(invoice.createdAt);
        if (Number.isNaN(invoiceDate.getTime())) return false;

        if (appliedFilters.fromDate) {
          const fromDate = new Date(`${appliedFilters.fromDate}T00:00:00`);
          if (invoiceDate < fromDate) return false;
        }

        if (appliedFilters.toDate) {
          const toDate = new Date(`${appliedFilters.toDate}T23:59:59`);
          if (invoiceDate > toDate) return false;
        }
      }

      return true;
    });
  }, [invoiceRows, appliedFilters, deletingInvoiceIds]);


const totalPages = Math.max(1, Math.ceil(filteredInvoices.length / ITEMS_PER_PAGE));
const safeCurrentPage = Math.min(currentPage, totalPages);
const startIndex = (safeCurrentPage - 1) * ITEMS_PER_PAGE;
const endIndex = startIndex + ITEMS_PER_PAGE;
const currentPageInvoices = filteredInvoices.slice(startIndex, endIndex);

useEffect(() => {
  if (currentPage !== safeCurrentPage) setCurrentPage(safeCurrentPage);
}, [currentPage, safeCurrentPage]);

const visibleInvoiceKeys = useMemo(
  () => currentPageInvoices.map((invoice) => invoice.key),
  [currentPageInvoices]
);

  useEffect(() => {
    if (filteredInvoices.length === 0) {
      setSelectAll(false);
      setSelectedInvoices([]);
      return;
    }

    const visibleKeys = new Set(filteredInvoices.map((inv) => inv.key));
    setSelectedInvoices((prev) => prev.filter((key) => visibleKeys.has(key)));
  }, [filteredInvoices]);

  const totalAmount = filteredInvoices.reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0);
  const pendingAmount = filteredInvoices
    .filter((inv) => inv.status === "Issued")
    .reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0);

  const selectedCount = selectedInvoices.length;
  const canEdit = selectedCount === 1;

  const companyDisplayName =
    currentCompany?.companyName ||
    currentCompany?.name ||
    currentCompany?.company ||
    "MILIK Property Management";

  const applySearch = () => {
    setAppliedFilters({ ...draftFilters });
    setSelectedInvoices([]);
    setSelectAll(false);
    setCurrentPage(1);
  };

  const resetFilters = () => {
    setDraftFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    setSelectedInvoices([]);
    setSelectAll(false);
    setCurrentPage(1);
  };

  const toggleSelectAll = () => {
    if (selectAll) {
      setSelectedInvoices((prev) => prev.filter((id) => !visibleInvoiceKeys.includes(id)));
      setSelectAll(false);
      return;
    }

    setSelectedInvoices((prev) => Array.from(new Set([...prev, ...visibleInvoiceKeys])));
    setSelectAll(true);
  };

  const toggleRowSelection = (rowKey) => {
    setSelectedInvoices((prev) => {
      const hasRow = prev.includes(rowKey);
      if (hasRow) return prev.filter((id) => id !== rowKey);
      return [...prev, rowKey];
    });
  };

  useEffect(() => {
    if (currentPageInvoices.length === 0) {
      setSelectAll(false);
      return;
    }
    setSelectAll(visibleInvoiceKeys.every((key) => selectedInvoices.includes(key)));
  }, [selectedInvoices, currentPageInvoices, visibleInvoiceKeys]);

  const openHtmlDocument = (title, html) => {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const printWindow = window.open(url, "_blank", "width=1100,height=850");
    if (!printWindow) {
      toast.error("Please allow popups to view or print invoices");
      window.URL.revokeObjectURL(url);
      return null;
    }

    setTimeout(() => window.URL.revokeObjectURL(url), 15000);

    try {
      printWindow.document.title = title;
    } catch (error) {
      // ignore
    }

    return printWindow;
  };

  const buildInvoiceHtml = (invoice) => {
    const amount = Number(invoice?.amount || 0).toLocaleString();
    const createdLabel = invoice?.createdAt
      ? new Date(invoice.createdAt).toLocaleString("en-GB")
      : invoice?.createdDate || "-";

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(invoice?.id || "Invoice")}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #111827; }
    .header { border-bottom: 2px solid #0B3B2E; padding-bottom: 12px; margin-bottom: 18px; display:flex; align-items:center; justify-content:space-between; gap:16px; }
    .brand-wrap { display:flex; align-items:center; gap:10px; }
    .logo { width:40px; height:40px; border-radius:8px; background:#0B3B2E; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:16px; }
    .brand { font-size: 20px; font-weight: 800; color: #0B3B2E; }
    .company { color:#111827; font-size:13px; font-weight:700; }
    .subtitle { color: #4b5563; font-size: 12px; text-align:right; }
    .grid { display: grid; grid-template-columns: 180px 1fr; gap: 8px 12px; font-size: 13px; }
    .label { color: #6b7280; font-weight: 600; }
    .value { color: #111827; font-weight: 700; }
    .amount { margin-top: 18px; font-size: 22px; font-weight: 800; color: #0B3B2E; }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand-wrap">
      <div class="logo">M</div>
      <div>
        <div class="brand">MILIK Rental Invoice</div>
        <div class="company">${escapeHtml(companyDisplayName)}</div>
      </div>
    </div>
    <div class="subtitle">Generated on ${escapeHtml(new Date().toLocaleString())}</div>
  </div>
  <div class="grid">
    <div class="label">Invoice #</div><div class="value">${escapeHtml(invoice?.id)}</div>
    <div class="label">Tenant</div><div class="value">${escapeHtml(invoice?.tenantName)}</div>
    <div class="label">Property</div><div class="value">${escapeHtml(invoice?.propertyName)}</div>
    <div class="label">Unit</div><div class="value">${escapeHtml(invoice?.unitName)}</div>
    <div class="label">Period</div><div class="value">${escapeHtml(invoice?.period)}</div>
    <div class="label">Status</div><div class="value">${escapeHtml(invoice?.status)}</div>
    <div class="label">Created</div><div class="value">${escapeHtml(createdLabel)}</div>
  </div>
  <div class="amount">Amount Due: KES ${amount}</div>
</body>
</html>`;
  };

  const buildInvoiceListHtml = (rows) => {
    const total = rows.reduce((sum, inv) => sum + (Number(inv?.amount) || 0), 0);
    const tableRows = rows
      .map(
        (inv) => `<tr>
  <td>${escapeHtml(inv.id)}</td>
  <td>${escapeHtml(inv.tenantName)}</td>
  <td>${escapeHtml(inv.propertyName)}</td>
  <td>${escapeHtml(inv.unitName)}</td>
  <td>${escapeHtml(inv.period)}</td>
  <td style="text-align:right;">KES ${Number(inv.amount || 0).toLocaleString()}</td>
  <td>${escapeHtml(inv.status)}</td>
  <td>${escapeHtml(inv.createdDate || "-")}</td>
</tr>`
      )
      .join("\n");

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>MILIK Rental Invoices List</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; color: #111827; }
    .header { display:flex; align-items:center; justify-content:space-between; gap:20px; border-bottom:3px solid #0B3B2E; padding-bottom:14px; margin-bottom:14px; }
    .brand-wrap { display:flex; align-items:center; gap:14px; }
    .logo { width:74px; height:74px; border-radius:16px; background:#0B3B2E; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:30px; border:1px solid #cbd5e1; }
    h1 { margin: 0; color: #0B3B2E; font-size: 22px; }
    .company { margin-top:4px; color:#111827; font-size:13px; font-weight:700; }
    .meta { margin: 0; color: #4b5563; font-size: 12px; text-align:right; line-height:1.5; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid #d1d5db; padding: 6px 8px; }
    th { background: #0B3B2E; color: white; text-align: left; }
    tfoot td { font-weight: 700; background: #f3f4f6; }
    @media print { body { margin: 10mm; } }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand-wrap">
      <div class="logo">M</div>
      <div>
        <h1>MILIK Rental Invoices List</h1>
        <div class="company">${escapeHtml(companyDisplayName)}</div>
      </div>
    </div>
    <div class="meta">Generated: ${escapeHtml(new Date().toLocaleString())}<br/>Count: ${rows.length}<br/>Total: KES ${total.toLocaleString()}</div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Invoice #</th>
        <th>Tenant</th>
        <th>Property</th>
        <th>Unit</th>
        <th>Period</th>
        <th style="text-align:right;">Amount</th>
        <th>Status</th>
        <th>Created</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="5" style="font-weight:800;">Total</td>
        <td style="text-align:right; font-weight:800;">KES ${total.toLocaleString()}</td>
        <td colspan="2"></td>
      </tr>
    </tfoot>
  </table>
</body>
</html>`;
  };

  const handleViewInvoice = (invoice) => {
    if (!invoice) return;

    setJournalContext({
      transactionNumber: invoice.id,
      date: invoice.createdDate || "-",
      tenant: invoice.tenantName,
      property: invoice.propertyName,
      unit: invoice.unitName,
      cashbook: "Tenant Receivables Control",
    });

    setJournalLines(buildJournalEntriesForInvoice(invoice));
    setJournalDrawerOpen(true);
  };

  const handlePrintInvoice = (invoice) => {
    if (!invoice) return;
    const printWindow = openHtmlDocument(`Invoice ${invoice.id}`, buildInvoiceHtml(invoice));
    if (!printWindow) return;

    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 500);
  };

  const handleDownloadInvoice = (invoice) => {
    if (!invoice) return;
    const html = buildInvoiceHtml(invoice);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${invoice.id || "invoice"}_${(invoice.period || "period").replace(/\s+/g, "_")}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    toast.success(`Downloaded ${invoice.id}`);
  };

  const handlePrintList = () => {
    if (filteredInvoices.length === 0) {
      toast.warn("No invoices to print");
      return;
    }

    const printWindow = openHtmlDocument(
      "MILIK Rental Invoices List",
      buildInvoiceListHtml(filteredInvoices)
    );
    if (!printWindow) return;

    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 500);
  };

  const findRevenueAccountId = (type) => {
    const typeLower = String(type || "rent").toLowerCase();

    const exactCode =
      typeLower === "utility"
        ? invoiceRevenueAccounts.find((acc) => String(acc?.code || "") === "4102")
        : invoiceRevenueAccounts.find((acc) => String(acc?.code || "") === "4100");

    if (exactCode?._id) return exactCode._id;

    const byName =
      typeLower === "utility"
        ? invoiceRevenueAccounts.find((acc) =>
            String(acc?.name || "").toLowerCase().includes("utility")
          )
        : invoiceRevenueAccounts.find((acc) =>
            String(acc?.name || "").toLowerCase().includes("rent")
          );

    return byName?._id || null;
  };
  const buildInvoicePayloadForTenant = ({
    targetTenant,
    amount,
    paymentType,
  categoryOverride = null,
    month,
    year,
    description,
    metadata,
  taxSelection = null,
  }) => {
  const numericAmount = Number(amount || 0);

  if (!targetTenant?._id || !targetTenant?.unit || numericAmount <= 0) {
    throw new Error("Invalid invoice payload");
  }

  const revenueAccountId = findRevenueAccountId(paymentType);
  if (!revenueAccountId) {
    throw new Error(
      `No income Chart of Account found for ${paymentType}. Ensure account 4100 / 4102 exists.`
    );
  }

  const businessId =
    targetTenant?.business?._id ||
    targetTenant?.business ||
    currentCompany?._id ||
    currentUser?.company?._id ||
    currentUser?.company ||
    null;

  const unitId = targetTenant?.unit?._id || targetTenant?.unit || null;

  const matchedUnit = unitsFromStore.find(
    (unit) => String(unit?._id || "") === String(unitId || "")
  );

  const propertyId =
    targetTenant?.property?._id ||
    targetTenant?.property ||
    matchedUnit?.property?._id ||
    matchedUnit?.property ||
    targetTenant?.unit?.property?._id ||
    targetTenant?.unit?.property ||
    null;

  const matchedProperty = propertiesFromStore.find(
    (property) => String(property?._id || "") === String(propertyId || "")
  );

  const landlordId =
    matchedProperty?.landlords?.[0]?.landlordId?._id ||
    matchedProperty?.landlords?.[0]?.landlordId ||
    matchedProperty?.landlords?.[0]?._id ||
    matchedProperty?.landlords?.[0] ||
    targetTenant?.landlord?._id ||
    targetTenant?.landlord ||
    null;

  const createdBy =
    currentUser?._id ||
    targetTenant?.createdBy?._id ||
    targetTenant?.createdBy ||
    null;

  if (!businessId) {
    throw new Error("Missing business context for invoice creation.");
  }

  if (!propertyId) {
    throw new Error("Missing property on selected tenant/unit.");
  }

  if (!landlordId) {
    throw new Error("Missing landlord on selected property's record.");
  }

  if (!unitId) {
    throw new Error("Missing unit on selected tenant.");
  }

  if (!createdBy) {
    throw new Error("Missing createdBy user context.");
  }

  const invoicePayload = {
    business: businessId,
    property: propertyId,
    landlord: landlordId,
    tenant: targetTenant._id,
    unit: unitId,
    category: categoryOverride || (paymentType === "utility" ? "UTILITY_CHARGE" : "RENT_CHARGE"),
    amount: numericAmount,
    description,
    invoiceDate: getStartOfPeriod(month, year),
    dueDate: getEndOfPeriod(month, year),
    createdBy,
    chartAccountId: revenueAccountId,
    metadata: metadata && typeof metadata === "object" ? metadata : undefined,
    ...resolveTaxSelectionPayload(taxSelection, normalizedTaxConfig),
  };

  return invoicePayload;
};

  const createBackendInvoiceEntry = async ({
    targetTenant,
    amount,
    paymentType,
    categoryOverride,
    month,
    year,
    description,
    metadata,
    taxSelection,
  }) => {
  const invoicePayload = buildInvoicePayloadForTenant({
    targetTenant,
    amount,
    paymentType,
    categoryOverride,
    month,
    year,
    description,
    metadata,
    taxSelection,
  });

  console.log("Creating invoice with payload:", invoicePayload);

  return await createTenantInvoice(invoicePayload);
};

  
  const createInvoiceForTenant = async (
    targetTenant,
    month,
    year,
    billingMode = "combined",
    taxSelection = null
  ) => {
    if (!targetTenant?._id) {
      return { created: false, reason: "Invalid tenant" };
    }

    const periodLabel = formatPeriodLabel(month, year);
    const { rentAmount, utilityAmount, utilityLabel } = getTenantPricing(targetTenant);
    const createdInvoiceIds = [];
    const utilityMetadata = buildUtilityInvoiceMetadata(utilityLabel);

    if (billingMode === "separate") {
      const shouldCreateRent =
        rentAmount > 0 &&
        !hasBlockingInvoiceForRequest({
          invoices: tenantInvoicesFromApi,
          tenantId: targetTenant._id,
          month,
          year,
          category: "RENT_CHARGE",
        });

      const shouldCreateUtility =
        utilityAmount > 0 &&
        !hasBlockingInvoiceForRequest({
          invoices: tenantInvoicesFromApi,
          tenantId: targetTenant._id,
          month,
          year,
          category: "UTILITY_CHARGE",
          metadata: utilityMetadata,
        });

      if (!shouldCreateRent && !shouldCreateUtility) {
        return { created: false, reason: "already_exists", periodLabel };
      }

      if (shouldCreateRent) {
        const createdInvoice = await createBackendInvoiceEntry({
          targetTenant,
          amount: rentAmount,
          paymentType: "rent",
          month,
          year,
          description: `Rent charge (${periodLabel})`,
          taxSelection,
        });

        createdInvoiceIds.push(createdInvoice?.invoiceNumber || "AUTO");
      }

      if (shouldCreateUtility) {
        const createdInvoice = await createBackendInvoiceEntry({
          targetTenant,
          amount: utilityAmount,
          paymentType: "utility",
          month,
          year,
          description: utilityLabel
            ? `${utilityLabel} charge (${periodLabel})`
            : `Utility charge (${periodLabel})`,
          metadata: utilityMetadata,
          taxSelection,
        });

        createdInvoiceIds.push(createdInvoice?.invoiceNumber || "AUTO");
      }
    } else {
      const combinedAmount = Number(rentAmount || 0) + Number(utilityAmount || 0);
      const hasCombinedBlocker = hasBlockingInvoiceForRequest({
        invoices: tenantInvoicesFromApi,
        tenantId: targetTenant._id,
        month,
        year,
        category: "RENT_CHARGE",
        metadata: buildCombinedInvoiceMetadata({
          utilityAmount,
          utilityLabel,
          periodLabel,
        }),
      });

      if (combinedAmount <= 0) {
        return { created: false, reason: "No billable rent or utility entries found" };
      }

      if (hasCombinedBlocker) {
        return { created: false, reason: "already_exists", periodLabel };
      }

      const createdInvoice = await createBackendInvoiceEntry({
        targetTenant,
        amount: combinedAmount,
        paymentType: "rent",
        categoryOverride: "RENT_CHARGE",
        month,
        year,
        description:
          utilityAmount > 0
            ? `Combined rent + utility charge (${periodLabel})`
            : `Rent charge (${periodLabel})`,
        metadata: buildCombinedInvoiceMetadata({
          utilityAmount,
          utilityLabel,
          periodLabel,
        }),
        taxSelection,
      });

      createdInvoiceIds.push(createdInvoice?.invoiceNumber || "AUTO");
    }

    return { created: createdInvoiceIds.length > 0, invoiceIds: createdInvoiceIds, periodLabel, ledgerSynced: true };
  };

  const handleBookingActionChange = (value) => {
    setBookingAction(value);

    if (value === "single") {
      setShowSingleBooking(true);
      if (tenantId) {
        setSingleBookingForm((prev) => ({ ...prev, tenantId }));
      }
    }

    if (value === "batch") {
      setShowBatchBooking(true);
    }
  };
  const handleSingleBooking = async () => {
    if (submittingSingleBooking) return;

    const selectedTenant = tenantLookup[singleBookingForm.tenantId];

    if (!selectedTenant) {
      toast.error("Please select a tenant");
      return;
    }

    if (isFutureBillingPeriod(singleBookingForm.month, singleBookingForm.year)) {
      toast.error("Future invoicing is disabled. Select the current month or an earlier clean period.");
      return;
    }

    const pricing = getTenantPricing(selectedTenant);
    if (pricing.total <= 0) {
      toast.error("Selected tenant has no billable rent/utility amount");
      return;
    }

    setSubmittingSingleBooking(true);
    try {
      const result = await createInvoiceForTenant(
        selectedTenant,
        Number(singleBookingForm.month),
        Number(singleBookingForm.year),
        singleBookingForm.billingMode,
        getBookingTaxSelection(singleBookingForm)
      );

      if (!result.created && result.reason === "already_exists") {
        toast.info(`Invoice for ${result.periodLabel} already exists for this tenant`);
        return;
      }

      if (!result.created) {
        toast.error(result.reason || "Failed to create booking");
        return;
      }

      toast.success(
        `Booked ${result.invoiceIds.join(", ")} for ${getTenantDisplayName(selectedTenant)}`
      );

      setShowSingleBooking(false);
      setBookingAction("");
      window.dispatchEvent(new Event("invoicesUpdated"));
      setRefreshTick((prev) => prev + 1);
    } catch (error) {
      console.error("Single booking failed:", error);
      toast.error(
        error?.response?.data?.error ||
        error?.response?.data?.message ||
        error?.message ||
        "Failed to create invoice"
      );
    } finally {
      setSubmittingSingleBooking(false);
    }
  };

  const handleBatchBooking = async () => {
    if (submittingBatchBooking) return;

    const selectedPropertyId = batchBookingForm.propertyId;
    const month = Number(batchBookingForm.month);
    const year = Number(batchBookingForm.year);

    if (isFutureBillingPeriod(month, year)) {
      toast.error("Future invoicing is disabled. Select the current month or an earlier clean period.");
      return;
    }

    const eligibleTenants = tenantsFromStore.filter((tenant) => {
      const tenantStatus = String(tenant?.status || "active").toLowerCase();
      if (tenantStatus !== "active") return false;

      const tenantPropertyId = getTenantPropertyId(tenant);
      if (!tenantPropertyId) return false;

      if (selectedPropertyId === "all") {
        return activeProperties.some(
          (property) => String(property?._id) === String(tenantPropertyId)
        );
      }

      return String(tenantPropertyId) === String(selectedPropertyId);
    });

    if (eligibleTenants.length === 0) {
      toast.warn("No active tenants found for the selected scope");
      return;
    }

    let createdCount = 0;
    let skippedCount = 0;
    const batchItems = [];
    const tenantsToProcess = [];

    const finalizeBatchRefresh = () => {
      setShowBatchBooking(false);
      setBookingAction("");
      window.dispatchEvent(new Event("invoicesUpdated"));
      setRefreshTick((prev) => prev + 1);
    };

    const runLegacySequentialBatch = async (initialErrorMessage = "") => {
      let fallbackCreatedCount = 0;
      let fallbackSkippedCount = skippedCount;
      let fallbackErrorMessage = initialErrorMessage;

      for (const tenant of tenantsToProcess) {
        try {
          const result = await createInvoiceForTenant(
            tenant,
            month,
            year,
            batchBookingForm.billingMode,
            getBookingTaxSelection(batchBookingForm)
          );

          if (result?.created) {
            fallbackCreatedCount += 1;
          } else if (result?.reason === "already_exists") {
            fallbackSkippedCount += 1;
          } else if (!fallbackErrorMessage && result?.reason) {
            fallbackErrorMessage = result.reason;
          }
        } catch (fallbackError) {
          if (!fallbackErrorMessage) {
            fallbackErrorMessage =
              fallbackError?.response?.data?.error ||
              fallbackError?.response?.data?.message ||
              fallbackError?.message ||
              "Batch booking failed";
          }
        }
      }

      if (fallbackCreatedCount > 0) {
        toast.success(
          `Batch booking complete: ${fallbackCreatedCount} created${
            fallbackSkippedCount > 0 ? `, ${fallbackSkippedCount} skipped` : ""
          }`
        );
        finalizeBatchRefresh();
        return true;
      }

      if (fallbackSkippedCount > 0 && !fallbackErrorMessage) {
        toast.info(`No new invoices created. ${fallbackSkippedCount} already existed.`);
        return true;
      }

      return fallbackErrorMessage || "Batch booking failed";
    };

    setSubmittingBatchBooking(true);

    try {
      for (const tenant of eligibleTenants) {
        const periodLabel = formatPeriodLabel(month, year);
        const { rentAmount, utilityAmount, utilityLabel } = getTenantPricing(tenant);
        const utilityMetadata = buildUtilityInvoiceMetadata(utilityLabel);

        if (rentAmount <= 0 && utilityAmount <= 0) {
          continue;
        }

        let tenantHasBatchItems = false;

        if (batchBookingForm.billingMode === "combined") {
          const combinedAmount = Number(rentAmount || 0) + Number(utilityAmount || 0);
          const combinedMetadata = buildCombinedInvoiceMetadata({
            utilityAmount,
            utilityLabel,
            periodLabel,
          });
          const hasCombinedBlocker = hasBlockingInvoiceForRequest({
            invoices: tenantInvoicesFromApi,
            tenantId: tenant._id,
            month,
            year,
            category: "RENT_CHARGE",
            metadata: combinedMetadata,
          });

          if (combinedAmount > 0 && !hasCombinedBlocker) {
            batchItems.push(
              buildInvoicePayloadForTenant({
                targetTenant: tenant,
                amount: combinedAmount,
                paymentType: "rent",
                categoryOverride: "RENT_CHARGE",
                month,
                year,
                description:
                  utilityAmount > 0
                    ? `Combined rent + utility charge (${periodLabel})`
                    : `Rent charge (${periodLabel})`,
                metadata: combinedMetadata,
                taxSelection: getBookingTaxSelection(batchBookingForm),
              })
            );
            tenantHasBatchItems = true;
          }
        } else {
          const shouldCreateRent =
            rentAmount > 0 &&
            !hasBlockingInvoiceForRequest({
              invoices: tenantInvoicesFromApi,
              tenantId: tenant._id,
              month,
              year,
              category: "RENT_CHARGE",
            });

          const shouldCreateUtility =
            utilityAmount > 0 &&
            !hasBlockingInvoiceForRequest({
              invoices: tenantInvoicesFromApi,
              tenantId: tenant._id,
              month,
              year,
              category: "UTILITY_CHARGE",
              metadata: utilityMetadata,
            });

          if (shouldCreateRent) {
            batchItems.push(
              buildInvoicePayloadForTenant({
                targetTenant: tenant,
                amount: rentAmount,
                paymentType: "rent",
                month,
                year,
                description: `Rent charge (${periodLabel})`,
                taxSelection: getBookingTaxSelection(batchBookingForm),
              })
            );
            tenantHasBatchItems = true;
          }

          if (shouldCreateUtility) {
            batchItems.push(
              buildInvoicePayloadForTenant({
                targetTenant: tenant,
                amount: utilityAmount,
                paymentType: "utility",
                month,
                year,
                description: utilityLabel
                  ? `${utilityLabel} charge (${periodLabel})`
                  : `Utility charge (${periodLabel})`,
                metadata: utilityMetadata,
                taxSelection: getBookingTaxSelection(batchBookingForm),
              })
            );
            tenantHasBatchItems = true;
          }
        }

        if (!tenantHasBatchItems) {
          skippedCount += 1;
          continue;
        }

        tenantsToProcess.push(tenant);
      }

      if (batchItems.length === 0 && skippedCount > 0) {
        toast.info(`No new invoices created. ${skippedCount} already existed.`);
        return;
      }

      if (batchItems.length === 0) {
        toast.warn("No billable rent or utility entries found for the selected tenants.");
        return;
      }

      const batchResponse = await createTenantInvoicesBatch({
        business:
          batchItems[0]?.business ||
          currentCompany?._id ||
          currentUser?.company?._id ||
          currentUser?.company,
        items: batchItems,
      });

      const successfulRows = Array.isArray(batchResponse?.results)
        ? batchResponse.results.filter((row) => row?.success)
        : [];
      const failedRows = Array.isArray(batchResponse?.results)
        ? batchResponse.results.filter((row) => !row?.success)
        : [];

      createdCount = new Set(successfulRows.map((row) => String(row?.tenant || "")).filter(Boolean)).size;
      const failedCount = new Set(failedRows.map((row) => String(row?.tenant || "")).filter(Boolean)).size;

      if (createdCount === 0 && failedRows.length > 0) {
        const primaryError =
          failedRows.find((row) => String(row?.error || "").trim())?.error ||
          batchResponse?.message ||
          "Batch booking failed";

        console.warn("Batch booking returned zero created rows. Falling back to legacy booking.", {
          summary: batchResponse?.summary,
          firstErrors: failedRows.slice(0, 5),
        });

        const fallbackOutcome = await runLegacySequentialBatch(primaryError);
        if (fallbackOutcome === true) {
          return;
        }

        const previewErrors = failedRows
          .slice(0, 3)
          .map((row) => row?.error)
          .filter(Boolean)
          .join(" | ");

        toast.error(previewErrors || fallbackOutcome || primaryError);
        return;
      }

      if (createdCount === 0 && skippedCount > 0) {
        toast.info(`No new invoices created. ${skippedCount} already existed.`);
        return;
      }

      toast.success(
        `Batch booking complete: ${createdCount} created${
          skippedCount > 0 ? `, ${skippedCount} skipped` : ""
        }${failedCount > 0 ? `, ${failedCount} with errors` : ""}`
      );

      if (failedRows.length > 0) {
        const previewErrors = failedRows
          .slice(0, 2)
          .map((row) => row?.error)
          .filter(Boolean)
          .join(" | ");

        if (previewErrors) {
          toast.warn(previewErrors);
        }
      }

      finalizeBatchRefresh();
    } catch (error) {
      const batchData = error?.response?.data;

      if (Array.isArray(batchData?.results) && batchData.results.length > 0) {
        const failedRows = batchData.results.filter((row) => !row?.success);
        const primaryError =
          failedRows.find((row) => String(row?.error || "").trim())?.error ||
          batchData?.message ||
          batchData?.error ||
          "Batch booking failed";

        console.warn("Batch booking request failed with structured response. Falling back to legacy booking.", {
          summary: batchData?.summary,
          firstErrors: failedRows.slice(0, 5),
        });

        const fallbackOutcome = await runLegacySequentialBatch(primaryError);
        if (fallbackOutcome === true) {
          return;
        }

        const previewErrors = failedRows
          .slice(0, 3)
          .map((row) => row?.error)
          .filter(Boolean)
          .join(" | ");

        toast.error(previewErrors || fallbackOutcome || primaryError);
        return;
      }

      toast.error(
        error?.response?.data?.error ||
          error?.response?.data?.message ||
          error?.message ||
          "Batch booking failed"
      );
    } finally {
      setSubmittingBatchBooking(false);
    }
  };

  const handleEditSelected = () => {
    if (!canEdit) {
      toast.warn("Select exactly one invoice to edit");
      return;
    }

    const selectedInvoice = filteredInvoices.find((inv) => inv.key === selectedInvoices[0]);
    if (!selectedInvoice) return;

    navigate(`/tenant/${selectedInvoice.tenantId}/statement`);
    toast.info(`Open tenant statement to review ${selectedInvoice.id}`);
  };

  const handleDeleteSelected = async () => {
    if (selectedInvoices.length === 0) {
      toast.warn("Select at least one invoice to delete");
      return;
    }

    const selectedRows = filteredInvoices.filter((inv) => selectedInvoices.includes(inv.key));
    const undeletable = selectedRows.filter((invoice) =>
      ["paid", "partially_paid"].includes(String(invoice.status || "").toLowerCase())
    );

    if (undeletable.length > 0) {
      toast.warn("Paid invoices cannot be deleted from this screen.");
      return;
    }

    try {
      for (const invoice of selectedRows) {
        if (!invoice?._id) continue;
        await deleteTenantInvoice(invoice._id);
      }

      toast.success(`${selectedRows.length} invoice(s) deleted successfully`);
      window.dispatchEvent(new Event("invoicesUpdated"));
      setRefreshTick((prev) => prev + 1);
      setSelectedInvoices([]);
      setSelectAll(false);
      setDeletingInvoiceIds([]);
    } catch (error) {
      toast.error(
        error?.response?.data?.error ||
          error?.response?.data?.message ||
          error.message ||
          "Failed to delete selected invoices"
      );
    }
  };

  const handleDeleteSingle = async (invoice) => {
    if (["paid", "partially_paid"].includes(String(invoice?.status || "").toLowerCase())) {
      toast.warn("Paid invoices cannot be deleted from this screen.");
      return;
    }

    if (!invoice?._id) {
      toast.error("Invoice id is missing.");
      return;
    }

    try {
      await deleteTenantInvoice(invoice._id);
      window.dispatchEvent(new Event("invoicesUpdated"));
      setRefreshTick((prev) => prev + 1);
      toast.success(`Invoice ${invoice.id} deleted successfully`);
    } catch (error) {
      toast.error(
        error?.response?.data?.error ||
          error?.response?.data?.message ||
          error.message ||
          `Failed to delete invoice ${invoice.id}`
      );
    }
  };

  const handleViewTenantStatement = (targetTenantId) => {
    navigate(`/tenant/${targetTenantId}/statement`);
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 p-3">
        <div className="mx-auto flex w-full max-w-[96%] min-h-0 flex-1 flex-col gap-3">
          <div className="flex-shrink-0 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
            <div className="mb-2 flex items-center justify-between">
              {tenantId ? (
                <button
                  onClick={() => navigate("/tenants")}
                  className="flex items-center gap-2 text-xs font-semibold text-gray-600 hover:text-gray-900"
                  title="Back to Tenants"
                >
                  <FaArrowLeft size={12} />
                  Back to tenant list
                </button>
              ) : (
                <div />
              )}
            </div>

            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
              <div className="rounded border border-blue-200 bg-blue-50 p-2.5">
                <p className="text-[11px] font-semibold text-blue-600">Total Invoices</p>
                <p className="text-xl font-bold leading-tight text-blue-900">{filteredInvoices.length}</p>
              </div>
              <div className="rounded border border-green-200 bg-green-50 p-2.5">
                <p className="text-[11px] font-semibold text-green-600">Total Amount</p>
                <p className="text-xl font-bold leading-tight text-green-900">
                  KES {totalAmount.toLocaleString()}
                </p>
              </div>
              <div className="rounded border border-orange-200 bg-orange-50 p-2.5">
                <p className="text-[11px] font-semibold text-orange-600">Pending Amount</p>
                <p className="text-xl font-bold leading-tight text-orange-900">
                  KES {pendingAmount.toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
            <div className="sticky top-0 z-20 flex-shrink-0 border-b border-gray-200 bg-gray-50 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setDraftFilters((prev) => ({ ...prev, status: "ACTIVE" }))}
                  className={`px-3 py-1 text-xs rounded font-semibold transition-colors ${
                    draftFilters.status === "ACTIVE"
                      ? `${MILIK_GREEN} text-white`
                      : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-100"
                  }`}
                >
                  Issued + Paid
                </button>
                <button
                  onClick={() => setDraftFilters((prev) => ({ ...prev, status: "Issued" }))}
                  className={`px-3 py-1 text-xs rounded font-semibold transition-colors ${
                    draftFilters.status === "Issued"
                      ? `${MILIK_GREEN} text-white`
                      : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-100"
                  }`}
                >
                  Issued
                </button>
                <button
                  onClick={() => setDraftFilters((prev) => ({ ...prev, status: "Paid" }))}
                  className={`px-3 py-1 text-xs rounded font-semibold transition-colors ${
                    draftFilters.status === "Paid"
                      ? `${MILIK_GREEN} text-white`
                      : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-100"
                  }`}
                >
                  Paid
                </button>
                <button
                  onClick={() => setDraftFilters((prev) => ({ ...prev, status: "Reversed" }))}
                  className={`px-3 py-1 text-xs rounded font-semibold transition-colors ${
                    draftFilters.status === "Reversed"
                      ? `${MILIK_GREEN} text-white`
                      : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-100"
                  }`}
                >
                  Reversed
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={draftFilters.invoiceNo}
                  onChange={(e) => setDraftFilters((prev) => ({ ...prev, invoiceNo: e.target.value }))}
                  placeholder="Invoice #"
                  className="rounded border border-gray-300 px-3 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                />

                {!tenantId && (
                  <input
                    type="text"
                    value={draftFilters.tenantName}
                    onChange={(e) => setDraftFilters((prev) => ({ ...prev, tenantName: e.target.value }))}
                    placeholder="Tenant name"
                    className="rounded border border-gray-300 px-3 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                  />
                )}

                <select
                  value={draftFilters.property}
                  onChange={(e) =>
                    setDraftFilters((prev) => ({
                      ...prev,
                      property: e.target.value,
                      unit: "any",
                    }))
                  }
                  className="rounded border border-gray-300 bg-[#DDEFE1] px-3 py-1 text-xs text-gray-800 shadow-sm"
                >
                  {uniqueProperties.map((property) => (
                    <option key={property} value={property}>
                      {property === "any" ? "Property" : property}
                    </option>
                  ))}
                </select>

                <select
                  value={draftFilters.unit}
                  onChange={(e) => setDraftFilters((prev) => ({ ...prev, unit: e.target.value }))}
                  className="rounded border border-gray-300 bg-[#DDEFE1] px-3 py-1 text-xs text-gray-800 shadow-sm"
                >
                  {unitsForSelectedProperty.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit === "any" ? "Unit" : unit}
                    </option>
                  ))}
                </select>

                <input
                  type="date"
                  value={draftFilters.fromDate}
                  onChange={(e) => setDraftFilters((prev) => ({ ...prev, fromDate: e.target.value }))}
                  className="rounded border border-gray-300 px-3 py-1 text-xs shadow-sm"
                  title="From date"
                />

                <input
                  type="date"
                  value={draftFilters.toDate}
                  onChange={(e) => setDraftFilters((prev) => ({ ...prev, toDate: e.target.value }))}
                  className="rounded border border-gray-300 px-3 py-1 text-xs shadow-sm"
                  title="To date"
                />

                <button
                  onClick={applySearch}
                  className={`flex items-center gap-2 rounded-lg px-4 py-1 text-xs text-white shadow-sm ${MILIK_ORANGE} ${MILIK_ORANGE_HOVER}`}
                >
                  <FaSearch className="text-xs" />
                  Search
                </button>

                <button
                  onClick={resetFilters}
                  className={`flex items-center gap-2 rounded-lg px-4 py-1 text-xs text-white shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
                >
                  <FaRedoAlt className="text-xs" />
                  Reset
                </button>

                <button
                  onClick={handleEditSelected}
                  disabled={!canEdit}
                  className={`flex items-center gap-2 rounded-lg px-4 py-1 text-xs text-white shadow-sm ${
                    canEdit ? `${MILIK_GREEN} ${MILIK_GREEN_HOVER}` : "bg-gray-400 cursor-not-allowed"
                  }`}
                >
                  <FaEdit className="text-xs" />
                  Edit
                </button>

                <button
                  onClick={handleDeleteSelected}
                  disabled={selectedCount === 0}
                  className={`flex items-center gap-2 rounded-lg px-4 py-1 text-xs text-white shadow-sm ${
                    selectedCount > 0 ? "bg-red-600 hover:bg-red-700" : "bg-gray-400 cursor-not-allowed"
                  }`}
                >
                  <FaTrash className="text-xs" />
                  Delete
                </button>

                <button
                  onClick={handlePrintList}
                  disabled={filteredInvoices.length === 0}
                  className={`flex items-center gap-2 rounded-lg px-4 py-1 text-xs text-white shadow-sm ${
                    filteredInvoices.length > 0
                      ? `${MILIK_GREEN} ${MILIK_GREEN_HOVER}`
                      : "bg-gray-400 cursor-not-allowed"
                  }`}
                >
                  <FaPrint className="text-xs" />
                  Print List
                </button>

                <div className="flex items-center gap-1">
                  <FaPlus className="text-[10px] text-[#0B3B2E]" />
                  <select
                    value={bookingAction}
                    onChange={(e) => handleBookingActionChange(e.target.value)}
                    className="rounded-lg border border-[#0B3B2E] bg-[#E7F5EC] px-3 py-1 text-xs font-semibold text-[#0B3B2E] shadow-sm"
                  >
                    <option value="">Booking</option>
                    <option value="single">Create Single Booking</option>
                    <option value="batch">Create Batch Booking</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full min-w-[1180px] text-xs">
                <thead>
                  <tr className={`${MILIK_GREEN} sticky top-0 z-10 text-white`}>
                    <th className="px-3 py-2 text-left">
                      <input type="checkbox" checked={currentPageInvoices.length > 0 && selectAll} onChange={toggleSelectAll} />
                    </th>
                    <th className="px-3 py-2 text-left font-semibold">Invoice #</th>
                    {!tenantId && <th className="px-3 py-2 text-left font-semibold">Tenant</th>}
                    {!tenantId && <th className="px-3 py-2 text-left font-semibold">Property</th>}
                    <th className="px-3 py-2 text-left font-semibold">Unit</th>
                    <th className="px-3 py-2 text-left font-semibold">Period</th>
                    <th className="px-3 py-2 text-left font-semibold">Type</th>
                    <th className="px-3 py-2 text-right font-semibold">Amount</th>
                    <th className="px-3 py-2 text-center font-semibold">Status</th>
                    <th className="px-3 py-2 text-center font-semibold">Created</th>
                    <th className="px-3 py-2 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={tenantId ? "10" : "12"} className="px-4 py-8 text-center text-gray-500">
                        <FaFileInvoice className="mb-2 inline-block text-4xl text-gray-300" />
                        <p className="mt-1 text-sm font-semibold">No invoices found</p>
                        <p className="mt-1 text-xs text-gray-400">
                          {tenantId
                            ? "Create invoices from billing schedule"
                            : "Create invoices and apply filters to see results"}
                        </p>
                      </td>
                    </tr>
                  ) : (
                    currentPageInvoices.map((invoice, idx) => { const isSelected = selectedInvoices.includes(invoice.key); return (
                      <tr
                        key={invoice.key}
                        className={`border-b border-slate-200 transition-colors ${
                          isSelected
                            ? "bg-emerald-50/85 shadow-[inset_4px_0_0_0_#0B3B2E] hover:bg-emerald-50"
                            : idx % 2 === 0
                            ? "bg-white hover:bg-blue-50/40"
                            : "bg-slate-50 hover:bg-blue-50/40"
                        }`}
                        onClick={() => handleViewInvoice(invoice)}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRowSelection(invoice.key)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td className="px-3 py-2 font-bold text-blue-700">{invoice.id}</td>
                        {!tenantId && (
                          <td className="px-3 py-2 font-bold text-slate-900">{invoice.tenantName}</td>
                        )}
                        {!tenantId && (
                          <td className="px-3 py-2 font-semibold text-slate-900">{invoice.propertyName}</td>
                        )}
                        <td className="px-3 py-2 font-semibold text-slate-900">{invoice.unitName}</td>
                        <td className="px-3 py-2 font-semibold text-orange-700">{invoice.period}</td>
                        <td className="px-3 py-2">
                          <span className="inline-flex rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-700">
                            {invoice.chargeType || "combined"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-slate-900">
                          KES {Number(invoice.amount || 0).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span
                            className={`inline-flex rounded px-2 py-0.5 text-[10px] font-semibold ${
                              invoice.status === "Paid"
                                ? "bg-green-100 text-green-700"
                                : invoice.status === "Cancelled" || invoice.status === "Reversed"
                                ? "bg-slate-100 text-slate-700"
                                : "bg-orange-100 text-orange-700"
                            }`}
                          >
                            {invoice.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center text-gray-600">{invoice.createdDate}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => handleViewInvoice(invoice)}
                              className="rounded p-1 text-blue-600 hover:bg-blue-50 hover:text-blue-800"
                              title="View Invoice"
                            >
                              <FaEye size={12} />
                            </button>
                            <button
                              onClick={() => handlePrintInvoice(invoice)}
                              className="rounded p-1 text-purple-600 hover:bg-purple-50 hover:text-purple-800"
                              title="Print Invoice"
                            >
                              <FaPrint size={12} />
                            </button>
                            <button
                              onClick={() => handleDownloadInvoice(invoice)}
                              className="rounded p-1 text-green-600 hover:bg-green-50 hover:text-green-800"
                              title="Download Invoice"
                            >
                              <FaDownload size={12} />
                            </button>
                            <button
                              onClick={() => handleDeleteSingle(invoice)}
                              className="rounded p-1 text-red-600 hover:bg-red-50 hover:text-red-800"
                              title="Delete Invoice"
                            >
                              <FaTrash size={12} />
                            </button>
                            {!tenantId && (
                              <button
                                onClick={() => handleViewTenantStatement(invoice.tenantId)}
                                className="rounded p-1 text-indigo-600 hover:bg-indigo-50 hover:text-indigo-800"
                                title="View Tenant Statement"
                              >
                                <FaArrowRight size={12} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ); })
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-700">
              <p>
                <span className="font-semibold">Showing:</span> {filteredInvoices.length === 0 ? 0 : startIndex + 1}
                {" - "}
                {Math.min(endIndex, filteredInvoices.length)} of {filteredInvoices.length} invoice(s)
                {appliedFilters.status !== "ACTIVE" && ` · Status: ${appliedFilters.status}`}
              </p>
              <p>
                <span className="font-semibold">Selected:</span> {selectedCount}
                {filteredInvoices.length > 0 && (
                  <>
                    {" · "}
                    <span className="font-semibold">Total:</span> KES {totalAmount.toLocaleString()}
                  </>
                )}
              </p>
            </div>

<div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-3 text-xs text-slate-700">
  <p>
    <span className="font-semibold">Per page:</span> {ITEMS_PER_PAGE}
  </p>
  <div className="flex items-center gap-2">
    <button
      type="button"
      onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
      disabled={safeCurrentPage === 1}
      className="rounded-md border border-slate-300 px-3 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      Previous
    </button>
    <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1 font-semibold text-slate-700">
      Page {safeCurrentPage} of {totalPages}
    </span>
    <button
      type="button"
      onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
      disabled={safeCurrentPage === totalPages}
      className="rounded-md border border-slate-300 px-3 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      Next
    </button>
  </div>
</div>
          </div>
        </div>
      </div>

      {showSingleBooking && (
        <div className="fixed inset-0 bg-black/45 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden">
            <div className="px-5 py-3 bg-[#0B3B2E] text-white flex items-center justify-between">
              <h3 className="text-sm font-bold tracking-wide">Single Tenant Booking</h3>
              <button
                onClick={() => {
                  setShowSingleBooking(false);
                  setBookingAction("");
                }}
                className="text-xs font-semibold px-2 py-1 rounded bg-white/20 hover:bg-white/30"
              >
                Close
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-3">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Tenant</label>
                  <select
                    value={singleBookingForm.tenantId}
                    onChange={(e) =>
                      setSingleBookingForm((prev) => ({ ...prev, tenantId: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                  >
                    <option value="">Select tenant</option>
                    {singleBookingTenantOptions.map((tenantOption) => (
                      <option key={tenantOption.id} value={tenantOption.id}>
                        {tenantOption.name} - {tenantOption.propertyName} ({tenantOption.unitName})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Period</label>
                  <select
                    value={singleBookingForm.month}
                    onChange={(e) =>
                      setSingleBookingForm((prev) => {
                        const nextPeriod = clampBillingPeriod(Number(e.target.value), prev.year);
                        return { ...prev, month: nextPeriod.month, year: nextPeriod.year };
                      })
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  >
                    {MONTH_OPTIONS.map((monthOption) => (
                      <option
                        key={monthOption.value}
                        value={monthOption.value}
                        disabled={isFutureBillingPeriod(monthOption.value, Number(singleBookingForm.year))}
                      >
                        {monthOption.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Year</label>
                  <input
                    type="number"
                    min="2000"
                    max={currentBookingYear}
                    value={singleBookingForm.year}
                    onChange={(e) =>
                      setSingleBookingForm((prev) => {
                        const nextYear = Math.min(Number(e.target.value) || currentBookingYear, currentBookingYear);
                        const nextPeriod = clampBillingPeriod(prev.month, nextYear);
                        return { ...prev, month: nextPeriod.month, year: nextPeriod.year };
                      })
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Billing Mode</label>
                  <select
                    value={singleBookingForm.billingMode}
                    onChange={(e) =>
                      setSingleBookingForm((prev) => ({ ...prev, billingMode: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  >
                    <option value="combined">Combined (Rent + Utility)</option>
                    <option value="separate">Separate (Rent and Utility)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Tax Handling</label>
                  <select
                    value={singleBookingForm.taxHandling}
                    onChange={(e) =>
                      setSingleBookingForm((prev) => ({ ...prev, taxHandling: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  >
                    <option value="company_default">Use company default</option>
                    <option value="taxable" disabled={!companyTaxEnabled}>Force taxable</option>
                    <option value="non_taxable">Force non-taxable</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Tax Code</label>
                  <select
                    value={singleBookingForm.taxCodeKey}
                    onChange={(e) =>
                      setSingleBookingForm((prev) => ({ ...prev, taxCodeKey: e.target.value }))
                    }
                    disabled={singleBookingForm.taxHandling === "non_taxable"}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg disabled:bg-slate-100"
                  >
                    {activeTaxCodes.map((code) => (
                      <option key={code.key} value={code.key}>
                        {code.name} ({Number(code.rate || 0)}%)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Tax Mode</label>
                  <select
                    value={singleBookingForm.taxMode}
                    onChange={(e) =>
                      setSingleBookingForm((prev) => ({ ...prev, taxMode: e.target.value }))
                    }
                    disabled={singleBookingForm.taxHandling === "non_taxable"}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg disabled:bg-slate-100"
                  >
                    <option value="company_default">Use company default</option>
                    <option value="exclusive">Exclusive</option>
                    <option value="inclusive">Inclusive</option>
                  </select>
                </div>
              </div>

              {selectedSingleBookingPreview && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                  <p className="text-xs font-semibold text-emerald-800 mb-2">
                    Booking Preview - {selectedSingleBookingPreview.periodLabel}
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <div>
                      <p className="text-slate-500">Property</p>
                      <p className="font-semibold text-slate-900">{selectedSingleBookingPreview.propertyName}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Unit</p>
                      <p className="font-semibold text-slate-900">{selectedSingleBookingPreview.unitName}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Rent</p>
                      <p className="font-semibold text-slate-900">
                        KES {selectedSingleBookingPreview.rentAmount.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500">Utility</p>
                      <p className="font-semibold text-slate-900">
                        KES {selectedSingleBookingPreview.utilityAmount.toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 text-sm font-bold text-[#0B3B2E]">
                    Subtotal: KES {selectedSingleBookingPreview.totalAmount.toLocaleString()}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-emerald-900">
                    Estimated tax: KES {Number(selectedSingleBookingTaxPreview?.taxAmount || 0).toLocaleString()}
                  </p>
                  <p className="mt-1 text-sm font-bold text-[#0B3B2E]">
                    Gross total: KES {Number(selectedSingleBookingTaxPreview?.grossAmount || selectedSingleBookingPreview.totalAmount || 0).toLocaleString()}
                  </p>
                  <p className="mt-1 text-[11px] text-emerald-800 font-semibold">
                    Mode: {singleBookingForm.billingMode === "separate" ? "Separate invoices" : "Combined invoice"}
                  </p>
                  <p className="mt-1 text-[11px] text-emerald-800 font-semibold">
                    Tax: {singleBookingForm.taxHandling === "company_default" ? "Company default" : singleBookingForm.taxHandling === "non_taxable" ? "Forced non-taxable" : `${getTaxCodeLabel(singleBookingForm.taxCodeKey, normalizedTaxConfig)} (${singleBookingForm.taxMode === "company_default" ? "Company mode" : singleBookingForm.taxMode})`}
                  </p>
                  {!companyTaxEnabled && (
                    <p className="mt-1 text-[11px] text-amber-700 font-semibold">
                      Company tax is currently disabled. Backend tax posting will remain non-taxable until tax is enabled in Company Setup.
                    </p>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setShowSingleBooking(false);
                    setBookingAction("");
                  }}
                  className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSingleBooking}
                  disabled={submittingSingleBooking}
                  className="px-4 py-2 text-xs font-semibold rounded-lg text-white bg-[#0B3B2E] hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submittingSingleBooking ? "Creating..." : "Create Booking"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showBatchBooking && (
        <div className="fixed inset-0 bg-black/45 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden">
            <div className="px-5 py-3 bg-[#0B3B2E] text-white flex items-center justify-between">
              <h3 className="text-sm font-bold tracking-wide">Batch Booking</h3>
              <button
                onClick={() => {
                  setShowBatchBooking(false);
                  setBookingAction("");
                }}
                className="text-xs font-semibold px-2 py-1 rounded bg-white/20 hover:bg-white/30"
              >
                Close
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-3">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Property Scope (Optional)
                  </label>
                  <select
                    value={batchBookingForm.propertyId}
                    onChange={(e) =>
                      setBatchBookingForm((prev) => ({ ...prev, propertyId: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  >
                    <option value="all">All active properties</option>
                    {activeProperties.map((property) => (
                      <option key={property._id} value={property._id}>
                        {property.propertyName || property.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Period</label>
                  <select
                    value={batchBookingForm.month}
                    onChange={(e) =>
                      setBatchBookingForm((prev) => {
                        const nextPeriod = clampBillingPeriod(Number(e.target.value), prev.year);
                        return { ...prev, month: nextPeriod.month, year: nextPeriod.year };
                      })
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  >
                    {MONTH_OPTIONS.map((monthOption) => (
                      <option
                        key={monthOption.value}
                        value={monthOption.value}
                        disabled={isFutureBillingPeriod(monthOption.value, Number(batchBookingForm.year))}
                      >
                        {monthOption.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Year</label>
                  <input
                    type="number"
                    min="2000"
                    max={currentBookingYear}
                    value={batchBookingForm.year}
                    onChange={(e) =>
                      setBatchBookingForm((prev) => {
                        const nextYear = Math.min(Number(e.target.value) || currentBookingYear, currentBookingYear);
                        const nextPeriod = clampBillingPeriod(prev.month, nextYear);
                        return { ...prev, month: nextPeriod.month, year: nextPeriod.year };
                      })
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Billing Mode</label>
                  <select
                    value={batchBookingForm.billingMode}
                    onChange={(e) =>
                      setBatchBookingForm((prev) => ({ ...prev, billingMode: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  >
                    <option value="combined">Combined (Rent + Utility)</option>
                    <option value="separate">Separate (Rent and Utility)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Tax Handling</label>
                  <select
                    value={batchBookingForm.taxHandling}
                    onChange={(e) =>
                      setBatchBookingForm((prev) => ({ ...prev, taxHandling: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  >
                    <option value="company_default">Use company default</option>
                    <option value="taxable" disabled={!companyTaxEnabled}>Force taxable</option>
                    <option value="non_taxable">Force non-taxable</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Tax Code</label>
                  <select
                    value={batchBookingForm.taxCodeKey}
                    onChange={(e) =>
                      setBatchBookingForm((prev) => ({ ...prev, taxCodeKey: e.target.value }))
                    }
                    disabled={batchBookingForm.taxHandling === "non_taxable"}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg disabled:bg-slate-100"
                  >
                    {activeTaxCodes.map((code) => (
                      <option key={code.key} value={code.key}>
                        {code.name} ({Number(code.rate || 0)}%)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Tax Mode</label>
                  <select
                    value={batchBookingForm.taxMode}
                    onChange={(e) =>
                      setBatchBookingForm((prev) => ({ ...prev, taxMode: e.target.value }))
                    }
                    disabled={batchBookingForm.taxHandling === "non_taxable"}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg disabled:bg-slate-100"
                  >
                    <option value="company_default">Use company default</option>
                    <option value="exclusive">Exclusive</option>
                    <option value="inclusive">Inclusive</option>
                  </select>
                </div>
              </div>

              <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
                <p className="text-xs text-orange-800 font-semibold">
                  Scope preview: {batchBookingScopeCount} active tenant(s) will be booked for{" "}
                  {formatPeriodLabel(Number(batchBookingForm.month), Number(batchBookingForm.year))}.
                </p>
                <p className="text-xs text-orange-800 font-semibold mt-1">
                  Mode: {batchBookingForm.billingMode === "separate" ? "Separate invoices" : "Combined invoice"}
                </p>
                <p className="text-xs text-orange-800 font-semibold mt-1">
                  Estimated gross booking: KES {Number(batchBookingTaxPreview?.grossAmount || 0).toLocaleString()} (tax: KES {Number(batchBookingTaxPreview?.taxAmount || 0).toLocaleString()})
                </p>
                <p className="text-xs text-orange-800 font-semibold mt-1">
                  Tax: {batchBookingForm.taxHandling === "company_default" ? "Company default" : batchBookingForm.taxHandling === "non_taxable" ? "Forced non-taxable" : `${getTaxCodeLabel(batchBookingForm.taxCodeKey, normalizedTaxConfig)} (${batchBookingForm.taxMode === "company_default" ? "Company mode" : batchBookingForm.taxMode})`}
                </p>
                {!companyTaxEnabled && (
                  <p className="text-xs text-amber-700 font-semibold mt-1">
                    Company tax is disabled, so backend tax posting will remain non-taxable until enabled in Company Setup.
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setShowBatchBooking(false);
                    setBookingAction("");
                  }}
                  className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  onClick={handleBatchBooking}
                  disabled={submittingBatchBooking}
                  className="px-4 py-2 text-xs font-semibold rounded-lg text-white bg-[#0B3B2E] hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submittingBatchBooking ? "Running..." : "Run Batch Booking"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <JournalEntriesDrawer
        open={journalDrawerOpen}
        onClose={() => setJournalDrawerOpen(false)}
        title="Invoice Journal Entry"
        sourceType="invoice"
        context={journalContext}
        lines={journalLines}
      />
    </DashboardLayout>
  );
};

export default RentalInvoices;