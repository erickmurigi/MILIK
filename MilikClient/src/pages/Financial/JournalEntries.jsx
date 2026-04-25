import React, { useEffect, useMemo, useState } from "react";
import {
  FaBookOpen,
  FaCheck,
  FaEdit,
  FaFilter,
  FaPlus,
  FaRedoAlt,
  FaSearch,
  FaTimes,
  FaTrash,
  FaUndo,
} from "react-icons/fa";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { isSelfManagingLandlordCompany } from "../../utils/companyModules";
import { getProperties } from "../../redux/propertyRedux";
import {
  createJournalEntry,
  deleteJournalEntry,
  getChartOfAccounts,
  getJournalEntries,
  getLandlords,
  postJournalEntry,
  reverseJournalEntry,
  updateJournalEntry,
} from "../../redux/apiCalls";
import { hasCompanyPermission } from "../../utils/permissions";

const JOURNAL_TYPES = [
  {
    value: "general_manual_journal",
    label: "General Manual Journal",
    description: "Use for controlled same-company adjustments. Leave it off the landlord statement unless one side is Landlord Remittance Payable.",
  },
  {
    value: "internal_account_transfer",
    label: "Internal Ledger Transfer (Same Company)",
    description: "Moves value between two ledger accounts inside the selected company only. Cross-company transfers are intentionally blocked.",
  },
  {
    value: "landlord_credit_adjustment",
    label: "Landlord Credit Adjustment",
    description: "Credits Landlord Remittance Payable to raise a landlord-facing addition with a balanced journal.",
  },
  {
    value: "landlord_debit_adjustment",
    label: "Landlord Debit Adjustment",
    description: "Debits Landlord Remittance Payable to post a landlord-facing deduction with a balanced journal.",
  },
  {
    value: "property_expense_accrual",
    label: "Property Expense / Landlord Deduction",
    description: "Use only when you need a manual landlord-facing property deduction. Debit Landlord Remittance Payable and credit the balancing account.",
  },
];

const STATUS_STYLES = {
  draft: "bg-slate-100 text-slate-700 border-slate-200",
  posted: "bg-green-100 text-green-700 border-green-200",
  reversed: "bg-amber-100 text-amber-700 border-amber-200",
};

const isLandlordPayableAccountRecord = (account = {}) => {
  const code = String(account?.code || account?.accountCode || "").trim().toUpperCase();
  const name = String(account?.name || account?.accountName || account?.title || "").trim().toLowerCase();
  return (
    code === "2110" ||
    /landlord remittance payable|landlord payable|owner payable|owner remittance payable/.test(name)
  );
};

const ITEMS_PER_PAGE = 50;

const buildInitialForm = () => ({
  date: new Date().toISOString().split("T")[0],
  journalType: "general_manual_journal",
  property: "",
  landlord: "",
  debitAccount: "",
  creditAccount: "",
  amount: "",
  reference: "",
  narration: "",
  includeInLandlordStatement: false,
});

const JournalEntries = () => {
  const dispatch = useDispatch();
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const currentUser = useSelector((state) => state.auth?.currentUser || state.auth?.user || null);
  const properties = useSelector((state) => state.property?.properties || []);
  const landlords = useSelector((state) => state.landlord?.landlords || []);
  const canCreateJournal = hasCompanyPermission(currentUser || {}, currentCompany, "journals", "create", "accounts");
  const canUpdateJournal = hasCompanyPermission(currentUser || {}, currentCompany, "journals", "update", "accounts");
  const canPostJournal = hasCompanyPermission(currentUser || {}, currentCompany, "journals", "process", "accounts");
  const canReverseJournal = hasCompanyPermission(currentUser || {}, currentCompany, "journals", "reverse", "accounts");
  const canDeleteJournal = hasCompanyPermission(currentUser || {}, currentCompany, "journals", "delete", "accounts");
  const isLandlordWorkspace = useMemo(
    () => isSelfManagingLandlordCompany(currentCompany || currentUser?.company || null),
    [currentCompany, currentUser?.company]
  );

  const [journals, setJournals] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [rowActionKey, setRowActionKey] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingJournalId, setEditingJournalId] = useState("");
  const [saving, setSaving] = useState(false);

  const [filters, setFilters] = useState({
    search: "",
    status: "all",
    journalType: "all",
    propertyId: "all",
  });

  const [form, setForm] = useState(buildInitialForm());
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    if (!currentCompany?._id) return;
    dispatch(getProperties({ business: currentCompany._id }));
    if (!isLandlordWorkspace) {
      dispatch(getLandlords({ company: currentCompany._id }));
    }
  }, [dispatch, currentCompany?._id, isLandlordWorkspace]);

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
  }, [currentCompany?._id, filters.search, filters.status, filters.journalType, filters.propertyId]);

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


  const totalPages = Math.max(1, Math.ceil(journals.length / ITEMS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentPageRows = journals.slice(startIndex, endIndex);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters.search, filters.status, filters.journalType, filters.propertyId]);

  useEffect(() => {
    if (currentPage !== safeCurrentPage) setCurrentPage(safeCurrentPage);
  }, [currentPage, safeCurrentPage]);

  const propertyOptions = useMemo(
    () =>
      properties.map((p) => ({
        value: p._id,
        label: p.propertyName || p.name || "Property",
      })),
    [properties]
  );


  const selectedPropertyRecord = useMemo(
    () => properties.find((property) => String(property?._id || "") === String(form.property || "")) || null,
    [form.property, properties]
  );

  const derivedLandlordIdFromProperty = useMemo(() => {
    if (!selectedPropertyRecord) return "";
    return (
      selectedPropertyRecord?.landlords?.find((item) => item?.isPrimary && (item?.landlordId?._id || item?.landlordId || item?._id))?.landlordId?._id ||
      selectedPropertyRecord?.landlords?.find((item) => item?.isPrimary && (item?.landlordId?._id || item?.landlordId || item?._id))?.landlordId ||
      selectedPropertyRecord?.landlords?.find((item) => item?.landlordId?._id || item?.landlordId || item?._id)?.landlordId?._id ||
      selectedPropertyRecord?.landlords?.find((item) => item?.landlordId?._id || item?.landlordId || item?._id)?.landlordId ||
      selectedPropertyRecord?.landlords?.find((item) => item?._id)?._id ||
      ""
    );
  }, [selectedPropertyRecord]);

  const landlordOptions = useMemo(
    () =>
      landlords.map((l) => ({
        value: l._id,
        label: l.landlordName || l.name || "Landlord",
      })),
    [landlords]
  );

  const accountOptions = useMemo(
    () =>
      accounts.map((a) => ({
        value: a._id,
        label: `${a.code} - ${a.name}`,
      })),
    [accounts]
  );

  const selectedDebitAccountRecord = useMemo(
    () => accounts.find((account) => String(account?._id || "") === String(form.debitAccount || "")) || null,
    [accounts, form.debitAccount]
  );

  const selectedCreditAccountRecord = useMemo(
    () => accounts.find((account) => String(account?._id || "") === String(form.creditAccount || "")) || null,
    [accounts, form.creditAccount]
  );

  const getJournalTypePresentation = (journalType) => {
    const match = JOURNAL_TYPES.find((type) => type.value === journalType) || JOURNAL_TYPES[0];
    if (!isLandlordWorkspace) return match;

    if (journalType === "landlord_credit_adjustment") {
      return {
        ...match,
        label: "Owner Credit Adjustment",
        description: "Raises an owner-facing addition while preserving a balanced manual journal.",
      };
    }

    if (journalType === "landlord_debit_adjustment") {
      return {
        ...match,
        label: "Owner Debit Adjustment",
        description: "Posts an owner-facing deduction while preserving a balanced manual journal.",
      };
    }

    return match;
  };

  const activeJournalTypePresentation = useMemo(
    () => getJournalTypePresentation(form.journalType),
    [form.journalType, isLandlordWorkspace]
  );

  const isLandlordJournal =
    form.journalType === "landlord_credit_adjustment" ||
    form.journalType === "landlord_debit_adjustment";
  const isInternalTransferJournal = form.journalType === "internal_account_transfer";
  const isForcedLandlordStatementJournal =
    form.journalType === "landlord_credit_adjustment" ||
    form.journalType === "landlord_debit_adjustment" ||
    form.journalType === "property_expense_accrual";
  const debitTouchesLandlordPayable = isLandlordPayableAccountRecord(selectedDebitAccountRecord);
  const creditTouchesLandlordPayable = isLandlordPayableAccountRecord(selectedCreditAccountRecord);
  const statementVisibilityLocked = isInternalTransferJournal || isForcedLandlordStatementJournal;
  const journalStructureHint = useMemo(() => {
    if (form.journalType === "landlord_credit_adjustment") {
      return "Credit Landlord Remittance Payable and debit the balancing account. This creates one clean landlord statement addition.";
    }
    if (form.journalType === "landlord_debit_adjustment") {
      return "Debit Landlord Remittance Payable and credit the balancing account. This creates one clean landlord statement deduction.";
    }
    if (form.journalType === "property_expense_accrual") {
      return "Use this only for a manual landlord-facing property deduction. Debit Landlord Remittance Payable and credit the accrual or offset account.";
    }
    if (form.journalType === "internal_account_transfer") {
      return "Internal transfers stay inside the same company only and must not use Landlord Remittance Payable or appear on the landlord statement.";
    }
    if (form.includeInLandlordStatement) {
      return "Statement-visible general journals must touch Landlord Remittance Payable on exactly one side. Debit = deduction. Credit = addition.";
    }
    return "General manual journals stay internal unless you deliberately expose one payable-side leg to the landlord statement.";
  }, [
    form.includeInLandlordStatement,
    form.journalType,
  ]);

  const applyJournalTypeDefaults = (journalType) => {
    const landlordStatementJournal =
      journalType === "landlord_credit_adjustment" ||
      journalType === "landlord_debit_adjustment" ||
      journalType === "property_expense_accrual";

    setForm((prev) => ({
      ...prev,
      journalType,
      includeInLandlordStatement:
        journalType === "internal_account_transfer" ? false : landlordStatementJournal,
      landlord:
        journalType === "internal_account_transfer"
          ? ""
          : isLandlordWorkspace
          ? derivedLandlordIdFromProperty || prev.landlord
          : prev.landlord,
    }));
  };

  const resetForm = () => {
    setEditingJournalId("");
    setForm(buildInitialForm());
  };

  const openCreateModal = () => {
    if (!canCreateJournal) {
      toast.warning("You do not have permission to create journals");
      return;
    }
    setEditingJournalId("");
    setForm((prev) => ({
      ...buildInitialForm(),
      landlord: isLandlordWorkspace ? derivedLandlordIdFromProperty || "" : "",
    }));
    setShowCreateModal(true);
  };

  const openEditModal = (journal) => {
    if (!canUpdateJournal) {
      toast.warning("You do not have permission to edit journals");
      return;
    }
    if (journal?.status !== "draft") {
      toast.info("Only draft journals can be edited directly. Reverse posted journals and recreate them if needed.");
      return;
    }

    setEditingJournalId(String(journal._id || ""));
    setForm({
      date: journal?.date ? new Date(journal.date).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
      journalType: journal?.journalType || "general_manual_journal",
      property: journal?.property?._id || journal?.property || "",
      landlord: journal?.landlord?._id || journal?.landlord || "",
      debitAccount: journal?.debitAccount?._id || journal?.debitAccount || "",
      creditAccount: journal?.creditAccount?._id || journal?.creditAccount || "",
      amount: journal?.amount || "",
      reference: journal?.reference || "",
      narration: journal?.narration || "",
      includeInLandlordStatement: Boolean(journal?.includeInLandlordStatement),
    });
    setShowCreateModal(true);
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
    resetForm();
  };


  useEffect(() => {
    if (!isLandlordWorkspace) return;
    if (!form.property) return;
    if (!derivedLandlordIdFromProperty) return;
    if (form.landlord === derivedLandlordIdFromProperty) return;

    setForm((prev) => ({
      ...prev,
      landlord: derivedLandlordIdFromProperty,
    }));
  }, [derivedLandlordIdFromProperty, form.landlord, form.property, isLandlordWorkspace]);

  const handleSaveJournal = async () => {
    if (!(editingJournalId ? canUpdateJournal : canCreateJournal)) {
      toast.warning(editingJournalId ? "You do not have permission to update journals" : "You do not have permission to create journals");
      return;
    }
    if (!currentCompany?._id) {
      toast.warning("Please select a company first");
      return;
    }

    if (!form.property) {
      toast.warning("Property is required");
      return;
    }

    if (isLandlordJournal && !isLandlordWorkspace && !form.landlord) {
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

    if (isInternalTransferJournal && (debitTouchesLandlordPayable || creditTouchesLandlordPayable)) {
      toast.warning("Internal ledger transfers cannot use Landlord Remittance Payable.");
      return;
    }

    if (form.journalType === "landlord_credit_adjustment" && (!creditTouchesLandlordPayable || debitTouchesLandlordPayable)) {
      toast.warning("Landlord Credit Adjustment must credit Landlord Remittance Payable.");
      return;
    }

    if (["landlord_debit_adjustment", "property_expense_accrual"].includes(form.journalType) && (!debitTouchesLandlordPayable || creditTouchesLandlordPayable)) {
      toast.warning(
        form.journalType === "property_expense_accrual"
          ? "Property Expense / Landlord Deduction must debit Landlord Remittance Payable."
          : "Landlord Debit Adjustment must debit Landlord Remittance Payable."
      );
      return;
    }

    if (
      form.journalType === "general_manual_journal" &&
      form.includeInLandlordStatement &&
      debitTouchesLandlordPayable === creditTouchesLandlordPayable
    ) {
      toast.warning("Statement-visible general journals must touch Landlord Remittance Payable on exactly one side.");
      return;
    }

    const payload = {
      business: currentCompany._id,
      company: currentCompany._id,
      date: form.date,
      journalType: form.journalType,
      property: form.property,
      landlord: isInternalTransferJournal ? undefined : (isLandlordWorkspace ? derivedLandlordIdFromProperty || form.landlord || undefined : form.landlord || undefined),
      debitAccount: form.debitAccount,
      creditAccount: form.creditAccount,
      amount: Number(form.amount),
      reference: form.reference,
      narration: form.narration,
      includeInLandlordStatement: isInternalTransferJournal
        ? false
        : isForcedLandlordStatementJournal
        ? true
        : Boolean(form.includeInLandlordStatement),
    };

    setSaving(true);
    try {
      const saved = editingJournalId
        ? await updateJournalEntry(editingJournalId, payload)
        : await createJournalEntry(payload);

      setJournals((prev) =>
        editingJournalId
          ? prev.map((row) => (row._id === editingJournalId ? saved : row))
          : [saved, ...prev]
      );
      toast.success(
        editingJournalId
          ? `Journal ${saved?.journalNo || ""} updated`
          : `Journal ${saved?.journalNo || ""} created`
      );
      closeCreateModal();
    } catch (error) {
      toast.error(
        error?.response?.data?.message ||
          (editingJournalId ? "Failed to update journal" : "Failed to create journal")
      );
    } finally {
      setSaving(false);
    }
  };

  const handlePostJournal = async (journal) => {
    if (!canPostJournal) {
      toast.warning("You do not have permission to post journals");
      return;
    }
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
    if (!canReverseJournal) {
      toast.warning("You do not have permission to reverse journals");
      return;
    }
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
    if (!canDeleteJournal) {
      toast.warning("You do not have permission to delete journals");
      return;
    }
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
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 p-2">
        <div className="mx-auto flex w-full max-w-full min-h-0 flex-1 flex-col gap-2">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="sticky top-0 z-20 flex-shrink-0 border-b border-slate-200 bg-slate-50/95 p-2 shadow-sm backdrop-blur">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[260px] flex-1">
                  <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400" />
                  <input
                    value={filters.search}
                    onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                    placeholder="Search journal no, reference, narration"
                    className="h-8 w-full rounded border border-gray-300 bg-[#DDEFE1] py-1.5 pl-9 pr-3 text-xs shadow-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                  />
                </div>
                <select
                  value={filters.status}
                  onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
                  className="h-8 rounded border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                >
                  <option value="all">All Statuses</option>
                  <option value="draft">Draft</option>
                  <option value="posted">Posted</option>
                  <option value="reversed">Reversed</option>
                </select>
                <select
                  value={filters.journalType}
                  onChange={(e) => setFilters((prev) => ({ ...prev, journalType: e.target.value }))}
                  className="h-8 rounded border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                >
                  <option value="all">All Journal Types</option>
                  {JOURNAL_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {getJournalTypePresentation(type.value)?.label || type.label}
                    </option>
                  ))}
                </select>
                <select
                  value={filters.propertyId}
                  onChange={(e) => setFilters((prev) => ({ ...prev, propertyId: e.target.value }))}
                  className="h-8 rounded border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                >
                  <option value="all">All Properties</option>
                  {propertyOptions.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => setFilters({ search: "", status: "all", journalType: "all", propertyId: "all" })}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-[11px] font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100"
                >
                  <FaFilter /> Reset
                </button>
                <button onClick={loadJournals} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-[11px] font-bold text-slate-700 hover:bg-slate-100"><FaRedoAlt /> Refresh</button>
                <button onClick={openCreateModal} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#FF8C00] px-3 text-[11px] font-bold text-white hover:bg-[#e67e00]"><FaPlus /> New Journal</button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full min-w-[1440px] text-xs">
                <thead>
                  <tr className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                    <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">Journal</th>
                    <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">Date</th>
                    <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">Type</th>
                    <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">Property</th>
                    <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">{isLandlordWorkspace ? "Owner" : "Landlord"}</th>
                    <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">Debit</th>
                    <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">Credit</th>
                    <th className="px-3 py-2 text-right text-[11px] font-black uppercase tracking-[0.16em]">Amount</th>
                    <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">Status</th>
                    <th className="px-3 py-2 text-right text-[11px] font-black uppercase tracking-[0.16em]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-10 text-center text-slate-500">Loading journals...</td>
                    </tr>
                  ) : journals.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-10 text-center text-slate-500">No journals found.</td>
                    </tr>
                  ) : (
                    currentPageRows.map((journal, index) => {
                      const busyPost = rowActionKey === `${journal._id}:post`;
                      const busyReverse = rowActionKey === `${journal._id}:reverse`;
                      const busyDelete = rowActionKey === `${journal._id}:delete`;

                      return (
                        <tr
                          key={journal._id}
                          className={`border-t border-slate-100 ${index % 2 === 0 ? "bg-white" : "bg-slate-50/40"} hover:bg-slate-50`}
                        >
                          <td className="px-3 py-1.5">
                            <div className="font-black text-slate-900">{journal.journalNo}</div>
                            <div className="text-xs text-slate-500">{journal.reference || journal.narration || "No reference"}</div>
                          </td>
                          <td className="px-3 py-1.5 text-slate-700">{journal.date ? new Date(journal.date).toLocaleDateString() : "-"}</td>
                          <td className="px-3 py-1.5 text-slate-700">{getJournalTypePresentation(journal.journalType)?.label || journal.journalType}</td>
                          <td className="px-3 py-1.5 text-slate-700">{journal.property?.propertyName || journal.property?.name || "N/A"}</td>
                          <td className="px-3 py-1.5 text-slate-700">{journal.landlord?.landlordName || journal.landlord?.name || "-"}</td>
                          <td className="px-3 py-1.5 text-slate-700">{journal.debitAccount?.code} - {journal.debitAccount?.name}</td>
                          <td className="px-3 py-1.5 text-slate-700">{journal.creditAccount?.code} - {journal.creditAccount?.name}</td>
                          <td className="px-3 py-1.5 text-right font-black text-slate-900">KES {Number(journal.amount || 0).toLocaleString()}</td>
                          <td className="px-3 py-1.5">
                            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${STATUS_STYLES[journal.status] || STATUS_STYLES.draft}`}>
                              {journal.status}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <div className="inline-flex flex-wrap justify-end gap-2">
                              {journal.status === "draft" && (
                                <>
                                  <button
                                    onClick={() => openEditModal(journal)}
                                    disabled={!canUpdateJournal || !!rowActionKey}
                                    className="inline-flex items-center gap-1 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 disabled:opacity-60"
                                  >
                                    <FaEdit /> Edit
                                  </button>
                                  <button
                                    onClick={() => handlePostJournal(journal)}
                                    disabled={!canPostJournal || !!rowActionKey}
                                    className="inline-flex items-center gap-1 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-xs font-black text-green-700 disabled:opacity-60"
                                  >
                                    <FaCheck /> {busyPost ? "Posting..." : "Post"}
                                  </button>
                                  <button
                                    onClick={() => handleDeleteJournal(journal)}
                                    disabled={!canDeleteJournal || !!rowActionKey}
                                    className="inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700 disabled:opacity-60"
                                  >
                                    <FaTrash /> {busyDelete ? "Deleting..." : "Delete"}
                                  </button>
                                </>
                              )}
                              {journal.status === "posted" && (
                                <button
                                  onClick={() => handleReverseJournal(journal)}
                                  disabled={!canReverseJournal || !!rowActionKey}
                                  className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-black text-amber-700 disabled:opacity-60"
                                >
                                  <FaUndo /> {busyReverse ? "Reversing..." : "Reverse"}
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
            <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
              <div className="font-semibold">Showing <span className="font-bold text-slate-900">{journals.length === 0 ? 0 : startIndex + 1}</span> to <span className="font-bold text-slate-900">{Math.min(endIndex, journals.length)}</span> of <span className="font-bold text-slate-900">{journals.length}</span> journal(s)</div>
              <div className="flex items-center gap-2"><span className="font-semibold">Per page: {ITEMS_PER_PAGE}</span><button onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))} disabled={safeCurrentPage === 1} className="rounded-lg border border-slate-300 px-3 py-1 font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Previous</button><span className="font-semibold text-slate-700">Page {safeCurrentPage} of {totalPages}</span><button onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))} disabled={safeCurrentPage === totalPages} className="rounded-lg border border-slate-300 px-3 py-1 font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Next</button></div>
            </div>
          </div>
        </div>
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-slate-900/45 p-4 sm:items-center sm:p-6">
          <div className="flex w-full max-w-5xl max-h-[calc(100vh-2rem)] flex-col overflow-y-auto overscroll-contain rounded-3xl border border-slate-200 bg-white shadow-2xl sm:max-h-[calc(100vh-3rem)]">
            <div className="sticky top-0 z-20 flex shrink-0 items-center justify-between bg-[#0B3B2E] px-6 py-4 text-white">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-100">Financial Accounts</p>
                <h3 className="text-xl font-black">{editingJournalId ? "Edit Draft Journal" : "Create Journal Entry"}</h3>
                <p className="mt-1 text-xs text-emerald-50">
                  {editingJournalId
                    ? "Only draft journals can be edited directly. Posted journals must be reversed to preserve audit integrity."
                    : "Draft first, then review and post from the journal list."}
                </p>
              </div>
              <button
                onClick={closeCreateModal}
                className="rounded-full border border-white/30 p-2 hover:bg-white/10"
              >
                <FaTimes />
              </button>
            </div>

            <div className="grid gap-4 p-6 lg:grid-cols-[1.15fr,0.85fr]">
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Journal type</p>
                  <select
                    value={form.journalType}
                    onChange={(e) => applyJournalTypeDefaults(e.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-1.5 text-xs focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                  >
                    {JOURNAL_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {getJournalTypePresentation(type.value)?.label || type.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-3 text-xs leading-6 text-slate-600">{activeJournalTypePresentation.description}</p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-bold text-slate-700">Journal Date</span>
                    <input
                      type="date"
                      value={form.date}
                      onChange={(e) => setForm((prev) => ({ ...prev, date: e.target.value }))}
                      className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-1.5 text-xs focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                    />
                  </label>

                  <label className="block">
                    <span className="text-xs font-bold text-slate-700">Property</span>
                    <select
                      value={form.property}
                      onChange={(e) => setForm((prev) => ({ ...prev, property: e.target.value }))}
                      className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-1.5 text-xs focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                    >
                      <option value="">Select property</option>
                      {propertyOptions.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-slate-500">
                      {isInternalTransferJournal
                        ? "Property stays required because posted ledger entries in the current architecture are property-scoped. The linked owner context is derived automatically during posting."
                        : isLandlordWorkspace
                        ? "Select the property context this owner-side journal belongs to. The linked owner is derived from the property automatically."
                        : "Select the property context this journal belongs to."}
                    </p>
                  </label>

                  {isInternalTransferJournal ? (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 md:col-span-2">
                      {isLandlordWorkspace
                        ? "Owner selection is not needed for internal ledger transfers. MILIK derives the owner automatically from the selected property's accounting context when the balanced ledger entries are posted."
                        : "Landlord selection is not needed for internal ledger transfers. MILIK derives the landlord automatically from the selected property's accounting context when the balanced ledger entries are posted."}
                    </div>
                  ) : isLandlordWorkspace ? (
                    <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4 text-xs text-orange-900 md:col-span-2">
                      <p className="font-black uppercase tracking-[0.16em] text-orange-700">Owner Context</p>
                      <p className="mt-1 leading-6">
                        This company is operating as the owner, so MILIK derives the owner ledger context from the selected property automatically. No separate landlord picker is required here.
                      </p>
                    </div>
                  ) : (
                    <label className="block md:col-span-2">
                      <span className="text-xs font-bold text-slate-700">Landlord</span>
                      <select
                        value={form.landlord}
                        onChange={(e) => setForm((prev) => ({ ...prev, landlord: e.target.value }))}
                        className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-1.5 text-xs focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                      >
                        <option value="">Select landlord {isLandlordJournal ? "" : "(optional)"}</option>
                        {landlordOptions.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-xs text-slate-500">
                        {isLandlordJournal
                          ? "Required because this journal affects a landlord-facing adjustment."
                          : "Optional unless the journal touches landlord-specific balances."}
                      </p>
                    </label>
                  )}
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-bold text-slate-700">Debit Account</span>
                    <select
                      value={form.debitAccount}
                      onChange={(e) => setForm((prev) => ({ ...prev, debitAccount: e.target.value }))}
                      className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-1.5 text-xs focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                    >
                      <option value="">Select debit account</option>
                      {accountOptions.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-xs font-bold text-slate-700">Credit Account</span>
                    <select
                      value={form.creditAccount}
                      onChange={(e) => setForm((prev) => ({ ...prev, creditAccount: e.target.value }))}
                      className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-1.5 text-xs focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                    >
                      <option value="">Select credit account</option>
                      {accountOptions.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              <div className="space-y-4">
                <label className="block">
                  <span className="text-xs font-bold text-slate-700">Amount</span>
                  <input
                    type="number"
                    min="0"
                    value={form.amount}
                    onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-1.5 text-xs focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-bold text-slate-700">Reference</span>
                  <input
                    value={form.reference}
                    onChange={(e) => setForm((prev) => ({ ...prev, reference: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-1.5 text-xs focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-bold text-slate-700">Narration</span>
                  <textarea
                    rows={5}
                    value={form.narration}
                    onChange={(e) => setForm((prev) => ({ ...prev, narration: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-1.5 text-xs focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                  />
                </label>

                <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={isInternalTransferJournal ? false : isForcedLandlordStatementJournal ? true : form.includeInLandlordStatement}
                    disabled={statementVisibilityLocked}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        includeInLandlordStatement: e.target.checked,
                      }))
                    }
                    className="mt-1"
                  />
                  <span>
                    {isLandlordWorkspace ? "Include in owner adjustment metadata" : "Include in landlord statement metadata"}
                    <span className="mt-1 block text-xs text-slate-500">
                      {isInternalTransferJournal
                        ? "Disabled for internal ledger transfers because those remain same-company movements only."
                        : isForcedLandlordStatementJournal
                        ? "Locked on for landlord-facing journal types because they are designed to create one clean landlord addition or deduction."
                        : "Turn this on only when exactly one side is Landlord Remittance Payable. Debit = deduction. Credit = addition."}
                    </span>
                  </span>
                </label>

                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
                  <p className="font-black">Control note</p>
                  <p className="mt-1 leading-6">{journalStructureHint}</p>
                  <p className="mt-2 text-xs font-semibold text-amber-800">
                    Current selection: debit {debitTouchesLandlordPayable ? "touches" : "does not touch"} Landlord Remittance Payable · credit {creditTouchesLandlordPayable ? "touches" : "does not touch"} Landlord Remittance Payable.
                  </p>
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 z-20 flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 bg-white/95 px-6 py-4 backdrop-blur-sm">
              <button
                onClick={closeCreateModal}
                className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-black text-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveJournal}
                disabled={!(editingJournalId ? canUpdateJournal : canCreateJournal) || saving}
                className="inline-flex items-center gap-2 rounded-xl bg-[#0B3B2E] px-3 py-1.5 text-xs font-black text-white disabled:opacity-60"
              >
                <FaPlus /> {saving ? "Saving..." : editingJournalId ? "Update Draft Journal" : "Save Draft Journal"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );

};

export default JournalEntries;
