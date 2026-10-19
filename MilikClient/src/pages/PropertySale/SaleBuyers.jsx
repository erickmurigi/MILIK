import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { FaBan, FaCheck, FaEdit, FaEnvelope, FaFileAlt, FaFileImport, FaHandshake, FaHistory, FaMoneyBillWave, FaPlus, FaPrint, FaRedoAlt, FaSms, FaTimes, FaTrash } from "react-icons/fa";
import ImportModal from "../../components/Modals/ImportModal";
import CwSmsModal from "../CarWash/CwSmsModal";
import SaleEmailModal from "./SaleEmailModal";
import { toast } from "react-toastify";
import { printDocument } from "../../utils/printKit";
import PropertySaleShell from "./PropertySaleShell";
import SaleFilterBar, { FilterSearch } from "./SaleFilterBar";
import PaginationBar from "../../components/PaginationBar";
import { saleApi } from "../../services/propertySaleApi";
import { fmtDate } from "../../utils/dates";
import { useConfirm } from "../../context/ConfirmContext";
import useDebounce from "../../hooks/useDebounce";
import { useTabState } from "../../hooks/useTabState";
import AppSelect from "../../components/common/AppSelect";
import Modal from "../../components/common/Modal";
import MilikTable from "../../components/common/MilikTable";
import ListToolbar from "../../components/common/ListToolbar";
import { useTerms } from "../../hooks/useTerm";
import useSalePhotoDraft from "../../hooks/useSalePhotoDraft";
import SaleDocumentsField from "./SaleDocumentsField";
import SalePrintButton from "./SalePrintButton";
import SaleExportButton from "./SaleExportButton";
import { exportAfterFetch, fetchAllPages, printAfterFetch } from "./salePrint";

// Local override, not the shared utils/formStyles.js — that file's labelClass/inputClass predate the
// bold-value-matches-label-weight convention now standard across PropertySale forms (see
// SaleActivityFormModal.jsx / AppSelect.jsx's label and selected-value weight).
const labelClass = "mb-1 block text-xs font-bold text-slate-900";
const inputClass = "w-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-900 placeholder:font-normal placeholder:text-slate-400 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";
const textareaClass = "w-full border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:border-[#0B3B2E] focus:outline-none";
const Required = () => <span className="ml-0.5 font-black text-red-600">*</span>;

const SOURCES      = ["walk_in", "referral", "online", "social_media", "agent", "cold_call", "other"];
const KYC_STATUSES = ["pending", "verified", "rejected"];
// Lazy-load the xlsx-backed helpers only when the Import modal is actually used.
const parseSaleBuyersExcel = (file) => import("../../utils/excelTemplates").then((m) => m.parseSaleBuyersExcel(file));
const downloadSaleBuyersTemplate = () => import("../../utils/excelTemplates").then((m) => m.downloadSaleBuyersTemplate());

const PAGE_SIZE    = 50;

const kycBadge = (s) => ({
  pending:  "border-amber-200 bg-amber-50 text-amber-700",
  verified: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rejected: "border-rose-200 bg-rose-50 text-rose-700",
}[s] || "border-slate-200 bg-slate-50 text-slate-600");

const blankForm = {
  fullName: "", idNumber: "", phone: "", email: "",
  address: "", nationality: "Kenyan", source: "walk_in",
  kycStatus: "pending", kycDocuments: [], notes: "",
};


// "walk_in" -> "Walk In" (matches the placeholder catalog's examples)
const humanize = (v) => String(v ?? "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const fmtKES = (n) => Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 0 });

const KYC_FILTER_OPTIONS    = KYC_STATUSES.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }));
const SOURCE_FILTER_OPTIONS = SOURCES.map((s) => ({ value: s, label: s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) }));
const SOURCE_FORM_OPTIONS   = SOURCES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }));
const KYC_FORM_OPTIONS      = KYC_STATUSES.map((s) => ({ value: s, label: s }));
const buyerColumns = (T) => [
  { label: `${T.saleBuyer} No.`, width: "10%" },
  { label: "Name", width: "22%" },
  { label: "ID / Passport", width: "13%" },
  { label: "Phone", width: "14%" },
  { label: "Email", width: "19%" },
  { label: "Source", width: "11%" },
  { label: "KYC", width: "9%" },
];

// Module scope so MilikTable's React.memo isn't defeated by a fresh function identity each parent render.
const renderBuyerRow = (row) => (
  <>
    <td className="px-3 py-1.5 border-r border-gray-100 font-mono font-black text-[#0B3B2E]">{row.buyerNumber}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 font-bold text-slate-900 truncate">{row.fullName}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 font-mono text-slate-600">{row.idNumber || "—"}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600">{row.phone || "—"}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600">{row.email || "—"}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 capitalize text-slate-600">{String(row.source || "").replace(/_/g, " ")}</td>
    <td className="px-3 py-1.5">
      <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${kycBadge(row.kycStatus)}`}>{row.kycStatus}</span>
    </td>
  </>
);

// Modals / inputs below own their own text state so keystrokes never re-render the page, rows or detail panel.

function BuyerFormModal({ editingId, initial, saving, invalidate, onClose, onSubmit }) {
  const T = useTerms("saleBuyer");
  const [form, setForm] = useState(initial);
  const f = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }));

  // Real uploaded KYC files — only once the buyer exists (editingId), since there's nowhere to stage
  // an upload-on-create for this modal (it hands off to the parent's own createBuyer/updateBuyer, not a
  // self-contained save like the Listing/Project forms). The legacy free-text kycDocuments labels below
  // still display read-only, for buyers that already have them, but new entries always go through here.
  const docs = useSalePhotoDraft({
    entityId: editingId,
    initialImages: initial.kycFiles || [],
    upload: saleApi.uploadBuyerDocuments,
    remove: saleApi.deleteBuyerDocument,
    onChanged: invalidate,
    itemLabel: "document",
    responseKey: "documents",
    fieldName: "documents",
  });

  return (
    <Modal
      title={editingId ? `Edit ${T.saleBuyer}` : `Register ${T.saleBuyer}`}
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={() => onSubmit(form)} disabled={saving} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
            {saving ? "Saving…" : editingId ? `Update ${T.saleBuyer}` : `Register ${T.saleBuyer}`}
          </button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className={labelClass}>Full Name<Required /></label>
          <input value={form.fullName} onChange={f("fullName")} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>National ID / Passport</label>
          <input value={form.idNumber} onChange={f("idNumber")} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Phone</label>
          <input value={form.phone} onChange={f("phone")} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Email</label>
          <input type="email" value={form.email} onChange={f("email")} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Nationality</label>
          <input value={form.nationality} onChange={f("nationality")} className={inputClass} />
        </div>
        <div>
          <AppSelect label="Source" value={form.source} onChange={(v) => setForm((p) => ({ ...p, source: v ?? "" }))} options={SOURCE_FORM_OPTIONS} size="md" />
        </div>
        <div>
          <AppSelect label="KYC Status" value={form.kycStatus} onChange={(v) => setForm((p) => ({ ...p, kycStatus: v ?? "" }))} options={KYC_FORM_OPTIONS} size="md" />
        </div>
        <div className="md:col-span-2">
          <label className={labelClass}>Address</label>
          <input value={form.address} onChange={f("address")} className={inputClass} />
        </div>
        <div className="md:col-span-2">
          {form.kycDocuments.length > 0 && (
            <div className="mb-2">
              <label className={labelClass}>Legacy KYC References</label>
              <p className="mb-1 text-[10px] text-slate-400">Text labels recorded before file upload was added — no file is attached to these.</p>
              <div className="space-y-1">
                {form.kycDocuments.map((doc, idx) => (
                  <div key={idx} className="flex items-center gap-2 border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                    <FaFileAlt size={9} className="flex-shrink-0 text-slate-400" />
                    <span className="flex-1 min-w-0 truncate text-xs text-slate-600">{doc}</span>
                    <button
                      type="button"
                      onClick={() => setForm((p) => ({ ...p, kycDocuments: p.kycDocuments.filter((_, i) => i !== idx) }))}
                      className="text-rose-400 hover:text-rose-600"
                    >
                      <FaTimes size={9} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {editingId ? (
            <SaleDocumentsField docs={docs} hasRecord />
          ) : (
            <>
              <label className={labelClass}>KYC Documents</label>
              <p className="border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-[10px] text-slate-400">
                Save this {T.saleBuyer.toLowerCase()} first, then reopen Edit to upload KYC documents.
              </p>
            </>
          )}
        </div>
        <div className="md:col-span-2">
          <label className={labelClass}>Notes</label>
          <textarea rows={2} value={form.notes} onChange={f("notes")} className={textareaClass} />
        </div>
      </div>
    </Modal>
  );
}

function BuyerEmailModal({ target, company, sending, onSend, onClose }) {
  const [emailForm, setEmailForm] = useState({ subject: "", body: "" });
  const vars = useMemo(() => ({
    buyerName:   target.fullName    || "",
    buyerNumber: target.buyerNumber || "",
    phone:       target.phone       || "",
    email:       target.email       || "",
    idNumber:    target.idNumber    || "",
    kycStatus:   humanize(target.kycStatus),
    source:      humanize(target.source),
    registrationDate: target.createdAt ? fmtDate(target.createdAt) : "",
    companyName:  company?.companyName || company?.name || "",
    companyPhone: company?.phoneNo || company?.phone || company?.telephone || "",
    companyEmail: company?.email || company?.companyEmail || "",
  }), [target, company]);
  return (
    <SaleEmailModal
      title="Send Email"
      subtitle={`To: ${target.email}`}
      emailForm={emailForm}
      setEmailForm={setEmailForm}
      sending={sending}
      onSend={() => onSend(emailForm)}
      onClose={onClose}
      context="buyer"
      vars={vars}
    />
  );
}

// KYC documents section of the detail panel — `key={buyer._id}` at the call site forces a fresh
// useSalePhotoDraft instance (and thus fresh `saved` state) whenever the selected buyer changes, since
// this panel stays mounted across row clicks rather than remounting like the modal does.
function BuyerKycPanel({ buyer, kycSaving, onRemoveLegacyDoc, invalidate }) {
  const docs = useSalePhotoDraft({
    entityId: buyer._id,
    initialImages: buyer.kycFiles || [],
    upload: saleApi.uploadBuyerDocuments,
    remove: saleApi.deleteBuyerDocument,
    onChanged: invalidate,
    itemLabel: "document",
    responseKey: "documents",
    fieldName: "documents",
  });
  return (
    <div className="px-4 py-3">
      {(buyer.kycDocuments || []).length > 0 && (
        <div className="mb-3">
          <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-slate-400">Legacy KYC References</div>
          <div className="space-y-1">
            {buyer.kycDocuments.map((doc, idx) => (
              <div key={idx} className="flex items-center gap-2 border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                <FaFileAlt size={9} className="flex-shrink-0 text-slate-400" />
                <span className="flex-1 min-w-0 truncate text-xs text-slate-600" title={doc}>{doc}</span>
                <button type="button" onClick={() => onRemoveLegacyDoc(buyer, idx)} disabled={kycSaving} className="flex-shrink-0 p-0.5 text-rose-400 hover:text-rose-600 disabled:opacity-40">
                  <FaTimes size={9} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <SaleDocumentsField docs={docs} hasRecord />
    </div>
  );
}

const SaleBuyers = () => {
  const T              = useTerms("saleModule", "saleBuyer", "saleBuyers", "saleOffer", "saleOffers", "saleDeal", "saleDeals", "saleAgent");
  const confirm        = useConfirm();
  const queryClient    = useQueryClient();
  const currentCompany = useSelector((s) => s.company?.currentCompany);

  const [saving,        setSaving]        = useState(false);
  const [buyerModal,    setBuyerModal]    = useState(null);   // { editingId, initial } while the form is open
  const [showImportModal, setShowImportModal] = useState(false);
  const [selected,      setSelected]      = useTabState("/sale/buyers:selected", null);
  const [kycSaving,     setKycSaving]     = useState(false);
  const [smsTarget,     setSmsTarget]     = useState(null);
  const [smsSending,    setSmsSending]    = useState(false);
  const [emailTarget,   setEmailTarget]   = useState(null);
  const [emailSending,  setEmailSending]  = useState(false);
  const [search,        setSearch]        = useTabState("/sale/buyers:search", "");
  const debouncedSearch = useDebounce(search, 400);
  const [kycFilter,     setKycFilter]     = useTabState("/sale/buyers:kycFilter", "");
  const [sourceFilter,  setSourceFilter]  = useTabState("/sale/buyers:sourceFilter", "");
  const [page,          setPage]          = useTabState("/sale/buyers:page", 1);
  const [pageSize,      setPageSize]      = useTabState("/sale/buyers:pageSize", PAGE_SIZE);
  const [panelTab,      setPanelTab]      = useState("profile");

  const biz = currentCompany?._id;
  const BUYER_COLUMNS = useMemo(() => buyerColumns(T), [T]);

  const { data: buyersData, isLoading: loading, isFetching, error } = useQuery({
    queryKey: ["sale-buyers", biz, debouncedSearch, kycFilter, sourceFilter, page, pageSize],
    queryFn:  () => saleApi.listBuyers({ business: biz, search: debouncedSearch, kycStatus: kycFilter, source: sourceFilter, page, limit: pageSize }),
    enabled:  !!biz,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey?.[1] === biz ? prev : undefined),
    staleTime: 30_000,
  });

  useEffect(() => { if (error) toast.error(`Failed to load ${T.saleBuyers.toLowerCase()}`); }, [error, T.saleBuyers]);

  const buyers     = useMemo(() => buyersData?.data ?? [], [buyersData]);
  const total      = buyersData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const selectedId = selected?._id;

  const { data: buyerOffersData }    = useQuery({ queryKey: ["sale-buyer-offers",    biz, selectedId], queryFn: () => saleApi.listOffers({ business: biz, buyerId: selectedId, limit: 100 }), enabled: !!biz && !!selectedId, staleTime: 30_000 });
  const { data: buyerDealsData }     = useQuery({ queryKey: ["sale-buyer-deals",     biz, selectedId], queryFn: () => saleApi.listDeals({ business: biz, buyerId: selectedId, limit: 100 }), enabled: !!biz && !!selectedId, staleTime: 30_000 });
  const { data: buyerPaymentsData }  = useQuery({ queryKey: ["sale-buyer-payments",  biz, selectedId], queryFn: () => saleApi.listPayments({ business: biz, buyer: selectedId, limit: 100 }), enabled: !!biz && !!selectedId && panelTab === "payments", staleTime: 30_000 });
  const { data: buyerActivitiesData }= useQuery({ queryKey: ["sale-buyer-activities",biz, selectedId], queryFn: () => saleApi.listActivities({ business: biz, relatedBuyer: selectedId, limit: 100 }), enabled: !!biz && !!selectedId && panelTab === "activities", staleTime: 30_000 });

  const buyerOffers     = buyerOffersData?.data     ?? [];
  const buyerDeals      = buyerDealsData?.data      ?? [];
  const buyerPayments   = buyerPaymentsData?.data   ?? [];
  const buyerActivities = buyerActivitiesData?.data ?? [];

  // sync panel with fresh data after mutations; reset tab when buyer changes
  useEffect(() => {
    if (!selected) return;
    const updated = buyers.find((b) => b._id === selected._id);
    if (updated) setSelected(updated);
  }, [buyers]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setPanelTab("profile"); }, [selectedId]);

  const invalidate = useCallback(() => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["sale-buyers", biz] }),
    queryClient.invalidateQueries({ queryKey: ["sale-buyers-ref", biz] }),
  ]), [queryClient, biz]);

  const editingId = buyerModal?.editingId || "";
  const openCreate = () => setBuyerModal({ editingId: "", initial: blankForm });
  const openEdit   = useCallback((row) => {
    setBuyerModal({
      editingId: row._id,
      initial: {
        fullName:     row.fullName     || "",
        idNumber:     row.idNumber     || "",
        phone:        row.phone        || "",
        email:        row.email        || "",
        address:      row.address      || "",
        nationality:  row.nationality  || "Kenyan",
        source:       row.source       || "walk_in",
        kycStatus:    row.kycStatus    || "pending",
        kycDocuments: Array.isArray(row.kycDocuments) ? [...row.kycDocuments] : [],
        kycFiles:     Array.isArray(row.kycFiles) ? [...row.kycFiles] : [],
        notes:        row.notes        || "",
      },
    });
  }, []);

  const handleSave = async (form) => {
    if (!form.fullName.trim()) return toast.warning("Full name is required");
    setSaving(true);
    try {
      const payload = { ...form, business: biz };
      if (editingId) await saleApi.updateBuyer(editingId, payload);
      else await saleApi.createBuyer(payload);
      invalidate();
      setBuyerModal(null);
      toast.success(`${T.saleBuyer} ${editingId ? "updated" : "registered"}`);
    } catch (err) {
      toast.error(err?.response?.data?.message || `Failed to save ${T.saleBuyer.toLowerCase()}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = useCallback(async (row) => {
    if (!await confirm({ title: `Remove ${T.saleBuyer}`, message: `Remove "${row.fullName}"?`, confirmText: "Remove", isDangerous: true })) return;
    try {
      await saleApi.deleteBuyer(row._id);
      setSelected((prev) => (prev?._id === row._id ? null : prev));
      invalidate();
      toast.success(`${T.saleBuyer} removed`);
    } catch (err) {
      toast.error(err?.response?.data?.message || `Cannot delete this ${T.saleBuyer.toLowerCase()}`);
    }
  }, [confirm, invalidate, setSelected, T.saleBuyer]);

  const handleKycAction = async (buyer, newStatus) => {
    setKycSaving(true);
    try {
      await saleApi.updateBuyer(buyer._id, { kycStatus: newStatus, business: biz });
      invalidate();
      toast.success(`KYC set to ${newStatus}`);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to update KYC status");
    } finally {
      setKycSaving(false);
    }
  };

  const handleRemoveDoc = async (buyer, idx) => {
    setKycSaving(true);
    try {
      const docs = (buyer.kycDocuments || []).filter((_, i) => i !== idx);
      await saleApi.updateBuyer(buyer._id, { kycDocuments: docs, business: biz });
      invalidate();
      toast.success("Document removed");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to remove document");
    } finally {
      setKycSaving(false);
    }
  };

  const handleSendSms = async (phone, body) => {
    if (!smsTarget) return;
    setSmsSending(true);
    try {
      await saleApi.sendBuyerSms(smsTarget._id, { phone, body });
      toast.success("SMS sent");
      setSmsTarget(null);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to send SMS");
    } finally {
      setSmsSending(false);
    }
  };

  const handleSendEmail = async (emailForm) => {
    if (!emailTarget?.email) { toast.warn(`${T.saleBuyer} has no email address`); return; }
    if (!emailForm.subject.trim() || !emailForm.body.trim()) { toast.warn("Subject and message are required"); return; }
    setEmailSending(true);
    try {
      await saleApi.sendBuyerEmail(emailTarget._id, { to: emailTarget.email, ...emailForm });
      toast.success("Email sent");
      setEmailTarget(null);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to send email");
    } finally {
      setEmailSending(false);
    }
  };

  const printBuyer = useCallback((row) => {
    const docs = [
      ...(Array.isArray(row.kycDocuments) ? row.kycDocuments : []),
      ...(Array.isArray(row.kycFiles) ? row.kycFiles.map((f) => f.name) : []),
    ];
    const printed = printDocument({
      company: currentCompany,
      docType: `${T.saleBuyer} Profile`,
      docNumber: row.buyerNumber || "",
      status: { label: `KYC: ${row.kycStatus || "—"}`, tone: { verified: "success", pending: "warning", rejected: "danger" }[row.kycStatus] || "neutral" },
      parties: [{ heading: `${T.saleBuyer} details`, name: row.fullName, lines: [row.phone, row.email, row.address] }],
      details: {
        heading: "Identification",
        rows: [[`${T.saleBuyer} No.`, row.buyerNumber || "—"], ["ID / Passport", row.idNumber || "—"], ["Nationality", row.nationality || "—"], ["Source", String(row.source || "").replace(/_/g, " ") || "—"], ["KYC status", row.kycStatus || "—"]],
      },
      notes: [
        ...(docs.length ? [{ heading: `KYC documents (${docs.length})`, items: docs }] : []),
        ...(row.notes ? [{ heading: "Notes", text: row.notes }] : []),
      ],
    });
    if (!printed) toast.error("Pop-up blocked — allow pop-ups for this site to print");
  }, [currentCompany, T.saleBuyer]);

  const handleSelectRow = useCallback((row) => setSelected((prev) => (prev?._id === row._id ? null : row)), [setSelected]);
  const isRowSelected = useCallback((row) => selectedId === row._id, [selectedId]);

  const renderBuyerActions = useCallback((row) => (
    <div className="inline-flex gap-1">
      <button type="button" onClick={() => printBuyer(row)} className="border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"><FaPrint className="text-[9px]" /></button>
      <button type="button" onClick={() => openEdit(row)} className="border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"><FaEdit className="text-[9px]" /></button>
      <button type="button" onClick={() => handleDelete(row)} className="border border-red-200 bg-white px-2 py-0.5 text-[11px] font-bold text-red-600 hover:bg-red-50"><FaTrash className="text-[9px]" /></button>
    </div>
  ), [printBuyer, openEdit, handleDelete]);

  const buildReportFilters = () => ({
    business: biz, search: debouncedSearch, kycStatus: kycFilter, source: sourceFilter,
  });
  const reportColumns = [
    { label: `${T.saleBuyer} No.`, value: (r) => r.buyerNumber },
    { label: "Name", value: (r) => r.fullName },
    { label: "ID / Passport", value: (r) => r.idNumber || "—" },
    { label: "Phone", value: (r) => r.phone || "—" },
    { label: "Email", value: (r) => r.email || "—" },
    { label: "Source", value: (r) => humanize(r.source) },
    { label: "KYC", value: (r) => r.kycStatus },
  ];

  const [printing, setPrinting] = useState(false);
  const printReport = async () => {
    setPrinting(true);
    const described = [
      kycFilter && `KYC: ${humanize(kycFilter)}`,
      sourceFilter && `Source: ${humanize(sourceFilter)}`,
      debouncedSearch && `Search: ${debouncedSearch}`,
    ].filter(Boolean);
    await printAfterFetch(() => fetchAllPages(saleApi.listBuyers, buildReportFilters()), ({ rows }) => ({
      title: T.saleBuyers,
      subtitle: described.join(" · ") || `All ${T.saleBuyers.toLowerCase()}`,
      company: currentCompany,
      columns: reportColumns,
      rows,
    }));
    setPrinting(false);
  };

  const [exporting, setExporting] = useState(false);
  const exportReport = async () => {
    setExporting(true);
    await exportAfterFetch(() => fetchAllPages(saleApi.listBuyers, buildReportFilters()), ({ rows }) => ({
      filename: "buyers",
      columns: reportColumns,
      rows,
    }));
    setExporting(false);
  };

  return (
    <PropertySaleShell>
      <SaleFilterBar
        onReset={() => { setSearch(""); setKycFilter(""); setSourceFilter(""); setPage(1); }}
        activeCount={[search, kycFilter, sourceFilter].filter(Boolean).length}
        trailing={
          <>
            <SalePrintButton onClick={printReport} busy={printing} disabled={loading || total === 0} />
            <SaleExportButton onClick={exportReport} busy={exporting} disabled={loading || total === 0} />
            <ListToolbar.Button
              variant="outline"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["sale-buyers", biz] })}
            >
              <FaRedoAlt size={7} className={isFetching ? "animate-spin" : ""} /> Refresh
            </ListToolbar.Button>
            <ListToolbar.Button icon={FaFileImport} variant="outline" onClick={() => setShowImportModal(true)}>
              Import
            </ListToolbar.Button>
            <ListToolbar.Button icon={FaPlus} onClick={openCreate}>
              New {T.saleBuyer}
            </ListToolbar.Button>
          </>
        }
      >
        <FilterSearch value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Name, phone, ID…" />
        <AppSelect value={kycFilter} onChange={(v) => { setKycFilter(v ?? ""); setPage(1); }} options={KYC_FILTER_OPTIONS} placeholder="All KYC" clearable compact />
        <AppSelect value={sourceFilter} onChange={(v) => { setSourceFilter(v ?? ""); setPage(1); }} options={SOURCE_FILTER_OPTIONS} placeholder="All Sources" clearable compact />
      </SaleFilterBar>

      {/* Table + KYC detail panel */}
      <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className={`flex flex-col flex-1 min-h-0 border border-slate-200 bg-white shadow-sm transition-[margin] duration-200 ${selected ? "mr-[380px]" : ""}`}>
          <MilikTable
            columns={BUYER_COLUMNS}
            rows={buyers}
            loading={loading}
            empty={`No ${T.saleBuyers.toLowerCase()} found.`}
            minWidth={640}
            onRowClick={handleSelectRow}
            isSelected={isRowSelected}
            renderRow={renderBuyerRow}
            renderActions={renderBuyerActions}
          />

          <PaginationBar page={page} pages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} loading={isFetching} label={T.saleBuyers.toLowerCase()} />
        </div>

        {selected && (
          <div className="absolute inset-0 z-[5]" onClick={() => setSelected(null)} />
        )}

        {/* Buyer Detail Panel */}
        {selected && (
          <div className="absolute right-0 top-0 bottom-0 w-full sm:w-[380px] flex flex-col bg-white border-l border-slate-200 shadow-xl z-10 overflow-hidden">
            {/* Header */}
            <div className="flex-shrink-0 bg-[#0B3B2E] px-4 py-3 text-white">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-wider text-white/60">{selected.buyerNumber}</div>
                  <div className="mt-0.5 text-sm font-black leading-tight">{selected.fullName}</div>
                  {selected.phone && <div className="text-[10px] text-white/60 mt-0.5">{selected.phone}{selected.email ? ` · ${selected.email}` : ""}</div>}
                </div>
                <button type="button" onClick={() => setSelected(null)} className="flex-shrink-0 p-1 text-white/70 hover:bg-white/10"><FaTimes size={12} /></button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className={`border px-1.5 py-0.5 text-[9px] font-black uppercase ${kycBadge(selected.kycStatus)}`}>{selected.kycStatus}</span>
                <span className="text-[10px] text-white/50">{buyerDeals.length} {(buyerDeals.length === 1 ? T.saleDeal : T.saleDeals).toLowerCase()} · {buyerOffers.length} {(buyerOffers.length === 1 ? T.saleOffer : T.saleOffers).toLowerCase()}</span>
              </div>
            </div>

            {/* Tab nav */}
            <div className="flex-shrink-0 flex border-b border-slate-200 bg-slate-50 overflow-x-auto">
              {[
                { id: "profile",    label: "Profile / KYC" },
                { id: "offers",     label: `${T.saleOffers} (${buyerOffers.length})` },
                { id: "deals",      label: `${T.saleDeals} (${buyerDeals.length})` },
                { id: "payments",   label: buyerPaymentsData ? `Payments (${buyerPayments.length})` : "Payments" },
                { id: "activities", label: buyerActivitiesData ? `Log (${buyerActivities.length})` : "Log" },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setPanelTab(t.id)}
                  className={`flex-shrink-0 px-3 py-2 text-[10px] font-black uppercase tracking-wide whitespace-nowrap border-b-2 transition-colors ${panelTab === t.id ? "border-[#0B3B2E] text-[#0B3B2E] bg-white" : "border-transparent text-slate-400 hover:text-slate-700"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Scrollable body */}
            <div className="flex-1 min-h-0 overflow-y-auto">

              {/* ── Profile / KYC tab ── */}
              {panelTab === "profile" && (
                <>
                  <div className="border-b border-slate-100 px-4 py-3">
                    <div className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">Contact Details</div>
                    <div className="space-y-1.5">
                      {[
                        ["ID / Passport", selected.idNumber],
                        ["Phone",         selected.phone],
                        ["Email",         selected.email],
                        ["Nationality",   selected.nationality],
                        ["Source",        String(selected.source || "").replace(/_/g, " ")],
                        ["Address",       selected.address],
                      ].filter(([, v]) => v).map(([label, val]) => (
                        <div key={label} className="flex items-baseline gap-2">
                          <span className="w-[100px] flex-shrink-0 text-[9px] font-black uppercase tracking-wider text-slate-400">{label}</span>
                          <span className="text-xs text-slate-800 break-all">{val}</span>
                        </div>
                      ))}
                    </div>
                    {selected.notes && (
                      <div className="mt-3 border-t border-slate-100 pt-3">
                        <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-slate-400">Notes</div>
                        <div className="text-xs leading-relaxed text-slate-600">{selected.notes}</div>
                      </div>
                    )}
                  </div>
                  <div className="border-b border-slate-100 px-4 py-3">
                    <div className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">KYC Status</div>
                    <div className="flex flex-wrap gap-1.5">
                      {selected.kycStatus !== "verified" && (
                        <button type="button" disabled={kycSaving} onClick={() => handleKycAction(selected, "verified")}
                          className="inline-flex items-center gap-1 border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60">
                          <FaCheck size={9} /> Verify
                        </button>
                      )}
                      {selected.kycStatus !== "rejected" && (
                        <button type="button" disabled={kycSaving} onClick={() => handleKycAction(selected, "rejected")}
                          className="inline-flex items-center gap-1 border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-60">
                          <FaBan size={9} /> Reject
                        </button>
                      )}
                      {selected.kycStatus !== "pending" && (
                        <button type="button" disabled={kycSaving} onClick={() => handleKycAction(selected, "pending")}
                          className="inline-flex items-center gap-1 border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-60">
                          Reset to Pending
                        </button>
                      )}
                    </div>
                  </div>
                  <BuyerKycPanel key={selected._id} buyer={selected} kycSaving={kycSaving} onRemoveLegacyDoc={handleRemoveDoc} invalidate={invalidate} />
                </>
              )}

              {/* ── Offers tab ── */}
              {panelTab === "offers" && (
                <div className="px-4 py-3">
                  {buyerOffers.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-400">No {T.saleOffers.toLowerCase()} found for this {T.saleBuyer.toLowerCase()}.</div>
                  ) : (
                    <div className="space-y-2">
                      {buyerOffers.map((o) => (
                        <div key={o._id} className="border border-slate-200 px-3 py-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="font-mono text-[10px] font-black text-[#0B3B2E]">{o.offerNumber}</div>
                              <div className="text-xs font-semibold text-slate-800 mt-0.5">{o.listing?.title || o.listing?.listingNumber || "—"}</div>
                            </div>
                            <span className={`flex-shrink-0 border px-1.5 py-0.5 text-[9px] font-black uppercase ${
                              o.status === "accepted" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : o.status === "rejected" || o.status === "withdrawn" ? "border-rose-200 bg-rose-50 text-rose-700"
                              : o.status === "expired" ? "border-slate-200 bg-slate-50 text-slate-500"
                              : "border-amber-200 bg-amber-50 text-amber-700"
                            }`}>{o.status}</span>
                          </div>
                          <div className="mt-1.5 flex items-center gap-3 text-[11px] text-slate-500">
                            <span>KES {fmtKES(o.offerAmount)}</span>
                            <span>{fmtDate(o.offerDate)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Deals tab ── */}
              {panelTab === "deals" && (
                <div className="px-4 py-3">
                  {buyerDeals.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-400">No {T.saleDeals.toLowerCase()} found for this {T.saleBuyer.toLowerCase()}.</div>
                  ) : (
                    <div className="space-y-2">
                      {buyerDeals.map((d) => {
                        const pct = d.agreedPrice ? Math.min(100, Math.round((d.totalPaid / d.agreedPrice) * 100)) : 0;
                        return (
                          <div key={d._id} className="border border-slate-200 px-3 py-2.5">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="font-mono text-[10px] font-black text-[#0B3B2E]">{d.dealNumber}</div>
                                <div className="text-xs font-semibold text-slate-800 mt-0.5">{d.listing?.title || d.listing?.listingNumber || "—"}</div>
                              </div>
                              <span className={`flex-shrink-0 border px-1.5 py-0.5 text-[9px] font-black uppercase ${
                                d.status === "closed" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : d.status === "cancelled" ? "border-slate-200 bg-slate-50 text-slate-500"
                                : "border-[#B7C9C0] bg-[#F1F6F3] text-[#0B3B2E]"
                              }`}>{d.status}</span>
                            </div>
                            <div className="mt-1.5 text-[11px] text-slate-500">
                              <span>KES {fmtKES(d.agreedPrice)}</span>
                              <span className="mx-2 text-slate-300">·</span>
                              <span className="text-slate-700 font-semibold">Paid: KES {fmtKES(d.totalPaid)}</span>
                              <span className="mx-2 text-slate-300">·</span>
                              <span>Bal: KES {fmtKES(d.balance)}</span>
                            </div>
                            <div className="mt-1.5">
                              <div className="flex items-center gap-1.5">
                                <div className="h-1.5 flex-1 bg-slate-100 overflow-hidden">
                                  <div className="h-full bg-[#0B3B2E] transition-all" style={{ width: `${pct}%` }} />
                                </div>
                                <span className="text-[10px] font-black text-slate-500">{pct}%</span>
                              </div>
                            </div>
                            <div className="mt-1 text-[10px] text-slate-400">{fmtDate(d.dealDate)}{d.agent ? ` · ${T.saleAgent}: ${d.agent.fullName}` : ""}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── Payments tab ── */}
              {panelTab === "payments" && (
                <div className="px-4 py-3">
                  {buyerPayments.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-400">No payments found for this {T.saleBuyer.toLowerCase()}.</div>
                  ) : (
                    <>
                      <div className="mb-2 flex items-baseline justify-between">
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{buyerPayments.length} payment{buyerPayments.length !== 1 ? "s" : ""}</span>
                        <span className="text-xs font-black text-[#0B3B2E]">Total: KES {fmtKES(buyerPayments.filter(p => p.status === "paid").reduce((s, p) => s + p.amount, 0))}</span>
                      </div>
                      <div className="space-y-1.5">
                        {buyerPayments.map((p) => (
                          <div key={p._id} className="flex items-start gap-2 border border-slate-200 px-3 py-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-[10px] font-black text-[#0B3B2E]">{p.paymentNumber}</span>
                                <span className={`border px-1 py-0.5 text-[8px] font-black uppercase ${p.status === "paid" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>{p.status}</span>
                              </div>
                              <div className="mt-0.5 text-[11px] text-slate-600">{String(p.paymentType || "").replace(/_/g, " ")} · {String(p.paymentMethod || "").replace(/_/g, " ")}</div>
                              <div className="text-[10px] text-slate-400">{fmtDate(p.paymentDate)} · {p.deal?.dealNumber || "—"}</div>
                            </div>
                            <div className="flex-shrink-0 text-right">
                              <div className="text-xs font-black text-slate-900">KES {fmtKES(p.amount)}</div>
                              {p.reference && <div className="text-[10px] text-slate-400">Ref: {p.reference}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ── Activities tab ── */}
              {panelTab === "activities" && (
                <div className="px-4 py-3">
                  {buyerActivities.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-400">No activity log for this {T.saleBuyer.toLowerCase()}.</div>
                  ) : (
                    <div className="relative">
                      <div className="absolute left-[7px] top-0 bottom-0 w-px bg-slate-200" />
                      <div className="space-y-3 pl-5">
                        {buyerActivities.map((a) => (
                          <div key={a._id} className="relative">
                            <div className="absolute -left-5 top-1 h-2 w-2 border border-[#B7C9C0] bg-[#F1F6F3]" />
                            <div className="border border-slate-200 px-3 py-2">
                              <div className="flex items-start justify-between gap-2">
                                <span className="text-[10px] font-black uppercase tracking-wide text-[#0B3B2E]">{String(a.type || "").replace(/_/g, " ")}</span>
                                {a.outcome && (
                                  <span className={`text-[9px] font-black uppercase px-1 py-0.5 ${a.outcome === "positive" ? "bg-emerald-50 text-emerald-700" : a.outcome === "negative" ? "bg-rose-50 text-rose-700" : "bg-slate-50 text-slate-500"}`}>{a.outcome}</span>
                                )}
                              </div>
                              {a.notes && <div className="mt-1 text-[11px] text-slate-700 leading-relaxed">{a.notes}</div>}
                              <div className="mt-1 text-[10px] text-slate-400">
                                {fmtDate(a.date)}{a.createdBy?.name || a.createdBy?.fullName ? ` · ${a.createdBy.name || a.createdBy.fullName}` : ""}
                                {a.relatedDeal?.dealNumber ? ` · ${a.relatedDeal.dealNumber}` : ""}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

            </div>

            {/* Panel footer */}
            <div className="flex-shrink-0 flex items-center justify-between gap-1 border-t border-slate-200 bg-slate-50 px-3 py-2">
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => printBuyer(selected)}
                  className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 py-1 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                  <FaPrint size={9} /> Print
                </button>
                {selected.phone && (
                  <button type="button" onClick={() => setSmsTarget(selected)}
                    className="inline-flex items-center gap-1 border border-teal-200 bg-teal-50 px-2.5 py-1 text-[11px] font-bold text-teal-700 hover:bg-teal-100">
                    <FaSms size={9} /> SMS
                  </button>
                )}
                {selected.email && (
                  <button type="button" onClick={() => setEmailTarget(selected)}
                    className="inline-flex items-center gap-1 border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700 hover:bg-blue-100">
                    <FaEnvelope size={9} /> Email
                  </button>
                )}
              </div>
              <button type="button" onClick={() => openEdit(selected)}
                className="inline-flex items-center gap-1 bg-[#0B3B2E] px-3 py-1 text-[11px] font-black text-white hover:bg-[#0A3127]">
                <FaEdit size={9} /> Edit Profile
              </button>
            </div>
          </div>
        )}
      </div>

      {/* SMS Modal */}
      {smsTarget && (
        <CwSmsModal
          target={{ name: smsTarget.fullName, phone: smsTarget.phone }}
          context={smsTarget.buyerNumber}
          defaultBody={`Dear ${smsTarget.fullName}, `}
          templates={[
            { label: "KYC Verified",      color: "green",  body: `Dear ${smsTarget.fullName}, your KYC verification is complete. You are now cleared to proceed with property transactions. Contact us for next steps.` },
            { label: "Document Request",  color: "amber",  body: `Dear ${smsTarget.fullName}, please submit your outstanding KYC documents at your earliest convenience. Contact us for assistance.` },
            { label: "Payment Reminder",  color: "violet", body: `Dear ${smsTarget.fullName}, this is a friendly payment reminder. Kindly ensure your outstanding balance is settled to avoid delays. Contact us for details.` },
            { label: "Welcome",           color: "slate",  body: `Welcome to MILIK ${T.saleModule}, ${smsTarget.fullName}! We are delighted to have you as a client. Our team is ready to assist you. Contact us anytime.` },
          ]}
          onSend={handleSendSms}
          onClose={() => setSmsTarget(null)}
          sending={smsSending}
        />
      )}

      {/* Email Modal */}
      {emailTarget && (
        <BuyerEmailModal target={emailTarget} company={currentCompany} sending={emailSending} onSend={handleSendEmail} onClose={() => setEmailTarget(null)} />
      )}

      {/* New / Edit Buyer Modal */}
      {buyerModal && (
        <BuyerFormModal editingId={buyerModal.editingId} initial={buyerModal.initial} saving={saving} invalidate={invalidate} onClose={() => setBuyerModal(null)} onSubmit={handleSave} />
      )}

      <ImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        title={`Import ${T.saleBuyers}`}
        entityName={T.saleBuyer.toLowerCase()}
        parseFile={parseSaleBuyersExcel}
        downloadTemplate={downloadSaleBuyersTemplate}
        onImport={async (rows) => {
          const res = await saleApi.bulkImportBuyers(rows);
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["sale-buyers", biz] }),
            queryClient.invalidateQueries({ queryKey: ["sale-buyers-ref", biz] }),
          ]);
          return res;
        }}
        previewCols={[
          { header: "Full Name",   render: (r) => <span className="font-semibold">{r.fullName}</span> },
          { header: "Phone",       render: (r) => r.phone || "—" },
          { header: "ID / Passport", render: (r) => r.idNumber || "—" },
          { header: "Source",      render: (r) => r.source },
          { header: "KYC Status",  render: (r) => r.kycStatus },
        ]}
      />
    </PropertySaleShell>
  );
};

export default SaleBuyers;
