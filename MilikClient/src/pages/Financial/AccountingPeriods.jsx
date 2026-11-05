import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  FaArchive, FaCalendarAlt, FaCalendarPlus, FaDoorClosed, FaEdit, FaExclamationTriangle, FaKey, FaLock, FaPlus, FaStopCircle, FaSyncAlt, FaTimes, FaTrash, FaUnlock,
} from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { ListToolbar } from "../../components/common/ListToolbar";
import MilikTable from "../../components/common/MilikTable";
import AppSelect from "../../components/common/AppSelect";
import { selectCurrentCompany, selectCurrentUser } from "../../redux/selectors";
import {
  closeAccountingPeriod, closeAccountingYear, createAccountingPeriod, deleteAccountingPeriod, endPostingWindow, generateAccountingYear, openPostingWindow,
  getAccountingPeriodChecklist, getAccountingPeriods, getYearCloseChecklist, lockAccountingPeriod, reopenAccountingPeriod,
  updateAccountingPeriod,
} from "../../redux/apiCalls/accountingPeriods";
import { useConfirm } from "../../context/ConfirmContext";

const labelClass = "mb-1 block text-xs font-bold text-slate-900";
const inputClass = "h-7 w-full border bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-500 outline-none transition focus:ring-1 border-slate-300 focus:border-[#0B3B2E] focus:ring-[#0B3B2E]/20";
const Required = () => <span className="ml-0.5 font-black text-red-600">*</span>;

const STATUS = {
  open:   { label: "Open",   cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  closed: { label: "Closed", cls: "border-amber-200 bg-amber-50 text-amber-700" },
  locked: { label: "Locked", cls: "border-red-200 bg-red-50 text-red-700" },
};
const ACTION_LABEL = {
  created: "Created", closed: "Closed", reopened: "Reopened", locked: "Locked", year_closed: "Year closed", edited: "Edited",
  posting_opened: "Posting window", posting_ended: "Window ended",
};
const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "");

const fmtYmd = (ymd) => (ymd ? new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const fmtWhen = (d) => (d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const fmtMoney = (n) => Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const errorText = (err, fallback) => err?.response?.data?.message || err?.message || fallback;
const lastChange = (p) => [...(p.history || [])].reverse().find((h) => ["closed", "reopened", "locked", "year_closed"].includes(h.action));

// one list per company, so revisiting the tab shows the last list at once while it refreshes
const listCache = new Map();

const Modal = ({ title, icon: Icon, onClose, busy, children, footer, width = "max-w-lg" }) => (
  <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
    <div className={`flex max-h-[92vh] w-full ${width} flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl`}>
      <div className="flex flex-shrink-0 items-center justify-between gap-3 bg-[#0B3B2E] px-4 py-2.5 text-white">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-black uppercase tracking-wide">
          {Icon && <Icon size={12} />}<span className="truncate">{title}</span>
        </h3>
        <button type="button" onClick={() => !busy && onClose()} disabled={busy} className="text-white/70 hover:text-white"><FaTimes size={13} /></button>
      </div>
      <div className="flex-1 overflow-y-auto bg-slate-50/60 p-3">{children}</div>
      <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-white px-4 py-2.5">{footer}</div>
    </div>
  </div>
);
const CancelButton = ({ onClick, busy }) => (
  <button type="button" onClick={onClick} disabled={busy} className="h-8 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
);
const PrimaryButton = ({ children, danger, ...props }) => (
  <button type="button" {...props} className={`inline-flex h-8 items-center gap-1.5 px-4 text-xs font-black text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${danger ? "bg-red-700 hover:bg-red-800" : "bg-[#0B3B2E] hover:bg-[#0A3127]"}`}>
    {children}
  </button>
);

function PeriodFormModal({ period, onClose, onSaved }) {
  const editing = Boolean(period?._id);
  const datesLocked = editing && period.status !== "open";
  const [form, setForm] = useState({
    name: period?.name || "", startDate: period?.startYmd || "", endDate: period?.endYmd || "", notes: period?.notes || "",
  });
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const save = async (e) => {
    e?.preventDefault();
    if (!form.name.trim() || !form.startDate || !form.endDate) { toast.error("Name, start and end dates are required."); return; }
    if (form.endDate < form.startDate) { toast.error("The end date must be on or after the start date."); return; }
    setBusy(true);
    try {
      if (editing) {
        await updateAccountingPeriod(period._id, datesLocked ? { name: form.name, notes: form.notes } : form);
      } else {
        await createAccountingPeriod(form);
      }
      toast.success(editing ? "Period updated" : "Period created");
      onSaved();
    } catch (err) {
      toast.error(errorText(err, "Failed to save the period"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? `Edit ${period.name}` : "New Accounting Period"} icon={FaCalendarAlt} onClose={onClose} busy={busy}
      footer={<><CancelButton onClick={onClose} busy={busy} /><PrimaryButton type="submit" form="period-form" disabled={busy}>Save</PrimaryButton></>}
    >
      <form id="period-form" onSubmit={save} className="grid grid-cols-2 gap-x-3 gap-y-2 border border-slate-200 bg-white p-2.5">
        <label className="col-span-2"><span className={labelClass}>Name<Required /></span>
          <input value={form.name} onChange={set("name")} placeholder="e.g. Oct 2026" className={inputClass} autoFocus />
        </label>
        <label><span className={labelClass}>Start date<Required /></span>
          <input type="date" value={form.startDate} onChange={set("startDate")} disabled={datesLocked} className={`${inputClass} disabled:bg-slate-100`} />
        </label>
        <label><span className={labelClass}>End date<Required /></span>
          <input type="date" value={form.endDate} onChange={set("endDate")} disabled={datesLocked} className={`${inputClass} disabled:bg-slate-100`} />
        </label>
        <label className="col-span-2"><span className={labelClass}>Notes</span>
          <input value={form.notes} onChange={set("notes")} placeholder="Optional" className={inputClass} />
        </label>
        {datesLocked && <p className="col-span-2 text-[11px] text-slate-500">Reopen the period to change its dates.</p>}
      </form>
    </Modal>
  );
}

// The close checklist for one period or a whole fiscal year: warnings to acknowledge, blockers to fix.
function CloseModal({ target, onClose, onDone }) {
  const navigate = useNavigate();
  const isYear = target.kind === "year";
  const [check, setCheck] = useState(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // loads once per target; onClose is read through a ref so a parent re-render doesn't refetch
  useEffect(() => {
    let live = true;
    (isYear ? getYearCloseChecklist(target.fiscalYear.key) : getAccountingPeriodChecklist(target.period._id))
      .then((data) => { if (live) setCheck(data); })
      .catch((err) => { if (live) { toast.error(errorText(err, "Failed to load the checklist")); onCloseRef.current(); } });
    return () => { live = false; };
  }, [isYear, target]);

  const warnings = (check?.items || []).filter((i) => i.count > 0);
  const blockers = isYear ? check?.blockers || [] : check?.blocker ? [check.blocker] : [];
  const name = isYear ? target.fiscalYear.label : target.period.name;

  const run = async () => {
    setBusy(true);
    try {
      if (isYear) await closeAccountingYear(target.fiscalYear.key);
      else await closeAccountingPeriod(target.period._id);
      toast.success(isYear ? `${name} closed. Its periods are locked.` : `${name} closed`);
      onDone();
    } catch (err) {
      toast.error(errorText(err, "Close failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Close ${name}`} icon={isYear ? FaArchive : FaDoorClosed} onClose={onClose} busy={busy} width="max-w-xl"
      footer={<>
        <CancelButton onClick={onClose} busy={busy} />
        <PrimaryButton onClick={run} danger={isYear} disabled={!check || busy || blockers.length > 0 || (warnings.length > 0 && !ack)}>
          {isYear ? <FaArchive size={10} /> : <FaDoorClosed size={10} />} {isYear ? "Close year" : "Close period"}
        </PrimaryButton>
      </>}
    >
      {!check ? (
        <div className="flex h-32 items-center justify-center"><FaSyncAlt className="animate-spin text-slate-400" /></div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-slate-600">
            {isYear
              ? "Closing the year locks all of its periods permanently. Nothing is posted: the Balance Sheet moves this year's profit into Retained Earnings from the next fiscal year."
              : "No entries can be posted into a closed period until it is reopened."}
          </p>
          {blockers.map((b) => (
            <div key={b} className="flex gap-2 border border-red-300 bg-red-50 p-2.5 text-xs text-red-800"><FaExclamationTriangle className="mt-0.5 shrink-0" />{b}</div>
          ))}
          <div className="border border-slate-200 bg-white">
            <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5">
              <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-800">Close checklist</h3>
            </div>
            <div className="divide-y divide-slate-100">
              {check.items.map((item) => (
                <div key={item.key} className="flex items-start justify-between gap-3 px-3 py-1.5 text-xs">
                  <div className="min-w-0">
                    <span className={item.count ? "font-semibold text-amber-800" : "text-slate-500"}>{item.label}</span>
                    {item.count > 0 && item.detail?.length > 0 && <span className="block text-[10px] text-slate-500">{item.detail.join(" · ")}</span>}
                  </div>
                  {item.count > 0 ? (
                    <button type="button" onClick={() => { onClose(); navigate(item.link); }} className="shrink-0 font-black tabular-nums text-amber-800 hover:underline" title="Open">
                      {item.count}
                    </button>
                  ) : (
                    <span className="shrink-0 font-bold text-emerald-700">✓</span>
                  )}
                </div>
              ))}
            </div>
          </div>
          {warnings.length > 0 && blockers.length === 0 && (
            <label className="flex items-start gap-2 border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 accent-[#0B3B2E]" />
              <span>I have reviewed the open items above and want to close anyway.</span>
            </label>
          )}
        </div>
      )}
    </Modal>
  );
}

function ReopenModal({ period, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await reopenAccountingPeriod(period._id, reason.trim());
      toast.success(`${period.name} reopened`);
      onDone();
    } catch (err) {
      toast.error(errorText(err, "Reopen failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Reopen ${period.name}`} icon={FaUnlock} onClose={onClose} busy={busy}
      footer={<><CancelButton onClick={onClose} busy={busy} /><PrimaryButton onClick={run} disabled={busy || reason.trim().length < 5}><FaUnlock size={10} /> Reopen</PrimaryButton></>}
    >
      <div className="border border-slate-200 bg-white p-2.5">
        <label><span className={labelClass}>Reason<Required /></span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} placeholder="e.g. Supplier invoice for October arrived late" className="w-full border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" autoFocus />
        </label>
        <p className="mt-1 text-[11px] text-slate-500">Recorded in the period history and the audit log.</p>
      </div>
    </Modal>
  );
}

// Lets the signed-in user post into a closed period for a few minutes without reopening it.
function PostingWindowModal({ period, onClose, onDone }) {
  const [minutes, setMinutes] = useState(30);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await openPostingWindow(period._id, { minutes, reason: reason.trim() });
      toast.success(`You can post into ${period.name} for ${minutes} minutes`);
      onDone();
    } catch (err) {
      toast.error(errorText(err, "Could not open the posting window"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Post into ${period.name}`} icon={FaKey} onClose={onClose} busy={busy}
      footer={<><CancelButton onClick={onClose} busy={busy} /><PrimaryButton onClick={run} disabled={busy || reason.trim().length < 5}><FaKey size={10} /> Open window</PrimaryButton></>}
    >
      <div className="space-y-2 border border-slate-200 bg-white p-2.5">
        <p className="text-xs text-slate-600">
          {period.name} stays closed for everyone else. Only you can post into it until the window ends. The window and its reason go into the period history and the audit log.
        </p>
        <div>
          <span className={labelClass}>For<Required /></span>
          <div className="flex gap-1">
            {[15, 30, 60].map((m) => (
              <button key={m} type="button" onClick={() => setMinutes(m)} className={`h-7 border px-3 text-xs font-bold ${minutes === m ? "border-[#0B3B2E] bg-[#0B3B2E] text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
                {m} min
              </button>
            ))}
          </div>
        </div>
        <label className="block"><span className={labelClass}>Reason<Required /></span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} placeholder="e.g. Post the late October electricity bill" className="w-full border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" autoFocus />
        </label>
      </div>
    </Modal>
  );
}

export default function AccountingPeriods() {
  const company = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const myKey = String(currentUser?._id || currentUser?.id || "");
  const companyId = company?._id;
  const confirm = useConfirm();

  const [data, setData] = useState(() => listCache.get(companyId) || null);
  const [loading, setLoading] = useState(false);
  const [yearKey, setYearKey] = useState("");
  const [form, setForm] = useState(null);       // period being created / edited
  const [closing, setClosing] = useState(null); // { kind: "period", period } | { kind: "year", fiscalYear }
  const [reopening, setReopening] = useState(null);
  const [windowFor, setWindowFor] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [genOpen, setGenOpen] = useState(false);
  const genRef = useRef(null);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    if (!companyId) return;
    const requestId = ++requestRef.current;
    setLoading(true);
    try {
      const next = await getAccountingPeriods();
      if (requestId !== requestRef.current) return;
      listCache.set(companyId, next);
      setData(next);
    } catch (err) {
      if (requestId === requestRef.current) toast.error(errorText(err, "Failed to load periods"));
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { setData(listCache.get(companyId) || null); load(); }, [companyId, load]);

  const years = useMemo(() => data?.fiscalYears || [], [data]);
  // default to the current fiscal year when it has periods, else the newest one
  useEffect(() => {
    if (!years.length || years.some((y) => y.key === yearKey) || yearKey === "all") return;
    setYearKey(years.find((y) => y.key === data?.currentFiscalYear)?.key || years[0].key);
  }, [years, yearKey, data?.currentFiscalYear]);

  const selectedYear = years.find((y) => y.key === yearKey) || null;
  const rows = useMemo(() => {
    const list = yearKey === "all" ? years : selectedYear ? [selectedYear] : [];
    return list.flatMap((y) => y.periods.map((p) => ({ ...p, fiscalYearLabel: y.label })));
  }, [years, selectedYear, yearKey]);
  const counts = useMemo(() => rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1, entries: acc.entries + (r.entries || 0) }), { entries: 0 }), [rows]);

  const refreshAfter = useCallback(() => { setForm(null); setClosing(null); setReopening(null); setWindowFor(null); load(); }, [load]);

  const generate = async (fy) => {
    setGenOpen(false);
    try {
      const res = await generateAccountingYear(fy.key);
      toast.success(`${res.fiscalYear}: ${res.created} periods created${res.skipped ? `, ${res.skipped} already covered` : ""}`);
      setYearKey(fy.key);
      load();
    } catch (err) {
      toast.error(errorText(err, "Failed to generate the year"));
    }
  };

  const runRowAction = async (period, label, fn, message) => {
    const ok = await confirm({ title: `${label} ${period.name}`, message, confirmText: label, isDangerous: label !== "Close" });
    if (!ok) return;
    setBusyId(period._id);
    try {
      await fn(period._id);
      toast.success(`${period.name}: ${label.toLowerCase()} done`);
      load();
    } catch (err) {
      toast.error(errorText(err, `${label} failed`));
    } finally {
      setBusyId(null);
    }
  };

  const yearOptions = useMemo(() => [
    ...years.map((y) => ({ value: y.key, label: `${y.label}${y.yearClosed ? " · closed" : ""}` })),
    ...(years.length > 1 ? [{ value: "all", label: "All years" }] : []),
  ], [years]);

  const columns = [
    { label: "Period", width: "22%" },
    { label: "Dates", width: "20%" },
    { label: "Status", width: "9%" },
    { label: "Entries", width: "7%", align: "right" },
    { label: "Debits", width: "11%", align: "right" },
    { label: "Credits", width: "11%", align: "right" },
    { label: "Last change", width: "20%" },
  ];

  const cell = "px-3 py-1.5 border-r border-gray-100";

  return (
    <DashboardLayout>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 p-1 sm:p-2">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-slate-200 bg-white">
          <ListToolbar>
            {yearOptions.length > 0 && (
              <AppSelect value={yearKey} onChange={(v) => setYearKey(v || "")} options={yearOptions} placeholder="Fiscal year" compact />
            )}
            {rows.length > 0 && (
              <>
                <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">Open: {counts.open || 0}</span>
                <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">Closed: {counts.closed || 0}</span>
                <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">Locked: {counts.locked || 0}</span>
                <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">Entries: {counts.entries.toLocaleString()}</span>
              </>
            )}
            <div className="ml-auto" />
            <ListToolbar.Button variant="outline" icon={FaSyncAlt} onClick={load} disabled={loading}>Refresh</ListToolbar.Button>
            <ListToolbar.Divider />
            {selectedYear && !selectedYear.yearClosed && (
              <ListToolbar.Button variant="outline" icon={FaArchive} onClick={() => setClosing({ kind: "year", fiscalYear: selectedYear })}>Close {selectedYear.label}</ListToolbar.Button>
            )}
            <ListToolbar.Button ref={genRef} variant="outline" icon={FaCalendarPlus} onClick={() => setGenOpen((o) => !o)} disabled={!data?.suggestions?.length}>Generate Year</ListToolbar.Button>
            <ListToolbar.Menu open={genOpen} onClose={() => setGenOpen(false)} anchorRef={genRef} width="w-52">
              {(data?.suggestions || []).map((fy) => (
                <ListToolbar.MenuItem key={fy.key} icon={FaCalendarPlus} onClick={() => generate(fy)}>
                  {fy.label} <span className="ml-auto text-[10px] text-slate-500">{fy.missing === 12 ? "12 months" : `${fy.missing} missing months`}</span>
                </ListToolbar.MenuItem>
              ))}
            </ListToolbar.Menu>
            <ListToolbar.Divider />
            <ListToolbar.Button icon={FaPlus} onClick={() => setForm({})}>New Period</ListToolbar.Button>
          </ListToolbar>

          {data?.gaps?.length > 0 && (
            <div className="flex flex-none gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-900">
              <FaExclamationTriangle className="mt-0.5 shrink-0" />
              <span>
                No period covers {data.gaps.map((g) => (g.fromYmd === g.toYmd ? fmtYmd(g.fromYmd) : `${fmtYmd(g.fromYmd)} – ${fmtYmd(g.toYmd)}`)).join(", ")}. Those dates stay open for posting and a fiscal year with gaps can't be closed.
              </span>
            </div>
          )}

          <MilikTable
            columns={columns}
            rows={rows}
            loading={loading && !data}
            groupBy={yearKey === "all" ? (r) => r.fiscalYearLabel : undefined}
            tableFixed
            minWidth={900}
            actionsWidth="140px"
            empty={data?.suggestions?.length ? "No periods yet. Use Generate Year to create this fiscal year's twelve months." : "No periods yet."}
            renderRow={(p) => {
              const s = STATUS[p.status] || STATUS.open;
              const change = lastChange(p);
              return (
                <>
                  <td className={`${cell} normal-case`}>
                    <span className="font-bold text-slate-900">{p.name}</span>
                    {p.yearEndClosed && <span className="ml-1.5 border border-slate-300 bg-slate-50 px-1 text-[9px] font-bold text-slate-600">Year closed</span>}
                    {p.notes && <span className="block truncate text-[10px] text-slate-500">{p.notes}</span>}
                    {(p.postingWindows || []).map((w) => (
                      <span key={w.userKey} className="block text-[10px] font-semibold text-amber-800" title={w.reason}>
                        <FaKey size={8} className="mr-1 inline" />Posting open to {w.userKey === myKey ? "you" : w.userName || "a user"} until {fmtTime(w.until)}
                      </span>
                    ))}
                  </td>
                  <td className={`${cell} normal-case text-slate-700`}>{fmtYmd(p.startYmd)} – {fmtYmd(p.endYmd)}</td>
                  <td className={cell}>
                    <span className={`inline-flex items-center gap-1 border px-1.5 py-0.5 text-[9px] font-bold ${s.cls}`}>
                      {p.status === "locked" && <FaLock size={7} />}{s.label}
                    </span>
                  </td>
                  <td className={`${cell} text-right tabular-nums text-slate-700`}>{p.entries ? p.entries.toLocaleString() : "—"}</td>
                  <td className={`${cell} text-right tabular-nums text-slate-700`}>{p.entries ? fmtMoney(p.debit) : "—"}</td>
                  <td className={`${cell} text-right tabular-nums text-slate-700`}>{p.entries ? fmtMoney(p.credit) : "—"}</td>
                  <td className="px-3 py-1.5 normal-case text-slate-600">
                    {change ? (
                      <>
                        <span className="font-semibold text-slate-800">{ACTION_LABEL[change.action]}</span>
                        <span className="ml-1.5 text-slate-500">{change.byName || "—"} · {fmtWhen(change.at)}</span>
                      </>
                    ) : "—"}
                  </td>
                </>
              );
            }}
            renderActions={(p) => {
              const busy = busyId === p._id;
              const btn = "p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40";
              return (
                <div className="flex items-center justify-end gap-0.5">
                  {p.status !== "locked" && <button type="button" title="Edit" disabled={busy} onClick={() => setForm(p)} className={btn}><FaEdit size={12} /></button>}
                  {p.status === "open" && <button type="button" title="Close period" disabled={busy} onClick={() => setClosing({ kind: "period", period: p })} className={btn}><FaDoorClosed size={12} /></button>}
                  {p.status === "closed" && ((p.postingWindows || []).some((w) => w.userKey === myKey) ? (
                    <button type="button" title="End my posting window" disabled={busy} className={btn}
                      onClick={() => runRowAction(p, "End", endPostingWindow, `End your posting window on ${p.name}? It goes back to closed for you too.`)}>
                      <FaStopCircle size={12} />
                    </button>
                  ) : (
                    <button type="button" title="Post into this period for a few minutes" disabled={busy} onClick={() => setWindowFor(p)} className={btn}><FaKey size={12} /></button>
                  ))}
                  {p.status === "closed" && <button type="button" title="Reopen" disabled={busy} onClick={() => setReopening(p)} className={btn}><FaUnlock size={12} /></button>}
                  {p.status === "closed" && (
                    <button type="button" title="Lock permanently" disabled={busy} className={btn}
                      onClick={() => runRowAction(p, "Lock", lockAccountingPeriod, `Lock ${p.name} permanently? A locked period can never be reopened.`)}>
                      <FaLock size={12} />
                    </button>
                  )}
                  {p.status === "open" && (
                    <button type="button" title="Delete" disabled={busy} className="p-1 text-red-600 hover:bg-red-50 hover:text-red-800 disabled:opacity-40"
                      onClick={() => runRowAction(p, "Delete", deleteAccountingPeriod, `Delete ${p.name}? No entries are changed; its dates just stop being covered by a period.`)}>
                      <FaTrash size={12} />
                    </button>
                  )}
                </div>
              );
            }}
            renderExpanded={(p) => (
              <div className="max-w-2xl normal-case">
                <div className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-500">History</div>
                {(p.history || []).length ? (
                  <table className="w-full text-[11px]">
                    <tbody>
                      {[...p.history].reverse().map((h, i) => (
                        <tr key={i} className="border-b border-slate-100">
                          <td className="w-28 py-1 pr-3 font-semibold text-slate-800">{ACTION_LABEL[h.action] || h.action}</td>
                          <td className="w-40 py-1 pr-3 text-slate-600">{h.byName || "—"}</td>
                          <td className="w-40 py-1 pr-3 text-slate-500">{fmtWhen(h.at)}</td>
                          <td className="py-1 text-slate-600">{h.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <p className="text-[11px] text-slate-500">No history recorded.</p>}
              </div>
            )}
          />
        </div>
      </div>

      {form && <PeriodFormModal period={form._id ? form : null} onClose={() => setForm(null)} onSaved={refreshAfter} />}
      {closing && <CloseModal target={closing} onClose={() => setClosing(null)} onDone={refreshAfter} />}
      {reopening && <ReopenModal period={reopening} onClose={() => setReopening(null)} onDone={refreshAfter} />}
      {windowFor && <PostingWindowModal period={windowFor} onClose={() => setWindowFor(null)} onDone={refreshAfter} />}
    </DashboardLayout>
  );
}
