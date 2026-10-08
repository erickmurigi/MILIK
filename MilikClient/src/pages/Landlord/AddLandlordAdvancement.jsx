import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import Spinner from "../../components/common/Spinner";
import AppSelect from "../../components/common/AppSelect";
import { useEntityCache } from "../../hooks/useEntityCache";
import { clearTabCache, useTabState } from "../../hooks/useTabState";
import { FaSave } from "react-icons/fa";
import {
  createLandlordAdvancement,
  getChartOfAccounts,
  getLandlordAdvancement,
  getLandlords,
  updateLandlordAdvancement,
} from "../../redux/apiCalls";
import { getProperties } from "../../redux/propertyRedux";
import { propertyBelongsToLandlord } from "./propertyUtils";
import { selectCurrentCompany, selectCurrentUser, selectAllLandlords, selectAllProperties } from "../../redux/selectors";
import { hasCompanyPermission } from "../../utils/permissions";
import { isCashbookAccount } from "../../utils/cashbookUtils";

const todayIso = () => new Date().toISOString().split("T")[0];
const money = (value) =>
  new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));
const fmtDatePreview = (value) => (value ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "-");
const round2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

const formInputClass = "h-7 w-full border border-slate-300 bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";
const formLabelClass = "mb-1 block text-xs font-bold text-slate-900";
const FormSection = ({ title, children }) => (
  <div className="border border-slate-200 bg-white">
    <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5">
      <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-800">{title}</h3>
    </div>
    <div className="p-2.5">{children}</div>
  </div>
);

const addMonths = (dateValue, months = 0) => {
  if (!dateValue) return null;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  const safeMonths = Math.max(0, Number(months || 0));
  const originalDay = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + safeMonths);
  const maxDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(originalDay, maxDay));
  return date;
};

const computeRecoveryEndDate = ({ startDate, periodMonths, gracePeriodMonths }) => {
  const safePeriodMonths = Math.max(0, Number(periodMonths || 0));
  if (!startDate || safePeriodMonths <= 0) return "";
  const effectiveStart = addMonths(startDate, gracePeriodMonths || 0);
  if (!effectiveStart) return "";
  const endDate = new Date(effectiveStart.getFullYear(), effectiveStart.getMonth() + safePeriodMonths, 0);
  return Number.isNaN(endDate.getTime()) ? "" : endDate.toISOString().split("T")[0];
};

const defaultTitleForType = (advanceType) =>
  advanceType === "against_payable" ? "Landlord Advance - Early Payout" : "Landlord Advance - Recover from Next Statement";

const blankForm = {
  advanceType: "against_payable",
  landlord: "",
  property: "",
  title: defaultTitleForType("against_payable"),
  narration: "",
  notes: "",
  amount: "",
  disbursementDate: todayIso(),
  startDate: todayIso(),
  endDate: "",
  periodMonths: "1",
  gracePeriodMonths: "0",
  frequency: "monthly",
  interestRate: "0",
  interestType: "simple_flat",
  paymentMethod: "bank_transfer",
  cashbook: "",
  status: "draft",
};

const mapRowToForm = (row) => {
  const advanceType = row?.advanceType || "future_recoverable";
  return {
    advanceType,
    landlord: row?.landlord?._id || row?.landlord || "",
    property: row?.property?._id || row?.property || "",
    title: row?.title || defaultTitleForType(advanceType),
    narration: row?.narration || "",
    notes: row?.notes || "",
    amount: row?.amount || "",
    disbursementDate: row?.disbursementDate ? new Date(row.disbursementDate).toISOString().split("T")[0] : todayIso(),
    startDate: row?.startDate ? new Date(row.startDate).toISOString().split("T")[0] : todayIso(),
    endDate: row?.endDate ? new Date(row.endDate).toISOString().split("T")[0] : "",
    periodMonths: row?.periodMonths ? String(row.periodMonths) : "1",
    gracePeriodMonths: String(row?.gracePeriodMonths || 0),
    frequency: row?.frequency || "monthly",
    interestRate: String(row?.interestRate || 0),
    interestType: row?.interestType === "reducing_balance" ? "reducing_balance" : "simple_flat",
    paymentMethod: row?.paymentMethod === "mobile_money" ? "mpesa" : row?.paymentMethod === "check" ? "cheque" : row?.paymentMethod || "bank_transfer",
    cashbook: row?.cashbook?._id || row?.cashbook || "",
    status: row?.status || "draft",
  };
};

const TYPE_OPTIONS = [
  {
    value: "against_payable",
    label: "Advance against current payable",
    hint: "Early payout. This reduces what is currently payable to the landlord and is not recovered later.",
  },
  {
    value: "future_recoverable",
    label: "Future recoverable advance",
    hint: "Pay now and recover from upcoming landlord statement(s), optionally with interest.",
  },
];

const INITIAL_STATUS_OPTIONS = [
  { value: "draft", label: "Save as Draft" },
  { value: "submitted", label: "Save and Submit" },
  { value: "approved", label: "Save and Approve" },
  { value: "disbursed", label: "Save and Disburse" },
];

const INTEREST_TYPE_OPTIONS = [
  { value: "simple_flat", label: "Simple Flat (same interest every installment)" },
  { value: "reducing_balance", label: "Reducing Balance (recalculated on what's still owed)" },
];

// ── Client-side schedule preview ──────────────────────────────────────────────
// Deliberately a simpler period-walker than the backend's recurringSchedule.js (no
// period-key dedup/processed-period matching needed for a preview of an advance that
// doesn't exist yet) — but the interest math below is a direct, faithful port of
// computeSchedule() in landlordAdvancements.js, so the numbers shown here are exactly
// what gets posted once saved.
const PREVIEW_MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const addMonthsForSchedule = (dateValue, months, dayOfMonth) => {
  const date = new Date(dateValue);
  const originalDay = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  const desired = Number.isFinite(dayOfMonth) ? dayOfMonth : originalDay;
  const maxDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(Math.max(desired, 1), maxDay));
  return date;
};

const addFrequencyStep = (dateValue, frequency, dayOfMonth) => {
  const date = new Date(dateValue);
  if (frequency === "weekly") { const next = new Date(date); next.setDate(next.getDate() + 7); return next; }
  if (frequency === "quarterly") return addMonthsForSchedule(date, 3, dayOfMonth);
  if (frequency === "semi_annually") return addMonthsForSchedule(date, 6, dayOfMonth);
  if (frequency === "annually" || frequency === "yearly") { const next = new Date(date); next.setFullYear(next.getFullYear() + 1); return next; }
  return addMonthsForSchedule(date, 1, dayOfMonth);
};

const periodLabelFor = (date, frequency) => {
  if (frequency === "weekly") return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  return `${PREVIEW_MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
};

const buildSchedulePreview = (form) => {
  if (form.advanceType !== "future_recoverable") return [];
  const principal = Number(form.amount || 0);
  if (!principal || !form.startDate) return [];

  const dayOfMonth = Math.max(1, Math.min(31, Number(form.dayOfMonth || new Date(form.startDate).getDate() || 5)));
  const graceMonths = Math.max(0, Number(form.gracePeriodMonths || 0));
  const effectiveStart = addMonths(form.startDate, graceMonths) || new Date(form.startDate);
  const hardEnd = form.endDate ? new Date(form.endDate) : null;
  if (!hardEnd) return [];

  const periods = [];
  let cursor = new Date(effectiveStart);
  let guard = 0;
  while (cursor.getTime() <= hardEnd.getTime() && guard < 120) {
    guard += 1;
    periods.push({ dueDate: new Date(cursor), periodLabel: periodLabelFor(cursor, form.frequency) });
    const nextCursor = addFrequencyStep(cursor, form.frequency, dayOfMonth);
    if (nextCursor.getTime() <= cursor.getTime()) break;
    cursor = nextCursor;
  }
  if (periods.length === 0) return [];

  const installmentCount = periods.length;
  const basePrincipal = round2(principal / installmentCount);
  let runningPrincipal = 0;
  const principalByIndex = periods.map((_item, index) => {
    const isLast = index === periods.length - 1;
    const value = isLast ? round2(principal - runningPrincipal) : basePrincipal;
    runningPrincipal = round2(runningPrincipal + value);
    return value;
  });

  const interestRate = Math.max(Number(form.interestRate || 0), 0);
  const totalInterestBudget = round2((principal * interestRate) / 100);
  let interestByIndex;
  if (totalInterestBudget <= 0) {
    interestByIndex = periods.map(() => 0);
  } else if (form.interestType === "reducing_balance") {
    let balanceBeforePeriod = principal;
    const weights = principalByIndex.map((principalThisPeriod) => {
      const weight = balanceBeforePeriod;
      balanceBeforePeriod = round2(balanceBeforePeriod - principalThisPeriod);
      return weight;
    });
    const totalWeight = weights.reduce((sum, w) => sum + w, 0) || 1;
    let runningInterest = 0;
    interestByIndex = weights.map((weight, index) => {
      const isLast = index === weights.length - 1;
      const value = isLast ? round2(totalInterestBudget - runningInterest) : round2(totalInterestBudget * (weight / totalWeight));
      runningInterest = round2(runningInterest + value);
      return value;
    });
  } else {
    const base = round2(totalInterestBudget / installmentCount);
    let runningInterest = 0;
    interestByIndex = periods.map((_item, index) => {
      const isLast = index === periods.length - 1;
      const value = isLast ? round2(totalInterestBudget - runningInterest) : base;
      runningInterest = round2(runningInterest + value);
      return value;
    });
  }

  return periods.map((period, index) => ({
    ...period,
    principal: principalByIndex[index],
    interest: interestByIndex[index],
    total: round2(principalByIndex[index] + interestByIndex[index]),
  }));
};

const AddLandlordAdvancement = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const isEditMode = Boolean(id);
  const dispatch = useDispatch();
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const landlords = useSelector(selectAllLandlords);
  const { propertiesLoaded } = useEntityCache(currentCompany?._id);
  const properties = useSelector(selectAllProperties);

  const activeLandlords = useMemo(() => landlords.filter((item) => String(item?.status || "active").toLowerCase() !== "archived"), [landlords]);
  const activeProperties = useMemo(() => properties.filter((item) => String(item?.status || "active").toLowerCase() !== "archived"), [properties]);
  const activeLandlordOptions = useMemo(
    () => activeLandlords.map((l) => ({ value: l._id, label: l.landlordName || l.firstName || l.email || "Landlord" })),
    [activeLandlords]
  );

  const canWrite = hasCompanyPermission(currentUser, currentCompany, "landlordAdvancements", "create", "accounts");

  // This app's tab system fully unmounts a page when you switch to another open tab —
  // useTabState (module-level cache keyed by path) survives that remount, plain useState
  // wouldn't, which would otherwise wipe an in-progress advance if the tab is switched
  // away and back. Edit mode's fetch effect below overwrites it with fresh server data on
  // every mount anyway, so this only actually preserves drafts for the "new" route.
  const [form, setForm] = useTabState(`${location.pathname}:form`, blankForm);
  const [cashbooks, setCashbooks] = useState([]);
  const [loadingRow, setLoadingRow] = useState(isEditMode);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!currentCompany?._id) return;
    if (!landlords?.length) dispatch(getLandlords({ company: currentCompany._id }));
    if (!propertiesLoaded) dispatch(getProperties({ business: currentCompany._id }));
    (async () => {
      try {
        const accounts = await getChartOfAccounts({ business: currentCompany._id, type: "asset" });
        setCashbooks(Array.isArray(accounts) ? accounts.filter(isCashbookAccount) : []);
      } catch (error) {
        toast.error(error?.response?.data?.message || "Failed to load cashbooks");
      }
    })();
  }, [dispatch, currentCompany?._id, propertiesLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isEditMode || !id) return;
    let cancelled = false;
    setLoadingRow(true);
    getLandlordAdvancement(id)
      .then((row) => { if (!cancelled) setForm(mapRowToForm(row)); })
      .catch((error) => {
        if (cancelled) return;
        toast.error(error?.response?.data?.message || "Failed to load landlord advance");
        navigate("/landlords/advancement");
      })
      .finally(() => { if (!cancelled) setLoadingRow(false); });
    return () => { cancelled = true; };
  }, [isEditMode, id, navigate]);

  // Auto-compute the recovery end date from start + period months + grace, same as the
  // old modal — kept in sync unless the user has typed a different date themselves.
  useEffect(() => {
    if (form.advanceType !== "future_recoverable") return;
    const computedEndDate = computeRecoveryEndDate({ startDate: form.startDate, periodMonths: form.periodMonths, gracePeriodMonths: form.gracePeriodMonths });
    if (computedEndDate && computedEndDate !== form.endDate) {
      setForm((prev) => ({ ...prev, endDate: computedEndDate }));
    }
  }, [form.advanceType, form.startDate, form.periodMonths, form.gracePeriodMonths]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setForm((prev) => {
      if (!prev.title || prev.title === defaultTitleForType(prev.advanceType === "against_payable" ? "future_recoverable" : "against_payable")) {
        return { ...prev, title: defaultTitleForType(prev.advanceType) };
      }
      return prev;
    });
  }, [form.advanceType]);

  const filteredProperties = useMemo(() => {
    if (!form.landlord) return activeProperties;
    const selectedLandlord = activeLandlords.find((item) => String(item._id) === String(form.landlord));
    return activeProperties.filter((property) => propertyBelongsToLandlord(property, form.landlord, selectedLandlord?.landlordName));
  }, [activeLandlords, activeProperties, form.landlord]);
  const filteredPropertyOptions = useMemo(
    () => filteredProperties.map((p) => ({ value: p._id, label: p.propertyName || p.name || p.propertyCode || "Property" })),
    [filteredProperties]
  );
  const cashbookOptions = useMemo(() => cashbooks.map((account) => ({ value: account._id, label: account.name || account.accountName || account.code })), [cashbooks]);

  const schedulePreview = useMemo(() => buildSchedulePreview(form), [form]);
  const previewTotals = useMemo(
    () => ({
      principal: round2(schedulePreview.reduce((sum, item) => sum + item.principal, 0)),
      interest: round2(schedulePreview.reduce((sum, item) => sum + item.interest, 0)),
      total: round2(schedulePreview.reduce((sum, item) => sum + item.total, 0)),
    }),
    [schedulePreview]
  );

  // Clears the cached draft for THIS route — otherwise a stale, already-saved (or
  // abandoned) draft would reappear the next time "New Advance" is opened, since
  // useTabState's cache only clears when a tab is actually closed, not on navigate-away.
  const clearDraft = () => clearTabCache(location.pathname);

  const handleCancel = () => { clearDraft(); navigate("/landlords/advancement"); };

  const handleSave = async () => {
    if (!canWrite) { toast.warning("You don't have permission to save landlord advancements"); return; }
    if (!form.landlord) return toast.warning("Select the landlord");
    if (!form.property) return toast.warning("Select the property");
    if (!Number(form.amount || 0) || Number(form.amount) <= 0) return toast.warning("Enter a valid amount");
    if (!form.disbursementDate) return toast.warning("Disbursement date is required");

    if (form.advanceType === "future_recoverable") {
      if (!form.startDate) return toast.warning("Recovery start date is required");
      if (!form.periodMonths && !form.endDate) return toast.warning("Provide how many statement periods to recover over");
    }

    const payload = {
      business: currentCompany?._id,
      company: currentCompany?._id,
      advanceType: form.advanceType,
      landlord: form.landlord,
      property: form.property,
      title: form.title?.trim() || defaultTitleForType(form.advanceType),
      narration: form.narration?.trim() || "",
      notes: form.notes?.trim() || "",
      amount: Number(form.amount),
      disbursementDate: form.disbursementDate,
      startDate: form.advanceType === "future_recoverable" ? form.startDate : form.disbursementDate,
      endDate: form.advanceType === "future_recoverable" ? form.endDate || null : form.disbursementDate,
      periodMonths: form.advanceType === "future_recoverable" ? Number(form.periodMonths || 0) || null : null,
      gracePeriodMonths: form.advanceType === "future_recoverable" ? Number(form.gracePeriodMonths || 0) : 0,
      frequency: form.advanceType === "future_recoverable" ? form.frequency : "monthly",
      interestRate: form.advanceType === "future_recoverable" ? Number(form.interestRate || 0) : 0,
      interestType: form.interestType,
      paymentMethod: form.paymentMethod,
      cashbook: form.cashbook || null,
      status: form.status,
    };

    setSaving(true);
    try {
      if (isEditMode) await updateLandlordAdvancement(id, payload);
      else await createLandlordAdvancement(payload);
      toast.success(`Landlord advance ${isEditMode ? "updated" : "saved"}`);
      clearDraft();
      navigate("/landlords/advancement");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to save landlord advance");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loadingRow ? (
            <div className="flex items-center justify-center gap-3 border border-slate-200 bg-white px-6 py-10 text-slate-700">
              <Spinner size="sm" />
              <span className="text-xs font-semibold">Loading advance details…</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 xl:grid-cols-5 xl:items-start">
              <div className="space-y-2 xl:col-span-3">
                <FormSection title="Advance Type">
                  <div className="flex gap-2">
                    {TYPE_OPTIONS.map((option) => {
                      const active = form.advanceType === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() =>
                            setForm((prev) => ({
                              ...prev,
                              advanceType: option.value,
                              title: !prev.title || prev.title === defaultTitleForType(prev.advanceType) ? defaultTitleForType(option.value) : prev.title,
                            }))
                          }
                          className={`flex-1 border px-3 py-1.5 text-left text-xs font-bold transition ${
                            active ? "border-[#0B3B2E] bg-[#0B3B2E] text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-1.5 text-[10px] text-slate-500">{TYPE_OPTIONS.find((o) => o.value === form.advanceType)?.hint}</p>
                </FormSection>

                <FormSection title="Advance Details">
                  <div className="grid grid-cols-3 gap-x-3 gap-y-2.5">
                    <div>
                      <label className={formLabelClass}>Landlord</label>
                      <AppSelect
                        value={form.landlord}
                        onChange={(v) => setForm((prev) => ({ ...prev, landlord: v ?? "", property: "" }))}
                        options={activeLandlordOptions}
                        placeholder="Select landlord…"
                        searchable
                        clearable
                        size="md"
                      />
                    </div>
                    <div>
                      <label className={formLabelClass}>Property</label>
                      <AppSelect
                        value={form.property}
                        onChange={(v) => setForm((prev) => ({ ...prev, property: v ?? "" }))}
                        options={filteredPropertyOptions}
                        placeholder="Select property…"
                        searchable
                        clearable
                        size="md"
                      />
                    </div>
                    <div>
                      <label className={formLabelClass}>Initial workflow step</label>
                      <AppSelect
                        value={form.status || null}
                        onChange={(v) => setForm((prev) => ({ ...prev, status: v ?? "draft" }))}
                        options={INITIAL_STATUS_OPTIONS}
                        size="md"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className={formLabelClass}>Title</label>
                      <input value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} className={formInputClass} />
                    </div>
                    <div>
                      <label className={formLabelClass}>Amount</label>
                      <input type="number" min="0" value={form.amount} onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))} className={formInputClass} />
                    </div>
                    <div>
                      <label className={formLabelClass}>Disbursement date</label>
                      <input
                        type="date"
                        value={form.disbursementDate}
                        onChange={(e) => setForm((prev) => ({ ...prev, disbursementDate: e.target.value, startDate: prev.advanceType === "against_payable" ? e.target.value : prev.startDate }))}
                        className={formInputClass}
                      />
                    </div>
                    <div>
                      <label className={formLabelClass}>Payment method</label>
                      <AppSelect
                        value={form.paymentMethod || null}
                        onChange={(v) => setForm((prev) => ({ ...prev, paymentMethod: v ?? "bank_transfer" }))}
                        options={[
                          { value: "bank_transfer", label: "Bank transfer" },
                          { value: "mpesa", label: "M-Pesa" },
                          { value: "cheque", label: "Cheque" },
                          { value: "cash", label: "Cash" },
                          { value: "other", label: "Other" },
                        ]}
                        size="md"
                      />
                    </div>
                    <div>
                      <label className={formLabelClass}>Cashbook <span className="font-normal text-slate-400">(optional)</span></label>
                      <AppSelect
                        value={form.cashbook || null}
                        onChange={(v) => setForm((prev) => ({ ...prev, cashbook: v ?? "" }))}
                        options={cashbookOptions}
                        placeholder="Use system default"
                        searchable
                        clearable
                        size="md"
                      />
                    </div>
                  </div>
                </FormSection>

                {form.advanceType === "future_recoverable" && (
                  <FormSection title="Recovery Schedule">
                    <div className="grid grid-cols-3 gap-x-3 gap-y-2.5">
                      <div>
                        <label className={formLabelClass}>Recover starting</label>
                        <input type="date" value={form.startDate} onChange={(e) => setForm((prev) => ({ ...prev, startDate: e.target.value }))} className={formInputClass} />
                      </div>
                      <div>
                        <label className={formLabelClass}>Over next X statements</label>
                        <input type="number" min="1" value={form.periodMonths} onChange={(e) => setForm((prev) => ({ ...prev, periodMonths: e.target.value }))} className={formInputClass} />
                      </div>
                      <div>
                        <label className={formLabelClass}>Grace period (months) <span className="font-normal text-slate-400">(optional)</span></label>
                        <input type="number" min="0" value={form.gracePeriodMonths} onChange={(e) => setForm((prev) => ({ ...prev, gracePeriodMonths: e.target.value }))} className={formInputClass} />
                      </div>
                      <div>
                        <label className={formLabelClass}>Frequency</label>
                        <AppSelect
                          value={form.frequency || null}
                          onChange={(v) => setForm((prev) => ({ ...prev, frequency: v ?? "monthly" }))}
                          options={[
                            { value: "monthly", label: "Monthly" },
                            { value: "weekly", label: "Weekly" },
                            { value: "quarterly", label: "Quarterly" },
                            { value: "semi_annually", label: "Semi-Annually" },
                            { value: "yearly", label: "Yearly" },
                          ]}
                          size="md"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className={formLabelClass}>Computed recovery end date</label>
                        <input type="date" value={form.endDate} onChange={(e) => setForm((prev) => ({ ...prev, endDate: e.target.value }))} className={formInputClass} />
                      </div>
                      <div>
                        <label className={formLabelClass}>Interest rate (%) <span className="font-normal text-slate-400">(optional)</span></label>
                        <input type="number" min="0" step="0.01" value={form.interestRate} onChange={(e) => setForm((prev) => ({ ...prev, interestRate: e.target.value }))} className={formInputClass} />
                      </div>
                      <div className="col-span-2">
                        <label className={formLabelClass}>Interest type</label>
                        <AppSelect
                          value={form.interestType}
                          onChange={(v) => setForm((prev) => ({ ...prev, interestType: v === "reducing_balance" ? "reducing_balance" : "simple_flat" }))}
                          options={INTEREST_TYPE_OPTIONS}
                          size="md"
                        />
                      </div>
                    </div>
                  </FormSection>
                )}

                <FormSection title="Notes">
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                    <div>
                      <label className={formLabelClass}>Narration <span className="font-normal text-slate-400">(optional)</span></label>
                      <textarea
                        rows={2}
                        value={form.narration}
                        onChange={(e) => setForm((prev) => ({ ...prev, narration: e.target.value }))}
                        className="w-full resize-none border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                      />
                    </div>
                    <div>
                      <label className={formLabelClass}>Internal notes <span className="font-normal text-slate-400">(optional)</span></label>
                      <textarea
                        rows={2}
                        value={form.notes}
                        onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                        className="w-full resize-none border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                      />
                    </div>
                  </div>
                </FormSection>
              </div>

              {/* ── Live schedule preview ── */}
              <div className="xl:col-span-2">
                <div className="border border-slate-200 bg-white">
                  <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5">
                    <p className="text-[11px] font-black uppercase tracking-wide text-slate-700">Schedule Preview</p>
                  </div>
                  {form.advanceType !== "future_recoverable" ? (
                    <p className="px-3 py-2.5 text-xs text-slate-500">Early payouts have no recovery schedule — the full amount is treated as paid to the landlord now.</p>
                  ) : schedulePreview.length === 0 ? (
                    <p className="px-3 py-2.5 text-xs text-slate-500">Enter an amount, start date and period count to preview the schedule.</p>
                  ) : (
                    <>
                      <div className="max-h-[420px] overflow-y-auto">
                        <table className="w-full text-[11px]">
                          <thead className="sticky top-0">
                            <tr className="border-b border-slate-200 bg-slate-50">
                              <th className="px-3 py-1 text-left font-bold uppercase tracking-wide text-slate-500">Period</th>
                              <th className="px-3 py-1 text-left font-bold uppercase tracking-wide text-slate-500">Due</th>
                              <th className="px-3 py-1 text-right font-bold uppercase tracking-wide text-slate-500">Principal</th>
                              <th className="px-3 py-1 text-right font-bold uppercase tracking-wide text-slate-500">Interest</th>
                              <th className="px-3 py-1 text-right font-bold uppercase tracking-wide text-slate-500">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {schedulePreview.map((item, index) => (
                              <tr key={index} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                                <td className="px-3 py-1.5 font-semibold text-slate-900 border-r border-gray-100">{item.periodLabel}</td>
                                <td className="px-3 py-1.5 text-slate-600 border-r border-gray-100">{fmtDatePreview(item.dueDate)}</td>
                                <td className="px-3 py-1.5 text-right tabular-nums text-slate-700 border-r border-gray-100">{money(item.principal)}</td>
                                <td className="px-3 py-1.5 text-right tabular-nums text-amber-700 border-r border-gray-100">{item.interest > 0 ? money(item.interest) : "—"}</td>
                                <td className="px-3 py-1.5 text-right tabular-nums font-bold text-slate-900">{money(item.total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-3 py-2">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{schedulePreview.length} installment{schedulePreview.length !== 1 ? "s" : ""}</span>
                        <span className="text-xs font-black text-slate-900">
                          {money(previewTotals.total)}
                          {previewTotals.interest > 0 && <span className="ml-1 font-normal text-slate-500">({money(previewTotals.principal)} + {money(previewTotals.interest)} interest)</span>}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex-shrink-0 border-t border-slate-200 bg-white px-3 py-2">
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={handleCancel} className="h-7 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || loadingRow}
              className={`flex h-7 items-center gap-1.5 px-3 text-xs font-black text-white transition ${saving || loadingRow ? "bg-slate-400 cursor-not-allowed" : "bg-[#0B3B2E] hover:bg-[#0A3127]"}`}
            >
              {saving ? <Spinner size="sm" /> : <FaSave size={11} />}
              {saving ? (isEditMode ? "Updating…" : "Saving…") : isEditMode ? "Update Advance" : "Save Advance"}
            </button>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default AddLandlordAdvancement;
