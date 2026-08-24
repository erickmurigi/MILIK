import React, { useCallback, useEffect, useState } from "react";
import { FaEnvelope, FaPlus, FaSave, FaSms, FaTimes } from "react-icons/fa";
import { toast } from "react-toastify";
import PropertySaleShell from "./PropertySaleShell";
import Modal from "../../components/common/Modal";
import Spinner from "../../components/common/Spinner";
import AppSelect from "../../components/common/AppSelect";
import { inputClass, labelClass } from "../../utils/formStyles";
import { saleApi } from "../../services/propertySaleApi";

const CONTEXT_OPTIONS = [
  { value: "buyer", label: "Buyer" },
  { value: "deal",  label: "Deal"  },
  { value: "lead",  label: "Lead"  },
];
const CHANNEL_OPTIONS = [
  { value: "email", label: "Email" },
  { value: "sms",   label: "SMS"   },
];

const CONTEXT_LABELS = { buyer: "Buyer", deal: "Deal", lead: "Lead" };
const CHANNEL_LABELS = { email: "Email", sms: "SMS" };

const PLACEHOLDERS = {
  buyer: [
    // Contact
    { key: "{buyerName}",        desc: "Buyer's full name" },
    { key: "{buyerNumber}",      desc: "Buyer reference (e.g. BYR-001)" },
    { key: "{phone}",            desc: "Phone number" },
    { key: "{email}",            desc: "Email address" },
    { key: "{idNumber}",         desc: "National ID / Passport number" },
    // KYC & acquisition
    { key: "{kycStatus}",        desc: "KYC verification status (pending / verified / rejected)" },
    { key: "{source}",           desc: "Acquisition source (e.g. Referral, Walk In)" },
    { key: "{registrationDate}", desc: "Date the buyer profile was created" },
    // Company
    { key: "{companyName}",      desc: "Your company name" },
    { key: "{companyPhone}",     desc: "Your company phone number" },
    { key: "{companyEmail}",     desc: "Your company email address" },
  ],
  deal: [
    // Buyer
    { key: "{buyerName}",           desc: "Buyer's full name" },
    { key: "{buyerNumber}",         desc: "Buyer reference (e.g. BYR-001)" },
    { key: "{phone}",               desc: "Buyer's phone number" },
    { key: "{email}",               desc: "Buyer's email address" },
    // Deal
    { key: "{dealNumber}",          desc: "Deal reference (e.g. DL-001)" },
    { key: "{dealStatus}",          desc: "Deal status (active / closed / cancelled)" },
    { key: "{salePrice}",           desc: "Agreed sale price" },
    { key: "{dealDate}",            desc: "Date the deal was created" },
    { key: "{expectedClosingDate}", desc: "Target closing / handover date" },
    { key: "{actualClosingDate}",   desc: "Actual date the deal was closed" },
    { key: "{titleTransferDate}",   desc: "Title deed transfer date" },
    { key: "{stampDuty}",           desc: "Stamp duty amount" },
    // Property / Listing
    { key: "{listingTitle}",        desc: "Property name" },
    { key: "{listingNumber}",       desc: "Listing reference (e.g. LST-001)" },
    { key: "{propertyType}",        desc: "Property type (Plot, House, Apartment…)" },
    { key: "{propertyLocation}",    desc: "Property location / area" },
    { key: "{propertyTown}",        desc: "Town the property is in" },
    { key: "{propertyCounty}",      desc: "County the property is in" },
    { key: "{propertySize}",        desc: "Property size with unit (e.g. 50 sqm)" },
    { key: "{askingPrice}",         desc: "Original asking / listed price" },
    // Agent & company
    { key: "{agentName}",           desc: "Assigned agent's name" },
    { key: "{companyName}",         desc: "Your company name" },
    { key: "{companyPhone}",        desc: "Your company phone number" },
    { key: "{companyEmail}",        desc: "Your company email address" },
  ],
  lead: [
    // Contact
    { key: "{leadName}",         desc: "Lead's full name" },
    { key: "{leadNumber}",       desc: "Lead reference (e.g. LDR-001)" },
    { key: "{phone}",            desc: "Phone number" },
    { key: "{email}",            desc: "Email address" },
    // Pipeline
    { key: "{source}",           desc: "Lead source (e.g. Walk In, Referral, Online)" },
    { key: "{status}",           desc: "Current pipeline stage" },
    { key: "{assignedAgent}",    desc: "Agent handling this lead" },
    { key: "{lastContactDate}",  desc: "Date the lead was last contacted" },
    { key: "{nextFollowUpDate}", desc: "Scheduled next follow-up date" },
    // Budget
    { key: "{budgetMin}",        desc: "Minimum budget" },
    { key: "{budgetMax}",        desc: "Maximum budget" },
    // Company
    { key: "{companyName}",      desc: "Your company name" },
    { key: "{companyPhone}",     desc: "Your company phone number" },
    { key: "{companyEmail}",     desc: "Your company email address" },
  ],
};

const blankForm = { name: "", channel: "email", context: "buyer", subject: "", body: "", isActive: true };

export default function SaleTemplates() {
  const [settings,     setSettings]     = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [showModal,    setShowModal]    = useState(false);
  const [editingId,    setEditingId]    = useState(null);
  const [form,         setForm]         = useState(blankForm);
  const [saving,       setSaving]       = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      const s = await saleApi.getSettings();
      setSettings(s);
    } catch {
      toast.error("Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  const allTemplates  = settings?.commTemplates ?? [];
  const active   = allTemplates.filter((t) => t.isActive !== false).length;
  const archived = allTemplates.length - active;
  const visible  = showInactive ? allTemplates : allTemplates.filter((t) => t.isActive !== false);

  const openCreate = () => { setEditingId(null); setForm(blankForm); setShowModal(true); };
  const openEdit   = (t)  => {
    setEditingId(t._id);
    setForm({ name: t.name, channel: t.channel, context: t.context, subject: t.subject || "", body: t.body, isActive: t.isActive ?? true });
    setShowModal(true);
  };
  const closeModal = () => { setShowModal(false); setEditingId(null); };

  const saveTemplate = async () => {
    if (!form.name.trim()) { toast.error("Template name is required"); return; }
    if (!form.body.trim()) { toast.error("Body is required"); return; }
    if (form.channel === "email" && !form.subject.trim()) { toast.error("Subject is required for email templates"); return; }
    setSaving(true);
    try {
      const updated = editingId
        ? await saleApi.updateCommTemplate(editingId, form)
        : await saleApi.addCommTemplate(form);
      setSettings(updated);
      toast.success(editingId ? "Updated" : "Added");
      closeModal();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (t) => {
    try {
      const updated = await saleApi.updateCommTemplate(t._id, { isActive: !t.isActive });
      setSettings(updated);
    } catch { toast.error("Failed to update"); }
  };

  const deleteTemplate = async (t) => {
    try {
      const updated = await saleApi.deleteCommTemplate(t._id);
      setSettings(updated);
      toast.success("Template deleted");
    } catch { toast.error("Failed to delete"); }
  };

  const placeholders = PLACEHOLDERS[form.context] ?? [];
  const insertPlaceholder = (key) => setForm((f) => ({ ...f, body: f.body + key }));

  return (
    <PropertySaleShell title="SMS & Email Templates">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-slate-200 bg-white shadow-sm">

        {/* Toolbar */}
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/80 px-4 py-2">
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">{active} active · {archived} archived</span>
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-600">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="h-3.5 w-3.5" />
              Show archived
            </label>
          </div>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 bg-[#0B3B2E] px-3 py-1.5 text-[11px] font-bold text-white hover:bg-[#0A3127]"
          >
            <FaPlus className="text-[10px]" /> Add Template
          </button>
        </div>

        {/* Table */}
        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="flex h-40 items-center justify-center gap-2 text-sm text-slate-500">
              <Spinner size="sm" /> Loading…
            </div>
          ) : visible.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-3 text-sm text-slate-400">
              <div>{allTemplates.length === 0 ? "No templates yet. Click Add Template to create one." : "No active templates."}</div>
              {allTemplates.length === 0 && (
                <button onClick={openCreate} className="inline-flex items-center gap-1.5 bg-[#0B3B2E] px-3 py-1.5 text-[11px] font-bold text-white hover:bg-[#0A3127]">
                  <FaPlus className="text-[10px]" /> Add Template
                </button>
              )}
            </div>
          ) : (
            <table className="w-full border-collapse text-[11px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#0B3B2E] text-white">
                  <th className="px-3 py-1.5 text-left font-bold border-r border-white/10">Name</th>
                  <th className="px-3 py-1.5 text-left font-bold border-r border-white/10 w-20">Channel</th>
                  <th className="px-3 py-1.5 text-left font-bold border-r border-white/10 w-20">Context</th>
                  <th className="px-3 py-1.5 text-left font-bold border-r border-white/10">Subject / Preview</th>
                  <th className="px-3 py-1.5 text-left font-bold border-r border-white/10 w-20">Status</th>
                  <th className="px-3 py-1.5 text-left font-bold w-28">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t, idx) => {
                  const isActive = t.isActive !== false;
                  return (
                    <tr
                      key={t._id}
                      className={`border-b border-gray-100 ${idx % 2 === 0 ? "bg-white hover:bg-blue-50/40" : "bg-slate-50/60 hover:bg-blue-50/40"}`}
                    >
                      <td className="px-3 py-1.5 border-r border-gray-100 font-semibold text-slate-900">{t.name}</td>
                      <td className="px-3 py-1.5 border-r border-gray-100">
                        <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${t.channel === "email" ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700"}`}>
                          {t.channel === "email" ? <FaEnvelope className="text-[8px]" /> : <FaSms className="text-[8px]" />}
                          {CHANNEL_LABELS[t.channel] ?? t.channel}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 border-r border-gray-100">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-600">
                          {CONTEXT_LABELS[t.context] ?? t.context}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 border-r border-gray-100 max-w-xs">
                        {t.subject && <div className="truncate font-medium text-slate-700">{t.subject}</div>}
                        <div className="mt-0.5 truncate text-slate-400 italic">{t.body}</div>
                      </td>
                      <td className="px-3 py-1.5 border-r border-gray-100">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${isActive ? "border-emerald-200 bg-emerald-100 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-500"}`}>
                          {isActive ? "Active" : "Archived"}
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-1">
                          <button onClick={() => openEdit(t)} className="rounded px-2 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-100">Edit</button>
                          <button
                            onClick={() => toggleStatus(t)}
                            className={`rounded px-2 py-1 text-[10px] font-bold ${isActive ? "text-amber-600 hover:bg-amber-50" : "text-emerald-600 hover:bg-emerald-50"}`}
                          >
                            {isActive ? "Disable" : "Enable"}
                          </button>
                          <button onClick={() => deleteTemplate(t)} className="rounded px-2 py-1 text-[10px] font-bold text-rose-600 hover:bg-rose-50">Delete</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <Modal
          onClose={closeModal}
          title={editingId ? "Edit Template" : "Add Template"}
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <button onClick={closeModal} className="inline-flex items-center gap-1.5 border border-slate-300 px-3 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50">
                <FaTimes /> Cancel
              </button>
              <button onClick={saveTemplate} disabled={saving} className="inline-flex items-center gap-1.5 bg-[#0B3B2E] px-3 py-1.5 text-[11px] font-bold text-white hover:bg-[#0A3127] disabled:opacity-50">
                {saving ? <Spinner size="sm" /> : <FaSave />}
                {saving ? "Saving…" : editingId ? "Update" : "Save"}
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Template Name *</label>
              <input
                className={inputClass}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Balance Reminder"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <AppSelect
                label="Channel *"
                value={form.channel}
                onChange={(v) => setForm((f) => ({ ...f, channel: v ?? "email" }))}
                options={CHANNEL_OPTIONS}
                size="md"
              />
              <AppSelect
                label="Context *"
                value={form.context}
                onChange={(v) => setForm((f) => ({ ...f, context: v ?? "buyer" }))}
                options={CONTEXT_OPTIONS}
                size="md"
              />
            </div>
            {form.channel === "email" && (
              <div>
                <label className={labelClass}>Subject *</label>
                <input
                  className={inputClass}
                  value={form.subject}
                  onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                  placeholder="e.g. Outstanding Balance Reminder"
                />
              </div>
            )}
            <div>
              <div className="mb-1 flex items-start justify-between gap-2">
                <label className={labelClass}>Body *</label>
                <div className="flex flex-wrap justify-end gap-1">
                  {placeholders.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      title={p.desc}
                      onClick={() => insertPlaceholder(p.key)}
                      className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[9px] text-slate-500 hover:border-[#0B3B2E] hover:text-[#0B3B2E]"
                    >
                      {p.key}
                    </button>
                  ))}
                </div>
              </div>
              <textarea
                rows={form.channel === "sms" ? 4 : 7}
                className={`${inputClass} font-mono`}
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                placeholder={
                  form.channel === "sms"
                    ? "Dear {buyerName}, …"
                    : "Dear {buyerName},\n\n…\n\nBest regards,\n{companyName}"
                }
              />
              <p className="mt-1 text-[10px] text-slate-400">
                Click a placeholder above to append it. Use &#123;curlyBrace&#125; syntax — substituted automatically when sending.
              </p>
            </div>
          </div>
        </Modal>
      )}
    </PropertySaleShell>
  );
}
