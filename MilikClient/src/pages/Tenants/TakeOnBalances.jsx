import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import DashboardLayout from "../../components/Layout/DashboardLayout";
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

const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-KE", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-950/30 backdrop-blur-[5px]"
        onClick={onClose}
      />
      <div className="relative w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="border-b border-slate-200 bg-gradient-to-r from-[#0B3B2E] via-[#0F5132] to-[#FF8C00] px-6 py-5 text-white">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/70">
                Tenant Take-On Balances
              </p>
              <h2 className="mt-2 text-2xl font-bold">
                {mode === "edit" ? "Edit Take-On Balance" : "Add Take-On Balance"}
              </h2>
              <p className="mt-1 text-sm text-white/80">
                Keep opening balances clean, auditable, and aligned to the right tenant bill item.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/20 bg-white/10 p-2 text-white transition hover:bg-white/20"
            >
              <FaTimes />
            </button>
          </div>
        </div>

        <div className="max-h-[80vh] overflow-y-auto px-6 py-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="space-y-5">
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Property</label>
                <select
                  value={form.propertyId}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      propertyId: e.target.value,
                      tenantId: "",
                    }))
                  }
                  disabled={mode === "edit"}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100 disabled:bg-slate-100"
                >
                  <option value="">Select property</option>
                  {propertyOptions.map((property) => {
                    const propertyId = normalizeId(property?._id || property?.id);
                    return (
                      <option key={propertyId} value={propertyId}>
                        {getPropertyDisplay(property)}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Find Tenant</label>
                <div className="relative">
                  <FaSearch className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={form.tenantSearch}
                    onChange={(e) => setForm((prev) => ({ ...prev, tenantSearch: e.target.value }))}
                    placeholder="Type tenant name, unit, or property"
                    className="w-full rounded-xl border border-slate-300 py-3 pl-11 pr-4 text-sm shadow-sm outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Tenant</label>
                <select
                  value={form.tenantId}
                  onChange={(e) => setForm((prev) => ({ ...prev, tenantId: e.target.value }))}
                  disabled={mode === "edit" || (!form.propertyId && mode !== "edit")}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100 disabled:bg-slate-100"
                >
                  <option value="">
                    {form.propertyId ? "Select tenant in selected property" : "Select property first"}
                  </option>
                  {filteredTenants.map((tenant) => (
                    <option key={tenant._id} value={tenant._id}>
                      {getTenantDisplayName(tenant)}
                      {tenant?.unit?.unitNumber ? ` — Unit ${tenant.unit.unitNumber}` : ""}
                    </option>
                  ))}
                </select>
                {!filteredTenants.length && form.propertyId ? (
                  <p className="mt-2 text-xs text-slate-500">
                    No tenant matched the selected property and search term.
                  </p>
                ) : null}
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Bill Item</label>
                <select
                  value={form.billItem}
                  onChange={(e) => setForm((prev) => ({ ...prev, billItem: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                >
                  {(Array.isArray(filterBillItemOptions) ? filterBillItemOptions : []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {form.billItem === "utility" && (
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">
                    Utility Name
                  </label>
                  <input
                    value={form.utilityLabel}
                    onChange={(e) => setForm((prev) => ({ ...prev, utilityLabel: e.target.value }))}
                    placeholder="e.g. Water, Electricity, Garbage"
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">Type</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))}
                    disabled={mode === "edit" && form.type === "credit"}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100 disabled:bg-slate-100"
                  >
                    <option value="debit">Debit</option>
                    <option value="credit">Credit</option>
                  </select>
                  <p className="mt-1 text-xs text-slate-500">
                    Debit take-ons raise opening tenant charges. Credit take-ons create opening tenant credits and post them through the selected opening balance account.
                  </p>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">Amount</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.amount}
                    onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                    placeholder="0.00"
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                  />
                </div>
              </div>

              {form.type === "credit" && (
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">
                    Opening Balance Posting Account
                  </label>
                  <select
                    value={form.openingBalanceAccountId}
                    onChange={(e) => setForm((prev) => ({ ...prev, openingBalanceAccountId: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                  >
                    <option value="">Select account</option>
                    {chartAccounts.map((account) => (
                      <option key={account._id} value={account._id}>
                        [{account.code || "---"}] {account.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">
                  Effective Date
                </label>
                <input
                  type="date"
                  value={form.effectiveDate}
                  onChange={(e) => setForm((prev) => ({ ...prev, effectiveDate: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">
                  Notes / Description
                </label>
                <textarea
                  rows={4}
                  value={form.description}
                  onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="Optional narration for this take-on balance"
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Selection Preview
                </p>
                <div className="mt-4 space-y-3 text-sm text-slate-700">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-slate-500">Tenant</span>
                    <span className="font-semibold text-slate-900">
                      {getTenantDisplayName(selectedTenant)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-slate-500">Property</span>
                    <span className="font-semibold text-slate-900">
                      {getPropertyDisplay(selectedProperty)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-slate-500">Unit</span>
                    <span className="font-semibold text-slate-900">
                      {getUnitDisplay(selectedUnit)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-slate-500">Bill Item</span>
                    <span className="font-semibold text-slate-900">
                      {form.billItem === "utility"
                        ? form.utilityLabel || "Utility"
                        : selectedBillItem.defaultLabel}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-slate-500">Amount</span>
                    <span className="font-semibold text-slate-900">
                      {formatCurrency(form.amount || 0)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-orange-200 bg-orange-50/80 p-5 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">How this pass works</p>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                  <li>• Choose a property first so only the right tenants appear.</li>
                  <li>• Each take-on row is stored as a dedicated tenant invoice flagged as a take-on balance.</li>
                  <li>• Allocated and Balance values are computed live from the tenant allocation engine.</li>
                  <li>• Edits are blocked once the take-on balance is allocated, to keep the audit trail clean.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition ${MILIK_ORANGE} ${MILIK_ORANGE_HOVER} disabled:cursor-not-allowed disabled:opacity-60`}
          >
            <FaSave />
            {saving ? "Saving..." : mode === "edit" ? "Save Changes" : "Save Take-On Balance"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TakeOnViewModal({ open, row, onClose }) {
  if (!open || !row) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/25 backdrop-blur-[4px]" onClick={onClose} />
      <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="border-b border-slate-200 bg-gradient-to-r from-slate-900 via-[#0B3B2E] to-[#FF8C00] px-6 py-5 text-white">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/70">
                Take-On Balance Details
              </p>
              <h2 className="mt-2 text-2xl font-bold">{row.billItemLabel}</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/20 bg-white/10 p-2 text-white hover:bg-white/20"
            >
              <FaTimes />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 px-6 py-6 md:grid-cols-2">
          {[
            ["Tenant", getTenantDisplayName(row.tenant)],
            ["Unit", getUnitDisplay(row.unit)],
            ["Type", row.type],
            ["Amount", formatCurrency(row.amount)],
            ["Allocated", formatCurrency(row.allocated)],
            ["Balance", formatCurrency(row.balance)],
            ["Effective Date", formatDate(row.effectiveDate)],
            [row.entryModel === "receipt" ? "Receipt Number" : "Invoice Number", row.invoiceNumber || "—"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                {label}
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-900">{value}</p>
            </div>
          ))}
          <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Description
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-700">{row.description || "—"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

const TakeOnBalances = () => {
  const dispatch = useDispatch();
  const { currentCompany } = useSelector((state) => state.company);
  const tenantState = useSelector((state) => state.tenant?.tenants || []);
  const propertyState = useSelector((state) => state.property?.properties || []);
  const tenants = Array.isArray(tenantState)
    ? tenantState
    : Array.isArray(tenantState?.data)
      ? tenantState.data
      : [];
  const properties = Array.isArray(propertyState)
    ? propertyState
    : Array.isArray(propertyState?.data)
      ? propertyState.data
      : [];

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftFilters, setDraftFilters] = useState(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState(emptyFilters);
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState("create");
  const [form, setForm] = useState(emptyForm);
  const [selectedRow, setSelectedRow] = useState(null);
  const [rowToDelete, setRowToDelete] = useState(null);
  const [chartAccounts, setChartAccounts] = useState([]);
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

  const propertyLookup = useMemo(() => {
    const map = new Map();
    propertyOptions.forEach((property) => {
      const propertyId = normalizeId(property?._id || property?.id);
      if (propertyId) map.set(propertyId, property);
    });
    return map;
  }, [propertyOptions]);

  const loadRows = async () => {
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
  };

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
  }, [dispatch, currentCompany?._id]);

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
      if (form.billItem === "utility" && !String(form.utilityLabel || "").trim()) {
        throw new Error("Enter the utility name for this take-on balance.");
      }
      if (form.type === "credit" && !form.openingBalanceAccountId) {
        throw new Error("Select the opening balance posting account for this credit take-on.");
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

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#FF8C00]">
                Tenants Financing
              </p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
                Tenant Take-On Balances
              </h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                Manage opening tenant balances in a clean, auditable list with live allocation
                tracking for Amount, Allocated, and Balance.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={loadRows}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100"
              >
                <FaRedoAlt />
                Refresh
              </button>
              <button
                type="button"
                onClick={openCreateModal}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
              >
                <FaPlus />
                Add Take-On Balance
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[
              ["Total Amount", totals.amount],
              ["Allocated", totals.allocated],
              ["Remaining Balance", totals.balance],
            ].map(([label, value], idx) => (
              <div
                key={label}
                className={`rounded-2xl border px-5 py-4 shadow-sm ${
                  idx === 2 ? "border-orange-200 bg-orange-50" : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                      {label}
                    </p>
                    <p className="mt-3 text-2xl font-bold text-slate-900">
                      {formatCurrency(value)}
                    </p>
                  </div>
                  <div
                    className={`rounded-2xl p-3 ${
                      idx === 2
                        ? "bg-orange-100 text-orange-700"
                        : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    <FaMoneyBillWave className="text-xl" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <FaFilter className="text-orange-500" />
                Filters
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 px-5 py-5 md:grid-cols-2 xl:grid-cols-5">
              <div className="xl:col-span-2">
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Search
                </label>
                <div className="relative">
                  <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={draftFilters.search}
                    onChange={(e) => setDraftFilters((prev) => ({ ...prev, search: e.target.value }))}
                    placeholder="Tenant, unit, bill item, invoice number"
                    className="w-full rounded-xl border border-slate-300 py-3 pl-10 pr-4 text-sm outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Tenant
                </label>
                <select
                  value={draftFilters.tenant}
                  onChange={(e) => setDraftFilters((prev) => ({ ...prev, tenant: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                >
                  <option value="">All tenants</option>
                  {tenants.map((tenant) => (
                    <option key={tenant._id} value={tenant._id}>
                      {getTenantDisplayName(tenant)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Bill Item
                </label>
                <select
                  value={draftFilters.billItem}
                  onChange={(e) => setDraftFilters((prev) => ({ ...prev, billItem: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                >
                  <option value="">All bill items</option>
                  {filterBillItemOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Type
                  </label>
                  <select
                    value={draftFilters.type}
                    onChange={(e) => setDraftFilters((prev) => ({ ...prev, type: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                  >
                    <option value="">All</option>
                    <option value="Debit">Debit</option>
                    <option value="Credit">Credit</option>
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Status
                  </label>
                  <select
                    value={draftFilters.status}
                    onChange={(e) => setDraftFilters((prev) => ({ ...prev, status: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                  >
                    <option value="">All</option>
                    <option value="unallocated">Unallocated</option>
                    <option value="partially_allocated">Partially Allocated</option>
                    <option value="fully_allocated">Fully Allocated</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={() => {
                  setDraftFilters(emptyFilters);
                  setAppliedFilters(emptyFilters);
                }}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => setAppliedFilters(draftFilters)}
                className={`rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition ${MILIK_ORANGE} ${MILIK_ORANGE_HOVER}`}
              >
                Apply Filters
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    {[
                      "Tenant",
                      "Unit",
                      "Bill Item",
                      "Type",
                      "Amount",
                      "Allocated",
                      "Balance",
                      "Effective Date",
                      "Actions",
                    ].map((header) => (
                      <th
                        key={header}
                        className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500"
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100 bg-white">
                  {loading ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-500">
                        Loading take-on balances...
                      </td>
                    </tr>
                  ) : filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-500">
                        No take-on balances found for the selected filters.
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row) => {
                      const meta = statusMeta[row.status] || statusMeta.unallocated;

                      return (
                        <tr key={row.invoiceId} className="transition hover:bg-slate-50/80">
                          <td className="px-4 py-4 text-sm font-semibold text-slate-900">
                            {getTenantDisplayName(row.tenant)}
                          </td>
                          <td className="px-4 py-4 text-sm text-slate-700">
                            {getUnitDisplay(row.unit)}
                          </td>
                          <td className="px-4 py-4 text-sm text-slate-700">
                            <div className="font-semibold text-slate-900">{row.billItemLabel}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              {row.invoiceNumber || "No invoice number"}
                            </div>
                          </td>
                          <td className="px-4 py-4 text-sm text-slate-700">{row.type}</td>
                          <td className="px-4 py-4 text-sm font-semibold text-slate-900">
                            {formatCurrency(row.amount)}
                          </td>
                          <td className="px-4 py-4 text-sm text-slate-700">
                            {formatCurrency(row.allocated)}
                          </td>
                          <td className="px-4 py-4 text-sm">
                            <div className="font-semibold text-slate-900">
                              {formatCurrency(row.balance)}
                            </div>
                            <span
                              className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${meta.classes}`}
                            >
                              {meta.label}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-sm text-slate-700">
                            {formatDate(row.effectiveDate)}
                          </td>
                          <td className="px-4 py-4 text-sm">
                            <div className="flex items-center gap-2 action-buttons">
                              <button
                                type="button"
                                onClick={() => setSelectedRow(row)}
                                className="rounded-lg border border-slate-300 p-2 text-slate-600 transition hover:bg-slate-100"
                                title="View"
                              >
                                <FaEye />
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditModal(row)}
                                disabled={!row.canEdit}
                                className="rounded-lg border border-orange-200 p-2 text-orange-600 transition hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-40"
                                title={row.canEdit ? "Edit" : "Allocated rows cannot be edited"}
                              >
                                <FaEdit />
                              </button>
                              <button
                                type="button"
                                onClick={() => setRowToDelete(row)}
                                disabled={!row.canDelete}
                                className="rounded-lg border border-red-200 p-2 text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                                title={row.canDelete ? "Delete" : "Allocated rows cannot be deleted"}
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