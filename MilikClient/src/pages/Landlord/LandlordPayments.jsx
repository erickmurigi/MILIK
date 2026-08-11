import React, { useState, useEffect, useMemo } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import {
  FaSearch,
  FaRedoAlt,
  FaEye,
  FaFileInvoiceDollar,
  FaPrint,
  FaTimes,
  FaChevronLeft,
  FaChevronRight,
  FaSms,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { getLandlords, getLandlordPayments } from "../../redux/apiCalls";
import { selectCurrentCompany, selectCurrentUser, selectAllProperties, selectAllTenants } from "../../redux/selectors";
import { hasCompanyPermission } from "../../utils/permissions";
import { fmtDate } from "../../utils/dates";
import AppSelect from "../../components/common/AppSelect";
import CommunicationComposerModal from "../../components/Communications/CommunicationComposerModal";
import { getProperties } from "../../redux/propertyRedux";
// NOTE: getLandlords is a thunk creator — must be called via dispatch(getLandlords({...}))

const MILIK_GREEN = "bg-[#0B3B2E]";
const ITEMS_PER_PAGE = 20;


const LandlordPayments = ({ mode = "payments" }) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  // Redux state
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const { landlords = [], isFetching } = useSelector((state) => state.landlord || {});
  const properties = useSelector(selectAllProperties);
  const tenants = useSelector(selectAllTenants);

  const canExportPayment = useMemo(
    () => hasCompanyPermission(currentUser || {}, currentCompany, "landlordPayments", "export", "accounts"),
    [currentUser, currentCompany]
  );

  // Local state
  const [filters, setFilters] = useTabState("/landlord-payments:filters", { search: "", status: "", paymentStatus: "" });
  const [currentPage, setCurrentPage] = useTabState("/landlord-payments:currentPage", 1);
  const [selectedLandlords, setSelectedLandlords] = useState([]);
  const [showSmsModal, setShowSmsModal] = useState(false);
  const [activeDetail, setActiveDetail] = useTabState("/landlord-payments:activeDetail", null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  // Landlord payment vouchers from backend
  const [landlordPayments, setLandlordPayments] = useState([]);

  // Load data
  useEffect(() => {
    const fetchData = async () => {
      if (currentCompany?._id) {
        dispatch(getLandlords({ business: currentCompany._id }));
        dispatch(getProperties({ business: currentCompany._id }));
        const payments = await getLandlordPayments(currentCompany._id);
        setLandlordPayments(payments);
      }
    };
    fetchData();
  }, [dispatch, currentCompany?._id]);

  // Calculate landlord financial data
  const tenantsByPropertyId = useMemo(() => {
    const m = new Map();
    tenants.forEach((tenant) => {
      const propId = String(tenant.unit?.property?._id || tenant.unit?.property || "");
      if (!propId) return;
      const arr = m.get(propId) || [];
      arr.push(tenant);
      m.set(propId, arr);
    });
    return m;
  }, [tenants]);

  const landlordData = useMemo(() => {
    const propsByLandlordId = new Map();
    const propsByLandlordName = new Map();
    for (const p of properties) {
      for (const entry of (p.landlords || [])) {
        if (entry.landlordId) {
          const id = String(entry.landlordId);
          if (!propsByLandlordId.has(id)) propsByLandlordId.set(id, []);
          propsByLandlordId.get(id).push(p);
        }
        if (entry.name) {
          if (!propsByLandlordName.has(entry.name)) propsByLandlordName.set(entry.name, []);
          propsByLandlordName.get(entry.name).push(p);
        }
      }
    }

    return landlords.map((landlord) => {
      const landlordIdStr = String(landlord._id);
      const byId = propsByLandlordId.get(landlordIdStr) || [];
      const byName = landlord.landlordName ? (propsByLandlordName.get(landlord.landlordName) || []) : [];
      const seen = new Set(byId.map((p) => String(p._id)));
      const landlordProperties = [...byId, ...byName.filter((p) => !seen.has(String(p._id)))];

      let totalRentExpected = 0;
      let totalTenantsCount = 0;
      const propertyBreakdown = [];

      landlordProperties.forEach((property) => {
        const propId = String(property._id);
        const propertyTenants = tenantsByPropertyId.get(propId) || [];
        const rentExpected = propertyTenants.reduce((sum, tenant) => sum + (tenant.rent || tenant.unit?.rent || 0), 0);

        totalRentExpected += rentExpected;
        totalTenantsCount += propertyTenants.length;

        propertyBreakdown.push({
          propertyId: property._id,
          propertyName: property.name || property.propertyName,
          tenantsCount: propertyTenants.length,
          rentExpected,
          rentCollected: 0,
          outstanding: rentExpected,
        });
      });

      const paymentsMade = landlordPayments
        .filter((p) => String(p?.landlord?._id || p?.landlord || p?.landlordId || "") === landlordIdStr && p.status !== "reversed")
        .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
      const balance = Number(landlord.balance ?? landlord.payableBalance ?? 0);

      return {
        ...landlord,
        propertiesCount: landlordProperties.length,
        tenantsCount: totalTenantsCount,
        rentExpected: totalRentExpected,
        rentCollected: 0,
        paymentsMade,
        balance,
        propertyBreakdown,
      };
    });
  }, [landlords, properties, tenantsByPropertyId, landlordPayments]);

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
      if (filters.status && landlord.status !== filters.status) {
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
    const paid = filteredLandlords.reduce((sum, ll) => sum + ll.paymentsMade, 0);
    const owed = filteredLandlords.reduce((sum, ll) => sum + Math.max(0, ll.balance), 0);
    return {
      totalLandlords: filteredLandlords.length,
      totalPaid: paid,
      totalOwed: owed,
    };
  }, [filteredLandlords]);

  // Handlers
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
                    <td><span class="amount negative">Ksh ${prop.rentExpected.toLocaleString()}</span></td>
                  </tr>
                `
                        )
                        .join("")
                    : `
                  <tr>
                    <td colspan="4" style="text-align: center; padding: 20px; color: #999;">
                      No properties assigned yet for this landlord
                    </td>
                  </tr>
                `
                }
                <tr class="totals-row">
                  <td colspan="1"><strong>TOTAL</strong></td>
                  <td style="text-align: center;"><strong>${landlord.tenantsCount || 0}</strong></td>
                  <td><span class="amount">Ksh ${landlord.rentExpected?.toLocaleString?.() || "0"}</span></td>
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
            <div className="filter-bar flex items-center gap-0.5 overflow-x-auto px-2 py-1">
              <div className="relative shrink-0">
                <FaSearch className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]" />
                <input value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Search name, code, email…" className="h-[20px] w-36 border border-slate-200 bg-white pl-6 pr-1 text-[9px] outline-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
              </div>
              <AppSelect
                value={filters.status}
                onChange={(v) => setFilters({ ...filters, status: v ?? '' })}
                options={[{ value: 'Active', label: 'Active' }, { value: 'Archived', label: 'Archived' }]}
                placeholder="All Status"
                compact
                clearable
              />
              <AppSelect
                value={filters.paymentStatus}
                onChange={(v) => setFilters({ ...filters, paymentStatus: v ?? '' })}
                options={[{ value: 'owed', label: 'Balance Owed' }, { value: 'clear', label: 'Fully Paid' }]}
                placeholder="All Payment Status"
                compact
                clearable
              />
              <div className="mx-1 h-3 w-px shrink-0 bg-slate-200" />
              <span className="shrink-0 border border-slate-200 bg-white px-1 py-0.5 text-[8px] font-bold text-slate-600">{stats.totalLandlords} landlords</span>
              <span className="shrink-0 border border-green-200 bg-green-50 px-1 py-0.5 text-[8px] font-bold text-green-700">Paid: Ksh {stats.totalPaid.toLocaleString()}</span>
              <span className="shrink-0 border border-orange-200 bg-orange-50 px-1 py-0.5 text-[8px] font-bold text-orange-700">Balance: Ksh {stats.totalOwed.toLocaleString()}</span>
              <div className="mx-1 h-3 w-px shrink-0 bg-slate-200" />
              <button onClick={() => setShowSmsModal(true)} disabled={selectedLandlords.length === 0} title={selectedLandlords.length > 0 ? `SMS ${selectedLandlords.length} landlord${selectedLandlords.length !== 1 ? "s" : ""}` : "Select landlords to SMS"} className="h-[20px] shrink-0 flex items-center gap-0.5 bg-teal-600 px-1.5 text-[9px] font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"><FaSms size={7} /> SMS{selectedLandlords.length > 0 && <span> ({selectedLandlords.length})</span>}</button>
              <button onClick={() => dispatch(getLandlords({ business: currentCompany._id }))} className="h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] font-semibold text-white bg-[#0B3B2E] hover:bg-[#0A3127]"><FaRedoAlt size={7} /> Refresh</button>
            </div>
          </div>

          {/* Table */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[1400px] text-[11px] border-collapse">
                <thead className="sticky top-0 z-10 shadow-sm">
                  <tr className={`${MILIK_GREEN} text-white`}>
                    <th className="px-3 py-2 text-center border-r border-white/10">
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
                    <th className="px-3 py-2 text-left font-bold border-r border-white/10">Code</th>
                    <th className="px-3 py-2 text-left font-bold border-r border-white/10">Landlord Name</th>
                    <th className="px-3 py-2 text-center font-bold border-r border-white/10">Properties</th>
                    <th className="px-3 py-2 text-center font-bold border-r border-white/10">Tenants</th>
                    <th className="px-3 py-2 text-right font-bold border-r border-white/10">Paid Out</th>
                    <th className="px-3 py-2 text-right font-bold border-r border-white/10">Balance</th>
                    <th className="px-3 py-2 text-center font-bold border-r border-white/10">Status</th>
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
                        className={`border-b border-gray-100 transition-colors ${idx % 2 === 0 ? "bg-white hover:bg-blue-50/40" : "bg-slate-50/60 hover:bg-blue-50/40"}`}
                      >
                        <td className="px-3 py-1 border-r border-gray-100 text-center">
                          <input
                            type="checkbox"
                            checked={selectedLandlords.includes(landlord._id)}
                            onChange={() => toggleSelection(landlord._id)}
                            className="cursor-pointer"
                          />
                        </td>
                        <td className="px-3 py-1 border-r border-gray-100 font-mono text-slate-700">
                          {landlord.landlordCode}
                        </td>
                        <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900">
                          {landlord.landlordName}
                        </td>
                        <td className="px-3 py-1 border-r border-gray-100 text-center text-slate-700">
                          {landlord.propertiesCount}
                        </td>
                        <td className="px-3 py-1 border-r border-gray-100 text-center text-slate-700">
                          {landlord.tenantsCount}
                        </td>
                        <td className="px-3 py-1 border-r border-gray-100 text-right font-bold text-green-700">
                          Ksh {landlord.paymentsMade.toLocaleString()}
                        </td>
                        <td className="px-3 py-1 border-r border-gray-100 text-right font-bold">
                          <span className={landlord.balance > 0 ? "text-orange-700" : "text-green-700"}>
                            Ksh {landlord.balance.toLocaleString()}
                          </span>
                        </td>
                        <td className="px-3 py-1 border-r border-gray-100 text-center">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold border ${landlord.status === "Active" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-600 border-slate-200"}`}>
                            {landlord.status}
                          </span>
                        </td>
                        <td className="px-3 py-1">
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
                            {canExportPayment && (
                            <button
                              onClick={() => handlePrintLandlordStatement(landlord)}
                              className="px-2 py-1 rounded bg-purple-600 hover:bg-purple-700 text-white"
                              title="Print Statement"
                            >
                              <FaPrint size={11} />
                            </button>
                            )}
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

      {/* Detail Modal */}
      {showDetailModal && activeDetail && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">
            <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
              <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide">
                <FaFileInvoiceDollar />
                {activeDetail.landlordName} - Payment Details
              </h3>
              <button
                onClick={() => setShowDetailModal(false)}
                className="text-white/70 transition-colors hover:text-white"
              >
                <FaTimes />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-white px-5 py-4 space-y-4">
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                  <table className="w-full text-[11px] border-collapse">
                    <thead>
                      <tr className={`${MILIK_GREEN} text-white`}>
                        <th className="px-3 py-1 text-left font-bold border-r border-white/10">Property</th>
                        <th className="px-3 py-1 text-center font-bold border-r border-white/10">Units</th>
                        <th className="px-3 py-1 text-right font-bold border-r border-white/10">Monthly Rent</th>
                        <th className="px-3 py-1 text-right font-bold">Outstanding</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeDetail.propertyBreakdown.length === 0 ? (
                        <tr>
                          <td colSpan="4" className="px-3 py-6 text-center text-slate-500 bg-slate-50">
                            No properties assigned to this landlord
                          </td>
                        </tr>
                      ) : (
                        <>
                          {activeDetail.propertyBreakdown.map((property, idx) => (
                            <tr
                              key={property.propertyId}
                              className={`border-b border-gray-100 ${idx % 2 === 0 ? "bg-white hover:bg-blue-50/40" : "bg-slate-50/60 hover:bg-blue-50/40"}`}
                            >
                              <td className="px-3 py-1 border-r border-gray-100 text-slate-900 font-medium">{property.propertyName}</td>
                              <td className="px-3 py-1 border-r border-gray-100 text-center text-slate-700">{property.tenantsCount}</td>
                              <td className="px-3 py-1 border-r border-gray-100 text-right font-semibold text-slate-900">Ksh {property.rentExpected.toLocaleString()}</td>
                              <td className="px-3 py-1 text-right font-semibold text-orange-700">Ksh {property.rentExpected.toLocaleString()}</td>
                            </tr>
                          ))}
                          <tr className="bg-slate-100 border-t-2 border-slate-200 font-bold">
                            <td className="px-3 py-1 text-slate-900">TOTAL</td>
                            <td className="px-3 py-1 text-center text-slate-900">{activeDetail.tenantsCount || 0}</td>
                            <td className="px-3 py-1 text-right text-slate-900">Ksh {activeDetail.rentExpected?.toLocaleString?.() || "0"}</td>
                            <td className="px-3 py-1 text-right text-orange-700">Ksh {Math.max(0, activeDetail.balance).toLocaleString()}</td>
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
                    <table className="w-full text-[11px] border-collapse">
                      <thead className="bg-[#0B3B2E] text-white sticky top-0">
                        <tr>
                          <th className="px-3 py-1 text-left font-bold border-r border-white/10">Date</th>
                          <th className="px-3 py-1 text-left font-bold border-r border-white/10">Method</th>
                          <th className="px-3 py-1 text-left font-bold border-r border-white/10">Reference</th>
                          <th className="px-3 py-1 text-right font-bold border-r border-white/10">Amount</th>
                          <th className="px-3 py-1 text-left font-bold">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeDetailHistory.length === 0 ? (
                          <tr>
                            <td colSpan="5" className="px-4 py-6 text-center text-slate-500">No landlord payments recorded yet.</td>
                          </tr>
                        ) : activeDetailHistory.map((payment, index) => (
                          <tr key={payment._id || index} className={`border-b border-gray-100 ${index % 2 === 0 ? "bg-white hover:bg-blue-50/40" : "bg-slate-50/60 hover:bg-blue-50/40"}`}>
                            <td className="px-3 py-1 border-r border-gray-100">{fmtDate(payment.date || payment.createdAt)}</td>
                            <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-800">{payment.paymentMethod ? payment.paymentMethod.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '-'}</td>
                            <td className="px-3 py-1 border-r border-gray-100 text-slate-600">{payment.reference || payment.referenceNumber || '-'}</td>
                            <td className="px-3 py-1 border-r border-gray-100 text-right font-bold text-slate-900">Ksh {Number(payment.amount || 0).toLocaleString()}</td>
                            <td className="px-3 py-1">
                              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${payment.status === 'paid' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : payment.status === 'approved' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>
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

            <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
              {canExportPayment && (
              <button
                onClick={() => handlePrintLandlordStatement(activeDetail)}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-black uppercase tracking-wide text-white bg-purple-600 hover:bg-purple-700"
              >
                <FaPrint />
                Print Statement
              </button>
              )}
              <button
                onClick={() => setShowDetailModal(false)}
                className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-700 transition-colors hover:bg-slate-100"
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
