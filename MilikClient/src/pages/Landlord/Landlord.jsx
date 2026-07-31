// pages/Landlord/Landlord.jsx
import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { useTabState } from "../../hooks/useTabState";
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
import { selectCurrentCompany, selectCurrentUser } from "../../redux/selectors";
import MilikConfirmDialog from "../../components/Modals/MilikConfirmDialog";
import LandlordImportModal from "../../components/Modals/LandlordImportModal";
import CommunicationComposerModal from "../../components/Communications/CommunicationComposerModal";
import { downloadLandlordsTemplate, exportLandlordsToExcel } from "../../utils/excelTemplates";
import { toast } from "react-toastify";
import { adminRequests } from "../../utils/requestMethods";
import { printTabularList } from "../../utils/printList";
import { LISTING_UI, normalizeUppercaseInput, toListingCaps } from "../../utils/listingPageUtils";
import { hasCompanyPermission } from "../../utils/permissions";
import AppSelect from "../../components/common/AppSelect";

const STORAGE_KEY = "milik_landlords_v1";
const DEFAULT_PAGE_SIZE = 50;

const emptyFilters = {
  status: "Active",
  portal: "any",
  location: "",
  code: "",
  name: "",
  regId: "",
  pin: "",
  email: "",
  phone: "",
};

const MILIK_GREEN = "bg-[#0B3B2E]"; // deep MILIK-ish green
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";
const MILIK_ORANGE = "bg-[#FF8C00]";
const MILIK_ORANGE_HOVER = "hover:bg-[#e67e00]";

const getErrorMessage = (error, fallback) =>
  error?.response?.data?.message || error?.message || fallback;

const Landlords = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  
  // Redux state
  const landlordState = useSelector((state) => state.landlord);
  const landlords = landlordState?.landlords || [];
  const landlordPagination = useSelector((state) => state.landlord?.pagination ?? { total: 0, page: 1, pages: 1, limit: 50 });
  const isFetching = landlordState?.isFetching || false;
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  
  // Table + UI state
  const [selectedLandlords, setSelectedLandlords] = useState([]);
  const [selectAll, setSelectAll] = useState(false);
  const [pageSize, setPageSize] = useTabState("/landlords:pageSize", DEFAULT_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useTabState("/landlords:currentPage", 1);
  const [isResizing, setIsResizing] = useState(false);

  // Modals
  const [showImportModal, setShowImportModal] = useState(false);
  const [showCommunicationModal, setShowCommunicationModal] = useState(false);

  const [appliedFilters, setAppliedFilters] = useTabState("/landlords:appliedFilters", emptyFilters);
  const [draftFilters, setDraftFilters] = useState(appliedFilters);

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
  const [actionMenuPos, setActionMenuPos] = useState({ top: 0, right: 0 });
  const actionMenuRef = useRef(null);
  const actionMenuBtnRef = useRef(null);

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

  const buildLandlordParams = useCallback((page = 1) => {
    const params = { page, limit: pageSize };
    if (currentCompany?._id) params.company = currentCompany._id;
    if (appliedFilters.status !== "any") params.status = appliedFilters.status;
    if (appliedFilters.portal !== "any") params.portal = appliedFilters.portal;
    if (appliedFilters.location.trim()) params.location = appliedFilters.location.trim();
    const textSearch = [
      appliedFilters.name, appliedFilters.code, appliedFilters.regId,
      appliedFilters.pin, appliedFilters.email, appliedFilters.phone,
    ].map((v) => v.trim()).find(Boolean);
    if (textSearch) params.search = textSearch;
    return params;
  }, [currentCompany?._id, appliedFilters, pageSize]);

  // Fetch landlords whenever company, applied filters, or pageSize changes (always page 1)
  useEffect(() => {
    if (!currentCompany?._id) return;
    setCurrentPage(1);
    dispatch(getLandlords(buildLandlordParams(1)));
  }, [dispatch, buildLandlordParams]);

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
  useEffect(() => {
    setSelectAll(false);
  }, [currentPage]);

  // Drop any selected ids that no longer exist after refresh/delete
  useEffect(() => {
    const validIds = new Set(landlords.map((l) => l._id));
    setSelectedLandlords((prev) => prev.filter((id) => validIds.has(id)));
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
  };

  const onFilterEnter = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applySearch();
    }
  };

  // Server handles all filtering; client just renders the current page from Redux
  const totalPages = Math.max(1, landlordPagination.pages ?? 1);
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const visiblePages = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const items = [1];
    if (safeCurrentPage > 3) items.push('…');
    const start = Math.max(2, safeCurrentPage - 1);
    const end = Math.min(totalPages - 1, safeCurrentPage + 1);
    for (let i = start; i <= end; i++) items.push(i);
    if (safeCurrentPage < totalPages - 2) items.push('…end');
    items.push(totalPages);
    return items;
  }, [safeCurrentPage, totalPages]);

  const startIndex = (safeCurrentPage - 1) * pageSize;
  const currentLandlords = landlords;

  const countLinkedProperties = (landlord = {}) =>
    Number(landlord?.activeProperties || 0) + Number(landlord?.archivedProperties || 0);

  const selectedLandlordRows = useMemo(
    () => landlords.filter((landlord) => selectedLandlords.includes(landlord._id)),
    [landlords, selectedLandlords]
  );

  const selectedDeletableLandlords = useMemo(
    () => selectedLandlordRows.filter((landlord) => countLinkedProperties(landlord) === 0),
    [selectedLandlordRows]
  );

  const selectedProtectedLandlords = useMemo(
    () => selectedLandlordRows.filter((landlord) => countLinkedProperties(landlord) > 0),
    [selectedLandlordRows]
  );

  const selectedArchivableLandlords = useMemo(
    () => selectedLandlordRows.filter((landlord) => String(landlord.status || "Active") !== "Archived"),
    [selectedLandlordRows]
  );

  const selectedRestorableLandlords = useMemo(
    () => selectedLandlordRows.filter((landlord) => String(landlord.status || "Active") === "Archived"),
    [selectedLandlordRows]
  );


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
    if (selectedLandlords.includes(landlordId)) return "bg-emerald-50/85 shadow-[inset_4px_0_0_0_#0B3B2E] hover:bg-emerald-50";
    return index % 2 === 0 ? "bg-white hover:bg-blue-50/40" : "bg-slate-50 hover:bg-blue-50/40";
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
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
      dispatch(getLandlords(buildLandlordParams(page)));
    }
  };

  // Delete selected landlords
  const deleteSelected = async () => {
    if (!canDelete) { toast.warning("You don't have permission to delete landlords"); return; }
    if (selectedLandlords.length === 0) return;

    if (selectedDeletableLandlords.length === 0) {
      const protectedCount = selectedProtectedLandlords.length;
      setConfirmDialog({
        isOpen: true,
        title: "Delete Blocked",
        message:
          protectedCount === 1
            ? "The selected landlord is linked to existing properties, so deletion is blocked. Archive the landlord instead if you want to hide it from active operations."
            : `All ${protectedCount} selected landlords are linked to existing properties, so deletion is blocked. Archive them instead if you want to hide them from active operations.`,
        confirmText: "OK",
        cancelText: "Close",
        isDangerous: false,
        onConfirm: () => setConfirmDialog((prev) => ({ ...prev, isOpen: false })),
      });
      return;
    }

    const deleteCount = selectedDeletableLandlords.length;
    const skippedCount = selectedProtectedLandlords.length;
    const isSingleDelete = deleteCount === 1;

    setConfirmDialog({
      isOpen: true,
      title: isSingleDelete ? "Delete Landlord" : "Delete Landlords",
      message:
        skippedCount > 0
          ? `Delete ${deleteCount} landlord(s) with no linked properties. ${skippedCount} selected landlord(s) will be skipped because they still manage or own properties.`
          : isSingleDelete
          ? "Are you sure you want to delete this landlord? This action cannot be undone."
          : `Are you sure you want to delete ${deleteCount} landlords? This action cannot be undone.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      isDangerous: true,
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        setSelectedLandlords([]);
        setSelectAll(false);
        const delResults = await Promise.allSettled(
          selectedDeletableLandlords.map((l) => dispatch(deleteLandlord(l._id)))
        );
        const delOk = delResults.filter((r) => r.status === "fulfilled").length;
        const delFail = delResults.filter((r) => r.status === "rejected").length;
        if (delOk > 0) toast.success(delOk === 1 ? "Landlord deleted successfully." : `${delOk} landlords deleted successfully.`);
        if (delFail > 0) toast.error(`${delFail} landlord(s) could not be deleted.`);
        if (skippedCount > 0) toast.info(skippedCount === 1 ? "1 landlord was skipped (still has linked properties)." : `${skippedCount} landlords were skipped (still have linked properties).`);
        setCurrentPage(1);
        dispatch(getLandlords(buildLandlordParams()));
      },
    });
  };

  const archiveSelected = () => {
    if (!canUpdate) { toast.warning("You don't have permission to archive landlords"); return; }
    if (selectedLandlords.length === 0) return;
    setActionMenuOpen(false);

    if (selectedArchivableLandlords.length === 0) {
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
      title: selectedArchivableLandlords.length === 1 ? "Archive Landlord" : "Archive Landlords",
      message:
        selectedArchivableLandlords.length === 1
          ? "Are you sure you want to archive this landlord?"
          : `Are you sure you want to archive ${selectedArchivableLandlords.length} landlords?`,
      confirmText: "Archive",
      cancelText: "Cancel",
      isDangerous: false,
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        setSelectedLandlords([]);
        setSelectAll(false);
        const count = selectedArchivableLandlords.length;
        const archResults = await Promise.allSettled(
          selectedArchivableLandlords.map((l) => dispatch(updateLandlord(l._id, { status: "Archived" })))
        );
        const archOk = archResults.filter((r) => r.status === "fulfilled").length;
        const archFail = archResults.filter((r) => r.status === "rejected").length;
        if (archOk > 0) toast.success(archOk === 1 ? "Landlord archived successfully." : `${archOk} landlords archived successfully.`);
        if (archFail > 0) toast.error(`${archFail} landlord(s) could not be archived.`);
        setCurrentPage(1);
        dispatch(getLandlords(buildLandlordParams()));
      },
    });
  };

  const restoreSelected = () => {
    if (!canUpdate) { toast.warning("You don't have permission to restore landlords"); return; }
    if (selectedLandlords.length === 0) return;
    setActionMenuOpen(false);

    if (selectedRestorableLandlords.length === 0) {
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
      title: selectedRestorableLandlords.length === 1 ? "Restore Landlord" : "Restore Landlords",
      message:
        selectedRestorableLandlords.length === 1
          ? "Are you sure you want to restore this landlord?"
          : `Are you sure you want to restore ${selectedRestorableLandlords.length} landlords?`,
      confirmText: "Restore",
      cancelText: "Cancel",
      isDangerous: false,
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        setSelectedLandlords([]);
        setSelectAll(false);
        const restResults = await Promise.allSettled(
          selectedRestorableLandlords.map((l) => dispatch(updateLandlord(l._id, { status: "Active" })))
        );
        const restOk = restResults.filter((r) => r.status === "fulfilled").length;
        const restFail = restResults.filter((r) => r.status === "rejected").length;
        if (restOk > 0) toast.success(restOk === 1 ? "Landlord restored successfully." : `${restOk} landlords restored successfully.`);
        if (restFail > 0) toast.error(`${restFail} landlord(s) could not be restored.`);
        setCurrentPage(1);
        dispatch(getLandlords(buildLandlordParams()));
      },
    });
  };

  // --- MODAL / FORM ---
  const openAddModal = () => {
    if (!canCreate) { toast.warning("You don't have permission to create landlords"); return; }
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

  const selectedCount = selectedLandlords.length;
  const { canCreate, canUpdate, canDelete } = useMemo(() => ({
    canCreate: hasCompanyPermission(currentUser, currentCompany, "landlords", "create", "propertyManagement"),
    canUpdate: hasCompanyPermission(currentUser, currentCompany, "landlords", "update", "propertyManagement"),
    canDelete: hasCompanyPermission(currentUser, currentCompany, "landlords", "delete", "propertyManagement"),
  }), [currentUser, currentCompany]);
  const canEdit = selectedCount === 1 && canUpdate;

  // Excel Import Handler
  const handleBulkImport = async (landlords) => {
    try {
      if (!currentCompany?._id) {
        throw new Error('No company selected. Please ensure you are logged in.');
      }

      const response = await adminRequests.post('/landlords/bulk-import', {
        landlords,
        company: currentCompany._id
      });

      setCurrentPage(1);
      await dispatch(getLandlords(buildLandlordParams()));

      return response.data;
    } catch (error) {
      const errorMessage = error?.response?.data?.message || error?.message || 'Failed to import landlords';
      throw new Error(errorMessage);
    }
  };

  const fetchAllForExport = async () => {
    const exportParams = { ...buildLandlordParams(), limit: 5000, page: 1 };
    const qs = new URLSearchParams(exportParams).toString();
    const res = await adminRequests.get(`/landlords?${qs}`);
    const raw = res.data;
    return Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : landlords);
  };

  const handleExport = async () => {
    if (landlordPagination.total === 0 && landlords.length === 0) {
      toast.warning('No landlords to export');
      return;
    }
    try {
      const rows = await fetchAllForExport();
      exportLandlordsToExcel(rows);
      toast.success(`Exported ${rows.length} landlords to Excel`);
    } catch {
      exportLandlordsToExcel(landlords);
      toast.success(`Exported ${landlords.length} landlords to Excel`);
    }
  };

  const handlePrintList = async () => {
    if (landlordPagination.total === 0 && landlords.length === 0) {
      toast.warning("No landlords to print");
      return;
    }
    let rows = landlords;
    try { rows = await fetchAllForExport(); } catch { /* use current page */ }

    printTabularList({
      title: "Landlords List",
      subtitle: "Current filtered landlords register",
      company: currentCompany || {},
      summary: `Records: ${rows.length} • Printed on ${new Date().toLocaleString()}`,
      columns: [
        { label: "Landlord Code", value: (row) => row?.landlordCode || row?.code || "-" },
        { label: "Landlord Name", value: (row) => row?.fullName || row?.name || row?.landlordName || row?.firstName || "-" },
        { label: "Status", value: (row) => row?.status || "Active" },
        { label: "Location", value: (row) => row?.location || "-" },
        { label: "Email", value: (row) => row?.email || "-" },
        { label: "Phone", value: (row) => row?.phone || row?.phoneNumber || "-" },
      ],
      rows,
    });
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col bg-gradient-to-br from-slate-50 via-white to-slate-100 p-2">
        {/* Toolbar — single scrollable row */}
        <div className="flex-none sticky top-0 z-30 border-b border-gray-200 bg-white shadow-sm">
          <div className="filter-bar flex items-center gap-1.5 overflow-x-auto px-2 py-1.5">
            <AppSelect
              value={draftFilters.status === "any" ? null : draftFilters.status}
              onChange={(v) => setDraftFilters((p) => ({ ...p, status: v ?? "any" }))}
              options={[
                { value: "Active", label: "Active" },
                { value: "Archived", label: "Archived" },
              ]}
              placeholder="All Status"
              clearable
              size="sm"
            />

            <AppSelect
              value={draftFilters.portal === "any" ? null : draftFilters.portal}
              onChange={(v) => setDraftFilters((p) => ({ ...p, portal: v ?? "any" }))}
              options={[
                { value: "Enabled", label: "Enabled" },
                { value: "Disabled", label: "Disabled" },
              ]}
              placeholder="Portal"
              clearable
              size="sm"
            />

            <input
              value={draftFilters.location}
              onChange={(e) => setDraftFilters((p) => ({ ...p, location: e.target.value }))}
              onKeyDown={onFilterEnter}
              placeholder="Location"
              className="h-7 w-24 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
            />

            <div className="h-4 w-px shrink-0 bg-slate-200" />

            <input
              value={draftFilters.code}
              onChange={(e) => setDraftFilters((p) => ({ ...p, code: normalizeUppercaseInput(e.target.value) }))}
              onKeyDown={onFilterEnter}
              placeholder="Code"
              className="h-7 w-20 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
            />
            <input
              value={draftFilters.name}
              onChange={(e) => setDraftFilters((p) => ({ ...p, name: normalizeUppercaseInput(e.target.value) }))}
              onKeyDown={onFilterEnter}
              placeholder="Name"
              className="h-7 w-28 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
            />
            <input
              value={draftFilters.regId}
              onChange={(e) => setDraftFilters((p) => ({ ...p, regId: normalizeUppercaseInput(e.target.value) }))}
              onKeyDown={onFilterEnter}
              placeholder="Reg/ID"
              className="h-7 w-20 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
            />
            <input
              value={draftFilters.email}
              onChange={(e) => setDraftFilters((p) => ({ ...p, email: e.target.value }))}
              onKeyDown={onFilterEnter}
              placeholder="Email"
              className="h-7 w-28 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
            />
            <input
              value={draftFilters.phone}
              onChange={(e) => setDraftFilters((p) => ({ ...p, phone: normalizeUppercaseInput(e.target.value) }))}
              onKeyDown={onFilterEnter}
              placeholder="Phone"
              className="h-7 w-24 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
            />

            <div className="h-4 w-px shrink-0 bg-slate-200" />

            <button onClick={applySearch} className="h-7 shrink-0 flex items-center gap-1 rounded bg-[#FF8C00] px-2.5 text-xs font-semibold text-white hover:bg-[#e67e00]">
              <FaSearch size={9} /> Search
            </button>
            <button onClick={resetFilters} className="h-7 shrink-0 flex items-center gap-1 rounded bg-[#0B3B2E] px-2.5 text-xs font-semibold text-white hover:bg-[#0A3127]">
              <FaRedoAlt size={9} /> Reset
            </button>
            <button onClick={openEditModal} disabled={!canEdit}
              className={`h-7 shrink-0 flex items-center gap-1 rounded px-2.5 text-xs font-semibold text-white ${canEdit ? "bg-[#0B3B2E] hover:bg-[#0A3127]" : "bg-gray-400 cursor-not-allowed"}`}>
              <FaEdit size={9} /> Edit
            </button>

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
                className={`h-7 flex items-center gap-1 rounded px-2.5 text-xs font-semibold text-white ${selectedCount > 0 ? "bg-[#0B3B2E] hover:bg-[#0A3127]" : "bg-gray-400 cursor-not-allowed"}`}>
                <FaArchive size={9} /> Actions <FaChevronDown size={8} />
              </button>
              {actionMenuOpen && selectedCount > 0 && (
                <div
                  ref={actionMenuRef}
                  style={{ position: "fixed", top: actionMenuPos.top, right: actionMenuPos.right, zIndex: 9999 }}
                  className="w-40 bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden">
                  <button onClick={archiveSelected} disabled={selectedArchivableLandlords.length === 0}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 ${selectedArchivableLandlords.length > 0 ? "hover:bg-gray-50" : "cursor-not-allowed bg-gray-50 text-gray-400"}`}>
                    <FaArchive className="text-xs text-gray-700" /> Archive
                  </button>
                  <button onClick={restoreSelected} disabled={selectedRestorableLandlords.length === 0}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 ${selectedRestorableLandlords.length > 0 ? "hover:bg-gray-50" : "cursor-not-allowed bg-gray-50 text-gray-400"}`}>
                    <FaUndo className="text-xs text-gray-700" /> Restore
                  </button>
                </div>
              )}
            </div>

            <button onClick={() => setShowCommunicationModal(true)} disabled={selectedCount === 0}
              className={`h-7 shrink-0 flex items-center gap-1 rounded px-2.5 text-xs font-semibold text-white ${selectedCount > 0 ? "bg-[#FF8C00] hover:bg-[#e67e00]" : "bg-gray-400 cursor-not-allowed"}`}>
              <FaSms size={9} /> SMS
            </button>
            <button onClick={deleteSelected} disabled={!canDelete || selectedCount === 0 || selectedDeletableLandlords.length === 0}
              className={`h-7 shrink-0 flex items-center gap-1 rounded px-2.5 text-xs font-semibold text-white ${canDelete && selectedCount > 0 && selectedDeletableLandlords.length > 0 ? "bg-red-600 hover:bg-red-700" : "bg-gray-400 cursor-not-allowed"}`}>
              <FaTrash size={9} /> Delete
            </button>
            <button onClick={openAddModal} disabled={!canCreate}
              className={`h-7 shrink-0 flex items-center gap-1 rounded px-2.5 text-xs font-semibold text-white ${canCreate ? "bg-[#0B3B2E] hover:bg-[#0A3127]" : "bg-gray-400 cursor-not-allowed"}`}>
              <FaPlus size={9} /> Add
            </button>
            <button onClick={() => navigate("/landlord-payments")} className="h-7 shrink-0 flex items-center gap-1 rounded bg-[#FF8C00] px-2.5 text-xs font-semibold text-white hover:bg-[#e67e00]">
              <FaMoneyBillWave size={9} /> Payments
            </button>
            <button onClick={() => downloadLandlordsTemplate()} className="h-7 shrink-0 flex items-center gap-1 rounded border border-blue-300 bg-blue-50 px-2.5 text-xs font-semibold text-blue-700 hover:bg-blue-100">
              <FaFileDownload size={9} /> Template
            </button>
            <button onClick={() => setShowImportModal(true)} className="h-7 shrink-0 flex items-center gap-1 rounded border border-green-300 bg-green-50 px-2.5 text-xs font-semibold text-green-700 hover:bg-green-100">
              <FaFileImport size={9} /> Import
            </button>
            <button onClick={handlePrintList} className="h-7 shrink-0 flex items-center gap-1 rounded border border-gray-300 px-2.5 text-xs font-semibold text-gray-600 hover:bg-gray-50">
              <FaPrint size={9} /> Print
            </button>
            <button onClick={handleExport} className="h-7 shrink-0 flex items-center gap-1 rounded border border-gray-300 px-2.5 text-xs font-semibold text-gray-600 hover:bg-gray-50">
              <FaFileExport size={9} /> Export
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="flex w-full max-w-none min-h-0 flex-1 flex-col px-0 pb-0">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
            {/* Make THIS the scroll area so the footer stays visible */}
            <div className="min-h-0 flex-1 overflow-auto">
              <table
                className="min-w-[1100px] w-full text-[11px] bg-white"
                ref={tableRef}
                style={{ tableLayout: "fixed", borderCollapse: "collapse" }}
              >
                <thead className="sticky top-0 z-10 shadow-sm">
                  <tr className="bg-[#0B3B2E] text-white">
                    <th
                      className="px-3 py-2 text-center font-bold border-r border-white/10"
                      style={{ width: "44px" }}
                    >
                      <input
                        type="checkbox"
                        checked={selectAll && currentLandlords.length > 0}
                        onChange={handleSelectAll}
                        onClick={handleCheckboxClick}
                        className="rounded border-gray-300 text-emerald-600 focus:ring-[#0B3B2E]/20"
                      />
                    </th>

                    {columns.map((column) => {
                      const width = columnWidths[column.key] ?? 140;
                      return (
                        <th
                          key={column.key}
                          className="relative px-3 py-2 text-left font-bold border-r border-white/10"
                          style={{ width: `${width}px`, minWidth: "80px" }}
                        >
                          <div className="flex items-center justify-between">
                            <span className="truncate">{column.label}</span>
                            <div
                              className="w-2 h-4 ml-1 cursor-col-resize hover:bg-white/20 flex items-center justify-center rounded shrink-0"
                              onMouseDown={(e) => startResizing(column.key, e)}
                            >
                              <FaGripVertical className="text-white/50 text-[9px]" />
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
                      <td colSpan={columns.length + 1} className="px-3 py-8 text-center text-gray-400 bg-white">
                        <div className="flex flex-col items-center justify-center gap-1">
                          <div className="text-sm font-bold">Loading landlords...</div>
                        </div>
                      </td>
                    </tr>
                  ) : currentLandlords.length > 0 ? (
                    currentLandlords.map((landlord, index) => (
                      <tr
                        key={landlord._id}
                        className={`border-b cursor-pointer transition-colors ${getRowClass(index, landlord._id)}`}
                        onClick={() => handleSelectLandlord(landlord._id)}
                      >
                        <td className="px-3 py-1.5 text-center border-r border-gray-100" onClick={handleCheckboxClick}>
                          <input
                            type="checkbox"
                            checked={selectedLandlords.includes(landlord._id)}
                            onChange={() => handleSelectLandlord(landlord._id)}
                            onClick={handleCheckboxClick}
                            className="rounded border-gray-300 text-emerald-600 focus:ring-[#0B3B2E]/20"
                          />
                        </td>
                        <td className="px-3 py-1 border-r border-gray-100 overflow-hidden">
                          <span className="font-mono text-[10px] text-slate-500 tracking-wide truncate block">{toListingCaps(landlord.landlordCode || landlord.code)}</span>
                        </td>
                        <td className="px-3 py-1 border-r border-gray-100 overflow-hidden">
                          <span className="font-semibold text-slate-900 truncate block">{toListingCaps(landlord.fullName || landlord.landlordName || landlord.name || landlord.firstName || "-")}</span>
                        </td>
                        <td className="px-3 py-1 border-r border-gray-100">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            String(landlord.status || "Active") === "Active"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-slate-100 text-slate-600 border-slate-200"
                          }`}>
                            {landlord.status || "Active"}
                          </span>
                        </td>
                        <td className="px-3 py-1 border-r border-gray-100 overflow-hidden">
                          <span className="text-slate-600 truncate block">{toListingCaps(landlord.location || "—")}</span>
                        </td>
                        <td className="px-3 py-1 border-r border-gray-100 overflow-hidden">
                          <span className="text-slate-600 truncate block">{landlord.email || "—"}</span>
                        </td>
                        <td className="px-3 py-1 border-r border-gray-100 overflow-hidden">
                          <span className="font-medium text-slate-700 truncate block">{landlord.phoneNumber || landlord.phone || "—"}</span>
                        </td>
                        <td className="px-3 py-1.5 text-center border-r border-gray-100">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border bg-emerald-50 text-emerald-700 border-emerald-200">
                            {landlord.activeProperties ?? "0"}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-center border-r border-gray-100">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border bg-slate-100 text-slate-500 border-slate-200">
                            {landlord.archivedProperties ?? "0"}
                          </span>
                        </td>
                        <td className="px-3 py-1.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            landlord.portalAccess === "Enabled"
                              ? "bg-blue-50 text-blue-700 border-blue-200"
                              : "bg-slate-100 text-slate-500 border-slate-200"
                          }`}>
                            {landlord.portalAccess || "Disabled"}
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={columns.length + 1} className="px-3 py-8 text-center text-gray-400 bg-white">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <div className="text-sm font-bold">No landlords found</div>
                          <div className="text-xs text-gray-400">Use the filter fields above, then click Search</div>
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
            <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-3 py-1 text-xs text-slate-700">
              <div className="flex w-full flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-gray-600">
                  <div className="flex items-center gap-4">
                    <span className="font-bold">
                      Showing{" "}
                      <span className="font-bold">{landlords.length === 0 ? 0 : startIndex + 1}</span> to{" "}
                      <span className="font-bold">{startIndex + landlords.length}</span> of{" "}
                      <span className="font-bold">{landlordPagination.total || landlords.length}</span> landlords
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
                  <div className="flex items-center gap-1">
                    <span className="font-semibold text-slate-500 text-xs">Per page:</span>
                    <AppSelect
                      value={pageSize}
                      onChange={(v) => { setPageSize(Number(v)); setCurrentPage(1); }}
                      options={[25, 50, 100, 200].map((n) => ({ value: n, label: String(n) }))}
                      size="sm"
                    />
                  </div>
                  <button
                    onClick={() => goToPage(safeCurrentPage - 1)}
                    disabled={safeCurrentPage === 1}
                    className="px-2.5 py-0.5 text-xs border border-gray-300 rounded flex items-center gap-1 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-bold"
                  >
                    <FaChevronLeft size={10} />
                    Previous
                  </button>

                  <div className="flex items-center gap-1">
                    {visiblePages.map((item) =>
                      typeof item === 'number' ? (
                        <button
                          key={item}
                          onClick={() => goToPage(item)}
                          className={`px-2 py-0.5 min-w-[24px] text-xs rounded border transition-colors font-bold ${
                            safeCurrentPage === item
                              ? "bg-[#0B3B2E] text-white border-[#0B3B2E] hover:bg-[#0A3127]"
                              : "border-gray-300 hover:bg-gray-50"
                          }`}
                        >
                          {item}
                        </button>
                      ) : (
                        <span key={item} className="px-1 text-gray-400 text-xs">...</span>
                      )
                    )}
                  </div>

                  <button
                    onClick={() => goToPage(safeCurrentPage + 1)}
                    disabled={safeCurrentPage === totalPages}
                    className="px-2.5 py-0.5 text-xs border border-gray-300 rounded flex items-center gap-1 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-bold"
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