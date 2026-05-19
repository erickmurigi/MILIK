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
import { LISTING_UI, normalizeUppercaseInput, toListingCaps } from "../../utils/listingPageUtils";
import { hasCompanyPermission } from "../../utils/permissions";

const STORAGE_KEY = "milik_landlords_v1";
const DEFAULT_PAGE_SIZE = 50;

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
  const isFetching = landlordState?.isFetching || false;
  const { currentCompany } = useSelector((state) => state.company);
  const currentUser = useSelector((state) => state.auth?.currentUser);
  
  // Table + UI state
  const [selectedLandlords, setSelectedLandlords] = useState([]);
  const [selectAll, setSelectAll] = useState(false);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
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
  const totalPages = Math.max(1, Math.ceil(filteredLandlords.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const startIndex = (safeCurrentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const currentLandlords = filteredLandlords.slice(startIndex, endIndex);

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
    if (page >= 1 && page <= totalPages) setCurrentPage(page);
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
        try {
          for (const landlord of selectedDeletableLandlords) {
            await dispatch(deleteLandlord(landlord._id));
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
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }));

          if (deleteCount > 0) {
            toast.success(
              deleteCount === 1
                ? "Landlord deleted successfully."
                : `${deleteCount} landlords deleted successfully.`
            );
          }
          if (skippedCount > 0) {
            toast.info(
              skippedCount === 1
                ? "1 landlord was skipped because it still has linked properties."
                : `${skippedCount} landlords were skipped because they still have linked properties.`
            );
          }
        } catch (err) {
          console.error('Delete error:', err);
          setConfirmDialog({
            isOpen: true,
            title: "Delete Failed",
            message: getErrorMessage(err, "Failed to delete landlord(s)"),
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
        try {
          for (const landlord of selectedArchivableLandlords) {
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
          toast.success(
            selectedArchivableLandlords.length === 1
              ? "Landlord archived successfully."
              : `${selectedArchivableLandlords.length} landlords archived successfully.`
          );
        } catch (err) {
          console.error("Archive error:", err);
          setConfirmDialog({
            isOpen: true,
            title: "Archive Failed",
            message: getErrorMessage(err, "Failed to archive landlord(s)"),
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
        try {
          for (const landlord of selectedRestorableLandlords) {
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
          toast.success(
            selectedRestorableLandlords.length === 1
              ? "Landlord restored successfully."
              : `${selectedRestorableLandlords.length} landlords restored successfully.`
          );
        } catch (err) {
          console.error("Restore error:", err);
          setConfirmDialog({
            isOpen: true,
            title: "Restore Failed",
            message: getErrorMessage(err, "Failed to restore landlord(s)"),
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
  const canCreate = hasCompanyPermission(currentUser, currentCompany, "landlords", "create", "propertyManagement");
  const canUpdate = hasCompanyPermission(currentUser, currentCompany, "landlords", "update", "propertyManagement");
  const canDelete = hasCompanyPermission(currentUser, currentCompany, "landlords", "delete", "propertyManagement");
  const canEdit = selectedCount === 1 && canUpdate;

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
        company: currentCompany._id
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
        { label: "Landlord Name", value: (row) => row?.fullName || row?.name || row?.landlordName || row?.firstName || "-" },
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
      <div className="flex h-full min-h-0 flex-col bg-gradient-to-br from-slate-50 via-white to-slate-100 p-2">
        {/* Toolbar — single scrollable row */}
        <div className="flex-none sticky top-0 z-30 border-b border-gray-200 bg-white shadow-sm">
          <div className="flex items-center gap-1.5 overflow-x-auto px-2 py-1.5">
            <select
              value={draftFilters.status}
              onChange={(e) => setDraftFilters((p) => ({ ...p, status: e.target.value }))}
              className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] appearance-none"
            >
              <option value="Active">Active</option>
              <option value="any">All Status</option>
              <option value="Archived">Archived</option>
            </select>

            <select
              value={draftFilters.portal}
              onChange={(e) => setDraftFilters((p) => ({ ...p, portal: e.target.value }))}
              className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] appearance-none"
            >
              <option value="any">Portal</option>
              <option value="Enabled">Enabled</option>
              <option value="Disabled">Disabled</option>
            </select>

            <select
              value={draftFilters.propsCount}
              onChange={(e) => setDraftFilters((p) => ({ ...p, propsCount: e.target.value }))}
              className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] appearance-none"
            >
              <option value="any">Props</option>
              <option value="1-5">1–5</option>
              <option value="6-10">6–10</option>
              <option value="10+">10+</option>
            </select>

            <select
              value={draftFilters.location}
              onChange={(e) => setDraftFilters((p) => ({ ...p, location: e.target.value }))}
              className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] appearance-none"
            >
              {uniqueLocations.map((loc) => (
                <option key={loc} value={loc}>{loc === "any" ? "Location" : loc}</option>
              ))}
            </select>

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

            <div className="relative shrink-0" ref={actionMenuRef}>
              <button onClick={() => setActionMenuOpen((v) => !v)} disabled={selectedCount === 0}
                className={`h-7 flex items-center gap-1 rounded px-2.5 text-xs font-semibold text-white ${selectedCount > 0 ? "bg-[#0B3B2E] hover:bg-[#0A3127]" : "bg-gray-400 cursor-not-allowed"}`}>
                <FaArchive size={9} /> Actions <FaChevronDown size={8} />
              </button>
              {actionMenuOpen && selectedCount > 0 && (
                <div className="absolute mt-1 right-0 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden">
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
                className="min-w-[1180px] w-full text-xs font-bold bg-white"
                ref={tableRef}
                style={{ tableLayout: "fixed" }}
              >
                <thead className="sticky top-0 z-10 shadow-sm">
                  <tr className="bg-[#0B3B2E] text-white">
                    <th
                      className="px-3 py-1.5 text-left font-bold text-white border border-gray-200 bg-[#0B3B2E]"
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
                          className="relative px-3 py-1.5 text-left font-bold text-white border border-gray-200 bg-[#0B3B2E]"
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
                          {toListingCaps(landlord.landlordCode || landlord.code)}
                        </td>
                        <td className="px-3 py-1 font-bold text-gray-900 border border-gray-200 align-top whitespace-nowrap overflow-hidden text-ellipsis">
                          {toListingCaps(landlord.fullName || landlord.landlordName || landlord.name || landlord.firstName || "-")}
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
                          {toListingCaps(landlord.location || "—")}
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
            <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-3 py-1 text-xs text-slate-700">
              <div className="flex w-full flex-wrap items-center justify-between gap-2">
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
                  <div className="flex items-center gap-1">
                    <span className="font-semibold text-slate-500 text-xs">Per page:</span>
                    <select
                      value={pageSize}
                      onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                      className="h-7 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-bold text-slate-700 focus:border-emerald-400 focus:outline-none transition"
                    >
                      {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
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
                            className={`px-2 py-0.5 min-w-[24px] text-xs rounded border transition-colors font-bold ${
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