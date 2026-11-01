import { useState, useCallback } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useLandlordPortal } from '../../context/LandlordPortalContext';
import {
  FaFileInvoiceDollar,
  FaBuilding,
  FaUsers,
  FaSignOutAlt,
  FaBars,
  FaTimes,
} from 'react-icons/fa';
import './LandlordPortal.css';

const NAV_ITEMS = [
  { to: '/landlord-portal/statements', label: 'Statements', icon: <FaFileInvoiceDollar /> },
  { to: '/landlord-portal/units',      label: 'Units',      icon: <FaBuilding /> },
  { to: '/landlord-portal/tenants',    label: 'Tenants',     icon: <FaUsers /> },
];

export default function LandlordPortalLayout() {
  const navigate = useNavigate();
  const { landlord, company, logout } = useLandlordPortal();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = useCallback(() => {
    logout();
    navigate('/landlord-portal/login', { replace: true });
  }, [logout, navigate]);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  return (
    <div className="lp-layout">
      {sidebarOpen && <div className="lp-overlay" onClick={closeSidebar} />}

      <aside className={`lp-sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="lp-sidebar-header">
          <div className="lp-sidebar-logo">
            <div className="lp-avatar-placeholder">{landlord?.landlordName?.[0] || 'L'}</div>
            <div className="lp-sidebar-name">
              <strong>{landlord?.landlordName}</strong>
              <span>{landlord?.landlordCode}</span>
            </div>
          </div>
          {company && <div className="lp-sidebar-company">{company.companyName}</div>}
        </div>

        <nav className="lp-nav">
          {NAV_ITEMS.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `lp-nav-item${isActive ? ' active' : ''}`}
              onClick={closeSidebar}
            >
              {icon}
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <button className="lp-logout-btn" onClick={handleLogout}>
          <FaSignOutAlt />
          <span>Sign Out</span>
        </button>
      </aside>

      <div className="lp-main">
        <header className="lp-topbar">
          <button className="lp-menu-btn" onClick={() => setSidebarOpen((p) => !p)}>
            {sidebarOpen ? <FaTimes /> : <FaBars />}
          </button>
          <div className="lp-topbar-title">Landlord Portal</div>
        </header>

        <main className="lp-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
