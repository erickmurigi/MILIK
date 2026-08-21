import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import PaginationBar from '../../components/PaginationBar';
import { useDispatch, useSelector } from "react-redux";
import { selectCurrentCompany, selectCurrentUser } from "../../redux/selectors";
import { getProperties } from "../../redux/propertyRedux";
import { getUnits, getTenants } from "../../redux/apiCalls";
import { fetchCompanySettings, selectCompanySettings } from "../../redux/companySettingsRedux";
import { toast } from "react-toastify";
import {
  FaArrowLeft,
  FaArrowRight,
  FaBan,
  FaBolt,
  FaCheckCircle,
  FaEdit,
  FaEnvelope,
  FaFileInvoice,
  FaPlus,
  FaPrint,
  FaRedoAlt,
  FaSave,
  FaSearch,
  FaSms,
  FaSync,
  FaTint,
  FaTrash,
} from "react-icons/fa";
import AppSelect from "../../components/common/AppSelect";
import StatusBadge from "../../components/common/StatusBadge";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import CommunicationComposerModal from "../../components/Communications/CommunicationComposerModal";
import { hasCompanyPermission } from "../../utils/permissions";
import { adminRequests } from "../../utils/requestMethods";
import { useConfirm } from "../../context/ConfirmContext";
import { formatMoney } from "../../utils/money";
import { fmtDate } from "../../utils/dates";
import {
  billMeterReading,
  createMeterReading,
  deleteMeterReading,
  getMeterReadings,
  updateMeterReading,
  voidMeterReading,
} from "../../redux/apiCalls";

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";
const MILIK_ORANGE = "bg-[#FF8C00]";
const MILIK_ORANGE_HOVER = "hover:bg-[#e67e00]";

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

const emptyFilters = {
  status: "ALL",
  search: "",
  property: "any",
  unit: "any",
  utilityType: "any",
  billingPeriod: "",
};

const ACTIVE_TENANT_STATUSES = new Set(["active", "overdue"]);

const METER_STATUS_MAP = {
  draft:   "border-orange-200 bg-orange-100 text-orange-700",
  billed:  "border-green-200 bg-green-100 text-green-700",
  void:    "border-slate-200 bg-slate-100 text-slate-700",
  deleted: "border-red-200 bg-red-100 text-red-700",
};

const formatNumber = (value) => {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num.toLocaleString() : "0";
};


const sanitizeDecimalInput = (value) => {
  const raw = String(value ?? "")
    .replace(/,/g, "")
    .replace(/[^\d.]/g, "");

  if (!raw) return "";

  const [whole = "", ...fractionParts] = raw.split(".");
  if (!fractionParts.length) return whole;
  return `${whole}.${fractionParts.join("")}`;
};

const inferUnitsConsumed = (form) => {
  const previous = Number(form.previousReading || 0);
  const current = Number(form.currentReading || 0);
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return 0;
  if (form.isMeterReset) return Math.max(current, 0);
  return Math.max(current - previous, 0);
};

const getStatusLabel = (status) => {
  const normalized = String(status || "draft").trim().toLowerCase();
  if (normalized === "billed") return "Billed";
  if (normalized === "void") return "Voided";
  if (normalized === "deleted") return "Deleted";
  return "Draft";
};

const escapeHtml = (v) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const buildRegisterPrintHtml = ({ company, companyName, rows, totalAmount, filters }) => {
  const co = company || {};
  const name = co.companyName || co.name || companyName || "Current Company";
  const logo = co.logo || "";
  const phone = co.phone || co.phoneNumber || co.mobile || "";
  const email = co.email || co.companyEmail || "";
  const address = co.address || co.location || co.city || "";
  const infoLine = [phone, email, address].filter(Boolean).join(" • ");

  const logoHtml = logo
    ? `<img src="${escapeHtml(logo)}" alt="logo" style="width:80px;height:80px;object-fit:cover;border-radius:12px;border:1px solid #cbd5e1;padding:4px;" />`
    : `<div style="width:80px;height:80px;background:#0B3B2E;color:#fff;font-size:28px;font-weight:900;display:flex;align-items:center;justify-content:center;border-radius:12px">${escapeHtml(name.slice(0, 1).toUpperCase())}</div>`;

  const tableRows = rows
    .map(
      (row, i) => `
        <tr style="${i % 2 === 1 ? "background:#f8fafc" : ""}">
          <td>${escapeHtml(row.billingPeriod || "-")}</td>
          <td>${escapeHtml(row.tenant?.name || "—")}</td>
          <td>${escapeHtml(row.property?.propertyName || "-")}</td>
          <td>${escapeHtml(row.unit?.unitNumber || "-")}</td>
          <td>${escapeHtml(row.utilityType || "-")}</td>
          <td style="text-align:right;font-family:monospace">${formatNumber(row.previousReading)}</td>
          <td style="text-align:right;font-family:monospace">${formatNumber(row.currentReading)}</td>
          <td style="text-align:right;font-family:monospace;font-weight:700">${formatNumber(row.unitsConsumed)}</td>
          <td style="text-align:right;font-family:monospace">${formatNumber(row.rate)}</td>
          <td style="text-align:right;font-family:monospace;font-weight:700">${formatMoney(row.amount)}</td>
          <td>${escapeHtml(getStatusLabel(row.status))}</td>
          <td>${escapeHtml(fmtDate(row.readingDate))}</td>
        </tr>
      `
    )
    .join("");

  const printedOn = new Date().toLocaleDateString("en-KE", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Meter Readings Register — ${escapeHtml(name)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;padding:24px 28px;font-size:11px}
    .hdr{display:grid;grid-template-columns:96px 1fr 160px;align-items:center;border-bottom:3px solid #0B3B2E;padding-bottom:14px;margin-bottom:16px;gap:12px}
    .co-name{font-size:20px;font-weight:900;color:#0B3B2E;letter-spacing:.01em}
    .co-sub{font-size:10px;color:#64748b;margin-top:3px;line-height:1.5}
    .rpt-title{font-size:15px;font-weight:800;margin-top:5px;color:#1e293b}
    .hdr-right{text-align:right;font-size:10px;color:#64748b;line-height:1.6}
    .summary-bar{display:flex;gap:16px;margin-bottom:14px;padding:8px 12px;background:#f0faf5;border-left:3px solid #0B3B2E;border-radius:0 6px 6px 0;font-size:11px;font-weight:700;color:#334155}
    .summary-bar span{color:#0B3B2E}
    table{width:100%;border-collapse:collapse;font-size:10px}
    thead th{background:#0B3B2E;color:#fff;padding:8px 9px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;border:1px solid rgba(255,255,255,.15);white-space:nowrap}
    thead th.right{text-align:right}
    tbody td{padding:7px 9px;border:1px solid #e2e8f0;vertical-align:top}
    tfoot td{padding:8px 9px;font-weight:800;border-top:2px solid #0B3B2E;background:#f0faf5;color:#0B3B2E}
    tfoot td.right{text-align:right;font-family:monospace}
    @media print{
      body{padding:10px 12px}
      @page{size:A4 landscape;margin:8mm 10mm}
      thead th{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    }
  </style>
</head>
<body>
  <div class="hdr">
    <div>${logoHtml}</div>
    <div style="text-align:center">
      <div class="co-name">${escapeHtml(name)}</div>
      ${infoLine ? `<div class="co-sub">${escapeHtml(infoLine)}</div>` : ""}
      <div class="rpt-title">Meter Readings Register</div>
    </div>
    <div class="hdr-right">
      Printed: ${escapeHtml(printedOn)}<br/>
      Records: <strong>${rows.length.toLocaleString()}</strong>
    </div>
  </div>

  <div class="summary-bar">
    <div>Total Records: <span>${rows.length.toLocaleString()}</span></div>
    <div>Total Amount: <span>${formatMoney(totalAmount)}</span></div>
    ${filters?.billingPeriod ? `<div>Period: <span>${escapeHtml(filters.billingPeriod)}</span></div>` : ""}
    ${filters?.utilityType && filters.utilityType !== "any" ? `<div>Utility: <span>${escapeHtml(filters.utilityType)}</span></div>` : ""}
  </div>

  <table>
    <thead>
      <tr>
        <th>Period</th>
        <th>Tenant</th>
        <th>Property</th>
        <th>Unit</th>
        <th>Utility</th>
        <th class="right">Previous</th>
        <th class="right">Current</th>
        <th class="right">Consumed</th>
        <th class="right">Rate</th>
        <th class="right">Amount</th>
        <th>Status</th>
        <th>Reading Date</th>
      </tr>
    </thead>
    <tbody>${tableRows || `<tr><td colspan="12" style="text-align:center;padding:16px;color:#94a3b8;font-style:italic">No records</td></tr>`}</tbody>
    <tfoot>
      <tr>
        <td colspan="9" style="text-align:right">Total (${rows.length.toLocaleString()} records)</td>
        <td class="right">${formatMoney(totalAmount)}</td>
        <td colspan="2"></td>
      </tr>
    </tfoot>
  </table>
</body>
</html>`;
};

const MeterReadings = () => {
  const [pageSize, setPageSize] = useState(50);
  const confirm = useConfirm();
  const dispatch = useDispatch();
  const currentCompany = useSelector(selectCurrentCompany);
  const businessId = currentCompany?._id || "";
  const currentUser = useSelector(selectCurrentUser);

  const companySettings = useSelector(selectCompanySettings);
  const reduxProperties = useSelector((s) => s.property?.properties || []);
  const reduxUnits = useSelector((s) => s.unit?.units || []);
  const reduxTenants = useSelector((s) => s.tenant?.tenants || []);

  const canCreateReading = hasCompanyPermission(
    currentUser || {},
    currentCompany,
    "meterReadings",
    "create",
    "propertyManagement"
  );
  const canUpdateReading = hasCompanyPermission(
    currentUser || {},
    currentCompany,
    "meterReadings",
    "update",
    "propertyManagement"
  );
  const canDeleteReading = hasCompanyPermission(
    currentUser || {},
    currentCompany,
    "meterReadings",
    "delete",
    "propertyManagement"
  );
  const canProcessReading = hasCompanyPermission(
    currentUser || {},
    currentCompany,
    "meterReadings",
    "process",
    "propertyManagement"
  );

  const [properties, setProperties] = useState([]);
  const [units, setUnits] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [utilityList, setUtilityList] = useState([]);
  const [readings, setReadings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bulkBilling, setBulkBilling] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedReadingIds, setSelectedReadingIds] = useState([]);
  const [appliedFilters, setAppliedFilters] = useTabState("/meter-readings:appliedFilters", emptyFilters);
  const [draftFilters, setDraftFilters] = useState(appliedFilters);
  const setFilter = (key) => (e) => setDraftFilters((prev) => ({ ...prev, [key]: e.target.value }));
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState("");
  const [communicationModal, setCommunicationModal] = useState(null);
  const [currentPage, setCurrentPage] = useTabState("/meter-readings:currentPage", 1);
  const [rowActionKey, setRowActionKey] = useState("");

  // Sync local state from Redux so existing JSX references work unchanged
  useEffect(() => { if (reduxProperties.length) setProperties(reduxProperties); }, [reduxProperties]);
  useEffect(() => { if (reduxUnits.length) setUnits(reduxUnits); }, [reduxUnits]);
  useEffect(() => { if (reduxTenants.length) setTenants(reduxTenants); }, [reduxTenants]);

  // Derive utility options from Redux data and the raw /utilities response
  const propertyOptions = useMemo(
    () => properties.map((property) => ({ value: property._id, label: property.propertyName || property.name || property.propertyCode })),
    [properties]
  );

  const utilityOptions = useMemo(() => {
    const names = new Set();
    utilityList.forEach((item) => { if (item?.name) names.add(String(item.name)); });
    (companySettings?.utilityTypes || []).forEach((item) => {
      if (item?.isActive !== false && item?.name) names.add(String(item.name));
    });
    units.forEach((unit) => {
      (unit?.utilities || []).forEach((item) => {
        if (item?.utility) names.add(String(item.utility));
      });
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [utilityList, companySettings, units]);

  const loadPageData = useCallback(async () => {
    if (!businessId) return;

    setLoading(true);
    try {
      const [utilitiesRes, readingsRes] = await Promise.all([
        adminRequests.get(`/utilities?business=${businessId}`),
        getMeterReadings({ business: businessId }),
      ]);

      setUtilityList(normalizeList(utilitiesRes.data));
      setReadings(Array.isArray(readingsRes) ? readingsRes : []);
      setSelectedReadingIds((prev) =>
        prev.filter((id) => (Array.isArray(readingsRes) ? readingsRes : []).some((row) => row._id === id))
      );
    } catch (error) {
      toast.error(
        error.response?.data?.message ||
          error.response?.data?.error ||
          "Failed to load meter readings data."
      );
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  // Trigger Redux loads for shared data (no-op if already in store)
  useEffect(() => {
    if (!businessId) return;
    dispatch(getProperties({ business: businessId }));
    getUnits(dispatch, businessId);
    getTenants(dispatch, businessId);
    dispatch(fetchCompanySettings(businessId));
  }, [businessId, dispatch]);

  useEffect(() => {
    loadPageData();
  }, [loadPageData]);

  const filteredUnits = useMemo(() => {
    if (!form.property) return units;
    return units.filter(
      (unit) => String(unit?.property?._id || unit?.property) === String(form.property)
    );
  }, [units, form.property]);

  const filteredTenants = useMemo(() => {
    const scopedTenants = !form.unit
      ? tenants
      : tenants.filter((tenant) => {
          const uid = String(form.unit);
          if (String(tenant?.unit?._id || tenant?.unit) === uid) return true;
          return (tenant?.additionalUnits ?? []).some((u) => String(u?._id || u) === uid);
        });

    return scopedTenants.filter((tenant) => {
      const status = String(tenant?.status || "").trim().toLowerCase();
      return ACTIVE_TENANT_STATUSES.has(status) || String(tenant?._id || "") === String(form.tenant || "");
    });
  }, [tenants, form.unit, form.tenant]);

  const unitsForSelectedProperty = useMemo(() => {
    if (draftFilters.property === "any") return units;
    return units.filter(
      (unit) =>
        String(unit?.property?._id || unit?.property) === String(draftFilters.property)
    );
  }, [units, draftFilters.property]);

  const selectedUnit = useMemo(
    () => units.find((unit) => String(unit._id) === String(form.unit)),
    [units, form.unit]
  );

  const selectedUnitUtilityOptions = useMemo(() => {
    const unitUtilityNames = Array.from(
      new Set(
        (selectedUnit?.utilities || [])
          .map((item) => String(item?.utility || "").trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));

    if (!unitUtilityNames.length) return utilityOptions;

    const seen = new Set(unitUtilityNames.map((item) => item.toLowerCase()));
    const fallback = utilityOptions.filter((item) => !seen.has(String(item || "").toLowerCase()));
    return [...unitUtilityNames, ...fallback];
  }, [selectedUnit, utilityOptions]);

  const inferredPreviousReading = useMemo(() => {
    if (!form.property || !form.unit || !form.utilityType) return 0;

    const targetUtility = String(form.utilityType || "").trim().toLowerCase();
    const targetPeriod = String(form.billingPeriod || "").trim();

    const candidates = readings
      .filter((reading) => {
        if (editingId && String(reading?._id || "") === String(editingId)) return false;
        if (!["draft", "billed"].includes(String(reading?.status || "").trim().toLowerCase())) return false;
        if (String(reading?.property?._id || reading?.property || "") !== String(form.property)) return false;
        if (String(reading?.unit?._id || reading?.unit || "") !== String(form.unit)) return false;
        if (String(reading?.utilityType || "").trim().toLowerCase() !== targetUtility) return false;

        const readingPeriod = String(reading?.billingPeriod || "").trim();
        if (/^\d{4}-\d{2}$/.test(targetPeriod) && /^\d{4}-\d{2}$/.test(readingPeriod)) {
          return readingPeriod < targetPeriod;
        }

        return true;
      })
      .sort((a, b) => {
        const periodCompare = String(b?.billingPeriod || "").localeCompare(String(a?.billingPeriod || ""));
        if (periodCompare !== 0) return periodCompare;
        return new Date(b?.readingDate || 0).getTime() - new Date(a?.readingDate || 0).getTime();
      });

    return Number(candidates[0]?.currentReading || 0);
  }, [readings, form.property, form.unit, form.utilityType, form.billingPeriod, editingId]);

  const effectivePreviousReading = form.previousReading === "" ? inferredPreviousReading : Number(form.previousReading || 0);

  const formDerived = useMemo(() => {
    const unitsConsumed = inferUnitsConsumed({
      ...form,
      previousReading: effectivePreviousReading,
    });
    const rate = Number(form.rate || 0);
    return {
      unitsConsumed,
      amount: Number((unitsConsumed * rate).toFixed(2)),
    };
  }, [form, effectivePreviousReading]);

  const selectedAutoTenant = useMemo(
    () => filteredTenants.find((tenant) => ACTIVE_TENANT_STATUSES.has(String(tenant?.status || "").trim().toLowerCase())) || null,
    [filteredTenants]
  );

  useEffect(() => {
    if (!form.property || !form.utilityType) return;
    if (form.rate !== "" && form.rate !== null) return;

    const normalizedUtility = String(form.utilityType || "").trim().toLowerCase();

    const matchingUnitUtility = (selectedUnit?.utilities || []).find(
      (item) => String(item.utility || "").trim().toLowerCase() === normalizedUtility
    );
    if (matchingUnitUtility && Number.isFinite(Number(matchingUnitUtility.unitCharge))) {
      setForm((prev) => ({ ...prev, rate: String(Number(matchingUnitUtility.unitCharge || 0)) }));
      return;
    }

    const selectedProperty = properties.find((p) => String(p._id) === String(form.property));
    const propertyRate = (selectedProperty?.utilityRates || []).find(
      (r) => String(r?.utilityType || "").trim().toLowerCase() === normalizedUtility && r?.isActive !== false
    );
    if (propertyRate && Number.isFinite(Number(propertyRate.unitCost))) {
      setForm((prev) => ({ ...prev, rate: String(Number(propertyRate.unitCost || 0)) }));
    }
  }, [selectedUnit, form.utilityType, form.property, properties]);

  useEffect(() => {
    setSelectedReadingIds((prev) => prev.filter((id) => readings.some((reading) => reading._id === id)));
  }, [readings]);

  const filteredReadings = useMemo(() => {
    return readings.filter((reading) => {
      const searchBase = [
        reading?.property?.propertyName,
        reading?.unit?.unitNumber,
        reading?.tenant?.name,
        reading?.tenant?.tenantCode,
        reading?.utilityType,
        reading?.billingPeriod,
        reading?.meterNumber,
        reading?.billedInvoice?.invoiceNumber,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (appliedFilters.status !== "ALL" && String(reading?.status || "") !== appliedFilters.status) {
        return false;
      }
      if (
        appliedFilters.property !== "any" &&
        String(reading?.property?._id || reading?.property) !== String(appliedFilters.property)
      ) {
        return false;
      }
      if (
        appliedFilters.unit !== "any" &&
        String(reading?.unit?._id || reading?.unit) !== String(appliedFilters.unit)
      ) {
        return false;
      }
      if (
        appliedFilters.utilityType !== "any" &&
        String(reading?.utilityType || "").toLowerCase() !==
          String(appliedFilters.utilityType).toLowerCase()
      ) {
        return false;
      }
      if (
        appliedFilters.billingPeriod &&
        String(reading?.billingPeriod || "") !== String(appliedFilters.billingPeriod)
      ) {
        return false;
      }
      if (appliedFilters.search && !searchBase.includes(String(appliedFilters.search).toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [readings, appliedFilters]);

  useEffect(() => {
    setCurrentPage(1);
  }, [appliedFilters, readings]);

  const totalPages = Math.max(1, Math.ceil(filteredReadings.length / pageSize));
  const currentSafePage = Math.min(currentPage, totalPages);
  const startIndex = (currentSafePage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const currentPageReadings = filteredReadings.slice(startIndex, endIndex);

  const selectedRows = useMemo(
    () => readings.filter((row) => selectedReadingIds.includes(row._id)),
    [readings, selectedReadingIds]
  );
  const selectedDraftRows = selectedRows.filter((row) => row.status === "draft");
  const selectedDeletableRows = selectedRows.filter((row) => row.status !== "deleted");
  const selectedCount = selectedRows.length;
  const selectedDraftCount = selectedDraftRows.length;
  const canEditSelected =
    canUpdateReading && selectedRows.length === 1 && String(selectedRows[0]?.status || "") === "draft";

  const visibleSelectableRows = currentPageReadings.filter((row) => row.status !== "deleted");
  const selectAll =
    visibleSelectableRows.length > 0 &&
    visibleSelectableRows.every((row) => selectedReadingIds.includes(row._id));

  const totalAmount = filteredReadings.reduce((sum, item) => sum + Number(item?.amount || 0), 0);
  const draftAmount = filteredReadings
    .filter((item) => item.status === "draft")
    .reduce((sum, item) => sum + Number(item?.amount || 0), 0);
  const billedAmount = filteredReadings
    .filter((item) => item.status === "billed")
    .reduce((sum, item) => sum + Number(item?.amount || 0), 0);

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
      const normalizedValue = ["previousReading", "currentReading", "rate"].includes(field)
        ? sanitizeDecimalInput(value)
        : value;

      const next = { ...prev, [field]: normalizedValue };
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
      setSelectedReadingIds((prev) => prev.filter((id) => normalized.some((row) => row._id === id)));
    } catch (error) {
      toast.error(
        error.response?.data?.message ||
          error.response?.data?.error ||
          "Failed to refresh meter readings."
      );
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
        tenant: form.tenant || selectedAutoTenant?._id || null,
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
        form.currentReading === "" ||
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
        toast.success("Meter reading updated successfully.");
      } else {
        await createMeterReading(payload);
        toast.success("Meter reading created successfully.");
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

  const handleDeleteSingle = async (reading) => {
    if (!canDeleteReading) return;

    const isBilled = String(reading?.status || "") === "billed";
    const confirmMessage = isBilled
      ? `Delete meter reading for ${reading?.unit?.unitNumber || "this unit"}? This will also reverse the linked invoice ledger entries.`
      : `Delete meter reading for ${reading?.unit?.unitNumber || "this unit"}?`;

    const ok = await confirm({ title: "Delete Meter Reading", message: confirmMessage, confirmText: "Delete", isDangerous: true });
    if (!ok) return;

    setRowActionKey(`delete-${reading._id}`);
    try {
      const response = await deleteMeterReading(reading._id);
      toast.success(response?.message || "Meter reading deleted successfully.");
      await refreshReadings();
      if (editingId === reading._id) {
        resetForm();
        setShowAddModal(false);
      }
      setSelectedReadingIds((prev) => prev.filter((id) => id !== reading._id));
    } catch (error) {
      toast.error(
        error.response?.data?.message ||
          error.response?.data?.error ||
          "Failed to delete meter reading."
      );
    } finally {
      setRowActionKey("");
    }
  };

  const handleVoidSingle = async (reading) => {
    if (!canDeleteReading) return;
    if (!await confirm({ title: "Void Meter Reading", message: "Void this meter reading? This action cannot be undone.", confirmText: "Void", isDangerous: true })) return;

    setRowActionKey(`void-${reading._id}`);
    try {
      const response = await voidMeterReading(reading._id, {
        notes: reading.notes || "Voided from meter readings page",
      });
      toast.success(response?.message || "Meter reading voided successfully.");
      await refreshReadings();
      if (editingId === reading._id) {
        resetForm();
        setShowAddModal(false);
      }
      setSelectedReadingIds((prev) => prev.filter((id) => id !== reading._id));
    } catch (error) {
      toast.error(
        error.response?.data?.message ||
          error.response?.data?.error ||
          "Failed to void meter reading."
      );
    } finally {
      setRowActionKey("");
    }
  };

  const handleBillSingle = async (reading) => {
    if (!canProcessReading) return;
    if (!await confirm({ title: "Generate Utility Invoice", message: "Convert this meter reading into a tenant utility invoice?", confirmText: "Generate Invoice" })) return;

    setRowActionKey(`bill-${reading._id}`);
    try {
      const response = await billMeterReading(reading._id, {
        invoiceDate: reading.readingDate,
        dueDate: reading.readingDate,
      });
      toast.success(
        response?.message ||
          `Meter reading billed${
            response?.invoice?.invoiceNumber ? ` as ${response.invoice.invoiceNumber}` : ""
          }.`
      );
      await refreshReadings();
      if (editingId === reading._id) {
        resetForm();
        setShowAddModal(false);
      }
      setSelectedReadingIds((prev) => prev.filter((id) => id !== reading._id));
    } catch (error) {
      toast.error(
        error.response?.data?.message ||
          error.response?.data?.error ||
          "Failed to bill meter reading."
      );
    } finally {
      setRowActionKey("");
    }
  };

  const toggleRowSelection = (readingId) => {
    setSelectedReadingIds((prev) =>
      prev.includes(readingId) ? prev.filter((id) => id !== readingId) : [...prev, readingId]
    );
  };

  const toggleSelectAll = () => {
    if (selectAll) {
      setSelectedReadingIds((prev) =>
        prev.filter((id) => !visibleSelectableRows.some((row) => row._id === id))
      );
      return;
    }

    setSelectedReadingIds((prev) => {
      const next = new Set(prev);
      visibleSelectableRows.forEach((row) => next.add(row._id));
      return Array.from(next);
    });
  };

  const handleRowClick = (reading) => {
    if (reading.status === "deleted") return;
    toggleRowSelection(reading._id);
  };

  const handleBulkBill = async () => {
    if (selectedDraftRows.length === 0) {
      toast.info("Select at least one draft meter reading to bill.");
      return;
    }

    if (!await confirm({
      title: "Bill Selected Readings",
      message: `Generate utility invoices for ${selectedDraftRows.length} selected meter reading${selectedDraftRows.length > 1 ? "s" : ""}?`,
      confirmText: "Bill All",
    })) return;

    setBulkBilling(true);
    try {
      let successCount = 0;
      let failedCount = 0;

      for (const reading of selectedDraftRows) {
        try {
          await billMeterReading(reading._id, {
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

  const handleDeleteSelected = async () => {
    if (selectedDeletableRows.length === 0) {
      toast.info("Select at least one meter reading to delete.");
      return;
    }

    const billedCount = selectedDeletableRows.filter((row) => row.status === "billed").length;
    const confirmMessage = billedCount > 0
      ? `Delete ${selectedDeletableRows.length} selected meter reading(s)? ${billedCount} billed reading(s) will also reverse linked invoice ledger entries.`
      : `Delete ${selectedDeletableRows.length} selected meter reading(s)?`;

    if (!await confirm({ title: "Delete Meter Readings", message: confirmMessage, confirmText: "Delete", isDangerous: true })) return;

    setBulkDeleting(true);
    try {
      let successCount = 0;
      let failedCount = 0;

      for (const reading of selectedDeletableRows) {
        try {
          await deleteMeterReading(reading._id);
          successCount += 1;
        } catch (error) {
          failedCount += 1;
        }
      }

      await refreshReadings();
      setSelectedReadingIds([]);

      if (successCount > 0 && failedCount === 0) {
        toast.success(
          `${successCount} meter reading${successCount > 1 ? "s" : ""} deleted successfully.`
        );
      } else if (successCount > 0 && failedCount > 0) {
        toast.warn(`${successCount} deleted, ${failedCount} failed.`);
      } else {
        toast.error("No selected meter readings were deleted.");
      }
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleEditSelected = () => {
    if (!canEditSelected) {
      toast.info("Select one draft meter reading to edit.");
      return;
    }
    handleEdit(selectedRows[0]);
  };

  const applySearch = () => {
    setAppliedFilters({ ...draftFilters });
  };

  const resetFilters = () => {
    setDraftFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
  };

  const handlePrintList = () => {
    if (filteredReadings.length === 0) {
      toast.info("There are no meter readings to print.");
      return;
    }

    const printWindow = window.open("", "_blank", "width=1200,height=800");
    if (!printWindow) {
      toast.error("Allow popups to print the meter readings register.");
      return;
    }

    printWindow.document.open();
    printWindow.document.write(
      buildRegisterPrintHtml({
        company: currentCompany,
        rows: filteredReadings,
        totalAmount,
        filters: appliedFilters,
      })
    );
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 300);
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 p-2">
        <div className="mx-auto flex w-full max-w-none min-h-0 flex-1 flex-col gap-2">
          <div className="flex-shrink-0 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 shadow-sm">
            <span className="text-xs font-black uppercase tracking-[0.1em] text-slate-800">Meter Readings</span>
            <div className="h-3.5 w-px bg-slate-300" />
            <div className="flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
              <span className="opacity-70">Readings</span> <span className="font-black text-blue-900">{filteredReadings.length}</span>
            </div>
            <div className="flex items-center gap-1 rounded border border-orange-200 bg-orange-50 px-2 py-0.5 text-[10px] font-semibold text-orange-700">
              <span className="opacity-70">Draft</span> <span className="font-black text-orange-900">KES {draftAmount.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-1 rounded border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700">
              <span className="opacity-70">Billed</span> <span className="font-black text-green-900">KES {billedAmount.toLocaleString()}</span>
            </div>
            <div className="ml-auto rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
              {currentCompany?.companyName || currentCompany?.name || "No company selected"}
            </div>
          </div>

          {showAddModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
              <div className="flex flex-col max-h-[92vh] w-full max-w-5xl overflow-hidden border border-slate-200 bg-white shadow-2xl">
                <div className="flex items-center justify-between bg-[#0B3B2E] px-4 py-3 text-white">
                  <h2 className="text-sm font-black uppercase tracking-wide">
                    {editingId ? "Edit meter reading" : "Add meter reading"}
                  </h2>
                  <button
                    type="button"
                    onClick={() => {
                      if (saving) return;
                      resetForm();
                      setShowAddModal(false);
                    }}
                    className="text-white/70 transition-colors hover:text-white"
                  >
                    <FaBan />
                  </button>
                </div>

                <form className="flex flex-col flex-1 overflow-hidden" onSubmit={handleSubmit}>
                  <div className="flex-1 overflow-y-auto bg-white px-5 py-4 space-y-4">
                    {/* ── Property + Unit ── */}
                    <div className="grid gap-4 md:grid-cols-2">
                      <AppSelect
                        label="Property"
                        required
                        value={form.property}
                        onChange={(v) => handleFormChange("property", v ?? "")}
                        options={propertyOptions}
                        placeholder="Select property"
                        searchable
                        size="md"
                      />

                      <AppSelect
                        label="Unit"
                        required
                        value={form.unit}
                        onChange={(v) => handleFormChange("unit", v ?? "")}
                        options={filteredUnits.map((unit) => ({ value: unit._id, label: unit.unitNumber }))}
                        placeholder="Select unit"
                        size="md"
                      />
                    </div>

                    {/* ── Tenant (read-only, auto-detected from unit) ── */}
                    {form.unit && (
                      <div className={`flex items-center gap-3 rounded-md border px-4 py-2.5 ${
                        selectedAutoTenant
                          ? "border-emerald-200 bg-emerald-50"
                          : "border-amber-200 bg-amber-50"
                      }`}>
                        <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-black ${
                          selectedAutoTenant ? "bg-emerald-600 text-white" : "bg-amber-500 text-white"
                        }`}>
                          {selectedAutoTenant ? selectedAutoTenant.name?.charAt(0)?.toUpperCase() || "T" : "!"}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Tenant / Occupant</p>
                          {selectedAutoTenant ? (
                            <p className="truncate text-xs font-semibold text-emerald-800">
                              {selectedAutoTenant.name}
                              <span className="ml-2 font-normal text-emerald-600">· auto-detected</span>
                            </p>
                          ) : (
                            <p className="text-xs font-semibold text-amber-800">No active tenant found for this unit</p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* ── Utility + Billing Period ── */}
                    <div className="grid gap-4 md:grid-cols-2">
                      <AppSelect
                        label="Utility type"
                        required
                        value={form.utilityType}
                        onChange={(v) => handleFormChange("utilityType", v ?? "")}
                        options={selectedUnitUtilityOptions.map((utility) => ({ value: utility, label: utility }))}
                        placeholder="Select utility"
                        size="md"
                      />

                      <label className="block">
                        <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">
                          Billing period <span className="text-red-500">*</span>
                        </span>
                        <input
                          type="month"
                          value={form.billingPeriod}
                          onChange={(e) => handleFormChange("billingPeriod", e.target.value)}
                          className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Reading date</span>
                        <input
                          type="date"
                          value={form.readingDate}
                          onChange={(e) => handleFormChange("readingDate", e.target.value)}
                          className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Rate per unit</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={form.rate}
                          onChange={(e) => handleFormChange("rate", e.target.value)}
                          className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Previous reading</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={form.previousReading === "" ? (inferredPreviousReading > 0 ? String(inferredPreviousReading) : "") : form.previousReading}
                          onChange={(e) => handleFormChange("previousReading", e.target.value)}
                          className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                          placeholder="0"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">
                          Current reading <span className="text-red-500">*</span>
                        </span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={form.currentReading}
                          onChange={(e) => handleFormChange("currentReading", e.target.value)}
                          className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                        />
                      </label>

                      <label className="block md:col-span-2">
                        <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Meter number</span>
                        <input
                          type="text"
                          value={form.meterNumber}
                          onChange={(e) => handleFormChange("meterNumber", e.target.value)}
                          className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                        />
                      </label>

                      <label className="block md:col-span-2">
                        <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Notes</span>
                        <textarea
                          rows={3}
                          value={form.notes}
                          onChange={(e) => handleFormChange("notes", e.target.value)}
                          className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                        />
                      </label>
                    </div>

                    <div className="flex items-center gap-2 rounded-lg border border-purple-200 bg-purple-50 px-4 py-3 text-sm text-purple-900">
                      <input
                        id="meter-reset"
                        type="checkbox"
                        checked={Boolean(form.isMeterReset)}
                        onChange={(e) => handleFormChange("isMeterReset", e.target.checked)}
                        className="h-4 w-4 rounded border-purple-300"
                      />
                      <label htmlFor="meter-reset" className="cursor-pointer font-medium">
                        Meter reset / rollover during this capture
                      </label>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded border border-blue-200 bg-blue-50 p-3">
                        <p className="text-[11px] font-semibold text-blue-600">Units Consumed</p>
                        <p className="text-lg font-bold text-blue-900">
                          {formatNumber(formDerived.unitsConsumed)} units
                        </p>
                      </div>
                      <div className="rounded border border-orange-200 bg-orange-50 p-3">
                        <p className="text-[11px] font-semibold text-orange-600">Rate</p>
                        <p className="text-lg font-bold text-orange-900">
                          {formatMoney(form.rate || 0)}
                        </p>
                      </div>
                      <div className="rounded border border-green-200 bg-green-50 p-3">
                        <p className="text-[11px] font-semibold text-green-600">Charge Preview</p>
                        <p className="text-lg font-bold text-green-900">
                          {formatMoney(formDerived.amount)}
                        </p>
                      </div>
                    </div>

                  </div>
                  <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
                    <button
                      type="button"
                      onClick={() => {
                        resetForm();
                        setShowAddModal(false);
                      }}
                      className="border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={saving || (!editingId && !canCreateReading) || (editingId && !canUpdateReading)}
                      className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-black text-white ${
                        saving || (!editingId && !canCreateReading) || (editingId && !canUpdateReading)
                          ? "cursor-not-allowed bg-gray-400"
                          : `${MILIK_GREEN} hover:bg-[#0A3127]`
                      }`}
                    >
                      <FaSave /> {saving ? "Saving..." : editingId ? "Update Reading" : "Save Reading"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
            <div className="flex-none sticky top-0 z-20 border-b border-gray-200 bg-white shadow-sm">
              <div className="filter-bar flex items-center gap-0.5 overflow-x-auto px-2 py-1">
                {[{val:"ALL",label:"All"},{val:"draft",label:"Draft"},{val:"billed",label:"Billed"},{val:"void",label:"Voided"}].map(({val,label}) => (
                  <button key={val} onClick={() => setDraftFilters((prev) => ({ ...prev, status: val }))} className={`h-[20px] shrink-0 px-1.5 text-[9px] font-semibold ${draftFilters.status === val ? `${MILIK_GREEN} text-white` : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-100"}`}>{label}</button>
                ))}
                <div className="mx-1 h-3 w-px shrink-0 bg-slate-200" />
                <input type="text" value={draftFilters.search} onChange={setFilter("search")} placeholder="Search…" className="h-[20px] w-36 shrink-0 border border-gray-300 px-1.5 text-[9px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
                <AppSelect value={draftFilters.property} onChange={(v) => setDraftFilters((prev) => ({ ...prev, property: v ?? "any", unit: "any" }))} options={propertyOptions} placeholder="Property" clearable searchable compact />
                <AppSelect value={draftFilters.unit} onChange={(v) => setDraftFilters((prev) => ({ ...prev, unit: v ?? "any" }))} options={unitsForSelectedProperty.map((unit) => ({ value: unit._id, label: unit.unitNumber }))} placeholder="Unit" clearable compact />
                <AppSelect value={draftFilters.utilityType} onChange={(v) => setDraftFilters((prev) => ({ ...prev, utilityType: v ?? "any" }))} options={utilityOptions.map((utility) => ({ value: utility, label: utility }))} placeholder="Utility" clearable compact />
                <input type="month" value={draftFilters.billingPeriod} onChange={setFilter("billingPeriod")} className="h-[20px] w-[5.5rem] shrink-0 border border-gray-300 px-1 text-[9px]" />
                <button onClick={applySearch} className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] text-white shadow-sm ${MILIK_ORANGE} ${MILIK_ORANGE_HOVER}`}><FaSearch size={7} /> Search</button>
                <button onClick={resetFilters} className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] text-white shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}><FaRedoAlt size={7} /> Reset</button>
                <button onClick={handleEditSelected} disabled={!canEditSelected} className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] text-white shadow-sm ${canEditSelected ? `${MILIK_GREEN} ${MILIK_GREEN_HOVER}` : "bg-gray-400 cursor-not-allowed"}`}><FaEdit size={7} /> Edit</button>
                <button onClick={handleDeleteSelected} disabled={selectedDeletableRows.length === 0 || bulkDeleting || !canDeleteReading} className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] text-white shadow-sm ${selectedDeletableRows.length > 0 && !bulkDeleting && canDeleteReading ? "bg-red-600 hover:bg-red-700" : "bg-gray-400 cursor-not-allowed"}`}><FaTrash size={7} /> Delete</button>
                <button onClick={handleBulkBill} disabled={selectedDraftCount === 0 || bulkBilling || !canProcessReading} className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] text-white shadow-sm ${selectedDraftCount > 0 && !bulkBilling && canProcessReading ? `${MILIK_GREEN} ${MILIK_GREEN_HOVER}` : "bg-gray-400 cursor-not-allowed"}`}><FaFileInvoice size={7} /> {bulkBilling ? "…" : "Bill"}</button>
                <button
                  onClick={() => setCommunicationModal({ contextType: "meter_reading", recordIds: selectedReadingIds, title: `Notify ${selectedCount} Tenant${selectedCount !== 1 ? "s" : ""}`, subtitle: "Send meter reading notification via SMS.", allowedChannels: ["sms", "email"], defaultChannel: "sms" })}
                  disabled={selectedCount === 0}
                  title={selectedCount === 0 ? "Select readings to SMS tenants" : `SMS ${selectedCount} tenant${selectedCount !== 1 ? "s" : ""}`}
                  className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] text-white shadow-sm ${selectedCount > 0 ? "bg-teal-600 hover:bg-teal-700" : "bg-gray-400 cursor-not-allowed"}`}
                ><FaSms size={7} /> SMS</button>
                <button
                  onClick={() => setCommunicationModal({ contextType: "meter_reading", recordIds: selectedReadingIds, title: `Email ${selectedCount} Tenant${selectedCount !== 1 ? "s" : ""}`, subtitle: "Send meter reading notification via email.", allowedChannels: ["email"], defaultChannel: "email" })}
                  disabled={selectedCount === 0}
                  title={selectedCount === 0 ? "Select readings to email tenants" : `Email ${selectedCount} tenant${selectedCount !== 1 ? "s" : ""}`}
                  className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] text-white shadow-sm ${selectedCount > 0 ? "bg-blue-600 hover:bg-blue-700" : "bg-gray-400 cursor-not-allowed"}`}
                ><FaEnvelope size={7} /> Email</button>
                <button onClick={handlePrintList} disabled={filteredReadings.length === 0} className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] text-white shadow-sm ${filteredReadings.length > 0 ? `${MILIK_GREEN} ${MILIK_GREEN_HOVER}` : "bg-gray-400 cursor-not-allowed"}`}><FaPrint size={7} /> Print</button>
                <button onClick={loadPageData} className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] text-white shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}><FaSync size={7} /> Refresh</button>
                <button onClick={openAddSectionForNew} disabled={!canCreateReading} className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] text-white shadow-sm ${canCreateReading ? `${MILIK_ORANGE} ${MILIK_ORANGE_HOVER}` : "bg-gray-400 cursor-not-allowed"}`}><FaPlus size={7} /> Add</button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full min-w-[1540px] text-[11px] border-collapse">
                <thead className="sticky top-0 z-10 shadow-sm">
                  <tr className={`${MILIK_GREEN} text-white`}>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">
                      <input
                        type="checkbox"
                        checked={currentPageReadings.length > 0 && selectAll}
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Period</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Tenant</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Property</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Unit</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Utility</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">Previous</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">Current</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">Consumed</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">Rate</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">Amount</th>
                    <th className="px-3 py-1 text-center font-bold border-r border-white/10">Status</th>
                    <th className="px-3 py-1 text-center font-bold border-r border-white/10">Created</th>
                    <th className="px-3 py-1 text-right font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan="14" className="px-4 py-8 text-center text-gray-500">
                        Loading meter readings...
                      </td>
                    </tr>
                  ) : filteredReadings.length === 0 ? (
                    <tr>
                      <td colSpan="14" className="px-4 py-8 text-center text-gray-500">
                        <FaTint className="mb-2 inline-block text-4xl text-gray-300" />
                        <p className="mt-1 text-sm font-semibold">No meter readings found</p>
                        <p className="mt-1 text-xs text-gray-400">
                          Add a new reading or adjust the filters to view more results.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    currentPageReadings.map((reading, idx) => {
                      const isSelected = selectedReadingIds.includes(reading._id);
                      const isDraft = reading.status === "draft";
                      const isBilled = reading.status === "billed";
                      const isVoid = reading.status === "void";
                      const deleteBusy = rowActionKey === `delete-${reading._id}`;
                      const billBusy = rowActionKey === `bill-${reading._id}`;
                      const voidBusy = rowActionKey === `void-${reading._id}`;

                      return (
                        <tr
                          key={reading._id}
                          className={`border-b border-gray-100 transition-colors ${
                            isSelected
                              ? "bg-emerald-50/85 shadow-[inset_4px_0_0_0_#0B3B2E] hover:bg-emerald-50"
                              : idx % 2 === 0
                              ? "bg-white hover:bg-blue-50/40"
                              : "bg-slate-50/60 hover:bg-blue-50/40"
                          }`}
                          onClick={() => handleRowClick(reading)}
                        >
                          <td className="px-3 py-1 border-r border-gray-100">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleRowSelection(reading._id)}
                              onClick={(e) => e.stopPropagation()}
                              disabled={reading.status === "deleted"}
                            />
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100">
                            <div className="font-bold text-blue-700">{reading.billingPeriod || "-"}</div>
                            <div className="text-[10px] text-slate-500">{fmtDate(reading.readingDate)}</div>
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100 font-bold text-slate-900">
                            {reading?.tenant?.name || "Auto / Not linked"}
                            <div className="text-[10px] font-normal text-slate-500">
                              {reading?.tenant?.tenantCode || "No tenant code"}
                            </div>
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900">
                            {reading?.property?.propertyName || "-"}
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900">
                            {reading?.unit?.unitNumber || "-"}
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100">
                            <div className="font-semibold text-orange-700">{reading.utilityType || "-"}</div>
                            <div className="text-[10px] text-slate-500">
                              Meter {reading.meterNumber || "-"}
                            </div>
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100 text-right text-slate-700">
                            {formatNumber(reading.previousReading)}
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100 text-right text-slate-700">
                            {formatNumber(reading.currentReading)}
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100 text-right font-semibold text-slate-900">
                            {formatNumber(reading.unitsConsumed)}
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100 text-right text-slate-700">
                            {formatNumber(reading.rate)}
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100 text-right font-bold text-slate-900">
                            {formatMoney(reading.amount)}
                            {reading?.billedInvoice?.invoiceNumber && (
                              <div className="text-[10px] font-semibold text-emerald-700">
                                Invoice {reading.billedInvoice.invoiceNumber}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100 text-center">
                            <StatusBadge status={reading.status || "draft"} map={METER_STATUS_MAP} />
                            {reading.isMeterReset && (
                              <div className="mt-0.5 text-[10px] font-semibold text-purple-700">Reset</div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center text-gray-600">
                            {fmtDate(reading.createdAt || reading.readingDate)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                              {isDraft && (
                                <button
                                  onClick={() => handleEdit(reading)}
                                  className="rounded p-1 text-blue-600 hover:bg-blue-50 hover:text-blue-800"
                                  title="Edit meter reading"
                                  disabled={!canUpdateReading}
                                >
                                  <FaEdit size={12} />
                                </button>
                              )}

                              {isDraft && (
                                <button
                                  onClick={() => handleBillSingle(reading)}
                                  className="rounded p-1 text-green-600 hover:bg-green-50 hover:text-green-800"
                                  title="Bill meter reading"
                                  disabled={!canProcessReading || billBusy}
                                >
                                  <FaFileInvoice size={12} />
                                </button>
                              )}

                              {isDraft && (
                                <button
                                  onClick={() => handleVoidSingle(reading)}
                                  className="rounded p-1 text-amber-600 hover:bg-amber-50 hover:text-amber-800"
                                  title="Void meter reading"
                                  disabled={!canDeleteReading || voidBusy}
                                >
                                  <FaBan size={12} />
                                </button>
                              )}

                              {reading?.tenant && reading.status !== "deleted" && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCommunicationModal({
                                      contextType: "meter_reading",
                                      recordIds: [reading._id],
                                      title: "Notify Affected Tenant",
                                      subtitle:
                                        "Preview the final meter or usage notification before sending.",
                                      allowedChannels: ["sms", "email"],
                                      defaultChannel: "sms",
                                    })
                                  }
                                  className="rounded p-1 text-indigo-600 hover:bg-indigo-50 hover:text-indigo-800"
                                  title="Notify tenant"
                                >
                                  <FaSms size={12} />
                                </button>
                              )}

                              <button
                                onClick={() => handleDeleteSingle(reading)}
                                className="rounded p-1 text-red-600 hover:bg-red-50 hover:text-red-800"
                                title={
                                  isBilled
                                    ? "Delete meter reading and reverse linked invoice"
                                    : isVoid
                                    ? "Delete voided meter reading"
                                    : "Delete meter reading"
                                }
                                disabled={!canDeleteReading || deleteBusy}
                              >
                                <FaTrash size={12} />
                              </button>

                              {isBilled && (
                                <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                  <FaCheckCircle size={10} /> Posted
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

            <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-700">
              <p>
                <span className="font-semibold">Showing:</span> {filteredReadings.length === 0 ? 0 : startIndex + 1}
                {" - "}
                {Math.min(endIndex, filteredReadings.length)} of {filteredReadings.length} reading(s)
                {appliedFilters.status !== "ALL" && ` · Status: ${getStatusLabel(appliedFilters.status)}`}
              </p>
              <p>
                <span className="font-semibold">Selected:</span> {selectedCount}
                {filteredReadings.length > 0 && (
                  <>
                    {" · "}
                    <span className="font-semibold">Total:</span> KES {totalAmount.toLocaleString()}
                  </>
                )}
              </p>
            </div>

            <PaginationBar
              page={currentSafePage}
              pages={totalPages}
              total={filteredReadings.length}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={(n) => { setPageSize(n); setCurrentPage(1); }}
              loading={loading}
              label="meter readings"
            />
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
        subtitle={
          communicationModal?.subtitle ||
          "Preview the final meter or usage notification before sending."
        }
        allowedChannels={communicationModal?.allowedChannels || ["sms", "email"]}
        defaultChannel={communicationModal?.defaultChannel || "sms"}
      />
    </DashboardLayout>
  );
};

export default MeterReadings;
