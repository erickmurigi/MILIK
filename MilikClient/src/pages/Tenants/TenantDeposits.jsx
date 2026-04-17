import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { FaFileInvoiceDollar, FaMoneyBillWave, FaPlus, FaReceipt, FaRedoAlt, FaSearch } from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { getTenants } from "../../redux/tenantsRedux";
import { getUnits } from "../../redux/unitRedux";
import { getProperties } from "../../redux/propertyRedux";
import { getRentPayments, createTenantInvoice } from "../../redux/apiCalls";
import { getTenantInvoices } from "../../redux/invoiceApi";
import { isSelfManagingLandlordCompany } from "../../utils/companyModules";

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";

const ensureArray = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.tenants)) return value.tenants;
  if (Array.isArray(value?.units)) return value.units;
  if (Array.isArray(value?.properties)) return value.properties;
  if (Array.isArray(value?.rentPayments)) return value.rentPayments;
  return [];
};

const safeId = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const todayInput = () => new Date().toISOString().split("T")[0];

const formatInvoiceDescriptionPeriod = (value) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return `${date.toLocaleString("en-US", { month: "short" })}/${String(date.getFullYear()).slice(-2)}`;
};

const buildDepositInvoiceDescription = (invoiceDate) => `${formatInvoiceDescriptionPeriod(invoiceDate)} Security Deposit`;

const normalizeDepositHolder = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (["landlord", "held_by_landlord"].includes(normalized)) return "landlord";
  if (
    [
      "management company",
      "management_company",
      "propertymanager",
      "property manager",
      "property_manager",
      "manager",
    ].includes(normalized)
  ) {
    return "manager";
  }
  return "";
};

const formatDepositHolderLabel = (value = "") =>
  normalizeDepositHolder(value) === "landlord" ? "Landlord" : "Management Company";

const getTenantDisplayName = (tenant) =>
  tenant?.name ||
  tenant?.tenantName ||
  [tenant?.firstName, tenant?.lastName].filter(Boolean).join(" ") ||
  "Unnamed Tenant";

const getPropertyName = (tenant, units = [], properties = []) => {
  const direct = tenant?.unit?.property?.propertyName || tenant?.property?.propertyName || tenant?.propertyName;
  if (direct) return direct;

  const unitId = tenant?.unit?._id || tenant?.unit;
  const matchedUnit = units.find((unit) => String(unit?._id || "") === String(unitId || ""));
  const propertyId = matchedUnit?.property?._id || matchedUnit?.property || tenant?.property?._id || tenant?.property;
  const matchedProperty = properties.find((property) => String(property?._id || "") === String(propertyId || ""));

  return matchedUnit?.property?.propertyName || matchedProperty?.propertyName || matchedProperty?.name || "-";
};

const getUnitName = (tenant, units = []) => {
  if (tenant?.unit?.unitNumber) return tenant.unit.unitNumber;
  const unitId = tenant?.unit?._id || tenant?.unit;
  const matchedUnit = units.find((unit) => String(unit?._id || "") === String(unitId || ""));
  return matchedUnit?.unitNumber || matchedUnit?.unitName || matchedUnit?.name || "-";
};

const buildAppliedAmountsByInvoice = (payments = []) => {
  const appliedByInvoice = new Map();

  payments.forEach((payment) => {
    if (payment?.ledgerType !== "receipts") return;
    if (payment?.isConfirmed !== true) return;
    if (payment?.isCancelled === true || payment?.isReversed === true || payment?.reversalOf) return;
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

const buildRecognizedDepositAmountsByTenant = (payments = []) => {
  const totals = new Map();

  payments.forEach((payment) => {
    if (payment?.ledgerType !== "receipts") return;
    if (payment?.isConfirmed !== true) return;
    if (payment?.isCancelled === true || payment?.isReversed === true || payment?.reversalOf) return;
    if (String(payment?.postingStatus || "").toLowerCase() === "reversed") return;

    const tenantId = safeId(payment?.tenant);
    if (!tenantId) return;

    const allocationSummary = payment?.allocationSummary || {};
    const recognizedAmount = Math.max(
      0,
      Number(allocationSummary.deposit || 0),
      String(payment?.paymentType || "").toLowerCase() === "deposit" ? Number(payment?.amount || 0) : 0
    );

    if (recognizedAmount <= 0) return;
    totals.set(tenantId, Number(totals.get(tenantId) || 0) + recognizedAmount);
  });

  return totals;
};

const TenantDeposits = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const isLandlordWorkspace = useMemo(() => isSelfManagingLandlordCompany(currentCompany || null), [currentCompany]);
  const holderColumnLabel = isLandlordWorkspace ? "Owner / Landlord" : "Deposit Holder";

  const tenants = useSelector((state) => ensureArray(state.tenant?.tenants));
  const units = useSelector((state) => ensureArray(state.unit?.units));
  const properties = useSelector((state) => ensureArray(state.property?.properties));
  const activeProperties = useMemo(
    () => properties.filter((property) => String(property?.status || "active").toLowerCase() !== "archived"),
    [properties]
  );
  const rentPayments = useSelector((state) => ensureArray(state.rentPayment?.rentPayments));

  const [tenantInvoices, setTenantInvoices] = useState([]);
  const [filters, setFilters] = useState({
    search: "",
    propertyId: "all",
    holder: "all",
    status: "all",
  });
  const [billingModal, setBillingModal] = useState({ open: false, row: null });
  const [billingForm, setBillingForm] = useState({
    amount: "",
    invoiceDate: todayInput(),
    dueDate: todayInput(),
    description: "",
  });
  const [isSaving, setIsSaving] = useState(false);

  const resetFilters = () => {
    setFilters({
      search: "",
      propertyId: "all",
      holder: "all",
      status: "all",
    });
  };

  const loadInvoices = useCallback(async () => {
    if (!currentCompany?._id) {
      setTenantInvoices([]);
      return;
    }

    try {
      const rows = await getTenantInvoices({
        business: currentCompany._id,
        category: "DEPOSIT_CHARGE",
      });
      setTenantInvoices(Array.isArray(rows) ? rows : []);
    } catch (error) {
      console.error("Failed to load tenant deposit invoices:", error);
      setTenantInvoices([]);
    }
  }, [currentCompany?._id]);

  useEffect(() => {
    if (!currentCompany?._id) return;
    dispatch(getTenants({ business: currentCompany._id }));
    dispatch(getUnits({ business: currentCompany._id }));
    dispatch(getProperties({ business: currentCompany._id }));
    getRentPayments(dispatch, currentCompany._id, null, null, null, null, "deposit");
    loadInvoices();
  }, [dispatch, currentCompany?._id, loadInvoices]);

  useEffect(() => {
    const handleRefresh = () => {
      loadInvoices();
      if (currentCompany?._id) {
        getRentPayments(dispatch, currentCompany._id, null, null, null, null, "deposit");
      }
    };

    window.addEventListener("invoicesUpdated", handleRefresh);
    return () => window.removeEventListener("invoicesUpdated", handleRefresh);
  }, [dispatch, currentCompany?._id, loadInvoices]);

  const invoiceMapByTenant = useMemo(() => {
    return tenantInvoices.reduce((acc, invoice) => {
      const tenantId = safeId(invoice?.tenant);
      if (!tenantId) return acc;
      if (!acc[tenantId]) acc[tenantId] = [];
      acc[tenantId].push(invoice);
      return acc;
    }, {});
  }, [tenantInvoices]);

  const appliedByInvoice = useMemo(() => buildAppliedAmountsByInvoice(rentPayments), [rentPayments]);
  const recognizedDepositPaidByTenant = useMemo(
    () => buildRecognizedDepositAmountsByTenant(rentPayments),
    [rentPayments]
  );

  const depositRows = useMemo(() => {
    return tenants
      .map((tenant) => {
        const tenantId = safeId(tenant);
        const unitId = tenant?.unit?._id || tenant?.unit || null;
        const matchedUnit = units.find((unit) => String(unit?._id || "") === String(unitId || "")) || null;
        const propertyId =
          tenant?.property?._id ||
          tenant?.property ||
          matchedUnit?.property?._id ||
          matchedUnit?.property ||
          tenant?.unit?.property?._id ||
          tenant?.unit?.property ||
          null;
        const matchedProperty =
          properties.find((property) => String(property?._id || "") === String(propertyId || "")) || null;
        const depositAmount = Number(tenant?.depositAmount ?? matchedUnit?.deposit ?? tenant?.unit?.deposit ?? 0);
        const depositHolder = formatDepositHolderLabel(
          tenant?.depositHeldBy || matchedProperty?.depositHeldBy || (isLandlordWorkspace ? "landlord" : "manager")
        );
        const invoices = (invoiceMapByTenant[tenantId] || []).filter((invoice) => {
          const status = String(invoice?.status || "").toLowerCase();
          return !["cancelled", "reversed"].includes(status);
        });

        const latestInvoice =
          [...invoices].sort(
            (a, b) =>
              new Date(b?.invoiceDate || b?.createdAt || 0).getTime() -
              new Date(a?.invoiceDate || a?.createdAt || 0).getTime()
          )[0] || null;

        const billed = invoices.reduce(
          (sum, invoice) => sum + Number(invoice?.adjustedAmount ?? invoice?.amount ?? 0),
          0
        );
        const invoiceAppliedPaid = invoices.reduce((sum, invoice) => {
          const invoiceId = String(invoice?._id || "");
          return sum + Math.max(0, Number(appliedByInvoice.get(invoiceId) || 0));
        }, 0);
        const recognizedReceiptPaid = Math.max(0, Number(recognizedDepositPaidByTenant.get(tenantId) || 0));
        const paid = Math.max(invoiceAppliedPaid, recognizedReceiptPaid);
        const outstanding = Math.max(0, billed - paid);

        let status = "Not configured";
        if (depositAmount > 0 && billed <= 0) status = "Unbilled";
        if (billed > 0 && paid <= 0) status = "Billed";
        if (billed > 0 && paid > 0 && outstanding > 0) status = "Partially paid";
        if (billed > 0 && outstanding <= 0) status = "Fully paid";

        return {
          tenantId,
          tenant,
          unit: matchedUnit,
          property: matchedProperty,
          propertyId: String(propertyId || ""),
          tenantName: getTenantDisplayName(tenant),
          propertyName: getPropertyName(tenant, units, properties),
          unitName: getUnitName(tenant, units),
          depositAmount,
          depositHolder,
          billed,
          paid,
          outstanding,
          status,
          invoices,
          latestInvoiceNumber: latestInvoice?.invoiceNumber || "-",
          latestInvoiceDescription: String(latestInvoice?.description || "").trim() || "-",
          latestInvoiceDate: latestInvoice?.invoiceDate || latestInvoice?.createdAt || null,
          canBill: depositAmount > 0 && invoices.length === 0,
        };
      })
      .filter((row) => {
        if (filters.propertyId !== "all" && row.propertyId !== String(filters.propertyId)) return false;
        if (filters.holder !== "all" && String(row.depositHolder).toLowerCase() !== String(filters.holder).toLowerCase())
          return false;
        if (filters.status !== "all" && String(row.status).toLowerCase() !== String(filters.status).toLowerCase())
          return false;
        if (filters.search) {
          const search = filters.search.toLowerCase();
          const haystack = `${row.tenantName} ${row.propertyName} ${row.unitName}`.toLowerCase();
          if (!haystack.includes(search)) return false;
        }
        return true;
      })
      .sort((a, b) => a.tenantName.localeCompare(b.tenantName));
  }, [
    tenants,
    units,
    properties,
    invoiceMapByTenant,
    appliedByInvoice,
    recognizedDepositPaidByTenant,
    filters,
    isLandlordWorkspace,
  ]);

  const totals = useMemo(() => {
    return depositRows.reduce(
      (acc, row) => ({
        configured: acc.configured + row.depositAmount,
        billed: acc.billed + row.billed,
        paid: acc.paid + row.paid,
        outstanding: acc.outstanding + row.outstanding,
      }),
      { configured: 0, billed: 0, paid: 0, outstanding: 0 }
    );
  }, [depositRows]);

  const openBillDepositModal = (row) => {
    if (!row?.canBill) return;
    setBillingModal({ open: true, row });
    setBillingForm({
      amount: String(row.depositAmount || ""),
      invoiceDate: todayInput(),
      dueDate: todayInput(),
      description: buildDepositInvoiceDescription(todayInput()),
    });
  };

  const handleCreateDepositInvoice = async () => {
    const row = billingModal.row;
    if (!row?.tenantId || !currentCompany?._id) return;

    const landlordId =
      row.property?.landlords?.[0]?.landlordId?._id ||
      row.property?.landlords?.[0]?.landlordId ||
      row.property?.landlords?.[0]?._id ||
      row.property?.landlords?.[0] ||
      row.tenant?.landlord?._id ||
      row.tenant?.landlord ||
      null;

    const unitId = row.unit?._id || row.tenant?.unit?._id || row.tenant?.unit || null;
    const propertyId = row.property?._id || row.tenant?.property?._id || row.tenant?.property || null;
    const amount = Number(billingForm.amount || 0);
    const normalizedDepositHolder =
      normalizeDepositHolder(
        row?.tenant?.depositHeldBy ||
          row?.depositHolder ||
          row?.property?.depositHeldBy ||
          (isLandlordWorkspace ? "landlord" : "manager")
      ) || (isLandlordWorkspace ? "landlord" : "manager");

    if (!propertyId || !unitId) {
      toast.error("Tenant deposit context is incomplete. Check property and unit linkage first.");
      return;
    }

    if (amount <= 0) {
      toast.error("Enter a valid deposit amount.");
      return;
    }

    setIsSaving(true);
    try {
      await createTenantInvoice({
        business: currentCompany._id,
        property: propertyId,
        landlord: landlordId || undefined,
        tenant: row.tenantId,
        unit: unitId,
        category: "DEPOSIT_CHARGE",
        amount,
        depositHeldBy: normalizedDepositHolder,
        ledgerMode: normalizedDepositHolder === "landlord" ? "off_ledger" : undefined,
        description: billingForm.description || `Security deposit charge for ${row.tenantName}`,
        invoiceDate: billingForm.invoiceDate,
        dueDate: billingForm.dueDate,
        metadata: {
          billItemKey: "deposit:security",
          billItemLabel: "Security Deposit",
          invoicePriorityCategory: "deposit",
          sourceTransactionType: "tenant_deposit_module",
          includeInLandlordStatement: false,
          includeInCategoryTotals: false,
          depositHeldBy: normalizedDepositHolder,
          ledgerMode: normalizedDepositHolder === "landlord" ? "off_ledger" : undefined,
        },
      });

      toast.success("Tenant deposit invoice created successfully.");
      setBillingModal({ open: false, row: null });
      setBillingForm({ amount: "", invoiceDate: todayInput(), dueDate: todayInput(), description: "" });
      await loadInvoices();
      window.dispatchEvent(new Event("invoicesUpdated"));
    } catch (error) {
      toast.error(
        error?.response?.data?.error ||
          error?.response?.data?.message ||
          error?.message ||
          "Failed to create tenant deposit invoice."
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <div className="mx-auto flex w-full max-w-[96%] flex-col gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-[#0B3B2E]">Tenant Deposits</p>
                <h1 className="mt-1 text-2xl font-black text-slate-900">Tenants Deposits</h1>
                <p className="mt-1 text-sm text-slate-500">
                  {isLandlordWorkspace
                    ? "Tighter owner-side deposit monitoring with invoice-style filters, compact actions, and a stable table layout."
                    : "Tighter deposit monitoring with invoice-style filters, compact actions, and a stable table layout."}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={loadInvoices}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-50"
                >
                  <FaRedoAlt /> Refresh
                </button>
                <button
                  onClick={() => navigate("/receipts")}
                  className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black text-white shadow-sm transition ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
                >
                  <FaReceipt /> Deposit Receipts
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Configured Deposits</p>
              <p className="mt-2 text-2xl font-black text-slate-900">KES {totals.configured.toLocaleString()}</p>
            </div>
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 shadow-sm">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-700">Billed</p>
              <p className="mt-2 text-2xl font-black text-blue-800">KES {totals.billed.toLocaleString()}</p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Paid</p>
              <p className="mt-2 text-2xl font-black text-emerald-800">KES {totals.paid.toLocaleString()}</p>
            </div>
            <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4 shadow-sm">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-700">Outstanding</p>
              <p className="mt-2 text-2xl font-black text-orange-800">KES {totals.outstanding.toLocaleString()}</p>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="sticky top-0 z-20 flex-shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[240px] flex-1">
                  <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400" />
                  <input
                    type="text"
                    value={filters.search}
                    onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                    placeholder="Tenant, property, or unit"
                    className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm shadow-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                  />
                </div>

                <select
                  value={filters.propertyId}
                  onChange={(e) => setFilters((prev) => ({ ...prev, propertyId: e.target.value }))}
                  className="rounded-lg border border-slate-300 bg-[#DDEFE1] px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                >
                  <option value="all">All properties</option>
                  {activeProperties.map((property) => (
                    <option key={property._id} value={property._id}>
                      {property.propertyName || property.name}
                    </option>
                  ))}
                </select>

                <select
                  value={filters.holder}
                  onChange={(e) => setFilters((prev) => ({ ...prev, holder: e.target.value }))}
                  className="rounded-lg border border-slate-300 bg-[#DDEFE1] px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                >
                  <option value="all">All holders</option>
                  {!isLandlordWorkspace && <option value="Management Company">Management Company</option>}
                  <option value="Landlord">{isLandlordWorkspace ? "Owner / Landlord" : "Landlord"}</option>
                </select>

                <select
                  value={filters.status}
                  onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
                  className="rounded-lg border border-slate-300 bg-[#DDEFE1] px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                >
                  <option value="all">All statuses</option>
                  <option value="not configured">Not configured</option>
                  <option value="unbilled">Unbilled</option>
                  <option value="billed">Billed</option>
                  <option value="partially paid">Partially paid</option>
                  <option value="fully paid">Fully paid</option>
                </select>

                <button
                  onClick={resetFilters}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100"
                >
                  <FaRedoAlt /> Reset
                </button>

                <div className="ml-auto flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500 shadow-sm">
                  Rows
                  <span className="text-sm text-slate-900">{depositRows.length}</span>
                </div>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full min-w-[1280px] text-sm">
                <thead>
                  <tr className={`${MILIK_GREEN} sticky top-0 z-10 text-white`}>
                    <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-[0.16em]">Tenant</th>
                    <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-[0.16em]">Property / Unit</th>
                    <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-[0.16em]">{holderColumnLabel}</th>
                    <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-[0.16em]">Deposit Invoice</th>
                    <th className="px-4 py-3 text-right text-xs font-black uppercase tracking-[0.16em]">Configured</th>
                    <th className="px-4 py-3 text-right text-xs font-black uppercase tracking-[0.16em]">Billed</th>
                    <th className="px-4 py-3 text-right text-xs font-black uppercase tracking-[0.16em]">Paid</th>
                    <th className="px-4 py-3 text-right text-xs font-black uppercase tracking-[0.16em]">Outstanding</th>
                    <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-[0.16em]">Status</th>
                    <th className="px-4 py-3 text-right text-xs font-black uppercase tracking-[0.16em]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {depositRows.length === 0 ? (
                    <tr>
                      <td colSpan="10" className="px-4 py-10 text-center text-slate-500">
                        No tenant deposits matched the current filters.
                      </td>
                    </tr>
                  ) : (
                    depositRows.map((row, index) => (
                      <tr key={row.tenantId} className={`border-t border-slate-100 align-top ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'} hover:bg-slate-50`}>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900">{row.tenantName}</div>
                          <div className="text-xs text-slate-500">Tenant ID: {row.tenantId}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900">{row.propertyName}</div>
                          <div className="text-xs text-slate-500">Unit: {row.unitName}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-700">{row.depositHolder}</td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900">{row.latestInvoiceNumber}</div>
                          <div className="text-xs text-slate-500">{row.latestInvoiceDescription}</div>
                          <div className="text-[11px] text-slate-400">{row.latestInvoiceDate ? new Date(row.latestInvoiceDate).toLocaleDateString() : "Not billed yet"}</div>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-900">KES {row.depositAmount.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-slate-700">KES {row.billed.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-slate-700">KES {row.paid.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-900">KES {row.outstanding.toLocaleString()}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">{row.status}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap justify-end gap-2">
                            <button onClick={() => navigate(`/tenant/${row.tenantId}/statement`)} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-100">
                              <FaFileInvoiceDollar /> Statement
                            </button>
                            <button onClick={() => navigate(`/receipts/new?tenant=${row.tenantId}`)} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-100">
                              <FaReceipt /> Receipt
                            </button>
                            <button onClick={() => openBillDepositModal(row)} disabled={!row.canBill} className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-black text-white transition ${MILIK_GREEN} ${MILIK_GREEN_HOVER} disabled:cursor-not-allowed disabled:opacity-50`}>
                              <FaPlus /> Bill Deposit
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {billingModal.open && billingModal.row && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Bill Tenant Deposit</h3>
                <p className="text-xs text-slate-600 mt-1">
                  {billingModal.row.tenantName} • {billingModal.row.propertyName} • {billingModal.row.unitName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBillingModal({ open: false, row: null })}
                className="text-sm font-semibold text-slate-500 hover:text-slate-700"
              >
                Close
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                <p className="font-semibold">
                  {isLandlordWorkspace ? "Owner-held deposit" : "Deposit holder"}: {billingModal.row.depositHolder}
                </p>
                <p className="mt-1">
                  Configured deposit: KES {Number(billingModal.row.depositAmount || 0).toLocaleString()}
                </p>
                <p className="mt-1 text-xs">
                  {isLandlordWorkspace
                    ? "This creates an owner-held deposit invoice using the existing deposit accounting flow. Deposit invoices remain non-taxable."
                    : "This creates a deposit invoice using the existing deposit accounting flow. Deposit invoices remain non-taxable."}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Amount</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={billingForm.amount}
                    onChange={(e) => setBillingForm((prev) => ({ ...prev, amount: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Invoice date</label>
                  <input
                    type="date"
                    value={billingForm.invoiceDate}
                    onChange={(e) => setBillingForm((prev) => ({ ...prev, invoiceDate: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Due date</label>
                  <input
                    type="date"
                    value={billingForm.dueDate}
                    onChange={(e) => setBillingForm((prev) => ({ ...prev, dueDate: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Description</label>
                  <textarea
                    value={billingForm.description}
                    onChange={(e) => setBillingForm((prev) => ({ ...prev, description: e.target.value }))}
                    rows="3"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBillingModal({ open: false, row: null })}
                className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateDepositInvoice}
                disabled={isSaving}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white ${MILIK_GREEN} ${MILIK_GREEN_HOVER} disabled:opacity-60`}
              >
                <FaMoneyBillWave /> {isSaving ? "Saving..." : "Create Deposit Invoice"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default TenantDeposits;