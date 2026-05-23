import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
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
  getLeases,
  getMaintenances,
  getNotifications,
  getRentPayments
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
  const currentCompany = useSelector(state => state.company?.currentCompany);
  const currentUser = useSelector(state => state.auth?.currentUser);

  const [invoices, setInvoices] = useState([]);
  const [paymentVouchers, setPaymentVouchers] = useState([]);
  const [processedStatements, setProcessedStatements] = useState([]);
  const [operationalLoading, setOperationalLoading] = useState(false);

  useEffect(() => { window.scrollTo(0, 0); }, []);

  useEffect(() => {
    const companyFromUser =
      typeof currentUser?.company === 'string'
        ? currentUser.company
        : currentUser?.company?._id;
    const businessId = currentCompany?._id || companyFromUser;
    if (!businessId) return;

    let active = true;

    const refreshDashboardData = async () => {
      dispatch(getProperties({ business: businessId, status: 'active', limit: 1000 }));
      dispatch(getUnits({ business: businessId }));
      dispatch(getTenants({ business: businessId }));

      setOperationalLoading(true);
      try {
        const results = await Promise.allSettled([
          adminRequests.get(`/tenant-invoices?business=${businessId}&includeSnapshots=true`),
          adminRequests.get(`/payment-vouchers?business=${businessId}`),
          adminRequests.get(`/processed-statements/business/${businessId}`),
          getRentPayments(dispatch, businessId),
          getMaintenances(dispatch, businessId),
          getLeases(dispatch, businessId),
          getNotifications(dispatch, businessId),
          getExpenseProperties(dispatch, businessId),
        ]);

        if (!active) return;
        setInvoices(normalizeArr(results[0], 'invoices', 'data'));
        setPaymentVouchers(normalizeArr(results[1], 'vouchers', 'paymentVouchers', 'data'));
        setProcessedStatements(normalizeArr(results[2], 'statements', 'data'));
      } finally {
        if (active) setOperationalLoading(false);
      }
    };

    refreshDashboardData();
    const intervalId = setInterval(refreshDashboardData, 300000);
    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [dispatch, currentCompany?._id, currentUser?.company]);

  useEffect(() => {
    const companyFromUser =
      typeof currentUser?.company === 'string'
        ? currentUser.company
        : currentUser?.company?._id;
    const businessId = currentCompany?._id || companyFromUser;
    if (!socket || !businessId) return;

    socket.emit('joinCompany', { companyId: businessId, userId: currentUser?._id });

    const handleNewNotification = () => getNotifications(dispatch, businessId);
    const handleNewPayment = () => getRentPayments(dispatch, businessId);
    const handleNewMaintenance = () => getMaintenances(dispatch, businessId);
    const handleNewLease = () => getLeases(dispatch, businessId);

    socket.on('notification:new', handleNewNotification);
    socket.on('payment:new', handleNewPayment);
    socket.on('maintenance:new', handleNewMaintenance);
    socket.on('lease:new', handleNewLease);

    return () => {
      socket.off('notification:new', handleNewNotification);
      socket.off('payment:new', handleNewPayment);
      socket.off('maintenance:new', handleNewMaintenance);
      socket.off('lease:new', handleNewLease);
    };
  }, [socket, currentCompany?._id, currentUser?._id, currentUser?.company, dispatch]);

  return (
    <DashboardLayout>
      <div className="flex min-h-0 flex-1 bg-white">
        <div className={`flex-1 overflow-auto px-2 pt-2 pb-3 space-y-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
          <MetricsGrid darkMode={darkMode} />

          <div className="dashboard-main-grid gap-2">
            <QuickActions
              darkMode={darkMode}
              invoices={invoices}
              paymentVouchers={paymentVouchers}
              processedStatements={processedStatements}
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
