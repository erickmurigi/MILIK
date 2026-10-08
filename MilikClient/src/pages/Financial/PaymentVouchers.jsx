import React, { useCallback, useEffect, useMemo, useState } from "react";
import BankDetailsFields from "../../components/common/BankDetailsFields";
import { printDocument, printTabularList } from "../../utils/printKit";
import { useEntityCache } from "../../hooks/useEntityCache";
import AppSelect from "../../components/common/AppSelect";
import { adminRequests } from "../../utils/requestMethods";
import useDebounce from "../../hooks/useDebounce";
import {
  FaBook,
  FaCheck,
  FaDownload,
  FaEdit,
  FaFileInvoiceDollar,
  FaFilePdf,
  FaFilter,
  FaPlus,
  FaPrint,
  FaSave,
  FaSearch,
  FaTrash,
  FaUndo,
} from "react-icons/fa";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import { useLocation, useNavigate } from "react-router-dom";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import JournalEntriesDrawer from "../../components/Accounting/JournalEntriesDrawer";
import { isSelfManagingLandlordCompany } from "../../utils/companyModules";
import { selectCurrentCompany, selectCurrentUser, selectAllProperties } from "../../redux/selectors";
import { hasCompanyPermission } from "../../utils/permissions";
import useScopedSessionDraft, { buildScopedDraftKey } from "../../hooks/useScopedSessionDraft";
import { useConfirm } from "../../context/ConfirmContext";
import { fmtDate } from "../../utils/dates";
import {
  createPaymentVoucher,
  deletePaymentVoucher,
  getChartOfAccounts,
  getPaymentVouchers,
  getServiceProviders,
  updatePaymentVoucher,
  updatePaymentVoucherStatus,
} from "../../redux/apiCalls";
import { getProperties } from "../../redux/propertyRedux";
import { fetchCompanySettings, selectCompanySettings } from "../../redux/companySettingsRedux";
import { useTabState } from "../../hooks/useTabState";
import PaginationBar from '../../components/PaginationBar';
import MilikTable from '../../components/common/MilikTable';
import ListToolbar from '../../components/common/ListToolbar';

const DEFAULT_PAGE_SIZE = 50;
const isRawObjectId = (s) => /^[a-f\d]{24}$/i.test(String(s || ""));

// Same field standard as the landlord form: bold labels, compact square inputs, readable text.
const VOUCHER_LABEL = "mb-1 block text-xs font-bold text-slate-900";
const VOUCHER_INPUT = "h-7 w-full border border-slate-300 bg-white px-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-500 transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";
const whtFor = (gross, rate) => Math.round(Number(gross || 0) * Number(rate || 0)) / 100;
// Landlord-side vouchers post to a property control account, so their lines have no payable or expense account of their own
const LANDLORD_CONTROL_CATEGORY_VALUES = new Set(["landlord_maintenance", "landlord_other", "deposit_refund"]);
const formatKes = (value) => `KES ${Number(value || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const wordsBelowThousand = (n) => {
  const parts = [];
  if (n >= 100) { parts.push(`${ONES[Math.floor(n / 100)]} Hundred`); n %= 100; if (n) parts.push("and"); }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "")); }
  else if (n > 0) parts.push(ONES[n]);
  return parts.join(" ");
};
/** 1250.5 -> "Kenya Shillings One Thousand Two Hundred and Fifty and Fifty Cents Only" (printed on a voucher so the figure can't be altered unnoticed) */
const amountInWords = (value) => {
  const total = Math.round(Number(value) * 100);
  if (!Number.isFinite(total) || total <= 0) return "";
  let shillings = Math.floor(total / 100);
  const cents = total % 100;
  const scales = ["", "Thousand", "Million", "Billion", "Trillion"];
  const groups = [];
  for (let i = 0; shillings > 0 && i < scales.length; i += 1, shillings = Math.floor(shillings / 1000)) {
    const chunk = shillings % 1000;
    if (chunk) groups.unshift(`${wordsBelowThousand(chunk)}${scales[i] ? ` ${scales[i]}` : ""}`);
  }
  const shillingWords = groups.join(" ") || "Zero";
  return `Kenya Shillings ${shillingWords}${cents ? ` and ${wordsBelowThousand(cents)} Cents` : ""} Only`;
};

const PMS_CATEGORIES = [
  { value: "landlord_maintenance", label: "Accounts Payable – Maintenance", landlordLabel: "Accounts Payable – Maintenance", propertyRequired: true,  explicitDebitAccount: false, pmsOnly: true },
  { value: "deposit_refund",       label: "Deposit Refund (Liability Release)", landlordLabel: "Deposit Refund (Liability Release)", propertyRequired: true,  explicitDebitAccount: false, pmsOnly: true },
  { value: "landlord_other",       label: "Accounts Payable – Other",       landlordLabel: "Accounts Payable – Other",       propertyRequired: true,  explicitDebitAccount: false, pmsOnly: true },
  { value: "manager_property",     label: "Operating Expense (Property)",   landlordLabel: "Operating Expense (Property)",   propertyRequired: true,  explicitDebitAccount: true,  pmsOnly: true },
];
const BASE_CATEGORIES = [
  ...PMS_CATEGORIES,
  { value: "company_operational", label: "Operating Expense (Company)", landlordLabel: "Operating Expense (Company)", propertyRequired: false, explicitDebitAccount: true },
  { value: "petty_cash_float",    label: "Petty Cash Float Top-up",    landlordLabel: "Petty Cash Float Top-up",    propertyRequired: false, explicitDebitAccount: true },
  { value: "petty_cash_expense",  label: "Petty Cash Expense",         landlordLabel: "Petty Cash Expense",         propertyRequired: false, explicitDebitAccount: true },
];

const CASHBOOK_PATTERN = /cash|bank|m-?pesa|mobile money|wallet|petty|till|collection/i;
const isCashbookLikeAccount = (account = {}) =>
  String(account?.type || "").toLowerCase() === "asset" &&
  CASHBOOK_PATTERN.test(`${account?.name || ""} ${account?.group || ""} ${account?.subGroup || ""}`);

const statusColors = {
  draft: "bg-slate-100 text-slate-700 border-slate-200",
  approved: "bg-blue-100 text-blue-700 border-blue-200",
  paid: "bg-green-100 text-green-700 border-green-200",
  reversed: "bg-amber-100 text-amber-700 border-amber-200",
};

const newVoucherLine = (seed = {}) => ({
  key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  expenseItemId: "",
  description: "",
  propertyId: "",
  expenseAccountId: "",
  payableAccountId: "",
  amount: "",
  whtRate: "",
  ...seed,
});
// A single-amount voucher (from a statement or requisition) becomes one line
const rateFromAmounts = (amount, wht) =>
  Number(amount) > 0 && Number(wht) > 0 ? String(Math.round((Number(wht) / Number(amount)) * 10000) / 100) : "";
const withVoucherLines = (form) => (form.lines?.length
  ? form
  : { ...form, lines: [newVoucherLine({ amount: String(form.amount || ""), whtRate: rateFromAmounts(form.amount, form.whtAmount) })] });

const blankForm = {
  category: "company_operational",
  propertyId: "",
  debitAccountId: "",
  settlementAccountId: "",
  lines: [newVoucherLine()],
  whtAccountId: "",
  serviceProviderId: "",
  payeeName: "",
  payeeBank: { bankName: "", branchName: "", accountName: "", accountNumber: "", mobileNumber: "" },
  paymentMethod: "bank_transfer",
  dueDate: new Date().toISOString().split("T")[0],
  narration: "",
  status: "draft",
  reference: "",
  sourceRequisitionId: "",
  sourceRequisitionNo: "",
};

const PaymentVouchers = () => {
  const confirm = useConfirm();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const properties = useSelector(selectAllProperties);
  const { propertiesLoaded } = useEntityCache(currentCompany?._id);
  const hasPMS = Boolean(currentCompany?.modules?.propertyManagement);
  const isLandlordWorkspace = useMemo(
    () => isSelfManagingLandlordCompany(currentCompany || currentUser?.company || null),
    [currentCompany, currentUser?.company]
  );
  const categories = useMemo(
    () => BASE_CATEGORIES
      .filter((c) => hasPMS || !c.pmsOnly)
      .map((c) => ({ ...c, label: isLandlordWorkspace ? c.landlordLabel : c.label })),
    [hasPMS, isLandlordWorkspace]
  );
  const canCreateVoucher = hasCompanyPermission(currentUser || {}, currentCompany, "paymentVouchers", "create", "accounts");
  const canUpdateVoucher = hasCompanyPermission(currentUser || {}, currentCompany, "paymentVouchers", "update", "accounts");
  const canApproveVoucher = hasCompanyPermission(currentUser || {}, currentCompany, "paymentVouchers", "process", "accounts");
  const canReverseVoucher = hasCompanyPermission(currentUser || {}, currentCompany, "paymentVouchers", "reverse", "accounts");
  const canDeleteVoucher = hasCompanyPermission(currentUser || {}, currentCompany, "paymentVouchers", "delete", "accounts");

  const voucherDraftKey = buildScopedDraftKey({
    page: "payment-vouchers",
    companyId: currentCompany?._id,
    userId: currentUser?._id || currentUser?.id || currentUser?.email,
  });
  const [voucherDraft, setVoucherDraft] = useScopedSessionDraft(voucherDraftKey, {
    filters: { search: "", category: "all", status: "all", propertyId: "all", startDate: "", endDate: "" },
  });
  const filters = voucherDraft.filters || { search: "", category: "all", status: "all", propertyId: "all", startDate: "", endDate: "" };
  const debouncedSearch = useDebounce(filters.search, 400);
  const setFilters = useCallback((value) => setVoucherDraft((prev) => ({ ...prev, filters: typeof value === "function" ? value(prev.filters || filters) : value })), []);
  const setFilter = useCallback((key) => (e) => setFilters((prev) => ({ ...prev, [key]: e.target.value })), [setFilters]);
  const [vouchers, setVouchers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rowActionKey, setRowActionKey] = useState("");
  const [liabilityAccounts, setLiabilityAccounts] = useState([]);
  const [debitAccounts, setDebitAccounts] = useState([]);
  const [settlementAccounts, setSettlementAccounts] = useState([]);
  const [serviceProvidersList, setServiceProvidersList] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [pageSize, setPageSize] = useTabState("/accounts/payment-vouchers:pageSize", DEFAULT_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useTabState("/accounts/payment-vouchers:currentPage", 1);
  const [serverTotal, setServerTotal] = useState(0);
  const [serverPages, setServerPages] = useState(1);
  const [pendingPayVoucher, setPendingPayVoucher] = useState(null);
  const [pendingPaySettlementId, setPendingPaySettlementId] = useState("");
  // Lazy initializer avoids a flash of the list on a direct/refreshed load of the
  // "/new" URL — the sync effect below (which reruns on every subsequent route
  // change, not just mount) is what actually fixes the stale-modal bug.
  const [showModal, setShowModal] = useState(() => location.pathname === "/accounts/payment-vouchers/new");
  const [editingVoucherId, setEditingVoucherId] = useState("");
  const [glVoucher, setGlVoucher] = useState(null);
  const [form, setForm] = useState(blankForm);
  const editingVoucher = useMemo(() => (editingVoucherId ? vouchers.find((row) => row._id === editingVoucherId) : null), [editingVoucherId, vouchers]);
  const selectedCategoryMeta = useMemo(
    () => categories.find((category) => category.value === form.category) || categories[0] || BASE_CATEGORIES[0],
    [categories, form.category]
  );
  const selectedSettlementAcc = useMemo(() => settlementAccounts.find((a) => String(a._id) === form.settlementAccountId), [settlementAccounts, form.settlementAccountId]);
  const selectedServiceProvider = useMemo(() => serviceProvidersList.find((sp) => String(sp._id) === form.serviceProviderId), [serviceProvidersList, form.serviceProviderId]);
  const companySettings = useSelector(selectCompanySettings);
  const expenseItems = useMemo(() => companySettings?.expenseItems || [], [companySettings]);
  const expenseItemOptions = useMemo(
    () => expenseItems.filter((item) => item?.isActive !== false).map((item) => ({ value: String(item._id), label: item.name })),
    [expenseItems]
  );
  const lineTotals = useMemo(() => {
    const amount = form.lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
    const wht = form.lines.reduce((sum, line) => sum + whtFor(line.amount, line.whtRate), 0);
    return { amount: Math.round(amount * 100) / 100, wht: Math.round(wht * 100) / 100 };
  }, [form.lines]);

  const showExpenseAccountColumn = Boolean(selectedCategoryMeta?.explicitDebitAccount) && form.category !== "petty_cash_float";

  const defaultWhtAccount = useMemo(() => liabilityAccounts.find((a) => String(a.code) === "2141"), [liabilityAccounts]);
  const defaultPayable = companySettings?.accountingDefaultsResolved?.accountsPayableAccount || null;
  const defaultPayableLabel = defaultPayable ? `${defaultPayable.code ? `${defaultPayable.code} – ` : ""}${defaultPayable.name}` : "";
  const isPaidNow = form.status === "paid";
  const showPayableColumn = !LANDLORD_CONTROL_CATEGORY_VALUES.has(form.category);

  // Journal preview: one debit per expense account, and one credit per payable (or cash when paid now), summed from the lines
  const journalPreview = useMemo(() => {
    const accountLabel = (id) => {
      const account = [...debitAccounts, ...liabilityAccounts].find((a) => String(a._id) === String(id));
      return account ? `${account.code} – ${account.name}` : null;
    };
    const sumBy = (keyOf) => {
      const rows = new Map();
      for (const line of form.lines) {
        const amount = Number(line.amount) || 0;
        if (!amount) continue;
        const key = keyOf(line);
        rows.set(key, (rows.get(key) || 0) + amount);
      }
      return Array.from(rows, ([key, amount]) => ({ key, amount }));
    };
    const explicit = selectedCategoryMeta?.explicitDebitAccount && form.category !== "petty_cash_float";
    const debits = sumBy((line) => line.expenseAccountId || "").map((row) => ({
      ...row,
      label: accountLabel(row.key) || (explicit ? null : "Auto from category"),
    }));
    const payables = sumBy((line) => line.payableAccountId || defaultPayable?._id || "").map((row) => ({
      ...row,
      label: accountLabel(row.key) || defaultPayableLabel || "No default payable set",
    }));
    return { debits, payables };
  }, [form.lines, form.category, selectedCategoryMeta, debitAccounts, liabilityAccounts, defaultPayable, defaultPayableLabel]);

  const whtAccountLabel = form.whtAccountId
    ? (() => { const w = liabilityAccounts.find((a) => String(a._id) === form.whtAccountId); return w ? `${w.code} – ${w.name}` : "WHT Payable"; })()
    : `${defaultWhtAccount?.code || "2141"} – ${defaultWhtAccount?.name || "WHT Payable"}`;
  const journalRows = [
    ...journalPreview.debits.map((row) => ({ key: `dr-${row.key}`, side: "Dr", label: row.label || "Select expense account", amount: row.amount })),
    ...(isPaidNow
      ? [
        { key: "cash", side: "Cr", label: selectedSettlementAcc ? `${selectedSettlementAcc.code} – ${selectedSettlementAcc.name}` : "Select cashbook", amount: lineTotals.amount - lineTotals.wht },
        ...(lineTotals.wht > 0 ? [{ key: "wht", side: "Cr", label: whtAccountLabel, amount: lineTotals.wht }] : []),
      ]
      : journalPreview.payables.map((row) => ({ key: `cr-${row.key}`, side: "Cr", label: row.label, amount: row.amount }))),
  ];
  const journalTotals = journalRows.reduce((acc, row) => {
    if (row.side === "Dr") acc.dr += row.amount; else acc.cr += row.amount;
    return acc;
  }, { dr: 0, cr: 0 });

  const updateLine = (key, patch) => setForm((prev) => ({
    ...prev,
    lines: prev.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)),
  }));
  const addLine = () => setForm((prev) => ({
    ...prev,
    lines: [...prev.lines, newVoucherLine({ whtRate: prev.lines[prev.lines.length - 1]?.whtRate || "" })],
  }));
  const removeLine = (key) => setForm((prev) => (prev.lines.length > 1
    ? { ...prev, lines: prev.lines.filter((line) => line.key !== key) }
    : prev));
  // Picking an expense item brings its ledger account, and fills the description and amount when they are still empty
  const pickExpenseItem = (key, itemId) => {
    const item = expenseItems.find((i) => String(i._id) === String(itemId));
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.map((line) => (line.key !== key ? line : {
        ...line,
        expenseItemId: itemId ? String(itemId) : "",
        expenseAccountId: item?.expenseAccount ? String(item.expenseAccount) : "",
        payableAccountId: item?.payableAccount ? String(item.payableAccount) : "",
        description: line.description || item?.name || "",
        amount: line.amount || (item?.defaultAmount ? String(item.defaultAmount) : ""),
      })),
    }));
  };

  // Fills the payee bank from the chosen service provider, or from the landlord of the chosen property.
  // The server resolves the record, so the form and a saved voucher always agree.
  const fillPayeeBank = async ({ serviceProvider = "", property = "" }) => {
    if (!currentCompany?._id) return;
    try {
      const res = await adminRequests.get("/payment-vouchers/payee-bank", {
        params: { business: currentCompany._id, serviceProvider, property, category: form.category },
      });
      const bank = res?.data?.payeeBank;
      if (bank) setForm((prev) => ({ ...prev, payeeBank: { ...blankForm.payeeBank, ...bank } }));
    } catch (error) {
      // Filling is a convenience; the bank can still be typed by hand. Logged so a failure can be traced.
      console.warn("Payee bank lookup failed", error?.response?.status, error?.message);
    }
  };


  const normalizeVoucher = (voucher) => ({
    ...voucher,
    propertyId: voucher?.property?._id || voucher?.property || voucher?.propertyId || "",
    propertyName: voucher?.property?.propertyName || voucher?.property?.name || voucher?.propertyName || (["company_operational", "petty_cash_float", "petty_cash_expense"].includes(String(voucher?.category || "")) ? "Company / Internal" : "N/A"),
    landlordName: voucher?.landlord?.landlordName || voucher?.landlord?.name || voucher?.landlordName || "N/A",
    liabilityAccountId: voucher?.liabilityAccount?._id || voucher?.liabilityAccount || voucher?.liabilityAccountId || "",
    liabilityAccountName: voucher?.liabilityAccount?.name || voucher?.liabilityAccountName || "N/A",
    debitAccountId: voucher?.debitAccount?._id || voucher?.debitAccount || voucher?.debitAccountId || "",
    debitAccountName: voucher?.debitAccount?.name || voucher?.debitAccountName || "N/A",
    settlementAccountId: voucher?.settlementAccount?._id || voucher?.settlementAccount || voucher?.settlementAccountId || "",
    settlementAccountName: voucher?.settlementAccount?.name || voucher?.settlementAccountName || "N/A",
    sourceRequisitionId: voucher?.sourceRequisition?._id || voucher?.sourceRequisition || voucher?.sourceRequisitionId || "",
    sourceRequisitionNo: voucher?.sourceRequisition?.requisitionNo || voucher?.sourceRequisition?.referenceNo || voucher?.sourceRequisitionNo || "",
    serviceProviderId: voucher?.serviceProvider?._id || voucher?.serviceProvider || voucher?.serviceProviderId || "",
    serviceProviderName: voucher?.serviceProvider?.name || voucher?.serviceProviderName || "",
    payeeName: voucher?.payeeName || "",
    payeeBank: { ...blankForm.payeeBank, ...(voucher?.payeeBank || {}) },
    paymentMethod: voucher?.paymentMethod || "bank_transfer",
    // Who this voucher is actually payable to, across every category — a registered
    // landlord, a registered Service Provider, or a free-text payee name, in that
    // order. Drives the "Payee" list column and GL detail panel (see below); the
    // print template's own "Landlord / Owner" field intentionally keeps using
    // landlordName directly since it's landlord-specific, not a general payee.
    payeeDisplay:
      voucher?.landlord?.landlordName || voucher?.landlord?.name || voucher?.landlordName ||
      voucher?.serviceProvider?.name  || voucher?.serviceProviderName ||
      voucher?.payeeName || "",
    whtAmount: voucher?.whtAmount != null ? String(voucher.whtAmount) : "",
    whtAccountId: voucher?.whtAccountId?._id || voucher?.whtAccountId || "",
  });

  useEffect(() => {
    if (!currentCompany?._id || !hasPMS) return;
    if (!propertiesLoaded) dispatch(getProperties({ business: currentCompany._id }));
  }, [currentCompany?._id, hasPMS]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (currentCompany?._id) dispatch(fetchCompanySettings(currentCompany._id));
  }, [currentCompany?._id, dispatch]);

  // "/accounts/payment-vouchers" and "/accounts/payment-vouchers/new" both render
  // this same component, and React re-renders the SAME mounted instance across
  // that route change instead of remounting it (same component, same position).
  // Navigating between them via the tab bar (or back/forward, or a direct URL
  // load) only ever changes location.pathname — it never runs openCreate()'s or
  // closeForm()'s own setShowModal() calls. Without this, the "new voucher" form
  // stayed on screen after switching to a different tab because nothing told
  // showModal to close. This only fires when the route itself actually changes,
  // so it never fights openEdit() (which opens the modal without navigating).
  useEffect(() => {
    setShowModal(location.pathname === "/accounts/payment-vouchers/new");
  }, [location.pathname]);

  useEffect(() => {
    if (!location.state) return;

    const { openCreate, prefill, search } = location.state || {};

    if (search) {
      setFilters((prev) => ({ ...prev, search: String(search || "") }));
    }

    if (openCreate && prefill) {
      setEditingVoucherId("");
      setForm(withVoucherLines({
        ...blankForm,
        ...prefill,
      }));
      setShowModal(true);
    }

    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    const loadAccounts = async () => {
      if (!currentCompany?._id) return;
      try {
        const [rows, spData] = await Promise.all([
          getChartOfAccounts({ business: currentCompany._id }),
          getServiceProviders({ business: currentCompany._id, active: "true", limit: 200 }).catch(() => null),
        ]);
        const postingAccounts = Array.isArray(rows) ? rows.filter((row) => row?.isPosting !== false && row?.isActive !== false) : [];
        setLiabilityAccounts(postingAccounts.filter((row) => String(row?.type || "").toLowerCase() === "liability"));
        setDebitAccounts(
          postingAccounts.filter(
            (row) =>
              String(row?.type || "").toLowerCase() === "expense" ||
              isCashbookLikeAccount(row)
          )
        );
        setSettlementAccounts(postingAccounts.filter((row) => isCashbookLikeAccount(row)));
        const spRows = Array.isArray(spData?.data) ? spData.data : Array.isArray(spData) ? spData : [];
        setServiceProvidersList(spRows);
      } catch (error) {
        toast.error(error?.response?.data?.message || "Failed to load chart of accounts");
      }
    };
    loadAccounts();
  }, [currentCompany?._id]);

  const toAccountOptions = (list) =>
    list.map((a) => ({
      value: a._id,
      label: `${a.code} – ${a.name}`,
      description: [
        a.type ? a.type.charAt(0).toUpperCase() + a.type.slice(1) : "",
        a.subGroup || a.group || "",
      ].filter(Boolean).join(" · "),
    }));

  const liabilityAccountOptions = useMemo(() => toAccountOptions(liabilityAccounts), [liabilityAccounts]);
  const debitAccountOptions     = useMemo(() => toAccountOptions(debitAccounts),     [debitAccounts]);
  const settlementAccountOptions = useMemo(() => toAccountOptions(settlementAccounts), [settlementAccounts]);

  const propertyOptions = useMemo(
    () => properties.map((p) => ({ value: p._id, label: p.propertyName || p.name || "Property" })),
    [properties]
  );

  const categoryOptions = useMemo(
    () => categories.map((c) => ({ value: c.value, label: c.label })),
    [categories]
  );

  const loadVouchers = useCallback(async () => {
    if (!currentCompany?._id) return;
    setLoading(true);
    try {
      // "All statuses" means the working list (reversed vouchers hidden); "Everything" adds them back
      const showEverything = filters.status === "everything";
      const { data: rows, total, pages } = await getPaymentVouchers({
        ...filters,
        status: showEverything ? "all" : filters.status,
        includeReversed: showEverything,
        search: debouncedSearch,
        business: currentCompany._id,
        company: currentCompany._id,
        page: currentPage,
        limit: pageSize,
      });
      setVouchers((Array.isArray(rows) ? rows : []).map(normalizeVoucher));
      setServerTotal(total ?? 0);
      setServerPages(pages ?? 1);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load payment vouchers");
    } finally {
      setLoading(false);
    }
  }, [currentCompany?._id, debouncedSearch, filters.category, filters.status, filters.propertyId, filters.startDate, filters.endDate, currentPage, pageSize]);

  useEffect(() => {
    loadVouchers();
  }, [loadVouchers]);

  const filtered = vouchers;

  const stats = useMemo(() => {
    const total = filtered.reduce((sum, voucher) => sum + Number(voucher.amount || 0), 0);
    const paid = filtered.filter((voucher) => voucher.status === "paid").reduce((sum, voucher) => sum + Number(voucher.amount || 0), 0);
    const draft = filtered.filter((voucher) => voucher.status === "draft").length;
    return { count: filtered.length, total, paid, draft };
  }, [filtered]);

  const selectedRows = useMemo(() => filtered.filter((voucher) => selectedIds.includes(voucher._id)), [filtered, selectedIds]);

  // The on-screen table is server-paginated (one page at a time) — printing or
  // exporting the whole filtered register needs its own fetch with every matching
  // row, not just whatever page happens to be visible.
  const fetchAllFilteredVouchers = async () => {
    const showEverything = filters.status === "everything";
    const { data: rows } = await getPaymentVouchers({
      ...filters,
      status: showEverything ? "all" : filters.status,
      includeReversed: showEverything,
      search: debouncedSearch,
      business: currentCompany._id,
      company: currentCompany._id,
      page: 1,
      limit: 2000,
    });
    return (Array.isArray(rows) ? rows : []).map(normalizeVoucher);
  };

  const categoryLabel = (voucher) => categories.find((c) => c.value === voucher.category)?.label || voucher.category || "-";

  const handlePrintList = async () => {
    if (!currentCompany?._id) return;
    try {
      const printRows = await fetchAllFilteredVouchers();
      if (printRows.length === 0) {
        toast.info("There are no vouchers to print.");
        return;
      }
      const totalAmount = printRows.reduce((sum, v) => sum + Number(v.amount || 0), 0);
      const paidAmount = printRows.filter((v) => v.status === "paid").reduce((sum, v) => sum + Number(v.amount || 0), 0);
      const printed = printTabularList({
        title: "Payment Vouchers Register",
        subtitle: `${printRows.length.toLocaleString()} voucher${printRows.length !== 1 ? "s" : ""}`,
        company: currentCompany,
        summaryItems: [
          ["Total Records", printRows.length.toLocaleString()],
          ["Total Amount", `KES ${totalAmount.toLocaleString()}`],
          ["Paid", `KES ${paidAmount.toLocaleString()}`],
        ],
        columns: [
          { label: "Voucher #", value: (v) => v.voucherNo || "-" },
          { label: "Ref #", value: (v) => (isRawObjectId(v.reference) ? "-" : v.reference || "-") },
          { label: "Category", value: categoryLabel },
          { label: "Payee", value: (v) => v.payeeDisplay || v.payeeName || "-" },
          { label: "Property", value: (v) => v.propertyName || "-" },
          { label: "Amount", align: "right", bold: true, value: (v) => `KES ${Number(v.amount || 0).toLocaleString()}` },
          { label: "Due Date", value: (v) => fmtDate(v.dueDate) },
          { label: "Paid Date", value: (v) => (v.paidDate ? fmtDate(v.paidDate) : "-") },
          { label: "Status", value: (v) => String(v.status || "").toUpperCase() },
        ],
        rows: printRows,
        totalsRow: [`Total (${printRows.length.toLocaleString()} records)`, "", "", "", "", `KES ${totalAmount.toLocaleString()}`, "", "", ""],
      });
      if (!printed) toast.error("Pop-up blocked — allow pop-ups for this site to print");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load vouchers for printing");
    }
  };

  const handleExportCsv = async () => {
    if (!currentCompany?._id) return;
    try {
      const exportRows = await fetchAllFilteredVouchers();
      if (exportRows.length === 0) {
        toast.info("There are no vouchers to export.");
        return;
      }
      const header = ["Voucher #", "Ref #", "Category", "Payee", "Property", "Amount", "Due Date", "Paid Date", "Status"];
      const rows = exportRows.map((v) => [
        v.voucherNo || "",
        isRawObjectId(v.reference) ? "" : v.reference || "",
        categoryLabel(v),
        v.payeeDisplay || v.payeeName || "",
        v.propertyName || "",
        Number(v.amount || 0).toFixed(2),
        v.dueDate ? fmtDate(v.dueDate) : "",
        v.paidDate ? fmtDate(v.paidDate) : "",
        (v.status || "").toUpperCase(),
      ]);
      const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `payment-vouchers-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load vouchers for export");
    }
  };

  const totalPages = Math.max(1, serverPages);

  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, filters.category, filters.status, filters.propertyId, filters.startDate, filters.endDate, pageSize]);


  const closeForm = () => {
    setShowModal(false);
    if (location.pathname === "/accounts/payment-vouchers/new") {
      navigate("/accounts/payment-vouchers");
    }
  };

  const openCreate = (prefill = null) => {
    setEditingVoucherId("");
    setForm(prefill ? withVoucherLines({ ...blankForm, ...prefill }) : blankForm);
    setShowModal(true);
    navigate("/accounts/payment-vouchers/new");
  };

  const openEdit = (voucher) => {
    setEditingVoucherId(voucher._id);
    setForm({
      category: voucher.category || "landlord_maintenance",
      propertyId: voucher.propertyId || "",
      debitAccountId: voucher.debitAccountId || "",
      settlementAccountId: voucher.settlementAccountId || "",
      lines: voucher.lines?.length
        ? voucher.lines.map((line) => newVoucherLine({
          expenseItemId: line.expenseItem ? String(line.expenseItem) : "",
          description: line.description || "",
          propertyId: line.property?._id || line.property || "",
          expenseAccountId: line.expenseAccount?._id || line.expenseAccount || "",
          payableAccountId: line.payableAccount?._id || line.payableAccount || "",
          amount: String(line.amount ?? ""),
          whtRate: String(line.whtRate ?? ""),
        }))
        : [newVoucherLine({ amount: String(voucher.amount || ""), whtRate: rateFromAmounts(voucher.amount, voucher.whtAmount) })],
      whtAccountId: voucher.whtAccountId?._id || voucher.whtAccountId || "",
      serviceProviderId: voucher.serviceProviderId || "",
      payeeName: voucher.payeeName || "",
      payeeBank: { ...blankForm.payeeBank, ...(voucher.payeeBank || {}) },
      paymentMethod: voucher.paymentMethod || "bank_transfer",
      dueDate: voucher.dueDate ? new Date(voucher.dueDate).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
      narration: voucher.narration || "",
      status: voucher.status || "draft",
      reference: voucher.reference || "",
      sourceRequisitionId: voucher.sourceRequisitionId || "",
      sourceRequisitionNo: voucher.sourceRequisitionNo || "",
    });
    setShowModal(true);
  };

  const validateForm = () => {
    if (selectedCategoryMeta?.propertyRequired && !form.propertyId) return "Property is required for this voucher category";
    if (form.lines.some((line) => !(Number(line.amount) > 0))) return "Every line needs an amount greater than zero";
    if (form.category === "petty_cash_float" && !form.debitAccountId) return "Choose the petty cash account that receives the float";
    if (selectedCategoryMeta?.explicitDebitAccount && form.category !== "petty_cash_float" && form.lines.some((line) => !line.expenseAccountId)) {
      return "Each line needs an expense item or an expense account";
    }
    if (form.status === "paid" && !form.settlementAccountId) return "Settlement cashbook / petty cash account is required when saving a paid voucher";
    if (lineTotals.amount <= 0) return "Valid amount is required";
    return "";
  };

  const handleSave = async () => {
    const errorMessage = validateForm();
    if (errorMessage) {
      toast.warning(errorMessage);
      return;
    }

    const payload = {
      business: currentCompany?._id,
      company: currentCompany?._id,
      category: form.category,
      property: form.propertyId || undefined,
      debitAccount: form.debitAccountId || undefined,
      settlementAccount: form.settlementAccountId || undefined,
      lines: form.lines.map((line) => ({
        description: line.description || "",
        property: line.propertyId || undefined,
        expenseItem: line.expenseItemId || undefined,
        expenseAccount: line.expenseAccountId || undefined,
        payableAccount: line.payableAccountId || undefined,
        amount: Number(line.amount || 0),
        whtRate: Number(line.whtRate || 0),
      })),
      amount: lineTotals.amount,
      whtAmount: lineTotals.wht,
      whtAccountId: lineTotals.wht > 0 ? (form.whtAccountId || "") : "",
      serviceProvider: form.serviceProviderId || undefined,
      payeeName: form.serviceProviderId ? undefined : (form.payeeName || undefined),
      payeeBank: form.payeeBank,
      paymentMethod: form.paymentMethod || "bank_transfer",
      dueDate: form.dueDate,
      narration: form.narration,
      status: form.status,
      reference: String(form.reference || "").trim(), // '' clears it on an edit; the server refuses one already used by another voucher
      sourceRequisition: form.sourceRequisitionId || undefined,
    };

    setSaving(true);
    try {
      const saved = editingVoucherId
        ? await updatePaymentVoucher(editingVoucherId, payload, { business: currentCompany?._id, company: currentCompany?._id })
        : await createPaymentVoucher(payload);
      const normalized = normalizeVoucher(saved);
      setVouchers((prev) => editingVoucherId ? prev.map((row) => row._id === editingVoucherId ? normalized : row) : [normalized, ...prev]);
      closeForm();
      setEditingVoucherId("");
      setForm(blankForm);
      toast.success(`Voucher ${editingVoucherId ? "updated" : "saved"} successfully`);
    } catch (error) {
      toast.error(error?.response?.data?.message || `Failed to ${editingVoucherId ? "update" : "save"} payment voucher`);
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (voucher, status, overrideSettlementId = null) => {
    const id = voucher?._id;
    if (!id) return;

    if (status === "paid" && !voucher?.settlementAccountId && !overrideSettlementId) {
      setPendingPayVoucher(voucher);
      setPendingPaySettlementId("");
      return;
    }

    setRowActionKey(`${id}:${status}`);
    try {
      const statusPayload = { status };
      if (status === "paid" && (overrideSettlementId || voucher?.settlementAccountId)) {
        statusPayload.settlementAccount = overrideSettlementId || voucher.settlementAccountId;
      }
      const updated = await updatePaymentVoucherStatus(id, statusPayload, { business: currentCompany?._id, company: currentCompany?._id });
      setVouchers((prev) => prev.map((row) => row._id === id ? normalizeVoucher(updated) : row));
      toast.success(`Voucher marked ${status}`);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to update voucher status");
    } finally {
      setRowActionKey("");
    }
  };

  const confirmPendingPay = async () => {
    if (!pendingPaySettlementId) return toast.warning("Please select a settlement account");
    const voucher = pendingPayVoucher;
    setPendingPayVoucher(null);
    await updateStatus(voucher, "paid", pendingPaySettlementId);
  };

  const removeVoucher = async (voucher) => {
    if (!await confirm({ title: "Delete Voucher", message: `Delete voucher ${voucher?.voucherNo || ""}?`, confirmText: "Delete", isDangerous: true })) return;
    setRowActionKey(`${voucher._id}:delete`);
    try {
      await deletePaymentVoucher(voucher._id, { business: currentCompany?._id, company: currentCompany?._id });
      setVouchers((prev) => prev.filter((row) => row._id !== voucher._id));
      setSelectedIds((prev) => prev.filter((id) => id !== voucher._id));
      toast.success("Voucher deleted");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to delete voucher");
    } finally {
      setRowActionKey("");
    }
  };

  const handlePrintVoucher = (voucher) => {
    const catLabel = categories.find((c) => c.value === voucher.category)?.label || voucher.category || "—";
    const preparedByName = [currentUser?.otherNames, currentUser?.surname].filter(Boolean).join(" ") || currentUser?.email || "Milik Admin";
    const STATUS_TONE = { draft: "warning", approved: "info", paid: "success", reversed: "danger" };
    const paid = voucher.status === "paid";
    const printed = printDocument({
      company: currentCompany,
      docType: "Payment Voucher",
      docNumber: voucher.voucherNo || "",
      status: { label: voucher.status || "draft", tone: STATUS_TONE[voucher.status] || "neutral" },
      watermark: paid ? "PAID" : voucher.status === "reversed" ? "VOID" : "",
      meta: [["Due date", fmtDate(voucher.dueDate)]],
      parties: [
        { heading: "Pay to", name: voucher.payeeDisplay || voucher.landlordName || voucher.payeeName || "—", lines: [voucher.propertyName ? `Property: ${voucher.propertyName}` : ""] },
        { heading: "Purpose", name: catLabel, lines: [isRawObjectId(voucher.reference) ? "" : (voucher.reference ? `Reference: ${voucher.reference}` : ""), voucher.narration || ""] },
      ],
      table: {
        columns: [{ label: "Account", value: (r) => r.label }, { label: "Name", value: (r) => r.name }],
        rows: [
          { label: "Liability account", name: voucher.liabilityAccountName },
          { label: "Debit account", name: voucher.debitAccountName },
          { label: "Settlement account", name: voucher.settlementAccountName },
        ].filter((r) => r.name),
      },
      totals: [{ label: "Amount", value: `KES ${Number(voucher.amount || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, hero: true }],
      amountWords: { amount: Number(voucher.amount || 0), currency: currentCompany?.baseCurrency || "KES" },
      signatures: [{ label: "Prepared by", name: preparedByName }, { label: "Approved by" }, { label: "Received / paid by" }],
      stamp: true,
      preparedBy: preparedByName,
    });
    if (!printed) toast.error("Pop-up blocked — allow pop-ups for this site to print");
  };

  const downloadVoucherPdf = async (voucher) => {
    try {
      const response = await adminRequests.get(`/payment-vouchers/${voucher._id}/pdf`, {
        params: { business: currentCompany?._id, company: currentCompany?._id },
        responseType: "arraybuffer",
      });
      const url = window.URL.createObjectURL(new Blob([response.data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `voucher-${voucher.voucherNo || voucher._id}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error("Failed to download PDF");
    }
  };

  const toggleSelect = (id) => setSelectedIds((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);
  const toggleSelectAll = () => setSelectedIds((prev) => prev.length === filtered.length ? [] : filtered.map((voucher) => voucher._id));

  const bulkDeleteSelected = async () => {
    if (selectedRows.length === 0) return toast.info("Select vouchers first");
    if (!await confirm({ title: "Delete Vouchers", message: `Delete ${selectedRows.length} selected vouchers?`, confirmText: "Delete", isDangerous: true })) return;
    // one at a time: reversing posted vouchers touches the same accounts, and two reversals at once would fight over them
    const failed = [];
    for (const voucher of selectedRows) {
      try {
        await deletePaymentVoucher(voucher._id, { business: currentCompany?._id, company: currentCompany?._id });
      } catch (error) {
        failed.push(`${voucher.voucherNo || "voucher"}: ${error?.response?.data?.message || "failed"}`);
      }
    }
    await loadVouchers();
    setSelectedIds([]);
    if (failed.length) toast.error(`${selectedRows.length - failed.length} removed, ${failed.length} failed — ${failed[0]}`);
    else toast.success("Selected vouchers removed");
  };

  return (
    <DashboardLayout lockContentScroll>
      {showModal ? (
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white">

          {/* ── Breadcrumb header ── */}
          <header className="shrink-0 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
            <div className="flex items-center gap-2">
              <button
                onClick={closeForm}
                className="text-[11px] font-bold text-[#0B3B2E] transition hover:underline"
              >
                ← Payment Vouchers
              </button>
              <span className="text-xs text-slate-300">/</span>
              <span className="text-sm font-black text-slate-800">
                {editingVoucherId ? "Edit Voucher" : "New Voucher"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={closeForm}
                className="border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || (editingVoucherId ? !canUpdateVoucher : !canCreateVoucher)}
                className="flex items-center gap-1.5 bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white transition hover:bg-[#0A3127] disabled:opacity-50"
              >
                <FaSave size={10} />
                {saving ? "Saving…" : editingVoucherId ? "Update Voucher" : "Save Voucher"}
              </button>
            </div>
          </header>

          {/* ── Body ── */}
          <div className="flex flex-1 min-h-0 overflow-hidden">

            {/* LEFT: Form — laid out in cards so it fits one screen */}
            <div className="flex-1 overflow-y-auto bg-slate-50/60 px-3 py-2 space-y-2 min-w-0">

              {form.sourceRequisitionNo && (
                <div className="flex items-center gap-3 border border-violet-200 bg-violet-50 px-4 py-2">
                  <FaFileInvoiceDollar size={13} className="shrink-0 text-violet-400" />
                  <p className="text-[10px] font-black uppercase tracking-wider text-violet-500">Linked from requisition</p>
                  <p className="text-sm font-bold text-violet-800">{form.sourceRequisitionNo}</p>
                </div>
              )}

              {/* ── Voucher header ── */}
              <section className="border border-slate-200 bg-white p-3 shadow-sm">
                <div className="mb-2 flex items-center gap-2">
                  <div className="h-3.5 w-0.5 bg-[#0B3B2E]" />
                  <h2 className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Voucher details</h2>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 lg:grid-cols-6">
                  {editingVoucherId && (
                    <label className="block">
                      <span className={VOUCHER_LABEL}>Voucher No.</span>
                      <input
                        readOnly
                        value={editingVoucher?.voucherNo || ""}
                        className={`${VOUCHER_INPUT} bg-slate-50 font-mono text-slate-500`}
                      />
                    </label>
                  )}
                  <div className="lg:col-span-2">
                    <AppSelect
                      label="Category *"
                      value={form.category}
                      onChange={(val) => setForm((prev) => ({ ...prev, category: val ?? prev.category }))}
                      options={categoryOptions}
                    />
                  </div>
                  <label className="block">
                    <span className={VOUCHER_LABEL}>Reference / Cheque No.</span>
                    <input
                      value={form.reference}
                      maxLength={100}
                      onChange={(e) => setForm((prev) => ({ ...prev, reference: e.target.value }))}
                      placeholder="e.g. CHQ-001"
                      title="Each payment voucher needs its own reference"
                      className={VOUCHER_INPUT}
                    />
                  </label>
                  <label className="block">
                    <span className={VOUCHER_LABEL}>Due date <span className="text-red-500">*</span></span>
                    <input
                      type="date"
                      value={form.dueDate}
                      onChange={(e) => setForm((prev) => ({ ...prev, dueDate: e.target.value }))}
                      className={VOUCHER_INPUT}
                    />
                  </label>
                  <div>
                    <AppSelect
                      label="Payment method"
                      value={form.paymentMethod}
                      onChange={(val) => setForm((prev) => ({ ...prev, paymentMethod: val ?? "bank_transfer" }))}
                      options={[
                        { value: "bank_transfer", label: "Bank transfer" },
                        { value: "mobile_money",  label: "M-Pesa" },
                        { value: "cash",          label: "Cash" },
                        { value: "cheque",        label: "Cheque" },
                        { value: "other",         label: "Other" },
                      ]}
                    />
                  </div>
                  {!editingVoucherId ? (
                    <div>
                      <AppSelect
                        label="Save as"
                        value={form.status}
                        onChange={(val) => setForm((prev) => ({ ...prev, status: val ?? "draft" }))}
                        options={[
                          { value: "draft",    label: "Draft" },
                          { value: "approved", label: "Approved" },
                          { value: "paid",     label: "Paid now" },
                        ]}
                      />
                    </div>
                  ) : (
                    <label className="block">
                      <span className={VOUCHER_LABEL}>Status</span>
                      <input readOnly value={editingVoucher?.status || "draft"} className={`${VOUCHER_INPUT} bg-slate-50 capitalize text-slate-500`} />
                    </label>
                  )}
                </div>
                {form.status === "paid" && !editingVoucherId && (
                  <p className="mt-1.5 text-[10px] font-semibold text-amber-600">Paid posts both the accrual and the settlement entries straight away, so a settlement account is required.</p>
                )}
              </section>

              <div className="flex flex-col gap-3">

                {/* ── Payee & amount ── */}
                <section className="border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="mb-2 flex items-center gap-2">
                    <div className="h-3.5 w-0.5 bg-emerald-500" />
                    <h2 className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Payee &amp; amount</h2>
                  </div>

                  <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
                    <div>
                      <AppSelect
                        label="Service provider"
                        value={form.serviceProviderId}
                        onChange={(v) => {
                          const spId = v ?? "";
                          if (spId) {
                            // Fill at once from the provider already loaded in this form, then confirm with the server
                            const picked = serviceProvidersList.find((s) => String(s._id) === spId);
                            if (picked) {
                              setForm((prev) => ({
                                ...prev,
                                payeeBank: {
                                  bankName: picked.bankName || "",
                                  branchName: picked.branchName || "",
                                  accountName: picked.accountName || "",
                                  accountNumber: picked.accountNumber || "",
                                  mobileNumber: picked.mobileNumber || "",
                                },
                              }));
                            }
                            fillPayeeBank({ serviceProvider: spId });
                          }
                          const sp = serviceProvidersList.find((s) => String(s._id) === spId);
                          setForm((prev) => {
                            if (sp?.subjectToWht && Number(sp?.whtRate) > 0) {
                              const rate = String(sp.whtRate);
                              return { ...prev, serviceProviderId: spId, lines: prev.lines.map((line) => ({ ...line, whtRate: rate })) };
                            }
                            // moving off a vendor that carried tax takes its tax with it
                            return selectedServiceProvider?.subjectToWht
                              ? { ...prev, serviceProviderId: spId, lines: prev.lines.map((line) => ({ ...line, whtRate: "" })), whtAccountId: "" }
                              : { ...prev, serviceProviderId: spId };
                          });
                        }}
                        options={serviceProvidersList.map((sp) => ({ value: sp._id, label: `${sp.name}${sp.subjectToWht ? ` (WHT ${sp.whtRate}%)` : ""}` }))}
                        placeholder={serviceProvidersList.length > 0 ? "— None —" : "No registered vendors yet"}
                        size="md"
                        searchable
                        clearable
                        disabled={serviceProvidersList.length === 0}
                      />
                    </div>
                    <label className="block">
                      <span className={VOUCHER_LABEL}>Payee name {form.serviceProviderId ? "" : "(one-off payee)"}</span>
                      <input
                        value={form.serviceProviderId ? (selectedServiceProvider?.name || "") : form.payeeName}
                        disabled={Boolean(form.serviceProviderId)}
                        maxLength={150}
                        onChange={(e) => setForm((prev) => ({ ...prev, payeeName: e.target.value }))}
                        placeholder="Who is being paid?"
                        className={`${VOUCHER_INPUT} h-9 disabled:bg-slate-50 disabled:text-slate-500`}
                      />
                    </label>
                    {hasPMS && selectedCategoryMeta?.propertyRequired && (
                      <div className="sm:col-span-2">
                        <AppSelect
                          label="Property *"
                          value={form.propertyId}
                          onChange={(val) => {
                            setForm((prev) => ({ ...prev, propertyId: val ?? "" }));
                            if (val && !form.serviceProviderId) fillPayeeBank({ property: val });
                          }}
                          options={propertyOptions}
                          placeholder={selectedCategoryMeta?.propertyRequired ? "Select property…" : "No property — company level"}
                          searchable
                          clearable
                        />
                      </div>
                    )}
                  </div>

                  {/* ── Payee bank: prefilled from the linked provider or landlord; optional ── */}
                  <div className="mt-2">
                    <BankDetailsFields
                      values={form.payeeBank}
                      onChange={(field, value) => setForm((prev) => ({ ...prev, payeeBank: { ...prev.payeeBank, [field]: value } }))}
                      title="Payee bank & payment details"
                      hideBranch
                    />
                  </div>

                  {/* ── Lines: each charge has its own expense item, property and WHT rate ── */}
                  <div className="mt-2">
                    <div className="mb-1 flex items-center justify-between">
                      <span className={VOUCHER_LABEL}>Lines</span>
                      <button type="button" onClick={addLine} className="flex items-center gap-1 text-[11px] font-bold text-[#0B3B2E] hover:underline">
                        <FaPlus size={9} /> Add line
                      </button>
                    </div>
                    <div className="overflow-x-auto border border-slate-200">
                      <table className="w-full min-w-[860px] table-auto text-[11px]">
                        <thead className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-2 py-1">Expense item</th>
                            {showExpenseAccountColumn && <th className="px-2 py-1">Expense account</th>}
                            {showPayableColumn && <th className="px-2 py-1">Payable</th>}
                            <th className="px-2 py-1">Description</th>
                            {!selectedCategoryMeta?.propertyRequired && <th className="px-2 py-1">Property</th>}
                            <th className="px-2 py-1 text-right">Amount</th>
                            <th className="px-2 py-1 text-right">WHT %</th>
                            <th className="px-2 py-1 text-right">WHT</th>
                            <th className="px-1 py-1" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {form.lines.map((line) => (
                            <tr key={line.key} className="align-middle">
                              <td className="px-1 py-1">
                                <AppSelect
                                  value={line.expenseItemId}
                                  onChange={(v) => pickExpenseItem(line.key, v)}
                                  options={expenseItemOptions}
                                  placeholder={expenseItemOptions.length ? "Select item" : "No expense items"}
                                  size="sm"
                                  searchable
                                  clearable
                                  disabled={expenseItemOptions.length === 0}
                                />
                              </td>
                              {showExpenseAccountColumn && (
                                <td className="px-1 py-1">
                                  <AppSelect
                                    value={line.expenseAccountId}
                                    onChange={(v) => updateLine(line.key, { expenseAccountId: v ?? "" })}
                                    options={debitAccountOptions}
                                    placeholder="Expense account"
                                    size="sm"
                                    searchable
                                    clearable
                                  />
                                </td>
                              )}
                              {showPayableColumn && (
                                <td className="px-1 py-1">
                                  <AppSelect
                                    value={line.payableAccountId}
                                    onChange={(v) => updateLine(line.key, { payableAccountId: v ?? "" })}
                                    options={liabilityAccountOptions}
                                    placeholder={isPaidNow ? "Not needed when paid now" : defaultPayableLabel ? `${defaultPayableLabel} (default)` : "Set a default payable"}
                                    size="sm"
                                    searchable
                                    clearable
                                    disabled={isPaidNow}
                                  />
                                </td>
                              )}
                              <td className="min-w-[160px] px-1 py-1">
                                <input
                                  value={line.description}
                                  maxLength={200}
                                  onChange={(e) => updateLine(line.key, { description: e.target.value })}
                                  placeholder="What for?"
                                  className={`${VOUCHER_INPUT} h-7`}
                                />
                              </td>
                              {!selectedCategoryMeta?.propertyRequired && (
                                <td className="px-1 py-1">
                                  <AppSelect
                                    value={line.propertyId}
                                    onChange={(v) => updateLine(line.key, { propertyId: v ?? "" })}
                                    options={propertyOptions}
                                    placeholder={form.propertyId ? "Voucher property" : "Company"}
                                    size="sm"
                                    searchable
                                    clearable
                                  />
                                </td>
                              )}
                              <td className="px-1 py-1">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={line.amount}
                                  onChange={(e) => updateLine(line.key, { amount: e.target.value })}
                                  placeholder="0.00"
                                  className={`${VOUCHER_INPUT} h-7 text-right font-bold tabular-nums`}
                                />
                              </td>
                              <td className="px-1 py-1">
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="0.01"
                                  value={line.whtRate}
                                  onChange={(e) => updateLine(line.key, { whtRate: e.target.value })}
                                  placeholder="0"
                                  className={`${VOUCHER_INPUT} h-7 text-right tabular-nums`}
                                />
                              </td>
                              <td className="px-2 py-1 text-right font-semibold tabular-nums text-amber-800">
                                {whtFor(line.amount, line.whtRate) > 0 ? formatKes(whtFor(line.amount, line.whtRate)).replace("KES ", "") : "—"}
                              </td>
                              <td className="px-1 py-1 text-center">
                                <button
                                  type="button"
                                  onClick={() => removeLine(line.key)}
                                  disabled={form.lines.length === 1}
                                  title="Remove line"
                                  className="p-1 text-slate-400 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-30"
                                >
                                  <FaTrash size={10} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="border-t border-slate-200 bg-slate-50 text-[11px] font-bold tabular-nums text-slate-900">
                          <tr>
                            <td colSpan={2 + (showExpenseAccountColumn ? 1 : 0) + (showPayableColumn ? 1 : 0) + (selectedCategoryMeta?.propertyRequired ? 0 : 1)} className="px-2 py-1 text-right text-[10px] uppercase tracking-wide text-slate-500">Total</td>
                            <td className="px-2 py-1 text-right">{lineTotals.amount.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            <td />
                            <td className="px-2 py-1 text-right text-amber-800">{lineTotals.wht > 0 ? lineTotals.wht.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                    {selectedServiceProvider?.subjectToWht && Number(selectedServiceProvider?.whtRate) > 0 && (
                      <p className="mt-1 text-[10px] text-slate-400">{selectedServiceProvider.name} is subject to {selectedServiceProvider.whtRate}% WHT on each line.</p>
                    )}
                  </div>

                  {lineTotals.amount > 0 && (
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px]">
                      <span className="italic text-slate-500">{amountInWords(lineTotals.amount)}</span>
                      <span className="font-semibold tabular-nums text-slate-700">
                        Gross {formatKes(lineTotals.amount)}
                        {lineTotals.wht > 0 && <> · WHT {formatKes(lineTotals.wht)} · <span className="font-black text-slate-900">Net {formatKes(lineTotals.amount - lineTotals.wht)}</span></>}
                      </span>
                    </div>
                  )}

                  {lineTotals.wht > 0 && (
                    <div className="mt-2 grid grid-cols-1 gap-x-3 sm:grid-cols-2">
                      <AppSelect
                        label="WHT payable account"
                        value={form.whtAccountId}
                        onChange={(val) => setForm((prev) => ({ ...prev, whtAccountId: val ?? "" }))}
                        options={liabilityAccountOptions}
                        placeholder={defaultWhtAccount ? `Default — ${defaultWhtAccount.code} ${defaultWhtAccount.name}` : "Default — 2141 Withholding Tax Payable"}
                        searchable
                        clearable
                      />
                    </div>
                  )}

                  {(form.category === "petty_cash_float" || form.status === "paid") && (
                  <div className="mt-2 grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
                    {form.category === "petty_cash_float" && (
                      <AppSelect
                        label="Petty cash account *"
                        value={form.debitAccountId}
                        onChange={(val) => setForm((prev) => ({ ...prev, debitAccountId: val ?? "" }))}
                        options={debitAccountOptions}
                        placeholder="Search expense / asset account…"
                        searchable
                        clearable
                      />
                    )}
                    {form.status === "paid" && (
                      <AppSelect
                        label="Paid from (cashbook) *"
                        value={form.settlementAccountId}
                        onChange={(val) => setForm((prev) => ({ ...prev, settlementAccountId: val ?? "" }))}
                        options={settlementAccountOptions}
                        placeholder="Search cashbook / petty cash…"
                        searchable
                        clearable
                      />
                    )}
                  </div>
                  )}

                  <label className="mt-2 block">
                    <span className={VOUCHER_LABEL}>Narration / description</span>
                    <textarea
                      rows={2}
                      maxLength={1000}
                      value={form.narration}
                      onChange={(e) => setForm((prev) => ({ ...prev, narration: e.target.value }))}
                      placeholder="What is this payment for?"
                      className={`${VOUCHER_INPUT} resize-none`}
                    />
                  </label>

                  <div className="mt-3">
                    <p className={VOUCHER_LABEL}>Journal entries {isPaidNow ? "(paid now)" : "(on approval)"}</p>
                    <div className="overflow-hidden border border-slate-200">
                      <table className="w-full text-[11px]">
                        <thead className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="w-12 px-2 py-1">Side</th>
                            <th className="px-2 py-1">Account</th>
                            <th className="w-36 px-2 py-1 text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {journalRows.length === 0 && (
                            <tr>
                              <td colSpan={3} className="px-2 py-2 text-center italic text-slate-400">Add a line with an amount to see the entries.</td>
                            </tr>
                          )}
                          {journalRows.map((row) => (
                            <tr key={row.key}>
                              <td className={`px-2 py-1 font-black ${row.side === "Dr" ? "text-blue-700" : "text-emerald-700"}`}>{row.side}</td>
                              <td className={`px-2 py-1 font-semibold ${row.label.startsWith("Select") || row.label.startsWith("No default") ? "italic text-slate-400" : "text-slate-800"}`}>{row.label}</td>
                              <td className="px-2 py-1 text-right tabular-nums">{row.amount.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            </tr>
                          ))}
                        </tbody>
                        {journalRows.length > 0 && (
                          <tfoot className="border-t border-slate-200 bg-slate-50 font-bold tabular-nums text-slate-900">
                            <tr>
                              <td />
                              <td className="px-2 py-1 text-right text-[10px] uppercase tracking-wide text-slate-500">Totals (debit · credit)</td>
                              <td className="px-2 py-1 text-right">
                                {journalTotals.dr.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · {journalTotals.cr.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  </div>
                </section>

              </div>
            </div>

          </div>
        </div>
      ) : (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 p-1 sm:p-2">
        <div className="mx-auto flex h-full w-full max-w-none flex-col overflow-hidden">

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-slate-200 bg-white">
            <ListToolbar>
              <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">Vouchers: {serverTotal}</span>
              <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">Total: KES {stats.total.toLocaleString()}</span>
              <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">Paid: KES {stats.paid.toLocaleString()}</span>
              <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">Draft: {stats.draft}</span>
              <ListToolbar.Divider />
              <span className="shrink-0 text-[9px] text-slate-400">Due</span>
              <ListToolbar.Input type="date" value={filters.startDate} onChange={setFilter("startDate")} />
              <span className="shrink-0 text-[9px] text-slate-400">—</span>
              <ListToolbar.Input type="date" value={filters.endDate} onChange={setFilter("endDate")} />
              <ListToolbar.Divider />
              <div className="relative shrink-0">
                <FaSearch className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[8px] text-slate-400" />
                <ListToolbar.Input
                  value={filters.search}
                  onChange={setFilter("search")}
                  placeholder={isLandlordWorkspace ? "Voucher, narration, owner, property" : "Voucher, narration, landlord, property"}
                  width="w-48"
                  className="pl-5"
                />
              </div>
              <AppSelect
                value={filters.category !== "all" ? filters.category : ""}
                onChange={(v) => setFilters((prev) => ({ ...prev, category: v ?? "all" }))}
                options={categoryOptions}
                placeholder="All categories"
                compact
                clearable
              />
              <AppSelect
                value={filters.status !== "all" ? filters.status : ""}
                onChange={(v) => setFilters((prev) => ({ ...prev, status: v ?? "all" }))}
                options={[
                  { value: "draft", label: "Draft" },
                  { value: "approved", label: "Approved" },
                  { value: "paid", label: "Paid" },
                  { value: "reversed", label: "Reversed" },
                  { value: "everything", label: "All (incl. reversed)" },
                ]}
                placeholder="Active"
                compact
                clearable
              />
              {hasPMS && (
                <AppSelect
                  value={filters.propertyId !== "all" ? filters.propertyId : ""}
                  onChange={(v) => setFilters((prev) => ({ ...prev, propertyId: v ?? "all" }))}
                  options={propertyOptions}
                  placeholder="All properties"
                  compact
                  clearable
                  searchable
                />
              )}
              <ListToolbar.Button icon={FaFilter} variant="outline" onClick={() => setFilters({ search: "", category: "all", status: "all", propertyId: "all", startDate: "", endDate: "" })}>
                Reset
              </ListToolbar.Button>
              <ListToolbar.Divider />
              <ListToolbar.Button icon={FaPrint} variant="outline" onClick={handlePrintList}>Print</ListToolbar.Button>
              <ListToolbar.Button icon={FaDownload} variant="outline" onClick={handleExportCsv}>Export</ListToolbar.Button>
              <ListToolbar.Divider />
              <ListToolbar.Button variant="danger" onClick={bulkDeleteSelected}>Delete Selected</ListToolbar.Button>
              <ListToolbar.Button icon={FaPlus} disabled={!canCreateVoucher} onClick={openCreate}>New Voucher</ListToolbar.Button>
            </ListToolbar>
            <MilikTable
              columns={[
                { label: "Voucher #" },
                { label: "Ref #" },
                { label: "Category" },
                { label: isLandlordWorkspace ? "Owner" : "Payee" },
                { label: "Property" },
                { label: "Amount (KES)", align: "right" },
                { label: "Due Date" },
                { label: "Paid Date" },
                { label: "Status", align: "center" },
              ]}
              rows={filtered}
              rowKey="_id"
              loading={loading}
              empty="No payment vouchers found."
              minWidth="1200px"
              checkboxes
              allChecked={selectedIds.length === filtered.length && filtered.length > 0}
              someChecked={selectedIds.length > 0 && selectedIds.length < filtered.length}
              onCheckAll={toggleSelectAll}
              isChecked={(voucher) => selectedIds.includes(voucher._id)}
              isSelected={(voucher) => selectedIds.includes(voucher._id)}
              onCheckRow={(voucher) => toggleSelect(voucher._id)}
              renderRow={(voucher) => {
                const isOverdue = voucher.dueDate && voucher.status !== "paid" && voucher.status !== "reversed" && new Date(voucher.dueDate) < new Date();
                return (
                  <>
                    <td className="px-3 py-1 border-r border-gray-100 font-bold text-slate-900 whitespace-nowrap" title={voucher.narration || ""}>{voucher.voucherNo}</td>
                    <td className="px-3 py-1 border-r border-gray-100 text-slate-600 max-w-[110px] truncate">{isRawObjectId(voucher.reference) ? "—" : voucher.reference || "—"}</td>
                    <td className="px-3 py-1 border-r border-gray-100 text-slate-700 max-w-[160px] truncate">{categories.find((c) => c.value === voucher.category)?.label || voucher.category}</td>
                    <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900 max-w-[160px] truncate">{voucher.payeeDisplay || "—"}</td>
                    <td className="px-3 py-1 border-r border-gray-100 text-slate-700 max-w-[140px] truncate">{voucher.propertyName || "—"}</td>
                    <td className="px-3 py-1 border-r border-gray-100 text-right font-bold text-slate-900">{Number(voucher.amount || 0).toLocaleString()}</td>
                    <td className={`px-3 py-1 border-r border-gray-100 whitespace-nowrap ${isOverdue ? "text-red-600 font-semibold" : "text-slate-700"}`}>{voucher.dueDate ? new Date(voucher.dueDate).toLocaleDateString("en-GB") : "—"}{isOverdue && <span className="ml-1 text-[9px] font-bold">OVERDUE</span>}</td>
                    <td className="px-3 py-1 border-r border-gray-100 text-slate-700 whitespace-nowrap">{voucher.paidDate ? new Date(voucher.paidDate).toLocaleDateString("en-GB") : "—"}</td>
                    <td className="px-3 py-1 border-r border-gray-100 text-center">
                      <span className={`inline-flex border px-2 py-0.5 text-[10px] font-bold ${statusColors[voucher.status] || statusColors.draft}`}>{voucher.status}</span>
                    </td>
                  </>
                );
              }}
              renderActions={(voucher) => {
                const isBusy = (action) => rowActionKey === `${voucher._id}:${action}`;
                return (
                  <div className="flex justify-end gap-1">
                    <button onClick={() => setGlVoucher(voucher)} className="rounded p-1 text-teal-600 hover:bg-teal-50 hover:text-teal-800" title="View GL Entries"><FaBook size={12} /></button>
                    <button onClick={() => handlePrintVoucher(voucher)} className="rounded p-1 text-purple-600 hover:bg-purple-50 hover:text-purple-800" title="Print"><FaPrint size={12} /></button>
                    <button onClick={() => downloadVoucherPdf(voucher)} className="rounded p-1 text-red-600 hover:bg-red-50 hover:text-red-800" title="Download PDF"><FaFilePdf size={12} /></button>
                    {voucher.status === "draft" && canUpdateVoucher && <button onClick={() => openEdit(voucher)} className="rounded p-1 text-blue-600 hover:bg-blue-50 hover:text-blue-800" title="Edit"><FaEdit size={12} /></button>}
                    {voucher.status === "draft" && canApproveVoucher && <button onClick={() => updateStatus(voucher, "approved")} disabled={!!rowActionKey} className="rounded p-1 text-indigo-600 hover:bg-indigo-50 hover:text-indigo-800 disabled:opacity-40" title={isBusy("approved") ? "Working…" : "Approve"}><FaCheck size={12} /></button>}
                    {(voucher.status === "draft" || voucher.status === "approved") && canUpdateVoucher && <button onClick={() => updateStatus(voucher, "paid")} disabled={!!rowActionKey} className="rounded p-1 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-800 disabled:opacity-40" title={isBusy("paid") ? "Working…" : "Mark Paid"}><FaSave size={12} /></button>}
                    {voucher.status !== "reversed" && canReverseVoucher && <button onClick={() => updateStatus(voucher, "reversed")} disabled={!!rowActionKey} className="rounded p-1 text-amber-600 hover:bg-amber-50 hover:text-amber-800 disabled:opacity-40" title={isBusy("reversed") ? "Working…" : "Reverse"}><FaUndo size={12} /></button>}
                    {canDeleteVoucher && <button onClick={() => removeVoucher(voucher)} disabled={!!rowActionKey} className="rounded p-1 text-rose-600 hover:bg-rose-50 hover:text-rose-800 disabled:opacity-40" title={isBusy("delete") ? "Working…" : "Delete"}><FaTrash size={12} /></button>}
                  </div>
                );
              }}
            />
            <PaginationBar
              page={currentPage}
              pages={totalPages}
              total={serverTotal}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={(n) => { setPageSize(n); setCurrentPage(1); }}
              loading={loading}
              label="vouchers"
            />
          </div>
        </div>
      </div>
      )}

      {pendingPayVoucher && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md border border-slate-200 bg-white shadow-2xl">
            <div className="bg-[#0B3B2E] px-5 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-400">Mark as Paid</p>
              <h3 className="mt-0.5 text-lg font-black text-white">{pendingPayVoucher.voucherNo}</h3>
              <p className="mt-1 text-[11px] text-emerald-100/70">Select a settlement account to complete payment.</p>
            </div>
            <div className="p-5">
              <AppSelect
                label="Settlement Cashbook / Petty Cash"
                value={pendingPaySettlementId}
                onChange={(val) => setPendingPaySettlementId(val ?? "")}
                options={settlementAccountOptions}
                placeholder="Search cashbook..."
                searchable
              />
            </div>
            <div className="flex gap-3 border-t border-slate-200 px-5 py-4">
              <button
                onClick={() => setPendingPayVoucher(null)}
                className="flex-1 border border-slate-300 py-2 text-sm font-black text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmPendingPay}
                className="flex-1 bg-[#0B3B2E] py-2 text-sm font-black text-white hover:bg-[#0A3127]"
              >
                Confirm &amp; Mark Paid
              </button>
            </div>
          </div>
        </div>
      )}

      <JournalEntriesDrawer
        open={!!glVoucher}
        onClose={() => setGlVoucher(null)}
        title="Payment Voucher"
        transactionRef={glVoucher?.voucherNo}
        date={glVoucher?.dueDate ? new Date(glVoucher.dueDate).toLocaleDateString("en-GB") : undefined}
        amount={glVoucher?.amount}
        status={glVoucher?.status}
        statusColors={statusColors[glVoucher?.status] || statusColors.draft}
        contextFields={glVoucher ? [
          { label: "Category",   value: categories.find((c) => c.value === glVoucher.category)?.label || glVoucher.category },
          { label: "Reference",  value: isRawObjectId(glVoucher.reference) ? undefined : (glVoucher.reference || undefined) },
          { label: isLandlordWorkspace ? "Owner" : "Payee", value: isLandlordWorkspace ? glVoucher.landlordName : glVoucher.payeeDisplay },
          { label: "Property",   value: glVoucher.propertyName },
          { label: "Narration",  value: glVoucher.narration },
          { label: "Paid Date",  value: glVoucher.paidDate ? new Date(glVoucher.paidDate).toLocaleDateString("en-GB") : "—" },
        ] : []}
        businessId={currentCompany?._id}
        sourceType="payment_voucher"
        sourceId={glVoucher?._id}
      />

    </DashboardLayout>
  );
};

export default PaymentVouchers;
