import React, { useCallback, useEffect, useMemo, useState } from "react";
import { fmtDate } from "../../utils/dates";
import { buildTenantOption } from "../../utils/tenantUtils";
import { useDispatch, useSelector } from "react-redux";
import {
  selectCurrentCompany,
  selectAllTenants,
  selectAllProperties,
} from "../../redux/selectors";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { useTerms } from "../../hooks/useTerm";
import {
  FaPlus,
  FaSearch,
  FaRedoAlt,
  FaEye,
  FaEdit,
  FaTrash,
  FaFilter,
  FaMoneyBillWave,
  FaTimes,
  FaSave,
  FaWrench,
} from "react-icons/fa";
import toast from "react-hot-toast";
import MilikConfirmDialog from "../../components/Modals/MilikConfirmDialog";
import { getTenants } from "../../redux/tenantsRedux";
import { getProperties } from "../../redux/propertyRedux";
import {
  createTenantInvoice,
  deleteTenantInvoice,
  getTakeOnBalances,
  updateTakeOnBalance,
} from "../../redux/invoiceApi";
import { createRentPayment, reverseRentPayment, getChartOfAccounts } from "../../redux/apiCalls";
import { adminRequests } from "../../utils/requestMethods";
import { useTabState } from "../../hooks/useTabState";
import AppSelect from "../../components/common/AppSelect";
import MilikTable from "../../components/common/MilikTable";
import PaginationBar from "../../components/PaginationBar";

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";
const MILIK_ORANGE = "bg-[#FF8C00]";
const MILIK_ORANGE_HOVER = "hover:bg-[#e67e00]";

const billItemOptions = [
  { value: "rent", label: "Rent", category: "RENT_CHARGE", defaultLabel: "Rent" },
  { value: "utility", label: "Utility", category: "UTILITY_CHARGE", defaultLabel: "Utility" },
  { value: "deposit", label: "Deposit", category: "DEPOSIT_CHARGE", defaultLabel: "Deposit" },
  { value: "late_penalty", label: "Late Penalty", category: "LATE_PENALTY_CHARGE", defaultLabel: "Late Penalty" },
];

const emptyFilters = {
  search: "",
  tenant: "",
  propertyId: "",
  billItem: "",
  type: "",
  status: "",
};

const emptyForm = {
  tenantId: "",
  billItem: "rent",
  type: "debit",
  utilityLabel: "",
  amount: "",
  effectiveDate: new Date().toISOString().slice(0, 10),
  description: "",
  openingBalanceAccountId: "",
  propertyId: "",
  tenantSearch: "",
};

const normalizeId = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const getTenantDisplayName = (tenant) =>
  tenant?.name ||
  tenant?.tenantName ||
  [tenant?.firstName, tenant?.lastName].filter(Boolean).join(" ") ||
  "—";

const getUnitDisplay = (unit) => unit?.unitNumber || unit?.unitName || unit?.name || "—";

const getPropertyDisplay = (property) => property?.propertyName || property?.name || "—";

const getTenantPropertyId = (tenant) =>
  normalizeId(tenant?.unit?.property?._id || tenant?.unit?.property || tenant?.property?._id || tenant?.property);

const getTenantPropertyRecord = (tenant) => {
  const unitProperty = tenant?.unit?.property;
  if (unitProperty && typeof unitProperty === "object") return unitProperty;
  const tenantProperty = tenant?.property;
  if (tenantProperty && typeof tenantProperty === "object") return tenantProperty;
  return null;
};

const formatCurrency = (value) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 2,
  }).format(Number(value || 0));


const statusMeta = {
  unallocated: { label: "Unallocated", classes: "bg-amber-100 text-amber-800" },
  partially_allocated: { label: "Partially Allocated", classes: "bg-blue-100 text-blue-800" },
  fully_allocated: { label: "Fully Allocated", classes: "bg-emerald-100 text-emerald-800" },
};

function TakeOnBalanceModal({
  open,
  mode = "create",
  form,
  setForm,
  tenants,
  properties = [],
  filterBillItemOptions,
  chartAccounts = [],
  onClose,
  onSave,
  saving,
}) {
  const { tenant: termTenant, unit: termUnit, property: termProperty } = useTerms("tenant", "unit", "property");
  const selectedTenant =
    tenants.find((tenant) => normalizeId(tenant._id) === normalizeId(form.tenantId)) || null;
  const selectedUnit = selectedTenant?.unit || null;
  const selectedBillItem =
    billItemOptions.find((item) => item.value === form.billItem) || billItemOptions[0];

  const propertyOptions = useMemo(() => {
    const map = new Map();

    (Array.isArray(properties) ? properties : []).forEach((property) => {
      const propertyId = normalizeId(property?._id || property?.id);
      if (propertyId && !map.has(propertyId)) {
        map.set(propertyId, property);
      }
    });

    (Array.isArray(tenants) ? tenants : []).forEach((tenant) => {
      const propertyId = getTenantPropertyId(tenant);
      const propertyRecord = getTenantPropertyRecord(tenant);
      if (propertyId && propertyRecord && !map.has(propertyId)) {
        map.set(propertyId, propertyRecord);
      }
    });

    return Array.from(map.values()).sort((a, b) =>
      getPropertyDisplay(a).localeCompare(getPropertyDisplay(b))
    );
  }, [properties, tenants]);

  const selectedPropertyId = normalizeId(form.propertyId || getTenantPropertyId(selectedTenant));
  const selectedProperty = useMemo(() => {
    const fromList = propertyOptions.find(
      (property) => normalizeId(property?._id || property?.id) === selectedPropertyId
    );
    if (fromList) return fromList;
    return getTenantPropertyRecord(selectedTenant);
  }, [propertyOptions, selectedPropertyId, selectedTenant]);

  const filteredTenants = useMemo(() => {
    const searchTerm = String(form.tenantSearch || "").trim().toLowerCase();

    if (!selectedPropertyId && mode !== "edit") {
      return [];
    }

    return (Array.isArray(tenants) ? tenants : []).filter((tenant) => {
      const tenantPropertyId = getTenantPropertyId(tenant);
      if (selectedPropertyId && tenantPropertyId !== selectedPropertyId) {
        return false;
      }

      if (!searchTerm) return true;

      const haystack = [
        getTenantDisplayName(tenant),
        getUnitDisplay(tenant?.unit),
        getPropertyDisplay(getTenantPropertyRecord(tenant)),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(searchTerm);
    });
  }, [tenants, selectedPropertyId, form.tenantSearch, mode]);

  const propertySelectOptions = useMemo(
    () => propertyOptions.map((property) => ({ value: normalizeId(property?._id || property?.id), label: getPropertyDisplay(property) })),
    [propertyOptions]
  );

  const filteredTenantOptions = useMemo(
    () => filteredTenants.map((tenant) => buildTenantOption(tenant)),
    [filteredTenants]
  );

  const chartAccountOptions = useMemo(
    () => chartAccounts.map((account) => ({ value: account._id, label: `[${account.code || "---"}] ${account.name}` })),
    [chartAccounts]
  );

  useEffect(() => {
    if (!open) return;
    if (form.billItem !== "utility" && form.utilityLabel) {
      setForm((prev) => ({ ...prev, utilityLabel: "" }));
    }
  }, [form.billItem, form.utilityLabel, open, setForm]);

  useEffect(() => {
    if (!open || !form.propertyId || !form.tenantId) return;
    const matchesSelectedProperty = getTenantPropertyId(selectedTenant) === normalizeId(form.propertyId);
    if (!matchesSelectedProperty) {
      setForm((prev) => ({ ...prev, tenantId: "" }));
    }
  }, [open, form.propertyId, form.tenantId, selectedTenant, setForm]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
      <div className="flex w-full max-w-3xl max-h-[90vh] flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
          <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide">
            {mode === "edit" ? "Edit Take-On Balance" : "Add Take-On Balance"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-white/70 transition-colors hover:text-white"
          >
            <FaTimes size={12} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto bg-white px-5 py-4">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-[1fr_260px]">
            {/* Left — form fields */}
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">{termProperty}</label>
                <AppSelect
                  value={form.propertyId}
                  onChange={(v) => setForm((prev) => ({ ...prev, propertyId: v ?? "", tenantId: "" }))}
                  options={propertySelectOptions}
                  placeholder="Select property"
                  searchable
                  disabled={mode === "edit"}
                  size="md"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Find {termTenant}</label>
                <div className="relative">
                  <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={10} />
                  <input
                    value={form.tenantSearch}
                    onChange={(e) => setForm((prev) => ({ ...prev, tenantSearch: e.target.value }))}
                    placeholder={`Type ${termTenant.toLowerCase()} name, ${termUnit.toLowerCase()}, or ${termProperty.toLowerCase()}`}
                    className="w-full border border-slate-300 py-2 pl-8 pr-3 text-xs shadow-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">{termTenant}</label>
                <AppSelect
                  value={form.tenantId}
                  onChange={(v) => setForm((prev) => ({ ...prev, tenantId: v ?? "" }))}
                  options={filteredTenantOptions}
                  placeholder={form.propertyId ? `Select ${termTenant.toLowerCase()}` : `Select ${termProperty.toLowerCase()} first`}
                  searchable
                  disabled={mode === "edit" || (!form.propertyId && mode !== "edit")}
                  size="md"
                />
                {!filteredTenants.length && form.propertyId && (
                  <p className="mt-1.5 text-[10px] text-slate-400">No tenants matched.</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Bill Item</label>
                  <AppSelect
                    value={form.billItem}
                    onChange={(v) => setForm((prev) => ({ ...prev, billItem: v ?? "rent" }))}
                    options={Array.isArray(filterBillItemOptions) ? filterBillItemOptions : []}
                    size="md"
                  />
                </div>

                {form.billItem === "utility" ? (
                  <div>
                    <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Utility Type</label>
                    <AppSelect
                      value={form.utilityLabel}
                      onChange={(v) => setForm((prev) => ({ ...prev, utilityLabel: v ?? "" }))}
                      options={[
                        { value: "Water", label: "Water" },
                        { value: "Electricity", label: "Electricity" },
                        { value: "Gas", label: "Gas" },
                        { value: "Garbage", label: "Garbage" },
                        { value: "Internet", label: "Internet" },
                        { value: "Security", label: "Security" },
                        { value: "Service Charge", label: "Service Charge" },
                      ]}
                      placeholder="Select type"
                      size="md"
                    />
                  </div>
                ) : <div />}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Type</label>
                  <AppSelect
                    value={form.type}
                    onChange={(v) => setForm((prev) => ({ ...prev, type: v ?? "debit" }))}
                    options={[
                      { value: "debit", label: "Debit" },
                      { value: "credit", label: "Credit" },
                    ]}
                    disabled={mode === "edit" && form.type === "credit"}
                    size="md"
                  />
                  <p className="mt-1 text-[10px] leading-4 text-slate-400">
                    {form.type === "credit"
                      ? "Creates an opening credit posted through the selected account."
                      : "Raises an opening charge on the tenant ledger."}
                  </p>
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Amount</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.amount}
                    onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                    placeholder="0.00"
                    className="w-full border border-slate-300 px-3 py-2 text-xs shadow-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
                  />
                </div>
              </div>

              {form.type === "credit" && (
                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Opening Balance Posting Account</label>
                  <AppSelect
                    value={form.openingBalanceAccountId}
                    onChange={(v) => setForm((prev) => ({ ...prev, openingBalanceAccountId: v ?? "" }))}
                    options={chartAccountOptions}
                    placeholder="Select account"
                    searchable
                    size="md"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Effective Date</label>
                  <input
                    type="date"
                    value={form.effectiveDate}
                    onChange={(e) => setForm((prev) => ({ ...prev, effectiveDate: e.target.value }))}
                    className="w-full border border-slate-300 px-3 py-2 text-xs shadow-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
                  />
                </div>
                <div />
              </div>

              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Notes / Description</label>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="Optional narration for this take-on balance"
                  className="w-full border border-slate-300 px-3 py-2 text-xs shadow-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
                />
              </div>
            </div>

            {/* Right — preview + guide */}
            <div className="space-y-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-[9px] font-bold uppercase tracking-[0.24em] text-slate-400">
                  Selection Preview
                </p>
                <div className="mt-3 divide-y divide-slate-100">
                  {[
                    [termTenant, getTenantDisplayName(selectedTenant)],
                    [termProperty, getPropertyDisplay(selectedProperty)],
                    [termUnit, getUnitDisplay(selectedUnit)],
                    ["Bill Item", form.billItem === "utility" ? (form.utilityLabel || "Utility") : selectedBillItem.defaultLabel],
                    ["Amount", formatCurrency(form.amount || 0)],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-2 py-2">
                      <span className="text-[10px] text-slate-400">{label}</span>
                      <span className="text-right text-[10px] font-semibold text-slate-800">{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-[#0B3B2E]/10 bg-[#0B3B2E]/5 p-4">
                <p className="text-[10px] font-bold text-[#0B3B2E]">How this works</p>
                <ul className="mt-2 space-y-1.5">
                  {[
                    "Choose a property first so only the right tenants appear.",
                    "Each row is stored as a dedicated invoice flagged as a take-on balance.",
                    "Allocated and Balance values are computed live from the allocation engine.",
                    "Edits are locked once the balance is allocated.",
                  ].map((tip) => (
                    <li key={tip} className="flex gap-2 text-[10px] leading-4 text-slate-600">
                      <span className="mt-0.5 shrink-0 text-[#0B3B2E]">•</span>
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-black uppercase text-white shadow-sm transition bg-[#0B3B2E] hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <FaSave size={11} />
            {saving ? "Saving…" : mode === "edit" ? "Save Changes" : "Save Take-On Balance"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TakeOnViewModal({ open, row, onClose }) {
  const { tenant: termTenant, unit: termUnit } = useTerms("tenant", "unit");
  if (!open || !row) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
      <div className="flex w-full max-w-2xl max-h-[90vh] flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
          <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide">{row.billItemLabel}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-white/70 transition-colors hover:text-white"
          >
            <FaTimes />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto grid grid-cols-1 gap-4 px-6 py-6 md:grid-cols-2">
          {[
            [termTenant, getTenantDisplayName(row.tenant)],
            [termUnit, getUnitDisplay(row.unit)],
            ["Type", row.type],
            ["Amount", formatCurrency(row.amount)],
            ["Allocated", formatCurrency(row.allocated)],
            ["Balance", formatCurrency(row.balance)],
            ["Effective Date", fmtDate(row.effectiveDate)],
            [row.entryModel === "receipt" ? "Receipt Number" : "Invoice Number", row.invoiceNumber || "—"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                {label}
              </p>
              <p className="mt-2 text-[10px] font-semibold text-slate-900">{value}</p>
            </div>
          ))}
          <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Description
            </p>
            <p className="mt-2 text-[10px] leading-6 text-slate-700">{row.description || "—"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

const TakeOnBalances = () => {
  const dispatch = useDispatch();
  const currentCompany = useSelector(selectCurrentCompany);
  const tenantState = useSelector(selectAllTenants);
  const { tenant: termTenant, tenants: termTenants, unit: termUnit, units: termUnits, property: termProperty, properties: termProperties } = useTerms("tenant", "tenants", "unit", "units", "property", "properties");
  const propertyState = useSelector(selectAllProperties);
  const tenants = useMemo(
    () => Array.isArray(tenantState) ? tenantState : Array.isArray(tenantState?.data) ? tenantState.data : [],
    [tenantState]
  );
  const properties = useMemo(
    () => Array.isArray(propertyState) ? propertyState : Array.isArray(propertyState?.data) ? propertyState.data : [],
    [propertyState]
  );

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [appliedFilters, setAppliedFilters] = useTabState("/tenants/take-on-balances:appliedFilters", emptyFilters);
  const [draftFilters, setDraftFilters] = useState(appliedFilters);
  const setFilter = (key) => (e) => setDraftFilters((prev) => ({ ...prev, [key]: e.target.value }));
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState("create");
  const [form, setForm] = useState(emptyForm);
  const [selectedRow, setSelectedRow] = useTabState("/tenants/take-on-balances:selectedRow", null);
  const [rowToDelete, setRowToDelete] = useState(null);
  const [currentPage, setCurrentPage] = useTabState("/tenants/take-on-balances:currentPage", 1);
  const [pageSize, setPageSize] = useState(50);
  const [expandedBalanceId, setExpandedBalanceId] = useState(null);
  const [chartAccounts, setChartAccounts] = useState([]);
  const [fixingDeposits, setFixingDeposits] = useState(false);
  const propertyOptions = useMemo(() => {
    const map = new Map();

    properties.forEach((property) => {
      const propertyId = normalizeId(property?._id || property?.id);
      if (propertyId && !map.has(propertyId)) {
        map.set(propertyId, property);
      }
    });

    tenants.forEach((tenant) => {
      const propertyId = getTenantPropertyId(tenant);
      const propertyRecord = getTenantPropertyRecord(tenant);
      if (propertyId && propertyRecord && !map.has(propertyId)) {
        map.set(propertyId, propertyRecord);
      }
    });

    return Array.from(map.values()).sort((a, b) =>
      getPropertyDisplay(a).localeCompare(getPropertyDisplay(b))
    );
  }, [properties, tenants]);

  const tenantSelectOptions = useMemo(
    () => tenants.filter((tenant) => !draftFilters.propertyId || getTenantPropertyId(tenant) === draftFilters.propertyId).map((tenant) => (<option key={tenant._id} value={tenant._id}>{getTenantDisplayName(tenant)}</option>)),
    [tenants, draftFilters.propertyId]
  );

  const propertyLookup = useMemo(() => {
    const map = new Map();
    propertyOptions.forEach((property) => {
      const propertyId = normalizeId(property?._id || property?.id);
      if (propertyId) map.set(propertyId, property);
    });
    return map;
  }, [propertyOptions]);

  const getRowPropertyId = (row) =>
    normalizeId(getTenantPropertyId(row?.tenant) || row?.property?._id || row?.property || "");

  const getRowPropertyName = (row) => {
    const propertyId = getRowPropertyId(row);
    const propertyRecord = propertyLookup.get(propertyId);
    return getPropertyDisplay(propertyRecord || row?.property || getTenantPropertyRecord(row?.tenant));
  };

  const loadRows = useCallback(async () => {
    if (!currentCompany?._id) return;
    try {
      setLoading(true);
      const data = await getTakeOnBalances({ business: currentCompany._id });
      setRows(Array.isArray(data) ? data : []);
    } catch (error) {
      toast.error(
        error?.response?.data?.message || error?.message || "Failed to load take-on balances."
      );
    } finally {
      setLoading(false);
    }
  }, [currentCompany?._id]);

  useEffect(() => {
    if (!currentCompany?._id) return;
    dispatch(getTenants({ business: currentCompany._id }));
    dispatch(getProperties({ business: currentCompany._id }));
    loadRows();
    (async () => {
      try {
        const accounts = await getChartOfAccounts({ business: currentCompany._id });
        setChartAccounts(Array.isArray(accounts) ? accounts : []);
      } catch {
        setChartAccounts([]);
      }
    })();
  }, [dispatch, currentCompany?._id, loadRows]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const searchHaystack = [
        getTenantDisplayName(row.tenant),
        getUnitDisplay(row.unit),
        row.billItemLabel,
        row.invoiceNumber,
        row.description,
      ]
        .join(" ")
        .toLowerCase();

      if (appliedFilters.search && !searchHaystack.includes(appliedFilters.search.toLowerCase())) {
        return false;
      }
      if (appliedFilters.tenant && normalizeId(row.tenant?._id || row.tenant) !== appliedFilters.tenant) {
        return false;
      }
      if (appliedFilters.propertyId && getRowPropertyId(row) !== appliedFilters.propertyId) {
        return false;
      }
      if (appliedFilters.billItem && row.billItemKey !== appliedFilters.billItem) {
        return false;
      }
      if (appliedFilters.type && String(row.type || "").toLowerCase() !== appliedFilters.type.toLowerCase()) {
        return false;
      }
      if (appliedFilters.status && row.status !== appliedFilters.status) {
        return false;
      }
      return true;
    });
  }, [rows, appliedFilters]);

  const propertyFilterOptions = useMemo(
    () => propertyOptions.map((property) => ({ value: normalizeId(property._id || property.id), label: getPropertyDisplay(property) })),
    [propertyOptions]
  );

  const tenantFilterOptions = useMemo(
    () => tenants
      .filter((t) => !draftFilters.propertyId || getTenantPropertyId(t) === draftFilters.propertyId)
      .map((t) => buildTenantOption(t)),
    [tenants, draftFilters.propertyId]
  );

  const filterBillItemOptions = useMemo(() => {
    const base = billItemOptions.map((option) => ({
      value: option.value,
      label: option.label,
    }));

    const extras = rows
      .filter((row) => row.billItemKey && row.billItemLabel)
      .map((row) => ({
        value: row.billItemKey,
        label: row.billItemLabel,
      }));

    const map = new Map();
    [...base, ...extras].forEach((item) => {
      if (!map.has(item.value)) {
        map.set(item.value, item);
      }
    });

    return Array.from(map.values());
  }, [rows]);

  const totals = useMemo(() => {
    return filteredRows.reduce(
      (acc, row) => {
        acc.amount += Number(row.amount || 0);
        acc.allocated += Number(row.allocated || 0);
        acc.balance += Number(row.balance || 0);
        return acc;
      },
      { amount: 0, allocated: 0, balance: 0 }
    );
  }, [filteredRows]);

  const openCreateModal = () => {
    setModalMode("create");
    setForm({ ...emptyForm });
    setShowModal(true);
  };

  const openEditModal = (row) => {
    if (Number(row.allocated || 0) > 0) {
      toast.error("This take-on balance has allocations and cannot be edited. Reverse it instead.");
      return;
    }
    setModalMode("edit");
    setSelectedRow(row);
    setForm({
      tenantId: normalizeId(row.tenant?._id || row.tenant),
      billItem:
        row.billItemKey?.startsWith("utility:") || row.billItemKey === "utility"
          ? "utility"
          : row.billItemKey || "rent",
      utilityLabel: row.billItemKey?.startsWith("utility:") ? row.billItemLabel || "" : "",
      type: String(row.type || "Debit").toLowerCase() === "credit" ? "credit" : "debit",
      amount: String(Number(row.amount || 0)),
      effectiveDate: row.effectiveDate
        ? new Date(row.effectiveDate).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10),
      description: row.description || "",
      openingBalanceAccountId: row?.metadata?.openingBalanceAccountId || "",
      propertyId: normalizeId(row.property?._id || row.property || getTenantPropertyId(row.tenant) || ""),
      tenantSearch: "",
    });
    setShowModal(true);
  };

  const buildPayloadFromForm = () => {
    const selectedTenant = tenants.find(
      (tenant) => normalizeId(tenant._id) === normalizeId(form.tenantId)
    );

    if (!selectedTenant?._id) {
      throw new Error("Select a tenant before saving the take-on balance.");
    }

    const tenantUnit = selectedTenant?.unit;
    const tenantPropertyId = getTenantPropertyId(selectedTenant) || normalizeId(form.propertyId);
    if (!tenantUnit?._id || !tenantPropertyId) {
      throw new Error("Selected tenant must have a valid unit and property.");
    }

    const option = billItemOptions.find((item) => item.value === form.billItem) || billItemOptions[0];
    const utilityLabel = String(form.utilityLabel || "").trim();
    const billItemLabel =
      form.billItem === "utility" ? utilityLabel || "Utility" : option.defaultLabel;

    const billItemKey =
      form.billItem === "utility"
        ? `utility:${billItemLabel.toLowerCase().replace(/\s+/g, "_")}`
        : option.value;

    const baseDescription =
      form.description?.trim() ||
      `Opening ${billItemLabel.toLowerCase()} take-on balance for ${getTenantDisplayName(selectedTenant)}`;

    if (form.type === "credit") {
      const effectiveDate = new Date(form.effectiveDate || new Date());
      const paymentType =
        form.billItem === "late_penalty"
          ? "late_fee"
          : form.billItem === "utility"
          ? "utility"
          : form.billItem === "deposit"
          ? "deposit"
          : "rent";

      return {
        business: currentCompany._id,
        tenant: selectedTenant._id,
        unit: tenantUnit._id,
        property: tenantPropertyId,
        amount: Number(form.amount || 0),
        paymentType,
        paymentDate: form.effectiveDate,
        bankingDate: form.effectiveDate,
        recordDate: form.effectiveDate,
        dueDate: form.effectiveDate,
        month: effectiveDate.getMonth() + 1,
        year: effectiveDate.getFullYear(),
        referenceNumber: `TOB-CR-${Date.now()}`,
        description: baseDescription,
        isConfirmed: true,
        paymentMethod: "bank_transfer",
        cashbook: "",
        paidDirectToLandlord: false,
        metadata: {
          isTakeOnBalance: true,
          sourceTransactionType: "tenant_take_on_balance",
          takeOnType: "credit",
          takeOnBillItemKey: billItemKey,
          takeOnBillItemLabel: billItemLabel,
          paymentType,
          openingBalanceAccountId: form.openingBalanceAccountId,
          ...(form.billItem === "utility" ? { utilityType: billItemLabel, utilityName: billItemLabel } : {}),
        },
      };
    }

    return {
      business: currentCompany._id,
      property: tenantPropertyId,
      landlord: null,
      tenant: selectedTenant._id,
      unit: tenantUnit._id,
      category: option.category,
      amount: Number(form.amount || 0),
      description: baseDescription,
      invoiceDate: form.effectiveDate,
      dueDate: form.effectiveDate,
      metadata: {
        isTakeOnBalance: true,
        sourceTransactionType: "tenant_take_on_balance",
        billItemKey,
        billItemLabel,
        takeOnType: "debit",
        ...(form.billItem === "utility" ? { utilityType: billItemLabel } : {}),
      },
    };
  };

  const handleSave = async () => {
    try {
      if (!form.propertyId) throw new Error("Property is required.");
      if (!form.tenantId) throw new Error("Tenant is required.");
      if (Number(form.amount || 0) <= 0) throw new Error("Amount must be greater than zero.");
      if (Number(form.amount || 0) > 10_000_000) {
        throw new Error("Amount exceeds KES 10,000,000 — please verify for any typos.");
      }
      if (!form.effectiveDate) throw new Error("Effective date is required.");
      if (new Date(form.effectiveDate) > new Date()) {
        throw new Error("Effective date cannot be in the future. Take-on balances are historical migration entries.");
      }
      if (form.billItem === "utility" && !String(form.utilityLabel || "").trim()) {
        throw new Error("Enter the utility name for this take-on balance.");
      }
      if (form.type === "credit" && !form.openingBalanceAccountId) {
        throw new Error("Select the opening balance posting account for this credit take-on.");
      }
      if (modalMode === "edit" && Number(selectedRow?.allocated || 0) > 0) {
        throw new Error("This take-on balance has allocations and cannot be edited.");
      }
      if (form.type === "debit" && modalMode === "create") {
        const billItemKey =
          form.billItem === "utility"
            ? `utility:${String(form.utilityLabel || "").trim().toLowerCase().replace(/\s+/g, "_")}`
            : form.billItem;
        const duplicate = rows.find(
          (row) =>
            normalizeId(row.tenant?._id || row.tenant) === normalizeId(form.tenantId) &&
            row.billItemKey === billItemKey &&
            String(row.type || "").toLowerCase() === "debit"
        );
        if (duplicate) {
          const label =
            billItemOptions.find((o) => o.value === form.billItem)?.defaultLabel || form.billItem;
          throw new Error(
            `A debit take-on balance for "${label}" already exists for this tenant. Edit or delete the existing entry.`
          );
        }
      }

      setSaving(true);
      const payload = buildPayloadFromForm();

      if (modalMode === "edit" && selectedRow?.invoiceId) {
        await updateTakeOnBalance(selectedRow.invoiceId, payload);
        toast.success("Take-on balance updated successfully.");
      } else if (form.type === "credit") {
        await createRentPayment(dispatch, payload);
        toast.success("Credit take-on balance created successfully.");
      } else {
        await createTenantInvoice(payload);
        toast.success("Take-on balance created successfully.");
      }

      setShowModal(false);
      setSelectedRow(null);
      setForm({ ...emptyForm });
      await loadRows();
    } catch (error) {
      toast.error(
        error?.response?.data?.message || error?.message || "Failed to save take-on balance."
      );
    } finally {
      setSaving(false);
    }
  };


  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedRows = filteredRows.slice(startIndex, endIndex);

  useEffect(() => {
    setCurrentPage(1);
  }, [appliedFilters, filteredRows.length]);

  useEffect(() => {
    if (currentPage !== safeCurrentPage) setCurrentPage(safeCurrentPage);
  }, [currentPage, safeCurrentPage]);

  const handleDelete = async () => {
    if (!rowToDelete?.invoiceId && !rowToDelete?.receiptId) return;
    try {
      if (rowToDelete?.entryModel === "receipt" && rowToDelete?.receiptId) {
        await reverseRentPayment(dispatch, rowToDelete.receiptId, { reason: "Reverse tenant take-on credit" });
      } else {
        await deleteTenantInvoice(rowToDelete.invoiceId);
      }
      toast.success("Take-on balance deleted successfully.");
      setRowToDelete(null);
      await loadRows();
    } catch (error) {
      toast.error(
        error?.response?.data?.error ||
          error?.response?.data?.message ||
          error?.message ||
          "Failed to delete take-on balance."
      );
    }
  };

  const handleFixTakeOnDeposits = async () => {
    if (!currentCompany?._id) return;
    try {
      setFixingDeposits(true);
      const res = await adminRequests.post(`/rent-payments/fix-takeon-deposits/${currentCompany._id}`);
      const { fixed, tenants: affectedTenants = [], errors = 0 } = res.data || {};
      if (fixed === 0) {
        toast.success("No misclassified take-on deposit receipts found — everything is already correct.");
      } else {
        toast.success(`Fixed ${fixed} take-on deposit receipt(s) across ${affectedTenants.length} tenant(s).${errors > 0 ? ` ${errors} recompute error(s).` : ""}`);
        await loadRows();
      }
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to fix take-on deposit classification.");
    } finally {
      setFixingDeposits(false);
    }
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 p-2">
        <div className="mx-auto flex h-full w-full max-w-full min-h-0 flex-1 flex-col gap-2">
          <div className="grid grid-cols-3 gap-1">
            {[
              ["Total Amount", totals.amount],
              ["Allocated", totals.allocated],
              ["Remaining Balance", totals.balance],
            ].map(([label, value], idx) => (
              <div
                key={label}
                className={`rounded-md border px-2 py-1 shadow-sm ${
                  idx === 2 ? "border-orange-200 bg-orange-50" : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      {label}
                    </p>
                    <p className="text-[10px] font-bold leading-tight text-slate-900">{formatCurrency(value)}</p>
                  </div>
                  <div
                    className={`hidden rounded-md p-1 ${
                      idx === 2 ? "bg-orange-100 text-orange-700" : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    <FaMoneyBillWave className="text-base" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex-none sticky top-0 z-20 border-b border-slate-200 bg-white shadow-sm">
              <div className="filter-bar flex items-center gap-0.5 overflow-x-auto px-2 py-1">
                <span className="shrink-0 border border-slate-200 bg-white px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-slate-500">Rows <span className="text-slate-900 normal-case">{filteredRows.length}</span></span>
                <div className="mx-1 h-3 w-px shrink-0 bg-slate-200" />
                <input value={draftFilters.search} onChange={setFilter("search")} placeholder="Search…" className="h-[20px] w-32 shrink-0 border border-slate-200 bg-white px-1.5 text-[9px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
                <AppSelect
                  value={draftFilters.propertyId}
                  onChange={(v) => setDraftFilters((prev) => ({ ...prev, propertyId: v ?? "", tenant: "" }))}
                  options={propertyFilterOptions}
                  placeholder={termProperty}
                  searchable
                  clearable
                  compact
                />
                <AppSelect
                  value={draftFilters.tenant}
                  onChange={(v) => setDraftFilters((prev) => ({ ...prev, tenant: v ?? "" }))}
                  options={tenantFilterOptions}
                  placeholder={termTenant}
                  searchable
                  clearable
                  compact
                />
                <AppSelect
                  value={draftFilters.billItem}
                  onChange={(v) => setDraftFilters((prev) => ({ ...prev, billItem: v ?? "" }))}
                  options={filterBillItemOptions}
                  placeholder="Bill Item"
                  clearable
                  compact
                />
                <AppSelect
                  value={draftFilters.type}
                  onChange={(v) => setDraftFilters((prev) => ({ ...prev, type: v ?? "" }))}
                  options={[
                    { value: "Debit", label: "Debit" },
                    { value: "Credit", label: "Credit" },
                  ]}
                  placeholder="Type"
                  clearable
                  compact
                />
                <AppSelect
                  value={draftFilters.status}
                  onChange={(v) => setDraftFilters((prev) => ({ ...prev, status: v ?? "" }))}
                  options={[
                    { value: "unallocated", label: "Unallocated" },
                    { value: "partially_allocated", label: "Partially Allocated" },
                    { value: "fully_allocated", label: "Fully Allocated" },
                  ]}
                  placeholder="Status"
                  clearable
                  compact
                />
                <button type="button" onClick={() => setAppliedFilters(draftFilters)} className={`h-[20px] shrink-0 px-1.5 text-[9px] font-semibold text-white shadow-sm ${MILIK_ORANGE} ${MILIK_ORANGE_HOVER}`}>Apply</button>
                <button type="button" onClick={() => { setDraftFilters(emptyFilters); setAppliedFilters(emptyFilters); }} className="h-[20px] shrink-0 border border-slate-200 bg-white px-1.5 text-[9px] font-semibold text-slate-700 shadow-sm hover:bg-slate-100">Reset</button>
                <button type="button" onClick={loadRows} className={`h-[20px] shrink-0 flex items-center gap-0.5 border border-slate-200 bg-white px-1.5 text-[9px] font-bold text-slate-700 shadow-sm hover:bg-slate-50`}><FaRedoAlt size={7} /> Refresh</button>
                <button type="button" onClick={openCreateModal} className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] font-bold text-white shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}><FaPlus size={7} /> Add Take-On</button>
                <button type="button" onClick={handleFixTakeOnDeposits} disabled={fixingDeposits} title="Re-classify take-on deposit receipts that were incorrectly saved as rent" className="h-[20px] shrink-0 flex items-center gap-0.5 border border-amber-300 bg-amber-50 px-1.5 text-[9px] font-bold text-amber-800 shadow-sm hover:bg-amber-100 disabled:opacity-60 disabled:cursor-not-allowed"><FaWrench size={7} /> {fixingDeposits ? "Fixing…" : "Fix Deposits"}</button>
              </div>
            </div>

            <MilikTable
              columns={[
                { label: termTenant },
                { label: termProperty },
                { label: termUnit },
                { label: "Bill Item" },
                { label: "Type" },
                { label: "Amount", align: "right" },
                { label: "Allocated", align: "right" },
                { label: "Balance", align: "right" },
                { label: "Effective Date" },
              ]}
              rows={paginatedRows}
              rowKey="_id"
              loading={loading}
              empty="No take-on balances found for the selected filters."
              minWidth={1120}
              renderRow={(row) => {
                const meta = statusMeta[row.status] || statusMeta.unallocated;
                return (
                  <>
                    <td className="px-3 py-1.5 border-r border-gray-100">
                      <div className="font-semibold text-slate-900">{getTenantDisplayName(row.tenant)}</div>
                    </td>
                    <td className="px-3 py-1.5 border-r border-gray-100 whitespace-nowrap text-slate-700">{getRowPropertyName(row)}</td>
                    <td className="px-3 py-1.5 border-r border-gray-100 whitespace-nowrap text-slate-700">{getUnitDisplay(row.unit)}</td>
                    <td className="px-3 py-1.5 border-r border-gray-100">
                      <div className="font-semibold text-slate-900">{row.billItemLabel}</div>
                      <div className="text-[10px] text-slate-500">{row.invoiceNumber || "No invoice number"}</div>
                    </td>
                    <td className="px-3 py-1.5 border-r border-gray-100 whitespace-nowrap text-slate-700">{row.type}</td>
                    <td className="px-3 py-1.5 border-r border-gray-100 whitespace-nowrap text-right font-semibold text-slate-900">{formatCurrency(row.amount)}</td>
                    <td className="px-3 py-1.5 border-r border-gray-100 whitespace-nowrap text-right text-slate-700">{formatCurrency(row.allocated)}</td>
                    <td className="px-3 py-1.5 border-r border-gray-100 whitespace-nowrap text-right">
                      <div className="font-semibold text-slate-900">{formatCurrency(row.balance)}</div>
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.classes}`}>{meta.label}</span>
                    </td>
                    <td className="px-3 py-1.5 border-r border-gray-100 whitespace-nowrap text-slate-700">{fmtDate(row.effectiveDate)}</td>
                  </>
                );
              }}
              renderExpanded={(row) => {
                const meta = statusMeta[row.status] || statusMeta.unallocated;
                return (
                  <div className="grid gap-2 text-[10px] md:grid-cols-4">
                    <div><span className="font-black uppercase tracking-[0.12em] text-slate-500">{termTenant}</span><p className="font-semibold text-slate-900">{getTenantDisplayName(row.tenant)}</p></div>
                    <div><span className="font-black uppercase tracking-[0.12em] text-slate-500">{termProperty} / {termUnit}</span><p className="font-semibold text-slate-900">{getRowPropertyName(row)} · {getUnitDisplay(row.unit)}</p></div>
                    <div><span className="font-black uppercase tracking-[0.12em] text-slate-500">Bill item</span><p className="font-semibold text-slate-900">{row.billItemLabel} · {row.type}</p></div>
                    <div><span className="font-black uppercase tracking-[0.12em] text-slate-500">Posting position</span><p className="font-semibold text-slate-900">{meta.label} · Balance {formatCurrency(row.balance)}</p></div>
                  </div>
                );
              }}
              renderActions={(row) => (
                <div className="inline-flex flex-wrap justify-end gap-1">
                  <button type="button" onClick={() => setSelectedRow(row)} className="rounded-lg border border-slate-300 bg-white p-1.5 text-slate-600 transition hover:bg-slate-100" title="View"><FaEye size={11} /></button>
                  <button type="button" onClick={() => openEditModal(row)} disabled={!row.canEdit} className="rounded-lg border border-orange-200 bg-orange-50 p-1.5 text-orange-600 transition hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-40" title={row.canEdit ? "Edit" : "Allocated rows cannot be edited"}><FaEdit size={11} /></button>
                  <button type="button" onClick={() => setRowToDelete(row)} disabled={!row.canDelete} className="rounded-lg border border-rose-200 bg-rose-50 p-1.5 text-rose-600 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-40" title={row.canDelete ? "Delete" : "Allocated rows cannot be deleted"}><FaTrash size={11} /></button>
                </div>
              )}
            />
            <PaginationBar
              page={safeCurrentPage}
              pages={totalPages}
              total={filteredRows.length}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={(n) => { setPageSize(n); setCurrentPage(1); }}
              loading={false}
              label="take-on balance rows"
            />
          </div>
        </div>
      </div>

      <TakeOnBalanceModal
        open={showModal}
        mode={modalMode}
        form={form}
        setForm={setForm}
        tenants={tenants}
        properties={propertyOptions}
        filterBillItemOptions={filterBillItemOptions}
        chartAccounts={chartAccounts}
        onClose={() => {
          setShowModal(false);
          setSelectedRow(null);
          setForm({ ...emptyForm });
        }}
        onSave={handleSave}
        saving={saving}
      />

      <TakeOnViewModal
        open={Boolean(selectedRow && !showModal)}
        row={selectedRow}
        onClose={() => setSelectedRow(null)}
      />

      <MilikConfirmDialog
        isOpen={Boolean(rowToDelete)}
        title="Delete Take-On Balance"
        message={`Delete ${rowToDelete?.billItemLabel || "this take-on balance"} for ${getTenantDisplayName(
          rowToDelete?.tenant
        )}? This action reverses the invoice and removes it from the take-on list.`}
        confirmText="Delete"
        isDangerous
        onConfirm={handleDelete}
        onCancel={() => setRowToDelete(null)}
      />
    </DashboardLayout>
  );

};

export default TakeOnBalances;