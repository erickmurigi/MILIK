// pages/Landlord/Landlord.jsx
import { fmtDate } from "../../utils/dates";
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
  FaSms,
  FaPrint,
} from "react-icons/fa";
import { getLandlords, deleteLandlord, updateLandlord } from "../../redux/apiCalls";
import { selectCurrentCompany, selectCurrentUser, selectAllLandlords, selectLandlordPagination, selectLandlordIsFetching } from "../../redux/selectors";
import MilikConfirmDialog from "../../components/Modals/MilikConfirmDialog";
import ImportModal from "../../components/Modals/ImportModal";
import CommunicationComposerModal from "../../components/Communications/CommunicationComposerModal";
import { downloadLandlordsTemplate, exportLandlordsToExcel, parseLandlordsExcel } from "../../utils/excelTemplates";
import { toast } from "react-toastify";
import { adminRequests } from "../../utils/requestMethods";
import { printTabularList } from "../../utils/printList";
import { useTerm } from "../../hooks/useTerm";
import { toListingCaps } from "../../utils/listingPageUtils";
import { hasCompanyPermission } from "../../utils/permissions";
import AppSelect from "../../components/common/AppSelect";
import PaginationBar from '../../components/PaginationBar';
import MilikTable from '../../components/common/MilikTable';
import ListToolbar from '../../components/common/ListToolbar';

const STORAGE_KEY = "milik_landlords_v1";
const DEFAULT_PAGE_SIZE = 50;

const emptyFilters = {
  status: "Active",
  text: "",
};

const MILIK_GREEN = "bg-[#0B3B2E]"; // deep MILIK-ish green
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";
const MILIK_ORANGE = "bg-[#FF8C00]";
const MILIK_ORANGE_HOVER = "hover:bg-[#e67e00]";


// Module-scope — pure function, no component state needed
const countLinkedProperties = (landlord = {}) =>
  Number(landlord?.activeProperties || 0) + Number(landlord?.archivedProperties || 0);

const Landlords = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const termLandlords = useTerm("landlords");
  const termLandlord = useTerm("landlord");
  const termProperties = useTerm("properties");
  
  // Redux state
  const landlords          = useSelector(selectAllLandlords);
  const landlordPagination = useSelector(selectLandlordPagination);
  const isFetching         = useSelector(selectLandlordIsFetching);
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  
  // Permissions (must come before any useCallback that puts these in dep arrays)
  const { canCreate, canUpdate, canDelete } = useMemo(() => ({
    canCreate: hasCompanyPermission(currentUser, currentCompany, "landlords", "create", "propertyManagement"),
    canUpdate: hasCompanyPermission(currentUser, currentCompany, "landlords", "update", "propertyManagement"),
    canDelete: hasCompanyPermission(currentUser, currentCompany, "landlords", "delete", "propertyManagement"),
  }), [currentUser, currentCompany]);

  // Table + UI state
  const [selectedLandlords, setSelectedLandlords] = useState([]);
  const [selectAll, setSelectAll] = useState(false);
  const [pageSize, setPageSize] = useTabState("/landlords:pageSize", DEFAULT_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useTabState("/landlords:currentPage", 1);

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

  const columns = useMemo(
    () => [
      { key: "code", label: `${termLandlord} Code` },
      { key: "name", label: `${termLandlord} Name` },
      { key: "status", label: "Status" },
      { key: "pin", label: "KRA PIN" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone" },
      { key: "properties", label: termProperties },
    ],
    [termLandlord, termProperties]
  );

  const buildLandlordParams = useCallback((page = 1) => {
    const params = { page, limit: pageSize };
    if (currentCompany?._id) params.company = currentCompany._id;
    if (appliedFilters.status !== "any") params.status = appliedFilters.status;
    const textSearch = String(appliedFilters.text || "").trim();
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
  const applySearch = useCallback(() => {
    setAppliedFilters({
      status: draftFilters.status,
      text: String(draftFilters.text || "").trim(),
    });
    setCurrentPage(1);
    setSelectedLandlords([]);
    setSelectAll(false);
  }, [draftFilters, setAppliedFilters, setCurrentPage]);

  const resetFilters = useCallback(() => {
    setDraftFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    setSelectedLandlords([]);
    setSelectAll(false);
    setCurrentPage(1);
    setActionMenuOpen(false);
  }, [setAppliedFilters, setCurrentPage]);

  const onFilterEnter = useCallback((e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applySearch();
    }
  }, [applySearch]);

  // Server handles all filtering; client just renders the current page from Redux
  const totalPages = Math.max(1, landlordPagination.pages ?? 1);
  const currentLandlords = landlords;

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
  const handleSelectLandlord = useCallback((id) => {
    setSelectedLandlords((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectAll) {
      const currentIds = currentLandlords.map((l) => l._id);
      setSelectedLandlords((prev) => prev.filter((id) => !currentIds.includes(id)));
      setSelectAll(false);
    } else {
      const currentIds = currentLandlords.map((l) => l._id);
      setSelectedLandlords((prev) => Array.from(new Set([...prev, ...currentIds])));
      setSelectAll(true);
    }
  }, [selectAll, currentLandlords]);

  const goToPage = useCallback((page) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
      dispatch(getLandlords(buildLandlordParams(page)));
    }
  }, [totalPages, dispatch, buildLandlordParams, setCurrentPage]);

  // Delete selected landlords
  const deleteSelected = async () => {
    if (!canDelete) { toast.warning(`You don't have permission to delete ${termLandlords.toLowerCase()}`); return; }
    if (selectedLandlords.length === 0) return;

    if (selectedDeletableLandlords.length === 0) {
      const protectedCount = selectedProtectedLandlords.length;
      setConfirmDialog({
        isOpen: true,
        title: "Delete Blocked",
        message:
          protectedCount === 1
            ? `The selected ${termLandlord.toLowerCase()} is linked to existing ${termProperties.toLowerCase()}, so deletion is blocked. Archive the ${termLandlord.toLowerCase()} instead if you want to hide it from active operations.`
            : `All ${protectedCount} selected ${termLandlords.toLowerCase()} are linked to existing ${termProperties.toLowerCase()}, so deletion is blocked. Archive them instead if you want to hide them from active operations.`,
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
      title: isSingleDelete ? `Delete ${termLandlord}` : `Delete ${termLandlords}`,
      message:
        skippedCount > 0
          ? `Delete ${deleteCount} ${termLandlord.toLowerCase()}(s) with no linked ${termProperties.toLowerCase()}. ${skippedCount} selected ${termLandlord.toLowerCase()}(s) will be skipped because they still manage or own ${termProperties.toLowerCase()}.`
          : isSingleDelete
          ? `Are you sure you want to delete this ${termLandlord.toLowerCase()}? This action cannot be undone.`
          : `Are you sure you want to delete ${deleteCount} ${termLandlords.toLowerCase()}? This action cannot be undone.`,
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
        if (delOk > 0) toast.success(delOk === 1 ? `${termLandlord} deleted successfully.` : `${delOk} ${termLandlords.toLowerCase()} deleted successfully.`);
        if (delFail > 0) toast.error(`${delFail} ${termLandlord.toLowerCase()}(s) could not be deleted.`);
        if (skippedCount > 0) toast.info(skippedCount === 1 ? `1 ${termLandlord.toLowerCase()} was skipped (still has linked ${termProperties.toLowerCase()}).` : `${skippedCount} ${termLandlords.toLowerCase()} were skipped (still have linked ${termProperties.toLowerCase()}).`);
        setCurrentPage(1);
        dispatch(getLandlords(buildLandlordParams()));
      },
    });
  };

  const archiveSelected = () => {
    if (!canUpdate) { toast.warning(`You don't have permission to archive ${termLandlords.toLowerCase()}`); return; }
    if (selectedLandlords.length === 0) return;
    setActionMenuOpen(false);

    if (selectedArchivableLandlords.length === 0) {
      setConfirmDialog({
        isOpen: true,
        title: "Nothing to Archive",
        message: `All selected ${termLandlords.toLowerCase()} are already archived.`,
        confirmText: "OK",
        cancelText: "Close",
        isDangerous: false,
        onConfirm: () => setConfirmDialog((prev) => ({ ...prev, isOpen: false })),
      });
      return;
    }

    setConfirmDialog({
      isOpen: true,
      title: selectedArchivableLandlords.length === 1 ? `Archive ${termLandlord}` : `Archive ${termLandlords}`,
      message:
        selectedArchivableLandlords.length === 1
          ? `Are you sure you want to archive this ${termLandlord.toLowerCase()}?`
          : `Are you sure you want to archive ${selectedArchivableLandlords.length} ${termLandlords.toLowerCase()}?`,
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
        if (archOk > 0) toast.success(archOk === 1 ? `${termLandlord} archived successfully.` : `${archOk} ${termLandlords.toLowerCase()} archived successfully.`);
        if (archFail > 0) toast.error(`${archFail} ${termLandlord.toLowerCase()}(s) could not be archived.`);
        setCurrentPage(1);
        dispatch(getLandlords(buildLandlordParams()));
      },
    });
  };

  const restoreSelected = () => {
    if (!canUpdate) { toast.warning(`You don't have permission to restore ${termLandlords.toLowerCase()}`); return; }
    if (selectedLandlords.length === 0) return;
    setActionMenuOpen(false);

    if (selectedRestorableLandlords.length === 0) {
      setConfirmDialog({
        isOpen: true,
        title: "Nothing to Restore",
        message: `Select at least one archived ${termLandlord.toLowerCase()} to restore.`,
        confirmText: "OK",
        cancelText: "Close",
        isDangerous: false,
        onConfirm: () => setConfirmDialog((prev) => ({ ...prev, isOpen: false })),
      });
      return;
    }

    setConfirmDialog({
      isOpen: true,
      title: selectedRestorableLandlords.length === 1 ? `Restore ${termLandlord}` : `Restore ${termLandlords}`,
      message:
        selectedRestorableLandlords.length === 1
          ? `Are you sure you want to restore this ${termLandlord.toLowerCase()}?`
          : `Are you sure you want to restore ${selectedRestorableLandlords.length} ${termLandlords.toLowerCase()}?`,
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
        if (restOk > 0) toast.success(restOk === 1 ? `${termLandlord} restored successfully.` : `${restOk} ${termLandlords.toLowerCase()} restored successfully.`);
        if (restFail > 0) toast.error(`${restFail} ${termLandlord.toLowerCase()}(s) could not be restored.`);
        setCurrentPage(1);
        dispatch(getLandlords(buildLandlordParams()));
      },
    });
  };

  // --- MODAL / FORM ---
  const openAddModal = useCallback(() => {
    if (!canCreate) { toast.warning(`You don't have permission to create ${termLandlords.toLowerCase()}`); return; }
    navigate('/landlords/new');
  }, [canCreate, navigate]);

  const openEditModal = useCallback(() => {
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
  }, [selectedLandlords, landlords, navigate]);

  const selectedCount = selectedLandlords.length;
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

      return response.data?.data || { successful: [], failed: [] };
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
      toast.warning(`No ${termLandlords.toLowerCase()} to export`);
      return;
    }
    try {
      const rows = await fetchAllForExport();
      exportLandlordsToExcel(rows);
      toast.success(`Exported ${rows.length} ${termLandlords.toLowerCase()} to Excel`);
    } catch {
      exportLandlordsToExcel(landlords);
      toast.success(`Exported ${landlords.length} ${termLandlords.toLowerCase()} to Excel`);
    }
  };

  const handlePrintList = async () => {
    if (landlordPagination.total === 0 && landlords.length === 0) {
      toast.warning(`No ${termLandlords.toLowerCase()} to print`);
      return;
    }
    let rows = landlords;
    try { rows = await fetchAllForExport(); } catch { /* use current page */ }

    printTabularList({
      title: `${termLandlords} List`,
      subtitle: `Current filtered ${termLandlords.toLowerCase()} register`,
      company: currentCompany || {},
      summary: `Records: ${rows.length} • Printed on ${new Date().toLocaleString()}`,
      columns: [
        { label: `${termLandlord} Code`, value: (row) => row?.landlordCode || row?.code || "-" },
        { label: `${termLandlord} Name`, value: (row) => row?.fullName || row?.name || row?.landlordName || row?.firstName || "-" },
        { label: "Status", value: (row) => row?.status || "Active" },
        { label: "KRA PIN", value: (row) => row?.taxPin || "-" },
        { label: "Email", value: (row) => row?.email || "-" },
        { label: "Phone", value: (row) => row?.phone || row?.phoneNumber || "-" },
      ],
      rows,
    });
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white p-0">
        {/* Toolbar — single scrollable row */}
        <ListToolbar>
          <AppSelect
            value={draftFilters.status === "any" ? null : draftFilters.status}
            onChange={(v) => setDraftFilters((p) => ({ ...p, status: v ?? "any" }))}
            options={[
              { value: "Active", label: "Active" },
              { value: "Archived", label: "Archived" },
            ]}
            placeholder="All Status"
            clearable
            compact
          />

          <ListToolbar.Divider />

          <ListToolbar.Input value={draftFilters.text} onChange={(e) => setDraftFilters((p) => ({ ...p, text: e.target.value }))} onKeyDown={onFilterEnter} placeholder="Search name, code, phone, email" width="w-64" />

          <ListToolbar.Divider />

          <ListToolbar.Button icon={FaSearch} variant="accent" onClick={applySearch}>Search</ListToolbar.Button>
          <ListToolbar.Button icon={FaRedoAlt} onClick={resetFilters}>Reset</ListToolbar.Button>
          <ListToolbar.Button icon={FaEdit} disabled={!canEdit} onClick={openEditModal}>Edit</ListToolbar.Button>

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
                <button onClick={archiveSelected} disabled={selectedArchivableLandlords.length === 0}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 ${selectedArchivableLandlords.length > 0 ? "hover:bg-gray-50" : "cursor-not-allowed bg-gray-50 text-gray-400"}`}>
                  <FaArchive className="text-xs text-gray-700" /> Archive
                </button>
                <button onClick={() => { setShowCommunicationModal(true); setActionMenuOpen(false); }}
                  className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-gray-50">
                  <FaSms className="text-xs text-gray-700" /> SMS
                </button>
                <button onClick={() => { navigate("/landlord-payments"); setActionMenuOpen(false); }}
                  className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-gray-50">
                  <FaMoneyBillWave className="text-xs text-gray-700" /> Payments
                </button>
                <button onClick={() => { deleteSelected(); setActionMenuOpen(false); }} disabled={!canDelete || selectedDeletableLandlords.length === 0}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 ${canDelete && selectedDeletableLandlords.length > 0 ? "hover:bg-gray-50" : "cursor-not-allowed bg-gray-50 text-gray-400"}`}>
                  <FaTrash className="text-xs text-gray-700" /> Delete
                </button>
                <button onClick={restoreSelected} disabled={selectedRestorableLandlords.length === 0}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 ${selectedRestorableLandlords.length > 0 ? "hover:bg-gray-50" : "cursor-not-allowed bg-gray-50 text-gray-400"}`}>
                  <FaUndo className="text-xs text-gray-700" /> Restore
                </button>
              </div>
            )}
          </div>

          <ListToolbar.Button icon={FaPlus} disabled={!canCreate} onClick={openAddModal}>Add</ListToolbar.Button>
          <ListToolbar.Button icon={FaFileImport} variant="outlineOk" onClick={() => setShowImportModal(true)}>Import</ListToolbar.Button>
          <ListToolbar.Button icon={FaPrint} variant="dark" onClick={handlePrintList}>Print</ListToolbar.Button>
          <ListToolbar.Button icon={FaFileExport} variant="outline" onClick={handleExport}>Export</ListToolbar.Button>
        </ListToolbar>

        {/* Table */}
        <div className="flex w-full max-w-none min-h-0 flex-1 flex-col px-2 pb-2">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
            <MilikTable
              columns={[
                { label: columns[0].label, width: "120px" },
                { label: columns[1].label },
                { label: columns[2].label, width: "110px" },
                { label: columns[3].label, width: "140px" },
                { label: columns[4].label, width: "220px" },
                { label: columns[5].label, width: "160px" },
                { label: columns[6].label, width: "140px", align: "center" },
              ]}
              rows={currentLandlords}
              rowKey="_id"
              loading={isFetching && currentLandlords.length === 0}
              empty={
                <div className="flex flex-col items-center justify-center gap-2">
                  <div className="text-sm font-bold text-gray-500">No {termLandlords.toLowerCase()} found</div>
                  <div className="text-xs text-gray-400">Use the filter fields above, then click Search</div>
                  <button
                    onClick={openAddModal}
                    className={`px-4 py-1 text-xs text-white rounded-lg flex items-center gap-2 shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
                    title={`Add your first ${termLandlord.toLowerCase()}`}
                  >
                    <FaPlus className="text-xs" />
                    <span>Add New {termLandlord}</span>
                  </button>
                </div>
              }
              minWidth="1100px"
              checkboxes
              allChecked={selectAll && currentLandlords.length > 0}
              someChecked={selectedCount > 0 && !(selectAll && currentLandlords.length > 0)}
              onCheckAll={handleSelectAll}
              isChecked={(landlord) => selectedLandlords.includes(landlord._id)}
              isSelected={(landlord) => selectedLandlords.includes(landlord._id)}
              onCheckRow={(landlord) => handleSelectLandlord(landlord._id)}
              onRowClick={(landlord) => handleSelectLandlord(landlord._id)}
              renderRow={(landlord) => (
                <>
                  <td className="px-3 py-1 border-r border-gray-100 overflow-hidden">
                    <span className="font-semibold text-slate-900 truncate block">{toListingCaps(landlord.landlordCode || landlord.code)}{landlord.lastSmsAt && <span className="ml-1.5 border border-slate-300 px-1 text-[9px] font-bold uppercase text-slate-500" title={`SMS sent ${fmtDate(landlord.lastSmsAt)}`}>SMS</span>}{landlord.lastEmailAt && <span className="ml-1.5 border border-slate-300 px-1 text-[9px] font-bold uppercase text-slate-500" title={`Emailed ${fmtDate(landlord.lastEmailAt)}`}>EMAIL</span>}</span>
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
                    <span className="text-slate-700 truncate block">{landlord.taxPin || "—"}</span>
                  </td>
                  <td className="px-3 py-1 border-r border-gray-100 overflow-hidden">
                    <span className="text-slate-700 truncate block">{landlord.email || "—"}</span>
                  </td>
                  <td className="px-3 py-1 border-r border-gray-100 overflow-hidden">
                    <span className="text-slate-700 truncate block">{landlord.phoneNumber || landlord.phone || "—"}</span>
                  </td>
                  <td className="px-3 py-1 border-r border-gray-100 overflow-hidden">
                    <span className="text-slate-900 tabular-nums">{landlord.activeProperties ?? 0}</span>
                    {Number(landlord.archivedProperties || 0) > 0 && (
                      <span className="ml-1 text-[10px] text-slate-500">({landlord.archivedProperties} archived)</span>
                    )}
                  </td>
                </>
              )}
            />

            <PaginationBar
              page={currentPage}
              pages={totalPages}
              total={landlordPagination.total}
              pageSize={pageSize}
              onPageChange={goToPage}
              onPageSizeChange={(n) => { setPageSize(n); setCurrentPage(1); }}
              loading={isFetching}
              label={termLandlords.toLowerCase()}
            />
          </div>
        </div>

        {/* TODO: Edit Landlord Modal (will be converted to separate page later) */}
        {/* Temporarily disabled - edit functionality will use a dedicated page like Add */}

        <CommunicationComposerModal
          open={showCommunicationModal}
          onClose={() => setShowCommunicationModal(false)}
          businessId={currentCompany?._id || ""}
          contextType="landlord_bulk"
          recordIds={selectedLandlords}
          title={`SMS Selected ${termLandlords}`}
          subtitle={`Choose a ${termLandlord.toLowerCase()} template, preview the final message, then send.`}
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
        <ImportModal
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
          title={`Import ${termLandlords} from Excel`}
          entityName={termLandlord.toLowerCase()}
          parseFile={parseLandlordsExcel}
          downloadTemplate={downloadLandlordsTemplate}
          onImport={handleBulkImport}
          maxWidthClass="max-w-4xl"
          getErrorRowLabel={(e) => e.data?.landlordName}
          getFailureRowLabel={(f) => f.landlord}
          previewCols={[
            { header: "Name", render: (r) => <span className="font-semibold">{r.landlordName}</span> },
            { header: "Type", render: (r) => r.landlordType },
            { header: "Reg / ID", render: (r) => r.regId },
            { header: "Email", render: (r) => r.email },
            { header: "Phone", render: (r) => r.phoneNumber },
          ]}
        />
      </div>
    </DashboardLayout>
  );
};

export default Landlords;