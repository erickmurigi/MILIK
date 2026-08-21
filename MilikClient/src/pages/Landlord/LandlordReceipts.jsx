import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEntityCache } from "../../hooks/useEntityCache";
import useDebounce from "../../hooks/useDebounce";
import { useTabState } from "../../hooks/useTabState";
import { useDispatch, useSelector } from "react-redux";
import {
  FaArrowLeft,
  FaCheck,
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

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";
const MILIK_ORANGE = "bg-[#FF8C00]";
const MILIK_ORANGE_HOVER = "hover:bg-[#e67e00]";
import PaginationBar from "../../components/PaginationBar";

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

  const landlordPropertyOptions = useMemo(() => activeProperties, [activeProperties]);

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

  const stats = useMemo(() => {
    const total = receipts.reduce((sum, row) => sum + Number(row?.amount || 0), 0);
    const posted = receipts.filter((row) => row?.status === "posted").reduce((sum, row) => sum + Number(row?.amount || 0), 0);
    const draft = receipts.filter((row) => row?.status === "draft").reduce((sum, row) => sum + Number(row?.amount || 0), 0);
    return {
      count: totalReceipts,
      posted,
      draft,
    };
  }, [receipts, totalReceipts]);

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
    const esc = (v) => String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const fmtAmt = (n) => `KES ${Number(n||0).toLocaleString("en-KE",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
    const co = currentCompany || {};
    const coName = esc(co.companyName || co.name || "MILIK");
    const coPhone = esc(co.phone || co.phoneNo || co.phoneNumber || co.contactPhone || "");
    const coEmail = esc(co.email || co.companyEmail || co.contactEmail || "");
    const coAddr = esc([co.address || co.postalAddress || co.location || "", co.town || co.city || ""].filter(Boolean).join(", "));
    const coSub = [coAddr, coPhone, coEmail].filter(Boolean).join(" · ");
    const logoHtml = co.logo
      ? `<img src="${esc(co.logo)}" style="max-height:60px;max-width:150px;object-fit:contain;border-radius:6px;" alt="logo"/>`
      : `<div style="width:56px;height:56px;border-radius:10px;background:#0B3B2E;color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:900;">${coName.slice(0,1)}</div>`;
    const categoryLabel = CATEGORY_OPTIONS.find((item) => item.value === receipt?.category)?.label || receipt?.category || "-";
    const statusColor = { draft:"#d97706", posted:"#16a34a", reversed:"#dc2626" }[receipt?.status] || "#475569";
    const statusBgColor = { draft:"#fef3c7", posted:"#dcfce7", reversed:"#fee2e2" }[receipt?.status] || "#f1f5f9";
    const preparedByName = [currentUser?.otherNames, currentUser?.surname].filter(Boolean).join(' ') || currentUser?.email || 'Milik Admin';

    const printWindow = window.open("", "_blank", "width=900,height=720");
    if (!printWindow) { toast.error("Unable to open print window."); return; }

    printWindow.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Landlord Receipt ${esc(receipt?.receiptNumber || "")}</title>
  <style>
    @page { size:A4; margin:14mm 16mm; }
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Helvetica Neue',Arial,sans-serif;font-size:13px;color:#0f172a;background:#fff}
    .header{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding-bottom:16px;gap:16px}
    .co-center{text-align:center;display:flex;flex-direction:column;align-items:center;gap:6px}
    .co-center-name{font-size:18px;font-weight:900;color:#0f172a;letter-spacing:-0.01em;margin-top:6px}
    .co-center-sub{font-size:10px;color:#64748b;line-height:1.6}
    .doc-title{text-align:right;align-self:center}
    .doc-label{font-size:34px;font-weight:900;color:#0f172a;letter-spacing:-0.03em;line-height:1}
    .doc-number{font-size:14px;color:#64748b;margin-top:6px}
    .divider{height:2px;background:linear-gradient(90deg,#0B3B2E,#E65F1A);border-radius:2px;margin:16px 0 20px}
    .body-grid{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-bottom:20px}
    .sec-label{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.18em;color:#94a3b8;margin-bottom:12px}
    .fk{font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;margin-top:8px}
    .fv{font-size:13px;font-weight:700;color:#0f172a}
    .fv.lg{font-size:16px;font-weight:800}
    .status-badge{display:inline-block;padding:4px 14px;border-radius:6px;font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:18px}
    .amount-row{display:flex;justify-content:flex-end;margin-bottom:20px}
    .amount-box{text-align:right}
    .amount-label{font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;margin-bottom:4px}
    .amount-value{font-size:28px;font-weight:900;color:#0f172a;letter-spacing:-0.02em}
    table{width:100%;border-collapse:collapse;margin-bottom:16px}
    thead tr{background:#1e293b;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    th{padding:10px 14px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#fff}
    th.r{text-align:right}
    tbody tr{border-bottom:1px solid #f1f5f9}
    td{padding:11px 14px;font-size:13px;color:#0f172a}
    td.r{text-align:right;font-weight:600}
    .sig-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;padding-top:20px;border-top:1px solid #e2e8f0;margin-top:28px}
    .sig-block{text-align:center}
    .sig-line{height:40px;border-bottom:1px solid #94a3b8;margin-bottom:6px;display:flex;align-items:flex-end;justify-content:center;padding-bottom:3px}
    .sig-role{font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.12em}
    .footer-note{margin-top:18px;padding-top:12px;border-top:1px solid #f1f5f9;font-size:11px;color:#94a3b8}
  </style>
</head>
<body>
  <div class="header">
    <div></div>
    <div class="co-center">
      ${logoHtml}
      <div class="co-center-name">${coName}</div>
      ${coSub ? `<div class="co-center-sub">${coSub}</div>` : ""}
    </div>
    <div class="doc-title">
      <div class="doc-label">RECEIPT</div>
      <div class="doc-number"># ${esc(receipt?.receiptNumber || "-")}</div>
    </div>
  </div>

  <div class="divider"></div>

  <div class="body-grid">
    <div>
      <div class="sec-label">Received From</div>
      <div class="fk">Landlord</div>
      <div class="fv lg">${esc(receipt?.landlord?.landlordName || "-")}</div>
      <div class="fk">Property</div>
      <div class="fv">${esc(receipt?.property?.propertyName || "-")}</div>
    </div>
    <div>
      <div class="sec-label">Receipt Details</div>
      <div class="fk">Receipt Date</div>
      <div class="fv">${esc(fmtDate(receipt?.receiptDate))}</div>
      <div class="fk">Payment Method</div>
      <div class="fv">${esc(String(receipt?.paymentMethod || "-").replace(/_/g," "))}</div>
      <div class="fk">Reference</div>
      <div class="fv">${esc(receipt?.referenceNumber || "-")}</div>
      <div class="fk">Cashbook</div>
      <div class="fv">${esc(receipt?.cashbook || "-")}</div>
    </div>
  </div>

  <span class="status-badge" style="background:${statusBgColor};color:${statusColor};">${esc(String(receipt?.status || "Draft").replace(/_/g," ").toUpperCase())}</span>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th>Category</th>
        <th class="r">Amount (KES)</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${esc(receipt?.narration || categoryLabel)}</td>
        <td>${esc(categoryLabel)}</td>
        <td class="r">${fmtAmt(receipt?.amount)}</td>
      </tr>
    </tbody>
  </table>

  <div style="display:flex;justify-content:flex-end;margin-bottom:20px">
    <div style="width:260px;border-top:2px solid #0f172a;padding-top:12px">
      <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:800;color:#0f172a">
        <span>Total Received</span><span>${fmtAmt(receipt?.amount)}</span>
      </div>
    </div>
  </div>

  <div class="sig-grid">
    <div class="sig-block">
      <div class="sig-line"><span style="font-size:11px;font-weight:700;color:#0f172a">${esc(preparedByName)}</span></div>
      <div class="sig-role">Prepared By</div>
    </div>
    <div class="sig-block">
      <div class="sig-line"></div>
      <div class="sig-role">Verified By</div>
    </div>
    <div class="sig-block">
      <div class="sig-line"></div>
      <div class="sig-role">Landlord / Received By</div>
    </div>
  </div>

  <div class="footer-note">
    Official landlord receipt generated by ${coName} · Milik Property Management System · ${esc(new Date().toLocaleString())}
  </div>
</body>
</html>`);
    printWindow.document.close();
    setTimeout(() => { printWindow.focus(); printWindow.print(); }, 450);
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="no-print flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 p-2">
        <div className="mx-auto flex h-full w-full max-w-none min-h-0 flex-1 flex-col gap-2">
          <div className="flex-none sticky top-0 z-20 border-b border-gray-200 bg-white shadow-sm">
            <div className="filter-bar flex items-center gap-0.5 overflow-x-auto px-2 py-1">
              <label className="relative shrink-0">
                <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400"><FaSearch /></span>
                <input value={filters.search} onChange={(e) => { setCurrentPage(1); setFilters((prev) => ({ ...prev, search: e.target.value })); }} placeholder="Search receipt, landlord…" className="h-[20px] w-36 border border-slate-200 bg-white pl-6 pr-1 text-[9px] outline-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
              </label>
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
                options={activeLandlords.map((l) => ({ value: l._id, label: l.landlordName }))}
                placeholder="All Landlords"
                searchable
                clearable
                compact
              />

              <div className="mx-1 h-3 w-px shrink-0 bg-slate-200" />
              <span className="shrink-0 border border-slate-200 bg-white px-1 py-0.5 text-[8px] font-bold text-slate-600">{totalReceipts} receipts</span>
              <span className="shrink-0 border border-emerald-200 bg-emerald-50 px-1 py-0.5 text-[8px] font-bold text-emerald-700">Posted: {formatMoney(stats.posted)}</span>
              <span className="shrink-0 border border-amber-200 bg-amber-50 px-1 py-0.5 text-[8px] font-bold text-amber-700">Draft: {formatMoney(stats.draft)}</span>
              <div className="mx-1 h-3 w-px shrink-0 bg-slate-200" />
              <button type="button" onClick={loadData} className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] font-semibold text-white ${MILIK_ORANGE} ${MILIK_ORANGE_HOVER}`}><FaRedoAlt size={7} /> Refresh</button>
              <button type="button" onClick={openCreateModal} disabled={!canCreate} className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300 ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}><FaPlus size={7} /> Add Receipt</button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="min-w-[1180px] w-full text-[11px] border-collapse">
                <thead className="sticky top-0 z-10 shadow-sm">
                  <tr className={`${MILIK_GREEN} text-white`}>
                    {["Date", "Receipt No", "Landlord", "Property", "Category", "Amount", "Status", "Actions"].map((label) => (
                      <th key={label} className={`px-3 py-2 font-bold ${label === "Amount" || label === "Actions" ? "text-right" : "text-left"} ${label !== "Actions" ? "border-r border-white/10" : ""}`}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {receipts.map((row, index) => (
                    <tr key={row._id} className={`border-b border-gray-100 transition-colors ${index % 2 === 0 ? "bg-white hover:bg-blue-50/40" : "bg-slate-50/60 hover:bg-blue-50/40"}`}>
                      <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-700">{fmtDate(row.receiptDate)}</td>
                      <td className="px-3 py-1 border-r border-gray-100 font-bold text-blue-700">{row.receiptNumber || "-"}</td>
                      <td className="px-3 py-1 border-r border-gray-100 text-slate-700">
                        <div className="font-bold text-slate-900">{row?.landlord?.landlordName || "-"}</div>
                        <div className="text-[10px] text-slate-500">{row?.landlord?.landlordCode || ""}</div>
                      </td>
                      <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900">{row?.property?.propertyName || "-"}</td>
                      <td className="px-3 py-1 border-r border-gray-100 text-slate-700">{CATEGORY_OPTIONS.find((item) => item.value === row?.category)?.label || row?.category || "-"}</td>
                      <td className="px-3 py-1 border-r border-gray-100 text-right font-bold text-slate-900">{formatMoney(row?.amount || 0)}</td>
                      <td className="px-3 py-1 border-r border-gray-100">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase border ${row?.status === "posted" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : row?.status === "reversed" ? "bg-rose-50 text-rose-700 border-rose-200" : "bg-orange-50 text-orange-700 border-orange-200"}`}>
                          {row?.status || "draft"}
                        </span>
                      </td>
                      <td className="px-3 py-1 text-right">
                        <div className="inline-flex flex-wrap justify-end gap-1">
                          <button type="button" onClick={() => { setActiveReceipt(row); setShowDetailModal(true); }} className="rounded p-1 text-blue-600 hover:bg-blue-50 hover:text-blue-800" title="View"><FaEye size={12} /></button>
                          <button type="button" onClick={() => handlePrint(row)} className="rounded p-1 text-purple-600 hover:bg-purple-50 hover:text-purple-800" title="Print"><FaPrint size={12} /></button>
                          {row?.status === "draft" && (
                            <>
                              {canCreate && <button type="button" onClick={() => openEditModal(row)} className="rounded p-1 text-indigo-600 hover:bg-indigo-50 hover:text-indigo-800" title="Edit"><FaEdit size={12} /></button>}
                              {canCreate && <button type="button" onClick={() => handlePost(row)} className="rounded p-1 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-800" title="Post"><FaCheck size={12} /></button>}
                              {canCreate && <button type="button" onClick={() => handleDelete(row)} className="rounded p-1 text-red-600 hover:bg-red-50 hover:text-red-800" title="Delete"><FaTrash size={12} /></button>}
                            </>
                          )}
                          {row?.status === "posted" && (
                            canReverse && <button type="button" onClick={() => handleReverse(row)} className="rounded p-1 text-amber-600 hover:bg-amber-50 hover:text-amber-800" title="Reverse"><FaUndo size={12} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!isLoading && receipts.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-sm font-semibold text-slate-500">
                        No landlord receipts found for the selected filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

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
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between bg-[#0B3B2E] px-5 py-4 text-white rounded-t-2xl">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-200">Landlord Receipts</p>
                <h2 className="text-lg font-black">{editingReceiptId ? "Edit Landlord Receipt" : "Add Landlord Receipt"}</h2>
              </div>
              <button type="button" onClick={() => setShowFormModal(false)} className="rounded-full border border-white/30 p-2 hover:bg-white/10"><FaTimes /></button>
            </div>
            <div className="grid gap-3 px-5 py-4 md:grid-cols-2">
              <div>
                <span className="mb-0.5 block text-xs font-semibold text-slate-700">Property <span className="text-red-500">*</span></span>
                <AppSelect
                  value={formData.property}
                  onChange={(v) => setFormData((prev) => ({ ...prev, property: v ?? "" }))}
                  options={landlordPropertyOptions.map((p) => ({ value: p._id, label: p.propertyName }))}
                  placeholder="Select property…"
                  searchable
                  size="sm"
                />
              </div>
              <div>
                <span className="mb-0.5 block text-xs font-semibold text-slate-700">Landlord</span>
                <input
                  type="text"
                  readOnly
                  value={resolvedFormLandlord?.name || ""}
                  className="w-full rounded border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 outline-none disabled:cursor-not-allowed"
                  placeholder={formData.property ? "No landlord linked to selected property" : "Select property first"}
                />
                <p className="mt-0.5 text-[10px] text-slate-500">Auto-filled from the selected property.</p>
              </div>
              <div>
                <span className="mb-0.5 block text-xs font-semibold text-slate-700">Receipt date <span className="text-red-500">*</span></span>
                <input type="date" value={formData.receiptDate} onChange={(e) => setFormData((prev) => ({ ...prev, receiptDate: e.target.value }))} className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
              </div>
              <div>
                <span className="mb-0.5 block text-xs font-semibold text-slate-700">Amount <span className="text-red-500">*</span></span>
                <input type="number" min="0" step="0.01" value={formData.amount} onChange={(e) => setFormData((prev) => ({ ...prev, amount: e.target.value }))} className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
              </div>
              <div className="md:col-span-2">
                <span className="mb-0.5 block text-xs font-semibold text-slate-700">Receipt category</span>
                <AppSelect
                  value={formData.category || null}
                  onChange={(v) => setFormData((prev) => ({ ...prev, category: v ?? "owner_float", linkedDocumentType: "", linkedDocumentId: "", linkedDocumentRef: "" }))}
                  options={CATEGORY_OPTIONS}
                  size="sm"
                />
                <p className="mt-0.5 text-[10px] text-slate-500">Posting rule: Dr selected cashbook, {CATEGORY_OPTIONS.find((item) => item.value === formData.category)?.accountHint || "controlled category account"}.</p>
              </div>
              <div>
                <span className="mb-0.5 block text-xs font-semibold text-slate-700">Payment method</span>
                <AppSelect
                  value={formData.paymentMethod || null}
                  onChange={(v) => setFormData((prev) => ({ ...prev, paymentMethod: v ?? "bank_transfer" }))}
                  options={PAYMENT_METHOD_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                  size="sm"
                />
              </div>
              <div>
                <span className="mb-0.5 block text-xs font-semibold text-slate-700">Cashbook</span>
                <AppSelect
                  value={formData.cashbook || null}
                  onChange={(v) => setFormData((prev) => ({ ...prev, cashbook: v ?? "" }))}
                  options={cashbooks.map((account) => ({ value: account.name, label: account.name }))}
                  placeholder="Select cashbook…"
                  searchable
                  clearable
                  size="sm"
                />
              </div>
              <div>
                <span className="mb-0.5 block text-xs font-semibold text-slate-700">Reference number</span>
                <input type="text" value={formData.referenceNumber} onChange={(e) => setFormData((prev) => ({ ...prev, referenceNumber: e.target.value }))} className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" placeholder="Bank ref / M-Pesa code / cheque no" />
              </div>
              {formData.category === "advance_settlement" ? (
                <div className="md:col-span-2">
                  <span className="mb-0.5 block text-xs font-semibold text-slate-700">
                    Advancement to settle <span className="text-slate-400 font-normal">(select the advance this receipt clears)</span>
                  </span>
                  {advancements.length === 0 ? (
                    <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
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
                    <span className="mb-0.5 block text-xs font-semibold text-slate-700">Linked document type</span>
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
                    <span className="mb-0.5 block text-xs font-semibold text-slate-700">Linked document ID</span>
                    <input type="text" value={formData.linkedDocumentId} onChange={(e) => setFormData((prev) => ({ ...prev, linkedDocumentId: e.target.value }))} className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" placeholder="Optional internal document id" />
                  </div>
                  <div>
                    <span className="mb-0.5 block text-xs font-semibold text-slate-700">Linked document reference</span>
                    <input type="text" value={formData.linkedDocumentRef} onChange={(e) => setFormData((prev) => ({ ...prev, linkedDocumentRef: e.target.value }))} className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" placeholder="Statement no / voucher no / manual ref" />
                  </div>
                </>
              )}
              <div className="md:col-span-2">
                <span className="mb-0.5 block text-xs font-semibold text-slate-700">Narration</span>
                <textarea rows={3} value={formData.narration} onChange={(e) => setFormData((prev) => ({ ...prev, narration: e.target.value }))} className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" placeholder="Explain why this money was received from the landlord" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-5 py-4">
              <button type="button" onClick={() => setShowFormModal(false)} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={handleSave} disabled={saving} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-60 ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}>
                <FaPlus /> {saving ? "Saving..." : editingReceiptId ? "Update Draft" : "Save Draft"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDetailModal && activeReceipt && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
              <div>
                <h2 className="text-xl font-black text-slate-900">Landlord Receipt Details</h2>
                <p className="mt-1 text-sm text-slate-500">{activeReceipt?.receiptNumber || "Receipt"}</p>
              </div>
              <button type="button" onClick={() => setShowDetailModal(false)} className="rounded-2xl border border-slate-200 p-3 text-slate-500 hover:bg-slate-100"><FaTimes /></button>
            </div>
            <div className="space-y-5 px-6 py-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-500">Landlord</p>
                  <p className="mt-2 text-lg font-black text-slate-900">{activeReceipt?.landlord?.landlordName || "-"}</p>
                  <p className="mt-1 text-sm text-slate-600">{activeReceipt?.landlord?.landlordCode || "-"}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-500">Property</p>
                  <p className="mt-2 text-lg font-black text-slate-900">{activeReceipt?.property?.propertyName || "-"}</p>
                  <p className="mt-1 text-sm text-slate-600">{activeReceipt?.property?.propertyCode || "-"}</p>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-500">Receipt status</p>
                  <p className="mt-2 text-xl font-black text-slate-900">{String(activeReceipt?.status || "draft").toUpperCase()}</p>
                  <p className="mt-1 text-sm text-slate-500">Date: {fmtDate(activeReceipt?.receiptDate)}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-500">Amount</p>
                  <p className="mt-2 text-xl font-black text-slate-900">{formatMoney(activeReceipt?.amount || 0)}</p>
                  <p className="mt-1 text-sm text-slate-500">Reference: {activeReceipt?.referenceNumber || "-"}</p>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-500">Controlled posting meaning</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
                    <div className="mb-1 font-black">Debit leg</div>
                    Dr {activeReceipt?.cashbook || "Selected cashbook"}
                  </div>
                  <div className="rounded-2xl bg-slate-100 p-4 text-sm font-semibold text-slate-800">
                    <div className="mb-1 font-black">Credit leg</div>
                    {CATEGORY_OPTIONS.find((item) => item.value === activeReceipt?.category)?.accountHint || "Controlled category account"}
                  </div>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-500">Audit</p>
                  <div className="mt-3 space-y-2 text-sm text-slate-700">
                    <p><span className="font-black text-slate-900">Created by:</span> {actorName(activeReceipt?.createdBy)}</p>
                    <p><span className="font-black text-slate-900">Posted by:</span> {actorName(activeReceipt?.postedBy)}</p>
                    <p><span className="font-black text-slate-900">Reversed by:</span> {actorName(activeReceipt?.reversedBy)}</p>
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-500">Linked document</p>
                  <div className="mt-3 space-y-2 text-sm text-slate-700">
                    <p><span className="font-black text-slate-900">Type:</span> {activeReceipt?.linkedDocumentType || "-"}</p>
                    <p><span className="font-black text-slate-900">ID:</span> {activeReceipt?.linkedDocumentId || "-"}</p>
                    <p><span className="font-black text-slate-900">Reference:</span> {activeReceipt?.linkedDocumentRef || "-"}</p>
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-500">Narration</p>
                <p className="mt-3 text-sm leading-6 text-slate-700">{activeReceipt?.narration || "No narration provided."}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 px-6 py-5">
              <button type="button" onClick={() => handlePrint(activeReceipt)} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-700 hover:bg-slate-100"><FaPrint /> Print</button>
              {activeReceipt?.status === "draft" && canCreate && (
                <>
                  <button type="button" onClick={() => { setShowDetailModal(false); openEditModal(activeReceipt); }} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-700 hover:bg-slate-100"><FaEdit /> Edit Draft</button>
                  <button type="button" onClick={() => { setShowDetailModal(false); handlePost(activeReceipt); }} className={`inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-black text-white ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}><FaCheck /> Post</button>
                </>
              )}
              {activeReceipt?.status === "posted" && canReverse && (
                <button type="button" onClick={() => { setShowDetailModal(false); handleReverse(activeReceipt); }} className={`inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-black text-white ${MILIK_ORANGE} ${MILIK_ORANGE_HOVER}`}><FaUndo /> Reverse</button>
              )}
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};
export default LandlordReceipts;