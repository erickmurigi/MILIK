import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import {
  FaArrowLeft,
  FaBook,
  FaCheckCircle,
  FaChevronDown,
  FaChevronUp,
  FaDownload,
  FaEnvelope,
  FaHourglass,
  FaMoneyBillWave,
  FaPrint,
  FaUndo,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { hasCompanyPermission } from "../../utils/permissions";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import JournalEntriesDrawer from "../../components/Accounting/JournalEntriesDrawer";
import {
  reverseStatement,
  updateStatement,
} from "../../redux/processedStatementsRedux";
import PayLandlordModal from "../../components/Modals/PayLandlordModal";
import RecordLandlordRecoveryModal from "../../components/Modals/RecordLandlordRecoveryModal";
import PostCommissionModal from "../../components/Modals/PostCommissionModal";
import CommunicationComposerModal from "../../components/Communications/CommunicationComposerModal";
import { adminRequests } from "../../utils/requestMethods";
import { getChartOfAccounts } from "../../redux/apiCalls";
import { selectCurrentCompany, selectCurrentUser } from "../../redux/selectors";

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";
const MILIK_ORANGE = "bg-[#FF8C00]";
const MILIK_ORANGE_HOVER = "hover:bg-[#e67e00]";
const ITEMS_PER_PAGE = 50;

const money = (value) => Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const displayMoney = (value) => `KSh ${money(value)}`;
const formatPaymentMethod = (method) => method ? method.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '—';
const formatDate = (dateString) => {
  if (!dateString) return "N/A";
  return new Date(dateString).toLocaleDateString("en-GB");
};
const formatPeriodRange = (statement) =>
  `${formatDate(statement?.periodStart)} - ${formatDate(statement?.periodEnd)}`;
const getCommissionBasisLabel = (basis) =>
  basis === "invoiced"
    ? "Rent Expected (Accrual)"
    : basis === "received_manager_only"
    ? "Rent Collected by Manager Only"
    : "Rent Collected (Cash)";
const isNegativeProcessedStatement = (statement) =>
  Boolean(statement?.isNegativeStatement) || Number(statement?.amountPayableByLandlordToManager || 0) > 0;
const getOutstandingRecoveryBalance = (statement) => {
  const total = Number(statement?.amountPayableByLandlordToManager || 0);
  const recovered = Number(statement?.amountRecovered || 0);
  return Math.max(total - recovered, 0);
};
const getStatementDisplayAmount = (statement) =>
  isNegativeProcessedStatement(statement)
    ? Number(statement?.recoveryBalance ?? getOutstandingRecoveryBalance(statement))
    : Number(statement?.balanceDue ?? statement?.netAmountDue ?? 0);
const getStatementAmountHeading = (statement) =>
  isNegativeProcessedStatement(statement) ? "Landlord Owes Manager" : "Net Due";

const ProcessedStatements = () => {
  const dispatch  = useDispatch();
  const navigate  = useNavigate();
  const location  = useLocation();
  const fromLedger = location.state?.fromPropertyLedger;

  const currentUser = useSelector(selectCurrentUser);
  const currentCompany = useSelector(selectCurrentCompany);
  const { canProcessLandlordPayments, canReverseProcessedStatement, canExportProcessedStatement, canSendCommunications } = useMemo(() => ({
    canProcessLandlordPayments: hasCompanyPermission(currentUser || {}, currentCompany, "landlordPayments", "process", "accounts"),
    canReverseProcessedStatement: hasCompanyPermission(currentUser || {}, currentCompany, "processedStatements", "reverse", "accounts"),
    canExportProcessedStatement: hasCompanyPermission(currentUser || {}, currentCompany, "processedStatements", "export", "accounts"),
    canSendCommunications: hasCompanyPermission(currentUser || {}, currentCompany, "processedStatements", "send", "accounts"),
  }), [currentUser, currentCompany]);
  const [statements, setStatements] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pages: 1, limit: ITEMS_PER_PAGE });
  const [loading, setLoading] = useState(false);
  const [glStatement, setGlStatement] = useState(null);

  const [activeTab, setActiveTab] = useTabState("/landlord/processed-statements:activeTab", "outstanding");
  const [expandedRow, setExpandedRow] = useState(null);
  const [searchText, setSearchText] = useTabState("/landlord/processed-statements:searchText", fromLedger ? (location.state?.propertyName || "") : "");
  const [sortBy, setSortBy] = useTabState("/landlord/processed-statements:sortBy", "date-desc");
  const [currentPage, setCurrentPage] = useTabState("/landlord/processed-statements:currentPage", 1);

  // Refs so loadStatements always reads current values without stale closure
  const tabRef = useRef("outstanding");
  const sortByRef = useRef("date-desc");
  const searchRef = useRef("");
  const [showPayModal, setShowPayModal] = useState(null);
  const [showRecoveryModal, setShowRecoveryModal] = useState(null);
  const [showCommissionModal, setShowCommissionModal] = useState(null);
  const [commModalStatement, setCommModalStatement] = useState(null);
  const [cashbookOptions, setCashbookOptions] = useState([]);
  const [reversalModal, setReversalModal] = useState({ open: false, statement: null, reason: "", loading: false });

  const businessId = useMemo(
    () => currentCompany?._id || currentUser?.company?._id || currentUser?.company || currentUser?.businessId || "",
    [currentCompany?._id, currentUser?.company, currentUser?.businessId]
  );

  const loadStatements = useCallback(async (page = 1) => {
    if (!businessId) return;
    setLoading(true);
    try {
      const params = { tab: tabRef.current, page, limit: ITEMS_PER_PAGE, sortBy: sortByRef.current };
      if (searchRef.current) params.search = searchRef.current;
      const res = await adminRequests.get(`/processed-statements/business/${businessId}`, { params });
      setStatements(res.data.statements || []);
      setPagination({
        total: res.data.total ?? 0,
        page: res.data.page ?? page,
        pages: res.data.pages ?? 1,
        limit: ITEMS_PER_PAGE,
      });
      setCurrentPage(res.data.page ?? page);
    } catch {
      toast.error("Failed to load processed statements");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return;
    // Run both in parallel — previously two sequential useEffect waterfalls
    loadStatements(1);
    getChartOfAccounts({ business: businessId, type: "asset" }).then((chartAccounts) => {
      const options = (Array.isArray(chartAccounts) ? chartAccounts : []).filter((account) => {
        const name = String(account?.name || "").toLowerCase();
        const code = String(account?.code || "");
        return (
          String(account?.type || "").toLowerCase() === "asset" &&
          account?.isPosting !== false &&
          !account?.isHeader &&
          (/^11/.test(code) || /(cash|bank|mpesa|m-pesa|mobile money|wallet|collection)/i.test(name))
        );
      });
      setCashbookOptions(options);
    }).catch(() => {});
  }, [businessId]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Server handles all filtering/sorting — statements is the current page
  const filteredStatements = statements; // alias for JSX references
  const paginatedStatements = statements;
  const totalPages = Math.max(1, pagination.pages);
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = pagination.total === 0 ? 0 : (safeCurrentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;

  const handleTabChange = (tab) => {
    tabRef.current = tab;
    setActiveTab(tab);
    setCurrentPage(1);
    setExpandedRow(null);
    loadStatements(1);
  };

  const handleSearchChange = (val) => {
    searchRef.current = val;
    setSearchText(val);
  };

  const applySearch = () => {
    setCurrentPage(1);
    setExpandedRow(null);
    loadStatements(1);
  };

  const handleSortChange = (val) => {
    sortByRef.current = val;
    setSortBy(val);
    setCurrentPage(1);
    loadStatements(1);
  };

  const handlePageChange = (page) => {
    const target = Math.max(1, Math.min(totalPages, page));
    setCurrentPage(target);
    loadStatements(target);
  };

  const stats = useMemo(() => {
    let totalPaid = 0, totalUnpaid = 0, totalRecoveries = 0, totalReversed = 0;
    let totalAmountPaid = 0, totalAmountUnpaid = 0, totalRecoveryAmount = 0;

    statements.forEach((s) => {
      if (s?.status === "reversed") {
        totalReversed++;
        return;
      }
      if (isNegativeProcessedStatement(s)) {
        totalRecoveries++;
        totalRecoveryAmount += getOutstandingRecoveryBalance(s);
        return;
      }
      if (s.status === "paid") {
        totalPaid++;
        totalAmountPaid += Number(s.amountPaid || s.netAmountDue || 0);
      } else if (["unpaid", "part_paid"].includes(s.status)) {
        totalUnpaid++;
        totalAmountUnpaid += Number(s.balanceDue ?? s.netAmountDue ?? 0);
      }
    });

    return { totalPaid, totalUnpaid, totalRecoveries, totalReversed, totalAmountPaid, totalAmountUnpaid, totalRecoveryAmount };
  }, [statements]);

  const reloadStatements = () => loadStatements(safeCurrentPage);

  const handleMarkAsPaid = async (statementId) => {
    if (!canProcessLandlordPayments) {
      toast.warning("You do not have permission to process landlord payments");
      return;
    }
    try {
      await dispatch(
        updateStatement({
          statementId,
          updates: {
            status: "paid",
            paidDate: new Date().toISOString(),
          },
        })
      ).unwrap();
      toast.success("Statement marked as paid");
    } catch (error) {
      toast.error(error || "Failed to update statement");
    }
  };

  const handleMarkAsUnpaid = async (statementId) => {
    if (!canProcessLandlordPayments) {
      toast.warning("You do not have permission to update landlord payment status");
      return;
    }
    try {
      await dispatch(
        updateStatement({
          statementId,
          updates: {
            status: "unpaid",
            paidDate: null,
          },
        })
      ).unwrap();
      toast.success("Statement marked as unpaid");
    } catch (error) {
      toast.error(error || "Failed to update statement");
    }
  };

  const handlePayLandlord = async (statementId, paymentData) => {
    try {
      const response = await adminRequests.post(`/landlord-payments/pay`, {
        statementId,
        business: businessId,
        ...paymentData,
      });
      toast.success(response?.data?.message || "Payment recorded successfully");
      setShowPayModal(null);
      reloadStatements();
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message || "Failed to record payment");
    }
  };

  const handleRecordRecovery = async (statementId, recoveryData) => {
    try {
      const response = await adminRequests.post(`/landlord-payments/record-recovery`, {
        statementId,
        business: businessId,
        ...recoveryData,
      });
      toast.success(response?.data?.message || "Recovery recorded successfully");
      setShowRecoveryModal(null);
      reloadStatements();
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message || "Failed to record recovery");
    }
  };

  const handlePostCommission = async (statementId, commissionData) => {
    try {
      const response = await adminRequests.post(`/landlord-payments/post-commission`, {
        statementId,
        business: businessId,
        ...commissionData,
      });
      toast.success(response?.data?.message || "Commission posted successfully");
      setShowCommissionModal(null);
      reloadStatements();
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message || "Failed to post commission");
    }
  };

  const handleReverseStatement = (statement) => {
    if (!canReverseProcessedStatement) {
      toast.warning("You do not have permission to reverse processed statements");
      return;
    }
    setReversalModal({ open: true, statement, reason: statement?.reversalReason || "Processed statement reversed", loading: false });
  };

  const handleReversalConfirm = async () => {
    const { statement, reason } = reversalModal;
    const finalReason = reason.trim() || "Processed statement reversed";
    const reopenDraftContext = {
      propertyId: statement?.property?._id || statement?.property || "",
      landlordId: statement?.landlord?._id || statement?.landlord || "",
      statementType: statement?.statementType || "provisional",
      periodStart: statement?.periodStart || "",
      periodEnd: statement?.periodEnd || statement?.cutoffAt || statement?.closedAt || "",
      sourceStatementId:
        statement?.sourceStatement?._id ||
        statement?.sourceStatement ||
        statement?.reversedSourceStatement?._id ||
        statement?.reversedSourceStatement ||
        "",
    };
    setReversalModal((prev) => ({ ...prev, loading: true }));
    try {
      await dispatch(reverseStatement({ statementId: statement._id, reason: finalReason })).unwrap();
      toast.success("Processed statement reversed successfully. Reopening the statement workspace with the same period so you can regenerate a fresh draft.");
      setReversalModal({ open: false, statement: null, reason: "", loading: false });
      navigate("/landlord/statements", { state: { reopenDraftContext } });
    } catch (error) {
      toast.error(error || "Failed to reverse statement");
      setReversalModal((prev) => ({ ...prev, loading: false }));
    }
  };

  const handlePrintFeeInvoice = async (statement) => {
    if (!canExportProcessedStatement) {
      toast.warning("You do not have permission to print fee invoices");
      return;
    }
    try {
      const response = await adminRequests.get(`/processed-statements/${statement._id}/management-fee-invoice-pdf`, {
        responseType: "blob",
      });
      const blob = new Blob([response.data], { type: "application/pdf" });
      const blobUrl = window.URL.createObjectURL(blob);
      const win = window.open(blobUrl, "_blank");
      if (!win) {
        window.URL.revokeObjectURL(blobUrl);
        toast.error("Unable to open print window");
        return;
      }
      const tryPrint = () => { try { win.focus(); win.print(); } catch (_) {} };
      win.onload = tryPrint;
      setTimeout(tryPrint, 1200);
      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 15000);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to generate fee invoice PDF");
    }
  };

  const handlePrintStatement = async (statement) => {
    if (!canExportProcessedStatement) {
      toast.warning("You do not have permission to print processed statements");
      return;
    }
    const sourceStatementId =
      statement?.sourceStatement?._id || (typeof statement?.sourceStatement === "string" ? statement.sourceStatement : "") || "";

    if (sourceStatementId) {
      try {
        const response = await adminRequests.get(`/statements/${sourceStatementId}/pdf`, {
          responseType: "blob",
        });
        const blob = new Blob([response.data], { type: "application/pdf" });
        const blobUrl = window.URL.createObjectURL(blob);
        const printWindow = window.open(blobUrl, "_blank");

        if (!printWindow) {
          window.URL.revokeObjectURL(blobUrl);
          toast.error("Unable to open print window");
          return;
        }

        const tryPrint = () => {
          try {
            printWindow.focus();
            printWindow.print();
          } catch {
            // ignore window timing issues
          }
        };

        printWindow.onload = tryPrint;
        setTimeout(tryPrint, 1200);
        setTimeout(() => window.URL.revokeObjectURL(blobUrl), 15000);
        return;
      } catch (error) {
        toast.error(error?.response?.data?.message || "Failed to print statement PDF");
        return;
      }
    }

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast.error("Unable to open print window");
      return;
    }

    const printContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Processed Statement</title>
  <style>
    @page { margin: 0.5cm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 10pt; line-height: 1.3; padding: 10px; }
    .header { text-align: center; margin-bottom: 15px; }
    .header h1 { font-size: 14pt; font-weight: bold; margin-bottom: 3px; }
    .header p { font-size: 9pt; margin: 1px 0; }
    .title { text-align: center; font-size: 11pt; font-weight: bold; margin: 10px 0; border-top: 2px solid black; border-bottom: 2px solid black; padding: 5px 0; }
    .info-section { display: flex; justify-content: space-between; margin: 10px 0; font-size: 9pt; }
    .statement-table { width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 9pt; }
    .statement-table th { background: #0B3B2E; color: white; padding: 5px; text-align: left; border: 1px solid #999; font-weight: bold; }
    .statement-table td { padding: 5px; border: 1px solid #ccc; text-align: left; }
    .statement-table .number { text-align: right; }
    .statement-table .total-row { font-weight: bold; background: #f5f5f5; }
    .summary { width: 50%; margin-left: auto; margin-top: 20px; font-size: 9pt; }
    .summary table { width: 100%; border-collapse: collapse; }
    .summary th { text-align: left; padding: 5px; background: #0B3B2E; color: white; border: 1px solid #999; font-weight: bold; }
    .summary td { padding: 5px; border: 1px solid #ccc; text-align: right; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${statement.business?.companyName || "PROPERTY MANAGEMENT SYSTEM"}</h1>
    <p>${statement.business?.address || ""}</p>
    <p>TEL: ${statement.business?.phone || ""} | EMAIL: ${statement.business?.email || ""}</p>
  </div>
  <div class="title">PROCESSED LANDLORD STATEMENT</div>
  <div class="info-section">
    <div>
      <p><strong>LANDLORD:</strong> ${statement.landlord?.landlordName || "N/A"}</p>
      <p><strong>PROPERTY:</strong> [${statement.property?.propertyCode || "N/A"}] ${statement.property?.propertyName || "N/A"}</p>
      <p><strong>PERIOD:</strong> ${formatPeriodRange(statement)}</p>
    </div>
    <div style="text-align: right;">
      <p><strong>STATUS:</strong> ${String(statement.status || "processed").toUpperCase()}</p>
      <p><strong>PROCESSED:</strong> ${formatDate(statement.closedAt)}</p>
      ${statement.reversedAt ? `<p><strong>REVERSED:</strong> ${formatDate(statement.reversedAt)}</p>` : ""}
      ${statement.paidDate ? `<p><strong>PAID DATE:</strong> ${formatDate(statement.paidDate)}</p>` : ""}
      ${statement.recoveryDate ? `<p><strong>RECOVERY DATE:</strong> ${formatDate(statement.recoveryDate)}</p>` : ""}
    </div>
  </div>
  <table class="statement-table">
    <thead>
      <tr>
        <th>UNIT</th>
        <th>TENANT</th>
        <th class="number">PER MONTH</th>
        <th class="number">BALANCE B/F</th>
        <th class="number">RENT EXPECTED</th>
        <th class="number">RENT COLLECTED</th>
        <th class="number">BALANCE C/F</th>
      </tr>
    </thead>
    <tbody>
      ${(statement.tenantRows || [])
        .map(
          (row) => `
        <tr>
          <td>${row.unit || ""}</td>
          <td>${row.tenantName || ""}</td>
          <td class="number">${money(row.rentPerMonth)}</td>
          <td class="number">${money(row.openingBalance)}</td>
          <td class="number">${money(row.totalInvoiced)}</td>
          <td class="number">${money(row.totalReceived)}</td>
          <td class="number">${money(row.closingBalance)}</td>
        </tr>`
        )
        .join("")}
    </tbody>
  </table>
  <div class="summary">
    <h3 style="margin-bottom: 10px;">FINANCIAL SUMMARY</h3>
    <table>
      <tr><th>RENT EXPECTED</th><td>${money(statement.totalRentInvoiced)}</td></tr>
      <tr><th>RENT COLLECTED</th><td>${money(statement.totalRentReceived)}</td></tr>
      <tr><th>ARREARS</th><td>${money((statement.totalRentInvoiced || 0) - (statement.totalRentReceived || 0))}</td></tr>
      <tr><th>COMMISSION BASIS</th><td>${getCommissionBasisLabel(statement.commissionBasis)}</td></tr>
      <tr><th>COMMISSION</th><td>(${money(statement.commissionAmount)})</td></tr>
      ${isNegativeProcessedStatement(statement) ? `<tr><th>AMOUNT RECOVERED</th><td>${money(statement.amountRecovered || 0)}</td></tr>` : ""}
      <tr style="background: #0B3B2E; color: white; font-weight: bold;"><th>${isNegativeProcessedStatement(statement) ? "OUTSTANDING RECOVERY" : "NET AMOUNT DUE"}</th><td>${money(getStatementDisplayAmount(statement))}</td></tr>
    </table>
  </div>
</body>
</html>`;

    printWindow.document.write(printContent);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 250);
  };

  const getStatusBadge = (statement) => {
    if (statement?.status === "reversed") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-gray-200 px-3 py-1 text-sm font-semibold text-gray-700">
          <FaUndo /> Reversed
        </span>
      );
    }

    if (isNegativeProcessedStatement(statement)) {
      const outstandingRecovery = getOutstandingRecoveryBalance(statement);
      if (outstandingRecovery <= 0 && Number(statement?.amountRecovered || 0) > 0) {
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-3 py-1 text-sm font-semibold text-green-700">
            <FaCheckCircle /> Recovered
          </span>
        );
      }
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-red-700">
          <FaHourglass /> Landlord Owes Manager
        </span>
      );
    }

    if (statement?.status === "paid") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-3 py-1 text-sm font-semibold text-green-700">
          <FaCheckCircle /> Paid
        </span>
      );
    }

    if (statement?.status === "part_paid") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-sm font-semibold text-blue-700">
          <FaHourglass /> Part Paid
        </span>
      );
    }

    if (statement?.status === "processed") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
          <FaHourglass /> Processed
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-3 py-1 text-sm font-semibold text-yellow-700">
        <FaHourglass /> Unpaid
      </span>
    );
  };

  return (
    <>
      <DashboardLayout lockContentScroll>
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 p-2">
          <div className="mx-auto flex h-full w-full max-w-full min-h-0 flex-1 flex-col overflow-hidden gap-2">
            <div className="flex-none sticky top-0 z-30 border-b border-slate-200 bg-white shadow-sm">
              <div className="filter-bar flex items-center gap-1.5 overflow-x-auto px-2 py-1.5">
                {fromLedger && (
                  <button onClick={() => navigate(`/properties/${location.state.propertyId}/ledger`)} className="h-7 shrink-0 flex items-center gap-1 rounded px-2 text-xs font-semibold text-[#0B3B2E] hover:bg-[#EDF5F1]">
                    <FaArrowLeft size={11} /> {location.state.propertyName} Ledger
                  </button>
                )}
                <button onClick={() => handleTabChange("outstanding")} className={`h-7 shrink-0 inline-flex items-center gap-1 rounded px-2.5 text-xs font-bold ${activeTab === "outstanding" ? "bg-[#0B3B2E] text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}><FaHourglass /> Outstanding {activeTab === "outstanding" ? `(${pagination.total})` : ""}</button>
                <button onClick={() => handleTabChange("recoveries")} className={`h-7 shrink-0 inline-flex items-center gap-1 rounded px-2.5 text-xs font-bold ${activeTab === "recoveries" ? "bg-[#0B3B2E] text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}><FaHourglass /> Recoveries {activeTab === "recoveries" ? `(${pagination.total})` : ""}</button>
                <button onClick={() => handleTabChange("paid")} className={`h-7 shrink-0 inline-flex items-center gap-1 rounded px-2.5 text-xs font-bold ${activeTab === "paid" ? "bg-[#0B3B2E] text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}><FaCheckCircle /> Paid {activeTab === "paid" ? `(${pagination.total})` : ""}</button>
                <button onClick={() => handleTabChange("management_fees")} className={`h-7 shrink-0 inline-flex items-center gap-1 rounded px-2.5 text-xs font-bold ${activeTab === "management_fees" ? "bg-[#FF8C00] text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}><FaDownload /> Mgmt Fees {activeTab === "management_fees" ? `(${pagination.total})` : ""}</button>
                <input type="text" placeholder="Search landlord, property…" value={searchText} onChange={(e) => handleSearchChange(e.target.value)} onBlur={applySearch} onKeyDown={(e) => e.key === "Enter" && applySearch()} className="h-7 w-44 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs outline-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
                <select value={sortBy} onChange={(e) => handleSortChange(e.target.value)} className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs appearance-none focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]">
                  <option value="date-desc">Newest First</option>
                  <option value="date-asc">Oldest First</option>
                </select>
                <div className="mx-1 h-4 w-px shrink-0 bg-slate-200" />
                <span className="shrink-0 rounded border border-yellow-200 bg-yellow-50 px-2 py-0.5 text-[10px] font-bold text-yellow-700">Outstanding: {activeTab === "outstanding" ? pagination.total : "—"} • {activeTab === "outstanding" ? money(stats.totalAmountUnpaid) : "—"}</span>
                <span className="shrink-0 rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">Recoveries: {activeTab === "recoveries" ? pagination.total : "—"} • {activeTab === "recoveries" ? money(stats.totalRecoveryAmount) : "—"}</span>
                <span className="shrink-0 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Paid: {activeTab === "paid" ? pagination.total : "—"} • {activeTab === "paid" ? money(stats.totalAmountPaid) : "—"}</span>
                <div className="mx-1 h-4 w-px shrink-0 bg-slate-200" />
                <button onClick={() => navigate(-1)} className="h-7 shrink-0 flex items-center gap-1 rounded px-2.5 text-xs font-semibold text-white bg-slate-600 hover:bg-slate-700"><FaArrowLeft /> Back</button>

              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              {loading ? (
                <div className="flex flex-1 items-center justify-center p-12 text-center"><p className="text-gray-500">Loading statements...</p></div>
              ) : filteredStatements.length === 0 ? (
                <div className="flex flex-1 items-center justify-center p-12 text-center"><p className="text-lg text-gray-500">No {activeTab} statements found</p></div>
              ) : (
                <div className="flex-1 min-h-0 overflow-auto">
                  <table className="w-full min-w-[1160px] text-[11px] border-collapse">
                    <thead className="sticky top-0 z-10 shadow-sm">
                      <tr className="bg-[#0B3B2E] text-white">
                        <th className="px-3 py-2 text-left font-bold border-r border-white/10">STMT #</th>
                        <th className="px-3 py-2 text-left font-bold border-r border-white/10">LANDLORD</th>
                        <th className="px-3 py-2 text-left font-bold border-r border-white/10">PROPERTY</th>
                        <th className="px-3 py-2 text-left font-bold border-r border-white/10">PERIOD</th>
                        <th className="px-3 py-2 text-right font-bold border-r border-white/10">NET POSITION</th>
                        <th className="px-3 py-2 text-right font-bold border-r border-white/10">SETTLED</th>
                        <th className="px-3 py-2 text-center font-bold border-r border-white/10">STATUS</th>
                        <th className="px-3 py-2 text-center font-bold">ACTIONS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedStatements.map((statement, stmtIdx) => {
                        const isNegative = isNegativeProcessedStatement(statement);
                        const outstandingRecovery = getOutstandingRecoveryBalance(statement);
                        return (
                          <React.Fragment key={statement._id}>
                            <tr className={`border-b border-gray-100 transition-colors ${stmtIdx % 2 === 0 ? "bg-white hover:bg-blue-50/40" : "bg-slate-50/60 hover:bg-blue-50/40"}`}>
                              <td className="px-3 py-1 border-r border-gray-100">
                                <div className="font-mono text-slate-500">{statement.sourceStatementNumber || '—'}</div>
                                {statement.managementFeeInvoiceNumber && (
                                  <div className="font-mono text-[10px] text-orange-600 font-semibold">{statement.managementFeeInvoiceNumber}</div>
                                )}
                              </td>
                              <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900">{statement.landlord?.landlordName || "N/A"}</td>
                              <td className="px-3 py-1 border-r border-gray-100">
                                <div>
                                  <p className="font-semibold text-slate-900">{statement.property?.propertyCode}</p>
                                  <p className="text-[10px] text-gray-500">{statement.property?.propertyName || statement.property?.name}</p>
                                </div>
                              </td>
                              <td className="px-3 py-1 border-r border-gray-100 text-slate-700">{formatPeriodRange(statement)}</td>
                              <td className="px-3 py-1 border-r border-gray-100 text-right font-bold text-slate-900">{displayMoney(getStatementDisplayAmount(statement))}</td>
                              <td className="px-3 py-1 border-r border-gray-100 text-right text-slate-700">
                                {displayMoney(isNegative ? statement.amountRecovered || 0 : statement.amountPaid || 0)}
                              </td>
                              <td className="px-3 py-1 border-r border-gray-100 text-center">{getStatusBadge(statement)}</td>
                              <td className="px-3 py-1 text-center">
                                <button
                                  onClick={() => setExpandedRow(expandedRow === statement._id ? null : statement._id)}
                                  className="text-gray-600 transition hover:text-gray-900"
                                >
                                  {expandedRow === statement._id ? <FaChevronUp /> : <FaChevronDown />}
                                </button>
                              </td>
                            </tr>

                            {expandedRow === statement._id && (
                              <tr className="border-b bg-gray-50">
                                <td colSpan="8" className="px-4 py-4">
                                  <div className="space-y-4">
                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                                      <div>
                                        <p className="text-sm text-gray-600">Occupied Units</p>
                                        <p className="font-semibold">{statement.occupiedUnits}</p>
                                      </div>
                                      <div>
                                        <p className="text-sm text-gray-600">Vacant Units</p>
                                        <p className="font-semibold">{statement.vacantUnits}</p>
                                      </div>
                                      <div>
                                        <p className="text-sm text-gray-600">Processed Date</p>
                                        <p className="font-semibold">{formatDate(statement.closedAt)}</p>
                                      </div>
                                      <div>
                                        <p className="text-sm text-gray-600">Statement Period</p>
                                        <p className="font-semibold">{formatPeriodRange(statement)}</p>
                                      </div>
                                      {statement.managementFeeInvoiceNumber && (
                                        <div>
                                          <p className="text-sm text-gray-600">Fee Invoice #</p>
                                          <p className="font-semibold font-mono text-[#FF8C00]">{statement.managementFeeInvoiceNumber}</p>
                                        </div>
                                      )}
                                    </div>

                                    <div className="rounded border bg-white p-3">
                                      <p className="mb-2 text-sm font-semibold">Financial Summary</p>
                                      <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                                        <div>
                                          <p className="text-gray-600">Rent Expected</p>
                                          <p className="font-semibold">{money(statement.totalRentInvoiced)}</p>
                                        </div>
                                        <div>
                                          <p className="text-gray-600">Rent Collected</p>
                                          <p className="font-semibold">{money(statement.totalRentReceived)}</p>
                                        </div>
                                        <div>
                                          <p className="text-gray-600">Arrears</p>
                                          <p className="font-semibold">
                                            {money((statement.totalRentInvoiced || 0) - (statement.totalRentReceived || 0))}
                                          </p>
                                        </div>
                                        <div>
                                          <p className="text-gray-600">Commission</p>
                                          <p className="font-semibold">({money(statement.commissionAmount)})</p>
                                        </div>
                                        <div>
                                          <p className="text-gray-600">VAT on Commission</p>
                                          <p className="font-semibold">({money(statement.commissionTaxAmount || 0)})</p>
                                        </div>
                                        <div>
                                          <p className="text-gray-600">Commission %</p>
                                          <p className="font-semibold">{statement.commissionPercentage}%</p>
                                        </div>
                                        <div>
                                          <p className="text-gray-600">Basis</p>
                                          <p className="font-semibold">{getCommissionBasisLabel(statement.commissionBasis)}</p>
                                        </div>
                                        {isNegative && (
                                          <>
                                            <div>
                                              <p className="text-gray-600">Total Recovery</p>
                                              <p className="font-semibold">{money(statement.amountPayableByLandlordToManager || 0)}</p>
                                            </div>
                                            <div>
                                              <p className="text-gray-600">Recovered So Far</p>
                                              <p className="font-semibold">{money(statement.amountRecovered || 0)}</p>
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    </div>

                                    {Array.isArray(statement.paymentHistory) && statement.paymentHistory.length > 0 && (
                                      <div>
                                        <p className="mb-2 text-sm font-semibold text-slate-700">Payment History</p>
                                        <div className="overflow-hidden rounded border border-slate-200">
                                          <table className="w-full text-[11px] border-collapse">
                                            <thead className="bg-[#0B3B2E] text-white">
                                              <tr>
                                                <th className="px-3 py-1 text-left font-bold border-r border-white/10">Date</th>
                                                <th className="px-3 py-1 text-left font-bold border-r border-white/10">Method</th>
                                                <th className="px-3 py-1 text-left font-bold border-r border-white/10">Reference</th>
                                                <th className="px-3 py-1 text-right font-bold border-r border-white/10">Amount</th>
                                                <th className="px-3 py-1 text-left font-bold">Notes</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {statement.paymentHistory.map((ph, i) => (
                                                <tr key={ph._id || ph.entryId || i} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                                                  <td className="px-3 py-1 border-r border-gray-100">{formatDate(ph.paymentDate)}</td>
                                                  <td className="px-3 py-1 border-r border-gray-100">{formatPaymentMethod(ph.paymentMethod)}</td>
                                                  <td className="px-3 py-1 border-r border-gray-100 font-mono text-slate-500">{ph.paymentReference || '—'}</td>
                                                  <td className="px-3 py-1 border-r border-gray-100 text-right font-semibold text-emerald-700">{displayMoney(ph.amount)}</td>
                                                  <td className="px-3 py-1 text-slate-500">{ph.notes || '—'}</td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      </div>
                                    )}

                                    {Array.isArray(statement.recoveryHistory) && statement.recoveryHistory.length > 0 && (
                                      <div>
                                        <p className="mb-2 text-sm font-semibold text-slate-700">Recovery History</p>
                                        <div className="overflow-hidden rounded border border-red-200">
                                          <table className="w-full text-[11px] border-collapse">
                                            <thead className="bg-red-700 text-white">
                                              <tr>
                                                <th className="px-3 py-1 text-left font-bold border-r border-white/10">Date</th>
                                                <th className="px-3 py-1 text-left font-bold border-r border-white/10">Method</th>
                                                <th className="px-3 py-1 text-left font-bold border-r border-white/10">Reference</th>
                                                <th className="px-3 py-1 text-right font-bold border-r border-white/10">Amount Recovered</th>
                                                <th className="px-3 py-1 text-left font-bold">Notes</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {statement.recoveryHistory.map((rh, i) => (
                                                <tr key={rh._id || rh.entryId || i} className={`border-b border-red-100 ${i % 2 === 0 ? 'bg-white' : 'bg-red-50/40'}`}>
                                                  <td className="px-3 py-1 border-r border-red-100">{formatDate(rh.paymentDate)}</td>
                                                  <td className="px-3 py-1 border-r border-red-100">{formatPaymentMethod(rh.paymentMethod)}</td>
                                                  <td className="px-3 py-1 border-r border-red-100 font-mono text-slate-500">{rh.paymentReference || '—'}</td>
                                                  <td className="px-3 py-1 border-r border-red-100 text-right font-semibold text-red-700">{displayMoney(rh.amount)}</td>
                                                  <td className="px-3 py-1 text-slate-500">{rh.notes || '—'}</td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      </div>
                                    )}

                                    {statement.status === "reversed" && (
                                      <div className="rounded-lg border border-gray-300 bg-gray-100 p-3 text-sm text-gray-700">
                                        <p className="font-semibold">Reversed Processed Statement</p>
                                        <p>Reversed on {formatDate(statement.reversedAt)}.</p>
                                        {statement.reversalReason ? <p>Reason: {statement.reversalReason}</p> : null}
                                        <p>Any ledger entries linked directly to this processed statement were reversed by the backend reversal flow.</p>
                                      </div>
                                    )}

                                    {isNegative && statement.status !== "reversed" && (
                                      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                                        <p className="font-semibold">{getStatementAmountHeading(statement)}</p>
                                        <p>
                                          The landlord owes the manager {money(statement.amountPayableByLandlordToManager || 0)} for this processed statement.
                                          Recovered so far: {money(statement.amountRecovered || 0)}. Outstanding recovery: {money(outstandingRecovery)}.
                                        </p>
                                      </div>
                                    )}

                                    <div className="flex flex-wrap gap-2">
                                      <button
                                        onClick={() => setGlStatement(statement)}
                                        className="flex items-center gap-2 rounded border border-teal-300 bg-teal-50 px-3 py-2 text-sm font-semibold text-teal-700 transition hover:bg-teal-100"
                                        title="View GL Journal Entries"
                                      >
                                        <FaBook /> GL Entries
                                      </button>

                                      <button
                                        onClick={() => handlePrintStatement(statement)}
                                        disabled={!canExportProcessedStatement}
                                        title={canExportProcessedStatement ? "Print" : "You do not have permission to print processed statements"}
                                        className="flex items-center gap-2 rounded bg-gray-700 px-3 py-2 text-sm text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        <FaPrint /> Print
                                      </button>

                                      {Number(statement.commissionAmount || 0) > 0 && (
                                        <button
                                          onClick={() => handlePrintFeeInvoice(statement)}
                                          disabled={!canExportProcessedStatement}
                                          title={statement.managementFeeInvoiceNumber ? `Print Fee Invoice ${statement.managementFeeInvoiceNumber}` : "Print Management Fee Invoice"}
                                          className="flex items-center gap-2 rounded border border-orange-300 bg-orange-50 px-3 py-2 text-sm font-semibold text-orange-700 transition hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          <FaDownload /> Fee Invoice
                                        </button>
                                      )}

                                      <button
                                        onClick={() => setCommModalStatement(statement)}
                                        disabled={!canSendCommunications}
                                        title={canSendCommunications ? "Email statement to landlord" : "You do not have permission to send communications"}
                                        className="flex items-center gap-2 rounded bg-blue-600 px-3 py-2 text-sm text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        <FaEnvelope /> Email Statement
                                      </button>

                                      {!isNegative && statement.status !== "reversed" && ["unpaid", "part_paid"].includes(statement.status) && canProcessLandlordPayments && (
                                        <button
                                          onClick={() => setShowPayModal(statement._id)}
                                          className={`flex items-center gap-2 rounded px-3 py-2 text-sm text-white transition ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
                                        >
                                          <FaCheckCircle /> Pay Landlord
                                        </button>
                                      )}

                                      {isNegative && statement.status !== "reversed" && outstandingRecovery > 0 && canProcessLandlordPayments && (
                                        <button
                                          onClick={() => setShowRecoveryModal(statement._id)}
                                          className="flex items-center gap-2 rounded bg-red-600 px-3 py-2 text-sm text-white transition hover:bg-red-700"
                                        >
                                          <FaMoneyBillWave /> Record Recovery
                                        </button>
                                      )}

                                      {!isNegative && statement.status !== "reversed" && ["unpaid", "part_paid"].includes(statement.status) && statement.commissionAmount > 0 && canProcessLandlordPayments && (
                                        <button
                                          onClick={() => setShowCommissionModal(statement._id)}
                                          className={`flex items-center gap-2 rounded px-3 py-2 text-sm text-white transition ${MILIK_ORANGE} ${MILIK_ORANGE_HOVER}`}
                                        >
                                          <FaDownload /> Post Commission
                                        </button>
                                      )}

                                      {!isNegative && statement.status !== "reversed" && ["unpaid", "part_paid"].includes(statement.status) && canProcessLandlordPayments && (
                                        <button
                                          onClick={() => handleMarkAsPaid(statement._id)}
                                          className={`flex items-center gap-2 rounded px-3 py-2 text-sm text-white transition ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
                                        >
                                          <FaCheckCircle /> Mark as Paid
                                        </button>
                                      )}

                                      {!isNegative && statement.status === "paid" && canProcessLandlordPayments && (
                                        <button
                                          onClick={() => handleMarkAsUnpaid(statement._id)}
                                          className="flex items-center gap-2 rounded bg-yellow-500 px-3 py-2 text-sm text-white transition hover:bg-yellow-600"
                                        >
                                          <FaHourglass /> Mark as Unpaid
                                        </button>
                                      )}

                                      {statement.status !== "reversed" && canReverseProcessedStatement && (
                                        <button
                                          onClick={() => handleReverseStatement(statement)}
                                          className="ml-auto flex items-center gap-2 rounded bg-slate-700 px-3 py-2 text-sm text-white transition hover:bg-slate-800"
                                        >
                                          <FaUndo /> Reverse
                                        </button>
                                      )}

                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex-shrink-0 border-t border-slate-200 bg-white px-3 py-2">
                <div className="flex items-center justify-between gap-3 text-xs text-slate-600">
                  <div className="font-semibold">Showing <span className="font-bold text-slate-900">{pagination.total === 0 ? 0 : startIndex + 1}</span> to <span className="font-bold text-slate-900">{Math.min(endIndex, pagination.total)}</span> of <span className="font-bold text-slate-900">{pagination.total}</span> processed statements</div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">Per page: {ITEMS_PER_PAGE}</span>
                    <button onClick={() => handlePageChange(safeCurrentPage - 1)} disabled={safeCurrentPage === 1} className="rounded-lg border border-slate-300 px-3 py-1 font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Previous</button>
                    <span className="font-semibold text-slate-700">Page {safeCurrentPage} of {totalPages}</span>
                    <button onClick={() => handlePageChange(safeCurrentPage + 1)} disabled={safeCurrentPage === totalPages} className="rounded-lg border border-slate-300 px-3 py-1 font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Next</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </DashboardLayout>

      <JournalEntriesDrawer
        open={!!glStatement}
        onClose={() => setGlStatement(null)}
        title="Processed Statement"
        transactionRef={glStatement?.sourceStatementNumber}
        date={glStatement ? new Date(glStatement.closedAt || glStatement.createdAt).toLocaleDateString("en-GB") : ""}
        amount={glStatement ? Math.abs(getStatementDisplayAmount(glStatement)) : undefined}
        status={glStatement?.status}
        statusColors={
          glStatement?.status === "paid" ? "bg-emerald-100 text-emerald-700 border-emerald-200"
          : glStatement?.status === "reversed" ? "bg-amber-100 text-amber-700 border-amber-200"
          : "bg-slate-100 text-slate-700 border-slate-200"
        }
        contextFields={glStatement ? [
          { label: "Landlord", value: glStatement.landlord?.landlordName },
          { label: "Property", value: glStatement.property?.propertyCode ? `${glStatement.property.propertyCode} — ${glStatement.property.propertyName || ""}` : glStatement.property?.propertyName },
          { label: "Period",   value: formatPeriodRange(glStatement) },
          { label: "Commission", value: glStatement.commissionAmount ? `KES ${Number(glStatement.commissionAmount).toLocaleString()}` : undefined },
        ].filter((f) => f.value) : []}
        businessId={businessId}
        sourceType="processed_statement"
        sourceId={glStatement?._id}
      />

      {showPayModal && (
        <PayLandlordModal
          statement={statements.find((s) => s._id === showPayModal)}
          cashbookOptions={cashbookOptions}
          onClose={() => setShowPayModal(null)}
          onSubmit={(paymentData) => handlePayLandlord(showPayModal, paymentData)}
        />
      )}

      {showRecoveryModal && (
        <RecordLandlordRecoveryModal
          statement={statements.find((s) => s._id === showRecoveryModal)}
          cashbookOptions={cashbookOptions}
          onClose={() => setShowRecoveryModal(null)}
          onSubmit={(recoveryData) => handleRecordRecovery(showRecoveryModal, recoveryData)}
        />
      )}

      {showCommissionModal && (
        <PostCommissionModal
          statement={statements.find((s) => s._id === showCommissionModal)}
          onClose={() => setShowCommissionModal(null)}
          onSubmit={(commissionData) => handlePostCommission(showCommissionModal, commissionData)}
        />
      )}

      {commModalStatement && (
        <CommunicationComposerModal
          open={Boolean(commModalStatement)}
          onClose={() => setCommModalStatement(null)}
          businessId={businessId}
          contextType="processed_statement"
          recordIds={[commModalStatement._id]}
          defaultChannel="email"
          allowedChannels={["sms", "email"]}
          title={`Email Statement — ${commModalStatement.landlord?.landlordName || "Landlord"}`}
          subtitle={`${commModalStatement.property?.propertyCode || ""} · ${formatPeriodRange(commModalStatement)}`}
          onSent={() => setCommModalStatement(null)}
        />
      )}

      {reversalModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="bg-[#0B3B2E] px-6 py-4 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
                <FaUndo className="text-white text-sm" />
              </div>
              <div>
                <h2 className="text-white font-semibold text-base leading-tight">Reverse Processed Statement</h2>
                <p className="text-white/60 text-xs mt-0.5">{reversalModal.statement?.property?.propertyCode || ""} {reversalModal.statement ? `· ${formatPeriodRange(reversalModal.statement)}` : ""}</p>
              </div>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="flex items-start gap-3 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
                <FaUndo className="text-amber-500 mt-0.5 shrink-0" />
                <p className="text-sm text-amber-800">This will reverse the processed statement and reopen the draft workspace for the same period. This action cannot be undone.</p>
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide">Reversal Reason</label>
                <textarea
                  rows={3}
                  autoFocus
                  className="w-full resize-none rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                  value={reversalModal.reason}
                  onChange={(e) => setReversalModal((prev) => ({ ...prev, reason: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleReversalConfirm(); } }}
                  disabled={reversalModal.loading}
                />
              </div>
            </div>
            <div className="px-6 pb-5 flex justify-end gap-3">
              <button onClick={() => setReversalModal({ open: false, statement: null, reason: "", loading: false })} disabled={reversalModal.loading} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50">Cancel</button>
              <button onClick={handleReversalConfirm} disabled={reversalModal.loading} className="rounded-lg bg-red-600 hover:bg-red-700 px-5 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-60 flex items-center gap-2">
                {reversalModal.loading ? <><svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>Reversing…</> : <><FaUndo className="text-xs" />Confirm Reversal</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ProcessedStatements;