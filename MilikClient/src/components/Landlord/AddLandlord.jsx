import MilikSelect from "../common/MilikSelect";
import { normalizeUppercaseInput } from "../../utils/listingPageUtils";
// components/Landlord/AddLandlord.jsx
import React, { useRef, useState, useEffect, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import DashboardLayout from "../Layout/DashboardLayout";
import {
  FaSave,
  FaPaperclip,
  FaDownload,
  FaTrash,
  FaTrashAlt,
  FaChevronDown,
  FaSpinner,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { createLandlord, updateLandlord } from "../../redux/apiCalls";
import { selectAllLandlords, selectCurrentCompany, selectCurrentUser, selectLandlordIsFetching } from "../../redux/selectors";
import { useTerms } from "../../hooks/useTerm";
import BankDetailsFields from "../common/BankDetailsFields";
import { INITIAL_LANDLORD_FORM, formatMobile, resolveLandlordPhone, toKenyanMobile, validateLandlordForm } from "../../utils/landlordForm";

const LANDLORD_TYPES = ["Individual", "Company", "Partnership", "Trust"];

const INITIAL_FORM = INITIAL_LANDLORD_FORM;

// Uppercased on entry, like the rest of the Milik name and address fields
const UPPERCASE_FIELDS = new Set(["landlordCode", "landlordName", "regId", "taxPin", "postalAddress", "location", "bankName", "branchName", "accountName"]);

const validateForm = validateLandlordForm;


const inputClass = (hasError = false) =>
  `h-7 w-full border bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-500 outline-none transition focus:ring-1 ${
    hasError
      ? "border-red-500 focus:border-red-500 focus:ring-red-500/20"
      : "border-slate-300 focus:border-[#0B3B2E] focus:ring-[#0B3B2E]/20"
  }`;

const labelClass = "mb-1 block text-xs font-bold text-slate-900";

const Required = () => <span className="ml-0.5 font-black text-red-600">*</span>;

const FieldError = ({ error }) => (error ? <p className="mt-0.5 text-[11px] font-semibold text-red-600">{error}</p> : null);

const Section = ({ title, children, className = "" }) => (
  <div className={`border border-slate-200 bg-white ${className}`}>
    <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5">
      <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-800">{title}</h3>
    </div>
    <div className="p-2.5">{children}</div>
  </div>
);

const AddLandlord = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const isFetching = useSelector(selectLandlordIsFetching);
  const landlords = useSelector(selectAllLandlords);
  const { landlord: termLandlord } = useTerms("landlord");
  const fileInputRef = useRef(null);
  const editLandlordId = location.state?.landlordId || null;
  const editLandlordData = location.state?.landlordData || null;
  const isEditMode = Boolean(editLandlordId);
  const draftStorageKey = currentCompany?._id
    ? `milik:landlord-form-draft:${currentCompany._id}:${currentUser?._id || currentUser?.id || currentUser?.email || "user"}:${isEditMode ? editLandlordId || "edit" : "new"}`
    : null;

  const [formData, setFormData] = useState(INITIAL_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [attachments, setAttachments] = useState([]);
  const draftReadyRef = useRef(false);
  const [draftReadyNonce, setDraftReadyNonce] = useState(0);

  const clearDraftState = () => {
    if (!draftStorageKey || typeof window === "undefined" || !window.sessionStorage) return;
    window.sessionStorage.removeItem(draftStorageKey);
  };

  useEffect(() => {
    if (!isEditMode || !editLandlordData) return;

    setFormData({
      landlordCode: editLandlordData.landlordCode || editLandlordData.code || "",
      landlordType: editLandlordData.landlordType || "Individual",
      landlordName: editLandlordData.landlordName || editLandlordData.name || "",
      regId: editLandlordData.regId || "",
      taxPin: editLandlordData.taxPin || editLandlordData.pin || "",
      status: editLandlordData.status || "Active",
      phoneNumber: editLandlordData.phoneNumber || editLandlordData.phone || "",
      email: editLandlordData.email || "",
      location: editLandlordData.location || "",
      postalAddress: editLandlordData.postalAddress || editLandlordData.address || "",
      bankName: editLandlordData.bankName || "",
      branchName: editLandlordData.branchName || "",
      accountName: editLandlordData.accountName || "",
      accountNumber: editLandlordData.accountNumber || "",
      mobileNumber: editLandlordData.mobileNumber || "",
    });

    setAttachments(
      (editLandlordData.attachments || []).map((a, index) => ({
        id: a.id || `${Date.now()}-${index}`,
        name: a.name || "Attachment",
        size: a.size || "Unknown",
        dateTime: a.dateTime || "",
        file: null,
      }))
    );
  }, [isEditMode, editLandlordData]);

  useEffect(() => {
    draftReadyRef.current = false;

    if (isEditMode || !draftStorageKey || typeof window === "undefined" || !window.sessionStorage) {
      draftReadyRef.current = true;
      setDraftReadyNonce((value) => value + 1);
      return;
    }

    try {
      const savedDraft = window.sessionStorage.getItem(draftStorageKey);
      if (savedDraft) {
        const parsedDraft = JSON.parse(savedDraft);
        if (parsedDraft?.formData && typeof parsedDraft.formData === "object") {
          setFormData((prev) => ({ ...prev, ...parsedDraft.formData }));
        }
        if (Array.isArray(parsedDraft?.attachments)) {
          setAttachments(parsedDraft.attachments);
        }
      }
    } catch (draftError) {
      console.warn("Failed to restore landlord draft", draftError);
    } finally {
      window.setTimeout(() => {
        draftReadyRef.current = true;
        setDraftReadyNonce((value) => value + 1);
      }, 0);
    }
  }, [draftStorageKey, isEditMode]);

  useEffect(() => {
    if (isEditMode || !draftStorageKey || !draftReadyRef.current || typeof window === "undefined" || !window.sessionStorage) return;

    try {
      window.sessionStorage.setItem(
        draftStorageKey,
        JSON.stringify({
          formData,
          attachments: attachments.map(({ id, name, size, dateTime }) => ({
            id,
            name,
            size,
            dateTime,
            file: null,
          })),
        })
      );
    } catch (draftError) {
      console.warn("Failed to persist landlord draft", draftError);
    }
  }, [attachments, draftReadyNonce, draftStorageKey, formData, isEditMode]);

  // Bank names already used by other landlords, offered in the bank list
  const landlordBankNames = useMemo(
    () => (Array.isArray(landlords) ? landlords : []).map((l) => l?.bankName).filter(Boolean),
    [landlords]
  );

  const isIndividual = formData.landlordType === "Individual";
  const regIdLabel = isIndividual ? "National ID No." : "Registration No.";
  const regIdPlaceholder = isIndividual ? "e.g. 12345678" : "e.g. PVT-1234567";

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    const nextValue = UPPERCASE_FIELDS.has(name) ? normalizeUppercaseInput(value) : value;
    setFormData((prev) => ({ ...prev, [name]: nextValue }));
    if (fieldErrors[name]) setFieldErrors((prev) => ({ ...prev, [name]: undefined }));
  };

  // Show a valid Kenyan number in its standard spacing once the user leaves the field
  const handleMobileBlur = (name) => {
    const local = toKenyanMobile(formData[name]);
    if (local) setFormData((prev) => ({ ...prev, [name]: formatMobile(local) }));
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files || []);
    const newAttachments = files.map((file) => ({
      id: Date.now() + Math.random(),
      name: file.name,
      size: formatFileSize(file.size),
      dateTime: new Date().toLocaleString(),
      file,
    }));
    setAttachments((prev) => [...prev, ...newAttachments]);
    e.target.value = "";
  };

  const handleDownload = (attachment) => {
    if (!attachment?.file) return;
    const url = URL.createObjectURL(attachment.file);
    const a = document.createElement("a");
    a.href = url;
    a.download = attachment.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDeleteAttachment = (id) => {
    setAttachments((prev) => prev.filter((att) => att.id !== id));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!currentCompany?._id) {
      toast.error("No active company selected. Please create or select a company first.");
      return;
    }

    const errors = validateForm(formData);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast.error("Check the highlighted fields");
      return;
    }

    try {
      const payload = {
        ...formData,
        phoneNumber: resolveLandlordPhone(formData.phoneNumber).value ?? "",
        email: formData.email.trim(),
        mobileNumber: formData.mobileNumber.trim() ? toKenyanMobile(formData.mobileNumber) : "",
        portalAccess: "Disabled",
        company: currentCompany._id,
        attachments: attachments.map(({ id, name, size, dateTime }) => ({
          id,
          name,
          size,
          dateTime
        })),
      };

      if (isEditMode) {
        await dispatch(updateLandlord(editLandlordId, payload));
        toast.success(`${termLandlord} updated successfully!`);
      } else {
        await dispatch(createLandlord(payload));
        toast.success(`${termLandlord} added successfully!`);
      }

      clearDraftState();
      navigate("/landlords");
    } catch (err) {
      console.error("Error:", err);
      toast.error(err?.message || (isEditMode ? `Failed to update ${termLandlord.toLowerCase()}` : `Failed to add ${termLandlord.toLowerCase()}`));
    }
  };

  const handleCancel = () => {
    navigate("/landlords");
  };

  const handleReset = () => {
    if (isEditMode) return;
    setFormData(INITIAL_FORM);
    setFieldErrors({});
    setAttachments([]);
    clearDraftState();
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">
        {/* Scrollable content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <form id="landlord-form" onSubmit={handleSubmit} noValidate className="w-full space-y-2.5">
            {/* Landlord details: general, contact and address together */}
            <Section title="Landlord Details">
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-4">
                <MilikSelect
                  label={`${termLandlord} Type`}
                  required
                  placeholder="Select type"
                  items={LANDLORD_TYPES}
                  value={formData.landlordType}
                  onChange={(val) => setFormData((p) => ({ ...p, landlordType: val }))}
                  getLabel={(x) => x}
                  getValue={(x) => x}
                />

                <div>
                  <label className={labelClass} htmlFor="landlordCode">{termLandlord} Code</label>
                  <input id="landlordCode" type="text" name="landlordCode" value={formData.landlordCode} onChange={handleInputChange} className={inputClass()} placeholder="Auto" />
                </div>

                <div className="col-span-2">
                  <label className={labelClass} htmlFor="landlordName">{termLandlord} Name<Required /></label>
                  <input
                    id="landlordName"
                    type="text"
                    name="landlordName"
                    value={formData.landlordName}
                    onChange={handleInputChange}
                    className={inputClass(Boolean(fieldErrors.landlordName))}
                    placeholder="Full legal name"
                    aria-invalid={Boolean(fieldErrors.landlordName)}
                  />
                  <FieldError error={fieldErrors.landlordName} />
                </div>

                <div>
                  <label className={labelClass} htmlFor="phoneNumber">Phone<Required /></label>
                  <input
                    id="phoneNumber"
                    type="tel"
                    inputMode="tel"
                    name="phoneNumber"
                    value={formData.phoneNumber}
                    onChange={handleInputChange}
                    onBlur={() => handleMobileBlur("phoneNumber")}
                    className={inputClass(Boolean(fieldErrors.phoneNumber))}
                    placeholder="0712 345 678"
                    aria-invalid={Boolean(fieldErrors.phoneNumber)}
                  />
                  <FieldError error={fieldErrors.phoneNumber} />
                </div>

                <div>
                  <label className={labelClass} htmlFor="email">Email<Required /></label>
                  <input
                    id="email"
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    className={inputClass(Boolean(fieldErrors.email))}
                    placeholder="Email, or -"
                    aria-invalid={Boolean(fieldErrors.email)}
                  />
                  <FieldError error={fieldErrors.email} />
                </div>

                <div>
                  <label className={labelClass} htmlFor="regId">{regIdLabel}</label>
                  <input id="regId" type="text" name="regId" value={formData.regId} onChange={handleInputChange} className={inputClass()} placeholder={regIdPlaceholder} />
                </div>

                <div>
                  <label className={labelClass} htmlFor="taxPin">Tax PIN (KRA)</label>
                  <input id="taxPin" type="text" name="taxPin" value={formData.taxPin} onChange={handleInputChange} className={inputClass()} placeholder="A000000000Z" />
                </div>

                <div>
                  <MilikSelect
                    label="Status"
                    placeholder="Select status"
                    items={["Active", "Archived"]}
                    value={formData.status}
                    onChange={(val) => setFormData((p) => ({ ...p, status: val }))}
                    getLabel={(x) => x}
                    getValue={(x) => x}
                  />
                </div>

                <div>
                  <label className={labelClass} htmlFor="location">Location</label>
                  <input id="location" type="text" name="location" value={formData.location} onChange={handleInputChange} className={inputClass()} placeholder="e.g. Westlands" />
                </div>

                <div className="col-span-2">
                  <label className={labelClass} htmlFor="postalAddress">Postal Address</label>
                  <input id="postalAddress" type="text" name="postalAddress" value={formData.postalAddress} onChange={handleInputChange} className={inputClass()} placeholder="P.O. Box 1234-00100, Nairobi" />
                </div>
              </div>
            </Section>

            {/* Payments: where remittances are paid. Optional; the system records, it does not block. */}
            <BankDetailsFields
              values={formData}
              onChange={(field, value) => setFormData((prev) => ({ ...prev, [field]: value }))}
              knownBanks={landlordBankNames}
              errors={{ mobileNumber: fieldErrors.mobileNumber }}
              title="Bank & Payment Details"
            />

            {/* Attachments */}
            <Section title="Attachments">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-3 text-xs font-bold text-white transition hover:bg-[#0A3127]"
                >
                  <FaPaperclip size={10} />
                  Add File
                </button>
                <button
                  type="button"
                  onClick={() => setAttachments([])}
                  disabled={attachments.length === 0}
                  className="inline-flex h-8 items-center gap-1.5 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FaTrashAlt size={10} />
                  Delete All
                </button>
                <span className="text-xs font-semibold text-slate-600">
                  {attachments.length === 0 ? "No files" : `${attachments.length} file${attachments.length === 1 ? "" : "s"} (names only)`}
                </span>
                <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" multiple />
              </div>

              {attachments.length > 0 && (
                <ul className="mt-2 divide-y divide-slate-200 border border-slate-200">
                  {attachments.map((attachment) => (
                    <li key={attachment.id} className="flex items-center justify-between gap-3 px-2.5 py-1.5 text-xs">
                      <span className="truncate font-semibold text-slate-900">{attachment.name}</span>
                      <span className="shrink-0 text-slate-600">{attachment.size}</span>
                      <div className="flex shrink-0 gap-3">
                        {attachment.file && (
                          <button type="button" onClick={() => handleDownload(attachment)} className="text-[#0B3B2E] hover:underline" title="Download">
                            <FaDownload size={11} />
                          </button>
                        )}
                        <button type="button" onClick={() => handleDeleteAttachment(attachment.id)} className="text-red-700 hover:underline" title="Remove">
                          <FaTrash size={11} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </form>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-slate-200 bg-white px-3 py-2">
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={isFetching}
              className="h-8 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            {!isEditMode && (
              <button
                type="button"
                onClick={handleReset}
                disabled={isFetching}
                className="h-8 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Reset
              </button>
            )}
            <button
              type="submit"
              form="landlord-form"
              disabled={isFetching}
              className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-black text-white transition hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isFetching ? <FaSpinner className="animate-spin" size={11} /> : <FaSave size={11} />}
              {isFetching ? "Saving…" : isEditMode ? `Update ${termLandlord}` : `Save ${termLandlord}`}
            </button>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default AddLandlord;
