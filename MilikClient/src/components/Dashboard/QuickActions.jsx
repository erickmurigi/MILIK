import React, { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import {
  FaArrowRight,
  FaClipboardList,
  FaExclamationTriangle,
  FaFileAlt,
  FaFileInvoiceDollar,
  FaHome,
  FaReceipt,
  FaTools
} from 'react-icons/fa';
import { adminRequests } from '../../utils/requestMethods';

const QuickActions = ({ darkMode }) => {
  const currentCompany = useSelector(state => state.company?.currentCompany);
  const currentUser = useSelector(state => state.auth?.currentUser);
  const units = useSelector(state => state.unit?.units || []);
  const leases = useSelector(state => state.lease?.leases || []);
  const maintenances = useSelector(state => state.maintenance?.maintenances || []);
  const rentPayments = useSelector(state => state.rentPayment?.rentPayments || []);

  const [invoices, setInvoices] = useState([]);
  const [paymentVouchers, setPaymentVouchers] = useState([]);
  const [processedStatements, setProcessedStatements] = useState([]);
  const [loading, setLoading] = useState(false);

  const businessId = useMemo(() => (
    currentCompany?._id ||
    currentUser?.company?._id ||
    (typeof currentUser?.company === 'string' ? currentUser.company : '')
  ), [currentCompany?._id, currentUser?.company]);

  useEffect(() => {
    let active = true;

    const loadOperationalData = async () => {
      if (!businessId) return;
      setLoading(true);
      try {
        const [invoiceRes, voucherRes, statementRes] = await Promise.allSettled([
          adminRequests.get(`/tenant-invoices?business=${businessId}`),
          adminRequests.get(`/payment-vouchers?business=${businessId}`),
          adminRequests.get(`/processed-statements/business/${businessId}`),
        ]);

        if (!active) return;

        setInvoices(invoiceRes.status === 'fulfilled' && Array.isArray(invoiceRes.value?.data) ? invoiceRes.value.data : []);
        setPaymentVouchers(voucherRes.status === 'fulfilled' && Array.isArray(voucherRes.value?.data) ? voucherRes.value.data : []);
        setProcessedStatements(
          statementRes.status === 'fulfilled' && Array.isArray(statementRes.value?.data?.statements)
            ? statementRes.value.data.statements
            : []
        );
      } finally {
        if (active) setLoading(false);
      }
    };

    loadOperationalData();
    return () => {
      active = false;
    };
  }, [businessId]);

  const today = new Date();
  const in30Days = new Date();
  in30Days.setDate(in30Days.getDate() + 30);

  const overdueInvoices = invoices.filter((invoice) => {
    const dueDate = invoice?.dueDate ? new Date(invoice.dueDate) : null;
    return dueDate && dueDate < today && ['pending', 'partially_paid'].includes(invoice?.status);
  }).length;

  const vacantUnits = units.filter((unit) => unit?.status === 'vacant').length;

  const leasesExpiringSoon = leases.filter((lease) => {
    if (!lease?.endDate) return false;
    const endDate = new Date(lease.endDate);
    const isActive = !lease?.status || lease.status === 'active';
    return isActive && endDate >= today && endDate <= in30Days;
  }).length;

  const unpostedReceipts = rentPayments.filter((payment) => payment?.postingStatus === 'unposted' || payment?.isConfirmed !== true).length;
  const pendingMaintenance = maintenances.filter((item) => item?.status === 'pending').length;
  const pendingStatements = processedStatements.filter((item) => ['processed', 'unpaid', 'part_paid'].includes(item?.status)).length;
  const pendingVoucherApprovals = paymentVouchers.filter((item) => item?.status === 'draft').length;

  const items = [
    { id: 'vacant-units', label: 'Vacant units', value: vacantUnits, icon: <FaHome />, tone: 'green', helper: 'Open inventory reducing occupancy' },
    { id: 'overdue-invoices', label: 'Overdue invoices', value: overdueInvoices, icon: <FaFileInvoiceDollar />, tone: 'orange', helper: 'Collections that need follow-up now' },
    { id: 'leases-expiring', label: 'Leases expiring in 30 days', value: leasesExpiringSoon, icon: <FaFileAlt />, tone: 'blue', helper: 'Renewal attention required soon' },
    { id: 'unposted-receipts', label: 'Unposted receipts', value: unpostedReceipts, icon: <FaReceipt />, tone: 'amber', helper: 'Receipts awaiting posting / confirmation' },
    { id: 'pending-maintenance', label: 'Pending maintenance requests', value: pendingMaintenance, icon: <FaTools />, tone: 'red', helper: 'Operational issues awaiting action' },
    { id: 'pending-statements', label: 'Landlord statements pending processing', value: pendingStatements, icon: <FaClipboardList />, tone: 'purple', helper: 'Statements not fully settled yet' },
    { id: 'pending-vouchers', label: 'Payment vouchers pending approvals', value: pendingVoucherApprovals, icon: <FaExclamationTriangle />, tone: 'slate', helper: 'Draft vouchers still awaiting workflow action' },
  ];

  const getToneClasses = (tone) => {
    const tones = {
      orange: { icon: 'text-[#E85C0D]', badge: 'bg-[#FFF1E8] text-[#C44B0B]', border: 'border-[#F7C9AF]' },
      green: { icon: 'text-[#1f4a35]', badge: 'bg-[#ECF6F1] text-[#1f4a35]', border: 'border-[#CFE4D8]' },
      blue: { icon: 'text-blue-700', badge: 'bg-blue-50 text-blue-700', border: 'border-blue-200' },
      amber: { icon: 'text-amber-700', badge: 'bg-amber-50 text-amber-700', border: 'border-amber-200' },
      red: { icon: 'text-red-700', badge: 'bg-red-50 text-red-700', border: 'border-red-200' },
      purple: { icon: 'text-purple-700', badge: 'bg-purple-50 text-purple-700', border: 'border-purple-200' },
      slate: { icon: 'text-slate-700', badge: 'bg-slate-100 text-slate-700', border: 'border-slate-200' },
    };
    return tones[tone] || tones.green;
  };

  return (
    <div className={`dashboard-panel rounded-xl ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-[#f8faf9] border-[#31694E]/10'} shadow-md border p-4`}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className={`font-extrabold text-sm tracking-tight uppercase ${darkMode ? 'text-white' : 'text-[#1f4a35]'}`}>
            Action Center
          </h3>
          <p className={`mt-1 text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Alerts, exceptions and workflow items that need attention.
          </p>
        </div>
        <div className={`rounded-full px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.16em] ${darkMode ? 'bg-[#31694E]/20 text-[#8bd1b0]' : 'bg-[#ECF6F1] text-[#1f4a35]'}`}>
          {items.filter(item => item.value > 0).length} live alerts
        </div>
      </div>

      <div className="dashboard-scroll-list space-y-2.5 pr-1">
        {items.map((item) => {
          const tone = getToneClasses(item.tone);
          return (
            <div
              key={item.id}
              className={`rounded-xl border p-3 transition-all ${darkMode ? 'border-gray-700 bg-gray-700/30 hover:bg-gray-700/50' : `${tone.border} bg-white hover:shadow-sm`}`}
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl ${darkMode ? 'bg-gray-800' : 'bg-white'} ${tone.icon}`}>
                  {item.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <div className={`text-sm font-bold leading-5 ${darkMode ? 'text-white' : 'text-slate-900'}`}>{item.label}</div>
                    <div className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-extrabold ${darkMode ? 'bg-gray-800 text-white' : tone.badge}`}>
                      {loading ? '...' : item.value}
                    </div>
                  </div>
                  <div className={`mt-1 text-xs ${darkMode ? 'text-gray-400' : 'text-slate-500'}`}>{item.helper}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className={`mt-4 rounded-xl border p-3 ${darkMode ? 'border-gray-700 bg-gray-700/20' : 'border-[#dce9e1] bg-white/90'}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className={`text-[10px] font-extrabold uppercase tracking-[0.18em] ${darkMode ? 'text-gray-400' : 'text-[#4a6b5e]'}`}>Focus today</div>
            <div className={`mt-1 text-sm font-bold ${darkMode ? 'text-white' : 'text-[#1f4a35]'}`}>Collections and pending posting items first.</div>
          </div>
          <FaArrowRight className={darkMode ? 'text-gray-500' : 'text-[#31694E]'} />
        </div>
      </div>
    </div>
  );
};

export default QuickActions;
