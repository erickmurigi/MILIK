import React, { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import {
  FaCar, FaCog, FaEdit, FaGift, FaRedoAlt, FaSearch,
  FaSms, FaStar, FaStamp, FaTimes, FaUserPlus, FaCheck,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";
import CwSmsModal from "./CwSmsModal";
import useCarWashPermission from "../../hooks/useCarWashPermission";
import { useTabState } from "../../hooks/useTabState";

const inputCls = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const labelCls = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";

// ─── Stamp dots ───────────────────────────────────────────────────────────────
const StampDots = React.memo(({ current, required }) => {
  const safe = Math.max(1, required);
  if (safe > 12) {
    const pct = Math.min((current / safe) * 100, 100);
    return (
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
          <div className="h-1.5 rounded-full bg-amber-400 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="tabular-nums text-[11px] font-black text-slate-700">{current}/{safe}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-0.5">
      {Array.from({ length: safe }, (_, i) => (
        <div
          key={i}
          className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 transition-all ${
            i < current ? "border-amber-500 bg-amber-500" : "border-slate-200 bg-white"
          }`}
        >
          {i < current && <div className="h-1 w-1 rounded-full bg-white" />}
        </div>
      ))}
      <span className="ml-0.5 text-[11px] font-extrabold text-slate-500">{current}/{safe}</span>
    </div>
  );
});

// ─── Stats strip ─────────────────────────────────────────────────────────────
const StatsBadge = React.memo(({ label, value, color = "slate" }) => {
  const colors = {
    slate: "border-slate-200 bg-slate-50 text-slate-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  };
  return (
    <div className={`flex items-center gap-2 border px-3 py-1.5 ${colors[color]}`}>
      <span className="text-[11px] font-semibold">{label}</span>
      <span className="tabular-nums text-sm font-black">{value ?? "—"}</span>
    </div>
  );
});

// ─── Generic modal ────────────────────────────────────────────────────────────
const Modal = ({ title, children, footer, onClose }) => (
  <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
    <div className="w-full max-w-xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
        <h2 className="text-sm font-extrabold uppercase tracking-wide">{title}</h2>
        <button type="button" onClick={onClose} className="p-1 text-white/80 hover:bg-white/10 hover:text-white"><FaTimes /></button>
      </div>
      <div className="p-4">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">{footer}</div>}
    </div>
  </div>
);

// ─── Manual stamp modal ───────────────────────────────────────────────────────
const ManualStampModal = React.memo(({ customer, stampsRequired, mutation, onClose }) => {
  const [count, setCount] = useState(1);
  const [note, setNote]   = useState("");

  const submit = () => {
    mutation.mutate(
      { customerId: customer._id, payload: { count, note } },
      {
        onSuccess: (data) => {
          toast.success(data?.message || `${count} stamp(s) awarded`);
          if (data?.rewardTriggered) toast.info("🎁 Reward triggered!");
          onClose();
        },
        onError: (err) => toast.error(err?.response?.data?.message || "Failed to award stamp"),
      }
    );
  };

  return (
    <Modal
      title={`Award Stamp — ${customer.name}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="border border-slate-300 px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button onClick={submit} disabled={mutation.isPending} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black uppercase tracking-wide text-white hover:bg-[#0A3127] disabled:opacity-50">
            {mutation.isPending ? "Awarding…" : "Award Stamp"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Manual stamps are for corrections only. Normal stamps are earned automatically via paid jobs.
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Stamps to award</label>
            <input
              className={inputCls}
              type="number"
              min={1}
              max={stampsRequired}
              value={count}
              onChange={e => setCount(Math.min(Math.max(Number(e.target.value), 1), stampsRequired))}
            />
          </div>
          <div className="flex items-end pb-0.5 text-xs text-slate-500">
            Progress: {customer.loyaltyCard?.currentStamps ?? 0} → {(customer.loyaltyCard?.currentStamps ?? 0) + count} / {stampsRequired}
          </div>
        </div>
        <div>
          <label className={labelCls}>Reason / note</label>
          <input className={inputCls} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Correcting missed stamp from Jan 5" />
        </div>
      </div>
    </Modal>
  );
});

// ─── Redeem reward modal ──────────────────────────────────────────────────────
const RedeemModal = React.memo(({ customer, businessId, mutation, onClose }) => {
  const [selectedJobId, setSelectedJobId] = useState(null);

  const plate = customer.plates?.[0] || "";
  const { data: jobsData, isLoading } = useQuery({
    queryKey: ["cw-redeem-jobs", businessId, customer._id],
    queryFn: () => carWashApi.listJobs({ search: plate, status: "done", limit: 10 }),
    enabled: Boolean(plate),
    staleTime: 0,
  });
  const jobs = useMemo(() => Array.isArray(jobsData) ? jobsData : (jobsData?.data ?? []), [jobsData]);

  const submit = () => {
    if (!selectedJobId) { toast.error("Select a job to redeem the reward on"); return; }
    mutation.mutate(selectedJobId, {
      onSuccess: () => { toast.success("Reward redeemed!"); onClose(); },
      onError: (err) => toast.error(err?.response?.data?.message || "Redemption failed"),
    });
  };

  return (
    <Modal
      title={`Redeem Reward — ${customer.name}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="border border-slate-300 px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button onClick={submit} disabled={!selectedJobId || mutation.isPending} className="bg-amber-600 px-4 py-1.5 text-xs font-black uppercase tracking-wide text-white hover:bg-amber-700 disabled:opacity-50">
            {mutation.isPending ? "Redeeming…" : "Redeem Reward"}
          </button>
        </>
      }
    >
      <p className="mb-3 text-xs text-slate-600">Select the job to apply the loyalty reward to:</p>
      {isLoading ? (
        <div className="py-6 text-center text-xs text-slate-400">Loading jobs…</div>
      ) : !jobs.length ? (
        <div className="rounded border border-slate-200 py-6 text-center text-xs text-slate-400">
          No recent done jobs found for plate <strong>{plate}</strong>. Complete a wash first.
        </div>
      ) : (
        <div className="divide-y divide-slate-100 border border-slate-200">
          {jobs.map(j => (
            <label
              key={j._id}
              className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-xs transition hover:bg-slate-50 ${selectedJobId === j._id ? "bg-amber-50" : ""}`}
            >
              <input
                type="radio"
                name="redeemJob"
                value={j._id}
                checked={selectedJobId === j._id}
                onChange={() => setSelectedJobId(j._id)}
                className="accent-amber-600"
              />
              <span className="font-bold text-slate-800">{j.jobNumber}</span>
              <span className="text-slate-500">{j.plateNumber}</span>
              <span className="ml-auto text-slate-400">{j.createdAt ? new Date(j.createdAt).toLocaleDateString("en-KE") : "—"}</span>
              <span className="font-semibold text-slate-700">KES {(j.price || 0).toLocaleString()}</span>
            </label>
          ))}
        </div>
      )}
    </Modal>
  );
});

// ─── Bulk SMS modal ───────────────────────────────────────────────────────────
const BulkSmsModal = React.memo(({ count, onSend, onClose, sending }) => {
  const [body, setBody] = useState("");
  return (
    <Modal
      title={`Bulk SMS — ${count} customer${count !== 1 ? "s" : ""}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="border border-slate-300 px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button onClick={() => onSend(body)} disabled={!body.trim() || sending} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black uppercase tracking-wide text-white hover:bg-[#0A3127] disabled:opacity-50">
            {sending ? "Sending…" : `Send to ${count}`}
          </button>
        </>
      }
    >
      <div>
        <label className={labelCls}>Message</label>
        <textarea
          className="h-28 w-full resize-none border border-slate-300 px-2 py-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none"
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Type your message here…"
        />
        <div className="mt-1 text-right text-[10px] text-slate-400">{body.length} chars</div>
      </div>
    </Modal>
  );
});

// ─── Expanded card detail (isolated query per customer) ───────────────────────
const CardDetail = React.memo(({ customerId, businessId, stampsRequired }) => {
  const { data, isLoading } = useQuery({
    queryKey: ["cw-customer-card", customerId, businessId],
    queryFn: () => carWashApi.getCustomerCard(customerId),
    staleTime: 60_000,
  });
  if (isLoading) return <div className="text-xs text-slate-400">Loading…</div>;
  const cd = data?.card;
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
                  : s.isManual
                  ? <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 font-black text-violet-700"><FaStamp className="text-[8px]" />Manual</span>
                  : <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-emerald-500"><div className="h-1.5 w-1.5 rounded-full bg-white" /></span>
                }
                {s.plate && <span className="inline-flex items-center gap-1 font-bold text-slate-700"><FaCar className="text-[9px] text-emerald-600" />{s.plate}</span>}
                <span className="text-slate-500">{s.jobNumber || "—"}</span>
                {s.note && <span className="text-slate-400 italic">"{s.note}"</span>}
                <span className="ml-auto text-slate-400">{s.awardedAt ? new Date(s.awardedAt).toLocaleDateString("en-KE") : "—"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

// ─── Customer row ─────────────────────────────────────────────────────────────
const CustomerRow = React.memo(({
  customer, isExpanded, isSelected, stampsRequired,
  canManage, businessId,
  onExpand, onSelect, onEdit, onSms, onStamp, onRedeem,
}) => {
  const card            = customer.loyaltyCard;
  const pendingRewards  = card?.pendingRewards ?? 0;
  const hasContact      = Boolean(customer.phone || customer.maskedMsisdn);

  return (
    <React.Fragment>
      <tr
        className={`cursor-pointer transition-colors hover:bg-[#F8FBF9] ${pendingRewards > 0 ? "bg-amber-50/40" : "bg-white"}`}
        onClick={() => onExpand(customer._id)}
      >
        {/* Select */}
        <td className="w-8 px-2 py-2 text-center" onClick={e => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onSelect(customer._id)}
            className="accent-emerald-600"
          />
        </td>

        {/* Customer */}
        <td className="px-3 py-2">
          <div className="font-extrabold text-slate-900 leading-tight">{customer.name}</div>
          {customer.phone
            ? <div className="mt-0.5 text-[10px] text-slate-500">{customer.phone}</div>
            : customer.maskedMsisdn
            ? <div className="mt-0.5 text-[10px] font-semibold text-emerald-600">M-Pesa · SMS ready</div>
            : <div className="mt-0.5 text-[10px] italic text-slate-400">No phone</div>
          }
        </td>

        {/* Plates */}
        <td className="w-40 px-3 py-2">
          <div className="flex flex-wrap gap-1">
            {(customer.plates || []).map(p => (
              <span key={p} className="inline-flex items-center gap-1 border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-bold font-mono text-slate-700">
                <FaCar className="text-[8px] text-emerald-600" />{p}
              </span>
            ))}
            {!customer.plates?.length && <span className="text-[10px] text-slate-400">—</span>}
          </div>
        </td>

        {/* Visits */}
        <td className="w-20 px-3 py-2 text-center tabular-nums text-xs text-slate-600">
          {customer.stats?.totalJobs ?? 0}
        </td>

        {/* Last visit */}
        <td className="w-28 px-3 py-2 text-xs text-slate-500">
          {customer.stats?.lastVisit
            ? new Date(customer.stats.lastVisit).toLocaleDateString("en-KE", { day: "2-digit", month: "short" })
            : <span className="italic text-slate-300">—</span>}
        </td>

        {/* Stamps */}
        <td className="px-3 py-2">
          {card ? (
            <div className="space-y-1">
              <StampDots current={card.currentStamps} required={stampsRequired} />
              {pendingRewards > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-black text-amber-700 border border-amber-200">
                  <FaGift className="text-[7px]" /> {pendingRewards}× ready
                </span>
              )}
            </div>
          ) : (
            <span className="text-[10px] italic text-slate-400">No card</span>
          )}
        </td>

        {/* Actions */}
        <td className="w-40 px-3 py-2 text-right" onClick={e => e.stopPropagation()}>
          <div className="inline-flex items-center gap-1">
            {pendingRewards > 0 && (
              <button
                onClick={() => onRedeem(customer)}
                className="inline-flex items-center gap-1 border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 hover:bg-amber-100"
                title="Redeem reward"
              >
                <FaGift className="text-[8px]" /> Redeem
              </button>
            )}
            {canManage && (
              <button
                onClick={() => onStamp(customer)}
                className="inline-flex items-center gap-1 border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-bold text-violet-700 hover:bg-violet-100"
                title="Award manual stamp"
              >
                <FaStamp className="text-[8px]" /> Stamp
              </button>
            )}
            {hasContact && (
              <button
                onClick={() => onSms(customer)}
                className="p-1 text-slate-400 hover:text-emerald-700"
                title="Send SMS"
              >
                <FaSms />
              </button>
            )}
            {canManage && (
              <button
                onClick={() => onEdit(customer)}
                className="p-1 text-slate-400 hover:text-emerald-700"
                title="Edit customer"
              >
                <FaEdit />
              </button>
            )}
          </div>
        </td>
      </tr>

      {isExpanded && (
        <tr className="bg-[#F4F9F6]">
          <td colSpan={7} className="px-6 py-4">
            <CardDetail customerId={customer._id} businessId={businessId} stampsRequired={stampsRequired} />
          </td>
        </tr>
      )}
    </React.Fragment>
  );
});

// ─── Program settings panel ───────────────────────────────────────────────────
const ProgramPanel = React.memo(({ program, onSaved, canManage }) => {
  const [form, setForm] = useState({
    name: "Loyalty Program",
    isActive: true,
    stampsRequired: 10,
    rewardType: "free_wash",
    rewardValue: 0,
    rewardServiceId: "",
    stampExpiryDays: 0,
    smsOnStamp: true,
    smsOnReward: true,
    smsOnPayment: false,
  });
  const [services, setServices] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    carWashApi.listServices({ active: true, limit: 500 })
      .then(d => setServices(Array.isArray(d) ? d : d?.services ?? []))
      .catch(() => {});
  }, []);

  React.useEffect(() => {
    if (!program) return;
    setForm({
      name: program.name || "Loyalty Program",
      isActive: program.isActive !== false,
      stampsRequired: program.stampsRequired ?? 10,
      rewardType: program.rewardType || "free_wash",
      rewardValue: program.rewardValue ?? 0,
      rewardServiceId: program.rewardServiceId ? String(program.rewardServiceId?._id || program.rewardServiceId) : "",
      stampExpiryDays: program.stampExpiryDays ?? 0,
      smsOnStamp: program.smsOnStamp !== false,
      smsOnReward: program.smsOnReward !== false,
      smsOnPayment: Boolean(program.smsOnPayment),
    });
    setDirty(false);
  }, [program]);

  const set = useCallback((key, val) => { setForm(f => ({ ...f, [key]: val })); setDirty(true); }, []);

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
          <label className={labelCls}>Program name</label>
          <input className={inputCls} value={form.name} onChange={e => set("name", e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Washes required for reward</label>
          <input className={inputCls} type="number" min={2} value={form.stampsRequired} onChange={e => set("stampsRequired", Number(e.target.value))} />
        </div>
        <div>
          <label className={labelCls}>Reward type</label>
          <select className={inputCls} value={form.rewardType} onChange={e => set("rewardType", e.target.value)}>
            <option value="free_service">Free specific service</option>
            <option value="free_wash">Free wash (entire job)</option>
            <option value="discount_percent">Discount (%)</option>
            <option value="discount_fixed">Discount (fixed KES)</option>
          </select>
        </div>
        {form.rewardType === "free_service" && (
          <div>
            <label className={labelCls}>Free reward service</label>
            <select className={inputCls} value={form.rewardServiceId} onChange={e => set("rewardServiceId", e.target.value)}>
              <option value="">— Select service —</option>
              {services.map(s => <option key={s._id} value={s._id}>{s.category ? `${s.category} — ${s.name}` : s.name}</option>)}
            </select>
          </div>
        )}
        {(form.rewardType === "discount_percent" || form.rewardType === "discount_fixed") && (
          <div>
            <label className={labelCls}>{form.rewardType === "discount_percent" ? "Discount %" : "Discount KES"}</label>
            <input className={inputCls} type="number" min={0} value={form.rewardValue} onChange={e => set("rewardValue", Number(e.target.value))} />
          </div>
        )}
        <div>
          <label className={labelCls}>Stamp expiry (days, 0 = never)</label>
          <input className={inputCls} type="number" min={0} value={form.stampExpiryDays} onChange={e => set("stampExpiryDays", Number(e.target.value))} />
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
          >
            Migrate Cards
          </button>
          <button
            onClick={async () => {
              try {
                const r = await carWashApi.backfillCustomerStats();
                toast.success(r?.message || "Stats backfill complete");
              } catch (e) {
                toast.error(e?.response?.data?.message || "Stats backfill failed");
              }
            }}
            className="border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100"
          >
            Backfill Stats
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
});

// ─── Main page ────────────────────────────────────────────────────────────────
const emptyForm = { name: "", phone: "", plates: [""], notes: "" };

const CarWashLoyalty = () => {
  const queryClient    = useQueryClient();
  const currentCompany = useSelector(s => s.company?.currentCompany);
  const businessId     = useMemo(() => currentCompany?._id || currentCompany?.id, [currentCompany]);
  const canManage      = useCarWashPermission("carwash-loyalty", "manage");

  // ── View state ───────────────────────────────────────────────────────────
  const [tab, setTab]             = useTabState("/carwash/loyalty:tab", "customers");
  const [search, setSearch]       = useTabState("/carwash/loyalty:search", "");
  const [debouncedSearch, setDebouncedSearch] = useTabState("/carwash/loyalty:debouncedSearch", "");
  const [page, setPage]           = useTabState("/carwash/loyalty:page", 1);
  const [pageSize, setPageSize]   = useTabState("/carwash/loyalty:pageSize", 25);
  const [dormantDays, setDormantDays] = useTabState("/carwash/loyalty:dormantDays", 0);
  const [expandedId, setExpandedId]   = useState(null);

  // ── Selection for bulk SMS ────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkSmsOpen, setBulkSmsOpen] = useState(false);
  const [bulkSmsSending, setBulkSmsSending] = useState(false);

  // ── Modal targets ─────────────────────────────────────────────────────────
  const [smsTarget,    setSmsTarget]    = useState(null);
  const [stampTarget,  setStampTarget]  = useState(null);
  const [redeemTarget, setRedeemTarget] = useState(null);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [editingCustomer,   setEditingCustomer]   = useState(null);
  const [customerForm,      setCustomerForm]       = useState(emptyForm);

  const debounceRef = useRef(null);
  const searchRef   = useRef(null);

  // ── Debounced search ─────────────────────────────────────────────────────
  const handleSearchChange = useCallback(e => {
    const val = e.target.value;
    setSearch(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      setDebouncedSearch(val);
    }, 300);
  }, []);

  const clearSearch = useCallback(() => {
    setSearch("");
    setDebouncedSearch("");
    setPage(1);
  }, []);

  // ── Queries ──────────────────────────────────────────────────────────────
  const programKey = useMemo(() => ["cw-loyalty-program", businessId], [businessId]);
  const { data: programRaw } = useQuery({
    queryKey: programKey,
    queryFn: carWashApi.getLoyaltyProgram,
    staleTime: 5 * 60_000,
    enabled: Boolean(businessId),
  });
  const program = programRaw?.data ?? programRaw ?? null;

  const customersKey = useMemo(
    () => ["cw-loyalty-customers", businessId, debouncedSearch, page, pageSize, dormantDays],
    [businessId, debouncedSearch, page, pageSize, dormantDays]
  );
  const { data: custData, isLoading, error, refetch } = useQuery({
    queryKey: customersKey,
    queryFn: () => carWashApi.listLoyaltyCustomers({
      search: debouncedSearch || undefined,
      page,
      limit: pageSize,
      dormantDays: dormantDays || undefined,
    }),
    staleTime: 30_000,
    placeholderData: prev => prev,
    enabled: Boolean(businessId),
  });

  const customers        = useMemo(() => custData?.data ?? [], [custData]);
  const total            = custData?.total ?? 0;
  const totalPages       = custData?.pages ?? Math.max(1, Math.ceil(total / pageSize));
  const rewardsReady     = custData?.rewardsReadyCount ?? 0;
  const stampsRequired   = program?.stampsRequired ?? 10;

  // ── Mutations ────────────────────────────────────────────────────────────
  const invalidateCustomers = useCallback(() => queryClient.invalidateQueries({ queryKey: ["cw-loyalty-customers", businessId] }), [queryClient, businessId]);
  const invalidateProgram   = useCallback(() => queryClient.invalidateQueries({ queryKey: programKey }), [queryClient, programKey]);

  const registerMutation = useMutation({
    mutationFn: payload => carWashApi.registerLoyaltyCustomer(payload),
    onSuccess: () => { invalidateCustomers(); setShowCustomerModal(false); toast.success("Customer registered"); },
    onError: err => toast.error(err?.response?.data?.message || "Failed to register customer"),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => carWashApi.updateLoyaltyCustomer(id, payload),
    onSuccess: () => { invalidateCustomers(); setShowCustomerModal(false); toast.success("Customer updated"); },
    onError: err => toast.error(err?.response?.data?.message || "Failed to update customer"),
  });
  const stampMutation = useMutation({
    mutationFn: ({ customerId, payload }) => carWashApi.awardManualStamp(customerId, payload),
    onSuccess: () => { invalidateCustomers(); queryClient.invalidateQueries({ queryKey: ["cw-customer-card"] }); },
  });
  const redeemMutation = useMutation({
    mutationFn: jobId => carWashApi.redeemLoyaltyReward(jobId),
    onSuccess: () => { invalidateCustomers(); queryClient.invalidateQueries({ queryKey: ["cw-customer-card"] }); },
  });

  // ── Callbacks ─────────────────────────────────────────────────────────────
  const handleExpand  = useCallback(id => setExpandedId(prev => prev === id ? null : id), []);
  const handleSelect  = useCallback(id => setSelectedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  }), []);
  const handleSelectAll = useCallback(() => {
    setSelectedIds(prev =>
      prev.size === customers.length ? new Set() : new Set(customers.map(c => c._id))
    );
  }, [customers]);

  const handleEdit  = useCallback(c => {
    setEditingCustomer(c);
    setCustomerForm({ name: c.name, phone: c.phone || "", plates: c.plates?.length ? c.plates : [""], notes: c.notes || "" });
    setShowCustomerModal(true);
  }, []);
  const handleSms   = useCallback(c => setSmsTarget(c), []);
  const handleStamp = useCallback(c => setStampTarget(c), []);
  const handleRedeem = useCallback(c => setRedeemTarget(c), []);

  const openAdd = useCallback(() => {
    setEditingCustomer(null);
    setCustomerForm(emptyForm);
    setShowCustomerModal(true);
  }, []);

  const saveCustomer = () => {
    if (!customerForm.name.trim()) { toast.error("Name is required"); return; }
    if (!customerForm.phone.trim()) { toast.error("Phone is required"); return; }
    const plates = customerForm.plates.map(p => p.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")).filter(Boolean);
    const payload = { ...customerForm, plates };
    if (editingCustomer) {
      updateMutation.mutate({ id: editingCustomer._id, payload });
    } else {
      registerMutation.mutate(payload);
    }
  };

  const setField = (key, val) => setCustomerForm(f => ({ ...f, [key]: val }));
  const setPlate = (i, val) => {
    const plates = [...customerForm.plates];
    plates[i] = val.toUpperCase();
    setCustomerForm(f => ({ ...f, plates }));
  };

  const sendBulkSms = async (body) => {
    if (!body.trim() || !selectedIds.size) return;
    setBulkSmsSending(true);
    try {
      await carWashApi.bulkSendCustomerSms({ customerIds: [...selectedIds], body });
      toast.success(`SMS sent to ${selectedIds.size} customer${selectedIds.size !== 1 ? "s" : ""}`);
      setBulkSmsOpen(false);
      setSelectedIds(new Set());
    } catch (err) {
      toast.error(err?.response?.data?.message || "Bulk SMS failed");
    } finally {
      setBulkSmsSending(false);
    }
  };

  const rewardDesc = program
    ? program.rewardType === "free_wash" ? "a free wash"
    : program.rewardType === "free_service" ? "a free service"
    : program.rewardType === "discount_percent" ? `${program.rewardValue}% off`
    : `KES ${program.rewardValue} off`
    : "a reward";

  const buildTemplates = useCallback(c => {
    const card = c.loyaltyCard;
    const name = c.name || "Valued Customer";
    const plates = (c.plates || []).join(", ") || "your vehicle";
    const templates = [];
    if ((card?.currentStamps ?? 0) > 0) {
      const rem = stampsRequired - card.currentStamps;
      templates.push({ label: "Stamp Update", color: "blue", body: `Hi ${name}, stamp ${card.currentStamps}/${stampsRequired} earned for ${plates}. ${rem} more wash${rem !== 1 ? "es" : ""} to earn your reward. Thank you.` });
    }
    if ((card?.pendingRewards ?? 0) > 0) {
      templates.push({ label: "Reward Ready", color: "amber", body: `Hi ${name}, you have earned ${rewardDesc} for ${plates}. Redeem on your next visit. Thank you.` });
    }
    templates.push({ label: "Welcome", color: "green", body: `Hi ${name}, welcome to our loyalty program. Collect ${stampsRequired} stamps to earn ${rewardDesc}. Thank you for choosing us.` });
    templates.push({ label: "Reminder", color: "violet", body: `Hi ${name}, you have ${card?.currentStamps ?? 0}/${stampsRequired} stamps. Visit us again to earn ${rewardDesc}.` });
    return templates;
  }, [program, stampsRequired, rewardDesc]);

  const sendSms = async (phone, body) => {
    if (!smsTarget) return;
    try {
      await carWashApi.sendCustomerSms(smsTarget._id, { ...(phone ? { phone } : {}), body });
      toast.success("SMS sent");
      setSmsTarget(null);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to send SMS");
    }
  };

  const allPageSelected = customers.length > 0 && customers.every(c => selectedIds.has(c._id));

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
          {tab === "customers" && canManage && (
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
        <div className="flex-1 min-h-0 overflow-y-auto p-2">
          <ProgramPanel
            program={program}
            canManage={canManage}
            onSaved={() => invalidateProgram()}
          />
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <div className="flex-1 min-h-0 overflow-y-auto p-2">
            <div className="space-y-3">

              {/* Program chip + stats strip */}
              <div className="flex flex-wrap items-center gap-2">
                {program && (
                  <div className={`inline-flex items-center gap-1.5 border px-3 py-1.5 text-[11px] font-bold ${program.isActive ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-500"}`}>
                    <FaStar className="text-[9px]" />
                    {program.isActive ? "Loyalty active" : "Loyalty inactive"} · {stampsRequired} washes for {rewardDesc}
                  </div>
                )}
                <StatsBadge label="Total members" value={total} color="slate" />
                {rewardsReady > 0 && <StatsBadge label="Rewards ready" value={rewardsReady} color="amber" />}
              </div>

              {/* Controls bar */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Search */}
                <div className="flex min-w-[220px] flex-1 items-center border border-slate-300 bg-white">
                  <FaSearch className="ml-2 shrink-0 text-[11px] text-slate-400" />
                  <input
                    ref={searchRef}
                    value={search}
                    onChange={handleSearchChange}
                    placeholder="Search name, phone or plate…"
                    className="h-9 flex-1 px-2 text-sm text-slate-800 outline-none"
                  />
                  {search && (
                    <button onClick={clearSearch} className="mr-1 text-slate-400 hover:text-slate-600">
                      <FaTimes className="text-[10px]" />
                    </button>
                  )}
                </div>

                {/* Dormancy filter */}
                <select
                  value={dormantDays}
                  onChange={e => { setDormantDays(Number(e.target.value)); setPage(1); }}
                  className="h-9 border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 focus:outline-none"
                >
                  <option value={0}>All customers</option>
                  <option value={30}>Dormant 30+ days</option>
                  <option value={60}>Dormant 60+ days</option>
                  <option value={90}>Dormant 90+ days</option>
                </select>

                <button onClick={refetch} className="h-9 border border-slate-300 bg-white px-2.5 text-slate-500 hover:bg-slate-50" title="Refresh">
                  <FaRedoAlt className="text-[11px]" />
                </button>

                {/* Bulk SMS bar */}
                {selectedIds.size > 0 && (
                  <div className="flex items-center gap-2 border border-emerald-300 bg-emerald-50 px-3 py-1">
                    <FaCheck className="text-[10px] text-emerald-600" />
                    <span className="text-xs font-bold text-emerald-700">{selectedIds.size} selected</span>
                    <button
                      onClick={() => setBulkSmsOpen(true)}
                      className="inline-flex items-center gap-1 border border-emerald-600 bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-emerald-700"
                    >
                      <FaSms className="text-[10px]" /> Send SMS
                    </button>
                    <button onClick={() => setSelectedIds(new Set())} className="text-slate-400 hover:text-slate-600">
                      <FaTimes className="text-[10px]" />
                    </button>
                  </div>
                )}

                <span className="ml-auto text-[11px] font-semibold text-slate-500">{total} customer{total !== 1 ? "s" : ""}</span>
              </div>

              {/* Table */}
              <div className="overflow-x-auto border border-slate-200 bg-white shadow-sm">
                <table className="w-full min-w-[760px] text-xs">
                  <thead>
                    <tr className="bg-[#0B3B2E] text-white">
                      <th className="w-8 px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={allPageSelected}
                          onChange={handleSelectAll}
                          className="accent-emerald-400"
                          title="Select all on this page"
                        />
                      </th>
                      <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.15em]">Customer</th>
                      <th className="w-40 px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.15em]">Plates</th>
                      <th className="w-20 px-3 py-2 text-center text-[10px] font-black uppercase tracking-[0.15em]">Visits</th>
                      <th className="w-28 px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.15em]">Last Visit</th>
                      <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.15em]">Stamps</th>
                      <th className="w-40 px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.15em]">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {isLoading ? (
                      <tr><td colSpan={7} className="py-10 text-center text-xs text-slate-400">Loading…</td></tr>
                    ) : error ? (
                      <tr><td colSpan={7} className="py-10 text-center text-xs text-rose-400">Failed to load customers</td></tr>
                    ) : customers.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-16 text-center">
                          <FaStar className="mx-auto mb-2 text-3xl text-slate-200" />
                          <div className="text-sm font-semibold text-slate-400">No customers found</div>
                          <div className="mt-1 text-xs text-slate-400">
                            {debouncedSearch ? "Try a different search term" : "Register a customer or create a job — plates enrol automatically"}
                          </div>
                        </td>
                      </tr>
                    ) : customers.map(c => (
                      <CustomerRow
                        key={c._id}
                        customer={c}
                        isExpanded={expandedId === c._id}
                        isSelected={selectedIds.has(c._id)}
                        stampsRequired={stampsRequired}
                        canManage={canManage}
                        businessId={businessId}
                        onExpand={handleExpand}
                        onSelect={handleSelect}
                        onEdit={handleEdit}
                        onSms={handleSms}
                        onStamp={handleStamp}
                        onRedeem={handleRedeem}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Pagination */}
          <div className="flex-shrink-0 flex min-h-9 items-center justify-between border-t border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-500 normal-case">Per page:</span>
              <select
                value={pageSize}
                onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
                className="h-7 border border-slate-200 bg-slate-50 px-2 text-xs font-bold text-slate-700 focus:border-emerald-400 focus:outline-none normal-case"
              >
                {[25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage(p => Math.max(p - 1, 1))}
                disabled={page <= 1 || isLoading}
                className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:cursor-not-allowed disabled:opacity-45"
              >
                Previous
              </button>
              <span>Page {page} of {totalPages}</span>
              <button
                type="button"
                onClick={() => setPage(p => Math.min(p + 1, totalPages))}
                disabled={page >= totalPages || isLoading}
                className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:cursor-not-allowed disabled:opacity-45"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Individual SMS */}
      {smsTarget && (
        <CwSmsModal
          target={{ _id: smsTarget._id, name: smsTarget.name, phone: smsTarget.phone, maskedMsisdn: smsTarget.maskedMsisdn }}
          defaultBody=""
          templates={buildTemplates(smsTarget)}
          context={(smsTarget.plates || []).join(", ") || "Loyalty Customer"}
          onSend={sendSms}
          onClose={() => setSmsTarget(null)}
        />
      )}

      {/* Manual stamp */}
      {stampTarget && (
        <ManualStampModal
          customer={stampTarget}
          stampsRequired={stampsRequired}
          mutation={stampMutation}
          onClose={() => setStampTarget(null)}
        />
      )}

      {/* Redeem reward */}
      {redeemTarget && (
        <RedeemModal
          customer={redeemTarget}
          businessId={businessId}
          mutation={redeemMutation}
          onClose={() => setRedeemTarget(null)}
        />
      )}

      {/* Bulk SMS */}
      {bulkSmsOpen && (
        <BulkSmsModal
          count={selectedIds.size}
          onSend={sendBulkSms}
          onClose={() => setBulkSmsOpen(false)}
          sending={bulkSmsSending}
        />
      )}

      {/* Register / edit customer */}
      {showCustomerModal && (
        <Modal
          title={editingCustomer ? "Edit Customer" : "Register Customer"}
          onClose={() => setShowCustomerModal(false)}
          footer={
            <>
              <button onClick={() => setShowCustomerModal(false)} className="border border-slate-300 px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              {canManage && (
                <button
                  onClick={saveCustomer}
                  disabled={registerMutation.isPending || updateMutation.isPending}
                  className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black uppercase tracking-wide text-white hover:bg-[#0A3127] disabled:opacity-50"
                >
                  {(registerMutation.isPending || updateMutation.isPending) ? "Saving…" : editingCustomer ? "Update" : "Register"}
                </button>
              )}
            </>
          }
        >
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Full name *</label>
                <input className={inputCls} value={customerForm.name} onChange={e => setField("name", e.target.value)} placeholder="e.g. John Kamau" />
              </div>
              <div>
                <label className={labelCls}>Phone *</label>
                <input className={inputCls} value={customerForm.phone} onChange={e => setField("phone", e.target.value)} placeholder="e.g. 0722000000" />
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className={labelCls}>Vehicle plates</label>
                <button
                  type="button"
                  onClick={() => setCustomerForm(f => ({ ...f, plates: [...f.plates, ""] }))}
                  className="text-[11px] font-bold text-emerald-700 hover:underline"
                >
                  + Add plate
                </button>
              </div>
              <div className="space-y-1.5">
                {customerForm.plates.map((p, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <input className={`${inputCls} flex-1`} value={p} onChange={e => setPlate(i, e.target.value)} placeholder="e.g. KAA 123X" />
                    {customerForm.plates.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setCustomerForm(f => ({ ...f, plates: f.plates.filter((_, idx) => idx !== i) }))}
                        className="px-1 text-rose-400 hover:text-rose-600"
                      >
                        <FaTimes />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <label className={labelCls}>Notes</label>
              <input className={inputCls} value={customerForm.notes} onChange={e => setField("notes", e.target.value)} placeholder="Optional" />
            </div>
          </div>
        </Modal>
      )}
    </CarWashShell>
  );
};

export default CarWashLoyalty;
