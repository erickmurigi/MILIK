// pages/Units.js
import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import {
  FaPlus,
  FaSearch,
  FaFileExport,
  FaDownload,
  FaPrint,
  FaGripVertical,
  FaTimes,
  FaSave,
  FaRedoAlt,
  FaEdit,
  FaTrash,
  FaChevronDown,
  FaChevronUp,
  FaArchive,
  FaUndo,
  FaExpandAlt,
  FaCompressAlt,
} from "react-icons/fa";
import MilikTable from '../../components/common/MilikTable';
import { getUnits, deleteUnit, updateUnit } from "../../redux/unitRedux";
import { getProperties } from "../../redux/propertyRedux";
import { selectCurrentCompany, selectCurrentUser, selectAllProperties, selectUnitPagination, selectAllUnits, selectUnitIsFetching } from "../../redux/selectors";
import { hasCompanyPermission } from "../../utils/permissions";
import { toast } from "react-toastify";
import MilikConfirmDialog from "../../components/Modals/MilikConfirmDialog";
import UnitsImportModal from "../../components/Modals/UnitsImportModal";
import { 
  downloadUnitsTemplate, 
  exportUnitsToExcel, 
  parseUnitsExcel 
} from "../../utils/excelTemplates";
import { adminRequests } from "../../utils/requestMethods";
import { getCompanyUnitTypes } from "../../redux/apiCalls";
import { printTabularList } from "../../utils/printList";
import { LISTING_UI, normalizeUppercaseInput, toListingCaps } from "../../utils/listingPageUtils";
import AppSelect from "../../components/common/AppSelect";

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";
const MILIK_ORANGE = "bg-[#FF8C00]";
const MILIK_ORANGE_HOVER = "hover:bg-[#e67e00]";

import PaginationBar from "../../components/PaginationBar";

const DEFAULT_COMPANY_UNIT_TYPES = ["studio", "1bed", "2bed", "3bed", "4bed", "commercial"];

// Module-scope constants — avoids re-allocating on every render
const EMPTY_FILTERS = {
  property: "any",
  status: "active",
  unitType: "any",
  unitNo: "",
  tenant: "",
};

const PROPERTIES_FOR_DROPDOWN = ["A1, KH KENYA", "AAA, PARKLANDS KENYA", "ALL PURPOSE APARTMENT", "ALPHA APARTMENT", "BASIL TOWERS", "BLUE SKY PLAZA"];
const CHARGE_FREQUENCIES = ["Monthly", "Quarterly", "Semi-Annually", "Annually", "One-time"];

// Module-scope option arrays so AppSelect gets a stable reference every render
const PROPERTIES_FOR_DROPDOWN_OPTIONS = PROPERTIES_FOR_DROPDOWN.map((p) => ({ value: p, label: p }));
const CHARGE_FREQUENCIES_OPTIONS = CHARGE_FREQUENCIES.map((f) => ({ value: f, label: f }));

const formatUnitTypeLabel = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  const legacyLabels = {
    studio: "Studio",
    "1bed": "1 Bedroom",
    "2bed": "2 Bedrooms",
    "3bed": "3 Bedrooms",
    "4bed": "4 Bedrooms",
    commercial: "Commercial",
    residential: "Residential",
    utility: "Utility",
    "mixed use": "Mixed Use",
    mixed_use: "Mixed Use",
  };
  if (legacyLabels[lower]) return legacyLabels[lower];
  return raw
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
};

const sanitizeCompanyUnitTypes = (value = []) => {
  const items = Array.isArray(value) ? value : [value];
  const normalized = Array.from(
    new Set(
      items
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .map((item) => item.slice(0, 80))
    )
  );
  return normalized.length ? normalized : [...DEFAULT_COMPANY_UNIT_TYPES];
};

// Pure helper — moved out of component so it's not re-declared every render
const formatRentAmount = (amount) => {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) return "Ksh 0";
  return `Ksh ${numericAmount.toLocaleString("en-KE")}`;
};


const Units = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const unitsData      = useSelector(selectAllUnits);
  const isFetching     = useSelector(selectUnitIsFetching);
  const unitPagination = useSelector(selectUnitPagination);
  const properties = useSelector(selectAllProperties);

  const { canCreateUnit, canUpdateUnit, canDeleteUnit } = useMemo(() => ({
    canCreateUnit: hasCompanyPermission(currentUser || {}, currentCompany, "units", "create", "propertyManagement"),
    canUpdateUnit: hasCompanyPermission(currentUser || {}, currentCompany, "units", "update", "propertyManagement"),
    canDeleteUnit: hasCompanyPermission(currentUser || {}, currentCompany, "units", "delete", "propertyManagement"),
  }), [currentUser, currentCompany]);

  // ---------------------------
  // UI STATE
  // ---------------------------
  const [configuredUnitTypes, setConfiguredUnitTypes] = useState([]);
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useTabState("/units:currentPage", 1);
  const [expandedUnits, setExpandedUnits] = useState([]); // Array to track multiple expanded units

  const [selectedUnits, setSelectedUnits] = useState([]);
  const [selectAll, setSelectAll] = useState(false);
  const selectedUnitsSet = useMemo(() => new Set(selectedUnits), [selectedUnits]);

  const [isResizing, setIsResizing] = useState(false);
  const resizingRef = useRef(null);

  // Archive/Restore dropdown
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [actionMenuPos, setActionMenuPos] = useState({ top: 0, right: 0 });
  const actionMenuRef = useRef(null);
  const actionMenuBtnRef = useRef(null);

  // Modal
  const [showAddUnitModal, setShowAddUnitModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  // ---------------------------
  // MODAL FORM STATE (kept from your code)
  // ---------------------------
  const [formData, setFormData] = useState({
    property: "",
    specifiedFloor: "",
    generalFloorNo: "",
    unitSpaceNo: "",
    ownerOccupied: "No",
    rentPerUnitArea: "",
    marketRent: "",
    areaSqFt: "",
    chargeFreq: "",
    electricityAccountNo: "",
    waterAccountNo: "",
    electricityMeterNo: "",
    waterMeterNo: "",
  });

  const [services, setServices] = useState([{ service: "", costPerArea: "", totalCost: "", checked: false }]);
  const [extraMeters, setExtraMeters] = useState([{ meterNo: "", readingSetup: false }]);

  // Draft persistence — survives tab switches for the Add Unit modal
  const _uDraftKey = (currentCompany?._id && (currentUser?._id || currentUser?.id))
    ? `milik:draft:unit-modal:${currentCompany._id}:${currentUser?._id || currentUser?.id || "u"}`
    : null;
  const _uDraftRestored = useRef(false);

  useEffect(() => {
    if (!_uDraftKey || _uDraftRestored.current) return;
    _uDraftRestored.current = true;
    try {
      const raw = window.sessionStorage.getItem(_uDraftKey);
      if (raw) {
        const { formData: fd, services: sv, extraMeters: em } = JSON.parse(raw);
        if (fd) { setFormData(fd); setShowAddUnitModal(true); }
        if (sv) setServices(sv);
        if (em) setExtraMeters(em);
      }
    } catch {}
  }, [_uDraftKey]);

  useEffect(() => {
    if (!_uDraftKey || !_uDraftRestored.current || !showAddUnitModal) return;
    try { window.sessionStorage.setItem(_uDraftKey, JSON.stringify({ formData, services, extraMeters })); } catch {}
  }, [_uDraftKey, formData, services, extraMeters, showAddUnitModal]);

  // Milik Confirm Dialog
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    title: "",
    message: "",
    confirmText: "Confirm",
    isDangerous: false,
    onConfirm: null,
  });

  // ---------------------------
  // FILTERS (Draft -> Apply with Search button)
  // ---------------------------
  const [appliedFilters, setAppliedFilters] = useTabState("/units:appliedFilters", EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState(appliedFilters);

  const buildUnitParams = useCallback((overridePage = 1, overrideFilters = null) => {
    const f = overrideFilters || appliedFilters;
    const params = { business: currentCompany?._id, page: overridePage, limit: pageSize };
    if (f.property && f.property !== "any") params.property = f.property;
    if (f.status && f.status !== "active" && f.status !== "any") params.status = f.status;
    if (f.unitType && f.unitType !== "any") params.unitType = f.unitType;
    if (f.unitNo) params.unitNumber = f.unitNo.trim();
    if (f.tenant) params.tenantName = f.tenant.trim();
    return params;
  }, [appliedFilters, currentCompany?._id, pageSize]);

  const applySearch = useCallback(() => {
    const newFilters = {
      ...draftFilters,
      unitNo: draftFilters.unitNo.trim(),
      tenant: draftFilters.tenant.trim(),
    };
    setAppliedFilters(newFilters);
    setCurrentPage(1);
    setSelectAll(false);
    setSelectedUnits([]);
    setExpandedUnits([]);
    if (currentCompany?._id) dispatch(getUnits(buildUnitParams(1, newFilters)));
  }, [draftFilters, setAppliedFilters, setCurrentPage, currentCompany?._id, dispatch, buildUnitParams]);

  const resetFilters = useCallback(() => {
    setDraftFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
    setCurrentPage(1);
    setExpandedUnits([]);
    setSelectAll(false);
    setSelectedUnits([]);
    setActionMenuOpen(false);
    if (currentCompany?._id) dispatch(getUnits({ business: currentCompany._id, page: 1, limit: pageSize }));
  }, [setAppliedFilters, setCurrentPage, currentCompany?._id, dispatch, pageSize]);

  const onFilterEnter = useCallback((e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applySearch();
    }
  }, [applySearch]);

  // Close dropdown on outside click
  useEffect(() => {
    const onDocClick = (e) => {
      if (actionMenuBtnRef.current?.contains(e.target)) return;
      if (actionMenuRef.current?.contains(e.target)) return;
      setActionMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Reset selectAll whenever page changes
  useEffect(() => setSelectAll(false), [currentPage]);

  // Fetch units on mount / company switch only
  useEffect(() => {
    if (currentCompany?._id) {
      dispatch(getUnits({ business: currentCompany._id, page: 1, limit: pageSize }));
      dispatch(getProperties({ business: currentCompany._id }));
      getCompanyUnitTypes(currentCompany._id)
        .then((res) => setConfiguredUnitTypes(Array.isArray(res?.unitTypes) ? res.unitTypes.filter((t) => t.isActive !== false) : []))
        .catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, currentCompany?._id]);

  // Transform units data to match the table structure (formatRentAmount moved to module scope)
  const propertyById = useMemo(() => {
    const m = new Map();
    (properties || []).forEach(p => { if (p?._id) m.set(String(p._id), p); });
    return m;
  }, [properties]);

  const unitIndexByProperty = useMemo(() => {
    const countByProp = new Map();
    const indexMap = new Map();
    (unitsData || []).forEach(unit => {
      const propObj = typeof unit.property === 'string' ? propertyById.get(unit.property) : unit.property;
      const propId = String(propObj?._id || unit.property || '');
      const idx = (countByProp.get(propId) || 0) + 1;
      countByProp.set(propId, idx);
      indexMap.set(String(unit._id), idx);
    });
    return indexMap;
  }, [unitsData, propertyById]);

  const transformedUnits = useMemo(() => {
    return (unitsData || []).map((unit) => {
      const propertyObj = typeof unit.property === 'string'
        ? propertyById.get(unit.property)
        : unit.property;

      const propertyDisplayName = propertyObj?.propertyName || "Unknown Property";
      const propertyCode = propertyObj?.propertyCode || "XX";
      const propertyId = String(propertyObj?._id || unit.property || "");
      const first2Letters = propertyDisplayName.substring(0, 2).toUpperCase();
      const unitIndexInProperty = unitIndexByProperty.get(String(unit._id)) || 1;
      
      // Generate unit code: first 2 letters of property name + 4 digit index within property
      const unitCode = `${first2Letters}${String(unitIndexInProperty).padStart(4, '0')}`;

      const rawStatus = (unit.status || "vacant").toLowerCase();
      const hasLiveTenant = Boolean(unit.currentTenant?._id || unit.currentTenant?.name);
      const normalizedStatus = hasLiveTenant && rawStatus !== "archived" ? "occupied" : rawStatus;
      const tenantName = hasLiveTenant ? (unit.currentTenant?.name || "-") : "-";
      const hasCurrentOccupant = normalizedStatus === "occupied" || hasLiveTenant;
      const hasTenantHistory = Boolean(unit.lastTenant?._id || unit.lastTenant?.name || unit.tenant?._id || unit.tenant?.name);
      const canArchive = normalizedStatus !== "archived" && !hasCurrentOccupant;
      const canRestore = normalizedStatus === "archived" && !hasCurrentOccupant;
      const canDelete = !hasCurrentOccupant && !hasTenantHistory;
      const blockedReason = hasCurrentOccupant
        ? "This unit is still occupied by a live tenant."
        : hasTenantHistory
        ? "This unit already has tenant history and should stay protected."
        : "";
      
      return {
        id: unit._id,
        unitNo: unit.unitNumber,
        unitCode: unitCode,
        propertyName: propertyDisplayName, // Store full property name
        propertyCode: propertyCode, // Store property code
        property: propertyId, // Use property ID for reliable filtering
        tenant: tenantName,
        area: typeof unit.areaSqFt === "number" ? unit.areaSqFt.toFixed(2) : "0.00",
        rentUnit: formatRentAmount(unit.rent),
        marketRent: formatRentAmount(unit.rent),
        currentRent: formatRentAmount(unit.rent),
        unitType: unit.unitType || "N/A",
        status: normalizedStatus,
        vacantFrom: unit.vacantSince ? new Date(unit.vacantSince).toLocaleDateString() : "-",
        propertyId: propertyId,
        canArchive,
        canRestore,
        canDelete,
        blockedReason,
      };
    }).sort((a, b) =>
      String(a.propertyName).localeCompare(String(b.propertyName)) ||
      String(a.unitNo).localeCompare(String(b.unitNo), undefined, { numeric: true })
    );
  }, [unitsData, propertyById, unitIndexByProperty]);

  // For filter dropdown property list
  const uniqueProperties = useMemo(() => {
    const options = (properties || [])
      .filter((p) => p?._id)
      .map((p) => ({
        value: p._id,
        label: p.propertyCode ? `${p.propertyCode} - ${p.propertyName}` : p.propertyName,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return [{ value: "any", label: "Property" }, ...options];
  }, [properties]);

  // ---------------------------
  // GROUP + PAGINATION (server already filters — we just group visible rows)
  // ---------------------------
  const propertiesGrouped = useMemo(() => {
    const map = new Map();

    transformedUnits.forEach((u) => {
      const key = String(u.propertyId || u.property || "");
      if (!map.has(key)) {
        map.set(key, {
          propertyId: u.propertyId || key,
          propertyName: u.propertyName,
          propertyCode: u.propertyCode,
          units: [],
        });
      }
      map.get(key).units.push(u);
    });

    const arr = Array.from(map.values()).map((p) => {
      const occupied = p.units.filter((x) => x.status === "occupied").length;
      const vacant = p.units.filter((x) => x.status === "vacant").length;
      const maintenance = p.units.filter((x) => x.status === "maintenance").length;

      return {
        ...p,
        totals: { total: p.units.length, occupied, vacant, maintenance },
      };
    });

    arr.sort((a, b) => String(a.propertyName).localeCompare(String(b.propertyName)));
    return arr;
  }, [transformedUnits]);

  // Pagination driven by server response
  const totalPages = Math.max(1, unitPagination.pages || 1);
  const safeCurrentPage = Math.min(currentPage, totalPages);
  // Server returns exactly the current page — no client slicing needed
  const currentUnits = transformedUnits;

  const propertyUnitCounts = useMemo(() => {
    const map = {};
    for (const u of currentUnits) map[u.propertyName] = (map[u.propertyName] || 0) + 1;
    return map;
  }, [currentUnits]);

  const handlePageChange = useCallback((page) => {
    const target = Math.max(1, Math.min(totalPages, page));
    setCurrentPage(target);
    setSelectAll(false);
    setSelectedUnits([]);
    if (currentCompany?._id) dispatch(getUnits(buildUnitParams(target)));
  }, [totalPages, currentCompany?._id, dispatch, buildUnitParams]);

  // Visible unit IDs on current page (for selectAll)
  const visibleUnitIds = useMemo(() => {
    return currentUnits.map((u) => u.id);
  }, [currentUnits]);

  const handleSelectUnit = useCallback((id) => {
    setSelectedUnits((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectAll) {
      const visibleSet = new Set(visibleUnitIds);
      setSelectedUnits((prev) => prev.filter((id) => !visibleSet.has(id)));
      setSelectAll(false);
    } else {
      setSelectedUnits((prev) => Array.from(new Set([...prev, ...visibleUnitIds])));
      setSelectAll(true);
    }
  }, [selectAll, visibleUnitIds]);

  const handleCheckboxClick = useCallback((e) => e.stopPropagation(), []);

  // Toggle expand for a specific unit
  const toggleUnitExpand = useCallback((unitId) => {
    setExpandedUnits((prev) =>
      prev.includes(unitId) ? prev.filter((id) => id !== unitId) : [...prev, unitId]
    );
  }, []);

  // Expand all visible units on current page
  const expandAllUnits = useCallback(() => {
    if (currentUnits && currentUnits.length > 0) {
      setExpandedUnits(currentUnits.map((u) => u.id));
    }
  }, [currentUnits]);

  // Collapse all units
  const collapseAllUnits = useCallback(() => {
    setExpandedUnits([]);
  }, []);

  // Check if all visible units are expanded
  const allUnitsExpanded = useMemo(
    () => currentUnits.length > 0 && currentUnits.every((unit) => expandedUnits.includes(unit.id)),
    [currentUnits, expandedUnits]
  );

  // Row click now selects the unit (not expands)
  const handleRowClick = (unitId, e) => {
    if (e.target.type === "checkbox" || e.target.closest(".action-buttons")) return;
    // Select the unit
    handleSelectUnit(unitId);
  };

  const selectedCount = selectedUnits.length;
  const canEdit = selectedCount === 1 && canUpdateUnit;

  const selectedUnitRows = useMemo(
    () => transformedUnits.filter((unit) => selectedUnits.includes(unit.id)),
    [transformedUnits, selectedUnits]
  );
  const selectedArchivableUnits = useMemo(
    () => selectedUnitRows.filter((unit) => unit.canArchive),
    [selectedUnitRows]
  );
  const selectedRestorableUnits = useMemo(
    () => selectedUnitRows.filter((unit) => unit.canRestore),
    [selectedUnitRows]
  );
  const selectedDeletableUnits = useMemo(
    () => selectedUnitRows.filter((unit) => unit.canDelete),
    [selectedUnitRows]
  );

  // CRUD Actions
  const archiveSelected = async () => {
    setActionMenuOpen(false);
    if (selectedCount === 0) return;

    if (selectedArchivableUnits.length === 0) {
      toast.warning("Only non-archived, non-occupied units can be archived from this list.");
      return;
    }

    const archiveCount = selectedArchivableUnits.length;
    const skippedCount = selectedUnitRows.length - archiveCount;

    setConfirmDialog({
      isOpen: true,
      title: "Archive Units",
      message:
        skippedCount > 0
          ? `Archive ${archiveCount} eligible unit(s). ${skippedCount} selected unit(s) will be skipped because they are already archived or still occupied.`
          : `Are you sure you want to archive ${archiveCount} selected unit(s)? You can restore them later.`,
      confirmText: "Archive",
      isDangerous: false,
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        setSelectedUnits([]);
        setSelectAll(false);
        const archiveResults = await Promise.allSettled(
          selectedArchivableUnits.map((unit) =>
            dispatch(updateUnit({ id: unit.id, unitData: { status: "archived", isVacant: true, vacantSince: new Date() } })).unwrap()
          )
        );
        const archiveOk = archiveResults.filter((r) => r.status === "fulfilled").length;
        const archiveFail = archiveResults.filter((r) => r.status === "rejected").length;
        if (archiveOk > 0) toast.success(`${archiveOk} unit(s) archived successfully.`);
        if (archiveFail > 0) toast.error(`${archiveFail} unit(s) could not be archived.`);
        if (skippedCount > 0) toast.info(`${skippedCount} unit(s) were skipped (occupied or already archived).`);
        dispatch(getUnits(buildUnitParams(safeCurrentPage)));
      },
    });
  };

  const restoreSelected = async () => {
    setActionMenuOpen(false);
    if (selectedCount === 0) return;

    if (selectedRestorableUnits.length === 0) {
      toast.warning("Select archived units to restore them back to vacant status.");
      return;
    }

    const restoreCount = selectedRestorableUnits.length;
    const skippedCount = selectedUnitRows.length - restoreCount;

    setConfirmDialog({
      isOpen: true,
      title: "Restore Units",
      message:
        skippedCount > 0
          ? `Restore ${restoreCount} archived unit(s). ${skippedCount} selected unit(s) will be skipped because they are not archived.`
          : `Are you sure you want to restore ${restoreCount} selected unit(s)?`,
      confirmText: "Restore",
      isDangerous: false,
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        setSelectedUnits([]);
        setSelectAll(false);
        const restoreResults = await Promise.allSettled(
          selectedRestorableUnits.map((unit) =>
            dispatch(updateUnit({ id: unit.id, unitData: { status: "vacant", isVacant: true, vacantSince: new Date() } })).unwrap()
          )
        );
        const restoreOk = restoreResults.filter((r) => r.status === "fulfilled").length;
        const restoreFail = restoreResults.filter((r) => r.status === "rejected").length;
        if (restoreOk > 0) toast.success(`${restoreOk} unit(s) restored successfully.`);
        if (restoreFail > 0) toast.error(`${restoreFail} unit(s) could not be restored.`);
        if (skippedCount > 0) toast.info(`${skippedCount} unit(s) were skipped (not archived).`);
        dispatch(getUnits(buildUnitParams(safeCurrentPage)));
      },
    });
  };

  const deleteSelected = async () => {
    if (selectedCount === 0) return;

    if (selectedDeletableUnits.length === 0) {
      toast.warning("Selected units are protected because they are occupied or already carry tenant history.");
      return;
    }

    const deleteCount = selectedDeletableUnits.length;
    const skippedCount = selectedUnitRows.length - deleteCount;

    setConfirmDialog({
      isOpen: true,
      title: "Delete Units",
      message:
        skippedCount > 0
          ? `Delete ${deleteCount} eligible unit(s). ${skippedCount} selected unit(s) will be skipped because they are occupied or already have tenant history.`
          : `Are you sure you want to delete ${deleteCount} selected unit(s)? This action cannot be undone.`,
      confirmText: "Delete",
      isDangerous: true,
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        setSelectedUnits([]);
        setSelectAll(false);
        const deleteResults = await Promise.allSettled(
          selectedDeletableUnits.map((unit) => dispatch(deleteUnit(unit.id)).unwrap())
        );
        const deleteOk = deleteResults.filter((r) => r.status === "fulfilled").length;
        const deleteFail = deleteResults.filter((r) => r.status === "rejected").length;
        if (deleteOk > 0) toast.success(`${deleteOk} unit(s) deleted successfully.`);
        if (deleteFail > 0) toast.error(`${deleteFail} unit(s) could not be deleted.`);
        if (skippedCount > 0) toast.info(`${skippedCount} unit(s) were skipped (occupied or have tenant history).`);
        dispatch(getUnits(buildUnitParams(safeCurrentPage)));
      },
    });
  };

  // ---------------------------
  // EXCEL IMPORT/EXPORT HANDLERS
  // ---------------------------
  const handleDownloadTemplate = () => {
    downloadUnitsTemplate(properties || []);
    toast.info('Units import template downloaded!');
  };

  const handleBulkImport = async (validRecords) => {
    try {
      const response = await adminRequests.post('/units/bulk-import', {
        units: validRecords,
        business: currentCompany._id
      }, { timeout: 0 });

      // Refresh units list
      await dispatch(getUnits(buildUnitParams(safeCurrentPage)));
      
      return response.data;
    } catch (error) {
      console.error('Bulk import error:', error);
      throw new Error(error.response?.data?.message || 'Failed to import units');
    }
  };

  const handlePrintList = () => {
    if (!currentUnits.length) {
      toast.warning("No units to print");
      return;
    }

    printTabularList({
      title: "Units List",
      subtitle: "Current filtered units register",
      company: currentCompany || {},
      summary: `Records: ${unitPagination.total} • Printed on ${new Date().toLocaleString()}`,
      columns: [
        { label: "Unit No",      value: (u) => u.unitNo || "-" },
        { label: "Code",         value: (u) => u.unitCode || "-" },
        { label: "Property",     value: (u) => u.propertyName || "-" },
        { label: "Unit Type",    value: (u) => formatUnitTypeLabel(u.unitType) || "-" },
        { label: "Rent",         value: (u) => u.currentRent || "Ksh 0", align: "right" },
        { label: "Status",       value: (u) => u.status ? u.status.charAt(0).toUpperCase() + u.status.slice(1) : "-" },
        { label: "Tenant",       value: (u) => u.status === "occupied" && u.tenant !== "-" ? u.tenant : "-" },
        { label: "Vacant Since", value: (u) => u.status === "vacant" ? u.vacantFrom : "-" },
      ],
      rows: currentUnits,
    });
  };

  const handleExportToExcel = () => {
    if (!unitsData || unitsData.length === 0) {
      toast.warning('No units to export');
      return;
    }
    exportUnitsToExcel(unitsData);
    toast.success('Units exported successfully!');
  };

  // ---------------------------
  // COLUMN RESIZING (Unit table columns only)
  // ---------------------------
  const [unitColumnWidths, setUnitColumnWidths] = useState({
    id: 120,
    unitNo: 140,
    tenant: 170,
    area: 140,
    rentUnit: 160,
    marketRent: 150,
    currentRent: 150,
    unitType: 140,
    status: 120,
    vacantFrom: 140,
    detailed: 110,
  });

  const startResizing = (columnKey, e) => {
    e.preventDefault();
    setIsResizing(true);

    const startWidth = unitColumnWidths[columnKey] ?? 140;

    resizingRef.current = {
      columnKey,
      startX: e.clientX,
      startWidth,
    };

    const handleMouseMove = (evt) => {
      if (!resizingRef.current) return;
      const { columnKey: ck, startX, startWidth: sw } = resizingRef.current;
      const diff = evt.clientX - startX;
      const newWidth = Math.max(80, sw + diff);

      setUnitColumnWidths((prev) => ({
        ...prev,
        [ck]: newWidth,
      }));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      resizingRef.current = null;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const getStatusPill = (status) => {
    if (status === "Occupied") return "bg-green-100 text-green-800 border border-green-300";
    if (status === "Vacant") return "bg-red-100 text-red-800 border border-red-300";
    return "bg-yellow-100 text-yellow-800 border border-yellow-300";
  };

  const getUnitTypePill = (type) => {
    if (type === "Residential") return "bg-blue-100 text-blue-800 border border-blue-300";
    if (type === "Commercial") return "bg-purple-100 text-purple-800 border border-purple-300";
    if (type === "Utility") return "bg-gray-100 text-gray-800 border border-gray-300";
    return "bg-yellow-100 text-yellow-800 border border-yellow-300";
  };

  // ---------------------------
  // MODAL HANDLERS (kept)
  // ---------------------------
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((p) => ({ ...p, [name]: value }));
  };

  const handleServiceChange = (index, field, value) => {
    const updated = [...services];
    updated[index][field] = value;

    if (field === "checked") updated[index].checked = value;

    if (field === "costPerArea" && formData.areaSqFt) {
      const cost = parseFloat(value) || 0;
      const area = parseFloat(formData.areaSqFt) || 0;
      updated[index].totalCost = (cost * area).toFixed(2);
    }
    setServices(updated);
  };

  const addServiceRow = () => setServices((p) => [...p, { service: "", costPerArea: "", totalCost: "", checked: false }]);
  const removeServiceRow = (index) => {
    if (services.length <= 1) return;
    setServices((p) => p.filter((_, i) => i !== index));
  };

  const handleMeterChange = (index, field, value) => {
    const updated = [...extraMeters];
    updated[index][field] = value;
    setExtraMeters(updated);
  };
  const addMeterRow = () => setExtraMeters((p) => [...p, { meterNo: "", readingSetup: false }]);
  const removeMeterRow = (index) => {
    if (extraMeters.length <= 1) return;
    setExtraMeters((p) => p.filter((_, i) => i !== index));
  };

  const closeAddUnitModal = () => {
    if (_uDraftKey) { try { window.sessionStorage.removeItem(_uDraftKey); } catch {} }
    setShowAddUnitModal(false);
  };

  const handleAddUnitSubmit = (e) => {
    e.preventDefault();
    if (!formData.property || !formData.unitSpaceNo) return;

    // wire later — payload when wired: ownerOccupied: formData.ownerOccupied === "Yes"
    if (_uDraftKey) { try { window.sessionStorage.removeItem(_uDraftKey); } catch {} }
    setShowAddUnitModal(false);

    setFormData({
      property: "",
      specifiedFloor: "",
      generalFloorNo: "",
      unitSpaceNo: "",
      ownerOccupied: "No",
      rentPerUnitArea: "",
      marketRent: "",
      areaSqFt: "",
      chargeFreq: "",
      electricityAccountNo: "",
      waterAccountNo: "",
      electricityMeterNo: "",
      waterMeterNo: "",
    });
    setServices([{ service: "", costPerArea: "", totalCost: "", checked: false }]);
    setExtraMeters([{ meterNo: "", readingSetup: false }]);
  };

  // propertiesForDropdown and chargeFrequencies are now module-scope constants (PROPERTIES_FOR_DROPDOWN, CHARGE_FREQUENCIES)
  // Produce { value, label } directly so the JSX prop needs no extra .map()
  const unitTypeOptions = useMemo(() => {
    const apiTypes = configuredUnitTypes.length
      ? configuredUnitTypes.map((t) => t.name.toLowerCase().replace(/\s+/g, ""))
      : sanitizeCompanyUnitTypes(currentCompany?.unitTypes);
    const existingTypes = Array.from(new Set((unitsData || []).map((item) => String(item?.unitType || "").trim()).filter(Boolean)));
    return Array.from(new Set([...apiTypes, ...existingTypes])).map((type) => ({ value: type, label: formatUnitTypeLabel(type) }));
  }, [configuredUnitTypes, currentCompany?.unitTypes, unitsData]);

  // ---------------------------
  // RENDER
  // ---------------------------
  return (
    <DashboardLayout lockContentScroll>
      <div className="flex flex-col h-full min-h-0 p-0 bg-gray-50 overflow-hidden">
        {/* Toolbar — single scrollable row */}
        <div className="flex-none sticky top-0 z-30 border-b border-gray-200 bg-white shadow-sm">
          <div className="filter-bar flex items-center gap-0.5 overflow-x-auto px-2 py-1">
            <AppSelect
              value={draftFilters.property === "any" ? "" : draftFilters.property}
              onChange={(v) => setDraftFilters((p) => ({ ...p, property: v ?? "any" }))}
              options={uniqueProperties.filter((p) => p.value !== "any")}
              placeholder="Property"
              searchable
              clearable
              compact
            />

            <AppSelect
              value={draftFilters.status}
              onChange={(v) => setDraftFilters((p) => ({ ...p, status: v ?? "active" }))}
              options={[
                { value: "active", label: "Active" },
                { value: "any", label: "All Statuses" },
                { value: "occupied", label: "Occupied" },
                { value: "vacant", label: "Vacant" },
                { value: "maintenance", label: "Maintenance" },
                { value: "archived", label: "Archived" },
              ]}
              placeholder="All Statuses"
              clearable
              compact
            />

            <AppSelect
              value={draftFilters.unitType === "any" ? "" : draftFilters.unitType}
              onChange={(v) => setDraftFilters((p) => ({ ...p, unitType: v ?? "any" }))}
              options={unitTypeOptions}
              placeholder="Unit Type"
              searchable
              clearable
              compact
            />

            <div className="h-3 w-px shrink-0 bg-slate-200" />

            <input value={draftFilters.unitNo} onChange={(e) => setDraftFilters((p) => ({ ...p, unitNo: normalizeUppercaseInput(e.target.value) }))}
              onKeyDown={onFilterEnter} placeholder="Unit No."
              className="h-[20px] w-20 shrink-0 border border-slate-200 bg-white px-1.5 text-[9px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
            <input value={draftFilters.tenant} onChange={(e) => setDraftFilters((p) => ({ ...p, tenant: normalizeUppercaseInput(e.target.value) }))}
              onKeyDown={onFilterEnter} placeholder="Tenant"
              className="h-[20px] w-24 shrink-0 border border-slate-200 bg-white px-1.5 text-[9px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />

            <div className="h-3 w-px shrink-0 bg-slate-200" />

            <button onClick={applySearch} className="h-[20px] shrink-0 flex items-center gap-0.5 bg-[#FF8C00] px-2.5 text-[9px] font-semibold text-white hover:bg-[#e67e00]">
              <FaSearch size={7} /> Search
            </button>
            <button onClick={resetFilters} className="h-[20px] shrink-0 flex items-center gap-0.5 bg-[#0B3B2E] px-2.5 text-[9px] font-semibold text-white hover:bg-[#0A3127]">
              <FaRedoAlt size={7} /> Reset
            </button>
            <button onClick={allUnitsExpanded ? collapseAllUnits : expandAllUnits} disabled={currentUnits.length === 0}
              className={`h-[20px] shrink-0 flex items-center gap-0.5 px-2.5 text-[9px] font-semibold text-white ${currentUnits.length > 0 ? allUnitsExpanded ? "bg-orange-600 hover:bg-orange-700" : "bg-[#0B3B2E] hover:bg-[#0A3127]" : "bg-gray-400 cursor-not-allowed"}`}>
              {allUnitsExpanded ? <><FaCompressAlt size={7} /> Collapse</> : <><FaExpandAlt size={7} /> Expand</>}
            </button>
            {canUpdateUnit && (
              <button disabled={!canEdit} onClick={() => { const id = selectedUnits[0]; if (id) navigate(`/units/${id}`); }}
                className={`h-[20px] shrink-0 flex items-center gap-0.5 px-2.5 text-[9px] font-semibold text-white ${canEdit ? "bg-[#0B3B2E] hover:bg-[#0A3127]" : "bg-gray-400 cursor-not-allowed"}`}>
                <FaEdit size={7} /> Edit
              </button>
            )}

            {canUpdateUnit && (
              <div className="shrink-0">
                <button
                  ref={actionMenuBtnRef}
                  onClick={() => {
                    if (!actionMenuOpen) {
                      const rect = actionMenuBtnRef.current?.getBoundingClientRect();
                      if (rect) setActionMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                    }
                    setActionMenuOpen((v) => !v);
                  }}
                  disabled={selectedCount === 0}
                  className={`h-[20px] flex items-center gap-0.5 px-2.5 text-[9px] font-semibold text-white ${selectedCount > 0 ? "bg-[#0B3B2E] hover:bg-[#0A3127]" : "bg-gray-400 cursor-not-allowed"}`}>
                  <FaArchive size={7} /> Actions <FaChevronDown size={8} />
                </button>
                {actionMenuOpen && selectedCount > 0 && (
                  <div
                    ref={actionMenuRef}
                    style={{ position: "fixed", top: actionMenuPos.top, right: actionMenuPos.right, zIndex: 9999 }}
                    className="w-40 bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden">
                    <button onClick={archiveSelected} disabled={selectedArchivableUnits.length === 0}
                      className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 ${selectedArchivableUnits.length > 0 ? "hover:bg-gray-50" : "cursor-not-allowed bg-gray-50 text-gray-400"}`}>
                      <FaArchive className="text-xs text-gray-700" /> Archive
                    </button>
                    <button onClick={restoreSelected} disabled={selectedRestorableUnits.length === 0}
                      className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 ${selectedRestorableUnits.length > 0 ? "hover:bg-gray-50" : "cursor-not-allowed bg-gray-50 text-gray-400"}`}>
                      <FaUndo className="text-xs text-gray-700" /> Restore
                    </button>
                  </div>
                )}
              </div>
            )}

            {canDeleteUnit && (
              <button onClick={deleteSelected} disabled={selectedCount === 0 || selectedDeletableUnits.length === 0}
                className={`h-[20px] shrink-0 flex items-center gap-0.5 px-2.5 text-[9px] font-semibold text-white ${selectedCount > 0 && selectedDeletableUnits.length > 0 ? "bg-red-600 hover:bg-red-700" : "bg-gray-400 cursor-not-allowed"}`}>
                <FaTrash size={7} /> Delete{selectedCount > 0 ? ` (${selectedCount})` : ""}
              </button>
            )}
            {canCreateUnit && (
              <button onClick={() => navigate("/units/new")} className="h-[20px] shrink-0 flex items-center gap-0.5 bg-[#0B3B2E] px-2.5 text-[9px] font-semibold text-white hover:bg-[#0A3127]">
                <FaPlus size={7} /> Add
              </button>
            )}
            <button onClick={handlePrintList} className="h-[20px] shrink-0 flex items-center gap-0.5 bg-slate-700 px-2.5 text-[9px] font-semibold text-white hover:bg-slate-800">
              <FaPrint size={7} /> Print
            </button>
            <button onClick={handleDownloadTemplate} className="h-[20px] shrink-0 flex items-center gap-0.5 bg-[#0B3B2E] px-2.5 text-[9px] font-semibold text-white hover:bg-[#0A3127]">
              <FaDownload size={7} /> Template
            </button>
            <button onClick={() => setShowImportModal(true)} className="h-[20px] shrink-0 flex items-center gap-0.5 bg-orange-600 px-2.5 text-[9px] font-semibold text-white hover:bg-orange-700">
              <FaFileExport size={7} /> Import
            </button>
            <button onClick={handleExportToExcel} className="h-[20px] shrink-0 flex items-center gap-0.5 border border-gray-300 px-2.5 text-[9px] font-semibold text-gray-600 hover:bg-gray-50">
              <FaFileExport size={7} /> Export
            </button>
          </div>
        </div>

        {/* PROPERTIES TABLE (Units appear below property) */}
        <div className="flex-1 min-h-0 px-2 pb-2 overflow-hidden">
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm h-full flex flex-col">
            <MilikTable
              tableFixed
              actionsWidth="72px"
              columns={[
                { label: 'Unit No', width: '90px' },
                { label: 'Code', width: '78px' },
                { label: 'Unit Type', width: '112px' },
                { label: 'Rent', align: 'right', width: '108px' },
                { label: 'Status', align: 'center', width: '92px' },
                { label: 'Occupancy', width: '200px' },
                { label: 'Vacant Since', width: '100px' },
              ]}
              rows={currentUnits}
              rowKey="id"
              loading={isFetching}
              empty={appliedFilters.property !== 'any' || appliedFilters.status !== 'any' ? 'No units match the current filters.' : 'No units found. Create a unit or import existing units.'}
              groupBy={(u) => u.propertyName}
              checkboxes
              allChecked={selectAll && visibleUnitIds.length > 0}
              someChecked={selectedUnits.length > 0 && !selectAll}
              onCheckAll={handleSelectAll}
              isChecked={(u) => selectedUnitsSet.has(u.id)}
              onCheckRow={(u) => handleSelectUnit(u.id)}
              onRowClick={(u) => handleSelectUnit(u.id)}
              isSelected={(u) => selectedUnitsSet.has(u.id)}
              renderRow={(u) => (
                <>
                  <td className="px-3 py-1 border-r border-gray-100 overflow-hidden">
                    <span className="font-semibold text-slate-700 truncate block">{toListingCaps(u.unitNo)}</span>
                  </td>
                  <td className="px-3 py-1 border-r border-gray-100 overflow-hidden">
                    <span className="font-mono text-[10px] text-slate-500 tracking-wide truncate block">{toListingCaps(u.unitCode)}</span>
                  </td>
                  <td className="px-3 py-1 border-r border-gray-100 overflow-hidden">
                    <span className="text-slate-600 truncate block">{formatUnitTypeLabel(u.unitType) || 'N/A'}</span>
                  </td>
                  <td className="px-3 py-1 border-r border-gray-100 text-right whitespace-nowrap">
                    <span className="font-semibold text-slate-700">{u.currentRent}</span>
                  </td>
                  <td className="px-3 py-1 border-r border-gray-100 text-center">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                      u.status === 'occupied' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : u.status === 'vacant' ? 'bg-red-50 text-red-700 border-red-200'
                      : u.status === 'maintenance' ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : u.status === 'archived' ? 'bg-slate-100 text-slate-500 border-slate-200'
                      : 'bg-slate-100 text-slate-600 border-slate-200'
                    }`}>
                      {u.status.charAt(0).toUpperCase() + u.status.slice(1)}
                    </span>
                  </td>
                  <td className="px-3 py-1 border-r border-gray-100 overflow-hidden">
                    {u.status === 'occupied' && u.tenant !== '-' ? (
                      <span className="font-semibold text-slate-800 truncate block">
                        <span className="text-emerald-500 mr-1">●</span>{toListingCaps(u.tenant)}
                      </span>
                    ) : u.status === 'maintenance' ? (
                      <span className="text-amber-600 font-semibold text-[10px]">In Maintenance</span>
                    ) : u.status === 'archived' ? (
                      <span className="text-slate-400 text-[10px]">Archived</span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1 border-r border-gray-100 overflow-hidden">
                    {u.status === 'vacant' ? (
                      <span className="text-red-500 font-medium text-[11px] truncate block">{u.vacantFrom}</span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                </>
              )}
              renderActions={(u) => (
                <button
                  className="px-2 py-0.5 text-[10px] text-white rounded font-semibold bg-[#0B3B2E] hover:bg-[#0A3127] transition-colors"
                  onClick={() => navigate(`/units/${u.id}`)}
                >
                  View
                </button>
              )}
              renderExpanded={(u) => (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <div className="space-y-4 p-4 bg-white rounded-lg shadow-md border-2 border-[#0B3B2E]/30">
                    <h4 className="font-black text-gray-900 text-sm mb-4 pb-2 border-b-3 border-[#0B3B2E]">📋 Unit Details</h4>
                    <div><span className="text-xs font-black text-gray-700 uppercase tracking-wide">Unit Number</span><p className="text-sm font-black text-gray-900 mt-2">{u.unitNo || 'N/A'}</p></div>
                    <div><span className="text-xs font-black text-gray-700 uppercase tracking-wide">Unit Code</span><p className="text-sm font-black font-mono text-gray-900 mt-2 bg-gray-100 p-2 rounded">{u.unitCode || 'N/A'}</p></div>
                    <div><span className="text-xs font-black text-gray-700 uppercase tracking-wide">Unit Type</span><p className="text-sm font-black text-gray-900 mt-2">{formatUnitTypeLabel(u.unitType) || 'N/A'}</p></div>
                    <div><span className="text-xs font-black text-gray-700 uppercase tracking-wide">Status</span>
                      <p className={`text-sm font-black mt-2 inline-block px-3 py-1 rounded-lg ${u.status === 'occupied' ? 'bg-green-200 text-green-900' : u.status === 'vacant' ? 'bg-red-200 text-red-900' : u.status === 'maintenance' ? 'bg-yellow-200 text-yellow-900' : 'bg-gray-200 text-gray-900'}`}>
                        {u.status.charAt(0).toUpperCase() + u.status.slice(1)}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-4 p-4 bg-white rounded-lg shadow-md border-2 border-[#FF8C00]/30">
                    <h4 className="font-black text-gray-900 text-sm mb-4 pb-2 border-b-3 border-[#FF8C00]">💰 Financial Details</h4>
                    <div><span className="text-xs font-black text-gray-700 uppercase tracking-wide">Monthly Rent</span><p className="text-sm font-black text-gray-900 mt-2">{u.currentRent || 'Ksh 0'}</p></div>
                    <div><span className="text-xs font-black text-gray-700 uppercase tracking-wide">Market Rent</span><p className="text-sm font-black text-gray-900 mt-2">{u.marketRent || 'N/A'}</p></div>
                    <div><span className="text-xs font-black text-gray-700 uppercase tracking-wide">Billing Frequency</span><p className="text-sm font-black text-gray-900 mt-2">Monthly</p></div>
                  </div>
                  <div className="space-y-4 p-4 bg-white rounded-lg shadow-md border-2 border-blue-300/50">
                    <h4 className="font-black text-gray-900 text-sm mb-4 pb-2 border-b-3 border-blue-600">👥 Occupancy Details</h4>
                    <div><span className="text-xs font-black text-gray-700 uppercase tracking-wide">Current Tenant</span><p className="text-sm font-black text-gray-900 mt-2">{u.tenant || '-'}</p></div>
                    <div><span className="text-xs font-black text-gray-700 uppercase tracking-wide">Vacant Since</span><p className="text-sm font-black text-gray-900 mt-2">{u.status === 'vacant' ? u.vacantFrom : '-'}</p></div>
                    <div><span className="text-xs font-black text-gray-700 uppercase tracking-wide">Property</span><p className="text-sm font-black text-gray-900 mt-2">{u.propertyName || 'Unknown'}</p></div>
                  </div>
                  <div className="space-y-4 p-4 bg-white rounded-lg shadow-md border-2 border-green-300/50">
                    <h4 className="font-black text-gray-900 text-sm mb-4 pb-2 border-b-3 border-green-600">⚙️ Actions</h4>
                    <button onClick={() => navigate(`/units/${u.id}`)} className={`w-full px-3 py-2 text-xs text-white rounded-lg flex items-center justify-center gap-2 transition-colors font-black ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}>
                      <FaEdit /> View Full Details
                    </button>
                  </div>
                </div>
              )}
            />

            <PaginationBar
              page={safeCurrentPage}
              pages={totalPages}
              total={unitPagination.total}
              pageSize={pageSize}
              onPageChange={handlePageChange}
              onPageSizeChange={(n) => {
                setPageSize(n);
                setCurrentPage(1);
                setSelectAll(false);
                setSelectedUnits([]);
                if (currentCompany?._id) {
                  const params = buildUnitParams(1);
                  params.limit = n;
                  dispatch(getUnits(params));
                }
              }}
              loading={isFetching}
              label="units"
            />
          </div>
        </div>

        {/* Resizing overlay */}
        {isResizing && <div className="fixed inset-0 z-50 cursor-col-resize" style={{ cursor: "col-resize" }} />}

        {/* Add Unit Modal (kept; styling aligned a bit) */}
        {showAddUnitModal && (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
            <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">
              <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
                <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide">Add New Unit/Space</h2>
                <button
                  onClick={closeAddUnitModal}
                  className="text-white/70 transition-colors hover:text-white"
                >
                  <FaTimes />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto bg-white px-5 py-4">
                <form onSubmit={handleAddUnitSubmit} id="unitForm">
                  <div className="mb-6">
                    <h3 className="mb-3 border-b border-slate-100 pb-1 text-[10px] font-black uppercase tracking-wide text-slate-500">General Information</h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Property <span className="text-red-500">*</span></label>
                        <AppSelect
                          value={formData.property}
                          onChange={(v) => setFormData((p) => ({ ...p, property: v ?? "" }))}
                          options={PROPERTIES_FOR_DROPDOWN_OPTIONS}
                          placeholder="Select Property"
                          searchable
                          clearable
                          size="md"
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Specified Floor</label>
                        <input
                          type="text"
                          name="specifiedFloor"
                          value={formData.specifiedFloor}
                          onChange={handleInputChange}
                          className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                          placeholder="e.g., Ground Floor"
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">General Floor No.</label>
                        <input
                          type="number"
                          name="generalFloorNo"
                          value={formData.generalFloorNo}
                          onChange={handleInputChange}
                          className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                          placeholder="e.g., 1, 2, 3..."
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Unit/Space No. <span className="text-red-500">*</span></label>
                        <input
                          type="text"
                          name="unitSpaceNo"
                          value={formData.unitSpaceNo}
                          onChange={handleInputChange}
                          className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                          placeholder="e.g., A101, 201, etc."
                          required
                        />
                      </div>

                      <div className="md:col-span-2">
                        <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Owner Occupied?</label>
                        <div className="flex gap-4">
                          <label className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="ownerOccupied"
                              value="Yes"
                              checked={formData.ownerOccupied === "Yes"}
                              onChange={handleInputChange}
                              className="text-emerald-600 focus:ring-[#0B3B2E]/20"
                            />
                            <span className="text-sm">Yes</span>
                          </label>
                          <label className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="ownerOccupied"
                              value="No"
                              checked={formData.ownerOccupied === "No"}
                              onChange={handleInputChange}
                              className="text-emerald-600 focus:ring-[#0B3B2E]/20"
                            />
                            <span className="text-sm">No</span>
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* AREA/SPACE MANAGEMENT & COSTING */}
                  <div className="mb-6 border-t pt-4">
                    <h3 className="mb-3 border-b border-slate-100 pb-1 text-[10px] font-black uppercase tracking-wide text-slate-500">Area/Space Management &amp; Costing</h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Rent Per Unit Area (Ksh)</label>
                        <input
                          type="number"
                          name="rentPerUnitArea"
                          value={formData.rentPerUnitArea}
                          onChange={handleInputChange}
                          className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                          placeholder="0.00"
                          step="0.01"
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Market Rent (Ksh)</label>
                        <input
                          type="number"
                          name="marketRent"
                          value={formData.marketRent}
                          onChange={handleInputChange}
                          className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                          placeholder="0.00"
                          step="0.01"
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Area (Sq Ft)</label>
                        <input
                          type="number"
                          name="areaSqFt"
                          value={formData.areaSqFt}
                          onChange={handleInputChange}
                          className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                          placeholder="0.00"
                          step="0.01"
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Charge Freq.</label>
                        <AppSelect
                          value={formData.chargeFreq}
                          onChange={(v) => setFormData((p) => ({ ...p, chargeFreq: v ?? "" }))}
                          options={CHARGE_FREQUENCIES_OPTIONS}
                          placeholder="Select Frequency"
                          clearable
                          size="md"
                        />
                      </div>
                    </div>

                    {/* Services */}
                    <div className="mt-4">
                      <div className="flex justify-between items-center mb-2">
                        <h4 className="text-[10px] font-black uppercase tracking-wide text-slate-500">Service Charge/Utility/Amenity</h4>
                        <button
                          type="button"
                          onClick={addServiceRow}
                          className={`px-3 py-1 text-xs text-white transition-colors ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
                        >
                          Add Service
                        </button>
                      </div>

                      <div className="overflow-x-auto border border-gray-200">
                        <table className="min-w-full text-[11px] border-collapse">
                          <thead>
                            <tr className="bg-[#0B3B2E] text-white">
                              <th className="px-3 py-1 font-bold border-r border-white/10 w-8"></th>
                              <th className="px-3 py-1 text-left font-bold border-r border-white/10">Service</th>
                              <th className="px-3 py-1 text-left font-bold border-r border-white/10">Cost Per Area</th>
                              <th className="px-3 py-1 text-left font-bold border-r border-white/10">Total Cost</th>
                              <th className="px-3 py-1 text-left font-bold w-16">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {services.map((s, i) => (
                              <tr key={i} className={`border-b border-gray-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50/60"}`}>
                                <td className="px-3 py-2 border-b">
                                  <input
                                    type="checkbox"
                                    checked={s.checked}
                                    onChange={(e) => handleServiceChange(i, "checked", e.target.checked)}
                                    className="border-gray-300 text-emerald-600 focus:ring-[#0B3B2E]/20"
                                  />
                                </td>
                                <td className="px-3 py-2 border-b">
                                  <input
                                    type="text"
                                    value={s.service}
                                    onChange={(e) => handleServiceChange(i, "service", e.target.value)}
                                    className="w-full px-2 py-1 border border-gray-300 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                                    placeholder="e.g., Water"
                                  />
                                </td>
                                <td className="px-3 py-2 border-b">
                                  <input
                                    type="number"
                                    value={s.costPerArea}
                                    onChange={(e) => handleServiceChange(i, "costPerArea", e.target.value)}
                                    className="w-full px-2 py-1 border border-gray-300 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                                    placeholder="0.00"
                                    step="0.01"
                                  />
                                </td>
                                <td className="px-3 py-2 border-b">
                                  <input
                                    type="text"
                                    value={s.totalCost}
                                    readOnly
                                    className="w-full px-2 py-1 border border-gray-300 bg-gray-50"
                                  />
                                </td>
                                <td className="px-3 py-2 border-b">
                                  {services.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => removeServiceRow(i)}
                                      className="px-2 py-1 text-xs bg-red-100 text-red-700 hover:bg-red-200 transition-colors"
                                    >
                                      Remove
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  {/* Utility meters */}
                  <div className="mb-6 border-t pt-4">
                    <h3 className="mb-3 border-b border-slate-100 pb-1 text-[10px] font-black uppercase tracking-wide text-slate-500">Utility Account &amp; Meter No.</h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Electricity Ac/No.</label>
                        <input
                          type="text"
                          name="electricityAccountNo"
                          value={formData.electricityAccountNo}
                          onChange={handleInputChange}
                          className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Water Ac/No.</label>
                        <input
                          type="text"
                          name="waterAccountNo"
                          value={formData.waterAccountNo}
                          onChange={handleInputChange}
                          className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Electricity Meter/No.</label>
                        <input
                          type="text"
                          name="electricityMeterNo"
                          value={formData.electricityMeterNo}
                          onChange={handleInputChange}
                          className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Water Meter/No.</label>
                        <input
                          type="text"
                          name="waterMeterNo"
                          value={formData.waterMeterNo}
                          onChange={handleInputChange}
                          className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                        />
                      </div>
                    </div>

                    <div className="mt-4">
                      <div className="flex justify-between items-center mb-2">
                        <h4 className="text-[10px] font-black uppercase tracking-wide text-slate-500">Extra Meter Numbers</h4>
                        <button
                          type="button"
                          onClick={addMeterRow}
                          className={`px-3 py-1 text-xs text-white transition-colors ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
                        >
                          Add Meter
                        </button>
                      </div>

                      <div className="overflow-x-auto border border-gray-200">
                        <table className="min-w-full text-[11px] border-collapse">
                          <thead>
                            <tr className="bg-[#0B3B2E] text-white">
                              <th className="px-3 py-1 font-bold border-r border-white/10 w-8"></th>
                              <th className="px-3 py-1 text-left font-bold border-r border-white/10">Meter No</th>
                              <th className="px-3 py-1 text-left font-bold border-r border-white/10 w-28">Reading Setup</th>
                              <th className="px-3 py-1 text-left font-bold w-16">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {extraMeters.map((m, i) => (
                              <tr key={i} className={`border-b border-gray-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50/60"}`}>
                                <td className="px-3 py-2 border-b"></td>
                                <td className="px-3 py-2 border-b">
                                  <input
                                    type="text"
                                    value={m.meterNo}
                                    onChange={(e) => handleMeterChange(i, "meterNo", e.target.value)}
                                    className="w-full px-2 py-1 border border-gray-300 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                                    placeholder="Meter number"
                                  />
                                </td>
                                <td className="px-3 py-2 border-b">
                                  <div className="flex items-center">
                                    <input
                                      type="checkbox"
                                      checked={m.readingSetup}
                                      onChange={(e) => handleMeterChange(i, "readingSetup", e.target.checked)}
                                      className="border-gray-300 text-emerald-600 focus:ring-[#0B3B2E]/20"
                                    />
                                    <span className="ml-2 text-xs">Enabled</span>
                                  </div>
                                </td>
                                <td className="px-3 py-2 border-b">
                                  {extraMeters.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => removeMeterRow(i)}
                                      className="px-2 py-1 text-xs bg-red-100 text-red-700 hover:bg-red-200 transition-colors"
                                    >
                                      Remove
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </form>
              </div>

              <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
                  <button
                    type="button"
                    onClick={closeAddUnitModal}
                    className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-700 transition-colors hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFormData({
                        property: "",
                        specifiedFloor: "",
                        generalFloorNo: "",
                        unitSpaceNo: "",
                        ownerOccupied: "No",
                        rentPerUnitArea: "",
                        marketRent: "",
                        areaSqFt: "",
                        chargeFreq: "",
                        electricityAccountNo: "",
                        waterAccountNo: "",
                        electricityMeterNo: "",
                        waterMeterNo: "",
                      });
                      setServices([{ service: "", costPerArea: "", totalCost: "", checked: false }]);
                      setExtraMeters([{ meterNo: "", readingSetup: false }]);
                    }}
                    className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-700 transition-colors hover:bg-slate-100"
                  >
                    Reset
                  </button>
                  <button
                    type="submit"
                    form="unitForm"
                    className="flex items-center gap-2 bg-[#0B3B2E] px-4 py-2 text-xs font-black uppercase tracking-wide text-white transition-colors hover:bg-[#0d5442] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <FaSave /> Save Unit
                  </button>
              </div>
            </div>
          </div>
        )}

        <UnitsImportModal 
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
          onImport={handleBulkImport}
        />

        <MilikConfirmDialog
          isOpen={confirmDialog.isOpen}
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmText={confirmDialog.confirmText || "Confirm"}
          cancelText="Cancel"
          isDangerous={confirmDialog.isDangerous}
          onConfirm={() => confirmDialog.onConfirm?.()}
          onCancel={() => setConfirmDialog((prev) => ({ ...prev, isOpen: false }))}
        />
      </div>
    </DashboardLayout>
  );
};

export default Units;
