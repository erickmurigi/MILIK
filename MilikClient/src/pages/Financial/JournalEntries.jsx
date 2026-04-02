import React, { useEffect, useMemo, useState } from "react";
import {
  FaBookOpen,
  FaPlus,
  FaRedoAlt,
  FaSearch,
  FaTrash,
  FaCheck,
  FaUndo,
  FaFilter,
} from "react-icons/fa";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { getProperties } from "../../redux/propertyRedux";
import {
  getLandlords,
  getChartOfAccounts,
  getJournalEntries,
  createJournalEntry,
  updateJournalEntry,
  postJournalEntry,
  reverseJournalEntry,
  deleteJournalEntry,
} from "../../redux/apiCalls";

const JOURNAL_TYPES = [
  { value: "landlord_credit_adjustment", label: "Landlord Credit Adjustment" },
  { value: "landlord_debit_adjustment", label: "Landlord Debit Adjustment" },
  { value: "property_expense_accrual", label: "Property Expense Accrual" },
  { value: "general_manual_journal", label: "General Manual Journal" },
];

const STATUS_STYLES = {
  draft: "bg-slate-100 text-slate-700 border-slate-200",
  posted: "bg-green-100 text-green-700 border-green-200",
  reversed: "bg-amber-100 text-amber-700 border-amber-200",
};

const JournalEntries = () => {
  const dispatch = useDispatch();
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const properties = useSelector((state) => state.property?.properties || []);
  const landlords = useSelector((state) => state.landlord?.landlords || []);

  const [journals, setJournals] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [rowActionKey, setRowActionKey] = useState("");

  const [filters, setFilters] = useState({
    search: "",
    status: "all",
    journalType: "all",
    propertyId: "all",
  });

  const [form, setForm] = useState({
    date: new Date().toISOString().split("T")[0],
    journalType: "landlord_credit_adjustment",
    property: "",
    landlord: "",
    debitAccount: "",
    creditAccount: "",
    amount: "",
    reference: "",
    narration: "",
    includeInLandlordStatement: true,
  });

  useEffect(() => {
    if (!currentCompany?._id) return;
    dispatch(getProperties({ business: currentCompany._id }));
    dispatch(getLandlords({ company: currentCompany._id }));
  }, [dispatch, currentCompany?._id]);

  useEffect(() => {
    const loadAccounts = async () => {
      if (!currentCompany?._id) return;
      try {
        const rows = await getChartOfAccounts({ business: currentCompany._id });
        setAccounts(
          Array.isArray(rows)
            ? rows.filter((row) => row?.isPosting !== false && row?.isHeader !== true)
            : []
        );
      } catch (error) {
        toast.error(
          error?.response?.data?.error ||
            error?.response?.data?.message ||
            "Failed to load chart of accounts"
        );
      }
    };

    loadAccounts();
  }, [currentCompany?._id]);

  const loadJournals = async () => {
    if (!currentCompany?._id) return;
    setLoading(true);
    try {
      const rows = await getJournalEntries({
        business: currentCompany._id,
        company: currentCompany._id,
        ...filters,
      });
      setJournals(Array.isArray(rows) ? rows : []);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load journal entries");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJournals();
  }, [currentCompany?._id, filters]);

  const totals = useMemo(() => {
    return journals.reduce(
      (acc, item) => {
        const amount = Number(item.amount || 0);
        acc.total += amount;
        if (item.status === "draft") acc.draft += amount;
        if (item.status === "posted") acc.posted += amount;
        if (item.status === "reversed") acc.reversed += amount;
        return acc;
      },
      { total: 0, draft: 0, posted: 0, reversed: 0 }
    );
  }, [journals]);

  const propertyOptions = properties.map((p) => ({
    value: p._id,
    label: p.propertyName || p.name || "Property",
  }));

  const landlordOptions = landlords.map((l) => ({
    value: l._id,
    label: l.landlordName || l.name || "Landlord",
  }));

  const accountOptions = accounts.map((a) => ({
    value: a._id,
    label: `${a.code} - ${a.name}`,
    type: a.type,
  }));

  const isLandlordJournal =
    form.journalType === "landlord_credit_adjustment" ||
    form.journalType === "landlord_debit_adjustment";

  const resetForm = () => {
    setForm({
      date: new Date().toISOString().split("T")[0],
      journalType: "landlord_credit_adjustment",
      property: "",
      landlord: "",
      debitAccount: "",
      creditAccount: "",
      amount: "",
      reference: "",
      narration: "",
      includeInLandlordStatement: true,
    });
  };

  const handleCreateJournal = async () => {
    if (!currentCompany?._id) {
      toast.warning("Please select a company first");
      return;
    }

    if (!form.property) {
      toast.warning("Property is required");
      return;
    }

    if (isLandlordJournal && !form.landlord) {
      toast.warning("Landlord is required for landlord journal types");
      return;
    }

    if (!form.debitAccount) {
      toast.warning("Debit account is required");
      return;
    }

    if (!form.creditAccount) {
      toast.warning("Credit account is required");
      return;
    }

    if (form.debitAccount === form.creditAccount) {
      toast.warning("Debit and credit accounts must be different");
      return;
    }

    if (!form.amount || Number(form.amount) <= 0) {
      toast.warning("Amount must be greater than zero");
      return;
    }

    const payload = {
      business: currentCompany._id,
      company: currentCompany._id,
      date: form.date,
      journalType: form.journalType,
      property: form.property,
      landlord: form.landlord || undefined,
      debitAccount: form.debitAccount,
      creditAccount: form.creditAccount,
      amount: Number(form.amount),
      reference: form.reference,
      narration: form.narration,
      includeInLandlordStatement: Boolean(form.includeInLandlordStatement),
    };

    try {
      const saved = await createJournalEntry(payload);
      setJournals((prev) => [saved, ...prev]);
      toast.success(`Journal ${saved?.journalNo || ""} created`);
      resetForm();
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to create journal");
    }
  };

  const handlePostJournal = async (journal) => {
    setRowActionKey(`${journal._id}:post`);
    try {
      const updated = await postJournalEntry(journal._id, {
        business: currentCompany?._id,
        company: currentCompany?._id,
      });
      setJournals((prev) => prev.map((row) => (row._id === journal._id ? updated : row)));
      toast.success(`Journal ${updated?.journalNo || ""} posted`);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to post journal");
    } finally {
      setRowActionKey("");
    }
  };

  const handleReverseJournal = async (journal) => {
    const ok = window.confirm(`Reverse journal ${journal.journalNo}?`);
    if (!ok) return;

    setRowActionKey(`${journal._id}:reverse`);
    try {
      const updated = await reverseJournalEntry(journal._id, {
        business: currentCompany?._id,
        company: currentCompany?._id,
        reason: `Journal ${journal.journalNo} reversed`,
      });
      setJournals((prev) => prev.map((row) => (row._id === journal._id ? updated : row)));
      toast.success(`Journal ${updated?.journalNo || ""} reversed`);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to reverse journal");
    } finally {
      setRowActionKey("");
    }
  };

  const handleDeleteJournal = async (journal) => {
    const ok = window.confirm(`Delete draft journal ${journal.journalNo}?`);
    if (!ok) return;

    setRowActionKey(`${journal._id}:delete`);
    try {
      await deleteJournalEntry(journal._id, {
        business: currentCompany?._id,
        company: currentCompany?._id,
      });
      setJournals((prev) => prev.filter((row) => row._id !== journal._id));
      toast.success("Journal deleted");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to delete journal");
    } finally {
      setRowActionKey("");
    }
  };

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 p-3">
        <div className="mx-auto" style={{ maxWidth: "96%" }}>
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-2.5 mb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h1 className="text-sm font-bold text-slate-900 uppercase tracking-wide flex items-center gap-2">
                <FaBookOpen /> Journal Entries
              </h1>
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="px-2 py-0.5 rounded border border-slate-300 bg-slate-50 font-semibold">
                  Total: Ksh {totals.total.toLocaleString()}
                </span>
                <span className="px-2 py-0.5 rounded border border-slate-300 bg-slate-50 font-semibold">
                  Draft: Ksh {totals.draft.toLocaleString()}
                </span>
                <span className="px-2 py-0.5 rounded border border-green-300 bg-green-50 font-semibold text-green-700">
                  Posted: Ksh {totals.posted.toLocaleString()}
                </span>
                <span className="px-2 py-0.5 rounded border border-amber-300 bg-amber-50 font-semibold text-amber-700">
                  Reversed: Ksh {totals.reversed.toLocaleString()}
                </span>
                <button
                  onClick={loadJournals}
                  className="px-2 py-0.5 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 font-semibold inline-flex items-center gap-1"
                >
                  <FaRedoAlt size={10} /> Refresh
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-5 gap-3">
            <div className="xl:col-span-2 bg-white border border-slate-200 rounded-lg shadow-sm p-3 space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-700 uppercase">
                <FaPlus /> New Journal
              </div>

              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((prev) => ({ ...prev, date: e.target.value }))}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded"
                />
                <select
                  value={form.journalType}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      journalType: e.target.value,
                      includeInLandlordStatement:
                        e.target.value === "landlord_credit_adjustment" ||
                        e.target.value === "landlord_debit_adjustment",
                    }))
                  }
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded"
                >
                  {JOURNAL_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>

              <select
                value={form.property}
                onChange={(e) => setForm((prev) => ({ ...prev, property: e.target.value }))}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded"
              >
                <option value="">Select Property</option>
                {propertyOptions.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>

              <select
                value={form.landlord}
                onChange={(e) => setForm((prev) => ({ ...prev, landlord: e.target.value }))}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded"
              >
                <option value="">Select Landlord {isLandlordJournal ? "" : "(optional)"}</option>
                {landlordOptions.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>

              <select
                value={form.debitAccount}
                onChange={(e) => setForm((prev) => ({ ...prev, debitAccount: e.target.value }))}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded"
              >
                <option value="">Select Debit Account</option>
                {accountOptions.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>

              <select
                value={form.creditAccount}
                onChange={(e) => setForm((prev) => ({ ...prev, creditAccount: e.target.value }))}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded"
              >
                <option value="">Select Credit Account</option>
                {accountOptions.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>

              <input
                type="number"
                min="0"
                placeholder="Amount"
                value={form.amount}
                onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded"
              />

              <input
                type="text"
                placeholder="Reference"
                value={form.reference}
                onChange={(e) => setForm((prev) => ({ ...prev, reference: e.target.value }))}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded"
              />

              <textarea
                rows={3}
                placeholder="Narration"
                value={form.narration}
                onChange={(e) => setForm((prev) => ({ ...prev, narration: e.target.value }))}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded"
              />

              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={form.includeInLandlordStatement}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      includeInLandlordStatement: e.target.checked,
                    }))
                  }
                />
                Include in landlord statement metadata
              </label>

              <button
                onClick={handleCreateJournal}
                className="w-full px-3 py-2 text-xs rounded text-white font-semibold bg-[#0B3B2E] hover:bg-[#0A3127]"
              >
                Save Draft Journal
              </button>
            </div>

            <div className="xl:col-span-3 bg-white border border-slate-200 rounded-lg shadow-sm p-3">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <div className="relative flex-1 min-w-[180px]">
                  <FaSearch className="absolute left-2 top-2.5 text-[10px] text-slate-400" />
                  <input
                    value={filters.search}
                    onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                    placeholder="Search journal no, reference, narration"
                    className="w-full pl-7 pr-2 py-2 text-xs border border-slate-300 rounded"
                  />
                </div>

                <select
                  value={filters.status}
                  onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
                  className="px-2 py-2 text-xs border border-slate-300 rounded"
                >
                  <option value="all">All Statuses</option>
                  <option value="draft">Draft</option>
                  <option value="posted">Posted</option>
                  <option value="reversed">Reversed</option>
                </select>

                <select
                  value={filters.journalType}
                  onChange={(e) => setFilters((prev) => ({ ...prev, journalType: e.target.value }))}
                  className="px-2 py-2 text-xs border border-slate-300 rounded"
                >
                  <option value="all">All Journal Types</option>
                  {JOURNAL_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>

                <select
                  value={filters.propertyId}
                  onChange={(e) => setFilters((prev) => ({ ...prev, propertyId: e.target.value }))}
                  className="px-2 py-2 text-xs border border-slate-300 rounded"
                >
                  <option value="all">All Properties</option>
                  {propertyOptions.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>

                <button
                  onClick={() =>
                    setFilters({
                      search: "",
                      status: "all",
                      journalType: "all",
                      propertyId: "all",
                    })
                  }
                  className="px-2 py-2 text-xs border border-slate-300 rounded text-slate-700 hover:bg-slate-50 flex items-center gap-1"
                >
                  <FaFilter /> Reset
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] text-xs">
                  <thead>
                    <tr className="bg-[#0B3B2E] text-white">
                      <th className="px-2 py-1 text-left">Journal</th>
                      <th className="px-2 py-1 text-left">Date</th>
                      <th className="px-2 py-1 text-left">Type</th>
                      <th className="px-2 py-1 text-left">Property</th>
                      <th className="px-2 py-1 text-left">Landlord</th>
                      <th className="px-2 py-1 text-left">Debit</th>
                      <th className="px-2 py-1 text-left">Credit</th>
                      <th className="px-2 py-1 text-right">Amount</th>
                      <th className="px-2 py-1 text-left">Status</th>
                      <th className="px-2 py-1 text-left">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={10} className="px-2 py-6 text-center text-slate-500">
                          Loading journals...
                        </td>
                      </tr>
                    ) : journals.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="px-2 py-6 text-center text-slate-500">
                          No journals found.
                        </td>
                      </tr>
                    ) : (
                      journals.map((journal) => {
                        const busyPost = rowActionKey === `${journal._id}:post`;
                        const busyReverse = rowActionKey === `${journal._id}:reverse`;
                        const busyDelete = rowActionKey === `${journal._id}:delete`;

                        return (
                          <tr
                            key={journal._id}
                            className="border-b border-slate-200 hover:bg-slate-50"
                          >
                            <td className="px-2 py-1.5 font-bold text-slate-900">
                              {journal.journalNo}
                            </td>
                            <td className="px-2 py-1.5">
                              {journal.date ? new Date(journal.date).toLocaleDateString() : "-"}
                            </td>
                            <td className="px-2 py-1.5">
                              {JOURNAL_TYPES.find((t) => t.value === journal.journalType)?.label ||
                                journal.journalType}
                            </td>
                            <td className="px-2 py-1.5">
                              {journal.property?.propertyName || journal.property?.name || "N/A"}
                            </td>
                            <td className="px-2 py-1.5">
                              {journal.landlord?.landlordName || journal.landlord?.name || "-"}
                            </td>
                            <td className="px-2 py-1.5">
                              {journal.debitAccount?.code} - {journal.debitAccount?.name}
                            </td>
                            <td className="px-2 py-1.5">
                              {journal.creditAccount?.code} - {journal.creditAccount?.name}
                            </td>
                            <td className="px-2 py-1.5 text-right font-semibold">
                              {Number(journal.amount || 0).toLocaleString()}
                            </td>
                            <td className="px-2 py-1.5">
                              <span
                                className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                                  STATUS_STYLES[journal.status] || STATUS_STYLES.draft
                                }`}
                              >
                                {journal.status}
                              </span>
                            </td>
                            <td className="px-2 py-1.5">
                              <div className="flex flex-wrap gap-1">
                                {journal.status === "draft" && (
                                  <>
                                    <button
                                      onClick={() => handlePostJournal(journal)}
                                      disabled={!!rowActionKey}
                                      className="inline-flex items-center gap-1 rounded border border-green-300 bg-green-50 px-2 py-1 text-[11px] font-semibold text-green-700 disabled:opacity-60"
                                    >
                                      <FaCheck size={10} />
                                      {busyPost ? "Posting..." : "Post"}
                                    </button>

                                    <button
                                      onClick={() => handleDeleteJournal(journal)}
                                      disabled={!!rowActionKey}
                                      className="inline-flex items-center gap-1 rounded border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 disabled:opacity-60"
                                    >
                                      <FaTrash size={10} />
                                      {busyDelete ? "Deleting..." : "Delete"}
                                    </button>
                                  </>
                                )}

                                {journal.status === "posted" && (
                                  <button
                                    onClick={() => handleReverseJournal(journal)}
                                    disabled={!!rowActionKey}
                                    className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700 disabled:opacity-60"
                                  >
                                    <FaUndo size={10} />
                                    {busyReverse ? "Reversing..." : "Reverse"}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default JournalEntries;