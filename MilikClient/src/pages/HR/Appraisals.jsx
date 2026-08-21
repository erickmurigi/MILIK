import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTabState } from "../../hooks/useTabState";
import {
  FaRedoAlt, FaChevronRight, FaTimes, FaCheck,
  FaClipboardCheck, FaUser, FaBuilding, FaUserTie,
} from 'react-icons/fa';
import AppSelect from "../../components/common/AppSelect";
import PaginationBar from "../../components/PaginationBar";
import DashboardLayout from '../../components/Layout/DashboardLayout';
import MilikConfirmDialog from '../../components/Modals/MilikConfirmDialog';
import { adminRequests } from '../../utils/requestMethods';
import { toast } from 'react-toastify';
import { fmtDate } from '../../utils/dates';
import MilikTable from '../../components/common/MilikTable';

const STATUS_PILL = {
  Pending:    'border-slate-300 bg-slate-50 text-slate-500',
  InProgress: 'border-amber-300 bg-amber-50 text-amber-700',
  Submitted:  'border-emerald-300 bg-emerald-50 text-emerald-700',
};
const DEFAULT_PAGE_SIZE = 25;
const F  = 'h-7 rounded border border-slate-200 bg-white px-2.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]';
const FW = `${F} w-full`;

function MiniBar({ score, maxScore }) {
  const pct   = maxScore > 0 ? Math.min((score / maxScore) * 100, 100) : 0;
  const color = pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-400' : 'bg-rose-400';
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-7 text-right text-[10px] font-semibold tabular-nums text-slate-600">{pct.toFixed(0)}%</span>
    </div>
  );
}

export default function Appraisals() {
  const queryClient = useQueryClient();
  const [cycleId, setCycleId]       = useTabState('/hr/appraisals:cycleId', '');
  const [statusFilter, setStatus]   = useTabState('/hr/appraisals:statusFilter', '');
  const [search, setSearch]         = useTabState('/hr/appraisals:search', '');
  const [page,     setPage]     = useTabState('/hr/appraisals:page', 1);
  const [pageSize, setPageSize] = useTabState('/hr/appraisals:pageSize', DEFAULT_PAGE_SIZE);

  const [selected, setSelected]       = useTabState('/hr/appraisals:selected', null);
  const [scores, setScores]           = useState([]);
  const [notes, setNotes]             = useState('');
  const [empComments, setEmpComments] = useState('');
  const [saving, setSaving]           = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data: cycles = [] } = useQuery({
    queryKey: ['hr-appraisal-cycles-ref'],
    queryFn: () => adminRequests.get('/hr/appraisal-cycles').then((r) => r.data || []),
    staleTime: 5 * 60_000,
  });

  const { data: apprData, isLoading: loading, error, refetch } = useQuery({
    queryKey: ['hr-appraisals', cycleId, statusFilter, search, page, pageSize],
    queryFn: async () => {
      const params = { page, limit: pageSize };
      if (cycleId)      params.cycleId = cycleId;
      if (statusFilter) params.status  = statusFilter;
      if (search)       params.search  = search;
      const res = await adminRequests.get('/hr/appraisals', { params });
      return res.data;
    },
    placeholderData: (prev) => prev,
  });

  useEffect(() => { if (error) toast.error('Failed to load appraisals'); }, [error]);
  useEffect(() => { setPage(1); }, [cycleId, statusFilter, search]);

  const appraisals = apprData?.appraisals ?? [];
  const total = apprData?.total ?? 0;

  const openScoring = async (a) => {
    try {
      const res = await adminRequests.get(`/hr/appraisals/${a._id}`);
      setSelected(res.data);
      setScores(res.data.ratings.map((r) => ({ ...r, score: r.score ?? 0 })));
      setNotes(res.data.reviewerNotes || '');
      setEmpComments(res.data.employeeComments || '');
    } catch { toast.error('Failed to load appraisal'); }
  };
  const closeDrawer = () => { setSelected(null); setScores([]); setNotes(''); setEmpComments(''); };

  const overallPreview = useMemo(
    () => scores.reduce((sum, r) => {
      const pct = r.maxScore > 0 ? (r.score / r.maxScore) * 100 : 0;
      return sum + pct * (r.weight / 100);
    }, 0),
    [scores]
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      await adminRequests.put(`/hr/appraisals/${selected._id}`, { ratings: scores, reviewerNotes: notes, employeeComments: empComments });
      toast.success('Scores saved');
      queryClient.invalidateQueries({ queryKey: ['hr-appraisals'] });
      closeDrawer();
    } catch (err) { toast.error(err.response?.data?.message || 'Save failed'); }
    finally { setSaving(false); }
  };

  const handleSubmit = () => setConfirmOpen(true);

  const doSubmit = async () => {
    setConfirmOpen(false);
    setSubmitting(true);
    try {
      await adminRequests.put(`/hr/appraisals/${selected._id}`, { ratings: scores, reviewerNotes: notes, employeeComments: empComments });
      await adminRequests.post(`/hr/appraisals/${selected._id}/submit`);
      toast.success('Appraisal submitted');
      queryClient.invalidateQueries({ queryKey: ['hr-appraisals'] });
      closeDrawer();
    } catch (err) { toast.error(err.response?.data?.message || 'Submit failed'); }
    finally { setSubmitting(false); }
  };

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);
  const nPending   = useMemo(() => appraisals.filter((a) => a.status === 'Pending').length,    [appraisals]);
  const nInProg    = useMemo(() => appraisals.filter((a) => a.status === 'InProgress').length, [appraisals]);
  const nSubmitted = useMemo(() => appraisals.filter((a) => a.status === 'Submitted').length,  [appraisals]);
  const disabled   = useMemo(() => selected?.status === 'Submitted', [selected]);
  const barOk      = useMemo(() => overallPreview >= 80 ? 'bg-emerald-500' : overallPreview >= 60 ? 'bg-amber-400' : 'bg-rose-400',   [overallPreview]);
  const scoreOk    = useMemo(() => overallPreview >= 80 ? 'text-emerald-600' : overallPreview >= 60 ? 'text-amber-600' : 'text-rose-500', [overallPreview]);

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full flex-col overflow-hidden">

        {/* ── Top bar ── */}
        <div className="flex flex-none items-center justify-between border-b border-slate-200 bg-white px-3 py-2">
          <div>
            <h1 className="text-[11px] font-extrabold uppercase tracking-widest text-[#0B3B2E]">Employee Appraisals</h1>
            <p className="text-[10px] text-slate-400 leading-tight">Score and submit performance appraisals per review cycle</p>
          </div>
          <button onClick={refetch} className="flex h-7 items-center gap-1 rounded border border-slate-200 px-2.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-50">
            <FaRedoAlt size={9} /> Refresh
          </button>
        </div>

        {/* ── Filter + stat bar ── */}
        <div className="flex flex-none items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-1.5">
          {cycleId && (
            <>
              <span className="text-[11px] font-bold text-slate-600 tabular-nums whitespace-nowrap">{total} <span className="font-normal text-slate-400">total</span></span>
              <span className="text-[11px] font-bold text-slate-400 tabular-nums whitespace-nowrap">{nPending} <span className="font-normal">pending</span></span>
              <span className="text-[11px] font-bold text-amber-600 tabular-nums whitespace-nowrap">{nInProg} <span className="font-normal text-slate-400">in progress</span></span>
              <span className="text-[11px] font-bold text-emerald-600 tabular-nums whitespace-nowrap">{nSubmitted} <span className="font-normal text-slate-400">submitted</span></span>
              {total > 0 && <span className="text-[11px] font-bold text-[#0B3B2E] tabular-nums whitespace-nowrap">{Math.round((nSubmitted / total) * 100)}% <span className="font-normal text-slate-400">done</span></span>}
              <div className="h-4 w-px bg-slate-300 mx-0.5" />
            </>
          )}
          <AppSelect
            value={cycleId}
            onChange={(v) => setCycleId(v ?? '')}
            options={cycles.map((c) => ({ value: c._id, label: `${c.name} (${c.year})` }))}
            placeholder="Select a cycle…"
            searchable
            clearable
            size="sm"
          />
          <AppSelect
            value={statusFilter}
            onChange={(v) => setStatus(v ?? '')}
            options={[
              { value: 'Pending', label: 'Pending' },
              { value: 'InProgress', label: 'In Progress' },
              { value: 'Submitted', label: 'Submitted' },
            ]}
            placeholder="All statuses"
            clearable
            size="sm"
          />
          <input className={`${F} w-40`} placeholder="Search employee…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {(cycleId || statusFilter || search) && (
            <button onClick={() => { setCycleId(''); setStatus(''); setSearch(''); }} className="flex h-7 items-center gap-0.5 rounded border border-slate-200 bg-white px-2 text-[10px] text-slate-400 hover:text-slate-600">
              <FaTimes size={8} /> Clear
            </button>
          )}
          <span className="ml-auto text-[10px] text-slate-400 whitespace-nowrap tabular-nums">
            {total} record{total !== 1 ? 's' : ''}
            {totalPages > 1 && ` · p${page}/${totalPages}`}
          </span>
        </div>

        {/* ── Table ── */}
        <MilikTable
          columns={[
            { label: '#', width: '2rem' },
            { label: 'Employee' },
            { label: 'Department', width: '9rem' },
            { label: 'Designation', width: '10rem' },
            { label: 'Cycle', width: '11rem' },
            { label: 'Score', align: 'center', width: '7rem' },
            { label: 'Status', align: 'center', width: '6rem' },
            { label: 'Submitted', align: 'center', width: '6rem' },
          ]}
          rows={appraisals}
          loading={loading}
          empty={cycleId ? 'No appraisals match the selected filters.' : 'Select a cycle above to view employee appraisals.'}
          onRowClick={openScoring}
          renderRow={(a, idx) => (
            <>
              <td className="px-3 py-1 text-slate-400 tabular-nums border-r border-gray-100">{(page - 1) * pageSize + idx + 1}</td>
              <td className="px-3 py-1 border-r border-gray-100">
                <span className="font-semibold text-slate-800">{a.snapshot.name}</span>
                <span className="ml-1.5 text-[10px] text-slate-400 tabular-nums">{a.snapshot.employeeNumber}</span>
              </td>
              <td className="px-3 py-1 text-slate-600 border-r border-gray-100">{a.snapshot.department || '—'}</td>
              <td className="px-3 py-1 text-slate-500 border-r border-gray-100">{a.snapshot.designation || '—'}</td>
              <td className="px-3 py-1 text-slate-600 border-r border-gray-100">
                {a.cycle?.name} <span className="text-slate-400">({a.cycle?.year})</span>
              </td>
              <td className="px-3 py-1 border-r border-gray-100"><div className="flex justify-center"><MiniBar score={a.overallScore} maxScore={100} /></div></td>
              <td className="px-3 py-1 text-center border-r border-gray-100">
                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${STATUS_PILL[a.status]}`}>
                  {a.status === 'InProgress' ? 'In Progress' : a.status}
                </span>
              </td>
              <td className="px-3 py-1 text-center text-[10px] text-slate-400 tabular-nums border-r border-gray-100">{fmtDate(a.submittedAt)}</td>
            </>
          )}
          renderActions={() => <FaChevronRight size={8} className="text-slate-300" />}
        />

        {/* ── Pagination ── */}
        <PaginationBar
          page={page}
          pages={totalPages}
          total={total}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
          loading={loading}
          label="appraisals"
        />
      </div>

      {/* ── Scoring Drawer ── */}
      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onClick={closeDrawer}>
          <div className="flex h-full w-full max-w-sm flex-col bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>

            <div className="flex-none border-b border-[#0B3B2E]/20 bg-[#0B3B2E] px-4 py-3 text-white">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest opacity-60">Appraisal Sheet</p>
                  <h2 className="mt-0.5 text-sm font-black">{selected.snapshot.name}</h2>
                  <p className="text-[10px] opacity-70">{selected.cycle?.name} · {selected.cycle?.year}</p>
                </div>
                <button onClick={closeDrawer} className="text-white/60 hover:text-white"><FaTimes size={15} /></button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2.5 text-[10px] opacity-60">
                <span className="flex items-center gap-1"><FaUser size={8} /> {selected.snapshot.employeeNumber || '—'}</span>
                {selected.snapshot.department  && <span className="flex items-center gap-1"><FaBuilding size={8} /> {selected.snapshot.department}</span>}
                {selected.snapshot.designation && <span className="flex items-center gap-1"><FaUserTie size={8} /> {selected.snapshot.designation}</span>}
              </div>
            </div>

            <div className="flex-none flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Overall Score</span>
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-200">
                  <div className={`h-full rounded-full transition-all ${barOk}`} style={{ width: `${Math.min(overallPreview, 100)}%` }} />
                </div>
                <span className={`text-sm font-black tabular-nums ${scoreOk}`}>{overallPreview.toFixed(1)}%</span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
              {disabled && (
                <div className="flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-700">
                  <FaClipboardCheck size={11} /> Submitted and locked.
                </div>
              )}
              {scores.map((r, idx) => {
                const pct = r.maxScore > 0 ? Math.min((r.score / r.maxScore) * 100, 100) : 0;
                const bc  = pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-400' : 'bg-rose-400';
                return (
                  <div key={r.kpi?._id || idx} className="rounded border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-bold text-slate-800 leading-tight">{r.kpiName}</p>
                        <p className="text-[10px] text-slate-400">Weight {r.weight}% · Max {r.maxScore}</p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <input
                          type="number" min={0} max={r.maxScore} disabled={disabled}
                          className="h-7 w-14 rounded border border-slate-200 px-1 text-center text-xs font-bold tabular-nums focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] disabled:bg-slate-50 disabled:text-slate-400"
                          value={r.score}
                          onChange={(e) => {
                            const v = Math.min(Math.max(0, Number(e.target.value)), r.maxScore);
                            setScores((p) => p.map((s, i) => i === idx ? { ...s, score: v } : s));
                          }}
                        />
                        <span className="text-[10px] text-slate-400">/{r.maxScore}</span>
                      </div>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 mb-0.5">
                      <div className={`h-full rounded-full transition-all ${bc}`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex items-center justify-between">
                      <textarea rows={1} placeholder="KPI notes…" disabled={disabled}
                        className="flex-1 resize-none rounded border border-slate-100 bg-slate-50 px-2 py-1 text-[10px] text-slate-600 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] disabled:text-slate-400 mr-2"
                        value={r.notes || ''} onChange={(e) => setScores((p) => p.map((s, i) => i === idx ? { ...s, notes: e.target.value } : s))} />
                      <span className="text-[10px] text-slate-400 whitespace-nowrap">+{(pct * r.weight / 100).toFixed(1)}pts</span>
                    </div>
                  </div>
                );
              })}

              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Reviewer Notes</label>
                <textarea rows={2} disabled={disabled}
                  className="w-full resize-none rounded border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] disabled:bg-slate-50 disabled:text-slate-400"
                  value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Overall reviewer comments…" />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Employee Comments</label>
                <textarea rows={2} disabled={disabled}
                  className="w-full resize-none rounded border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] disabled:bg-slate-50 disabled:text-slate-400"
                  value={empComments} onChange={(e) => setEmpComments(e.target.value)} placeholder="Employee self-assessment…" />
              </div>
            </div>

            {!disabled && (
              <div className="flex-none flex items-center justify-end gap-1.5 border-t border-slate-100 bg-slate-50 px-4 py-2.5">
                <button onClick={closeDrawer} className="h-7 rounded border border-slate-200 px-3 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
                <button onClick={handleSave} disabled={saving || submitting}
                  className="h-7 rounded border border-[#0B3B2E] px-3 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white disabled:opacity-50 transition-colors">
                  {saving ? 'Saving…' : 'Save Draft'}
                </button>
                <button onClick={handleSubmit} disabled={saving || submitting}
                  className="flex h-7 items-center gap-1 rounded bg-[#0B3B2E] px-3 text-[11px] font-bold text-white hover:bg-[#0a3127] disabled:opacity-50">
                  <FaCheck size={9} /> {submitting ? 'Submitting…' : 'Submit'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <MilikConfirmDialog
        isOpen={confirmOpen}
        title="Submit Appraisal"
        message="Once submitted, this appraisal will be locked and cannot be edited. Continue?"
        confirmText="Submit"
        cancelText="Cancel"
        isDangerous={false}
        onConfirm={doSubmit}
        onCancel={() => setConfirmOpen(false)}
      />
    </DashboardLayout>
  );
}
