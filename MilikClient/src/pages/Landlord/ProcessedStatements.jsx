import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import {
  FaArrowLeft,
  FaCheckCircle,
  FaChevronDown,
  FaChevronUp,
  FaDownload,
  FaHourglass,
  FaMoneyBillWave,
  FaPrint,
  FaUndo,
} from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import {
  getProcessedStatements,
  reverseStatement,
  updateStatement,
} from "../../redux/processedStatementsRedux";
import PayLandlordModal from "../../components/Modals/PayLandlordModal";
import RecordLandlordRecoveryModal from "../../components/Modals/RecordLandlordRecoveryModal";
import PostCommissionModal from "../../components/Modals/PostCommissionModal";
import { adminRequests } from "../../utils/requestMethods";
import { getChartOfAccounts } from "../../redux/apiCalls";

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";
const MILIK_ORANGE = "bg-[#FF8C00]";
const MILIK_ORANGE_HOVER = "hover:bg-[#e67e00]";

const money = (value) => Number(value || 0).toFixed(2);
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
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const currentUser = useSelector((state) => state.auth?.currentUser);
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const { statements, loading } = useSelector((state) => state.processedStatements);

  const [activeTab, setActiveTab] = useState("outstanding");
  const [expandedRow, setExpandedRow] = useState(null);
  const [searchText, setSearchText] = useState("");
  const [sortBy, setSortBy] = useState("date-desc");
  const [showPayModal, setShowPayModal] = useState(null);
  const [showRecoveryModal, setShowRecoveryModal] = useState(null);
  const [showCommissionModal, setShowCommissionModal] = useState(null);
  const [cashbookOptions, setCashbookOptions] = useState([]);

  const businessId = useMemo(
    () => currentCompany?._id || currentUser?.company?._id || currentUser?.company || currentUser?.businessId || "",
    [currentCompany?._id, currentUser?.company, currentUser?.businessId]
  );

  useEffect(() => {
    if (!businessId) return;

    const loadStatements = async () => {
      try {
        await dispatch(getProcessedStatements({ businessId, status: null })).unwrap();
        const chartAccounts = await getChartOfAccounts({ business: businessId, type: "asset" });
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
      } catch (error) {
        toast.error("Failed to load processed statements");
      }
    };

    loadStatements();
  }, [businessId, dispatch]);

  const filteredStatements = useMemo(() => {
    let filtered = statements.filter((statement) => {
      const isNegative = isNegativeProcessedStatement(statement);
      const isReversed = statement?.status === "reversed";

      if (activeTab === "outstanding") {
        return !isReversed && !isNegative && ["unpaid", "part_paid"].includes(statement.status);
      }

      if (activeTab === "recoveries") {
        return !isReversed && isNegative;
      }

      if (activeTab === "paid") {
        return !isReversed && !isNegative && statement.status === "paid";
      }

      return isReversed;
    });

    if (searchText) {
      const search = searchText.toLowerCase();
      filtered = filtered.filter((s) => {
        const landlordName = String(s.landlord?.landlordName || "").toLowerCase();
        const propertyCode = String(s.property?.propertyCode || "").toLowerCase();
        const propertyName = String(s.property?.propertyName || s.property?.name || "").toLowerCase();
        return landlordName.includes(search) || propertyCode.includes(search) || propertyName.includes(search);
      });
    }

    filtered.sort((a, b) =>
      sortBy === "date-asc" ? new Date(a.closedAt) - new Date(b.closedAt) : new Date(b.closedAt) - new Date(a.closedAt)
    );

    return filtered;
  }, [statements, activeTab, searchText, sortBy]);

  const stats = useMemo(() => {
    const reversed = statements.filter((statement) => statement?.status === "reversed");
    const active = statements.filter((statement) => statement?.status !== "reversed");
    const recoveries = active.filter((statement) => isNegativeProcessedStatement(statement));
    const paid = active.filter((statement) => !isNegativeProcessedStatement(statement) && statement.status === "paid");
    const unpaid = active.filter(
      (statement) => !isNegativeProcessedStatement(statement) && ["unpaid", "part_paid"].includes(statement.status)
    );

    return {
      totalPaid: paid.length,
      totalUnpaid: unpaid.length,
      totalRecoveries: recoveries.length,
      totalReversed: reversed.length,
      totalAmountPaid: paid.reduce((sum, s) => sum + Number(s.amountPaid || s.netAmountDue || 0), 0),
      totalAmountUnpaid: unpaid.reduce((sum, s) => sum + Number(s.balanceDue ?? s.netAmountDue ?? 0), 0),
      totalRecoveryAmount: recoveries.reduce((sum, s) => sum + getOutstandingRecoveryBalance(s), 0),
    };
  }, [statements]);

  const reloadStatements = () => {
    if (businessId) {
      dispatch(getProcessedStatements({ businessId, status: null }));
    }
  };

  const handleMarkAsPaid = async (statementId) => {
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

  const handleReverseStatement = async (statement) => {
    const defaultReason = statement?.reversalReason || "Processed statement reversed";
    const reasonInput = window.prompt("Enter reversal reason", defaultReason);
    if (reasonInput === null) return;

    const reason = reasonInput.trim() || defaultReason;

    try {
      await dispatch(reverseStatement({ statementId: statement._id, reason })).unwrap();
      toast.success("Processed statement reversed successfully. Linked processed-statement ledger entries were reversed too.");
      if (expandedRow === statement._id) {
        setExpandedRow(statement._id);
      }
    } catch (error) {
      toast.error(error || "Failed to reverse statement");
    }
  };

  const handlePrintStatement = async (statement) => {
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
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 p-4">
          <div className="mx-auto flex w-full max-w-[96%] min-h-0 flex-1 flex-col gap-4">
            <div className="flex flex-shrink-0 items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Processed Statements</h1>
                <p className="mt-2 text-gray-600">View processed statements, payouts, recoveries, and reversals</p>
              </div>
              <button
                onClick={() => navigate(-1)}
                className="flex items-center gap-2 rounded-lg bg-gray-600 px-4 py-2 text-white transition hover:bg-gray-700"
              >
                <FaArrowLeft /> Back
              </button>
            </div>

            <div className="grid flex-shrink-0 grid-cols-1 gap-4 md:grid-cols-4">
              <div className="rounded-lg bg-yellow-500 p-6 text-white shadow-md">
                <p className="text-sm opacity-90">Outstanding to Landlords</p>
                <p className="text-2xl font-bold">{stats.totalUnpaid}</p>
                <p className="text-xs opacity-75">Amount: {money(stats.totalAmountUnpaid)}</p>
              </div>
              <div className="rounded-lg bg-red-600 p-6 text-white shadow-md">
                <p className="text-sm opacity-90">Recoveries from Landlords</p>
                <p className="text-2xl font-bold">{stats.totalRecoveries}</p>
                <p className="text-xs opacity-75">Amount: {money(stats.totalRecoveryAmount)}</p>
              </div>
              <div className={`${MILIK_GREEN} rounded-lg p-6 text-white shadow-md`}>
                <p className="text-sm opacity-90">Total Paid</p>
                <p className="text-2xl font-bold">{stats.totalPaid}</p>
                <p className="text-xs opacity-75">Amount: {money(stats.totalAmountPaid)}</p>
              </div>
              <div className="rounded-lg bg-blue-600 p-6 text-white shadow-md">
                <p className="text-sm opacity-90">Total Statements</p>
                <p className="text-2xl font-bold">{statements.length}</p>
                <p className="text-xs opacity-75">Reversed: {stats.totalReversed}</p>
              </div>
            </div>

            <div className="flex-shrink-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-6 flex flex-wrap gap-4 border-b">
                <button
                  onClick={() => setActiveTab("outstanding")}
                  className={`border-b-2 px-4 py-2 font-semibold transition ${
                    activeTab === "outstanding"
                      ? `${MILIK_GREEN} border-orange-500 text-white`
                      : "border-transparent text-gray-600 hover:text-gray-900"
                  }`}
                >
                  <FaHourglass className="mr-2 inline" /> Outstanding ({stats.totalUnpaid})
                </button>
                <button
                  onClick={() => setActiveTab("recoveries")}
                  className={`border-b-2 px-4 py-2 font-semibold transition ${
                    activeTab === "recoveries"
                      ? `${MILIK_GREEN} border-orange-500 text-white`
                      : "border-transparent text-gray-600 hover:text-gray-900"
                  }`}
                >
                  <FaHourglass className="mr-2 inline" /> Recoveries ({stats.totalRecoveries})
                </button>
                <button
                  onClick={() => setActiveTab("paid")}
                  className={`border-b-2 px-4 py-2 font-semibold transition ${
                    activeTab === "paid"
                      ? `${MILIK_GREEN} border-orange-500 text-white`
                      : "border-transparent text-gray-600 hover:text-gray-900"
                  }`}
                >
                  <FaCheckCircle className="mr-2 inline" /> Paid ({stats.totalPaid})
                </button>
                <button
                  onClick={() => setActiveTab("reversed")}
                  className={`border-b-2 px-4 py-2 font-semibold transition ${
                    activeTab === "reversed"
                      ? `${MILIK_GREEN} border-orange-500 text-white`
                      : "border-transparent text-gray-600 hover:text-gray-900"
                  }`}
                >
                  <FaUndo className="mr-2 inline" /> Reversed ({stats.totalReversed})
                </button>
              </div>

              <div className="flex flex-col gap-4 md:flex-row">
                <input
                  type="text"
                  placeholder="Search by landlord or property..."
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  className="flex-1 rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-orange-500"
                />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-orange-500"
                >
                  <option value="date-desc">Newest First</option>
                  <option value="date-asc">Oldest First</option>
                </select>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              {loading ? (
                <div className="flex flex-1 items-center justify-center p-12 text-center"><p className="text-gray-500">Loading statements...</p></div>
              ) : filteredStatements.length === 0 ? (
                <div className="flex flex-1 items-center justify-center p-12 text-center"><p className="text-lg text-gray-500">No {activeTab} statements found</p></div>
              ) : (
                <div className="flex-1 min-h-0 overflow-auto">
                  <table className="w-full min-w-[1040px] text-sm">
                    <thead>
                      <tr className="sticky top-0 z-10 border-b bg-[#0B3B2E] text-white">
                        <th className="px-4 py-3 text-left text-sm font-semibold text-white">LANDLORD</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-white">PROPERTY</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-white">PERIOD</th>
                        <th className="px-4 py-3 text-right text-sm font-semibold text-white">NET POSITION</th>
                        <th className="px-4 py-3 text-right text-sm font-semibold text-white">SETTLED</th>
                        <th className="px-4 py-3 text-center text-sm font-semibold text-white">STATUS</th>
                        <th className="px-4 py-3 text-center text-sm font-semibold text-white">ACTIONS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredStatements.map((statement) => {
                        const isNegative = isNegativeProcessedStatement(statement);
                        const outstandingRecovery = getOutstandingRecoveryBalance(statement);
                        return (
                          <React.Fragment key={statement._id}>
                            <tr className="border-b transition hover:bg-gray-50">
                              <td className="px-4 py-3">{statement.landlord?.landlordName || "N/A"}</td>
                              <td className="px-4 py-3">
                                <div>
                                  <p className="font-semibold">{statement.property?.propertyCode}</p>
                                  <p className="text-sm text-gray-600">{statement.property?.propertyName || statement.property?.name}</p>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-sm">{formatPeriodRange(statement)}</td>
                              <td className="px-4 py-3 text-right font-semibold">{money(getStatementDisplayAmount(statement))}</td>
                              <td className="px-4 py-3 text-right">
                                {money(isNegative ? statement.amountRecovered || 0 : statement.amountPaid || 0)}
                              </td>
                              <td className="px-4 py-3 text-center">{getStatusBadge(statement)}</td>
                              <td className="px-4 py-3 text-center">
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
                                <td colSpan="7" className="px-4 py-4">
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
                                        onClick={() => handlePrintStatement(statement)}
                                        className="flex items-center gap-2 rounded bg-gray-700 px-3 py-2 text-sm text-white transition hover:bg-gray-800"
                                      >
                                        <FaPrint /> Print
                                      </button>

                                      {!isNegative && statement.status !== "reversed" && ["unpaid", "part_paid"].includes(statement.status) && (
                                        <button
                                          onClick={() => setShowPayModal(statement._id)}
                                          className={`flex items-center gap-2 rounded px-3 py-2 text-sm text-white transition ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
                                        >
                                          <FaCheckCircle /> Pay Landlord
                                        </button>
                                      )}

                                      {isNegative && statement.status !== "reversed" && outstandingRecovery > 0 && (
                                        <button
                                          onClick={() => setShowRecoveryModal(statement._id)}
                                          className="flex items-center gap-2 rounded bg-red-600 px-3 py-2 text-sm text-white transition hover:bg-red-700"
                                        >
                                          <FaMoneyBillWave /> Record Recovery
                                        </button>
                                      )}

                                      {!isNegative && statement.status !== "reversed" && ["unpaid", "part_paid"].includes(statement.status) && statement.commissionAmount > 0 && (
                                        <button
                                          onClick={() => setShowCommissionModal(statement._id)}
                                          className={`flex items-center gap-2 rounded px-3 py-2 text-sm text-white transition ${MILIK_ORANGE} ${MILIK_ORANGE_HOVER}`}
                                        >
                                          <FaDownload /> Post Commission
                                        </button>
                                      )}

                                      {!isNegative && statement.status !== "reversed" && ["unpaid", "part_paid"].includes(statement.status) && (
                                        <button
                                          onClick={() => handleMarkAsPaid(statement._id)}
                                          className={`flex items-center gap-2 rounded px-3 py-2 text-sm text-white transition ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
                                        >
                                          <FaCheckCircle /> Mark as Paid
                                        </button>
                                      )}

                                      {!isNegative && statement.status === "paid" && (
                                        <button
                                          onClick={() => handleMarkAsUnpaid(statement._id)}
                                          className="flex items-center gap-2 rounded bg-yellow-500 px-3 py-2 text-sm text-white transition hover:bg-yellow-600"
                                        >
                                          <FaHourglass /> Mark as Unpaid
                                        </button>
                                      )}

                                      {statement.status !== "reversed" && (
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
            </div>
          </div>
        </div>
      </DashboardLayout>

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
    </>
  );
};

export default ProcessedStatements;
