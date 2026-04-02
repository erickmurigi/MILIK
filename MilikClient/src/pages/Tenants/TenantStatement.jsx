import React, { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { getTenants } from "../../redux/tenantsRedux";
import { getUnits } from "../../redux/unitRedux";
import { getProperties } from "../../redux/propertyRedux";
import {
  getLeases,
  getUtilities,
  getRentPayments,
  getTenantInvoices,
  getTenantInvoiceNotes,
  createTenantInvoice,
  updateLease,
} from "../../redux/apiCalls";
import { deleteTenantInvoice } from "../../redux/invoiceApi";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import InvoiceCreationModal from "./InvoiceCreationModal";
import { toast } from "react-toastify";
import { adminRequests } from "../../utils/requestMethods";
import {
  normalizeCompanyTaxConfig,
  resolveTaxSelectionPayload,
} from "./invoiceTaxUtils";
import {
  FaArrowLeft,
  FaDownload,
  FaPrint,
  FaChartLine,
  FaFileInvoiceDollar,
  FaCalendarAlt,
  FaUser,
  FaMoneyBillWave,
  FaChartBar,
  FaCog,
  FaPlus,
  FaEdit,
  FaTrash,
  FaCheck,
  FaTimes,
  FaLink,
} from "react-icons/fa";

const MILIK_GREEN = "bg-[#165946]";

const formatPeriodLabel = (dateValue) => {
  const dt = new Date(dateValue);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
};

const safeId = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const buildPeriodKey = (year, month) => `${year}-${String(Number(month) + 1).padStart(2, "0")}`;

const formatInputDate = (value) => {
  if (!value) return "";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatDisplayDate = (value) => {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "-";
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
};

const round2 = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const buildCombinedInvoiceMetadata = ({ utilityAmount = 0, utilityLabel = "", periodLabel = "" } = {}) => ({
  billItemKey: "rent_utility:combined",
  billItemLabel: "Combined Rent + Utilities",
  invoicePriorityCategory: "rent",
  sourceTransactionType: "tenant_statement_combined",
  utilityBreakdown:
    Number(utilityAmount || 0) > 0
      ? [
          {
            label: String(utilityLabel || "Utility").trim() || "Utility",
            amount: Number(utilityAmount || 0),
            periodLabel,
          },
        ]
      : [],
});

const getInvoiceCategoryLabel = (invoice = {}) => {
  const category = String(invoice?.category || "").toUpperCase();
  if (category === "RENT_CHARGE") return "Rent Charge";
  if (category === "UTILITY_CHARGE") return "Utility Charge";
  if (category === "DEPOSIT_CHARGE") {
    return "Deposit Charge";
  }
  if (category === "LATE_PENALTY_CHARGE") return "Late Penalty Charge";
  return invoice?.category || "Charge";
};

const isActiveReceipt = (payment) => {
  const postingStatus = String(payment?.postingStatus || "").toLowerCase();
  return (
    payment?.ledgerType === "receipts" &&
    payment?.isConfirmed === true &&
    payment?.isCancelled !== true &&
    payment?.isReversed !== true &&
    !payment?.reversalOf &&
    postingStatus !== "reversed"
  );
};

const isReceiptReversed = (payment) => {
  const postingStatus = String(payment?.postingStatus || "").toLowerCase();
  return payment?.isReversed === true || Boolean(payment?.reversalOf) || postingStatus === "reversed";
};

const getReceiptAllocationRows = (payment) =>
  Array.isArray(payment?.allocations) ? payment.allocations : [];

const getReceiptAllocationLabel = (row = {}) => {
  const priority = String(row?.priorityGroup || "").toLowerCase();
  if (priority === "utility") {
    const utilityType = String(row?.utilityType || "").trim();
    return utilityType ? `Utility · ${utilityType}` : "Utility";
  }
  if (priority === "deposit") return "Deposit";
  if (priority === "late_penalty") return "Late Penalty";
  if (priority === "debit_note") return "Debit Note";
  if (priority === "rent") return "Rent";
  return row?.category || "Other";
};

const TenantStatement = () => {
  const { id: tenantId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const [activeTab, setActiveTab] = useState("statement");
  const [startDate, setStartDate] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [endDate, setEndDate] = useState(() => formatInputDate(new Date()));
  const [transactionType, setTransactionType] = useState("ALL");
  const [reviewFormOpen, setReviewFormOpen] = useState(false);
  const [allocationTraceTarget, setAllocationTraceTarget] = useState(null);
  const [editingReviewId, setEditingReviewId] = useState(null);
  const [reviewRecords, setReviewRecords] = useState(() => {
    try {
      const storageKey = `rentReviews_${tenantId}`;
      const stored = localStorage.getItem(storageKey);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      return [];
    }
  });
  const [reviewForm, setReviewForm] = useState({
    type: "percentage",
    value: 5,
    frequency: "yearly",
    effectiveDate: new Date().toISOString().split("T")[0],
    note: "",
  });
  const [selectedSchedules, setSelectedSchedules] = useState([]);
  const [showDeleteScheduleModal, setShowDeleteScheduleModal] = useState(false);
  const [showFreezeScheduleModal, setShowFreezeScheduleModal] = useState(false);
  const [showEditScheduleModal, setShowEditScheduleModal] = useState(false);
  const [localBillingScheduleAdjustments, setLocalBillingScheduleAdjustments] = useState([]);
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [savingScheduleAction, setSavingScheduleAction] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    from: "",
    to: "",
    rent: "",
    utility: "",
  });
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [invoiceRefresh, setInvoiceRefresh] = useState(0);
  const [tenantInvoices, setTenantInvoices] = useState([]);
  const [tenantInvoiceNotes, setTenantInvoiceNotes] = useState([]);
  const [scheduleDefinedPeriod, setScheduleDefinedPeriod] = useState("custom");
  const [scheduleFilterFrom, setScheduleFilterFrom] = useState("");
  const [scheduleFilterTo, setScheduleFilterTo] = useState("");
  const [scheduleSearchText, setScheduleSearchText] = useState("");
  const [companyTaxConfig, setCompanyTaxConfig] = useState(null);

  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const tenantsFromStore = useSelector((state) => state.tenant?.tenants || []);
  const leasesFromStore = useSelector((state) => state.lease?.leases || []);
  const rentPaymentsFromStore = useSelector((state) => state.rentPayment?.rentPayments || []);
  const maintenanceFromStore = useSelector((state) => state.maintenance?.maintenances || []);
  const expensesFromStore = useSelector((state) => state.expenseProperty?.expenseProperties || []);
  const utilitiesFromStore = useSelector((state) => state.utility?.utilities || []);
  const unitsFromStore = useSelector((state) => state.unit?.units || []);
  const propertiesFromStore = useSelector((state) => state.property?.properties || []);
  const normalizedTaxConfig = useMemo(
    () => normalizeCompanyTaxConfig(companyTaxConfig),
    [companyTaxConfig]
  );

  const tenant = tenantsFromStore?.find((t) => t._id === tenantId);

  const tenantUnitRecord = useMemo(() => {
    const unitId = tenant?.unit?._id || tenant?.unit || null;
    return unitsFromStore.find((unit) => String(unit?._id || "") === String(unitId || "")) || null;
  }, [tenant, unitsFromStore]);

  const tenantDepositAmount = useMemo(() => {
    return Number(tenant?.depositAmount ?? tenantUnitRecord?.deposit ?? tenant?.unit?.deposit ?? 0);
  }, [tenant, tenantUnitRecord]);

  const tenantDepositHolder = useMemo(() => {
    if (tenant?.depositHeldBy) return tenant.depositHeldBy;
    const propertyHeldBy = tenantUnitRecord?.property?.depositHeldBy;
    return propertyHeldBy === "landlord" ? "Landlord" : "Management Company";
  }, [tenant, tenantUnitRecord]);

  const activeDepositInvoices = useMemo(() => {
    return (tenantInvoices || []).filter((invoice) => {
      const invoiceTenantId = safeId(invoice?.tenant);
      const status = String(invoice?.status || "").toLowerCase();
      const category = String(invoice?.category || "").toUpperCase();
      return (
        invoiceTenantId === String(tenantId) &&
        category === "DEPOSIT_CHARGE" &&
        !["cancelled", "reversed"].includes(status)
      );
    });
  }, [tenantInvoices, tenantId]);

  const depositInvoiceSummary = activeDepositInvoices[0] || null;
  const hasActiveDepositInvoice = activeDepositInvoices.length > 0;

  const resolveTenantPropertyName = (targetTenant) => {
    if (!targetTenant) return "-";

    const directPropertyName =
      targetTenant?.unit?.property?.propertyName ||
      targetTenant?.property?.propertyName ||
      targetTenant?.propertyName;
    if (directPropertyName) return directPropertyName;

    const tenantUnitId = targetTenant?.unit?._id || targetTenant?.unit;
    const tenantUnitIdStr = tenantUnitId ? String(tenantUnitId) : "";
    const matchedUnit = unitsFromStore.find((unit) => String(unit?._id || "") === tenantUnitIdStr);
    const propertyIdFromUnit = matchedUnit?.property?._id || matchedUnit?.property;
    const propertyIdFromTenant = targetTenant?.property?._id || targetTenant?.property;
    const resolvedPropertyId = propertyIdFromUnit || propertyIdFromTenant;
    const resolvedPropertyIdStr = resolvedPropertyId ? String(resolvedPropertyId) : "";
    const matchedProperty = propertiesFromStore.find(
      (property) => String(property?._id || "") === resolvedPropertyIdStr
    );

    return (
      matchedUnit?.property?.propertyName ||
      matchedProperty?.propertyName ||
      matchedProperty?.name ||
      "-"
    );
  };

  const resolveTenantUnitNumber = (targetTenant) => {
    if (!targetTenant) return "-";
    if (targetTenant?.unit?.unitNumber) return targetTenant.unit.unitNumber;

    const tenantUnitId = targetTenant?.unit?._id || targetTenant?.unit;
    const tenantUnitIdStr = tenantUnitId ? String(tenantUnitId) : "";
    const matchedUnit = unitsFromStore.find((unit) => String(unit?._id || "") === tenantUnitIdStr);

    return matchedUnit?.unitNumber || matchedUnit?.unitName || "-";
  };

  const resolveTenantInvoiceContext = (targetTenant) => {
    if (!targetTenant?._id) {
      throw new Error("Tenant context is missing.");
    }

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

    if (!currentCompany?._id) {
      throw new Error("Business context is missing.");
    }

    if (!propertyId) {
      throw new Error("Property is missing on the selected tenant.");
    }

    if (!landlordId) {
      throw new Error("Landlord is missing on the selected property's record.");
    }

    if (!unitId) {
      throw new Error("Unit is missing on the selected tenant.");
    }

    return {
      business: currentCompany._id,
      property: propertyId,
      landlord: landlordId,
      unit: unitId,
    };
  };

  const tenantLease = useMemo(() => {
    return leasesFromStore.find((lease) => safeId(lease?.tenant) === safeId(tenantId));
  }, [leasesFromStore, tenantId]);

  useEffect(() => {
    const rows = Array.isArray(tenantLease?.billingScheduleAdjustments)
      ? tenantLease.billingScheduleAdjustments
      : [];
    setLocalBillingScheduleAdjustments(rows);
  }, [tenantLease]);

  const billingScheduleAdjustmentsByPeriod = useMemo(() => {
    return (Array.isArray(localBillingScheduleAdjustments) ? localBillingScheduleAdjustments : []).reduce((acc, item) => {
      if (item?.periodKey) {
        acc[item.periodKey] = item;
      }
      return acc;
    }, {});
  }, [localBillingScheduleAdjustments]);

  useEffect(() => {
    try {
      const storageKey = `rentReviews_${tenantId}`;
      const stored = localStorage.getItem(storageKey);
      setReviewRecords(stored ? JSON.parse(stored) : []);
    } catch (error) {
      setReviewRecords([]);
    }
  }, [tenantId]);

  useEffect(() => {
    const storageKey = `rentReviews_${tenantId}`;
    localStorage.setItem(storageKey, JSON.stringify(reviewRecords));
  }, [reviewRecords, tenantId]);

  useEffect(() => {
    document.title = "MILIK";
  }, []);

  useEffect(() => {
    if (!currentCompany?._id) {
      setCompanyTaxConfig(null);
      return;
    }

    let isMounted = true;

    const loadCompanyTaxConfig = async () => {
      try {
        const res = await adminRequests.get(`/company-settings/${currentCompany._id}`);
        if (isMounted) {
          setCompanyTaxConfig(res.data || null);
        }
      } catch (_error) {
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

    dispatch(getTenants({ business: currentCompany._id }));
    dispatch(getUnits({ business: currentCompany._id }));
    dispatch(getProperties({ business: currentCompany._id }));
    getLeases(dispatch, currentCompany._id, null, tenantId);
    getUtilities(dispatch, currentCompany._id);
    getRentPayments(dispatch, currentCompany._id, tenantId);
  }, [dispatch, currentCompany?._id, tenantId]);

  useEffect(() => {
    if (!currentCompany?._id || !tenantId) return;

    const loadInvoices = async () => {
      try {
        const [invoices, notes] = await Promise.all([
          getTenantInvoices({
            business: currentCompany._id,
            tenantId,
          }),
          getTenantInvoiceNotes({
            business: currentCompany._id,
            tenantId,
          }),
        ]);
        setTenantInvoices(Array.isArray(invoices) ? invoices : []);
        setTenantInvoiceNotes(Array.isArray(notes) ? notes : []);
      } catch (error) {
        console.error("Failed to load tenant invoices:", error);
        setTenantInvoices([]);
        setTenantInvoiceNotes([]);
      }
    };

    loadInvoices();
  }, [currentCompany?._id, tenantId, invoiceRefresh]);

  const handleCreateInvoice = async (invoiceData) => {
    try {
      await createTenantInvoice(invoiceData);
      toast.success("Invoice created successfully");
      setInvoiceRefresh((v) => v + 1);
      setShowInvoiceModal(false);
      window.dispatchEvent(new Event("invoicesUpdated"));
    } catch (err) {
      toast.error("Failed to create invoice: " + (err?.response?.data?.error || err.message));
    }
  };

  const handleCancelInvoice = async () => {
    toast.info("Invoice cancellation is not enabled in the current backend route yet.");
  };

  const getInvoicesForPeriod = (periodLabel, categories = ["RENT_CHARGE", "UTILITY_CHARGE"]) => {
    const allowedCategories = Array.isArray(categories)
      ? categories.map((category) => String(category || "").toUpperCase())
      : [];

    return tenantInvoices.filter((invoice) => {
      const invoicePeriod = formatPeriodLabel(invoice?.invoiceDate || invoice?.createdAt);
      const status = String(invoice?.status || "").toLowerCase();
      const invoiceCategory = String(invoice?.category || "").toUpperCase();

      return (
        invoicePeriod === periodLabel &&
        !["cancelled", "reversed"].includes(status) &&
        (allowedCategories.length === 0 || allowedCategories.includes(invoiceCategory))
      );
    });
  };

  const handleConfirmInvoiceCreation = async (options = {}) => {
    const normalizedOptions =
      typeof options === "string"
        ? {
            billingMode: options,
            includeDeposit: false,
            depositAmount: 0,
            taxSelection: {
              handling: "company_default",
              taxCodeKey: normalizedTaxConfig?.taxSettings?.defaultTaxCodeKey || "vat_standard",
              taxMode: "company_default",
            },
          }
        : {
            billingMode: options?.billingMode || "combined",
            includeDeposit: Boolean(options?.includeDeposit),
            depositAmount: Number(options?.depositAmount || 0),
            taxSelection: {
              handling: options?.taxSelection?.handling || "company_default",
              taxCodeKey:
                options?.taxSelection?.taxCodeKey ||
                normalizedTaxConfig?.taxSettings?.defaultTaxCodeKey ||
                "vat_standard",
              taxMode: options?.taxSelection?.taxMode || "company_default",
            },
          };

    const { billingMode, includeDeposit, depositAmount, taxSelection } = normalizedOptions;
    const taxPayload = resolveTaxSelectionPayload(taxSelection, normalizedTaxConfig);
    const selectedRows = selectedSchedules
      .map((key) => billingScheduleByKey.get(key))
      .filter(Boolean)
      .sort((a, b) => {
        const aTime = new Date(a.periodYear, a.periodMonth, 1).getTime();
        const bTime = new Date(b.periodYear, b.periodMonth, 1).getTime();
        return aTime - bTime;
      });
    const periodsWithoutInvoices = selectedRows.filter((row) => row.invoice === "-");

    try {
      if (!tenant) {
        toast.error("Tenant not found");
        return;
      }

      let invoiceContext;
      try {
        invoiceContext = resolveTenantInvoiceContext(tenant);
      } catch (contextError) {
        toast.error(contextError.message || "Tenant invoice context is incomplete.");
        return;
      }

      for (const period of periodsWithoutInvoices) {
        const periodDate = new Date(period.periodYear, period.periodMonth, 1);
        const dueDate = new Date(period.periodYear, period.periodMonth, 5);

        if (billingMode === "separate") {
          if (Number(period.rent || 0) > 0) {
            await createTenantInvoice({
              ...invoiceContext,
              tenant: tenantId,
              category: "RENT_CHARGE",
              amount: Number(period.rent || 0),
              description: `Rent charge for ${period.description}`,
              invoiceDate: periodDate,
              dueDate,
              ...taxPayload,
            });
          }

          if (Number(period.utility || 0) > 0) {
            await createTenantInvoice({
              ...invoiceContext,
              tenant: tenantId,
              category: "UTILITY_CHARGE",
              amount: Number(period.utility || 0),
              description: `Utility charge for ${period.description}`,
              invoiceDate: periodDate,
              dueDate,
              ...taxPayload,
            });
          }
        } else {
          const combinedAmount = Number(period.rent || 0) + Number(period.utility || 0);
          if (combinedAmount > 0) {
            await createTenantInvoice({
              ...invoiceContext,
              tenant: tenantId,
              category: "RENT_CHARGE",
              amount: combinedAmount,
              description:
                Number(period.utility || 0) > 0
                  ? `Combined rent + utility charge for ${period.description}`
                  : `Rent charge for ${period.description}`,
              invoiceDate: periodDate,
              dueDate,
              metadata: buildCombinedInvoiceMetadata({
                utilityAmount: Number(period.utility || 0),
                utilityLabel: Array.isArray(period.utilityNames) && period.utilityNames.length > 0
                  ? period.utilityNames.join(", ")
                  : "Utility",
                periodLabel: period.description,
              }),
              ...taxPayload,
            });
          }
        }
      }

      let createdDepositInvoice = false;

      if (includeDeposit) {
        if (depositAmount <= 0) {
          toast.error("Enter a valid deposit amount to bill.");
          return;
        }

        if (hasActiveDepositInvoice) {
          toast.error("A deposit invoice already exists for this tenant.");
          return;
        }

        const depositPeriod = periodsWithoutInvoices[0] || selectedRows[0];

        if (!depositPeriod) {
          toast.error("Select at least one billing period for deposit invoicing.");
          return;
        }

        const depositInvoiceDate = new Date(depositPeriod.periodYear, depositPeriod.periodMonth, 1);
        const depositDueDate = new Date(depositPeriod.periodYear, depositPeriod.periodMonth, 5);

        await createTenantInvoice({
          ...invoiceContext,
          tenant: tenantId,
          category: "DEPOSIT_CHARGE",
          amount: Number(depositAmount || 0),
          description: `Security deposit charge for ${depositPeriod.description}`,
          invoiceDate: depositInvoiceDate,
          dueDate: depositDueDate,
          metadata: {
            billItemKey: "deposit:security",
            billItemLabel: "Security Deposit",
            invoicePriorityCategory: "deposit",
            sourceTransactionType: "tenant_statement_deposit",
            includeInLandlordStatement: false,
            includeInCategoryTotals: false,
          },
        });

        createdDepositInvoice = true;
      }

      toast.success(
        `Created ${periodsWithoutInvoices.length} invoice period(s) in ${billingMode} mode${
          createdDepositInvoice
            ? ` and billed a tenant deposit of KES ${Number(depositAmount || 0).toLocaleString()}.`
            : ""
        }`
      );

      setSelectedSchedules([]);
      setShowInvoiceModal(false);
      setInvoiceRefresh((v) => v + 1);
      window.dispatchEvent(new Event("invoicesUpdated"));
    } catch (error) {
      toast.error("Failed to create invoices: " + (error?.response?.data?.error || error.message || "Unknown error"));
    }
  };

  const validTenantInvoices = useMemo(() => {
    return tenantInvoices
      .filter((invoice) => {
        const invoiceTenantId = safeId(invoice?.tenant);
        const status = String(invoice?.status || "").toLowerCase();
        return invoiceTenantId === String(tenantId) && !["cancelled", "reversed"].includes(status);
      })
      .sort((a, b) => new Date(a.invoiceDate || a.createdAt) - new Date(b.invoiceDate || b.createdAt));
  }, [tenantInvoices, tenantId]);

  const activeTenantReceipts = useMemo(() => {
    return rentPaymentsFromStore
      .filter((payment) => safeId(payment?.tenant) === String(tenantId) && isActiveReceipt(payment))
      .sort((a, b) => new Date(a.paymentDate || a.createdAt) - new Date(b.paymentDate || b.createdAt));
  }, [rentPaymentsFromStore, tenantId]);

  const statementData = useMemo(() => {
    const transactions = [];
    let transactionId = 1;

    validTenantInvoices.forEach((invoice) => {
      transactions.push({
        id: transactionId++,
        date: invoice.invoiceDate || invoice.createdAt,
        description: `Invoice ${invoice.invoiceNumber || ""} - ${getInvoiceCategoryLabel(invoice)}`,
        type: "CHARGE",
        amount: Number(invoice.amount || 0),
        transactionCode: invoice.invoiceNumber || `INV-${transactionId}`,
        sourceKind: "invoice",
        sourceId: safeId(invoice),
      });
    });

    tenantInvoiceNotes
      .filter((note) => {
        const status = String(note?.status || "").toLowerCase();
        return (
          String(note?.tenant?._id || note?.tenant || "") === String(tenantId) &&
          !["cancelled", "reversed"].includes(status)
        );
      })
      .sort((a, b) => new Date(a.noteDate || a.invoiceDate || a.createdAt) - new Date(b.noteDate || b.invoiceDate || b.createdAt))
      .forEach((note) => {
        const isCredit = String(note?.noteType || note?.documentType || "").toUpperCase() === "CREDIT_NOTE";
        transactions.push({
          id: transactionId++,
          date: note.noteDate || note.invoiceDate || note.createdAt,
          description: `${isCredit ? "Credit Note" : "Debit Note"} ${note.noteNumber || note.invoiceNumber || ""}${note.sourceInvoiceNumber ? ` against ${note.sourceInvoiceNumber}` : ""}`,
          type: isCredit ? "CREDIT_NOTE" : "DEBIT_NOTE",
          amount: isCredit ? -Math.abs(Number(note.amount || 0)) : Math.abs(Number(note.amount || 0)),
          transactionCode: note.noteNumber || note.invoiceNumber || `NT-${transactionId}`,
          sourceKind: "note",
          sourceId: safeId(note),
        });
      });

    activeTenantReceipts.forEach((payment) => {
      transactions.push({
        id: transactionId++,
        date: payment.paymentDate || payment.createdAt,
        description: `Receipt ${payment.receiptNumber || payment.referenceNumber || ""}`,
        type: "PAYMENT",
        amount: -(Number(payment.amount || 0)),
        transactionCode: payment.receiptNumber || payment.referenceNumber || `RCP-${transactionId}`,
        sourceKind: "receipt",
        sourceId: safeId(payment),
      });
    });

    const tenantMaintenanceCharges = maintenanceFromStore.filter(
      (m) => safeId(m?.tenant) === String(tenantId)
    );

    tenantMaintenanceCharges.forEach((maintenance) => {
      if (maintenance.actualCost || maintenance.estimatedCost) {
        transactions.push({
          id: transactionId++,
          date: maintenance.completedDate || maintenance.createdAt,
          description: `Maintenance - ${maintenance.category || "General"}`,
          type: "CHARGE",
          amount: Number(maintenance.actualCost || maintenance.estimatedCost || 0),
          transactionCode: `MNT${transactionId}`,
        });
      }
    });

    transactions.sort((a, b) => new Date(a.date) - new Date(b.date));

    let runningBalance = 0;
    transactions.forEach((t) => {
      runningBalance += t.amount;
      t.balance = runningBalance;
    });

    const totalCharges = transactions
      .filter((t) => ["CHARGE", "DEBIT_NOTE"].includes(t.type))
      .reduce((sum, t) => sum + Math.abs(Number(t.amount || 0)), 0);
    const totalPayments = transactions
      .filter((t) => ["PAYMENT", "CREDIT_NOTE"].includes(t.type))
      .reduce((sum, t) => sum + Math.abs(Number(t.amount || 0)), 0);
    const currentBalance = round2(totalCharges - totalPayments);

    return {
      transactions,
      totalCharges,
      totalPayments,
      currentBalance,
    };
  }, [validTenantInvoices, tenantInvoiceNotes, activeTenantReceipts, maintenanceFromStore, tenantId]);

  const allocationTraceData = useMemo(() => {
    const receiptRows = activeTenantReceipts.map((receipt) => {
      const allocations = getReceiptAllocationRows(receipt).map((row) => ({
        receiptId: safeId(receipt),
        receiptNumber: receipt?.receiptNumber || receipt?.referenceNumber || "-",
        receiptDate: receipt?.paymentDate || receipt?.createdAt || null,
        invoiceId: String(row?.invoice || row?.invoiceId || ""),
        invoiceNumber: row?.invoiceNumber || "-",
        label: getReceiptAllocationLabel(row),
        appliedAmount: round2(Math.abs(Number(row?.appliedAmount || 0))),
        afterOutstanding: round2(Math.abs(Number(row?.afterOutstanding || 0))),
      }));

      const allocatedAmount = round2(allocations.reduce((sum, row) => sum + Number(row?.appliedAmount || 0), 0));
      const unappliedAmount = round2(
        Math.max(
          0,
          Math.abs(
            Number(
              receipt?.allocationSummary?.unapplied ?? Math.abs(Number(receipt?.amount || 0)) - allocatedAmount
            )
          )
        )
      );

      return {
        receiptId: safeId(receipt),
        receiptNumber: receipt?.receiptNumber || receipt?.referenceNumber || "-",
        paymentDate: receipt?.paymentDate || receipt?.createdAt || null,
        paymentType: receipt?.paymentType || "rent",
        amount: round2(Math.abs(Number(receipt?.amount || 0))),
        allocatedAmount,
        unappliedAmount,
        statusLabel: receipt?.isConfirmed ? "Confirmed" : "Pending",
        allocations,
      };
    });

    const appliedByInvoice = new Map();
    receiptRows.forEach((receipt) => {
      receipt.allocations.forEach((row) => {
        if (!row.invoiceId) return;
        const current = appliedByInvoice.get(row.invoiceId) || [];
        current.push(row);
        appliedByInvoice.set(row.invoiceId, current);
      });
    });

    const invoiceRows = validTenantInvoices.map((invoice) => {
      const invoiceId = safeId(invoice);
      const receiptApplications = (appliedByInvoice.get(invoiceId) || []).sort(
        (a, b) => new Date(a.receiptDate || 0) - new Date(b.receiptDate || 0)
      );
      const appliedAmount = round2(receiptApplications.reduce((sum, row) => sum + Number(row?.appliedAmount || 0), 0));
      const outstandingAmount = round2(Math.max(0, Math.abs(Number(invoice?.balance || invoice?.amount || 0))));
      return {
        invoiceId,
        invoiceNumber: invoice?.invoiceNumber || "-",
        invoiceDate: invoice?.invoiceDate || invoice?.createdAt || null,
        categoryLabel: getInvoiceCategoryLabel(invoice),
        amount: round2(Math.abs(Number(invoice?.amount || 0))),
        appliedAmount,
        outstandingAmount,
        receiptApplications,
      };
    });

    return {
      receipts: receiptRows,
      invoices: invoiceRows,
      receiptMap: new Map(receiptRows.map((item) => [item.receiptId, item])),
      invoiceMap: new Map(invoiceRows.map((item) => [item.invoiceId, item])),
      receiptCount: receiptRows.length,
      unappliedReceipts: receiptRows.filter((item) => item.unappliedAmount > 0),
      partiallyAllocatedReceipts: receiptRows.filter((item) => item.allocatedAmount > 0 || item.unappliedAmount > 0),
    };
  }, [activeTenantReceipts, validTenantInvoices]);

  const selectedAllocationTrace = useMemo(() => {
    if (allocationTraceTarget?.kind === "receipt") {
      return allocationTraceData.receiptMap.get(String(allocationTraceTarget?.id || "")) || null;
    }
    if (allocationTraceTarget?.kind === "invoice") {
      return allocationTraceData.invoiceMap.get(String(allocationTraceTarget?.id || "")) || null;
    }
    return null;
  }, [allocationTraceTarget, allocationTraceData]);

  const openReceiptAllocationWorkspace = (receiptId = "") => {
    const query = receiptId ? `?receipt=${encodeURIComponent(receiptId)}&mode=allocate` : "";
    const receipt = receiptId
      ? activeTenantReceipts.find((item) => safeId(item) === String(receiptId)) ||
        rentPaymentsFromStore.find((item) => safeId(item) === String(receiptId)) ||
        null
      : null;
    const receiptNumber = String(receipt?.receiptNumber || receipt?.referenceNumber || "").trim();
    const tabTitle = receiptNumber ? `Allocate ${receiptNumber}` : "Receipts";

    navigate(`/receipts/${tenantId}${query}`, {
      state: { ...(location.state || {}), tabTitle },
    });
  };

  const renderAllocationTracePanel = () => {
    const receiptCount = allocationTraceData.receiptCount || 0;
    const unappliedCount = allocationTraceData.unappliedReceipts.length || 0;
    const hasSelection = Boolean(selectedAllocationTrace && allocationTraceTarget?.kind);

    return (
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr_1.4fr]">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Receipt application tracing</p>
            <h3 className="mt-1 text-sm font-bold text-slate-900">Operational settlement view</h3>
          </div>
          <div className="space-y-3 px-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Receipts in trace</p>
                <p className="mt-1 text-lg font-black text-slate-900">{receiptCount}</p>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-700">Receipts with unapplied balance</p>
                <p className="mt-1 text-lg font-black text-amber-700">{unappliedCount}</p>
              </div>
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Quick trace</p>
              <div className="mt-2 space-y-2">
                {(allocationTraceData.partiallyAllocatedReceipts.length > 0
                  ? allocationTraceData.partiallyAllocatedReceipts
                  : allocationTraceData.receipts)
                  .slice(0, 6)
                  .map((receipt) => (
                    <button
                      key={receipt.receiptId}
                      type="button"
                      onClick={() => setAllocationTraceTarget({ kind: "receipt", id: receipt.receiptId })}
                      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition ${
                        allocationTraceTarget?.kind === "receipt" && allocationTraceTarget?.id === receipt.receiptId
                          ? "border-orange-300 bg-orange-50"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <div>
                        <p className="text-xs font-bold text-slate-900">{receipt.receiptNumber}</p>
                        <p className="text-[11px] text-slate-500">
                          {receipt.paymentDate ? new Date(receipt.paymentDate).toLocaleDateString() : "-"} · {receipt.paymentType}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-black text-slate-900">Ksh {receipt.amount.toLocaleString()}</p>
                        <p className="text-[11px] text-amber-700">Unapplied {receipt.unappliedAmount.toLocaleString()}</p>
                      </div>
                    </button>
                  ))}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Trace detail</p>
              <h3 className="mt-1 text-sm font-bold text-slate-900">
                {allocationTraceTarget?.kind === "invoice"
                  ? "Invoice settlement trace"
                  : allocationTraceTarget?.kind === "receipt"
                  ? "Receipt application trace"
                  : "Choose a receipt or charge row"}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => openReceiptAllocationWorkspace(allocationTraceTarget?.kind === "receipt" ? allocationTraceTarget?.id : "")}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0B3B2E] px-3 py-2 text-xs font-bold text-white hover:bg-[#0A3127]"
            >
              <FaLink size={12} />
              {allocationTraceTarget?.kind === "receipt" ? "Manage this receipt" : "Open receipts workspace"}
            </button>
          </div>
          <div className="px-4 py-4">
            {!hasSelection && (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
                <p className="text-sm font-semibold text-slate-700">Select a receipt from the trace list or click Trace in the transaction table.</p>
                <p className="mt-2 text-xs text-slate-500">This page stays read-heavy. Allocation editing still happens safely from the Receipts page.</p>
              </div>
            )}

            {hasSelection && allocationTraceTarget?.kind === "receipt" && selectedAllocationTrace && (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Receipt</p>
                    <p className="mt-1 text-sm font-black text-slate-900">{selectedAllocationTrace.receiptNumber}</p>
                    <p className="text-[11px] text-slate-500">{selectedAllocationTrace.paymentDate ? new Date(selectedAllocationTrace.paymentDate).toLocaleDateString() : "-"}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Allocated</p>
                    <p className="mt-1 text-sm font-black text-green-700">Ksh {selectedAllocationTrace.allocatedAmount.toLocaleString()}</p>
                    <p className="text-[11px] text-slate-500">Operational application</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Unapplied</p>
                    <p className="mt-1 text-sm font-black text-amber-700">Ksh {selectedAllocationTrace.unappliedAmount.toLocaleString()}</p>
                    <p className="text-[11px] text-slate-500">Locked if receipt is already posted</p>
                  </div>
                </div>

                {selectedAllocationTrace.allocations.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">
                    No invoice allocations recorded for this receipt yet.
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-slate-200">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-100">
                        <tr>
                          <th className="px-3 py-2 text-left font-bold text-slate-700">Invoice</th>
                          <th className="px-3 py-2 text-left font-bold text-slate-700">Charge</th>
                          <th className="px-3 py-2 text-right font-bold text-slate-700">Applied</th>
                          <th className="px-3 py-2 text-right font-bold text-slate-700">Outstanding after</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedAllocationTrace.allocations.map((row) => (
                          <tr key={`${selectedAllocationTrace.receiptId}-${row.invoiceId}-${row.label}`} className="border-t border-slate-200">
                            <td className="px-3 py-2 font-semibold text-slate-900">{row.invoiceNumber}</td>
                            <td className="px-3 py-2 text-slate-600">{row.label}</td>
                            <td className="px-3 py-2 text-right font-bold text-green-700">Ksh {row.appliedAmount.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right text-slate-700">Ksh {row.afterOutstanding.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {hasSelection && allocationTraceTarget?.kind === "invoice" && selectedAllocationTrace && (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Invoice</p>
                    <p className="mt-1 text-sm font-black text-slate-900">{selectedAllocationTrace.invoiceNumber}</p>
                    <p className="text-[11px] text-slate-500">{selectedAllocationTrace.categoryLabel}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Applied by receipts</p>
                    <p className="mt-1 text-sm font-black text-green-700">Ksh {selectedAllocationTrace.appliedAmount.toLocaleString()}</p>
                    <p className="text-[11px] text-slate-500">Operational settlement to date</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Outstanding</p>
                    <p className="mt-1 text-sm font-black text-red-700">Ksh {selectedAllocationTrace.outstandingAmount.toLocaleString()}</p>
                    <p className="text-[11px] text-slate-500">Current invoice balance</p>
                  </div>
                </div>

                {selectedAllocationTrace.receiptApplications.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">
                    No receipt has been applied to this invoice yet.
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-slate-200">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-100">
                        <tr>
                          <th className="px-3 py-2 text-left font-bold text-slate-700">Receipt</th>
                          <th className="px-3 py-2 text-left font-bold text-slate-700">Date</th>
                          <th className="px-3 py-2 text-left font-bold text-slate-700">Charge</th>
                          <th className="px-3 py-2 text-right font-bold text-slate-700">Applied</th>
                          <th className="px-3 py-2 text-center font-bold text-slate-700">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedAllocationTrace.receiptApplications.map((row) => (
                          <tr key={`${selectedAllocationTrace.invoiceId}-${row.receiptId}-${row.appliedAmount}`} className="border-t border-slate-200">
                            <td className="px-3 py-2 font-semibold text-slate-900">{row.receiptNumber}</td>
                            <td className="px-3 py-2 text-slate-600">{row.receiptDate ? new Date(row.receiptDate).toLocaleDateString() : "-"}</td>
                            <td className="px-3 py-2 text-slate-600">{row.label}</td>
                            <td className="px-3 py-2 text-right font-bold text-green-700">Ksh {row.appliedAmount.toLocaleString()}</td>
                            <td className="px-3 py-2 text-center">
                              <button
                                type="button"
                                onClick={() => openReceiptAllocationWorkspace(row.receiptId)}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-100"
                              >
                                <FaLink size={10} />
                                Open receipt
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const billingScheduleData = useMemo(() => {
    const baseRent = tenantLease?.rentAmount || tenant?.rent || 23000;

    let tenantUtilities = [];
    let serviceCharge = 0;
    let tenantUtilityNames = [];

    if (tenant?.utilities && tenant.utilities.length > 0) {
      tenantUtilities = tenant.utilities;
    } else if (tenant?.unit?.utilities && tenant.unit.utilities.length > 0) {
      tenantUtilities = tenant.unit.utilities;
    } else if (unitsFromStore && unitsFromStore.length > 0) {
      const tenantUnitId = tenant?.unit?._id || tenant?.unit;
      const matchedUnit = unitsFromStore.find((u) => u?._id === tenantUnitId);
      if (matchedUnit?.utilities && matchedUnit.utilities.length > 0) {
        tenantUtilities = matchedUnit.utilities;
      }
    }

    if (tenantUtilities.length > 0) {
      tenantUtilities.forEach((util) => {
        const charge = parseFloat(util.unitCharge) || 0;
        const utilityName = util.utilityLabel || util.utility || "Unknown";
        if (!tenantUtilityNames.includes(utilityName)) {
          tenantUtilityNames.push(utilityName);
        }
        if (!util.isIncluded) {
          serviceCharge += charge;
        }
      });
    }

    const scheduleData = [];
    const tenantName =
      tenant?.firstName && tenant?.lastName
        ? `${tenant.firstName} ${tenant.lastName}`
        : tenant?.name || tenant?.tenantName || "N/A";
    const propertyName = resolveTenantPropertyName(tenant);

    let scheduleStartDate;
    let scheduleEndDate;

    if (tenantLease) {
      scheduleStartDate = new Date(tenantLease.startDate);
      const hasEndDate = tenantLease.endDate && new Date(tenantLease.endDate) > new Date();
      scheduleEndDate = hasEndDate
        ? new Date(tenantLease.endDate)
        : new Date(scheduleStartDate.getTime() + 2 * 365 * 24 * 60 * 60 * 1000);
    } else if (tenant) {
      scheduleStartDate = tenant.moveInDate ? new Date(tenant.moveInDate) : new Date();
      const hasEndDate = tenant.moveOutDate && new Date(tenant.moveOutDate) > new Date();
      scheduleEndDate = hasEndDate
        ? new Date(tenant.moveOutDate)
        : new Date(scheduleStartDate.getTime() + 2 * 365 * 24 * 60 * 60 * 1000);
    } else {
      scheduleStartDate = new Date();
      scheduleEndDate = new Date(scheduleStartDate.getTime() + 2 * 365 * 24 * 60 * 60 * 1000);
    }

    let currentDate = new Date(scheduleStartDate);
    currentDate.setDate(1);

    while (currentDate < scheduleEndDate) {
      const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
      const nextDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
      const monthName = currentDate.toLocaleDateString("en-US", {
        month: "short",
        year: "2-digit",
      });
      const periodKey = buildPeriodKey(currentDate.getFullYear(), currentDate.getMonth());
      const adjustment = billingScheduleAdjustmentsByPeriod[periodKey] || null;

      if (adjustment?.status === "deleted") {
        currentDate = nextDate;
        continue;
      }

      const periodInvoices = getInvoicesForPeriod(monthName);
      const createdInvoiceNumber = periodInvoices
        .map((item) => item.invoiceNumber)
        .filter(Boolean)
        .join(", ");
      const hasCreatedInvoice = periodInvoices.length > 0;

      const resolvedRent = Number(adjustment?.rentAmount ?? baseRent);
      const resolvedUtility = Number(adjustment?.utilityAmount ?? serviceCharge);
      const resolvedUtilityNames =
        Array.isArray(adjustment?.utilityNames) && adjustment.utilityNames.length > 0
          ? adjustment.utilityNames
          : tenantUtilityNames;
      const resolvedFromDate = adjustment?.fromDate || monthStart;
      const resolvedToDate = adjustment?.toDate || monthEnd;
      const isFrozen = adjustment?.status === "frozen";

      scheduleData.push({
        from: formatDisplayDate(resolvedFromDate),
        to: formatDisplayDate(resolvedToDate),
        fromRaw: formatInputDate(resolvedFromDate),
        toRaw: formatInputDate(resolvedToDate),
        description: monthName,
        rent: resolvedRent,
        utility: resolvedUtility,
        utilityNames: resolvedUtilityNames.length > 0 ? resolvedUtilityNames : [],
        booked: hasCreatedInvoice ? "Yes" : "No",
        frozen: isFrozen ? "Yes" : "No",
        invoice: hasCreatedInvoice ? createdInvoiceNumber : "-",
        tenantName,
        propertyName,
        periodMonth: currentDate.getMonth(),
        periodYear: currentDate.getFullYear(),
        periodKey,
      });

      currentDate = nextDate;
    }

    return scheduleData;
  }, [tenantLease, tenant, unitsFromStore, tenantInvoices, billingScheduleAdjustmentsByPeriod]);

  const billingScheduleByKey = useMemo(() => {
    return new Map((billingScheduleData || []).map((row) => [row.periodKey, row]));
  }, [billingScheduleData]);

  const depositBillingOption = useMemo(() => {
    const selectedRows = selectedSchedules
      .map((key) => billingScheduleByKey.get(key))
      .filter(Boolean)
      .sort((a, b) => {
        const aTime = new Date(a.periodYear, a.periodMonth, 1).getTime();
        const bTime = new Date(b.periodYear, b.periodMonth, 1).getTime();
        return aTime - bTime;
      });

    const selectedPeriodLabel = selectedRows[0]?.description || "";

    if (tenantDepositAmount <= 0) {
      return {
        amount: 0,
        holder: tenantDepositHolder,
        enabled: false,
        recommended: false,
        selectedPeriodLabel,
        reason: "This tenant has no deposit amount configured.",
      };
    }

    if (hasActiveDepositInvoice) {
      return {
        amount: tenantDepositAmount,
        holder: tenantDepositHolder,
        enabled: false,
        recommended: false,
        selectedPeriodLabel,
        reason: `Deposit has already been billed${depositInvoiceSummary?.invoiceNumber ? ` on invoice ${depositInvoiceSummary.invoiceNumber}` : ""}.`,
      };
    }

    if (selectedRows.length === 0) {
      return {
        amount: tenantDepositAmount,
        holder: tenantDepositHolder,
        enabled: false,
        recommended: false,
        selectedPeriodLabel,
        reason: "Select a billing period first to bill the deposit from the tenant statement.",
      };
    }

    return {
      amount: tenantDepositAmount,
      holder: tenantDepositHolder,
      enabled: true,
      recommended: selectedRows.length === 1,
      selectedPeriodLabel,
      reason: "",
    };
  }, [
    selectedSchedules,
    billingScheduleByKey,
    tenantDepositAmount,
    tenantDepositHolder,
    hasActiveDepositInvoice,
    depositInvoiceSummary,
  ]);

  const filteredBillingScheduleData = useMemo(() => {
    const normalizedSearch = String(scheduleSearchText || "").trim().toLowerCase();
    return (billingScheduleData || []).filter((row) => {
      const rowFrom = row?.fromRaw ? new Date(`${row.fromRaw}T00:00:00`) : null;
      const rowTo = row?.toRaw ? new Date(`${row.toRaw}T23:59:59`) : null;
      const fromOk = scheduleFilterFrom ? (rowTo ? rowTo >= new Date(`${scheduleFilterFrom}T00:00:00`) : false) : true;
      const toOk = scheduleFilterTo ? (rowFrom ? rowFrom <= new Date(`${scheduleFilterTo}T23:59:59`) : false) : true;
      const searchOk = !normalizedSearch
        ? true
        : [row.description, row.invoice, row.tenantName, row.propertyName, row.booked, row.frozen]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(normalizedSearch));
      return fromOk && toOk && searchOk;
    });
  }, [billingScheduleData, scheduleFilterFrom, scheduleFilterTo, scheduleSearchText]);

  const tabs = [
    { id: "statement", label: "Tenant Statement", icon: <FaFileInvoiceDollar /> },
    { id: "billing", label: "Billing Schedule", icon: <FaCalendarAlt /> },
    { id: "details", label: "Tenant Details", icon: <FaUser /> },
    { id: "charges", label: "Standing Charges", icon: <FaMoneyBillWave /> },
    { id: "reviews", label: "Rent Reviews / Escalations", icon: <FaChartBar /> },
    { id: "actions", label: "Actions", icon: <FaCog /> },
  ];

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = () => {
    window.print();
  };

  const renderStatement = () => (
    <div className="statement-tab space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-blue-50 border-l-4 border-blue-600 rounded-lg px-4 py-3 shadow-sm">
          <p className="text-[10px] font-bold text-blue-600 uppercase tracking-tight">
            Monthly Rent
          </p>
          <p className="text-xl font-bold text-blue-900 mt-1">
            Ksh {(tenantLease?.rentAmount || tenant?.rent || 0).toLocaleString()}
          </p>
        </div>

        <div className="bg-orange-50 border-l-4 border-orange-600 rounded-lg px-4 py-3 shadow-sm">
          <p className="text-[10px] font-bold text-orange-600 uppercase tracking-tight">
            Total Charges
          </p>
          <p className="text-xl font-bold text-orange-900 mt-1">
            Ksh {(statementData?.totalCharges || 0).toLocaleString()}
          </p>
        </div>

        <div
          className={`border-l-4 rounded-lg px-4 py-3 shadow-sm ${
            statementData?.currentBalance >= 0
              ? "bg-green-50 border-green-600"
              : "bg-red-50 border-red-600"
          }`}
        >
          <p
            className={`text-[10px] font-bold uppercase tracking-tight ${
              statementData?.currentBalance >= 0 ? "text-green-600" : "text-red-600"
            }`}
          >
            Current Balance
          </p>
          <p
            className={`text-xl font-bold mt-1 ${
              statementData?.currentBalance >= 0 ? "text-green-900" : "text-red-900"
            }`}
          >
            Ksh {Math.abs(statementData?.currentBalance || 0).toLocaleString()}
          </p>
        </div>
      </div>

      <div className="filter-section bg-white rounded-lg shadow-sm border border-slate-200 px-4 py-3">
        <h3 className="text-sm font-bold text-slate-900 mb-2">Filter Period</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Transaction Type
            </label>
            <select
              value={transactionType}
              onChange={(e) => setTransactionType(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              <option value="ALL">All Transactions</option>
              <option value="CHARGE">Invoices Only</option>
              <option value="DEBIT_NOTE">Debit Notes</option>
              <option value="CREDIT_NOTE">Credit Notes</option>
              <option value="PAYMENT">Receipts Only</option>
            </select>
          </div>
        </div>
      </div>

      <div
        className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden flex flex-col"
        style={{ height: "500px" }}
      >
        <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex-shrink-0">
          <h3 className="text-sm font-bold text-slate-900">
            <FaChartLine className="inline mr-2" />
            Account Transactions
          </h3>
        </div>

        <div className="overflow-y-auto flex-grow">
          <table className="w-full text-xs">
            <thead className="sticky top-0">
              <tr className={`${MILIK_GREEN} text-white text-[11px] font-bold`}>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Description</th>
                <th className="px-3 py-2 text-center">Type</th>
                <th className="px-3 py-2 text-left">Code</th>
                <th className="px-3 py-2 text-center">Trace</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-right">R. Balance</th>
              </tr>
            </thead>
            <tbody>
              {statementData?.transactions && statementData.transactions.length > 0 ? (
                statementData.transactions
                  .filter((t) => transactionType === "ALL" || t.type === transactionType)
                  .filter((t) => {
                    const txDate = new Date(t.date);
                    const fromOk = startDate ? txDate >= new Date(`${startDate}T00:00:00`) : true;
                    const toOk = endDate ? txDate <= new Date(`${endDate}T23:59:59`) : true;
                    return fromOk && toOk;
                  })
                  .map((transaction, idx) => (
                    <tr
                      key={transaction.id}
                      className={`border-b border-slate-200 ${
                        idx % 2 === 0 ? "bg-white" : "bg-slate-50"
                      } hover:bg-blue-50 transition-colors`}
                    >
                      <td className="px-3 py-1.5 text-[11px] font-semibold text-gray-900 whitespace-nowrap">
                        {new Date(transaction.date).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-1.5 text-[11px] text-gray-700">
                        {transaction.description}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                            ["CHARGE", "DEBIT_NOTE"].includes(transaction.type)
                              ? "bg-red-100 text-red-700"
                              : "bg-green-100 text-green-700"
                          }`}
                        >
                          {transaction.type}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-[11px] font-semibold text-slate-900 whitespace-nowrap">
                        {transaction.transactionCode}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        {["invoice", "receipt"].includes(String(transaction.sourceKind || "")) ? (
                          <button
                            type="button"
                            onClick={() =>
                              setAllocationTraceTarget({
                                kind: transaction.sourceKind === "invoice" ? "invoice" : "receipt",
                                id: transaction.sourceId,
                              })
                            }
                            className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-[10px] font-bold text-slate-700 hover:border-slate-400 hover:bg-slate-100"
                          >
                            <FaLink size={10} />
                            Trace
                          </button>
                        ) : (
                          <span className="text-[10px] text-slate-300">—</span>
                        )}
                      </td>
                      <td
                        className={`px-3 py-1.5 text-[11px] font-bold text-right whitespace-nowrap ${
                          ["CHARGE", "DEBIT_NOTE"].includes(transaction.type)
                            ? "text-red-600"
                            : "text-green-600"
                        }`}
                      >
                        {["CHARGE", "DEBIT_NOTE"].includes(transaction.type) ? "+" : "-"}Ksh{" "}
                        {Math.abs(transaction.amount).toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5 text-[11px] font-bold text-right text-gray-900 whitespace-nowrap">
                        Ksh {transaction.balance.toLocaleString()}
                      </td>
                    </tr>
                  ))
              ) : (
                <tr>
                  <td colSpan="7" className="px-3 py-6 text-center text-xs text-gray-600">
                    No transactions found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {statementData?.transactions && statementData.transactions.length > 0 && (
          <div className="px-4 py-2 bg-slate-100 border-t border-slate-200 flex-shrink-0">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <p className="text-[10px] font-bold text-gray-600">Total Charges</p>
                <p className="text-base font-bold text-red-600 mt-0.5">
                  Ksh {(statementData.totalCharges || 0).toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-600">Total Payments</p>
                <p className="text-base font-bold text-green-600 mt-0.5">
                  Ksh {(statementData.totalPayments || 0).toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-600">Net Balance</p>
                <p
                  className={`text-base font-bold mt-0.5 ${
                    statementData?.currentBalance >= 0 ? "text-green-600" : "text-red-600"
                  }`}
                >
                  Ksh {Math.abs(statementData?.currentBalance || 0).toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="print-footer" style={{ display: "none" }}>
          <p style={{ marginBottom: "5px" }}>
            Generated on{" "}
            {new Date().toLocaleDateString("en-GB", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}{" "}
            at{" "}
            {new Date().toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              fontSize: "10px",
              color: "#9CA3AF",
            }}
          >
            <span>Powered by</span>
            <img
              src="/logo.png"
              alt="MILIK Logo"
              style={{
                width: "20px",
                height: "20px",
                display: "inline-block",
                verticalAlign: "middle",
              }}
            />
            <span>MILIK - Property Management System</span>
          </div>
        </div>
      </div>

      {renderAllocationTracePanel()}
    </div>
  );

  const renderBillingSchedule = () => {
    const handleSelectSchedule = (scheduleKey) => {
      setSelectedSchedules((prev) =>
        prev.includes(scheduleKey) ? prev.filter((k) => k !== scheduleKey) : [...prev, scheduleKey]
      );
    };

    const handleSelectAll = () => {
      if (selectedSchedules.length === filteredBillingScheduleData.length && filteredBillingScheduleData.length > 0) {
        setSelectedSchedules([]);
      } else {
        setSelectedSchedules(filteredBillingScheduleData.map((row) => row.periodKey));
      }
    };

    const persistScheduleAdjustments = async (updater, successMessage) => {
      if (!safeId(tenantLease?._id)) {
        toast.error("Active lease not found for this tenant.");
        return false;
      }

      const currentAdjustments = Array.isArray(localBillingScheduleAdjustments)
        ? localBillingScheduleAdjustments
        : [];

      try {
        setSavingScheduleAction(true);
        const nextAdjustments = updater([...currentAdjustments]);
        setLocalBillingScheduleAdjustments(nextAdjustments);

        await updateLease(dispatch, tenantLease._id, {
          billingScheduleAdjustments: nextAdjustments,
        });

        if (currentCompany?._id) {
          await getLeases(dispatch, currentCompany._id, null, tenantId);
        }
        toast.success(successMessage);
        return true;
      } catch (error) {
        setLocalBillingScheduleAdjustments(currentAdjustments);
        toast.error(error?.response?.data?.message || error?.message || "Schedule action failed");
        return false;
      } finally {
        setSavingScheduleAction(false);
      }
    };

    const handleCreateInvoices = () => {
      if (selectedSchedules.length === 0) {
        toast.warning("Please select at least one billing period");
        return;
      }

      const selectedRows = selectedSchedules.map((key) => billingScheduleByKey.get(key)).filter(Boolean);
      const frozenRows = selectedRows.filter((row) => row.frozen === "Yes");
      const periodsWithInvoices = selectedRows.filter((row) => row.invoice !== "-");
      const periodsWithoutInvoices = selectedRows.filter((row) => row.invoice === "-" && row.frozen !== "Yes");

      if (frozenRows.length > 0) {
        toast.warning(`Frozen schedule(s) cannot be invoiced: ${frozenRows.map((p) => p.description).join(", ")}`);
        return;
      }

      if (periodsWithInvoices.length > 0) {
        toast.warning(
          `${periodsWithInvoices.length} period(s) already have invoices: ${periodsWithInvoices
            .map((p) => p.description)
            .join(", ")}`
        );
        return;
      }

      if (periodsWithoutInvoices.length === 0) {
        toast.warning("No valid periods selected for invoicing");
        return;
      }

      setShowInvoiceModal(true);
    };

    const handleCancelInvoices = async () => {
      if (selectedSchedules.length === 0) {
        toast.warning("Please select at least one billing period");
        return;
      }

      const selectedRows = selectedSchedules.map((key) => billingScheduleByKey.get(key)).filter(Boolean);
      const invoicedPeriods = selectedRows.filter((row) => row.invoice !== "-");

      if (invoicedPeriods.length === 0) {
        toast.warning("No invoiced periods selected");
        return;
      }

      const matchingInvoices = tenantInvoices.filter((invoice) => {
        const invoicePeriod = formatPeriodLabel(invoice?.invoiceDate || invoice?.createdAt);
        const category = String(invoice?.category || "").toUpperCase();
        return (
          ["RENT_CHARGE", "UTILITY_CHARGE"].includes(category) &&
          invoicedPeriods.some((row) => row.description === invoicePeriod)
        );
      });

      if (matchingInvoices.length === 0) {
        toast.warning("No matching invoices were found to cancel.");
        return;
      }

      const nonDeletable = matchingInvoices.filter((invoice) =>
        ["paid", "partially_paid"].includes(String(invoice?.status || "").toLowerCase())
      );

      if (nonDeletable.length > 0) {
        toast.warning("Paid or partially paid invoices cannot be cancelled from this screen.");
        return;
      }

      try {
        setSavingScheduleAction(true);
        for (const invoice of matchingInvoices) {
          await deleteTenantInvoice(invoice._id);
        }
        toast.success("Selected invoice booking(s) cancelled successfully.");
        setSelectedSchedules([]);
        setInvoiceRefresh((v) => v + 1);
        window.dispatchEvent(new Event("invoicesUpdated"));
      } catch (error) {
        toast.error(error?.response?.data?.error || error?.message || "Failed to cancel selected invoice bookings");
      } finally {
        setSavingScheduleAction(false);
      }
    };

    const handleEditSchedules = () => {
      if (selectedSchedules.length === 0) {
        toast.warning("Please select at least one billing period");
        return;
      }

      if (selectedSchedules.length > 1) {
        toast.warning("Edit works one billing period at a time. Please select one row.");
        return;
      }

      const row = billingScheduleByKey.get(selectedSchedules[0]);
      if (!row) return;

      setEditingSchedule(selectedSchedules[0]);
      setScheduleForm({
        from: row.fromRaw || "",
        to: row.toRaw || "",
        rent: String(row.rent ?? ""),
        utility: String(row.utility ?? ""),
      });
      setShowEditScheduleModal(true);
    };

    const handleDeleteSchedules = () => {
      if (selectedSchedules.length === 0) {
        toast.warning("Please select at least one billing period");
        return;
      }

      setShowDeleteScheduleModal(true);
    };

    const handleFreezeSchedules = () => {
      if (selectedSchedules.length === 0) {
        toast.warning("Please select at least one billing period");
        return;
      }

      setShowFreezeScheduleModal(true);
    };

    return (
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
          <h3 className="text-sm font-bold text-slate-900">Rent & Other Charges Schedule</h3>
        </div>

        <div className="px-4 py-3 border-b border-slate-200 bg-emerald-50/60">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-white border border-emerald-200 rounded-lg px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-tight text-emerald-700">Deposit Amount</p>
              <p className="text-sm font-bold text-slate-900 mt-1">KES {tenantDepositAmount.toLocaleString()}</p>
            </div>
            <div className="bg-white border border-emerald-200 rounded-lg px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-tight text-emerald-700">Deposit Holder</p>
              <p className="text-sm font-bold text-slate-900 mt-1">{tenantDepositHolder}</p>
              <p className="text-[10px] text-slate-500 mt-1">Receipt mode now controls posting and clearing, not this holder label.</p>
            </div>
            <div className="bg-white border border-emerald-200 rounded-lg px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-tight text-emerald-700">Deposit Billing Status</p>
              <p className="text-sm font-bold text-slate-900 mt-1">
                {hasActiveDepositInvoice
                  ? `Already billed${depositInvoiceSummary?.invoiceNumber ? ` (${depositInvoiceSummary.invoiceNumber})` : ""}`
                  : "Not yet billed"}
              </p>
            </div>
          </div>
        </div>

        <div className="px-4 py-2 border-b border-slate-200 bg-white">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
            <div className="md:col-span-2">
              <label className="block text-[10px] text-slate-600 font-semibold mb-1">Defined Period</label>
              <select
                value={scheduleDefinedPeriod}
                onChange={(e) => {
                  const value = e.target.value;
                  setScheduleDefinedPeriod(value);
                  const today = new Date();
                  if (value === "this_year") {
                    setScheduleFilterFrom(`${today.getFullYear()}-01-01`);
                    setScheduleFilterTo(`${today.getFullYear()}-12-31`);
                  } else if (value === "next_12_months") {
                    const from = new Date(today.getFullYear(), today.getMonth(), 1);
                    const to = new Date(today.getFullYear(), today.getMonth() + 12, 0);
                    setScheduleFilterFrom(formatInputDate(from));
                    setScheduleFilterTo(formatInputDate(to));
                  }
                }}
                className="w-full text-xs border border-slate-300 rounded px-2 py-1.5"
              >
                <option value="custom">Custom</option>
                <option value="this_year">This Year</option>
                <option value="next_12_months">Next 12 Months</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-[10px] text-slate-600 font-semibold mb-1">From</label>
              <input
                type="date"
                value={scheduleFilterFrom}
                onChange={(e) => {
                  setScheduleDefinedPeriod("custom");
                  setScheduleFilterFrom(e.target.value);
                }}
                className="w-full text-xs border border-slate-300 rounded px-2 py-1.5"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-[10px] text-slate-600 font-semibold mb-1">To</label>
              <input
                type="date"
                value={scheduleFilterTo}
                onChange={(e) => {
                  setScheduleDefinedPeriod("custom");
                  setScheduleFilterTo(e.target.value);
                }}
                className="w-full text-xs border border-slate-300 rounded px-2 py-1.5"
              />
            </div>
            <div className="md:col-span-3">
              <label className="block text-[10px] text-slate-600 font-semibold mb-1">Search</label>
              <input
                type="text"
                value={scheduleSearchText}
                onChange={(e) => setScheduleSearchText(e.target.value)}
                placeholder="Month, invoice no., status..."
                className="w-full text-xs border border-slate-300 rounded px-2 py-1.5"
              />
            </div>
            <div className="md:col-span-3 flex gap-2 md:justify-end">
              <button
                onClick={() => setSelectedSchedules([])}
                className={`${MILIK_GREEN} text-white text-xs font-semibold px-3 py-1.5 rounded`}
              >
                Search
              </button>
              <button
                onClick={() => {
                  setScheduleDefinedPeriod("custom");
                  setScheduleFilterFrom("");
                  setScheduleFilterTo("");
                  setScheduleSearchText("");
                  setSelectedSchedules([]);
                }}
                className="bg-slate-100 text-slate-700 text-xs font-semibold px-3 py-1.5 rounded border border-slate-300"
              >
                Reset
              </button>
              <button
                onClick={async () => {
                  if (currentCompany?._id) {
                    await Promise.all([
                      getLeases(dispatch, currentCompany._id, null, tenantId),
                      getTenantInvoices(dispatch, currentCompany._id, tenantId),
                    ]);
                    setInvoiceRefresh((v) => v + 1);
                    setSelectedSchedules([]);
                    toast.success("Billing schedule refreshed.");
                  }
                }}
                className="bg-slate-100 text-slate-700 text-xs font-semibold px-3 py-1.5 rounded border border-slate-300"
              >
                Refresh
              </button>
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-b border-slate-200 bg-gray-50">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleCreateInvoices}
              disabled={selectedSchedules.length === 0 || savingScheduleAction}
              className={`flex items-center gap-1 px-3 py-2 rounded text-xs font-semibold transition-colors ${
                selectedSchedules.length === 0
                  ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                  : "bg-blue-600 hover:bg-blue-700 text-white"
              }`}
            >
              <FaFileInvoiceDollar size={12} />
              Create Invoice
            </button>
            <button
              type="button"
              onClick={handleCancelInvoices}
              disabled={selectedSchedules.length === 0 || savingScheduleAction}
              className={`flex items-center gap-1 px-3 py-2 rounded text-xs font-semibold transition-colors ${
                selectedSchedules.length === 0
                  ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                  : "bg-red-600 hover:bg-red-700 text-white"
              }`}
            >
              <FaPrint size={12} />
              Cancel Invoice
            </button>
            <button
              type="button"
              onClick={handleEditSchedules}
              disabled={selectedSchedules.length === 0 || savingScheduleAction}
              className={`flex items-center gap-1 px-3 py-2 rounded text-xs font-semibold transition-colors ${
                selectedSchedules.length === 0
                  ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                  : "bg-orange-600 hover:bg-orange-700 text-white"
              }`}
            >
              <FaCog size={12} />
              Edit Schedule
            </button>
            <button
              type="button"
              onClick={handleDeleteSchedules}
              disabled={selectedSchedules.length === 0 || savingScheduleAction}
              className={`flex items-center gap-1 px-3 py-2 rounded text-xs font-semibold transition-colors ${
                selectedSchedules.length === 0
                  ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                  : "bg-gray-600 hover:bg-gray-700 text-white"
              }`}
            >
              <FaTrash size={12} />
              Delete Schedule
            </button>
            <button
              type="button"
              onClick={handleFreezeSchedules}
              disabled={selectedSchedules.length === 0 || savingScheduleAction}
              className={`flex items-center gap-1 px-3 py-2 rounded text-xs font-semibold transition-colors ${
                selectedSchedules.length === 0
                  ? "bg-blue-200 text-blue-400 cursor-not-allowed"
                  : "bg-blue-600 hover:bg-blue-700 text-white"
              }`}
            >
              <FaCheck size={12} />
              {selectedSchedules.length > 0 && selectedSchedules.every((key) => billingScheduleByKey.get(key)?.frozen === "Yes")
                ? "Activate Schedule"
                : "Freeze Schedule"}
            </button>

            {showFreezeScheduleModal && selectedSchedules.length > 0 && (
              <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-md">
                  <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="font-bold text-slate-900 flex items-center gap-2">
                      <FaCheck className="text-blue-600" />
                      {selectedSchedules.every((key) => billingScheduleByKey.get(key)?.frozen === "Yes")
                        ? "Confirm Schedule Activation"
                        : "Confirm Schedule Freeze"}
                    </h3>
                    <button
                      type="button"
                      onClick={() => setShowFreezeScheduleModal(false)}
                      className="text-slate-500 hover:text-slate-700"
                    >
                      <FaTimes />
                    </button>
                  </div>
                  <div className="p-4">
                    <p className="text-sm text-slate-700 mb-4">
                      {selectedSchedules.every((key) => billingScheduleByKey.get(key)?.frozen === "Yes")
                        ? "Are you sure you want to activate the selected frozen schedule(s)?"
                        : "Are you sure you want to freeze the selected schedule(s)?"}
                    </p>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setShowFreezeScheduleModal(false)}
                        className="px-4 py-2 text-xs border border-slate-300 rounded-md font-semibold hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const selectedRows = selectedSchedules.map((key) => billingScheduleByKey.get(key)).filter(Boolean);
                          const bookedRows = selectedRows.filter((row) => row.booked === "Yes");
                          const rowsToChange = selectedRows.filter((row) => row.booked !== "Yes");
                          const activating = rowsToChange.length > 0 && rowsToChange.every((row) => row.frozen === "Yes");

                          if (rowsToChange.length === 0) {
                            toast.warning(activating ? "Booked schedule rows cannot be activated." : "Booked schedule rows cannot be frozen.");
                            return;
                          }

                          const ok = await persistScheduleAdjustments((currentAdjustments) => {
                            const byKey = new Map(currentAdjustments.map((item) => [item.periodKey, { ...item }]));
                            rowsToChange.forEach((row) => {
                              const existing = byKey.get(row.periodKey) || { periodKey: row.periodKey };
                              byKey.set(row.periodKey, {
                                ...existing,
                                fromDate: row.fromRaw,
                                toDate: row.toRaw,
                                rentAmount: Number(row.rent || 0),
                                utilityAmount: Number(row.utility || 0),
                                utilityNames: row.utilityNames || [],
                                status: activating ? "active" : "frozen",
                                updatedAt: new Date().toISOString(),
                              });
                            });
                            return Array.from(byKey.values());
                          }, activating
                            ? (bookedRows.length > 0 ? "Unbooked frozen schedule(s) activated. Booked rows were skipped." : "Schedule(s) activated successfully.")
                            : (bookedRows.length > 0 ? "Unbooked schedule(s) frozen. Booked rows were skipped." : "Schedule(s) frozen successfully."));

                          if (ok) {
                            setShowFreezeScheduleModal(false);
                            setSelectedSchedules([]);
                          }
                        }}
                        className="px-4 py-2 text-xs rounded-md text-white font-semibold bg-blue-600 hover:bg-blue-700"
                      >
                        Confirm
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {showDeleteScheduleModal && selectedSchedules.length > 0 && (
              <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-md">
                  <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="font-bold text-slate-900 flex items-center gap-2">
                      <FaTrash className="text-red-600" />
                      Confirm Schedule Deletion
                    </h3>
                    <button
                      type="button"
                      onClick={() => setShowDeleteScheduleModal(false)}
                      className="text-slate-500 hover:text-slate-700"
                    >
                      <FaTimes />
                    </button>
                  </div>
                  <div className="p-4">
                    <p className="text-sm text-slate-700 mb-4">
                      Are you sure you want to delete the selected schedule(s)? This action cannot be undone.
                    </p>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setShowDeleteScheduleModal(false)}
                        className="px-4 py-2 text-xs border border-slate-300 rounded-md font-semibold hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={async () => {
                          const selectedRows = selectedSchedules.map((key) => billingScheduleByKey.get(key)).filter(Boolean);
                          const bookedRows = selectedRows.filter((row) => row.booked === "Yes");
                          const rowsToDelete = selectedRows.filter((row) => row.booked !== "Yes");

                          if (rowsToDelete.length === 0) {
                            toast.warning("Booked schedule rows cannot be deleted.");
                            return;
                          }

                          const ok = await persistScheduleAdjustments((currentAdjustments) => {
                            const byKey = new Map(currentAdjustments.map((item) => [item.periodKey, { ...item }]));
                            rowsToDelete.forEach((row) => {
                              const existing = byKey.get(row.periodKey) || { periodKey: row.periodKey };
                              byKey.set(row.periodKey, {
                                ...existing,
                                status: "deleted",
                                updatedAt: new Date().toISOString(),
                              });
                            });
                            return Array.from(byKey.values());
                          }, bookedRows.length > 0 ? "Unbooked schedule(s) deleted. Booked rows were skipped." : "Schedule(s) deleted successfully.");

                          if (ok) {
                            setShowDeleteScheduleModal(false);
                            setSelectedSchedules([]);
                          }
                        }}
                        className="px-4 py-2 text-xs rounded-md text-white font-semibold bg-red-600 hover:bg-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {showEditScheduleModal && editingSchedule !== null && (
              <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-md">
                  <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="font-bold text-slate-900 flex items-center gap-2">
                      <FaCog className="text-green-600" />
                      Edit Schedule
                    </h3>
                    <button
                      type="button"
                      onClick={() => setShowEditScheduleModal(false)}
                      className="text-slate-500 hover:text-slate-700"
                    >
                      <FaTimes />
                    </button>
                  </div>
                  <div className="p-4 space-y-3">
                    <label className="text-xs font-semibold text-slate-700">From Date</label>
                    <input
                      type="date"
                      value={scheduleForm.from}
                      onChange={(e) => setScheduleForm((prev) => ({ ...prev, from: e.target.value }))}
                      className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-md text-sm"
                    />
                    <label className="text-xs font-semibold text-slate-700">To Date</label>
                    <input
                      type="date"
                      value={scheduleForm.to}
                      onChange={(e) => setScheduleForm((prev) => ({ ...prev, to: e.target.value }))}
                      className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-md text-sm"
                    />
                    <label className="text-xs font-semibold text-slate-700">Rent</label>
                    <input
                      type="number"
                      value={scheduleForm.rent}
                      onChange={(e) => setScheduleForm((prev) => ({ ...prev, rent: e.target.value }))}
                      className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-md text-sm"
                    />
                    <label className="text-xs font-semibold text-slate-700">Utility</label>
                    <input
                      type="number"
                      value={scheduleForm.utility}
                      onChange={(e) => setScheduleForm((prev) => ({ ...prev, utility: e.target.value }))}
                      className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-md text-sm"
                    />
                  </div>
                  <div className="px-4 py-3 border-t border-slate-200 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowEditScheduleModal(false)}
                      className="px-4 py-2 text-xs border border-slate-300 rounded-md font-semibold hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        const row = billingScheduleByKey.get(editingSchedule);
                        if (!row) {
                          setShowEditScheduleModal(false);
                          return;
                        }

                        if (row.booked === "Yes") {
                          toast.warning("Booked schedule rows cannot be edited from this screen.");
                          return;
                        }

                        const ok = await persistScheduleAdjustments((currentAdjustments) => {
                          const byKey = new Map(currentAdjustments.map((item) => [item.periodKey, { ...item }]));
                          const existing = byKey.get(row.periodKey) || { periodKey: row.periodKey };
                          byKey.set(row.periodKey, {
                            ...existing,
                            fromDate: scheduleForm.from || row.fromRaw,
                            toDate: scheduleForm.to || row.toRaw,
                            rentAmount: scheduleForm.rent === "" ? Number(row.rent || 0) : Number(scheduleForm.rent),
                            utilityAmount: scheduleForm.utility === "" ? Number(row.utility || 0) : Number(scheduleForm.utility),
                            utilityNames: row.utilityNames || [],
                            status: existing.status === "deleted" ? "active" : existing.status || "active",
                            updatedAt: new Date().toISOString(),
                          });
                          return Array.from(byKey.values());
                        }, "Schedule updated successfully.");

                        if (ok) {
                          setShowEditScheduleModal(false);
                          setEditingSchedule(null);
                          setSelectedSchedules([]);
                        }
                      }}
                      className={`px-4 py-2 text-xs rounded-md text-white font-semibold ${MILIK_GREEN} hover:bg-[#0A3127]`}
                    >
                      Save Changes
                    </button>
                  </div>
                </div>
              </div>
            )}

            {selectedSchedules.length > 0 && (
              <span className="ml-auto flex items-center text-xs text-gray-600 font-semibold">
                {selectedSchedules.length} selected
              </span>
            )}
          </div>
        </div>

        <div className="overflow-auto">
          <table className="w-full min-w-[1200px] text-xs">
            <thead>
              <tr className={`${MILIK_GREEN} text-white`}>
                <th className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={
                      selectedSchedules.length === filteredBillingScheduleData.length && filteredBillingScheduleData.length > 0
                    }
                    onChange={handleSelectAll}
                    className="cursor-pointer"
                  />
                </th>
                <th className="px-3 py-2 text-left font-semibold">From</th>
                <th className="px-3 py-2 text-left font-semibold">To</th>
                <th className="px-3 py-2 text-left font-semibold">Description</th>
                <th className="px-3 py-2 text-right font-semibold">Rent Amount</th>
                <th className="px-3 py-2 text-right font-semibold">S. Charge/Util.</th>
                <th className="px-3 py-2 text-right font-semibold">Total</th>
                <th className="px-3 py-2 text-center font-semibold">Frozen</th>
                <th className="px-3 py-2 text-center font-semibold">Booked</th>
                <th className="px-3 py-2 text-left font-semibold">Invoice #</th>
              </tr>
            </thead>
            <tbody>
              {filteredBillingScheduleData.map((row, index) => {
                const total = row.rent + row.utility;
                const isSelected = selectedSchedules.includes(row.periodKey);

                return (
                  <tr
                    key={`${row.from}-${row.description}`}
                    className={`${
                      isSelected ? "bg-blue-50" : index % 2 === 0 ? "bg-white" : "bg-slate-50"
                    } border-b border-slate-200 hover:bg-emerald-50/40 cursor-pointer`}
                    onClick={() => handleSelectSchedule(row.periodKey)}
                  >
                    <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleSelectSchedule(row.periodKey)}
                        className="cursor-pointer"
                      />
                    </td>
                    <td className="px-3 py-2 text-slate-800">{row.from}</td>
                    <td className="px-3 py-2 text-slate-800">{row.to}</td>
                    <td className="px-3 py-2 font-medium text-slate-900">{row.description}</td>
                    <td className="px-3 py-2 text-right text-slate-900">{row.rent.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right text-slate-900">
                      <div>
                        <div className="font-bold">{row.utility ? row.utility.toLocaleString() : "-"}</div>
                        {row.utilityNames && row.utilityNames.length > 0 && (
                          <div className="text-[9px] text-slate-500 font-medium mt-0.5">
                            {row.utilityNames.join(", ")}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-900">
                      {total.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded text-[10px] font-semibold ${
                          row.frozen === "Yes"
                            ? "bg-purple-100 text-purple-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {row.frozen}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded text-[10px] font-semibold ${
                          row.booked === "Yes"
                            ? "bg-green-100 text-green-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {row.booked}
                      </span>
                    </td>
                    <td
                      className={`px-3 py-2 ${
                        row.booked === "Yes" ? "text-emerald-700 font-semibold" : "text-slate-500"
                      }`}
                    >
                      {row.invoice}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderTenantDetails = () => (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <h3 className="text-lg font-bold text-gray-900 mb-6">Tenant Information</h3>
      {tenant ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="border-b md:border-b-0 pb-4 md:pb-0">
            <label className="block text-sm font-semibold text-gray-600 mb-2">Tenant Name</label>
            <p className="text-lg font-bold text-gray-900">
              {tenant?.name || (tenant?.firstName && tenant?.lastName ? `${tenant.firstName} ${tenant.lastName}` : "N/A")}
            </p>
          </div>
          <div className="border-b md:border-b-0 pb-4 md:pb-0">
            <label className="block text-sm font-semibold text-gray-600 mb-2">Email</label>
            <p className="text-lg font-bold text-gray-900">{tenant?.email || "N/A"}</p>
          </div>
          <div className="border-b md:border-b-0 pb-4 md:pb-0">
            <label className="block text-sm font-semibold text-gray-600 mb-2">Phone</label>
            <p className="text-lg font-bold text-gray-900">{tenant?.phone || "N/A"}</p>
          </div>
          <div className="border-b md:border-b-0 pb-4 md:pb-0">
            <label className="block text-sm font-semibold text-gray-600 mb-2">ID Number</label>
            <p className="text-lg font-bold text-gray-900">{tenant?.idDocument || tenant?.idNumber || "N/A"}</p>
          </div>
          <div className="border-b md:border-b-0 pb-4 md:pb-0">
            <label className="block text-sm font-semibold text-gray-600 mb-2">Unit</label>
            <p className="text-lg font-bold text-gray-900">{resolveTenantUnitNumber(tenant)}</p>
          </div>
          <div className="border-b md:border-b-0 pb-4 md:pb-0">
            <label className="block text-sm font-semibold text-gray-600 mb-2">Property</label>
            <p className="text-lg font-bold text-gray-900">{resolveTenantPropertyName(tenant)}</p>
          </div>
          <div className="border-b md:border-b-0 pb-4 md:pb-0">
            <label className="block text-sm font-semibold text-gray-600 mb-2">Move-In Date</label>
            <p className="text-lg font-bold text-gray-900">
              {tenantLease?.startDate
                ? new Date(tenantLease.startDate).toLocaleDateString()
                : tenant?.moveInDate
                ? new Date(tenant.moveInDate).toLocaleDateString()
                : "N/A"}
            </p>
          </div>
          <div className="border-b md:border-b-0 pb-4 md:pb-0">
            <label className="block text-sm font-semibold text-gray-600 mb-2">Rent Amount</label>
            <p className="text-lg font-bold text-gray-900">
              Ksh {(tenantLease?.rentAmount || tenant?.rent || 0).toLocaleString()}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-gray-600">Tenant not found</p>
      )}
    </div>
  );

  const renderStandingCharges = () => {
    let tenantUtilities = tenant?.utilities || [];

    if (tenantUtilities.length === 0 && tenant?.unit?.utilities && tenant.unit.utilities.length > 0) {
      tenantUtilities = tenant.unit.utilities;
    }

    const totalStandingCharges = tenantUtilities.reduce(
      (sum, util) => sum + (parseFloat(util.unitCharge) || 0),
      0
    );

    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4">Standing Charges</h3>
        <p className="text-gray-600 mb-6">Recurring charges attached to this tenancy</p>

        {tenantUtilities.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-600">No standing charges for this tenant.</p>
            <p className="text-sm text-gray-500 mt-2">Utilities will appear here when added to the tenant record.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {tenantUtilities.map((utility, idx) => (
              <div key={idx} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-semibold text-gray-900">{utility.utilityLabel || utility.utility}</h4>
                    <p className="text-sm text-gray-600 mt-1">Monthly charge for this tenant</p>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-gray-900">
                      Ksh {(parseFloat(utility.unitCharge) || 0).toLocaleString()}
                    </div>
                    <div className="text-xs text-gray-600 font-medium mt-1">
                      {utility.isIncluded ? (
                        <span className="text-green-600">✓ Included in Rent</span>
                      ) : (
                        <span className="text-orange-600">Tenant Pays</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}

            <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">
                <span className="font-bold">Total Monthly Standing Charges:</span>
                <span className="float-right font-bold">Ksh {totalStandingCharges.toLocaleString()}</span>
              </p>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderRentReviewsAndEscalations = () => {
    const baseRent = tenantLease?.rentAmount || tenant?.rent || 0;
    const sortedRecords = [...reviewRecords].sort(
      (a, b) => new Date(a.effectiveDate) - new Date(b.effectiveDate)
    );

    const computeNewRent = (current, type, value) => {
      const numericValue = Number(value) || 0;
      if (type === "percentage") {
        return Math.round(current * (1 + numericValue / 100));
      }
      return Math.round(current + numericValue);
    };

    const appliedOnly = sortedRecords.filter((record) => record.status === "Applied");
    const currentEffectiveRent = appliedOnly.reduce((rent, record) => {
      return computeNewRent(rent, record.type, record.value);
    }, baseRent);

    const pendingRecords = sortedRecords.filter((record) => record.status !== "Applied");
    const nextPendingRecord = pendingRecords.length > 0 ? pendingRecords[0] : null;
    const projectedRent = nextPendingRecord
      ? computeNewRent(currentEffectiveRent, nextPendingRecord.type, nextPendingRecord.value)
      : currentEffectiveRent;

    const computedRows = sortedRecords.reduce(
      (acc, record) => {
        const previousRent = acc.runningRent;
        const resultingRent = computeNewRent(previousRent, record.type, record.value);
        acc.rows.push({ ...record, previousRent, resultingRent });
        if (record.status === "Applied") {
          acc.runningRent = resultingRent;
        }
        return acc;
      },
      { runningRent: baseRent, rows: [] }
    ).rows;

    const resetReviewForm = () => {
      setReviewForm({
        type: "percentage",
        value: 5,
        frequency: "yearly",
        effectiveDate: new Date().toISOString().split("T")[0],
        note: "",
      });
      setEditingReviewId(null);
      setReviewFormOpen(false);
    };

    const handleSaveReview = () => {
      if (!reviewForm.effectiveDate) {
        toast.error("Effective date is required");
        return;
      }
      if (!reviewForm.value || Number(reviewForm.value) <= 0) {
        toast.error("Review value must be greater than zero");
        return;
      }

      if (editingReviewId) {
        setReviewRecords((prev) =>
          prev.map((record) =>
            record.id === editingReviewId
              ? {
                  ...record,
                  ...reviewForm,
                  updatedAt: new Date().toISOString(),
                }
              : record
          )
        );
        toast.success("Review updated");
      } else {
        const newRecord = {
          id: `REV-${Date.now()}`,
          ...reviewForm,
          status: "Scheduled",
          createdAt: new Date().toISOString(),
        };
        setReviewRecords((prev) => [...prev, newRecord]);
        toast.success("Review created");
      }
      resetReviewForm();
    };

    const handleEditReview = (record) => {
      setEditingReviewId(record.id);
      setReviewForm({
        type: record.type,
        value: record.value,
        frequency: record.frequency,
        effectiveDate: record.effectiveDate,
        note: record.note || "",
      });
      setReviewFormOpen(true);
    };

    const handleDeleteReview = (reviewId) => {
      setReviewRecords((prev) => prev.filter((record) => record.id !== reviewId));
      toast.success("Review deleted");
      if (editingReviewId === reviewId) resetReviewForm();
    };

    const handleApplyReview = (reviewId) => {
      setReviewRecords((prev) =>
        prev.map((record) =>
          record.id === reviewId
            ? { ...record, status: "Applied", appliedAt: new Date().toISOString() }
            : record
        )
      );
      toast.success("Review applied to effective rent");
    };

    const formatFrequency = (frequency) => {
      if (frequency === "biannual") return "Bi-Annual";
      if (frequency === "quarterly") return "Quarterly";
      return "Yearly";
    };

    return (
      <div className="space-y-6">
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-5">
            <div>
              <h3 className="text-lg font-bold text-gray-900">Rent Reviews & Escalations</h3>
              <p className="text-gray-600 text-sm mt-1">
                Manage rent adjustments with full review and escalation controls.
              </p>
            </div>
            <button
              onClick={() => {
                setEditingReviewId(null);
                setReviewFormOpen(true);
              }}
              className={`${MILIK_GREEN} hover:bg-[#0A3127] text-white px-4 py-2 rounded font-semibold flex items-center gap-2`}
            >
              <FaPlus /> Add Review / Escalation
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
            <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
              <p className="text-xs text-slate-600 font-semibold">Base Rent</p>
              <p className="text-lg font-bold text-slate-900 mt-1">Ksh {baseRent.toLocaleString()}</p>
            </div>
            <div className="border border-green-200 rounded-lg p-3 bg-green-50">
              <p className="text-xs text-green-700 font-semibold">Current Effective Rent</p>
              <p className="text-lg font-bold text-green-700 mt-1">
                Ksh {currentEffectiveRent.toLocaleString()}
              </p>
            </div>
            <div className="border border-blue-200 rounded-lg p-3 bg-blue-50">
              <p className="text-xs text-blue-700 font-semibold">Scheduled Reviews</p>
              <p className="text-lg font-bold text-blue-700 mt-1">{pendingRecords.length}</p>
            </div>
            <div className="border border-orange-200 rounded-lg p-3 bg-orange-50">
              <p className="text-xs text-orange-700 font-semibold">Projected Next Rent</p>
              <p className="text-lg font-bold text-orange-700 mt-1">Ksh {projectedRent.toLocaleString()}</p>
            </div>
          </div>

          {reviewFormOpen && (
            <div className="border border-slate-200 rounded-lg p-4 bg-slate-50 mb-5">
              <h4 className="font-bold text-slate-900 mb-3">
                {editingReviewId ? "Edit Review / Escalation" : "New Review / Escalation"}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700">Type</label>
                  <select
                    value={reviewForm.type}
                    onChange={(e) => setReviewForm((prev) => ({ ...prev, type: e.target.value }))}
                    className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-md text-sm"
                  >
                    <option value="percentage">Percentage (%)</option>
                    <option value="amount">Fixed Amount (Ksh)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">
                    {reviewForm.type === "percentage" ? "Increase %" : "Increase Amount"}
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={reviewForm.value}
                    onChange={(e) =>
                      setReviewForm((prev) => ({ ...prev, value: Math.max(0, Number(e.target.value)) }))
                    }
                    className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-md text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">Frequency</label>
                  <select
                    value={reviewForm.frequency}
                    onChange={(e) => setReviewForm((prev) => ({ ...prev, frequency: e.target.value }))}
                    className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-md text-sm"
                  >
                    <option value="yearly">Yearly</option>
                    <option value="biannual">Bi-Annual</option>
                    <option value="quarterly">Quarterly</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">Effective Date</label>
                  <input
                    type="date"
                    value={reviewForm.effectiveDate}
                    onChange={(e) => setReviewForm((prev) => ({ ...prev, effectiveDate: e.target.value }))}
                    className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-md text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">Projected Rent</label>
                  <div className="mt-1 h-[42px] px-3 rounded-md border border-green-300 bg-green-50 flex items-center font-bold text-green-700 text-sm">
                    Ksh {computeNewRent(currentEffectiveRent, reviewForm.type, reviewForm.value).toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="mt-3">
                <label className="text-xs font-semibold text-slate-700">Notes</label>
                <textarea
                  rows={2}
                  value={reviewForm.note}
                  onChange={(e) => setReviewForm((prev) => ({ ...prev, note: e.target.value }))}
                  className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-md text-sm"
                  placeholder="Reason for escalation/review"
                />
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  onClick={resetReviewForm}
                  className="px-4 py-2 rounded border border-slate-300 text-slate-700 font-semibold text-sm hover:bg-slate-100 flex items-center gap-2"
                >
                  <FaTimes /> Cancel
                </button>
                <button
                  onClick={handleSaveReview}
                  className={`${MILIK_GREEN} hover:bg-[#0A3127] text-white px-4 py-2 rounded font-semibold text-sm`}
                >
                  {editingReviewId ? "Update" : "Save"}
                </button>
              </div>
            </div>
          )}

          <div className="overflow-auto border border-slate-200 rounded-lg">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className={`${MILIK_GREEN} text-white text-xs`}>
                  <th className="px-3 py-2 text-left">Effective Date</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-left">Frequency</th>
                  <th className="px-3 py-2 text-right">Increase</th>
                  <th className="px-3 py-2 text-right">Resulting Rent</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Notes</th>
                  <th className="px-3 py-2 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {computedRows.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="px-3 py-8 text-center text-slate-500">
                      No rent review/escalation records yet.
                    </td>
                  </tr>
                ) : (
                  computedRows.map((record, index) => {
                    const isApplied = record.status === "Applied";
                    return (
                      <tr
                        key={record.id}
                        className={`${index % 2 === 0 ? "bg-white" : "bg-slate-50"} border-b border-slate-200`}
                      >
                        <td className="px-3 py-2 text-slate-800">
                          {new Date(record.effectiveDate).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-2 text-slate-800 capitalize">{record.type}</td>
                        <td className="px-3 py-2 text-slate-800">{formatFrequency(record.frequency)}</td>
                        <td className="px-3 py-2 text-right text-slate-900 font-semibold">
                          {record.type === "percentage"
                            ? `${Number(record.value)}%`
                            : `Ksh ${Number(record.value).toLocaleString()}`}
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-slate-900">
                          Ksh {record.resultingRent.toLocaleString()}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex px-2 py-1 rounded text-xs font-semibold ${
                              isApplied ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {record.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-700 max-w-[220px] truncate">
                          {record.note || "-"}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-center gap-2">
                            {!isApplied && (
                              <button
                                onClick={() => handleApplyReview(record.id)}
                                className="px-2 py-1 text-xs rounded bg-green-600 text-white hover:bg-green-700 flex items-center gap-1"
                                title="Apply"
                              >
                                <FaCheck /> Apply
                              </button>
                            )}
                            <button
                              onClick={() => handleEditReview(record)}
                              className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700"
                              title="Edit"
                            >
                              <FaEdit />
                            </button>
                            <button
                              onClick={() => handleDeleteReview(record.id)}
                              className="px-2 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700"
                              title="Delete"
                            >
                              <FaTrash />
                            </button>
                          </div>
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
    );
  };

  const handlePrintReceipt = (receipt) => {
    const printWindow = window.open("", "_blank");
    const receiptHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Receipt #${receipt.receiptNumber}</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            padding: 20px;
            background: white;
          }
          .receipt-container {
            max-width: 600px;
            margin: 0 auto;
            border: 2px solid #165946;
            padding: 30px;
            border-radius: 8px;
          }
          .header {
            text-align: center;
            margin-bottom: 20px;
            border-bottom: 2px solid #165946;
            padding-bottom: 15px;
          }
          .company-name {
            font-size: 24px;
            font-weight: bold;
            color: #165946;
            margin-bottom: 5px;
          }
          .receipt-title {
            font-size: 18px;
            font-weight: bold;
            color: #333;
            margin-top: 15px;
          }
          .receipt-number {
            font-size: 14px;
            color: #666;
            margin-top: 10px;
          }
          .detail-row {
            display: flex;
            justify-content: space-between;
            margin: 8px 0;
            font-size: 14px;
          }
          .detail-label {
            font-weight: bold;
            color: #333;
          }
          .detail-value {
            color: #666;
          }
          .divider {
            border-top: 1px solid #ddd;
            margin: 15px 0;
          }
          .amount-section {
            margin: 20px 0;
            padding: 15px;
            background: #f5f5f5;
            border-radius: 4px;
          }
          .total-amount {
            display: flex;
            justify-content: space-between;
            font-size: 18px;
            font-weight: bold;
            color: #165946;
          }
          .footer {
            text-align: center;
            margin-top: 20px;
            font-size: 12px;
            color: #999;
          }
          @media print {
            body {
              background: white;
            }
          }
        </style>
      </head>
      <body>
        <div class="receipt-container">
          <div class="header">
            <div class="company-name">${currentCompany?.companyName || "MILIK"}</div>
            <div class="receipt-title">RENT RECEIPT</div>
            <div class="receipt-number">Receipt #${receipt.receiptNumber}</div>
          </div>

          <div class="detail-row">
            <span class="detail-label">Tenant Name:</span>
            <span class="detail-value">${tenant?.name || "-"}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Reference:</span>
            <span class="detail-value">${receipt.referenceNumber || "-"}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Payment Date:</span>
            <span class="detail-value">${new Date(receipt.paymentDate).toLocaleDateString()}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Payment Method:</span>
            <span class="detail-value">${receipt.paymentMethod || "-"}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Payment Type:</span>
            <span class="detail-value">${receipt.paymentType || "-"}</span>
          </div>

          <div class="divider"></div>

          <div class="amount-section">
            <div class="total-amount">
              <span>Amount Received:</span>
              <span>Ksh ${(receipt.amount || 0).toLocaleString()}</span>
            </div>
          </div>

          <div class="divider"></div>

          <div class="detail-row">
            <span class="detail-label">Status:</span>
            <span class="detail-value">${receipt.isConfirmed ? "CONFIRMED" : "PENDING"}</span>
          </div>

          <div class="footer">
            <p>Thank you for your payment</p>
            <p>This is an electronically generated receipt</p>
          </div>
        </div>
        <script>
          window.onload = function() {
            window.print();
          }
        </script>
      </body>
      </html>
    `;
    printWindow.document.write(receiptHTML);
    printWindow.document.close();
  };

  const renderActions = () => {
    const tenantReceipts = rentPaymentsFromStore.filter(
      (p) =>
        (p.tenant === tenantId || p.tenant?._id === tenantId) &&
        p?.ledgerType === "receipts" &&
        !p?.reversalOf
    );

    return (
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
          <h3 className="text-lg font-bold text-slate-900">Tenant Actions & Receipts</h3>
        </div>

        <div className="px-6 py-4 border-b border-slate-200">
          <h4 className="text-sm font-semibold text-slate-800 mb-4">Quick Actions</h4>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => {
                navigate(`/receipts/${tenantId}`);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded font-semibold text-sm transition-colors"
            >
              <FaMoneyBillWave size={16} />
              View All Receipts
            </button>
            <button
              onClick={() => openReceiptAllocationWorkspace()}
              className="flex items-center gap-2 px-4 py-2 bg-[#0B3B2E] hover:bg-[#0A3127] text-white rounded font-semibold text-sm transition-colors"
            >
              <FaLink size={16} />
              Receipt Allocation Workspace
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-semibold text-sm transition-colors"
            >
              <FaPrint size={16} />
              Print Statement
            </button>
            <button
              onClick={() => navigate(`/tenant/${tenantId}/edit`)}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded font-semibold text-sm transition-colors"
            >
              <FaEdit size={16} />
              Edit Tenant
            </button>
          </div>
        </div>

        <div className="px-6 py-4">
          <h4 className="text-sm font-semibold text-slate-800 mb-4">Recent Receipts</h4>
          {tenantReceipts.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>No receipts found for this tenant</p>
            </div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200">
                    <th className="px-4 py-2 text-left font-semibold text-slate-700">Receipt #</th>
                    <th className="px-4 py-2 text-left font-semibold text-slate-700">Date</th>
                    <th className="px-4 py-2 text-left font-semibold text-slate-700">Type</th>
                    <th className="px-4 py-2 text-right font-semibold text-slate-700">Amount</th>
                    <th className="px-4 py-2 text-center font-semibold text-slate-700">Status</th>
                    <th className="px-4 py-2 text-center font-semibold text-slate-700">Allocation</th>
                    <th className="px-4 py-2 text-center font-semibold text-slate-700">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {tenantReceipts
                    .slice()
                    .sort((a, b) => new Date(b.paymentDate || b.createdAt) - new Date(a.paymentDate || a.createdAt))
                    .map((receipt) => {
                      const receiptIsReversed = isReceiptReversed(receipt);
                      const receiptStatusLabel = receiptIsReversed
                        ? "Reversed"
                        : receipt.isConfirmed
                        ? "Confirmed"
                        : "Pending";
                      const receiptStatusClass = receiptIsReversed
                        ? "bg-slate-100 text-slate-700"
                        : receipt.isConfirmed
                        ? "bg-green-100 text-green-800"
                        : "bg-yellow-100 text-yellow-800";

                      return (
                      <tr key={receipt._id} className="border-b border-slate-200 hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono text-slate-700">{receipt.receiptNumber}</td>
                        <td className="px-4 py-3 text-slate-600">
                          {new Date(receipt.paymentDate).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{receipt.paymentType}</td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-900">
                          Ksh {(receipt.amount || 0).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-bold ${receiptStatusClass}`}
                          >
                            {receiptStatusLabel}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="space-y-2">
                            <button
                              onClick={() => setAllocationTraceTarget({ kind: "receipt", id: safeId(receipt) })}
                              className="text-slate-700 hover:text-slate-900 font-semibold flex items-center justify-center gap-1 mx-auto"
                              title="Trace allocations"
                            >
                              <FaLink size={13} />
                              <span className="text-xs">Trace</span>
                            </button>
                            <button
                              onClick={() => openReceiptAllocationWorkspace(safeId(receipt))}
                              disabled={receiptIsReversed}
                              className={`font-semibold flex items-center justify-center gap-1 mx-auto ${
                                receiptIsReversed
                                  ? "text-slate-400 cursor-not-allowed"
                                  : "text-[#0B3B2E] hover:text-[#0A3127]"
                              }`}
                              title={receiptIsReversed ? "Reversed receipts are read-only here" : "Manage allocations"}
                            >
                              <FaMoneyBillWave size={13} />
                              <span className="text-xs">{receiptIsReversed ? "Read only" : "Allocate"}</span>
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => handlePrintReceipt(receipt)}
                            className="text-blue-600 hover:text-blue-800 font-semibold flex items-center justify-center gap-1 mx-auto"
                            title="Print Receipt"
                          >
                            <FaPrint size={14} />
                            <span className="text-xs">Print</span>
                          </button>
                        </td>
                      </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderContent = () => {
    switch (activeTab) {
      case "statement":
        return renderStatement();
      case "billing":
        return renderBillingSchedule();
      case "details":
        return renderTenantDetails();
      case "charges":
        return renderStandingCharges();
      case "reviews":
        return renderRentReviewsAndEscalations();
      case "actions":
        return renderActions();
      default:
        return renderStatement();
    }
  };

  if (!tenant) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Tenant Not Found</h1>
            <p className="text-gray-600 mb-4">The tenant you're looking for doesn't exist.</p>
            <button
              onClick={() => navigate("/tenants")}
              className={`${MILIK_GREEN} hover:bg-[#0A3127] text-white px-4 py-2 rounded font-semibold flex items-center gap-2 mx-auto`}
            >
              <FaArrowLeft />
              Back to Tenants
            </button>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 p-4">
        <div className="mx-auto" style={{ maxWidth: "95%" }}>
          <div className="print-only-header" style={{ display: "none" }}>
            <div style={{ textAlign: "center", paddingBottom: "10px", marginBottom: "10px" }}>
              <h1
                style={{
                  fontSize: "26px",
                  fontWeight: "bold",
                  color: "#165946",
                  marginBottom: "12px",
                  letterSpacing: "1px",
                }}
              >
                {currentCompany?.companyName || currentCompany?.name || "System Admin"}
              </h1>
              {currentCompany?.companyEmail && (
                <p style={{ fontSize: "13px", color: "#4B5563", marginBottom: "3px" }}>
                  Email: {currentCompany.companyEmail}
                </p>
              )}
              {currentCompany?.companyPhone && (
                <p style={{ fontSize: "13px", color: "#4B5563", marginBottom: "3px" }}>
                  Phone: {currentCompany.companyPhone}
                </p>
              )}
              {currentCompany?.companyAddress && (
                <p style={{ fontSize: "13px", color: "#4B5563", marginBottom: "10px" }}>
                  Address: {currentCompany.companyAddress}
                </p>
              )}
              <div style={{ borderBottom: "3px solid #165946", margin: "10px auto", width: "100%" }}></div>
            </div>
            <h2
              style={{
                fontSize: "20px",
                fontWeight: "bold",
                color: "#1F2937",
                textAlign: "center",
                marginBottom: "15px",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              Tenant Statement
            </h2>
            <div
              style={{
                backgroundColor: "#F9FAFB",
                border: "2px solid #E5E7EB",
                borderRadius: "8px",
                padding: "15px",
                marginBottom: "20px",
              }}
            >
              <h3
                style={{
                  fontSize: "14px",
                  fontWeight: "bold",
                  color: "#165946",
                  marginBottom: "12px",
                  borderBottom: "1px solid #D1D5DB",
                  paddingBottom: "6px",
                }}
              >
                TENANT INFORMATION
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <p style={{ fontSize: "11px", fontWeight: "bold", color: "#6B7280", marginBottom: "3px" }}>
                    Tenant Name
                  </p>
                  <p style={{ fontSize: "13px", fontWeight: "600", color: "#1F2937" }}>
                    {tenant?.tenantName || tenant?.name || "-"}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: "11px", fontWeight: "bold", color: "#6B7280", marginBottom: "3px" }}>
                    Unit Number
                  </p>
                  <p style={{ fontSize: "13px", fontWeight: "600", color: "#1F2937" }}>
                    {resolveTenantUnitNumber(tenant)}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: "11px", fontWeight: "bold", color: "#6B7280", marginBottom: "3px" }}>
                    Property
                  </p>
                  <p style={{ fontSize: "13px", fontWeight: "600", color: "#1F2937" }}>
                    {resolveTenantPropertyName(tenant)}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: "11px", fontWeight: "bold", color: "#6B7280", marginBottom: "3px" }}>
                    Monthly Rent
                  </p>
                  <p style={{ fontSize: "13px", fontWeight: "600", color: "#1F2937" }}>
                    Ksh {(tenantLease?.rentAmount || tenant?.rent || 0).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="sticky top-0 z-10 bg-white rounded-lg shadow-lg border border-slate-200 mb-6 p-4 no-print">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <button
                  onClick={() => navigate("/tenants")}
                  className="text-gray-600 hover:text-gray-900 flex items-center gap-2 font-semibold"
                >
                  <FaArrowLeft size={16} />
                  Back to Tenants
                </button>
              </div>
              {activeTab === "statement" && (
                <div className="flex gap-2">
                  <button
                    onClick={() => navigate(`/receipts/${tenantId}`)}
                    className="bg-[#FF8C00] hover:bg-[#e67e00] text-white px-4 py-2 rounded font-semibold flex items-center gap-2 shadow-md"
                  >
                    <FaMoneyBillWave size={16} />
                    Receipts
                  </button>
                  <button
                    onClick={handlePrint}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded font-semibold flex items-center gap-2 shadow-md"
                  >
                    <FaPrint size={16} />
                    Print
                  </button>
                  <button
                    onClick={handleDownload}
                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded font-semibold flex items-center gap-2 shadow-md"
                  >
                    <FaDownload size={16} />
                    Download PDF
                  </button>
                </div>
              )}
            </div>

            <div className="bg-slate-50 rounded-lg px-4 py-3 print-tenant-info">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <p className="text-[10px] font-bold text-gray-600 uppercase tracking-tight">
                    Tenant Name
                  </p>
                  <p className="text-sm font-semibold text-gray-900 mt-0.5 truncate">
                    {tenant?.tenantName || tenant?.name || "Loading..."}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-gray-600 uppercase tracking-tight">Phone</p>
                  <p className="text-sm font-semibold text-gray-900 mt-0.5 truncate">{tenant?.phone || "-"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-gray-600 uppercase tracking-tight">Unit</p>
                  <p className="text-sm font-semibold text-gray-900 mt-0.5 truncate">
                    {resolveTenantUnitNumber(tenant)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-gray-600 uppercase tracking-tight">Property</p>
                  <p className="text-sm font-semibold text-gray-900 mt-0.5 truncate">
                    {resolveTenantPropertyName(tenant)}
                  </p>
                </div>
              </div>
            </div>

            <div className="tabs-container bg-white rounded-lg shadow-md border border-slate-200 mt-4 overflow-hidden">
              <div className="flex border-b border-gray-200 overflow-x-auto">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center justify-center gap-2 px-4 py-4 font-semibold text-sm whitespace-nowrap transition-colors ${
                      activeTab === tab.id
                        ? "bg-orange-50 text-orange-600 border-b-2 border-orange-600"
                        : "text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <span className="text-lg">{tab.icon}</span>
                    <span className="hidden md:inline">{tab.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-4 mt-6">{renderContent()}</div>
        </div>
      </div>

      <style>{`
        @media print {
          @page {
            margin: 0.75in;
            size: A4;
          }

          body {
            background: white !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .fixed {
            display: none !important;
          }

          .pt-36 {
            padding-top: 0 !important;
          }

          .pt-4 {
            padding-top: 0 !important;
          }

          .pb-20 {
            padding-bottom: 0 !important;
          }

          .print-only-header {
            display: block !important;
            page-break-after: avoid;
          }

          button {
            display: none !important;
          }

          input[type="checkbox"] {
            display: none !important;
          }

          .no-print {
            display: none !important;
          }

          .tabs-container {
            display: none !important;
          }

          .tabs-container .flex {
            display: none !important;
          }

          .filter-section {
            display: none !important;
          }

          .tab-content {
            display: none !important;
          }

          .statement-tab {
            display: block !important;
          }

          .bg-gray-50 {
            display: none !important;
          }

          .bg-gradient-to-br {
            background: white !important;
          }

          .shadow-sm, .shadow-md, .shadow-lg {
            box-shadow: none !important;
          }

          .print-tenant-info {
            background: white !important;
            border: 2px solid #E5E7EB !important;
            padding: 15px !important;
            margin-bottom: 20px !important;
            page-break-after: avoid;
          }

          .print-tenant-info p {
            font-size: 12px !important;
          }

          .transaction-table {
            height: auto !important;
            break-inside: avoid;
          }

          .transaction-table tbody {
            page-break-inside: avoid;
          }

          .transaction-table tr {
            page-break-inside: avoid;
            page-break-after: auto;
          }

          .flex.items-center.justify-between {
            display: none !important;
          }

          .bg-blue-600, .bg-green-600, .bg-orange-600, .bg-red-600 {
            background-color: white !important;
            border: 1px solid #000 !important;
          }

          .text-gray-600, .text-gray-700 {
            color: #000 !important;
          }

          .bg-white {
            border: 1px solid #E5E7EB !important;
          }

          .bg-blue-50, .bg-orange-50, .bg-green-50 {
            background: white !important;
            border: 2px solid #165946 !important;
          }

          .print-footer {
            display: block !important;
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #E5E7EB;
            text-align: center;
            font-size: 11px;
            color: #6B7280;
          }
        }
      `}</style>

      <InvoiceCreationModal
        isOpen={showInvoiceModal}
        periods={selectedSchedules.map((key) => billingScheduleByKey.get(key)).filter(Boolean)}
        depositOption={depositBillingOption}
        onConfirm={handleConfirmInvoiceCreation}
        onCancel={() => setShowInvoiceModal(false)}
        taxConfig={normalizedTaxConfig}
      />
    </DashboardLayout>
  );
};

export default TenantStatement;