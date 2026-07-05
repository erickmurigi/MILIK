import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { FaArrowLeft, FaSave, FaSpinner } from "react-icons/fa";
import { useDispatch, useSelector } from "react-redux";
import {
  selectCurrentUser,
  selectCurrentCompany,
  selectAllProperties,
  selectAllTenants,
} from "../../redux/selectors";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import AppSelect from "../../components/common/AppSelect";
import { createRentPayment, getTenantInvoices, getChartOfAccounts } from "../../redux/apiCalls";
import { getProperties } from "../../redux/propertyRedux";
import { getTenants } from "../../redux/tenantsRedux";
import { hasCompanyPermission } from "../../utils/permissions";
import { isSelfManagingLandlordCompany } from "../../utils/companyModules";
import useScopedSessionDraft, { buildScopedDraftKey } from "../../hooks/useScopedSessionDraft";

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";
const PREPAYMENT_OPTION_KEY = "__prepayment__";

const todayInput = () => new Date().toISOString().split("T")[0];

const ensureArray = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.properties)) return value.properties;
  if (Array.isArray(value?.tenants)) return value.tenants;
  if (Array.isArray(value?.rentPayments)) return value.rentPayments;
  if (Array.isArray(value?.invoices)) return value.invoices;
  if (Array.isArray(value?.accounts)) return value.accounts;
  return [];
};

const getTenantName = (tenant) => {
  if (!tenant) return "";
  return (
    tenant.name ||
    tenant.tenantName ||
    [tenant.firstName, tenant.lastName].filter(Boolean).join(" ") ||
    "Unnamed Tenant"
  );
};

const getTenantPropertyId = (tenant) => {
  const propertyFromUnit = tenant?.unit?.property?._id || tenant?.unit?.property;
  const propertyDirect = tenant?.property?._id || tenant?.property;
  return propertyFromUnit || propertyDirect || "";
};

const normalizeLifecycleStatus = (value = "") =>
  String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");

const isArchivedRecord = (record) =>
  normalizeLifecycleStatus(record?.status || record?.lifecycleStatus) === "archived";

const isTerminatedTenant = (tenant) => {
  const status = normalizeLifecycleStatus(tenant?.status || tenant?.tenantStatus || tenant?.lifecycleStatus);
  return ["terminated", "inactive", "moved_out", "movedout", "closed"].includes(status) || Boolean(tenant?.terminatedAt);
};

const getChargeTypeFromInvoice = (invoice) => {
  const category = String(invoice?.category || "").toUpperCase();
  const metadata = invoice?.metadata && typeof invoice.metadata === "object" ? invoice.metadata : {};
  if (category === "RENT_CHARGE" && String(metadata?.billItemKey || "").trim().toLowerCase() === "rent_utility:combined") {
    return "combined";
  }
  if (category === "UTILITY_CHARGE") return "utility";
  if (category === "DEPOSIT_CHARGE") return "deposit";
  if (category === "LATE_PENALTY_CHARGE") return "late_fee";
  return "rent";
};

const getChargeTypeLabel = (chargeType = "rent") => {
  const normalized = String(chargeType || "rent").toLowerCase();
  if (normalized === "combined") return "Combined Rent + Utility";
  if (normalized === "utility") return "Utility";
  if (normalized === "deposit") return "Deposit";
  if (normalized === "late_fee") return "Late Penalty";
  return "Rent";
};

const mapOutstandingInvoiceStatus = ({ rawStatus = "", outstanding = 0, paid = 0 }) => {
  const normalizedStatus = String(rawStatus || "").toLowerCase();

  if (normalizedStatus === "paid") return "Settled";
  if (normalizedStatus === "partially_paid") return "Partially Paid";
  if (normalizedStatus === "cancelled") return "Cancelled";
  if (normalizedStatus === "reversed") return "Reversed";
  if (normalizedStatus === "pending") {
    if (outstanding <= 0) return "Settled";
    return paid > 0 ? "Partially Paid" : "Open";
  }

  if (outstanding <= 0) return "Settled";
  return paid > 0 ? "Partially Paid" : "Open";
};


const isCashbookAccount = (account) => {
  if (!account) return false;
  const name = String(account?.name || "").toLowerCase();
  const group = String(account?.group || "").toLowerCase();
  const subGroup = String(account?.subGroup || "").toLowerCase();
  return (
    String(account?.type || "").toLowerCase() === "asset" &&
    account?.isHeader !== true &&
    account?.isPosting !== false &&
    /cash|bank|m-?pesa|mobile money|wallet|petty|till|collection/.test(`${name} ${group} ${subGroup}`)
  );
};

const AddReceipt = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const receiptMode = searchParams.get("mode") || "tenant";
  const isLandlordMode = receiptMode === "landlord";
  const isInstantMode = receiptMode === "instant";
  const preselectedTenantId = searchParams.get("tenant") || "";
  const prefilledTenantCode = searchParams.get("tnt") || searchParams.get("tenantCode") || "";
  const prefilledAmount = searchParams.get("amount") || "";
  const prefilledReference = searchParams.get("reference") || "";
  const prefilledMethod = searchParams.get("paymentMethod") || searchParams.get("method") || "";
  const prefilledDescription = searchParams.get("description") || "";
  const prefilledCollectionId = searchParams.get("collectionId") || "";
  const prefilledAccountReference = searchParams.get("accountReference") || "";
  const prefilledMsisdn = searchParams.get("msisdn") || "";
  const prefilledPayerName = searchParams.get("payerName") || "";
  const currentCompany = useSelector(selectCurrentCompany);
  const isCompanyLandlordMode = isSelfManagingLandlordCompany(currentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const canSaveReceipt = hasCompanyPermission(currentUser || {}, currentCompany, "receipts", "create", "propertyManagement");
  const rawProperties = useSelector(selectAllProperties);
  const rawTenants = useSelector(selectAllTenants);

  const properties = ensureArray(rawProperties);
  const activeProperties = useMemo(
    () => properties.filter((property) => !isArchivedRecord(property)),
    [properties]
  );
  const tenants = ensureArray(rawTenants);

  const receiptDraftKey = buildScopedDraftKey({
    page: "add-receipt",
    companyId: currentCompany?._id,
    userId: currentUser?._id || currentUser?.id || currentUser?.email,
    extra: preselectedTenantId || prefilledCollectionId || "new",
  });
  const [receiptDraft, setReceiptDraft, clearReceiptDraft] = useScopedSessionDraft(receiptDraftKey, {
    formData: {
      propertyId: "",
      tenantId: preselectedTenantId,
      amount: prefilledAmount,
      paymentMethod: ["bank_transfer", "mobile_money", "cash", "check", "credit_card", "pesalink", "rtgs", "standing_order", "direct_debit"].includes(prefilledMethod) ? prefilledMethod : "mobile_money",
      cashbook: "Main Cashbook",
      paidDirectToLandlord: isLandlordMode,
      paymentDate: todayInput(),
      bookingDate: todayInput(),
      referenceNumber: prefilledReference,
      bankingDate: todayInput(),
      description: prefilledDescription,
      isConfirmed: false,
    },
    priorityInvoiceKeys: [],
    manualSelectionMode: false,
    creditOnAccountMode: false,
    includeTerminatedTenants: Boolean(preselectedTenantId || prefilledTenantCode),
  });
  const formData = receiptDraft.formData || {};
  const setFormData = (updater) => {
    setReceiptDraft((prev) => ({
      ...prev,
      formData: typeof updater === "function" ? updater(prev.formData || {}) : updater,
    }));
  };
  const priorityInvoiceKeys = receiptDraft.priorityInvoiceKeys || [];
  const setPriorityInvoiceKeys = (updater) => {
    setReceiptDraft((prev) => ({
      ...prev,
      priorityInvoiceKeys: typeof updater === "function" ? updater(prev.priorityInvoiceKeys || []) : updater,
    }));
  };
  const [tenantInvoices, setTenantInvoices] = useState([]);
  const [cashbookOptions, setCashbookOptions] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [prepaymentLines, setPrepaymentLines] = useState([]);
  const prepaymentInitializedRef = useRef(false);
  const creditOnAccountMode = Boolean(receiptDraft.creditOnAccountMode);
  const setCreditOnAccountMode = (value) => {
    setReceiptDraft((prev) => ({
      ...prev,
      creditOnAccountMode: Boolean(value),
      // turning on credit-on-account clears manual invoice selection
      ...(value ? { manualSelectionMode: true, priorityInvoiceKeys: [] } : {}),
    }));
  };

  const manualSelectionMode = Boolean(receiptDraft.manualSelectionMode);
  const setManualSelectionMode = (updater) => {
    setReceiptDraft((prev) => ({
      ...prev,
      manualSelectionMode: typeof updater === "function" ? updater(Boolean(prev.manualSelectionMode)) : Boolean(updater),
    }));
  };
  const includeTerminatedTenants = Boolean(receiptDraft.includeTerminatedTenants);
  const setIncludeTerminatedTenants = (updater) => {
    setReceiptDraft((prev) => ({
      ...prev,
      includeTerminatedTenants: typeof updater === "function" ? updater(Boolean(prev.includeTerminatedTenants)) : Boolean(updater),
    }));
  };

  // ── Dynamic reference label based on payment method ──
  const refRequired = ["mobile_money", "bank_transfer", "pesalink", "rtgs", "standing_order"].includes(formData.paymentMethod);
  const refLabel = {
    mobile_money:   "M-Pesa / Airtel Ref Number",
    bank_transfer:  "Bank Transfer Ref",
    pesalink:       "PesaLink Ref",
    rtgs:           "RTGS / Wire Ref",
    standing_order: "Standing Order Ref",
    direct_debit:   "Direct Debit Ref",
    cash:           "Reference No.",
    check:          "Cheque No.",
    credit_card:    "Card Auth. Ref",
  }[formData.paymentMethod] || "Reference No.";

  // In self-managing landlord mode, receipts are always auto-confirmed.
  // Cashbook is still required — landlords need to track which account received the payment.
  useEffect(() => {
    if (!isCompanyLandlordMode) return;
    setFormData((prev) => ({
      ...prev,
      isConfirmed: true,
    }));
  }, [isCompanyLandlordMode]);

  useEffect(() => {
    if (!currentCompany?._id) return;

    const load = async () => {
      try {
        const [,, invoiceRows, chartRows] = await Promise.all([
          dispatch(getProperties({ business: currentCompany._id })),
          dispatch(getTenants({ business: currentCompany._id })),
          getTenantInvoices({ business: currentCompany._id, includeSnapshots: true }),
          getChartOfAccounts({ business: currentCompany._id, type: "asset" }),
        ]);

        const normalizedInvoices = ensureArray(invoiceRows);
        const normalizedChartRows = ensureArray(chartRows);

        setTenantInvoices(normalizedInvoices);
        const liveCashbooks = normalizedChartRows.filter(isCashbookAccount);
        setCashbookOptions(liveCashbooks);

        if (liveCashbooks.length > 0) {
          const preferred = liveCashbooks.some((item) => item.name === "Main Cashbook")
            ? "Main Cashbook"
            : liveCashbooks[0].name;

          setFormData((prev) => ({
            ...prev,
            cashbook: liveCashbooks.some((item) => item.name === prev.cashbook) ? prev.cashbook : preferred,
          }));
        }
      } catch (error) {
        setTenantInvoices([]);
        setCashbookOptions([]);
        toast.error("Failed to load receipt setup data");
      }
    };

    load();
  }, [currentCompany?._id, dispatch]);

  useEffect(() => {
    if (!formData.tenantId || formData.propertyId) return;
    const selected = tenants.find((tenant) => String(tenant._id) === String(formData.tenantId));
    if (!selected) return;

    const tenantPropertyId = getTenantPropertyId(selected);
    if (tenantPropertyId) {
      setFormData((prev) => ({ ...prev, propertyId: String(tenantPropertyId) }));
    }
  }, [formData.tenantId, formData.propertyId, tenants]);

  const tenantOptions = useMemo(() => {
    if (!formData.propertyId) return [];
    return tenants.filter((tenant) => {
      const belongsToSelectedProperty = String(getTenantPropertyId(tenant) || "") === String(formData.propertyId);
      if (!belongsToSelectedProperty) return false;
      if (includeTerminatedTenants) return true;
      return !isTerminatedTenant(tenant);
    });
  }, [tenants, formData.propertyId, includeTerminatedTenants]);

  const selectedTenant = useMemo(
    () => tenants.find((tenant) => String(tenant._id) === String(formData.tenantId)),
    [formData.tenantId, tenants]
  );

  useEffect(() => {
    if (selectedTenant && isTerminatedTenant(selectedTenant) && !includeTerminatedTenants) {
      setIncludeTerminatedTenants(true);
    }
  }, [includeTerminatedTenants, selectedTenant]);

  useEffect(() => {
    if (preselectedTenantId || formData.tenantId || !prefilledTenantCode || tenants.length === 0) return;
    const matchedTenant = tenants.find((tenant) => String(tenant?.tenantCode || "").trim().toLowerCase() === String(prefilledTenantCode || "").trim().toLowerCase());
    if (!matchedTenant?._id) return;
    setFormData((prev) => ({ ...prev, tenantId: String(matchedTenant._id) }));
  }, [formData.tenantId, prefilledTenantCode, preselectedTenantId, tenants]);

  const isDirectToLandlord = Boolean(formData.paidDirectToLandlord);
  const backToPath = isLandlordMode
    ? "/receipts/landlord"
    : isInstantMode
    ? "/receipts/instant"
    : preselectedTenantId
    ? `/receipts/${preselectedTenantId}`
    : "/receipts";
  const getCreatedInvoicesForTenant = (targetTenantId) => {
    if (!targetTenantId) return [];

    return tenantInvoices.filter((invoice) => {
      const invoiceTenantId =
        typeof invoice?.tenant === "object"
          ? String(invoice.tenant?._id || "")
          : String(invoice?.tenant || "");

      return (
        invoiceTenantId === String(targetTenantId) &&
        !["cancelled", "reversed"].includes(String(invoice?.status || "").toLowerCase())
      );
    });
  };

  const calculateTenantBalance = (tenantId) => {
    if (!tenantId) return { totalOwed: 0, totalPaid: 0, balance: 0 };

    const invoices = getCreatedInvoicesForTenant(tenantId);

    return invoices.reduce(
      (summary, inv) => {
        const billedAmount = Number((inv.netAmount ?? inv.adjustedAmount ?? inv.amount) || 0);
        const paidAmount = Math.max(0, Number(inv?.appliedAmount || 0));
        const outstandingAmount = Math.max(
          0,
          Number(inv?.outstanding ?? Math.max(0, billedAmount - paidAmount))
        );

        summary.totalOwed += billedAmount;
        summary.totalPaid += Math.min(billedAmount, paidAmount);
        summary.balance += outstandingAmount;
        return summary;
      },
      { totalOwed: 0, totalPaid: 0, balance: 0 }
    );
  };

  const getOutstandingInvoices = (tenantId) => {
    if (!tenantId) return [];

    const invoices = getCreatedInvoicesForTenant(tenantId)
      .filter((inv) => Number(inv.amount) > 0)
      .sort((a, b) => {
        const aTime = a.invoiceDate ? new Date(a.invoiceDate).getTime() : new Date(a.createdAt || 0).getTime();
        const bTime = b.invoiceDate ? new Date(b.invoiceDate).getTime() : new Date(b.createdAt || 0).getTime();
        return aTime - bTime;
      });

    return invoices
      .map((inv) => {
        const billedAmount = Number((inv.netAmount ?? inv.adjustedAmount ?? inv.amount) || 0);
        const paid = Math.min(billedAmount, Math.max(0, Number(inv?.appliedAmount || 0)));
        const outstanding = Math.max(0, Number(inv?.outstanding ?? Math.max(0, billedAmount - paid)));
        const invoiceDate = inv.invoiceDate ? new Date(inv.invoiceDate) : null;
        const periodLabel =
          invoiceDate && !Number.isNaN(invoiceDate.getTime())
            ? invoiceDate.toLocaleDateString(undefined, { month: "short", year: "numeric" })
            : inv.invoiceNumber || "Invoice";

        const chargeType = getChargeTypeFromInvoice(inv);
        const invoiceLabel = String(inv?.description || inv?.invoiceNumber || periodLabel).trim() || periodLabel;
        const status = mapOutstandingInvoiceStatus({
          rawStatus: inv?.computedStatus || inv?.status || "",
          outstanding,
          paid,
        });
        const metadata = inv?.metadata && typeof inv.metadata === "object" ? inv.metadata : {};
        const specificUtilityName = chargeType === "utility"
          ? (metadata.utilityName || metadata.utilityType || metadata.takeOnBillItemLabel || "").trim()
          : "";
        const chargeTypeLabel = specificUtilityName || getChargeTypeLabel(chargeType);

        return {
          invoiceId: String(inv._id || ""),
          invoiceKey: String(inv._id || inv.invoiceNumber || periodLabel),
          period: periodLabel,
          invoiceNumber: String(inv?.invoiceNumber || "").trim(),
          invoiceLabel,
          chargeType,
          chargeTypeLabel,
          billedAmount,
          paid,
          outstanding,
          status,
        };
      })
      .filter((inv) => inv.billedAmount > 0 && inv.outstanding > 0.009);
  };

  const balanceSummary = useMemo(
    () => calculateTenantBalance(formData.tenantId),
    [formData.tenantId, tenantInvoices]
  );

  const outstandingInvoices = useMemo(
    () => getOutstandingInvoices(formData.tenantId),
    [formData.tenantId, tenantInvoices]
  );

  useEffect(() => {
    setPriorityInvoiceKeys([]);
    setManualSelectionMode(false);
    setPrepaymentLines([]);
    prepaymentInitializedRef.current = false;
  }, [formData.tenantId]);

  useEffect(() => {
    const activeKeys = new Set(outstandingInvoices.map((invoice) => invoice.invoiceKey));
    setPriorityInvoiceKeys((prev) => prev.filter((key) => activeKeys.has(key)));
  }, [outstandingInvoices]);

  const orderedOutstandingInvoices = useMemo(() => {
    if (priorityInvoiceKeys.length === 0) return outstandingInvoices;

    const priorityMap = new Map(priorityInvoiceKeys.map((key, index) => [key, index]));
    return [...outstandingInvoices].sort((a, b) => {
      const aIndex = priorityMap.has(a.invoiceKey) ? priorityMap.get(a.invoiceKey) : Number.MAX_SAFE_INTEGER;
      const bIndex = priorityMap.has(b.invoiceKey) ? priorityMap.get(b.invoiceKey) : Number.MAX_SAFE_INTEGER;
      if (aIndex !== bIndex) return aIndex - bIndex;
      return 0;
    });
  }, [outstandingInvoices, priorityInvoiceKeys]);

  const togglePriorityInvoice = (invoiceKey) => {
    if (!invoiceKey) return;
    setPriorityInvoiceKeys((prev) => {
      if (prev.includes(invoiceKey)) {
        return prev.filter((key) => key !== invoiceKey);
      }
      return [...prev, invoiceKey];
    });
  };

  const getPriorityIndex = (invoiceKey) => {
    const index = priorityInvoiceKeys.findIndex((key) => key === invoiceKey);
    return index >= 0 ? index + 1 : null;
  };

  const allocationPreview = useMemo(() => {
    const receiptAmount = Number(formData.amount) || 0;
    const sourceInvoices = manualSelectionMode
      ? orderedOutstandingInvoices.filter((invoice) => priorityInvoiceKeys.includes(invoice.invoiceKey))
      : orderedOutstandingInvoices;

    let remaining = receiptAmount;

    const lines = sourceInvoices.map((invoice) => {
      const apply = Math.min(invoice.outstanding, Math.max(0, remaining));
      remaining -= apply;
      return {
        invoiceId: String(invoice.invoiceId || invoice.invoiceKey || ""),
        invoiceKey: invoice.invoiceKey,
        period: invoice.period,
        chargeType: invoice.chargeType,
        chargeTypeLabel: invoice.chargeTypeLabel || getChargeTypeLabel(invoice.chargeType),
        beforeOutstanding: invoice.outstanding,
        apply,
        afterOutstanding: Math.max(0, invoice.outstanding - apply),
      };
    });

    const unappliedAmount = Math.max(0, remaining);

    if (unappliedAmount > 0) {
      lines.push({
        invoiceId: PREPAYMENT_OPTION_KEY,
        invoiceKey: PREPAYMENT_OPTION_KEY,
        period: "Prepayment",
        chargeType: "unapplied",
        chargeTypeLabel: "Prepayment / Unapplied Credit",
        beforeOutstanding: unappliedAmount,
        apply: unappliedAmount,
        afterOutstanding: 0,
      });
    }

    return {
      lines,
      invoiceLines: lines.filter((line) => line.invoiceId && line.invoiceId !== PREPAYMENT_OPTION_KEY),
      unappliedAmount,
      projectedBalance: balanceSummary.balance - receiptAmount,
    };
  }, [formData.amount, orderedOutstandingInvoices, balanceSummary.balance, manualSelectionMode, priorityInvoiceKeys]);

  // ── Derive paymentType from allocations so the field can be hidden ──
  const derivedPaymentType = useMemo(() => {
    if (creditOnAccountMode) return "rent";
    const lines = allocationPreview?.invoiceLines || [];
    const totals = {};
    for (const line of lines) {
      if (line.apply > 0) totals[line.chargeType] = (totals[line.chargeType] || 0) + line.apply;
    }
    const entries = Object.entries(totals);
    if (!entries.length) return "rent";
    const primary = entries.sort((a, b) => b[1] - a[1])[0][0];
    return { rent: "rent", deposit: "deposit", utility: "utility", late_fee: "late_fee", combined: "rent" }[primary] || "rent";
  }, [creditOnAccountMode, allocationPreview]);

  const prepaymentTypeOptions = useMemo(() => {
    const options = [{ billItemKey: "rent", label: "Rent Prepayment" }];
    if (!formData.tenantId) return options;
    const allTenantInvoices = getCreatedInvoicesForTenant(formData.tenantId);
    const seenKeys = new Set(["rent"]);
    for (const inv of allTenantInvoices) {
      if (String(inv?.category || "").toUpperCase() !== "UTILITY_CHARGE") continue;
      const meta = inv?.metadata && typeof inv.metadata === "object" ? inv.metadata : {};
      const utilName = (meta.utilityName || meta.utilityType || meta.takeOnBillItemLabel || "").trim();
      if (!utilName) continue;
      const normalized = utilName.toLowerCase().replace(/\s+/g, "_");
      const key = `utility:${normalized}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      options.push({ billItemKey: key, label: `${utilName} Prepayment` });
    }
    return options;
  }, [formData.tenantId, tenantInvoices]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const excess = allocationPreview.unappliedAmount;
    if (excess <= 0.005) {
      setPrepaymentLines([]);
      prepaymentInitializedRef.current = false;
      return;
    }
    if (!prepaymentInitializedRef.current) {
      setPrepaymentLines([{ billItemKey: "rent", label: "Rent Prepayment", amount: parseFloat(excess.toFixed(2)) }]);
      prepaymentInitializedRef.current = true;
      return;
    }
    setPrepaymentLines((prev) => {
      if (!prev.length) return [{ billItemKey: "rent", label: "Rent Prepayment", amount: parseFloat(excess.toFixed(2)) }];
      const otherTotal = prev.slice(0, -1).reduce((s, l) => s + (Number(l.amount) || 0), 0);
      const lastAmount = parseFloat(Math.max(0, excess - otherTotal).toFixed(2));
      if (lastAmount <= 0 && prev.length > 1) return [{ billItemKey: "rent", label: "Rent Prepayment", amount: parseFloat(excess.toFixed(2)) }];
      return [...prev.slice(0, -1), { ...prev[prev.length - 1], amount: lastAmount }];
    });
  }, [allocationPreview.unappliedAmount]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-populate description from allocated invoices (falls back to tenant+date) ──
  // Initialize with the current description so a restored draft value is treated as auto-generated
  // and gets refreshed when the underlying data (utility names, allocations) changes.
  const lastAutoDescRef = useRef(formData.description || "");
  useEffect(() => {
    let autoDesc = "";

    // Primary: build narration from what is actually being applied
    const activeLines = (allocationPreview?.lines || []).filter(
      (l) => l.apply > 0 && l.invoiceId !== PREPAYMENT_OPTION_KEY
    );
    if (activeLines.length > 0) {
      const byPeriod = new Map();
      for (const line of activeLines) {
        if (!line.period) continue;
        if (!byPeriod.has(line.period)) byPeriod.set(line.period, new Set());
        byPeriod.get(line.period).add(line.chargeTypeLabel || line.chargeType || "");
      }
      if (byPeriod.size > 0) {
        autoDesc = Array.from(byPeriod.entries())
          .map(([period, types]) => {
            const typeList = Array.from(types).filter(Boolean);
            const joined = typeList.length > 1
              ? typeList.slice(0, -1).join(", ") + " and " + typeList[typeList.length - 1]
              : typeList[0] || "";
            return `${period} — ${joined}`;
          })
          .join("; ");
      }
    }

    // Fallback: use tenant + payment month when no invoices are applied yet
    if (!autoDesc && selectedTenant && formData.paymentDate) {
      const tenantName = getTenantName(selectedTenant);
      const unitNumber = selectedTenant?.unit?.unitNumber || "";
      const d = new Date(`${formData.paymentDate}T00:00:00`);
      const monthYear = Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-KE", { month: "short", year: "numeric" });
      if (monthYear) {
        autoDesc = unitNumber ? `${monthYear} — ${tenantName} (Unit ${unitNumber})` : `${monthYear} — ${tenantName}`;
      }
    }

    if (!autoDesc) return;
    if (!formData.description || formData.description === lastAutoDescRef.current) {
      lastAutoDescRef.current = autoDesc;
      setFormData((prev) => ({ ...prev, description: autoDesc }));
    }
  }, [allocationPreview, selectedTenant, formData.paymentDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPropertyChange = (propertyId) => {
    setFormData((prev) => ({
      ...prev,
      propertyId,
      tenantId: "",
    }));
  };


  const labelClass = "mb-0.5 block text-xs font-semibold text-slate-700";
  const inputClass = "w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";
  const preventWheelValueChange = (event) => {
    event.currentTarget.blur();
  };

  const handleSubmit = useCallback(async () => {
    if (isSaving) return;
    if (!canSaveReceipt) {
      toast.error("You do not have permission to record receipts");
      return;
    }
    if (!currentCompany?._id) {
      toast.error("No active company selected");
      return;
    }

    if (!formData.propertyId) {
      toast.error("Property is required");
      return;
    }

    if (!formData.tenantId) {
      toast.error("Tenant is required");
      return;
    }

    if (!formData.amount || Number(formData.amount) <= 0) {
      toast.error("Amount must be greater than zero");
      return;
    }

    if (!isDirectToLandlord && !formData.cashbook) {
      toast.error("Cashbook is required unless this receipt was paid directly to the landlord");
      return;
    }

    if (refRequired && !String(formData.referenceNumber || "").trim()) {
      toast.error(`${refLabel} is required for this payment method`);
      return;
    }

    const unitId = selectedTenant?.unit?._id || selectedTenant?.unit;
    if (!unitId) {
      toast.error("Selected tenant has no linked unit");
      return;
    }

    const paymentDateObj = new Date(formData.paymentDate);

    const manualAllocationRows = allocationPreview.invoiceLines
      .filter((line) => Number(line?.apply || 0) > 0 && String(line?.invoiceId || "").trim())
      .map((line) => ({
        invoiceId: String(line.invoiceId),
        appliedAmount: Number(line.apply || 0),
      }));

    // Credit on account → send empty allocations so entire amount goes to 2130
    const shouldUseManualAllocations = creditOnAccountMode || manualSelectionMode || priorityInvoiceKeys.length > 0;
    const creditAllocations = creditOnAccountMode ? [] : undefined;
    const payload = {
      tenant: formData.tenantId,
      unit: unitId,
      amount: Number(formData.amount),
      paymentType: derivedPaymentType,
      paymentMethod: formData.paymentMethod,
      cashbook: isDirectToLandlord ? "" : formData.cashbook,
      paidDirectToLandlord: isDirectToLandlord,
      paymentDate: formData.paymentDate,
      bookingDate: formData.bookingDate && formData.bookingDate !== formData.paymentDate ? formData.bookingDate : undefined,
      dueDate: new Date(paymentDateObj.getFullYear(), paymentDateObj.getMonth(), 1).toISOString().slice(0, 10),
      referenceNumber: String(formData.referenceNumber || "").trim(),
      bankingDate: formData.bankingDate || formData.paymentDate || undefined,
      description: formData.description,
      isConfirmed: formData.isConfirmed,
      ledgerType: "receipts",
      month: paymentDateObj.getMonth() + 1,
      year: paymentDateObj.getFullYear(),
      business: currentCompany._id,
      allocations: creditOnAccountMode ? creditAllocations : (shouldUseManualAllocations ? manualAllocationRows : undefined),
      allocationMode: creditOnAccountMode ? "credit_on_account" : (shouldUseManualAllocations ? "manual" : undefined),
      prepaymentLines: !creditOnAccountMode && allocationPreview.unappliedAmount > 0.005 && prepaymentLines.length > 0
        ? prepaymentLines.map((l) => ({ billItemKey: l.billItemKey, label: l.label || l.billItemKey, amount: Number(l.amount) || 0 }))
        : undefined,
      metadata: prefilledCollectionId
        ? {
            mpesa: {
              collectionId: prefilledCollectionId,
              transactionCode: String(formData.referenceNumber || "").trim(),
              accountReference: prefilledAccountReference || "",
              msisdn: prefilledMsisdn || "",
              payerName: prefilledPayerName || "",
              source: isInstantMode ? "instant_receipts" : "prefilled",
            },
          }
        : undefined,
    };

    if (!creditOnAccountMode && allocationPreview.unappliedAmount > 0.005) {
      if (prepaymentLines.length === 0) {
        toast.error("Please allocate the prepayment excess before saving");
        return;
      }
      const linesTotal = prepaymentLines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
      if (Math.abs(linesTotal - allocationPreview.unappliedAmount) > 0.5) {
        toast.error(`Prepayment lines must total KES ${allocationPreview.unappliedAmount.toLocaleString()}. Current: KES ${linesTotal.toLocaleString()}`);
        return;
      }
      for (const line of prepaymentLines) {
        if (!line.billItemKey) { toast.error("Each prepayment line must have a type selected"); return; }
        if (!(Number(line.amount) > 0)) { toast.error("Each prepayment line amount must be greater than zero"); return; }
      }
    }

    setIsSaving(true);
    try {
      await createRentPayment(dispatch, payload);
      toast.success("Receipt created successfully");
      clearReceiptDraft();
      navigate(backToPath);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to create receipt");
      setIsSaving(false);
    }
  }, [isSaving, canSaveReceipt, currentCompany, formData, isDirectToLandlord, isCompanyLandlordMode, selectedTenant, allocationPreview, derivedPaymentType, refRequired, refLabel, manualSelectionMode, priorityInvoiceKeys, prepaymentLines, creditOnAccountMode, prefilledCollectionId, prefilledAccountReference, prefilledMsisdn, prefilledPayerName, isInstantMode, dispatch, clearReceiptDraft, navigate, backToPath]);

  const amountDueColor =
    !formData.tenantId
      ? "border-slate-200 bg-slate-50 text-slate-400"
      : balanceSummary.balance > 0.009
      ? "border-red-200 bg-red-50 text-red-700"
      : balanceSummary.balance < -0.009
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border-slate-200 bg-slate-50 text-slate-500";

  const totalInvoiced = outstandingInvoices.reduce((s, i) => s + i.billedAmount, 0);
  const totalPaid = outstandingInvoices.reduce((s, i) => s + i.paid, 0);
  const totalOutstanding = outstandingInvoices.reduce((s, i) => s + i.outstanding, 0);

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">

        {/* Sticky header */}
        <div className="flex-shrink-0 bg-[#0B3B2E] px-4 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => navigate(backToPath)} className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#B7C9C0] hover:text-white transition">
                <FaArrowLeft /> Back
              </button>
              <div className="h-4 w-px bg-[#2A5C4A]" />
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#B7C9C0]">
                  {isLandlordMode ? "Landlord" : isInstantMode ? "Instant" : "Tenant"} Receipts
                </div>
                <h1 className="text-sm font-black text-white leading-none">New Receipt</h1>
              </div>
            </div>
            <span className="rounded-lg border border-[#2A5C4A] bg-[#0A3127] px-2.5 py-1 text-[10px] font-bold text-[#B7C9C0]">Posting-Safe Entry</span>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">

              {/* ── COLLECTION FORM ── */}
              <div className="mb-3 overflow-hidden border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
                  <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-700">Collection Details</h2>
                  {isCompanyLandlordMode && (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Landlord Mode — Auto-Confirmed</span>
                  )}
                </div>
                <div className="p-3">

                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {/* Property */}
                  <div>
                    <label className={labelClass}>Property <span className="text-red-500">*</span></label>
                    <AppSelect
                      value={formData.propertyId}
                      onChange={(v) => onPropertyChange(v ?? "")}
                      options={activeProperties.map((p) => ({ value: p._id, label: p.propertyName || p.name || "Unnamed Property" }))}
                      placeholder="Select property…"
                      searchable
                      size="sm"
                    />
                  </div>

                  {/* Tenant */}
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <label className={labelClass}>Tenant <span className="text-red-500">*</span></label>
                      <label className="inline-flex cursor-pointer items-center gap-1.5 text-[10px] font-semibold text-slate-500">
                        <input
                          type="checkbox"
                          checked={includeTerminatedTenants}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setIncludeTerminatedTenants(checked);
                            if (!checked && selectedTenant && isTerminatedTenant(selectedTenant)) {
                              setFormData((prev) => ({ ...prev, tenantId: "" }));
                            }
                          }}
                          className="h-3 w-3 rounded border-slate-300 text-[#0B3B2E] focus:ring-[#0B3B2E]"
                          disabled={!formData.propertyId}
                        />
                        Include terminated
                      </label>
                    </div>
                    <AppSelect
                      value={formData.tenantId}
                      onChange={(v) => setFormData((prev) => ({ ...prev, tenantId: v ?? "" }))}
                      options={tenantOptions.map((t) => {
                        const name = getTenantName(t);
                        const unitNum = t?.unit?.unitNumber;
                        const code = t?.tenantCode;
                        const terminated = isTerminatedTenant(t) ? " — Terminated" : "";
                        const suffix = [unitNum ? `Unit ${unitNum}` : "", code || ""].filter(Boolean).join(" · ");
                        return { value: t._id, label: suffix ? `${name} — ${suffix}${terminated}` : `${name}${terminated}` };
                      })}
                      placeholder={formData.propertyId ? "Select tenant…" : "Select property first"}
                      searchable
                      clearable
                      disabled={!formData.propertyId}
                      size="sm"
                    />
                    {selectedTenant?.unit?.unitNumber && (
                      <p className="mt-1 text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                        Unit {selectedTenant.unit.unitNumber}
                      </p>
                    )}
                    {selectedTenant && isTerminatedTenant(selectedTenant) && (
                      <p className="mt-1 text-[10px] font-semibold text-amber-600">
                        Arrears / recovery receipt only — occupancy is not restored.
                      </p>
                    )}
                  </div>

                  {/* Amount */}
                  <div>
                    <label className={labelClass}>Amount *</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={formData.amount}
                      onChange={(e) => setFormData((prev) => ({ ...prev, amount: e.target.value }))}
                      onWheel={preventWheelValueChange}
                      className={`${inputClass} [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
                    />
                  </div>

                  {/* Amount Due — read-only */}
                  <div>
                    <label className={labelClass}>Amount Due</label>
                    <div className={`flex h-8 items-center border px-3 text-xs font-black ${amountDueColor}`}>
                      {formData.tenantId
                        ? balanceSummary.balance < -0.009
                          ? `Ksh ${Math.abs(balanceSummary.balance).toLocaleString()} CR`
                          : `Ksh ${balanceSummary.balance.toLocaleString()}`
                        : <span className="text-[12px] font-normal">Select tenant</span>}
                    </div>
                  </div>

                  {/* Payment Method */}
                  <div>
                    <label className={labelClass}>Payment Method *</label>
                    <select
                      value={formData.paymentMethod}
                      onChange={(e) => setFormData((prev) => ({ ...prev, paymentMethod: e.target.value }))}
                      className={inputClass}
                    >
                      <option value="mobile_money">Mobile Money (M-Pesa / Airtel)</option>
                      <option value="bank_transfer">Bank Transfer (EFT)</option>
                      <option value="pesalink">PesaLink</option>
                      <option value="rtgs">RTGS / Wire Transfer</option>
                      <option value="standing_order">Standing Order</option>
                      <option value="direct_debit">Direct Debit</option>
                      <option value="cash">Cash</option>
                      <option value="check">Cheque</option>
                      <option value="credit_card">Card (Debit / Credit)</option>
                    </select>
                  </div>

                  {/* Reference Number — label changes with payment method */}
                  <div>
                    <label className={labelClass}>
                      {refLabel}{refRequired ? " *" : ""}
                    </label>
                    <input
                      type="text"
                      value={formData.referenceNumber}
                      onChange={(e) => setFormData((prev) => ({ ...prev, referenceNumber: e.target.value }))}
                      className={inputClass}
                      placeholder={
                        formData.paymentMethod === "mobile_money" ? "e.g. QJZ7HK3P2T"
                        : formData.paymentMethod === "bank_transfer" ? "EFT reference / slip no."
                        : formData.paymentMethod === "pesalink" ? "PesaLink transaction ref"
                        : formData.paymentMethod === "rtgs"    ? "Wire transfer ref"
                        : formData.paymentMethod === "check"   ? "Cheque number"
                        : "Optional"
                      }
                    />
                  </div>

                  {/* Cashbook */}
                  <div>
                    <label className={labelClass}>{isDirectToLandlord ? "Cashbook" : "Cashbook *"}</label>
                    {isDirectToLandlord ? (
                      <div className="flex h-8 items-center border border-amber-200 bg-amber-50 px-3 text-xs text-amber-800">
                        Direct-to-landlord — not posted to cashbooks.
                      </div>
                    ) : cashbookOptions.length === 1 ? (
                      <div className="flex h-8 items-center border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700">
                        {cashbookOptions[0].code ? `${cashbookOptions[0].code} · ${cashbookOptions[0].name}` : cashbookOptions[0].name}
                      </div>
                    ) : (
                      <select
                        value={formData.cashbook}
                        onChange={(e) => setFormData((prev) => ({ ...prev, cashbook: e.target.value }))}
                        className={inputClass}
                      >
                        {cashbookOptions.map((option) => (
                          <option key={option._id || option.name} value={option.name}>
                            {option.code ? `${option.code} · ${option.name}` : option.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* Payment Date */}
                  <div>
                    <label className={labelClass}>Payment Date *</label>
                    <input
                      type="date"
                      value={formData.paymentDate}
                      onChange={(e) => setFormData((prev) => ({
                        ...prev,
                        paymentDate: e.target.value,
                        bankingDate: prev.bankingDate === prev.paymentDate ? e.target.value : prev.bankingDate,
                        bookingDate: prev.bookingDate === prev.paymentDate ? e.target.value : prev.bookingDate,
                      }))}
                      className={inputClass}
                    />
                  </div>

                  {/* Booking Date — controls which landlord statement period owns this receipt */}
                  <div>
                    <label className={labelClass}>
                      Booking Date{" "}
                      <span className="font-normal text-slate-400">(statement period)</span>
                    </label>
                    <input
                      type="date"
                      value={formData.bookingDate}
                      onChange={(e) => setFormData((prev) => ({ ...prev, bookingDate: e.target.value }))}
                      className={inputClass}
                    />
                    {formData.bookingDate && formData.bookingDate !== formData.paymentDate && (
                      <p className="mt-1 text-[10px] text-amber-700 font-semibold">
                        ⚠ Statement date overridden — receipt will appear in the period containing {formData.bookingDate}, not {formData.paymentDate}.
                      </p>
                    )}
                  </div>

                  {/* Banking Date — only relevant for bank transfer / cheque */}
                  {["bank_transfer", "check", "standing_order", "rtgs", "pesalink"].includes(formData.paymentMethod) && (
                    <div>
                      <label className={labelClass}>Banking / Clearance Date</label>
                      <input
                        type="date"
                        value={formData.bankingDate}
                        onChange={(e) => setFormData((prev) => ({ ...prev, bankingDate: e.target.value }))}
                        className={inputClass}
                      />
                    </div>
                  )}

                  {/* Description — feeds the GL ledger narration */}
                  <div className="col-span-2 md:col-span-4">
                    <label className={labelClass}>
                      Description <span className="font-normal text-slate-400">(appears in ledger narration)</span>
                    </label>
                    <textarea
                      rows={2}
                      value={formData.description}
                      onChange={(e) => {
                        const val = e.target.value;
                        lastAutoDescRef.current = "";
                        setFormData((prev) => ({ ...prev, description: val }));
                      }}
                      className={inputClass}
                      placeholder="Auto-filled from allocated invoices — edit freely"
                    />
                  </div>

                  {/* Checkboxes */}
                  <div className="col-span-2 md:col-span-4 flex flex-wrap items-center gap-6 border-t border-slate-100 pt-3">
                    {isCompanyLandlordMode ? (
                      <span className="rounded-full border border-[#0B3B2E]/20 bg-[#0B3B2E]/8 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[#0B3B2E]">
                        Landlord Mode — select the cashbook where payment was received
                      </span>
                    ) : (
                      <label htmlFor="paidDirectToLandlord" className="inline-flex cursor-pointer items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">
                        <input
                          type="checkbox"
                          id="paidDirectToLandlord"
                          checked={formData.paidDirectToLandlord}
                          onChange={(e) =>
                            setFormData((prev) => ({
                              ...prev,
                              paidDirectToLandlord: e.target.checked,
                              cashbook: e.target.checked ? "" : prev.cashbook,
                            }))
                          }
                          className="h-3.5 w-3.5 rounded border-slate-300 text-[#0B3B2E] focus:ring-[#0B3B2E]"
                        />
                        Direct to Landlord Receipt (do not post to cashbook)
                      </label>
                    )}
                    {isCompanyLandlordMode ? (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">
                        Auto-Confirmed
                      </span>
                    ) : (
                      <label htmlFor="isConfirmed" className="inline-flex cursor-pointer items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">
                        <input
                          type="checkbox"
                          id="isConfirmed"
                          checked={formData.isConfirmed}
                          onChange={(e) => setFormData((prev) => ({ ...prev, isConfirmed: e.target.checked }))}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-[#0B3B2E] focus:ring-[#0B3B2E]"
                        />
                        Mark as Confirmed
                      </label>
                    )}
                  </div>
                </div>
                </div>
              </div>

              {/* ── EXISTING CREDIT BANNER ── */}
              {formData.tenantId && balanceSummary.balance < -0.009 && !creditOnAccountMode && (
                <div className="mb-3 flex items-start gap-3 border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center bg-emerald-200 text-emerald-800 font-bold text-xs">CR</div>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-emerald-800">
                      This tenant has KES {Math.abs(balanceSummary.balance).toLocaleString("en-KE", { minimumFractionDigits: 2 })} credit on account
                    </p>
                    <p className="mt-0.5 text-xs text-emerald-700">
                      The credit is held in 2130 Unallocated Receipts and will be applied to open invoices. New receipt will be allocated after the credit is consumed.
                    </p>
                  </div>
                </div>
              )}

              {/* ── INVOICE PREVIEW (bottom) ── */}
              {formData.tenantId && (
                <div className="mb-3 space-y-3">

                  {/* Flat invoice ledger */}
                  <div className="overflow-hidden border border-slate-200 shadow-sm">
                    {/* Table header bar */}
                    <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0B3B2E] px-4 py-3">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/60">Invoice Preview</p>
                        <p className="mt-0.5 text-[11px] text-white/75">
                          {creditOnAccountMode
                            ? "Credit on account — full amount held in 2130 (Unallocated Receipts). Apply to a future invoice manually."
                            : manualSelectionMode
                            ? "Manual mode — only checked invoices will be allocated; remainder held as prepayment."
                            : "Only open invoices shown. Fully paid invoices are hidden."}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        {/* Credit on Account primary toggle */}
                        <button
                          type="button"
                          onClick={() => setCreditOnAccountMode(!creditOnAccountMode)}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-bold transition-colors ${
                            creditOnAccountMode
                              ? "border-emerald-300/60 bg-emerald-500/30 text-white"
                              : "border-white/20 bg-white/10 text-white/70 hover:bg-white/20"
                          }`}
                        >
                          {creditOnAccountMode ? "✓ Credit on Account" : "Credit on Account"}
                        </button>

                        <label className="inline-flex cursor-pointer items-center gap-2 text-[11px] font-semibold text-white/70">
                          <input
                            type="checkbox"
                            checked={manualSelectionMode && !creditOnAccountMode}
                            onChange={(e) => { setCreditOnAccountMode(false); setManualSelectionMode(e.target.checked); }}
                            className="h-3.5 w-3.5 rounded border-white/40 text-[#0B3B2E] focus:ring-white/30"
                          />
                          Manual
                        </label>
                        {priorityInvoiceKeys.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setPriorityInvoiceKeys([])}
                            className="text-[11px] font-semibold text-white/70 underline hover:text-white"
                          >
                            Clear Priority
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Credit on Account — bypass invoice table entirely */}
                    {creditOnAccountMode ? (
                      <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
                          <span className="text-xl">💳</span>
                        </div>
                        <div>
                          <p className="text-sm font-bold text-emerald-800">Holding as Credit on Account</p>
                          <p className="mt-1 text-xs text-slate-500 max-w-sm">
                            KES {Number(formData.amount || 0).toLocaleString()} will be held in{" "}
                            <span className="font-semibold">2130 Unallocated Receipts</span> (liability). The PM can apply this credit to any future invoice for this tenant — no invoice allocation is needed now.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setCreditOnAccountMode(false)}
                          className="text-xs text-[#0B3B2E] underline"
                        >
                          Apply to invoices instead
                        </button>
                      </div>
                    ) : outstandingInvoices.length > 0 ? (
                      <div className="overflow-auto">
                        <table className="w-full border-collapse text-[11px]">
                          <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                            <tr>
                              <th className="w-9 px-3 py-1 border-r border-white/10" />
                              <th className="px-3 py-1 text-left font-bold border-r border-white/10">Invoice</th>
                              <th className="px-3 py-1 text-left font-bold border-r border-white/10">Period</th>
                              <th className="px-3 py-1 text-left font-bold border-r border-white/10">Type</th>
                              <th className="px-3 py-1 text-right font-bold border-r border-white/10">Invoiced</th>
                              <th className="px-3 py-1 text-right font-bold border-r border-white/10">Paid</th>
                              <th className="px-3 py-1 text-right font-bold border-r border-white/10">Outstanding</th>
                              <th className="px-3 py-1 text-left font-bold border-r border-white/10">Status</th>
                              <th className="w-16 px-3 py-1 text-center font-bold">Priority</th>
                            </tr>
                          </thead>
                          <tbody>
                            {orderedOutstandingInvoices.map((invoice, index) => {
                              const priorityIndex = getPriorityIndex(invoice.invoiceKey);
                              const isSelected = Boolean(priorityIndex);
                              return (
                                <tr
                                  key={`${invoice.invoiceKey}-${index}`}
                                  onClick={() => togglePriorityInvoice(invoice.invoiceKey)}
                                  className={`cursor-pointer border-b border-gray-100 transition-colors hover:bg-[#0B3B2E]/5 ${
                                    isSelected ? "bg-[#0B3B2E]/5" : index % 2 === 0 ? "bg-white" : "bg-slate-50/40"
                                  }`}
                                >
                                  <td className="px-3 py-1.5 align-middle">
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => togglePriorityInvoice(invoice.invoiceKey)}
                                      onClick={(e) => e.stopPropagation()}
                                      className="h-3.5 w-3.5 rounded border-slate-300 text-[#0B3B2E] focus:ring-[#0B3B2E]"
                                    />
                                  </td>
                                  <td className="max-w-[180px] truncate px-3 py-1.5 font-semibold text-slate-800" title={invoice.invoiceLabel}>
                                    {invoice.invoiceNumber || invoice.invoiceLabel || invoice.period}
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-1.5 text-slate-500">{invoice.period}</td>
                                  <td className="whitespace-nowrap px-3 py-1.5">
                                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                                      {invoice.chargeTypeLabel || getChargeTypeLabel(invoice.chargeType)}
                                    </span>
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-1.5 text-right text-slate-500">
                                    Ksh {invoice.billedAmount.toLocaleString()}
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-1.5 text-right text-slate-500">
                                    Ksh {invoice.paid.toLocaleString()}
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-1.5 text-right font-bold text-slate-900">
                                    Ksh {invoice.outstanding.toLocaleString()}
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-1.5">
                                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                                      invoice.status === "Open"
                                        ? "border-amber-200 bg-amber-50 text-amber-700"
                                        : invoice.status === "Partially Paid"
                                        ? "border-blue-200 bg-blue-50 text-blue-700"
                                        : "border-slate-200 bg-slate-50 text-slate-500"
                                    }`}>
                                      {invoice.status}
                                    </span>
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-1.5 text-center">
                                    {priorityIndex ? (
                                      <span className="rounded-full bg-[#0B3B2E] px-2 py-0.5 text-[10px] font-black text-white">
                                        #{priorityIndex}
                                      </span>
                                    ) : (
                                      <span className="text-[10px] text-slate-400">Auto</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 border-slate-200 bg-slate-50">
                              <td colSpan={4} className="px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                                {outstandingInvoices.length} open invoice{outstandingInvoices.length !== 1 ? "s" : ""}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-right text-xs font-bold text-slate-600">
                                Ksh {totalInvoiced.toLocaleString()}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-right text-xs font-bold text-slate-600">
                                Ksh {totalPaid.toLocaleString()}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-right text-xs font-black text-[#0B3B2E]">
                                Ksh {totalOutstanding.toLocaleString()}
                              </td>
                              <td colSpan={2} />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    ) : (
                      <div className="px-4 py-8 text-center text-xs text-slate-400">
                        No open invoices found for this tenant.
                      </div>
                    )}
                  </div>

                  {/* Receipt allocation preview */}
                  <div className="border border-amber-200 bg-amber-50 px-4 py-3">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-700">Receipt Allocation Preview</p>
                    {Number(formData.amount) > 0 ? (
                      <div className="space-y-1">
                        {allocationPreview.lines.map((line, idx) =>
                          line.apply > 0 ? (
                            <div
                              key={`${line.period}-${line.chargeType}-${idx}`}
                              className="flex items-center justify-between border border-amber-100 bg-white px-3 py-1.5 text-xs text-amber-900"
                            >
                              <span>{line.period} — {line.chargeTypeLabel || line.chargeType}</span>
                              <span className="font-semibold">
                                {line.invoiceId === PREPAYMENT_OPTION_KEY
                                  ? `Hold Ksh ${line.apply.toLocaleString()} as prepayment`
                                  : `Apply Ksh ${line.apply.toLocaleString()} · Remaining: Ksh ${line.afterOutstanding.toLocaleString()}`}
                              </span>
                            </div>
                          ) : null
                        )}
                        {allocationPreview.lines.every((l) => l.apply === 0) && (
                          <p className="text-xs text-amber-800">
                            {manualSelectionMode
                              ? "No selected invoice will receive this receipt yet. Save to hold as prepayment."
                              : "Entered amount does not apply to any open invoice yet."}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-amber-700">Enter an amount to preview how this receipt clears open invoices.</p>
                    )}
                  </div>

                  {/* ── PREPAYMENT ALLOCATION ── */}
                  {!creditOnAccountMode && allocationPreview.unappliedAmount > 0.005 && (
                    <div className="overflow-hidden border border-[#0B3B2E]/30 shadow-sm">
                      <div className="flex items-center gap-3 bg-[#0B3B2E] px-4 py-2.5">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/60">Prepayment Allocation</p>
                          <p className="text-[11px] font-semibold text-white">
                            KES {allocationPreview.unappliedAmount.toLocaleString("en-KE", { minimumFractionDigits: 2 })} excess — tag how this should apply to future invoices
                          </p>
                        </div>
                      </div>
                      <div className="space-y-2 bg-[#0B3B2E]/5 p-4">
                        <p className="text-[10px] text-slate-500">
                          Receipt exceeds outstanding invoices. Tag the surplus so it auto-allocates when the matching invoice is raised.
                        </p>
                        {prepaymentLines.map((line, idx) => {
                          const usedKeys = new Set(prepaymentLines.filter((_, i) => i !== idx).map((l) => l.billItemKey));
                          const availableOptions = prepaymentTypeOptions.filter((opt) => !usedKeys.has(opt.billItemKey) || opt.billItemKey === line.billItemKey);
                          return (
                            <div key={idx} className="flex items-center gap-2">
                              <div className="flex-1">
                                <select
                                  value={line.billItemKey}
                                  onChange={(e) => {
                                    const opt = prepaymentTypeOptions.find((o) => o.billItemKey === e.target.value);
                                    setPrepaymentLines((prev) => {
                                      const updated = [...prev];
                                      updated[idx] = { ...updated[idx], billItemKey: e.target.value, label: opt?.label || e.target.value };
                                      return updated;
                                    });
                                  }}
                                  className={inputClass}
                                >
                                  {availableOptions.map((opt) => (
                                    <option key={opt.billItemKey} value={opt.billItemKey}>{opt.label}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="w-36">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  inputMode="decimal"
                                  value={line.amount}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value) || 0;
                                    setPrepaymentLines((prev) => {
                                      const updated = [...prev];
                                      updated[idx] = { ...updated[idx], amount: val };
                                      return updated;
                                    });
                                  }}
                                  onWheel={preventWheelValueChange}
                                  className={`${inputClass} [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
                                />
                              </div>
                              {prepaymentLines.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => setPrepaymentLines((prev) => prev.filter((_, i) => i !== idx))}
                                  className="shrink-0 px-2 text-sm font-bold text-red-400 hover:text-red-600"
                                  title="Remove line"
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          );
                        })}
                        <div className="flex items-center justify-between border-t border-[#0B3B2E]/10 pt-2">
                          {prepaymentLines.length < prepaymentTypeOptions.length ? (
                            <button
                              type="button"
                              onClick={() => {
                                const usedKeys = new Set(prepaymentLines.map((l) => l.billItemKey));
                                const nextOpt = prepaymentTypeOptions.find((opt) => !usedKeys.has(opt.billItemKey));
                                if (!nextOpt) return;
                                const remaining = parseFloat(Math.max(0, allocationPreview.unappliedAmount - prepaymentLines.reduce((s, l) => s + (Number(l.amount) || 0), 0)).toFixed(2));
                                setPrepaymentLines((prev) => [...prev, { billItemKey: nextOpt.billItemKey, label: nextOpt.label, amount: remaining }]);
                              }}
                              className="text-[11px] font-bold text-[#0B3B2E] hover:underline"
                            >
                              + Add line
                            </button>
                          ) : <span />}
                          <div className="text-right text-[11px]">
                            {(() => {
                              const total = prepaymentLines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
                              const diff = parseFloat((allocationPreview.unappliedAmount - total).toFixed(2));
                              return Math.abs(diff) < 0.01 ? (
                                <span className="font-bold text-emerald-700">✓ Balanced</span>
                              ) : (
                                <span className="font-bold text-red-600">
                                  {diff > 0 ? `KES ${diff.toLocaleString()} unallocated` : `KES ${Math.abs(diff).toLocaleString()} over-allocated`}
                                </span>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

        </div>

        {/* Sticky footer */}
        <div className="flex-shrink-0 border-t border-slate-200 bg-[#F6FAF8] px-4 py-2.5">
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => navigate(backToPath)}
              className="border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSaveReceipt || isSaving}
              title={canSaveReceipt ? "Save receipt" : "You do not have permission to record receipts"}
              className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-black text-white transition ${
                canSaveReceipt && !isSaving ? `${MILIK_GREEN} ${MILIK_GREEN_HOVER}` : "cursor-not-allowed bg-gray-400"
              }`}
            >
              {isSaving ? <FaSpinner className="animate-spin" /> : <FaSave />}
              {isSaving ? "Saving…" : "Save Receipt"}
            </button>
          </div>
        </div>

      </div>
    </DashboardLayout>
  );
};

export default AddReceipt;
