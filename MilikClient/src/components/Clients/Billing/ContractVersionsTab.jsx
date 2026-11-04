// Contract version timeline: every amendment / escalation / renewal with its field and line diffs;
// pending amendments can be approved or rejected here.
import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import Spinner from '../../common/Spinner';
import { fmtDate, fmtDateTime } from '../../../utils/dates';
import { contractsApi, apiError } from '../../../services/clientsBillingApi';
import { ReasonModal, StatusPill, EmptyNote, barOk, barDanger } from './BillingUi';
import { money, userName } from './billingShared';

const MONEY_FIELDS = new Set(['unitPrice', 'depositAmount']);
const DATE_FIELDS = new Set(['startDate', 'endDate']);
const fmtValue = (field, v) => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (DATE_FIELDS.has(field)) return fmtDate(v);
  if (MONEY_FIELDS.has(field)) return money(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v).replace(/_/g, ' ');
};
const fieldLabel = (f) => String(f).replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

const DiffTable = ({ changes }) => (
  <table className="w-full text-[11px]">
    <tbody className="divide-y divide-slate-100">
      {changes.map((c) => (
        <tr key={c.field}>
          <td className="w-1/3 px-2 py-0.5 font-semibold text-slate-700">{fieldLabel(c.field)}</td>
          <td className="px-2 py-0.5 text-slate-500 line-through">{fmtValue(c.field, c.from)}</td>
          <td className="px-2 py-0.5 font-semibold text-slate-900">{fmtValue(c.field, c.to)}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

const LINE_TONE = { added: 'text-emerald-700', removed: 'text-red-700', modified: 'text-amber-700' };

const ContractVersionsTab = ({ contract, canApprove, onChanged }) => {
  const [versions, setVersions] = useState(null);
  const [tick, setTick] = useState(0);
  const [rejecting, setRejecting] = useState(null);
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    let alive = true;
    contractsApi.versions(contract._id)
      .then((res) => { if (alive) setVersions(res.data?.versions || res.data?.data || []); })
      .catch((err) => { if (alive) { setVersions([]); toast.error(apiError(err, 'Could not load versions')); } });
    return () => { alive = false; };
  }, [contract._id, contract.version, tick]);

  const approve = async (v) => {
    setBusyId(v._id);
    try {
      await contractsApi.approveVersion(contract._id, v._id);
      toast.success(`Version ${v.version} approved and applied`);
      setTick((t) => t + 1);
      onChanged();
    } catch (err) {
      toast.error(apiError(err, 'Could not approve the amendment'));
    } finally {
      setBusyId('');
    }
  };

  if (!versions) return <div className="flex items-center justify-center gap-2 py-10 text-slate-400"><Spinner size="sm" /><span className="text-xs font-semibold">Loading versions…</span></div>;
  if (!versions.length) return <EmptyNote>No versions yet — version 1 is recorded when the contract is activated.</EmptyNote>;

  return (
    <div className="flex-1 overflow-y-auto p-3">
      <ol className="relative ml-2 border-l-2 border-slate-200">
        {versions.map((v) => (
          <li key={v._id} className="relative mb-3 ml-4">
            <span className={`absolute -left-[23px] top-1 h-3 w-3 border-2 border-white ${v.status === 'pending_approval' ? 'bg-amber-500' : v.status === 'rejected' ? 'bg-red-500' : v.status === 'applied' ? 'bg-[#0B3B2E]' : 'bg-slate-400'}`} />
            <div className="border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5">
                <span className="text-xs font-black text-slate-900">v{v.version}</span>
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{v.versionType}</span>
                <StatusPill status={v.status} />
                <span className="text-[11px] text-slate-700">Effective <b>{fmtDate(v.effectiveDate)}</b></span>
                <span className="ml-auto text-[10px] text-slate-500">
                  {userName(v.createdBy) || 'System'} · {fmtDateTime(v.createdAt)}
                  {v.approvedBy && v.status !== 'pending_approval' ? ` · approved by ${userName(v.approvedBy)}` : ''}
                </span>
              </div>
              <div className="space-y-1.5 px-3 py-2">
                <p className="text-xs font-semibold text-slate-900">{v.changeSummary || '—'}</p>
                {v.rejectionReason && <p className="text-[11px] text-red-700">Rejected: {v.rejectionReason}</p>}
                {v.fieldChanges?.length > 0 && <DiffTable changes={v.fieldChanges} />}
                {v.lineDiffs?.length > 0 && (
                  <div className="space-y-1">
                    {v.lineDiffs.map((d) => (
                      <div key={`${d.lineKey}-${d.change}`} className="border border-slate-100">
                        <p className="bg-slate-50 px-2 py-0.5 text-[11px]">
                          <span className={`font-black uppercase ${LINE_TONE[d.change] || ''}`}>{d.change}</span> <span className="font-semibold text-slate-900">{d.itemName}</span>
                        </p>
                        {d.fields?.length > 0 && <DiffTable changes={d.fields} />}
                      </div>
                    ))}
                  </div>
                )}
                {v.status === 'pending_approval' && canApprove && (
                  <div className="flex gap-1.5 pt-1">
                    <button type="button" className={barOk} disabled={busyId === v._id} onClick={() => approve(v)}>{busyId === v._id ? 'Approving…' : 'Approve & apply'}</button>
                    <button type="button" className={barDanger} disabled={busyId === v._id} onClick={() => setRejecting(v)}>Reject</button>
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
      {rejecting && (
        <ReasonModal
          title={`Reject amendment v${rejecting.version}`}
          message="The contract stays on its current terms."
          confirmLabel="Reject amendment"
          onClose={() => setRejecting(null)}
          onConfirm={async (reason) => {
            try {
              await contractsApi.rejectVersion(contract._id, rejecting._id, reason);
              toast.success('Amendment rejected');
              setRejecting(null);
              setTick((t) => t + 1);
              onChanged();
            } catch (err) {
              toast.error(apiError(err, 'Could not reject the amendment'));
            }
          }}
        />
      )}
    </div>
  );
};

export default ContractVersionsTab;
