import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  FaArrowLeft, FaBalanceScale, FaBook, FaCheckCircle, FaCopy, FaExclamationTriangle, FaPlus, FaSave, FaTag, FaTimes, FaTrash, FaUndo,
} from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import AppSelect from "../../components/common/AppSelect";
import JournalEntriesDrawer from "../../components/Accounting/JournalEntriesDrawer";
import { selectCurrentCompany, selectCurrentUser, selectAllProperties } from "../../redux/selectors";
import { getProperties } from "../../redux/propertyRedux";
import {
  createJournalEntry, getChartOfAccounts, getJournalEntry, postJournalEntry, reverseJournalEntry, updateJournalEntry,
} from "../../redux/apiCalls";
import { saleApi } from "../../services/propertySaleApi";
import { hasCompanyModule } from "../../utils/companyModules";
import { hasCompanyPermission } from "../../utils/permissions";
import { useConfirm } from "../../context/ConfirmContext";
import useScopedSessionDraft, { buildScopedDraftKey } from "../../hooks/useScopedSessionDraft";

// Multi-line journal: any number of debit / credit lines that must balance, for any company and any purpose. Every line
// can carry optional tags (cost centre for everyone; project, unit, deal, agent, property where the company has them) so reports can slice the ledger. Tags for a
// module only appear when the company has that module; a company with none of them still gets the full journal.
const LINE_TYPES = [
  { value: "general_manual_journal", label: "General journal" },
  { value: "adjustment", label: "Adjustment" },
  { value: "accrual", label: "Accrual" },
  { value: "reclassification", label: "Reclassification" },
  { value: "allocation", label: "Allocation" },
  { value: "opening_balance", label: "Opening balance" },
  { value: "company_journal", label: "Company (internal) journal" },
];
const TYPE_LABELS = Object.fromEntries(LINE_TYPES.map((t) => [t.value, t.label]));
const STATUS_STYLES = {
  draft: "bg-slate-100 text-slate-700 border-slate-200",
  posted: "bg-green-100 text-green-700 border-green-200",
  reversed: "bg-amber-100 text-amber-700 border-amber-200",
};
const GRID = "grid grid-cols-[2rem_minmax(230px,2.2fr)_minmax(150px,1.6fr)_9.5rem_9.5rem_5.5rem_4.5rem] items-start gap-x-2";
const inputCls = "h-8 w-full rounded border border-slate-200 bg-white px-2 text-xs text-slate-900 outline-none placeholder:text-slate-300 focus:border-[#0B3B2E] disabled:bg-slate-50";
const labelCls = "mb-1 block text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500";

const today = () => new Date().toISOString().split("T")[0];
let lineSeq = 0;
const newLine = (over = {}) => ({ key: `l${++lineSeq}`, account: "", description: "", debit: "", credit: "", tags: {}, tagsOpen: false, ...over });
const blankDoc = () => ({
  date: today(), journalType: "general_manual_journal", reference: "", narration: "",
  lines: [newLine(), newLine()],
});

const cents = (v) => {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const money = (c) => (c / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cleanAmount = (raw) => {
  const s = String(raw).replace(/[^0-9.]/g, "");
  const i = s.indexOf(".");
  return i === -1 ? s : `${s.slice(0, i + 1)}${s.slice(i + 1).replace(/\./g, "").slice(0, 2)}`;
};
const idOf = (v) => (v && typeof v === "object" ? v._id : v) || "";

// Saved journal -> editable form (populated refs collapse to ids)
const docFromJournal = (j) => ({
  date: j.date ? new Date(j.date).toISOString().split("T")[0] : today(),
  journalType: j.journalType || "general_manual_journal",
  reference: j.reference || "",
  narration: j.narration || "",
  lines: (j.lines || []).map((l) => newLine({
    account: idOf(l.account),
    description: l.description || "",
    debit: l.debit ? String(l.debit) : "",
    credit: l.credit ? String(l.credit) : "",
    tags: Object.fromEntries(
      Object.entries(l.dimensions || {}).map(([k, v]) => [k, idOf(v)]).filter(([, v]) => v)
    ),
  })),
});

const TAG_FIELDS = [
  { key: "project", label: "Project", module: "propertySale" },
  { key: "listing", label: "Unit / listing", module: "propertySale" },
  { key: "deal", label: "Deal", module: "propertySale" },
  { key: "agent", label: "Agent", module: "propertySale" },
  { key: "property", label: "Property", module: "propertyManagement" },
];

const JournalEntryForm = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const confirm = useConfirm();
  const company = useSelector(selectCurrentCompany);
  const user = useSelector(selectCurrentUser);
  const properties = useSelector(selectAllProperties);
  const isNew = !id;
  const copyFrom = isNew ? location.state?.copyFrom : null;
  const base = location.pathname.startsWith("/financial/") ? "/financial/journals" : "/accounts/journals";

  const can = useMemo(() => ({
    create: hasCompanyPermission(user || {}, company, "journals", "create", "accounts"),
    update: hasCompanyPermission(user || {}, company, "journals", "update", "accounts"),
    post: hasCompanyPermission(user || {}, company, "journals", "process", "accounts"),
    reverse: hasCompanyPermission(user || {}, company, "journals", "reverse", "accounts"),
  }), [user, company]);

  const hasSales = hasCompanyModule(company, "propertySale");
  const hasPM = hasCompanyModule(company, "propertyManagement");
  const tagFields = useMemo(() => TAG_FIELDS.filter((f) => (f.module === "propertySale" ? hasSales : hasPM)), [hasSales, hasPM]);

  // ---- document state (a new journal keeps its work in the session so a refresh or a tab switch loses nothing)
  const draftKey = buildScopedDraftKey({ page: "journal-form", companyId: company?._id, userId: user?._id || user?.id || user?.email, extra: "new" });
  const [doc, setDoc, clearDraft] = useScopedSessionDraft(
    draftKey,
    () => (copyFrom ? { ...docFromJournal(copyFrom), date: today(), reference: "" } : blankDoc()),
    { enabled: isNew && !copyFrom }
  );
  const [saved, setSaved] = useState(null); // the journal as stored (edit / view)
  const [loading, setLoading] = useState(!isNew);
  const [busy, setBusy] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [tagData, setTagData] = useState({ projects: [], agents: [], listings: [], deals: [], loaded: false });
  const formRef = useRef(null);

  // a stored draft from the session may hold lines created before a reload: keep line keys unique
  useEffect(() => {
    lineSeq = Math.max(lineSeq, ...((doc.lines || []).map((l) => Number(String(l.key).slice(1)) || 0)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!company?._id) return;
    let live = true;
    getChartOfAccounts({ business: company._id })
      .then((rows) => live && setAccounts((Array.isArray(rows) ? rows : []).filter((r) => r?.isPosting !== false && r?.isHeader !== true && r?.active !== false)))
      .catch((e) => toast.error(e?.response?.data?.message || "Failed to load chart of accounts"));
    if (hasPM) dispatch(getProperties({ business: company._id }));
    return () => { live = false; };
  }, [company?._id, hasPM, dispatch]);

  useEffect(() => {
    if (isNew || !id) return;
    let live = true;
    setLoading(true);
    getJournalEntry(id)
      .then((j) => {
        if (!live) return;
        setSaved(j);
        if (j.lines?.length) setDoc(docFromJournal(j));
      })
      .catch((e) => { toast.error(e?.response?.data?.message || "Failed to load journal"); navigate(base, { replace: true }); })
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // sale tags are loaded the first time a tag panel opens (most journals never need them)
  const anyTagsOpen = (doc.lines || []).some((l) => l.tagsOpen);
  useEffect(() => {
    if (!hasSales || !anyTagsOpen || tagData.loaded) return;
    setTagData((p) => ({ ...p, loaded: true }));
    Promise.all([
      saleApi.listProjects({ limit: 200 }), saleApi.listAgents({ limit: 200 }),
      saleApi.listListings({ limit: 500 }), saleApi.listDeals({ limit: 200 }),
    ]).then(([p, a, l, d]) => setTagData({ projects: p.data || [], agents: a.data || [], listings: l.data || [], deals: d.data || [], loaded: true }))
      .catch(() => toast.error("Could not load project / deal tags"));
  }, [hasSales, anyTagsOpen, tagData.loaded]);

  const status = saved?.status || "draft";
  const legacy = Boolean(saved && !saved.lines?.length); // two-line owner / property journal
  const readOnly = !isNew && (status !== "draft" || legacy);
  const canEditNow = isNew ? can.create : can.update;

  const accountById = useMemo(() => new Map(accounts.map((a) => [String(a._id), a])), [accounts]);
  const accountOptions = useMemo(() => accounts.map((a) => ({
    value: a._id,
    label: `${a.code} – ${a.name}`,
    description: [a.type ? a.type[0].toUpperCase() + a.type.slice(1) : "", a.subGroup || a.group || ""].filter(Boolean).join(" · "),
  })), [accounts]);
  const options = useMemo(() => ({
    project: tagData.projects.map((p) => ({ value: p._id, label: [p.projectNumber, p.name].filter(Boolean).join(" · ") })),
    agent: tagData.agents.map((a) => ({ value: a._id, label: [a.agentNumber, a.fullName].filter(Boolean).join(" · ") })),
    deal: tagData.deals.map((d) => ({ value: d._id, label: d.dealNumber })),
    property: properties.map((p) => ({ value: p._id, label: p.propertyName || p.name || "Property" })),
  }), [tagData, properties]);
  const listingOptionsFor = (line) => tagData.listings
    .filter((l) => !line.tags.project || String(idOf(l.project)) === String(line.tags.project))
    .map((l) => ({ value: l._id, label: [l.listingNumber, l.unitNumber ? `Unit ${l.unitNumber}` : l.title].filter(Boolean).join(" · ") }));

  // ---- editing
  const patch = useCallback((patchDoc) => setDoc((d) => ({ ...d, ...patchDoc })), [setDoc]);
  const patchLine = useCallback((key, p) => setDoc((d) => ({ ...d, lines: d.lines.map((l) => (l.key === key ? { ...l, ...p } : l)) })), [setDoc]);
  const setTag = (line, key, value) => {
    const tags = { ...line.tags };
    if (value) tags[key] = value; else delete tags[key];
    if (key === "project") delete tags.listing; // a unit belongs to one project
    patchLine(line.key, { tags });
  };
  const addLine = (over = {}, focus = true) => {
    const line = newLine(over);
    setDoc((d) => ({ ...d, lines: [...d.lines, line] }));
    if (focus) setTimeout(() => formRef.current?.querySelector(`[data-row="${line.key}"] button`)?.focus(), 30);
  };
  const removeLine = (key) => setDoc((d) => (d.lines.length <= 2 ? d : { ...d, lines: d.lines.filter((l) => l.key !== key) }));
  const duplicateLine = (line) => setDoc((d) => {
    const i = d.lines.findIndex((l) => l.key === line.key);
    const copy = { ...line, key: `l${++lineSeq}`, tags: { ...line.tags }, tagsOpen: false };
    return { ...d, lines: [...d.lines.slice(0, i + 1), copy, ...d.lines.slice(i + 1)] };
  });
  const setAmount = (line, side, raw) => {
    const value = cleanAmount(raw);
    patchLine(line.key, side === "debit" ? { debit: value, ...(value ? { credit: "" } : {}) } : { credit: value, ...(value ? { debit: "" } : {}) });
  };
  const formatAmount = (line, side) => {
    const c = cents(line[side]);
    if (c > 0) patchLine(line.key, { [side]: (c / 100).toFixed(2) });
  };
  const applyTagsToAll = (line) => {
    setDoc((d) => ({ ...d, lines: d.lines.map((l) => ({ ...l, tags: { ...line.tags } })) }));
    toast.info("Tags copied to every line");
  };

  // ---- totals and problems (mirror the server rules so the person sees them before saving)
  const totals = useMemo(() => {
    let debit = 0, credit = 0;
    (doc.lines || []).forEach((l) => { debit += cents(l.debit); credit += cents(l.credit); });
    return { debit, credit, diff: debit - credit };
  }, [doc.lines]);
  const filled = useMemo(() => (doc.lines || []).filter((l) => l.account || cents(l.debit) || cents(l.credit)), [doc.lines]);
  const lineIssue = useCallback((l) => {
    if (!l.account && !cents(l.debit) && !cents(l.credit)) return "";
    if (!l.account) return "Choose an account";
    if (!cents(l.debit) && !cents(l.credit)) return "Enter a debit or a credit";
    return "";
  }, []);
  const problems = useMemo(() => {
    const list = [];
    if (!doc.date) list.push("Choose the journal date.");
    if (filled.length < 2) list.push("A journal needs at least two lines.");
    filled.forEach((l) => { const m = lineIssue(l); if (m) list.push(`Line ${doc.lines.indexOf(l) + 1}: ${m.toLowerCase()}.`); });
    if (filled.length >= 2 && totals.diff !== 0) list.push(`Out of balance by ${money(Math.abs(totals.diff))} — debits and credits must be equal.`);
    if (filled.length >= 2 && totals.debit === 0) list.push("The journal total must be more than zero.");
    return list;
  }, [doc.date, doc.lines, filled, totals, lineIssue]);

  const balanceIt = () => {
    if (totals.diff === 0) return;
    const side = totals.diff > 0 ? "credit" : "debit";
    const amount = (Math.abs(totals.diff) / 100).toFixed(2);
    const empty = doc.lines.find((l) => l.account && !cents(l.debit) && !cents(l.credit));
    if (empty) patchLine(empty.key, { [side]: amount });
    else addLine({ [side]: amount }, false);
  };

  // ---- save / post
  const payload = () => ({
    business: company._id,
    company: company._id,
    date: doc.date,
    journalType: doc.journalType,
    reference: doc.reference,
    narration: doc.narration,
    lines: filled.map((l) => ({
      account: l.account,
      description: l.description,
      debit: cents(l.debit) / 100,
      credit: cents(l.credit) / 100,
      dimensions: l.tags,
    })),
  });

  const save = async (andPost) => {
    if (!canEditNow) return toast.warning("You do not have permission to save this journal");
    if (andPost && !can.post) return toast.warning("You do not have permission to post journals");
    if (problems.length) {
      setShowErrors(true);
      return toast.warning(problems[0]);
    }
    if (andPost) {
      const ok = await confirm({ title: "Post journal", message: `Post this journal for KES ${money(totals.debit)} to the ledger?`, confirmText: "Post" });
      if (!ok) return;
    }
    setBusy(andPost ? "post" : "save");
    let journal = saved;
    try {
      journal = saved ? await updateJournalEntry(saved._id, payload()) : await createJournalEntry(payload());
      setSaved(journal);
      if (isNew) clearDraft();
      if (andPost) {
        journal = await postJournalEntry(journal._id, { business: company._id, company: company._id });
        toast.success(`Journal ${journal.journalNo} posted`);
        navigate(`${base}/${journal._id}`, { replace: true });
        setSaved(journal);
      } else {
        toast.success(`Journal ${journal.journalNo} saved as draft`);
        if (isNew) navigate(`${base}/${journal._id}`, { replace: true });
      }
    } catch (e) {
      toast.error(e?.response?.data?.message || (andPost ? "Failed to post journal" : "Failed to save journal"));
      // saved but not posted: land on the saved draft so nothing is created twice
      if (isNew && journal?._id && journal !== saved) navigate(`${base}/${journal._id}`, { replace: true });
    } finally {
      setBusy("");
    }
  };

  const postDraft = async () => {
    if (!can.post) return toast.warning("You do not have permission to post journals");
    const ok = await confirm({ title: "Post journal", message: `Post journal ${saved.journalNo} for KES ${money(cents(saved.amount))} to the ledger?`, confirmText: "Post" });
    if (!ok) return;
    setBusy("post");
    try {
      const j = await postJournalEntry(saved._id, { business: company._id, company: company._id });
      setSaved(j);
      toast.success(`Journal ${j.journalNo} posted`);
    } catch (e) { toast.error(e?.response?.data?.message || "Failed to post journal"); } finally { setBusy(""); }
  };

  const reverse = async () => {
    if (!can.reverse) return toast.warning("You do not have permission to reverse journals");
    const ok = await confirm({ title: "Reverse journal", message: `Reverse journal ${saved.journalNo}? A reversing entry is posted; the original stays in the ledger.`, confirmText: "Reverse" });
    if (!ok) return;
    setBusy("reverse");
    try {
      const j = await reverseJournalEntry(saved._id, { business: company._id, company: company._id, reason: `Journal ${saved.journalNo} reversed` });
      setSaved(j);
      toast.success(`Journal ${j.journalNo} reversed`);
    } catch (e) { toast.error(e?.response?.data?.message || "Failed to reverse journal"); } finally { setBusy(""); }
  };

  const discard = async () => {
    if (isNew && (filled.length || doc.narration || doc.reference)) {
      const ok = await confirm({ title: "Discard journal", message: "Discard this journal? Nothing has been saved.", confirmText: "Discard", isDangerous: true });
      if (!ok) return;
      clearDraft();
    }
    navigate(base);
  };

  // legacy (two-line) journals are shown as a read-only pair of lines
  const viewLines = legacy
    ? [
        { key: "d", account: idOf(saved.debitAccount), debit: String(saved.amount || ""), credit: "", description: "", tags: {} },
        { key: "c", account: idOf(saved.creditAccount), debit: "", credit: String(saved.amount || ""), description: "", tags: {} },
      ]
    : doc.lines;
  const accountName = (accId, populated) => {
    const a = populated || accountById.get(String(accId));
    return a ? `${a.code} – ${a.name}` : "";
  };
  const savedAccountFor = (line, index) => {
    if (legacy) return index === 0 ? saved.debitAccount : saved.creditAccount;
    return saved?.lines?.[index]?.account;
  };
  const tagChips = (line, index) => {
    const src = saved?.lines?.[index]?.dimensions || {};
    const chips = [];
    if (src.project?.name) chips.push(["Project", src.project.name]);
    if (src.listing) chips.push(["Unit", src.listing.unitNumber || src.listing.title || src.listing.listingNumber]);
    if (src.deal?.dealNumber) chips.push(["Deal", src.deal.dealNumber]);
    if (src.agent?.fullName) chips.push(["Agent", src.agent.fullName]);
    if (src.property) chips.push(["Property", src.property.propertyName || src.property.name]);
    if (line.tags.costCentre) chips.push(["Cost centre", line.tags.costCentre]);
    return chips;
  };
  const editChips = (line) => {
    const chips = [];
    const by = (list, v) => list.find((o) => String(o.value) === String(v))?.label;
    if (line.tags.project) chips.push(["Project", by(options.project, line.tags.project) || "…"]);
    if (line.tags.listing) chips.push(["Unit", by(listingOptionsFor(line), line.tags.listing) || "…"]);
    if (line.tags.deal) chips.push(["Deal", by(options.deal, line.tags.deal) || "…"]);
    if (line.tags.agent) chips.push(["Agent", by(options.agent, line.tags.agent) || "…"]);
    if (line.tags.property) chips.push(["Property", by(options.property, line.tags.property) || "…"]);
    if (line.tags.costCentre) chips.push(["Cost centre", line.tags.costCentre]);
    return chips;
  };

  const title = isNew ? "New journal entry" : saved ? `Journal ${saved.journalNo}` : "Journal entry";

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-100">
        {/* header */}
        <div className="flex flex-none flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
          <div className="flex items-center gap-3">
            <button type="button" onClick={discard} className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-500 hover:text-slate-900">
              <FaArrowLeft /> Journals
            </button>
            <div className="h-4 w-px bg-slate-200" />
            <h1 className="text-sm font-black text-slate-900">{title}</h1>
            {!isNew && saved && (
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLES[status] || STATUS_STYLES.draft}`}>{status}</span>
            )}
            {saved?.approvalStatus && saved.approvalStatus !== "not_required" && (
              <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                {String(saved.approvalStatus).replace(/_/g, " ")}
              </span>
            )}
          </div>
          {!isNew && saved && (
            <div className="flex items-center gap-2">
              {status === "posted" && (
                <button type="button" onClick={() => setLedgerOpen(true)} className="inline-flex h-8 items-center gap-1.5 rounded border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">
                  <FaBook size={11} /> Ledger entries
                </button>
              )}
              {!legacy && (
                <button type="button" onClick={() => navigate(`${base}/new`, { state: { copyFrom: saved } })} className="inline-flex h-8 items-center gap-1.5 rounded border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">
                  <FaCopy size={11} /> Copy as new
                </button>
              )}
              {status === "posted" && can.reverse && (
                <button type="button" disabled={!!busy} onClick={reverse} className="inline-flex h-8 items-center gap-1.5 rounded border border-amber-300 bg-amber-50 px-3 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50">
                  <FaUndo size={11} /> {busy === "reverse" ? "Reversing…" : "Reverse"}
                </button>
              )}
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-500">Loading journal…</div>
        ) : (
          <div ref={formRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {legacy && (
              <div className="flex items-start gap-2 border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                <FaExclamationTriangle className="mt-0.5 shrink-0" />
                <span>This is a two-line owner / property journal. It can be viewed here; drafts of this kind are edited from the journal list.</span>
              </div>
            )}
            {status === "reversed" && saved?.reversalReason && (
              <div className="border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">Reversed: {saved.reversalReason}</div>
            )}

            {/* details */}
            <div className="border border-slate-200 bg-white p-3 shadow-sm">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <div>
                  <label className={labelCls}>Journal date <span className="text-red-500">*</span></label>
                  <input type="date" disabled={readOnly} value={doc.date} onChange={(e) => patch({ date: e.target.value })}
                    className={`${inputCls} ${showErrors && !doc.date ? "border-red-400" : ""}`} />
                </div>
                <div>
                  <label className={labelCls}>Type</label>
                  {readOnly ? (
                    <div className={`${inputCls} flex items-center bg-slate-50`}>{TYPE_LABELS[doc.journalType] || saved?.journalType?.replace(/_/g, " ") || "—"}</div>
                  ) : (
                    <AppSelect value={doc.journalType} onChange={(v) => patch({ journalType: v || "general_manual_journal" })} options={LINE_TYPES} size="sm" />
                  )}
                </div>
                <div>
                  <label className={labelCls}>Reference</label>
                  <input disabled={readOnly} value={doc.reference} maxLength={200} onChange={(e) => patch({ reference: e.target.value })} placeholder="Invoice, cheque or document no." className={inputCls} />
                </div>
                <div className="col-span-2 md:col-span-3">
                  <label className={labelCls}>Narration</label>
                  <input disabled={readOnly} value={doc.narration} maxLength={1000} onChange={(e) => patch({ narration: e.target.value })} placeholder="What is this journal for?" className={inputCls} />
                </div>
              </div>
            </div>

            {/* lines */}
            <div className="overflow-x-auto border border-slate-200 bg-white shadow-sm">
              <div className="min-w-[860px]">
                <div className={`${GRID} border-b border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500`}>
                  <span>#</span><span>Account</span><span>Description</span>
                  <span className="text-right">Debit</span><span className="text-right">Credit</span><span className="text-center">Tags</span><span />
                </div>

                {viewLines.map((line, index) => {
                  const issue = showErrors ? lineIssue(line) : "";
                  const account = accountById.get(String(line.account));
                  const chips = readOnly ? tagChips(line, index) : editChips(line);
                  const tagCount = chips.length;
                  return (
                    <div key={line.key} data-row={line.key} className={`border-b border-slate-100 px-3 py-1.5 ${issue ? "bg-red-50/60" : ""}`}>
                      <div className={GRID}>
                        <span className="pt-1.5 text-[11px] font-semibold text-slate-400">{index + 1}</span>
                        <div className="min-w-0">
                          {readOnly ? (
                            <div className="py-1.5 text-xs font-semibold text-slate-800">{accountName(line.account, savedAccountFor(line, index)) || "—"}</div>
                          ) : (
                            <>
                              <AppSelect value={line.account} onChange={(v) => patchLine(line.key, { account: v || "" })} options={accountOptions}
                                placeholder="Search account…" searchable size="sm" error={issue === "Choose an account" ? issue : ""} />
                              {account?.isControl && <p className="mt-0.5 text-[10px] text-amber-700">Control account — modules post here automatically; use for corrections.</p>}
                            </>
                          )}
                        </div>
                        {readOnly ? (
                          <div className="py-1.5 text-xs text-slate-600">{line.description || ""}</div>
                        ) : (
                          <input value={line.description} maxLength={200} onChange={(e) => patchLine(line.key, { description: e.target.value })} placeholder="Line note (optional)" className={inputCls} />
                        )}
                        {["debit", "credit"].map((side) => (
                          readOnly ? (
                            <div key={side} className="py-1.5 text-right text-xs font-bold tabular-nums text-slate-900">{cents(line[side]) ? money(cents(line[side])) : ""}</div>
                          ) : (
                            <input key={side} inputMode="decimal" value={line[side]} placeholder="0.00"
                              onChange={(e) => setAmount(line, side, e.target.value)}
                              onBlur={() => formatAmount(line, side)}
                              onFocus={(e) => e.target.select()}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && index === doc.lines.length - 1 && side === "credit") { e.preventDefault(); addLine(); }
                              }}
                              className={`${inputCls} text-right font-semibold tabular-nums ${issue === "Enter a debit or a credit" ? "border-red-400" : ""}`} />
                          )
                        ))}
                        <div className="flex justify-center pt-0.5">
                          {readOnly ? (
                            <span className="pt-1 text-[10px] text-slate-400">{tagCount ? `${tagCount}` : "—"}</span>
                          ) : (
                            <button type="button" onClick={() => patchLine(line.key, { tagsOpen: !line.tagsOpen })} title="Tag this line (project, unit, deal, agent, cost centre…)"
                              className={`inline-flex h-8 items-center gap-1 rounded border px-2 text-[11px] font-bold ${line.tagsOpen || tagCount ? "border-[#0B3B2E] bg-emerald-50 text-[#0B3B2E]" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
                              <FaTag size={10} />{tagCount || ""}
                            </button>
                          )}
                        </div>
                        <div className="flex justify-end gap-0.5 pt-0.5">
                          {!readOnly && (
                            <>
                              <button type="button" onClick={() => duplicateLine(line)} title="Duplicate line" className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><FaCopy size={11} /></button>
                              <button type="button" onClick={() => removeLine(line.key)} disabled={doc.lines.length <= 2} title="Remove line" className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"><FaTrash size={11} /></button>
                            </>
                          )}
                        </div>
                      </div>

                      {issue && <p className="ml-10 mt-0.5 text-[10px] font-semibold text-red-600">{issue}</p>}

                      {/* tags: chips when closed, editor when open */}
                      {!line.tagsOpen && tagCount > 0 && (
                        <div className="ml-10 mt-1 flex flex-wrap gap-1">
                          {chips.map(([k, v]) => (
                            <span key={k} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600"><b className="font-bold text-slate-500">{k}:</b> {v}</span>
                          ))}
                        </div>
                      )}
                      {line.tagsOpen && !readOnly && (
                        <div className="ml-10 mt-1.5 border border-slate-200 bg-slate-50 p-3">
                          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                            {tagFields.map((f) => (
                              <div key={f.key}>
                                <label className={labelCls}>{f.label}</label>
                                <AppSelect value={line.tags[f.key] || ""} onChange={(v) => setTag(line, f.key, v)}
                                  options={f.key === "listing" ? listingOptionsFor(line) : options[f.key]}
                                  placeholder={hasSales && f.module === "propertySale" && !tagData.loaded ? "Loading…" : "None"} size="sm" searchable clearable />
                              </div>
                            ))}
                            <div>
                              <label className={labelCls}>Cost centre</label>
                              <input value={line.tags.costCentre || ""} maxLength={40} onChange={(e) => setTag(line, "costCentre", e.target.value)} placeholder="e.g. Head office" className={inputCls} />
                            </div>
                          </div>
                          <div className="mt-2 flex items-center justify-between">
                            <p className="text-[10px] text-slate-500">Tags let reports show income and costs per module, project, unit, agent or cost centre.</p>
                            <div className="flex gap-2">
                              <button type="button" onClick={() => applyTagsToAll(line)} className="text-[11px] font-bold text-[#0B3B2E] hover:underline">Apply to all lines</button>
                              <button type="button" onClick={() => patchLine(line.key, { tagsOpen: false })} className="text-[11px] font-bold text-slate-500 hover:underline">Done</button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {!readOnly && (
                  <div className="flex items-center justify-between px-3 py-2">
                    <button type="button" onClick={() => addLine()} className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0B3B2E] hover:underline"><FaPlus size={10} /> Add line</button>
                    <span className="text-[10px] text-slate-400">Tip: press Enter in the last credit box to add a line</span>
                  </div>
                )}
              </div>
            </div>

            {showErrors && problems.length > 0 && (
              <div className="border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                <p className="mb-1 font-bold">Fix before saving:</p>
                <ul className="list-inside list-disc space-y-0.5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
              </div>
            )}
          </div>
        )}

        {/* totals + actions */}
        {!loading && (
          <div className="flex flex-none flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
              <div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Total debit</p><p className="text-sm font-black tabular-nums text-slate-900">{readOnly ? money(cents(saved?.amount)) : money(totals.debit)}</p></div>
              <div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Total credit</p><p className="text-sm font-black tabular-nums text-slate-900">{readOnly ? money(cents(saved?.amount)) : money(totals.credit)}</p></div>
              {!readOnly && (
                totals.diff === 0 && filled.length ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700"><FaCheckCircle /> Balanced</span>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-bold text-red-700">
                      <FaExclamationTriangle /> {filled.length ? `Out by ${money(Math.abs(totals.diff))}` : "Enter the lines"}
                    </span>
                    {filled.length > 0 && (
                      <button type="button" onClick={balanceIt} className="inline-flex h-7 items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50">
                        <FaBalanceScale size={11} /> Balance it
                      </button>
                    )}
                  </div>
                )
              )}
            </div>
            <div className="flex items-center gap-2">
              {!readOnly ? (
                <>
                  <button type="button" onClick={discard} className="inline-flex h-9 items-center gap-1.5 rounded border border-slate-300 bg-white px-4 text-xs font-bold text-slate-700 hover:bg-slate-50"><FaTimes size={11} /> {isNew ? "Discard" : "Close"}</button>
                  <button type="button" disabled={!!busy || !canEditNow} onClick={() => save(false)} className="inline-flex h-9 items-center gap-1.5 rounded border border-[#0B3B2E] bg-white px-4 text-xs font-bold text-[#0B3B2E] hover:bg-emerald-50 disabled:opacity-50">
                    <FaSave size={11} /> {busy === "save" ? "Saving…" : "Save draft"}
                  </button>
                  <button type="button" disabled={!!busy || !canEditNow || !can.post} onClick={() => save(true)} className="inline-flex h-9 items-center gap-1.5 rounded bg-[#0B3B2E] px-4 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-50">
                    <FaCheckCircle size={11} /> {busy === "post" ? "Posting…" : "Save & post"}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => navigate(base)} className="inline-flex h-9 items-center rounded border border-slate-300 bg-white px-4 text-xs font-bold text-slate-700 hover:bg-slate-50">Back to journals</button>
                  {status === "draft" && !legacy && can.post && (
                    <button type="button" disabled={!!busy} onClick={postDraft} className="inline-flex h-9 items-center gap-1.5 rounded bg-[#0B3B2E] px-4 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-50"><FaCheckCircle size={11} /> Post</button>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <JournalEntriesDrawer
        open={ledgerOpen}
        onClose={() => setLedgerOpen(false)}
        title="Journal Entry"
        transactionRef={saved?.journalNo}
        date={saved?.date ? new Date(saved.date).toLocaleDateString("en-GB") : undefined}
        amount={saved?.amount}
        status={saved?.status}
        statusColors={STATUS_STYLES[saved?.status] || STATUS_STYLES.draft}
        contextFields={saved ? [
          { label: "Type", value: TYPE_LABELS[saved.journalType] || saved.journalType },
          { label: "Reference", value: saved.reference },
          { label: "Narration", value: saved.narration },
        ] : []}
        businessId={company?._id}
        sourceType="manual_adjustment"
        sourceId={saved?._id}
      />
    </DashboardLayout>
  );
};

export default JournalEntryForm;
