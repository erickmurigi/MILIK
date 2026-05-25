import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FaCar, FaCheckCircle, FaCog, FaEdit, FaGift, FaPlus,
  FaRedoAlt, FaSearch, FaSms, FaStar, FaTimes, FaUser, FaUserPlus,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";

const inputClass = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const labelClass = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";

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

const StampBar = ({ current, required }) => {
  const pct = required > 0 ? Math.min((current / required) * 100, 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 overflow-hidden rounded-full bg-slate-100 h-2">
        <div className="h-2 rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] font-black text-slate-600 tabular-nums whitespace-nowrap">{current}/{required}</span>
    </div>
  );
};

const emptyCustomer = { name: "", phone: "", plates: [""], notes: "" };

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
    <div className="border border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
        <FaCog className="text-emerald-700 text-[13px]" />
        <span className="text-xs font-black uppercase tracking-wide text-slate-700">Program Settings</span>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 cursor-pointer">
            <input type="checkbox" checked={form.isActive} onChange={e => set("isActive", e.target.checked)} className="accent-emerald-600" />
            Active
          </label>
        </div>
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
        <div className="text-[11px] font-black uppercase tracking-wide text-slate-500 mb-2">SMS Notifications</div>
        <div className="flex flex-wrap gap-4">
          {[
            { key: "smsOnStamp", label: "On each stamp earned" },
            { key: "smsOnReward", label: "When reward is ready" },
            { key: "smsOnPayment", label: "On payment confirmation" },
          ].map(({ key, label }) => (
            <label key={key} className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer">
              <input type="checkbox" checked={form[key]} onChange={e => set(key, e.target.checked)} className="accent-emerald-600" />
              {label}
            </label>
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2.5">
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black uppercase tracking-wide text-white hover:bg-[#0A3127] disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save Program"}
        </button>
      </div>
    </div>
  );
};

// ─── Main page ────────────────────────────────────────────────────────────────
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
  const [tab, setTab] = useState("customers"); // "customers" | "program"
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
    setCustomerForm({ name: c.name, phone: c.phone, plates: c.plates?.length ? c.plates : [""], notes: c.notes || "" });
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

  const openSmsModal = (customer) => {
    setSmsTarget(customer);
    const card = customer.loyaltyCard;
    const stampsText = card ? `${card.currentStamps}/${program?.stampsRequired ?? 10} stamps` : "no stamps yet";
    setSmsBody(`Hi ${customer.name}, your car wash loyalty card has ${stampsText}. Thank you for being a loyal customer!`);
  };

  const sendSms = async () => {
    if (!smsTarget || !smsBody.trim()) return;
    setSmsSending(true);
    try {
      await carWashApi.sendCustomerSms(smsTarget._id, { phone: smsTarget.phone, body: smsBody.trim() });
      toast.success("SMS sent successfully");
      setSmsTarget(null);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to send SMS");
    } finally {
      setSmsSending(false);
    }
  };

  const stampsRequired = program?.stampsRequired ?? 10;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <CarWashShell activePage="loyalty">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-2 py-3 sm:px-4">
          <div className="flex flex-wrap items-center gap-3 justify-between sm:justify-start">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Car Wash</div>
              <h1 className="text-sm font-black text-slate-900">Customer Loyalty</h1>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {/* Tabs */}
              <div className="flex border border-slate-200 overflow-hidden text-[11px] font-black uppercase tracking-wide">
                {[["customers", "Customers", FaUser], ["program", "Program Settings", FaCog]].map(([key, label, Icon]) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 transition ${tab === key ? "bg-[#0B3B2E] text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
                  >
                    <Icon className="text-[10px]" />{label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-4">
          {tab === "program" ? (
            <ProgramPanel program={program} onSaved={p => setProgram(p)} />
          ) : (
            <>
              {/* Program summary chip */}
              {program && (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold border ${program.isActive ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-slate-100 border-slate-200 text-slate-500"}`}>
                    <FaStar className="text-[9px]" />
                    {program.isActive ? "Loyalty active" : "Loyalty inactive"} · {program.stampsRequired} washes for{" "}
                    {program.rewardType === "free_wash" ? "a free wash" : program.rewardType === "discount_percent" ? `${program.rewardValue}% off` : `KES ${program.rewardValue} off`}
                  </div>
                  {!program.isActive && (
                    <span className="text-[11px] text-amber-600 font-semibold">Enable the program in Settings to start earning stamps.</span>
                  )}
                </div>
              )}

              {/* Toolbar */}
              <div className="mb-3 flex flex-wrap items-center gap-2 justify-between sm:justify-start">
                <div className="flex flex-1 min-w-0 sm:min-w-[220px] items-center border border-slate-300 bg-white">
                  <FaSearch className="ml-2 text-slate-400 text-[11px] shrink-0" />
                  <input
                    ref={searchRef}
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && applySearch()}
                    placeholder="Search name, phone or plate…"
                    className="h-9 flex-1 px-2 text-sm text-slate-800 outline-none"
                  />
                  {search && <button onClick={() => { setSearch(""); setAppliedSearch(""); }} className="mr-1 text-slate-400 hover:text-slate-600"><FaTimes className="text-[10px]" /></button>}
                </div>
                <button onClick={applySearch} className="h-9 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">Search</button>
                <button onClick={loadCustomers} className="h-9 border border-slate-300 bg-white px-2.5 text-slate-500 hover:bg-slate-50" title="Refresh"><FaRedoAlt className="text-[11px]" /></button>
                <button onClick={openAdd} className="ml-auto flex h-9 items-center gap-1.5 bg-[#0B3B2E] px-3 text-xs font-black uppercase tracking-wide text-white hover:bg-[#0A3127]">
                  <FaUserPlus className="text-[11px]" /> Register Customer
                </button>
              </div>

              {/* Customer table */}
              <div className="overflow-x-auto border border-slate-200 bg-white">
                <table className="w-full min-w-[640px] text-xs">
                  <thead>
                    <tr className="bg-slate-900 text-white">
                      <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.16em]">Customer</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.16em]">Plates</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.16em]">Stamps / Rewards</th>
                      <th className="px-4 py-2.5 text-right text-[10px] font-black uppercase tracking-[0.16em]">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loading ? (
                      <tr><td colSpan={4} className="py-10 text-center text-xs text-slate-400">Loading…</td></tr>
                    ) : customers.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-14 text-center">
                          <FaUser className="mx-auto mb-2 text-2xl text-slate-200" />
                          <div className="text-sm font-semibold text-slate-400">No customers yet</div>
                          <div className="text-xs text-slate-400 mt-1">Register a customer to start tracking loyalty</div>
                        </td>
                      </tr>
                    ) : customers.map(c => {
                      const card = c.loyaltyCard;
                      const isExpanded = expandedId === c._id;
                      const pendingRewards = card?.pendingRewards ?? 0;
                      return (
                        <React.Fragment key={c._id}>
                          <tr
                            className="group cursor-pointer bg-white hover:bg-slate-50 transition"
                            onClick={() => toggleExpand(c)}
                          >
                            <td className="px-4 py-3">
                              <div className="font-black text-slate-900">{c.name}</div>
                              <div className="text-[11px] text-slate-500">{c.phone}</div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-1">
                                {(c.plates || []).map(p => (
                                  <span key={p} className="inline-flex items-center gap-1 bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                                    <FaCar className="text-[9px] text-emerald-600" />{p}
                                  </span>
                                ))}
                                {!c.plates?.length && <span className="text-[11px] text-slate-400">—</span>}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              {card ? (
                                <div className="space-y-1.5">
                                  <StampBar current={card.currentStamps} required={stampsRequired} />
                                  <div className="flex items-center gap-2 text-[11px] text-slate-500">
                                    <span>{card.totalStampsEarned} total stamps</span>
                                    {pendingRewards > 0 && (
                                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-700">
                                        <FaGift className="text-[8px]" /> {pendingRewards} reward{pendingRewards !== 1 ? "s" : ""} ready
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <span className="text-[11px] text-slate-400">No card yet</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {c.phone && (
                                <button
                                  onClick={e => { e.stopPropagation(); openSmsModal(c); }}
                                  className="mr-2 text-slate-400 hover:text-emerald-700"
                                  title={`Send SMS to ${c.phone}`}
                                >
                                  <FaSms />
                                </button>
                              )}
                              <button
                                onClick={e => { e.stopPropagation(); openEdit(c); }}
                                className="mr-2 text-slate-400 hover:text-emerald-700"
                                title="Edit"
                              >
                                <FaEdit />
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-slate-50">
                              <td colSpan={4} className="px-6 py-3">
                                {cardData[c._id] ? (
                                  <div className="space-y-2">
                                    <div className="text-[11px] font-black uppercase tracking-wide text-slate-500 mb-1">Loyalty Cards</div>
                                    {cardData[c._id].cards?.length ? cardData[c._id].cards.map(card => (
                                      <div key={card._id} className="flex items-center gap-4 border border-slate-200 bg-white px-3 py-2">
                                        <span className="inline-flex items-center gap-1 font-black text-slate-800 text-xs">
                                          <FaCar className="text-emerald-600 text-[10px]" />{card.plate}
                                        </span>
                                        <div className="flex-1">
                                          <StampBar current={card.currentStamps} required={stampsRequired} />
                                        </div>
                                        <div className="flex items-center gap-3 text-[11px] text-slate-500">
                                          <span>{card.totalStampsEarned} earned</span>
                                          <span>{card.totalRewardsRedeemed} redeemed</span>
                                          {card.pendingRewards > 0 && (
                                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-black text-amber-700">
                                              <FaGift className="text-[8px]" />{card.pendingRewards} ready
                                            </span>
                                          )}
                                          {card.lastStampAt && (
                                            <span>Last: {new Date(card.lastStampAt).toLocaleDateString("en-KE")}</span>
                                          )}
                                        </div>
                                      </div>
                                    )) : (
                                      <div className="text-xs text-slate-400">No loyalty cards yet. Cards are created automatically when a registered plate is washed.</div>
                                    )}
                                  </div>
                                ) : (
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
                <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                  <span>{total} customer{total !== 1 ? "s" : ""}</span>
                  <div className="flex gap-1">
                    <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="border border-slate-300 px-2 py-1 disabled:opacity-40 hover:bg-slate-50">Prev</button>
                    <span className="border border-slate-300 px-3 py-1 font-bold">{page}/{totalPages}</span>
                    <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)} className="border border-slate-300 px-2 py-1 disabled:opacity-40 hover:bg-slate-50">Next</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {smsTarget && (
        <Modal
          title="Send SMS"
          onClose={() => setSmsTarget(null)}
          footer={
            <>
              <button onClick={() => setSmsTarget(null)} className="border border-slate-300 px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={sendSms} disabled={smsSending || !smsBody.trim()} className="inline-flex items-center gap-1.5 bg-[#0B3B2E] px-4 py-1.5 text-xs font-black uppercase tracking-wide text-white hover:bg-[#0A3127] disabled:opacity-50">
                <FaSms className="text-[10px]" />
                {smsSending ? "Sending…" : "Send SMS"}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">To</label>
              <div className="text-sm font-semibold text-slate-800">{smsTarget.name} · <span className="text-slate-500">{smsTarget.phone}</span></div>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Message *</label>
              <textarea
                className="min-h-24 w-full border border-slate-300 px-2 py-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none"
                value={smsBody}
                onChange={e => setSmsBody(e.target.value)}
                maxLength={320}
              />
              <div className="mt-1 text-right text-[10px] text-slate-400">{smsBody.length}/320</div>
            </div>
          </div>
        </Modal>
      )}

      {/* Customer modal */}
      {showCustomerModal && (
        <Modal
          title={editingCustomer ? "Edit Customer" : "Register Customer"}
          onClose={() => setShowCustomerModal(false)}
          footer={
            <>
              <button onClick={() => setShowCustomerModal(false)} className="border border-slate-300 px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={saveCustomer} disabled={saving} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black uppercase tracking-wide text-white hover:bg-[#0A3127] disabled:opacity-50">
                {saving ? "Saving…" : editingCustomer ? "Update" : "Register"}
              </button>
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
                <button type="button" onClick={addPlateField} className="text-[11px] text-emerald-700 font-bold hover:underline">+ Add plate</button>
              </div>
              <div className="space-y-1.5">
                {customerForm.plates.map((p, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <input
                      className={inputClass + " flex-1"}
                      value={p}
                      onChange={e => setPlate(i, e.target.value)}
                      placeholder={`e.g. KAA 123X`}
                    />
                    {customerForm.plates.length > 1 && (
                      <button type="button" onClick={() => removePlateField(i)} className="text-rose-400 hover:text-rose-600 px-1"><FaTimes /></button>
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
