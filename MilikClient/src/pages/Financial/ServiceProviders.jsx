import React, { useCallback, useEffect, useRef, useState } from "react";
import BankDetailsFields from "../../components/common/BankDetailsFields";
import { FaEdit, FaFileInvoiceDollar, FaFilePdf, FaHistory, FaPlus, FaRedoAlt, FaSave, FaSearch, FaTrash, FaUndo } from "react-icons/fa";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { selectCurrentCompany, selectCurrentUser } from "../../redux/selectors";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import {
  createServiceProvider,
  deleteServiceProvider,
  getServiceProviders,
  updateServiceProvider,
  getCreditorStatement,
  createVendorTakeOnBalance,
} from "../../redux/apiCalls";
import { hasCompanyPermission } from "../../utils/permissions";
import { useConfirm } from "../../context/ConfirmContext";
import { useTabState } from "../../hooks/useTabState";
import useDebounce from "../../hooks/useDebounce";
import AppSelect from "../../components/common/AppSelect";
import CurrencyInput from "../../components/common/CurrencyInput";
import PaginationBar from '../../components/PaginationBar';
import MilikTable from '../../components/common/MilikTable';
import ListToolbar from '../../components/common/ListToolbar';
import Modal from "../../components/common/Modal";
import printTabularList from "../../utils/printList";
import { getCachedChartOfAccounts } from "../../utils/chartOfAccountsCache";

const formatMoney = (value) =>
  Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ACTIVE_OPTIONS = [
  { value: "true", label: "Active only" },
  { value: "false", label: "Inactive only" },
];

const labelClass = "mb-1 block text-xs font-bold text-slate-900";
const inputClass = "h-7 w-full border bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-500 outline-none transition focus:ring-1 border-slate-300 focus:border-[#0B3B2E] focus:ring-[#0B3B2E]/20";
const checkboxClass = "h-3.5 w-3.5 border-slate-300 text-[#0B3B2E] focus:ring-[#0B3B2E]";
const Required = () => <span className="ml-0.5 font-black text-red-600">*</span>;

const Section = ({ title, children, className = "" }) => (
  <div className={`border border-slate-200 bg-white ${className}`}>
    <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5">
      <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-800">{title}</h3>
    </div>
    <div className="p-2.5">{children}</div>
  </div>
);

const blankForm = {
  name: "",
  contactPerson: "",
  phone: "",
  email: "",
  category: "general",
  kraPin: "",
  accountNumber: "",
  paybillNumber: "",
  bankName: "",
  branchName: "",
  accountName: "",
  mobileNumber: "",
  defaultExpenseAccount: "",
  subjectToWht: false,
  whtRate: "",
  whtCategory: "",
  isActive: true,
  notes: "",
};

const DEFAULT_PAGE_SIZE = 50;

const CATEGORY_OPTIONS = [
  { value: "general", label: "General" },
  { value: "maintenance", label: "Maintenance" },
  { value: "utilities", label: "Utilities" },
  { value: "security", label: "Security" },
  { value: "cleaning", label: "Cleaning" },
  { value: "legal", label: "Legal" },
  { value: "contractor", label: "Contractor" },
  { value: "other", label: "Other" },
];

const ServiceProviders = () => {
  const confirm = useConfirm();
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expenseAccounts, setExpenseAccounts] = useState([]);
  const [search, setSearch] = useTabState("/accounts/service-providers:search", "");
  const debouncedSearch = useDebounce(search, 400);
  const [categoryFilter, setCategoryFilter] = useTabState("/accounts/service-providers:categoryFilter", "");
  const [activeFilter, setActiveFilter] = useTabState("/accounts/service-providers:activeFilter", "");
  const [showModal, setShowModal] = useState(false);
  const [statementRow, setStatementRow] = useState(null);
  const [statement, setStatement] = useState(null);
  const [statementLoading, setStatementLoading] = useState(false);
  const [takeOnRow, setTakeOnRow] = useState(null);
  const [takeOnForm, setTakeOnForm] = useState({ amount: "", expenseAccount: "", effectiveDate: "", notes: "" });
  const [savingTakeOn, setSavingTakeOn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(blankForm);
  const [pageSize, setPageSize] = useTabState("/accounts/service-providers:pageSize", DEFAULT_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useTabState("/accounts/service-providers:currentPage", 1);
  const [serverTotal, setServerTotal] = useState(0);
  const [serverPages, setServerPages] = useState(1);

  const canCreate = hasCompanyPermission(currentUser, currentCompany, "expenses", "create", "accounts");
  const canUpdate = hasCompanyPermission(currentUser, currentCompany, "expenses", "update", "accounts");
  const canDelete = hasCompanyPermission(currentUser, currentCompany, "expenses", "delete", "accounts");
  const canRecordTakeOn = hasCompanyPermission(currentUser, currentCompany, "vendorTakeOnBalances", "create", "accounts");

  const _uid = currentUser?._id || currentUser?.id;
  const _spDraftKey = (currentCompany?._id && _uid) ? `milik:draft:service-provider:${currentCompany._id}:${_uid}` : null;
  const _spDraftRestored = useRef(false);

  useEffect(() => {
    if (!_spDraftKey || _spDraftRestored.current) return;
    _spDraftRestored.current = true;
    try {
      const raw = window.sessionStorage.getItem(_spDraftKey);
      if (raw) { const { form: s } = JSON.parse(raw); if (s) { setForm(s); setShowModal(true); } }
    } catch {}
  }, [_spDraftKey]);

  useEffect(() => {
    if (!_spDraftKey || !_spDraftRestored.current || !showModal || editingId) return;
    try { window.sessionStorage.setItem(_spDraftKey, JSON.stringify({ form })); } catch {}
  }, [_spDraftKey, form, showModal, editingId]);

  const closeModal = () => {
    if (_spDraftKey) { try { window.sessionStorage.removeItem(_spDraftKey); } catch {} }
    setShowModal(false);
    setEditingId("");
    setForm(blankForm);
  };

  const loadRows = useCallback(async () => {
    if (!currentCompany?._id) return;
    setLoading(true);
    try {
      const { data, total, pages } = await getServiceProviders({
        business: currentCompany._id,
        company: currentCompany._id,
        search: debouncedSearch,
        category: categoryFilter && categoryFilter !== "all" ? categoryFilter : undefined,
        active: activeFilter === "true" ? true : activeFilter === "false" ? false : undefined,
        page: currentPage,
        limit: pageSize,
      });
      setRows(Array.isArray(data) ? data : []);
      setServerTotal(total ?? 0);
      setServerPages(pages ?? 1);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load service providers");
    } finally {
      setLoading(false);
    }
  }, [currentCompany?._id, debouncedSearch, categoryFilter, activeFilter, currentPage, pageSize]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  useEffect(() => {
    if (!currentCompany?._id) return;
    getCachedChartOfAccounts(currentCompany._id)
      .then((data) => setExpenseAccounts((Array.isArray(data) ? data : []).filter((a) => a.type === "expense" && a.isPosting !== false)))
      .catch(() => {});
  }, [currentCompany?._id]);

  const totalPages = Math.max(1, serverPages);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, categoryFilter, activeFilter, pageSize]);

  const openCreate = () => {
    if (!canCreate) { toast.warning("You don't have permission to create service providers"); return; }
    setEditingId("");
    setForm(blankForm);
    setShowModal(true);
  };

  const openEdit = (row) => {
    if (!canUpdate) { toast.warning("You don't have permission to edit service providers"); return; }
    setEditingId(row._id);
    setForm({
      name: row.name || "",
      contactPerson: row.contactPerson || "",
      phone: row.phone || "",
      email: row.email || "",
      category: row.category || "general",
      kraPin: row.kraPin || "",
      accountNumber: row.accountNumber || "",
      paybillNumber: row.paybillNumber || "",
      bankName: row.bankName || "",
      branchName: row.branchName || "",
      accountName: row.accountName || "",
      mobileNumber: row.mobileNumber || "",
      defaultExpenseAccount: row.defaultExpenseAccount?._id || row.defaultExpenseAccount || "",
      subjectToWht: Boolean(row.subjectToWht),
      whtRate:      row.whtRate ? String(row.whtRate) : "",
      whtCategory:  row.whtCategory || "",
      isActive: row.isActive !== false,
      notes: row.notes || "",
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.warning("Service provider name is required");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...form,
        business: currentCompany?._id,
        company: currentCompany?._id,
      };

      const saved = editingId
        ? await updateServiceProvider(editingId, payload)
        : await createServiceProvider(payload);

      setRows((prev) =>
        editingId
          ? prev.map((row) => (row._id === editingId ? saved : row))
          : [saved, ...prev]
      );
      closeModal();
      toast.success(`Service provider ${editingId ? "updated" : "saved"}`);
      if (saved?.duplicateWarnings?.length) {
        saved.duplicateWarnings.forEach((w) => {
          toast.warning(`This provider's ${w.label} matches ${w.matchedProviderName} (${w.matchedProviderCode}) — please confirm this isn't a duplicate vendor.`, { autoClose: 10000 });
        });
      }
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to save service provider");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    if (!canDelete) { toast.warning("You don't have permission to delete service providers"); return; }
    if (!await confirm({ title: "Delete Service Provider", message: `Delete service provider ${row.name}?`, confirmText: "Delete", isDangerous: true })) return;
    try {
      await deleteServiceProvider(row._id, {
        business: currentCompany?._id,
        company: currentCompany?._id,
      });
      setRows((prev) => prev.filter((item) => item._id !== row._id));
      toast.success("Service provider deleted");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to delete service provider");
    }
  };

  const clearFilters = () => {
    setSearch("");
    setCategoryFilter("all");
    setActiveFilter("");
  };

  const openStatement = async (row) => {
    setStatementRow(row);
    setStatement(null);
    setStatementLoading(true);
    try {
      const data = await getCreditorStatement(row._id, {
        business: currentCompany?._id,
        company: currentCompany?._id,
      });
      setStatement(data);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load statement");
    } finally {
      setStatementLoading(false);
    }
  };

  const closeStatement = () => {
    setStatementRow(null);
    setStatement(null);
  };

  const handlePrintStatement = () => {
    if (!statement?.lines?.length) { toast.info("No transactions to print"); return; }
    const asOfText = new Date().toLocaleDateString("en-KE", { day: "2-digit", month: "long", year: "numeric" });
    const printed = printTabularList({
      title: "Creditor Statement",
      subtitle: `${statementRow.name} (${statementRow.providerCode}) · As of ${asOfText}`,
      company: currentCompany,
      columns: [
        { label: "Date", value: (l) => (l.date ? new Date(l.date).toLocaleDateString("en-KE") : "-") },
        { label: "Ref", value: (l) => l.ref || "-" },
        { label: "Description", value: (l) => l.description || "-" },
        { label: "Invoiced (KES)", align: "right", value: (l) => (l.invoiced ? formatMoney(l.invoiced) : "") },
        { label: "Paid (KES)", align: "right", value: (l) => (l.paid ? formatMoney(l.paid) : "") },
        { label: "Balance (KES)", align: "right", bold: true, value: (l) => formatMoney(l.balance) },
      ],
      rows: statement.lines,
      summaryItems: [
        ["Total Invoiced", formatMoney(statement.summary?.totalInvoiced)],
        ["Total Paid", formatMoney(statement.summary?.totalPaid)],
        ["Outstanding", formatMoney(statement.summary?.outstanding)],
      ],
      totalsRow: ["Totals", "", "", formatMoney(statement.summary?.totalInvoiced), formatMoney(statement.summary?.totalPaid), formatMoney(statement.summary?.outstanding)],
    });
    if (!printed) toast.error("Pop-up blocked — allow pop-ups for this site to print");
  };

  const openTakeOn = (row) => {
    if (!canRecordTakeOn) { toast.warning("You don't have permission to record vendor opening balances"); return; }
    setTakeOnRow(row);
    setTakeOnForm({
      amount: "",
      expenseAccount: row.defaultExpenseAccount?._id || row.defaultExpenseAccount || "",
      effectiveDate: new Date().toISOString().split("T")[0],
      notes: "",
    });
  };

  const closeTakeOn = () => {
    setTakeOnRow(null);
  };

  const handleSaveTakeOn = async () => {
    const amount = Number(takeOnForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.warning("Enter a valid opening balance amount");
      return;
    }
    if (!takeOnForm.expenseAccount) {
      toast.warning("Select the expense account this opening balance should post against");
      return;
    }
    setSavingTakeOn(true);
    try {
      await createVendorTakeOnBalance({
        business: currentCompany?._id,
        company: currentCompany?._id,
        serviceProvider: takeOnRow._id,
        amount,
        expenseAccount: takeOnForm.expenseAccount,
        effectiveDate: takeOnForm.effectiveDate,
        notes: takeOnForm.notes,
      });
      toast.success(`Opening balance recorded for ${takeOnRow.name}`);
      closeTakeOn();
      loadRows();
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to record opening balance");
    } finally {
      setSavingTakeOn(false);
    }
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 p-2">
        <div className="flex min-h-0 w-full max-w-full flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <ListToolbar>
            <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">Providers: {serverTotal}</span>

            <ListToolbar.Divider />

            <div className="relative shrink-0">
              <FaSearch className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[8px] text-slate-400" />
              <ListToolbar.Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Code, name, contact, phone, email" width="w-56" className="pl-5" />
            </div>
            <AppSelect
              value={categoryFilter}
              onChange={(v) => setCategoryFilter(v ?? "")}
              options={CATEGORY_OPTIONS}
              placeholder="All categories"
              compact
              clearable
            />
            <AppSelect
              value={activeFilter}
              onChange={(v) => setActiveFilter(v ?? "")}
              options={ACTIVE_OPTIONS}
              placeholder="Active & inactive"
              compact
              clearable
            />

            <ListToolbar.Divider />
            <ListToolbar.Button icon={FaUndo} variant="outline" onClick={clearFilters}>Clear</ListToolbar.Button>
            <ListToolbar.Button icon={FaRedoAlt} variant="outline" onClick={loadRows} title="Refresh" />

            <ListToolbar.Divider />
            <ListToolbar.Button icon={FaPlus} disabled={!canCreate} onClick={openCreate}>Add Provider</ListToolbar.Button>
          </ListToolbar>
          <MilikTable
            columns={[
              { label: "Code" },
              { label: "Name" },
              { label: "Contact" },
              { label: "Category" },
              { label: "Settlement" },
              { label: "Outstanding" },
              { label: "Status" },
            ]}
            rows={rows}
            rowKey="_id"
            loading={loading}
            empty="No service providers found."
            minWidth="1150px"
            renderRow={(row) => (
              <>
                <td className="px-3 py-1 border-r border-gray-100 font-mono font-bold text-slate-900 whitespace-nowrap">{row.providerCode}</td>
                <td className="px-3 py-1 border-r border-gray-100 max-w-[180px] truncate text-slate-900 font-bold" title={row.name}>
                  {row.name}
                  {row.subjectToWht && <span className="ml-1.5 inline-flex border border-amber-200 bg-amber-50 px-1 py-0 text-[9px] font-black text-amber-700 align-middle">WHT {row.whtRate}%</span>}
                </td>
                <td className="px-3 py-1 border-r border-gray-100 max-w-[220px] truncate text-slate-700" title={[row.contactPerson, row.phone || row.email].filter(Boolean).join(" · ")}>
                  {row.contactPerson ? <>{row.contactPerson}{(row.phone || row.email) && <span className="text-slate-400"> · {row.phone || row.email}</span>}</> : (row.phone || row.email || "-")}
                </td>
                <td className="px-3 py-1 border-r border-gray-100 whitespace-nowrap text-slate-700 capitalize">{row.category || "general"}</td>
                <td className="px-3 py-1 border-r border-gray-100 max-w-[160px] truncate text-slate-700">{row.bankName || row.paybillNumber || row.accountNumber || "-"}</td>
                <td className="px-3 py-1 border-r border-gray-100 whitespace-nowrap text-right font-mono font-bold">
                  <span className={row.outstanding > 0 ? "text-rose-700" : "text-slate-500"}>{formatMoney(row.outstanding)}</span>
                </td>
                <td className="px-3 py-1 text-center"><span className={`inline-flex border px-2 py-0.5 text-[10px] font-black ${row.isActive !== false ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-600 border-slate-200"}`}>{row.isActive !== false ? "Active" : "Inactive"}</span></td>
              </>
            )}
            renderActions={(row) => (
              <div className="flex justify-end gap-1">
                <button onClick={() => openStatement(row)} className="p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900" title="Creditor Statement"><FaFileInvoiceDollar size={12} /></button>
                {canRecordTakeOn && <button onClick={() => openTakeOn(row)} className="p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900" title="Record Opening Balance"><FaHistory size={12} /></button>}
                <button onClick={() => openEdit(row)} disabled={!canUpdate} className="p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40" title="Edit Provider"><FaEdit size={12} /></button>
                <button onClick={() => handleDelete(row)} disabled={!canDelete} className="p-1 text-red-600 hover:bg-red-50 hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-40" title="Delete Provider"><FaTrash size={12} /></button>
              </div>
            )}
          />
          <PaginationBar
            page={currentPage}
            pages={totalPages}
            total={serverTotal}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            onPageSizeChange={(n) => { setPageSize(n); setCurrentPage(1); }}
            loading={loading}
            label="providers"
          />
        </div>
      </div>

      {showModal && (
        <Modal
          title={editingId ? "Edit Provider" : "New Provider"}
          icon={<FaFileInvoiceDollar size={12} />}
          onClose={closeModal}
          size="extraWide"
          footer={
            <>
              <button type="button" onClick={closeModal} disabled={saving} className="h-8 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                Cancel
              </button>
              <button type="button" onClick={handleSave} disabled={saving} className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-black text-white transition hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60">
                <FaSave size={10} /> {saving ? "Saving…" : editingId ? "Update Provider" : "Save Provider"}
              </button>
            </>
          }
        >
          <div className="space-y-2.5">
            <Section title="Provider Details">
              <div className="space-y-2.5">
                <div className="grid grid-cols-3 gap-2.5">
                  <div className="col-span-2">
                    <label className={labelClass}>Provider Name<Required /></label>
                    <input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Phone</label>
                    <input value={form.phone} onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))} className={inputClass} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  <div>
                    <label className={labelClass}>Contact Person</label>
                    <input value={form.contactPerson} onChange={(e) => setForm((prev) => ({ ...prev, contactPerson: e.target.value }))} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Email</label>
                    <input type="email" value={form.email} onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))} className={inputClass} />
                  </div>
                  <AppSelect
                    label="Category"
                    value={form.category}
                    onChange={(v) => setForm((prev) => ({ ...prev, category: v ?? "general" }))}
                    options={CATEGORY_OPTIONS}
                    size="sm"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  <div>
                    <label className={labelClass}>KRA PIN</label>
                    <input value={form.kraPin} onChange={(e) => setForm((prev) => ({ ...prev, kraPin: e.target.value }))} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Paybill / Till</label>
                    <input value={form.paybillNumber} onChange={(e) => setForm((prev) => ({ ...prev, paybillNumber: e.target.value }))} className={inputClass} />
                  </div>
                  <div className="flex items-end pb-1">
                    <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-900">
                      <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.checked }))} className={checkboxClass} />
                      Active provider
                    </label>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  <div className="col-span-2">
                    <AppSelect
                      label="Default Expense Account"
                      value={form.defaultExpenseAccount}
                      onChange={(v) => setForm((prev) => ({ ...prev, defaultExpenseAccount: v ?? "" }))}
                      options={expenseAccounts.map((a) => ({ value: a._id, label: `${a.code ? `[${a.code}] ` : ""}${a.name}` }))}
                      placeholder="None — pick the account each time"
                      size="sm"
                      searchable
                      clearable
                    />
                    <p className="mt-1 text-[10px] text-slate-500">Pre-fills this GL account on new requisitions/vouchers for this vendor. Doesn't override an account already chosen.</p>
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Notes</label>
                  <textarea rows={2} value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} className={`${inputClass.replace("h-7", "h-auto")} py-1.5`} />
                </div>
              </div>
            </Section>

            <BankDetailsFields
              values={form}
              onChange={(field, value) => setForm((prev) => ({ ...prev, [field]: value }))}
              title="Bank & Payment Details"
            />

            <Section title="Withholding Tax (WHT)">
              <div className="space-y-2.5">
                <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-900">
                  <input
                    type="checkbox"
                    checked={form.subjectToWht}
                    onChange={(e) => setForm((prev) => ({ ...prev, subjectToWht: e.target.checked, whtRate: e.target.checked ? (prev.whtRate || "5") : "" }))}
                    className={checkboxClass}
                  />
                  Subject to WHT deduction on payments
                </label>
                {form.subjectToWht && (
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className={labelClass}>WHT Rate (%)</label>
                      <input
                        type="number"
                        min="0"
                        max="30"
                        step="0.01"
                        value={form.whtRate}
                        onChange={(e) => setForm((prev) => ({ ...prev, whtRate: e.target.value }))}
                        placeholder="e.g. 5"
                        className={inputClass}
                      />
                    </div>
                    <AppSelect
                      label="WHT Category"
                      value={form.whtCategory}
                      onChange={(v) => setForm((prev) => ({ ...prev, whtCategory: v ?? "" }))}
                      options={[
                        { value: "professional_services", label: "Professional Services (5%)" },
                        { value: "management_fees", label: "Management Fees (5%)" },
                        { value: "rent", label: "Rent (5%)" },
                        { value: "contractors", label: "Contractors (3%)" },
                        { value: "dividends", label: "Dividends (5%)" },
                        { value: "other", label: "Other" },
                      ]}
                      placeholder="Select category"
                      size="sm"
                      clearable
                    />
                  </div>
                )}
              </div>
            </Section>
          </div>
        </Modal>
      )}

      {statementRow && (
        <Modal
          title={`Creditor Statement — ${statementRow.name}`}
          icon={<FaFileInvoiceDollar size={12} />}
          onClose={closeStatement}
          size="wide"
          footer={
            <>
              <button type="button" onClick={handlePrintStatement} disabled={!statement?.lines?.length} className="inline-flex h-8 items-center gap-1.5 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
                <FaFilePdf size={10} /> Print
              </button>
              <button type="button" onClick={closeStatement} className="h-8 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">Close</button>
            </>
          }
        >
          {statementLoading ? (
            <div className="py-10 text-center text-xs font-semibold text-slate-500">Loading statement...</div>
          ) : !statement?.lines?.length ? (
            <div className="py-10 text-center text-xs font-semibold text-slate-500">No invoiced or paid transactions for this provider yet.</div>
          ) : (
            <>
              <div className="mb-3 grid grid-cols-3 gap-2.5">
                <div className="border border-slate-200 bg-slate-50 p-2.5 text-center">
                  <p className="text-[10px] font-bold uppercase text-slate-500">Invoiced</p>
                  <p className="font-mono text-sm font-black text-slate-900">{formatMoney(statement.summary?.totalInvoiced)}</p>
                </div>
                <div className="border border-slate-200 bg-slate-50 p-2.5 text-center">
                  <p className="text-[10px] font-bold uppercase text-slate-500">Paid</p>
                  <p className="font-mono text-sm font-black text-slate-900">{formatMoney(statement.summary?.totalPaid)}</p>
                </div>
                <div className="border border-rose-200 bg-rose-50 p-2.5 text-center">
                  <p className="text-[10px] font-bold uppercase text-rose-600">Outstanding</p>
                  <p className="font-mono text-sm font-black text-rose-700">{formatMoney(statement.summary?.outstanding)}</p>
                </div>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[10px] font-black uppercase text-slate-500">
                    <th className="py-1.5">Date</th>
                    <th className="py-1.5">Ref</th>
                    <th className="py-1.5">Description</th>
                    <th className="py-1.5 text-right">Invoiced</th>
                    <th className="py-1.5 text-right">Paid</th>
                    <th className="py-1.5 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.lines.map((line, idx) => (
                    <tr key={idx} className="border-b border-slate-100">
                      <td className="whitespace-nowrap py-1.5">{line.date ? new Date(line.date).toLocaleDateString() : "-"}</td>
                      <td className="max-w-[120px] truncate py-1.5 font-mono" title={line.ref}>{line.ref || "-"}</td>
                      <td className="max-w-[200px] truncate py-1.5 text-slate-600" title={line.description}>{line.description || "-"}</td>
                      <td className="py-1.5 text-right font-mono">{line.invoiced ? formatMoney(line.invoiced) : "-"}</td>
                      <td className="py-1.5 text-right font-mono">{line.paid ? formatMoney(line.paid) : "-"}</td>
                      <td className="py-1.5 text-right font-mono font-bold">{formatMoney(line.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Modal>
      )}

      {takeOnRow && (
        <Modal
          title={`Opening Balance — ${takeOnRow.name}`}
          icon={<FaHistory size={12} />}
          onClose={closeTakeOn}
          size="md"
          footer={
            <>
              <button type="button" onClick={closeTakeOn} disabled={savingTakeOn} className="h-8 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
              <button type="button" onClick={handleSaveTakeOn} disabled={savingTakeOn} className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-black text-white transition hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60">
                <FaSave size={10} /> {savingTakeOn ? "Recording…" : "Record Opening Balance"}
              </button>
            </>
          }
        >
          <div className="space-y-2.5">
            <p className="text-[11px] text-slate-500">
              Records what this vendor was already owed before being added here. Posts immediately as an approved accrual — it will show up in this vendor's Outstanding balance, statement and AP aging right away.
            </p>
            <div>
              <label className={labelClass}>Amount Owed<Required /></label>
              <CurrencyInput value={takeOnForm.amount} onChange={(e) => setTakeOnForm((prev) => ({ ...prev, amount: e.target.value }))} inputClassName={inputClass.replace("px-2.5", "pl-10 pr-2.5")} />
            </div>
            <div>
              <AppSelect
                label="Expense Account"
                value={takeOnForm.expenseAccount}
                onChange={(v) => setTakeOnForm((prev) => ({ ...prev, expenseAccount: v ?? "" }))}
                options={expenseAccounts.map((a) => ({ value: a._id, label: `${a.code ? `[${a.code}] ` : ""}${a.name}` }))}
                placeholder="Select the GL account this balance relates to"
                size="sm"
                searchable
              />
            </div>
            <div>
              <label className={labelClass}>Effective Date<Required /></label>
              <input type="date" max={new Date().toISOString().split("T")[0]} value={takeOnForm.effectiveDate} onChange={(e) => setTakeOnForm((prev) => ({ ...prev, effectiveDate: e.target.value }))} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Notes</label>
              <textarea rows={2} value={takeOnForm.notes} onChange={(e) => setTakeOnForm((prev) => ({ ...prev, notes: e.target.value }))} className={`${inputClass.replace("h-7", "h-auto")} py-1.5`} placeholder="e.g. Carried over from previous accounting system" />
            </div>
          </div>
        </Modal>
      )}
    </DashboardLayout>
  );
};

export default ServiceProviders;
