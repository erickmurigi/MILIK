import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import AppSelect from '../../components/common/AppSelect';
import Modal from '../../components/common/Modal';
import { fmtDate, todayISO } from '../../utils/dates';
import { useConfirm } from '../../context/ConfirmContext';
import { inputClass, labelClass } from '../../utils/formStyles';
import {
  FaBuilding,
  FaCalendar,
  FaChevronLeft,
  FaComments,
  FaEnvelope,
  FaEdit,
  FaFileAlt,
  FaFileInvoice,
  FaHandshake,
  FaPhone,
  FaPlus,
  FaSave,
  FaSms,
  FaStickyNote,
  FaTimes,
  FaTrash,
} from 'react-icons/fa';
import ClientsShell from './ClientsShell';
import { clientsApi } from '../../services/clientsApi';
import RecordClientPaymentModal from '../../components/Modals/RecordClientPaymentModal';
import PaginationBar from '../../components/PaginationBar';
import MilikTable from '../../components/common/MilikTable';
import StatementLedgerTab from '../../components/common/StatementLedgerTab';

// ─── Formatting helpers ───────────────────────────────────────────────────────

const fmtKES = (n) =>
  new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    minimumFractionDigits: 2,
  }).format(Number(n) || 0);

const daysUntil = (d) =>
  Math.ceil((new Date(d) - new Date()) / (1000 * 60 * 60 * 24));


const btnPrimary =
  'bg-[#0B3B2E] text-white hover:bg-[#027333] px-4 py-2 rounded-md text-sm font-semibold disabled:opacity-50';
const btnDanger =
  'bg-red-600 text-white hover:bg-red-700 px-4 py-2 rounded-md text-sm font-semibold disabled:opacity-50';
const btnSecondary =
  'border border-slate-200 text-slate-700 hover:bg-slate-50 px-4 py-2 rounded-md text-sm font-semibold';

// ─── Badge helpers ────────────────────────────────────────────────────────────

const contractStatusBadge = (status) => {
  const map = {
    active:     'bg-emerald-50 text-emerald-700 border-emerald-200',
    draft:      'bg-slate-50 text-slate-600 border-slate-200',
    expired:    'bg-red-50 text-red-700 border-red-200',
    terminated: 'bg-red-50 text-red-600 border-red-200',
    renewed:    'bg-blue-50 text-blue-700 border-blue-200',
  };
  return map[status] || 'bg-slate-50 text-slate-500 border-slate-200';
};

const invoiceStatusBadge = (status) => {
  const map = {
    draft:     'bg-slate-50 text-slate-600 border-slate-200',
    sent:      'bg-blue-50 text-blue-700 border-blue-200',
    paid:      'bg-emerald-50 text-emerald-700 border-emerald-200',
    partial:   'bg-amber-50 text-amber-700 border-amber-200',
    overdue:   'bg-red-50 text-red-700 border-red-200',
    cancelled: 'bg-slate-50 text-slate-400 border-slate-200',
  };
  return map[status] || 'bg-slate-50 text-slate-500 border-slate-200';
};

const daysColor = (days) => {
  if (days <= 30) return 'text-red-600 font-bold';
  if (days <= 60) return 'text-amber-600 font-semibold';
  return 'text-emerald-700';
};

const clientStatusCls = (status) => {
  if (status === 'active')   return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'inactive') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (status === 'churned')  return 'bg-red-50 text-red-600 border-red-200';
  return 'bg-slate-50 text-slate-500 border-slate-200';
};

// ─── Data constants ───────────────────────────────────────────────────────────

const CATEGORIES      = ['enterprise', 'sme', 'individual'];
const SOURCES         = ['referral', 'direct', 'online', 'other'];
const BILLING_CYCLES  = ['monthly', 'quarterly', 'annually'];
const RENEWAL_STAGES  = ['due', 'contacted', 'negotiating', 'renewed', 'lost'];
const INTERACTION_TYPES = ['note', 'email', 'call', 'meeting', 'sms'];

// ─── Shared sub-components ────────────────────────────────────────────────────

const Card = ({ title, right, children, className = '' }) => (
  <div className={`border border-slate-200 bg-white shadow-sm ${className}`}>
    <div className="flex min-h-8 flex-wrap items-center justify-between gap-1 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5">
      <h2 className="text-[10px] font-black uppercase tracking-widest text-[#0B3B2E]">{title}</h2>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
    {children}
  </div>
);

const StatTile = ({ label, value, color = 'text-slate-800' }) => (
  <div className="border border-slate-200 bg-white px-4 py-3 text-center">
    <p className="text-[9px] font-extrabold uppercase tracking-widest text-slate-400">{label}</p>
    <p className={`mt-1 text-xl font-black tabular-nums ${color}`}>{value}</p>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// TAB: Profile
// ─────────────────────────────────────────────────────────────────────────────

const ProfileTab = ({ client, summary, onRefresh }) => {
  const [editMode, setEditMode]     = useState(false);
  const [form, setForm]             = useState({});
  const [saving, setSaving]         = useState(false);
  const [showAddContact, setShowAddContact] = useState(false);
  const [contactForm, setContactForm] = useState({ name: '', role: '', phone: '', email: '' });
  const [contactSaving, setContactSaving] = useState(false);

  useEffect(() => {
    if (client) {
      setForm({
        name:                client.name || '',
        email:               client.email || '',
        phone:               client.phone || '',
        category:            client.category || '',
        source:              client.source || '',
        taxPin:              client.taxPin || '',
        companyRegistration: client.companyRegistration || '',
        'address.line1':     client.address?.line1 || '',
        'address.city':      client.address?.city || '',
        notes:               client.notes || '',
      });
    }
  }, [client]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await clientsApi.update(client._id, {
        name:                form.name.trim(),
        email:               form.email.trim() || undefined,
        phone:               form.phone.trim() || undefined,
        category:            form.category || undefined,
        source:              form.source || undefined,
        taxPin:              form.taxPin.trim() || undefined,
        companyRegistration: form.companyRegistration.trim() || undefined,
        address: {
          line1: form['address.line1'].trim() || undefined,
          city:  form['address.city'].trim() || undefined,
        },
        notes: form.notes.trim() || undefined,
      });
      toast.success('Client updated');
      setEditMode(false);
      onRefresh();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to update client');
    } finally {
      setSaving(false);
    }
  };

  const handleAddContact = async () => {
    if (!contactForm.name.trim()) { toast.error('Contact name required'); return; }
    setContactSaving(true);
    try {
      const existing = client.contactPersons || [];
      await clientsApi.update(client._id, {
        contactPersons: [
          ...existing,
          {
            name:  contactForm.name.trim(),
            role:  contactForm.role.trim() || undefined,
            phone: contactForm.phone.trim() || undefined,
            email: contactForm.email.trim() || undefined,
          },
        ],
      });
      toast.success('Contact added');
      setShowAddContact(false);
      setContactForm({ name: '', role: '', phone: '', email: '' });
      onRefresh();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to add contact');
    } finally {
      setContactSaving(false);
    }
  };

  if (!client) {
    return <div className="py-12 text-center text-sm text-slate-400">Loading profile…</div>;
  }

  // Plain label-over-value typography instead of a boxed/greyed field — this
  // is a read-only profile display, not a disabled form. Matches the compact
  // label style used throughout the app (StatTile above, PayLandlordModal's
  // summary rows, etc.): tiny bold uppercase tracked-out label, bold value.
  const FieldView = ({ label, value }) => (
    <div>
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-0.5 text-[13px] font-semibold text-slate-800">
        {value || <span className="font-normal italic text-slate-300">—</span>}
      </p>
    </div>
  );

  const FieldEdit = ({ label, field, type = 'text', options }) => (
    <div>
      <label className={labelClass}>{label}</label>
      {options ? (
        <AppSelect
          size="md"
          clearable
          placeholder="Select…"
          value={form[field] || ''}
          onChange={(v) => set(field, v ?? '')}
          options={options.map((o) => ({ value: o, label: o }))}
        />
      ) : type === 'textarea' ? (
        <textarea
          className={`${inputClass} resize-none`}
          rows={3}
          value={form[field] || ''}
          onChange={(e) => set(field, e.target.value)}
        />
      ) : (
        <input
          type={type}
          className={inputClass}
          value={form[field] || ''}
          onChange={(e) => set(field, e.target.value)}
        />
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Stats row */}
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <StatTile
          label="Active Contracts"
          value={summary?.activeContracts ?? '…'}
          color="text-[#0B3B2E]"
        />
        <StatTile
          label="Total Invoiced"
          value={summary ? fmtKES(summary.totalInvoiced) : '…'}
        />
        <StatTile
          label="Total Paid"
          value={summary ? fmtKES(summary.totalPaid) : '…'}
          color="text-emerald-700"
        />
        <StatTile
          label="Outstanding"
          value={summary ? fmtKES(summary.outstanding) : '…'}
          color={(summary?.outstanding || 0) > 0 ? 'text-red-600' : 'text-slate-800'}
        />
      </div>

      {/* Client details card */}
      <Card
        title="Client Details"
        right={
          editMode ? (
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setEditMode(false)}
                className="inline-flex h-6 items-center gap-1 border border-slate-200 text-slate-600 hover:bg-slate-50 px-2 rounded text-xs font-semibold"
              >
                <FaTimes size={9} /> Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="inline-flex h-6 items-center gap-1 bg-[#0B3B2E] text-white hover:bg-[#027333] px-2 rounded text-xs font-semibold disabled:opacity-50"
              >
                <FaSave size={9} /> {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditMode(true)}
              className="inline-flex h-6 items-center gap-1 border border-slate-200 text-slate-600 hover:bg-slate-50 px-2 rounded text-xs font-semibold"
            >
              <FaEdit size={9} /> Edit
            </button>
          )
        }
      >
        <div className="p-3 grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {editMode ? (
            <>
              <FieldEdit label="Name"            field="name" />
              <FieldView label="Code"            value={client.clientCode} />
              <FieldEdit label="Category"        field="category"            options={CATEGORIES} />
              <FieldEdit label="Source"          field="source"              options={SOURCES} />
              <FieldEdit label="Email"           field="email"               type="email" />
              <FieldEdit label="Phone"           field="phone" />
              <FieldEdit label="Tax PIN"         field="taxPin" />
              <FieldEdit label="Company Reg #"   field="companyRegistration" />
              <FieldEdit label="Address Line 1"  field="address.line1" />
              <FieldEdit label="City"            field="address.city" />
              <div className="sm:col-span-2 lg:col-span-3">
                <FieldEdit label="Notes" field="notes" type="textarea" />
              </div>
            </>
          ) : (
            <>
              <FieldView label="Name"            value={client.name} />
              <FieldView label="Code"            value={client.clientCode} />
              <FieldView label="Category"        value={client.category} />
              <FieldView label="Source"          value={client.source} />
              <FieldView label="Email"           value={client.email} />
              <FieldView label="Phone"           value={client.phone} />
              <FieldView label="Tax PIN"         value={client.taxPin} />
              <FieldView label="Company Reg #"   value={client.companyRegistration} />
              <FieldView label="Address"         value={client.address?.line1} />
              <FieldView label="City"            value={client.address?.city} />
              <div className="sm:col-span-2 lg:col-span-3">
                <FieldView label="Notes" value={client.notes} />
              </div>
            </>
          )}
        </div>
      </Card>

      {/* Contact persons */}
      <Card
        title="Contact Persons"
        right={
          <button
            type="button"
            onClick={() => setShowAddContact(true)}
            className="inline-flex h-6 items-center gap-1 bg-[#0B3B2E] text-white hover:bg-[#027333] px-2 rounded text-xs font-semibold"
          >
            <FaPlus size={9} /> Add Contact
          </button>
        }
      >
        {!(client.contactPersons || []).length ? (
          <p className="px-4 py-6 text-center text-xs text-slate-400">No contact persons recorded.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {(client.contactPersons || []).map((cp, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{cp.name}</p>
                  <p className="text-[10px] text-slate-400">
                    {cp.role && <span className="mr-2">{cp.role}</span>}
                    {cp.phone && <span className="mr-2">{cp.phone}</span>}
                    {cp.email}
                  </p>
                </div>
                {cp.role && (
                  <span className="flex-shrink-0 inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                    {cp.role}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Add contact modal */}
      {showAddContact && (
        <Modal
          title="Add Contact Person"
          onClose={() => setShowAddContact(false)}
          footer={
            <>
              <button type="button" onClick={() => setShowAddContact(false)} className={btnSecondary}>
                Cancel
              </button>
              <button type="button" onClick={handleAddContact} disabled={contactSaving} className={btnPrimary}>
                {contactSaving ? 'Saving…' : 'Add Contact'}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <div>
              <label className={labelClass}>Name *</label>
              <input
                className={inputClass}
                value={contactForm.name}
                onChange={(e) => setContactForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className={labelClass}>Role / Title</label>
              <input
                className={inputClass}
                placeholder="e.g. Procurement Manager"
                value={contactForm.role}
                onChange={(e) => setContactForm((f) => ({ ...f, role: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Phone</label>
                <input
                  className={inputClass}
                  value={contactForm.phone}
                  onChange={(e) => setContactForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelClass}>Email</label>
                <input
                  type="email"
                  className={inputClass}
                  value={contactForm.email}
                  onChange={(e) => setContactForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// TAB: Contracts
// ─────────────────────────────────────────────────────────────────────────────

const AddContractModal = ({ clientId, onClose, onCreated }) => {
  const [form, setForm] = useState({
    description: '',
    startDate: todayISO(),
    endDate: '',
    openEnded: false,
    baseValue: '',
    billingCycle: 'monthly',
    escalationPercent: '10',
    escalationPeriodYears: '2',
    noticePeriodDays: '30',
    paymentTermsDays: '30',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (!form.description.trim()) { toast.error('Description required'); return; }
    if (!form.startDate)          { toast.error('Start date required'); return; }
    if (!form.openEnded && !form.endDate) { toast.error('End date required, or check "Open-ended"'); return; }
    if (!form.baseValue || isNaN(Number(form.baseValue))) { toast.error('Valid base value required'); return; }
    setSaving(true);
    try {
      await clientsApi.createContract({
        client:                clientId,
        description:           form.description.trim(),
        startDate:             form.startDate,
        endDate:               form.openEnded ? undefined : form.endDate,
        openEnded:             form.openEnded,
        baseValue:             Number(form.baseValue),
        billingCycle:          form.billingCycle,
        escalationPercent:     Number(form.escalationPercent) || 10,
        escalationPeriodYears: Number(form.escalationPeriodYears) || 2,
        noticePeriodDays:      Number(form.noticePeriodDays) || 30,
        paymentTermsDays:      Number(form.paymentTermsDays) || 30,
        notes:                 form.notes.trim() || undefined,
      });
      toast.success('Contract created');
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to create contract');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Add Contract"
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button type="button" onClick={handleSubmit} disabled={saving} className={btnPrimary}>
            {saving ? 'Saving…' : 'Create Contract'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2.5">
        <div className="col-span-2">
          <label className={labelClass}>Description *</label>
          <input
            className={inputClass}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Contract scope / title"
          />
        </div>
        <div>
          <label className={labelClass}>Start Date *</label>
          <input type="date" className={inputClass} value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className={labelClass} style={{ marginBottom: 0 }}>End Date {form.openEnded ? '' : '*'}</label>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.openEnded}
                onChange={(e) => set('openEnded', e.target.checked)}
                className="rounded border-slate-300 text-[#0B3B2E] focus:ring-[#0B3B2E]"
              />
              <span className="text-[11px] font-semibold text-slate-500">Open-ended</span>
            </label>
          </div>
          <input
            type="date"
            className={`${inputClass} ${form.openEnded ? 'opacity-40 pointer-events-none' : ''}`}
            value={form.openEnded ? '' : form.endDate}
            onChange={(e) => set('endDate', e.target.value)}
            disabled={form.openEnded}
          />
        </div>
        <div>
          <label className={labelClass}>Base Value (KES) *</label>
          <input type="number" className={inputClass} value={form.baseValue} onChange={(e) => set('baseValue', e.target.value)} min="0" placeholder="0.00" />
        </div>
        <div>
          <label className={labelClass}>Billing Cycle</label>
          <AppSelect
            size="md"
            value={form.billingCycle}
            onChange={(v) => set('billingCycle', v ?? 'monthly')}
            options={BILLING_CYCLES.map((c) => ({ value: c, label: c }))}
          />
        </div>
        <div>
          <label className={labelClass}>Escalation % (default 10)</label>
          <input type="number" className={inputClass} value={form.escalationPercent} onChange={(e) => set('escalationPercent', e.target.value)} min="0" />
        </div>
        <div>
          <label className={labelClass}>Escalation Period (years, default 2)</label>
          <input type="number" className={inputClass} value={form.escalationPeriodYears} onChange={(e) => set('escalationPeriodYears', e.target.value)} min="1" />
        </div>
        <div>
          <label className={labelClass}>Notice Period (days)</label>
          <input type="number" className={inputClass} value={form.noticePeriodDays} onChange={(e) => set('noticePeriodDays', e.target.value)} min="0" />
        </div>
        <div>
          <label className={labelClass}>Payment Terms (days)</label>
          <input type="number" className={inputClass} value={form.paymentTermsDays} onChange={(e) => set('paymentTermsDays', e.target.value)} min="0" />
        </div>
        <div className="col-span-2">
          <label className={labelClass}>Notes</label>
          <textarea className={`${inputClass} resize-none`} rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
      </div>
    </Modal>
  );
};

const RenewContractModal = ({ contract, onClose, onRenewed }) => {
  const currentVal  = Number(contract?.currentValue || contract?.baseValue || 0);
  const escalation  = Number(contract?.escalationPercent ?? 10) / 100;
  const proposedVal = Math.round(currentVal * (1 + escalation) * 100) / 100;
  const [form, setForm] = useState({
    startDate: contract?.endDate ? contract.endDate.slice(0, 10) : todayISO(),
    endDate:   '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (!form.startDate || !form.endDate) { toast.error('Start and end dates required'); return; }
    setSaving(true);
    try {
      await clientsApi.renewContract(contract._id, {
        startDate: form.startDate,
        endDate:   form.endDate,
      });
      toast.success('Contract renewed');
      onRenewed();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to renew contract');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Renew Contract"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button type="button" onClick={handleSubmit} disabled={saving} className={btnPrimary}>
            {saving ? 'Renewing…' : 'Renew Contract'}
          </button>
        </>
      }
    >
      <div className="space-y-2.5">
        <div className="border border-slate-200 bg-slate-50 p-3">
          <p className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">Renewal Summary</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Current Value</p>
              <p className="mt-0.5 text-[13px] font-semibold text-slate-800">{fmtKES(currentVal)}</p>
            </div>
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                New Value ({contract?.escalationPercent ?? 10}% escalation)
              </p>
              <p className="mt-0.5 text-[13px] font-bold text-[#0B3B2E]">{fmtKES(proposedVal)}</p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className={labelClass}>New Start Date</label>
            <input type="date" className={inputClass} value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>New End Date</label>
            <input type="date" className={inputClass} value={form.endDate} onChange={(e) => set('endDate', e.target.value)} />
          </div>
        </div>
      </div>
    </Modal>
  );
};

const TerminateContractModal = ({ contract, onClose, onTerminated }) => {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await clientsApi.terminateContract(contract._id, { lostReason: reason.trim() });
      toast.success('Contract terminated');
      onTerminated();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to terminate contract');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Terminate Contract"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button type="button" onClick={handleSubmit} disabled={saving} className={btnDanger}>
            {saving ? 'Terminating…' : 'Terminate'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          You are about to terminate contract{' '}
          <strong>{contract.contractNumber || contract._id?.slice(-6).toUpperCase()}</strong>. This cannot be undone.
        </p>
        <div>
          <label className={labelClass}>Reason for Termination</label>
          <textarea
            className={`${inputClass} resize-none`}
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Describe why the contract is being terminated…"
          />
        </div>
      </div>
    </Modal>
  );
};

const ContractsTab = ({ clientId, onSummaryChange }) => {
  const [contracts, setContracts]     = useState([]);
  const [pagination, setPagination]   = useState({ total: 0, page: 1, pages: 1 });
  const [loading, setLoading]         = useState(true);
  const [page, setPage]               = useState(1);
  const [limit, setLimit]             = useState(25);
  const [showAdd, setShowAdd]         = useState(false);
  const [renewTarget, setRenewTarget] = useState(null);
  const [termTarget, setTermTarget]   = useState(null);
  const [stageUpdating, setStageUpdating] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await clientsApi.listContracts({ clientId, page, limit });
      setContracts(data?.contracts || data?.data || []);
      setPagination(data?.pagination || { total: 0, page: 1, pages: 1 });
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to load contracts');
    } finally {
      setLoading(false);
    }
  }, [clientId, page, limit]);

  useEffect(() => { load(); }, [load]);

  // Contract count/status changes affect the Profile tab's "Active Contracts"
  // stat, which otherwise only refreshes on initial page load — call this
  // instead of load() alone after anything that changes a contract's status.
  const refresh = useCallback(() => {
    load();
    onSummaryChange?.();
  }, [load, onSummaryChange]);

  const handleActivate = async (c) => {
    try {
      await clientsApi.activateContract(c._id);
      toast.success('Contract activated');
      refresh();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to activate');
    }
  };

  const handleRenewalStage = async (contractId, stage) => {
    setStageUpdating((p) => ({ ...p, [contractId]: true }));
    try {
      await clientsApi.updateRenewalStage(contractId, { renewalStage: stage });
      toast.success('Renewal stage updated');
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to update stage');
    } finally {
      setStageUpdating((p) => ({ ...p, [contractId]: false }));
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="inline-flex h-7 items-center gap-1.5 bg-[#0B3B2E] text-white hover:bg-[#027333] px-3 text-xs font-bold rounded"
        >
          <FaPlus size={9} /> Add Contract
        </button>
      </div>

      <MilikTable
        columns={[
          { label: 'Contract #' },
          { label: 'Description' },
          { label: 'Period' },
          { label: 'Value (KES)' },
          { label: 'Billing' },
          { label: 'Status' },
          { label: 'Expires' },
        ]}
        rows={contracts}
        rowKey="_id"
        loading={loading}
        empty="No contracts on record."
        renderRow={(c) => {
          const days = c.endDate ? daysUntil(c.endDate) : null;
          return (
            <>
              <td className="px-3 py-2.5 font-mono text-[11px] text-[#0B3B2E]">
                {c.contractNumber || c._id?.slice(-6).toUpperCase()}
              </td>
              <td className="px-3 py-2.5 max-w-[160px] truncate font-semibold text-slate-800">
                {c.description || '—'}
              </td>
              <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">
                {fmtDate(c.startDate)} –{' '}
                {c.openEnded || !c.endDate
                  ? <span className="font-semibold text-emerald-700">Ongoing</span>
                  : fmtDate(c.endDate)}
              </td>
              <td className="px-3 py-2.5 tabular-nums font-semibold text-slate-700">
                {fmtKES(c.currentValue || c.baseValue)}
              </td>
              <td className="px-3 py-2.5 text-slate-500 capitalize">{c.billingCycle || '—'}</td>
              <td className="px-3 py-2.5">
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${contractStatusBadge(c.status)}`}
                >
                  {c.status || '—'}
                </span>
              </td>
              <td className="px-3 py-2.5 whitespace-nowrap">
                {c.status === 'active' && days !== null ? (
                  <span className={`tabular-nums text-[11px] ${daysColor(days)}`}>
                    {days < 0 ? `${Math.abs(days)}d overdue` : `${days}d`}
                  </span>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </td>
            </>
          );
        }}
        renderActions={(c) => (
          <div className="flex flex-wrap items-center gap-1">
            {c.status === 'draft' && (
              <button
                type="button"
                onClick={() => handleActivate(c)}
                className="border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 px-2 py-0.5 rounded text-[10px] font-semibold"
              >
                Activate
              </button>
            )}
            {c.status === 'active' && (
              <>
                <button
                  type="button"
                  onClick={() => setRenewTarget(c)}
                  className="border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 px-2 py-0.5 rounded text-[10px] font-semibold"
                >
                  Renew
                </button>
                <AppSelect
                  size="sm"
                  value={c.renewalStage || 'not_started'}
                  onChange={(v) => handleRenewalStage(c._id, v ?? 'not_started')}
                  disabled={stageUpdating[c._id]}
                  options={RENEWAL_STAGES.map((s) => ({ value: s, label: s.replace(/_/g, ' ') }))}
                />
              </>
            )}
            {(c.status === 'active' || c.status === 'draft') && (
              <button
                type="button"
                onClick={() => setTermTarget(c)}
                className="border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 px-2 py-0.5 rounded text-[10px] font-semibold"
              >
                Terminate
              </button>
            )}
          </div>
        )}
      />

      <PaginationBar
        page={page}
        pages={pagination.pages || 1}
        total={pagination.total || 0}
        pageSize={limit}
        onPageChange={setPage}
        onPageSizeChange={(n) => { setLimit(n); setPage(1); }}
        loading={loading}
        label="contracts"
      />

      {showAdd   && <AddContractModal clientId={clientId} onClose={() => setShowAdd(false)} onCreated={refresh} />}
      {renewTarget && <RenewContractModal contract={renewTarget} onClose={() => setRenewTarget(null)} onRenewed={refresh} />}
      {termTarget  && <TerminateContractModal contract={termTarget} onClose={() => setTermTarget(null)} onTerminated={refresh} />}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// TAB: Invoices
// ─────────────────────────────────────────────────────────────────────────────

const EMPTY_LINE = { description: '', qty: '1', unitPrice: '' };

const CreateInvoiceModal = ({ clientId, contracts, onClose, onCreated }) => {
  const [form, setForm] = useState({
    contractId: '',
    periodStart: todayISO(),
    periodEnd: '',
    issueDate: todayISO(),
    dueDate: '',
    vatRate: '16',
    notes: '',
  });
  const [lines, setLines]   = useState([{ ...EMPTY_LINE }]);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const setLine = (i, k, v) =>
    setLines((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [k]: v };
      return next;
    });

  const addLine    = () => setLines((prev) => [...prev, { ...EMPTY_LINE }]);
  const removeLine = (i) => setLines((prev) => prev.filter((_, idx) => idx !== i));

  const lineAmt  = (l) => (Number(l.qty) || 0) * (Number(l.unitPrice) || 0);
  const subtotal = lines.reduce((s, l) => s + lineAmt(l), 0);
  const vatAmt   = subtotal * (Number(form.vatRate) / 100);
  const total    = subtotal + vatAmt;

  const handleSubmit = async () => {
    if (!form.issueDate || !form.dueDate)               { toast.error('Issue and due dates required'); return; }
    if (lines.every((l) => !l.description.trim()))      { toast.error('At least one line item required'); return; }
    setSaving(true);
    try {
      await clientsApi.createInvoice({
        client:      clientId,
        contract:    form.contractId || undefined,
        periodStart: form.periodStart || undefined,
        periodEnd:   form.periodEnd || undefined,
        issueDate:   form.issueDate,
        dueDate:     form.dueDate,
        vatRate:     form.vatRate !== '' && form.vatRate !== null && form.vatRate !== undefined ? Number(form.vatRate) : 16,
        lineItems:   lines
          .filter((l) => l.description.trim())
          .map((l) => ({
            description: l.description.trim(),
            quantity:    Number(l.qty) || 1,
            unitPrice:   Number(l.unitPrice) || 0,
            amount:      lineAmt(l),
          })),
        subtotal,
        vatAmount:   vatAmt,
        totalAmount: total,
        notes:       form.notes.trim() || undefined,
      });
      toast.success('Invoice created');
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to create invoice');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Create Invoice"
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button type="button" onClick={handleSubmit} disabled={saving} className={btnPrimary}>
            {saving ? 'Saving…' : 'Create Invoice'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2.5">
          {contracts.length > 0 && (
            <div className="col-span-2">
              <label className={labelClass}>Contract (optional)</label>
              <AppSelect
                size="md"
                clearable
                placeholder="No specific contract"
                value={form.contractId}
                onChange={(v) => set('contractId', v ?? '')}
                options={contracts.map((c) => ({
                  value: c._id,
                  label: `${c.contractNumber || c._id?.slice(-6).toUpperCase()} — ${c.description || ''}`,
                }))}
              />
            </div>
          )}
          <div>
            <label className={labelClass}>Period Start</label>
            <input type="date" className={inputClass} value={form.periodStart} onChange={(e) => set('periodStart', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Period End</label>
            <input type="date" className={inputClass} value={form.periodEnd} onChange={(e) => set('periodEnd', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Issue Date *</label>
            <input type="date" className={inputClass} value={form.issueDate} onChange={(e) => set('issueDate', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Due Date *</label>
            <input type="date" className={inputClass} value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
          </div>
        </div>

        {/* Line items */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className={labelClass}>Line Items</span>
            <button
              type="button"
              onClick={addLine}
              className="inline-flex h-6 items-center gap-1 text-[11px] font-semibold text-[#0B3B2E] hover:underline"
            >
              <FaPlus size={8} /> Add Line
            </button>
          </div>
          <div className="rounded border border-slate-200 overflow-x-auto">
            <table className="w-full min-w-[480px] text-xs">
              <thead>
                <tr className="bg-slate-100">
                  <th className="px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">Description</th>
                  <th className="px-2 py-1.5 w-14 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">Qty</th>
                  <th className="px-2 py-1.5 w-24 text-right text-[10px] font-bold uppercase tracking-wide text-slate-500">Unit Price</th>
                  <th className="px-2 py-1.5 w-24 text-right text-[10px] font-bold uppercase tracking-wide text-slate-500">Amount</th>
                  <th className="px-2 py-1.5 w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1">
                      <input
                        className="w-full border-0 bg-transparent px-0 py-1 text-xs focus:outline-none"
                        value={l.description}
                        onChange={(e) => setLine(i, 'description', e.target.value)}
                        placeholder="Service description…"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="number"
                        className="w-full border-0 bg-transparent px-0 py-1 text-xs focus:outline-none text-right"
                        value={l.qty}
                        onChange={(e) => setLine(i, 'qty', e.target.value)}
                        min="0"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="number"
                        className="w-full border-0 bg-transparent px-0 py-1 text-xs focus:outline-none text-right"
                        value={l.unitPrice}
                        onChange={(e) => setLine(i, 'unitPrice', e.target.value)}
                        min="0"
                        placeholder="0.00"
                      />
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums font-semibold text-slate-700">
                      {fmtKES(lineAmt(l))}
                    </td>
                    <td className="px-2 py-1">
                      {lines.length > 1 && (
                        <button type="button" onClick={() => removeLine(i)} className="text-red-400 hover:text-red-600">
                          <FaTimes size={9} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="mt-2 space-y-1.5 border border-slate-200 bg-slate-50 p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Subtotal</span>
              <span className="text-[13px] tabular-nums font-semibold text-slate-700">{fmtKES(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">VAT</span>
                <input
                  type="number"
                  className="w-12 border border-slate-200 rounded px-1 py-0.5 text-[11px]"
                  value={form.vatRate}
                  onChange={(e) => set('vatRate', e.target.value)}
                  min="0"
                  max="100"
                />
                <span className="text-[10px] text-slate-400">%</span>
              </div>
              <span className="text-[13px] tabular-nums font-semibold text-slate-700">{fmtKES(vatAmt)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-slate-200 pt-1.5">
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Total</span>
              <span className="tabular-nums font-black text-[#0B3B2E] text-sm">{fmtKES(total)}</span>
            </div>
          </div>
        </div>

        <div>
          <label className={labelClass}>Notes</label>
          <textarea
            className={`${inputClass} resize-none`}
            rows={2}
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
};

const InvoicesTab = ({ clientId, contracts, onSummaryChange }) => {
  const navigate = useNavigate();
  const confirm  = useConfirm();
  const [invoices, setInvoices]     = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pages: 1 });
  const [loading, setLoading]       = useState(true);
  const [page, setPage]             = useState(1);
  const [limit, setLimit]           = useState(25);
  const [showCreate, setShowCreate]     = useState(false);
  const [markPaidTarget, setMarkPaidTarget] = useState(null);
  const [sending, setSending]       = useState({});
  const [cancelling, setCancelling] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await clientsApi.listInvoices({ clientId, page, limit });
      setInvoices(data?.invoices || data?.data || []);
      setPagination(data?.pagination || { total: 0, page: 1, pages: 1 });
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  }, [clientId, page, limit]);

  useEffect(() => { load(); }, [load]);

  // Sending/paying/cancelling an invoice changes the Profile tab's Total
  // Invoiced/Total Paid/Outstanding stats, which otherwise only refresh on
  // initial page load — call this instead of load() alone after any of them.
  const refresh = useCallback(() => {
    load();
    onSummaryChange?.();
  }, [load, onSummaryChange]);

  const handleSend = async (inv) => {
    setSending((p) => ({ ...p, [inv._id]: true }));
    try {
      await clientsApi.sendInvoice(inv._id);
      toast.success('Invoice sent');
      refresh();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to send invoice');
    } finally {
      setSending((p) => ({ ...p, [inv._id]: false }));
    }
  };

  const handleCancel = async (inv) => {
    if (!(await confirm({ title: 'Cancel Invoice', message: 'Cancel this invoice? This cannot be undone.', confirmText: 'Cancel Invoice', isDangerous: true }))) return;
    setCancelling((p) => ({ ...p, [inv._id]: true }));
    try {
      await clientsApi.cancelInvoice(inv._id);
      toast.success('Invoice cancelled');
      refresh();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to cancel invoice');
    } finally {
      setCancelling((p) => ({ ...p, [inv._id]: false }));
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex h-7 items-center gap-1.5 bg-[#0B3B2E] text-white hover:bg-[#027333] px-3 text-xs font-bold rounded"
        >
          <FaPlus size={9} /> Create Invoice
        </button>
      </div>

      <MilikTable
        columns={[
          { label: 'Invoice #' },
          { label: 'Period' },
          { label: 'Issue Date' },
          { label: 'Due Date' },
          { label: 'Total' },
          { label: 'Paid' },
          { label: 'Balance' },
          { label: 'Status' },
        ]}
        rows={invoices}
        rowKey="_id"
        loading={loading}
        empty="No invoices on record."
        renderRow={(inv) => {
          const balance = (inv.total || 0) - (inv.paidAmount || 0);
          return (
            <>
              <td className="px-3 py-2.5 font-mono text-[11px] text-[#0B3B2E]">
                {inv.invoiceNumber || inv._id?.slice(-6).toUpperCase()}
              </td>
              <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">
                {inv.periodStart ? `${fmtDate(inv.periodStart)} – ${fmtDate(inv.periodEnd)}` : '—'}
              </td>
              <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{fmtDate(inv.issueDate)}</td>
              <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{fmtDate(inv.dueDate)}</td>
              <td className="px-3 py-2.5 tabular-nums font-semibold text-slate-700">
                {fmtKES(inv.total)}
              </td>
              <td className="px-3 py-2.5 tabular-nums text-emerald-700">{fmtKES(inv.paidAmount || 0)}</td>
              <td className={`px-3 py-2.5 tabular-nums font-semibold ${balance > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                {fmtKES(balance)}
              </td>
              <td className="px-3 py-2.5">
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${invoiceStatusBadge(inv.status)}`}
                >
                  {inv.status || '—'}
                </span>
              </td>
            </>
          );
        }}
        renderActions={(inv) => (
          <div className="flex flex-wrap items-center gap-1">
            {(inv.status === 'draft' || inv.status === 'sent') && (
              <button
                type="button"
                onClick={() => handleSend(inv)}
                disabled={sending[inv._id]}
                className="border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 px-2 py-0.5 rounded text-[10px] font-semibold disabled:opacity-50"
              >
                {sending[inv._id] ? '…' : 'Send'}
              </button>
            )}
            {inv.status !== 'paid' && inv.status !== 'cancelled' && (
              <button
                type="button"
                onClick={() => setMarkPaidTarget(inv)}
                className="border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 px-2 py-0.5 rounded text-[10px] font-semibold"
              >
                Mark Paid
              </button>
            )}
            <button
              type="button"
              onClick={() => navigate(`/clients/invoices/${inv._id}/print`)}
              className="border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 px-2 py-0.5 rounded text-[10px] font-semibold"
            >
              Print
            </button>
            {inv.status !== 'paid' && inv.status !== 'cancelled' && (
              <button
                type="button"
                onClick={() => handleCancel(inv)}
                disabled={cancelling[inv._id]}
                className="border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 px-2 py-0.5 rounded text-[10px] font-semibold disabled:opacity-50"
              >
                {cancelling[inv._id] ? '…' : 'Cancel'}
              </button>
            )}
          </div>
        )}
      />

      <PaginationBar
        page={page}
        pages={pagination.pages || 1}
        total={pagination.total || 0}
        pageSize={limit}
        onPageChange={setPage}
        onPageSizeChange={(n) => { setLimit(n); setPage(1); }}
        loading={loading}
        label="invoices"
      />

      {showCreate && (
        <CreateInvoiceModal
          clientId={clientId}
          contracts={contracts}
          onClose={() => setShowCreate(false)}
          onCreated={refresh}
        />
      )}
      {markPaidTarget && (
        <RecordClientPaymentModal
          invoice={markPaidTarget}
          onClose={() => setMarkPaidTarget(null)}
          onRecorded={refresh}
        />
      )}
    </div>
  );
};

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

// ─────────────────────────────────────────────────────────────────────────────
// Main: ClientDetail
// ─────────────────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'profile',        label: 'Profile',        icon: FaBuilding },
  { key: 'contracts',      label: 'Contracts',      icon: FaHandshake },
  { key: 'invoices',       label: 'Invoices',       icon: FaFileInvoice },
  { key: 'statement',      label: 'Statement',      icon: FaFileAlt },
  { key: 'communications', label: 'Communications', icon: FaComments },
];

// Client Management has no debit-note/credit-note concept yet (see
// StatementLedgerTab's own doc comment) — a reduced type set vs. the tenant
// statement's four types.
const CLIENT_STATEMENT_TYPE_OPTIONS = [
  { value: 'CHARGE',  label: 'Invoices' },
  { value: 'PAYMENT', label: 'Receipts' },
];
const CLIENT_STATEMENT_TYPE_META = {
  CHARGE:  { label: 'Invoice', cls: 'text-red-700 bg-red-50 ring-1 ring-red-200' },
  PAYMENT: { label: 'Receipt', cls: 'text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200' },
};

const StatementTab = ({ clientId, activeContracts }) => {
  const [statementData, setStatementData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await clientsApi.getStatement(clientId);
      setStatementData(data?.data || data);
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to load statement');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  if (loading && !statementData) {
    return <div className="py-16 text-center text-sm text-slate-400">Loading statement…</div>;
  }

  return (
    <StatementLedgerTab
      statementData={statementData}
      extraKpi={{ label: 'Active Contracts', value: String(activeContracts || 0), color: 'text-white' }}
      typeOptions={CLIENT_STATEMENT_TYPE_OPTIONS}
      typeMeta={CLIENT_STATEMENT_TYPE_META}
    />
  );
};

const ClientDetail = () => {
  const { id }   = useParams();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState('profile');
  const [client, setClient]       = useState(null);
  const [summary, setSummary]     = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);

  // Contracts cached here so both ContractsTab and InvoicesTab can share them
  const [contracts, setContracts] = useState([]);
  const contractsLoadedRef        = useRef(false);

  const loadClient = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [clientRes, summaryRes] = await Promise.all([
        clientsApi.get(id),
        clientsApi.getSummary(id).catch(() => ({ data: null })),
      ]);
      setClient(clientRes.data?.client || clientRes.data);
      setSummary(summaryRes.data?.summary || summaryRes.data);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Failed to load client');
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Silent sibling of loadClient — re-fetches only the summary stats, without
  // toggling `loading`. Contracts/Invoices tabs call this after any action
  // that changes Active Contracts/Total Invoiced/Total Paid/Outstanding (send,
  // record payment, cancel, activate, renew, terminate) so the Profile tab's
  // stat row doesn't go stale until a full page reload. loadClient itself
  // would work too, but it flips `loading` and would flash the whole detail
  // page (all tabs) to the loading state on every such action.
  const refreshSummary = useCallback(async () => {
    try {
      const { data } = await clientsApi.getSummary(id);
      setSummary(data?.summary || data);
    } catch (_err) {
      // Non-fatal — the stat row just keeps its last known values.
    }
  }, [id]);

  useEffect(() => { loadClient(); }, [loadClient]);

  // Pre-load contracts for both Contracts and Invoices tabs
  useEffect(() => {
    if ((activeTab === 'contracts' || activeTab === 'invoices') && !contractsLoadedRef.current) {
      clientsApi.listContracts({ clientId: id })
        .then(({ data }) => {
          setContracts(data?.contracts || data?.data || []);
          contractsLoadedRef.current = true;
        })
        .catch(() => {});
    }
  }, [activeTab, id]);

  const clientName = client?.name || 'Client';

  return (
    <ClientsShell
      title={loading ? 'Loading…' : clientName}
      action={
        <button
          type="button"
          onClick={() => navigate('/clients')}
          className="inline-flex h-7 items-center gap-1.5 border border-slate-200 text-slate-700 hover:bg-slate-50 px-3 text-xs font-semibold rounded"
        >
          <FaChevronLeft size={9} /> All Clients
        </button>
      }
    >
      {error ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <p className="text-sm font-semibold text-red-600">{error}</p>
            <button type="button" onClick={loadClient} className="mt-3 text-xs text-[#0B3B2E] underline">
              Retry
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col h-full">
          {/* Client header strip */}
          {!loading && client && (
            <div className="flex-shrink-0 border-b border-slate-200 bg-white px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h1 className="text-lg font-extrabold text-slate-900">{clientName}</h1>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {client.clientCode && <span className="font-mono mr-2">{client.clientCode}</span>}
                    {client.category && <span className="mr-2">{client.category}</span>}
                    {client.email && <span className="mr-2">{client.email}</span>}
                    {client.phone}
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab('statement')}
                    className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <FaFileAlt size={10} /> View Statement
                  </button>
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${clientStatusCls(client.status)}`}
                  >
                    {client.status || '—'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Tab nav */}
          <div className="flex-shrink-0 border-b border-slate-200 bg-white px-4 overflow-x-auto">
            <div className="flex items-center gap-0.5 min-w-max py-1.5">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`h-[20px] shrink-0 inline-flex items-center gap-0.5 px-1.5 text-[9px] font-bold whitespace-nowrap ${
                      activeTab === tab.key
                        ? 'bg-[#0B3B2E] text-white'
                        : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Icon size={7} /> {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tab content */}
          <div className="flex-1 min-h-0 overflow-auto p-4">
            {loading ? (
              <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
            ) : (
              <>
                {activeTab === 'profile' && (
                  <ProfileTab client={client} summary={summary} onRefresh={loadClient} />
                )}
                {activeTab === 'contracts' && (
                  <ContractsTab clientId={id} onSummaryChange={refreshSummary} />
                )}
                {activeTab === 'invoices' && (
                  <InvoicesTab clientId={id} contracts={contracts} onSummaryChange={refreshSummary} />
                )}
                {activeTab === 'statement' && (
                  <StatementTab clientId={id} activeContracts={summary?.activeContracts} />
                )}
                {activeTab === 'communications' && (
                  <CommunicationsTab clientId={id} clientPhone={client?.phone} />
                )}
              </>
            )}
          </div>
        </div>
      )}
    </ClientsShell>
  );
};

export default ClientDetail;
