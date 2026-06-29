import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { selectCurrentUser, selectCurrentCompany } from '../../redux/selectors';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import MetricsGrid from '../../components/Dashboard/MetricsGrid';
import PropertiesOverview from '../../components/Dashboard/PropertiesOverview';
import RecentActivity from '../../components/Dashboard/RecentActivity';
import FinancialOverview from '../../components/Dashboard/FinancialOverview';
import QuickActions from '../../components/Dashboard/QuickActions';
import useSocket from '../../utils/socketService';
import { getProperties } from '../../redux/propertyRedux';
import { getUnits } from '../../redux/unitRedux';
import { getTenants } from '../../redux/tenantsRedux';
import {
  getExpenseProperties,
  getMaintenances,
  getNotifications,
} from '../../redux/apiCalls';
import { adminRequests } from '../../utils/requestMethods';
import './dashboard.css';

// Normalise a Promise.allSettled result into an array, trying multiple response-body shapes
const normalizeArr = (settled, ...keys) => {
  if (settled.status !== 'fulfilled') return [];
  const d = settled.value?.data;
  if (Array.isArray(d)) return d;
  for (const k of keys) if (Array.isArray(d?.[k])) return d[k];
  return [];
};

const Dashboard = ({ darkMode }) => {
  const dispatch = useDispatch();
  const socket = useSocket();
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);

  const [invoices, setInvoices] = useState([]);
  const [summaryData, setSummaryData] = useState({});
  const [operationalLoading, setOperationalLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState(null);

  useEffect(() => { window.scrollTo(0, 0); }, []);

  useEffect(() => {
    const companyFromUser =
      typeof currentUser?.company === 'string'
        ? currentUser.company
        : currentUser?.company?._id;
    const businessId = currentCompany?._id || companyFromUser;
    if (!businessId) return;

    let active = true;

    const loadDashboardData = async () => {
      setOperationalLoading(true);
      setDashboardError(null);

      dispatch(getProperties({ business: businessId, status: 'active', limit: 1000 }));
      dispatch(getUnits({ business: businessId }));
      dispatch(getTenants({ business: businessId }));

      const year = new Date().getFullYear();
      const fromDate = `${year}-01-01`;
      const toDate = `${year}-12-31`;

      try {
        const results = await Promise.allSettled([
          // Current-year active invoices only — enough for the 12-month chart and month tables
          adminRequests.get(`/tenant-invoices?business=${businessId}&includeSnapshots=true&status=ACTIVE&fromDate=${fromDate}&toDate=${toDate}`),
          // Single summary call replaces vouchers + statements + leases fetches
          adminRequests.get('/dashboard/summary'),
          getMaintenances(dispatch, businessId),
          getNotifications(dispatch, businessId),
          getExpenseProperties(dispatch, businessId),
        ]);

        if (!active) return;
        setInvoices(normalizeArr(results[0], 'invoices', 'data'));
        if (results[1].status === 'fulfilled') {
          setSummaryData(results[1].value?.data || {});
        }
      } catch (err) {
        if (active) setDashboardError(err?.response?.data?.message || err?.message || 'Failed to load dashboard data');
      } finally {
        if (active) setOperationalLoading(false);
      }
    };

    loadDashboardData();
    // Socket events (payment:new, maintenance:new, etc.) handle real-time updates — no polling needed
    return () => { active = false; };
  }, [dispatch, currentCompany?._id, currentUser?.company, currentUser?._id]);

  useEffect(() => {
    const companyFromUser =
      typeof currentUser?.company === 'string'
        ? currentUser.company
        : currentUser?.company?._id;
    const businessId = currentCompany?._id || companyFromUser;
    if (!socket || !businessId) return;

    socket.emit('joinCompany', { companyId: businessId, userId: currentUser?._id });

    const handleNewNotification = () => getNotifications(dispatch, businessId);
    const handleNewMaintenance = () => getMaintenances(dispatch, businessId);

    socket.on('notification:new', handleNewNotification);
    socket.on('maintenance:new', handleNewMaintenance);

    return () => {
      socket.off('notification:new', handleNewNotification);
      socket.off('maintenance:new', handleNewMaintenance);
    };
  }, [socket, currentCompany?._id, currentUser?._id, currentUser?.company, dispatch]);

  return (
    <DashboardLayout>
      <div className="flex min-h-0 flex-1 bg-white">
        <div className={`flex-1 overflow-auto px-2 pt-2 pb-3 space-y-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
          {dashboardError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              ⚠ {dashboardError}
            </div>
          )}
          <MetricsGrid darkMode={darkMode} />

          <div className="dashboard-main-grid gap-2">
            <QuickActions
              darkMode={darkMode}
              summaryData={summaryData}
              loading={operationalLoading}
            />
            <PropertiesOverview darkMode={darkMode} invoices={invoices} />
            <FinancialOverview darkMode={darkMode} invoices={invoices} />
          </div>

          <RecentActivity darkMode={darkMode} />
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Dashboard;
