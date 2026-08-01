import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { useSelector } from 'react-redux';
import useDebounce from '../../hooks/useDebounce';
import { useTabState } from "../../hooks/useTabState";
import {
  FaPlus, FaSearch, FaPrint, FaTrash, FaCheck, FaFileAlt,
  FaRedoAlt, FaChevronRight, FaTimes, FaArrowLeft, FaEnvelope, FaBan,
} from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import PrintLetterhead from '../../components/HR/PrintLetterhead';
import EmailSendModal from '../../components/HR/EmailSendModal';
import { selectCurrentUser } from '../../redux/selectors';
import { adminRequests } from '../../utils/requestMethods';
import { toast } from 'react-toastify';
import AppSelect from "../../components/common/AppSelect";

const STATUS_STYLE = {
  draft:   'bg-slate-100 text-slate-600',
  issued:  'bg-emerald-100 text-emerald-700',
  revoked: 'bg-rose-100 text-rose-700',
};

const TYPE_LABELS = {
  offer: 'Offer Letter', appointment: 'Appointment', confirmation: 'Confirmation',
  increment: 'Salary Increment', promotion: 'Promotion',
  warning_1: '1st Warning', warning_2: '2nd Warning', final_warning: 'Final Warning',
  termination: 'Termination', reference: 'Reference Letter',
  suspension: 'Suspension', reinstatement: 'Reinstatement',
  redundancy: 'Redundancy', custom: 'Custom Letter',
};

const TYPE_COLOR = {
  offer: 'text-emerald-700', appointment: 'text-emerald-700', confirmation: 'text-blue-600',
  increment: 'text-blue-600', promotion: 'text-purple-600',
  warning_1: 'text-amber-600', warning_2: 'text-orange-600', final_warning: 'text-rose-600',
  termination: 'text-rose-700', reference: 'text-slate-600',
  suspension: 'text-orange-600', reinstatement: 'text-teal-600',
  redundancy: 'text-rose-600', custom: 'text-slate-600',
};

// ── Compose modal ─────────────────────────────────────────────────────────────
function ComposeModal({ employees, letterMeta, onClose, onCreate }) {
  const [step, setStep]         = useState(1);   // 1=type, 2=employee, 3=fields, 4=preview
  const [letterType, setLetterType] = useState('');
  const [employeeId, setEmpId]  = useState('');
  const [empSearch, setEmpSearch] = useState('');
  const [fields, setFields]     = useState({});
  const [saving, setSaving]     = useState(false);

  const meta = useMemo(() => letterMeta[letterType], [letterMeta, letterType]);

  const filteredEmps = useMemo(() => {
    const q = empSearch.toLowerCase();
    if (!q) return employees;
    return employees.filter((e) =>
      `${e.surname} ${e.otherNames}`.toLowerCase().includes(q)
      || (e.employeeNumber || '').toLowerCase().includes(q)
    );
  }, [employees, empSearch]);

  const handleCreate = async () => {
    setSaving(true);
    try {
      const res = await adminRequests.post('/hr/letters', {
        employeeId, letterType, metadata: fields,
      });
      onCreate(res.data);
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to create letter');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex-shrink-0 flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-emerald-700">New HR Letter</div>
            <h2 className="text-sm font-black text-slate-900">
              {step === 1 ? 'Choose Letter Type' : step === 2 ? 'Select Employee' : step === 3 ? 'Letter Details' : 'Confirm & Create'}
            </h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><FaTimes size={12} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {/* Step 1 — Letter type */}
          {step === 1 && (
            <div className="space-y-2">
              {Object.entries(TYPE_LABELS).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => { setLetterType(key); setStep(2); }}
                  className="w-full flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left hover:border-[#0B3B2E] hover:bg-emerald-50 transition-colors"
                >
                  <div>
                    <div className={`text-xs font-black ${TYPE_COLOR[key] || 'text-slate-700'}`}>{label}</div>
                    {letterMeta[key] && (
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {letterMeta[key].fields.filter((f) => f.required).map((f) => f.label).join(' · ')}
                      </div>
                    )}
                  </div>
                  <FaChevronRight size={10} className="text-slate-300" />
                </button>
              ))}
            </div>
          )}

          {/* Step 2 — Employee */}
          {step === 2 && (
            <div className="space-y-3">
              <div className="relative">
                <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={10} />
                <input
                  value={empSearch}
                  onChange={(e) => setEmpSearch(e.target.value)}
                  placeholder="Search employee…"
                  autoFocus
                  className="h-8 w-full rounded border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                />
              </div>
              <div className="divide-y divide-slate-50 rounded-xl border border-slate-200 overflow-hidden max-h-64 overflow-y-auto">
                {filteredEmps.map((e) => (
                  <button
                    key={e._id}
                    onClick={() => { setEmpId(e._id); setStep(meta?.fields?.length ? 3 : 4); }}
                    className={`w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-slate-50 ${employeeId === e._id ? 'bg-emerald-50' : ''}`}
                  >
                    <div>
                      <div className="text-xs font-black text-slate-900">{e.surname} {e.otherNames}</div>
                      <div className="text-[10px] text-slate-400">{e.employeeNumber} · {e.department?.name || '—'}</div>
                    </div>
                    {employeeId === e._id && <FaCheck size={10} className="text-emerald-600" />}
                  </button>
                ))}
                {filteredEmps.length === 0 && (
                  <div className="px-4 py-6 text-center text-xs text-slate-400">No employees found</div>
                )}
              </div>
            </div>
          )}

          {/* Step 3 — Fields */}
          {step === 3 && meta && (
            <div className="space-y-4">
              {meta.fields.map((f) => (
                <div key={f.key}>
                  <label className="mb-0.5 block text-xs font-semibold text-slate-700">
                    {f.label}{f.required && <span className="text-red-500 ml-0.5">*</span>}
                  </label>
                  {f.type === 'textarea' ? (
                    <textarea
                      rows={3}
                      value={fields[f.key] ?? (f.default || '')}
                      onChange={(e) => setFields((p) => ({ ...p, [f.key]: e.target.value }))}
                      className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20 resize-none"
                    />
                  ) : f.type === 'select' ? (
                    <AppSelect
                      value={fields[f.key] ?? (f.default || '')}
                      onChange={(v) => setFields((p) => ({ ...p, [f.key]: v ?? '' }))}
                      options={(f.options || []).map((o) => ({ value: o, label: o }))}
                      size="md"
                    />
                  ) : (
                    <input
                      type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                      value={fields[f.key] ?? (f.default || '')}
                      onChange={(e) => setFields((p) => ({ ...p, [f.key]: e.target.value }))}
                      className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Step 4 — Confirm */}
          {step === 4 && (
            <div className="space-y-4">
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-2">
                <div>
                  <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Letter Type</div>
                  <div className={`text-sm font-black ${TYPE_COLOR[letterType] || 'text-slate-900'}`}>{TYPE_LABELS[letterType]}</div>
                </div>
                <div>
                  <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Employee</div>
                  <div className="text-sm font-black text-slate-900">
                    {employees.find((e) => e._id === employeeId)?.surname} {employees.find((e) => e._id === employeeId)?.otherNames}
                  </div>
                </div>
                {Object.entries(fields).filter(([, v]) => v).map(([k, v]) => (
                  <div key={k}>
                    <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">{k}</div>
                    <div className="text-xs text-slate-700">{String(v)}</div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-500">A draft letter will be generated from the template. You can edit it before issuing.</p>
            </div>
          )}
        </div>

        {/* Footer nav */}
        <div className="flex-shrink-0 flex items-center justify-between border-t border-slate-100 px-5 py-3 bg-slate-50">
          <button
            onClick={() => step > 1 ? setStep((s) => s - 1) : onClose()}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900"
          >
            <FaArrowLeft size={9} /> {step > 1 ? 'Back' : 'Cancel'}
          </button>
          {step < 4 ? (
            <button
              onClick={() => step === 3 ? setStep(4) : null}
              disabled={step === 3 && !employeeId}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60"
              style={{ display: step === 3 ? 'inline-flex' : 'none' }}
            >
              Preview <FaChevronRight size={9} />
            </button>
          ) : (
            <button
              onClick={handleCreate}
              disabled={saving || !employeeId || !letterType}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60"
            >
              {saving ? 'Creating…' : 'Create Letter'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const LIMIT = 25;

// ── Main page ─────────────────────────────────────────────────────────────────
export default function HRLetters() {
  const [letters, setLetters]       = useState([]);
  const [employees, setEmployees]   = useState([]);
  const [letterMeta, setLetterMeta] = useState({});
  const [selected, setSelected]     = useTabState('/hr/letters:selected', null);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useTabState('/hr/letters:search', '');
  const [filterType, setFilterType] = useTabState('/hr/letters:filterType', '');
  const [filterStatus, setFilterStatus] = useTabState('/hr/letters:filterStatus', '');
  const [page, setPage]             = useTabState('/hr/letters:page', 1);
  const [total, setTotal]           = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [showCompose, setShowCompose] = useState(false);
  const [issuing, setIssuing]       = useState(false);
  const [deleting, setDeleting]     = useState(false);
  const [showEmail, setShowEmail]   = useState(false);
  const [revokeDialog, setRevokeDialog] = useState({ isOpen: false, reason: '', busy: false });
  const currentUser = useSelector(selectCurrentUser);
  const printRef = useRef();
  const debouncedSearch = useDebounce(search, 300);

  const printLetter = useCallback(() => {
    if (!selected) return;
    const emp = selected.employee;
    const empName = emp ? `${emp.surname} ${emp.otherNames}` : 'Employee';
    const type = TYPE_LABELS[selected.letterType] || selected.letterType;
    const isIssued = selected.status === 'issued';
    const issuedOn = isIssued
      ? new Date(selected.issuedDate).toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' })
      : '';

    const win = window.open('', '_blank', 'width=840,height=1080');
    if (!win) { toast.error('Allow pop-ups to print letters'); return; }

    win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${type} — ${empName}</title>
  <style>
    @page { size: A4; margin: 16mm 22mm 20mm; }
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; }

    /* ── Print header ── */
    .ph-bar {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      padding-bottom: 10px;
      margin-bottom: 24px;
      border-bottom: 2.5px solid #027333;
    }
    .ph-badge {
      display: inline-block;
      background: #027333;
      color: #fff;
      font-family: Arial, sans-serif;
      font-size: 7pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      padding: 2px 9px;
      border-radius: 20px;
      margin-bottom: 4px;
    }
    .ph-title {
      font-family: Arial, sans-serif;
      font-size: 13pt;
      font-weight: 900;
      color: #0f172a;
      letter-spacing: -0.2px;
      line-height: 1.2;
    }
    .ph-status {
      text-align: right;
      font-family: Arial, sans-serif;
      font-size: 8pt;
      line-height: 1.5;
    }
    .ph-issued {
      display: inline-block;
      border: 1.5px solid #027333;
      color: #027333;
      font-size: 7pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      padding: 2px 8px;
      border-radius: 3px;
    }
    .ph-draft {
      display: inline-block;
      border: 1.5px solid #d97706;
      color: #d97706;
      font-size: 7pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      padding: 2px 8px;
      border-radius: 3px;
    }

    /* ── Footer ── */
    .pf-bar {
      margin-top: 32px;
      padding-top: 8px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      font-family: Arial, sans-serif;
      font-size: 7pt;
      color: #94a3b8;
    }

    @media print {
      html, body { background: #fff; }
    }
  </style>
</head>
<body>
  <div class="ph-bar">
    <div>
      <div class="ph-badge">${type}</div>
      <div class="ph-title">${selected.subject || empName}</div>
    </div>
    <div class="ph-status">
      ${isIssued
        ? `<span class="ph-issued">Issued</span><br><span style="color:#64748b">${issuedOn}</span>`
        : '<span class="ph-draft">Draft — Not Issued</span>'}
    </div>
  </div>

  ${DOMPurify.sanitize(selected.body || '')}

  <div class="pf-bar">
    <span>Private &amp; Confidential</span>
    <span>${empName}</span>
    <span>Printed ${new Date().toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
  </div>
</body>
</html>`);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  }, [selected]);

  const loadLetters = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: LIMIT };
      if (filterType)     params.letterType = filterType;
      if (filterStatus)   params.status     = filterStatus;
      if (debouncedSearch) params.search    = debouncedSearch;
      const res = await adminRequests.get('/hr/letters', { params });
      setLetters(res.data.letters || []);
      setTotal(res.data.total || 0);
      setTotalPages(res.data.pages || 1);
    } catch (e) {
      toast.error('Failed to load letters');
    } finally {
      setLoading(false);
    }
  }, [filterType, filterStatus, page, debouncedSearch]);

  useEffect(() => { loadLetters(); }, [loadLetters]);
  useEffect(() => { setPage(1); }, [filterType, filterStatus, debouncedSearch]);

  useEffect(() => {
    Promise.all([
      adminRequests.get('/hr/reports/employees-list'),
      adminRequests.get('/hr/letters/meta'),
    ]).then(([empRes, metaRes]) => {
      setEmployees(empRes.data || []);
      setLetterMeta(metaRes.data || {});
    }).catch(() => {});
  }, []);

  const loadLetter = async (id) => {
    try {
      const res = await adminRequests.get(`/hr/letters/${id}`);
      setSelected(res.data);
    } catch (e) {
      toast.error('Failed to load letter');
    }
  };

  const handleIssue = async () => {
    if (!selected) return;
    setIssuing(true);
    try {
      const res = await adminRequests.patch(`/hr/letters/${selected._id}/issue`);
      setSelected(res.data);
      setLetters((prev) => prev.map((l) => l._id === res.data._id ? { ...l, ...res.data } : l));
      toast.success('Letter issued successfully');
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to issue letter');
    } finally {
      setIssuing(false);
    }
  };

  const doRevoke = async () => {
    setRevokeDialog((d) => ({ ...d, busy: true }));
    try {
      const res = await adminRequests.patch(`/hr/letters/${selected._id}/revoke`, { reason: revokeDialog.reason });
      setSelected(res.data);
      setLetters((prev) => prev.map((l) => l._id === res.data._id ? { ...l, status: 'revoked' } : l));
      toast.success('Letter revoked');
      setRevokeDialog({ isOpen: false, reason: '', busy: false });
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to revoke letter');
      setRevokeDialog((d) => ({ ...d, busy: false }));
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    setDeleting(true);
    try {
      await adminRequests.delete(`/hr/letters/${selected._id}`);
      setLetters((prev) => prev.filter((l) => l._id !== selected._id));
      setSelected(null);
      toast.success('Letter deleted');
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to delete letter');
    } finally {
      setDeleting(false);
    }
  };


  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">

        {/* Header */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-5 py-3 shadow-sm print-hide">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Human Resource</div>
              <h1 className="text-sm font-black text-slate-900 leading-tight">HR Letters &amp; Documents</h1>
            </div>
            <button
              onClick={() => setShowCompose(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#0B3B2E] px-3 py-2 text-xs font-black text-white hover:bg-[#0a2e23]"
            >
              <FaPlus size={9} /> New Letter
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 flex overflow-hidden">

          {/* Sidebar — letter list */}
          <div className="print-hide flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white">
            <div className="flex-shrink-0 space-y-2 border-b border-slate-100 p-3">
              <div className="relative">
                <FaSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={9} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search letters…"
                  className="h-7 w-full rounded border border-slate-200 bg-slate-50 pl-7 pr-3 text-[11px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                />
              </div>
              <div className="flex gap-1.5">
                <AppSelect value={filterType} onChange={(v) => setFilterType(v ?? "")} options={Object.entries(TYPE_LABELS).map(([k, v]) => ({ value: k, label: v }))} placeholder="All types" clearable searchable size="sm" />
                <AppSelect value={filterStatus} onChange={(v) => setFilterStatus(v ?? "")} options={[{ value: "draft", label: "Draft" }, { value: "issued", label: "Issued" }, { value: "revoked", label: "Revoked" }]} placeholder="All" clearable size="sm" />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
              {loading ? (
                <div className="flex h-24 items-center justify-center text-xs text-slate-400">Loading…</div>
              ) : letters.length === 0 ? (
                <div className="flex h-32 flex-col items-center justify-center gap-2 text-slate-300">
                  <FaFileAlt size={20} />
                  <p className="text-xs font-black">No letters found</p>
                </div>
              ) : (
                letters.map((l) => {
                  const emp = l.employee;
                  return (
                    <button
                      key={l._id}
                      onClick={() => loadLetter(l._id)}
                      className={`w-full px-3 py-2.5 text-left hover:bg-slate-50 transition-colors ${selected?._id === l._id ? 'bg-emerald-50 border-l-2 border-emerald-600' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <div className="min-w-0">
                          <div className="text-xs font-black text-slate-900 truncate">
                            {emp ? `${emp.surname} ${emp.otherNames}` : '—'}
                          </div>
                          <div className={`text-[10px] font-semibold truncate ${TYPE_COLOR[l.letterType] || 'text-slate-500'}`}>
                            {TYPE_LABELS[l.letterType] || l.letterType}
                          </div>
                          <div className="text-[9px] text-slate-400 mt-0.5">
                            {new Date(l.createdAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </div>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${STATUS_STYLE[l.status] || ''}`}>
                          {l.status}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Pagination */}
            <div className="flex-shrink-0 flex items-center justify-between border-t border-slate-200 bg-white px-3 py-1.5">
              <span className="text-[10px] text-slate-500">{total} letter{total !== 1 ? 's' : ''}</span>
              <div className="flex items-center gap-1">
                <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-bold disabled:opacity-40 hover:bg-slate-50">‹</button>
                <span className="px-1.5 text-[10px] font-semibold text-slate-600">{page}/{Math.max(1, totalPages)}</span>
                <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-bold disabled:opacity-40 hover:bg-slate-50">›</button>
              </div>
            </div>
          </div>

          {/* Main — letter preview */}
          <div className="min-w-0 flex-1 overflow-y-auto">
            {!selected ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-300">
                <FaFileAlt size={40} />
                <p className="text-sm font-black">Select a letter to preview</p>
                <p className="text-xs text-slate-400">Or create a new letter using the button above</p>
              </div>
            ) : (
              <div className="h-full flex flex-col">
                {/* Letter actions bar */}
                <div className="flex-shrink-0 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-2.5 print-hide">
                  <div>
                    <div className={`text-[10px] font-black uppercase tracking-widest ${TYPE_COLOR[selected.letterType] || 'text-slate-600'}`}>
                      {TYPE_LABELS[selected.letterType]}
                    </div>
                    <div className="text-xs font-black text-slate-900 truncate max-w-xs">{selected.subject}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {selected.status === 'draft' && (
                      <>
                        <button
                          onClick={handleIssue}
                          disabled={issuing}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <FaCheck size={9} /> {issuing ? 'Issuing…' : 'Mark as Issued'}
                        </button>
                        <button
                          onClick={handleDelete}
                          disabled={deleting}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-black text-rose-600 hover:bg-rose-100 disabled:opacity-50"
                        >
                          <FaTrash size={9} /> {deleting ? '…' : 'Delete'}
                        </button>
                      </>
                    )}
                    {selected.status === 'issued' && currentUser?.adminAccess && (
                      <button
                        onClick={() => setRevokeDialog({ isOpen: true, reason: '', busy: false })}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-black text-rose-700 hover:bg-rose-100"
                      >
                        <FaBan size={9} /> Revoke
                      </button>
                    )}
                    <button
                      onClick={() => setShowEmail(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                    >
                      <FaEnvelope size={9} /> Email
                    </button>
                    <button
                      onClick={printLetter}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B3B2E] px-3 py-1.5 text-xs font-black text-white hover:bg-[#0a2e23]"
                    >
                      <FaPrint size={9} /> Print
                    </button>
                  </div>
                </div>

                {/* Rendered letter */}
                <div className="flex-1 overflow-y-auto p-6" ref={printRef}>
                  <div className="employee-print-area mx-auto max-w-2xl">
                    <PrintLetterhead variant="document" docLabel={`HR Letter · ${TYPE_LABELS[selected.letterType] || ''}`} printedDate={false} />
                    <div className="rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden print-card">
                      <div className="bg-[#0B3B2E] px-8 py-4 text-white">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-300">
                              {TYPE_LABELS[selected.letterType]}
                            </div>
                            <div className="text-lg font-black mt-0.5">{selected.subject}</div>
                          </div>
                          <div className="text-right text-emerald-200 text-xs space-y-0.5">
                            <div className={`rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wide ${
                              selected.status === 'issued'  ? 'bg-emerald-400/30 text-emerald-200' :
                              selected.status === 'revoked' ? 'bg-rose-400/30 text-rose-200' :
                              'bg-white/10 text-white/70'
                            }`}>
                              {selected.status === 'issued'  ? `Issued ${new Date(selected.issuedDate).toLocaleDateString('en-KE')}` :
                               selected.status === 'revoked' ? `Revoked` : 'Draft'}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div
                        className="px-8 py-6 text-sm text-slate-800"
                        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(selected.body || '') }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {showEmail && selected && (
        <EmailSendModal
          title="Email Letter"
          defaultEmail={selected.employee?.email || selected.employee?.workEmail || ''}
          onSend={async (email) => {
            try {
              const res = await adminRequests.post(`/hr/emails/letter/${selected._id}`, { email });
              toast.success(`Letter emailed to ${res.data.to}`);
              return res.data;
            } catch (e) {
              toast.error(e?.response?.data?.message || 'Failed to send email');
              throw e;
            }
          }}
          onClose={() => setShowEmail(false)}
        />
      )}
      {showCompose && (
        <ComposeModal
          employees={employees}
          letterMeta={letterMeta}
          onClose={() => setShowCompose(false)}
          onCreate={(letter) => {
            setLetters((prev) => [letter, ...prev]);
            loadLetter(letter._id);
            toast.success('Letter created as draft');
          }}
        />
      )}

      {revokeDialog.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl border border-rose-200 overflow-hidden">
            <div className="flex items-start gap-3 border-b border-rose-100 bg-rose-50 px-5 py-4">
              <FaBan className="mt-0.5 shrink-0 text-rose-600" size={15} />
              <div>
                <div className="text-sm font-black text-rose-800">Revoke Letter</div>
                <div className="text-xs text-rose-600 mt-0.5">
                  This will mark the issued letter as revoked. The record will be retained for audit purposes.
                </div>
              </div>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="text-xs font-black text-slate-700 truncate">{selected?.subject}</div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Reason (optional)</label>
                <textarea
                  rows={3}
                  autoFocus
                  value={revokeDialog.reason}
                  onChange={(e) => setRevokeDialog((d) => ({ ...d, reason: e.target.value }))}
                  placeholder="State the reason for revoking…"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-rose-400 resize-none"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
              <button
                onClick={() => setRevokeDialog({ isOpen: false, reason: '', busy: false })}
                className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={doRevoke}
                disabled={revokeDialog.busy}
                className="px-4 py-2 text-xs font-black text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:opacity-50"
              >
                {revokeDialog.busy ? 'Revoking…' : 'Confirm Revoke'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
