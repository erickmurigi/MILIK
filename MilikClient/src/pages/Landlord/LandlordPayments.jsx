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
  FaSms,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { getLandlords, getLandlordPayments } from "../../redux/apiCalls";
import { selectCurrentCompany, selectCurrentUser, selectAllProperties, selectAllTenants, selectAllLandlords, selectLandlordIsFetching } from "../../redux/selectors";
import { hasCompanyPermission } from "../../utils/permissions";
import { fmtDate } from "../../utils/dates";
import { printDocument, formatMoney, formatDate as formatPrintDate } from "../../utils/printKit";
import AppSelect from "../../components/common/AppSelect";
import CommunicationComposerModal from "../../components/Communications/CommunicationComposerModal";
import { getProperties } from "../../redux/propertyRedux";
// NOTE: getLandlords is a thunk creator — must be called via dispatch(getLandlords({...}))

import PaginationBar from "../../components/PaginationBar";
import MilikTable from "../../components/common/MilikTable";
import ListToolbar from "../../components/common/ListToolbar";

const MILIK_GREEN = "bg-[#0B3B2E]";


const LandlordPayments = ({ mode = "payments" }) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  // Redux state
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const landlords = useSelector(selectAllLandlords);
  const isFetching = useSelector(selectLandlordIsFetching);
  const properties = useSelector(selectAllProperties);
  const tenants = useSelector(selectAllTenants);

  const canExportPayment = useMemo(
    () => hasCompanyPermission(currentUser || {}, currentCompany, "landlordPayments", "export", "accounts"),
    [currentUser, currentCompany]
  );

  // Local state
  const [filters, setFilters] = useTabState("/landlord-payments:filters", { search: "", status: "", paymentStatus: "" });
  const [pageSize, setPageSize] = useState(20);
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
  const totalPages = Math.max(1, Math.ceil(filteredLandlords.length / pageSize));
  const currentPageData = filteredLandlords.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
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
    const currentDate = new Date();
    const periodStart = new Date(currentDate.getFullYear(), currentDate.getMonth() - 2, 1);
    const periodEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
    const breakdown = landlord.propertyBreakdown || [];
    const balance = Number(landlord.balance || 0);
    const printed = printDocument({
      company: currentCompany,
      docType: "Landlord Payment Statement",
      docNumber: landlord.landlordCode || "",
      status: { label: landlord.status || "", tone: String(landlord.status || "").toLowerCase() === "active" ? "success" : "neutral" },
      meta: [["Period", `${formatPrintDate(periodStart)} - ${formatPrintDate(periodEnd)}`], ["Generated", formatPrintDate(currentDate)]],
      parties: [{
        heading: "Landlord",
        name: landlord.landlordName,
        lines: [landlord.landlordCode ? `Code: ${landlord.landlordCode}` : "", `Type: ${landlord.landlordType || "Individual"}`, landlord.email, landlord.phoneNumber],
      }],
      details: { heading: "Payment Summary", rows: [["Paid to landlord", `Ksh ${formatMoney(landlord.paymentsMade)}`], ["Balance owed", `Ksh ${formatMoney(balance)}`], ["Properties managed", String(landlord.propertiesCount || 0)]] },
      table: {
        columns: [
          { label: "Property Name", value: (row) => row.propertyName },
          { label: "Units", align: "right", value: (row) => String(row.tenantsCount) },
          { label: "Monthly Rent Expected", align: "right", value: (row) => `Ksh ${formatMoney(row.rentExpected)}` },
          { label: "Outstanding", align: "right", value: (row) => `Ksh ${formatMoney(row.rentExpected)}` },
        ],
        rows: breakdown,
        empty: "No properties assigned yet for this landlord",
      },
      totals: [
        { label: "Total units / tenants", value: String(landlord.tenantsCount || 0) },
        { label: "Monthly rent expected", value: `Ksh ${formatMoney(landlord.rentExpected)}` },
        { label: "Already paid to landlord", value: `Ksh ${formatMoney(landlord.paymentsMade)}` },
        { label: "Outstanding balance", value: `Ksh ${formatMoney(balance)}`, hero: true },
      ],
      notes: [{ heading: "Account status", text: `This statement reflects all rent collected from properties managed on behalf of ${landlord.landlordName}.` }],
    });
    if (!printed) toast.error("Pop-up blocked — allow pop-ups for this site to print");
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
          <ListToolbar>
            <div className="relative shrink-0">
              <FaSearch className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[8px] text-slate-400" />
              <ListToolbar.Input value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Search name, code, email…" width="w-36" className="pl-5" />
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
            <ListToolbar.Divider />
            <span className="shrink-0 border border-slate-200 bg-white px-1 py-0.5 text-[8px] font-bold text-slate-600">{stats.totalLandlords} landlords</span>
            <span className="shrink-0 border border-green-200 bg-green-50 px-1 py-0.5 text-[8px] font-bold text-green-700">Paid: Ksh {stats.totalPaid.toLocaleString()}</span>
            <span className="shrink-0 border border-orange-200 bg-orange-50 px-1 py-0.5 text-[8px] font-bold text-orange-700">Balance: Ksh {stats.totalOwed.toLocaleString()}</span>
            <ListToolbar.Divider />
            <ListToolbar.Button
              icon={FaSms}
              className="!bg-teal-600 hover:!bg-teal-700"
              disabled={selectedLandlords.length === 0}
              onClick={() => setShowSmsModal(true)}
              title={selectedLandlords.length > 0 ? `SMS ${selectedLandlords.length} landlord${selectedLandlords.length !== 1 ? "s" : ""}` : "Select landlords to SMS"}
            >
              SMS{selectedLandlords.length > 0 && <span> ({selectedLandlords.length})</span>}
            </ListToolbar.Button>
            <ListToolbar.Button icon={FaRedoAlt} onClick={() => dispatch(getLandlords({ business: currentCompany._id }))}>Refresh</ListToolbar.Button>
          </ListToolbar>

          {/* Table */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <MilikTable
              columns={[
                { label: "Code" },
                { label: "Landlord Name" },
                { label: "Properties", align: "center" },
                { label: "Tenants", align: "center" },
                { label: "Paid Out", align: "right" },
                { label: "Balance", align: "right" },
                { label: "Status", align: "center" },
              ]}
              rows={currentPageData}
              rowKey="_id"
              loading={isFetching}
              empty="No landlords found"
              minWidth="1400px"
              checkboxes
              allChecked={currentPageData.length > 0 && selectedLandlords.length === currentPageData.length}
              someChecked={selectedLandlords.length > 0 && selectedLandlords.length < currentPageData.length}
              onCheckAll={toggleSelectAll}
              isChecked={(landlord) => selectedLandlords.includes(landlord._id)}
              isSelected={(landlord) => selectedLandlords.includes(landlord._id)}
              onCheckRow={(landlord) => toggleSelection(landlord._id)}
              renderRow={(landlord) => (
                <>
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
                </>
              )}
              renderActions={(landlord) => (
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
              )}
            />

            <PaginationBar
              page={currentPage}
              pages={totalPages}
              total={filteredLandlords.length}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={(n) => { setPageSize(n); setCurrentPage(1); }}
              loading={isFetching}
              label="landlords"
            />
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
