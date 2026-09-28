import React, { useCallback, useEffect, useMemo, useState } from "react";
import { printDocument } from "../../utils/printKit";
import { useEntityCache } from "../../hooks/useEntityCache";
import AppSelect from "../../components/common/AppSelect";
import { adminRequests } from "../../utils/requestMethods";
import useDebounce from "../../hooks/useDebounce";
import {
  FaBook,
  FaCheck,
  FaEdit,
  FaFileInvoiceDollar,
  FaFilePdf,
  FaFilter,
  FaPlus,
  FaPrint,
  FaSave,
  FaSearch,
  FaSquare,
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
import { useTabState } from "../../hooks/useTabState";
import PaginationBar from '../../components/PaginationBar';
import MilikTable from '../../components/common/MilikTable';

const DEFAULT_PAGE_SIZE = 50;
const isRawObjectId = (s) => /^[a-f\d]{24}$/i.test(String(s || ""));

const VOUCHER_LABEL = "mb-0.5 block text-[11px] font-semibold text-slate-600";
const VOUCHER_INPUT = "mt-0.5 w-full border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-900 outline-none placeholder:text-slate-300 focus:border-[#0B3B2E]";
const WHT_PRESETS = ["3", "5", "10", "15", "20"];
const whtFor = (gross, rate) => Math.round(Number(gross || 0) * Number(rate || 0)) / 100;
/** The preset rate an existing WHT amount corresponds to, otherwise "custom" (or "" when there is none). */
const deriveWhtRate = (amount, wht) => {
  const w = Number(wht || 0);
  if (!(w > 0)) return "";
  return WHT_PRESETS.find((rate) => Math.abs(whtFor(amount, rate) - w) < 0.01) || "custom";
};
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

const blankForm = {
  category: "company_operational",
  propertyId: "",
  liabilityAccountId: "",
  debitAccountId: "",
  settlementAccountId: "",
  amount: "",
  whtAmount: "",
  whtRate: "",
  whtAccountId: "",
  serviceProviderId: "",
  payeeName: "",
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
    filters: { search: "", category: "all", status: "all", propertyId: "all" },
  });
  const filters = voucherDraft.filters || { search: "", category: "all", status: "all", propertyId: "all" };
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
  const selectedLiabilityAcc  = useMemo(() => liabilityAccounts.find((a) => String(a._id) === form.liabilityAccountId),  [liabilityAccounts,  form.liabilityAccountId]);
  const selectedDebitAcc      = useMemo(() => debitAccounts.find((a)     => String(a._id) === form.debitAccountId),      [debitAccounts,      form.debitAccountId]);
  const selectedSettlementAcc = useMemo(() => settlementAccounts.find((a) => String(a._id) === form.settlementAccountId), [settlementAccounts, form.settlementAccountId]);
  const selectedServiceProvider = useMemo(() => serviceProvidersList.find((sp) => String(sp._id) === form.serviceProviderId), [serviceProvidersList, form.serviceProviderId]);
  const autoWhtAmount = useMemo(() => {
    if (!selectedServiceProvider?.subjectToWht || !selectedServiceProvider?.whtRate) return 0;
    const gross = Number(form.amount || 0);
    if (!gross) return 0;
    return Math.round(gross * Number(selectedServiceProvider.whtRate) / 100 * 100) / 100;
  }, [selectedServiceProvider, form.amount]);

  const selectWhtRate = (rate) => setForm((prev) => ({
    ...prev,
    whtRate: rate,
    whtAmount: rate === "" ? "" : rate === "custom" ? prev.whtAmount : String(whtFor(prev.amount, rate)),
    whtAccountId: rate === "" ? "" : prev.whtAccountId,
  }));
  const defaultWhtAccount = useMemo(() => liabilityAccounts.find((a) => String(a.code) === "2141"), [liabilityAccounts]);

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
      setForm({
        ...blankForm,
        ...prefill,
      });
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
  }, [currentCompany?._id, debouncedSearch, filters.category, filters.status, filters.propertyId, currentPage, pageSize]);

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

  const totalPages = Math.max(1, serverPages);
  const currentPageRows = vouchers;

  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, filters.category, filters.status, filters.propertyId, pageSize]);


  const closeForm = () => {
    setShowModal(false);
    if (location.pathname === "/accounts/payment-vouchers/new") {
      navigate("/accounts/payment-vouchers");
    }
  };

  const openCreate = (prefill = null) => {
    setEditingVoucherId("");
    setForm(prefill ? { ...blankForm, ...prefill } : blankForm);
    setShowModal(true);
    navigate("/accounts/payment-vouchers/new");
  };

  const openEdit = (voucher) => {
    setEditingVoucherId(voucher._id);
    setForm({
      category: voucher.category || "landlord_maintenance",
      propertyId: voucher.propertyId || "",
      liabilityAccountId: voucher.liabilityAccountId || "",
      debitAccountId: voucher.debitAccountId || "",
      settlementAccountId: voucher.settlementAccountId || "",
      amount: voucher.amount || "",
      whtAmount: voucher.whtAmount != null ? String(voucher.whtAmount) : "",
      whtRate: deriveWhtRate(voucher.amount, voucher.whtAmount),
      whtAccountId: voucher.whtAccountId?._id || voucher.whtAccountId || "",
      serviceProviderId: voucher.serviceProviderId || "",
      payeeName: voucher.payeeName || "",
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
    if (!form.liabilityAccountId) return "Credit liability / payable account is required";
    if (selectedCategoryMeta?.explicitDebitAccount && !form.debitAccountId) return "Debit posting account is required for this voucher category";
    if (form.status === "paid" && !form.settlementAccountId) return "Settlement cashbook / petty cash account is required when saving a paid voucher";
    if (!form.amount || Number(form.amount) <= 0) return "Valid amount is required";
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
      liabilityAccount: form.liabilityAccountId,
      debitAccount: form.debitAccountId || undefined,
      settlementAccount: form.settlementAccountId || undefined,
      amount: Number(form.amount),
      whtAmount: Number(form.whtAmount || 0),
      whtAccountId: Number(form.whtAmount || 0) > 0 ? (form.whtAccountId || "") : "",
      serviceProvider: form.serviceProviderId || undefined,
      payeeName: form.serviceProviderId ? undefined : (form.payeeName || undefined),
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
            <div className="flex-1 overflow-y-auto bg-slate-50/60 px-4 py-3 space-y-3 min-w-0">

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
                  <label className="block">
                    <span className={VOUCHER_LABEL}>Voucher No.</span>
                    <input
                      readOnly
                      value={editingVoucher?.voucherNo || "Auto-assigned on save"}
                      className={`${VOUCHER_INPUT} bg-slate-50 font-mono text-slate-500`}
                    />
                  </label>
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

              <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">

                {/* ── Payee & amount ── */}
                <section className="border border-slate-200 bg-white p-3 shadow-sm xl:col-span-7">
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
                          const sp = serviceProvidersList.find((s) => String(s._id) === spId);
                          setForm((prev) => {
                            if (sp?.subjectToWht && Number(sp?.whtRate) > 0) {
                              const rate = WHT_PRESETS.includes(String(sp.whtRate)) ? String(sp.whtRate) : "custom";
                              return { ...prev, serviceProviderId: spId, whtRate: rate, whtAmount: String(whtFor(prev.amount, sp.whtRate)) };
                            }
                            // moving off a vendor that carried tax takes its tax with it; a hand-entered tax stays
                            return selectedServiceProvider?.subjectToWht
                              ? { ...prev, serviceProviderId: spId, whtRate: "", whtAmount: "", whtAccountId: "" }
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
                    {hasPMS && (
                      <div className="sm:col-span-2">
                        <AppSelect
                          label={selectedCategoryMeta?.propertyRequired ? "Property *" : "Property (optional)"}
                          value={form.propertyId}
                          onChange={(val) => setForm((prev) => ({ ...prev, propertyId: val ?? "" }))}
                          options={propertyOptions}
                          placeholder={selectedCategoryMeta?.propertyRequired ? "Select property…" : "No property — company level"}
                          searchable
                          clearable
                        />
                      </div>
                    )}
                  </div>

                  <div className="mt-2 grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
                    <label className="block">
                      <span className={VOUCHER_LABEL}>Amount (KES) <span className="text-red-500">*</span></span>
                      <div className="relative mt-0.5">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-slate-400">KES</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={form.amount}
                          onChange={(e) => {
                            const value = e.target.value;
                            setForm((prev) => ({
                              ...prev,
                              amount: value,
                              whtAmount: WHT_PRESETS.includes(prev.whtRate) ? String(whtFor(value, prev.whtRate)) : prev.whtAmount,
                            }));
                          }}
                          placeholder="0.00"
                          className="w-full border-2 border-slate-200 pl-11 pr-3 py-1.5 text-lg font-black tabular-nums text-slate-900 placeholder:text-slate-200 focus:border-[#0B3B2E] focus:outline-none"
                        />
                      </div>
                    </label>
                    <div className="flex flex-col justify-end">
                      <span className={VOUCHER_LABEL}>Net payable</span>
                      <div className="flex h-[42px] items-center justify-between border border-slate-200 bg-slate-50 px-3">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{Number(form.whtAmount || 0) > 0 ? "after WHT" : "no WHT"}</span>
                        <span className="text-lg font-black tabular-nums text-slate-900">
                          {Number(form.amount || 0) > 0 ? formatKes(Number(form.amount) - Number(form.whtAmount || 0)) : "—"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* ── Withholding tax ── */}
                  <div className={`mt-2 border p-2 ${Number(form.whtAmount || 0) > 0 ? "border-amber-300 bg-amber-50/70" : "border-slate-200 bg-slate-50/60"}`}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="mr-1 text-[11px] font-semibold text-slate-600">Withholding tax</span>
                      {[["", "None"], ...WHT_PRESETS.map((rate) => [rate, `${rate}%`]), ["custom", "Custom"]].map(([rate, label]) => (
                        <button
                          key={rate || "none"}
                          type="button"
                          onClick={() => selectWhtRate(rate)}
                          className={`px-2.5 py-1 text-[11px] font-bold transition ${form.whtRate === rate
                            ? (rate === "" ? "bg-slate-600 text-white" : "bg-amber-500 text-white")
                            : "border border-slate-200 bg-white text-slate-600 hover:border-amber-300 hover:text-amber-700"}`}
                        >
                          {label}
                        </button>
                      ))}
                      {selectedServiceProvider?.subjectToWht && Number(selectedServiceProvider?.whtRate) > 0 && (
                        <span className="ml-auto text-[10px] text-slate-400">{selectedServiceProvider.name} is subject to {selectedServiceProvider.whtRate}% WHT</span>
                      )}
                    </div>
                    {form.whtRate !== "" && (
                      <div className="mt-2 grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
                        <label className="block">
                          <span className={VOUCHER_LABEL}>{form.whtRate === "custom" ? "WHT amount (KES)" : `WHT at ${form.whtRate}% (KES)`}</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={form.whtAmount}
                            readOnly={form.whtRate !== "custom"}
                            onChange={(e) => setForm((prev) => ({ ...prev, whtAmount: e.target.value }))}
                            placeholder="0.00"
                            className={`${VOUCHER_INPUT} h-9 text-sm font-bold tabular-nums text-amber-900 ${form.whtRate !== "custom" ? "bg-white/70" : ""} ${Number(form.whtAmount || 0) >= Number(form.amount || 0) && Number(form.whtAmount || 0) > 0 ? "border-red-400" : ""}`}
                          />
                          {Number(form.whtAmount || 0) > 0 && Number(form.whtAmount || 0) >= Number(form.amount || 0) && (
                            <span className="mt-0.5 block text-[10px] font-semibold text-red-600">Withholding tax must be less than the voucher amount.</span>
                          )}
                        </label>
                        <div>
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
                      </div>
                    )}
                  </div>

                  {Number(form.amount || 0) > 0 && (
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px]">
                      <span className="italic text-slate-500">{amountInWords(form.amount)}</span>
                      {Number(form.whtAmount || 0) > 0 && (
                        <span className="font-semibold tabular-nums text-slate-600">
                          Gross {formatKes(form.amount)} · WHT {formatKes(form.whtAmount)}
                        </span>
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
                </section>

                {/* ── Accounting entries ── */}
                <section className="border border-blue-100 bg-blue-50/40 p-3 shadow-sm xl:col-span-5">
                  <div className="mb-2 flex items-center gap-2">
                    <div className="h-3.5 w-0.5 bg-blue-500" />
                    <h2 className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Accounting entries</h2>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <AppSelect
                        label="Credit — liability / payable account *"
                        value={form.liabilityAccountId}
                        onChange={(val) => setForm((prev) => ({ ...prev, liabilityAccountId: val ?? "" }))}
                        options={liabilityAccountOptions}
                        placeholder="Search liability / payable account…"
                        searchable
                      />
                      <p className="mt-0.5 text-[10px] text-slate-400">Credited on accrual, debited when settled.</p>
                    </div>
                    {selectedCategoryMeta?.explicitDebitAccount ? (
                      <div>
                        <AppSelect
                          label={form.category === "petty_cash_float" ? "Debit — petty cash asset account *" : "Debit — expense account *"}
                          value={form.debitAccountId}
                          onChange={(val) => setForm((prev) => ({ ...prev, debitAccountId: val ?? "" }))}
                          options={debitAccountOptions}
                          placeholder="Search expense / asset account…"
                          searchable
                          clearable
                        />
                        <p className="mt-0.5 text-[10px] text-slate-400">
                          {form.category === "petty_cash_float" ? "Receives the float top-up." : "Debited on approval."}
                        </p>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2 border border-slate-200 bg-white px-3 py-2">
                        <FaFileInvoiceDollar size={11} className="mt-0.5 shrink-0 text-slate-400" />
                        <p className="text-[11px] text-slate-500">Debit account is set automatically from the category.</p>
                      </div>
                    )}
                    <div>
                      <AppSelect
                        label={form.status === "paid" ? "Settlement — cashbook / petty cash *" : "Settlement — cashbook / petty cash"}
                        value={form.settlementAccountId}
                        onChange={(val) => setForm((prev) => ({ ...prev, settlementAccountId: val ?? "" }))}
                        options={settlementAccountOptions}
                        placeholder="Search cashbook / petty cash…"
                        searchable
                        clearable
                      />
                      <p className="mt-0.5 text-[10px] text-slate-400">Where the money is paid from. Needed to mark the voucher paid.</p>
                    </div>
                  </div>
                </section>
              </div>
            </div>

            {/* RIGHT: Live Preview */}
            <div className="w-[260px] shrink-0 overflow-y-auto border-l border-slate-200 bg-slate-50 px-4 py-4 space-y-3">
              <div className="bg-[#0B3B2E] px-4 py-3 text-white">
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-emerald-400">Payment Amount</p>
                <p className="mt-1.5 text-2xl font-black tabular-nums leading-none">
                  {form.amount && Number(form.amount) > 0
                    ? `KES ${Number(form.amount).toLocaleString("en-KE", { minimumFractionDigits: 2 })}`
                    : <span className="text-xl text-emerald-400">KES —</span>}
                </p>
                <div className="mt-2.5 flex items-center justify-between text-[10px] text-emerald-400">
                  <span>Due</span>
                  <span className="font-bold text-emerald-200">{form.dueDate || "—"}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[10px] text-emerald-400">
                  <span>Category</span>
                  <span className="font-bold text-emerald-200 text-right max-w-[130px] truncate">{selectedCategoryMeta?.label || "—"}</span>
                </div>
              </div>
              <div className="border border-slate-200 bg-white p-3">
                <p className="mb-2 text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Journal Preview</p>
                <p className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-blue-400">On Accrual / Approval</p>
                <div className="space-y-1 mb-1">
                  <div className="flex items-start gap-1.5 bg-slate-50 px-2 py-1.5">
                    <span className="mt-0.5 shrink-0 bg-blue-100 px-1 py-0.5 text-[8px] font-black text-blue-700">DR</span>
                    <span className="min-w-0 flex-1 text-[10px] font-semibold text-slate-700 break-words">
                      {selectedDebitAcc ? `${selectedDebitAcc.code} – ${selectedDebitAcc.name}` : selectedCategoryMeta?.explicitDebitAccount ? <span className="italic text-slate-400">Select expense account</span> : <span className="italic text-slate-400">Auto from category</span>}
                    </span>
                  </div>
                  <div className="flex items-start gap-1.5 bg-slate-50 px-2 py-1.5">
                    <span className="mt-0.5 shrink-0 bg-emerald-100 px-1 py-0.5 text-[8px] font-black text-emerald-700">CR</span>
                    <span className="min-w-0 flex-1 text-[10px] font-semibold text-slate-700 break-words">
                      {selectedLiabilityAcc ? `${selectedLiabilityAcc.code} – ${selectedLiabilityAcc.name}` : <span className="italic text-slate-400">Select liability account</span>}
                    </span>
                  </div>
                </div>
                {selectedSettlementAcc && (
                  <>
                    <div className="my-2 h-px bg-slate-100" />
                    <p className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-emerald-500">On Settlement / Payment</p>
                    <div className="space-y-1">
                      <div className="flex items-start gap-1.5 bg-slate-50 px-2 py-1.5">
                        <span className="mt-0.5 shrink-0 bg-blue-100 px-1 py-0.5 text-[8px] font-black text-blue-700">DR</span>
                        <span className="min-w-0 flex-1 text-[10px] font-semibold text-slate-700 break-words">
                          {selectedLiabilityAcc ? `${selectedLiabilityAcc.code} – ${selectedLiabilityAcc.name}` : <span className="italic text-slate-400">Liability account</span>}
                        </span>
                      </div>
                      <div className="flex items-start gap-1.5 bg-slate-50 px-2 py-1.5">
                        <span className="mt-0.5 shrink-0 bg-emerald-100 px-1 py-0.5 text-[8px] font-black text-emerald-700">CR</span>
                        <span className="min-w-0 flex-1 text-[10px] font-semibold text-slate-700 break-words">
                          {selectedSettlementAcc.code} – {selectedSettlementAcc.name}
                          {Number(form.whtAmount || 0) > 0 && (
                            <span className="block text-[9px] text-slate-400 font-normal">
                              Net: KES {(Number(form.amount || 0) - Number(form.whtAmount)).toLocaleString("en-KE", { minimumFractionDigits: 2 })}
                            </span>
                          )}
                        </span>
                      </div>
                      {Number(form.whtAmount || 0) > 0 && (
                        <div className="flex items-start gap-1.5 bg-amber-50 border border-amber-100 px-2 py-1.5">
                          <span className="mt-0.5 shrink-0 bg-amber-100 px-1 py-0.5 text-[8px] font-black text-amber-700">CR</span>
                          <span className="min-w-0 flex-1 text-[10px] font-semibold text-amber-800 break-words">
                            {form.whtAccountId ? (() => { const w = liabilityAccounts.find((a) => String(a._id) === form.whtAccountId); return w ? `${w.code} – ${w.name}` : "WHT Payable"; })() : `${defaultWhtAccount?.code || "2141"} – ${defaultWhtAccount?.name || "WHT Payable"}`}
                            <span className="block text-[9px] text-amber-600 font-normal">KES {Number(form.whtAmount).toLocaleString("en-KE", { minimumFractionDigits: 2 })}</span>
                          </span>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
              <div className="border border-slate-200 bg-white p-3">
                <p className="mb-2 text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Approval Workflow</p>
                <div className="space-y-2">
                  {[
                    { key: "draft",    label: "Draft",    desc: "Voucher recorded, pending review" },
                    { key: "approved", label: "Approved", desc: "Cleared for payment settlement" },
                    { key: "paid",     label: "Paid",     desc: "Settled — GL entries posted" },
                  ].map((step, i) => {
                    const active = i <= ({ draft: 0, approved: 1, paid: 2 }[form.status] ?? 0);
                    return (
                      <div key={step.key} className="flex items-start gap-2">
                        <div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-[8px] font-black ${active ? "bg-[#0B3B2E] text-white" : "bg-slate-100 text-slate-400"}`}>{i + 1}</div>
                        <div>
                          <p className={`text-[11px] font-bold leading-tight ${active ? "text-slate-800" : "text-slate-400"}`}>{step.label}</p>
                          <p className="text-[9px] text-slate-400">{step.desc}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <button
                onClick={handleSave}
                disabled={saving || (editingVoucherId ? !canUpdateVoucher : !canCreateVoucher)}
                className="w-full flex items-center justify-center gap-2 bg-[#0B3B2E] py-2.5 text-sm font-black text-white transition hover:bg-[#0A3127] disabled:opacity-50"
              >
                <FaSave size={11} />
                {saving ? "Saving…" : editingVoucherId ? "Update Voucher" : "Save Voucher"}
              </button>
            </div>
          </div>
        </div>
      ) : (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 p-1 sm:p-2">
        <div className="mx-auto flex h-full w-full max-w-none flex-col overflow-hidden">

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
            <div className="flex-none sticky top-0 z-30 border-b border-gray-200 bg-white shadow-sm">
              <div className="filter-bar flex items-center gap-1 overflow-x-auto px-2 py-1.5">
                <span className="shrink-0 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">Vouchers: {serverTotal}</span>
                <span className="shrink-0 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">Total: KES {stats.total.toLocaleString()}</span>
                <span className="shrink-0 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">Paid: KES {stats.paid.toLocaleString()}</span>
                <span className="shrink-0 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">Draft: {stats.draft}</span>
                <div className="mx-0.5 h-4 w-px shrink-0 bg-slate-200" />
                <div className="relative shrink-0">
                  <FaSearch className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400" />
                  <input
                    value={filters.search}
                    onChange={setFilter("search")}
                    placeholder={isLandlordWorkspace ? "Voucher, narration, owner, property" : "Voucher, narration, landlord, property"}
                    className="h-7 w-48 rounded border border-slate-200 bg-white pl-6 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/20"
                  />
                </div>
                <AppSelect
                  value={filters.category !== "all" ? filters.category : ""}
                  onChange={(v) => setFilters((prev) => ({ ...prev, category: v ?? "all" }))}
                  options={categoryOptions}
                  placeholder="All categories"
                  size="sm"
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
                  size="sm"
                  clearable
                />
                {hasPMS && (
                  <AppSelect
                    value={filters.propertyId !== "all" ? filters.propertyId : ""}
                    onChange={(v) => setFilters((prev) => ({ ...prev, propertyId: v ?? "all" }))}
                    options={propertyOptions}
                    placeholder="All properties"
                    size="sm"
                    clearable
                    searchable
                  />
                )}
                <button onClick={() => setFilters({ search: "", category: "all", status: "all", propertyId: "all" })} className="h-7 shrink-0 flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                  <FaFilter size={9} /> Reset
                </button>
                <div className="mx-0.5 h-4 w-px shrink-0 bg-slate-200" />
                <button onClick={bulkDeleteSelected} className="h-7 shrink-0 flex items-center gap-1 rounded border border-rose-300 bg-rose-50 px-2.5 text-xs font-semibold text-rose-700 hover:bg-rose-100">Delete Selected</button>
                <button onClick={openCreate} disabled={!canCreateVoucher} className="h-7 shrink-0 flex items-center gap-1 rounded bg-[#0B3B2E] px-2.5 text-xs font-semibold text-white hover:bg-[#0A3127] disabled:opacity-60"><FaPlus size={9} /> New Voucher</button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
              <table className="w-full min-w-[1200px] text-[11px] border-collapse">
                <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                  <tr>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10 w-8"><button type="button" onClick={toggleSelectAll}>{selectedIds.length === filtered.length && filtered.length > 0 ? <FaCheck /> : <FaSquare />}</button></th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Voucher #</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Ref #</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Category</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">{isLandlordWorkspace ? "Owner" : "Payee"}</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Property</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">Amount (KES)</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Due Date</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Paid Date</th>
                    <th className="px-3 py-1 text-center font-bold border-r border-white/10">Status</th>
                    <th className="px-3 py-1 text-right font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan="11" className="px-4 py-10 text-center text-slate-500">Loading vouchers...</td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan="11" className="px-4 py-10 text-center text-slate-500">No payment vouchers found.</td></tr>
                  ) : currentPageRows.map((voucher, index) => {
                    const isBusy = (action) => rowActionKey === `${voucher._id}:${action}`;
                    const isOverdue = voucher.dueDate && voucher.status !== "paid" && voucher.status !== "reversed" && new Date(voucher.dueDate) < new Date();
                    return (
                      <tr key={voucher._id} className={`cursor-pointer border-b border-gray-100 transition-colors ${selectedIds.includes(voucher._id) ? "bg-emerald-50/85 shadow-[inset_4px_0_0_0_#0B3B2E] hover:bg-emerald-50" : index % 2 === 0 ? "bg-white hover:bg-blue-50/40" : "bg-slate-50/60 hover:bg-blue-50/40"}`}>
                        <td className="px-3 py-1 border-r border-gray-100"><button type="button" onClick={() => toggleSelect(voucher._id)}>{selectedIds.includes(voucher._id) ? <FaCheck className="text-[#0B3B2E]" /> : <FaSquare className="text-slate-400" />}</button></td>
                        <td className="px-3 py-1 border-r border-gray-100 font-bold text-slate-900 whitespace-nowrap" title={voucher.narration || ""}>{voucher.voucherNo}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-slate-600 max-w-[110px] truncate">{isRawObjectId(voucher.reference) ? "—" : voucher.reference || "—"}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-slate-700 max-w-[160px] truncate">{categories.find((c) => c.value === voucher.category)?.label || voucher.category}</td>
                        <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900 max-w-[160px] truncate">{voucher.payeeDisplay || "—"}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-slate-700 max-w-[140px] truncate">{voucher.propertyName || "—"}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-right font-bold text-slate-900">{Number(voucher.amount || 0).toLocaleString()}</td>
                        <td className={`px-3 py-1 border-r border-gray-100 whitespace-nowrap ${isOverdue ? "text-red-600 font-semibold" : "text-slate-700"}`}>{voucher.dueDate ? new Date(voucher.dueDate).toLocaleDateString("en-GB") : "—"}{isOverdue && <span className="ml-1 text-[9px] font-bold">OVERDUE</span>}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-slate-700 whitespace-nowrap">{voucher.paidDate ? new Date(voucher.paidDate).toLocaleDateString("en-GB") : "—"}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-center">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusColors[voucher.status] || statusColors.draft}`}>{voucher.status}</span>
                        </td>
                        <td className="px-3 py-1 text-right">
                          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => setGlVoucher(voucher)} className="rounded p-1 text-teal-600 hover:bg-teal-50 hover:text-teal-800" title="View GL Entries"><FaBook size={12} /></button>
                            <button onClick={() => handlePrintVoucher(voucher)} className="rounded p-1 text-purple-600 hover:bg-purple-50 hover:text-purple-800" title="Print"><FaPrint size={12} /></button>
                            <button onClick={() => downloadVoucherPdf(voucher)} className="rounded p-1 text-red-600 hover:bg-red-50 hover:text-red-800" title="Download PDF"><FaFilePdf size={12} /></button>
                            {voucher.status === "draft" && canUpdateVoucher && <button onClick={() => openEdit(voucher)} className="rounded p-1 text-blue-600 hover:bg-blue-50 hover:text-blue-800" title="Edit"><FaEdit size={12} /></button>}
                            {voucher.status === "draft" && canApproveVoucher && <button onClick={() => updateStatus(voucher, "approved")} disabled={!!rowActionKey} className="rounded p-1 text-indigo-600 hover:bg-indigo-50 hover:text-indigo-800 disabled:opacity-40" title={isBusy("approved") ? "Working…" : "Approve"}><FaCheck size={12} /></button>}
                            {(voucher.status === "draft" || voucher.status === "approved") && canUpdateVoucher && <button onClick={() => updateStatus(voucher, "paid")} disabled={!!rowActionKey} className="rounded p-1 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-800 disabled:opacity-40" title={isBusy("paid") ? "Working…" : "Mark Paid"}><FaSave size={12} /></button>}
                            {voucher.status !== "reversed" && canReverseVoucher && <button onClick={() => updateStatus(voucher, "reversed")} disabled={!!rowActionKey} className="rounded p-1 text-amber-600 hover:bg-amber-50 hover:text-amber-800 disabled:opacity-40" title={isBusy("reversed") ? "Working…" : "Reverse"}><FaUndo size={12} /></button>}
                            {canDeleteVoucher && <button onClick={() => removeVoucher(voucher)} disabled={!!rowActionKey} className="rounded p-1 text-rose-600 hover:bg-rose-50 hover:text-rose-800 disabled:opacity-40" title={isBusy("delete") ? "Working…" : "Delete"}><FaTrash size={12} /></button>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
