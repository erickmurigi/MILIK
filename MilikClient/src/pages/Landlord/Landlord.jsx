// pages/Landlord/Landlord.jsx
import React, { useMemo, useRef, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import {
  FaPlus,
  FaSearch,
  FaFileExport,
  FaEllipsisH,
  FaChevronLeft,
  FaChevronRight,
  FaGripVertical,
  FaTimes,
  FaSave,
  FaPaperclip,
  FaDownload as FaDownloadIcon,
  FaTrash,
  FaTrashAlt,
  FaEdit,
  FaRedoAlt,
  FaArchive,
  FaUndo,
  FaChevronDown,
  FaMoneyBillWave,
  FaFileImport,
  FaFileDownload,
  FaSms,
  FaPrint,
} from "react-icons/fa";
import { getLandlords, deleteLandlord, updateLandlord } from "../../redux/apiCalls";
import MilikConfirmDialog from "../../components/Modals/MilikConfirmDialog";
import LandlordImportModal from "../../components/Modals/LandlordImportModal";
import CommunicationComposerModal from "../../components/Communications/CommunicationComposerModal";
import { downloadLandlordsTemplate, exportLandlordsToExcel } from "../../utils/excelTemplates";
import { toast } from "react-toastify";
import { adminRequests } from "../../utils/requestMethods";
import { printTabularList } from "../../utils/printList";

const STORAGE_KEY = "milik_landlords_v1";
const ITEMS_PER_PAGE = 50;

const MILIK_GREEN = "bg-[#0B3B2E]"; // deep MILIK-ish green
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";
const MILIK_ORANGE = "bg-[#FF8C00]";
const MILIK_ORANGE_HOVER = "hover:bg-[#e67e00]";

const Landlords = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  
  // Redux state
  const landlordState = useSelector((state) => state.landlord);
  const landlords = landlordState?.landlords || [];
  const isFetching = landlordState?.isFetching || false;
  const { currentCompany } = useSelector((state) => state.company);
  
  // Table + UI state
  const [selectedLandlords, setSelectedLandlords] = useState([]);
  const [selectAll, setSelectAll] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [isResizing, setIsResizing] = useState(false);

  // Modals (keeping edit mode for future edit functionality)
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showCommunicationModal, setShowCommunicationModal] = useState(false);

  // ---- NEW: Draft filters (typed) + Applied filters (used for searching) ----
  const emptyFilters = {
    status: "Active", // Active default
    portal: "any", // any | Enabled | Disabled
    propsCount: "any", // any | 1-5 | 6-10 | 10+
    location: "any",

    code: "",
    name: "",
    regId: "",
    pin: "",
    email: "",
    phone: "",
  };

  const [draftFilters, setDraftFilters] = useState(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState(emptyFilters);

  // Milik Confirm Dialog
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    title: "",
    message: "",
    confirmText: "Confirm",
    cancelText: "Cancel",
    isDangerous: false,
    onConfirm: null,
  });

  // Dropdown (Archive/Restore)
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const actionMenuRef = useRef(null);

  // Column widths (FIXED KEYS)
  const [columnWidths, setColumnWidths] = useState({
    code: 120,
    name: 220,
    status: 110,
    regId: 150,
    address: 220,
    location: 160,
    email: 220,
    phone: 160,
    active: 140,
    archived: 160,
    portal: 140,
  });

  const resizingRef = useRef(null);
  const tableRef = useRef(null);

  const columns = useMemo(
    () => [
      { key: "code", label: "Landlord Code" },
      { key: "name", label: "Landlord Name" },
      { key: "status", label: "Status" },
      { key: "location", label: "Location" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone Nos." },
      { key: "active", label: "Active Properties" },
      { key: "archived", label: "Archived Properties" },
      { key: "portal", label: "Portal Access" },
    ],
    []
  );

  // Fetch landlords from backend on mount / company change
  useEffect(() => {
    dispatch(
      getLandlords(
        currentCompany?._id
          ? { company: currentCompany._id }
          : {}
      )
    );
  }, [dispatch, currentCompany?._id]);

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
  useEffect(() => {
    setSelectAll(false);
  }, [currentPage]);

  // Drop any selected ids that no longer exist after refresh/delete
  useEffect(() => {
    const validIds = new Set(landlords.map((l) => l._id));
    setSelectedLandlords((prev) => prev.filter((id) => validIds.has(id)));
  }, [landlords]);

  const normalize = (v) => String(v ?? "").toLowerCase().trim();

  const uniqueLocations = useMemo(() => {
    const set = new Set();
    landlords.forEach((l) => {
      if (l.location) set.add(l.location);
    });
    return ["any", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [landlords]);

  // --- APPLY SEARCH (button) ---
  const applySearch = () => {
    setAppliedFilters({
      ...draftFilters,
      code: draftFilters.code.trim(),
      name: draftFilters.name.trim(),
      regId: draftFilters.regId.trim(),
      pin: draftFilters.pin.trim(),
      email: draftFilters.email.trim(),
      phone: draftFilters.phone.trim(),
    });
    setCurrentPage(1);
    setSelectedLandlords([]);
    setSelectAll(false);
  };

  const resetFilters = () => {
    setDraftFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    setSelectedLandlords([]);
    setSelectAll(false);
    setCurrentPage(1);
    setActionMenuOpen(false);

    dispatch(
      getLandlords(
        currentCompany?._id
          ? { company: currentCompany._id }
          : {}
      )
    );
  };

  const onFilterEnter = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applySearch();
    }
  };

  // --- FILTER LOGIC (uses appliedFilters only) ---
  const matchesText = (fieldValue, query) => {
    const q = normalize(query);
    if (!q) return true;
    return normalize(fieldValue).includes(q);
  };

  const matchesPortal = (l) => {
    if (appliedFilters.portal === "any") return true;
    return String(l.portalAccess) === appliedFilters.portal;
  };

  const matchesLocation = (l) => {
    if (appliedFilters.location === "any") return true;
    return String(l.location) === appliedFilters.location;
  };

  const matchesStatus = (l) => {
    if (appliedFilters.status === "any") return true;
    return String(l.status || "Active") === appliedFilters.status;
  };

  const matchesPropertiesCount = (l) => {
    if (appliedFilters.propsCount === "any") return true;
    const n = Number(l.activeProperties || 0);
    if (Number.isNaN(n)) return false;

    if (appliedFilters.propsCount === "1-5") return n >= 1 && n <= 5;
    if (appliedFilters.propsCount === "6-10") return n >= 6 && n <= 10;
    if (appliedFilters.propsCount === "10+") return n >= 11;
    return true;
  };

  const matchesTypedFields = (l) => {
    return (
      matchesText(l.landlordCode || l.code, appliedFilters.code) &&
      matchesText(l.landlordName || l.name, appliedFilters.name) &&
      matchesText(l.regId, appliedFilters.regId) &&
      matchesText(l.taxPin || l.pin, appliedFilters.pin) &&
      matchesText(l.email, appliedFilters.email) &&
      matchesText(l.phoneNumber || l.phone, appliedFilters.phone)
    );
  };

  const filteredLandlords = useMemo(() => {
    return landlords.filter(
      (l) =>
        matchesTypedFields(l) &&
        matchesStatus(l) &&
        matchesPortal(l) &&
        matchesLocation(l) &&
        matchesPropertiesCount(l)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landlords, appliedFilters]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredLandlords.length / ITEMS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const startIndex = (safeCurrentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentLandlords = filteredLandlords.slice(startIndex, endIndex);

  // Ensure currentPage doesn't exceed totalPages after filtering
  useEffect(() => {
    if (currentPage !== safeCurrentPage) setCurrentPage(safeCurrentPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalPages]);

  // Selection
  const handleSelectLandlord = (id) => {
    setSelectedLandlords((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSelectAll = () => {
    if (selectAll) {
      const currentIds = currentLandlords.map((l) => l._id);
      setSelectedLandlords((prev) => prev.filter((id) => !currentIds.includes(id)));
      setSelectAll(false);
    } else {
      const currentIds = currentLandlords.map((l) => l._id);
      setSelectedLandlords((prev) => Array.from(new Set([...prev, ...currentIds])));
      setSelectAll(true);
    }
  };

  const handleCheckboxClick = (e) => e.stopPropagation();

  // Zebra + selection styling
  const getRowClass = (index, landlordId) => {
    if (selectedLandlords.includes(landlordId)) return "bg-[#CDE7D3] hover:bg-[#DFF1E3]";
    return index % 2 === 0 ? "bg-white hover:bg-[#f8f8f8]" : "bg-[#f9f9f9] hover:bg-[#f0f0f0]";
  };

  // Column resizing
  const startResizing = (columnKey, e) => {
    e.preventDefault();
    setIsResizing(true);

    const startWidth = columnWidths[columnKey] ?? 140;

    resizingRef.current = {
      columnKey,
      startX: e.clientX,
      startWidth,
    };

    const handleMouseMove = (evt) => {
      if (!resizingRef.current) return;
      const { columnKey: ck, startX, startWidth } = resizingRef.current;
      const diff = evt.clientX - startX;
      const newWidth = Math.max(80, startWidth + diff);

      setColumnWidths((prev) => ({
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

  const goToPage = (page) => {
    if (page >= 1 && page <= totalPages) setCurrentPage(page);
  };

  // Delete selected landlords
  const deleteSelected = async () => {
    if (selectedLandlords.length === 0) return;
    
    const isSingleDelete = selectedLandlords.length === 1;
    setConfirmDialog({
      isOpen: true,
      title: isSingleDelete ? "Delete Landlord" : "Delete Landlords",
      message: isSingleDelete
        ? "Are you sure you want to delete this landlord? This action cannot be undone."
        : `Are you sure you want to delete ${selectedLandlords.length} landlords? This action cannot be undone.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      isDangerous: true,
      onConfirm: async () => {
        try {
          for (const id of selectedLandlords) {
            await dispatch(deleteLandlord(id));
          }
          await dispatch(
            getLandlords(
              currentCompany?._id
                ? { company: currentCompany._id }
                : {}
            )
          );
          setSelectedLandlords([]);
          setSelectAll(false);
          setCurrentPage(1);
          setConfirmDialog(prev => ({ ...prev, isOpen: false }));
        } catch (err) {
          console.error('Delete error:', err);
          setConfirmDialog({
            isOpen: true,
            title: "Delete Failed",
            message: err?.response?.data?.message || err?.message || "Failed to delete landlord(s)",
            confirmText: "OK",
            cancelText: "Close",
            isDangerous: false,
            onConfirm: () => setConfirmDialog((prev) => ({ ...prev, isOpen: false })),
          });
        }
      },
    });
  };

  const archiveSelected = () => {
    if (selectedLandlords.length === 0) return;
    setActionMenuOpen(false);

    const selectedRows = landlords.filter((l) => selectedLandlords.includes(l._id));
    const toArchive = selectedRows.filter((l) => String(l.status || "Active") !== "Archived");

    if (toArchive.length === 0) {
      setConfirmDialog({
        isOpen: true,
        title: "Nothing to Archive",
        message: "All selected landlords are already archived.",
        confirmText: "OK",
        cancelText: "Close",
        isDangerous: false,
        onConfirm: () => setConfirmDialog((prev) => ({ ...prev, isOpen: false })),
      });
      return;
    }

    setConfirmDialog({
      isOpen: true,
      title: toArchive.length === 1 ? "Archive Landlord" : "Archive Landlords",
      message:
        toArchive.length === 1
          ? "Are you sure you want to archive this landlord?"
          : `Are you sure you want to archive ${toArchive.length} landlords?`,
      confirmText: "Archive",
      cancelText: "Cancel",
      isDangerous: false,
      onConfirm: async () => {
        try {
          for (const landlord of toArchive) {
            await dispatch(updateLandlord(landlord._id, { status: "Archived" }));
          }
          await dispatch(
            getLandlords(
              currentCompany?._id
                ? { company: currentCompany._id }
                : {}
            )
          );
          setSelectedLandlords([]);
          setSelectAll(false);
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        } catch (err) {
          console.error("Archive error:", err);
          setConfirmDialog({
            isOpen: true,
            title: "Archive Failed",
            message: err?.response?.data?.message || err?.message || "Failed to archive landlord(s)",
            confirmText: "OK",
            cancelText: "Close",
            isDangerous: false,
            onConfirm: () => setConfirmDialog((prev) => ({ ...prev, isOpen: false })),
          });
        }
      },
    });
  };

  const restoreSelected = () => {
    if (selectedLandlords.length === 0) return;
    setActionMenuOpen(false);

    const selectedRows = landlords.filter((l) => selectedLandlords.includes(l._id));
    const toRestore = selectedRows.filter((l) => String(l.status || "Active") === "Archived");

    if (toRestore.length === 0) {
      setConfirmDialog({
        isOpen: true,
        title: "Nothing to Restore",
        message: "Select at least one archived landlord to restore.",
        confirmText: "OK",
        cancelText: "Close",
        isDangerous: false,
        onConfirm: () => setConfirmDialog((prev) => ({ ...prev, isOpen: false })),
      });
      return;
    }

    setConfirmDialog({
      isOpen: true,
      title: toRestore.length === 1 ? "Restore Landlord" : "Restore Landlords",
      message:
        toRestore.length === 1
          ? "Are you sure you want to restore this landlord?"
          : `Are you sure you want to restore ${toRestore.length} landlords?`,
      confirmText: "Restore",
      cancelText: "Cancel",
      isDangerous: false,
      onConfirm: async () => {
        try {
          for (const landlord of toRestore) {
            await dispatch(updateLandlord(landlord._id, { status: "Active" }));
          }
          await dispatch(
            getLandlords(
              currentCompany?._id
                ? { company: currentCompany._id }
                : {}
            )
          );
          setSelectedLandlords([]);
          setSelectAll(false);
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        } catch (err) {
          console.error("Restore error:", err);
          setConfirmDialog({
            isOpen: true,
            title: "Restore Failed",
            message: err?.response?.data?.message || err?.message || "Failed to restore landlord(s)",
            confirmText: "OK",
            cancelText: "Close",
            isDangerous: false,
            onConfirm: () => setConfirmDialog((prev) => ({ ...prev, isOpen: false })),
          });
        }
      },
    });
  };

  // --- MODAL / FORM ---
  const openAddModal = () => {
    navigate('/landlords/new');
  };

  const openEditModal = () => {
    if (selectedLandlords.length !== 1) return;
    const id = selectedLandlords[0];
    const l = landlords.find((x) => x._id === id || x.id === id);
    if (!l) return;

    navigate('/landlords/new', {
      state: {
        mode: 'edit',
        tabTitle: 'Landlord Details',
        landlordId: l._id || l.id,
        landlordData: l,
      },
    });
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files || []);
    const newAttachments = files.map((file) => ({
      id: Date.now() + Math.random(),
      name: file.name,
      size: formatFileSize(file.size),
      dateTime: new Date().toLocaleString(),
      file,
    }));
    setAttachments((prev) => [...prev, ...newAttachments]);
    e.target.value = "";
  };

  const handleDownload = (attachment) => {
    if (!attachment?.file) return;
    const url = URL.createObjectURL(attachment.file);
    const a = document.createElement("a");
    a.href = url;
    a.download = attachment.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDeleteAttachment = (id) => {
    setAttachments((prev) => prev.filter((att) => att.id !== id));
  };

  const nextCode = () => {
    const codes = landlords
      .map((l) => String(l.code || ""))
      .filter((c) => /^LL\d{3,}$/i.test(c))
      .map((c) => Number(c.replace(/[^0-9]/g, "")))
      .filter((n) => !Number.isNaN(n));

    const max = codes.length ? Math.max(...codes) : 0;
    const next = max + 1;
    return `LL${String(next).padStart(3, "0")}`;
  };

  const handleAddOrEditSubmit = (e) => {
    e.preventDefault();

    const landlordCode = formData.landlordCode?.trim() || nextCode();

    if (!formData.landlordName?.trim()) return;
    if (!formData.regId?.trim()) return;
    if (!formData.taxPin?.trim()) return;
    if (!formData.phoneNumber?.trim()) return;

    const payload = {
      id: isEditMode ? editingId : Date.now(),
      code: landlordCode,
      name: formData.landlordName.trim(),
      pin: formData.taxPin.trim(),
      regId: formData.regId.trim(),
      address: formData.postalAddress?.trim() || "",
      location: formData.location?.trim() || "",
      email: formData.email?.trim() || "",
      phone: formData.phoneNumber?.trim() || "",
      activeProperties: String(
        Number.isFinite(Number((landlords.find((x) => x.id === editingId) || {}).activeProperties))
          ? (landlords.find((x) => x.id === editingId) || {}).activeProperties
          : 0
      ),
      archivedProperties: String(
        Number.isFinite(Number((landlords.find((x) => x.id === editingId) || {}).archivedProperties))
          ? (landlords.find((x) => x.id === editingId) || {}).archivedProperties
          : 0
      ),
      portalAccess: formData.portalAccess || "Disabled",
      status: formData.status || "Active",
      landlordType: formData.landlordType,
      attachments: attachments.map(({ id, name, size, dateTime }) => ({ id, name, size, dateTime })),
      updatedAt: new Date().toISOString(),
      ...(isEditMode ? {} : { createdAt: new Date().toISOString() }),
    };

    setLandlords((prev) => {
      if (!isEditMode) return [payload, ...prev];
      return prev.map((x) => (x.id === editingId ? { ...x, ...payload } : x));
    });

    setShowAddLandlordModal(false);
    setIsEditMode(false);
    setEditingId(null);
    setAttachments([]);
    setFormData({
      landlordCode: "",
      landlordType: "Individual",
      landlordName: "",
      regId: "",
      taxPin: "",
      postalAddress: "",
      email: "",
      phoneNumber: "",
      location: "",
      portalAccess: "Disabled",
      status: "Active",
    });

    setCurrentPage(1);
  };

  const selectedCount = selectedLandlords.length;
  const canEdit = selectedCount === 1;

  // Excel Import Handler
  const handleBulkImport = async (landlords) => {
    try {
      console.log('Starting bulk import...', { count: landlords.length, company: currentCompany?._id });
      
      if (!currentCompany?._id) {
        throw new Error('No company selected. Please ensure you are logged in.');
      }

      // Call backend bulk import endpoint
      const response = await adminRequests.post('/landlords/bulk-import', {
        landlords,
        business: currentCompany._id
      });

      console.log('Bulk import response:', response.data);

      // Refresh landlords list (getLandlords expects 'company' not 'business')
      await dispatch(getLandlords({ company: currentCompany._id }));

      console.log('Landlords list refreshed');

      // Return the result data for the modal
      return response.data;
    } catch (error) {
      console.error('Bulk import error:', error);
      const errorMessage = error?.response?.data?.message || error?.message || 'Failed to import landlords';
      throw new Error(errorMessage);
    }
  };

  // Handle export to Excel
  const handleExport = () => {
    if (filteredLandlords.length === 0) {
      toast.warning('No landlords to export');
      return;
    }
    exportLandlordsToExcel(filteredLandlords);
    toast.success(`Exported ${filteredLandlords.length} landlords to Excel`);
  };

  const handlePrintList = () => {
    if (filteredLandlords.length === 0) {
      toast.warning("No landlords to print");
      return;
    }

    printTabularList({
      title: "Landlords List",
      subtitle: "Current filtered landlords register",
      company: currentCompany || {},
      summary: `Records: ${filteredLandlords.length} • Printed on ${new Date().toLocaleString()}`,
      columns: [
        { label: "Landlord Code", value: (row) => row?.landlordCode || row?.code || "-" },
        { label: "Landlord Name", value: (row) => row?.name || row?.landlordName || "-" },
        { label: "Status", value: (row) => row?.status || "Active" },
        { label: "Location", value: (row) => row?.location || "-" },
        { label: "Email", value: (row) => row?.email || "-" },
        { label: "Phone", value: (row) => row?.phone || row?.phoneNumber || "-" },
      ],
      rows: filteredLandlords,
    });
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex flex-col h-full min-h-0 bg-white overflow-hidden">
        {/* Filters Row */}
        <div className="flex-shrink-0 sticky top-0 z-30 bg-white pt-2 px-2">
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-2">
            {/* Row 1: dropdown filters */}
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={draftFilters.status}
                onChange={(e) => setDraftFilters((p) => ({ ...p, status: e.target.value }))}
                className="px-3 py-1 text-xs border border-gray-300 rounded shadow-sm focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] bg-[#DDEFE1] text-gray-800 hover:bg-white transition-colors"
              >
                <option value="Active">Active</option>
                <option value="any">All Status</option>
                <option value="Archived">Archived</option>
              </select>

              <select
                value={draftFilters.portal}
                onChange={(e) => setDraftFilters((p) => ({ ...p, portal: e.target.value }))}
                className="px-3 py-1 text-xs border border-gray-300 rounded shadow-sm focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] bg-[#DDEFE1] text-gray-800 hover:bg-white transition-colors"
              >
                <option value="any">Portal Access</option>
                <option value="Enabled">Enabled</option>
                <option value="Disabled">Disabled</option>
              </select>

              <select
                value={draftFilters.propsCount}
                onChange={(e) => setDraftFilters((p) => ({ ...p, propsCount: e.target.value }))}
                className="px-3 py-1 text-xs border border-gray-300 rounded shadow-sm focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] bg-[#DDEFE1] text-gray-800 hover:bg-white transition-colors"
              >
                <option value="any">Properties Count</option>
                <option value="1-5">1-5 Properties</option>
                <option value="6-10">6-10 Properties</option>
                <option value="10+">10+ Properties</option>
              </select>

              <select
                value={draftFilters.location}
                onChange={(e) => setDraftFilters((p) => ({ ...p, location: e.target.value }))}
                className="px-3 py-1 text-xs border border-gray-300 rounded shadow-sm focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] bg-[#DDEFE1] text-gray-800 hover:bg-white transition-colors"
              >
                {uniqueLocations.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc === "any" ? "Location" : loc}
                  </option>
                ))}
              </select>

              {/* Search button */}
              <button
                onClick={applySearch}
                className={`px-4 py-1 text-xs text-white rounded-lg flex items-center gap-2 shadow-sm ${MILIK_ORANGE} ${MILIK_ORANGE_HOVER}`}
                title="Search using the fields"
              >
                <FaSearch className="text-xs" />
                Search
              </button>

              {/* Reset */}
              <button
                onClick={resetFilters}
                className={`px-4 py-1 text-xs text-white rounded-lg flex items-center gap-2 shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
                title="Reset filters and selection"
              >
                <FaRedoAlt className="text-xs" />
                Reset
              </button>

              {/* Edit */}
              <button
                onClick={openEditModal}
                disabled={!canEdit}
                className={`px-4 py-1 text-xs text-white rounded-lg flex items-center gap-2 shadow-sm ${
                  canEdit ? `${MILIK_GREEN} ${MILIK_GREEN_HOVER}` : "bg-gray-400 cursor-not-allowed"
                }`}
                title={canEdit ? "Edit selected landlord" : "Select exactly 1 landlord to edit"}
              >
                <FaEdit className="text-xs" />
                Edit
              </button>

              {/* Archive / Restore dropdown */}
              <div className="relative" ref={actionMenuRef}>
                <button
                  onClick={() => setActionMenuOpen((v) => !v)}
                  disabled={selectedCount === 0}
                  className={`px-4 py-1 text-xs text-white rounded-lg flex items-center gap-2 shadow-sm ${
                    selectedCount > 0 ? `${MILIK_GREEN} ${MILIK_GREEN_HOVER}` : "bg-gray-400 cursor-not-allowed"
                  }`}
                  title={selectedCount ? "Archive/Restore selected landlord(s)" : "Select landlord(s) first"}
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
                onClick={() => setShowCommunicationModal(true)}
                disabled={selectedCount === 0}
                className={`px-4 py-1 text-xs text-white rounded-lg flex items-center gap-2 shadow-sm ${
                  selectedCount > 0 ? `${MILIK_ORANGE} ${MILIK_ORANGE_HOVER}` : "bg-gray-400 cursor-not-allowed"
                }`}
                title={selectedCount ? "SMS selected landlord(s)" : "Select landlord(s) first"}
              >
                <FaSms className="text-xs" />
                SMS Selected Landlords
              </button>

              {/* Delete */}
              <button
                onClick={deleteSelected}
                disabled={selectedCount === 0}
                className={`px-4 py-1 text-xs text-white rounded-lg flex items-center gap-2 shadow-sm ${
                  selectedCount > 0 ? "bg-red-600 hover:bg-red-700" : "bg-gray-400 cursor-not-allowed"
                }`}
                title={selectedCount ? "Delete selected landlord(s)" : "Select landlord(s) to delete"}
              >
                <FaTrash className="text-xs" />
                Delete
              </button>

              {/* Existing actions */}
              <button
                onClick={openAddModal}
                className={`px-4 py-1 text-xs text-white rounded-lg flex items-center gap-2 shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
              >
                <FaPlus className="text-xs" />
                <span>Add Landlord</span>
              </button>

              {/* View Payments */}
              <button
                onClick={() => navigate("/landlord-payments")}
                className={`px-4 py-1 text-xs text-white rounded-lg flex items-center gap-2 shadow-sm ${MILIK_ORANGE} ${MILIK_ORANGE_HOVER}`}
                title="View landlord payments"
              >
                <FaMoneyBillWave className="text-xs" />
                <span>Payments</span>
              </button>

              {/* Download Template */}
              <button 
                onClick={() => downloadLandlordsTemplate()}
                className="px-4 py-1 text-xs border border-gray-300 bg-blue-50 text-blue-700 rounded-lg flex items-center gap-2 hover:bg-blue-100 transition-colors shadow-sm"
                title="Download Excel template for bulk import"
              >
                <FaFileDownload className="text-xs" />
                <span>Template</span>
              </button>

              {/* Import */}
              <button 
                onClick={() => setShowImportModal(true)}
                className="px-4 py-1 text-xs border border-gray-300 bg-green-50 text-green-700 rounded-lg flex items-center gap-2 hover:bg-green-100 transition-colors shadow-sm"
                title="Import landlords from Excel"
              >
                <FaFileImport className="text-xs" />
                <span>Import</span>
              </button>

              <button
                onClick={handlePrintList}
                className="px-4 py-1 text-xs border border-gray-300 rounded-lg flex items-center gap-2 hover:bg-gray-50 transition-colors shadow-sm"
                title="Print current landlords list"
              >
                <FaPrint className="text-xs" />
                <span>Print List</span>
              </button>

              {/* Export */}
              <button 
                onClick={handleExport}
                className="px-4 py-1 text-xs border border-gray-300 rounded-lg flex items-center gap-2 hover:bg-gray-50 transition-colors shadow-sm"
                title="Export current landlords to Excel"
              >
                <FaFileExport className="text-xs" />
                <span>Export</span>
              </button>

              <button className="px-4 py-1 text-xs border border-gray-300 rounded-lg flex items-center gap-2 hover:bg-gray-50 transition-colors shadow-sm">
                <FaEllipsisH className="text-xs" />
                <span>
                  <strong></strong>More
                </span>
              </button>
            </div>

            {/* Row 2: typed fields */}
            <div className="mt-2 grid grid-cols-2 md:grid-cols-6 gap-2">
              <input
                value={draftFilters.code}
                onChange={(e) => setDraftFilters((p) => ({ ...p, code: e.target.value }))}
                onKeyDown={onFilterEnter}
                placeholder="Landlord Code"
                className="px-3 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] bg-white"
              />
              <input
                value={draftFilters.name}
                onChange={(e) => setDraftFilters((p) => ({ ...p, name: e.target.value }))}
                onKeyDown={onFilterEnter}
                placeholder="Landlord Name"
                className="px-3 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] bg-white"
              />
              <input
                value={draftFilters.regId}
                onChange={(e) => setDraftFilters((p) => ({ ...p, regId: e.target.value }))}
                onKeyDown={onFilterEnter}
                placeholder="Reg/ID No."
                className="px-3 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] bg-white"
              />
              <input
                value={draftFilters.email}
                onChange={(e) => setDraftFilters((p) => ({ ...p, email: e.target.value }))}
                onKeyDown={onFilterEnter}
                placeholder="Email"
                className="px-3 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] bg-white"
              />
              <input
                value={draftFilters.phone}
                onChange={(e) => setDraftFilters((p) => ({ ...p, phone: e.target.value }))}
                onKeyDown={onFilterEnter}
                placeholder="Phone"
                className="px-3 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] bg-white"
              />
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 min-h-0 px-2 pb-2 overflow-hidden">
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm h-full flex flex-col">
            {/* Make THIS the scroll area so the footer stays visible */}
            <div className="overflow-x-auto overflow-y-auto flex-1 min-h-0">
              <table
                className="min-w-full text-xs border-collapse border border-gray-200 font-bold bg-white"
                ref={tableRef}
                style={{ tableLayout: "fixed" }}
              >
                <thead>
                  <tr className="sticky top-0 z-10">
                    <th
                      className="px-3 py-1 text-left font-bold text-white border border-gray-200 bg-[#0B3B2E]"
                      style={{ width: "50px", minWidth: "50px", maxWidth: "50px" }}
                    >
                      <input
                        type="checkbox"
                        checked={selectAll && currentLandlords.length > 0}
                        onChange={handleSelectAll}
                        onClick={handleCheckboxClick}
                        className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                      />
                    </th>

                    {columns.map((column) => {
                      const width = columnWidths[column.key] ?? 140;
                      return (
                        <th
                          key={column.key}
                          className="relative px-3 py-1 text-left font-bold text-white border border-gray-200 bg-[#0B3B2E]"
                          style={{
                            width: `${width}px`,
                            minWidth: "80px",
                            position: "relative",
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <span className="truncate">{column.label}</span>
                            <div
                              className="w-2 h-4 ml-1 cursor-col-resize hover:bg-white/20 flex items-center justify-center rounded"
                              onMouseDown={(e) => startResizing(column.key, e)}
                              title="Drag to resize"
                            >
                              <FaGripVertical className="text-white/70 text-xs" />
                            </div>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>

                <tbody>
                  {isFetching ? (
                    <tr>
                      <td
                        colSpan={columns.length + 1}
                        className="px-3 py-4 text-center text-gray-500 border border-gray-200 bg-white"
                      >
                        <div className="flex flex-col items-center justify-center py-8">
                          <div className="text-lg font-bold text-gray-400 mb-2">Loading landlords...</div>
                        </div>
                      </td>
                    </tr>
                  ) : currentLandlords.length > 0 ? (
                    currentLandlords.map((landlord, index) => (
                      <tr
                        key={landlord._id}
                        className={`border-b border-gray-200 cursor-pointer transition-colors duration-150 ${getRowClass(
                          index,
                          landlord._id
                        )}`}
                        onClick={() => handleSelectLandlord(landlord._id)}
                      >
                        <td
                          className="px-3 py-1 border border-gray-200 align-top"
                          style={{ width: "50px", minWidth: "50px", maxWidth: "50px" }}
                          onClick={handleCheckboxClick}
                        >
                          <input
                            type="checkbox"
                            checked={selectedLandlords.includes(landlord._id)}
                            onChange={() => handleSelectLandlord(landlord._id)}
                            onClick={handleCheckboxClick}
                            className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                          />
                        </td>

                        <td className="px-3 py-1 font-bold text-gray-900 border border-gray-200 align-top whitespace-nowrap overflow-hidden text-ellipsis">
                          {landlord.landlordCode || landlord.code}
                        </td>
                        <td className="px-3 py-1 font-bold text-gray-900 border border-gray-200 align-top whitespace-nowrap overflow-hidden text-ellipsis">
                          {landlord.landlordName || landlord.name}
                        </td>

                        <td className="px-3 py-1 border border-gray-200 align-top">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold whitespace-nowrap border ${
                              String(landlord.status || "Active") === "Active"
                                ? selectedLandlords.includes(landlord._id)
                                  ? "bg-white text-green-800 border-green-300"
                                  : "bg-green-100 text-green-800 border-green-300"
                                : selectedLandlords.includes(landlord._id)
                                ? "bg-white text-gray-800 border-gray-300"
                                : "bg-gray-100 text-gray-800 border-gray-300"
                            }`}
                          >
                            {landlord.status || "Active"}
                          </span>
                        </td>

                        <td className="px-3 py-1 font-bold text-gray-900 border border-gray-200 align-top whitespace-nowrap overflow-hidden text-ellipsis">
                          {landlord.location || "—"}
                        </td>
                        <td className="px-3 py-1 font-bold text-gray-900 border border-gray-200 align-top whitespace-nowrap overflow-hidden text-ellipsis">
                          {landlord.email || "—"}
                        </td>
                        <td className="px-3 py-1 font-bold text-gray-900 border border-gray-200 align-top whitespace-nowrap overflow-hidden text-ellipsis">
                          {landlord.phoneNumber || landlord.phone || "—"}
                        </td>

                        <td className="px-3 py-1 text-center font-bold text-gray-900 border border-gray-200 align-top">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${
                              selectedLandlords.includes(landlord._id)
                                ? "bg-white text-green-800 border-green-300"
                                : "bg-green-100 text-green-800 border-green-300"
                            }`}
                          >
                            {landlord.activeProperties ?? "0"}
                          </span>
                        </td>

                        <td className="px-3 py-1 text-center font-bold text-gray-900 border border-gray-200 align-top">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${
                              selectedLandlords.includes(landlord._id)
                                ? "bg-white text-gray-800 border-gray-300"
                                : "bg-gray-100 text-gray-800 border-gray-300"
                            }`}
                          >
                            {landlord.archivedProperties ?? "0"}
                          </span>
                        </td>

                        <td className="px-3 py-1 border border-gray-200 align-top">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold whitespace-nowrap border ${
                              landlord.portalAccess === "Enabled"
                                ? selectedLandlords.includes(landlord._id)
                                  ? "bg-white text-green-800 border-green-300"
                                  : "bg-green-100 text-green-800 border-green-300"
                                : selectedLandlords.includes(landlord._id)
                                ? "bg-white text-gray-800 border-gray-300"
                                : "bg-gray-100 text-gray-800 border-gray-300"
                            }`}
                          >
                            {landlord.portalAccess || "Disabled"}
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={columns.length + 1}
                        className="px-3 py-4 text-center text-gray-500 border border-gray-200 bg-white"
                      >
                        <div className="flex flex-col items-center justify-center py-8">
                          <div className="text-lg font-bold text-gray-400 mb-2">No landlords found</div>
                          <div className="text-sm text-gray-500">Use the filter fields above, then click Search</div>
                          <button
                            onClick={openAddModal}
                            className={`px-4 py-1 text-xs text-white rounded-lg flex items-center gap-2 shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
                            title="Add your first landlord"
                          >
                            <FaPlus className="text-xs" />
                            <span>Add New Landlord</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Footer (STICKY bottom inside the card) */}
            <div className="sticky bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-20 shadow-sm">
              <div className="flex items-center justify-between px-3 py-2">
                <div className="text-xs text-gray-600">
                  <div className="flex items-center gap-4">
                    <span className="font-bold">
                      Showing{" "}
                      <span className="font-bold">{filteredLandlords.length === 0 ? 0 : startIndex + 1}</span> to{" "}
                      <span className="font-bold">{Math.min(endIndex, filteredLandlords.length)}</span> of{" "}
                      <span className="font-bold">{filteredLandlords.length}</span> landlords
                    </span>

                    {selectedLandlords.length > 0 && (
                      <span className="bg-[#DDEFE1] text-gray-900 px-2 py-0.5 rounded-full text-xs font-bold border border-[#0B3B2E]/30">
                        {selectedLandlords.length} selected
                      </span>
                    )}
                  </div>
                </div>

                {/* Pagination */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => goToPage(safeCurrentPage - 1)}
                    disabled={safeCurrentPage === 1}
                    className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg flex items-center gap-1 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-bold"
                  >
                    <FaChevronLeft size={10} />
                    Previous
                  </button>

                  <div className="flex items-center gap-1">
                    {[...Array(totalPages)].map((_, i) => {
                      const page = i + 1;
                      if (
                        page === 1 ||
                        page === totalPages ||
                        (page >= safeCurrentPage - 1 && page <= safeCurrentPage + 1)
                      ) {
                        return (
                          <button
                            key={page}
                            onClick={() => goToPage(page)}
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
                    onClick={() => goToPage(safeCurrentPage + 1)}
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

        {/* TODO: Edit Landlord Modal (will be converted to separate page later) */}
        {/* Temporarily disabled - edit functionality will use a dedicated page like Add */}

        <CommunicationComposerModal
          open={showCommunicationModal}
          onClose={() => setShowCommunicationModal(false)}
          businessId={currentCompany?._id || ""}
          contextType="landlord_bulk"
          recordIds={selectedLandlords}
          title="SMS Selected Landlords"
          subtitle="Choose a landlord template, preview the final message, then send."
          allowedChannels={["sms"]}
          defaultChannel="sms"
        />

        {/* Milik Confirm Dialog */}
        <MilikConfirmDialog
          isOpen={confirmDialog.isOpen}
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmText={confirmDialog.confirmText || "Confirm"}
          cancelText={confirmDialog.cancelText || "Cancel"}
          isDangerous={confirmDialog.isDangerous}
          onConfirm={() => confirmDialog.onConfirm?.()}
          onCancel={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}
        />

        {/* Import Modal */}
        <LandlordImportModal
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
          onImport={handleBulkImport}
        />
      </div>
    </DashboardLayout>
  );
};

export default Landlords;