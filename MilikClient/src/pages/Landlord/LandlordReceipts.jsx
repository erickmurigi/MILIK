import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEntityCache } from "../../hooks/useEntityCache";
import useDebounce from "../../hooks/useDebounce";
import { useTabState } from "../../hooks/useTabState";
import { useDispatch, useSelector } from "react-redux";
import {
  FaArrowLeft,
  FaCheck,
  FaDownload,
  FaEdit,
  FaEye,
  FaMoneyBillWave,
  FaPlus,
  FaPrint,
  FaRedoAlt,
  FaSearch,
  FaTimes,
  FaTrash,
  FaUndo,
} from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import AppSelect from "../../components/common/AppSelect";
import { getLandlords, getChartOfAccounts, getLandlordReceipts, getLandlordAdvancements, createLandlordReceipt, updateLandlordReceipt, postLandlordReceipt, reverseLandlordReceipt, deleteLandlordReceipt } from "../../redux/apiCalls";
import { selectCurrentCompany, selectCurrentUser, selectAllLandlords, selectAllProperties } from "../../redux/selectors";
import { getProperties } from "../../redux/propertyRedux";
import { hasCompanyPermission } from "../../utils/permissions";
import { isCashbookAccount } from "../../utils/cashbookUtils";
import { useConfirm } from "../../context/ConfirmContext";
import { fmtDate } from "../../utils/dates";
import { formatMoney } from "../../utils/money";
import { printDocument, printTabularList, formatMoney as formatPrintMoney } from "../../utils/printKit";
import PaginationBar from "../../components/PaginationBar";
import MilikTable from "../../components/common/MilikTable";
import ListToolbar from "../../components/common/ListToolbar";

const CATEGORY_OPTIONS = [
  { value: "owner_float", label: "Owner Float / Expense Funding", accountHint: "Cr 2150 Landlord Funds Held" },
  { value: "expense_reimbursement", label: "Expense Reimbursement", accountHint: "Cr 1210 Landlord Advances Recoverable" },
  { value: "advance_settlement", label: "Advance Settlement", accountHint: "Cr 1210 Landlord Advances Recoverable" },
  { value: "utility_funding", label: "Utility Funding", accountHint: "Cr 2150 Landlord Funds Held" },
  { value: "deposit_funding", label: "Deposit Funding", accountHint: "Cr 2150 Landlord Funds Held" },
  { value: "other_adjusted_receipt", label: "Other Adjusted Receipt", accountHint: "Cr 2110 Landlord Remittance Payable" },
];

const PAYMENT_METHOD_OPTIONS = [
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "mobile_money", label: "Mobile Money / M-Pesa" },
  { value: "cash", label: "Cash" },
  { value: "check", label: "Cheque" },
  { value: "credit_card", label: "Credit Card" },
];

const LINKED_DOCUMENT_OPTIONS = [
  { value: "", label: "None" },
  { value: "processed_statement", label: "Processed Statement" },
  { value: "payment_voucher", label: "Payment Voucher" },
  { value: "expense_requisition", label: "Expense Requisition" },
  { value: "manual_reference", label: "Manual Reference" },
];

const formInputClass = "h-7 w-full border border-slate-300 bg-white px-2.5 text-xs text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";
const formLabelClass = "mb-0.5 block text-xs font-bold text-slate-900";
const FormSection = ({ title, children }) => (
  <div className="border border-slate-200 bg-white">
    <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5">
      <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-800">{title}</h3>
    </div>
    <div className="p-2.5">{children}</div>
  </div>
);

const ensureArray = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.rows)) return value.rows;
  return [];
};

const todayInput = () => new Date().toISOString().split("T")[0];


const actorName = (user) => {
  if (!user) return "-";
  const full = [String(user?.surname || "").trim(), String(user?.otherNames || "").trim()].filter(Boolean).join(" ");
  return full || user?.email || "-";
};

const buildDefaultForm = () => ({
  landlord: "",
  property: "",
  receiptDate: todayInput(),
  amount: "",
  category: "owner_float",
  paymentMethod: "bank_transfer",
  cashbook: "Main Cashbook",
  referenceNumber: "",
  narration: "",
  linkedDocumentType: "",
  linkedDocumentId: "",
  linkedDocumentRef: "",
});

const findPropertyById = (properties, propertyId) =>
  properties.find((property) => String(property?._id || "") === String(propertyId || "")) || null;

const getPropertyLinkedLandlord = (property, landlords = []) => {
  const landlordLinks = Array.isArray(property?.landlords) ? property.landlords : [];
  const primary = landlordLinks.find((item) => item?.isPrimary && (item?.landlordId || item?._id));
  const fallback = landlordLinks.find((item) => item?.landlordId || item?._id);
  const linked = primary || fallback || null;
  const landlordId = String(linked?.landlordId || linked?._id || "");
  if (!landlordId) {
    return { id: "", name: linked?.name || "", source: linked || null };
  }
  const full = landlords.find((item) => String(item?._id || "") === landlordId);
  return {
    id: landlordId,
    name: full?.landlordName || linked?.name || "",
    source: linked || null,
  };
};

const LandlordReceipts = () => {
  const confirm = useConfirm();
  const dispatch = useDispatch();
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const landlords = ensureArray(useSelector(selectAllLandlords));
  const entityCache = useEntityCache(currentCompany?._id);
  const entityCacheRef = useRef(entityCache);
  entityCacheRef.current = entityCache;
  const properties = ensureArray(useSelector(selectAllProperties));
  const activeLandlords = useMemo(() => landlords.filter((item) => String(item?.status || "active").toLowerCase() !== "archived"), [landlords]);
  const activeProperties = useMemo(() => properties.filter((item) => String(item?.status || "active").toLowerCase() !== "archived"), [properties]);
  // Stable option arrays — avoids busting AppSelect's internal useMemo on every render
  const activeLandlordOptions = useMemo(() => activeLandlords.map((l) => ({ value: l._id, label: l.landlordName })), [activeLandlords]);

  const canCreate  = hasCompanyPermission(currentUser, currentCompany, "landlordReceipts", "create", "accounts");
  const canReverse = hasCompanyPermission(currentUser, currentCompany, "landlordReceipts", "reverse", "accounts");

  const [cashbooks, setCashbooks] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [totalReceipts, setTotalReceipts] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [advancements, setAdvancements] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [pageSize, setPageSize] = useState(25);
  const [filters, setFilters] = useTabState("/receipts/landlord:filters", { search: "", status: "", category: "", landlord: "", property: "" });
  const [currentPage, setCurrentPage] = useTabState("/receipts/landlord:currentPage", 1);
  const debouncedSearch = useDebounce(filters.search, 400);
  const [showFormModal, setShowFormModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeReceipt, setActiveReceipt] = useState(null);
  const [editingReceiptId, setEditingReceiptId] = useState("");
  const [formData, setFormData] = useState(buildDefaultForm());

  const loadData = useCallback(async () => {
    if (!currentCompany?._id) return;
    setIsLoading(true);
    const { propertiesLoaded } = entityCacheRef.current;
    try {
      const [chartRows, receiptRows] = await Promise.all([
        getChartOfAccounts({ business: currentCompany._id, type: "asset" }),
        getLandlordReceipts({
          business: currentCompany._id,
          page: currentPage,
          limit: pageSize,
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.category ? { category: filters.category } : {}),
          ...(filters.landlord ? { landlord: filters.landlord } : {}),
          ...(filters.property ? { property: filters.property } : {}),
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
        }),
        dispatch(getLandlords({ company: currentCompany._id })),
        ...(propertiesLoaded ? [] : [dispatch(getProperties({ business: currentCompany._id }))]),
      ]);

      setCashbooks(ensureArray(chartRows).filter(isCashbookAccount));
      setReceipts(ensureArray(receiptRows?.data));
      setTotalReceipts(receiptRows?.total ?? 0);
      setTotalPages(receiptRows?.pages ?? 1);
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to load landlord receipts");
    } finally {
      setIsLoading(false);
    }
  }, [currentCompany?._id, dispatch, currentPage, pageSize, filters.status, filters.category, filters.landlord, filters.property, debouncedSearch]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (cashbooks.length === 0) return;
    setFormData((prev) => ({
      ...prev,
      cashbook: cashbooks.some((item) => item.name === prev.cashbook) ? prev.cashbook : cashbooks[0]?.name || prev.cashbook,
    }));
  }, [cashbooks]);

  const landlordPropertyOptions = useMemo(() => activeProperties.map((p) => ({ value: p._id, label: p.propertyName })), [activeProperties]);
  const cashbookOptions = useMemo(() => cashbooks.map((account) => ({ value: account.name, label: account.name })), [cashbooks]);

  const selectedProperty = useMemo(
    () => findPropertyById(properties, formData.property),
    [properties, formData.property]
  );

  const resolvedFormLandlord = useMemo(
    () => getPropertyLinkedLandlord(selectedProperty, landlords),
    [selectedProperty, landlords]
  );

  useEffect(() => {
    const nextLandlordId = String(resolvedFormLandlord?.id || "");
    if (!formData.property) {
      if (formData.landlord) {
        setFormData((prev) => ({ ...prev, landlord: "" }));
      }
      return;
    }
    if (nextLandlordId && String(formData.landlord || "") !== nextLandlordId) {
      setFormData((prev) => ({ ...prev, landlord: nextLandlordId }));
      return;
    }
    if (!nextLandlordId && formData.landlord) {
      setFormData((prev) => ({ ...prev, landlord: "" }));
    }
  }, [resolvedFormLandlord?.id, formData.property, formData.landlord]);

  // The on-screen table is server-paginated (one page at a time) — printing or exporting
  // the whole filtered register needs its own fetch with every matching row.
  const fetchAllFilteredReceipts = async () => {
    const result = await getLandlordReceipts({
      business: currentCompany._id,
      page: 1,
      limit: 2000,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.landlord ? { landlord: filters.landlord } : {}),
      ...(filters.property ? { property: filters.property } : {}),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
    });
    return ensureArray(result?.data);
  };

  const PRINT_COLUMNS = [
    { label: "Date", value: (r) => fmtDate(r.receiptDate) },
    { label: "Receipt No", value: (r) => r.receiptNumber || "-" },
    { label: "Landlord", value: (r) => r?.landlord?.landlordName || "-" },
    { label: "Property", value: (r) => r?.property?.propertyName || "-" },
    { label: "Category", value: (r) => CATEGORY_OPTIONS.find((item) => item.value === r?.category)?.label || r?.category || "-" },
    { label: "Amount", align: "right", bold: true, value: (r) => formatMoney(r?.amount || 0) },
    { label: "Status", align: "center", value: (r) => String(r?.status || "draft").toUpperCase() },
  ];

  const handlePrintList = async () => {
    if (!currentCompany?._id) return;
    try {
      const printRows = await fetchAllFilteredReceipts();
      if (printRows.length === 0) { toast.info("There are no landlord receipts to print."); return; }
      const totalAmount = printRows.reduce((s, r) => s + Number(r.amount || 0), 0);
      const printed = printTabularList({
        title: "Landlord Receipts",
        subtitle: `${printRows.length.toLocaleString()} receipt${printRows.length !== 1 ? "s" : ""}`,
        company: currentCompany,
        summaryItems: [
          ["Total Receipts", printRows.length.toLocaleString()],
          ["Total Amount", formatMoney(totalAmount)],
        ],
        columns: PRINT_COLUMNS,
        rows: printRows,
        totalsRow: ["", "", "", "", "Total", formatMoney(totalAmount), ""],
      });
      if (!printed) toast.error("Pop-up blocked — allow pop-ups for this site to print");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load landlord receipts for printing");
    }
  };

  const handleExportCsv = async () => {
    if (!currentCompany?._id) return;
    try {
      const exportRows = await fetchAllFilteredReceipts();
      if (exportRows.length === 0) { toast.info("There are no landlord receipts to export."); return; }
      const header = PRINT_COLUMNS.map((c) => c.label);
      const rows = exportRows.map((r) => PRINT_COLUMNS.map((c) => c.value(r)));
      const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `landlord-receipts-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load landlord receipts for export");
    }
  };

  useEffect(() => {
    if (formData.category !== "advance_settlement" || !currentCompany?._id || !formData.property) {
      setAdvancements([]);
      return;
    }
    getLandlordAdvancements({
      business: currentCompany._id,
      propertyId: formData.property,
      ...(formData.landlord ? { landlordId: formData.landlord } : {}),
      status: "all",
    })
      .then((rows) => setAdvancements(ensureArray(rows).filter((a) => ["disbursed", "recovering"].includes(a.status))))
      .catch(() => {});
  }, [formData.category, formData.property, formData.landlord, currentCompany?._id]);

  const openCreateModal = () => {
    if (!canCreate) { toast.warning("You don't have permission to record landlord receipts"); return; }
    setEditingReceiptId("");
    setFormData(buildDefaultForm());
    setShowFormModal(true);
  };

  const openEditModal = (receipt) => {
    if (!canCreate) { toast.warning("You don't have permission to edit landlord receipts"); return; }
    setEditingReceiptId(String(receipt?._id || ""));
    setFormData({
      property: String(receipt?.property?._id || receipt?.property || ""),
      landlord: String(receipt?.landlord?._id || receipt?.landlord || ""),
      receiptDate: receipt?.receiptDate ? new Date(receipt.receiptDate).toISOString().split("T")[0] : todayInput(),
      amount: String(receipt?.amount || ""),
      category: String(receipt?.category || "owner_float"),
      paymentMethod: String(receipt?.paymentMethod || "bank_transfer"),
      cashbook: String(receipt?.cashbook || "Main Cashbook"),
      referenceNumber: String(receipt?.referenceNumber || ""),
      narration: String(receipt?.narration || ""),
      linkedDocumentType: String(receipt?.linkedDocumentType || ""),
      linkedDocumentId: String(receipt?.linkedDocumentId || ""),
      linkedDocumentRef: String(receipt?.linkedDocumentRef || ""),
    });
    setShowFormModal(true);
  };

  const handleSave = async () => {
    if (!currentCompany?._id) return;
    const resolvedLandlordId = String(resolvedFormLandlord?.id || formData.landlord || "");
    if (!formData.property || !formData.amount || Number(formData.amount) <= 0) {
      toast.error("Property and a valid amount are required.");
      return;
    }
    if (!resolvedLandlordId) {
      toast.error("The selected property must have a linked landlord before you can save this receipt.");
      return;
    }
    if (!formData.referenceNumber.trim()) {
      toast.error("Reference number is required.");
      return;
    }
    if (!formData.cashbook.trim()) {
      toast.error("Cashbook is required.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...formData,
        landlord: resolvedLandlordId,
        amount: Number(formData.amount),
        business: currentCompany._id,
      };

      if (editingReceiptId) {
        await updateLandlordReceipt(editingReceiptId, payload);
        toast.success("Landlord receipt updated successfully.");
      } else {
        await createLandlordReceipt(payload);
        toast.success("Landlord receipt created successfully.");
      }

      setShowFormModal(false);
      setEditingReceiptId("");
      setFormData(buildDefaultForm());
      await loadData();
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to save landlord receipt");
    } finally {
      setSaving(false);
    }
  };

  const handlePost = async (receipt) => {
    if (!canCreate) { toast.warning("You don't have permission to post landlord receipts"); return; }
    if (!receipt?._id) return;
    try {
      await postLandlordReceipt(receipt._id, { business: currentCompany?._id });
      toast.success("Landlord receipt posted successfully.");
      await loadData();
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to post landlord receipt");
    }
  };

  const handleReverse = async (receipt) => {
    if (!canReverse) { toast.warning("You don't have permission to reverse landlord receipts"); return; }
    if (!receipt?._id) return;
    const reason = window.prompt("Enter reversal reason", "Landlord receipt reversed") || "Landlord receipt reversed";
    try {
      await reverseLandlordReceipt(receipt._id, { business: currentCompany?._id, reason });
      toast.success("Landlord receipt reversed successfully.");
      await loadData();
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to reverse landlord receipt");
    }
  };

  const handleDelete = async (receipt) => {
    if (!canCreate) { toast.warning("You don't have permission to delete landlord receipts"); return; }
    if (!receipt?._id) return;
    const ok = await confirm({ title: "Delete Receipt", message: `Delete draft receipt ${receipt.receiptNumber || ""}?`, confirmText: "Delete", isDangerous: true });
    if (!ok) return;
    try {
      await deleteLandlordReceipt(receipt._id, { business: currentCompany?._id });
      toast.success("Landlord receipt deleted successfully.");
      await loadData();
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to delete landlord receipt");
    }
  };

  const handlePrint = (receipt) => {
    if (!receipt) return;
    const money = (v) => `KES ${formatPrintMoney(v)}`;
    const categoryLabel = CATEGORY_OPTIONS.find((item) => item.value === receipt?.category)?.label || receipt?.category || "-";
    const status = String(receipt?.status || "draft").toLowerCase();
    const preparedByName = [currentUser?.otherNames, currentUser?.surname].filter(Boolean).join(" ") || currentUser?.email || "Milik Admin";
    const printed = printDocument({
      company: currentCompany,
      docType: "Landlord Receipt",
      docNumber: receipt?.receiptNumber || "-",
      status: { label: status.replace(/_/g, " "), tone: { draft: "warning", posted: "success", reversed: "danger" }[status] || "neutral" },
      watermark: status === "reversed" ? "VOID" : "",
      meta: [["Date", fmtDate(receipt?.receiptDate)]],
      parties: [{ heading: "Received from", name: receipt?.landlord?.landlordName || "-", lines: [receipt?.property?.propertyName ? `Property: ${receipt.property.propertyName}` : ""] }],
      details: [
        ["Payment method", String(receipt?.paymentMethod || "-").replace(/_/g, " ")],
        ["Reference", receipt?.referenceNumber || "-"],
        ["Cashbook", receipt?.cashbook || "-"],
      ],
      table: {
        columns: [
          { label: "Description", value: () => receipt?.narration || categoryLabel },
          { label: "Category", value: () => categoryLabel },
          { label: "Amount (KES)", align: "right", value: () => money(receipt?.amount) },
        ],
        rows: [receipt],
      },
      totals: [{ label: "Total received", value: money(receipt?.amount), hero: true }],
      amountWords: { amount: receipt?.amount, currency: currentCompany?.baseCurrency || "KES" },
      signatures: [{ label: "Prepared by", name: preparedByName }, { label: "Verified by" }, { label: "Landlord / Received by" }],
      preparedBy: preparedByName,
    });
    if (!printed) toast.error("Pop-up blocked — allow pop-ups for this site to print");
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="no-print flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 p-2">
        <div className="mx-auto flex h-full w-full max-w-none min-h-0 flex-1 flex-col gap-2">
          <ListToolbar>
            <div className="relative shrink-0">
              <FaSearch className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[8px] text-slate-400" />
              <ListToolbar.Input value={filters.search} onChange={(e) => { setCurrentPage(1); setFilters((prev) => ({ ...prev, search: e.target.value })); }} placeholder="Search receipt, landlord…" width="w-36" className="pl-5" />
            </div>
            <AppSelect
              value={filters.status}
              onChange={(v) => { setCurrentPage(1); setFilters((prev) => ({ ...prev, status: v ?? "" })); }}
              options={[
                { value: "draft", label: "Draft" },
                { value: "posted", label: "Posted" },
                { value: "reversed", label: "Reversed" },
              ]}
              placeholder="All Statuses"
              clearable
              compact
            />
            <AppSelect
              value={filters.category}
              onChange={(v) => { setCurrentPage(1); setFilters((prev) => ({ ...prev, category: v ?? "" })); }}
              options={CATEGORY_OPTIONS}
              placeholder="All Categories"
              clearable
              compact
            />
            <AppSelect
              value={filters.landlord}
              onChange={(v) => { setCurrentPage(1); setFilters((prev) => ({ ...prev, landlord: v ?? "" })); }}
              options={activeLandlordOptions}
              placeholder="All Landlords"
              searchable
              clearable
              compact
            />
            <AppSelect
              value={filters.property}
              onChange={(v) => { setCurrentPage(1); setFilters((prev) => ({ ...prev, property: v ?? "" })); }}
              options={landlordPropertyOptions}
              placeholder="All Properties"
              searchable
              clearable
              compact
            />

            <ListToolbar.Divider />
            <ListToolbar.Button icon={FaPrint} variant="outline" onClick={handlePrintList}>Print</ListToolbar.Button>
            <ListToolbar.Button icon={FaDownload} variant="outline" onClick={handleExportCsv}>Export</ListToolbar.Button>
            <ListToolbar.Button icon={FaRedoAlt} variant="outline" onClick={loadData}>Refresh</ListToolbar.Button>
            <ListToolbar.Divider />
            <ListToolbar.Button icon={FaPlus} disabled={!canCreate} onClick={openCreateModal}>Add Receipt</ListToolbar.Button>
          </ListToolbar>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-slate-200 bg-white shadow-lg">
            <MilikTable
              columns={[
                { label: "Date" },
                { label: "Receipt No" },
                { label: "Landlord" },
                { label: "Property" },
                { label: "Category" },
                { label: "Amount", align: "right" },
                { label: "Status" },
              ]}
              rows={receipts}
              rowKey="_id"
              loading={isLoading && receipts.length === 0}
              empty="No landlord receipts found for the selected filters."
              minWidth="1180px"
              renderRow={(row) => (
                <>
                  <td className="px-3 py-1.5 border-r border-gray-100 font-semibold text-slate-700 whitespace-nowrap">{fmtDate(row.receiptDate)}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 font-bold text-blue-700 whitespace-nowrap">{row.receiptNumber || "-"}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-slate-700">
                    <span className="font-semibold text-slate-900">{row?.landlord?.landlordName || "-"}</span>
                    {row?.landlord?.landlordCode && <span className="ml-1.5 font-normal text-slate-500">· {row.landlord.landlordCode}</span>}
                  </td>
                  <td className="px-3 py-1.5 border-r border-gray-100 font-semibold text-slate-900">{row?.property?.propertyName || "-"}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-slate-700">{CATEGORY_OPTIONS.find((item) => item.value === row?.category)?.label || row?.category || "-"}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-right font-bold text-slate-900 tabular-nums">{formatMoney(row?.amount || 0)}</td>
                  <td className="px-3 py-1.5">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase border ${row?.status === "posted" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : row?.status === "reversed" ? "bg-rose-50 text-rose-700 border-rose-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>
                      {row?.status || "draft"}
                    </span>
                  </td>
                </>
              )}
              renderActions={(row) => (
                <div className="inline-flex flex-wrap justify-end gap-1">
                  <button type="button" onClick={() => { setActiveReceipt(row); setShowDetailModal(true); }} className="px-2 py-1 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50" title="View"><FaEye size={11} /></button>
                  <button type="button" onClick={() => handlePrint(row)} className="px-2 py-1 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50" title="Print"><FaPrint size={11} /></button>
                  {row?.status === "draft" && (
                    <>
                      {canCreate && <button type="button" onClick={() => openEditModal(row)} className="px-2 py-1 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50" title="Edit"><FaEdit size={11} /></button>}
                      {canCreate && <button type="button" onClick={() => handlePost(row)} className="px-2 py-1 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50" title="Post"><FaCheck size={11} /></button>}
                      {canCreate && <button type="button" onClick={() => handleDelete(row)} className="px-2 py-1 border border-red-300 bg-white text-red-600 hover:bg-red-50" title="Delete"><FaTrash size={11} /></button>}
                    </>
                  )}
                  {row?.status === "posted" && (
                    canReverse && <button type="button" onClick={() => handleReverse(row)} className="px-2 py-1 border border-red-300 bg-white text-red-600 hover:bg-red-50" title="Reverse"><FaUndo size={11} /></button>
                  )}
                </div>
              )}
            />

            <PaginationBar
              page={currentPage}
              pages={totalPages}
              total={totalReceipts}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={(n) => { setPageSize(n); setCurrentPage(1); }}
              loading={isLoading}
              label="receipts"
            />
          </div>
        </div>
      </div>

      {showFormModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 p-4">
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">
            <div className="flex flex-shrink-0 items-center justify-between bg-[#0B3B2E] px-4 py-3 text-white">
              <h2 className="text-sm font-black uppercase tracking-wide">{editingReceiptId ? "Edit Landlord Receipt" : "Add Landlord Receipt"}</h2>
              <button type="button" onClick={() => setShowFormModal(false)} className="text-white/70 transition-colors hover:text-white"><FaTimes size={14} /></button>
            </div>
            <div className="flex-1 space-y-2.5 overflow-y-auto bg-white px-5 py-4">
              <FormSection title="Receipt Details">
                <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                  <div>
                    <label className={formLabelClass}>Property <span className="font-normal text-red-500">*</span></label>
                    <AppSelect
                      value={formData.property}
                      onChange={(v) => setFormData((prev) => ({ ...prev, property: v ?? "" }))}
                      options={landlordPropertyOptions}
                      placeholder="Select property…"
                      searchable
                      size="sm"
                    />
                  </div>
                  <div>
                    <label className={formLabelClass}>Landlord</label>
                    <input
                      type="text"
                      readOnly
                      value={resolvedFormLandlord?.name || ""}
                      className={`${formInputClass} bg-slate-50 text-slate-600`}
                      placeholder={formData.property ? "No landlord linked to selected property" : "Select property first"}
                    />
                  </div>
                  <div>
                    <label className={formLabelClass}>Receipt date <span className="font-normal text-red-500">*</span></label>
                    <input type="date" value={formData.receiptDate} onChange={(e) => setFormData((prev) => ({ ...prev, receiptDate: e.target.value }))} className={formInputClass} />
                  </div>
                  <div>
                    <label className={formLabelClass}>Amount <span className="font-normal text-red-500">*</span></label>
                    <input type="number" min="0" step="0.01" value={formData.amount} onChange={(e) => setFormData((prev) => ({ ...prev, amount: e.target.value }))} className={formInputClass} />
                  </div>
                  <div className="col-span-2">
                    <label className={formLabelClass}>Receipt category</label>
                    <AppSelect
                      value={formData.category || null}
                      onChange={(v) => setFormData((prev) => ({ ...prev, category: v ?? "owner_float", linkedDocumentType: "", linkedDocumentId: "", linkedDocumentRef: "" }))}
                      options={CATEGORY_OPTIONS}
                      size="sm"
                    />
                    <p className="mt-0.5 text-[10px] text-slate-500">Posting rule: Dr selected cashbook, {CATEGORY_OPTIONS.find((item) => item.value === formData.category)?.accountHint || "controlled category account"}.</p>
                  </div>
                  <div>
                    <label className={formLabelClass}>Payment method</label>
                    <AppSelect
                      value={formData.paymentMethod || null}
                      onChange={(v) => setFormData((prev) => ({ ...prev, paymentMethod: v ?? "bank_transfer" }))}
                      options={PAYMENT_METHOD_OPTIONS}
                      size="sm"
                    />
                  </div>
                  <div>
                    <label className={formLabelClass}>Cashbook</label>
                    <AppSelect
                      value={formData.cashbook || null}
                      onChange={(v) => setFormData((prev) => ({ ...prev, cashbook: v ?? "" }))}
                      options={cashbookOptions}
                      placeholder="Select cashbook…"
                      searchable
                      clearable
                      size="sm"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className={formLabelClass}>Reference number</label>
                    <input type="text" value={formData.referenceNumber} onChange={(e) => setFormData((prev) => ({ ...prev, referenceNumber: e.target.value }))} className={formInputClass} placeholder="Bank ref / M-Pesa code / cheque no" />
                  </div>
                </div>
              </FormSection>

              <FormSection title="Linking & Notes">
                <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                  {formData.category === "advance_settlement" ? (
                    <div className="col-span-2">
                      <label className={formLabelClass}>
                        Advancement to settle <span className="font-normal text-slate-400">(select the advance this receipt clears)</span>
                      </label>
                      {advancements.length === 0 ? (
                        <p className="border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
                          No disbursed advancements found for this property. Select a property with active advancements first.
                        </p>
                      ) : (
                        <AppSelect
                          value={formData.linkedDocumentId}
                          onChange={(v) => {
                            const adv = advancements.find((a) => String(a._id) === v);
                            setFormData((prev) => ({
                              ...prev,
                              linkedDocumentType: "landlord_advancement",
                              linkedDocumentId: v ?? "",
                              linkedDocumentRef: adv?.referenceNo || "",
                              amount: adv ? String(Number(adv.balanceOutstanding || 0)) : prev.amount,
                            }));
                          }}
                          options={advancements.map((adv) => ({ value: adv._id, label: `${adv.referenceNo} — ${adv.title} — Balance: KES ${Number(adv.balanceOutstanding || 0).toLocaleString()}` }))}
                          placeholder="— Select advancement —"
                          searchable
                          clearable
                          size="sm"
                        />
                      )}
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className={formLabelClass}>Linked document type</label>
                        <AppSelect
                          value={formData.linkedDocumentType || null}
                          onChange={(v) => setFormData((prev) => ({ ...prev, linkedDocumentType: v ?? "" }))}
                          options={LINKED_DOCUMENT_OPTIONS.filter((o) => o.value !== "")}
                          placeholder="None"
                          clearable
                          size="sm"
                        />
                      </div>
                      <div>
                        <label className={formLabelClass}>Linked document ID</label>
                        <input type="text" value={formData.linkedDocumentId} onChange={(e) => setFormData((prev) => ({ ...prev, linkedDocumentId: e.target.value }))} className={formInputClass} placeholder="Optional internal document id" />
                      </div>
                      <div className="col-span-2">
                        <label className={formLabelClass}>Linked document reference</label>
                        <input type="text" value={formData.linkedDocumentRef} onChange={(e) => setFormData((prev) => ({ ...prev, linkedDocumentRef: e.target.value }))} className={formInputClass} placeholder="Statement no / voucher no / manual ref" />
                      </div>
                    </>
                  )}
                  <div className="col-span-2">
                    <label className={formLabelClass}>Narration</label>
                    <textarea rows={3} value={formData.narration} onChange={(e) => setFormData((prev) => ({ ...prev, narration: e.target.value }))} className="w-full resize-none border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" placeholder="Explain why this money was received from the landlord" />
                  </div>
                </div>
              </FormSection>
            </div>
            <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <button type="button" onClick={() => setShowFormModal(false)} className="h-8 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={handleSave} disabled={saving} className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-black text-white hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60">
                <FaPlus size={11} /> {saving ? "Saving…" : editingReceiptId ? "Update Draft" : "Save Draft"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDetailModal && activeReceipt && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 p-4">
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">
            <div className="flex flex-shrink-0 items-center justify-between bg-[#0B3B2E] px-4 py-3 text-white">
              <h2 className="text-sm font-black uppercase tracking-wide">Landlord Receipt — {activeReceipt?.receiptNumber || "Receipt"}</h2>
              <button type="button" onClick={() => setShowDetailModal(false)} className="text-white/70 transition-colors hover:text-white"><FaTimes size={14} /></button>
            </div>
            <div className="flex-1 space-y-2.5 overflow-y-auto bg-white px-5 py-4">
              <FormSection title="Landlord & Property">
                <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-xs">
                  <div><span className="font-bold text-slate-900">Landlord:</span> <span className="text-slate-600">{activeReceipt?.landlord?.landlordName || "-"} {activeReceipt?.landlord?.landlordCode ? `(${activeReceipt.landlord.landlordCode})` : ""}</span></div>
                  <div><span className="font-bold text-slate-900">Property:</span> <span className="text-slate-600">{activeReceipt?.property?.propertyName || "-"} {activeReceipt?.property?.propertyCode ? `(${activeReceipt.property.propertyCode})` : ""}</span></div>
                  <div><span className="font-bold text-slate-900">Status:</span> <span className="text-slate-600">{String(activeReceipt?.status || "draft").toUpperCase()}</span></div>
                  <div><span className="font-bold text-slate-900">Date:</span> <span className="text-slate-600">{fmtDate(activeReceipt?.receiptDate)}</span></div>
                  <div><span className="font-bold text-slate-900">Amount:</span> <span className="text-slate-600">{formatMoney(activeReceipt?.amount || 0)}</span></div>
                  <div><span className="font-bold text-slate-900">Reference:</span> <span className="text-slate-600">{activeReceipt?.referenceNumber || "-"}</span></div>
                </div>
              </FormSection>

              <FormSection title="Controlled Posting">
                <div className="grid grid-cols-2 gap-3">
                  <div className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                    <div className="mb-0.5 font-black uppercase tracking-wide">Debit leg</div>
                    Dr {activeReceipt?.cashbook || "Selected cashbook"}
                  </div>
                  <div className="border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800">
                    <div className="mb-0.5 font-black uppercase tracking-wide">Credit leg</div>
                    {CATEGORY_OPTIONS.find((item) => item.value === activeReceipt?.category)?.accountHint || "Controlled category account"}
                  </div>
                </div>
              </FormSection>

              <FormSection title="Audit & Linked Document">
                <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-xs">
                  <div><span className="font-bold text-slate-900">Created by:</span> <span className="text-slate-600">{actorName(activeReceipt?.createdBy)}</span></div>
                  <div><span className="font-bold text-slate-900">Posted by:</span> <span className="text-slate-600">{actorName(activeReceipt?.postedBy)}</span></div>
                  <div><span className="font-bold text-slate-900">Reversed by:</span> <span className="text-slate-600">{actorName(activeReceipt?.reversedBy)}</span></div>
                  <div><span className="font-bold text-slate-900">Linked type:</span> <span className="text-slate-600">{activeReceipt?.linkedDocumentType || "-"}</span></div>
                  <div><span className="font-bold text-slate-900">Linked ref:</span> <span className="text-slate-600">{activeReceipt?.linkedDocumentRef || activeReceipt?.linkedDocumentId || "-"}</span></div>
                </div>
              </FormSection>

              <FormSection title="Narration">
                <p className="text-xs leading-5 text-slate-700">{activeReceipt?.narration || "No narration provided."}</p>
              </FormSection>
            </div>
            <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <button type="button" onClick={() => handlePrint(activeReceipt)} className="inline-flex h-8 items-center gap-1.5 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"><FaPrint size={11} /> Print</button>
              {activeReceipt?.status === "draft" && canCreate && (
                <>
                  <button type="button" onClick={() => { setShowDetailModal(false); openEditModal(activeReceipt); }} className="inline-flex h-8 items-center gap-1.5 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"><FaEdit size={11} /> Edit Draft</button>
                  <button type="button" onClick={() => { setShowDetailModal(false); handlePost(activeReceipt); }} className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-3 text-xs font-black text-white hover:bg-[#0A3127]"><FaCheck size={11} /> Post</button>
                </>
              )}
              {activeReceipt?.status === "posted" && canReverse && (
                <button type="button" onClick={() => { setShowDetailModal(false); handleReverse(activeReceipt); }} className="inline-flex h-8 items-center gap-1.5 border border-red-300 bg-white px-3 text-xs font-bold text-red-600 hover:bg-red-50"><FaUndo size={11} /> Reverse</button>
              )}
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};
export default LandlordReceipts;