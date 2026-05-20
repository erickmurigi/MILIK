import { propertyBelongsToLandlord } from "./propertyUtils";
import React, { useState, useEffect, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import {
  FaArrowLeft,
  FaMoneyBillWave,
  FaPlus,
  FaSearch,
  FaRedoAlt,
  FaEye,
  FaFileInvoiceDollar,
  FaPrint,
  FaCheck,
  FaTimes,
  FaChevronLeft,
  FaChevronRight,
  FaEdit,
  FaTrash,
  FaSms,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { getLandlords, getRentPayments, getLandlordPayments, createLandlordPayment, getChartOfAccounts } from "../../redux/apiCalls";
import CommunicationComposerModal from "../../components/Communications/CommunicationComposerModal";
import { getProperties } from "../../redux/propertyRedux";
import { getTenants } from "../../redux/tenantsRedux";
// NOTE: getLandlords is a thunk creator — must be called via dispatch(getLandlords({...}))

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_ORANGE = "bg-[#FF8C00]";
const ITEMS_PER_PAGE = 20;

const formatDate = (date) => {
  if (!date) return "-";
  return new Date(date).toLocaleDateString();
};

const LandlordPayments = ({ mode = "payments" }) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  // Redux state
  const { currentCompany } = useSelector((state) => state.company || {});
  const { landlords = [], isFetching } = useSelector((state) => state.landlord || {});
  const properties = useSelector((state) => state.property?.properties || []);
  const rentPayments = useSelector((state) => state.rentPayment?.rentPayments || []);
  const tenants = useSelector((state) => state.tenant?.tenants || []);

  // Local state
  const [filters, setFilters] = useState({
    search: "",
    status: "all",
    paymentStatus: "all",
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedLandlords, setSelectedLandlords] = useState([]);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showSmsModal, setShowSmsModal] = useState(false);
  const [activeDetail, setActiveDetail] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    landlordId: "",
    amount: "",
    paymentDate: new Date().toISOString().split("T")[0],
    paymentMethod: "bank_transfer",
    referenceNumber: "",
    cashbook: "",
    description: "",
    propertyIds: [],
  });
  // Landlord payment vouchers from backend
  const [landlordPayments, setLandlordPayments] = useState([]);
  const [cashbookAccounts, setCashbookAccounts] = useState([]);

  // Load data
  useEffect(() => {
    const fetchData = async () => {
      if (currentCompany?._id) {
        dispatch(getLandlords({ business: currentCompany._id }));
        dispatch(getProperties({ business: currentCompany._id }));
        dispatch(getTenants({ business: currentCompany._id }));
        getRentPayments(dispatch, currentCompany._id);
        // Fetch landlord payment vouchers
        const payments = await getLandlordPayments(currentCompany._id);
        setLandlordPayments(payments);
      }
    };
    fetchData();
    // eslint-disable-next-line
  }, [dispatch, currentCompany]);

  useEffect(() => {
    const loadCashbooks = async () => {
      if (!currentCompany?._id) return;
      try {
        const rows = await getChartOfAccounts({ business: currentCompany._id });
        const CASHBOOK_PATTERN = /cash|bank|m-?pesa|mobile|wallet|petty|till|collection/i;
        setCashbookAccounts(
          (Array.isArray(rows) ? rows : []).filter(
            (row) =>
              row?.isPosting !== false &&
              String(row?.type || "").toLowerCase() === "asset" &&
              CASHBOOK_PATTERN.test(`${row?.name || ""} ${row?.group || ""} ${row?.subGroup || ""}`)
          )
        );
      } catch {
        // non-critical — cashbook dropdown will be empty, user can still type
      }
    };
    loadCashbooks();
  }, [currentCompany?._id]);

  // Calculate landlord financial data
  const landlordData = useMemo(() => {
    return landlords.map((landlord) => {
      // Get properties owned by this landlord
      const landlordProperties = properties.filter((prop) =>
        propertyBelongsToLandlord(prop, landlord._id, landlord.landlordName)
      );

      // Calculate total rent from all properties
      let totalRentExpected = 0;
      let totalRentCollected = 0;
      const propertyBreakdown = [];

      landlordProperties.forEach((property) => {
        // Get tenants in this property (unit.property is populated by backend)
        const propertyTenants = tenants.filter((tenant) => {
          const tenantPropertyId = String(tenant.unit?.property?._id || tenant.unit?.property || '');
          return tenantPropertyId && tenantPropertyId === String(property._id);
        });

        // Calculate rent expected (rent lives on tenant, not unit)
        const rentExpected = propertyTenants.reduce((sum, tenant) => {
          return sum + (tenant.rent || tenant.unit?.rent || 0);
        }, 0);

        // Calculate rent collected (confirmed, non-cancelled, non-reversed payments)
        const rentCollected = rentPayments
          .filter((payment) => {
            const paymentTenantId = payment.tenant?._id || payment.tenant;
            return (
              propertyTenants.some((t) => String(t._id) === String(paymentTenantId)) &&
              payment.isConfirmed === true &&
              !payment.isCancelled &&
              !payment.isReversed
            );
          })
          .reduce((sum, payment) => sum + (payment.amount || 0), 0);

        totalRentExpected += rentExpected;
        totalRentCollected += rentCollected;

        propertyBreakdown.push({
          propertyId: property._id,
          propertyName: property.name || property.propertyName,
          tenantsCount: propertyTenants.length,
          rentExpected,
          rentCollected,
          outstanding: rentExpected - rentCollected,
        });
      });

      // Real payments to landlord from backend
      const paymentsMade = landlordPayments
        .filter((p) => String(p?.landlord?._id || p?.landlord || p?.landlordId || "") === String(landlord._id) && p.status !== "reversed")
        .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
      const balance = Number(landlord.balance ?? landlord.payableBalance ?? Math.max(totalRentCollected - paymentsMade, 0));

      return {
        ...landlord,
        propertiesCount: landlordProperties.length,
        tenantsCount: landlordProperties.reduce((sum, prop) => {
          return (
            sum +
            tenants.filter((t) => {
              const tPropId = String(t.unit?.property?._id || t.unit?.property || '');
              return tPropId && tPropId === String(prop._id);
            }).length
          );
        }, 0),
        rentExpected: totalRentExpected,
        rentCollected: totalRentCollected,
        paymentsMade,
        balance,
        propertyBreakdown,
      };
    });
  }, [landlords, properties, tenants, rentPayments, landlordPayments]);

  // Filter landlords
  const filteredLandlords = useMemo(() => {
    return landlordData.filter((landlord) => {
      // Search filter
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        const nameMatch = landlord.landlordName?.toLowerCase().includes(searchLower);
        const codeMatch = landlord.landlordCode?.toLowerCase().includes(searchLower);
        const emailMatch = landlord.email?.toLowerCase().includes(searchLower);
        if (!nameMatch && !codeMatch && !emailMatch) return false;
      }

      // Status filter
      if (filters.status !== "all" && landlord.status !== filters.status) {
        return false;
      }

      // Payment status filter
      if (filters.paymentStatus === "owed" && landlord.balance <= 0) return false;
      if (filters.paymentStatus === "clear" && landlord.balance !== 0) return false;

      return true;
    });
  }, [landlordData, filters]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredLandlords.length / ITEMS_PER_PAGE));
  const currentPageData = filteredLandlords.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  // Summary stats
  const activeDetailHistory = useMemo(() => {
    if (!activeDetail?._id) return [];
    return landlordPayments
      .filter((payment) => String(payment?.landlord?._id || payment?.landlord || payment?.landlordId || "") === String(activeDetail._id))
      .sort((a, b) => new Date(b?.paidDate || b?.createdAt || 0) - new Date(a?.paidDate || a?.createdAt || 0));
  }, [activeDetail, landlordPayments]);

  const stats = useMemo(() => {
    const total = filteredLandlords.reduce((sum, ll) => sum + ll.rentCollected, 0);
    const paid = filteredLandlords.reduce((sum, ll) => sum + ll.paymentsMade, 0);
    const owed = filteredLandlords.reduce((sum, ll) => sum + Math.max(0, ll.balance), 0);
    return {
      totalLandlords: filteredLandlords.length,
      totalCollected: total,
      totalPaid: paid,
      totalOwed: owed,
    };
  }, [filteredLandlords]);

  // Handlers
  const handleOpenPayment = (landlord) => {
    setPaymentForm({
      landlordId: landlord._id,
      amount: landlord.balance > 0 ? landlord.balance : "",
      paymentDate: new Date().toISOString().split("T")[0],
      paymentMethod: "bank_transfer",
      referenceNumber: "",
      cashbook: "",
      description: `Payment to ${landlord.landlordName}`,
      propertyIds: landlord.propertyBreakdown.map((p) => p.propertyId),
    });
    setShowPaymentModal(true);
  };

  const handleSavePayment = async () => {
    if (!paymentForm.amount || Number(paymentForm.amount) <= 0) {
      toast.error("Enter a valid payment amount");
      return;
    }

    if (!paymentForm.cashbook) {
      toast.error("Select or enter a cashbook account");
      return;
    }

    try {
      // Save payment to backend
      const payload = {
        landlordId: paymentForm.landlordId,
        amount: Number(paymentForm.amount),
        paymentDate: paymentForm.paymentDate,
        paymentMethod: paymentForm.paymentMethod,
        referenceNumber: paymentForm.referenceNumber,
        cashbook: paymentForm.cashbook,
        description: paymentForm.description,
        propertyIds: paymentForm.propertyIds,
        business: currentCompany?._id,
      };
      await createLandlordPayment(payload);
      toast.success("Payment recorded successfully");
      // Refresh landlord payments
      if (currentCompany?._id) {
        const payments = await getLandlordPayments(currentCompany._id);
        setLandlordPayments(payments);
      }
      setShowPaymentModal(false);
      setPaymentForm({
        landlordId: "",
        amount: "",
        paymentDate: new Date().toISOString().split("T")[0],
        paymentMethod: "bank_transfer",
        referenceNumber: "",
        cashbook: "",
        description: "",
        propertyIds: [],
      });
    } catch (err) {
      toast.error("Failed to record payment: " + (err?.response?.data?.message || err.message));
    }
  };

  const handleViewDetails = (landlord) => {
    setActiveDetail(landlord);
    setShowDetailModal(true);
  };

  const handlePrintLandlordStatement = (landlord) => {
    const printWindow = window.open("", "_blank");
    const currentDate = new Date();
    const periodStart = new Date(currentDate.getFullYear(), currentDate.getMonth() - 2, 1).toLocaleDateString();
    const periodEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).toLocaleDateString();
    
    const statementHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Statement - ${landlord.landlordName}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Segoe UI', Arial, sans-serif;
            padding: 20px;
            background: white;
            color: #333;
          }
          .statement-container {
            max-width: 900px;
            margin: 0 auto;
            border: 3px solid #0B3B2E;
            padding: 40px;
            border-radius: 8px;
            background: white;
          }
          .header {
            text-align: center;
            margin-bottom: 35px;
            border-bottom: 4px solid #0B3B2E;
            padding-bottom: 25px;
          }
          .company-name {
            font-size: 32px;
            font-weight: bold;
            color: #0B3B2E;
            margin-bottom: 5px;
            letter-spacing: 1px;
          }
          .statement-title {
            font-size: 22px;
            font-weight: bold;
            color: #333;
            margin-top: 15px;
            text-transform: uppercase;
            letter-spacing: 2px;
          }
          .period-info {
            font-size: 12px;
            color: #666;
            margin-top: 8px;
            font-style: italic;
          }
          .landlord-info {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            background: #f9fafb;
            padding: 20px;
            border-radius: 6px;
            margin: 25px 0;
            border-left: 4px solid #FF8C00;
          }
          .info-section {
            display: flex;
            flex-direction: column;
            gap: 10px;
          }
          .info-row {
            display: flex;
            justify-content: space-between;
            font-size: 13px;
            padding: 6px 0;
          }
          .info-label {
            font-weight: bold;
            color: #0B3B2E;
            min-width: 120px;
          }
          .info-value {
            color: #555;
            text-align: right;
            flex: 1;
          }
          .summary-section {
            margin: 30px 0;
            padding: 20px;
            background: #f0f7ff;
            border-radius: 6px;
            border: 2px solid #e0e7ff;
            border-left: 5px solid #0B3B2E;
          }
          .summary-title {
            font-size: 14px;
            font-weight: bold;
            color: #0B3B2E;
            text-transform: uppercase;
            margin-bottom: 15px;
            letter-spacing: 1px;
          }
          .summary-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
          }
          .summary-card {
            text-align: center;
            padding: 15px;
            border-radius: 4px;
            border: 1px solid #ddd;
          }
          .summary-card.collected {
            background: #DBEAFE;
            border-color: #0EA5E9;
          }
          .summary-card.paid {
            background: #DCFCE7;
            border-color: #4ADE80;
          }
          .summary-card.outstanding {
            background: #FED7AA;
            border-color: #FB923C;
          }
          .summary-label {
            font-size: 11px;
            font-weight: bold;
            color: #555;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 8px;
          }
          .summary-value {
            font-size: 22px;
            font-weight: bold;
            color: #0B3B2E;
          }
          .table-section {
            margin: 30px 0;
          }
          .section-title {
            font-size: 13px;
            font-weight: bold;
            color: #0B3B2E;
            margin-bottom: 12px;
            text-transform: uppercase;
            letter-spacing: 1px;
            padding-bottom: 8px;
            border-bottom: 2px solid #0B3B2E;
          }
          .properties-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
            margin-bottom: 20px;
          }
          .properties-table th {
            background: #0B3B2E;
            color: white;
            padding: 12px;
            text-align: left;
            font-weight: bold;
            border: none;
          }
          .properties-table th:last-child,
          .properties-table td:last-child {
            text-align: right;
          }
          .properties-table td {
            padding: 12px;
            border-bottom: 1px solid #e5e7eb;
          }
          .properties-table tbody tr:nth-child(even) {
            background: #f9fafb;
          }
          .properties-table tbody tr:hover {
            background: #f3f4f6;
          }
          .properties-table tr:last-child td {
            border-bottom: 2px solid #0B3B2E;
          }
          .amount {
            font-weight: 600;
            color: #0B3B2E;
            font-family: 'Courier New', monospace;
          }
          .positive { color: #059669; }
          .negative { color: #DC2626; }
          .totals-row {
            background: #e8f5e9;
            font-weight: bold;
            color: #0B3B2E;
          }
          .footer {
            margin-top: 35px;
            padding-top: 25px;
            border-top: 2px solid #e5e7eb;
            text-align: center;
            font-size: 11px;
            color: #888;
            line-height: 1.6;
          }
          .timestamp {
            margin-top: 12px;
            font-size: 10px;
            color: #aaa;
          }
          @media print {
            body { background: white; }
            .statement-container { border: 2px solid #0B3B2E; box-shadow: none; }
            page { margin: 0; }
          }
        </style>
      </head>
      <body>
        <div class="statement-container">
          <!-- Header -->
          <div class="header">
            <div class="company-name">${currentCompany?.companyName || "MILIK"}</div>
            <div class="statement-title">Landlord Payment Statement</div>
            <div class="period-info">For Period: ${periodStart} to ${periodEnd}</div>
          </div>

          <!-- Landlord Information -->
          <div class="landlord-info">
            <div class="info-section">
              <div class="info-row">
                <span class="info-label">Landlord Name:</span>
                <span class="info-value"><strong>${landlord.landlordName}</strong></span>
              </div>
              <div class="info-row">
                <span class="info-label">Landlord Code:</span>
                <span class="info-value">${landlord.landlordCode}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Landlord Type:</span>
                <span class="info-value">${landlord.landlordType || "Individual"}</span>
              </div>
            </div>
            <div class="info-section">
              <div class="info-row">
                <span class="info-label">Email:</span>
                <span class="info-value">${landlord.email || "—"}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Phone:</span>
                <span class="info-value">${landlord.phoneNumber || "—"}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Status:</span>
                <span class="info-value"><strong>${landlord.status}</strong></span>
              </div>
            </div>
          </div>

          <!-- Summary Section -->
          <div class="summary-section">
            <div class="summary-title">💰 Payment Summary</div>
            <div class="summary-grid">
              <div class="summary-card collected">
                <div class="summary-label">Total Rent Collected</div>
                <div class="summary-value">Ksh ${landlord.rentCollected.toLocaleString()}</div>
              </div>
              <div class="summary-card paid">
                <div class="summary-label">Paid to Landlord</div>
                <div class="summary-value">Ksh ${landlord.paymentsMade.toLocaleString()}</div>
              </div>
              <div class="summary-card outstanding">
                <div class="summary-label">Balance Owed</div>
                <div class="summary-value">Ksh ${landlord.balance.toLocaleString()}</div>
              </div>
            </div>
          </div>

          <!-- Properties Breakdown -->
          <div class="table-section">
            <div class="section-title">📋 Properties & Collections by Unit</div>
            <table class="properties-table">
              <thead>
                <tr>
                  <th>Property Name</th>
                  <th style="text-align: center;">Units</th>
                  <th>Monthly Rent Expected</th>
                  <th>Total Collected</th>
                  <th>Outstanding</th>
                </tr>
              </thead>
              <tbody>
                ${
                  landlord.propertyBreakdown && landlord.propertyBreakdown.length > 0
                    ? landlord.propertyBreakdown
                        .map(
                          (prop, idx) => `
                  <tr>
                    <td><strong>${prop.propertyName}</strong></td>
                    <td style="text-align: center;">${prop.tenantsCount}</td>
                    <td><span class="amount">Ksh ${prop.rentExpected.toLocaleString()}</span></td>
                    <td><span class="amount positive">Ksh ${prop.rentCollected.toLocaleString()}</span></td>
                    <td><span class="amount ${prop.outstanding > 0 ? "negative" : "positive"}">Ksh ${prop.outstanding.toLocaleString()}</span></td>
                  </tr>
                `
                        )
                        .join("")
                    : `
                  <tr>
                    <td colspan="5" style="text-align: center; padding: 20px; color: #999;">
                      No properties assigned yet for this landlord
                    </td>
                  </tr>
                `
                }
                <tr class="totals-row">
                  <td colspan="1"><strong>TOTAL</strong></td>
                  <td style="text-align: center;"><strong>${landlord.tenantsCount || 0}</strong></td>
                  <td><span class="amount">Ksh ${landlord.rentExpected?.toLocaleString?.() || "0"}</span></td>
                  <td><span class="amount">Ksh ${landlord.rentCollected.toLocaleString()}</span></td>
                  <td><span class="amount">${landlord.balance > 0 ? "Ksh " + Math.max(0, landlord.balance).toLocaleString() : "—"}</span></td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Summary Statement -->
          <div class="table-section">
            <div class="section-title">📊 Account Summary</div>
            <table class="properties-table" style="margin-bottom: 0;">
              <tbody>
                <tr>
                  <td><strong>Properties Managed:</strong></td>
                  <td style="text-align: right;"><strong>${landlord.propertiesCount || 0}</strong></td>
                </tr>
                <tr>
                  <td><strong>Total Units/Tenants:</strong></td>
                  <td style="text-align: right;"><strong>${landlord.tenantsCount || 0}</strong></td>
                </tr>
                <tr>
                  <td><strong>Total Rent Collected (Period):</strong></td>
                  <td style="text-align: right;"><strong>Ksh ${landlord.rentCollected.toLocaleString()}</strong></td>
                </tr>
                <tr>
                  <td><strong>Already Paid to Landlord:</strong></td>
                  <td style="text-align: right;"><strong>Ksh ${landlord.paymentsMade.toLocaleString()}</strong></td>
                </tr>
                <tr class="totals-row">
                  <td><strong>Outstanding Balance:</strong></td>
                  <td style="text-align: right;"><strong>Ksh ${landlord.balance.toLocaleString()}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Footer -->
          <div class="footer">
            <p><strong>Account Status:</strong> This statement reflects all rent collected from properties managed on behalf of ${landlord.landlordName}.</p>
            <p style="margin-top: 10px;">This is an electronically generated statement from ${currentCompany?.companyName || "MILIK"} Property Management System.</p>
            <div class="timestamp">Generated on ${currentDate.toLocaleString()} | Statement Period: ${periodStart} to ${periodEnd}</div>
          </div>
        </div>

        <script>
          window.onload = function() {
            window.print();
          }
        </script>
      </body>
      </html>
    `;
    printWindow.document.write(statementHTML);
    printWindow.document.close();
  };

  const toggleSelection = (id) => {
    setSelectedLandlords((prev) =>
      prev.includes(id) ? prev.filter((lid) => lid !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedLandlords.length === currentPageData.length) {
      setSelectedLandlords([]);
    } else {
      setSelectedLandlords(currentPageData.map((ll) => ll._id));
    }
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 p-2">
        <div className="mx-auto flex h-full w-full max-w-full min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex-none sticky top-0 z-30 border-b border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-1.5 overflow-x-auto px-2 py-1.5">
              <div className="relative shrink-0">
                <FaSearch className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]" />
                <input value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Search name, code, email…" className="h-7 w-44 rounded border border-orange-300 bg-orange-50 pl-6 pr-2 text-xs outline-none focus:border-[#FF8C00] focus:ring-1 focus:ring-[#FF8C00]" />
              </div>
              <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs appearance-none focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]">
                <option value="all">All Status</option><option value="Active">Active</option><option value="Archived">Archived</option>
              </select>
              <select value={filters.paymentStatus} onChange={(e) => setFilters({ ...filters, paymentStatus: e.target.value })} className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs appearance-none focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]">
                <option value="all">All Payment Status</option><option value="owed">Balance Owed</option><option value="clear">Fully Paid</option>
              </select>
              <div className="mx-1 h-4 w-px shrink-0 bg-slate-200" />
              <span className="shrink-0 rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-600">{stats.totalLandlords} landlords</span>
              <span className="shrink-0 rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">Collected: Ksh {stats.totalCollected.toLocaleString()}</span>
              <span className="shrink-0 rounded border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-bold text-green-700">Paid: Ksh {stats.totalPaid.toLocaleString()}</span>
              <span className="shrink-0 rounded border border-orange-200 bg-orange-50 px-2 py-0.5 text-[10px] font-bold text-orange-700">Balance: Ksh {stats.totalOwed.toLocaleString()}</span>
              <div className="mx-1 h-4 w-px shrink-0 bg-slate-200" />
              <button onClick={() => setShowSmsModal(true)} disabled={selectedLandlords.length === 0} title={selectedLandlords.length > 0 ? `SMS ${selectedLandlords.length} landlord${selectedLandlords.length !== 1 ? "s" : ""}` : "Select landlords to SMS"} className="h-7 shrink-0 flex items-center gap-1 rounded bg-teal-600 px-2.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"><FaSms size={10} />{selectedLandlords.length > 0 && <span>{selectedLandlords.length}</span>}</button>
              <button onClick={() => dispatch(getLandlords({ business: currentCompany._id }))} className="h-7 shrink-0 flex items-center gap-1 rounded px-2.5 text-xs font-semibold text-white bg-[#0B3B2E] hover:bg-[#0A3127]"><FaRedoAlt /></button>
            </div>
          </div>

          {/* Table */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[1400px] text-xs">
                <thead className="sticky top-0 z-10 shadow-sm">
                  <tr className={`${MILIK_GREEN} text-white`}>
                    <th className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={
                          currentPageData.length > 0 &&
                          selectedLandlords.length === currentPageData.length
                        }
                        onChange={toggleSelectAll}
                        className="cursor-pointer"
                      />
                    </th>
                    <th className="px-3 py-2 text-left font-bold">Code</th>
                    <th className="px-3 py-2 text-left font-bold">Landlord Name</th>
                    <th className="px-3 py-2 text-center font-bold">Properties</th>
                    <th className="px-3 py-2 text-center font-bold">Tenants</th>
                    <th className="px-3 py-2 text-right font-bold">Rent Collected</th>
                    <th className="px-3 py-2 text-right font-bold">Paid Out</th>
                    <th className="px-3 py-2 text-right font-bold">Balance</th>
                    <th className="px-3 py-2 text-center font-bold">Status</th>
                    <th className="px-3 py-2 text-center font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isFetching ? (
                    <tr>
                      <td colSpan="10" className="px-3 py-8 text-center text-slate-500">
                        Loading...
                      </td>
                    </tr>
                  ) : currentPageData.length === 0 ? (
                    <tr>
                      <td colSpan="10" className="px-3 py-8 text-center text-slate-500">
                        No landlords found
                      </td>
                    </tr>
                  ) : (
                    currentPageData.map((landlord, idx) => (
                      <tr
                        key={landlord._id}
                        className={`${
                          idx % 2 === 0 ? "bg-white" : "bg-slate-50"
                        } border-b border-slate-200 hover:bg-slate-100`}
                      >
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={selectedLandlords.includes(landlord._id)}
                            onChange={() => toggleSelection(landlord._id)}
                            className="cursor-pointer"
                          />
                        </td>
                        <td className="px-3 py-2 font-mono text-slate-700">
                          {landlord.landlordCode}
                        </td>
                        <td className="px-3 py-2 font-semibold text-slate-900">
                          {landlord.landlordName}
                        </td>
                        <td className="px-3 py-2 text-center text-slate-700">
                          {landlord.propertiesCount}
                        </td>
                        <td className="px-3 py-2 text-center text-slate-700">
                          {landlord.tenantsCount}
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-blue-700">
                          Ksh {landlord.rentCollected.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-green-700">
                          Ksh {landlord.paymentsMade.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right font-bold">
                          <span
                            className={
                              landlord.balance > 0 ? "text-orange-700" : "text-green-700"
                            }
                          >
                            Ksh {landlord.balance.toLocaleString()}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span
                            className={`inline-flex px-2 py-1 rounded text-[10px] font-bold ${
                              landlord.status === "Active"
                                ? "bg-green-100 text-green-700"
                                : "bg-gray-100 text-gray-700"
                            }`}
                          >
                            {landlord.status}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => handleViewDetails(landlord)}
                              className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white"
                              title="View Details"
                            >
                              <FaEye size={11} />
                            </button>
                            <button
                              onClick={() => navigate(`/landlord-payment-history?landlordId=${landlord._id}`)}
                              className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-800 text-white"
                              title="View Payments"
                            >
                              <FaFileInvoiceDollar size={11} />
                            </button>
                            <button
                              onClick={() => handleOpenPayment(landlord)}
                              className={`px-2 py-1 rounded ${MILIK_ORANGE} hover:bg-[#e67e00] text-white`}
                              title="Make Payment"
                              disabled={landlord.balance <= 0}
                            >
                              <FaMoneyBillWave size={11} />
                            </button>
                            <button
                              onClick={() => handlePrintLandlordStatement(landlord)}
                              className="px-2 py-1 rounded bg-purple-600 hover:bg-purple-700 text-white"
                              title="Print Statement"
                            >
                              <FaPrint size={11} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex-shrink-0 border-t border-slate-200 bg-white px-3 py-2 flex items-center justify-between text-xs text-slate-600">
              <div className="text-xs text-slate-600">
                Showing {currentPageData.length > 0 ? (currentPage - 1) * ITEMS_PER_PAGE + 1 : 0}{" "}
                to {Math.min(currentPage * ITEMS_PER_PAGE, filteredLandlords.length)} of{" "}
                {filteredLandlords.length} landlords
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1 text-xs border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <FaChevronLeft />
                </button>

                <span className="text-xs text-slate-700 font-semibold">
                  Page {currentPage} of {totalPages}
                </span>

                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1 text-xs border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <FaChevronRight />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Payment Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-2xl">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-slate-900 flex items-center gap-2">
                <FaMoneyBillWave className="text-orange-600" />
                Record Landlord Payment
              </h3>
              <button
                onClick={() => setShowPaymentModal(false)}
                className="text-slate-500 hover:text-slate-700"
              >
                <FaTimes />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700">Amount to Pay *</label>
                  <input
                    type="number"
                    min="0"
                    value={paymentForm.amount}
                    onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                    className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-md text-sm"
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700">Payment Date *</label>
                  <input
                    type="date"
                    value={paymentForm.paymentDate}
                    onChange={(e) =>
                      setPaymentForm({ ...paymentForm, paymentDate: e.target.value })
                    }
                    className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-md text-sm"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700">Payment Method *</label>
                  <select
                    value={paymentForm.paymentMethod}
                    onChange={(e) =>
                      setPaymentForm({ ...paymentForm, paymentMethod: e.target.value })
                    }
                    className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-md text-sm"
                  >
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="check">Check</option>
                    <option value="cash">Cash</option>
                    <option value="mobile_money">Mobile Money</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700">Cashbook Account *</label>
                  <select
                    value={paymentForm.cashbook}
                    onChange={(e) => setPaymentForm({ ...paymentForm, cashbook: e.target.value })}
                    className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-md text-sm"
                  >
                    <option value="">Select cashbook / bank account...</option>
                    {cashbookAccounts.map((account) => (
                      <option key={account._id} value={account._id}>
                        {account.code ? `${account.code} - ` : ""}{account.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700">
                    Reference Number
                  </label>
                  <input
                    type="text"
                    value={paymentForm.referenceNumber}
                    onChange={(e) =>
                      setPaymentForm({ ...paymentForm, referenceNumber: e.target.value })
                    }
                    className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-md text-sm"
                    placeholder="Transaction ref"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="text-xs font-semibold text-slate-700">Description</label>
                  <textarea
                    rows={3}
                    value={paymentForm.description}
                    onChange={(e) =>
                      setPaymentForm({ ...paymentForm, description: e.target.value })
                    }
                    className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-md text-sm"
                    placeholder="Payment notes"
                  />
                </div>
              </div>
            </div>

            <div className="px-4 py-3 border-t border-slate-200 flex justify-end gap-2">
              <button
                onClick={() => setShowPaymentModal(false)}
                className="px-4 py-2 text-xs border border-slate-300 rounded-md font-semibold hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSavePayment}
                className={`px-4 py-2 text-xs rounded-md text-white font-semibold ${MILIK_GREEN} hover:bg-[#0A3127]`}
              >
                Record Payment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {showDetailModal && activeDetail && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white">
              <h3 className="font-bold text-slate-900 flex items-center gap-2">
                <FaFileInvoiceDollar className="text-blue-600" />
                {activeDetail.landlordName} - Payment Details
              </h3>
              <button
                onClick={() => setShowDetailModal(false)}
                className="text-slate-500 hover:text-slate-700"
              >
                <FaTimes />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-xs font-bold text-blue-700">Rent Collected</p>
                  <p className="text-2xl font-bold text-blue-700">
                    Ksh {activeDetail.rentCollected.toLocaleString()}
                  </p>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <p className="text-xs font-bold text-green-700">Paid to Landlord</p>
                  <p className="text-2xl font-bold text-green-700">
                    Ksh {activeDetail.paymentsMade.toLocaleString()}
                  </p>
                </div>
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                  <p className="text-xs font-bold text-orange-700">Balance Owed</p>
                  <p className="text-2xl font-bold text-orange-700">
                    Ksh {activeDetail.balance.toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Property Breakdown */}
              <div>
                <h4 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                  📋 Property Breakdown & Collections
                </h4>
                <div className="border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className={`${MILIK_GREEN} text-white`}>
                        <th className="px-3 py-2 text-left font-semibold">
                          Property
                        </th>
                        <th className="px-3 py-2 text-center font-semibold">
                          Units
                        </th>
                        <th className="px-3 py-2 text-right font-semibold">
                          Monthly Rent
                        </th>
                        <th className="px-3 py-2 text-right font-semibold">
                          Collected
                        </th>
                        <th className="px-3 py-2 text-right font-semibold">
                          Outstanding
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeDetail.propertyBreakdown.length === 0 ? (
                        <tr>
                          <td colSpan="5" className="px-3 py-6 text-center text-slate-500 bg-slate-50">
                            No properties assigned to this landlord
                          </td>
                        </tr>
                      ) : (
                        <>
                          {activeDetail.propertyBreakdown.map((property, idx) => (
                            <tr
                              key={property.propertyId}
                              className={`${
                                idx % 2 === 0 ? "bg-white" : "bg-slate-50"
                              } border-b border-slate-200 hover:bg-blue-50`}
                            >
                              <td className="px-3 py-2 text-slate-900 font-medium">
                                {property.propertyName}
                              </td>
                              <td className="px-3 py-2 text-center text-slate-700">
                                {property.tenantsCount}
                              </td>
                              <td className="px-3 py-2 text-right font-semibold text-slate-900">
                                Ksh {property.rentExpected.toLocaleString()}
                              </td>
                              <td className="px-3 py-2 text-right font-semibold text-green-700">
                                Ksh {property.rentCollected.toLocaleString()}
                              </td>
                              <td className="px-3 py-2 text-right font-semibold text-orange-700">
                                Ksh {property.outstanding.toLocaleString()}
                              </td>
                            </tr>
                          ))}
                          <tr className="bg-slate-100 border-t-2 border-slate-200 font-bold">
                            <td colSpan="1" className="px-3 py-2 text-slate-900">TOTAL</td>
                            <td className="px-3 py-2 text-center text-slate-900">
                              {activeDetail.tenantsCount || 0}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-900">
                              Ksh {activeDetail.rentExpected?.toLocaleString?.() || "0"}
                            </td>
                            <td className="px-3 py-2 text-right text-green-700">
                              Ksh {activeDetail.rentCollected.toLocaleString()}
                            </td>
                            <td className="px-3 py-2 text-right text-orange-700">
                              Ksh {Math.max(0, activeDetail.balance).toLocaleString()}
                            </td>
                          </tr>
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Account Summary */}
              <div>
                <h4 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                  📊 Account Summary
                </h4>
                <div className="border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                  <table className="w-full text-xs">
                    <tbody>
                      <tr className="border-b border-slate-200 bg-white hover:bg-slate-50">
                        <td className="px-4 py-3 font-semibold text-slate-800">Properties Managed:</td>
                        <td className="px-4 py-3 text-right font-bold text-slate-900">{activeDetail.propertiesCount || 0}</td>
                      </tr>
                      <tr className="border-b border-slate-200 bg-slate-50 hover:bg-slate-100">
                        <td className="px-4 py-3 font-semibold text-slate-800">Total Units/Tenants:</td>
                        <td className="px-4 py-3 text-right font-bold text-slate-900">{activeDetail.tenantsCount || 0}</td>
                      </tr>
                      <tr className="border-b border-slate-200 bg-white hover:bg-slate-50">
                        <td className="px-4 py-3 font-semibold text-slate-800">Total Rent Collected:</td>
                        <td className="px-4 py-3 text-right font-bold text-green-700">Ksh {activeDetail.rentCollected.toLocaleString()}</td>
                      </tr>
                      <tr className="border-b border-slate-200 bg-slate-50 hover:bg-slate-100">
                        <td className="px-4 py-3 font-semibold text-slate-800">Already Paid to Landlord:</td>
                        <td className="px-4 py-3 text-right font-bold text-blue-700">Ksh {activeDetail.paymentsMade.toLocaleString()}</td>
                      </tr>
                      <tr className="bg-orange-50 border-t-2 border-orange-200">
                        <td className="px-4 py-3 font-bold text-slate-900 text-sm">Outstanding Balance:</td>
                        <td className="px-4 py-3 text-right font-bold text-orange-700 text-lg">Ksh {activeDetail.balance.toLocaleString()}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                  💳 Payment History
                </h4>
                <div className="border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                  <div className="max-h-64 overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-100 text-slate-600 sticky top-0">
                        <tr>
                          <th className="px-4 py-2 text-left">Date</th>
                          <th className="px-4 py-2 text-left">Method</th>
                          <th className="px-4 py-2 text-left">Reference</th>
                          <th className="px-4 py-2 text-right">Amount</th>
                          <th className="px-4 py-2 text-left">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeDetailHistory.length === 0 ? (
                          <tr>
                            <td colSpan="5" className="px-4 py-6 text-center text-slate-500">No landlord payments recorded yet.</td>
                          </tr>
                        ) : activeDetailHistory.map((payment, index) => (
                          <tr key={payment._id || index} className={index % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                            <td className="px-4 py-2">{formatDate(payment.date || payment.createdAt)}</td>
                            <td className="px-4 py-2 font-semibold text-slate-800">{payment.paymentMethod ? payment.paymentMethod.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '-'}</td>
                            <td className="px-4 py-2 text-slate-600">{payment.reference || payment.referenceNumber || '-'}</td>
                            <td className="px-4 py-2 text-right font-bold text-slate-900">Ksh {Number(payment.amount || 0).toLocaleString()}</td>
                            <td className="px-4 py-2">
                              <span className={`inline-flex rounded-full px-2 py-1 font-semibold ${payment.status === 'paid' ? 'bg-emerald-100 text-emerald-700' : payment.status === 'approved' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-700'}`}>
                                {payment.status || 'draft'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-4 py-3 border-t border-slate-200 flex justify-end gap-2 sticky bottom-0 bg-white">
              <button
                onClick={() => handlePrintLandlordStatement(activeDetail)}
                className="px-4 py-2 text-xs rounded-md text-white font-semibold bg-purple-600 hover:bg-purple-700 flex items-center gap-2"
              >
                <FaPrint />
                Print Statement
              </button>
              <button
                onClick={() => handleOpenPayment(activeDetail)}
                className={`px-4 py-2 text-xs rounded-md text-white font-semibold ${MILIK_ORANGE} hover:bg-[#e67e00] flex items-center gap-2`}
                disabled={activeDetail.balance <= 0}
              >
                <FaMoneyBillWave />
                Make Payment
              </button>
              <button
                onClick={() => setShowDetailModal(false)}
                className="px-4 py-2 text-xs border border-slate-300 rounded-md font-semibold hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <CommunicationComposerModal
        open={showSmsModal}
        onClose={() => setShowSmsModal(false)}
        businessId={currentCompany?._id || ""}
        contextType="landlord_bulk"
        recordIds={selectedLandlords}
        title={`SMS Landlord${selectedLandlords.length !== 1 ? "s" : ""} (${selectedLandlords.length})`}
        subtitle="Send an SMS notification to the selected landlords."
        allowedChannels={["sms"]}
        defaultChannel="sms"
        onSent={() => setShowSmsModal(false)}
      />
    </DashboardLayout>
  );
};

export default LandlordPayments;
