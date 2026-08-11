import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaBuilding, FaFileContract, FaMoneyBillWave, FaChartLine } from 'react-icons/fa';
import ClientsShell from './ClientsShell';
import { clientsApi } from '../../services/clientsApi';
import DashboardCard, { DashboardStatCard } from '../../components/Dashboard/DashboardCard';
import { fmtDate } from '../../utils/dates';
import StatusBadge from '../../components/common/StatusBadge';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtKES = (n) =>
  new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    minimumFractionDigits: 2,
  }).format(Number(n) || 0);

const daysUntil = (d) =>
  Math.ceil((new Date(d) - new Date()) / (1000 * 60 * 60 * 24));

const StatCard = DashboardStatCard;
const Card     = DashboardCard;

const daysColor = (days) => {
  if (days <= 30) return 'text-red-600 font-bold';
  if (days <= 60) return 'text-amber-600 font-semibold';
  return 'text-emerald-700';
};

const CONTRACT_STATUS_MAP = {
  active:     'border-emerald-200 bg-emerald-50 text-emerald-700',
  draft:      'border-slate-200 bg-slate-50 text-slate-600',
  expired:    'border-red-200 bg-red-50 text-red-700',
  terminated: 'border-red-200 bg-red-50 text-red-600',
  renewed:    'border-blue-200 bg-blue-50 text-blue-700',
};

const CLIENT_STATUS_MAP = {
  active:   'border-emerald-200 bg-emerald-50 text-emerald-700',
  inactive: 'border-amber-200 bg-amber-50 text-amber-700',
  churned:  'border-red-200 bg-red-50 text-red-600',
};

// ─── Main component ───────────────────────────────────────────────────────────

const ClientsDashboard = () => {
  const navigate = useNavigate();
  const [loading, setLoading]   = useState(true);
  const [clients, setClients]   = useState([]);
  const [contracts, setContracts] = useState([]);
  const [error, setError]       = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      clientsApi.list({ status: 'active', limit: 8 }),
      clientsApi.listContracts({ expiringDays: 60, limit: 10 }),
    ])
      .then(([clientsRes, contractsRes]) => {
        if (cancelled) return;
        setClients(clientsRes.data?.clients || clientsRes.data?.data || []);
        setContracts(contractsRes.data?.contracts || contractsRes.data?.data || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'Failed to load dashboard');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // ─── Stats computation ────────────────────────────────────────────────────
  const activeClients    = clients.length;
  const expiringCount    = contracts.filter((c) => daysUntil(c.endDate) <= 30).length;
  const monthlyRecurring = contracts
    .filter((c) => c.status === 'active' && (c.billingCycle === 'monthly' || c.billingCycle === 'Monthly'))
    .reduce((sum, c) => sum + Number(c.currentValue || c.baseValue || 0), 0);

  const expiringContracts = [...contracts].sort(
    (a, b) => new Date(a.endDate) - new Date(b.endDate)
  );

  return (
    <ClientsShell
      title="Dashboard"
      action={
        <button
          type="button"
          onClick={() => navigate('/clients')}
          className="inline-flex h-7 items-center gap-1.5 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#027333]"
        >
          All Clients
        </button>
      }
    >
      <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5">

        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        {/* ── Stat cards ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-1.5 xl:grid-cols-4">
          <StatCard
            label="Active Clients"
            value={loading ? '…' : activeClients}
            icon={FaBuilding}
            tone="green"
            sub="currently active"
          />
          <StatCard
            label="Expiring (30 days)"
            value={loading ? '…' : expiringCount}
            icon={FaFileContract}
            tone="orange"
            sub="contracts expiring"
          />
          <StatCard
            label="Monthly Recurring"
            value={loading ? '…' : fmtKES(monthlyRecurring)}
            icon={FaChartLine}
            tone="slate"
            sub="active monthly contracts"
          />
          <div
            role="button"
            tabIndex={0}
            onClick={() => navigate('/clients/invoices')}
            onKeyDown={(e) => e.key === 'Enter' && navigate('/clients/invoices')}
            className="relative overflow-hidden border bg-amber-700 border-amber-700 px-4 py-3 shadow-sm cursor-pointer hover:brightness-110 transition-all"
          >
            <FaMoneyBillWave className="absolute right-3 top-2.5 h-10 w-10 text-white/10" />
            <p className="text-[9px] font-extrabold uppercase tracking-widest text-white/60">Invoices</p>
            <p className="mt-1.5 text-2xl font-black leading-none text-white">All Invoices</p>
            <p className="mt-1 text-[10px] text-white/60 underline">View all invoices →</p>
          </div>
        </div>

        {/* ── Two column area ──────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-1.5 xl:grid-cols-[1fr_360px]">

          {/* Contracts Expiring Soon */}
          <Card
            title="Contracts Expiring Soon (Next 60 Days)"
            right={
              <button
                type="button"
                onClick={() => navigate('/clients/contracts')}
              className="text-[10px] font-extrabold uppercase tracking-wide text-[#0B3B2E] hover:text-[#FF8C00]"
              >
                View All →
              </button>
            }
          >
            {loading ? (
              <div className="py-8 text-center text-xs text-slate-400">Loading…</div>
            ) : !expiringContracts.length ? (
              <div className="py-8 text-center text-xs text-slate-400">
                No contracts expiring in the next 60 days.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] text-xs">
                  <thead>
                    <tr className="bg-[#0B3B2E]">
                      {['Client', 'Contract #', 'Value (KES)', 'Ends On', 'Days Left', 'Status'].map((h) => (
                        <th
                          key={h}
                          className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {expiringContracts.map((c, idx) => {
                      const days = daysUntil(c.endDate);
                      return (
                        <tr
                          key={c._id}
                          className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}`}
                          onClick={() => navigate(`/clients/${c.client?._id || c.client}`)}
                        >
                          <td className="px-3 py-2 font-semibold text-slate-800">
                            {c.client?.name || c.clientName || '—'}
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-[#0B3B2E]">
                            {c.contractNumber || c._id?.slice(-6).toUpperCase() || '—'}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-slate-700">
                            {fmtKES(c.currentValue || c.baseValue)}
                          </td>
                          <td className="px-3 py-2 text-slate-600">{fmtDate(c.endDate)}</td>
                          <td className={`px-3 py-2 tabular-nums ${daysColor(days)}`}>
                            {days < 0 ? `${Math.abs(days)} overdue` : `${days} days`}
                          </td>
                          <td className="px-3 py-2">
                            <StatusBadge status={c.status} map={CONTRACT_STATUS_MAP} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Recent Clients */}
          <Card
            title="Recent Active Clients"
            right={
              <button
                type="button"
                onClick={() => navigate('/clients')}
                className="text-[10px] font-extrabold uppercase tracking-wide text-[#0B3B2E] hover:text-[#FF8C00]"
              >
                View All →
              </button>
            }
          >
            {loading ? (
              <div className="py-8 text-center text-xs text-slate-400">Loading…</div>
            ) : !clients.length ? (
              <div className="py-8 text-center text-xs text-slate-400">No active clients.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {clients.map((cl) => (
                  <div
                    key={cl._id}
                    className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer"
                    onClick={() => navigate(`/clients/${cl._id}`)}
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-800 truncate">{cl.name}</p>
                      <p className="text-[10px] text-slate-400">
                        {cl.clientCode || '—'} &middot; {cl.category || '—'}
                      </p>
                    </div>
                    <StatusBadge status={cl.status} map={CLIENT_STATUS_MAP} />
                  </div>
                ))}
              </div>
            )}
          </Card>

        </div>
      </div>
    </ClientsShell>
  );
};

export default ClientsDashboard;
