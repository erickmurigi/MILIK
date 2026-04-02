// pages/Units.js
import React, { useMemo, useRef, useState, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import {
  FaPlus,
  FaSearch,
  FaFileExport,
  FaDownload,
  FaPrint,
  FaChevronLeft,
  FaChevronRight,
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
import { getUnits, deleteUnit, updateUnit } from "../../redux/unitRedux";
import { getProperties } from "../../redux/propertyRedux";
import { toast } from "react-toastify";
import MilikConfirmDialog from "../../components/Modals/MilikConfirmDialog";
import UnitsImportModal from "../../components/Modals/UnitsImportModal";
import { 
  downloadUnitsTemplate, 
  exportUnitsToExcel, 
  parseUnitsExcel 
} from "../../utils/excelTemplates";
import { adminRequests } from "../../utils/requestMethods";
import { printTabularList } from "../../utils/printList";

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";
const MILIK_ORANGE = "bg-[#FF8C00]";
const MILIK_ORANGE_HOVER = "hover:bg-[#e67e00]";

const ITEMS_PER_PAGE = 50;

const DEFAULT_COMPANY_UNIT_TYPES = ["studio", "1bed", "2bed", "3bed", "4bed", "commercial"];

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


const Units = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  
  const { currentCompany } = useSelector((state) => state.company);
  const { units: unitsData, isFetching } = useSelector((state) => state.unit);
  const { properties } = useSelector((state) => state.property);

  // ---------------------------
  // UI STATE
  // ---------------------------
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedUnits, setExpandedUnits] = useState([]); // Array to track multiple expanded units

  const [selectedUnits, setSelectedUnits] = useState([]);
  const [selectAll, setSelectAll] = useState(false);

  const [isResizing, setIsResizing] = useState(false);
  const resizingRef = useRef(null);

  // Archive/Restore dropdown (placeholder, wire later)
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const actionMenuRef = useRef(null);

  // Modal
  const [showAddUnitModal, setShowAddUnitModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

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
  const emptyFilters = {
    property: "any",
    status: "any",
    unitType: "any",
    unitNo: "",
    tenant: "",
  };

  const [draftFilters, setDraftFilters] = useState(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState(emptyFilters);

  const applySearch = () => {
    setAppliedFilters({
      ...draftFilters,
      unitNo: draftFilters.unitNo.trim(),
      tenant: draftFilters.tenant.trim(),
    });
    setCurrentPage(1);
    setSelectAll(false);
    setSelectedUnits([]);
    setExpandedUnits([]);
  };

  const resetFilters = () => {
    setDraftFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    setCurrentPage(1);
    setExpandedUnits([]);
    setSelectAll(false);
    setSelectedUnits([]);
    setActionMenuOpen(false);
  };

  const onFilterEnter = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applySearch();
    }
  };

  // Close dropdown on outside click
  useEffect(() => {
    const onDocClick = (e) => {
      if (!actionMenuRef.current) return;
      if (!actionMenuRef.current.contains(e.target)) setActionMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Reset selectAll whenever page changes
  useEffect(() => setSelectAll(false), [currentPage]);

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

  // Fetch units on mount
  useEffect(() => {
    if (currentCompany?._id) {
      dispatch(getUnits({ business: currentCompany._id }));
      dispatch(getProperties({ business: currentCompany._id }));
    }
  }, [dispatch, currentCompany]);

  // Transform units data to match the table structure
  const formatRentAmount = (amount) => {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount)) return "Ksh 0";
    return `Ksh ${numericAmount.toLocaleString("en-KE")}`;
  };

  const transformedUnits = useMemo(() => {
    return (unitsData || []).map((unit, index) => {
      // unit.property is already populated from backend with {_id, propertyName, address}
      // Extract the property data whether it's a string ID or populated object
      const propertyObj = typeof unit.property === 'string' 
        ? properties.find((p) => p._id === unit.property)
        : unit.property;
      
      // Get property display name - prioritize populated data, fallback to Redux
      const propertyDisplayName = propertyObj?.propertyName || "Unknown Property";
      const propertyCode = propertyObj?.propertyCode || "XX";
      const propertyId = propertyObj?._id || unit.property;
      
      // Get first 2 letters from property name
      const first2Letters = propertyDisplayName.substring(0, 2).toUpperCase();
      
      // Count how many units with the same propertyId come before this one to get index within property
      const unitIndexInProperty = (unitsData || []).reduce((count, u, i) => {
        const uProperty = typeof u.property === 'string' 
          ? properties.find((p) => p._id === u.property)
          : u.property;
        const uPropertyId = uProperty?._id || u.property;
        return i < index && uPropertyId === propertyId ? count + 1 : count;
      }, 0) + 1;
      
      // Generate unit code: first 2 letters of property name + 4 digit index within property
      const unitCode = `${first2Letters}${String(unitIndexInProperty).padStart(4, '0')}`;

      const tenantName =
        unit.currentTenant?.name ||
        unit.lastTenant?.name ||
        unit.tenant?.name ||
        unit.tenantName ||
        "-";
      
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
        status: (unit.status || "vacant").toLowerCase(),
        vacantFrom: unit.vacantSince ? new Date(unit.vacantSince).toLocaleDateString() : "-",
        propertyId: propertyId,
      };
    });
  }, [unitsData, properties]);

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
  // FILTER + GROUP (Units under Property)
  // ---------------------------
  const normalize = (v) => String(v ?? "").toLowerCase().trim();

  const filteredUnits = useMemo(() => {
    return transformedUnits.filter((u) => {
      if (appliedFilters.property !== "any" && u.property !== appliedFilters.property) return false;
      if (appliedFilters.status === "active" && u.status === "archived") return false;
      if (
        appliedFilters.status !== "any" &&
        appliedFilters.status !== "active" &&
        u.status !== appliedFilters.status
      ) {
        return false;
      }
      if (appliedFilters.unitType !== "any" && u.unitType !== appliedFilters.unitType) return false;

      const unitNoOk = appliedFilters.unitNo ? normalize(u.unitNo).includes(normalize(appliedFilters.unitNo)) : true;
      const tenantOk = appliedFilters.tenant ? normalize(u.tenant).includes(normalize(appliedFilters.tenant)) : true;

      return unitNoOk && tenantOk;
    });
  }, [transformedUnits, appliedFilters]);

  const propertiesGrouped = useMemo(() => {
    const map = new Map();

    filteredUnits.forEach((u) => {
      const key = u.propertyId || u.property;
      if (!map.has(key)) {
        map.set(key, {
          propertyId: u.propertyId || key,
          propertyName: u.propertyName, // Use the actual property name
          propertyCode: u.propertyCode, // Store property code too
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
        totals: {
          total: p.units.length,
          occupied,
          vacant,
          maintenance,
        },
      };
    });

    // sort by property name
    arr.sort((a, b) => String(a.propertyName).localeCompare(String(b.propertyName)));
    return arr;
  }, [filteredUnits]);

  // Pagination is per UNIT row (max 50 entries per page)
  const totalPages = Math.max(1, Math.ceil(filteredUnits.length / ITEMS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentUnits = filteredUnits.slice(startIndex, endIndex);

  useEffect(() => {
    if (currentPage !== safeCurrentPage) setCurrentPage(safeCurrentPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalPages]);

  // Visible unit IDs on current page (for selectAll)
  const visibleUnitIds = useMemo(() => {
    return currentUnits.map((u) => u.id);
  }, [currentUnits]);

  const handleSelectUnit = (id) => {
    setSelectedUnits((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSelectAll = () => {
    if (selectAll) {
      // remove visible ids from selection
      setSelectedUnits((prev) => prev.filter((id) => !visibleUnitIds.includes(id)));
      setSelectAll(false);
    } else {
      setSelectedUnits((prev) => Array.from(new Set([...prev, ...visibleUnitIds])));
      setSelectAll(true);
    }
  };

  const handleCheckboxClick = (e) => e.stopPropagation();

  // Toggle expand for a specific unit
  const toggleUnitExpand = (unitId) => {
    setExpandedUnits((prev) =>
      prev.includes(unitId) ? prev.filter((id) => id !== unitId) : [...prev, unitId]
    );
  };

  // Expand all visible units on current page
  const expandAllUnits = () => {
    if (currentUnits && currentUnits.length > 0) {
      setExpandedUnits(currentUnits.map((u) => u.id));
    }
  };

  // Collapse all units
  const collapseAllUnits = () => {
    setExpandedUnits([]);
  };

  // Check if all visible units are expanded
  const allUnitsExpanded =
    currentUnits.length > 0 && currentUnits.every((unit) => expandedUnits.includes(unit.id));

  // Row click now selects the unit (not expands)
  const handleRowClick = (unitId, e) => {
    if (e.target.type === "checkbox" || e.target.closest(".action-buttons")) return;
    // Select the unit
    handleSelectUnit(unitId);
  };

  const selectedCount = selectedUnits.length;
  const canEdit = selectedCount === 1;

  // CRUD Actions
  const archiveSelected = async () => {
    setActionMenuOpen(false);
    if (selectedCount === 0) return;

    setConfirmDialog({
      isOpen: true,
      title: "Archive Units",
      message: `Are you sure you want to archive ${selectedCount} selected unit(s)? You can restore them later.`,
      confirmText: "Archive",
      isDangerous: false,
      onConfirm: async () => {
        try {
          for (const unitId of selectedUnits) {
            // eslint-disable-next-line no-await-in-loop
            await dispatch(
              updateUnit({
                id: unitId,
                unitData: {
                  status: "archived",
                  isVacant: true,
                  vacantSince: new Date(),
                },
              })
            ).unwrap();
          }

          await dispatch(getUnits({ business: currentCompany._id }));
          setSelectedUnits([]);
          setSelectAll(false);
          toast.success(`${selectedCount} unit(s) archived successfully`);
        } catch (error) {
          const msg = error?.message || error?.data?.message || "Error archiving units";
          toast.error(msg);
        } finally {
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        }
      },
    });
  };

  const restoreSelected = async () => {
    setActionMenuOpen(false);
    if (selectedCount === 0) return;

    setConfirmDialog({
      isOpen: true,
      title: "Restore Units",
      message: `Are you sure you want to restore ${selectedCount} selected unit(s)?`,
      confirmText: "Restore",
      isDangerous: false,
      onConfirm: async () => {
        try {
          for (const unitId of selectedUnits) {
            // eslint-disable-next-line no-await-in-loop
            await dispatch(
              updateUnit({
                id: unitId,
                unitData: {
                  status: "vacant",
                  isVacant: true,
                  vacantSince: new Date(),
                },
              })
            ).unwrap();
          }

          await dispatch(getUnits({ business: currentCompany._id }));
          setSelectedUnits([]);
          setSelectAll(false);
          toast.success(`${selectedCount} unit(s) restored successfully`);
        } catch (error) {
          const msg = error?.message || error?.data?.message || "Error restoring units";
          toast.error(msg);
        } finally {
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        }
      },
    });
  };

  const deleteSelected = async () => {
    if (selectedCount === 0) return;

    setConfirmDialog({
      isOpen: true,
      title: "Delete Units",
      message: `Are you sure you want to delete ${selectedCount} selected unit(s)? This action cannot be undone.`,
      confirmText: "Delete",
      isDangerous: true,
      onConfirm: async () => {
        try {
          for (const unitId of selectedUnits) {
            // eslint-disable-next-line no-await-in-loop
            await dispatch(deleteUnit(unitId)).unwrap();
          }
          await dispatch(getUnits({ business: currentCompany._id }));
          setSelectedUnits([]);
          setSelectAll(false);
          toast.success(`${selectedCount} unit(s) deleted successfully`);
        } catch (error) {
          const msg = error?.message || error?.data?.message || "Error deleting units";
          toast.error(msg);
        } finally {
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        }
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
      });

      // Refresh units list
      await dispatch(getUnits({ business: currentCompany._id }));
      
      return response.data;
    } catch (error) {
      console.error('Bulk import error:', error);
      throw new Error(error.response?.data?.message || 'Failed to import units');
    }
  };

  const handlePrintList = () => {
    if (!filteredUnits.length) {
      toast.warning("No units to print");
      return;
    }

    printTabularList({
      title: "Units List",
      subtitle: "Current filtered units register",
      company: currentCompany || {},
      summary: `Records: ${filteredUnits.length} • Printed on ${new Date().toLocaleString()}`,
      columns: [
        { label: "Unit", value: (row) => row?.unitNumber || row?.unitName || "-" },
        { label: "Property", value: (row) => row?.property?.propertyName || row?.propertyName || "-" },
        { label: "Type", value: (row) => row?.type || row?.unitType || "-" },
        { label: "Rent", value: (row) => Number(row?.rent || 0).toLocaleString(), align: "right" },
        { label: "Deposit", value: (row) => Number(row?.deposit || 0).toLocaleString(), align: "right" },
        { label: "Status", value: (row) => row?.status || (row?.isVacant ? "vacant" : "occupied") },
      ],
      rows: filteredUnits,
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

  const handleAddUnitSubmit = (e) => {
    e.preventDefault();
    if (!formData.property || !formData.unitSpaceNo) return;

    // wire later
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

  const propertiesForDropdown = ["A1, KH KENYA", "AAA, PARKLANDS KENYA", "ALL PURPOSE APARTMENT", "ALPHA APARTMENT", "BASIL TOWERS", "BLUE SKY PLAZA"];
  const chargeFrequencies = ["Monthly", "Quarterly", "Semi-Annually", "Annually", "One-time"];
  const unitTypeOptions = useMemo(() => {
    const companyTypes = sanitizeCompanyUnitTypes(currentCompany?.unitTypes);
    const existingTypes = Array.from(new Set((unitsData || []).map((item) => String(item?.unitType || "").trim()).filter(Boolean)));
    return Array.from(new Set([...companyTypes, ...existingTypes]));
  }, [currentCompany?.unitTypes, unitsData]);

  // ---------------------------
  // RENDER
  // ---------------------------
  return (
    <DashboardLayout lockContentScroll>
      <div className="flex flex-col h-full min-h-0 p-0 bg-gray-50 overflow-hidden">
        {/* Filters Card (consistent style) */}
        <div className="flex-shrink-0 sticky top-0 z-30 bg-gray-50 pt-2 px-2">
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-2">
            {/* Row 1: dropdowns + action buttons */}
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={draftFilters.property}
                onChange={(e) => setDraftFilters((p) => ({ ...p, property: e.target.value }))}
                className="px-3 py-1 text-xs border border-gray-300 rounded shadow-sm focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] bg-[#DDEFE1] text-gray-800 hover:bg-white transition-colors"
              >
                {uniqueProperties.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>

              <select
                value={draftFilters.status}
                onChange={(e) => setDraftFilters((p) => ({ ...p, status: e.target.value }))}
                className="px-3 py-1 text-xs border border-gray-300 rounded shadow-sm focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] bg-[#DDEFE1] text-gray-800 hover:bg-white transition-colors"
              >
                <option value="active">Active</option>
                <option value="any">All Statuses</option>
                <option value="occupied">Occupied</option>
                <option value="vacant">Vacant</option>
                <option value="maintenance">Maintenance</option>
                <option value="archived">Archived</option>
              </select>

              <select
                value={draftFilters.unitType}
                onChange={(e) => setDraftFilters((p) => ({ ...p, unitType: e.target.value }))}
                className="px-3 py-1 text-xs border border-gray-300 rounded shadow-sm focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] bg-[#DDEFE1] text-gray-800 hover:bg-white transition-colors"
              >
                <option value="any">Unit Type</option>
                {unitTypeOptions.map((type) => (
                  <option key={type} value={type}>{formatUnitTypeLabel(type)}</option>
                ))}
              </select>

              <button
                onClick={applySearch}
                className={`px-4 py-1 text-xs text-white rounded-lg flex items-center gap-2 shadow-sm ${MILIK_ORANGE} ${MILIK_ORANGE_HOVER}`}
                title="Search using the fields"
              >
                <FaSearch className="text-xs" />
                Search
              </button>

              <button
                onClick={resetFilters}
                className={`px-4 py-1 text-xs text-white rounded-lg flex items-center gap-2 shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
                title="Reset filters and selection"
              >
                <FaRedoAlt className="text-xs" />
                Reset
              </button>

              <button
                onClick={allUnitsExpanded ? collapseAllUnits : expandAllUnits}
                disabled={!filteredUnits || filteredUnits.length === 0}
                className={`px-4 py-1 text-xs text-white rounded-lg flex items-center gap-2 shadow-sm ${
                  filteredUnits && filteredUnits.length > 0
                    ? allUnitsExpanded
                      ? "bg-orange-600 hover:bg-orange-700"
                      : `${MILIK_GREEN} ${MILIK_GREEN_HOVER}`
                    : "bg-gray-400 cursor-not-allowed"
                }`}
                title={allUnitsExpanded ? "Collapse all units" : "Expand all units"}
              >
                {allUnitsExpanded ? (
                  <>
                    <FaCompressAlt className="text-xs" />
                    Collapse All
                  </>
                ) : (
                  <>
                    <FaExpandAlt className="text-xs" />
                    Expand All
                  </>
                )}
              </button>

              <button
                disabled={!canEdit}
                onClick={() => {
                  const unitId = selectedUnits[0];
                  if (unitId) navigate(`/units/${unitId}`);
                }}
                className={`px-4 py-1 text-xs text-white rounded-lg flex items-center gap-2 shadow-sm ${
                  canEdit ? `${MILIK_GREEN} ${MILIK_GREEN_HOVER}` : "bg-gray-400 cursor-not-allowed"
                }`}
                title={canEdit ? "Edit selected unit" : "Select exactly 1 unit to edit"}
              >
                <FaEdit className="text-xs" />
                Edit
              </button>

              {/* Archive / Restore dropdown (one button) */}
              <div className="relative" ref={actionMenuRef}>
                <button
                  onClick={() => setActionMenuOpen((v) => !v)}
                  disabled={selectedCount === 0}
                  className={`px-4 py-1 text-xs text-white rounded-lg flex items-center gap-2 shadow-sm ${
                    selectedCount > 0 ? `${MILIK_GREEN} ${MILIK_GREEN_HOVER}` : "bg-gray-400 cursor-not-allowed"
                  }`}
                  title={selectedCount ? "Archive/Restore selected units" : "Select unit(s) first"}
                >
                  <FaArchive className="text-xs" />
                  Actions
                  <FaChevronDown className="text-[10px] opacity-90" />
                </button>

                {actionMenuOpen && selectedCount > 0 && (
                  <div className="absolute mt-1 right-0 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden">
                    <button
                      onClick={archiveSelected}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2"
                    >
                      <FaArchive className="text-xs text-gray-700" />
                      Archive
                    </button>
                    <button
                      onClick={restoreSelected}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2"
                    >
                      <FaUndo className="text-xs text-gray-700" />
                      Restore
                    </button>
                  </div>
                )}
              </div>

              <button
                onClick={deleteSelected}
                disabled={selectedCount === 0}
                className={`px-4 py-1 text-xs text-white rounded-lg flex items-center gap-2 shadow-sm ${
                  selectedCount > 0 ? "bg-red-600 hover:bg-red-700" : "bg-gray-400 cursor-not-allowed"
                }`}
                title={selectedCount ? "Delete selected units" : "Select unit(s) to delete"}
              >
                <FaTrash className="text-xs" />
                Delete {selectedCount > 0 ? `(${selectedCount})` : ""}
              </button>

              <button
                onClick={() => navigate("/units/new")}
                className={`px-4 py-1 text-xs text-white rounded-lg flex items-center gap-2 shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
              >
                <FaPlus className="text-xs" />
                Add Unit
              </button>

              <button
                onClick={handlePrintList}
                className="px-4 py-1 text-xs bg-slate-700 text-white rounded-lg flex items-center gap-2 hover:bg-slate-800 transition-colors shadow-sm"
                title="Print units list"
              >
                <FaPrint className="text-xs" />
                Print List
              </button>

              <button 
                onClick={handleDownloadTemplate}
                className={`px-4 py-1 text-xs text-white rounded-lg flex items-center gap-2 shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
                title="Download Excel import template"
              >
                <FaDownload className="text-xs" />
                Template
              </button>

              <button 
                onClick={() => setShowImportModal(true)}
                className={`px-4 py-1 text-xs text-white rounded-lg flex items-center gap-2 shadow-sm bg-orange-600 hover:bg-orange-700`}
                title="Import units from Excel"
              >
                <FaFileExport className="text-xs" />
                Import
              </button>

              <button 
                onClick={handleExportToExcel}
                className="px-4 py-1 text-xs border border-gray-300 rounded-lg flex items-center gap-2 hover:bg-gray-50 transition-colors shadow-sm"
                title="Export units to Excel"
              >
                <FaFileExport className="text-xs" />
                Export
              </button>
            </div>

            {/* Row 2: typed fields */}
            <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2">
              <input
                value={draftFilters.unitNo}
                onChange={(e) => setDraftFilters((p) => ({ ...p, unitNo: e.target.value }))}
                onKeyDown={onFilterEnter}
                placeholder="Unit/Space No"
                className="px-3 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] bg-white"
              />
              <input
                value={draftFilters.tenant}
                onChange={(e) => setDraftFilters((p) => ({ ...p, tenant: e.target.value }))}
                onKeyDown={onFilterEnter}
                placeholder="Tenant"
                className="px-3 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] bg-white"
              />
              <div className="hidden md:block" />
              <div className="hidden md:block" />
            </div>
          </div>
        </div>

        {/* PROPERTIES TABLE (Units appear below property) */}
        <div className="flex-1 min-h-0 px-2 pb-2 overflow-hidden">
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm h-full flex flex-col">
            <div className="overflow-x-auto overflow-y-auto flex-1 min-h-0">
              <table className="min-w-full text-xs border-collapse bg-white" style={{ tableLayout: "auto" }}>
                <thead>
                  <tr className="sticky top-0 z-10 bg-[#0B3B2E] border-b border-gray-300">
                    <th className="px-2 py-2 text-left font-bold text-white border-r border-gray-300 w-8">
                      <input
                        type="checkbox"
                        checked={selectAll && visibleUnitIds.length > 0}
                        onChange={handleSelectAll}
                        onClick={handleCheckboxClick}
                        className="rounded border-gray-300 text-orange-600 focus:ring-orange-500 cursor-pointer"
                        title="Select all visible units"
                      />
                    </th>
                    <th className="px-1 py-2 text-center font-bold text-white border-r border-gray-300 w-8" title="Expand details"></th>
                    <th className="px-2 py-2 text-left font-bold text-white border-r border-gray-300 w-20">Property</th>
                    <th className="px-2 py-2 text-left font-bold text-white border-r border-gray-300 w-24">Unit No</th>
                    <th className="px-2 py-2 text-left font-bold text-white border-r border-gray-300 w-16">Code</th>
                    <th className="px-2 py-2 text-left font-bold text-white border-r border-gray-300 w-24">Unit Type</th>
                    <th className="px-2 py-2 text-right font-bold text-white border-r border-gray-300 w-28">Rent (Kshs)</th>
                    <th className="px-2 py-2 text-center font-bold text-white border-r border-gray-300 w-24">Status</th>
                    <th className="px-2 py-2 text-left font-bold text-white border-r border-gray-300 w-32">Tenant</th>
                    <th className="px-2 py-2 text-center font-bold text-white border-r border-gray-300 w-20">Vacant From</th>
                    <th className="px-2 py-2 text-center font-bold text-white w-16">Action</th>
                  </tr>
                </thead>

                <tbody>
                  {currentUnits.length > 0 ? (
                    // Render paginated units (max 50 per page)
                    currentUnits.map((u, idx) => {
                      const isFirstOfProperty =
                        idx === 0 || currentUnits[idx - 1].propertyId !== u.propertyId;

                      return (
                        <React.Fragment key={`unit-${u.id}`}>
                          {/* Property Section Header */}
                          {isFirstOfProperty && (
                            <tr className="bg-transparent">
                              <td colSpan={12} className="px-2 pt-1.5 pb-1">
                                <h3 className="text-sm font-extrabold text-black tracking-normal uppercase">
                                  {u.propertyName}
                                </h3>
                                <div className="mt-1 h-[2px] w-full bg-[#FF8C00]" />
                              </td>
                            </tr>
                          )}

                          {/* Unit Row */}
                          <tr
                            className={`border-b transition-colors cursor-pointer ${
                              selectedUnits.includes(u.id)
                                ? "bg-blue-100 hover:bg-blue-150"
                                : idx % 2 === 0
                                ? "bg-white hover:bg-slate-50"
                                : "bg-slate-50 hover:bg-slate-100"
                            }`}
                            onClick={(e) => handleRowClick(u.id, e)}
                          >
                            {/* Checkbox */}
                            <td className="px-2 py-1 border-r border-gray-200" onClick={handleCheckboxClick}>
                              <input
                                type="checkbox"
                                checked={selectedUnits.includes(u.id)}
                                onChange={() => handleSelectUnit(u.id)}
                                onClick={handleCheckboxClick}
                                className="rounded border-gray-300 text-orange-600 focus:ring-orange-500 cursor-pointer"
                              />
                            </td>

                            {/* Expand Button */}
                            <td className="px-1 py-1 border-r border-gray-200 align-top text-center">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleUnitExpand(u.id);
                                }}
                                className="p-1 hover:bg-gray-200 rounded transition-colors"
                                title={expandedUnits.includes(u.id) ? "Collapse" : "Expand"}
                              >
                                {expandedUnits.includes(u.id) ? (
                                  <FaChevronUp className="text-gray-600 text-xs" />
                                ) : (
                                  <FaChevronDown className="text-gray-600 text-xs" />
                                )}
                              </button>
                            </td>

                            {/* Property Name */}
                            <td className="px-2 py-1 border-r border-gray-200 font-bold text-slate-900 text-xs">
                              {u.propertyName}
                            </td>

                            {/* Unit/Space No */}
                            <td className="px-2 py-1 border-r border-gray-200 font-bold text-slate-900 text-xs">
                              {u.unitNo}
                            </td>

                            {/* Unit Code - 2 letters + 4 digits */}
                            <td className="px-2 py-1 border-r border-gray-200 font-bold font-mono text-slate-900 text-xs bg-gray-50">
                              {u.unitCode}
                            </td>

                            {/* Unit Type */}
                            <td className="px-2 py-1 border-r border-gray-200 font-bold text-slate-900 text-xs">
                              {formatUnitTypeLabel(u.unitType) || "N/A"}
                            </td>

                            {/* Rent Estimate */}
                            <td className="px-2 py-1 border-r border-gray-200 text-right font-bold text-slate-900 text-xs">
                              {u.currentRent}
                            </td>

                            {/* Status - Color coded background */}
                            <td className="px-2 py-1 border-r border-gray-200 text-center">
                              <span
                                className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-bold whitespace-nowrap w-full ${
                                  u.status === "occupied"
                                    ? "bg-green-200 text-green-900"
                                    : u.status === "vacant"
                                    ? "bg-red-200 text-red-900"
                                    : u.status === "maintenance"
                                    ? "bg-yellow-200 text-yellow-900"
                                    : "bg-gray-200 text-gray-900"
                                }`}
                              >
                                {u.status.charAt(0).toUpperCase() + u.status.slice(1)}
                              </span>
                            </td>

                            {/* Current Resident/Tenant */}
                            <td className="px-2 py-1 border-r border-gray-200 text-xs font-bold text-slate-900 truncate">
                              {u.tenant}
                            </td>

                            {/* Vacant From */}
                            <td className="px-2 py-1 border-r border-gray-200 text-center text-xs font-bold text-slate-900">
                              {u.status === "vacant" ? u.vacantFrom : "-"}
                            </td>

                            {/* Action */}
                            <td className="px-2 py-1 text-center">
                              <button
                                className={`px-2 py-0.5 text-xs text-white rounded font-semibold transition-all ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/units/${u.id}`);
                                }}
                              >
                                View
                              </button>
                            </td>
                          </tr>

                          {/* Expanded Unit Details */}
                          {expandedUnits.includes(u.id) && (
                            <tr className={`border-b ${idx % 2 === 0 ? "bg-white" : "bg-slate-50"}`}>
                              <td colSpan={12} className="p-4 border border-gray-200 bg-gradient-to-br from-white to-gray-50">
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                  {/* Unit Details */}
                                  <div className="space-y-4 p-4 bg-white rounded-lg shadow-md border-2 border-[#0B3B2E]/30">
                                    <h4 className="font-black text-gray-900 text-sm mb-4 pb-2 border-b-3 border-[#0B3B2E]">📋 Unit Details</h4>
                                    <div>
                                      <span className="text-xs font-black text-gray-700 uppercase tracking-wide">Unit Number</span>
                                      <p className="text-sm font-black text-gray-900 mt-2">{u.unitNo || "N/A"}</p>
                                    </div>
                                    <div>
                                      <span className="text-xs font-black text-gray-700 uppercase tracking-wide">Unit Code</span>
                                      <p className="text-sm font-black font-mono text-gray-900 mt-2 bg-gray-100 p-2 rounded">{u.unitCode || "N/A"}</p>
                                    </div>
                                    <div>
                                      <span className="text-xs font-black text-gray-700 uppercase tracking-wide">Unit Type</span>
                                      <p className="text-sm font-black text-gray-900 mt-2">{formatUnitTypeLabel(u.unitType) || "N/A"}</p>
                                    </div>
                                    <div>
                                      <span className="text-xs font-black text-gray-700 uppercase tracking-wide">Status</span>
                                      <p className={`text-sm font-black mt-2 inline-block px-3 py-1 rounded-lg ${
                                        u.status === "occupied"
                                          ? "bg-green-200 text-green-900"
                                          : u.status === "vacant"
                                          ? "bg-red-200 text-red-900"
                                          : u.status === "maintenance"
                                          ? "bg-yellow-200 text-yellow-900"
                                          : "bg-gray-200 text-gray-900"
                                      }`}>
                                        {u.status.charAt(0).toUpperCase() + u.status.slice(1)}
                                      </p>
                                    </div>
                                  </div>

                                  {/* Financial Details */}
                                  <div className="space-y-4 p-4 bg-white rounded-lg shadow-md border-2 border-[#FF8C00]/30">
                                    <h4 className="font-black text-gray-900 text-sm mb-4 pb-2 border-b-3 border-[#FF8C00]">💰 Financial Details</h4>
                                    <div>
                                      <span className="text-xs font-black text-gray-700 uppercase tracking-wide">Monthly Rent</span>
                                      <p className="text-sm font-black text-gray-900 mt-2">{u.currentRent || "Ksh 0"}</p>
                                    </div>
                                    <div>
                                      <span className="text-xs font-black text-gray-700 uppercase tracking-wide">Market Rent</span>
                                      <p className="text-sm font-black text-gray-900 mt-2">{u.marketRent || "N/A"}</p>
                                    </div>
                                    <div>
                                      <span className="text-xs font-black text-gray-700 uppercase tracking-wide">Billing Frequency</span>
                                      <p className="text-sm font-black text-gray-900 mt-2">Monthly</p>
                                    </div>
                                  </div>

                                  {/* Occupancy Details */}
                                  <div className="space-y-4 p-4 bg-white rounded-lg shadow-md border-2 border-blue-300/50">
                                    <h4 className="font-black text-gray-900 text-sm mb-4 pb-2 border-b-3 border-blue-600">👥 Occupancy Details</h4>
                                    <div>
                                      <span className="text-xs font-black text-gray-700 uppercase tracking-wide">Current Tenant</span>
                                      <p className="text-sm font-black text-gray-900 mt-2">{u.tenant || "-"}</p>
                                    </div>
                                    <div>
                                      <span className="text-xs font-black text-gray-700 uppercase tracking-wide">Vacant Since</span>
                                      <p className="text-sm font-black text-gray-900 mt-2">{u.status === "vacant" ? u.vacantFrom : "-"}</p>
                                    </div>
                                    <div>
                                      <span className="text-xs font-black text-gray-700 uppercase tracking-wide">Property</span>
                                      <p className="text-sm font-black text-gray-900 mt-2">{u.propertyName || "Unknown"}</p>
                                    </div>
                                  </div>

                                  {/* Actions */}
                                  <div className="space-y-4 p-4 bg-white rounded-lg shadow-md border-2 border-green-300/50">
                                    <h4 className="font-black text-gray-900 text-sm mb-4 pb-2 border-b-3 border-green-600">⚙️ Actions</h4>
                                    <button
                                      onClick={() => navigate(`/units/${u.id}`)}
                                      className={`w-full px-3 py-2 text-xs text-white rounded-lg flex items-center justify-center gap-2 transition-colors font-black ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
                                    >
                                      <FaEdit /> View Full Details
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={12} className="px-4 py-8 text-center">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <div className="text-lg font-bold text-slate-400">No units found</div>
                          <div className="text-sm text-slate-500">
                            {appliedFilters.property !== "any" || appliedFilters.status !== "any"
                              ? "Try adjusting your filters"
                              : "Create a unit or import existing units"}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Footer (consistent) */}
            <div className="flex-shrink-0 sticky bottom-0 z-20 bg-white border-t border-gray-200 shadow-sm">
              <div className="flex items-center justify-between px-3 py-2">
                <div className="text-xs text-gray-600">
                  <div className="flex items-center gap-4">
                    <span className="font-bold">
                      Showing <span className="font-bold text-slate-900">{currentUnits.length > 0 ? startIndex + 1 : 0}</span> to <span className="font-bold text-slate-900">{Math.min(endIndex, filteredUnits.length)}</span> of <span className="font-bold text-slate-900">{filteredUnits.length}</span> unit(s) across{" "}
                      <span className="font-bold text-slate-900">{propertiesGrouped.length}</span> propert{propertiesGrouped.length === 1 ? "y" : "ies"}
                    </span>

                    {selectedUnits.length > 0 && (
                      <span className="bg-orange-100 text-orange-900 px-2 py-0.5 rounded-full text-xs font-bold border border-orange-300">
                        {selectedUnits.length} unit(s) selected
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={safeCurrentPage === 1}
                    className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg flex items-center gap-1 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-bold"
                  >
                    <FaChevronLeft size={10} />
                    Previous
                  </button>

                  <div className="flex items-center gap-1">
                    {[...Array(totalPages)].map((_, i) => {
                      const page = i + 1;
                      if (page === 1 || page === totalPages || (page >= safeCurrentPage - 1 && page <= safeCurrentPage + 1)) {
                        return (
                          <button
                            key={page}
                            onClick={() => setCurrentPage(page)}
                            className={`px-3 py-1.5 min-w-[32px] text-xs rounded-lg border transition-colors font-bold ${
                              safeCurrentPage === page
                                ? "bg-[#0B3B2E] text-white border-[#0B3B2E] hover:bg-[#0A3127]"
                                : "border-gray-300 hover:bg-gray-50"
                            }`}
                          >
                            {page}
                          </button>
                        );
                      }
                      if (page === safeCurrentPage - 2 || page === safeCurrentPage + 2) {
                        return (
                          <span key={page} className="px-1 text-gray-400 text-xs">
                            ...
                          </span>
                        );
                      }
                      return null;
                    })}
                  </div>

                  <button
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={safeCurrentPage === totalPages}
                    className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg flex items-center gap-1 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-bold"
                  >
                    Next
                    <FaChevronRight size={10} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Resizing overlay */}
        {isResizing && <div className="fixed inset-0 z-50 cursor-col-resize" style={{ cursor: "col-resize" }} />}

        {/* Add Unit Modal (kept; styling aligned a bit) */}
        {showAddUnitModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-md backdrop-saturate-300 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
              <div className="flex justify-between items-center p-4 border-b">
                <div>
                  <h2 className="text-lg font-semibold text-gray-800">Add New Unit/Space</h2>
                  <p className="text-xs text-gray-600">Fill in the unit details below</p>
                </div>
                <button
                  onClick={() => setShowAddUnitModal(false)}
                  className="text-gray-500 hover:text-gray-700 p-1 rounded-full hover:bg-gray-100"
                >
                  <FaTimes />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6">
                <form onSubmit={handleAddUnitSubmit} id="unitForm">
                  <div className="mb-6">
                    <h3 className="text-sm font-semibold text-gray-800 mb-4 pb-2 border-b">General Information</h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Property *</label>
                        <select
                          name="property"
                          value={formData.property}
                          onChange={handleInputChange}
                          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] bg-white"
                          required
                        >
                          <option value="">Select Property</option>
                          {propertiesForDropdown.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Specified Floor</label>
                        <input
                          type="text"
                          name="specifiedFloor"
                          value={formData.specifiedFloor}
                          onChange={handleInputChange}
                          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                          placeholder="e.g., Ground Floor"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">General Floor No.</label>
                        <input
                          type="number"
                          name="generalFloorNo"
                          value={formData.generalFloorNo}
                          onChange={handleInputChange}
                          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                          placeholder="e.g., 1, 2, 3..."
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Unit/Space No. *</label>
                        <input
                          type="text"
                          name="unitSpaceNo"
                          value={formData.unitSpaceNo}
                          onChange={handleInputChange}
                          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                          placeholder="e.g., A101, 201, etc."
                          required
                        />
                      </div>

                      <div className="md:col-span-2">
                        <label className="block text-xs font-medium text-gray-700 mb-2">Owner Occupied?</label>
                        <div className="flex gap-4">
                          <label className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="ownerOccupied"
                              value="Yes"
                              checked={formData.ownerOccupied === "Yes"}
                              onChange={handleInputChange}
                              className="text-emerald-600 focus:ring-emerald-500"
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
                              className="text-emerald-600 focus:ring-emerald-500"
                            />
                            <span className="text-sm">No</span>
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* AREA/SPACE MANAGEMENT & COSTING */}
                  <div className="mb-6 border-t pt-4">
                    <h3 className="text-sm font-semibold text-gray-800 mb-4">AREA/SPACE MANAGEMENT & COSTING</h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Rent Per Unit Area (Ksh)</label>
                        <input
                          type="number"
                          name="rentPerUnitArea"
                          value={formData.rentPerUnitArea}
                          onChange={handleInputChange}
                          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                          placeholder="0.00"
                          step="0.01"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Market Rent (Ksh)</label>
                        <input
                          type="number"
                          name="marketRent"
                          value={formData.marketRent}
                          onChange={handleInputChange}
                          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                          placeholder="0.00"
                          step="0.01"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Area (Sq Ft)</label>
                        <input
                          type="number"
                          name="areaSqFt"
                          value={formData.areaSqFt}
                          onChange={handleInputChange}
                          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                          placeholder="0.00"
                          step="0.01"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Charge Freq.</label>
                        <select
                          name="chargeFreq"
                          value={formData.chargeFreq}
                          onChange={handleInputChange}
                          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] bg-white"
                        >
                          <option value="">Select Frequency</option>
                          {chargeFrequencies.map((f) => (
                            <option key={f} value={f}>
                              {f}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Services */}
                    <div className="mt-4">
                      <div className="flex justify-between items-center mb-2">
                        <h4 className="text-xs font-medium text-gray-700">Service Charge/Utility/Amenity</h4>
                        <button
                          type="button"
                          onClick={addServiceRow}
                          className={`px-3 py-1 text-xs text-white rounded transition-colors ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
                        >
                          Add Service
                        </button>
                      </div>

                      <div className="overflow-x-auto border border-gray-200 rounded-lg">
                        <table className="min-w-full text-xs">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-3 py-2 text-left font-medium text-gray-700 border-b w-8"></th>
                              <th className="px-3 py-2 text-left font-medium text-gray-700 border-b">Service</th>
                              <th className="px-3 py-2 text-left font-medium text-gray-700 border-b">Cost Per Area</th>
                              <th className="px-3 py-2 text-left font-medium text-gray-700 border-b">Total Cost</th>
                              <th className="px-3 py-2 text-left font-medium text-gray-700 border-b w-16">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {services.map((s, i) => (
                              <tr key={i} className="hover:bg-gray-50">
                                <td className="px-3 py-2 border-b">
                                  <input
                                    type="checkbox"
                                    checked={s.checked}
                                    onChange={(e) => handleServiceChange(i, "checked", e.target.checked)}
                                    className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                                  />
                                </td>
                                <td className="px-3 py-2 border-b">
                                  <input
                                    type="text"
                                    value={s.service}
                                    onChange={(e) => handleServiceChange(i, "service", e.target.value)}
                                    className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                                    placeholder="e.g., Water"
                                  />
                                </td>
                                <td className="px-3 py-2 border-b">
                                  <input
                                    type="number"
                                    value={s.costPerArea}
                                    onChange={(e) => handleServiceChange(i, "costPerArea", e.target.value)}
                                    className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                                    placeholder="0.00"
                                    step="0.01"
                                  />
                                </td>
                                <td className="px-3 py-2 border-b">
                                  <input
                                    type="text"
                                    value={s.totalCost}
                                    readOnly
                                    className="w-full px-2 py-1 border border-gray-300 rounded bg-gray-50"
                                  />
                                </td>
                                <td className="px-3 py-2 border-b">
                                  {services.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => removeServiceRow(i)}
                                      className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
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
                    <h3 className="text-sm font-semibold text-gray-800 mb-4">UTILITY ACCOUNT & METER NO.</h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Electricity Ac/No.</label>
                        <input
                          type="text"
                          name="electricityAccountNo"
                          value={formData.electricityAccountNo}
                          onChange={handleInputChange}
                          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Water Ac/No.</label>
                        <input
                          type="text"
                          name="waterAccountNo"
                          value={formData.waterAccountNo}
                          onChange={handleInputChange}
                          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Electricity Meter/No.</label>
                        <input
                          type="text"
                          name="electricityMeterNo"
                          value={formData.electricityMeterNo}
                          onChange={handleInputChange}
                          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Water Meter/No.</label>
                        <input
                          type="text"
                          name="waterMeterNo"
                          value={formData.waterMeterNo}
                          onChange={handleInputChange}
                          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                        />
                      </div>
                    </div>

                    <div className="mt-4">
                      <div className="flex justify-between items-center mb-2">
                        <h4 className="text-xs font-medium text-gray-700">Extra Meter Numbers</h4>
                        <button
                          type="button"
                          onClick={addMeterRow}
                          className={`px-3 py-1 text-xs text-white rounded transition-colors ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
                        >
                          Add Meter
                        </button>
                      </div>

                      <div className="overflow-x-auto border border-gray-200 rounded-lg">
                        <table className="min-w-full text-xs">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-3 py-2 text-left font-medium text-gray-700 border-b w-8"></th>
                              <th className="px-3 py-2 text-left font-medium text-gray-700 border-b">Meter No</th>
                              <th className="px-3 py-2 text-left font-medium text-gray-700 border-b w-28">Reading Setup</th>
                              <th className="px-3 py-2 text-left font-medium text-gray-700 border-b w-16">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {extraMeters.map((m, i) => (
                              <tr key={i} className="hover:bg-gray-50">
                                <td className="px-3 py-2 border-b"></td>
                                <td className="px-3 py-2 border-b">
                                  <input
                                    type="text"
                                    value={m.meterNo}
                                    onChange={(e) => handleMeterChange(i, "meterNo", e.target.value)}
                                    className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                                    placeholder="Meter number"
                                  />
                                </td>
                                <td className="px-3 py-2 border-b">
                                  <div className="flex items-center">
                                    <input
                                      type="checkbox"
                                      checked={m.readingSetup}
                                      onChange={(e) => handleMeterChange(i, "readingSetup", e.target.checked)}
                                      className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                                    />
                                    <span className="ml-2 text-xs">Enabled</span>
                                  </div>
                                </td>
                                <td className="px-3 py-2 border-b">
                                  {extraMeters.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => removeMeterRow(i)}
                                      className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
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

              <div className="flex justify-between items-center p-4 border-t bg-gray-50">
                <div className="text-xs text-gray-500">Fields marked with * are required</div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAddUnitModal(false)}
                    className="px-6 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
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
                    className="px-6 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Reset
                  </button>
                  <button
                    type="submit"
                    form="unitForm"
                    className={`px-6 py-2 text-sm text-white rounded-lg transition-colors flex items-center gap-2 ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
                  >
                    <FaSave /> Save Unit
                  </button>
                </div>
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