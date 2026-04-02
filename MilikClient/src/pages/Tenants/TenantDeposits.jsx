import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { FaFileInvoiceDollar, FaMoneyBillWave, FaPlus, FaReceipt, FaSearch } from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { getTenants } from "../../redux/tenantsRedux";
import { getUnits } from "../../redux/unitRedux";
import { getProperties } from "../../redux/propertyRedux";
import { getRentPayments, createTenantInvoice } from "../../redux/apiCalls";
import { getTenantInvoices } from "../../redux/invoiceApi";

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

const TenantDeposits = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const tenants = useSelector((state) => ensureArray(state.tenant?.tenants));
  const units = useSelector((state) => ensureArray(state.unit?.units));
  const properties = useSelector((state) => ensureArray(state.property?.properties));
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
        const matchedProperty = properties.find((property) => String(property?._id || "") === String(propertyId || "")) || null;
        const depositAmount = Number(tenant?.depositAmount ?? matchedUnit?.deposit ?? tenant?.unit?.deposit ?? 0);
        const depositHolder = tenant?.depositHeldBy || (matchedProperty?.depositHeldBy === "landlord" ? "Landlord" : "Management Company");
        const invoices = (invoiceMapByTenant[tenantId] || []).filter((invoice) => {
          const status = String(invoice?.status || "").toLowerCase();
          return !["cancelled", "reversed"].includes(status);
        });

        const billed = invoices.reduce(
          (sum, invoice) => sum + Number(invoice?.adjustedAmount ?? invoice?.amount ?? 0),
          0
        );
        const paid = invoices.reduce((sum, invoice) => {
          const invoiceId = String(invoice?._id || "");
          return sum + Math.max(0, Number(appliedByInvoice.get(invoiceId) || 0));
        }, 0);
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
          canBill: depositAmount > 0 && invoices.length === 0,
        };
      })
      .filter((row) => {
        if (filters.propertyId !== "all" && row.propertyId !== String(filters.propertyId)) return false;
        if (filters.holder !== "all" && String(row.depositHolder).toLowerCase() !== String(filters.holder).toLowerCase()) return false;
        if (filters.status !== "all" && String(row.status).toLowerCase() !== String(filters.status).toLowerCase()) return false;
        if (filters.search) {
          const search = filters.search.toLowerCase();
          const haystack = `${row.tenantName} ${row.propertyName} ${row.unitName}`.toLowerCase();
          if (!haystack.includes(search)) return false;
        }
        return true;
      })
      .sort((a, b) => a.tenantName.localeCompare(b.tenantName));
  }, [tenants, units, properties, invoiceMapByTenant, appliedByInvoice, filters]);

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
      description: `Security deposit charge for ${row.tenantName}`,
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

    if (!propertyId || !unitId || !landlordId) {
      toast.error("Tenant deposit context is incomplete. Check property, unit, and landlord linkage first.");
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
        landlord: landlordId,
        tenant: row.tenantId,
        unit: unitId,
        category: "DEPOSIT_CHARGE",
        amount,
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
      <div className="space-y-6 p-4 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Tenants Deposits</h1>
            <p className="text-sm text-slate-600 mt-1">
              View, bill, and monitor tenant deposits using the existing invoice, receipt, and ledger foundation.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => navigate("/receipts")}
              className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Deposit Receipts
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Configured deposits</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">KES {totals.configured.toLocaleString()}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Billed</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">KES {totals.billed.toLocaleString()}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Paid</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">KES {totals.paid.toLocaleString()}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Outstanding</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">KES {totals.outstanding.toLocaleString()}</p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">Search</label>
              <div className="relative">
                <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
                <input
                  type="text"
                  value={filters.search}
                  onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                  placeholder="Tenant, property, or unit"
                  className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Property</label>
              <select
                value={filters.propertyId}
                onChange={(e) => setFilters((prev) => ({ ...prev, propertyId: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="all">All properties</option>
                {properties.map((property) => (
                  <option key={property._id} value={property._id}>
                    {property.propertyName || property.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Holder</label>
              <select
                value={filters.holder}
                onChange={(e) => setFilters((prev) => ({ ...prev, holder: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="all">All holders</option>
                <option value="Management Company">Management Company</option>
                <option value="Landlord">Landlord</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Status</label>
              <select
                value={filters.status}
                onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="all">All statuses</option>
                <option value="not configured">Not configured</option>
                <option value="unbilled">Unbilled</option>
                <option value="billed">Billed</option>
                <option value="partially paid">Partially paid</option>
                <option value="fully paid">Fully paid</option>
              </select>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Tenant</th>
                  <th className="px-4 py-3 text-left font-semibold">Property / Unit</th>
                  <th className="px-4 py-3 text-left font-semibold">Holder</th>
                  <th className="px-4 py-3 text-right font-semibold">Configured</th>
                  <th className="px-4 py-3 text-right font-semibold">Billed</th>
                  <th className="px-4 py-3 text-right font-semibold">Paid</th>
                  <th className="px-4 py-3 text-right font-semibold">Outstanding</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {depositRows.length === 0 ? (
                  <tr>
                    <td colSpan="9" className="px-4 py-6 text-center text-slate-500">
                      No tenant deposits matched the current filters.
                    </td>
                  </tr>
                ) : (
                  depositRows.map((row) => (
                    <tr key={row.tenantId} className="border-t border-slate-100 align-top">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{row.tenantName}</div>
                        <div className="text-xs text-slate-500">Tenant ID: {row.tenantId}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{row.propertyName}</div>
                        <div className="text-xs text-slate-500">Unit: {row.unitName}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{row.depositHolder}</td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-900">KES {row.depositAmount.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-slate-700">KES {row.billed.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-slate-700">KES {row.paid.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-900">KES {row.outstanding.toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                          {row.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            onClick={() => navigate(`/tenant/${row.tenantId}/statement`)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            <FaFileInvoiceDollar /> Statement
                          </button>
                          <button
                            onClick={() => navigate(`/receipts/new?tenant=${row.tenantId}`)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            <FaReceipt /> Receipt
                          </button>
                          <button
                            onClick={() => openBillDepositModal(row)}
                            disabled={!row.canBill}
                            className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white ${MILIK_GREEN} ${MILIK_GREEN_HOVER} disabled:opacity-50 disabled:cursor-not-allowed`}
                          >
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

      {billingModal.open && billingModal.row && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Bill Tenant Deposit</h3>
                <p className="text-xs text-slate-600 mt-1">{billingModal.row.tenantName} • {billingModal.row.propertyName} • {billingModal.row.unitName}</p>
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
                <p className="font-semibold">Deposit holder: {billingModal.row.depositHolder}</p>
                <p className="mt-1">Configured deposit: KES {Number(billingModal.row.depositAmount || 0).toLocaleString()}</p>
                <p className="mt-1 text-xs">This creates a deposit invoice using the existing deposit accounting flow. Deposit invoices remain non-taxable.</p>
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
