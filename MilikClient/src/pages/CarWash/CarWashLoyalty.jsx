import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FaCar, FaCog, FaEdit, FaGift, FaRedoAlt, FaSearch,
  FaSms, FaStar, FaTimes, FaUserPlus,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";
import CwSmsModal from "./CwSmsModal";
import useCarWashPermission from "../../hooks/useCarWashPermission";

const inputClass = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const labelClass = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";

// ─── Visual stamp dots ────────────────────────────────────────────────────────
const StampDots = ({ current, required }) => {
  const safe = Math.max(1, required);
  if (safe > 12) {
    const pct = Math.min((current / safe) * 100, 100);
    return (
      <div className="flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
          <div className="h-2 rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="tabular-nums text-xs font-black text-slate-700">{current}/{safe}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {Array.from({ length: safe }, (_, i) => (
        <div
          key={i}
          className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition-all ${
            i < current
              ? "border-emerald-500 bg-emerald-500 shadow-sm"
              : "border-slate-200 bg-white"
          }`}
          title={i < current ? `Stamp ${i + 1}` : "Not yet earned"}
        >
          {i < current && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
        </div>
      ))}
      <span className="ml-0.5 text-[11px] font-extrabold text-slate-500">{current}/{safe}</span>
    </div>
  );
};

// ─── Program settings panel ───────────────────────────────────────────────────
const ProgramPanel = ({ program, onSaved }) => {
  const [form, setForm] = useState({
    name: "Loyalty Program",
    isActive: true,
    stampsRequired: 10,
    rewardType: "free_wash",
    rewardValue: 0,
    stampExpiryDays: 0,
    smsOnStamp: true,
    smsOnReward: true,
    smsOnPayment: false,
  });
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const canManage = useCarWashPermission("carwash-loyalty", "manage");

  useEffect(() => {
    if (program) {
      setForm({
        name: program.name || "Loyalty Program",
        isActive: program.isActive !== false,
        stampsRequired: program.stampsRequired ?? 10,
        rewardType: program.rewardType || "free_wash",
        rewardValue: program.rewardValue ?? 0,
        stampExpiryDays: program.stampExpiryDays ?? 0,
        smsOnStamp: program.smsOnStamp !== false,
        smsOnReward: program.smsOnReward !== false,
        smsOnPayment: Boolean(program.smsOnPayment),
      });
    }
  }, [program]);

  const set = (key, val) => { setForm(f => ({ ...f, [key]: val })); setDirty(true); };

  const save = async () => {
    if (Number(form.stampsRequired) < 2) { toast.error("Stamps required must be at least 2"); return; }
    setSaving(true);
    try {
      const saved = await carWashApi.saveLoyaltyProgram(form);
      onSaved(saved);
      toast.success("Loyalty program saved");
      setDirty(false);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to save program");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-[#EDF5F1] px-4 py-2.5">
        <FaCog className="text-[#0B3B2E] text-[13px]" />
        <span className="text-xs font-black uppercase tracking-wide text-[#0B3B2E]">Program Settings</span>
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-slate-600">
          <input type="checkbox" checked={form.isActive} onChange={e => set("isActive", e.target.checked)} className="accent-emerald-600" />
          Active
        </label>
      </div>
      <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className={labelClass}>Program name</label>
          <input className={inputClass} value={form.name} onChange={e => set("name", e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>Washes required for reward</label>
          <input className={inputClass} type="number" min={2} value={form.stampsRequired} onChange={e => set("stampsRequired", Number(e.target.value))} />
        </div>
        <div>
          <label className={labelClass}>Reward type</label>
          <select className={inputClass} value={form.rewardType} onChange={e => set("rewardType", e.target.value)}>
            <option value="free_wash">Free wash</option>
            <option value="discount_percent">Discount (%)</option>
            <option value="discount_fixed">Discount (fixed KES)</option>
          </select>
        </div>
        {form.rewardType !== "free_wash" && (
          <div>
            <label className={labelClass}>{form.rewardType === "discount_percent" ? "Discount %" : "Discount KES"}</label>
            <input className={inputClass} type="number" min={0} value={form.rewardValue} onChange={e => set("rewardValue", Number(e.target.value))} />
          </div>
        )}
        <div>
          <label className={labelClass}>Stamp expiry (days, 0 = never)</label>
          <input className={inputClass} type="number" min={0} value={form.stampExpiryDays} onChange={e => set("stampExpiryDays", Number(e.target.value))} />
        </div>
      </div>
      <div className="border-t border-slate-100 px-4 py-3">
        <div className="mb-2 text-[11px] font-black uppercase tracking-wide text-slate-500">SMS Notifications</div>
        <div className="flex flex-wrap gap-4">
          {[
            { key: "smsOnStamp", label: "On each stamp earned" },
            { key: "smsOnReward", label: "When reward is ready" },
            { key: "smsOnPayment", label: "On payment confirmation" },
          ].map(({ key, label }) => (
            <label key={key} className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-slate-700">
              <input type="checkbox" checked={form[key]} onChange={e => set(key, e.target.checked)} className="accent-emerald-600" />
              {label}
            </label>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              try {
                const r = await carWashApi.backfillCustomersAndStamps();
                toast.success(r?.message || `Backfill complete — ${r?.stampsAwarded ?? 0} stamps awarded`);
              } catch (e) {
                toast.error(e?.response?.data?.message || "Backfill failed");
              }
            }}
            className="border border-emerald-600 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-50"
            title="Award missed stamps for all existing Done/Paid jobs"
          >
            Backfill Stamps
          </button>
          <button
            onClick={async () => {
              try {
                const r = await carWashApi.migratePerCustomerCards();
                toast.success(r?.message || "Migration complete");
              } catch (e) {
                toast.error(e?.response?.data?.message || "Migration failed");
              }
            }}
            className="border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100"
            title="Merge per-plate loyalty cards into one card per customer"
          >
            Migrate Cards
          </button>
        </div>
        {canManage && (
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black uppercase tracking-wide text-white hover:bg-[#0A3127] disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Program"}
          </button>
        )}
      </div>
    </div>
  );
};

const Modal = ({ title, children, footer, onClose }) => (
  <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
    <div className="w-full max-w-xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
        <h2 className="text-sm font-extrabold uppercase tracking-wide">{title}</h2>
        <button type="button" onClick={onClose} className="p-1 text-white/80 hover:bg-white/10 hover:text-white"><FaTimes /></button>
      </div>
      <div className="p-4">{children}</div>
      <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">{footer}</div>
    </div>
  </div>
);

const emptyCustomer = { name: "", phone: "", plates: [""], notes: "" };

const CarWashLoyalty = () => {
  const [program, setProgram] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [customerForm, setCustomerForm] = useState(emptyCustomer);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("customers");
  const canManageLoyalty = useCarWashPermission("carwash-loyalty", "manage");
  const [expandedId, setExpandedId] = useState(null);
  const [cardData, setCardData] = useState({});
  const [smsTarget, setSmsTarget] = useState(null);
  const [smsBody, setSmsBody] = useState("");
  const [smsSending, setSmsSending] = useState(false);
  const searchRef = useRef(null);
  const PAGE_SIZE = 30;

  const loadProgram = useCallback(async () => {
    try { setProgram(await carWashApi.getLoyaltyProgram()); } catch (_) {}
  }, []);

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await carWashApi.listLoyaltyCustomers({ search: appliedSearch || undefined, page, limit: PAGE_SIZE });
      setCustomers(Array.isArray(res) ? res : res?.data ?? []);
      setTotal(res?.total ?? (Array.isArray(res) ? res.length : 0));
    } catch (_) {
      toast.error("Failed to load customers");
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, page]);

  useEffect(() => { loadProgram(); }, [loadProgram]);
  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  const applySearch = () => { setAppliedSearch(search); setPage(1); };

  const openAdd = () => {
    setEditingCustomer(null);
    setCustomerForm(emptyCustomer);
    setShowCustomerModal(true);
  };

  const openEdit = (c) => {
    setEditingCustomer(c);
    setCustomerForm({ name: c.name, phone: c.phone || "", plates: c.plates?.length ? c.plates : [""], notes: c.notes || "" });
    setShowCustomerModal(true);
  };

  const setField = (key, val) => setCustomerForm(f => ({ ...f, [key]: val }));
  const setPlate = (i, val) => {
    const plates = [...customerForm.plates];
    plates[i] = val.toUpperCase();
    setCustomerForm(f => ({ ...f, plates }));
  };
  const addPlateField = () => setCustomerForm(f => ({ ...f, plates: [...f.plates, ""] }));
  const removePlateField = (i) => setCustomerForm(f => ({ ...f, plates: f.plates.filter((_, idx) => idx !== i) }));

  const saveCustomer = async () => {
    if (!customerForm.name.trim()) { toast.error("Name is required"); return; }
    if (!customerForm.phone.trim()) { toast.error("Phone is required"); return; }
    const plates = customerForm.plates.map(p => p.trim().toUpperCase()).filter(Boolean);
    setSaving(true);
    try {
      if (editingCustomer) {
        await carWashApi.updateLoyaltyCustomer(editingCustomer._id, { ...customerForm, plates });
        toast.success("Customer updated");
      } else {
        await carWashApi.registerLoyaltyCustomer({ ...customerForm, plates });
        toast.success("Customer registered");
      }
      setShowCustomerModal(false);
      loadCustomers();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to save customer");
    } finally {
      setSaving(false);
    }
  };

  const toggleExpand = async (customer) => {
    const id = customer._id;
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (!cardData[id]) {
      try {
        const res = await carWashApi.getCustomerCard(id);
        setCardData(prev => ({ ...prev, [id]: res }));
      } catch (_) {}
    }
  };

  const stampsRequired = program?.stampsRequired ?? 10;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const rewardDesc = (prog) => {
    if (!prog) return "a reward";
    if (prog.rewardType === "free_wash") return "a free wash";
    if (prog.rewardType === "discount_percent") return `${prog.rewardValue}% off`;
    return `KES ${prog.rewardValue} off`;
  };

  const buildTemplates = (customer) => {
    const card = customer.loyaltyCard;
    const name = customer.name || "Valued Customer";
    const plates = (customer.plates || []).join(", ") || "your vehicle";
    const reward = rewardDesc(program);
    const req = stampsRequired;
    const templates = [];
    if (card?.currentStamps > 0) {
      const rem = req - card.currentStamps;
      templates.push({ label: "Stamp Update", color: "blue", body: `Hi ${name}, stamp ${card.currentStamps}/${req} earned for ${plates}. ${rem} more wash${rem !== 1 ? "es" : ""} to earn your reward. Thank you.` });
    }
    if ((card?.pendingRewards ?? 0) > 0) {
      templates.push({ label: "Reward Ready", color: "amber", body: `Hi ${name}, you have earned ${reward} for ${plates}. Redeem on your next visit. Thank you.` });
    }
    templates.push({ label: "Welcome", color: "green", body: `Hi ${name}, welcome to our loyalty program. Collect ${req} stamps to earn ${reward}. Thank you for choosing us.` });
    templates.push({ label: "Reminder", color: "violet", body: `Hi ${name}, you have ${card?.currentStamps ?? 0}/${req} stamps. Visit us again to earn ${reward}.` });
    return templates;
  };

  const openSmsModal = (customer, type = "general") => {
    setSmsTarget(customer);
    const card = customer.loyaltyCard;
    const name = customer.name || "Valued Customer";
    const plates = (customer.plates || []).join(", ") || "your vehicle";
    const reward = rewardDesc(program);
    if (type === "stamp" && card) {
      const rem = stampsRequired - card.currentStamps;
      setSmsBody(`Hi ${name}, stamp ${card.currentStamps}/${stampsRequired} earned for ${plates}. ${rem} more wash${rem !== 1 ? "es" : ""} to earn your reward. Thank you.`);
    } else if (type === "reward" && card) {
      setSmsBody(`Hi ${name}, you have earned ${reward} for ${plates}. Redeem on your next visit. Thank you.`);
    } else {
      setSmsBody(`Hi ${name}, your loyalty card has ${card?.currentStamps ?? 0}/${stampsRequired} stamps. Thank you for your continued support.`);
    }
  };

  const sendSms = async (phone, body) => {
    if (!smsTarget) return;
    setSmsSending(true);
    try {
      // phone is null in masked-MSISDN mode — backend falls back to customer.maskedMsisdn
      await carWashApi.sendCustomerSms(smsTarget._id, { ...(phone ? { phone } : {}), body });
      toast.success("SMS sent");
      setSmsTarget(null);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to send SMS");
    } finally {
      setSmsSending(false);
    }
  };

  return (
    <CarWashShell
      title="Customer Loyalty"
      action={
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden border border-slate-300 text-[11px] font-black uppercase tracking-wide">
            {[["customers", "Customers"], ["program", "Program Settings"]].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-3 py-1.5 transition ${tab === key ? "bg-[#0B3B2E] text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "customers" && canManageLoyalty && (
            <button
              onClick={openAdd}
              className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-3 text-xs font-black uppercase tracking-wide text-white hover:bg-[#0A3127]"
            >
              <FaUserPlus className="text-[11px]" /> Register Customer
            </button>
          )}
        </div>
      }
    >
      {tab === "program" ? (
        <ProgramPanel program={program} onSaved={p => setProgram(p)} />
      ) : (
        <div className="space-y-3">
          {/* Program chip */}
          {program && (
            <div className={`inline-flex items-center gap-1.5 border px-3 py-1.5 text-[11px] font-bold ${program.isActive ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-500"}`}>
              <FaStar className="text-[9px]" />
              {program.isActive ? "Loyalty active" : "Loyalty inactive"} · {program.stampsRequired} washes for {rewardDesc(program)}
              {!program.isActive && <span className="ml-2 text-amber-600">Enable in Program Settings to start earning stamps.</span>}
            </div>
          )}

          {/* Search bar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-[220px] flex-1 items-center border border-slate-300 bg-white">
              <FaSearch className="ml-2 shrink-0 text-[11px] text-slate-400" />
              <input
                ref={searchRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => e.key === "Enter" && applySearch()}
                placeholder="Search name, phone or plate…"
                className="h-9 flex-1 px-2 text-sm text-slate-800 outline-none"
              />
              {search && (
                <button onClick={() => { setSearch(""); setAppliedSearch(""); }} className="mr-1 text-slate-400 hover:text-slate-600">
                  <FaTimes className="text-[10px]" />
                </button>
              )}
            </div>
            <button onClick={applySearch} className="h-9 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">Search</button>
            <button onClick={loadCustomers} className="h-9 border border-slate-300 bg-white px-2.5 text-slate-500 hover:bg-slate-50" title="Refresh">
              <FaRedoAlt className="text-[11px]" />
            </button>
            <span className="ml-auto text-[11px] font-semibold text-slate-500">{total} customer{total !== 1 ? "s" : ""}</span>
          </div>

          {/* Table */}
          <div className="overflow-x-auto border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[680px] text-xs">
              <thead>
                <tr className="bg-[#0B3B2E] text-white">
                  <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.15em]">Customer</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.15em]">Plates</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.15em]">Stamp Progress</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-black uppercase tracking-[0.15em]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan={4} className="py-10 text-center text-xs text-slate-400">Loading…</td></tr>
                ) : customers.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-16 text-center">
                      <FaStar className="mx-auto mb-2 text-3xl text-slate-200" />
                      <div className="text-sm font-semibold text-slate-400">No customers yet</div>
                      <div className="mt-1 text-xs text-slate-400">Register a customer or create a job — plates enrol automatically</div>
                    </td>
                  </tr>
                ) : customers.map(c => {
                  const card = c.loyaltyCard;
                  const pendingRewards = card?.pendingRewards ?? 0;
                  const isExpanded = expandedId === c._id;
                  const hasReward = pendingRewards > 0;
                  const hasContact = Boolean(c.phone || c.maskedMsisdn);

                  return (
                    <React.Fragment key={c._id}>
                      <tr
                        className={`cursor-pointer transition-colors hover:bg-[#F8FBF9] ${hasReward ? "bg-amber-50/40" : "bg-white"}`}
                        onClick={() => toggleExpand(c)}
                      >
                        {/* Customer */}
                        <td className="px-4 py-3">
                          <div className="font-extrabold text-slate-900">{c.name}</div>
                          {c.phone
                            ? <div className="mt-0.5 text-[11px] text-slate-500">{c.phone}</div>
                            : c.maskedMsisdn
                            ? <div className="mt-0.5 text-[10px] font-semibold text-emerald-600">M-Pesa · SMS ready</div>
                            : <div className="mt-0.5 text-[10px] italic text-slate-400">No phone yet</div>
                          }
                        </td>

                        {/* Plates */}
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {(c.plates || []).map(p => (
                              <span key={p} className="inline-flex items-center gap-1 border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                                <FaCar className="text-[9px] text-emerald-600" />{p}
                              </span>
                            ))}
                            {!c.plates?.length && <span className="text-[11px] text-slate-400">—</span>}
                          </div>
                        </td>

                        {/* Stamps */}
                        <td className="px-4 py-3">
                          {card ? (
                            <div className="space-y-1.5">
                              <StampDots current={card.currentStamps} required={stampsRequired} />
                              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                                <span>{card.totalStampsEarned} total stamp{card.totalStampsEarned !== 1 ? "s" : ""}</span>
                                {hasReward && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-700">
                                    <FaGift className="text-[8px]" /> {pendingRewards} reward{pendingRewards !== 1 ? "s" : ""} ready!
                                  </span>
                                )}
                                {card.lastStampAt && (
                                  <span className="text-slate-400">Last: {new Date(card.lastStampAt).toLocaleDateString("en-KE")}</span>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span className="text-[11px] italic text-slate-400">No card yet</span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                          <div className="inline-flex items-center gap-1">
                            {hasContact && card && card.currentStamps > 0 && (
                              <button
                                onClick={() => openSmsModal(c, "stamp")}
                                className="inline-flex items-center gap-1 border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700 hover:bg-blue-100"
                                title="Send stamp SMS"
                              >
                                <FaSms /> Stamp
                              </button>
                            )}
                            {hasContact && hasReward && (
                              <button
                                onClick={() => openSmsModal(c, "reward")}
                                className="inline-flex items-center gap-1 border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 hover:bg-amber-100"
                                title="Send reward SMS"
                              >
                                <FaSms /> Reward
                              </button>
                            )}
                            {hasContact && (
                              <button
                                onClick={() => openSmsModal(c)}
                                className="p-1 text-slate-400 hover:text-emerald-700"
                                title={c.phone ? `Send SMS to ${c.phone}` : "Send SMS via M-Pesa masked number"}
                              >
                                <FaSms />
                              </button>
                            )}
                            {canManageLoyalty && (
                              <button
                                onClick={() => openEdit(c)}
                                className="p-1 text-slate-400 hover:text-emerald-700"
                                title="Edit customer"
                              >
                                <FaEdit />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Expanded card detail */}
                      {isExpanded && (
                        <tr className="bg-[#F4F9F6]">
                          <td colSpan={4} className="px-6 py-4">
                            {cardData[c._id] ? (() => {
                              const cd = cardData[c._id].card;
                              if (!cd) return <div className="text-xs italic text-slate-400">No loyalty card yet. Cards are created automatically when a registered plate is washed and paid.</div>;
                              const recentStamps = [...(cd.stampHistory || [])].reverse().slice(0, 10);
                              return (
                                <div className="space-y-3">
                                  <div className="flex flex-wrap items-center gap-4 border border-slate-200 bg-white px-4 py-3">
                                    <div className="flex-1 min-w-[140px]">
                                      <StampDots current={cd.currentStamps} required={stampsRequired} />
                                    </div>
                                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                                      <span><strong className="text-slate-700">{cd.totalStampsEarned}</strong> total earned</span>
                                      <span><strong className="text-slate-700">{cd.totalRewardsRedeemed}</strong> redeemed</span>
                                      {cd.pendingRewards > 0 && (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-black text-amber-700">
                                          <FaGift className="text-[8px]" />{cd.pendingRewards} reward{cd.pendingRewards !== 1 ? "s" : ""} ready
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  {recentStamps.length > 0 && (
                                    <div>
                                      <div className="mb-1 text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">Recent stamps</div>
                                      <div className="divide-y divide-slate-100 border border-slate-200 bg-white">
                                        {recentStamps.map((s, i) => (
                                          <div key={i} className="flex items-center gap-3 px-3 py-1.5 text-[11px]">
                                            {s.wasRedemption
                                              ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-black text-amber-700"><FaGift className="text-[8px]" />Redeemed</span>
                                              : <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-emerald-500"><div className="h-1.5 w-1.5 rounded-full bg-white" /></span>
                                            }
                                            {s.plate && <span className="inline-flex items-center gap-1 font-bold text-slate-700"><FaCar className="text-[9px] text-emerald-600" />{s.plate}</span>}
                                            <span className="text-slate-500">{s.jobNumber || "—"}</span>
                                            <span className="ml-auto text-slate-400">{s.awardedAt ? new Date(s.awardedAt).toLocaleDateString("en-KE") : "—"}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })() : (
                              <div className="text-xs text-slate-400">Loading…</div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-1 text-xs">
              <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="border border-slate-300 bg-white px-3 py-1 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40">Prev</button>
              <span className="border border-slate-300 bg-white px-3 py-1 font-black text-slate-700">{page} / {totalPages}</span>
              <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)} className="border border-slate-300 bg-white px-3 py-1 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40">Next</button>
            </div>
          )}
        </div>
      )}

      {smsTarget && (
        <CwSmsModal
          target={{ _id: smsTarget._id, name: smsTarget.name, phone: smsTarget.phone, maskedMsisdn: smsTarget.maskedMsisdn }}
          defaultBody={smsBody}
          templates={buildTemplates(smsTarget)}
          context={(smsTarget.plates || []).join(", ") || "Loyalty Customer"}
          onSend={sendSms}
          onClose={() => setSmsTarget(null)}
          sending={smsSending}
        />
      )}

      {showCustomerModal && (
        <Modal
          title={editingCustomer ? "Edit Customer" : "Register Customer"}
          onClose={() => setShowCustomerModal(false)}
          footer={
            <>
              <button onClick={() => setShowCustomerModal(false)} className="border border-slate-300 px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              {canManageLoyalty && (
                <button onClick={saveCustomer} disabled={saving} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black uppercase tracking-wide text-white hover:bg-[#0A3127] disabled:opacity-50">
                  {saving ? "Saving…" : editingCustomer ? "Update" : "Register"}
                </button>
              )}
            </>
          }
        >
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Full name *</label>
                <input className={inputClass} value={customerForm.name} onChange={e => setField("name", e.target.value)} placeholder="e.g. John Kamau" />
              </div>
              <div>
                <label className={labelClass}>Phone *</label>
                <input className={inputClass} value={customerForm.phone} onChange={e => setField("phone", e.target.value)} placeholder="e.g. 0722000000" />
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className={labelClass}>Vehicle plates</label>
                <button type="button" onClick={addPlateField} className="text-[11px] font-bold text-emerald-700 hover:underline">+ Add plate</button>
              </div>
              <div className="space-y-1.5">
                {customerForm.plates.map((p, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <input className={`${inputClass} flex-1`} value={p} onChange={e => setPlate(i, e.target.value)} placeholder="e.g. KAA 123X" />
                    {customerForm.plates.length > 1 && (
                      <button type="button" onClick={() => removePlateField(i)} className="px-1 text-rose-400 hover:text-rose-600"><FaTimes /></button>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <label className={labelClass}>Notes</label>
              <input className={inputClass} value={customerForm.notes} onChange={e => setField("notes", e.target.value)} placeholder="Optional" />
            </div>
          </div>
        </Modal>
      )}
    </CarWashShell>
  );
};

export default CarWashLoyalty;
