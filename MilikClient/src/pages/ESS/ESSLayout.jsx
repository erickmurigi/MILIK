import { useState, useCallback } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useESS } from '../../context/ESSContext';
import {
  FaTachometerAlt,
  FaFileInvoiceDollar,
  FaCalendarAlt,
  FaEnvelopeOpenText,
  FaUserCircle,
  FaSignOutAlt,
  FaBars,
  FaTimes,
  FaRegClock,
  FaClipboardCheck,
} from 'react-icons/fa';
import './ESS.css';

const NAV_ITEMS = [
  { to: '/ess/dashboard',   label: 'Dashboard',    icon: <FaTachometerAlt /> },
  { to: '/ess/payslips',    label: 'Payslips',     icon: <FaFileInvoiceDollar /> },
  { to: '/ess/leave',       label: 'Leave',        icon: <FaCalendarAlt /> },
  { to: '/ess/attendance',  label: 'Attendance',   icon: <FaRegClock /> },
  { to: '/ess/appraisals',  label: 'Appraisals',   icon: <FaClipboardCheck /> },
  { to: '/ess/letters',     label: 'Letters',      icon: <FaEnvelopeOpenText /> },
  { to: '/ess/profile',     label: 'My Profile',   icon: <FaUserCircle /> },
];

export default function ESSLayout() {
  const navigate  = useNavigate();
  const { employee, company, logout } = useESS();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = useCallback(() => {
    logout();
    navigate('/ess/login', { replace: true });
  }, [logout, navigate]);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  return (
    <div className="ess-layout">
      {/* Mobile overlay */}
      {sidebarOpen && <div className="ess-overlay" onClick={closeSidebar} />}

      {/* Sidebar */}
      <aside className={`ess-sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="ess-sidebar-header">
          <div className="ess-sidebar-logo">
            {employee?.profilePicture
              ? <img src={employee.profilePicture} alt="avatar" className="ess-avatar" />
              : <div className="ess-avatar-placeholder">
                  {employee?.surname?.[0]}{employee?.otherNames?.[0]}
                </div>
            }
            <div className="ess-sidebar-name">
              <strong>{employee?.surname} {employee?.otherNames}</strong>
              <span>{employee?.employeeNumber}</span>
            </div>
          </div>
          {company && <div className="ess-sidebar-company">{company.companyName}</div>}
        </div>

        <nav className="ess-nav">
          {NAV_ITEMS.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `ess-nav-item${isActive ? ' active' : ''}`}
              onClick={closeSidebar}
            >
              {icon}
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <button className="ess-logout-btn" onClick={handleLogout}>
          <FaSignOutAlt />
          <span>Sign Out</span>
        </button>
      </aside>

      {/* Main */}
      <div className="ess-main">
        <header className="ess-topbar">
          <button className="ess-menu-btn" onClick={() => setSidebarOpen((p) => !p)}>
            {sidebarOpen ? <FaTimes /> : <FaBars />}
          </button>
          <div className="ess-topbar-title">Employee Self Service</div>
          <div className="ess-topbar-user">
            {employee?.profilePicture
              ? <img src={employee.profilePicture} alt="" className="ess-avatar-sm" />
              : <div className="ess-avatar-sm-placeholder">
                  {employee?.surname?.[0]}
                </div>
            }
          </div>
        </header>

        <main className="ess-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
