// pages/Properties.js
import React, { useState, useRef, useEffect, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useNavigate } from "react-router-dom";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import {
  FaPlus,
  FaSearch,
  FaEdit,
  FaTrash,
  FaEye,
  FaFileExport,
  FaChevronLeft,
  FaChevronRight,
  FaChevronDown,
  FaChevronUp,
  FaBuilding,
  FaRedoAlt,
  FaArchive,
  FaUndo,
  FaExpandAlt,
  FaCompressAlt,
  FaFileImport,
  FaFileDownload,
  FaPrint,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { getProperties, deleteProperty, archiveProperty, restoreProperty } from "../../redux/propertyRedux";
import { getLandlords } from "../../redux/apiCalls";
import MilikConfirmDialog from "../../components/Modals/MilikConfirmDialog";
import PropertyImportModal from "../../components/Modals/PropertyImportModal";
import { downloadPropertiesTemplate, exportPropertiesToExcel } from "../../utils/excelTemplates";
import { adminRequests } from "../../utils/requestMethods";
import { printTabularList } from "../../utils/printList";

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";
const MILIK_ORANGE = "bg-[#FF8C00]";
const MILIK_ORANGE_HOVER = "hover:bg-[#e67e00]";

const Properties = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  // Redux state
  const { properties, error, pagination } = useSelector((state) => state.property);
  const landlords = useSelector((state) => state?.landlord?.landlords || state?.landlords?.items || state?.landlords?.landlords || []);
  const { currentCompany } = useSelector((state) => state.company);

  // Pagination
  const itemsPerPage = 50;
  const [currentPage, setCurrentPage] = useState(1);

  // Selection + table UI
  const [selectedProperties, setSelectedProperties] = useState([]);
  const [selectAll, setSelectAll] = useState(false);
  const [expandedRows, setExpandedRows] = useState([]); // Array to track multiple expanded rows
  const [isResizing, setIsResizing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);

  // Dropdown (Archive/Restore placeholder)
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const actionMenuRef = useRef(null);

  // Import modal
  const [showImportModal, setShowImportModal] = useState(false);

  // Column resizing refs (kept for compatibility)
  const resizingRef = useRef(null);
  const tableRef = useRef(null);

  // Columns (reduced to avoid horizontal scroll)
  const columns = useMemo(
    () => [
      { key: "code", label: "Code" },
      { key: "name", label: "Name" },
      { key: "landlord", label: "Landlord" },
      { key: "category", label: "Category" },
      { key: "zone", label: "Zone" },
      { key: "location", label: "Location" },
      { key: "totalUnits", label: "Total Units" },
      { key: "occupiedUnits", label: "Occupied" },
      { key: "vacantUnits", label: "Vacant" },
      { key: "status", label: "Status" },
    ],
    []
  );

  // Filters
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

  const [draftFilters, setDraftFilters] = useState(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState(emptyFilters);

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
  // Load landlords on mount
  useEffect(() => {
    if (currentCompany?._id) {
      dispatch(getLandlords({ company: currentCompany._id }));
    }
  }, [dispatch, currentCompany]);

  useEffect(() => {
    const onDocClick = (e) => {
      if (!actionMenuRef.current) return;
      if (!actionMenuRef.current.contains(e.target)) setActionMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Keep selectAll off when page changes
  useEffect(() => {
    setSelectAll(false);
  }, [currentPage]);

  // Apply search (button)
  const applySearch = () => {
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
  };

  const resetFilters = () => {
    setDraftFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    setCurrentPage(1);
    setSelectedProperties([]);
    setSelectAll(false);
    setExpandedRows([]);
    setActionMenuOpen(false);
  };

  const onFilterEnter = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applySearch();
    }
  };

  // Fetch properties when applied filters or page changes
  useEffect(() => {
    const params = {
      page: currentPage,
      limit: itemsPerPage,
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
  }, [dispatch, currentPage, itemsPerPage, appliedFilters]);

  // Show error toast
  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  // Selection
  const handleSelectProperty = (id) => {
    setSelectedProperties((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedProperties([]);
      setSelectAll(false);
    } else {
      setSelectedProperties((properties || []).map((p) => p._id));
      setSelectAll(true);
    }
  };

  const handleCheckboxClick = (e) => e.stopPropagation();

  // Toggle expand for a specific row
  const toggleRowExpand = (propertyId) => {
    setExpandedRows((prev) =>
      prev.includes(propertyId) ? prev.filter((id) => id !== propertyId) : [...prev, propertyId]
    );
  };

  // Expand all rows
  const expandAllRows = () => {
    if (properties && properties.length > 0) {
      setExpandedRows(properties.map((p) => p._id));
    }
  };

  // Collapse all rows
  const collapseAllRows = () => {
    setExpandedRows([]);
  };

  // Check if all rows are expanded
  const allRowsExpanded = properties && properties.length > 0 && expandedRows.length === properties.length;

  // Row click now selects the property (not expands)
  const handleRowClick = (propertyId, e) => {
    if (e.target.type === "checkbox" || e.target.closest(".action-buttons")) return;
    // Select the property
    handleSelectProperty(propertyId);
  };

  // Delete
  const handleDelete = async (propertyId) => {
    try {
      await dispatch(deleteProperty(propertyId)).unwrap();
      toast.success("Property deleted successfully");
      setShowDeleteConfirm(null);

      // refresh
      const params = {
        page: currentPage,
        limit: itemsPerPage,
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
    } catch (err) {
      const errorMsg = typeof err === 'string' ? err : (err?.message || "Failed to delete property");
      toast.error(errorMsg);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedProperties.length === 0) {
      toast.error("No properties selected");
      return;
    }

    setConfirmDialog({
      isOpen: true,
      title: "Delete Properties",
      message: `Are you sure you want to delete ${selectedProperties.length} properties? This action cannot be undone.`,
      confirmText: "Delete",
      isDangerous: true,
      onConfirm: async () => {
        try {
          for (const propertyId of selectedProperties) {
            // unwrap so errors are caught
            // eslint-disable-next-line no-await-in-loop
            await dispatch(deleteProperty(propertyId)).unwrap();
          }
          toast.success(`${selectedProperties.length} properties deleted successfully`);
          setSelectedProperties([]);
          setSelectAll(false);
          setConfirmDialog({ isOpen: false });

          // refresh
          const params = {
            page: currentPage,
            limit: itemsPerPage,
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
        } catch (err) {
          const errorMsg = typeof err === 'string' ? err : (err?.message || "Failed to delete some properties");
          toast.error(errorMsg);
        }
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));
      },
    });
  };

  const handleBulkImport = async (properties) => {
    if (!currentCompany?._id) {
      toast.error('No company selected');
      return { data: { successful: [], failed: [{ error: 'No company selected' }] } };
    }

    try {
      console.log('Calling bulk import with properties:', properties.length);
      const response = await adminRequests.post('/properties/bulk-import', {
        properties,
        business: currentCompany._id
      });
      console.log('Import completed:', response.data);

      // Refresh properties list
      const params = {
        page: currentPage,
        limit: itemsPerPage,
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

      return response;
    } catch (error) {
      console.error('Bulk import error:', error);
      throw error;
    }
  };

  const handlePrintList = () => {
    if (!Array.isArray(properties) || properties.length === 0) {
      toast.warning("No properties to print");
      return;
    }

    printTabularList({
      title: "Properties List",
      subtitle: "Current visible properties register",
      company: currentCompany || {},
      summary: `Records: ${properties.length} • Printed on ${new Date().toLocaleString()}`,
      columns: [
        { label: "Property Code", value: (row) => row?.propertyCode || row?.code || "-" },
        { label: "Property Name", value: (row) => row?.propertyName || row?.name || "-" },
        { label: "Landlord", value: (row) => row?.landlord?.name || row?.landlordName || "-" },
        { label: "Location", value: (row) => row?.location || row?.address || "-" },
        { label: "Units", value: (row) => row?.unitsCount || row?.totalUnits || row?.units?.length || "-", align: "right" },
        { label: "Status", value: (row) => row?.status || "active" },
      ],
      rows: properties,
    });
  };

  const handleExport = () => {
    if (!properties || properties.length === 0) {
      toast.warning('No properties to export');
      return;
    }
    exportPropertiesToExcel(properties);
    toast.success('Properties exported successfully');
  };

  const openEditProperty = (propertyId) => {
    if (!propertyId) return;
    navigate(`/properties/edit/${propertyId}`, {
      state: { tabTitle: "Property Details" },
    });
  };

  // Row styling
  const getRowClass = (index, id) => {
    if (selectedProperties.includes(id)) return "bg-[#CDE7D3] hover:bg-[#DFF1E3]";
    return index % 2 === 0 ? "bg-white hover:bg-[#f8f8f8]" : "bg-[#f9f9f9] hover:bg-[#f0f0f0]";
  };

  // Helpers
  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const getPrimaryLandlord = (landlords) => {
    if (!landlords || landlords.length === 0) return "N/A";
    const primary = landlords.find((l) => l.isPrimary);
    return primary ? primary.name : landlords[0]?.name || "N/A";
  };

  const getFullAddress = (property) => {
    const parts = [property.roadStreet, property.estateArea, property.townCityState].filter(
      (p) => p && String(p).trim() !== ""
    );
    return parts.join(", ") || property.address || "N/A";
  };

  const getStatusColor = (status) => {
    switch (status) {
      case "active":
        return "bg-green-100 text-green-800 border border-green-300";
      case "maintenance":
        return "bg-yellow-100 text-yellow-800 border border-yellow-300";
      case "closed":
        return "bg-red-100 text-red-800 border border-red-300";
      default:
        return "bg-gray-100 text-gray-800 border border-gray-300";
    }
  };

  const getCategoryColor = (category) => {
    switch (category?.toLowerCase()) {
      case "residential":
        return "bg-blue-100 text-blue-800 border border-blue-300";
      case "commercial":
        return "bg-purple-100 text-purple-800 border border-purple-300";
      case "mixed use":
        return "bg-yellow-100 text-yellow-800 border border-yellow-300";
      default:
        return "bg-gray-100 text-gray-800 border border-gray-300";
    }
  };

  const totalPages = Math.max(1, Math.ceil((pagination?.total || 0) / itemsPerPage));

  // Archive/Restore properties
  const archiveSelected = () => {
    if (selectedProperties.length === 0) {
      toast.error("No properties selected");
      return;
    }

    setConfirmDialog({
      isOpen: true,
      title: "Archive Properties",
      message: `Are you sure you want to archive ${selectedProperties.length} properties? You can restore them later.`,
      confirmText: "Archive",
      isDangerous: false,
      onConfirm: async () => {
        try {
          for (const propertyId of selectedProperties) {
            // eslint-disable-next-line no-await-in-loop
            await dispatch(archiveProperty(propertyId)).unwrap();
          }
          toast.success(`${selectedProperties.length} properties archived successfully`);
          setSelectedProperties([]);
          setSelectAll(false);
          setActionMenuOpen(false);
          setConfirmDialog({ isOpen: false });

          // refresh
          const params = {
            page: currentPage,
            limit: itemsPerPage,
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
        } catch (err) {
          const errorMsg = typeof err === 'string' ? err : (err?.message || "Failed to archive properties");
          toast.error(errorMsg);
          setConfirmDialog({ isOpen: false });
        }
      },
    });
  };

  const restoreSelected = () => {
    if (selectedProperties.length === 0) {
      toast.error("No properties selected");
      return;
    }

    setConfirmDialog({
      isOpen: true,
      title: "Restore Properties",
      message: `Are you sure you want to restore ${selectedProperties.length} properties?`,
      confirmText: "Restore",
      isDangerous: false,
      onConfirm: async () => {
        try {
          for (const propertyId of selectedProperties) {
            // eslint-disable-next-line no-await-in-loop
            await dispatch(restoreProperty(propertyId)).unwrap();
          }
          toast.success(`${selectedProperties.length} properties restored successfully`);
          setSelectedProperties([]);
          setSelectAll(false);
          setActionMenuOpen(false);
          setConfirmDialog({ isOpen: false });

          // refresh
          const params = {
            page: currentPage,
            limit: itemsPerPage,
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
        } catch (err) {
          const errorMsg = typeof err === 'string' ? err : (err?.message || "Failed to restore properties");
          toast.error(errorMsg);
          setConfirmDialog({ isOpen: false });
        }
      },
    });
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex flex-col h-full min-h-0 p-0 bg-white overflow-hidden">
        {/* Filters Card */}
        <div className="flex-shrink-0 sticky top-0 z-30 bg-white pt-2 px-2">
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-2">
            {/* Row 1 */}
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="px-3 py-1 text-xs border border-gray-300 rounded shadow-sm focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] bg-[#DDEFE1] text-gray-800 hover:bg-white transition-colors"
                value={draftFilters.status}
                onChange={(e) => setDraftFilters((p) => ({ ...p, status: e.target.value }))}
              >
                <option value="active">Active</option>
                <option value="">All Status</option>
                <option value="maintenance">Maintenance</option>
                <option value="closed">Closed</option>
              </select>

              <select
                className="px-3 py-1 text-xs border border-gray-300 rounded shadow-sm focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] bg-[#DDEFE1] text-gray-800 hover:bg-white transition-colors"
                value={draftFilters.zone}
                onChange={(e) => setDraftFilters((p) => ({ ...p, zone: e.target.value }))}
              >
                <option value="">All Zones</option>
                <option value="Nairobi CBD">Nairobi CBD</option>
                <option value="Westlands">Westlands</option>
                <option value="Kilimani">Kilimani</option>
                <option value="Karen">Karen</option>
                <option value="Mombasa Road">Mombasa Road</option>
                <option value="Thika Road">Thika Road</option>
              </select>

              <select
                className="px-3 py-1 text-xs border border-gray-300 rounded shadow-sm focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] bg-[#DDEFE1] text-gray-800 hover:bg-white transition-colors"
                value={draftFilters.category}
                onChange={(e) => setDraftFilters((p) => ({ ...p, category: e.target.value }))}
              >
                <option value="">All Categories</option>
                <option value="Residential">Residential</option>
                <option value="Commercial">Commercial</option>
                <option value="Mixed Use">Mixed Use</option>
                <option value="Industrial">Industrial</option>
                <option value="Agricultural">Agricultural</option>
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
                onClick={allRowsExpanded ? collapseAllRows : expandAllRows}
                disabled={!properties || properties.length === 0}
                className={`px-4 py-1 text-xs text-white rounded-lg flex items-center gap-2 shadow-sm ${
                  properties && properties.length > 0
                    ? allRowsExpanded
                      ? "bg-orange-600 hover:bg-orange-700"
                      : `${MILIK_GREEN} ${MILIK_GREEN_HOVER}`
                    : "bg-gray-400 cursor-not-allowed"
                }`}
                title={allRowsExpanded ? "Collapse all properties" : "Expand all properties"}
              >
                {allRowsExpanded ? (
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
                onClick={() => openEditProperty(selectedProperties[0])}
                disabled={selectedProperties.length !== 1}
                className={`px-4 py-1 text-xs text-white rounded-lg flex items-center gap-2 shadow-sm ${
                  selectedProperties.length === 1
                    ? `${MILIK_GREEN} ${MILIK_GREEN_HOVER}`
                    : "bg-gray-400 cursor-not-allowed"
                }`}
                title={selectedProperties.length === 1 ? "Edit selected property" : "Select exactly 1 property to edit"}
              >
                <FaEdit className="text-xs" />
                Edit
              </button>

              <div className="relative" ref={actionMenuRef}>
                <button
                  onClick={() => setActionMenuOpen((v) => !v)}
                  disabled={selectedProperties.length === 0}
                  className={`px-4 py-1 text-xs text-white rounded-lg flex items-center gap-2 shadow-sm ${
                    selectedProperties.length > 0
                      ? `${MILIK_GREEN} ${MILIK_GREEN_HOVER}`
                      : "bg-gray-400 cursor-not-allowed"
                  }`}
                  title={selectedProperties.length ? "Archive/Restore selected properties" : "Select properties first"}
                >
                  <FaArchive className="text-xs" />
                  Actions
                  <FaChevronDown className="text-[10px] opacity-90" />
                </button>

                {actionMenuOpen && selectedProperties.length > 0 && (
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
                onClick={handleBulkDelete}
                disabled={selectedProperties.length === 0}
                className={`px-4 py-1 text-xs text-white rounded-lg flex items-center gap-2 shadow-sm ${
                  selectedProperties.length > 0 ? "bg-red-600 hover:bg-red-700" : "bg-gray-400 cursor-not-allowed"
                }`}
                title={selectedProperties.length ? "Delete selected properties" : "Select properties to delete"}
              >
                <FaTrash className="text-xs" />
                Delete {selectedProperties.length > 0 ? `(${selectedProperties.length})` : ""}
              </button>

              <button
                onClick={() => downloadPropertiesTemplate()}
                className="px-4 py-1 text-xs bg-blue-50 text-blue-700 border border-blue-300 rounded-lg flex items-center gap-2 hover:bg-blue-100 transition-colors shadow-sm"
                title="Download Excel import template"
              >
                <FaFileDownload className="text-xs" />
                Template
              </button>

              <button
                onClick={() => setShowImportModal(true)}
                className="px-4 py-1 text-xs bg-green-50 text-green-700 border border-green-300 rounded-lg flex items-center gap-2 hover:bg-green-100 transition-colors shadow-sm"
                title="Import properties from Excel"
              >
                <FaFileImport className="text-xs" />
                Import
              </button>

              <button
                onClick={handlePrintList}
                className="px-4 py-1 text-xs bg-slate-700 text-white border border-slate-700 rounded-lg flex items-center gap-2 hover:bg-slate-800 transition-colors shadow-sm"
                title="Print current properties list"
              >
                <FaPrint className="text-xs" />
                Print List
              </button>

              <Link to="/properties/new">
                <button
                  className={`px-4 py-1 text-xs text-white rounded-lg flex items-center gap-2 shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
                >
                  <FaPlus className="text-xs" />
                  Add Property
                </button>
              </Link>

              <button
                onClick={handleExport}
                className="px-4 py-1 text-xs border border-gray-300 rounded-lg flex items-center gap-2 hover:bg-gray-50 transition-colors shadow-sm"
              >
                <FaFileExport className="text-xs" />
                Export
              </button>
            </div>

            {/* Row 2 */}
            <div className="mt-2 grid grid-cols-2 md:grid-cols-5 gap-2">
              <input
                value={draftFilters.code}
                onChange={(e) => setDraftFilters((p) => ({ ...p, code: e.target.value }))}
                onKeyDown={onFilterEnter}
                placeholder="Property Code"
                className="px-3 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] bg-white"
              />
              <input
                value={draftFilters.name}
                onChange={(e) => setDraftFilters((p) => ({ ...p, name: e.target.value }))}
                onKeyDown={onFilterEnter}
                placeholder="Property Name"
                className="px-3 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] bg-white"
              />
              <input
                value={draftFilters.lr}
                onChange={(e) => setDraftFilters((p) => ({ ...p, lr: e.target.value }))}
                onKeyDown={onFilterEnter}
                placeholder="LR Number"
                className="px-3 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] bg-white"
              />
              <select
                value={draftFilters.landlord}
                onChange={(e) => setDraftFilters((p) => ({ ...p, landlord: e.target.value }))}
                onKeyDown={onFilterEnter}
                className="px-3 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] bg-white"
              >
                <option value="">All Landlords</option>
                {landlords && landlords.length > 0 ? (
                  landlords.map((l) => (
                    <option key={l._id || l.id} value={l._id || l.id || ""}>
                      {l.fullName || l.name || l.landlordName || "Unnamed"}
                    </option>
                  ))
                ) : (
                  <option disabled>No landlords available</option>
                )}
              </select>
              <input
                value={draftFilters.location}
                onChange={(e) => setDraftFilters((p) => ({ ...p, location: e.target.value }))}
                onKeyDown={onFilterEnter}
                placeholder="Location"
                className="px-3 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] bg-white"
              />
            </div>
          </div>
        </div>

        {/* Table Card */}
        <div className="flex-1 min-h-0 px-2 pb-2 overflow-hidden">
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm h-full flex flex-col">
            <>
                {/* table scroll area */}
                <div className="overflow-y-auto flex-1 min-h-0">
                  <table
                    className="w-full text-xs border-collapse border border-gray-200 font-bold bg-white"
                    ref={tableRef}
                    style={{ tableLayout: "fixed" }}
                  >
                    <thead>
                      <tr className="sticky top-0 z-10">
                        <th
                          className="px-3 py-1 text-left font-bold text-white border border-gray-200 bg-[#0B3B2E]"
                          style={{ width: "46px" }}
                        >
                          <input
                            type="checkbox"
                            checked={selectAll && (properties || []).length > 0}
                            onChange={handleSelectAll}
                            onClick={handleCheckboxClick}
                            className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                          />
                        </th>

                        <th
                          className="px-3 py-1 text-left font-bold text-white border border-gray-200 bg-[#0B3B2E]"
                          style={{ width: "44px" }}
                        />

                        {columns.map((column) => (
                          <th
                            key={column.key}
                            className="px-3 py-1 text-left font-bold text-white border border-gray-200 bg-[#0B3B2E] whitespace-nowrap"
                          >
                            {column.label}
                          </th>
                        ))}
                      </tr>
                    </thead>

                    <tbody>
                      {properties && properties.length > 0 ? (
                        properties.map((property, index) => (
                          <React.Fragment key={property._id}>
                            <tr
                              className={`border-b border-gray-200 cursor-pointer transition-colors duration-150 ${getRowClass(
                                index,
                                property._id
                              )}`}
                              onClick={(e) => handleRowClick(property._id, e)}
                            >
                              <td className="px-3 py-1 border border-gray-200 align-top" onClick={handleCheckboxClick}>
                                <input
                                  type="checkbox"
                                  checked={selectedProperties.includes(property._id)}
                                  onChange={() => handleSelectProperty(property._id)}
                                  onClick={handleCheckboxClick}
                                  className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                                />
                              </td>

                              <td className="px-1 py-1 border border-gray-200 align-top text-center">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleRowExpand(property._id);
                                  }}
                                  className="p-1 hover:bg-gray-200 rounded transition-colors"
                                  title={expandedRows.includes(property._id) ? "Collapse" : "Expand"}
                                >
                                  {expandedRows.includes(property._id) ? (
                                    <FaChevronUp className="text-gray-600 text-xs" />
                                  ) : (
                                    <FaChevronDown className="text-gray-600 text-xs" />
                                  )}
                                </button>
                              </td>

                              <td className="px-3 py-1 border border-gray-200 align-top truncate">{property.propertyCode}</td>
                              <td className="px-3 py-1 border border-gray-200 align-top truncate">{property.propertyName}</td>
                              <td className="px-3 py-1 border border-gray-200 align-top truncate">
                                {getPrimaryLandlord(property.landlords)}
                              </td>

                              <td className="px-3 py-1 border border-gray-200 align-top">
                                <span
                                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold whitespace-nowrap ${getCategoryColor(
                                    property.propertyType
                                  )}`}
                                >
                                  {property.propertyType || "N/A"}
                                </span>
                              </td>

                              <td className="px-3 py-1 border border-gray-200 align-top truncate">
                                {property.zoneRegion || "N/A"}
                              </td>

                              <td className="px-3 py-1 border border-gray-200 align-top truncate">{getFullAddress(property)}</td>

                              <td className="px-3 py-1 text-center border border-gray-200 align-top">
                                {property.totalUnits || 0}
                              </td>

                              <td className="px-3 py-1 text-center border border-gray-200 align-top">
                                <span className="font-bold text-green-700">{property.occupiedUnits || 0}</span>
                              </td>

                              <td className="px-3 py-1 text-center border border-gray-200 align-top">
                                <span className="font-bold text-red-700">{property.vacantUnits || 0}</span>
                              </td>

                              <td className="px-3 py-1 border border-gray-200 align-top">
                                <span
                                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold whitespace-nowrap ${getStatusColor(
                                    property.status
                                  )}`}
                                >
                                  {property.status || "N/A"}
                                </span>
                              </td>
                            </tr>

                            {expandedRows.includes(property._id) && (
                              <tr className={getRowClass(index, property._id)}>
                                <td colSpan={columns.length + 2} className="p-4 border border-gray-200 bg-gradient-to-br from-white to-gray-50">
                                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                    {/* Property Details */}
                                    <div className="space-y-3 p-3 bg-white rounded-lg shadow-sm border border-gray-100">
                                      <h4 className="font-bold text-gray-900 text-sm mb-3 pb-2 border-b-2 border-[#0B3B2E]">📋 Property Details</h4>
                                      <div>
                                        <span className="text-xs font-semibold text-gray-700">Property Type:</span>
                                        <p className="text-sm font-bold text-gray-900 mt-1">{<property className="propertyCategory"></property> || "N/A"}</p>
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
                                        <p className="text-sm font-bold text-gray-900 mt-1">{formatDate(property.dateAcquired)}</p>
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
                                        <p className="text-sm font-bold text-gray-900 mt-1">{property.accountLedgerType || "N/A"}</p>
                                      </div>
                                      <div>
                                        <span className="text-xs font-semibold text-gray-700">Invoice Prefix:</span>
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
                                          <div key={idx} className="p-2 bg-gray-50 rounded border border-gray-200">
                                            <p className="text-sm font-bold text-gray-900">
                                              {landlord.name} {landlord.isPrimary && "⭐ (Primary)"}
                                            </p>
                                            {landlord.contact && (
                                              <p className="text-xs text-gray-700 font-semibold mt-1">{landlord.contact}</p>
                                            )}
                                          </div>
                                        ))
                                      ) : (
                                        <p className="text-sm text-gray-600 font-semibold">No landlords added</p>
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

                                        <Link
                                          to={`/properties/edit/${property._id}`}
                                          state={{ tabTitle: "Property Details" }}
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <button
                                            className={`px-3 py-2 text-xs text-white rounded-lg flex items-center justify-center gap-2 transition-colors w-full font-bold ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
                                          >
                                            <FaEdit /> Edit Property
                                          </button>
                                        </Link>

                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setShowDeleteConfirm(property._id);
                                          }}
                                          className="px-3 py-2 text-xs bg-red-600 text-white rounded-lg flex items-center justify-center gap-2 hover:bg-red-700 transition-colors w-full font-bold"
                                        >
                                          <FaTrash /> Delete Property
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        ))
                      ) : (
                        <tr>
                          <td
                            colSpan={columns.length + 2}
                            className="px-3 py-4 text-center text-gray-500 border border-gray-200 bg-white"
                          >
                            <div className="flex flex-col items-center justify-center py-8">
                            
                              <div className="text-lg font-bold text-gray-400 mb-2">No properties found</div>
                              <div className="text-sm text-gray-500 mb-4">Use the filter fields above, then click Search</div>
                              <Link to="/properties/new">
                                <button
                                  className={`px-4 py-2 text-white rounded-lg transition-colors ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
                                >
                                  Add New Property
                                </button>
                              </Link>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination footer (Landlords-style inside card) */}
                <div className="flex-shrink-0 sticky bottom-0 z-20 border-t border-gray-200 bg-white">
                  <div className="flex items-center justify-between px-3 py-2">
                    <div className="text-xs text-gray-600">
                      <div className="flex items-center gap-4">
                        <span className="font-bold">
                          Showing{" "}
                          <span className="font-bold">{properties?.length ? (currentPage - 1) * itemsPerPage + 1 : 0}</span>{" "}
                          to{" "}
                          <span className="font-bold">
                            {properties?.length ? Math.min(currentPage * itemsPerPage, pagination?.total || 0) : 0}
                          </span>{" "}
                          of <span className="font-bold">{pagination?.total || 0}</span> properties
                        </span>

                        {selectedProperties.length > 0 && (
                          <span className="bg-[#DDEFE1] text-gray-900 px-2 py-0.5 rounded-full text-xs font-bold border border-[#0B3B2E]/30">
                            {selectedProperties.length} selected
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg flex items-center gap-1 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-bold"
                      >
                        <FaChevronLeft size={10} />
                        Previous
                      </button>

                      <div className="flex items-center gap-1">
                        {[...Array(totalPages)].map((_, i) => {
                          const page = i + 1;
                          if (page === 1 || page === totalPages || (page >= currentPage - 1 && page <= currentPage + 1)) {
                            return (
                              <button
                                key={page}
                                onClick={() => setCurrentPage(page)}
                                className={`px-3 py-1.5 min-w-[32px] text-xs rounded-lg border transition-colors font-bold ${
                                  currentPage === page
                                    ? "bg-[#0B3B2E] text-white border-[#0B3B2E] hover:bg-[#0A3127]"
                                    : "border-gray-300 hover:bg-gray-50"
                                }`}
                              >
                                {page}
                              </button>
                            );
                          }
                          if (page === currentPage - 2 || page === currentPage + 2) {
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
                        disabled={currentPage === totalPages}
                        className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg flex items-center gap-1 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-bold"
                      >
                        Next
                        <FaChevronRight size={10} />
                      </button>
                    </div>
                  </div>
                </div>
            </>
          </div>
        </div>

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-md flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg p-6 max-w-md w-full mx-auto shadow-xl">
              <h3 className="text-lg font-bold text-gray-800 mb-2">Confirm Delete</h3>
              <p className="text-gray-600 mb-6">Are you sure you want to delete this property? This action cannot be undone.</p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(null)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDelete(showDeleteConfirm)}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  Delete Property
                </button>
              </div>
            </div>
          </div>
        )}

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
        <PropertyImportModal
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
          onImport={handleBulkImport}
        />
      </div>
    </DashboardLayout>
  );
};

export default Properties;