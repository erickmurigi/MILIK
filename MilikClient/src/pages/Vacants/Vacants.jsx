// pages/Vacants/Vacants.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "../../components/Layout/DashboardLayout";
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
  FaHome,
  FaBuilding,
  FaCalendarAlt,
  FaTools,
  FaUserPlus,
  FaUserEdit,
  FaWrench,
  FaArchive,
  FaUndo,
  FaCheckCircle,
  FaClock,
  FaTag,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { getUnits, updateUnit } from "../../redux/unitRedux";
import { getProperties } from "../../redux/propertyRedux";
import { getTenants } from "../../redux/tenantsRedux";
import { getMaintenances } from "../../redux/apiCalls";
import { selectCurrentCompany, selectCurrentUser, selectAllProperties, selectAllTenants, selectAllMaintenances } from "../../redux/selectors";
import { hasCompanyPermission } from "../../utils/permissions";
import MilikConfirmDialog from "../../components/Modals/MilikConfirmDialog";
import { printTabularList } from "../../utils/printList";

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";
const MILIK_ORANGE = "bg-[#FF8C00]";
const MILIK_ORANGE_HOVER = "hover:bg-[#e67e00]";
const ITEMS_PER_PAGE = 50;
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

const formatDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString();
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
    case "occupied":
      return "bg-emerald-100 text-emerald-800 border border-emerald-300";
    case "vacant":
      return "bg-orange-100 text-orange-800 border border-orange-300";
    case "notice_given":
      return "bg-blue-100 text-blue-800 border border-blue-300";
    case "reserved":
      return "bg-violet-100 text-violet-800 border border-violet-300";
    case "under_maintenance":
      return "bg-amber-100 text-amber-800 border border-amber-300";
    case "off_market":
      return "bg-slate-200 text-slate-700 border border-slate-300";
    default:
      return "bg-gray-100 text-gray-700 border border-gray-300";
  }
};

const getAvailabilityLabel = (status) => {
  switch (status) {
    case "occupied":
      return "Occupied";
    case "vacant":
      return "Vacant";
    case "notice_given":
      return "Notice Given";
    case "reserved":
      return "Reserved";
    case "under_maintenance":
      return "Under Maintenance";
    case "off_market":
      return "Off Market";
    default:
      return "Unknown";
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

  const units = useSelector((state) => state.unit?.units || []);
  const unitsLoading = useSelector((state) => state.unit?.isFetching || false);
  const properties = useSelector(selectAllProperties);
  const tenants = useSelector(selectAllTenants);
  const maintenances = useSelector(selectAllMaintenances);

  const [currentPage, setCurrentPage] = useState(1);
  const [expandedRows, setExpandedRows] = useState([]);
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

  const [draftFilters, setDraftFilters] = useState(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState(emptyFilters);

  useEffect(() => {
    if (!currentCompany?._id) return;
    dispatch(getUnits({ business: currentCompany._id }));
    dispatch(getProperties({ business: currentCompany._id }));
    dispatch(getTenants({ business: currentCompany._id }));
    getMaintenances(dispatch, currentCompany._id).catch(() => {
      // keep page usable even if maintenance fetch fails
    });
  }, [dispatch, currentCompany]);

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
    return (Array.isArray(units) ? units : []).map((unit, index) => {
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
        notes.push(`Move-out scheduled for ${formatDate(currentTenant.moveOutDate)}`);
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
      if (availabilityStatus === "vacant" && daysVacant !== null) {
        notes.push(`Vacant for ${daysVacant} day${daysVacant === 1 ? "" : "s"}`);
      }

      const first2Letters = propertyName.substring(0, 2).toUpperCase();
      const unitIndexInProperty = (Array.isArray(units) ? units : []).reduce((count, item, itemIndex) => {
        const itemPropertyObj = typeof item?.property === "string"
          ? properties.find((p) => normalizeId(p?._id) === normalizeId(item?.property))
          : item?.property;
        const itemPropertyId = normalizeId(itemPropertyObj?._id || item?.property);
        return itemIndex < index && itemPropertyId === propertyId ? count + 1 : count;
      }, 0) + 1;

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
        availableFromLabel: formatDate(availableFrom),
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
        if (row.status !== "off_market") acc.rentable += 1;
        if (row.status === "occupied") acc.occupied += 1;
        if (row.status === "vacant") acc.vacant += 1;
        if (row.status === "notice_given") acc.notice += 1;
        if (row.status === "reserved") acc.reserved += 1;
        if (row.status === "under_maintenance") acc.maintenance += 1;
        if (row.status === "off_market") acc.offMarket += 1;
        return acc;
      },
      { total: 0, rentable: 0, occupied: 0, vacant: 0, notice: 0, reserved: 0, maintenance: 0, offMarket: 0 }
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
            return acc;
          },
          { total: 0, occupied: 0, vacant: 0, notice: 0, reserved: 0, maintenance: 0, offMarket: 0 }
        );

        return {
          ...group,
          counts,
        };
      })
      .sort((a, b) => String(a.propertyName).localeCompare(String(b.propertyName)));
  }, [filteredRows]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / ITEMS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentRows = filteredRows.slice(startIndex, endIndex);

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
  };

  const applySearch = () => {
    setAppliedFilters({
      ...draftFilters,
      search: draftFilters.search.trim(),
      tenant: draftFilters.tenant.trim(),
    });
    setExpandedRows([]);
  };

  const resetFilters = () => {
    setDraftFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    setExpandedRows([]);
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
    </div>
  );

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gray-50 p-0">
        <div className="flex-none sticky top-0 z-30 border-b border-gray-100 bg-white shadow-sm">
          <div className="filter-bar flex items-center gap-1.5 overflow-x-auto px-2 py-1.5">
            <button onClick={applySearch} className={`h-7 shrink-0 flex items-center gap-1 rounded-md px-2.5 text-[10px] font-bold text-white shadow-sm ${MILIK_ORANGE} ${MILIK_ORANGE_HOVER}`}><FaSearch size={9} /></button>
            <button onClick={resetFilters} className={`h-7 shrink-0 flex items-center gap-1 rounded-md px-2 text-[10px] font-bold text-white shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}><FaRedoAlt size={9} /></button>
            <button onClick={allExpanded ? collapseAll : expandAll} disabled={!currentRows.length} className={`h-7 shrink-0 flex items-center gap-1 rounded-md px-2 text-[10px] font-bold text-white shadow-sm ${currentRows.length ? (allExpanded ? "bg-orange-600 hover:bg-orange-700" : `${MILIK_GREEN} ${MILIK_GREEN_HOVER}`) : "cursor-not-allowed bg-gray-400"}`}>{allExpanded ? <FaCompressAlt size={9} /> : <FaExpandAlt size={9} />}</button>
            <div className="mx-1 h-4 w-px shrink-0 bg-gray-300" />
            {canCreateTenant && <button onClick={() => navigate("/tenant/new")} className={`h-7 shrink-0 flex items-center gap-1 rounded-md px-2 text-[10px] font-bold text-white shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}><FaUserPlus size={9} /> Add Tenant</button>}
            {canCreateUnit && <button onClick={() => navigate("/units/new")} className={`h-7 shrink-0 flex items-center gap-1 rounded-md px-2 text-[10px] font-bold text-white shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}><FaPlus size={9} /> Add Unit</button>}
            <div className="mx-1 h-4 w-px shrink-0 bg-gray-300" />
            <button onClick={handlePrint} className="h-7 shrink-0 flex items-center gap-1 rounded-md bg-slate-700 px-2 text-[10px] font-bold text-white shadow-sm hover:bg-slate-800"><FaPrint size={9} /></button>
            <button onClick={handleExport} className="h-7 shrink-0 flex items-center gap-1 rounded-md border border-gray-300 px-2 text-[10px] font-bold shadow-sm hover:bg-gray-50"><FaFileExport size={9} /></button>
            <div className="mx-1 h-4 w-px shrink-0 bg-gray-300" />
            <select value={draftFilters.property} onChange={(event) => setDraftFilters((prev) => ({ ...prev, property: event.target.value }))} className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-[11px] text-gray-800 appearance-none focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]">
              {uniqueProperties.map((property) => (<option key={property.value} value={property.value}>{property.label}</option>))}
            </select>
            <select value={draftFilters.status} onChange={(event) => setDraftFilters((prev) => ({ ...prev, status: event.target.value }))} className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-[11px] text-gray-800 appearance-none focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]">
              <option value="any">Status</option>
              <option value="occupied">Occupied</option>
              <option value="vacant">Vacant</option>
              <option value="notice_given">Notice Given</option>
              <option value="reserved">Reserved</option>
              <option value="under_maintenance">Under Maintenance</option>
              <option value="off_market">Off Market</option>
            </select>
            <select value={draftFilters.unitType} onChange={(event) => setDraftFilters((prev) => ({ ...prev, unitType: event.target.value }))} className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-[11px] text-gray-800 appearance-none focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]">
              <option value="any">Unit Type</option>
              {unitTypeOptions.map((type) => (<option key={type} value={type}>{formatUnitTypeLabel(type)}</option>))}
            </select>
            <select value={draftFilters.window} onChange={(event) => setDraftFilters((prev) => ({ ...prev, window: event.target.value }))} className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-[11px] text-gray-800 appearance-none focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]">
              <option value="all">Availability</option>
              <option value="now">Available Now</option>
              <option value="next7">In 7 Days</option>
              <option value="next30">In 30 Days</option>
            </select>
            <div className="mx-1 h-4 w-px shrink-0 bg-gray-300" />
            <input value={draftFilters.search} onChange={(event) => setDraftFilters((prev) => ({ ...prev, search: event.target.value }))} onKeyDown={handleFilterEnter} placeholder="Search…" className="h-7 w-36 shrink-0 rounded border border-gray-300 bg-white px-2 text-[11px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
            <input value={draftFilters.tenant} onChange={(event) => setDraftFilters((prev) => ({ ...prev, tenant: event.target.value }))} onKeyDown={handleFilterEnter} placeholder="Tenant" className="h-7 w-24 shrink-0 rounded border border-gray-300 bg-white px-2 text-[11px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden px-2 pb-2">
          <div className="flex h-full min-h-0 flex-col rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 bg-white px-3 py-3">
              <div className="grid grid-cols-3 gap-1.5 md:grid-cols-6">
                {[
                  { label: "Rentable Units", value: summary.rentable, tone: "bg-emerald-50 border border-emerald-200 text-emerald-900", icon: <FaBuilding className="text-emerald-700" /> },
                  { label: "Vacant", value: summary.vacant, tone: "bg-orange-50 border border-orange-200 text-orange-900", icon: <FaHome className="text-orange-700" /> },
                  { label: "Notice Given", value: summary.notice, tone: "bg-blue-50 border border-blue-200 text-blue-900", icon: <FaClock className="text-blue-700" /> },
                  { label: "Reserved", value: summary.reserved, tone: "bg-violet-50 border border-violet-200 text-violet-900", icon: <FaTag className="text-violet-700" /> },
                  { label: "Maintenance", value: summary.maintenance, tone: "bg-amber-50 border border-amber-200 text-amber-900", icon: <FaTools className="text-amber-700" /> },
                  { label: "Occupancy Rate", value: `${summary.occupancyRate}%`, tone: "bg-slate-50 border border-slate-200 text-slate-900", icon: <FaCheckCircle className="text-[#0B3B2E]" /> },
                ].map((card) => (
                  <div key={card.label} className={`rounded-md px-2 py-1 ${card.tone}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.18em]">{card.label}</div>
                        <div className="mt-0.5 text-[13px] font-black">{card.value}</div>
                      </div>
                      <div className="hidden rounded-full bg-white/80 p-1 shadow-sm">{card.icon}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[1180px] border-collapse bg-white text-[11px]" style={{ tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: "42px" }} />
                  <col style={{ width: "120px" }} />
                  <col style={{ width: "85px" }} />
                  <col style={{ width: "80px" }} />
                  <col style={{ width: "105px" }} />
                  <col style={{ width: "115px" }} />
                  <col style={{ width: "105px" }} />
                  <col style={{ width: "105px" }} />
                  <col style={{ width: "75px" }} />
                  <col style={{ width: "85px" }} />
                  <col style={{ width: "180px" }} />
                </colgroup>
                <thead className="sticky top-0 z-10 shadow-sm">
                  <tr className="border-b border-gray-300 bg-[#0B3B2E]">
                    <th className="border-r border-white/10 px-1 py-1.5 text-center font-bold text-white"></th>
                    <th className="sticky left-[42px] z-20 border-r border-white/10 bg-[#0B3B2E] px-1.5 py-1 text-left font-bold text-white whitespace-nowrap">Property</th>
                    <th className="border-r border-white/10 px-1.5 py-1 text-left font-bold text-white whitespace-nowrap">Unit No</th>
                    <th className="border-r border-white/10 px-1.5 py-1 text-left font-bold text-white whitespace-nowrap">Code</th>
                    <th className="border-r border-white/10 px-1.5 py-1 text-left font-bold text-white whitespace-nowrap">Unit Type</th>
                    <th className="border-r border-white/10 px-1.5 py-1 text-left font-bold text-white whitespace-nowrap">Availability</th>
                    <th className="border-r border-white/10 px-1.5 py-1 text-left font-bold text-white whitespace-nowrap">Current Tenant</th>
                    <th className="border-r border-white/10 px-1.5 py-1 text-left font-bold text-white whitespace-nowrap">Available From</th>
                    <th className="border-r border-white/10 px-1.5 py-1 text-right font-bold text-white whitespace-nowrap">Days Vacant</th>
                    <th className="border-r border-white/10 px-1.5 py-1 text-right font-bold text-white whitespace-nowrap">Rent</th>
                    <th className="px-1.5 py-1 text-left font-bold text-white whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {currentRows.length > 0 ? (
                    currentRows.map((row, index) => {
                      const isFirstInProperty = index === 0 || currentRows[index - 1].propertyId !== row.propertyId;
                      const group = groupedRows.find((item) => item.propertyId === row.propertyId);
                      const canAddTenant = ["vacant", "reserved"].includes(row.status);
                      const isExpanded = expandedRows.includes(row.id);

                      return (
                        <React.Fragment key={row.id}>
                          {isFirstInProperty && group && (
                            <tr className="bg-[#eef5f1]">
                              <td colSpan={11} className="border-b border-t border-[#d7e6df] px-3 py-2">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <div>
                                    <div className="text-sm font-black uppercase tracking-[0.18em] text-[#0B3B2E]">
                                      {group.propertyCode ? `${group.propertyCode} • ${group.propertyName}` : group.propertyName}
                                    </div>
                                    <div className="mt-1 text-[11px] font-semibold text-slate-600">
                                      {group.counts.total} unit(s) in current result set
                                    </div>
                                  </div>
                                  {renderPropertySummary(group)}
                                </div>
                              </td>
                            </tr>
                          )}

                          <tr className={`border-b border-gray-100 transition-colors hover:bg-blue-50/40 ${isExpanded ? "bg-[#fcfdfc]" : "bg-white"}`}>
                            <td className="border-r border-gray-100 px-1 py-1.5 text-center align-top">
                              <button
                                onClick={() => toggleRow(row.id)}
                                className="rounded border border-gray-300 bg-white p-1 text-slate-600 transition-colors hover:bg-gray-50"
                                title={isExpanded ? "Collapse" : "Expand"}
                              >
                                {isExpanded ? <FaChevronUp size={10} /> : <FaChevronDown size={10} />}
                              </button>
                            </td>
                            <td className="border-r border-gray-100 px-1.5 py-1 align-top font-bold text-slate-800">
                              <div className="truncate whitespace-nowrap" title={row.propertyName}>
                                {row.propertyName}
                              </div>
                            </td>
                            <td className="border-r border-gray-100 px-1.5 py-1 align-top font-bold text-slate-900 whitespace-nowrap">
                              {row.unitNo}
                            </td>
                            <td className="border-r border-gray-100 px-1.5 py-1 align-top font-semibold text-slate-600 whitespace-nowrap">
                              {row.unitCode}
                            </td>
                            <td className="border-r border-gray-100 px-1.5 py-1 align-top">
                              <span className="inline-flex max-w-full truncate whitespace-nowrap rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-800">
                                {row.unitTypeLabel}
                              </span>
                            </td>
                            <td className="border-r border-gray-100 px-1.5 py-1 align-top">
                              <span className={`inline-flex max-w-full truncate whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${getAvailabilityTone(row.status)}`}>
                                {row.statusLabel}
                              </span>
                            </td>
                            <td className="border-r border-gray-100 px-1.5 py-1 align-top font-semibold text-slate-700">
                              <div className="truncate whitespace-nowrap" title={row.tenantName}>
                                {row.tenantName}
                              </div>
                            </td>
                            <td className="border-r border-gray-100 px-1.5 py-1 align-top font-semibold text-slate-700 whitespace-nowrap">
                              {row.availableFromLabel}
                            </td>
                            <td className="border-r border-gray-100 px-1.5 py-1 text-right align-top font-bold text-slate-700 whitespace-nowrap">
                              {row.daysVacantLabel}
                            </td>
                            <td className="border-r border-gray-100 px-1.5 py-1 text-right align-top font-bold text-slate-900 whitespace-nowrap">
                              {row.rentLabel}
                            </td>
                            <td className="px-1.5 py-1 align-top">
                              <div className="flex min-w-0 flex-wrap gap-1.5">
                                {canUpdateUnit && (
                                  <button
                                    onClick={() => navigate(`/units/${row.id}`)}
                                    className={`flex items-center gap-1 whitespace-nowrap rounded-lg px-1.5 py-0.5 text-[10px] text-white shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
                                  >
                                    <FaUserEdit size={10} />
                                    View Unit
                                  </button>
                                )}

                                {row.tenantId ? (
                                  <button
                                    onClick={() => navigate(`/tenant/${row.tenantId}/statement`, { state: { tabTitle: `${row.unitNo} Tenant` } })}
                                    className="flex items-center gap-1 whitespace-nowrap rounded-lg bg-slate-700 px-1.5 py-0.5 text-[10px] text-white shadow-sm transition-colors hover:bg-slate-800"
                                  >
                                    <FaUserEdit size={10} />
                                    Review Tenant
                                  </button>
                                ) : canCreateTenant && (
                                  <button
                                    onClick={() => openTenantTakeOn(row)}
                                    disabled={!canAddTenant}
                                    className={`flex items-center gap-1 whitespace-nowrap rounded-lg px-1.5 py-0.5 text-[10px] text-white shadow-sm ${
                                      canAddTenant ? `${MILIK_ORANGE} ${MILIK_ORANGE_HOVER}` : "cursor-not-allowed bg-gray-400"
                                    }`}
                                  >
                                    <FaUserPlus size={10} />
                                    {row.status === "reserved" ? "Complete Take-On" : "Add Tenant"}
                                  </button>
                                )}

                                {canUpdateUnit && ["vacant", "notice_given"].includes(row.status) && (
                                  <button
                                    onClick={() => handleReserve(row)}
                                    className="flex items-center gap-1 whitespace-nowrap rounded-lg bg-violet-600 px-1.5 py-0.5 text-[10px] text-white shadow-sm transition-colors hover:bg-violet-700"
                                  >
                                    <FaTag size={10} />
                                    Reserve
                                  </button>
                                )}

                                {canUpdateUnit && ["vacant", "notice_given", "reserved"].includes(row.status) && (
                                  <button
                                    onClick={() => handleMaintenance(row)}
                                    className="flex items-center gap-1 whitespace-nowrap rounded-lg bg-amber-600 px-1.5 py-0.5 text-[10px] text-white shadow-sm transition-colors hover:bg-amber-700"
                                  >
                                    <FaWrench size={10} />
                                    Maintenance
                                  </button>
                                )}

                                {canUpdateUnit && (row.status === "off_market" ? (
                                  <button
                                    onClick={() => handleRestore(row)}
                                    className="flex items-center gap-1 whitespace-nowrap rounded-lg bg-emerald-600 px-1.5 py-0.5 text-[10px] text-white shadow-sm transition-colors hover:bg-emerald-700"
                                  >
                                    <FaUndo size={10} />
                                    Restore
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handleOffMarket(row)}
                                    className="flex items-center gap-1 whitespace-nowrap rounded-lg bg-slate-600 px-1.5 py-0.5 text-[10px] text-white shadow-sm transition-colors hover:bg-slate-700"
                                  >
                                    <FaArchive size={10} />
                                    Off Market
                                  </button>
                                ))}

                                {canUpdateUnit && ["reserved", "under_maintenance"].includes(row.status) && (
                                  <button
                                    onClick={() => handleReady(row)}
                                    className="flex items-center gap-1 whitespace-nowrap rounded-lg bg-green-600 px-1.5 py-0.5 text-[10px] text-white shadow-sm transition-colors hover:bg-green-700"
                                  >
                                    <FaCheckCircle size={10} />
                                    Mark Ready
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>

                          {isExpanded && (
                            <tr className="bg-[#f9fbfa]">
                              <td colSpan={11} className="px-3 py-3">
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
                                      <p className="mt-2 text-sm font-black text-gray-900">{formatDate(row.moveOutDate)}</p>
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
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={11} className="px-4 py-10 text-center">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <div className="text-lg font-bold text-slate-400">No availability records found</div>
                          <div className="text-sm text-slate-500">
                            {unitsLoading ? "Loading availability status..." : "Try adjusting the filters or add units to start tracking availability."}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="sticky bottom-0 z-20 flex-shrink-0 border-t border-gray-200 bg-white shadow-sm">
              <div className="flex items-center justify-between px-3 py-1">
                <div className="text-[11px] text-gray-600">
                  <div className="flex items-center gap-4">
                    <span className="font-bold">
                      Showing <span className="font-bold text-slate-900">{currentRows.length > 0 ? startIndex + 1 : 0}</span> to <span className="font-bold text-slate-900">{Math.min(endIndex, filteredRows.length)}</span> of <span className="font-bold text-slate-900">{filteredRows.length}</span> unit(s) across <span className="font-bold text-slate-900">{groupedRows.length}</span> propert{groupedRows.length === 1 ? "y" : "ies"}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-[11px] text-slate-500">
                  <button
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    disabled={safeCurrentPage === 1}
                    className="flex items-center gap-1 rounded border border-gray-300 px-2.5 py-0.5 text-[11px] font-bold transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <FaChevronLeft size={10} />
                    Previous
                  </button>

                  <div className="flex items-center gap-1">
                    {[...Array(totalPages)].map((_, index) => {
                      const page = index + 1;
                      if (page === 1 || page === totalPages || (page >= safeCurrentPage - 1 && page <= safeCurrentPage + 1)) {
                        return (
                          <button
                            key={page}
                            onClick={() => setCurrentPage(page)}
                            className={`min-w-[24px] rounded border px-2 py-0.5 text-[11px] font-bold transition-colors ${
                              safeCurrentPage === page
                                ? "border-[#0B3B2E] bg-[#0B3B2E] text-white hover:bg-[#0A3127]"
                                : "border-gray-300 hover:bg-gray-50"
                            }`}
                          >
                            {page}
                          </button>
                        );
                      }
                      if (page === safeCurrentPage - 2 || page === safeCurrentPage + 2) {
                        return <span key={page} className="px-1 text-[11px] text-gray-400">...</span>;
                      }
                      return null;
                    })}
                  </div>

                  <button
                    onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={safeCurrentPage === totalPages}
                    className="flex items-center gap-1 rounded border border-gray-300 px-2.5 py-0.5 text-[11px] font-bold transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                    <FaChevronRight size={10} />
                  </button>
                </div>
              </div>
            </div>
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