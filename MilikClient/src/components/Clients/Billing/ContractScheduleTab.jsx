// Contract billing schedule grid (one row per line per period) with hold / skip / release —
// the contract counterpart of TenantStatement's billing schedule.
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { FaPause, FaPlay, FaForward, FaSyncAlt } from 'react-icons/fa';
import MilikTable from '../../common/MilikTable';
import ListToolbar from '../../common/ListToolbar';
import { fmtDate } from '../../../utils/dates';
import { contractsApi, apiError } from '../../../services/clientsBillingApi';
import { Chip, ReasonModal, StatusPill, cell, cellLast, numCell, iconBtn } from './BillingUi';
import { money } from './billingShared';

const STATUS_ORDER = ['scheduled', 'invoiced', 'invoicing', 'held', 'skipped', 'cancelled'];

const ContractScheduleTab = ({ contract, schedule, loading, onReload, canEdit }) => {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState('');
  const [action, setAction] = useState(null); // { kind, row }
  const [refreshing, setRefreshing] = useState(false);
  const rows = useMemo(
    () => (schedule?.rows || []).filter((r) => !statusFilter || r.status === statusFilter),
    [schedule, statusFilter],
  );
  const summary = schedule?.summary || {};
  const cur = contract.currency || 'KES';

  const refresh = async () => {
    setRefreshing(true);
    try { await onReload(true); } finally { setRefreshing(false); }
  };

  const run = async (kind, row, reason = '') => {
    try {
      await contractsApi.scheduleAction(contract._id, row._id, kind, reason);
      toast.success(`Period ${kind === 'release' ? 'released' : kind === 'hold' ? 'held' : 'skipped'}`);
      await onReload(false);
      setAction(null);
    } catch (err) {
      toast.error(apiError(err, 'Could not update the period'));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ListToolbar>
        {STATUS_ORDER.filter((s) => summary[s]).map((s) => (
          <Chip key={s} active={statusFilter === s} onClick={() => setStatusFilter(statusFilter === s ? '' : s)} title={`Net ${money(summary[s].net)} · tax ${money(summary[s].tax)}`}>
            <span className="capitalize">{s}</span>: {summary[s].count} · {cur} {money(summary[s].total)}
          </Chip>
        ))}
        {!Object.keys(summary).length && <span className="text-[10px] text-slate-500">No billing periods generated yet{contract.status === 'draft' ? ' — the schedule is built when the contract is activated' : ''}.</span>}
        <ListToolbar.Divider />
        <ListToolbar.Button variant="outline" icon={FaSyncAlt} onClick={refresh} disabled={refreshing}>{refreshing ? 'Rebuilding…' : 'Rebuild schedule'}</ListToolbar.Button>
      </ListToolbar>
      <MilikTable
        columns={[
          { label: 'Item', width: '22%' },
          { label: 'Bills on', width: '10%' },
          { label: 'Service from – to', width: '17%' },
          { label: 'Net', align: 'right', width: '10%' },
          { label: 'Tax', align: 'right', width: '9%' },
          { label: 'Total', align: 'right', width: '10%' },
          { label: 'Status', width: '10%' },
          { label: 'Invoice', width: '12%' },
        ]}
        rows={rows}
        groupBy={(r) => r.periodKey}
        loading={loading && rows.length === 0}
        empty={statusFilter ? `No ${statusFilter} periods.` : 'No billing periods yet.'}
        tableFixed
        minWidth={900}
        actionsWidth="70px"
        renderRow={(r) => (
          <>
            <td className={cell}>
              <span className="block truncate font-semibold text-slate-900">{r.itemName}</span>
              <span className="block truncate text-[10px] text-slate-500">
                {r.quantity} × {money(r.unitPrice)}{r.discountPercent ? ` · −${r.discountPercent}%` : ''}{r.prorationFactor && r.prorationFactor !== 1 ? ` · prorated ${Math.round(r.prorationFactor * 100)}%` : ''}{r.contractVersion ? ` · v${r.contractVersion}` : ''}
              </span>
            </td>
            <td className={`${cell} whitespace-nowrap text-slate-700`}>{fmtDate(r.billingDate)}</td>
            <td className={`${cell} whitespace-nowrap text-slate-700`}>{fmtDate(r.from)} – {fmtDate(r.to)}</td>
            <td className={numCell}>{money(r.netAmount)}</td>
            <td className={numCell}>{money(r.taxAmount)}</td>
            <td className={`${numCell} font-bold text-slate-900`}>{money(r.totalAmount)}</td>
            <td className={cell} title={r.statusReason || ''}>
              <StatusPill status={r.status} />
              {r.statusReason && <span className="block truncate text-[10px] text-slate-500">{r.statusReason}</span>}
            </td>
            <td className={cellLast}>
              {r.invoice ? (
                <button type="button" className="font-bold text-[#0B3B2E] hover:underline" onClick={() => navigate(`/clients/invoices/${r.invoice}`, { state: { tabTitle: r.invoiceNumber || 'Invoice' } })}>{r.invoiceNumber || 'Invoice'}</button>
              ) : <span className="text-slate-400">—</span>}
            </td>
          </>
        )}
        renderActions={(r) => (canEdit ? (
          <div className="flex justify-end gap-0.5">
            {r.status === 'scheduled' && <button type="button" className={iconBtn} title="Hold this period" onClick={() => setAction({ kind: 'hold', row: r })}><FaPause size={11} /></button>}
            {['scheduled', 'held'].includes(r.status) && <button type="button" className={iconBtn} title="Skip — never bill this period" onClick={() => setAction({ kind: 'skip', row: r })}><FaForward size={11} /></button>}
            {['held', 'skipped'].includes(r.status) && <button type="button" className={iconBtn} title="Release — billable again" onClick={() => setAction({ kind: 'release', row: r })}><FaPlay size={11} /></button>}
          </div>
        ) : null)}
      />
      {action && (
        <ReasonModal
          title={`${action.kind === 'hold' ? 'Hold' : action.kind === 'skip' ? 'Skip' : 'Release'} ${action.row.itemName} · ${fmtDate(action.row.from)} – ${fmtDate(action.row.to)}`}
          message={action.kind === 'hold'
            ? 'A held period is not billed until it is released.'
            : action.kind === 'skip'
              ? 'A skipped period is never billed (e.g. a free month). It can be released later.'
              : 'The period becomes billable again on the next billing run.'}
          withReason={action.kind !== 'release'}
          danger={action.kind === 'skip'}
          confirmLabel={action.kind === 'hold' ? 'Hold period' : action.kind === 'skip' ? 'Skip period' : 'Release'}
          onClose={() => setAction(null)}
          onConfirm={(reason) => run(action.kind, action.row, reason)}
        />
      )}
    </div>
  );
};

export default ContractScheduleTab;
