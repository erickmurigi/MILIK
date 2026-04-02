import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  FaBolt,
  FaCheckCircle,
  FaEnvelope,
  FaEdit,
  FaFileInvoice,
  FaSms,
  FaFilter,
  FaPlus,
  FaSave,
  FaSearch,
  FaSync,
  FaTint,
  FaTrash,
  FaBan,
} from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import CommunicationComposerModal from "../../components/Communications/CommunicationComposerModal";
import { hasCompanyPermission } from "../../utils/permissions";
import { adminRequests } from "../../utils/requestMethods";
import {
  billMeterReading,
  createMeterReading,
  deleteMeterReading,
  getMeterReadings,
  updateMeterReading,
  voidMeterReading,
} from "../../redux/apiCalls";

const normalizeList = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.properties)) return payload.properties;
  if (Array.isArray(payload?.units)) return payload.units;
  if (Array.isArray(payload?.tenants)) return payload.tenants;
  return [];
};

const emptyForm = {
  property: "",
  unit: "",
  tenant: "",
  utilityType: "",
  meterNumber: "",
  billingPeriod: new Date().toISOString().slice(0, 7),
  readingDate: new Date().toISOString().slice(0, 10),
  previousReading: "",
  currentReading: "",
  rate: "",
  notes: "",
  isMeterReset: false,
};

const statusBadgeClass = {
  draft: "bg-amber-100 text-amber-800",
  billed: "bg-emerald-100 text-emerald-800",
  void: "bg-slate-200 text-slate-700",
};

const formatMoney = (value) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const formatNumber = (value) => {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num.toLocaleString() : "0";
};

const inferUnitsConsumed = (form) => {
  const previous = Number(form.previousReading || 0);
  const current = Number(form.currentReading || 0);
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return 0;
  if (form.isMeterReset) return Math.max(current, 0);
  return Math.max(current - previous, 0);
};

const milikPrimaryBtn =
  "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60";
const milikGreenBtn = `${milikPrimaryBtn} bg-[#0B5D3B]`;
const milikOrangeBtn = `${milikPrimaryBtn} bg-[#D97706]`;
const milikSoftBtn =
  "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition";

const MeterReadings = () => {
  const { currentCompany } = useSelector((state) => state.company || {});
  const businessId = currentCompany?._id || "";
  const currentUser = useSelector((state) => state.auth?.currentUser);
  const canCreateReading = hasCompanyPermission(currentUser || {}, currentCompany, "meterReadings", "create", "propertyManagement");
  const canUpdateReading = hasCompanyPermission(currentUser || {}, currentCompany, "meterReadings", "update", "propertyManagement");
  const canDeleteReading = hasCompanyPermission(currentUser || {}, currentCompany, "meterReadings", "delete", "propertyManagement");
  const canProcessReading = hasCompanyPermission(currentUser || {}, currentCompany, "meterReadings", "process", "propertyManagement");

  const [properties, setProperties] = useState([]);
  const [units, setUnits] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [utilityOptions, setUtilityOptions] = useState([]);
  const [readings, setReadings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bulkBilling, setBulkBilling] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedReadingIds, setSelectedReadingIds] = useState([]);
  const [filters, setFilters] = useState({
    property: "",
    unit: "",
    utilityType: "",
    billingPeriod: "",
    status: "",
    search: "",
  });
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState("");
  const [communicationModal, setCommunicationModal] = useState(null);

  const loadPageData = async () => {
    if (!businessId) return;

    setLoading(true);
    try {
      const [
        propertiesRes,
        unitsRes,
        tenantsRes,
        utilitiesRes,
        settingsRes,
        readingsRes,
      ] = await Promise.all([
        adminRequests.get(`/properties?business=${businessId}&limit=1000`),
        adminRequests.get(`/units?business=${businessId}`),
        adminRequests.get(`/tenants?business=${businessId}`),
        adminRequests.get(`/utilities?business=${businessId}`),
        adminRequests.get(`/company-settings/${businessId}`),
        getMeterReadings({ business: businessId }),
      ]);

      const propertyList = normalizeList(propertiesRes.data);
      const unitList = normalizeList(unitsRes.data);
      const tenantList = normalizeList(tenantsRes.data);
      const utilityList = normalizeList(utilitiesRes.data);
      const utilityNames = new Set();

      utilityList.forEach((item) => {
        if (item?.name) utilityNames.add(String(item.name));
      });

      (settingsRes.data?.utilityTypes || []).forEach((item) => {
        if (item?.isActive !== false && item?.name) utilityNames.add(String(item.name));
      });

      unitList.forEach((unit) => {
        (unit?.utilities || []).forEach((item) => {
          if (item?.utility) utilityNames.add(String(item.utility));
        });
      });

      setProperties(propertyList);
      setUnits(unitList);
      setTenants(tenantList);
      setUtilityOptions(Array.from(utilityNames).sort((a, b) => a.localeCompare(b)));
      setReadings(Array.isArray(readingsRes) ? readingsRes : []);
      setSelectedReadingIds([]);
    } catch (error) {
      toast.error(
        error.response?.data?.message ||
          error.response?.data?.error ||
          "Failed to load meter readings data."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPageData();
  }, [businessId]);

  const filteredUnits = useMemo(() => {
    if (!form.property) return units;
    return units.filter(
      (unit) => String(unit?.property?._id || unit?.property) === String(form.property)
    );
  }, [units, form.property]);

  const filteredTenants = useMemo(() => {
    if (!form.unit) return tenants;
    return tenants.filter(
      (tenant) => String(tenant?.unit?._id || tenant?.unit) === String(form.unit)
    );
  }, [tenants, form.unit]);

  const filteredReadings = useMemo(() => {
    return readings.filter((reading) => {
      const searchBase = [
        reading?.property?.propertyName,
        reading?.unit?.unitNumber,
        reading?.tenant?.name,
        reading?.utilityType,
        reading?.billingPeriod,
        reading?.billedInvoice?.invoiceNumber,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (
        filters.property &&
        String(reading?.property?._id || reading?.property) !== String(filters.property)
      ) {
        return false;
      }
      if (filters.unit && String(reading?.unit?._id || reading?.unit) !== String(filters.unit)) {
        return false;
      }
      if (
        filters.utilityType &&
        String(reading?.utilityType || "").toLowerCase() !==
          String(filters.utilityType).toLowerCase()
      ) {
        return false;
      }
      if (
        filters.billingPeriod &&
        String(reading?.billingPeriod || "") !== String(filters.billingPeriod)
      ) {
        return false;
      }
      if (filters.status && String(reading?.status || "") !== String(filters.status)) {
        return false;
      }
      if (filters.search && !searchBase.includes(String(filters.search).toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [readings, filters]);

  const selectableFilteredReadings = useMemo(
    () => filteredReadings.filter((reading) => reading.status === "draft"),
    [filteredReadings]
  );

  const allVisibleDraftSelected =
    selectableFilteredReadings.length > 0 &&
    selectableFilteredReadings.every((reading) => selectedReadingIds.includes(reading._id));

  const selectedDraftCount = selectedReadingIds.length;

  const formDerived = useMemo(() => {
    const unitsConsumed = inferUnitsConsumed(form);
    const rate = Number(form.rate || 0);
    return {
      unitsConsumed,
      amount: Number((unitsConsumed * rate).toFixed(2)),
    };
  }, [form]);

  const selectedUnit = useMemo(
    () => units.find((unit) => String(unit._id) === String(form.unit)),
    [units, form.unit]
  );

  useEffect(() => {
    if (!selectedUnit || !form.utilityType) return;

    const matchingUtility = (selectedUnit.utilities || []).find(
      (item) =>
        String(item.utility || "").trim().toLowerCase() ===
        String(form.utilityType || "").trim().toLowerCase()
    );

    if (matchingUtility && (form.rate === "" || form.rate === null)) {
      setForm((prev) => ({ ...prev, rate: String(Number(matchingUtility.unitCharge || 0)) }));
    }
  }, [selectedUnit, form.utilityType]);

  useEffect(() => {
    setSelectedReadingIds((prev) =>
      prev.filter((id) =>
        readings.some((reading) => reading._id === id && reading.status === "draft")
      )
    );
  }, [readings]);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId("");
  };

  const openAddSectionForNew = () => {
    resetForm();
    setShowAddModal(true);
  };

  const handleFormChange = (field, value) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value };

      if (field === "property") {
        next.unit = "";
        next.tenant = "";
      }

      if (field === "unit") {
        next.tenant = "";
      }

      return next;
    });
  };

  const handleEdit = (reading) => {
    if (reading.status !== "draft") {
      toast.info("Only draft meter readings can be edited.");
      return;
    }

    setEditingId(reading._id);
    setForm({
      property: String(reading?.property?._id || reading?.property || ""),
      unit: String(reading?.unit?._id || reading?.unit || ""),
      tenant: String(reading?.tenant?._id || reading?.tenant || ""),
      utilityType: reading?.utilityType || "",
      meterNumber: reading?.meterNumber || "",
      billingPeriod: reading?.billingPeriod || new Date().toISOString().slice(0, 7),
      readingDate: reading?.readingDate
        ? new Date(reading.readingDate).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10),
      previousReading: String(reading?.previousReading ?? ""),
      currentReading: String(reading?.currentReading ?? ""),
      rate: String(reading?.rate ?? ""),
      notes: reading?.notes || "",
      isMeterReset: Boolean(reading?.isMeterReset),
    });
    setShowAddModal(true);
    
  };

  const refreshReadings = async () => {
    if (!businessId) return;
    try {
      const list = await getMeterReadings({ business: businessId });
      const normalized = Array.isArray(list) ? list : [];
      setReadings(normalized);
      setSelectedReadingIds((prev) =>
        prev.filter((id) =>
          normalized.some((reading) => reading._id === id && reading.status === "draft")
        )
      );
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to refresh meter readings.");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!businessId) {
      toast.error("Select a company first.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        business: businessId,
        property: form.property,
        unit: form.unit,
        tenant: form.tenant || null,
        utilityType: form.utilityType,
        meterNumber: form.meterNumber,
        billingPeriod: form.billingPeriod,
        readingDate: form.readingDate,
        previousReading: form.previousReading === "" ? undefined : Number(form.previousReading),
        currentReading: Number(form.currentReading),
        rate: form.rate === "" ? undefined : Number(form.rate),
        notes: form.notes,
        isMeterReset: Boolean(form.isMeterReset),
      };

      if (
        !payload.property ||
        !payload.unit ||
        !payload.utilityType ||
        !form.currentReading ||
        !payload.billingPeriod
      ) {
        toast.error(
          "Property, unit, utility type, billing period, and current reading are required."
        );
        setSaving(false);
        return;
      }

      if (editingId) {
        await updateMeterReading(editingId, payload);
        toast.success("Meter reading updated.");
      } else {
        await createMeterReading(payload);
        toast.success("Meter reading created.");
      }

      await refreshReadings();
      resetForm();
      setShowAddModal(false);
    } catch (error) {
      toast.error(
        error.response?.data?.message ||
          error.response?.data?.error ||
          "Failed to save meter reading."
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (reading) => {
    if (reading.status !== "draft") {
      toast.info("Only draft meter readings can be deleted.");
      return;
    }

    if (!window.confirm(`Delete meter reading for ${reading?.unit?.unitNumber || "this unit"}?`)) {
      return;
    }

    try {
      await deleteMeterReading(reading._id);
      toast.success("Meter reading deleted.");
      await refreshReadings();
      if (editingId === reading._id) resetForm();
      setSelectedReadingIds((prev) => prev.filter((id) => id !== reading._id));
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to delete meter reading.");
    }
  };

  const handleVoid = async (reading) => {
    if (!window.confirm("Void this meter reading?")) return;
    try {
      await voidMeterReading(reading._id, {
        notes: reading.notes || "Voided from meter readings page",
      });
      toast.success("Meter reading voided.");
      await refreshReadings();
      if (editingId === reading._id) resetForm();
      setSelectedReadingIds((prev) => prev.filter((id) => id !== reading._id));
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to void meter reading.");
    }
  };

  const handleBill = async (reading) => {
    if (!window.confirm("Convert this meter reading into a tenant utility invoice?")) return;
    try {
      const response = await billMeterReading(reading._id, {
        invoiceDate: reading.readingDate,
        dueDate: reading.readingDate,
      });
      toast.success(
        `Meter reading billed${
          response?.invoice?.invoiceNumber ? ` as ${response.invoice.invoiceNumber}` : ""
        }.`
      );
      await refreshReadings();
      if (editingId === reading._id) resetForm();
      setSelectedReadingIds((prev) => prev.filter((id) => id !== reading._id));
    } catch (error) {
      toast.error(
        error.response?.data?.message ||
          error.response?.data?.error ||
          "Failed to bill meter reading."
      );
    }
  };

  const toggleReadingSelection = (readingId) => {
    setSelectedReadingIds((prev) =>
      prev.includes(readingId) ? prev.filter((id) => id !== readingId) : [...prev, readingId]
    );
  };

  const handleRowClick = (reading) => {
    if (reading.status !== "draft") return;
    toggleReadingSelection(reading._id);
  };

  const handleToggleSelectAllVisibleDrafts = () => {
    if (allVisibleDraftSelected) {
      setSelectedReadingIds((prev) =>
        prev.filter((id) => !selectableFilteredReadings.some((reading) => reading._id === id))
      );
      return;
    }

    setSelectedReadingIds((prev) => {
      const next = new Set(prev);
      selectableFilteredReadings.forEach((reading) => next.add(reading._id));
      return Array.from(next);
    });
  };

  const handleBulkBill = async () => {
    if (selectedReadingIds.length === 0) {
      toast.info("Select at least one draft meter reading to bill.");
      return;
    }

    if (
      !window.confirm(
        `Bill ${selectedReadingIds.length} selected meter reading${
          selectedReadingIds.length > 1 ? "s" : ""
        } into utility invoices?`
      )
    ) {
      return;
    }

    setBulkBilling(true);
    try {
      let successCount = 0;
      let failedCount = 0;

      for (const readingId of selectedReadingIds) {
        const reading = readings.find((item) => item._id === readingId);
        if (!reading || reading.status !== "draft") {
          failedCount += 1;
          continue;
        }

        try {
          await billMeterReading(readingId, {
            invoiceDate: reading.readingDate,
            dueDate: reading.readingDate,
          });
          successCount += 1;
        } catch (error) {
          failedCount += 1;
        }
      }

      await refreshReadings();
      setSelectedReadingIds([]);

      if (successCount > 0 && failedCount === 0) {
        toast.success(
          `${successCount} meter reading${successCount > 1 ? "s" : ""} billed successfully.`
        );
      } else if (successCount > 0 && failedCount > 0) {
        toast.warn(`${successCount} billed, ${failedCount} failed.`);
      } else {
        toast.error("No selected meter readings were billed.");
      }
    } finally {
      setBulkBilling(false);
    }
  };

  const stopRowEvent = (e) => {
    e.stopPropagation();
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="min-h-screen bg-slate-50 p-4 md:p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">Meter Readings</h1>
                <p className="mt-1 text-sm text-slate-600">
                  Capture reading-based utility consumption and convert approved readings into the
                  normal tenant invoice flow.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                  <div className="font-semibold">Current company</div>
                  <div>{currentCompany?.companyName || currentCompany?.name || "No company selected"}</div>
                </div>
                <button
                  type="button"
                  onClick={loadPageData}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <FaSync /> Refresh
                </button>
              </div>
            </div>
          </div>

          {showAddModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
              <div className="max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
                <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4">
                  <div>
                    <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-slate-500">Meter readings</p>
                    <h2 className="mt-1 text-lg font-bold text-slate-900">{editingId ? "Edit meter reading" : "Add meter reading"}</h2>
                    <p className="mt-1 text-sm text-slate-500">Capture a reading in a modal, then return to the readings register.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => !saving && (resetForm(), setShowAddModal(false))}
                    className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-white hover:text-slate-800"
                  >
                    <FaBan />
                  </button>
                </div>
                <div className="max-h-[calc(92vh-82px)] overflow-y-auto p-5">
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    {editingId ? "Edit meter reading" : "Add meter reading"}
                  </h2>
                  <p className="text-sm text-slate-500">
                    Charges are billed later through the existing invoice engine.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {editingId && (
                    <button
                      type="button"
                      onClick={() => {
                        resetForm();
                        setShowAddModal(false);
                      }}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Cancel edit
                    </button>
                  )}
                </div>
              </div>

              <form className="space-y-4" onSubmit={handleSubmit}>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-1 text-sm font-medium text-slate-700">
                    <span>Property</span>
                    <select
                      value={form.property}
                      onChange={(e) => handleFormChange("property", e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#D97706]"
                    >
                      <option value="">Select property</option>
                      {properties.map((property) => (
                        <option key={property._id} value={property._id}>
                          {property.propertyName || property.name || property.propertyCode}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1 text-sm font-medium text-slate-700">
                    <span>Unit</span>
                    <select
                      value={form.unit}
                      onChange={(e) => handleFormChange("unit", e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#D97706]"
                    >
                      <option value="">Select unit</option>
                      {filteredUnits.map((unit) => (
                        <option key={unit._id} value={unit._id}>
                          {unit.unitNumber}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1 text-sm font-medium text-slate-700">
                    <span>Tenant / occupant</span>
                    <select
                      value={form.tenant}
                      onChange={(e) => handleFormChange("tenant", e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#D97706]"
                    >
                      <option value="">Auto-detect active tenant</option>
                      {filteredTenants.map((tenant) => (
                        <option key={tenant._id} value={tenant._id}>
                          {tenant.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1 text-sm font-medium text-slate-700">
                    <span>Utility type</span>
                    <select
                      value={form.utilityType}
                      onChange={(e) => handleFormChange("utilityType", e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#D97706]"
                    >
                      <option value="">Select utility</option>
                      {utilityOptions.map((utility) => (
                        <option key={utility} value={utility}>
                          {utility}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1 text-sm font-medium text-slate-700">
                    <span>Billing period</span>
                    <input
                      type="month"
                      value={form.billingPeriod}
                      onChange={(e) => handleFormChange("billingPeriod", e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#D97706]"
                    />
                  </label>

                  <label className="space-y-1 text-sm font-medium text-slate-700">
                    <span>Reading date</span>
                    <input
                      type="date"
                      value={form.readingDate}
                      onChange={(e) => handleFormChange("readingDate", e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#D97706]"
                    />
                  </label>

                  <label className="space-y-1 text-sm font-medium text-slate-700">
                    <span>Previous reading</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.previousReading}
                      onChange={(e) => handleFormChange("previousReading", e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#D97706]"
                      placeholder="Auto from last reading if left blank"
                    />
                  </label>

                  <label className="space-y-1 text-sm font-medium text-slate-700">
                    <span>Current reading</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.currentReading}
                      onChange={(e) => handleFormChange("currentReading", e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#D97706]"
                    />
                  </label>

                  <label className="space-y-1 text-sm font-medium text-slate-700">
                    <span>Rate per unit</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.rate}
                      onChange={(e) => handleFormChange("rate", e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#D97706]"
                    />
                  </label>

                  <label className="space-y-1 text-sm font-medium text-slate-700">
                    <span>Meter number</span>
                    <input
                      type="text"
                      value={form.meterNumber}
                      onChange={(e) => handleFormChange("meterNumber", e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#D97706]"
                    />
                  </label>
                </div>

                <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.isMeterReset}
                    onChange={(e) => handleFormChange("isMeterReset", e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Meter was reset for this period
                </label>

                <label className="space-y-1 text-sm font-medium text-slate-700">
                  <span>Notes</span>
                  <textarea
                    rows="3"
                    value={form.notes}
                    onChange={(e) => handleFormChange("notes", e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#D97706]"
                    placeholder="Optional notes"
                  />
                </label>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Units consumed
                    </div>
                    <div className="mt-2 text-xl font-bold text-slate-900">
                      {formatNumber(formDerived.unitsConsumed)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Calculated amount
                    </div>
                    <div className="mt-2 text-xl font-bold text-slate-900">
                      {formatMoney(formDerived.amount)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Utility
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
                      {String(form.utilityType || "").toLowerCase().includes("water") ? (
                        <FaTint />
                      ) : (
                        <FaBolt />
                      )}
                      {form.utilityType || "Not selected"}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button type="submit" disabled={saving || (!canCreateReading && !editingId) || (!!editingId && !canUpdateReading)} className={milikGreenBtn}>
                    {editingId ? <FaSave /> : <FaPlus />}
                    {saving ? "Saving..." : editingId ? "Update reading" : "Save reading"}
                  </button>

                  <button
                    type="button"
                    onClick={resetForm}
                    className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Reset
                  </button>
                </div>
              </form>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Readings register</h2>
                <p className="text-sm text-slate-500">
                  Draft readings can be edited or deleted. Billing creates a normal utility invoice
                  and posts it through the existing accounting flow.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (showAddModal) {
                      resetForm();
                      setShowAddModal(false);
                      return;
                    }
                    openAddSectionForNew();
                  }}
                  disabled={!canCreateReading && !showAddModal}
                  className={milikOrangeBtn}
                >
                  <FaPlus />
                  {showAddModal ? "Close" : "Add reading"}
                </button>

                <button
                  type="button"
                  onClick={handleBulkBill}
                  disabled={bulkBilling || selectedDraftCount === 0 || !canProcessReading}
                  className={milikGreenBtn}
                >
                  <FaFileInvoice />
                  {bulkBilling
                    ? "Billing..."
                    : `Bill selected${selectedDraftCount > 0 ? ` (${selectedDraftCount})` : ""}`}
                </button>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <div className="relative">
                <FaSearch className="pointer-events-none absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search"
                  value={filters.search}
                  onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 py-2 pl-10 pr-3 text-sm outline-none focus:border-[#D97706]"
                />
              </div>

              <select
                value={filters.property}
                onChange={(e) => setFilters((prev) => ({ ...prev, property: e.target.value, unit: "" }))}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#D97706]"
              >
                <option value="">All properties</option>
                {properties.map((property) => (
                  <option key={property._id} value={property._id}>
                    {property.propertyName || property.propertyCode}
                  </option>
                ))}
              </select>

              <select
                value={filters.unit}
                onChange={(e) => setFilters((prev) => ({ ...prev, unit: e.target.value }))}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#D97706]"
              >
                <option value="">All units</option>
                {units
                  .filter(
                    (unit) =>
                      !filters.property ||
                      String(unit?.property?._id || unit?.property) === String(filters.property)
                  )
                  .map((unit) => (
                    <option key={unit._id} value={unit._id}>
                      {unit.unitNumber}
                    </option>
                  ))}
              </select>

              <select
                value={filters.utilityType}
                onChange={(e) => setFilters((prev) => ({ ...prev, utilityType: e.target.value }))}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#D97706]"
              >
                <option value="">All utilities</option>
                {utilityOptions.map((utility) => (
                  <option key={utility} value={utility}>
                    {utility}
                  </option>
                ))}
              </select>

              <input
                type="month"
                value={filters.billingPeriod}
                onChange={(e) => setFilters((prev) => ({ ...prev, billingPeriod: e.target.value }))}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#D97706]"
              />

              <select
                value={filters.status}
                onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#D97706]"
              >
                <option value="">All statuses</option>
                <option value="draft">Draft</option>
                <option value="billed">Billed</option>
                <option value="void">Void</option>
              </select>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-600">
              <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
                <FaFilter /> {filteredReadings.length} reading(s)
              </span>
              <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 font-semibold text-amber-800">
                Draft {filteredReadings.filter((item) => item.status === "draft").length}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 font-semibold text-emerald-800">
                Billed {filteredReadings.filter((item) => item.status === "billed").length}
              </span>
              {selectedDraftCount > 0 && (
                <span className="inline-flex items-center gap-2 rounded-full bg-orange-100 px-3 py-1 font-semibold text-orange-800">
                  Selected {selectedDraftCount}
                </span>
              )}
            </div>

            <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={allVisibleDraftSelected}
                        onChange={handleToggleSelectAllVisibleDrafts}
                        disabled={selectableFilteredReadings.length === 0}
                        className="h-4 w-4 rounded border-slate-300"
                        title="Select all visible draft readings"
                      />
                    </th>
                    <th className="px-4 py-3">Period</th>
                    <th className="px-4 py-3">Property / Unit</th>
                    <th className="px-4 py-3">Tenant</th>
                    <th className="px-4 py-3">Utility</th>
                    <th className="px-4 py-3">Readings</th>
                    <th className="px-4 py-3">Consumption</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100 bg-white">
                  {loading ? (
                    <tr>
                      <td colSpan="10" className="px-4 py-10 text-center text-slate-500">
                        Loading meter readings...
                      </td>
                    </tr>
                  ) : filteredReadings.length === 0 ? (
                    <tr>
                      <td colSpan="10" className="px-4 py-10 text-center text-slate-500">
                        No meter readings found.
                      </td>
                    </tr>
                  ) : (
                    filteredReadings.map((reading) => {
                      const isDraft = reading.status === "draft";
                      const isSelected = selectedReadingIds.includes(reading._id);

                      return (
                        <tr
                          key={reading._id}
                          onClick={() => handleRowClick(reading)}
                          className={`align-top transition ${
                            isDraft ? "cursor-pointer" : "cursor-default"
                          } ${
                            isSelected
                              ? "bg-orange-50 hover:bg-orange-100"
                              : "hover:bg-slate-50"
                          }`}
                        >
                          <td className="px-4 py-3" onClick={stopRowEvent}>
                            {isDraft ? (
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleReadingSelection(reading._id)}
                                className="h-4 w-4 rounded border-slate-300"
                              />
                            ) : (
                              <span className="text-xs text-slate-300">—</span>
                            )}
                          </td>

                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-900">{reading.billingPeriod}</div>
                            <div className="text-xs text-slate-500">
                              {reading.readingDate
                                ? new Date(reading.readingDate).toLocaleDateString()
                                : "-"}
                            </div>
                          </td>

                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-900">
                              {reading?.property?.propertyName || "-"}
                            </div>
                            <div className="text-xs text-slate-500">
                              Unit {reading?.unit?.unitNumber || "-"}
                            </div>
                          </td>

                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-900">
                              {reading?.tenant?.name || "Auto / Not linked"}
                            </div>
                            <div className="text-xs text-slate-500">
                              {reading?.tenant?.tenantCode || "No tenant code"}
                            </div>
                          </td>

                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-900">{reading.utilityType}</div>
                            <div className="text-xs text-slate-500">
                              Meter {reading.meterNumber || "-"}
                            </div>
                          </td>

                          <td className="px-4 py-3">
                            <div className="text-slate-900">Prev: {formatNumber(reading.previousReading)}</div>
                            <div className="text-slate-900">Curr: {formatNumber(reading.currentReading)}</div>
                            {reading.isMeterReset && (
                              <div className="mt-1 inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-semibold text-purple-700">
                                Reset
                              </div>
                            )}
                          </td>

                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-900">
                              {formatNumber(reading.unitsConsumed)} units
                            </div>
                            <div className="text-xs text-slate-500">@ {formatNumber(reading.rate)}</div>
                          </td>

                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-900">
                              {formatMoney(reading.amount)}
                            </div>
                            {reading?.billedInvoice?.invoiceNumber && (
                              <div className="text-xs text-emerald-700">
                                Invoice {reading.billedInvoice.invoiceNumber}
                              </div>
                            )}
                          </td>

                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                                statusBadgeClass[reading.status] || statusBadgeClass.draft
                              }`}
                            >
                              {reading.status}
                            </span>
                          </td>

                          <td className="px-4 py-3" onClick={stopRowEvent}>
                            <div className="flex justify-end gap-2">
                              {isDraft && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleEdit(reading)}
                                    disabled={!canUpdateReading}
                                    className={`${milikSoftBtn} border-orange-200 bg-orange-50 text-orange-800 hover:bg-orange-100`}
                                  >
                                    <FaEdit /> Edit
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => handleBill(reading)}
                                    disabled={!canProcessReading}
                                    className={`${milikSoftBtn} border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100`}
                                  >
                                    <FaFileInvoice /> Bill
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => handleVoid(reading)}
                                    disabled={!canDeleteReading}
                                    className={`${milikSoftBtn} border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100`}
                                  >
                                    <FaBan /> Void
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => handleDelete(reading)}
                                    disabled={!canDeleteReading}
                                    className={`${milikSoftBtn} border-red-200 bg-red-50 text-red-700 hover:bg-red-100`}
                                  >
                                    <FaTrash /> Delete
                                  </button>
                                </>
                              )}

                              {reading?.tenant && reading.status !== "void" && (
                                <button
                                  type="button"
                                  onClick={() => setCommunicationModal({
                                    contextType: "meter_reading",
                                    recordIds: [reading._id],
                                    title: "Notify Affected Tenant",
                                    subtitle: "Preview the final meter or usage notification before sending.",
                                    allowedChannels: ["sms", "email"],
                                    defaultChannel: "sms",
                                  })}
                                  className={`${milikSoftBtn} border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100`}
                                >
                                  <FaSms /> Notify Tenant
                                </button>
                              )}

                              {reading.status === "billed" && (
                                <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                                  <FaCheckCircle /> Posted via invoice
                                </span>
                              )}

                              {reading.status === "void" && (
                                <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
                                  <FaBan /> Voided
                                </span>
                              )}
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
      <CommunicationComposerModal
        open={Boolean(communicationModal)}
        onClose={() => setCommunicationModal(null)}
        businessId={currentCompany?._id || ""}
        contextType={communicationModal?.contextType || "meter_reading"}
        recordIds={communicationModal?.recordIds || []}
        title={communicationModal?.title || "Notify Affected Tenant"}
        subtitle={communicationModal?.subtitle || "Preview the final meter or usage notification before sending."}
        allowedChannels={communicationModal?.allowedChannels || ["sms", "email"]}
        defaultChannel={communicationModal?.defaultChannel || "sms"}
      />
    </DashboardLayout>
  );
};

export default MeterReadings;