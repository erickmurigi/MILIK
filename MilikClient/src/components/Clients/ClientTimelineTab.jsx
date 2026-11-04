// Timeline (interactions) tab — note / call / meeting / email / SMS log for one client.
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import Modal from '../common/Modal';
import { fmtDate } from '../../utils/dates';
import { useConfirm } from '../../context/ConfirmContext';
import { inputClass, labelClass } from '../../utils/formStyles';
import {
  FaCalendar,
  FaEnvelope,
  FaPhone,
  FaSms,
  FaStickyNote,
  FaTrash,
} from 'react-icons/fa';
import { clientsApi } from '../../services/clientsApi';
import PaginationBar from '../PaginationBar';

// ─── Formatting helpers ───────────────────────────────────────────────────────

const btnPrimary =
  'bg-[#0B3B2E] text-white hover:bg-[#0A3127] px-4 py-2 rounded-md text-sm font-semibold disabled:opacity-50';
const btnSecondary =
  'border border-slate-200 text-slate-700 hover:bg-slate-50 px-4 py-2 rounded-md text-sm font-semibold';

// ─── Badge helpers ────────────────────────────────────────────────────────────

// ─── Data constants ───────────────────────────────────────────────────────────

const INTERACTION_TYPES = ['note', 'email', 'call', 'meeting', 'sms'];

// ─── Shared sub-components ────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// TAB: Communications
// ─────────────────────────────────────────────────────────────────────────────

const typeIcon = (type) => {
  const map = { email: FaEnvelope, call: FaPhone, meeting: FaCalendar, note: FaStickyNote, sms: FaSms };
  return map[type] || FaStickyNote;
};

const typeColorCls = (type) => {
  const map = {
    email:   'text-blue-600 bg-blue-50 border-blue-200',
    call:    'text-emerald-700 bg-emerald-50 border-emerald-200',
    meeting: 'text-violet-700 bg-violet-50 border-violet-200',
    note:    'text-amber-700 bg-amber-50 border-amber-200',
    sms:     'text-cyan-700 bg-cyan-50 border-cyan-200',
  };
  return map[type] || 'text-slate-600 bg-slate-50 border-slate-200';
};

const emailStatusCls = (status) => {
  const map = {
    sent:      'text-blue-700 bg-blue-50 border-blue-200',
    delivered: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    failed:    'text-red-600 bg-red-50 border-red-200',
    opened:    'text-violet-700 bg-violet-50 border-violet-200',
  };
  return map[status] || 'text-slate-500 bg-slate-50 border-slate-200';
};

const LogInteractionModal = ({ clientId, defaultType, onClose, onCreated }) => {
  const [form, setForm] = useState({ type: defaultType || 'note', subject: '', body: '' });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (!form.body.trim()) { toast.error('Body / content required'); return; }
    setSaving(true);
    try {
      await clientsApi.createInteraction({
        client:  clientId,
        type:    form.type,
        subject: form.subject.trim() || undefined,
        body:    form.body.trim(),
      });
      toast.success('Interaction logged');
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to log interaction');
    } finally {
      setSaving(false);
    }
  };

  const titles = { note: 'Add Note', email: 'Log Email', call: 'Log Call', meeting: 'Log Meeting', sms: 'Log SMS' };

  return (
    <Modal
      title={titles[form.type] || 'Log Interaction'}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button type="button" onClick={handleSubmit} disabled={saving} className={btnPrimary}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className={labelClass}>Type</label>
          <div className="flex flex-wrap gap-1.5">
            {INTERACTION_TYPES.map((t) => {
              const Icon = typeIcon(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => set('type', t)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded border text-xs font-semibold transition-colors ${
                    form.type === t
                      ? 'bg-[#0B3B2E] text-white border-[#0B3B2E]'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Icon size={9} /> {t}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className={labelClass}>Subject</label>
          <input
            className={inputClass}
            value={form.subject}
            onChange={(e) => set('subject', e.target.value)}
            placeholder="Brief subject / title"
          />
        </div>
        <div>
          <label className={labelClass}>Content *</label>
          <textarea
            className={`${inputClass} resize-none`}
            rows={5}
            value={form.body}
            onChange={(e) => set('body', e.target.value)}
            placeholder="Details…"
          />
        </div>
      </div>
    </Modal>
  );
};

// Sends a real ad-hoc SMS via the shared communicationService (see
// clientsController.sendClientSms) and logs it as an interaction on the
// backend — distinct from LogInteractionModal, which only records that a
// contact happened without actually dispatching anything.
const SendSmsModal = ({ clientId, defaultPhone, onClose, onSent }) => {
  const [phone, setPhone] = useState(defaultPhone || '');
  const [body, setBody]   = useState('');
  const [sending, setSending] = useState(false);

  const handleSubmit = async () => {
    if (!phone.trim()) { toast.error('Phone number required'); return; }
    if (!body.trim())  { toast.error('Message required'); return; }
    setSending(true);
    try {
      const { data } = await clientsApi.sendSms(clientId, { phone: phone.trim(), body: body.trim() });
      if (data?.success === false || (data?.message && /could not be confirmed/i.test(data.message))) {
        toast.warning(data?.message || 'SMS dispatch could not be confirmed');
      } else {
        toast.success('SMS sent');
      }
      onSent?.();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to send SMS');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      title="Send SMS"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button type="button" onClick={handleSubmit} disabled={sending} className={btnPrimary}>
            {sending ? 'Sending…' : 'Send'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className={labelClass}>Phone Number</label>
          <input
            className={inputClass}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="07XXXXXXXX"
          />
        </div>
        <div>
          <label className={labelClass}>Message *</label>
          <textarea
            className={`${inputClass} resize-none`}
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Message content…"
            maxLength={480}
          />
          <p className="mt-0.5 text-right text-[10px] text-slate-400">{body.length}/480</p>
        </div>
      </div>
    </Modal>
  );
};

const CommunicationsTab = ({ clientId, clientPhone }) => {
  const confirm = useConfirm();
  const [interactions, setInteractions] = useState([]);
  const [pagination, setPagination]     = useState({ total: 0, page: 1, pages: 1 });
  const [loading, setLoading]           = useState(true);
  const [page, setPage]                 = useState(1);
  const [limit, setLimit]               = useState(25);
  const [expanded, setExpanded]         = useState({});
  const [showLog, setShowLog]           = useState(null);
  const [showSms, setShowSms]           = useState(false);
  const [deleting, setDeleting]         = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await clientsApi.listInteractions({ clientId, page, limit });
      setInteractions(data?.interactions || data?.data || []);
      setPagination(data?.pagination || { total: 0, page: 1, pages: 1 });
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to load interactions');
    } finally {
      setLoading(false);
    }
  }, [clientId, page, limit]);

  useEffect(() => { load(); }, [load]);

  const toggleExpand = (id) => setExpanded((p) => ({ ...p, [id]: !p[id] }));

  const handleDelete = async (id) => {
    if (!(await confirm({ title: 'Delete Interaction', message: 'Delete this interaction?', confirmText: 'Delete', isDangerous: true }))) return;
    setDeleting((p) => ({ ...p, [id]: true }));
    try {
      await clientsApi.deleteInteraction(id);
      toast.success('Deleted');
      setInteractions((prev) => prev.filter((i) => i._id !== id));
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to delete');
    } finally {
      setDeleting((p) => ({ ...p, [id]: false }));
    }
  };

  const LOG_BUTTONS = [
    { type: 'note',    label: 'Add Note',    cls: btnSecondary },
    { type: 'call',    label: 'Log Call',    cls: btnSecondary },
    { type: 'meeting', label: 'Log Meeting', cls: btnSecondary },
    { type: 'email',   label: 'Log Email',   cls: btnPrimary },
  ];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap justify-end gap-1.5">
        <button
          type="button"
          onClick={() => setShowSms(true)}
          className={`inline-flex h-7 items-center gap-1.5 px-3 text-xs font-semibold rounded ${btnPrimary}`}
        >
          <FaSms size={9} /> Send SMS
        </button>
        {LOG_BUTTONS.map(({ type, label, cls }) => {
          const Icon = typeIcon(type);
          return (
            <button
              key={type}
              type="button"
              onClick={() => setShowLog(type)}
              className={`inline-flex h-7 items-center gap-1.5 px-3 text-xs font-semibold rounded ${cls}`}
            >
              <Icon size={9} /> {label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-slate-400">Loading interactions…</div>
      ) : !interactions.length ? (
        <div className="py-12 text-center text-sm text-slate-400">No interactions logged yet.</div>
      ) : (
        <div className="space-y-1.5">
          {interactions.map((item) => {
            const Icon       = typeIcon(item.type);
            const isExpanded = expanded[item._id];
            const body       = item.body || '';
            const preview    = body.length > 100 ? body.slice(0, 100) + '…' : body;

            return (
              <div key={item._id} className="border border-slate-200 bg-white">
                <div className="flex items-start gap-2.5 px-3 py-2.5">
                  <div
                    className={`mt-0.5 flex-shrink-0 flex h-6 w-6 items-center justify-center rounded-full border ${typeColorCls(item.type)}`}
                  >
                    <Icon size={10} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-slate-800">
                        {item.subject || item.type}
                      </span>
                      {item.type === 'email' && item.emailStatus && (
                        <span
                          className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${emailStatusCls(item.emailStatus)}`}
                        >
                          {item.emailStatus}
                        </span>
                      )}
                      <span className="text-[10px] text-slate-400 ml-auto whitespace-nowrap">
                        {item.createdBy?.name && (
                          <span className="mr-1">{item.createdBy.name} &middot;</span>
                        )}
                        {fmtDate(item.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600 whitespace-pre-line">
                      {isExpanded ? body : preview}
                    </p>
                    {body.length > 100 && (
                      <button
                        type="button"
                        onClick={() => toggleExpand(item._id)}
                        className="mt-1 text-[10px] font-semibold text-[#0B3B2E] hover:underline"
                      >
                        {isExpanded ? 'Show less' : 'Show more'}
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(item._id)}
                    disabled={deleting[item._id]}
                    className="flex-shrink-0 text-slate-300 hover:text-red-500 transition-colors disabled:opacity-50 mt-0.5"
                    title="Delete interaction"
                  >
                    <FaTrash size={10} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <PaginationBar
        page={page}
        pages={pagination.pages || 1}
        total={pagination.total || 0}
        pageSize={limit}
        onPageChange={setPage}
        onPageSizeChange={(n) => { setLimit(n); setPage(1); }}
        loading={loading}
        label="interactions"
      />

      {showLog && (
        <LogInteractionModal
          clientId={clientId}
          defaultType={showLog}
          onClose={() => setShowLog(null)}
          onCreated={load}
        />
      )}
      {showSms && (
        <SendSmsModal
          clientId={clientId}
          defaultPhone={clientPhone}
          onClose={() => setShowSms(false)}
          onSent={load}
        />
      )}
    </div>
  );
};

export default CommunicationsTab;
export { SendSmsModal, LogInteractionModal };
