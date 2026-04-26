import React, { useEffect, useMemo, useState } from "react";
import { FaSave } from "react-icons/fa";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { createRentPayment, getTenantInvoices, getChartOfAccounts } from "../../redux/apiCalls";
import { getProperties } from "../../redux/propertyRedux";
import { getTenants } from "../../redux/tenantsRedux";
import { hasCompanyPermission } from "../../utils/permissions";

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
  const prefilledPaymentType = searchParams.get("paymentType") || "";
  const prefilledDescription = searchParams.get("description") || "";
  const prefilledCollectionId = searchParams.get("collectionId") || "";
  const prefilledAccountReference = searchParams.get("accountReference") || "";
  const prefilledMsisdn = searchParams.get("msisdn") || "";
  const prefilledPayerName = searchParams.get("payerName") || "";
  const { currentCompany } = useSelector((state) => state.company || {});
  const currentUser = useSelector((state) => state.auth?.currentUser || state.auth?.user || null);
  const canSaveReceipt = hasCompanyPermission(currentUser || {}, currentCompany, "receipts", "create", "propertyManagement");
  const rawProperties = useSelector((state) => state.property?.properties);
  const rawTenants = useSelector((state) => state.tenant?.tenants);

  const properties = ensureArray(rawProperties);
  const activeProperties = useMemo(
    () => properties.filter((property) => !isArchivedRecord(property)),
    [properties]
  );
  const tenants = ensureArray(rawTenants);

  const [formData, setFormData] = useState({
    propertyId: "",
    tenantId: preselectedTenantId,
    amount: prefilledAmount,
    paymentType: ["rent", "deposit", "utility", "late_fee", "other"].includes(prefilledPaymentType) ? prefilledPaymentType : "rent",
    paymentMethod: ["bank_transfer", "mobile_money", "cash", "check", "credit_card"].includes(prefilledMethod) ? prefilledMethod : "mobile_money",
    cashbook: "Main Cashbook",
    paidDirectToLandlord: isLandlordMode,
    paymentDate: todayInput(),
    dueDate: todayInput(),
    referenceNumber: prefilledReference,
    bankingDate: todayInput(),
    recordDate: todayInput(),
    description: prefilledDescription,
    isConfirmed: false,
  });
  const [priorityInvoiceKeys, setPriorityInvoiceKeys] = useState([]);
  const [tenantInvoices, setTenantInvoices] = useState([]);
  const [cashbookOptions, setCashbookOptions] = useState([]);
  const [manualSelectionMode, setManualSelectionMode] = useState(false);
  const [includeTerminatedTenants, setIncludeTerminatedTenants] = useState(Boolean(preselectedTenantId || prefilledTenantCode));

  useEffect(() => {
    if (!currentCompany?._id) return;

    const load = async () => {
      try {
        await Promise.all([
          dispatch(getProperties({ business: currentCompany._id })),
          dispatch(getTenants({ business: currentCompany._id })),
        ]);

        const [invoiceRows, chartRows] = await Promise.all([
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

        return {
          invoiceId: String(inv._id || ""),
          invoiceKey: String(inv._id || inv.invoiceNumber || periodLabel),
          period: periodLabel,
          invoiceNumber: String(inv?.invoiceNumber || "").trim(),
          invoiceLabel,
          chargeType,
          chargeTypeLabel: getChargeTypeLabel(chargeType),
          billedAmount,
          paid,
          outstanding,
          status,
        };
      })
      .filter((inv) => inv.billedAmount > 0);
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

  const combinedOutstandingInvoices = useMemo(
    () => outstandingInvoices.filter((invoice) => invoice.chargeType === "combined"),
    [outstandingInvoices]
  );

  const rentOutstandingInvoices = useMemo(
    () => outstandingInvoices.filter((invoice) => invoice.chargeType === "rent"),
    [outstandingInvoices]
  );

  const utilityOutstandingInvoices = useMemo(
    () => outstandingInvoices.filter((invoice) => invoice.chargeType === "utility"),
    [outstandingInvoices]
  );

  const depositOutstandingInvoices = useMemo(
    () => outstandingInvoices.filter((invoice) => invoice.chargeType === "deposit"),
    [outstandingInvoices]
  );

  const latePenaltyOutstandingInvoices = useMemo(
    () => outstandingInvoices.filter((invoice) => invoice.chargeType === "late_fee"),
    [outstandingInvoices]
  );

  const onPropertyChange = (propertyId) => {
    setFormData((prev) => ({
      ...prev,
      propertyId,
      tenantId: "",
    }));
  };


  const labelClass = "text-[11px] font-extrabold uppercase tracking-[0.16em] text-slate-700";
  const inputClass =
    "w-full mt-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/10";
  const sectionCardClass = "rounded-xl border border-slate-200 bg-white shadow-sm";
  const preventWheelValueChange = (event) => {
    event.currentTarget.blur();
  };

  const handleSubmit = async () => {
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

    if (!String(formData.referenceNumber || "").trim()) {
      toast.error("Reference number is required");
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

    const shouldUseManualAllocations = manualSelectionMode || priorityInvoiceKeys.length > 0;
    const payload = {
      tenant: formData.tenantId,
      unit: unitId,
      amount: Number(formData.amount),
      paymentType: formData.paymentType,
      paymentMethod: formData.paymentMethod,
      cashbook: isDirectToLandlord ? "" : formData.cashbook,
      paidDirectToLandlord: isDirectToLandlord,
      paymentDate: formData.paymentDate,
      dueDate: formData.dueDate,
      referenceNumber: String(formData.referenceNumber || "").trim(),
      bankingDate: formData.bankingDate || undefined,
      recordDate: formData.recordDate || undefined,
      description: formData.description,
      isConfirmed: formData.isConfirmed,
      ledgerType: "receipts",
      month: paymentDateObj.getMonth() + 1,
      year: paymentDateObj.getFullYear(),
      business: currentCompany._id,
      allocations: shouldUseManualAllocations ? manualAllocationRows : undefined,
      allocationMode: shouldUseManualAllocations ? "manual" : undefined,
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

    try {
      await createRentPayment(dispatch, payload);
      toast.success("Receipt created successfully");
      navigate(backToPath);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to create receipt");
    }
  };

  return (
    <DashboardLayout>
      <div className="min-h-[calc(100vh-112px)] w-full overflow-x-hidden bg-gradient-to-br from-slate-100 via-slate-50 to-white px-2 py-2 sm:px-3 lg:px-4">
        <div className="w-full max-w-none">
          <div className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_36px_rgba(15,23,42,0.08)]">
            <div className="p-3 md:p-4">

            {formData.tenantId && (
              <div className="mb-3 space-y-2">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  <div className="bg-red-50 border border-red-200 rounded-lg p-2">
                    <p className="text-[10px] font-bold uppercase text-red-700 mb-1">Total Invoiced</p>
                    <p className="text-base font-bold text-red-700">Ksh {balanceSummary.totalOwed.toLocaleString()}</p>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-2">
                    <p className="text-[10px] font-bold uppercase text-blue-700 mb-1">Current Balance</p>
                    <p className={`text-base font-bold ${balanceSummary.balance > 0 ? "text-blue-700" : "text-green-700"}`}>
                      Ksh {balanceSummary.balance.toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-green-50 border border-green-200 rounded-lg p-2">
                    <p className="text-[10px] font-bold uppercase text-green-700 mb-1">After This Receipt</p>
                    <p className={`text-base font-bold ${allocationPreview.projectedBalance > 0 ? "text-red-700" : "text-green-700"}`}>
                      Ksh {allocationPreview.projectedBalance.toLocaleString()}
                    </p>
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-2 shadow-sm">
                  <h3 className="text-[11px] font-bold text-slate-700 mb-1">Invoice Preview</h3>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-3 text-[10px]">
                    <p className="text-slate-500">
                      {manualSelectionMode
                        ? "Manual selection mode is on. Only the invoice(s) you pick below will be allocated. Any remaining amount stays as prepayment."
                        : "All active tenant invoices appear here. Click an invoice with outstanding balance to prioritize it for clearing first."}
                    </p>
                    <div className="flex items-center gap-3">
                      <label className="inline-flex items-center gap-2 font-semibold text-slate-600">
                        <input
                          type="checkbox"
                          checked={manualSelectionMode}
                          onChange={(e) => setManualSelectionMode(e.target.checked)}
                        />
                        Manual selection / prepayment mode
                      </label>
                      {priorityInvoiceKeys.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setPriorityInvoiceKeys([])}
                          className="text-blue-700 font-semibold hover:underline"
                        >
                          Clear Priority
                        </button>
                      )}
                    </div>
                  </div>
                  {outstandingInvoices.length > 0 ? (
                    <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1 rounded-lg border border-slate-200 bg-white p-1">
                      <div className="bg-white border border-violet-200 rounded p-1.5">
                        <p className="text-[10px] font-bold uppercase text-violet-700 mb-1">Combined Invoices</p>
                        {combinedOutstandingInvoices.length > 0 ? (
                          <div className="space-y-1">
                            {combinedOutstandingInvoices.map((invoice, index) => {
                              const priorityIndex = invoice.outstanding > 0 ? getPriorityIndex(invoice.invoiceKey) : null;
                              return (
                                <div
                                  key={`combined-${invoice.invoiceKey}-${index}`}
                                  onClick={() => invoice.outstanding > 0 && togglePriorityInvoice(invoice.invoiceKey)}
                                  className={`border rounded-lg px-2 py-1.5 text-[11px] grid grid-cols-1 gap-1 transition-colors sm:grid-cols-[minmax(120px,1fr)_150px_220px_auto] sm:items-center ${
                                    invoice.outstanding <= 0
                                      ? "border-slate-200 bg-slate-50 opacity-80"
                                      : priorityIndex
                                      ? "border-violet-400 bg-violet-50 cursor-pointer"
                                      : "border-slate-200 hover:bg-slate-50 cursor-pointer"
                                  }`}
                                >
                                  <span className="font-semibold text-slate-900 whitespace-nowrap">{invoice.invoiceNumber || invoice.period}</span>
                                  <span className="text-slate-600 whitespace-nowrap">Invoice: Ksh {invoice.billedAmount.toLocaleString()}</span>
                                  <span className="text-slate-600 whitespace-nowrap">Outstanding: Ksh {invoice.outstanding.toLocaleString()} · {invoice.status}</span>
                                  {priorityIndex && (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-violet-700 text-white whitespace-nowrap">
                                      #{priorityIndex}
                                    </span>
                                  )}
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-violet-100 text-violet-700 uppercase whitespace-nowrap">
                                    {invoice.chargeTypeLabel || getChargeTypeLabel(invoice.chargeType)}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500">No combined invoices.</p>
                        )}
                      </div>

                      <div className="bg-white border border-blue-200 rounded p-1.5">
                        <p className="text-[10px] font-bold uppercase text-blue-700 mb-1">Rent Invoices</p>
                        {rentOutstandingInvoices.length > 0 ? (
                          <div className="space-y-1">
                            {rentOutstandingInvoices.map((invoice, index) => {
                              const priorityIndex = invoice.outstanding > 0 ? getPriorityIndex(invoice.invoiceKey) : null;
                              return (
                                <div
                                  key={`rent-${invoice.period}-${index}`}
                                  onClick={() => invoice.outstanding > 0 && togglePriorityInvoice(invoice.invoiceKey)}
                                  className={`border rounded-lg px-2 py-1.5 text-[11px] grid grid-cols-1 gap-1 transition-colors sm:grid-cols-[minmax(120px,1fr)_150px_220px_auto] sm:items-center ${
                                    invoice.outstanding <= 0
                                      ? "border-slate-200 bg-slate-50 opacity-80"
                                      : priorityIndex
                                      ? "border-blue-400 bg-blue-50 cursor-pointer"
                                      : "border-slate-200 hover:bg-slate-50 cursor-pointer"
                                  }`}
                                >
                                  <span className="font-semibold text-slate-900 whitespace-nowrap">{invoice.invoiceNumber || invoice.period}</span>
                                  <span className="text-slate-600 whitespace-nowrap">Invoice: Ksh {invoice.billedAmount.toLocaleString()}</span>
                                  <span className="text-slate-600 whitespace-nowrap">Outstanding: Ksh {invoice.outstanding.toLocaleString()} · {invoice.status}</span>
                                  {priorityIndex && (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-700 text-white whitespace-nowrap">
                                      #{priorityIndex}
                                    </span>
                                  )}
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700 uppercase whitespace-nowrap">
                                    {invoice.chargeTypeLabel || getChargeTypeLabel(invoice.chargeType)}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500">No rent invoices.</p>
                        )}
                      </div>

                      <div className="bg-white border border-amber-200 rounded p-1.5">
                        <p className="text-[10px] font-bold uppercase text-amber-700 mb-1">Utility Invoices</p>
                        {utilityOutstandingInvoices.length > 0 ? (
                          <div className="space-y-1">
                            {utilityOutstandingInvoices.map((invoice, index) => {
                              const priorityIndex = invoice.outstanding > 0 ? getPriorityIndex(invoice.invoiceKey) : null;
                              return (
                                <div
                                  key={`utility-${invoice.period}-${index}`}
                                  onClick={() => invoice.outstanding > 0 && togglePriorityInvoice(invoice.invoiceKey)}
                                  className={`border rounded-lg px-2 py-1.5 text-[11px] grid grid-cols-1 gap-1 transition-colors sm:grid-cols-[minmax(120px,1fr)_150px_220px_auto] sm:items-center ${
                                    invoice.outstanding <= 0
                                      ? "border-slate-200 bg-slate-50 opacity-80"
                                      : priorityIndex
                                      ? "border-amber-400 bg-amber-50 cursor-pointer"
                                      : "border-slate-200 hover:bg-slate-50 cursor-pointer"
                                  }`}
                                >
                                  <span className="font-semibold text-slate-900 whitespace-nowrap">{invoice.invoiceNumber || invoice.period}</span>
                                  <span className="text-slate-600 whitespace-nowrap">Invoice: Ksh {invoice.billedAmount.toLocaleString()}</span>
                                  <span className="text-slate-600 whitespace-nowrap">Outstanding: Ksh {invoice.outstanding.toLocaleString()} · {invoice.status}</span>
                                  {priorityIndex && (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-700 text-white whitespace-nowrap">
                                      #{priorityIndex}
                                    </span>
                                  )}
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700 uppercase whitespace-nowrap">
                                    {invoice.chargeTypeLabel || getChargeTypeLabel(invoice.chargeType)}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500">No utility invoices.</p>
                        )}
                      </div>

                      <div className="bg-white border border-emerald-200 rounded p-1.5">
                        <p className="text-[10px] font-bold uppercase text-emerald-700 mb-1">Deposit Invoices</p>
                        {depositOutstandingInvoices.length > 0 ? (
                          <div className="space-y-1">
                            {depositOutstandingInvoices.map((invoice, index) => {
                              const priorityIndex = invoice.outstanding > 0 ? getPriorityIndex(invoice.invoiceKey) : null;
                              return (
                                <div
                                  key={`deposit-${invoice.period}-${index}`}
                                  onClick={() => invoice.outstanding > 0 && togglePriorityInvoice(invoice.invoiceKey)}
                                  className={`border rounded-lg px-2 py-1.5 text-[11px] grid grid-cols-1 gap-1 transition-colors sm:grid-cols-[minmax(120px,1fr)_150px_220px_auto] sm:items-center ${
                                    invoice.outstanding <= 0
                                      ? "border-slate-200 bg-slate-50 opacity-80"
                                      : priorityIndex
                                      ? "border-emerald-400 bg-emerald-50 cursor-pointer"
                                      : "border-slate-200 hover:bg-slate-50 cursor-pointer"
                                  }`}
                                >
                                  <span className="font-semibold text-slate-900 whitespace-nowrap">{invoice.invoiceNumber || invoice.period}</span>
                                  <span className="text-slate-600 whitespace-nowrap">Invoice: Ksh {invoice.billedAmount.toLocaleString()}</span>
                                  <span className="text-slate-600 whitespace-nowrap">Outstanding: Ksh {invoice.outstanding.toLocaleString()} · {invoice.status}</span>
                                  {priorityIndex && (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-700 text-white whitespace-nowrap">
                                      #{priorityIndex}
                                    </span>
                                  )}
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 uppercase whitespace-nowrap">
                                    {invoice.chargeTypeLabel || getChargeTypeLabel(invoice.chargeType)}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500">No deposit invoices.</p>
                        )}
                      </div>

                      <div className="bg-white border border-rose-200 rounded p-1.5">
                        <p className="text-[10px] font-bold uppercase text-rose-700 mb-1">Late Penalty Invoices</p>
                        {latePenaltyOutstandingInvoices.length > 0 ? (
                          <div className="space-y-1">
                            {latePenaltyOutstandingInvoices.map((invoice, index) => {
                              const priorityIndex = invoice.outstanding > 0 ? getPriorityIndex(invoice.invoiceKey) : null;
                              return (
                                <div
                                  key={`late-${invoice.invoiceKey}-${index}`}
                                  onClick={() => invoice.outstanding > 0 && togglePriorityInvoice(invoice.invoiceKey)}
                                  className={`border rounded-lg px-2 py-1.5 text-[11px] grid grid-cols-1 gap-1 transition-colors sm:grid-cols-[minmax(120px,1fr)_150px_220px_auto] sm:items-center ${
                                    invoice.outstanding <= 0
                                      ? "border-slate-200 bg-slate-50 opacity-80"
                                      : priorityIndex
                                      ? "border-rose-400 bg-rose-50 cursor-pointer"
                                      : "border-slate-200 hover:bg-slate-50 cursor-pointer"
                                  }`}
                                >
                                  <span className="font-semibold text-slate-900 whitespace-nowrap">{invoice.invoiceNumber || invoice.period}</span>
                                  <span className="text-slate-600 whitespace-nowrap">Invoice: Ksh {invoice.billedAmount.toLocaleString()}</span>
                                  <span className="text-slate-600 whitespace-nowrap">Outstanding: Ksh {invoice.outstanding.toLocaleString()} · {invoice.status}</span>
                                  {priorityIndex && (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-700 text-white whitespace-nowrap">
                                      #{priorityIndex}
                                    </span>
                                  )}
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 uppercase whitespace-nowrap">
                                    {invoice.chargeTypeLabel || getChargeTypeLabel(invoice.chargeType)}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500">No late penalty invoices.</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">No open invoices found for this tenant.</p>
                  )}
                </div>

                <div className="bg-amber-50 border border-amber-200 rounded-lg p-2">
                  <h3 className="text-[11px] font-bold text-amber-800 mb-1">Receipt Allocation Preview</h3>
                  {Number(formData.amount) > 0 ? (
                    <div className="space-y-1 text-[11px] text-amber-900">
                      {allocationPreview.lines.map((line, idx) =>
                        line.apply > 0 ? (
                          <div
                            key={`${line.period}-${line.chargeType}-${idx}`}
                            className="flex items-center justify-between bg-white border border-amber-100 rounded px-2 py-0.5"
                          >
                            <span>
                              {line.period} ({line.chargeTypeLabel || line.chargeType})
                            </span>
                            <span>
                              {line.invoiceId === PREPAYMENT_OPTION_KEY
                                ? `Hold Ksh ${line.apply.toLocaleString()} as prepayment`
                                : `Apply Ksh ${line.apply.toLocaleString()} | Remaining: Ksh ${line.afterOutstanding.toLocaleString()}`}
                            </span>
                          </div>
                        ) : null
                      )}

                      {allocationPreview.lines.every((line) => line.apply === 0) && (
                        <p className="text-xs">
                          {manualSelectionMode
                            ? "No selected invoice will receive this receipt yet. Save now to hold the amount as prepayment."
                            : "Entered amount does not apply to any open invoice yet."}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-amber-800">Enter an amount to preview how this receipt clears open invoices.</p>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.8fr)_minmax(280px,0.7fr)]">
              <div className={`${sectionCardClass} p-3 md:p-4`}>
                <div className="mb-3 flex items-center justify-between gap-3 border-b border-slate-200 pb-2">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">Receipt details</p>
                    <h2 className="mt-0.5 text-base font-black text-slate-900">Collection information</h2>
                  </div>
                  <div className="rounded-full bg-[#0B3B2E]/8 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-[#0B3B2E]">Posting-safe entry</div>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className={labelClass}>Property *</label>
                <select
                  value={formData.propertyId}
                  onChange={(e) => onPropertyChange(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Select property</option>
                  {activeProperties.map((property) => (
                    <option key={property._id} value={property._id}>
                      {property.propertyName || property.name || "Unnamed Property"}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <label className={labelClass}>Tenant *</label>
                  <label className="mt-1 inline-flex items-center gap-2 text-[11px] font-bold text-slate-600">
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
                      className="h-3.5 w-3.5 rounded border-slate-300 text-[#0B3B2E] focus:ring-[#0B3B2E]"
                      disabled={!formData.propertyId}
                    />
                    Include terminated
                  </label>
                </div>
                <select
                  value={formData.tenantId}
                  onChange={(e) => setFormData((prev) => ({ ...prev, tenantId: e.target.value }))}
                  className={inputClass}
                  disabled={!formData.propertyId}
                >
                  <option value="">{formData.propertyId ? "Select tenant" : "Select property first"}</option>
                  {tenantOptions.map((tenant) => {
                    const terminated = isTerminatedTenant(tenant);
                    return (
                      <option key={tenant._id} value={tenant._id}>
                        {getTenantName(tenant)}{terminated ? " — Terminated" : ""}
                      </option>
                    );
                  })}
                </select>
                {selectedTenant && isTerminatedTenant(selectedTenant) ? (
                  <p className="mt-1 text-xs font-semibold text-amber-700">
                    Receipting a terminated tenant is allowed for arrears, recoveries, or late settlements only. New occupancy is not restored by this receipt.
                  </p>
                ) : null}
              </div>

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

              <div>
                <label className={labelClass}>Reference Number</label>
                <input
                  type="text"
                  value={formData.referenceNumber}
                  onChange={(e) => setFormData((prev) => ({ ...prev, referenceNumber: e.target.value }))}
                  className={inputClass}
                  placeholder="Bank ref / MPESA code"
                />
              </div>

              <div>
                <label className={labelClass}>Payment Type *</label>
                <select
                  value={formData.paymentType}
                  onChange={(e) => setFormData((prev) => ({ ...prev, paymentType: e.target.value }))}
                  className={inputClass}
                >
                  <option value="rent">Rent</option>
                  <option value="deposit">Deposit</option>
                  <option value="utility">Utility</option>
                  <option value="late_fee">Late Fee</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className={labelClass}>Payment Method *</label>
                <select
                  value={formData.paymentMethod}
                  onChange={(e) => setFormData((prev) => ({ ...prev, paymentMethod: e.target.value }))}
                  className={inputClass}
                >
                  <option value="mobile_money">Mobile Money</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="cash">Cash</option>
                  <option value="check">Check</option>
                  <option value="credit_card">Credit Card</option>
                </select>
              </div>

              <div>
                <label className={labelClass}>
                  {isDirectToLandlord ? "Cashbook" : "Cashbook *"}
                </label>
                {isDirectToLandlord ? (
                  <div className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    Direct-to-landlord receipts do not hit MILIK-managed cashbooks.
                  </div>
                ) : (
                  <>
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
                    <p className="mt-1 text-[11px] text-slate-500">
                      Select where this receipt is collected for posting to journals and ledger reports.
                    </p>
                  </>
                )}
              </div>

              <div>
                <label className={labelClass}>Payment Date *</label>
                <input
                  type="date"
                  value={formData.paymentDate}
                  onChange={(e) => setFormData((prev) => ({ ...prev, paymentDate: e.target.value }))}
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Due Date *</label>
                <input
                  type="date"
                  value={formData.dueDate}
                  onChange={(e) => setFormData((prev) => ({ ...prev, dueDate: e.target.value }))}
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Banking Date</label>
                <input
                  type="date"
                  value={formData.bankingDate}
                  onChange={(e) => setFormData((prev) => ({ ...prev, bankingDate: e.target.value }))}
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Record Date</label>
                <input
                  type="date"
                  value={formData.recordDate}
                  onChange={(e) => setFormData((prev) => ({ ...prev, recordDate: e.target.value }))}
                  className={inputClass}
                />
              </div>

              <div className="md:col-span-2 xl:col-span-3">
                <label className={labelClass}>Description</label>
                <textarea
                  rows={3}
                  value={formData.description}
                  onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                  className={inputClass}
                  placeholder="Optional notes"
                />
              </div>

              <div className="md:col-span-2 xl:col-span-3 flex items-center gap-2">
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
                />
                <label htmlFor="paidDirectToLandlord" className={labelClass}>
                  Direct to landlord receipt (do not post to MILIK cashbook)
                </label>
              </div>

              <div className="md:col-span-2 xl:col-span-3 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isConfirmed"
                  checked={formData.isConfirmed}
                  onChange={(e) => setFormData((prev) => ({ ...prev, isConfirmed: e.target.checked }))}
                />
                <label htmlFor="isConfirmed" className={labelClass}>
                  Mark as confirmed
                </label>
              </div>
                </div>
              </div>
              <div className="space-y-3">
                <div className={`${sectionCardClass} p-3 md:p-4`}>
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">Posting controls</p>
                  <h2 className="mt-0.5 text-base font-black text-slate-900">Receipt status and notes</h2>
                  <p className="mt-1 text-xs text-slate-600">Use these controls only when you are ready for the receipt to participate in operational reporting and downstream posting actions.</p>
                  <div className="mt-3 space-y-3">
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      <p className="font-bold">Reference discipline</p>
                      <p className="mt-1 text-amber-800">Use the bank reference, M-Pesa code, or teller reference exactly as received so duplicates remain easy to detect during reconciliation.</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                      <p className="font-bold text-slate-900">Receipt amount wheel lock</p>
                      <p className="mt-1">Mouse-wheel changes on the Amount field are disabled to prevent accidental edits while scrolling.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                onClick={() => navigate(backToPath)}
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-bold uppercase tracking-[0.16em] text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!canSaveReceipt}
                title={canSaveReceipt ? "Save receipt" : "You do not have permission to record receipts"}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold uppercase tracking-[0.16em] text-white shadow-sm transition ${canSaveReceipt ? `${MILIK_GREEN} ${MILIK_GREEN_HOVER}` : "bg-gray-400 cursor-not-allowed"}`}
              >
                <FaSave /> Save Receipt
              </button>
            </div>
          </div>
        </div>
      </div>
      </div>
    </DashboardLayout>
  );
};

export default AddReceipt;
