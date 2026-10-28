import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { FaBook, FaEdit, FaPlus, FaSearch, FaWallet } from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import ListToolbar from "../../components/common/ListToolbar";
import MilikTable from "../../components/common/MilikTable";
import AppSelect from "../../components/common/AppSelect";
import CurrencyInput from "../../components/common/CurrencyInput";
import Modal from "../../components/common/Modal";
import { hasCompanyPermission } from "../../utils/permissions";
import { getCachedChartOfAccounts } from "../../utils/chartOfAccountsCache";
import {
  createPettyCashAccount,
  getPettyCashAccounts,
  updatePettyCashAccount,
} from "../../redux/pettyCashApi";

const labelClass = "mb-1 block text-xs font-bold text-slate-900";
const inputClass = "h-7 w-full border bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-500 outline-none transition focus:ring-1 border-slate-300 focus:border-[#0B3B2E] focus:ring-[#0B3B2E]/20";
const Required = () => <span className="ml-0.5 font-black text-red-600">*</span>;

const Section = ({ title, children }) => (
  <div className="border border-slate-200 bg-white">
    <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5">
      <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-800">{title}</h3>
    </div>
    <div className="space-y-2.5 p-2.5">{children}</div>
  </div>
);

const fmt = (n) => Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const EMPTY_FORM = { name: "", custodianName: "", floatAmount: "", glAccountId: "", voucherPrefix: "PCV", notes: "", status: "active" };

const PettyCashAccounts = () => {
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const currentUser = useSelector((s) => s.auth?.currentUser);
  const businessId = currentCompany?._id;
  const navigate = useNavigate();

  const canCreate = hasCompanyPermission(currentUser, currentCompany, "pettyCash", "create", "accounts");

  const [accounts, setAccounts] = useState([]);
  const [coas, setCoas] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const assetAccounts = useMemo(() => coas.filter((a) => a.isActive !== false && String(a.type).toLowerCase() === "asset"), [coas]);

  const loadAccounts = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const data = await getPettyCashAccounts({ business: businessId });
      setAccounts(Array.isArray(data) ? data : []);
    } catch {
      toast.error("Failed to load petty cash accounts");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  useEffect(() => {
    if (!businessId) return;
    getCachedChartOfAccounts(businessId)
      .then((list) => setCoas(list.filter((a) => !a.isHeader && a.active !== false && a.isActive !== false)))
      .catch(() => {});
  }, [businessId]);

  const filteredAccounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts.filter((a) => {
      if (q && !a.name?.toLowerCase().includes(q) && !a.custodianName?.toLowerCase().includes(q)) return false;
      if (statusFilter && a.status !== statusFilter) return false;
      return true;
    });
  }, [accounts, search, statusFilter]);

  const openCreate = () => { setEditingId(null); setForm(EMPTY_FORM); setShowForm(true); };
  const openEdit = (account) => {
    setEditingId(account._id);
    setForm({
      name: account.name || "",
      custodianName: account.custodianName || "",
      floatAmount: String(account.floatAmount ?? ""),
      glAccountId: account.glAccountId?._id || account.glAccountId || "",
      voucherPrefix: account.voucherPrefix || "PCV",
      notes: account.notes || "",
      status: account.status || "active",
    });
    setShowForm(true);
  };
  const closeForm = () => { setShowForm(false); setEditingId(null); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Account name is required");
    if (!form.floatAmount || Number(form.floatAmount) <= 0) return toast.error("Float amount must be greater than zero");
    if (!form.glAccountId) return toast.error("GL asset account is required — every transaction needs somewhere to post to in the ledger");
    setSubmitting(true);
    try {
      if (editingId) {
        await updatePettyCashAccount(editingId, { ...form, business: businessId });
        toast.success("Petty cash account updated");
      } else {
        await createPettyCashAccount({ ...form, business: businessId });
        toast.success("Petty cash account created");
      }
      closeForm();
      await loadAccounts();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-[calc(100dvh-152px)] flex-col overflow-hidden">

        {/* Toolbar */}
        <ListToolbar>
          <FaWallet size={10} className="shrink-0 text-slate-400" />
          <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-slate-400">Petty Cash Accounts</span>
          <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
            Accounts: {filteredAccounts.length}
          </span>
          <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
            Active: {filteredAccounts.filter((a) => a.status === "active").length}
          </span>

          <ListToolbar.Divider />

          <div className="relative shrink-0">
            <FaSearch className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-slate-400" />
            <ListToolbar.Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, custodian…" width="w-48" className="pl-6" />
          </div>
          <AppSelect
            size="sm"
            clearable
            placeholder="All Statuses"
            value={statusFilter}
            onChange={(v) => setStatusFilter(v ?? "")}
            options={[{ value: "active", label: "Active" }, { value: "closed", label: "Closed" }]}
          />

          <div className="flex-1" />
          <ListToolbar.Button icon={FaPlus} disabled={!canCreate} onClick={openCreate}>
            New Account
          </ListToolbar.Button>
        </ListToolbar>

        {/* List */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <MilikTable
            columns={[
              { label: "Account Name" },
              { label: "Custodian" },
              { label: "Float (KES)", align: "right" },
              { label: "Current Balance (KES)", align: "right" },
              { label: "GL Account" },
              { label: "Voucher Prefix" },
              { label: "Status", align: "center" },
            ]}
            rows={filteredAccounts}
            rowKey="_id"
            loading={loading && accounts.length === 0}
            empty={accounts.length === 0 ? "No petty cash accounts yet. Click “New Account” to get started." : "No accounts match these filters."}
            renderActions={(a) => (
              <div className="flex items-center justify-center gap-1">
                <button onClick={() => navigate(`/accounts/petty-cash?account=${a._id}`)} className="p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900" title="View ledger">
                  <FaBook size={11} />
                </button>
                <button onClick={() => openEdit(a)} className="p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900" title="Edit account">
                  <FaEdit size={11} />
                </button>
              </div>
            )}
            renderRow={(a) => (
              <>
                <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-800">{a.name}</td>
                <td className="px-3 py-1 border-r border-gray-100 text-slate-600">{a.custodianName || "—"}</td>
                <td className="px-3 py-1 border-r border-gray-100 text-right font-mono text-slate-700">{fmt(a.floatAmount)}</td>
                <td className="px-3 py-1 border-r border-gray-100 text-right font-mono font-semibold text-slate-800">{fmt(a.currentBalance)}</td>
                <td className="px-3 py-1 border-r border-gray-100 text-slate-500">
                  {a.glAccountId ? `${a.glAccountId.code ? a.glAccountId.code + " — " : ""}${a.glAccountId.name}` : <span className="text-red-500">Not set</span>}
                </td>
                <td className="px-3 py-1 border-r border-gray-100 font-mono text-slate-500">{a.voucherPrefix}</td>
                <td className="px-3 py-1 text-center">
                  <span className={`inline-flex border px-2 py-0.5 text-[10px] font-semibold ${a.status === "active" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-500"}`}>
                    {a.status}
                  </span>
                </td>
              </>
            )}
          />
        </div>
      </div>

      {/* New / Edit Account */}
      {showForm && (
        <Modal
          title={editingId ? "Edit Petty Cash Account" : "New Petty Cash Account"}
          icon={<FaWallet size={12} />}
          onClose={closeForm}
          footer={
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={closeForm} className="h-8 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                Cancel
              </button>
              <button type="submit" form="pc-account-form" disabled={submitting}
                className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-black text-white transition hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60">
                {submitting ? "Saving…" : editingId ? "Save Changes" : "Create Account"}
              </button>
            </div>
          }
        >
          <form id="pc-account-form" onSubmit={handleSubmit} className="space-y-2.5">
            <Section title="Account Details">
              <div>
                <label className={labelClass}>Account Name<Required /></label>
                <input className={inputClass} value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Head Office Petty Cash" />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className={labelClass}>Custodian Name</label>
                  <input className={inputClass} value={form.custodianName} onChange={(e) => setForm((p) => ({ ...p, custodianName: e.target.value }))} placeholder="Person responsible" />
                </div>
                <div>
                  <label className={labelClass}>Voucher Prefix</label>
                  <input className={inputClass} value={form.voucherPrefix} onChange={(e) => setForm((p) => ({ ...p, voucherPrefix: e.target.value.toUpperCase().slice(0, 10) }))} placeholder="PCV" maxLength={10} />
                </div>
              </div>
              {editingId && (
                <div>
                  <label className={labelClass}>Status</label>
                  <AppSelect
                    value={form.status}
                    onChange={(v) => setForm((p) => ({ ...p, status: v ?? "active" }))}
                    options={[{ value: "active", label: "Active" }, { value: "closed", label: "Closed" }]}
                    size="sm"
                    className="w-full"
                  />
                </div>
              )}
            </Section>
            <Section title="Float & GL Posting">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className={labelClass}>Float Amount<Required /></label>
                  <CurrencyInput value={form.floatAmount} onChange={(e) => setForm((p) => ({ ...p, floatAmount: e.target.value }))} placeholder="e.g. 10000" inputClassName={inputClass.replace("px-2.5", "pl-10 pr-2.5")} />
                </div>
                <div>
                  <label className={labelClass}>Petty Cash Asset Account (GL)<Required /></label>
                  <AppSelect
                    value={form.glAccountId}
                    onChange={(v) => setForm((p) => ({ ...p, glAccountId: v ?? "" }))}
                    options={assetAccounts.map((a) => ({ value: String(a._id), label: `${a.code ? a.code + " — " : ""}${a.name}` }))}
                    placeholder="— Select account —"
                    searchable
                    clearable
                    size="sm"
                    className="w-full"
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>Notes</label>
                <textarea className={`${inputClass.replace("h-7", "h-auto")} py-1.5`} rows={2} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Optional notes" />
              </div>
            </Section>
          </form>
        </Modal>
      )}
    </DashboardLayout>
  );
};

export default PettyCashAccounts;
