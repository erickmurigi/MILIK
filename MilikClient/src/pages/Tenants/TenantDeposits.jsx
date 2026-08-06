import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useEntityCache } from "../../hooks/useEntityCache";
import AppSelect from "../../components/common/AppSelect";
import {
  selectCurrentUser,
  selectCurrentCompany,
  selectAllTenants,
  selectAllUnits,
  selectAllProperties,
} from "../../redux/selectors";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  FaArrowRight,
  FaEnvelope,
  FaEye,
  FaFileInvoice,
  FaMoneyBillWave,
  FaPlus,
  FaPrint,
  FaReceipt,
  FaRedoAlt,
  FaSearch,
  FaSms,
  FaSpinner,
  FaTimes,
  FaTrash,
  FaUndo,
} from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import CommunicationComposerModal from "../../components/Communications/CommunicationComposerModal";
import { useConfirm } from "../../context/ConfirmContext";
import { getTenants } from "../../redux/tenantsRedux";
import { getUnits } from "../../redux/unitRedux";
import { getProperties } from "../../redux/propertyRedux";
import { createTenantInvoice, deleteTenantInvoice, getTenantInvoices } from "../../redux/invoiceApi";
import { adminRequests } from "../../utils/requestMethods";
import { fetchCompanySettings, selectCompanySettings } from "../../redux/companySettingsRedux";
import { isSelfManagingLandlordCompany } from "../../utils/companyModules";
import { hasCompanyPermission } from "../../utils/permissions";
import { LISTING_UI, normalizeUppercaseInput } from "../../utils/listingPageUtils";
import { useTabState } from "../../hooks/useTabState";
import { safeId } from "../../utils/idUtils";

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";
const DEPOSIT_STATUS_FILTERS = [
  { val: "ACTIVE", label: "All" },
  { val: "Issued", label: "Issued" },
  { val: "Paid", label: "Paid" },
];
const MILIK_ORANGE = "bg-[#FF8C00]";
const MILIK_ORANGE_HOVER = "hover:bg-[#e67e00]";
const ITEMS_PER_PAGE = 50;

const emptyFilters = {
  status: "ACTIVE",
  invoiceNo: "",
  tenantName: "",
  propertyId: "any",
  unitId: "any",
  depositTypeId: "any",
  holder: "any",
  fromDate: "",
  toDate: "",
};

const todayInput = () => new Date().toISOString().slice(0, 10);

const ensureArray = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.tenants)) return value.tenants;
  if (Array.isArray(value?.units)) return value.units;
  if (Array.isArray(value?.properties)) return value.properties;
  return [];
};


const normalizeDepositHolder = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["landlord", "held_by_landlord"].includes(normalized)) return "landlord";
  if (
    [
      "management_company",
      "management",
      "property_manager",
      "propertymanager",
      "manager",
    ].includes(normalized)
  ) {
    return "manager";
  }
  return "";
};

const formatDepositHolderLabel = (value = "") =>
  normalizeDepositHolder(value) === "landlord" ? "Landlord" : "Management Company";

const formatCurrency = (value = 0) => `KES ${Number(value || 0).toLocaleString()}`;

const formatDateDisplay = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const formatTenantName = (tenant = {}) =>
  tenant?.name ||
  tenant?.tenantName ||
  [tenant?.firstName, tenant?.lastName].filter(Boolean).join(" ") ||
  "Unnamed Tenant";

const formatUnitName = (unit = {}) =>
  unit?.unitNumber || unit?.unitName || unit?.name || "-";

const formatPropertyName = (property = {}) =>
  property?.propertyName || property?.name || "-";

const normalizeStatus = (value = "") => String(value || "").trim().toLowerCase();

const mapInvoiceStatusLabel = ({ rawStatus = "", outstanding = 0, appliedAmount = 0 }) => {
  const status = normalizeStatus(rawStatus);
  if (status === "paid") return "Paid";
  if (status === "partially_paid") return "Partially Paid";
  if (status === "cancelled") return "Cancelled";
  if (status === "reversed") return "Reversed";
  if (outstanding <= 0) return "Paid";
  return appliedAmount > 0 ? "Partially Paid" : "Issued";
};

const getStatusBadgeClass = (status = "") => {
  if (status === "Paid") return "bg-green-100 text-green-700";
  if (status === "Partially Paid") return "bg-amber-100 text-amber-700";
  if (status === "Cancelled" || status === "Reversed") return "bg-slate-100 text-slate-700";
  return "bg-orange-100 text-orange-700";
};

const slugify = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "deposit";

const getPrimaryLandlordId = ({ property = {}, tenant = {} } = {}) => {
  const propertyLandlords = Array.isArray(property?.landlords) ? property.landlords : [];
  const primary =
    propertyLandlords.find((item) => item?.isPrimary) ||
    propertyLandlords.find(Boolean) ||
    null;

  return (
    primary?.landlordId?._id ||
    primary?.landlordId ||
    primary?._id ||
    primary ||
    tenant?.landlord?._id ||
    tenant?.landlord ||
    null
  );
};

const buildDepositDescription = ({ depositType, tenantName, invoiceDate }) => {
  const typeLabel = depositType?.name || "Deposit";
  const parsedDate = invoiceDate ? new Date(invoiceDate) : new Date();
  const period = Number.isNaN(parsedDate.getTime())
    ? ""
    : `${parsedDate.toLocaleString("en-US", { month: "short" })}/${String(parsedDate.getFullYear()).slice(-2)}`;
  return `${period ? `${period} ` : ""}${typeLabel}${tenantName ? ` - ${tenantName}` : ""}`;
};

const fallbackDepositType = {
  _id: "security_deposit",
  name: "Security Deposit",
  code: "SECURITY",
  defaultAmount: 0,
  refundable: true,
  isFallback: true,
};

const TenantDeposits = () => {
  const confirm = useConfirm();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const tenants = useSelector(selectAllTenants);
  const units = useSelector(selectAllUnits);
  const properties = useSelector(selectAllProperties);
  const { propertiesLoaded, unitsLoaded, tenantsLoaded } = useEntityCache(currentCompany?._id);

  const isLandlordWorkspace = useMemo(() => isSelfManagingLandlordCompany(currentCompany || null), [currentCompany]);
  const holderColumnLabel = isLandlordWorkspace ? "Owner / Landlord" : "Deposit Holder";
  const { canCreateInvoice, canDeleteInvoice, canExportInvoice } = useMemo(() => ({
    canCreateInvoice: hasCompanyPermission(currentUser || {}, currentCompany, "tenantInvoices", "create", "propertyManagement"),
    canDeleteInvoice: hasCompanyPermission(currentUser || {}, currentCompany, "tenantInvoices", "delete", "propertyManagement"),
    canExportInvoice: hasCompanyPermission(currentUser || {}, currentCompany, "tenantInvoices", "export", "propertyManagement"),
  }), [currentUser, currentCompany]);

  const storedSettings = useSelector(selectCompanySettings);
  const [depositInvoices, setDepositInvoices] = useState([]);
  const depositTypes = Array.isArray(storedSettings?.depositTypes) ? storedSettings.depositTypes : [];
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [appliedFilters, setAppliedFilters] = useTabState("/tenants/deposits:appliedFilters", emptyFilters);
  const [draftFilters, setDraftFilters] = useState(appliedFilters);
  const setFilter = (key) => (e) => setDraftFilters((prev) => ({ ...prev, [key]: e.target.value }));
  const [currentPage, setCurrentPage] = useTabState("/tenants/deposits:currentPage", 1);
  const [selectedInvoices, setSelectedInvoices] = useState([]);
  const [selectAll, setSelectAll] = useState(false);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [communicationModal, setCommunicationModal] = useState(null);
  const [tenantPropertyFilter, setTenantPropertyFilter] = useTabState("/tenants/deposits:tenantPropertyFilter", "any");
  const [depositForm, setDepositForm] = useState({
    tenantId: "",
    depositTypeId: "",
    amount: "",
    invoiceDate: todayInput(),
    dueDate: todayInput(),
    depositHeldBy: "",
    description: "",
  });

  const tenantLookup = useMemo(() => new Map(tenants.map((tenant) => [String(tenant?._id || ""), tenant])), [tenants]);
  const unitLookup = useMemo(() => new Map(units.map((unit) => [String(unit?._id || ""), unit])), [units]);
  const propertyLookup = useMemo(() => new Map(properties.map((property) => [String(property?._id || ""), property])), [properties]);

  const activeProperties = useMemo(
    () => properties.filter((property) => normalizeStatus(property?.status || "active") !== "archived"),
    [properties]
  );
  const activePropertyOptions = useMemo(
    () => activeProperties.map((property) => ({ value: property._id, label: formatPropertyName(property) })),
    [activeProperties]
  );

  const activeDepositTypes = useMemo(() => {
    const rows = Array.isArray(depositTypes) ? depositTypes : [];
    const activeRows = rows.filter((item) => item?.isActive !== false);
    return activeRows.length > 0 ? activeRows : [fallbackDepositType];
  }, [depositTypes]);

  const depositTypeLookup = useMemo(() => {
    const map = new Map();
    activeDepositTypes.forEach((item) => map.set(String(item?._id || item?.code || item?.name || ""), item));
    return map;
  }, [activeDepositTypes]);

  const unitsForFilter = useMemo(() => {
    if (draftFilters.propertyId === "any") return units;
    return units.filter((unit) => safeId(unit?.property) === String(draftFilters.propertyId));
  }, [draftFilters.propertyId, units]);

  const tenantOptions = useMemo(() => {
    return tenants
      .map((tenant) => {
        const unitId = safeId(tenant?.unit);
        const unit = unitLookup.get(unitId) || {};
        const propertyId = safeId(tenant?.property) || safeId(unit?.property) || safeId(tenant?.unit?.property);
        const property = propertyLookup.get(propertyId) || tenant?.property || unit?.property || {};
        return {
          tenant,
          tenantId: safeId(tenant),
          tenantName: formatTenantName(tenant),
          unitName: formatUnitName(unit || tenant?.unit),
          propertyId,
          propertyName: formatPropertyName(property),
        };
      })
      .filter((option) => {
        if (!option.tenantId) return false;
        if (tenantPropertyFilter !== "any" && String(option.propertyId) !== String(tenantPropertyFilter)) return false;
        return true;
      })
      .sort((a, b) => a.tenantName.localeCompare(b.tenantName));
  }, [tenantPropertyFilter, tenants, unitLookup, propertyLookup]);

  const resolveTenantContext = useCallback(
    (tenantId) => {
      const tenant = tenantLookup.get(String(tenantId || "")) || null;
      if (!tenant) return null;

      const unitId = safeId(tenant?.unit);
      const unit = unitLookup.get(unitId) || tenant?.unit || null;
      const propertyId =
        safeId(tenant?.property) ||
        safeId(unit?.property) ||
        safeId(tenant?.unit?.property);
      const property = propertyLookup.get(propertyId) || tenant?.property || unit?.property || null;

      return {
        tenant,
        tenantId: safeId(tenant),
        tenantName: formatTenantName(tenant),
        unit,
        unitId: safeId(unit) || unitId,
        unitName: formatUnitName(unit),
        property,
        propertyId: safeId(property) || propertyId,
        propertyName: formatPropertyName(property),
        landlordId: getPrimaryLandlordId({ property, tenant }),
        depositAmount: Number(tenant?.depositAmount ?? unit?.deposit ?? tenant?.unit?.deposit ?? 0),
        depositHeldBy:
          normalizeDepositHolder(tenant?.depositHeldBy || property?.depositHeldBy) ||
          (isLandlordWorkspace ? "landlord" : "manager"),
      };
    },
    [isLandlordWorkspace, propertyLookup, tenantLookup, unitLookup]
  );

  const loadDepositInvoices = useCallback(async () => {
    if (!currentCompany?._id) {
      setDepositInvoices([]);
      return;
    }

    setLoading(true);
    try {
      const rows = await getTenantInvoices({
        business: currentCompany._id,
        category: "DEPOSIT_CHARGE",
        includeSnapshots: true,
      });
      setDepositInvoices(Array.isArray(rows) ? rows : []);
    } catch (error) {
      console.error("Failed to load deposit invoices:", error);
      setDepositInvoices([]);
      toast.error(error?.message || "Failed to load deposit invoices.");
    } finally {
      setLoading(false);
    }
  }, [currentCompany?._id]);

  useEffect(() => {
    if (!currentCompany?._id) return;
    if (!tenantsLoaded) dispatch(getTenants({ business: currentCompany._id }));
    if (!unitsLoaded) dispatch(getUnits({ business: currentCompany._id }));
    if (!propertiesLoaded) dispatch(getProperties({ business: currentCompany._id }));
    dispatch(fetchCompanySettings(currentCompany._id));
    loadDepositInvoices();
  }, [currentCompany?._id, loadDepositInvoices, dispatch]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handleRefresh = () => loadDepositInvoices();
    window.addEventListener("invoicesUpdated", handleRefresh);
    return () => window.removeEventListener("invoicesUpdated", handleRefresh);
  }, [loadDepositInvoices]);

  const depositRows = useMemo(() => {
    return depositInvoices
      .map((invoice, index) => {
        const invoiceTenantId = safeId(invoice?.tenant);
        const tenant = tenantLookup.get(invoiceTenantId) || (typeof invoice?.tenant === "object" ? invoice.tenant : {});
        const invoiceUnitId = safeId(invoice?.unit) || safeId(tenant?.unit);
        const unit = unitLookup.get(invoiceUnitId) || (typeof invoice?.unit === "object" ? invoice.unit : {});
        const invoicePropertyId = safeId(invoice?.property) || safeId(tenant?.property) || safeId(unit?.property);
        const property = propertyLookup.get(invoicePropertyId) || (typeof invoice?.property === "object" ? invoice.property : {});
        const metadata = invoice?.metadata && typeof invoice.metadata === "object" ? invoice.metadata : {};
        const amount = Number(invoice?.adjustedAmount ?? invoice?.amount ?? 0);
        const appliedAmount = Math.max(0, Number(invoice?.appliedAmount ?? 0));
        const outstandingAmount = Math.max(
          0,
          Number(invoice?.outstanding ?? Math.max(0, amount - appliedAmount))
        );
        const status = mapInvoiceStatusLabel({
          rawStatus: invoice?.computedStatus || invoice?.status,
          outstanding: outstandingAmount,
          appliedAmount,
        });
        const depositTypeLabel =
          metadata?.depositTypeName ||
          metadata?.billItemLabel ||
          invoice?.description ||
          "Deposit";
        const depositTypeId = String(metadata?.depositTypeId || metadata?.billItemKey || slugify(depositTypeLabel));
        const invoiceDate = invoice?.bookingDate || invoice?.invoiceDate || invoice?.createdAt || null;

        return {
          key: safeId(invoice) || `${invoice?.invoiceNumber || "deposit"}-${index}`,
          id: invoice?.invoiceNumber || safeId(invoice) || "-",
          invoiceId: safeId(invoice),
          tenantId: invoiceTenantId,
          tenantName: invoice?.tenant?.name || formatTenantName(tenant),
          propertyId: invoicePropertyId,
          propertyName: invoice?.property?.propertyName || formatPropertyName(property),
          unitId: invoiceUnitId,
          unitName: invoice?.unit?.unitNumber || formatUnitName(unit),
          depositTypeId,
          depositTypeLabel,
          holder: formatDepositHolderLabel(invoice?.depositHeldBy || metadata?.depositHeldBy || tenant?.depositHeldBy || property?.depositHeldBy),
          amount,
          appliedAmount,
          outstandingAmount,
          status,
          rawStatus: normalizeStatus(invoice?.computedStatus || invoice?.status),
          invoiceDate,
          invoiceDateLabel: formatDateDisplay(invoiceDate),
          dueDate: invoice?.dueDate || null,
          dueDateLabel: formatDateDisplay(invoice?.dueDate),
          createdAt: invoice?.createdAt || invoiceDate,
          createdDate: formatDateDisplay(invoice?.createdAt || invoiceDate),
          description: invoice?.description || depositTypeLabel,
          originalInvoice: invoice,
        };
      })
      .sort((a, b) => new Date(b.invoiceDate || b.createdAt || 0) - new Date(a.invoiceDate || a.createdAt || 0));
  }, [depositInvoices, propertyLookup, tenantLookup, unitLookup]);

  const filteredRows = useMemo(() => {
    return depositRows.filter((row) => {
      if (appliedFilters.status === "ACTIVE" && ["cancelled", "reversed"].includes(row.rawStatus)) return false;
      if (appliedFilters.status === "Issued" && !["Issued", "Partially Paid"].includes(row.status)) return false;
      if (appliedFilters.status === "Paid" && row.status !== "Paid") return false;
      if (appliedFilters.invoiceNo && !row.id.toLowerCase().includes(appliedFilters.invoiceNo.toLowerCase())) return false;
      if (appliedFilters.tenantName && !row.tenantName.toLowerCase().includes(appliedFilters.tenantName.toLowerCase())) return false;
      if (appliedFilters.propertyId !== "any" && String(row.propertyId) !== String(appliedFilters.propertyId)) return false;
      if (appliedFilters.unitId !== "any" && String(row.unitId) !== String(appliedFilters.unitId)) return false;
      if (appliedFilters.depositTypeId !== "any") {
        const expected = String(appliedFilters.depositTypeId);
        if (String(row.depositTypeId) !== expected && !String(row.depositTypeId).includes(expected)) return false;
      }
      if (appliedFilters.holder !== "any" && normalizeDepositHolder(row.holder) !== appliedFilters.holder) return false;

      const invoiceTime = row.invoiceDate ? new Date(row.invoiceDate).getTime() : 0;
      if (appliedFilters.fromDate) {
        const from = new Date(`${appliedFilters.fromDate}T00:00:00`).getTime();
        if (invoiceTime < from) return false;
      }
      if (appliedFilters.toDate) {
        const to = new Date(`${appliedFilters.toDate}T23:59:59`).getTime();
        if (invoiceTime > to) return false;
      }
      return true;
    });
  }, [appliedFilters, depositRows]);

  const totals = useMemo(
    () =>
      filteredRows.reduce(
        (acc, row) => ({
          count: acc.count + 1,
          amount: acc.amount + row.amount,
          paid: acc.paid + row.appliedAmount,
          outstanding: acc.outstanding + row.outstandingAmount,
        }),
        { count: 0, amount: 0, paid: 0, outstanding: 0 }
      ),
    [filteredRows]
  );

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / ITEMS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, filteredRows.length);
  const currentPageRows = filteredRows.slice(startIndex, endIndex);
  const selectedCount = selectedInvoices.length;

  useEffect(() => {
    setCurrentPage(1);
    setSelectedInvoices([]);
    setSelectAll(false);
  }, [appliedFilters]);

  useEffect(() => {
    if (currentPage !== safeCurrentPage) setCurrentPage(safeCurrentPage);
  }, [currentPage, safeCurrentPage]);

  useEffect(() => {
    const pageKeys = currentPageRows.map((row) => row.key);
    setSelectAll(pageKeys.length > 0 && pageKeys.every((key) => selectedInvoices.includes(key)));
  }, [currentPageRows, selectedInvoices]);

  const applySearch = () => setAppliedFilters({ ...draftFilters });

  const resetFilters = () => {
    setDraftFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
  };

  const syncDepositFormDefaults = ({ tenantId, depositTypeId, invoiceDate = todayInput(), dueDate = todayInput() }) => {
    const context = resolveTenantContext(tenantId);
    const depositType = depositTypeLookup.get(String(depositTypeId || "")) || activeDepositTypes[0] || fallbackDepositType;
    const amount = Number(depositType?.defaultAmount || 0) > 0
      ? Number(depositType.defaultAmount)
      : Number(context?.depositAmount || 0);
    const holder = context?.depositHeldBy || (isLandlordWorkspace ? "landlord" : "manager");

    return {
      tenantId: tenantId || "",
      depositTypeId: String(depositType?._id || depositType?.code || ""),
      amount: amount > 0 ? String(amount) : "",
      invoiceDate,
      dueDate,
      depositHeldBy: holder,
      description: buildDepositDescription({
        depositType,
        tenantName: context?.tenantName || "",
        invoiceDate,
      }),
    };
  };

  const openDepositModal = () => {
    const firstType = activeDepositTypes[0] || fallbackDepositType;
    setTenantPropertyFilter("any");
    setDepositForm(syncDepositFormDefaults({
      tenantId: "",
      depositTypeId: firstType?._id || firstType?.code || "",
      invoiceDate: todayInput(),
      dueDate: todayInput(),
    }));
    setShowDepositModal(true);
  };

  const closeDepositModal = () => {
    if (saving) return;
    setShowDepositModal(false);
  };

  const updateDepositTenant = (tenantId) => {
    setDepositForm((prev) =>
      syncDepositFormDefaults({
        tenantId,
        depositTypeId: prev.depositTypeId,
        invoiceDate: prev.invoiceDate || todayInput(),
        dueDate: prev.dueDate || todayInput(),
      })
    );
  };

  const updateDepositType = (depositTypeId) => {
    setDepositForm((prev) =>
      syncDepositFormDefaults({
        tenantId: prev.tenantId,
        depositTypeId,
        invoiceDate: prev.invoiceDate || todayInput(),
        dueDate: prev.dueDate || todayInput(),
      })
    );
  };

  const handleCreateDepositInvoice = async () => {
    if (!currentCompany?._id) return;
    const context = resolveTenantContext(depositForm.tenantId);
    const depositType = depositTypeLookup.get(String(depositForm.depositTypeId || "")) || activeDepositTypes[0] || fallbackDepositType;
    const amount = Number(depositForm.amount || 0);
    const holder = normalizeDepositHolder(depositForm.depositHeldBy) || (isLandlordWorkspace ? "landlord" : "manager");

    if (!context?.tenantId) {
      toast.error("Select a tenant before creating the deposit invoice.");
      return;
    }
    if (!context.propertyId || !context.unitId) {
      toast.error("Tenant deposit context is incomplete. Check the tenant property and unit linkage first.");
      return;
    }
    if (amount <= 0) {
      toast.error("Enter a valid deposit amount.");
      return;
    }
    if (new Date(depositForm.dueDate) < new Date(depositForm.invoiceDate)) {
      toast.error("Due date cannot be before invoice date.");
      return;
    }

    setSaving(true);
    try {
      const depositTypeKey = slugify(depositType?.code || depositType?.name || "deposit");
      await createTenantInvoice({
        business: currentCompany._id,
        property: context.propertyId,
        landlord: context.landlordId || undefined,
        tenant: context.tenantId,
        unit: context.unitId,
        category: "DEPOSIT_CHARGE",
        amount,
        depositHeldBy: holder,
        description:
          depositForm.description ||
          buildDepositDescription({
            depositType,
            tenantName: context.tenantName,
            invoiceDate: depositForm.invoiceDate,
          }),
        invoiceDate: depositForm.invoiceDate,
        dueDate: depositForm.dueDate,
        metadata: {
          billItemKey: `deposit:${depositTypeKey}`,
          billItemLabel: depositType?.name || "Deposit",
          depositTypeId: depositType?.isFallback ? "" : safeId(depositType),
          depositTypeCode: depositType?.code || "",
          depositTypeName: depositType?.name || "Deposit",
          refundable: depositType?.refundable !== false,
          invoicePriorityCategory: "deposit",
          sourceTransactionType: "tenant_deposit_module",
          includeInLandlordStatement: false,
          includeInCategoryTotals: false,
          depositHeldBy: holder,
          ledgerMode: holder === "landlord" ? "off_ledger" : "on_ledger",
        },
      });

      toast.success("Deposit invoice created successfully.");
      setShowDepositModal(false);
      await loadDepositInvoices();
      window.dispatchEvent(new Event("invoicesUpdated"));
    } catch (error) {
      toast.error(
        error?.response?.data?.error ||
          error?.response?.data?.message ||
          error?.message ||
          "Failed to create deposit invoice."
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleRowSelection = (key) => {
    setSelectedInvoices((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
  };

  const toggleSelectAll = () => {
    const pageKeys = currentPageRows.map((row) => row.key);
    if (selectAll) {
      setSelectedInvoices((prev) => prev.filter((key) => !pageKeys.includes(key)));
      setSelectAll(false);
      return;
    }
    setSelectedInvoices((prev) => Array.from(new Set([...prev, ...pageKeys])));
    setSelectAll(true);
  };

  const handleDeleteSelected = async () => {
    if (!canDeleteInvoice || selectedInvoices.length === 0) return;
    const selectedRows = depositRows.filter((row) => selectedInvoices.includes(row.key));
    const confirmed = await confirm({ title: "Delete Deposit Invoices", message: `Delete ${selectedRows.length} selected deposit invoice(s)?`, confirmText: "Delete", isDangerous: true });
    if (!confirmed) return;

    setDeleting(true);
    try {
      await Promise.all(selectedRows.filter((row) => row.invoiceId).map((row) => deleteTenantInvoice(row.invoiceId)));
      toast.success("Selected deposit invoice(s) deleted successfully.");
      setSelectedInvoices([]);
      await loadDepositInvoices();
      window.dispatchEvent(new Event("invoicesUpdated"));
    } catch (error) {
      toast.error(error?.message || "Failed to delete selected deposit invoices.");
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteSingle = async (row) => {
    if (!canDeleteInvoice || !row?.invoiceId) return;
    const isOnLedger = row.originalInvoice?.ledgerMode !== "off_ledger";
    const action = isOnLedger ? "Reverse" : "Delete";
    const confirmed = await confirm({
      title: `${action} Deposit Invoice`,
      message: isOnLedger
        ? `Reverse deposit invoice ${row.id}? The ledger entries will be reversed.`
        : `Permanently delete deposit invoice ${row.id}?`,
      confirmText: action,
      isDangerous: true,
    });
    if (!confirmed) return;

    setDeleting(true);
    try {
      await deleteTenantInvoice(row.invoiceId);
      toast.success(isOnLedger ? "Deposit invoice reversed." : "Deposit invoice deleted.");
      setSelectedInvoices((prev) => prev.filter((key) => key !== row.key));
      await loadDepositInvoices();
      window.dispatchEvent(new Event("invoicesUpdated"));
    } catch (error) {
      toast.error(error?.message || `Failed to ${action.toLowerCase()} deposit invoice.`);
    } finally {
      setDeleting(false);
    }
  };

  const handlePrintList = () => {
    if (!canExportInvoice || filteredRows.length === 0) return;
    const rowsHtml = filteredRows
      .map(
        (row) => `
          <tr>
            <td>${row.id}</td>
            <td>${row.tenantName}</td>
            <td>${row.propertyName}</td>
            <td>${row.unitName}</td>
            <td>${row.depositTypeLabel}</td>
            <td>${row.holder}</td>
            <td>${row.invoiceDateLabel}</td>
            <td>${row.dueDateLabel}</td>
            <td>${formatCurrency(row.amount)}</td>
            <td>${formatCurrency(row.outstandingAmount)}</td>
            <td>${row.status}</td>
          </tr>`
      )
      .join("");

    const printWindow = window.open("", "_blank", "width=1100,height=800");
    if (!printWindow) return;
    printWindow.document.write(`
      <html>
        <head>
          <title>Deposit Invoices Register</title>
          <style>
            body { font-family: Arial, sans-serif; color: #172b24; padding: 24px; }
            h1 { font-size: 18px; margin: 0 0 4px; }
            p { margin: 0 0 14px; font-size: 12px; color: #52635d; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; }
            th { background: #0B3B2E; color: white; text-align: left; padding: 7px; }
            td { border-bottom: 1px solid #dbe4df; padding: 7px; }
          </style>
        </head>
        <body>
          <h1>Deposit Invoices Register</h1>
          <p>${currentCompany?.name || currentCompany?.companyName || ""} - ${filteredRows.length} invoice(s)</p>
          <table>
            <thead>
              <tr>
                <th>Invoice #</th><th>Tenant</th><th>Property</th><th>Unit</th><th>Deposit Type</th>
                <th>Holder</th><th>Invoice Date</th><th>Due Date</th><th>Amount</th><th>Outstanding</th><th>Status</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const totalFilteredCount = filteredRows.length;

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col bg-gradient-to-br from-slate-50 via-white to-slate-100 p-1 sm:p-2">
        <div className="mx-auto flex h-full min-h-0 w-full max-w-none flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
            <div className="flex-none sticky top-0 z-30 border-b border-gray-200 bg-white shadow-sm">
              <div className="filter-bar flex items-center gap-0.5 overflow-x-auto px-2 py-1">
                <span className="shrink-0 border border-blue-200 bg-blue-50 px-1 py-0.5 text-[8px] font-bold text-blue-700">Deposits: {totals.count}</span>
                <span className="shrink-0 border border-emerald-200 bg-emerald-50 px-1 py-0.5 text-[8px] font-bold text-emerald-700">{formatCurrency(totals.amount)}</span>
                <span className="shrink-0 border border-amber-200 bg-amber-50 px-1 py-0.5 text-[8px] font-bold text-amber-700">O/S: {formatCurrency(totals.outstanding)}</span>
                <div className="mx-1 h-3 w-px shrink-0 bg-slate-200" />
                {DEPOSIT_STATUS_FILTERS.map(({val,label}) => (
                  <button key={val} onClick={() => setDraftFilters((prev) => ({ ...prev, status: val }))} className={`h-[20px] shrink-0 px-1.5 text-[9px] font-semibold ${draftFilters.status === val ? `${MILIK_GREEN} text-white` : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-100"}`}>{label}</button>
                ))}
                <div className="mx-1 h-3 w-px shrink-0 bg-slate-200" />
                <input type="text" value={draftFilters.invoiceNo} onChange={(e) => setDraftFilters((prev) => ({ ...prev, invoiceNo: normalizeUppercaseInput(e.target.value) }))} placeholder="Invoice #" className="h-[20px] w-20 shrink-0 border border-gray-300 px-1.5 text-[9px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
                <input type="text" value={draftFilters.tenantName} onChange={setFilter("tenantName")} placeholder="Tenant" className="h-[20px] w-20 shrink-0 border border-gray-300 px-1.5 text-[9px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
                <AppSelect
                  compact
                  clearable
                  searchable
                  placeholder="Property"
                  value={draftFilters.propertyId}
                  onChange={(v) => setDraftFilters((prev) => ({ ...prev, propertyId: v ?? "any", unitId: "any" }))}
                  options={activePropertyOptions}
                />
                <AppSelect
                  compact
                  clearable
                  placeholder="Unit"
                  value={draftFilters.unitId}
                  onChange={(v) => setDraftFilters((prev) => ({ ...prev, unitId: v ?? "any" }))}
                  options={unitsForFilter.map((unit) => ({ value: unit._id, label: formatUnitName(unit) }))}
                />
                <AppSelect
                  compact
                  clearable
                  placeholder="Deposit Type"
                  value={draftFilters.depositTypeId}
                  onChange={(v) => setDraftFilters((prev) => ({ ...prev, depositTypeId: v ?? "any" }))}
                  options={activeDepositTypes.map((type) => ({ value: type._id || `deposit:${slugify(type.code || type.name)}`, label: type.name }))}
                />
                <AppSelect
                  compact
                  clearable
                  placeholder={holderColumnLabel}
                  value={draftFilters.holder}
                  onChange={(v) => setDraftFilters((prev) => ({ ...prev, holder: v ?? "any" }))}
                  options={[
                    ...(!isLandlordWorkspace ? [{ value: "manager", label: "Management Company" }] : []),
                    { value: "landlord", label: isLandlordWorkspace ? "Owner / Landlord" : "Landlord" },
                  ]}
                />
                <input type="date" value={draftFilters.fromDate} onChange={setFilter("fromDate")} className="h-[20px] w-[5.5rem] shrink-0 border border-slate-200 bg-white px-1 text-[9px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
                <input type="date" value={draftFilters.toDate} onChange={setFilter("toDate")} className="h-[20px] w-[5.5rem] shrink-0 border border-slate-200 bg-white px-1 text-[9px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
                <button onClick={applySearch} className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] font-semibold text-white shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}><FaSearch size={7} /> Search</button>
                <button onClick={resetFilters} className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] font-semibold text-white shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}><FaRedoAlt size={7} /> Reset</button>
                <button onClick={loadDepositInvoices} disabled={loading} className="h-[20px] shrink-0 flex items-center gap-0.5 border border-gray-300 bg-white px-1.5 text-[9px] text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-60">{loading ? <FaSpinner className="animate-spin" size={7} /> : <FaRedoAlt size={7} />} Refresh</button>
                <button onClick={handleDeleteSelected} disabled={!canDeleteInvoice || selectedCount === 0 || deleting} className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] font-semibold text-white shadow-sm ${selectedCount > 0 ? "bg-red-600 hover:bg-red-700" : "cursor-not-allowed bg-gray-400"}`}><FaTrash size={7} /> Delete</button>
                <button
                  onClick={() => setCommunicationModal({ contextType: "invoice", recordIds: selectedInvoices, title: `Notify ${selectedCount} Tenant${selectedCount !== 1 ? "s" : ""}`, subtitle: "Send deposit invoice notification via SMS.", allowedChannels: ["sms", "email"], defaultChannel: "sms" })}
                  disabled={selectedCount === 0}
                  title={selectedCount === 0 ? "Select deposits to SMS tenants" : `SMS ${selectedCount} tenant${selectedCount !== 1 ? "s" : ""}`}
                  className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] font-semibold text-white shadow-sm ${selectedCount > 0 ? "bg-teal-600 hover:bg-teal-700" : "cursor-not-allowed bg-gray-400"}`}
                ><FaSms size={7} /> SMS</button>
                <button
                  onClick={() => setCommunicationModal({ contextType: "invoice", recordIds: selectedInvoices, title: `Email ${selectedCount} Tenant${selectedCount !== 1 ? "s" : ""}`, subtitle: "Send deposit invoice notification via email.", allowedChannels: ["email"], defaultChannel: "email" })}
                  disabled={selectedCount === 0}
                  title={selectedCount === 0 ? "Select deposits to email tenants" : `Email ${selectedCount} tenant${selectedCount !== 1 ? "s" : ""}`}
                  className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] font-semibold text-white shadow-sm ${selectedCount > 0 ? "bg-blue-600 hover:bg-blue-700" : "cursor-not-allowed bg-gray-400"}`}
                ><FaEnvelope size={7} /> Email</button>
                <button onClick={handlePrintList} disabled={!canExportInvoice || totalFilteredCount === 0} className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] font-semibold text-white shadow-sm ${totalFilteredCount > 0 ? `${MILIK_GREEN} ${MILIK_GREEN_HOVER}` : "cursor-not-allowed bg-gray-400"}`}><FaPrint size={7} /> Print</button>
                <button type="button" onClick={openDepositModal} disabled={!canCreateInvoice} className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] font-semibold text-white shadow-sm ${canCreateInvoice ? `${MILIK_GREEN} ${MILIK_GREEN_HOVER}` : "cursor-not-allowed bg-gray-400"}`}><FaPlus size={7} /> Deposit</button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
              <table className="w-full min-w-[1480px] text-[11px] border-collapse">
                <thead className="sticky top-0 z-10 shadow-sm">
                  <tr className={`${MILIK_GREEN} text-white`}>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">
                      <input type="checkbox" checked={currentPageRows.length > 0 && selectAll} onChange={toggleSelectAll} />
                    </th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Invoice #</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Tenant</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Property</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Unit</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Deposit Type</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">{holderColumnLabel}</th>
                    <th className="px-3 py-1 text-center font-bold border-r border-white/10">Booking / Invoice Date</th>
                    <th className="px-3 py-1 text-center font-bold border-r border-white/10">Due Date</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">Amount</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">Paid</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">Outstanding</th>
                    <th className="px-3 py-1 text-center font-bold border-r border-white/10">Status</th>
                    <th className="px-3 py-1 text-center font-bold border-r border-white/10">Created</th>
                    <th className="px-3 py-1 text-right font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && currentPageRows.length === 0 ? (
                    <tr>
                      <td colSpan="15" className="px-4 py-8 text-center text-gray-500">
                        <FaSpinner className="mb-2 inline-block animate-spin text-2xl text-gray-300" />
                        <p className="mt-1 text-sm font-semibold">Loading deposit invoices...</p>
                      </td>
                    </tr>
                  ) : totalFilteredCount === 0 ? (
                    <tr>
                      <td colSpan="15" className="px-4 py-8 text-center text-gray-500">
                        <FaFileInvoice className="mb-2 inline-block text-4xl text-gray-300" />
                        <p className="mt-1 text-sm font-semibold">No deposit invoices found</p>
                        <p className="mt-1 text-xs text-gray-400">Create a deposit invoice to see it in this register.</p>
                      </td>
                    </tr>
                  ) : (
                    currentPageRows.map((row, idx) => (
                      <tr
                        key={row.key}
                        className={`cursor-pointer border-b border-gray-100 transition-colors ${
                          selectedInvoices.includes(row.key)
                            ? "bg-emerald-50/85 shadow-[inset_4px_0_0_0_#0B3B2E] hover:bg-emerald-50"
                            : idx % 2 === 0
                            ? "bg-white hover:bg-blue-50/40"
                            : "bg-slate-50/60 hover:bg-blue-50/40"
                        }`}
                        onClick={() => navigate(`/tenant/${row.tenantId}/statement`)}
                      >
                        <td className="px-3 py-1 border-r border-gray-100">
                          <input
                            type="checkbox"
                            checked={selectedInvoices.includes(row.key)}
                            onChange={() => toggleRowSelection(row.key)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td className="px-3 py-1 border-r border-gray-100 font-bold text-blue-700">{row.id}</td>
                        <td className="px-3 py-1 border-r border-gray-100 font-bold text-slate-900">{row.tenantName}</td>
                        <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900">{row.propertyName}</td>
                        <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900">{row.unitName}</td>
                        <td className="px-3 py-1 border-r border-gray-100 font-semibold text-orange-700">
                          <div>{row.depositTypeLabel}</div>
                          <div className="max-w-[220px] truncate text-[10px] font-normal text-slate-500">{row.description}</div>
                        </td>
                        <td className="px-3 py-1 border-r border-gray-100 text-slate-700">{row.holder}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-center text-gray-700">{row.invoiceDateLabel}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-center text-gray-700">{row.dueDateLabel}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-right font-bold text-slate-900">{formatCurrency(row.amount)}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-right text-slate-700">{formatCurrency(row.appliedAmount)}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-right font-bold text-slate-900">{formatCurrency(row.outstandingAmount)}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-center">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${getStatusBadgeClass(row.status)}`}>
                            {row.status}
                          </span>
                        </td>
                        <td className="px-3 py-1 border-r border-gray-100 text-center text-gray-600">{row.createdDate}</td>
                        <td className="px-3 py-1 text-right">
                          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => navigate(`/tenant/${row.tenantId}/statement`)}
                              className="rounded p-1 text-blue-600 hover:bg-blue-50 hover:text-blue-800"
                              title="View tenant statement"
                            >
                              <FaEye size={12} />
                            </button>
                            <button
                              onClick={() => navigate(`/receipts/new?tenant=${row.tenantId}`)}
                              className="rounded p-1 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-800"
                              title="Create receipt"
                            >
                              <FaReceipt size={12} />
                            </button>
                            {(() => {
                              const isOnLedger = row.originalInvoice?.ledgerMode !== "off_ledger";
                              const isPaid = ["paid", "partially_paid"].includes(row.rawStatus);
                              const disabledReason = !canDeleteInvoice
                                ? "You do not have permission"
                                : isPaid
                                ? "Paid deposits must be reversed via receipts first"
                                : null;
                              return (
                                <button
                                  onClick={() => handleDeleteSingle(row)}
                                  disabled={!!disabledReason || deleting}
                                  className={`rounded p-1 disabled:cursor-not-allowed disabled:opacity-40 ${isOnLedger ? "text-amber-600 hover:bg-amber-50 hover:text-amber-800" : "text-red-600 hover:bg-red-50 hover:text-red-800"}`}
                                  title={disabledReason || (isOnLedger ? "Reverse deposit invoice (ledger will be reversed)" : "Delete deposit invoice")}
                                >
                                  {isOnLedger ? <FaUndo size={12} /> : <FaTrash size={12} />}
                                </button>
                              );
                            })()}
                            <button
                              onClick={() => navigate(`/tenant/${row.tenantId}/statement`)}
                              className="rounded p-1 text-indigo-600 hover:bg-indigo-50 hover:text-indigo-800"
                              title="Open statement"
                            >
                              <FaArrowRight size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700">
              <p>
                <span className="font-semibold">Showing:</span> {totalFilteredCount === 0 ? 0 : startIndex + 1}
                {" - "}
                {endIndex} of {totalFilteredCount} deposit invoice(s)
                {appliedFilters.status !== "ACTIVE" && ` - Status: ${appliedFilters.status}`}
              </p>
              <div className="flex items-center gap-3">
                <p>
                  <span className="font-semibold">Selected:</span> {selectedCount}
                  {totalFilteredCount > 0 && (
                    <>
                      {" - "}
                      <span className="font-semibold">Total:</span> {formatCurrency(totals.amount)}
                    </>
                  )}
                </p>
                <div className="h-4 w-px bg-slate-300" />
                <span className="text-slate-500">Per page: {ITEMS_PER_PAGE}</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    disabled={safeCurrentPage === 1}
                    className="rounded border border-slate-300 px-2.5 py-0.5 font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span className="rounded border border-slate-200 bg-white px-2.5 py-0.5 font-semibold text-slate-700">
                    Page {safeCurrentPage} of {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={safeCurrentPage === totalPages}
                    className="rounded border border-slate-300 px-2.5 py-0.5 font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showDepositModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
          <div className="flex w-full max-w-3xl max-h-[90vh] flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">
            <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
              <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide">New Deposit Invoice</h3>
              <button
                onClick={closeDepositModal}
                className="text-white/70 transition-colors hover:text-white"
              >
                <FaTimes />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-white px-5 py-4">
              {depositTypes.length === 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
                  No custom deposit types are active in Operational Settings yet, so Security Deposit is available as a fallback.
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Property Filter</label>
                  <AppSelect
                    size="md"
                    clearable
                    placeholder="All properties"
                    value={tenantPropertyFilter}
                    onChange={(v) => {
                      setTenantPropertyFilter(v ?? "any");
                      setDepositForm((prev) => ({ ...prev, tenantId: "" }));
                    }}
                    options={activePropertyOptions}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Tenant <span className="text-red-500">*</span></label>
                  <AppSelect
                    size="md"
                    searchable
                    placeholder="Select tenant"
                    value={depositForm.tenantId}
                    onChange={(v) => updateDepositTenant(v ?? "")}
                    options={tenantOptions.map((option) => ({
                      value: option.tenantId,
                      label: `${option.tenantName} - ${option.propertyName} / ${option.unitName}`,
                    }))}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Deposit Type *</label>
                  <AppSelect
                    size="md"
                    value={depositForm.depositTypeId}
                    onChange={(v) => updateDepositType(v ?? "")}
                    options={activeDepositTypes.map((type) => ({ value: type._id || type.code || type.name, label: type.name }))}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Amount *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={depositForm.amount}
                    onChange={(e) => setDepositForm((prev) => ({ ...prev, amount: e.target.value }))}
                    className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Invoice Date</label>
                  <input
                    type="date"
                    value={depositForm.invoiceDate}
                    onChange={(e) => setDepositForm((prev) => ({ ...prev, invoiceDate: e.target.value }))}
                    className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Due Date</label>
                  <input
                    type="date"
                    value={depositForm.dueDate}
                    onChange={(e) => setDepositForm((prev) => ({ ...prev, dueDate: e.target.value }))}
                    className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">{holderColumnLabel}</label>
                  <AppSelect
                    size="md"
                    value={depositForm.depositHeldBy}
                    onChange={(v) => setDepositForm((prev) => ({ ...prev, depositHeldBy: v ?? "landlord" }))}
                    options={[
                      ...(!isLandlordWorkspace ? [{ value: "manager", label: "Management Company" }] : []),
                      { value: "landlord", label: isLandlordWorkspace ? "Owner / Landlord" : "Landlord" },
                    ]}
                    disabled={isLandlordWorkspace}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Description</label>
                  <textarea
                    value={depositForm.description}
                    onChange={(e) => setDepositForm((prev) => ({ ...prev, description: e.target.value }))}
                    rows="3"
                    className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <button
                type="button"
                onClick={closeDepositModal}
                className="border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateDepositInvoice}
                disabled={saving}
                className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-black uppercase text-white hover:bg-[#0A3127] disabled:opacity-60 ${MILIK_GREEN}`}
              >
                {saving ? <FaSpinner className="animate-spin" /> : <FaMoneyBillWave />}
                {saving ? "Saving..." : "Create Deposit Invoice"}
              </button>
            </div>
          </div>
        </div>
      )}

      <CommunicationComposerModal
        open={Boolean(communicationModal)}
        onClose={() => setCommunicationModal(null)}
        businessId={currentCompany?._id || ""}
        contextType={communicationModal?.contextType || "invoice"}
        recordIds={communicationModal?.recordIds || []}
        title={communicationModal?.title || "Deposit Invoice Notification"}
        subtitle={communicationModal?.subtitle || "Preview and send deposit invoice notification."}
        allowedChannels={communicationModal?.allowedChannels || ["sms", "email"]}
        defaultChannel={communicationModal?.defaultChannel || "sms"}
      />
    </DashboardLayout>
  );
};

export default TenantDeposits;
