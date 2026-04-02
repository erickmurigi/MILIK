import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import {
  FaPlus,
  FaSearch,
  FaChevronLeft,
  FaChevronRight,
  FaExpandAlt,
  FaCompressAlt,
  FaFileExport,
  FaRedoAlt,
  FaEdit,
  FaEllipsisV,
  FaFileInvoiceDollar,
  FaUserEdit,
  FaBolt,
  FaChartLine,
  FaMoneyBillWave,
  FaTrash,
  FaSpinner,
  FaDownload,
  FaPrint,
  FaSms,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { getTenants, deleteTenant } from "../../redux/tenantsRedux";
import { getUnits } from "../../redux/unitRedux";
import { getProperties } from "../../redux/propertyRedux";
import TenantsImportModal from "../../components/Modals/TenantsImportModal";
import CommunicationComposerModal from "../../components/Communications/CommunicationComposerModal";
import {
  downloadTenantsTemplate,
  exportTenantsToExcel,
} from "../../utils/excelTemplates";
import { adminRequests } from "../../utils/requestMethods";
import { printTabularList } from "../../utils/printList";
import { getRentPayments, getTenantInvoices, getTenantInvoiceNotes } from "../../redux/apiCalls";

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_ORANGE = "bg-[#FF8C00]";
const ITEMS_PER_PAGE = 50;

const normalizeId = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const isActiveInvoice = (invoice) => {
  const status = String(invoice?.status || "").toLowerCase();
  return status !== "cancelled" && status !== "reversed";
};

const computeOperationalStatus = ({ tenant }) => {
  const currentStatus = String(tenant?.status || "active").toLowerCase();

  if (["terminated", "moved_out"].includes(currentStatus)) {
    return "terminated";
  }

  if (["inactive", "evicted"].includes(currentStatus)) {
    return currentStatus;
  }

  return "active";
};

const Tenants = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  // Redux state
  const { currentCompany } = useSelector((state) => state.company || {});
  const { tenants: tenantsData = [], isFetching } = useSelector(
    (state) => state.tenant || { tenants: [], isFetching: false }
  );
  const units = useSelector((state) => state.unit?.units || []);
  const properties = useSelector((state) => state.property?.properties || []);
  const { rentPayments = [] } = useSelector((state) => state.rentPayment || {});
  const { leases = [] } = useSelector((state) => state.lease || {});

  // ===== UI STATE =====
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedTenants, setExpandedTenants] = useState([]);
  const [selectedTenants, setSelectedTenants] = useState([]);
  const [selectAll, setSelectAll] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const actionMenuRef = useRef(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showCommunicationModal, setShowCommunicationModal] = useState(false);
  const [invoiceRefreshTick, setInvoiceRefreshTick] = useState(0);
  const [paymentsSnapshotReady, setPaymentsSnapshotReady] = useState(false);

  // Backend invoice cache
  const [tenantInvoices, setTenantInvoices] = useState([]);
  const [tenantInvoiceNotes, setTenantInvoiceNotes] = useState([]);

  // ===== FILTERS =====
  const [draftFilters, setDraftFilters] = useState({
    property: "any",
    status: "any",
    balanceScope: "any",
    search: "",
    tenantName: "",
    tenantCode: "",
  });
  const [appliedFilters, setAppliedFilters] = useState({
    property: "any",
    status: "any",
    balanceScope: "any",
    search: "",
    tenantName: "",
    tenantCode: "",
  });

  // ===== EFFECTS =====
  useEffect(() => {
    if (currentCompany?._id) {
      dispatch(getTenants({ business: currentCompany._id }));
      dispatch(getUnits({ business: currentCompany._id }));
      dispatch(getProperties({ business: currentCompany._id }));
    }
  }, [dispatch, currentCompany]);

  useEffect(() => {
    setSelectAll(false);
  }, [currentPage]);

  useEffect(() => {
    const handleInvoiceChange = () => {
      setInvoiceRefreshTick((prev) => prev + 1);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        handleInvoiceChange();
      }
    };

    window.addEventListener("invoicesUpdated", handleInvoiceChange);
    window.addEventListener("storage", handleInvoiceChange);
    window.addEventListener("focus", handleInvoiceChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("invoicesUpdated", handleInvoiceChange);
      window.removeEventListener("storage", handleInvoiceChange);
      window.removeEventListener("focus", handleInvoiceChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const onDocClick = (e) => {
      if (!actionMenuRef.current) return;
      if (!actionMenuRef.current.contains(e.target)) setActionMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const loadInvoices = useCallback(async () => {
    if (!currentCompany?._id) return;

    setPaymentsSnapshotReady(false);
    try {
      const [rows, notes] = await Promise.all([
        getTenantInvoices({ business: currentCompany._id }),
        getTenantInvoiceNotes({ business: currentCompany._id }),
        getRentPayments(dispatch, currentCompany._id),
      ]);
      setTenantInvoices(Array.isArray(rows) ? rows : []);
      setTenantInvoiceNotes(Array.isArray(notes) ? notes : []);
      setPaymentsSnapshotReady(true);
    } catch (error) {
      console.error("Failed to load tenant invoices:", error);
      setTenantInvoices([]);
      setTenantInvoiceNotes([]);
      setPaymentsSnapshotReady(false);
    }
  }, [currentCompany?._id, dispatch]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices, invoiceRefreshTick]);

  // ===== TRANSFORM TENANT DATA =====
  const resolveTenantPropertyName = (tenant, unitsFromStore = [], propertiesFromStore = []) => {
    const directPropertyName =
      tenant?.unit?.property?.propertyName ||
      tenant?.property?.propertyName ||
      tenant?.propertyName;
    if (directPropertyName) return directPropertyName;

    const tenantUnitId = tenant?.unit?._id || tenant?.unit;
    const matchedUnit = unitsFromStore.find(
      (unit) => normalizeId(unit?._id) === normalizeId(tenantUnitId)
    );
    const propertyIdFromUnit = matchedUnit?.property?._id || matchedUnit?.property;

    const propertyIdFromTenant = tenant?.property?._id || tenant?.property;
    const resolvedPropertyId = propertyIdFromUnit || propertyIdFromTenant;
    const matchedProperty = propertiesFromStore.find(
      (property) => normalizeId(property?._id) === normalizeId(resolvedPropertyId)
    );

    return (
      matchedUnit?.property?.propertyName ||
      matchedProperty?.propertyName ||
      matchedProperty?.name ||
      "-"
    );
  };

  const calculateTenantBalance = useCallback(
    (tenantId) => {
      const tenantIdStr = String(tenantId);

      const confirmedReceiptTotal = rentPayments
        .filter((payment) => {
          const paymentTenantId = normalizeId(payment?.tenant);
          return (
            paymentTenantId === tenantIdStr &&
            String(payment?.ledgerType || "").toLowerCase() === "receipts" &&
            payment?.isConfirmed === true &&
            payment?.isCancelled !== true &&
            payment?.isReversed !== true &&
            !payment?.reversalOf &&
            String(payment?.postingStatus || "").toLowerCase() !== "reversed" &&
            ["rent", "utility", "deposit", "late_fee", "other"].includes(
              String(payment?.paymentType || "").toLowerCase()
            )
          );
        })
        .reduce((sum, payment) => sum + Math.abs(Number(payment?.amount || 0)), 0);

      const activeInvoiceTotal = tenantInvoices
        .filter((invoice) => {
          const invoiceTenantId = normalizeId(invoice?.tenant);
          return invoiceTenantId === tenantIdStr && isActiveInvoice(invoice);
        })
        .reduce(
          (sum, invoice) =>
            sum + Number((invoice?.netAmount ?? invoice?.adjustedAmount ?? invoice?.amount) || 0),
          0
        );

      const activeNoteEffect = tenantInvoiceNotes
        .filter((note) => {
          const noteTenantId = normalizeId(note?.tenant);
          const status = String(note?.status || "").toLowerCase();
          return noteTenantId === tenantIdStr && !["cancelled", "reversed"].includes(status);
        })
        .reduce((sum, note) => {
          const amount = Math.abs(Number(note?.amount || 0));
          const noteType = String(note?.noteType || note?.documentType || "").toUpperCase();
          if (noteType === "CREDIT_NOTE") return sum - amount;
          if (noteType === "DEBIT_NOTE") return sum + amount;
          return sum;
        }, 0);

      const effectiveInvoiceTotal = tenantInvoices.some((invoice) => Number((invoice?.adjustedAmount ?? invoice?.netAmount ?? invoice?.amount) || 0) !== Number(invoice?.amount || 0))
        ? activeInvoiceTotal
        : activeInvoiceTotal + activeNoteEffect;

      return effectiveInvoiceTotal - confirmedReceiptTotal;
    },
    [rentPayments, tenantInvoices, tenantInvoiceNotes]
  );

  const transformedTenants = useMemo(() => {
    return (Array.isArray(tenantsData) ? tenantsData : []).map((tenant) => {
      const tenantLease = leases.find(
        (l) => normalizeId(l.tenant) === normalizeId(tenant._id)
      );
      const resolvedStartDate = tenantLease?.startDate || tenant.moveInDate;
      const resolvedEndDate = tenantLease?.endDate || tenant.moveOutDate;
      const balance = paymentsSnapshotReady ? calculateTenantBalance(tenant._id) : Number(tenant?.balance || 0);
      const tenantOperationalStatus = computeOperationalStatus({ tenant });

      return {
        id: tenant._id,
        tenantCode: tenant.tenantCode || "-",
        tenantName: tenant.name || "-",
        unitNumber:
          tenant.unit?.unitNumber ||
          tenant.unit?.unitName ||
          tenant.unit?.name ||
          "-",
        propertyName: resolveTenantPropertyName(tenant, units, properties),
        startDate: resolvedStartDate
          ? new Date(resolvedStartDate).toLocaleDateString()
          : "-",
        endDate: resolvedEndDate
          ? new Date(resolvedEndDate).toLocaleDateString()
          : "-",
        rent: tenant.unit?.rent
          ? `Ksh ${tenant.unit.rent.toLocaleString()}`
          : tenantLease?.rentAmount
          ? `Ksh ${Number(tenantLease.rentAmount).toLocaleString()}`
          : "-",
        balance,
        hasBalance: Math.abs(Number(balance || 0)) > 0.009,
        status: tenantOperationalStatus,
        phone: tenant.phone || "-",
        email: tenant.email || "-",
      };
    });
  }, [tenantsData, units, properties, leases, calculateTenantBalance, paymentsSnapshotReady, tenantInvoices]);

  // ===== FILTER TENANTS =====
  const filteredTenants = useMemo(() => {
    return transformedTenants.filter((t) => {
      if (
        appliedFilters.property !== "any" &&
        t.propertyName !== appliedFilters.property
      ) {
        return false;
      }

      if (
        appliedFilters.status !== "any" &&
        t.status !== appliedFilters.status
      ) {
        return false;
      }

      if (appliedFilters.balanceScope === "with_balance" && !t.hasBalance) {
        return false;
      }

      if (appliedFilters.search) {
        const searchLower = appliedFilters.search.toLowerCase();
        const matchesName = t.tenantName.toLowerCase().includes(searchLower);
        const matchesPhone = t.phone.toLowerCase().includes(searchLower);
        if (!matchesName && !matchesPhone) return false;
      }

      if (appliedFilters.tenantName) {
        const nameLower = appliedFilters.tenantName.toLowerCase();
        if (!t.tenantName.toLowerCase().includes(nameLower)) return false;
      }

      if (appliedFilters.tenantCode) {
        const codeLower = appliedFilters.tenantCode.toLowerCase();
        if (!t.tenantCode.toLowerCase().includes(codeLower)) return false;
      }

      return true;
    });
  }, [transformedTenants, appliedFilters]);

  const sortedFilteredTenants = useMemo(() => {
    const sorted = [...filteredTenants];
    sorted.sort((a, b) => {
      const propA = String(a.propertyName || "").toLowerCase();
      const propB = String(b.propertyName || "").toLowerCase();
      if (propA !== propB) return propA.localeCompare(propB);
      return String(a.tenantName || "").localeCompare(String(b.tenantName || ""));
    });
    return sorted;
  }, [filteredTenants]);

  // ===== PAGINATION =====
  const totalPages = Math.max(1, Math.ceil(sortedFilteredTenants.length / ITEMS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentTenants = sortedFilteredTenants.slice(startIndex, endIndex);

  // ===== SELECTION HANDLERS =====
  const handleSelectTenant = (tenantId) => {
    setSelectedTenants((prev) =>
      prev.includes(tenantId)
        ? prev.filter((id) => id !== tenantId)
        : [...prev, tenantId]
    );
  };

  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedTenants([]);
      setSelectAll(false);
    } else {
      setSelectedTenants(currentTenants.map((t) => t.id));
      setSelectAll(true);
    }
  };

  const handleCheckboxClick = (e) => {
    e.stopPropagation();
  };

  // ===== EXPAND/COLLAPSE =====
  const toggleTenantExpand = (tenantId) => {
    setExpandedTenants((prev) =>
      prev.includes(tenantId)
        ? prev.filter((id) => id !== tenantId)
        : [...prev, tenantId]
    );
  };

  const expandAllTenants = () => {
    setExpandedTenants(sortedFilteredTenants.map((t) => t.id));
  };

  const collapseAllTenants = () => {
    setExpandedTenants([]);
  };

  // ===== ACTION MENU HANDLERS =====
  const handleViewStatement = () => {
    if (selectedTenants.length === 0) {
      toast.warning("Please select at least one tenant");
      return;
    }
    const selectedTenant = transformedTenants.find((t) => t.id === selectedTenants[0]);
    const firstName = (selectedTenant?.tenantName || "Tenant").split(" ")[0];
    const tabTitle = `${firstName}-${selectedTenant?.tenantCode || "TT0000"}`;

    if (selectedTenants.length === 1) {
      navigate(`/tenant/${selectedTenants[0]}/statement`, { state: { tabTitle } });
    } else {
      toast.info("Multiple tenants selected. Opening first tenant's statement.");
      navigate(`/tenant/${selectedTenants[0]}/statement`, { state: { tabTitle } });
    }
    setActionMenuOpen(false);
  };

  const handleEditTenant = () => {
    if (selectedTenants.length === 0) {
      toast.warning("Please select a tenant to edit");
      return;
    }
    if (selectedTenants.length > 1) {
      toast.warning("Please select only one tenant to edit");
      return;
    }
    navigate(`/tenant/${selectedTenants[0]}/edit`);
    setActionMenuOpen(false);
  };

  const handleViewReceipts = () => {
    if (selectedTenants.length === 0) {
      toast.warning("Please select at least one tenant");
      return;
    }
    navigate(`/receipts/${selectedTenants[0]}`);
    setActionMenuOpen(false);
  };

  const handleAddUtility = () => {
    if (selectedTenants.length === 0) {
      toast.warning("Please select at least one tenant");
      return;
    }
    toast.info("Add utility feature coming soon");
    setActionMenuOpen(false);
  };

  const handleReviewRent = () => {
    if (selectedTenants.length === 0) {
      toast.warning("Please select at least one tenant");
      return;
    }
    toast.info("Review rent feature coming soon");
    setActionMenuOpen(false);
  };

  const handleResetFilters = () => {
    const resetState = {
      property: "any",
      status: "active",
      balanceScope: "any",
      search: "",
      tenantName: "",
      tenantCode: "",
    };
    setDraftFilters(resetState);
    setAppliedFilters(resetState);
    setCurrentPage(1);
  };

  // ===== CRUD ACTIONS =====
  const handleDeleteSelectedTenants = async () => {
    if (selectedTenants.length === 0) {
      toast.warning("Please select at least one tenant to delete");
      return;
    }
    setShowDeleteModal(true);
  };

  const confirmDeleteTenants = async () => {
    setIsDeleting(true);
    let successCount = 0;
    let failCount = 0;

    for (const tenantId of selectedTenants) {
      try {
        await dispatch(deleteTenant(tenantId)).unwrap();
        successCount++;
      } catch (error) {
        console.error(`Failed to delete tenant ${tenantId}:`, error);
        failCount++;
      }
    }

    setIsDeleting(false);
    setShowDeleteModal(false);
    setSelectedTenants([]);
    setSelectAll(false);
    setActionMenuOpen(false);

    if (successCount > 0) {
      toast.success(`Successfully deleted ${successCount} tenant(s)`);
    }
    if (failCount > 0) {
      toast.error(`Failed to delete ${failCount} tenant(s)`);
    }

    if (currentCompany?._id) {
      dispatch(getTenants({ business: currentCompany._id }));
      loadInvoices();
    }
  };

  // ---------------------------
  // EXCEL IMPORT/EXPORT HANDLERS
  // ---------------------------
  const handleDownloadTemplate = () => {
    downloadTenantsTemplate(units || []);
    toast.info("Tenants import template downloaded!");
  };

  const handleBulkImport = async (validRecords) => {
    try {
      const response = await adminRequests.post("/tenants/bulk-import", {
        tenants: validRecords,
        business: currentCompany._id,
      });

      await dispatch(getTenants({ business: currentCompany._id }));
      await loadInvoices();

      return response.data;
    } catch (error) {
      console.error("Bulk import error:", error);
      throw new Error(error.response?.data?.message || "Failed to import tenants");
    }
  };

  const handlePrintList = () => {
    if (!filteredTenants.length) {
      toast.warning("No tenants to print");
      return;
    }

    const resolveTenantPrintTaxLabel = (row) => {
      const propertyName = resolveTenantPropertyName(row, units, properties);
      const matchedProperty = (Array.isArray(properties) ? properties : []).find((item) => {
        const candidateName = item?.propertyName || item?.name || "";
        return String(candidateName).trim().toLowerCase() === String(propertyName || "").trim().toLowerCase();
      });

      const vatRate = Number(matchedProperty?.vatRate || 0);
      const taxCodeKey = String(matchedProperty?.taxCodeKey || "").trim();
      const taxMode = String(matchedProperty?.taxMode || "company_default").trim().toLowerCase();

      if (vatRate > 0) {
        return `${vatRate}% ${taxMode === "inclusive" ? "Inclusive" : taxMode === "exclusive" ? "Exclusive" : "VAT"}`;
      }

      if (taxCodeKey) {
        return taxCodeKey.replace(/[_-]+/g, " ").split(/\s+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
      }

      return currentCompany?.taxRegime || "-";
    };

    printTabularList({
      title: "Tenants List",
      subtitle: "Current filtered tenants register",
      company: currentCompany || {},
      summary: `Records: ${filteredTenants.length} • Printed on ${new Date().toLocaleString()}`,
      columns: [
        { label: "Tenant Code", value: (row) => row?.tenantCode || row?.code || "-" },
        { label: "Tenant Name", value: (row) => row?.name || row?.tenantName || "-" },
        { label: "Property", value: (row) => resolveTenantPropertyName(row, units, properties) },
        { label: "Unit", value: (row) => row?.unit?.unitNumber || row?.unitNumber || "-" },
        { label: "VAT / Tax", value: (row) => resolveTenantPrintTaxLabel(row) },
        { label: "Rent", value: (row) => Number(row?.rent || row?.monthlyRent || 0).toLocaleString(), align: "right" },
        { label: "Balance", value: (row) => Number(row?.balance || 0).toLocaleString(), align: "right" },
        { label: "Status", value: (row) => computeOperationalStatus({ tenant: row }) },
      ],
      rows: filteredTenants,
    });
  };

  const handleExportToExcel = () => {
    if (!tenantsData || tenantsData.length === 0) {
      toast.warning("No tenants to export");
      return;
    }
    exportTenantsToExcel(tenantsData);
    toast.info("Tenants exported successfully!");
  };

  // ===== FILTER OPTIONS =====
  const uniqueProperties = useMemo(() => {
    const propertyNames = properties
      .map((p) => p.propertyName || p.name)
      .filter(Boolean);
    return ["any", ...Array.from(new Set(propertyNames)).sort()];
  }, [properties]);

  const statusOptions = ["active", "terminated", "inactive", "any"];
  const balanceScopeOptions = ["any", "with_balance"];

  // ===== RENDER =====
  return (
    <DashboardLayout lockContentScroll>
      <div className="flex flex-col h-full min-h-0 p-0 bg-gray-50 overflow-hidden">
        {/* ===== FILTER BAR ===== */}
        <div className="flex-shrink-0 sticky top-0 z-30 bg-white border-b border-gray-200 px-2 pt-1">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <div>
              <select
                value={draftFilters.property}
                onChange={(e) =>
                  setDraftFilters({ ...draftFilters, property: e.target.value })
                }
                className="px-3 py-1 text-xs border border-gray-300 rounded shadow-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 bg-[#addbb2] text-gray-800 hover:bg-white transition-colors"
              >
                {uniqueProperties.map((prop) => (
                  <option key={prop} value={prop}>
                    {prop === "any" ? "All Properties" : prop}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <select
                value={draftFilters.status}
                onChange={(e) =>
                  setDraftFilters({ ...draftFilters, status: e.target.value })
                }
                className="px-3 py-1 text-xs border border-gray-300 rounded shadow-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 bg-[#addbb2] text-gray-800 hover:bg-white transition-colors"
              >
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status === "any"
                      ? "All Status"
                      : status.charAt(0).toUpperCase() + status.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <select
                value={draftFilters.balanceScope}
                onChange={(e) =>
                  setDraftFilters({ ...draftFilters, balanceScope: e.target.value })
                }
                className="px-3 py-1 text-xs border border-gray-300 rounded shadow-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 bg-[#addbb2] text-gray-800 hover:bg-white transition-colors"
              >
                {balanceScopeOptions.map((scope) => (
                  <option key={scope} value={scope}>
                    {scope === "with_balance" ? "With Balance Only" : "All Balances"}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <input
                type="text"
                placeholder="Tenant Name"
                value={draftFilters.tenantName}
                onChange={(e) =>
                  setDraftFilters({ ...draftFilters, tenantName: e.target.value })
                }
                className="px-3 py-1 text-xs border border-gray-300 rounded shadow-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 bg-[#addbb2] text-gray-800 placeholder-gray-600"
              />
            </div>

            <div>
              <input
                type="text"
                placeholder="Tenant Code (TT####)"
                value={draftFilters.tenantCode}
                onChange={(e) =>
                  setDraftFilters({ ...draftFilters, tenantCode: e.target.value })
                }
                className="px-3 py-1 text-xs border border-gray-300 rounded shadow-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 bg-[#addbb2] text-gray-800 placeholder-gray-600"
              />
            </div>

            <div className="relative flex-1 min-w-[200px]">
              <FaSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 text-xs" />
              <input
                type="text"
                placeholder="Search tenants..."
                value={draftFilters.search}
                onChange={(e) =>
                  setDraftFilters({ ...draftFilters, search: e.target.value })
                }
                className="w-full pl-9 pr-3 py-1 text-xs border border-gray-300 rounded bg-white shadow-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
              />
            </div>
          </div>
        </div>

        {/* ===== COMPACT ACTION BAR ===== */}
        <div className="flex-shrink-0 bg-gray-50 border-b border-gray-200 px-2 py-2 flex items-center justify-start">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={expandAllTenants}
              className="p-1.5 hover:bg-gray-200 rounded transition-colors text-gray-700 text-sm"
              title="Expand all"
            >
              <FaExpandAlt />
            </button>
            <button
              onClick={collapseAllTenants}
              className="p-1.5 hover:bg-gray-200 rounded transition-colors text-gray-700 text-sm"
              title="Collapse all"
            >
              <FaCompressAlt />
            </button>
            <span className="text-xs font-bold text-gray-700">
              {selectedTenants.length} selected
            </span>

            <button
              onClick={handleEditTenant}
              className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded text-xs font-medium flex items-center gap-1 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              title="Edit Selected Tenant"
              disabled={selectedTenants.length !== 1}
            >
              <FaEdit size={10} />
              <span>Edit</span>
            </button>

            <div className="relative" ref={actionMenuRef}>
              <button
                onClick={() => setActionMenuOpen(!actionMenuOpen)}
                className={`${MILIK_GREEN} hover:bg-[#0A3127] text-white px-3 py-1 rounded text-xs font-medium flex items-center gap-1 shadow-sm`}
                title="More Actions"
              >
                <FaEllipsisV size={10} />
                <span>Actions</span>
              </button>

              {actionMenuOpen && (
                <div className="absolute right-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                  <div className="py-1">
                    <button
                      onClick={handleViewStatement}
                      className="w-full text-left px-4 py-2 text-xs hover:bg-gray-100 flex items-center gap-2 text-gray-700"
                    >
                      <FaFileInvoiceDollar size={12} />
                      <span>View Tenant Statement</span>
                    </button>
                    <button
                      onClick={handleEditTenant}
                      className="w-full text-left px-4 py-2 text-xs hover:bg-gray-100 flex items-center gap-2 text-gray-700"
                    >
                      <FaUserEdit size={12} />
                      <span>Edit Tenant Details</span>
                    </button>
                    <button
                      onClick={handleViewReceipts}
                      className="w-full text-left px-4 py-2 text-xs hover:bg-gray-100 flex items-center gap-2 text-gray-700"
                    >
                      <FaMoneyBillWave size={12} />
                      <span>View Tenant Receipts</span>
                    </button>
                    <button
                      onClick={handleAddUtility}
                      className="w-full text-left px-4 py-2 text-xs hover:bg-gray-100 flex items-center gap-2 text-gray-700"
                    >
                      <FaBolt size={12} />
                      <span>Add Utility to Selected Tenant</span>
                    </button>
                    <button
                      onClick={handleReviewRent}
                      className="w-full text-left px-4 py-2 text-xs hover:bg-gray-100 flex items-center gap-2 text-gray-700 border-t border-gray-200"
                    >
                      <FaChartLine size={12} />
                      <span>Review Rent for Selected Tenant</span>
                    </button>
                    <button
                      onClick={() => {
                        setActionMenuOpen(false);
                        setShowCommunicationModal(true);
                      }}
                      className="w-full text-left px-4 py-2 text-xs hover:bg-orange-50 flex items-center gap-2 text-orange-700 border-t border-gray-200"
                    >
                      <FaSms size={12} />
                      <span>SMS Tenants</span>
                    </button>
                    <button
                      onClick={handleDeleteSelectedTenants}
                      className="w-full text-left px-4 py-2 text-xs hover:bg-red-50 flex items-center gap-2 text-red-600 border-t border-gray-200 font-semibold"
                    >
                      <FaTrash size={12} />
                      <span>Delete Selected Tenant(s)</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={() => navigate("/tenant/new")}
              className={`px-3 py-1 text-xs ${MILIK_ORANGE} text-white rounded font-medium flex items-center gap-1 hover:bg-[#e67e00] transition-colors shadow-sm`}
            >
              <FaPlus className="text-xs" />
              <span>Add</span>
            </button>

            <button
              onClick={() => setAppliedFilters(draftFilters)}
              className={`px-3 py-1 text-xs ${MILIK_GREEN} text-white rounded font-medium flex items-center gap-1 hover:bg-[#0A3127] transition-colors shadow-sm`}
            >
              <FaSearch className="text-xs" />
              <span>Search</span>
            </button>

            <button
              onClick={handleResetFilters}
              className="px-3 py-1 text-xs bg-gray-500 text-white rounded font-medium flex items-center gap-1 hover:bg-gray-600 transition-colors shadow-sm"
            >
              <FaRedoAlt className="text-xs" />
              <span>Reset</span>
            </button>

            <button
              onClick={handleDownloadTemplate}
              className="px-3 py-1 text-xs bg-blue-500 text-white rounded font-medium flex items-center gap-1 hover:bg-blue-600 transition-colors shadow-sm"
              title="Download import template"
            >
              <FaDownload className="text-xs" />
              <span>Template</span>
            </button>

            <button
              onClick={() => setShowImportModal(true)}
              className={`px-3 py-1 text-xs ${MILIK_ORANGE} text-white rounded font-medium flex items-center gap-1 hover:bg-[#e67e00] transition-colors shadow-sm`}
              title="Import tenants from Excel"
            >
              <FaFileExport className="text-xs rotate-180" />
              <span>Import</span>
            </button>

            <button
              onClick={handlePrintList}
              className="px-3 py-1 text-xs bg-slate-700 text-white rounded font-medium flex items-center gap-1 hover:bg-slate-800 transition-colors shadow-sm"
              title="Print tenants list"
            >
              <FaPrint className="text-xs" />
              <span>Print List</span>
            </button>

            <button
              onClick={handleExportToExcel}
              className="px-3 py-1 text-xs bg-gray-600 text-white rounded font-medium flex items-center gap-1 hover:bg-gray-700 transition-colors shadow-sm"
              title="Export tenants to Excel"
            >
              <FaFileExport className="text-xs" />
              <span>Export</span>
            </button>
          </div>
        </div>

        {/* ===== TENANTS TABLE ===== */}
        <div className="flex-1 min-h-0 overflow-auto px-2 py-1">
          <table className="w-full border-collapse">
            <thead>
              <tr className={`${MILIK_GREEN} text-white text-xs`}>
                <th className="px-2 py-1.5 text-center font-bold border-r border-gray-400 w-6">
                  <input
                    type="checkbox"
                    checked={selectAll}
                    onChange={handleSelectAll}
                    onClick={handleCheckboxClick}
                    className="rounded border-gray-300 text-orange-600 focus:ring-orange-500 cursor-pointer"
                  />
                </th>
                <th className="px-2 py-1.5 text-center font-bold border-r border-gray-400 w-6">
                  ⬇️
                </th>
                <th className="px-2 py-1.5 text-left font-bold border-r border-gray-400 min-w-[80px]">
                  Code
                </th>
                <th className="px-2 py-1.5 text-left font-bold border-r border-gray-400 min-w-[150px]">
                  Tenant Name
                </th>
                <th className="px-2 py-1.5 text-left font-bold border-r border-gray-400 min-w-[120px]">
                  Property
                </th>
                <th className="px-2 py-1.5 text-left font-bold border-r border-gray-400 min-w-[80px]">
                  Unit
                </th>
                <th className="px-2 py-1.5 text-left font-bold border-r border-gray-400 min-w-[120px]">
                  Lease Start Date
                </th>
                <th className="px-2 py-1.5 text-left font-bold border-r border-gray-400 min-w-[120px]">
                  Lease End Date
                </th>
                <th className="px-2 py-1.5 text-right font-bold border-r border-gray-400 min-w-[100px]">
                  Rent
                </th>
                <th className="px-2 py-1.5 text-right font-bold border-r border-gray-400 min-w-[110px]">
                  Balance
                </th>
                <th className="px-2 py-1.5 text-center font-bold border-r border-gray-400 min-w-[80px]">
                  Status
                </th>
                <th className="px-2 py-1.5 text-left font-bold min-w-[100px]">
                  Phone
                </th>
              </tr>
            </thead>

            <tbody>
              {currentTenants.length > 0 ? (
                currentTenants.map((tenant, idx) => {
                  const isFirstOfProperty =
                    idx === 0 || currentTenants[idx - 1].propertyName !== tenant.propertyName;

                  return (
                    <React.Fragment key={tenant.id}>
                      {isFirstOfProperty && (
                        <tr className="bg-transparent">
                          <td colSpan={12} className="px-2 pt-1.5 pb-1">
                            <h3 className="text-sm font-extrabold text-black tracking-normal uppercase">
                              {tenant.propertyName}
                            </h3>
                            <div className="mt-1 h-[2px] w-full bg-[#FF8C00]" />
                          </td>
                        </tr>
                      )}

                      <tr
                        className={`border-b border-gray-200 cursor-pointer transition-colors text-xs ${
                          selectedTenants.includes(tenant.id)
                            ? "bg-orange-50 hover:bg-orange-100"
                            : "bg-white hover:bg-gray-50"
                        }`}
                        onClick={() => handleSelectTenant(tenant.id)}
                      >
                        <td
                          className="px-2 py-1 text-center border-r border-gray-200"
                          onClick={handleCheckboxClick}
                        >
                          <input
                            type="checkbox"
                            checked={selectedTenants.includes(tenant.id)}
                            onChange={() => handleSelectTenant(tenant.id)}
                            onClick={handleCheckboxClick}
                            className="rounded border-gray-300 text-orange-600 focus:ring-orange-500 cursor-pointer"
                          />
                        </td>
                        <td
                          className="px-2 py-1 text-center border-r border-gray-200 cursor-pointer"
                          onClick={() => toggleTenantExpand(tenant.id)}
                        >
                          <span>
                            {expandedTenants.includes(tenant.id) ? "▼" : "▶"}
                          </span>
                        </td>
                        <td className="px-2 py-1 font-mono text-gray-600 border-r border-gray-200 text-xs">
                          {tenant.tenantCode}
                        </td>
                        <td className="px-2 py-1 font-bold text-gray-900 border-r border-gray-200">
                          {tenant.tenantName}
                        </td>
                        <td className="px-2 py-1 font-bold text-gray-900 border-r border-gray-200">
                          {tenant.propertyName}
                        </td>
                        <td className="px-2 py-1 font-bold text-gray-900 border-r border-gray-200">
                          {tenant.unitNumber}
                        </td>
                        <td className="px-2 py-1 font-bold text-gray-900 border-r border-gray-200">
                          {tenant.startDate}
                        </td>
                        <td className="px-2 py-1 font-bold text-gray-900 border-r border-gray-200">
                          {tenant.endDate}
                        </td>
                        <td className="px-2 py-1 font-bold text-gray-900 text-right border-r border-gray-200">
                          {tenant.rent}
                        </td>
                        <td className="px-2 py-1 font-bold text-right border-r border-gray-200">
                          <span
                            className={`${
                              tenant.balance > 0
                                ? "text-red-600"
                                : tenant.balance < 0
                                ? "text-green-600"
                                : "text-gray-600"
                            }`}
                          >
                            Ksh {tenant.balance.toLocaleString()}
                          </span>
                        </td>
                        <td className="px-2 py-1 text-center border-r border-gray-200">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${
                              tenant.status === "active"
                                ? "bg-green-100 text-green-800"
                                : tenant.status === "terminated"
                                ? "bg-red-100 text-red-700"
                                : "bg-gray-100 text-gray-800"
                            }`}
                          >
                            {tenant.status}
                          </span>
                        </td>
                        <td className="px-2 py-1 font-bold text-gray-900">
                          {tenant.phone}
                        </td>
                      </tr>

                      {expandedTenants.includes(tenant.id) && (
                        <tr className="bg-gray-100 border-b border-gray-200">
                          <td colSpan="12" className="px-3 py-2">
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                              <div>
                                <h4 className="font-bold text-gray-900 mb-2 text-xs border-b-2 border-orange-500 pb-1">
                                  👤 Tenant Details
                                </h4>
                                <div className="space-y-1 text-xs">
                                  <div>
                                    <span className="font-bold text-gray-700 block text-xs">Email:</span>
                                    <p className="text-gray-600 text-xs">{tenant.email}</p>
                                  </div>
                                  <div>
                                    <span className="font-bold text-gray-700 block text-xs">Phone:</span>
                                    <p className="text-gray-600 text-xs">{tenant.phone}</p>
                                  </div>
                                  <div>
                                    <span className="font-bold text-gray-700 block text-xs">Property:</span>
                                    <p className="text-gray-600 text-xs">{tenant.propertyName}</p>
                                  </div>
                                </div>
                              </div>

                              <div>
                                <h4 className="font-bold text-gray-900 mb-2 text-xs border-b-2 border-green-500 pb-1">
                                  💰 Billing Info
                                </h4>
                                <div className="space-y-1 text-xs">
                                  <div>
                                    <span className="font-bold text-gray-700 block text-xs">Monthly Rent:</span>
                                    <p className="text-gray-600 font-bold">{tenant.rent}</p>
                                  </div>
                                  <div>
                                    <span className="font-bold text-gray-700 block text-xs">Balance:</span>
                                    <p
                                      className={`font-bold ${
                                        tenant.balance > 0
                                          ? "text-red-600"
                                          : tenant.balance < 0
                                          ? "text-green-600"
                                          : "text-gray-600"
                                      }`}
                                    >
                                      Ksh {tenant.balance.toLocaleString()}
                                    </p>
                                  </div>
                                  <div>
                                    <span className="font-bold text-gray-700 block text-xs">Status:</span>
                                    <p
                                      className={`text-xs font-bold ${
                                        tenant.status === "any"
                                          ? "text-green-700"
                                          : "text-gray-700"
                                      }`}
                                    >
                                      {tenant.status.toUpperCase()}
                                    </p>
                                  </div>
                                </div>
                              </div>

                              <div>
                                <h4 className="font-bold text-gray-900 mb-2 text-xs border-b-2 border-blue-500 pb-1">
                                  📋 Lease Details
                                </h4>
                                <div className="space-y-1 text-xs">
                                  <div>
                                    <span className="font-bold text-gray-700 block text-xs">Unit:</span>
                                    <p className="text-gray-600 text-xs">{tenant.unitNumber}</p>
                                  </div>
                                  <div>
                                    <span className="font-bold text-gray-700 block text-xs">Lease Start Date:</span>
                                    <p className="text-gray-600 font-bold text-xs">{tenant.startDate}</p>
                                  </div>
                                  <div>
                                    <span className="font-bold text-gray-700 block text-xs">Lease End Date:</span>
                                    <p className="text-gray-600 font-bold text-xs">{tenant.endDate}</p>
                                  </div>
                                </div>
                              </div>

                              <div>
                                <h4 className="font-bold text-gray-900 mb-2 text-xs border-b-2 border-purple-500 pb-1">
                                  ⚙️ Actions
                                </h4>
                                <div className="flex flex-col gap-1">
                                  <button
                                    onClick={() => {
                                      const firstName = (tenant.tenantName || "Tenant").split(" ")[0];
                                      const tabTitle = `${firstName}-${tenant.tenantCode || "TT0000"}`;
                                      navigate(`/tenant/${tenant.id}/statement`, { state: { tabTitle } });
                                    }}
                                    className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded text-xs transition-colors"
                                  >
                                    💳 View Statement
                                  </button>
                                  <button
                                  onClick={() => {
                                    setSelectedTenants([tenant.id]);
                                    setShowDeleteModal(true);
                                  }}
            
                                    className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white font-bold rounded text-xs transition-colors"
                                  >
                                    🗑️ Delete
                                  </button>
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
                  <td colSpan="12" className="px-3 py-4 text-center text-gray-600 font-semibold text-xs">
                    No tenants found. Try adjusting filters or create a new tenant.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ===== COMPACT PAGINATION FOOTER ===== */}
        <div className="flex-shrink-0 sticky bottom-0 z-20 bg-white border-t border-gray-200 px-2 py-2 flex items-center justify-between">
          <div className="text-xs font-bold text-gray-600">
            Showing {currentTenants.length > 0 ? startIndex + 1 : 0} to{" "}
            {Math.min(endIndex, sortedFilteredTenants.length)} of {sortedFilteredTenants.length}{" "}
            tenants
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(safeCurrentPage - 1)}
              disabled={safeCurrentPage === 1}
              className="p-1 hover:bg-gray-100 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-gray-700 text-xs"
            >
              <FaChevronLeft size={12} />
            </button>

            <div className="flex items-center gap-0.5">
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
                      onClick={() => setCurrentPage(page)}
                      className={`px-2 py-0.5 rounded text-xs font-bold transition-colors ${
                        safeCurrentPage === page
                          ? `${MILIK_ORANGE} text-white`
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      }`}
                    >
                      {page}
                    </button>
                  );
                } else if (
                  page === safeCurrentPage - 2 ||
                  page === safeCurrentPage + 2
                ) {
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
              onClick={() => setCurrentPage(safeCurrentPage + 1)}
              disabled={safeCurrentPage === totalPages}
              className="p-1 hover:bg-gray-100 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-gray-700 text-xs"
            >
              <FaChevronRight size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* ===== DELETE CONFIRMATION MODAL ===== */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/0 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-md transform transition-all">
            <div className="bg-gradient-to-r from-red-600 to-red-700 px-6 py-4 rounded-t-lg">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <FaTrash size={18} />
                Confirm Delete
              </h3>
            </div>

            <div className="p-6">
              <p className="text-gray-700 mb-4">
                Are you sure you want to delete <strong>{selectedTenants.length}</strong> tenant(s)?
              </p>
              <p className="text-sm text-red-600 font-semibold">
                ⚠️ This action cannot be undone!
              </p>

              {selectedTenants.length > 0 && (
                <div className="mt-4 p-3 bg-gray-50 rounded border border-gray-200">
                  <p className="text-xs text-gray-600 mb-2">Tenants to be deleted:</p>
                  <ul className="text-xs text-gray-700 space-y-1 max-h-32 overflow-y-auto">
                    {selectedTenants.slice(0, 10).map((tenantId) => {
                      const tenant = transformedTenants.find((t) => t.id === tenantId);
                      return tenant ? (
                        <li key={tenantId} className="flex items-center gap-2">
                          <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                          <span className="font-semibold">{tenant.tenantCode}</span> - {tenant.tenantName}
                        </li>
                      ) : null;
                    })}
                    {selectedTenants.length > 10 && (
                      <li className="text-gray-500 italic">
                        ...and {selectedTenants.length - 10} more
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>

            <div className="flex gap-3 px-6 py-4 bg-gray-50 rounded-b-lg">
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={isDeleting}
                className="flex-1 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-md font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteTenants}
                disabled={isDeleting}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <FaSpinner className="animate-spin" size={14} />
                    Deleting...
                  </>
                ) : (
                  <>
                    <FaTrash size={14} />
                    Delete {selectedTenants.length} Tenant(s)
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <CommunicationComposerModal
        open={showCommunicationModal}
        onClose={() => setShowCommunicationModal(false)}
        businessId={currentCompany?._id || ""}
        contextType="tenant_bulk"
        recordIds={selectedTenants}
        title="SMS Tenants"
        subtitle="Use tenant-relevant templates only and preview the resolved message first."
        allowedChannels={["sms"]}
        defaultChannel="sms"
      />

      {/* ===== TENANTS IMPORT MODAL ===== */}
      <TenantsImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImport={handleBulkImport}
      />
    </DashboardLayout>
  );
};

export default Tenants;