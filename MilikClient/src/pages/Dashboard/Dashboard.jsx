import React, { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  selectCurrentUser, selectCurrentCompany,
  selectAllUnits, selectAllTenants, selectAllMaintenances,
  selectAllProperties,
} from '../../redux/selectors';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import MetricsGrid from '../../components/Dashboard/MetricsGrid';
import PropertiesOverview from '../../components/Dashboard/PropertiesOverview';
import FinancialOverview from '../../components/Dashboard/FinancialOverview';
import QuickActions from '../../components/Dashboard/QuickActions';
import RecentActivity from '../../components/Dashboard/RecentActivity';
import { buildTenantsByUnit, buildMaintByUnit } from '../../components/Dashboard/dashboardUtils';
import useSocket from '../../utils/socketService';
import { getProperties } from '../../redux/propertyRedux';
import { getUnits } from '../../redux/unitRedux';
import { getTenants } from '../../redux/tenantsRedux';
import { getExpenseProperties, getMaintenances, getNotifications } from '../../redux/apiCalls';
import { adminRequests } from '../../utils/requestMethods';
import './dashboard.css';

const Dashboard = ({ darkMode }) => {
  const dispatch       = useDispatch();
  const socket         = useSocket();
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser    = useSelector(selectCurrentUser);
  const properties     = useSelector(selectAllProperties);
  const units          = useSelector(selectAllUnits);
  const tenants        = useSelector(selectAllTenants);
  const maintenances   = useSelector(selectAllMaintenances);

  const [summaryData,    setSummaryData]    = useState({});
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState(null);

  useEffect(() => { window.scrollTo(0, 0); }, []);

  useEffect(() => {
    const companyFromUser =
      typeof currentUser?.company === 'string' ? currentUser.company : currentUser?.company?._id;
    const businessId = currentCompany?._id || companyFromUser;
    if (!businessId) return;

    let active = true;

    const load = async () => {
      setSummaryLoading(true);
      setDashboardError(null);

      // ── Phase 1: summary only — renders KPIs, Action Centre, and Financial chart ──
      try {
        const res = await adminRequests.get('/dashboard/summary');
        if (!active) return;
        setSummaryData(res.data || {});
      } catch (err) {
        if (active) setDashboardError(err?.response?.data?.message || err?.message || 'Failed to load dashboard');
      } finally {
        if (active) setSummaryLoading(false);
      }

      // ── Phase 2: entity data (deferred — Portfolio Pulse + Activity) ──
      // Skip Redux dispatches if data is already cached from a prior navigation
      const alreadyCached = properties.length > 0 && units.length > 0 && tenants.length > 0;
      if (!alreadyCached) {
        dispatch(getProperties({ business: businessId, status: 'active', limit: 1000 }));
        dispatch(getUnits({ business: businessId }));
        dispatch(getTenants({ business: businessId }));
      }
      Promise.allSettled([
        getMaintenances(dispatch, businessId),
        getNotifications(dispatch, businessId),
        getExpenseProperties(dispatch, businessId),
      ]);
    };

    load();
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, currentCompany?._id, currentUser?.company, currentUser?._id]);

  useEffect(() => {
    const companyFromUser =
      typeof currentUser?.company === 'string' ? currentUser.company : currentUser?.company?._id;
    const businessId = currentCompany?._id || companyFromUser;
    if (!socket || !businessId) return;
    socket.emit('joinCompany', { companyId: businessId, userId: currentUser?._id });
    const onNotif = () => getNotifications(dispatch, businessId);
    const onMaint = () => getMaintenances(dispatch, businessId);
    socket.on('notification:new', onNotif);
    socket.on('maintenance:new',  onMaint);
    return () => { socket.off('notification:new', onNotif); socket.off('maintenance:new', onMaint); };
  }, [socket, currentCompany?._id, currentUser?._id, currentUser?.company, dispatch]);

  // ── Shared Maps — computed ONCE, passed as stable props to avoid duplicate O(n) builds ──
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const tenantsByUnit = useMemo(() => buildTenantsByUnit(tenants), [tenants]);
  const maintByUnit   = useMemo(() => buildMaintByUnit(maintenances), [maintenances]);

  return (
    <DashboardLayout>
      <div className="flex min-h-0 flex-1 bg-white">
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 pt-2 pb-4 space-y-1.5">

          {dashboardError && (
            <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              ⚠ {dashboardError}
            </div>
          )}

          {/* Row 1 — KPI stat cards (available after Phase 1) */}
          <MetricsGrid summaryData={summaryData} loading={summaryLoading} />

          {/* Row 2 — Financial chart + Portfolio Pulse (left) | Action Centre & Activity (right) */}
          <div className="grid grid-cols-1 items-start gap-1.5 xl:grid-cols-[1fr_320px]">
            <div className="flex min-w-0 flex-col gap-1.5">
              <FinancialOverview summaryData={summaryData} />
              <PropertiesOverview
                summaryData={summaryData}
                tenantsByUnit={tenantsByUnit}
                maintByUnit={maintByUnit}
                today={today}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <QuickActions summaryData={summaryData} loading={summaryLoading} />
              <RecentActivity />
            </div>
          </div>

        </div>
      </div>
    </DashboardLayout>
  );
};

export default Dashboard;
