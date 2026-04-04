import React, { useEffect, useMemo, useState } from "react";
import { FaArrowLeft, FaSave } from "react-icons/fa";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { createRentPayment, getRentPayments, getTenantInvoices, getChartOfAccounts } from "../../redux/apiCalls";
import { getProperties } from "../../redux/propertyRedux";
import { getTenants } from "../../redux/tenantsRedux";

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";

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

const getChargeTypeFromInvoice = (invoice) => {
  const category = String(invoice?.category || "").toUpperCase();
  if (category === "UTILITY_CHARGE") return "utility";
  if (category === "DEPOSIT_CHARGE") return "deposit";
  if (category === "LATE_PENALTY_CHARGE") return "late_fee";
  return "rent";
};

const buildAppliedAmountsByInvoice = (payments = [], tenantId = "") => {
  const appliedByInvoice = new Map();
  const tenantIdStr = String(tenantId || "");

  payments.forEach((payment) => {
    const paymentTenantId = String(payment?.tenant?._id || payment?.tenant || "");
    if (tenantIdStr && paymentTenantId !== tenantIdStr) return;
    if (payment?.isConfirmed !== true) return;
    if (payment?.isCancelled === true || payment?.isReversed === true || payment?.reversalOf) return;
    if (payment?.ledgerType !== "receipts") return;
    if (String(payment?.postingStatus || "").toLowerCase() === "reversed") return;

    (Array.isArray(payment?.allocations) ? payment.allocations : []).forEach((allocation) => {
      const invoiceId = String(allocation?.invoice || allocation?.invoiceId || "");
      if (!invoiceId) return;
      const amount = Number(allocation?.appliedAmount || 0);
      if (!amount) return;
      appliedByInvoice.set(invoiceId, Number(appliedByInvoice.get(invoiceId) || 0) + amount);
    });
  });

  return appliedByInvoice;
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

  const preselectedTenantId = searchParams.get("tenant") || "";
  const prefilledAmount = searchParams.get("amount") || "";
  const prefilledReference = searchParams.get("reference") || "";
  const prefilledMethod = searchParams.get("paymentMethod") || searchParams.get("method") || "";
  const prefilledPaymentType = searchParams.get("paymentType") || "";
  const prefilledDescription = searchParams.get("description") || "";
  const { currentCompany } = useSelector((state) => state.company || {});
  const rawProperties = useSelector((state) => state.property?.properties);
  const rawTenants = useSelector((state) => state.tenant?.tenants);
  const rawRentPayments = useSelector((state) => state.rentPayment?.rentPayments);

  const properties = ensureArray(rawProperties);
  const tenants = ensureArray(rawTenants);
  const rentPayments = ensureArray(rawRentPayments);

  const [formData, setFormData] = useState({
    propertyId: "",
    tenantId: preselectedTenantId,
    amount: prefilledAmount,
    paymentType: ["rent", "deposit", "utility", "late_fee", "other"].includes(prefilledPaymentType) ? prefilledPaymentType : "rent",
    paymentMethod: ["bank_transfer", "mobile_money", "cash", "check", "credit_card"].includes(prefilledMethod) ? prefilledMethod : "mobile_money",
    cashbook: "Main Cashbook",
    paidDirectToLandlord: false,
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

  useEffect(() => {
    if (!currentCompany?._id) return;

    const load = async () => {
      try {
        await Promise.all([
          dispatch(getProperties({ business: currentCompany._id })),
          dispatch(getTenants({ business: currentCompany._id })),
          getRentPayments(dispatch, currentCompany._id),
        ]);

        const [invoiceRows, chartRows] = await Promise.all([
          getTenantInvoices({ business: currentCompany._id }),
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
    return tenants.filter(
      (tenant) => String(getTenantPropertyId(tenant) || "") === String(formData.propertyId)
    );
  }, [tenants, formData.propertyId]);

  const selectedTenant = useMemo(
    () => tenants.find((tenant) => String(tenant._id) === String(formData.tenantId)),
    [formData.tenantId, tenants]
  );

  const isDirectToLandlord = Boolean(formData.paidDirectToLandlord);

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

    const tenantPayments = rentPayments.filter(
      (payment) =>
        String(payment?.tenant?._id || payment?.tenant || "") === String(tenantId) &&
        payment.isConfirmed === true &&
        payment.isCancelled !== true &&
        payment.isReversed !== true &&
        !payment?.reversalOf &&
        payment.ledgerType === "receipts" &&
        String(payment?.postingStatus || "").toLowerCase() !== "reversed"
    );
    const totalPaid = tenantPayments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);

    const invoices = getCreatedInvoicesForTenant(tenantId);
    const totalOwed = invoices.reduce((sum, inv) => sum + (Number((inv.netAmount ?? inv.adjustedAmount ?? inv.amount) || 0)), 0);

    return {
      totalOwed,
      totalPaid,
      balance: totalOwed - totalPaid,
    };
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

    const appliedByInvoice = buildAppliedAmountsByInvoice(rentPayments, tenantId);

    return invoices
      .map((inv) => {
        const billedAmount = Number((inv.netAmount ?? inv.adjustedAmount ?? inv.amount) || 0);
        const paid = Math.min(
          billedAmount,
          Math.max(0, Number(appliedByInvoice.get(String(inv._id || "")) || 0))
        );
        const outstanding = Math.max(0, billedAmount - paid);
        const invoiceDate = inv.invoiceDate ? new Date(inv.invoiceDate) : null;
        const periodLabel =
          invoiceDate && !Number.isNaN(invoiceDate.getTime())
            ? invoiceDate.toLocaleDateString(undefined, { month: "short", year: "numeric" })
            : inv.invoiceNumber || "Invoice";

        return {
          invoiceKey: String(inv._id || inv.invoiceNumber || periodLabel),
          period: periodLabel,
          chargeType: getChargeTypeFromInvoice(inv),
          billedAmount,
          paid,
          outstanding,
        };
      })
      .filter((inv) => inv.outstanding > 0 || inv.paid > 0);
  };

  const balanceSummary = useMemo(
    () => calculateTenantBalance(formData.tenantId),
    [formData.tenantId, rentPayments, tenantInvoices]
  );

  const outstandingInvoices = useMemo(
    () => getOutstandingInvoices(formData.tenantId),
    [formData.tenantId, rentPayments, tenantInvoices]
  );

  useEffect(() => {
    setPriorityInvoiceKeys([]);
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
    let remaining = receiptAmount;

    const lines = orderedOutstandingInvoices.map((invoice) => {
      const apply = Math.min(invoice.outstanding, Math.max(0, remaining));
      remaining -= apply;
      return {
        invoiceKey: invoice.invoiceKey,
        period: invoice.period,
        chargeType: invoice.chargeType,
        beforeOutstanding: invoice.outstanding,
        apply,
        afterOutstanding: Math.max(0, invoice.outstanding - apply),
      };
    });

    return {
      lines,
      unappliedAmount: Math.max(0, remaining),
      projectedBalance: balanceSummary.balance - receiptAmount,
    };
  }, [formData.amount, orderedOutstandingInvoices, balanceSummary.balance]);

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

  const onPropertyChange = (propertyId) => {
    setFormData((prev) => ({
      ...prev,
      propertyId,
      tenantId: "",
    }));
  };


  const labelClass = "text-[11px] font-extrabold uppercase tracking-[0.16em] text-slate-700";
  const inputClass =
    "w-full mt-1 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/10";
  const sectionCardClass = "rounded-2xl border border-slate-200 bg-white shadow-sm";
  const preventWheelValueChange = (event) => {
    event.currentTarget.blur();
  };

  const handleSubmit = async () => {
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
    };

    try {
      await createRentPayment(dispatch, payload);
      toast.success("Receipt created successfully");
      navigate(preselectedTenantId ? `/receipts/${preselectedTenantId}` : "/receipts");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to create receipt");
    }
  };

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-gradient-to-br from-slate-100 via-slate-50 to-white p-4 md:p-6">
        <div className="mx-auto max-w-6xl">
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
            <div className="border-b border-slate-200 bg-gradient-to-r from-[#0B3B2E] via-[#114b3d] to-slate-900 px-4 py-4 md:px-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <button
                onClick={() => navigate(preselectedTenantId ? `/receipts/${preselectedTenantId}` : "/receipts")}
                className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/15"
              >
                <FaArrowLeft /> Back to Receipts
              </button>
                <div className="text-white md:text-right">
                  <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-emerald-100">Rental Receipting</p>
                  <h1 className="mt-1 text-xl font-black tracking-tight md:text-2xl">Add Receipt</h1>
                  <p className="mt-1 text-sm text-slate-200">Capture tenant collections cleanly, allocate safely, and preserve ledger integrity.</p>
                </div>
              </div>
            </div>
            <div className="p-4 md:p-6">

            {formData.tenantId && (
              <div className="mb-3 space-y-2">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="bg-red-50 border border-red-200 rounded-lg p-2">
                    <p className="text-[10px] font-bold uppercase text-red-700 mb-1">Total Invoiced</p>
                    <p className="text-lg font-bold text-red-700">Ksh {balanceSummary.totalOwed.toLocaleString()}</p>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-2">
                    <p className="text-[10px] font-bold uppercase text-blue-700 mb-1">Current Balance</p>
                    <p className={`text-lg font-bold ${balanceSummary.balance > 0 ? "text-blue-700" : "text-green-700"}`}>
                      Ksh {balanceSummary.balance.toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-green-50 border border-green-200 rounded-lg p-2">
                    <p className="text-[10px] font-bold uppercase text-green-700 mb-1">After This Receipt</p>
                    <p className={`text-lg font-bold ${allocationPreview.projectedBalance > 0 ? "text-red-700" : "text-green-700"}`}>
                      Ksh {allocationPreview.projectedBalance.toLocaleString()}
                    </p>
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-lg p-2">
                  <h3 className="text-[11px] font-bold text-slate-700 mb-1">Open Invoice Breakdown</h3>
                  <div className="mb-1 flex items-center justify-between text-[10px]">
                    <p className="text-slate-500">Click an invoice row to prioritize it for clearing first.</p>
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
                  {outstandingInvoices.length > 0 ? (
                    <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                      <div className="bg-white border border-blue-200 rounded p-1.5">
                        <p className="text-[10px] font-bold uppercase text-blue-700 mb-1">Rent Invoices</p>
                        {rentOutstandingInvoices.length > 0 ? (
                          <div className="space-y-1">
                            {rentOutstandingInvoices.map((invoice, index) => {
                              const priorityIndex = getPriorityIndex(invoice.invoiceKey);
                              return (
                                <div
                                  key={`rent-${invoice.period}-${index}`}
                                  onClick={() => togglePriorityInvoice(invoice.invoiceKey)}
                                  className={`border rounded px-2 py-1 text-[11px] flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                                    priorityIndex
                                      ? "border-blue-400 bg-blue-50"
                                      : "border-slate-200 hover:bg-slate-50"
                                  }`}
                                >
                                  <span className="font-semibold text-slate-900 whitespace-nowrap">{invoice.period}</span>
                                  <span className="text-slate-600 whitespace-nowrap">Invoice: Ksh {invoice.billedAmount.toLocaleString()}</span>
                                  <span className="text-slate-600 whitespace-nowrap">Outstanding: Ksh {invoice.outstanding.toLocaleString()}</span>
                                  {priorityIndex && (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-700 text-white whitespace-nowrap">
                                      #{priorityIndex}
                                    </span>
                                  )}
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700 uppercase whitespace-nowrap">
                                    {invoice.chargeType}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500">No open rent invoices.</p>
                        )}
                      </div>

                      <div className="bg-white border border-amber-200 rounded p-1.5">
                        <p className="text-[10px] font-bold uppercase text-amber-700 mb-1">Utility Invoices</p>
                        {utilityOutstandingInvoices.length > 0 ? (
                          <div className="space-y-1">
                            {utilityOutstandingInvoices.map((invoice, index) => {
                              const priorityIndex = getPriorityIndex(invoice.invoiceKey);
                              return (
                                <div
                                  key={`utility-${invoice.period}-${index}`}
                                  onClick={() => togglePriorityInvoice(invoice.invoiceKey)}
                                  className={`border rounded px-2 py-1 text-[11px] flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                                    priorityIndex
                                      ? "border-amber-400 bg-amber-50"
                                      : "border-slate-200 hover:bg-slate-50"
                                  }`}
                                >
                                  <span className="font-semibold text-slate-900 whitespace-nowrap">{invoice.period}</span>
                                  <span className="text-slate-600 whitespace-nowrap">Invoice: Ksh {invoice.billedAmount.toLocaleString()}</span>
                                  <span className="text-slate-600 whitespace-nowrap">Outstanding: Ksh {invoice.outstanding.toLocaleString()}</span>
                                  {priorityIndex && (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-700 text-white whitespace-nowrap">
                                      #{priorityIndex}
                                    </span>
                                  )}
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700 uppercase whitespace-nowrap">
                                    {invoice.chargeType}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500">No open utility invoices.</p>
                        )}
                      </div>

                      <div className="bg-white border border-emerald-200 rounded p-1.5">
                        <p className="text-[10px] font-bold uppercase text-emerald-700 mb-1">Deposit Invoices</p>
                        {depositOutstandingInvoices.length > 0 ? (
                          <div className="space-y-1">
                            {depositOutstandingInvoices.map((invoice, index) => {
                              const priorityIndex = getPriorityIndex(invoice.invoiceKey);
                              return (
                                <div
                                  key={`deposit-${invoice.period}-${index}`}
                                  onClick={() => togglePriorityInvoice(invoice.invoiceKey)}
                                  className={`border rounded px-2 py-1 text-[11px] flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                                    priorityIndex
                                      ? "border-emerald-400 bg-emerald-50"
                                      : "border-slate-200 hover:bg-slate-50"
                                  }`}
                                >
                                  <span className="font-semibold text-slate-900 whitespace-nowrap">{invoice.period}</span>
                                  <span className="text-slate-600 whitespace-nowrap">Invoice: Ksh {invoice.billedAmount.toLocaleString()}</span>
                                  <span className="text-slate-600 whitespace-nowrap">Outstanding: Ksh {invoice.outstanding.toLocaleString()}</span>
                                  {priorityIndex && (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-700 text-white whitespace-nowrap">
                                      #{priorityIndex}
                                    </span>
                                  )}
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 uppercase whitespace-nowrap">
                                    {invoice.chargeType}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500">No open deposit invoices.</p>
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
                            <span>{line.period} ({line.chargeType})</span>
                            <span>
                              Apply Ksh {line.apply.toLocaleString()} | Remaining: Ksh {line.afterOutstanding.toLocaleString()}
                            </span>
                          </div>
                        ) : null
                      )}

                      {allocationPreview.unappliedAmount > 0 && (
                        <div className="flex items-center justify-between bg-white border border-amber-100 rounded px-2 py-0.5">
                          <span>Unapplied / Credit</span>
                          <span>Ksh {allocationPreview.unappliedAmount.toLocaleString()}</span>
                        </div>
                      )}

                      {allocationPreview.lines.every((line) => line.apply === 0) && (
                        <p className="text-xs">Entered amount does not apply to any open invoice yet.</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-amber-800">Enter an amount to preview how this receipt clears open invoices.</p>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
              <div className={`${sectionCardClass} p-4 md:p-5`}>
                <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">Receipt details</p>
                    <h2 className="mt-1 text-lg font-black text-slate-900">Collection information</h2>
                  </div>
                  <div className="rounded-full bg-[#0B3B2E]/8 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-[#0B3B2E]">Posting-safe entry</div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Property *</label>
                <select
                  value={formData.propertyId}
                  onChange={(e) => onPropertyChange(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Select property</option>
                  {properties.map((property) => (
                    <option key={property._id} value={property._id}>
                      {property.propertyName || property.name || "Unnamed Property"}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelClass}>Tenant *</label>
                <select
                  value={formData.tenantId}
                  onChange={(e) => setFormData((prev) => ({ ...prev, tenantId: e.target.value }))}
                  className={inputClass}
                  disabled={!formData.propertyId}
                >
                  <option value="">{formData.propertyId ? "Select tenant" : "Select property first"}</option>
                  {tenantOptions.map((tenant) => (
                    <option key={tenant._id} value={tenant._id}>
                      {getTenantName(tenant)}
                    </option>
                  ))}
                </select>
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

              <div className="md:col-span-2">
                <label className={labelClass}>Description</label>
                <textarea
                  rows={3}
                  value={formData.description}
                  onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                  className={inputClass}
                  placeholder="Optional notes"
                />
              </div>

              <div className="md:col-span-2 flex items-center gap-2">
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

              <div className="md:col-span-2 flex items-center gap-2">
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
              <div className="space-y-4">
                <div className={`${sectionCardClass} p-4 md:p-5`}>
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">Posting controls</p>
                  <h2 className="mt-1 text-lg font-black text-slate-900">Receipt status and notes</h2>
                  <p className="mt-1 text-sm text-slate-600">Use these controls only when you are ready for the receipt to participate in operational reporting and downstream posting actions.</p>
                  <div className="mt-4 space-y-4">
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      <p className="font-bold">Reference discipline</p>
                      <p className="mt-1 text-amber-800">Use the bank reference, M-Pesa code, or teller reference exactly as received so duplicates remain easy to detect during reconciliation.</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                      <p className="font-bold text-slate-900">Receipt amount wheel lock</p>
                      <p className="mt-1">Mouse-wheel changes on the Amount field are disabled to prevent accidental edits while scrolling.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => navigate(preselectedTenantId ? `/receipts/${preselectedTenantId}` : "/receipts")}
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-bold uppercase tracking-[0.16em] text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold uppercase tracking-[0.16em] text-white shadow-sm transition ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
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