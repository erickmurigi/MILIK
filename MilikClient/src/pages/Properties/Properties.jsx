// pages/Properties.js
import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useNavigate } from "react-router-dom";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import AppSelect from "../../components/common/AppSelect";
import {
  FaPlus,
  FaSearch,
  FaEdit,
  FaTrash,
  FaEye,
  FaFileExport,
  FaChevronDown,
  FaChevronUp,
  FaBuilding,
  FaRedoAlt,
  FaArchive,
  FaUndo,
  FaExpandAlt,
  FaCompressAlt,
  FaFileImport,
  FaPrint,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { getProperties, deleteProperty, archiveProperty, restoreProperty } from "../../redux/propertyRedux";
import { getLandlords } from "../../redux/apiCalls";
import { selectCurrentCompany, selectCurrentUser, selectAllLandlords, selectAllProperties, selectPropertyPagination, selectPropertyError } from "../../redux/selectors";
import { hasCompanyPermission } from "../../utils/permissions";
import MilikConfirmDialog from "../../components/Modals/MilikConfirmDialog";
import ImportModal from "../../components/Modals/ImportModal";
import { downloadPropertiesTemplate, exportPropertiesToExcel, parsePropertiesExcel } from "../../utils/excelTemplates";
import { adminRequests, getErrorMessage } from "../../utils/requestMethods";
import { printTabularList } from "../../utils/printList";
import { useTerm } from "../../hooks/useTerm";
import { normalizeUppercaseInput, toListingCaps } from "../../utils/listingPageUtils";
import { useTabState } from "../../hooks/useTabState";
import { fmtDate } from "../../utils/dates";
import PaginationBar from '../../components/PaginationBar';
import MilikTable from '../../components/common/MilikTable';
import ListToolbar from '../../components/common/ListToolbar';

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";
const MILIK_ORANGE = "bg-[#FF8C00]";
const MILIK_ORANGE_HOVER = "hover:bg-[#e67e00]";

const emptyFilters = {
  status: "active",
  zone: "",
  category: "",
  code: "",
  name: "",
  lr: "",
  landlord: "",
  location: "",
};

const getPrimaryLandlord = (landlords) => {
  if (!landlords || landlords.length === 0) return "N/A";
  const primary = landlords.find((l) => l.isPrimary) || landlords[0];
  return primary?.name || primary?.landlordId?.landlordName || primary?.landlordId?.fullName || primary?.landlordId?.name || "N/A";
};

const getFullAddress = (property) => {
  const parts = [property.roadStreet, property.estateArea, property.townCityState].filter(
    (p) => p && String(p).trim() !== ""
  );
  return parts.join(", ") || property.address || "N/A";
};

const getStatusColor = (status) => {
  switch (status) {
    case "active": return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "maintenance": return "bg-amber-50 text-amber-700 border-amber-200";
    case "closed": return "bg-red-50 text-red-700 border-red-200";
    default: return "bg-slate-100 text-slate-600 border-slate-200";
  }
};

const getCategoryColor = (category) => {
  switch (category?.toLowerCase()) {
    case "residential": return "bg-blue-50 text-blue-700 border-blue-200";
    case "commercial": return "bg-purple-50 text-purple-700 border-purple-200";
    case "mixed use": return "bg-amber-50 text-amber-700 border-amber-200";
    default: return "bg-slate-100 text-slate-600 border-slate-200";
  }
};

// Module-scope helper — avoids creating an IIFE on every row render
const getLedgerBadge = (property) => {
  const v = String(property.accountLedgerType || "").toLowerCase();
  return v.startsWith("off") || v === "property-gl";
};

const Properties = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const termProperties = useTerm("properties");
  const termProperty = useTerm("property");
  const termLandlord = useTerm("landlord");
  const termLandlords = useTerm("landlords");
  const termUnits = useTerm("units");
  const termInvoice = useTerm("invoice");

  // Redux state
  const properties = useSelector(selectAllProperties);
  const pagination = useSelector(selectPropertyPagination);
  const error      = useSelector(selectPropertyError);
  const landlords  = useSelector(selectAllLandlords);
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);

  const { canCreateProperty, canUpdateProperty, canDeleteProperty } = useMemo(() => ({
    canCreateProperty: hasCompanyPermission(currentUser || {}, currentCompany, "properties", "create", "propertyManagement"),
    canUpdateProperty: hasCompanyPermission(currentUser || {}, currentCompany, "properties", "update", "propertyManagement"),
    canDeleteProperty: hasCompanyPermission(currentUser || {}, currentCompany, "properties", "delete", "propertyManagement"),
  }), [currentUser, currentCompany]);

  // Produce { value, label } directly so the JSX prop needs no extra .map()
  const landlordOptions = useMemo(() =>
    landlords.map(l => ({ value: l._id || l.id || "", label: l.fullName || l.name || l.landlordName || "Unnamed" })),
  [landlords]);

  // Pagination
  const [pageSize, setPageSize] = useTabState("/properties:pageSize", 50);
  const [currentPage, setCurrentPage] = useTabState("/properties:currentPage", 1);

  // Selection + table UI
  const [selectedProperties, setSelectedProperties] = useState([]);
  const [selectAll, setSelectAll] = useState(false);
  const [zoneOptions, setZoneOptions] = useState([]);
  const [expandedRows, setExpandedRows] = useState(new Set()); // property ids currently expanded — Set, matches MilikTable's expandedKeys shape
  const [isResizing, setIsResizing] = useState(false);

  // Dropdown (Archive/Restore placeholder)
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const actionMenuBtnRef = useRef(null);

  // Import modal
  const [showImportModal, setShowImportModal] = useState(false);

  // Filters
  const [appliedFilters, setAppliedFilters] = useTabState("/properties:appliedFilters", emptyFilters);
  const [draftFilters, setDraftFilters] = useState(appliedFilters);

  // Milik Confirm Dialog
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    title: "",
    message: "",
    confirmText: "Confirm",
    isDangerous: false,
    onConfirm: null,
  });

  // Close dropdown on outside click
  // Load landlords and zones on mount
  useEffect(() => {
    if (currentCompany?._id) {
      dispatch(getLandlords({ company: currentCompany._id, limit: 500 }));
    }
  }, [dispatch, currentCompany?._id]);

  useEffect(() => {
    adminRequests.get('/zones', { params: { limit: 500, isActive: 'true' } })
      .then((res) => setZoneOptions(
        (res.data?.zones || []).map((z) => ({ value: z.name, label: z.name }))
      ))
      .catch(() => {});
  }, []);

  // Keep selectAll off when page changes
  useEffect(() => {
    setSelectAll(false);
  }, [currentPage]);

  // Apply search (button)
  const applySearch = useCallback(() => {
    setAppliedFilters({
      ...draftFilters,
      code: draftFilters.code.trim(),
      name: draftFilters.name.trim(),
      lr: draftFilters.lr.trim(),
      landlord: draftFilters.landlord.trim(),
      location: draftFilters.location.trim(),
    });
    setCurrentPage(1);
    setSelectedProperties([]);
    setSelectAll(false);
    setActionMenuOpen(false);
    setExpandedRows([]);
  }, [draftFilters, setAppliedFilters, setCurrentPage]);

  const resetFilters = useCallback(() => {
    setDraftFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    setCurrentPage(1);
    setSelectedProperties([]);
    setSelectAll(false);
    setExpandedRows([]);
    setActionMenuOpen(false);
  }, [setAppliedFilters, setCurrentPage]);

  const onFilterEnter = useCallback((e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applySearch();
    }
  }, [applySearch]);

  // Fetch properties when applied filters or page changes
  useEffect(() => {
    if (!currentCompany?._id) return;

    const params = {
      page: currentPage,
      limit: pageSize,
      search: "",
      status: appliedFilters.status,
      zone: appliedFilters.zone,
      category: appliedFilters.category,
      code: appliedFilters.code,
      name: appliedFilters.name,
      lrNumber: appliedFilters.lr,
      landlord: appliedFilters.landlord,
      location: appliedFilters.location,
    };

    dispatch(getProperties(params));
  }, [dispatch, currentPage, pageSize, appliedFilters, currentCompany?._id]);

  // Show error toast
  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  // Selection
  const handleSelectProperty = useCallback((id) => {
    setSelectedProperties((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectAll) {
      setSelectedProperties([]);
      setSelectAll(false);
    } else {
      setSelectedProperties((properties || []).map((p) => p._id));
      setSelectAll(true);
    }
  }, [selectAll, properties]);

  // Expand all rows
  const expandAllRows = useCallback(() => {
    if (properties && properties.length > 0) {
      setExpandedRows(new Set(properties.map((p) => p._id)));
    }
  }, [properties]);

  // Collapse all rows
  const collapseAllRows = useCallback(() => {
    setExpandedRows(new Set());
  }, []);

  // Check if all rows are expanded
  const allRowsExpanded = useMemo(
    () => properties && properties.length > 0 && properties.every((p) => expandedRows.has(p._id)),
    [properties, expandedRows]
  );

  const buildFetchParams = useCallback(() => ({
    page: currentPage,
    limit: pageSize,
    search: "",
    status: appliedFilters.status,
    zone: appliedFilters.zone,
    category: appliedFilters.category,
    code: appliedFilters.code,
    name: appliedFilters.name,
    lrNumber: appliedFilters.lr,
    landlord: appliedFilters.landlord,
    location: appliedFilters.location,
  }), [currentPage, pageSize, appliedFilters]);

  // Delete
  const handleDelete = (propertyId) => {
    setConfirmDialog({
      isOpen: true,
      title: `Delete ${termProperty}`,
      message: `Delete this ${termProperty.toLowerCase()}? If it has operational or accounting history, MILIK will archive it safely instead.`,
      confirmText: "Delete",
      isDangerous: true,
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        try {
          const result = await dispatch(deleteProperty(propertyId)).unwrap();
          toast.success(result?.message || `${termProperty} deleted successfully.`);
          dispatch(getProperties(buildFetchParams()));
        } catch (err) {
          toast.error(typeof err === 'string' ? err : getErrorMessage(err, `Failed to delete ${termProperty.toLowerCase()}`));
        }
      },
    });
  };

  const handleBulkDelete = async () => {
    if (selectedProperties.length === 0) {
      toast.error(`No ${termProperties.toLowerCase()} selected`);
      return;
    }

    setConfirmDialog({
      isOpen: true,
      title: `Delete ${termProperties}`,
      message: `Are you sure you want to delete ${selectedProperties.length} ${termProperties.toLowerCase()}? Unused ${termProperties.toLowerCase()} will be deleted permanently, but ${termProperties.toLowerCase()} with operational or accounting history will be archived safely instead.`,
      confirmText: "Delete",
      isDangerous: true,
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        setSelectedProperties([]);
        setSelectAll(false);
        const idsToDelete = [...selectedProperties];
        const results = await Promise.allSettled(
          idsToDelete.map((id) => dispatch(deleteProperty(id)).unwrap())
        );
        let deletedCount = 0;
        let archivedCount = 0;
        const responseMessages = [];
        for (const r of results) {
          if (r.status === 'fulfilled') {
            if (r.value?.mode === 'deleted') deletedCount += 1;
            else archivedCount += 1;
            if (r.value?.message) responseMessages.push(r.value.message);
          }
        }
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (deletedCount > 0 && archivedCount > 0) {
          toast.success(`${deletedCount} ${termProperties.toLowerCase()} deleted and ${archivedCount} archived safely.`);
        } else if (archivedCount > 0) {
          toast.success(`${archivedCount} ${termProperties.toLowerCase()} archived safely instead of being deleted.`);
        } else if (deletedCount > 0) {
          toast.success(`${deletedCount} ${termProperties.toLowerCase()} deleted successfully.`);
        }
        if (deletedCount === 0 && archivedCount === 1 && responseMessages[0]) toast.info(responseMessages[0]);
        if (failed > 0) toast.error(`${failed} ${termProperties.toLowerCase()} could not be deleted.`);
        dispatch(getProperties(buildFetchParams()));
      },
    });
  };

  const handleBulkImport = async (properties) => {
    if (!currentCompany?._id) {
      toast.error('No company selected');
      return { successful: [], failed: [{ error: 'No company selected' }] };
    }

    try {
      const response = await adminRequests.post('/properties/bulk-import', {
        properties,
        business: currentCompany._id
      });

      // Refresh properties list
      const params = {
        page: currentPage,
        limit: pageSize,
        search: "",
        status: appliedFilters.status,
        zone: appliedFilters.zone,
        category: appliedFilters.category,
        code: appliedFilters.code,
        name: appliedFilters.name,
        lrNumber: appliedFilters.lr,
        landlord: appliedFilters.landlord,
        location: appliedFilters.location,
      };
      dispatch(getProperties(params));

      return response.data?.data || { successful: [], failed: [] };
    } catch (error) {
      throw error;
    }
  };

  const handlePrintList = () => {
    if (!Array.isArray(properties) || properties.length === 0) {
      toast.warning(`No ${termProperties.toLowerCase()} to print`);
      return;
    }

    printTabularList({
      title: `${termProperties} List`,
      subtitle: `Current visible ${termProperties.toLowerCase()} register`,
      company: currentCompany || {},
      summary: `Records: ${properties.length} • Printed on ${new Date().toLocaleString()}`,
      columns: [
        { label: `${termProperty} Code`, value: (row) => row?.propertyCode || row?.code || "-" },
        { label: `${termProperty} Name`, value: (row) => row?.propertyName || row?.name || "-" },
        { label: termLandlord, value: (row) => row?.landlord?.name || row?.landlordName || row?.landlords?.[0]?.name || row?.landlords?.[0]?.landlordId?.landlordName || row?.landlords?.[0]?.landlordId?.fullName || "-" },
        { label: "Location", value: (row) => row?.location || row?.address || "-" },
        { label: termUnits, value: (row) => row?.unitsCount || row?.totalUnits || row?.units?.length || "-", align: "right" },
        { label: "Status", value: (row) => row?.status || "active" },
      ],
      rows: properties,
    });
  };

  const handleExport = () => {
    if (!properties || properties.length === 0) {
      toast.warning(`No ${termProperties.toLowerCase()} to export`);
      return;
    }
    exportPropertiesToExcel(properties);
    toast.success(`${termProperties} exported successfully`);
  };

  const openEditProperty = (propertyId) => {
    if (!propertyId) return;
    navigate(`/properties/edit/${propertyId}`, {
      state: { tabTitle: `${termProperty} Details` },
    });
  };

  const totalPages = Math.max(1, Math.ceil((pagination?.total || 0) / pageSize));

  // Archive/Restore properties
  const archiveSelected = () => {
    if (selectedProperties.length === 0) {
      toast.error(`No ${termProperties.toLowerCase()} selected`);
      return;
    }

    setConfirmDialog({
      isOpen: true,
      title: `Archive ${termProperties}`,
      message: `Are you sure you want to archive ${selectedProperties.length} ${termProperties.toLowerCase()}? You can restore them later.`,
      confirmText: "Archive",
      isDangerous: false,
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        setSelectedProperties([]);
        setSelectAll(false);
        setActionMenuOpen(false);
        const archResults = await Promise.allSettled(
          selectedProperties.map((id) => dispatch(archiveProperty(id)).unwrap())
        );
        const archOk = archResults.filter((r) => r.status === 'fulfilled').length;
        const archFail = archResults.filter((r) => r.status === 'rejected').length;
        if (archOk > 0) toast.success(`${archOk} ${termProperties.toLowerCase()} archived successfully.`);
        if (archFail > 0) toast.error(`${archFail} ${termProperties.toLowerCase()} could not be archived.`);
        dispatch(getProperties(buildFetchParams()));
      },
    });
  };

  const restoreSelected = () => {
    if (selectedProperties.length === 0) {
      toast.error(`No ${termProperties.toLowerCase()} selected`);
      return;
    }

    setConfirmDialog({
      isOpen: true,
      title: `Restore ${termProperties}`,
      message: `Are you sure you want to restore ${selectedProperties.length} ${termProperties.toLowerCase()}?`,
      confirmText: "Restore",
      isDangerous: false,
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        setSelectedProperties([]);
        setSelectAll(false);
        setActionMenuOpen(false);
        const restResults = await Promise.allSettled(
          selectedProperties.map((id) => dispatch(restoreProperty(id)).unwrap())
        );
        const restOk = restResults.filter((r) => r.status === 'fulfilled').length;
        const restFail = restResults.filter((r) => r.status === 'rejected').length;
        if (restOk > 0) toast.success(`${restOk} ${termProperties.toLowerCase()} restored successfully.`);
        if (restFail > 0) toast.error(`${restFail} ${termProperties.toLowerCase()} could not be restored.`);
        dispatch(getProperties(buildFetchParams()));
      },
    });
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex flex-col h-full min-h-0 p-0 bg-white overflow-hidden">
        {/* Toolbar — single scrollable row */}
        <ListToolbar>
          <AppSelect
            value={draftFilters.status}
            onChange={(v) => setDraftFilters((p) => ({ ...p, status: v ?? "" }))}
            options={[
              { value: "active", label: "Active" },
              { value: "maintenance", label: "Maintenance" },
              { value: "closed", label: "Closed" },
              { value: "archived", label: "Archived" },
            ]}
            placeholder="All Status"
            clearable
            compact
          />

          <AppSelect
            value={draftFilters.zone}
            onChange={(v) => setDraftFilters((p) => ({ ...p, zone: v ?? "" }))}
            options={zoneOptions}
            placeholder="All Zones"
            searchable
            clearable
            compact
          />

          <AppSelect
            value={draftFilters.category}
            onChange={(v) => setDraftFilters((p) => ({ ...p, category: v ?? "" }))}
            options={[
              { value: "Residential", label: "Residential" },
              { value: "Commercial", label: "Commercial" },
              { value: "Mixed Use", label: "Mixed Use" },
              { value: "Industrial", label: "Industrial" },
              { value: "Agricultural", label: "Agricultural" },
            ]}
            placeholder="All Categories"
            clearable
            compact
          />

          <AppSelect
            value={draftFilters.landlord}
            onChange={(v) => setDraftFilters((p) => ({ ...p, landlord: v ?? "" }))}
            options={landlordOptions}
            placeholder={`All ${termLandlords}`}
            searchable
            clearable
            compact
          />

          <ListToolbar.Divider />

          <ListToolbar.Input width="w-[4.5rem]" value={draftFilters.code} onChange={(e) => setDraftFilters((p) => ({ ...p, code: normalizeUppercaseInput(e.target.value) }))}
            onKeyDown={onFilterEnter} placeholder="Code" />
          <ListToolbar.Input value={draftFilters.name} onChange={(e) => setDraftFilters((p) => ({ ...p, name: normalizeUppercaseInput(e.target.value) }))}
            onKeyDown={onFilterEnter} placeholder="Name" />
          <ListToolbar.Input width="w-[4.5rem]" value={draftFilters.lr} onChange={(e) => setDraftFilters((p) => ({ ...p, lr: e.target.value }))}
            onKeyDown={onFilterEnter} placeholder="LR No." />
          <ListToolbar.Input width="w-20" value={draftFilters.location} onChange={(e) => setDraftFilters((p) => ({ ...p, location: normalizeUppercaseInput(e.target.value) }))}
            onKeyDown={onFilterEnter} placeholder="Location" />

          <ListToolbar.Divider />

          <ListToolbar.Button icon={FaSearch} variant="accent" onClick={applySearch}>Search</ListToolbar.Button>
          <ListToolbar.Button icon={FaRedoAlt} onClick={resetFilters}>Reset</ListToolbar.Button>
          <ListToolbar.Button
            icon={allRowsExpanded ? FaCompressAlt : FaExpandAlt}
            variant={allRowsExpanded ? "toggle" : "primary"}
            disabled={!properties || properties.length === 0}
            onClick={allRowsExpanded ? collapseAllRows : expandAllRows}
          >
            {allRowsExpanded ? "Collapse" : "Expand"}
          </ListToolbar.Button>
          {canUpdateProperty && (
            <ListToolbar.Button icon={FaEdit} disabled={selectedProperties.length !== 1} onClick={() => openEditProperty(selectedProperties[0])}>
              Edit
            </ListToolbar.Button>
          )}

          {canUpdateProperty && (
            <div className="shrink-0">
              <ListToolbar.Button
                icon={FaArchive}
                ref={actionMenuBtnRef}
                disabled={selectedProperties.length === 0}
                onClick={() => setActionMenuOpen((v) => !v)}
              >
                Actions <FaChevronDown size={8} />
              </ListToolbar.Button>
              <ListToolbar.Menu open={actionMenuOpen && selectedProperties.length > 0} onClose={() => setActionMenuOpen(false)} anchorRef={actionMenuBtnRef}>
                <ListToolbar.MenuItem icon={FaArchive} onClick={archiveSelected}>Archive</ListToolbar.MenuItem>
                <ListToolbar.MenuItem icon={FaUndo} onClick={restoreSelected}>Restore</ListToolbar.MenuItem>
              </ListToolbar.Menu>
            </div>
          )}

          {canDeleteProperty && (
            <ListToolbar.Button icon={FaTrash} variant="danger" disabled={selectedProperties.length === 0} onClick={handleBulkDelete}>
              Delete{selectedProperties.length > 0 ? ` (${selectedProperties.length})` : ""}
            </ListToolbar.Button>
          )}
          {canCreateProperty && (
            <Link to="/properties/new" className="shrink-0">
              <ListToolbar.Button icon={FaPlus}>Add</ListToolbar.Button>
            </Link>
          )}
          <ListToolbar.Button icon={FaFileImport} variant="outlineOk" onClick={() => setShowImportModal(true)}>Import</ListToolbar.Button>
          <ListToolbar.Button icon={FaPrint} variant="dark" onClick={handlePrintList}>Print</ListToolbar.Button>
          <ListToolbar.Button icon={FaFileExport} variant="outline" onClick={handleExport}>Export</ListToolbar.Button>
        </ListToolbar>

        {/* Table Card */}
        <div className="flex-1 min-h-0 px-2 pb-2 overflow-hidden">
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm h-full flex flex-col">
            <MilikTable
              tableFixed
              columns={[
                { label: "Code" },
                { label: "Name" },
                { label: termLandlord },
                { label: "Category" },
                { label: "Zone" },
                { label: "Location" },
                { label: `Total ${termUnits}`, align: "center", width: "92px" },
                { label: "Occupied", align: "center", width: "84px" },
                { label: "Vacant", align: "center", width: "84px" },
                { label: "Status" },
              ]}
              rows={properties || []}
              rowKey="_id"
              empty={`No ${termProperties.toLowerCase()} found. Use the filter fields above, then click Search.`}
              checkboxes
              allChecked={selectAll && (properties || []).length > 0}
              someChecked={selectedProperties.length > 0 && !selectAll}
              onCheckAll={handleSelectAll}
              isChecked={(property) => selectedProperties.includes(property._id)}
              onCheckRow={(property) => handleSelectProperty(property._id)}
              onRowClick={(property) => handleSelectProperty(property._id)}
              isSelected={(property) => selectedProperties.includes(property._id)}
              expandedKeys={expandedRows}
              onExpandedKeysChange={setExpandedRows}
              renderExpanded={(property) => (
                                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                    {/* Property Details */}
                                    <div className="space-y-3 p-3 bg-white rounded-lg shadow-sm border border-gray-100">
                                      <h4 className="font-bold text-gray-900 text-sm mb-3 pb-2 border-b-2 border-[#0B3B2E]">📋 {termProperty} Details</h4>
                                      <div>
                                        <span className="text-xs font-semibold text-gray-700">{termProperty} Type:</span>
                                        <p className="text-sm font-bold text-gray-900 mt-1">{property.propertyCategory || property.propertyType || "N/A"}</p>
                                      </div>
                                      <div>
                                        <span className="text-xs font-semibold text-gray-700">Specification:</span>
                                        <p className="text-sm font-bold text-gray-900 mt-1">{property.specification || "N/A"}</p>
                                      </div>
                                      <div>
                                        <span className="text-xs font-semibold text-gray-700">Floors:</span>
                                        <p className="text-sm font-bold text-gray-900 mt-1">{property.numberOfFloors || "0"}</p>
                                      </div>
                                      <div>
                                        <span className="text-xs font-semibold text-gray-700">LR Number:</span>
                                        <p className="text-sm font-bold text-gray-900 mt-1">{property.lrNumber || "N/A"}</p>
                                      </div>
                                      <div>
                                        <span className="text-xs font-semibold text-gray-700">Date Acquired:</span>
                                        <p className="text-sm font-bold text-gray-900 mt-1">{fmtDate(property.dateAcquired)}</p>
                                      </div>
                                    </div>

                                    {/* Financial Details */}
                                    <div className="space-y-3 p-3 bg-white rounded-lg shadow-sm border border-gray-100">
                                      <h4 className="font-bold text-gray-900 text-sm mb-3 pb-2 border-b-2 border-[#FF8C00]">💰 Financial Details</h4>
                                      <div>
                                        <span className="text-xs font-semibold text-gray-700">Let/Manage:</span>
                                        <p className="text-sm font-bold text-gray-900 mt-1">{property.letManage || "N/A"}</p>
                                      </div>
                                      <div>
                                        <span className="text-xs font-semibold text-gray-700">Account Ledger:</span>
                                        <div className="mt-1 flex flex-col gap-1">
                                          {getLedgerBadge(property) ? (
                                            <>
                                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-700 border border-purple-200">
                                                {termProperty} GL — {property.propertyLedgerEnabled ? "Ledger Active" : "Ledger Disabled"}
                                              </span>
                                              <Link
                                                to={`/properties/${property._id}/ledger`}
                                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-purple-700 text-white hover:bg-purple-800 w-fit"
                                                onClick={(e) => e.stopPropagation()}
                                              >
                                                {termProperty} Ledger →
                                              </Link>
                                            </>
                                          ) : (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">
                                              In-GL — Posts to General Ledger
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      <div>
                                        <span className="text-xs font-semibold text-gray-700">Held for {termLandlord}:</span>
                                        {property.pctrlBalance > 0 ? (
                                          <p className="text-sm font-bold text-emerald-700 mt-1">
                                            KES {Number(property.pctrlBalance).toLocaleString("en-KE", { minimumFractionDigits: 2 })}
                                          </p>
                                        ) : (
                                          <p className="text-sm font-bold text-slate-400 mt-1">
                                            {property.controlAccount ? "KES 0.00" : "⚠ No control account"}
                                          </p>
                                        )}
                                      </div>
                                      <div>
                                        <span className="text-xs font-semibold text-gray-700">{termInvoice} Prefix:</span>
                                        <p className="text-sm font-bold text-gray-900 mt-1">{property.invoicePrefix || "N/A"}</p>
                                      </div>
                                      <div>
                                        <span className="text-xs font-semibold text-gray-700">M-Pesa Paybill:</span>
                                        <p className="text-sm font-bold text-gray-900 mt-1">{property.mpesaPaybill ? "✅ Yes" : "❌ No"}</p>
                                      </div>
                                    </div>

                                    {/* Contact Details */}
                                    <div className="space-y-3 p-3 bg-white rounded-lg shadow-sm border border-gray-100">
                                      <h4 className="font-bold text-gray-900 text-sm mb-3 pb-2 border-b-2 border-blue-600">👥 Contact Details</h4>
                                      {property.landlords && property.landlords.length > 0 ? (
                                        property.landlords.map((landlord, idx) => (
                                          <div key={landlord._id || landlord.landlordId || idx} className="p-2 bg-gray-50 rounded border border-gray-200">
                                            <p className="text-sm font-bold text-gray-900">
                                              {landlord.name} {landlord.isPrimary && "⭐ (Primary)"}
                                            </p>
                                            {landlord.contact && (
                                              <p className="text-xs text-gray-700 font-semibold mt-1">{landlord.contact}</p>
                                            )}
                                          </div>
                                        ))
                                      ) : (
                                        <p className="text-sm text-gray-600 font-semibold">No {termLandlords.toLowerCase()} added</p>
                                      )}
                                      {property.specificContactInfo && (
                                        <div className="p-2 bg-gray-50 rounded border border-gray-200">
                                          <span className="text-xs font-semibold text-gray-700">Additional Contact:</span>
                                          <p className="text-sm font-bold text-gray-900 mt-1">{property.specificContactInfo}</p>
                                        </div>
                                      )}
                                    </div>

                                    {/* Actions */}
                                    <div className="space-y-3 p-3 bg-white rounded-lg shadow-sm border border-gray-100">
                                      <h4 className="font-bold text-gray-900 text-sm mb-3 pb-2 border-b-2 border-green-600">⚙️ Actions</h4>
                                      <div className="flex flex-col gap-2 action-buttons">
                                        <Link to={`/properties/${property._id}`} onClick={(e) => e.stopPropagation()}>
                                          <button className="px-3 py-2 text-xs bg-blue-600 text-white rounded-lg flex items-center justify-center gap-2 hover:bg-blue-700 transition-colors w-full font-bold">
                                            <FaEye /> View Details
                                          </button>
                                        </Link>

                                        {canUpdateProperty && (
                                          <Link
                                            to={`/properties/edit/${property._id}`}
                                            state={{ tabTitle: `${termProperty} Details` }}
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            <button
                                              className={`px-3 py-2 text-xs text-white rounded-lg flex items-center justify-center gap-2 transition-colors w-full font-bold ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
                                            >
                                              <FaEdit /> Edit {termProperty}
                                            </button>
                                          </Link>
                                        )}

                                        {canDeleteProperty && (
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleDelete(property._id);
                                            }}
                                            className="px-3 py-2 text-xs bg-red-600 text-white rounded-lg flex items-center justify-center gap-2 hover:bg-red-700 transition-colors w-full font-bold"
                                          >
                                            <FaTrash /> Delete {termProperty}
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  </div>
              )}
              renderRow={(property) => (
                <>
                  <td className="px-3 py-1 border-r border-gray-100 overflow-hidden">
                    <span className="font-mono text-[10px] text-slate-500 tracking-wide truncate block">{toListingCaps(property.propertyCode)}</span>
                  </td>
                  <td className="px-3 py-1 border-r border-gray-100 overflow-hidden">
                    <span className="font-semibold text-slate-900 truncate block">{toListingCaps(property.propertyName)}</span>
                    {getLedgerBadge(property) && (
                      <span className="inline-flex items-center px-1.5 py-px rounded text-[9px] font-bold tracking-wide bg-purple-100 text-purple-700 border border-purple-200 mt-0.5">
                        {termProperty} GL{property.propertyLedgerEnabled ? " ✓" : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1 border-r border-gray-100 overflow-hidden">
                    <span className="text-slate-600 truncate block">{toListingCaps(getPrimaryLandlord(property.landlords))}</span>
                  </td>
                  <td className="px-3 py-1 border-r border-gray-100">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${getCategoryColor(property.propertyType)}`}>
                      {property.propertyType || "N/A"}
                    </span>
                  </td>
                  <td className="px-3 py-1 border-r border-gray-100 overflow-hidden">
                    <span className="text-slate-600 truncate block">{toListingCaps(property.zoneRegion || "—")}</span>
                  </td>
                  <td className="px-3 py-1 border-r border-gray-100 overflow-hidden">
                    <span className="text-slate-600 truncate block">{toListingCaps(getFullAddress(property))}</span>
                  </td>
                  <td className="px-3 py-1.5 text-center border-r border-gray-100 font-semibold text-slate-700">
                    {property.totalUnits || 0}
                  </td>
                  <td className="px-3 py-1.5 text-center border-r border-gray-100 font-bold text-emerald-700">
                    {property.occupiedUnits || 0}
                  </td>
                  <td className="px-3 py-1.5 text-center border-r border-gray-100 font-bold text-red-600">
                    {property.vacantUnits || 0}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${getStatusColor(property.status)}`}>
                      {property.status || "N/A"}
                    </span>
                  </td>
                </>
              )}
            />

            <PaginationBar
              page={currentPage}
              pages={totalPages}
              total={pagination?.total}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={(n) => { setPageSize(n); setCurrentPage(1); }}
              label={termProperties.toLowerCase()}
            />
          </div>
        </div>

        {/* Resizing overlay (kept) */}
        {isResizing && <div className="fixed inset-0 z-50 cursor-col-resize" style={{ cursor: "col-resize" }} />}

        {/* Milik Confirm Dialog */}
        <MilikConfirmDialog
          isOpen={confirmDialog.isOpen}
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmText={confirmDialog.confirmText || "Confirm"}
          cancelText="Cancel"
          isDangerous={confirmDialog.isDangerous}
          onConfirm={() => confirmDialog.onConfirm?.()}
          onCancel={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}
        />

        {/* Property Import Modal */}
        <ImportModal
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
          title={`Import ${termProperties} from Excel`}
          entityName={termProperty.toLowerCase()}
          parseFile={parsePropertiesExcel}
          downloadTemplate={downloadPropertiesTemplate}
          onImport={handleBulkImport}
          maxWidthClass="max-w-4xl"
          getErrorRowLabel={(e) => e.data?.propertyName}
          getFailureRowLabel={(f) => f.propertyName}
          previewCols={[
            { header: `${termProperty} Name`, render: (r) => <span className="font-semibold">{r.propertyName}</span> },
            { header: "Type", render: (r) => r.propertyType },
            { header: "LR Number", render: (r) => r.lrNumber },
            { header: "Location", render: (r) => r.townCityState },
            { header: termLandlord, render: (r) => r.landlordName },
            { header: termUnits, render: (r) => r.totalUnits },
          ]}
        />
      </div>
    </DashboardLayout>
  );
};

export default Properties;