// pages/Vacants/Vacants.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useDispatch, useSelector } from "react-redux";
import { useEntityCache } from "../../hooks/useEntityCache";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { fmtDate } from "../../utils/dates";
import {
  FaSearch,
  FaRedoAlt,
  FaExpandAlt,
  FaCompressAlt,
  FaPrint,
  FaFileExport,
  FaPlus,
  FaChevronLeft,
  FaChevronRight,
  FaChevronDown,
  FaChevronUp,
  FaUserPlus,
  FaUserEdit,
  FaWrench,
  FaArchive,
  FaUndo,
  FaCheckCircle,
  FaTag,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { getUnits, updateUnit } from "../../redux/unitRedux";
import { getProperties } from "../../redux/propertyRedux";
import { getTenants } from "../../redux/tenantsRedux";
import { getMaintenances } from "../../redux/apiCalls";
import { selectCurrentCompany, selectCurrentUser, selectAllProperties, selectAllTenants, selectAllMaintenances, selectAllUnits, selectUnitIsFetching } from "../../redux/selectors";
import { hasCompanyPermission } from "../../utils/permissions";
import MilikConfirmDialog from "../../components/Modals/MilikConfirmDialog";
import AppSelect from "../../components/common/AppSelect";
import { printTabularList } from "../../utils/printList";
import PaginationBar from '../../components/PaginationBar';
import MilikTable from '../../components/common/MilikTable';

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";
const MILIK_ORANGE = "bg-[#FF8C00]";
const MILIK_ORANGE_HOVER = "hover:bg-[#e67e00]";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_COMPANY_UNIT_TYPES = ["studio", "1bed", "2bed", "3bed", "4bed", "commercial"];

const normalizeId = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const normalizeText = (value) => String(value ?? "").toLowerCase().trim();

const isFutureDate = (value) => {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return date.getTime() >= today.getTime();
};


const getDaysBetween = (fromValue, toValue = new Date()) => {
  if (!fromValue) return null;
  const from = new Date(fromValue);
  const to = new Date(toValue);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  from.setHours(0, 0, 0, 0);
  to.setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil((to.getTime() - from.getTime()) / ONE_DAY_MS));
};

const formatCurrency = (amount) => {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) return "Ksh 0";
  return `Ksh ${numericAmount.toLocaleString("en-KE")}`;
};

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

const getAvailabilityTone = (status) => {
  switch (status) {
    case "occupied":       return "bg-emerald-100 text-emerald-800 border border-emerald-300";
    case "vacant":         return "bg-orange-100 text-orange-800 border border-orange-300";
    case "notice_given":   return "bg-blue-100 text-blue-800 border border-blue-300";
    case "reserved":       return "bg-violet-100 text-violet-800 border border-violet-300";
    case "under_maintenance": return "bg-amber-100 text-amber-800 border border-amber-300";
    case "off_market":     return "bg-slate-200 text-slate-700 border border-slate-300";
    case "owner_occupied": return "bg-pink-100 text-pink-800 border border-pink-300";
    default:               return "bg-gray-100 text-gray-700 border border-gray-300";
  }
};

const getAvailabilityLabel = (status) => {
  switch (status) {
    case "occupied":          return "Occupied";
    case "vacant":            return "Vacant";
    case "notice_given":      return "Notice Given";
    case "reserved":          return "Reserved";
    case "under_maintenance": return "Under Maintenance";
    case "off_market":        return "Off Market";
    case "owner_occupied":    return "Owner Occupied";
    default:                  return "Unknown";
  }
};

const isOpenMaintenanceStatus = (status) => {
  const normalized = normalizeText(status);
  return normalized === "pending" || normalized === "in_progress";
};

const isOffMarketStatus = (status) => {
  const normalized = normalizeText(status);
  return ["archived", "inactive", "off_market", "off market"].includes(normalized);
};

const buildCsv = (rows) => {
  const header = [
    "Property",
    "Unit/Space",
    "Unit Type",
    "Availability Status",
    "Current Tenant",
    "Available From",
    "Days Vacant",
    "Monthly Rent",
    "Notes",
  ];

  const lines = rows.map((row) => [
    row.propertyName,
    row.unitNo,
    row.unitTypeLabel,
    row.statusLabel,
    row.tenantName,
    row.availableFromLabel,
    row.daysVacantLabel,
    row.rentLabel,
    row.notes,
  ]);

  return [header, ...lines]
    .map((line) =>
      line
        .map((item) => `"${String(item ?? "").replace(/"/g, '""')}"`)
        .join(",")
    )
    .join("\n");
};

const Vacants = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const canCreateTenant = hasCompanyPermission(currentUser || {}, currentCompany, 'tenants', 'create', 'propertyManagement');
  const canCreateUnit   = hasCompanyPermission(currentUser || {}, currentCompany, 'units', 'create', 'propertyManagement');
  const canUpdateUnit   = hasCompanyPermission(currentUser || {}, currentCompany, 'units', 'update', 'propertyManagement');
  const { propertiesLoaded, unitsLoaded, tenantsLoaded } = useEntityCache(currentCompany?._id);

  const units = useSelector(selectAllUnits);
  const unitsLoading = useSelector(selectUnitIsFetching);
  const properties = useSelector(selectAllProperties);
  const tenants = useSelector(selectAllTenants);
  const maintenances = useSelector(selectAllMaintenances);

  const [currentPage, setCurrentPage] = useTabState("/vacants:currentPage", 1);
  const [pageSize, setPageSize] = useState(50);
  const [expandedRows, setExpandedRows] = useState([]);
  const [selectedRowId, setSelectedRowId] = useTabState("/vacants:selectedRowId", null);
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    title: "",
    message: "",
    confirmText: "Confirm",
    isDangerous: false,
    onConfirm: null,
  });

  const emptyFilters = {
    property: "any",
    status: "any",
    unitType: "any",
    window: "all",
    search: "",
    tenant: "",
  };

  const [appliedFilters, setAppliedFilters] = useTabState("/vacants:appliedFilters", emptyFilters);
  const [draftFilters, setDraftFilters] = useState(appliedFilters);

  useEffect(() => {
    if (!currentCompany?._id) return;
    if (!unitsLoaded) dispatch(getUnits({ business: currentCompany._id }));
    if (!propertiesLoaded) dispatch(getProperties({ business: currentCompany._id }));
    if (!tenantsLoaded) dispatch(getTenants({ business: currentCompany._id }));
    getMaintenances(dispatch, currentCompany._id).catch(() => {
      // keep page usable even if maintenance fetch fails
    });
  }, [currentCompany?._id]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setCurrentPage(1);
  }, [appliedFilters]);

  const tenantAssignments = useMemo(() => {
    const byUnit = new Map();

    (Array.isArray(tenants) ? tenants : []).forEach((tenant) => {
      const tenantStatus = normalizeText(tenant?.status || "active");
      if (["terminated", "moved_out", "inactive", "evicted"].includes(tenantStatus)) return;

      const assignedUnitIds = [
        normalizeId(tenant?.unit?._id || tenant?.unit),
        ...(Array.isArray(tenant?.additionalUnits)
          ? tenant.additionalUnits.map((item) => normalizeId(item?._id || item))
          : []),
      ].filter(Boolean);

      assignedUnitIds.forEach((unitId) => {
        if (!byUnit.has(unitId)) byUnit.set(unitId, []);
        byUnit.get(unitId).push(tenant);
      });
    });

    return byUnit;
  }, [tenants]);

  const maintenanceAssignments = useMemo(() => {
    const byUnit = new Map();

    (Array.isArray(maintenances) ? maintenances : []).forEach((item) => {
      if (!isOpenMaintenanceStatus(item?.status)) return;
      const unitId = normalizeId(item?.unit?._id || item?.unit);
      if (!unitId) return;
      if (!byUnit.has(unitId)) byUnit.set(unitId, []);
      byUnit.get(unitId).push(item);
    });

    return byUnit;
  }, [maintenances]);

  const availabilityRows = useMemo(() => {
    const unitList = Array.isArray(units) ? units : [];

    // Precompute per-property sequential index so the inner loop is O(n) not O(n²)
    const propertyCounter = new Map();
    const unitIndexInPropertyArr = unitList.map((unit) => {
      const propId = normalizeId(
        typeof unit?.property === 'string'
          ? unit.property
          : (unit?.property?._id || unit?.property)
      );
      const next = (propertyCounter.get(propId) || 0) + 1;
      propertyCounter.set(propId, next);
      return next;
    });

    return unitList.map((unit, index) => {
      const propertyObj = typeof unit?.property === "string"
        ? properties.find((item) => normalizeId(item?._id) === normalizeId(unit?.property))
        : unit?.property;

      const propertyId = normalizeId(propertyObj?._id || unit?.property);
      const propertyName = propertyObj?.propertyName || propertyObj?.name || "Unknown Property";
      const propertyCode = propertyObj?.propertyCode || "";
      const unitId = normalizeId(unit?._id);
      const assignedTenants = tenantAssignments.get(unitId) || [];
      const currentTenant = unit?.currentTenant || assignedTenants[0] || null;
      const maintenanceItems = maintenanceAssignments.get(unitId) || [];
      const rawStatus = normalizeText(unit?.status || "");
      const isReserved = rawStatus === "reserved";
      const isMaintenance = rawStatus === "maintenance" || maintenanceItems.length > 0;
      const isOffMarket = isOffMarketStatus(rawStatus);
      const hasFutureMoveOut = Boolean(currentTenant?.moveOutDate && isFutureDate(currentTenant.moveOutDate));
      const hasActiveOccupant = Boolean(
        currentTenant || rawStatus === "occupied" || unit?.isVacant === false || normalizeText(unit?.tenantName) !== ""
      );

      let availabilityStatus = "vacant";
      if (isOffMarket) {
        availabilityStatus = "off_market";
      } else if (unit?.ownerOccupied) {
        availabilityStatus = "owner_occupied";
      } else if (isMaintenance) {
        availabilityStatus = "under_maintenance";
      } else if (isReserved) {
        availabilityStatus = "reserved";
      } else if (hasFutureMoveOut) {
        availabilityStatus = "notice_given";
      } else if (hasActiveOccupant) {
        availabilityStatus = "occupied";
      }

      const vacancyAnchorDate =
        availabilityStatus === "vacant"
          ? unit?.vacantSince || unit?.updatedAt || unit?.createdAt || null
          : null;

      const availableFrom =
        availabilityStatus === "vacant"
          ? vacancyAnchorDate
          : availabilityStatus === "notice_given"
            ? currentTenant?.moveOutDate || null
            : null;

      const daysVacant = availabilityStatus === "vacant" ? getDaysBetween(vacancyAnchorDate) : null;
      const tenantName =
        currentTenant?.name ||
        unit?.currentTenant?.name ||
        unit?.tenant?.name ||
        unit?.tenantName ||
        unit?.lastTenant?.name ||
        "-";

      const notes = [];
      if (availabilityStatus === "notice_given" && currentTenant?.moveOutDate) {
        notes.push(`Move-out scheduled for ${fmtDate(currentTenant.moveOutDate)}`);
      }
      if (availabilityStatus === "under_maintenance" && maintenanceItems.length > 0) {
        notes.push(`${maintenanceItems.length} open maintenance request${maintenanceItems.length === 1 ? "" : "s"}`);
      }
      if (availabilityStatus === "reserved") {
        notes.push("Reserved and awaiting move-in");
      }
      if (availabilityStatus === "off_market") {
        notes.push("Unit is archived or inactive");
      }
      if (availabilityStatus === "owner_occupied") {
        notes.push("Occupied by property owner");
      }
      if (availabilityStatus === "vacant" && daysVacant !== null) {
        notes.push(`Vacant for ${daysVacant} day${daysVacant === 1 ? "" : "s"}`);
      }

      const first2Letters = propertyName.substring(0, 2).toUpperCase();
      const unitIndexInProperty = unitIndexInPropertyArr[index];

      return {
        id: unitId,
        propertyId,
        propertyName,
        propertyCode,
        unitNo: unit?.unitNumber || unit?.unitName || unit?.name || `Unit ${index + 1}`,
        unitCode: `${first2Letters}${String(unitIndexInProperty).padStart(4, "0")}`,
        unitType: String(unit?.unitType || "").trim(),
        unitTypeLabel: formatUnitTypeLabel(unit?.unitType || "N/A"),
        status: availabilityStatus,
        statusLabel: getAvailabilityLabel(availabilityStatus),
        tenantId: normalizeId(currentTenant?._id),
        tenantName,
        moveOutDate: currentTenant?.moveOutDate || null,
        availableFrom,
        availableFromLabel: fmtDate(availableFrom),
        daysVacant,
        daysVacantLabel: daysVacant === null ? "-" : `${daysVacant}`,
        rent: Number(unit?.rent || 0),
        rentLabel: formatCurrency(unit?.rent || 0),
        vacantSince: unit?.vacantSince || null,
        rawUnit: unit,
        maintenanceCount: maintenanceItems.length,
        notes: notes.join(" • ") || "-",
      };
    });
  }, [maintenanceAssignments, properties, tenantAssignments, units]);

  const summary = useMemo(() => {
    const totals = availabilityRows.reduce(
      (acc, row) => {
        acc.total += 1;
        if (row.status !== "off_market" && row.status !== "owner_occupied") acc.rentable += 1;
        if (row.status === "occupied") acc.occupied += 1;
        if (row.status === "vacant") acc.vacant += 1;
        if (row.status === "notice_given") acc.notice += 1;
        if (row.status === "reserved") acc.reserved += 1;
        if (row.status === "under_maintenance") acc.maintenance += 1;
        if (row.status === "off_market") acc.offMarket += 1;
        if (row.status === "owner_occupied") acc.ownerOccupied += 1;
        return acc;
      },
      { total: 0, rentable: 0, occupied: 0, vacant: 0, notice: 0, reserved: 0, maintenance: 0, offMarket: 0, ownerOccupied: 0 }
    );

    return {
      ...totals,
      occupancyRate: totals.rentable > 0 ? ((totals.occupied / totals.rentable) * 100).toFixed(1) : "0.0",
    };
  }, [availabilityRows]);

  const uniqueProperties = useMemo(() => {
    const options = (properties || [])
      .filter((property) => property?._id)
      .map((property) => ({
        value: property._id,
        label: property.propertyCode
          ? `${property.propertyCode} - ${property.propertyName}`
          : property.propertyName,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return [{ value: "any", label: "Property" }, ...options];
  }, [properties]);

  const unitTypeOptions = useMemo(() => {
    const companyTypes = sanitizeCompanyUnitTypes(currentCompany?.unitTypes);
    const existingTypes = Array.from(
      new Set(availabilityRows.map((item) => item.unitType).filter(Boolean))
    );
    return Array.from(new Set([...companyTypes, ...existingTypes]));
  }, [availabilityRows, currentCompany?.unitTypes]);

  const filteredRows = useMemo(() => {
    const now = new Date();

    const matchesWindow = (row) => {
      if (appliedFilters.window === "all") return true;
      if (appliedFilters.window === "now") return row.status === "vacant";

      const availableDate = row.availableFrom ? new Date(row.availableFrom) : null;
      if (row.status === "vacant") return true;
      if (!availableDate || Number.isNaN(availableDate.getTime())) return false;

      const targetDays = appliedFilters.window === "next7" ? 7 : 30;
      const future = new Date(now);
      future.setHours(0, 0, 0, 0);
      future.setDate(future.getDate() + targetDays);

      availableDate.setHours(0, 0, 0, 0);
      return availableDate.getTime() <= future.getTime();
    };

    return availabilityRows
      .filter((row) => {
        if (appliedFilters.property !== "any" && row.propertyId !== appliedFilters.property) return false;
        if (appliedFilters.status !== "any" && row.status !== appliedFilters.status) return false;
        if (appliedFilters.unitType !== "any" && row.unitType !== appliedFilters.unitType) return false;
        if (!matchesWindow(row)) return false;

        const matchesSearch = appliedFilters.search
          ? [row.unitNo, row.propertyName, row.propertyCode, row.unitCode, row.statusLabel]
              .some((value) => normalizeText(value).includes(normalizeText(appliedFilters.search)))
          : true;

        const matchesTenant = appliedFilters.tenant
          ? normalizeText(row.tenantName).includes(normalizeText(appliedFilters.tenant))
          : true;

        return matchesSearch && matchesTenant;
      })
      .sort((a, b) => {
        const propertyCompare = String(a.propertyName || "").localeCompare(String(b.propertyName || ""), undefined, {
          numeric: true,
          sensitivity: "base",
        });
        if (propertyCompare !== 0) return propertyCompare;
        return String(a.unitNo || "").localeCompare(String(b.unitNo || ""), undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });
  }, [appliedFilters, availabilityRows]);

  const groupedRows = useMemo(() => {
    const map = new Map();

    filteredRows.forEach((row) => {
      const key = row.propertyId || row.propertyName;
      if (!map.has(key)) {
        map.set(key, {
          propertyId: row.propertyId,
          propertyName: row.propertyName,
          propertyCode: row.propertyCode,
          rows: [],
        });
      }
      map.get(key).rows.push(row);
    });

    return Array.from(map.values())
      .map((group) => {
        const counts = group.rows.reduce(
          (acc, row) => {
            acc.total += 1;
            if (row.status === "occupied") acc.occupied += 1;
            if (row.status === "vacant") acc.vacant += 1;
            if (row.status === "notice_given") acc.notice += 1;
            if (row.status === "reserved") acc.reserved += 1;
            if (row.status === "under_maintenance") acc.maintenance += 1;
            if (row.status === "off_market") acc.offMarket += 1;
            if (row.status === "owner_occupied") acc.ownerOccupied += 1;
            return acc;
          },
          { total: 0, occupied: 0, vacant: 0, notice: 0, reserved: 0, maintenance: 0, offMarket: 0, ownerOccupied: 0 }
        );

        return {
          ...group,
          counts,
        };
      })
      .sort((a, b) => String(a.propertyName).localeCompare(String(b.propertyName)));
  }, [filteredRows]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const currentRows = filteredRows.slice(startIndex, endIndex);

  const selectedRow = useMemo(
    () => currentRows.find((r) => r.id === selectedRowId) || null,
    [currentRows, selectedRowId]
  );

  useEffect(() => {
    if (currentPage !== safeCurrentPage) setCurrentPage(safeCurrentPage);
  }, [currentPage, safeCurrentPage]);

  const allExpanded = currentRows.length > 0 && currentRows.every((row) => expandedRows.includes(row.id));

  const handleFilterEnter = (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    setAppliedFilters({
      ...draftFilters,
      search: draftFilters.search.trim(),
      tenant: draftFilters.tenant.trim(),
    });
    setExpandedRows([]);
    setSelectedRowId(null);
  };

  const applySearch = () => {
    setAppliedFilters({
      ...draftFilters,
      search: draftFilters.search.trim(),
      tenant: draftFilters.tenant.trim(),
    });
    setExpandedRows([]);
    setSelectedRowId(null);
  };

  const resetFilters = () => {
    setDraftFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    setExpandedRows([]);
    setSelectedRowId(null);
  };

  const toggleRow = (rowId) => {
    setExpandedRows((prev) => (prev.includes(rowId) ? prev.filter((item) => item !== rowId) : [...prev, rowId]));
  };

  const expandAll = () => {
    setExpandedRows(currentRows.map((row) => row.id));
  };

  const collapseAll = () => {
    setExpandedRows([]);
  };

  const refreshRows = async () => {
    if (!currentCompany?._id) return;
    await dispatch(getUnits({ business: currentCompany._id }));
    await dispatch(getTenants({ business: currentCompany._id }));
    getMaintenances(dispatch, currentCompany._id).catch(() => {});
  };

  const queueStatusChange = ({ row, title, message, unitData, confirmText = "Update", isDangerous = false }) => {
    setConfirmDialog({
      isOpen: true,
      title,
      message,
      confirmText,
      isDangerous,
      onConfirm: async () => {
        try {
          await dispatch(updateUnit({ id: row.id, unitData })).unwrap();
          await refreshRows();
          toast.success(`${row.unitNo} updated successfully.`);
        } catch (error) {
          const msg = error?.message || error?.data?.message || "Failed to update availability status.";
          toast.error(msg);
        } finally {
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        }
      },
    });
  };

  const handleReserve = (row) => {
    queueStatusChange({
      row,
      title: "Reserve Unit",
      message: `Mark ${row.unitNo} as reserved? It will remain unavailable until a tenant is moved in or the reservation is cleared.`,
      confirmText: "Reserve",
      unitData: {
        status: "reserved",
        isVacant: true,
        vacantSince: row.rawUnit?.vacantSince || new Date().toISOString(),
      },
    });
  };

  const handleMaintenance = (row) => {
    queueStatusChange({
      row,
      title: "Mark Under Maintenance",
      message: `Move ${row.unitNo} into maintenance status? This will block it from normal vacancy allocation until it is marked ready again.`,
      confirmText: "Mark Maintenance",
      unitData: {
        status: "maintenance",
        isVacant: true,
        vacantSince: row.rawUnit?.vacantSince || new Date().toISOString(),
      },
    });
  };

  const handleReady = (row) => {
    queueStatusChange({
      row,
      title: "Mark Ready for Letting",
      message: `Mark ${row.unitNo} as ready and available for letting?`,
      confirmText: "Mark Ready",
      unitData: {
        status: "vacant",
        isVacant: true,
        vacantSince: row.rawUnit?.vacantSince || new Date().toISOString(),
      },
    });
  };

  const handleOffMarket = (row) => {
    queueStatusChange({
      row,
      title: "Move Off Market",
      message: `Archive ${row.unitNo} from the active letting stock? You can restore it later from this page.`,
      confirmText: "Move Off Market",
      isDangerous: true,
      unitData: {
        status: "archived",
        isVacant: true,
        vacantSince: row.rawUnit?.vacantSince || new Date().toISOString(),
      },
    });
  };

  const handleRestore = (row) => {
    queueStatusChange({
      row,
      title: "Restore Unit",
      message: `Restore ${row.unitNo} back into the active availability stock as vacant?`,
      confirmText: "Restore",
      unitData: {
        status: "vacant",
        isVacant: true,
        vacantSince: row.rawUnit?.vacantSince || new Date().toISOString(),
      },
    });
  };

  const handleOwnerOccupied = (row) => {
    if (row.tenantId && row.tenantName !== "-") {
      toast.error(`${row.unitNo} has an active tenant (${row.tenantName}). Remove the tenant before marking this unit as owner occupied.`);
      return;
    }
    queueStatusChange({
      row,
      title: "Mark as Owner Occupied",
      message: `Mark ${row.unitNo} as owner occupied? The unit will be excluded from rental availability and occupancy calculations.`,
      confirmText: "Mark Owner Occupied",
      unitData: { ownerOccupied: true, status: "occupied", isVacant: false },
    });
  };

  const handleReleaseOwner = (row) => {
    queueStatusChange({
      row,
      title: "Release Owner Occupied Unit",
      message: `Release ${row.unitNo} back into the letting stock as vacant?`,
      confirmText: "Release Unit",
      unitData: { ownerOccupied: false, status: "vacant", isVacant: true, vacantSince: new Date().toISOString() },
    });
  };

  const openTenantTakeOn = (row) => {
    if (!row?.id || !row?.propertyId) {
      toast.error("The selected unit is missing its property or unit reference.");
      return;
    }

    const nextActionLabel = row.status === "reserved" ? "Complete Take-On" : "Add Tenant";
    navigate(
      `/tenant/new?propertyId=${encodeURIComponent(row.propertyId)}&unitId=${encodeURIComponent(row.id)}&source=availability_status`,
      {
        state: {
          tabTitle: `${nextActionLabel} • ${row.unitNo}`,
          preselectedPropertyId: row.propertyId,
          preselectedUnitId: row.id,
          preselectionSource: "availability_status",
          preselectedUnitSnapshot: {
            propertyName: row.propertyName,
            unitNumber: row.unitNo,
            unitCode: row.unitCode,
            status: row.status,
            statusLabel: row.statusLabel,
            rent: row.rawUnit?.rent ?? row.rent,
            deposit: row.rawUnit?.deposit,
            availableFrom: row.availableFrom,
          },
        },
      }
    );
  };

  const handlePrint = () => {
    if (!filteredRows.length) {
      toast.info("There are no availability records to print.");
      return;
    }

    printTabularList({
      title: "Availability Status",
      subtitle: "Unit-by-unit occupancy and availability control list",
      company: currentCompany,
      summary: `Records: ${filteredRows.length} • Rentable units: ${summary.rentable} • Occupancy rate: ${summary.occupancyRate}% • Printed on ${new Date().toLocaleString()}`,
      columns: [
        { label: "Property", value: (row) => row.propertyName },
        { label: "Unit/Space", value: (row) => row.unitNo },
        { label: "Type", value: (row) => row.unitTypeLabel },
        { label: "Status", value: (row) => row.statusLabel },
        { label: "Tenant", value: (row) => row.tenantName },
        { label: "Available From", value: (row) => row.availableFromLabel },
        { label: "Days Vacant", value: (row) => row.daysVacantLabel, align: "right" },
        { label: "Rent", value: (row) => row.rentLabel, align: "right" },
      ],
      rows: filteredRows,
    });
  };

  const handleExport = () => {
    if (!filteredRows.length) {
      toast.info("There are no availability records to export.");
      return;
    }

    const csv = buildCsv(filteredRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `availability_status_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);
    toast.success("Availability status exported successfully.");
  };

  const renderPropertySummary = (group) => (
    <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em]">
      <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-800">Occupied {group.counts.occupied}</span>
      <span className="rounded-full bg-orange-100 px-2.5 py-1 text-orange-800">Vacant {group.counts.vacant}</span>
      <span className="rounded-full bg-blue-100 px-2.5 py-1 text-blue-800">Notice {group.counts.notice}</span>
      <span className="rounded-full bg-violet-100 px-2.5 py-1 text-violet-800">Reserved {group.counts.reserved}</span>
      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-800">Maintenance {group.counts.maintenance}</span>
      <span className="rounded-full bg-slate-200 px-2.5 py-1 text-slate-700">Off Market {group.counts.offMarket}</span>
      {group.counts.ownerOccupied > 0 && (
        <span className="rounded-full bg-pink-100 px-2.5 py-1 text-pink-800">Owner Occ. {group.counts.ownerOccupied}</span>
      )}
    </div>
  );

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gray-50 p-0">
        <div className="flex-none sticky top-0 z-30 border-b border-gray-100 bg-white shadow-sm">
          <div className="filter-bar flex items-center gap-0.5 overflow-x-auto px-2 py-1">
            <button onClick={applySearch} className={`h-[20px] shrink-0 flex items-center gap-0.5 px-2.5 text-[9px] font-bold text-white shadow-sm ${MILIK_ORANGE} ${MILIK_ORANGE_HOVER}`}><FaSearch size={7} /> Search</button>
            <button onClick={resetFilters} className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] font-bold text-white shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}><FaRedoAlt size={7} /> Reset</button>
            <button onClick={allExpanded ? collapseAll : expandAll} disabled={!currentRows.length} className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] font-bold text-white shadow-sm ${currentRows.length ? (allExpanded ? "bg-orange-600 hover:bg-orange-700" : `${MILIK_GREEN} ${MILIK_GREEN_HOVER}`) : "cursor-not-allowed bg-gray-400"}`}>{allExpanded ? <><FaCompressAlt size={7} /> Collapse</> : <><FaExpandAlt size={7} /> Expand</>}</button>
            <div className="mx-1 h-3 w-px shrink-0 bg-gray-300" />
            {canCreateTenant && <button onClick={() => navigate("/tenant/new")} className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] font-bold text-white shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}><FaUserPlus size={7} /> Add Tenant</button>}
            {canCreateUnit && <button onClick={() => navigate("/units/new")} className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] font-bold text-white shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}><FaPlus size={7} /> Add Unit</button>}
            <div className="mx-1 h-3 w-px shrink-0 bg-gray-300" />
            <button onClick={handlePrint} className="h-[20px] shrink-0 flex items-center gap-0.5 bg-slate-700 px-1.5 text-[9px] font-bold text-white shadow-sm hover:bg-slate-800"><FaPrint size={7} /> Print</button>
            <button onClick={handleExport} className="h-[20px] shrink-0 flex items-center gap-0.5 border border-gray-300 px-1.5 text-[9px] font-bold shadow-sm hover:bg-gray-50"><FaFileExport size={7} /> Export</button>
            <div className="mx-1 h-3 w-px shrink-0 bg-gray-300" />
            <AppSelect value={draftFilters.property} onChange={(v) => setDraftFilters((prev) => ({ ...prev, property: v ?? "any" }))} options={uniqueProperties.filter((o) => o.value !== "any")} placeholder="Property" clearable searchable compact />
            <AppSelect value={draftFilters.status} onChange={(v) => setDraftFilters((prev) => ({ ...prev, status: v ?? "any" }))} options={[{value:"occupied",label:"Occupied"},{value:"vacant",label:"Vacant"},{value:"notice_given",label:"Notice Given"},{value:"reserved",label:"Reserved"},{value:"under_maintenance",label:"Under Maintenance"},{value:"off_market",label:"Off Market"},{value:"owner_occupied",label:"Owner Occupied"}]} placeholder="Status" clearable compact />
            <AppSelect value={draftFilters.unitType} onChange={(v) => setDraftFilters((prev) => ({ ...prev, unitType: v ?? "any" }))} options={unitTypeOptions.map((type) => ({ value: type, label: formatUnitTypeLabel(type) }))} placeholder="Unit Type" clearable compact />
            <AppSelect value={draftFilters.window} onChange={(v) => setDraftFilters((prev) => ({ ...prev, window: v ?? "all" }))} options={[{value:"now",label:"Available Now"},{value:"next7",label:"In 7 Days"},{value:"next30",label:"In 30 Days"}]} placeholder="Availability" clearable compact />
            <div className="mx-1 h-3 w-px shrink-0 bg-gray-300" />
            <input value={draftFilters.search} onChange={(event) => setDraftFilters((prev) => ({ ...prev, search: event.target.value }))} onKeyDown={handleFilterEnter} placeholder="Search…" className="h-[20px] w-28 shrink-0 border border-gray-300 bg-white px-1.5 text-[9px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
            <input value={draftFilters.tenant} onChange={(event) => setDraftFilters((prev) => ({ ...prev, tenant: event.target.value }))} onKeyDown={handleFilterEnter} placeholder="Tenant" className="h-[20px] w-20 shrink-0 border border-gray-300 bg-white px-1.5 text-[9px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
          </div>

          {/* Context action bar — shows when a row is selected */}
          <div className={`flex items-center gap-1.5 overflow-x-auto border-t px-2 py-1 transition-all ${selectedRow ? "border-gray-200 bg-[#f5faf8]" : "border-transparent bg-transparent"}`} style={{ minHeight: "34px" }}>
            {selectedRow ? (
              <>
                <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-slate-400">Unit:</span>
                <span className="shrink-0 inline-flex items-center gap-1 rounded bg-[#0B3B2E] px-2 py-0.5 text-[10px] font-bold text-white">{selectedRow.unitNo}</span>
                <span className="shrink-0 text-[10px] font-semibold text-slate-600 truncate max-w-[140px]" title={selectedRow.propertyName}>{selectedRow.propertyName}</span>
                <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${getAvailabilityTone(selectedRow.status)}`}>{selectedRow.statusLabel}</span>
                <span className="shrink-0 text-[10px] font-bold text-slate-700">{selectedRow.rentLabel}</span>
                <div className="mx-1 h-4 w-px shrink-0 bg-gray-300" />
                {canUpdateUnit && (
                  <button onClick={() => navigate(`/units/${selectedRow.id}`)} className={`h-7 shrink-0 flex items-center gap-1 rounded-md px-2 text-[10px] font-bold text-white shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}>
                    <FaUserEdit size={9} /> View Unit
                  </button>
                )}
                {selectedRow.status !== "owner_occupied" && (
                  selectedRow.tenantId ? (
                    <button onClick={() => navigate(`/tenant/${selectedRow.tenantId}/statement`, { state: { tabTitle: `${selectedRow.unitNo} Tenant` } })} className="h-7 shrink-0 flex items-center gap-1 rounded-md bg-slate-700 px-2 text-[10px] font-bold text-white shadow-sm hover:bg-slate-800">
                      <FaUserEdit size={9} /> Review Tenant
                    </button>
                  ) : canCreateTenant && (
                    <button
                      onClick={() => openTenantTakeOn(selectedRow)}
                      disabled={!["vacant", "reserved"].includes(selectedRow.status)}
                      className={`h-7 shrink-0 flex items-center gap-1 rounded-md px-2 text-[10px] font-bold text-white shadow-sm ${["vacant", "reserved"].includes(selectedRow.status) ? `${MILIK_ORANGE} ${MILIK_ORANGE_HOVER}` : "cursor-not-allowed bg-gray-400"}`}
                    >
                      <FaUserPlus size={9} /> {selectedRow.status === "reserved" ? "Complete Take-On" : "Add Tenant"}
                    </button>
                  )
                )}
                {canUpdateUnit && ["vacant", "notice_given"].includes(selectedRow.status) && (
                  <button onClick={() => handleReserve(selectedRow)} className="h-7 shrink-0 flex items-center gap-1 rounded-md bg-violet-600 px-2 text-[10px] font-bold text-white shadow-sm hover:bg-violet-700">
                    <FaTag size={9} /> Reserve
                  </button>
                )}
                {canUpdateUnit && ["vacant", "notice_given", "reserved"].includes(selectedRow.status) && (
                  <button onClick={() => handleMaintenance(selectedRow)} className="h-7 shrink-0 flex items-center gap-1 rounded-md bg-amber-600 px-2 text-[10px] font-bold text-white shadow-sm hover:bg-amber-700">
                    <FaWrench size={9} /> Maintenance
                  </button>
                )}
                {canUpdateUnit && ["reserved", "under_maintenance"].includes(selectedRow.status) && (
                  <button onClick={() => handleReady(selectedRow)} className="h-7 shrink-0 flex items-center gap-1 rounded-md bg-green-600 px-2 text-[10px] font-bold text-white shadow-sm hover:bg-green-700">
                    <FaCheckCircle size={9} /> Mark Ready
                  </button>
                )}
                {canUpdateUnit && selectedRow.status === "owner_occupied" ? (
                  <button onClick={() => handleReleaseOwner(selectedRow)} className="h-7 shrink-0 flex items-center gap-1 rounded-md bg-emerald-600 px-2 text-[10px] font-bold text-white shadow-sm hover:bg-emerald-700">
                    <FaUndo size={9} /> Release Unit
                  </button>
                ) : canUpdateUnit && (selectedRow.status === "off_market" ? (
                  <button onClick={() => handleRestore(selectedRow)} className="h-7 shrink-0 flex items-center gap-1 rounded-md bg-emerald-600 px-2 text-[10px] font-bold text-white shadow-sm hover:bg-emerald-700">
                    <FaUndo size={9} /> Restore
                  </button>
                ) : (
                  <>
                    <button onClick={() => handleOffMarket(selectedRow)} className="h-7 shrink-0 flex items-center gap-1 rounded-md bg-slate-600 px-2 text-[10px] font-bold text-white shadow-sm hover:bg-slate-700">
                      <FaArchive size={9} /> Off Market
                    </button>
                    <button onClick={() => handleOwnerOccupied(selectedRow)} className="h-7 shrink-0 flex items-center gap-1 rounded-md bg-pink-600 px-2 text-[10px] font-bold text-white shadow-sm hover:bg-pink-700">
                      Owner Occupied
                    </button>
                  </>
                ))}
                <button onClick={() => setSelectedRowId(null)} className="ml-auto h-7 shrink-0 flex items-center justify-center rounded border border-gray-300 px-2 text-[10px] font-bold text-slate-500 hover:bg-gray-100" title="Deselect">✕</button>
              </>
            ) : (
              <span className="text-[10px] text-slate-400 select-none">Click a row to reveal actions</span>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden px-2 pb-2">
          <div className="flex h-full min-h-0 flex-col rounded-lg border border-gray-200 bg-white shadow-sm">
            <MilikTable
              columns={[
                { label: 'Property', width: '130px' },
                { label: 'Unit No', width: '75px' },
                { label: 'Code', width: '75px' },
                { label: 'Unit Type', width: '105px' },
                { label: 'Availability', width: '110px' },
                { label: 'Current Tenant', width: '120px' },
                { label: 'Available From', width: '100px' },
                { label: 'Days', width: '70px', align: 'right' },
                { label: 'Rent', width: '90px', align: 'right' },
              ]}
              rows={currentRows}
              rowKey="id"
              loading={unitsLoading}
              empty={unitsLoading ? "Loading availability status..." : "No availability records found. Try adjusting the filters or add units to start tracking availability."}
              minWidth="980px"
              groupBy={(row) => row.propertyName}
              onRowClick={(row) => setSelectedRowId((prev) => (prev === row.id ? null : row.id))}
              isSelected={(row) => selectedRowId === row.id}
              renderRow={(row) => (
                <>
                  <td className="border-r border-gray-100 px-1.5 py-0.5 font-semibold text-slate-800">
                    <div className="truncate whitespace-nowrap" title={row.propertyName}>{row.propertyName}</div>
                  </td>
                  <td className="border-r border-gray-100 px-1.5 py-0.5 font-bold text-slate-900 whitespace-nowrap">{row.unitNo}</td>
                  <td className="border-r border-gray-100 px-1.5 py-0.5 font-medium text-slate-500 whitespace-nowrap">{row.unitCode}</td>
                  <td className="border-r border-gray-100 px-1.5 py-0.5">
                    <span className="inline-flex max-w-full truncate whitespace-nowrap rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-800">{row.unitTypeLabel}</span>
                  </td>
                  <td className="border-r border-gray-100 px-1.5 py-0.5">
                    <span className={`inline-flex max-w-full truncate whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${getAvailabilityTone(row.status)}`}>{row.statusLabel}</span>
                  </td>
                  <td className="border-r border-gray-100 px-1.5 py-0.5 text-slate-600">
                    <div className="truncate whitespace-nowrap" title={row.tenantName}>{row.tenantName}</div>
                  </td>
                  <td className="border-r border-gray-100 px-1.5 py-0.5 text-slate-600 whitespace-nowrap">{row.availableFromLabel}</td>
                  <td className="border-r border-gray-100 px-1.5 py-0.5 text-right font-bold text-slate-700 whitespace-nowrap">{row.daysVacantLabel}</td>
                  <td className="px-1.5 py-0.5 text-right font-bold text-slate-900 whitespace-nowrap">{row.rentLabel}</td>
                </>
              )}
              renderExpanded={(row) => (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
                  <div className="space-y-3 rounded-lg border-2 border-[#0B3B2E]/20 bg-white p-4 shadow-md">
                    <h4 className="border-b-2 border-[#0B3B2E] pb-2 text-sm font-black text-gray-900">🏢 Inventory Snapshot</h4>
                    <div>
                      <span className="text-[11px] font-black uppercase tracking-wide text-gray-700">Property</span>
                      <p className="mt-2 text-sm font-black text-gray-900">{row.propertyName}</p>
                    </div>
                    <div>
                      <span className="text-[11px] font-black uppercase tracking-wide text-gray-700">Unit / Space</span>
                      <p className="mt-2 text-sm font-black text-gray-900">{row.unitNo}</p>
                    </div>
                    <div>
                      <span className="text-[11px] font-black uppercase tracking-wide text-gray-700">Unit Type</span>
                      <p className="mt-2 text-sm font-black text-gray-900">{row.unitTypeLabel}</p>
                    </div>
                  </div>

                  <div className="space-y-3 rounded-lg border-2 border-orange-200 bg-white p-4 shadow-md">
                    <h4 className="border-b-2 border-[#FF8C00] pb-2 text-sm font-black text-gray-900">📍 Availability Details</h4>
                    <div>
                      <span className="text-[11px] font-black uppercase tracking-wide text-gray-700">Availability Status</span>
                      <p className="mt-2 text-sm font-black text-gray-900">{row.statusLabel}</p>
                    </div>
                    <div>
                      <span className="text-[11px] font-black uppercase tracking-wide text-gray-700">Available From</span>
                      <p className="mt-2 text-sm font-black text-gray-900">{row.availableFromLabel}</p>
                    </div>
                    <div>
                      <span className="text-[11px] font-black uppercase tracking-wide text-gray-700">Days Vacant</span>
                      <p className="mt-2 text-sm font-black text-gray-900">{row.daysVacantLabel}</p>
                    </div>
                  </div>

                  <div className="space-y-3 rounded-lg border-2 border-blue-200 bg-white p-4 shadow-md">
                    <h4 className="border-b-2 border-blue-600 pb-2 text-sm font-black text-gray-900">👥 Occupancy Context</h4>
                    <div>
                      <span className="text-[11px] font-black uppercase tracking-wide text-gray-700">Current Tenant</span>
                      <p className="mt-2 text-sm font-black text-gray-900">{row.tenantName}</p>
                    </div>
                    <div>
                      <span className="text-[11px] font-black uppercase tracking-wide text-gray-700">Move-out Date</span>
                      <p className="mt-2 text-sm font-black text-gray-900">{fmtDate(row.moveOutDate)}</p>
                    </div>
                    <div>
                      <span className="text-[11px] font-black uppercase tracking-wide text-gray-700">Operational Notes</span>
                      <p className="mt-2 text-sm font-black text-gray-900">{row.notes}</p>
                    </div>
                  </div>

                  <div className="space-y-3 rounded-lg border-2 border-green-200 bg-white p-4 shadow-md">
                    <h4 className="border-b-2 border-green-600 pb-2 text-sm font-black text-gray-900">💰 Letting Snapshot</h4>
                    <div>
                      <span className="text-[11px] font-black uppercase tracking-wide text-gray-700">Monthly Rent</span>
                      <p className="mt-2 text-sm font-black text-gray-900">{row.rentLabel}</p>
                    </div>
                    <div>
                      <span className="text-[11px] font-black uppercase tracking-wide text-gray-700">Unit Code</span>
                      <p className="mt-2 text-sm font-black text-gray-900">{row.unitCode}</p>
                    </div>
                    <div>
                      <span className="text-[11px] font-black uppercase tracking-wide text-gray-700">Open Maintenance</span>
                      <p className="mt-2 text-sm font-black text-gray-900">{row.maintenanceCount}</p>
                    </div>
                  </div>
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
              loading={unitsLoading}
              label="units"
            />
          </div>
        </div>

        <MilikConfirmDialog
          isOpen={confirmDialog.isOpen}
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmText={confirmDialog.confirmText}
          isDangerous={confirmDialog.isDangerous}
          onCancel={() => setConfirmDialog((prev) => ({ ...prev, isOpen: false }))}
          onConfirm={confirmDialog.onConfirm}
        />
      </div>
    </DashboardLayout>
  );
};

export default Vacants;