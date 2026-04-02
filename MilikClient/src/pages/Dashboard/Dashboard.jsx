import React, { useEffect } from 'react';
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
import './dashboard.css';

const Dashboard = ({ darkMode }) => {
  const dispatch = useDispatch();
  const socket = useSocket();
  const currentCompany = useSelector(state => state.company?.currentCompany);
  const currentUser = useSelector(state => state.auth?.currentUser);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const companyFromUser =
      typeof currentUser?.company === 'string'
        ? currentUser.company
        : currentUser?.company?._id;
    const businessId = currentCompany?._id || companyFromUser;
    if (!businessId) return;

    const refreshDashboardData = async () => {
      dispatch(getProperties({ business: businessId, status: 'active', limit: 1000 }));
      dispatch(getUnits({ business: businessId }));
      dispatch(getTenants({ business: businessId }));

      await Promise.allSettled([
        getRentPayments(dispatch, businessId),
        getMaintenances(dispatch, businessId),
        getLeases(dispatch, businessId),
        getNotifications(dispatch, businessId),
        getExpenseProperties(dispatch, businessId)
      ]);
    };

    refreshDashboardData();
    const intervalId = setInterval(refreshDashboardData, 30000);

    return () => clearInterval(intervalId);
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
      <div className="flex flex-1 bg-white">
        <div className={`flex-1 overflow-auto px-4 pt-3 pb-5 space-y-5 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
          <MetricsGrid darkMode={darkMode} />

          <div className="dashboard-main-grid gap-5">
            <QuickActions darkMode={darkMode} />
            <PropertiesOverview darkMode={darkMode} />
            <FinancialOverview darkMode={darkMode} />
          </div>

          <RecentActivity darkMode={darkMode} />
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Dashboard;
