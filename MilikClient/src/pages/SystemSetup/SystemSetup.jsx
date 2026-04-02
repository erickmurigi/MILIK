import React, { useState, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { getUsers, deleteUser, toggleUserLock, deleteCompany } from "../../redux/apiCalls";
import { useLocation, useNavigate } from "react-router-dom";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import {
  FaBuilding,
  FaUsers,
  FaSearch,
  FaPlus,
  FaEdit,
  FaTrash,
  FaLock,
  FaUnlock,
  FaEye,
  FaFileExport,
  FaFilter,
  FaChevronLeft,
  FaChevronRight,
  FaUserShield,
  FaDatabase,
  FaKey,
  FaUserClock,
  FaHistory,
  FaSave,
  FaCheck,
  FaSpinner,
  FaCalendarAlt,
  FaMapMarkerAlt,
  FaGlobe,
  FaMoneyBill,
  FaToggleOn,
  FaToggleOff,
  FaCog,
  FaWallet,
  FaChartLine,
  FaHome,
  FaHotel,
  FaShoppingCart,
  FaUsers as FaUsersIcon,
  FaUserTie,
  FaFileAlt,
  FaProjectDiagram,
  FaChartBar,
  FaPhone,
  FaEnvelope,
  FaIdCard,
  FaVenusMars,
  FaLock as FaLockIcon,
  FaShieldAlt,
  FaUserCircle,
  FaArrowLeft,
  FaArrowRight,
  FaTimes,
  FaSync,
  FaEllipsisV,
  FaEllipsisH,
} from "react-icons/fa";
import { getCompanies, createCompany } from "../../redux/apiCalls";
import AddCompanyWizard from "./AddCompanyWizard";
import { toast } from "react-toastify";
import MilikConfirmDialog from "../../components/Modals/MilikConfirmDialog";

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";
const MILIK_ORANGE = "bg-[#FF8C00]";
const MILIK_ORANGE_HOVER = "hover:bg-[#e67e00]";

const StatCard = ({ icon, label, value, color }) => (
  <div className="bg-white rounded-lg border border-slate-200 p-3 flex items-center gap-3">
    <div className={`w-10 h-10 rounded-lg ${color} flex items-center justify-center text-white`}>
      {icon}
    </div>
    <div>
      <div className="text-xs text-slate-600">{label}</div>
      <div className="text-xl font-bold text-slate-900">{value}</div>
    </div>
  </div>
);

const ActionButton = ({ icon, label, onClick, variant = "default" }) => {
  const baseClasses = "inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md transition";
  const variants = {
    default: "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50",
    primary: `${MILIK_GREEN} text-white ${MILIK_GREEN_HOVER}`,
    danger: "bg-red-50 text-red-700 hover:bg-red-100 border border-red-200",
    warning: `${MILIK_ORANGE} text-white ${MILIK_ORANGE_HOVER}`,
  };
  
  return (
    <button onClick={onClick} className={`${baseClasses} ${variants[variant]}`}>
      {icon}
      {label}
    </button>
  );
};

const SearchBar = ({ value, onChange, placeholder }) => (
  <div className="relative">
    <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
    <input
      type="text"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className="w-full pl-8 pr-4 py-2 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20 focus:border-[#0B3B2E]"
    />
  </div>
);

const Pagination = ({ currentPage, totalPages, onPageChange, totalRecords, recordsPerPage }) => (
  <div className="flex items-center justify-between mt-3 text-xs text-slate-600">
    <div>
      Displaying {((currentPage - 1) * recordsPerPage) + 1} - {Math.min(currentPage * recordsPerPage, totalRecords)} of {totalRecords} Records
    </div>
    <div className="flex items-center gap-2">
      <span>Per Page: {recordsPerPage}</span>
      <div className="flex gap-1">
        <button 
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="p-1 rounded border border-slate-200 disabled:opacity-50 hover:bg-slate-50"
        >
          <FaChevronLeft className="text-xs" />
        </button>
        <span className="px-3 py-1 bg-white border border-slate-200 rounded-md">
          Page {currentPage} of {totalPages}
        </span>
        <button 
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="p-1 rounded border border-slate-200 disabled:opacity-50 hover:bg-slate-50"
        >
          <FaChevronRight className="text-xs" />
        </button>
      </div>
    </div>
  </div>
);
const CompaniesTable = ({ companies, onEdit, onDelete, onLock, onAddCompany, isLoading }) => {
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedCompanies, setSelectedCompanies] = useState([]);
  const [selectAll, setSelectAll] = useState(false);
  const recordsPerPage = 10;

  // Handle both array and paginated object
  let companiesArray = [];
  if (Array.isArray(companies)) {
    companiesArray = companies;
  } else if (companies && Array.isArray(companies.companies)) {
    companiesArray = companies.companies;
  }

  // Map API data to display fields (relevant attributes only)
  const mappedCompanies = companiesArray.map(company => ({
    id: company._id,
    name: company.companyName || '-',
    regNo: company.registrationNo || '-',
    email: company.email || '-',
    country: company.country || '-',
    town: company.town || '-',
    status: company.accountStatus || (company.isActive ? 'Active' : 'Inactive'),
  }));

  // Filter based on search
  const filteredCompanies = mappedCompanies.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.regNo.toLowerCase().includes(search.toLowerCase()) ||
    c.email.toLowerCase().includes(search.toLowerCase()) ||
    c.country.toLowerCase().includes(search.toLowerCase())
  );

  // Pagination
  const totalPages = Math.ceil(filteredCompanies.length / recordsPerPage);
  const paginatedCompanies = filteredCompanies.slice(
    (currentPage - 1) * recordsPerPage,
    currentPage * recordsPerPage
  );

  // Selection handlers
  const handleSelectCompany = (id) => {
    setSelectedCompanies(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleSelectAll = () => {
    if (selectAll) {
      const currentIds = paginatedCompanies.map(c => c.id);
      setSelectedCompanies(prev => prev.filter(id => !currentIds.includes(id)));
      setSelectAll(false);
    } else {
      const currentIds = paginatedCompanies.map(c => c.id);
      setSelectedCompanies(prev => Array.from(new Set([...prev, ...currentIds])));
      setSelectAll(true);
    }
  };

  const handleCheckboxClick = (e) => e.stopPropagation();

  const getCompanyRowClass = (index, companyId) => {
    if (selectedCompanies.includes(companyId)) return "bg-[#CDE7D3] hover:bg-[#DFF1E3]";
    return index % 2 === 0 ? "bg-white hover:bg-[#f8f8f8]" : "bg-[#f9f9f9] hover:bg-[#f0f0f0]";
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-8">
        <FaSpinner className="animate-spin text-teal-600 text-2xl" />
        <span className="ml-2 text-slate-600">Loading companies...</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar - Search, Reset, Edit, Actions, Delete on top right */}
      <div className="flex items-center justify-between bg-white rounded-lg border border-gray-200 p-2.5">
        <div className="flex items-center gap-2">
          <button className="px-3 py-1.5 text-xs bg-blue-100 text-blue-600 rounded-lg flex items-center gap-1 hover:bg-blue-200 transition-colors font-bold border border-blue-300">
            <FaSearch className="w-3 h-3" /> Search
          </button>
          <button className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-lg flex items-center gap-1 hover:bg-gray-200 transition-colors font-bold border border-gray-300">
            <FaSync className="w-3 h-3" /> Reset
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => {
              if (selectedCompanies.length === 1) {
                const company = paginatedCompanies.find(c => c.id === selectedCompanies[0]);
                onEdit(company);
              } else {
                toast.info('Edit available for single selection only', { duration: 2000 });
              }
            }}
            disabled={selectedCompanies.length === 0}
            className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg flex items-center gap-1 hover:bg-blue-700 transition-colors font-bold disabled:opacity-50 disabled:cursor-not-allowed border border-blue-700"
          >
            <FaEdit className="w-3 h-3" /> Edit
          </button>
          <button className="px-3 py-1.5 text-xs bg-gray-600 text-white rounded-lg flex items-center gap-1 hover:bg-gray-700 transition-colors font-bold border border-gray-700">
            <FaEllipsisV className="w-3 h-3" /> Actions
          </button>
          <button 
            onClick={() => {
              if (selectedCompanies.length > 0) {
                setConfirmDialog({
                  isOpen: true,
                  title: "Delete Companies",
                  message: `Are you sure you want to delete ${selectedCompanies.length} selected company(ies)? This action cannot be undone.`,
                  isDangerous: true,
                  onConfirm: () => {
                    selectedCompanies.forEach(id => onDelete(id));
                    setSelectedCompanies([]);
                    setConfirmDialog(prev => ({ ...prev, isOpen: false }));
                  },
                });
              }
            }}
            disabled={selectedCompanies.length === 0}
            className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-lg flex items-center gap-1 hover:bg-red-700 transition-colors font-bold disabled:opacity-50 disabled:cursor-not-allowed border border-red-700"
          >
            <FaTrash className="w-3 h-3" /> Delete
          </button>
          <button className="px-3 py-1.5 text-xs bg-teal-600 text-white rounded-lg flex items-center gap-1 hover:bg-teal-700 transition-colors font-bold border border-teal-700" onClick={onAddCompany}>
            <FaPlus className="w-3 h-3" /> Add Company
          </button>
          <button className="px-3 py-1.5 text-xs bg-gray-600 text-white rounded-lg flex items-center gap-1 hover:bg-gray-700 transition-colors font-bold border border-gray-700">
            <FaFileExport className="w-3 h-3" /> Export
          </button>
          <button className="px-3 py-1.5 text-xs bg-gray-600 text-white rounded-lg flex items-center gap-1 hover:bg-gray-700 transition-colors font-bold border border-gray-700">
            <FaEllipsisH className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Table container */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse border border-gray-200 font-bold bg-white">
            <thead>
              <tr className="sticky top-0 z-10">
                <th
                  className="px-3 py-1 text-left font-bold text-white border border-gray-200 bg-[#0B3B2E]"
                  style={{ width: "46px" }}
                >
                  <input
                    type="checkbox"
                    checked={selectAll && paginatedCompanies.length > 0}
                    onChange={handleSelectAll}
                    onClick={handleCheckboxClick}
                    className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                  />
                </th>
                <th className="px-3 py-1 text-left font-bold text-white border border-gray-200 bg-[#0B3B2E]">Company Name</th>
                <th className="px-3 py-1 text-left font-bold text-white border border-gray-200 bg-[#0B3B2E]">Reg No.</th>
                <th className="px-3 py-1 text-left font-bold text-white border border-gray-200 bg-[#0B3B2E]">Email</th>
                <th className="px-3 py-1 text-left font-bold text-white border border-gray-200 bg-[#0B3B2E]">Country</th>
                <th className="px-3 py-1 text-left font-bold text-white border border-gray-200 bg-[#0B3B2E]">Town</th>
                <th className="px-3 py-1 text-center font-bold text-white border border-gray-200 bg-[#0B3B2E]">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {paginatedCompanies.length > 0 ? (
                paginatedCompanies.map((company, index) => (
                  <tr
                    key={company.id}
                    className={[
                      "border-b border-gray-200 cursor-pointer transition-colors duration-150",
                      getCompanyRowClass(index, company.id),
                    ].join(" ")}
                    onClick={() => handleSelectCompany(company.id)}
                  >
                    <td className="px-3 py-1 border border-gray-200 align-top" onClick={handleCheckboxClick}>
                      <input
                        type="checkbox"
                        checked={selectedCompanies.includes(company.id)}
                        onChange={() => handleSelectCompany(company.id)}
                        onClick={handleCheckboxClick}
                        className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                      />
                    </td>
                    <td className="px-3 py-1 font-bold text-gray-900 border border-gray-200 align-top truncate" title={company.name}>
                      {company.name}
                    </td>
                    <td className="px-3 py-1 font-bold text-gray-900 border border-gray-200 align-top">{company.regNo}</td>
                    <td className="px-3 py-1 font-bold text-gray-900 border border-gray-200 align-top truncate" title={company.email}>
                      {company.email}
                    </td>
                    <td className="px-3 py-1 font-bold text-gray-900 border border-gray-200 align-top truncate" title={company.country}>
                      {company.country}
                    </td>
                    <td className="px-3 py-1 font-bold text-gray-900 border border-gray-200 align-top truncate" title={company.town}>
                      {company.town}
                    </td>
                    <td className="px-3 py-1 text-center border border-gray-200 align-top">
                      <span
                        className={[
                          "inline-flex items-center px-2 py-0.5 rounded text-xs font-bold whitespace-nowrap border",
                          company.status === "Active"
                            ? selectedCompanies.includes(company.id)
                              ? "bg-white text-green-800 border-green-300"
                              : "bg-green-100 text-green-800 border-green-300"
                            : selectedCompanies.includes(company.id)
                            ? "bg-white text-gray-800 border-gray-300"
                            : "bg-gray-100 text-gray-800 border-gray-300",
                        ].join(" ")}
                      >
                        {company.status}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="8" className="px-3 py-4 text-center text-gray-500 border border-gray-200 bg-white">
                    <div className="flex flex-col items-center justify-center py-8">
                      <div className="text-lg font-bold text-gray-400 mb-2">No companies found</div>
                      <div className="text-sm text-gray-500">Click Add Company to create a new one</div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination Footer */}
      {filteredCompanies.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-3 flex items-center justify-between">
          <div className="text-xs text-gray-600 font-bold">
            <div className="flex items-center gap-4">
              <span>
                Showing <span className="font-bold">{((currentPage - 1) * recordsPerPage) + 1}</span> to{" "}
                <span className="font-bold">{Math.min(currentPage * recordsPerPage, filteredCompanies.length)}</span> of{" "}
                <span className="font-bold">{filteredCompanies.length}</span> companies
              </span>
              {selectedCompanies.length > 0 && (
                <span className="bg-[#DDEFE1] text-gray-900 px-2 py-0.5 rounded-full text-xs font-bold border border-[#0B3B2E]/30">
                  {selectedCompanies.length} selected
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg flex items-center gap-1 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-bold"
            >
              <FaChevronLeft size={10} />
              Previous
            </button>
            <span className="text-xs font-bold text-gray-600">
              Page <span className="font-bold">{currentPage}</span> of <span className="font-bold">{totalPages}</span>
            </span>
            <button
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg flex items-center gap-1 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-bold"
            >
              Next
              <FaChevronRight size={10} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
const UsersTable = ({ users, onEdit, onLock, onDelete, onAddUser, isLoading, selectedCompany }) => {
  const currentUser = useSelector((state) => state.auth?.currentUser);
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [selectAll, setSelectAll] = useState(false);
  const recordsPerPage = 15;
  const safeUsers = Array.isArray(users) ? users : [];
  const canInjectSystemAdmin = Boolean(currentUser?.isSystemAdmin || currentUser?.superAdminAccess) && selectedCompany?._id;
  const systemAdminVirtualId = selectedCompany?._id ? `__system_admin__-${selectedCompany._id}` : "";
  const displayUsers = canInjectSystemAdmin
    ? [
        {
          _id: systemAdminVirtualId,
          surname: "System",
          otherNames: "Admin",
          email: String(currentUser?.email || "milik-admin@milik.local").toLowerCase(),
          phoneNumber: currentUser?.phoneNumber || "-",
          isActive: true,
          locked: false,
          superAdminAccess: true,
          adminAccess: true,
          profile: "Administrator",
          company: selectedCompany,
          accessibleCompanies: [selectedCompany],
          createdAt: null,
          isVirtualSystemAdmin: true,
        },
        ...safeUsers,
      ]
    : safeUsers;

  // Map user data to display fields
  const mappedUsers = displayUsers.map(user => ({
    id: user._id,
    isVirtualSystemAdmin: Boolean(user.isVirtualSystemAdmin),
    name: `${user.surname || ''} ${user.otherNames || ''}`.trim() || '-',
    email: user.email || '-',
    phone: user.phoneNumber || '-',
    status: user.isActive ? 'Active' : 'Inactive',
    locked: user.locked ? 'Yes' : 'No',
    adminAccess: user.superAdminAccess ? 'Milik Admin' : (user.adminAccess ? 'Company Admin' : 'Standard'),
    userProfile: user.profile || '-',
    companies: Array.isArray(user.accessibleCompanies) && user.accessibleCompanies.length > 0 ? user.accessibleCompanies.map((item) => item.companyName || item.name).join(', ') : (user.company?.companyName || selectedCompany?.companyName || '-'),
    createdAt: user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-GB') : 'Default access',
  }));

  // Filter based on search
  const filteredUsers = mappedUsers.filter(u =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    u.phone.toLowerCase().includes(search.toLowerCase())
  );

  // Pagination
  const totalPages = Math.ceil(filteredUsers.length / recordsPerPage);
  const paginatedUsers = filteredUsers.slice(
    (currentPage - 1) * recordsPerPage,
    currentPage * recordsPerPage
  );

  // Selection handlers
  const handleSelectUser = (id) => {
    if (!id || String(id).startsWith('__system_admin__-')) return;
    setSelectedUsers(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleSelectAll = () => {
    if (selectAll) {
      const currentIds = paginatedUsers.filter((u) => !u.isVirtualSystemAdmin).map(u => u.id);
      setSelectedUsers(prev => prev.filter(id => !currentIds.includes(id)));
      setSelectAll(false);
    } else {
      const currentIds = paginatedUsers.filter((u) => !u.isVirtualSystemAdmin).map(u => u.id);
      setSelectedUsers(prev => Array.from(new Set([...prev, ...currentIds])));
      setSelectAll(true);
    }
  };

  const handleCheckboxClick = (e) => e.stopPropagation();

  const getUserRowClass = (index, userId) => {
    if (selectedUsers.includes(userId)) return "bg-[#CDE7D3] hover:bg-[#DFF1E3]";
    return index % 2 === 0 ? "bg-white hover:bg-[#f8f8f8]" : "bg-[#f9f9f9] hover:bg-[#f0f0f0]";
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-8">
        <FaSpinner className="animate-spin text-teal-600 text-2xl" />
        <span className="ml-2 text-slate-600">Loading users...</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar - Search, Reset, Edit, Actions, Delete on top right */}
      <div className="flex items-center justify-between bg-white rounded-lg border border-gray-200 p-2.5">
        <div className="flex items-center gap-2">
          <button className="px-3 py-1.5 text-xs bg-blue-100 text-blue-600 rounded-lg flex items-center gap-1 hover:bg-blue-200 transition-colors font-bold border border-blue-300">
            <FaSearch className="w-3 h-3" /> Search
          </button>
          <button className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-lg flex items-center gap-1 hover:bg-gray-200 transition-colors font-bold border border-gray-300">
            <FaSync className="w-3 h-3" /> Reset
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => {
              if (selectedUsers.length === 1) {
                const user = paginatedUsers.find(u => u.id === selectedUsers[0]);
                onEdit(user);
              } else {
                toast.info('Edit available for single selection only', { duration: 2000 });
              }
            }}
            disabled={selectedUsers.length === 0}
            className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg flex items-center gap-1 hover:bg-blue-700 transition-colors font-bold disabled:opacity-50 disabled:cursor-not-allowed border border-blue-700"
          >
            <FaEdit className="w-3 h-3" /> Edit
          </button>
          <button className="px-3 py-1.5 text-xs bg-gray-600 text-white rounded-lg flex items-center gap-1 hover:bg-gray-700 transition-colors font-bold border border-gray-700">
            <FaEllipsisV className="w-3 h-3" /> Actions
          </button>
          <button 
            onClick={() => {
              if (selectedUsers.length > 0) {
                setConfirmDialog({
                  isOpen: true,
                  title: "Delete Users",
                  message: `Are you sure you want to delete ${selectedUsers.length} selected user(s)? This action cannot be undone.`,
                  isDangerous: true,
                  onConfirm: () => {
                    selectedUsers.forEach(id => onDelete(id));
                    setSelectedUsers([]);
                    setConfirmDialog(prev => ({ ...prev, isOpen: false }));
                  },
                });
              }
            }}
            disabled={selectedUsers.length === 0}
            className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-lg flex items-center gap-1 hover:bg-red-700 transition-colors font-bold disabled:opacity-50 disabled:cursor-not-allowed border border-red-700"
          >
            <FaTrash className="w-3 h-3" /> Delete
          </button>
          <button className="px-3 py-1.5 text-xs bg-teal-600 text-white rounded-lg flex items-center gap-1 hover:bg-teal-700 transition-colors font-bold border border-teal-700" onClick={onAddUser}>
            <FaPlus className="w-3 h-3" /> Add User
          </button>
          <button className="px-3 py-1.5 text-xs bg-gray-600 text-white rounded-lg flex items-center gap-1 hover:bg-gray-700 transition-colors font-bold border border-gray-700">
            <FaFileExport className="w-3 h-3" /> Export
          </button>
          <button className="px-3 py-1.5 text-xs bg-gray-600 text-white rounded-lg flex items-center gap-1 hover:bg-gray-700 transition-colors font-bold border border-gray-700">
            <FaEllipsisH className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Table container */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse border border-gray-200 font-bold bg-white">
            <thead>
              <tr className="sticky top-0 z-10">
                <th
                  className="px-3 py-1 text-left font-bold text-white border border-gray-200 bg-[#0B3B2E]"
                  style={{ width: "46px" }}
                >
                  <input
                    type="checkbox"
                    checked={selectAll && paginatedUsers.length > 0}
                    onChange={handleSelectAll}
                    onClick={handleCheckboxClick}
                    className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                  />
                </th>
                <th className="px-3 py-1 text-left font-bold text-white border border-gray-200 bg-[#0B3B2E]">Name</th>
                <th className="px-3 py-1 text-left font-bold text-white border border-gray-200 bg-[#0B3B2E]">Email</th>
                <th className="px-3 py-1 text-left font-bold text-white border border-gray-200 bg-[#0B3B2E]">Phone</th>
                <th className="px-3 py-1 text-center font-bold text-white border border-gray-200 bg-[#0B3B2E]">Status</th>
                <th className="px-3 py-1 text-center font-bold text-white border border-gray-200 bg-[#0B3B2E]">Locked</th>
                <th className="px-3 py-1 text-left font-bold text-white border border-gray-200 bg-[#0B3B2E]">Admin Access</th>
                <th className="px-3 py-1 text-center font-bold text-white border border-gray-200 bg-[#0B3B2E]">Profile</th>
                <th className="px-3 py-1 text-center font-bold text-white border border-gray-200 bg-[#0B3B2E]">Company</th>
                <th className="px-3 py-1 text-left font-bold text-white border border-gray-200 bg-[#0B3B2E]">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {paginatedUsers.length > 0 ? (
                paginatedUsers.map((user, index) => (
                  <tr
                    key={user.id}
                    className={[
                      "border-b border-gray-200 transition-colors duration-150",
                      user.isVirtualSystemAdmin ? "cursor-default" : "cursor-pointer",
                      getUserRowClass(index, user.id),
                    ].join(" ")}
                    onClick={() => handleSelectUser(user.id)}
                  >
                    <td className="px-3 py-1 border border-gray-200 align-top" onClick={handleCheckboxClick}>
                      <input
                        type="checkbox"
                        checked={selectedUsers.includes(user.id)}
                        onChange={() => handleSelectUser(user.id)}
                        onClick={handleCheckboxClick}
                        disabled={user.isVirtualSystemAdmin}
                        className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    </td>
                    <td className="px-3 py-1 font-bold text-gray-900 border border-gray-200 align-top">
                      <div>{user.name}</div>
                      {user.isVirtualSystemAdmin ? (
                        <div className="mt-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700">Default in this company</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-1 font-bold text-gray-900 border border-gray-200 align-top truncate max-w-[150px]" title={user.email}>
                      {user.email}
                    </td>
                    <td className="px-3 py-1 font-bold text-gray-900 border border-gray-200 align-top">{user.phone}</td>
                    <td className="px-3 py-1 text-center border border-gray-200 align-top">
                      <span
                        className={[
                          "inline-flex items-center px-2 py-0.5 rounded text-xs font-bold whitespace-nowrap border",
                          user.status === "Active"
                            ? selectedUsers.includes(user.id)
                              ? "bg-white text-green-800 border-green-300"
                              : "bg-green-100 text-green-800 border-green-300"
                            : selectedUsers.includes(user.id)
                            ? "bg-white text-gray-800 border-gray-300"
                            : "bg-gray-100 text-gray-800 border-gray-300",
                        ].join(" ")}
                      >
                        {user.status}
                      </span>
                    </td>
                    <td className="px-3 py-1 text-center border border-gray-200 align-top">
                      {user.locked === 'Yes' ? (
                        <FaLock className="inline text-amber-600" />
                      ) : (
                        <FaUnlock className="inline text-gray-400" />
                      )}
                    </td>
                    <td className="px-3 py-1 font-bold text-gray-900 border border-gray-200 align-top">{user.adminAccess}</td>
                    <td className="px-3 py-1 text-center font-bold text-gray-900 border border-gray-200 align-top">{user.userProfile}</td>
                    <td className="px-3 py-1 text-center font-bold text-gray-900 border border-gray-200 align-top">{user.companies}</td>
                    <td className="px-3 py-1 font-bold text-gray-900 border border-gray-200 align-top">{user.createdAt}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="10" className="px-3 py-4 text-center text-gray-500 border border-gray-200 bg-white">
                    <div className="flex flex-col items-center justify-center py-8">
                      <div className="text-lg font-bold text-gray-400 mb-2">No users found</div>
                      <div className="text-sm text-gray-500">Click Add User to create a new one</div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination Footer */}
      {filteredUsers.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-3 flex items-center justify-between">
          <div className="text-xs text-gray-600 font-bold">
            <div className="flex items-center gap-4">
              <span>
                Showing <span className="font-bold">{((currentPage - 1) * recordsPerPage) + 1}</span> to{" "}
                <span className="font-bold">{Math.min(currentPage * recordsPerPage, filteredUsers.length)}</span> of{" "}
                <span className="font-bold">{filteredUsers.length}</span> users
              </span>
              {selectedUsers.length > 0 && (
                <span className="bg-[#DDEFE1] text-gray-900 px-2 py-0.5 rounded-full text-xs font-bold border border-[#0B3B2E]/30">
                  {selectedUsers.length} selected
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg flex items-center gap-1 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-bold"
            >
              <FaChevronLeft size={10} />
              Previous
            </button>
            <span className="text-xs font-bold text-gray-600">
              Page <span className="font-bold">{currentPage}</span> of <span className="font-bold">{totalPages}</span>
            </span>
            <button
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg flex items-center gap-1 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-bold"
            >
              Next
              <FaChevronRight size={10} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const SystemRightsTable = () => {
  const [enableAll, setEnableAll] = useState(false);
  const [disableAll, setDisableAll] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedRights, setSelectedRights] = useState([]);
  const [selectAll, setSelectAll] = useState(false);
  const recordsPerPage = 10;

  // Mock system rights data - can be replaced with API call later
  const systemRights = [
    { id: 1, name: "Accounting periods", status: "Disabled", privilege: "View", profile: "Property Management", module: "Financial Accounts Module" },
    { id: 2, name: "Accounts", status: "Disabled", privilege: "View", profile: "Property Management", module: "Financial Accounts Module" },
    { id: 3, name: "Accounts Budgeting", status: "Disabled", privilege: "View", profile: "Property Management", module: "Financial Accounts Module" },
    { id: 4, name: "Accounts Meter Reading", status: "Disabled", privilege: "View", profile: "Property Management", module: "Financial Accounts Module" },
    { id: 5, name: "Accounts Module Setup", status: "Disabled", privilege: "View", profile: "Property Management", module: "Financial Accounts Module" },
    { id: 6, name: "Accounts Non Sale Inventory", status: "Disabled", privilege: "View", profile: "Property Management", module: "Financial Accounts Module" },
    { id: 7, name: "Accounts Periods", status: "Disabled", privilege: "View", profile: "Property Management", module: "Financial Accounts Module" },
  ];

  const totalPages = Math.ceil(systemRights.length / recordsPerPage);
  const paginatedRights = systemRights.slice(
    (currentPage - 1) * recordsPerPage,
    currentPage * recordsPerPage
  );

  // Selection handlers
  const handleSelectRight = (id) => {
    setSelectedRights(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleSelectAll = () => {
    if (selectAll) {
      const currentIds = paginatedRights.map(r => r.id);
      setSelectedRights(prev => prev.filter(id => !currentIds.includes(id)));
      setSelectAll(false);
    } else {
      const currentIds = paginatedRights.map(r => r.id);
      setSelectedRights(prev => Array.from(new Set([...prev, ...currentIds])));
      setSelectAll(true);
    }
  };

  const handleCheckboxClick = (e) => e.stopPropagation();

  const getRightRowClass = (index, rightId) => {
    if (selectedRights.includes(rightId)) return "bg-[#CDE7D3] hover:bg-[#DFF1E3]";
    return index % 2 === 0 ? "bg-white hover:bg-[#f8f8f8]" : "bg-[#f9f9f9] hover:bg-[#f0f0f0]";
  };

  return (
    <div className="space-y-3">
      {/* Toolbar - Search, Reset, Enable All, Disable All on top */}
      <div className="flex items-center justify-between bg-white rounded-lg border border-gray-200 p-2.5">
        <div className="flex items-center gap-2">
          <button className="px-3 py-1.5 text-xs bg-blue-100 text-blue-600 rounded-lg flex items-center gap-1 hover:bg-blue-200 transition-colors font-bold border border-blue-300">
            <FaSearch className="w-3 h-3" /> Search
          </button>
          <button className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-lg flex items-center gap-1 hover:bg-gray-200 transition-colors font-bold border border-gray-300">
            <FaSync className="w-3 h-3" /> Reset
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setEnableAll(true)}
            className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg flex items-center gap-1 hover:bg-green-700 transition-colors font-bold border border-green-700"
          >
            <FaCheck className="w-3 h-3" /> Enable All
          </button>
          <button 
            onClick={() => setDisableAll(true)}
            className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-lg flex items-center gap-1 hover:bg-red-700 transition-colors font-bold border border-red-700"
          >
            <FaTimes className="w-3 h-3" /> Disable All
          </button>
          <button className="px-3 py-1.5 text-xs bg-gray-600 text-white rounded-lg flex items-center gap-1 hover:bg-gray-700 transition-colors font-bold border border-gray-700">
            <FaFileExport className="w-3 h-3" /> Export
          </button>
          <button className="px-3 py-1.5 text-xs bg-gray-600 text-white rounded-lg flex items-center gap-1 hover:bg-gray-700 transition-colors font-bold border border-gray-700">
            <FaEllipsisH className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Table container */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse border border-gray-200 font-bold bg-white">
            <thead>
              <tr className="sticky top-0 z-10">
                <th
                  className="px-3 py-1 text-left font-bold text-white border border-gray-200 bg-[#0B3B2E]"
                  style={{ width: "46px" }}
                >
                  <input
                    type="checkbox"
                    checked={selectAll && paginatedRights.length > 0}
                    onChange={handleSelectAll}
                    onClick={handleCheckboxClick}
                    className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                  />
                </th>
                <th className="px-3 py-1 text-left font-bold text-white border border-gray-200 bg-[#0B3B2E]">System Right [Name]</th>
                <th className="px-3 py-1 text-center font-bold text-white border border-gray-200 bg-[#0B3B2E]">Permission Status</th>
                <th className="px-3 py-1 text-center font-bold text-white border border-gray-200 bg-[#0B3B2E]">Privilege</th>
                <th className="px-3 py-1 text-left font-bold text-white border border-gray-200 bg-[#0B3B2E]">Profile</th>
                <th className="px-3 py-1 text-left font-bold text-white border border-gray-200 bg-[#0B3B2E]">Module</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {paginatedRights.map((right, index) => (
                <tr
                  key={right.id}
                  className={[
                    "border-b border-gray-200 cursor-pointer transition-colors duration-150",
                    getRightRowClass(index, right.id),
                  ].join(" ")}
                  onClick={() => handleSelectRight(right.id)}
                >
                  <td className="px-3 py-1 border border-gray-200 align-top" onClick={handleCheckboxClick}>
                    <input
                      type="checkbox"
                      checked={selectedRights.includes(right.id)}
                      onChange={() => handleSelectRight(right.id)}
                      onClick={handleCheckboxClick}
                      className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                    />
                  </td>
                  <td className="px-3 py-1 font-bold text-gray-900 border border-gray-200 align-top">{right.name}</td>
                  <td className="px-3 py-1 text-center border border-gray-200 align-top">
                    <span
                      className={[
                        "inline-flex items-center px-2 py-0.5 rounded text-xs font-bold whitespace-nowrap border",
                        right.status === "Enabled"
                          ? selectedRights.includes(right.id)
                            ? "bg-white text-green-800 border-green-300"
                            : "bg-green-100 text-green-800 border-green-300"
                          : selectedRights.includes(right.id)
                          ? "bg-white text-gray-800 border-gray-300"
                          : "bg-gray-100 text-gray-800 border-gray-300",
                      ].join(" ")}
                    >
                      {right.status}
                    </span>
                  </td>
                  <td className="px-3 py-1 text-center font-bold text-gray-900 border border-gray-200 align-top">{right.privilege}</td>
                  <td className="px-3 py-1 font-bold text-gray-900 border border-gray-200 align-top">{right.profile}</td>
                  <td className="px-3 py-1 font-bold text-gray-900 border border-gray-200 align-top">{right.module}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination Footer */}
      <div className="bg-white rounded-lg border border-gray-200 p-3 flex items-center justify-between">
        <div className="text-xs text-gray-600 font-bold">
          <div className="flex items-center gap-4">
            <span>
              Showing <span className="font-bold">{((currentPage - 1) * recordsPerPage) + 1}</span> to{" "}
              <span className="font-bold">{Math.min(currentPage * recordsPerPage, systemRights.length)}</span> of{" "}
              <span className="font-bold">{systemRights.length}</span> system rights
            </span>
            {selectedRights.length > 0 && (
              <span className="bg-[#DDEFE1] text-gray-900 px-2 py-0.5 rounded-full text-xs font-bold border border-[#0B3B2E]/30">
                {selectedRights.length} selected
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg flex items-center gap-1 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-bold"
          >
            <FaChevronLeft size={10} />
            Previous
          </button>
          <span className="text-xs font-bold text-gray-600">
            Page <span className="font-bold">{currentPage}</span> of <span className="font-bold">{totalPages}</span>
          </span>
          <button
            onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages}
            className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg flex items-center gap-1 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-bold"
          >
            Next
            <FaChevronRight size={10} />
          </button>
        </div>
      </div>
    </div>
  );
};
export default function SystemSetupPage() {
  
  const dispatch = useDispatch();
  const location = useLocation();
  const navigate = useNavigate();
  const { companies, isFetching: companiesFetching } = useSelector((state) => state.company);
  const { users, isFetching: usersFetching } = useSelector((state) => state.user);
  const { currentUser } = useSelector((state) => state.auth);
  const { currentCompany } = useSelector((state) => state.company);
  const isSystemAdmin = Boolean(currentUser?.isSystemAdmin || currentUser?.superAdminAccess);
  
  const companyName = currentCompany?.companyName || currentUser?.company?.companyName || 'Company';
  const userName = currentUser ? `${currentUser.surname} ${currentUser.otherNames}`.trim() : 'User';
  const [selectedCompanyForUsers, setSelectedCompanyForUsers] = useState(null);

  // Milik Confirm Dialog state
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    title: "",
    message: "",
    isDangerous: false,
    onConfirm: null,
  });

  const sectionFromPath = location.pathname.split("/")[2];
  const validSections = ["companies", "users", "rights", "database", "sessions", "audit"];
  const activeTab = validSections.includes(sectionFromPath) ? sectionFromPath : "companies";

  useEffect(() => {
    if (!validSections.includes(sectionFromPath)) {
      navigate("/system-setup/companies", { replace: true });
    }
  }, [sectionFromPath, navigate]);

  // Fetch companies on mount
  useEffect(() => {
    dispatch(getCompanies({ limit: 100 }));
  }, [dispatch]);

  // Set default company for users when companies load
  useEffect(() => {
    if (selectedCompanyForUsers?._id) return;

    if (currentCompany?._id) {
      setSelectedCompanyForUsers(currentCompany);
      return;
    }

    if (companies.length > 0) {
      setSelectedCompanyForUsers(companies[0]);
    }
  }, [companies, currentCompany, selectedCompanyForUsers]);

  // Fetch users when selected company changes
  useEffect(() => {
    if (selectedCompanyForUsers) {
      dispatch(getUsers(selectedCompanyForUsers._id, { limit: 100 }));
    }
  }, [dispatch, selectedCompanyForUsers]);

  

  const handleDeleteUser = (userId) => {
    setConfirmDialog({
      isOpen: true,
      title: "Delete User",
      message: "Are you sure you want to delete this user? This action cannot be undone.",
      isDangerous: true,
      onConfirm: () => {
        dispatch(deleteUser(userId));
        setConfirmDialog({ ...confirmDialog, isOpen: false });
      },
    });
  };

  const handleLockUser = (userId) => {
    dispatch(toggleUserLock(userId));
  };

  const handleEditUser = (user) => {
    const userId = user?.id || user?._id;
    if (!userId) return;
    navigate(`/add-user/${userId}`, { state: { tabTitle: 'User Access' } });
  };



  const tabs = [
    { key: "companies", label: "COMPANIES", icon: <FaBuilding />, path: "/system-setup/companies" },
    { key: "users", label: "USERS", icon: <FaUsers />, path: "/system-setup/users" },
    { key: "rights", label: "SYSTEM RIGHTS", icon: <FaUserShield />, path: "/system-setup/rights" },
    { key: "database", label: "DATABASE", icon: <FaDatabase />, path: "/system-setup/database" },
    { key: "sessions", label: "SESSIONS", icon: <FaUserClock />, path: "/system-setup/sessions" },
    { key: "audit", label: "AUDIT LOG", icon: <FaHistory />, path: "/system-setup/audit" },
  ];

  const handleAddUser = async () => {
    navigate('/add-user', { state: { tabTitle: 'New User' } });
  };

  const handleEdit = (company) => {
    const companyId = company?.id || company?._id;
    if (!companyId) {
      toast.error('Unable to open company details for editing.', { duration: 3000 });
      return;
    }

    navigate(`/add-company/${companyId}`, {
      state: { tabTitle: 'Company Details' },
    });
  };

  const handleDelete = (id) => {
    setConfirmDialog({
      isOpen: true,
      title: "Delete Company",
      message: "Are you sure you want to delete this company? This action cannot be undone.",
      isDangerous: true,
      onConfirm: () => {
        try {
          dispatch(deleteCompany(id));
          toast.success('Company deleted successfully', { duration: 3000 });
          setConfirmDialog(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
          console.error("Failed to delete company:", error);
          toast.error('Failed to delete company: ' + (error.message || 'Unknown error'), { duration: 3000 });
        }
      },
    });
  };

  const handleLock = (company) => {
    // Toggle company lock status
    toast.info('Lock feature coming soon', { duration: 3000 });
    // TODO: Implement lock/unlock for company status
  };

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-[1400px] px-4 py-5">
        {/* Header and Stats cards remain same */}

        {/* Tabs */}
        <div className="bg-[#0A400C] border border-slate-300 rounded-lg p-1 mb-4">
          <div className="flex gap-1 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => navigate(tab.path)}
                className={`
                  flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-md whitespace-nowrap transition-colors
                  ${activeTab === tab.key 
                    ? 'bg-emerald-700 text-white' 
                    : 'text-gray-200 hover:bg-emerald-700 hover:text-gray-100'
                  }
                `}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {!isSystemAdmin ? (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            System Admin is reserved for Milik Admin only.
          </div>
        ) : (
          <div className="mb-4 rounded-2xl border border-emerald-100 bg-gradient-to-r from-emerald-50 via-white to-orange-50 px-4 py-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <div className="text-sm font-black uppercase tracking-[0.18em] text-emerald-700">System Admin</div>
                <div className="text-lg font-extrabold text-slate-900">Company onboarding starts here</div>
                <div className="text-sm text-slate-600">Create a company, switch into it, then continue setup from Company Setup using the active company context.</div>
              </div>
              <div className="rounded-2xl border border-white bg-white/90 px-4 py-3 shadow-sm">
                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-orange-600">Active company context</div>
                <div className="text-base font-extrabold text-slate-900">{companyName}</div>
              </div>
            </div>
          </div>
        )}

        {/* Tab Content */}
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          {activeTab === "companies" && (
            <div>
              <CompaniesTable 
                companies={companies}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onLock={handleLock}
                onAddCompany={() => navigate('/add-company', { state: { tabTitle: 'New Company' } })}
                isLoading={companiesFetching}
              />
              <div className="mt-3 text-right">
                <ActionButton 
                  icon={<FaPlus />} 
                  label="Add New Company" 
                  variant="primary"
                  onClick={() => navigate('/add-company', { state: { tabTitle: 'New Company' } })}
                />
              </div>
            </div>
          )}

        
          
          {activeTab === "users" && (
      <div>
        
        <UsersTable
          users={users}
          onEdit={handleEditUser}
          onDelete={handleDeleteUser}
          onLock={handleLockUser}
          onAddUser={handleAddUser}
          isLoading={usersFetching}
          selectedCompany={selectedCompanyForUsers}
        />
        <div className="mt-3 text-right">
          <ActionButton
            icon={<FaPlus />}
            label="Add New User"
            variant="primary"
            onClick={handleAddUser}
          />
        </div>
      </div>
    )}
          
          {activeTab === "rights" && (
            <SystemRightsTable />
          )}
          
          {activeTab === "database" && (
            <div className="p-8 text-center text-slate-500">
              <FaDatabase className="text-4xl mx-auto mb-2 text-slate-300" />
              <p>Database management interface coming soon...</p>
            </div>
          )}
          
          {activeTab === "sessions" && (
            <div className="p-8 text-center text-slate-500">
              <FaUserClock className="text-4xl mx-auto mb-2 text-slate-300" />
              <p>Active user sessions monitoring coming soon...</p>
            </div>
          )}
          
          {activeTab === "audit" && (
            <div className="p-8 text-center text-slate-500">
              <FaHistory className="text-4xl mx-auto mb-2 text-slate-300" />
              <p>System audit log coming soon...</p>
            </div>
          )}
        </div>

        {/* Footer note */}
        <div className="mt-4 text-xs text-slate-500 text-right">
          Last updated: {new Date().toLocaleDateString()}
        </div>
      </div>

      {/* Milik Confirm Dialog */}
      <MilikConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmText="Delete"
        cancelText="Cancel"
        isDangerous={confirmDialog.isDangerous}
        onConfirm={() => confirmDialog.onConfirm?.()}
        onCancel={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}
      />
    </DashboardLayout>
  );
}