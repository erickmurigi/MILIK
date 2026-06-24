import { normalizeUppercaseInput } from "../../utils/listingPageUtils";
// components/Landlord/AddLandlord.jsx
import React, { useRef, useState, useEffect, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import DashboardLayout from "../Layout/DashboardLayout";
import {
  FaSave,
  FaTimes,
  FaPaperclip,
  FaDownload,
  FaTrash,
  FaTrashAlt,
  FaChevronDown,
  FaSpinner,
  FaArrowLeft,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { createLandlord, updateLandlord } from "../../redux/apiCalls";
import { selectCurrentCompany, selectCurrentUser } from "../../redux/selectors";

const MILIK_ORANGE_BG = "bg-[#0B3B2E]";
const MILIK_ORANGE_BG_HOVER = "hover:bg-[#0A3127]";
const MILIK_ORANGE_RING = "";
const MILIK_ORANGE_BORDER_FOCUS = "";

/**
 * Custom dropdown with orange highlighting
 */
function MilikSelect({
  label,
  required,
  placeholder = "Select...",
  items = [],
  value,
  onChange,
  getLabel,
  getValue,
  disabled,
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const selectedItem = useMemo(
    () => items.find((it) => getValue(it) === value) || null,
    [items, value, getValue]
  );

  useEffect(() => {
    const onClickOutside = (e) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className={`${className} relative`} ref={wrapRef}>
      {label ? (
        <label className="mb-0.5 block text-xs font-semibold text-slate-700">
          {label} {required ? <span className="text-red-500">*</span> : ""}
        </label>
      ) : null}

      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((s) => !s)}
        className={[
          "w-full h-8 px-3 rounded border border-slate-200 bg-white text-slate-900",
          "transition focus:outline-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20",
          "flex items-center justify-between gap-2",
          disabled ? "opacity-50 cursor-not-allowed" : "",
        ].join(" ")}
      >
        <span className="text-xs font-semibold truncate">
          {selectedItem ? getLabel(selectedItem) : <span className="text-slate-400">{placeholder}</span>}
        </span>
        <FaChevronDown className="text-slate-600" size={10} />
      </button>

      {open && !disabled && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden">
          <div className="max-h-56 overflow-auto">
            {items.length === 0 ? (
              <div className="px-3 py-3 text-sm text-slate-500">No items</div>
            ) : (
              items.map((it) => {
                const v = getValue(it);
                const isSelected = v === value;
                return (
                  <button
                    type="button"
                    key={v}
                    onClick={() => {
                      onChange?.(v, it);
                      setOpen(false);
                    }}
                    className={[
                      "w-full text-left px-3 py-1.5 text-xs font-semibold transition-colors",
                      isSelected
                        ? `${MILIK_ORANGE_BG} text-white`
                        : "text-slate-800 hover:bg-orange-50",
                    ].join(" ")}
                  >
                    {getLabel(it)}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const AddLandlord = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const { isFetching } = useSelector((state) => state.landlord);
  const fileInputRef = useRef(null);
  const editLandlordId = location.state?.landlordId || null;
  const editLandlordData = location.state?.landlordData || null;
  const isEditMode = Boolean(editLandlordId);
  const draftStorageKey = currentCompany?._id
    ? `milik:landlord-form-draft:${currentCompany._id}:${currentUser?._id || currentUser?.id || currentUser?.email || "user"}:${isEditMode ? editLandlordId || "edit" : "new"}`
    : null;

  const [formData, setFormData] = useState({
    landlordCode: "",
    landlordType: "Individual",
    landlordName: "",
    regId: "",
    taxPin: "",
    postalAddress: "",
    email: "",
    phoneNumber: "",
    location: "",
    portalAccess: "Disabled",
    status: "Active",
  });

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
      postalAddress: editLandlordData.postalAddress || editLandlordData.address || "",
      email: editLandlordData.email || "",
      phoneNumber: editLandlordData.phoneNumber || editLandlordData.phone || "",
      location: editLandlordData.location || "",
      portalAccess: editLandlordData.portalAccess || "Disabled",
      status: editLandlordData.status || "Active",
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
  // Input classes for consistency
  const inputClass =
    "w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";

  const labelClass = "mb-0.5 block text-xs font-semibold text-slate-700";

  const uppercaseLandlordFields = new Set(["landlordCode", "landlordName", "regId", "taxPin", "postalAddress", "location"]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    const nextValue = uppercaseLandlordFields.has(name) ? normalizeUppercaseInput(value) : value;
    setFormData((prev) => ({ ...prev, [name]: nextValue }));
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

    // Validation
    if (!formData.landlordName?.trim()) {
      toast.error("Landlord name is required");
      return;
    }
    if (!formData.regId?.trim()) {
      toast.error("Reg/ID number is required");
      return;
    }
    if (!formData.taxPin?.trim()) {
      toast.error("Tax/PIN number is required");
      return;
    }
    if (!formData.phoneNumber?.trim()) {
      toast.error("Phone number is required");
      return;
    }

    try {
      const payload = {
        ...formData,
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
        toast.success("Landlord updated successfully!");
      } else {
        await dispatch(createLandlord(payload));
        toast.success("Landlord added successfully!");
      }

      clearDraftState();
      navigate("/landlords");
    } catch (err) {
      console.error("Error:", err);
      toast.error(err?.message || (isEditMode ? "Failed to update landlord" : "Failed to add landlord"));
    }
  };

  const handleCancel = () => {
    navigate("/landlords");
  };

  const handleReset = () => {
    if (isEditMode) return;
    setFormData({ landlordCode: "", landlordType: "Individual", landlordName: "", regId: "", taxPin: "", postalAddress: "", email: "", phoneNumber: "", location: "", portalAccess: "Disabled", status: "Active" });
    setAttachments([]);
    clearDraftState();
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">
        {/* Sticky dark header */}
        <div className="flex-shrink-0 bg-[#0B3B2E] px-4 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button type="button" onClick={handleCancel} className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#B7C9C0] hover:text-white transition">
                <FaArrowLeft /> Back
              </button>
              <div className="h-4 w-px bg-[#2A5C4A]" />
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#B7C9C0]">Landlords</div>
                <h1 className="text-sm font-black text-white leading-none">{isEditMode ? "Edit Landlord" : "New Landlord"}</h1>
              </div>
            </div>
            {currentCompany?.companyName && (
              <span className="rounded-lg border border-[#2A5C4A] bg-[#0A3127] px-2.5 py-1 text-[10px] font-bold text-[#B7C9C0]">{currentCompany.companyName}</span>
            )}
          </div>
        </div>

        {/* Scrollable content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <form id="landlord-form" onSubmit={handleSubmit} className="w-full max-w-none">
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
              {/* General Information */}
              <div className="xl:col-span-7 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
                  <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-700">General Information</h3>
                </div>
                <div className="p-3">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  <div>
                    <label className={labelClass}>Landlord Code</label>
                    <input
                      type="text"
                      name="landlordCode"
                      value={formData.landlordCode}
                      onChange={handleInputChange}
                      className={`${inputClass} ${MILIK_ORANGE_RING} ${MILIK_ORANGE_BORDER_FOCUS}`}
                      placeholder="Leave blank to auto-generate (LL001...)"
                    />
                    <p className="text-xs text-slate-500 mt-1">Auto-generated if left empty</p>
                  </div>

                  <div>
                    <MilikSelect
                      label="Landlord Type"
                      required
                      placeholder="Select Type"
                      items={["Individual", "Company", "Partnership", "Trust"]}
                      value={formData.landlordType}
                      onChange={(val) => setFormData((p) => ({ ...p, landlordType: val }))}
                      getLabel={(x) => x}
                      getValue={(x) => x}
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className={labelClass}>
                      Landlord Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      name="landlordName"
                      value={formData.landlordName}
                      onChange={handleInputChange}
                      className={`${inputClass} ${MILIK_ORANGE_RING} ${MILIK_ORANGE_BORDER_FOCUS}`}
                      placeholder="Enter landlord name"
                      required
                    />
                  </div>

                  <div>
                    <label className={labelClass}>
                      Reg/ID NO. <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      name="regId"
                      value={formData.regId}
                      onChange={handleInputChange}
                      className={`${inputClass} ${MILIK_ORANGE_RING} ${MILIK_ORANGE_BORDER_FOCUS}`}
                      placeholder="ID number or registration number"
                      required
                    />
                  </div>

                  <div>
                    <label className={labelClass}>
                      Tax/PIN NO. <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      name="taxPin"
                      value={formData.taxPin}
                      onChange={handleInputChange}
                      className={`${inputClass} ${MILIK_ORANGE_RING} ${MILIK_ORANGE_BORDER_FOCUS}`}
                      placeholder="e.g., A123456789X"
                      required
                    />
                  </div>

                  <div>
                    <MilikSelect
                      label="Status"
                      placeholder="Select Status"
                      items={["Active", "Archived"]}
                      value={formData.status}
                      onChange={(val) => setFormData((p) => ({ ...p, status: val }))}
                      getLabel={(x) => x}
                      getValue={(x) => x}
                    />
                  </div>

                  <div>
                    <MilikSelect
                      label="Portal Access"
                      placeholder="Select Access"
                      items={["Enabled", "Disabled"]}
                      value={formData.portalAccess}
                      onChange={(val) => setFormData((p) => ({ ...p, portalAccess: val }))}
                      getLabel={(x) => x}
                      getValue={(x) => x}
                    />
                  </div>
                </div>
                </div>
              </div>

              {/* Address Information */}
              <div className="xl:col-span-5 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
                  <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-700">Address Information</h3>
                </div>
                <div className="p-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="md:col-span-2">
                    <label className={labelClass}>Postal Address</label>
                    <input
                      type="text"
                      name="postalAddress"
                      value={formData.postalAddress}
                      onChange={handleInputChange}
                      className={`${inputClass} ${MILIK_ORANGE_RING} ${MILIK_ORANGE_BORDER_FOCUS}`}
                      placeholder="Physical or postal address"
                    />
                  </div>

                  <div>
                    <label className={labelClass}>Email</label>
                    <input
                      type="email"
                      name="email"
                      value={formData.email}
                      onChange={handleInputChange}
                      className={`${inputClass} ${MILIK_ORANGE_RING} ${MILIK_ORANGE_BORDER_FOCUS}`}
                      placeholder="Email address (optional)"
                    />
                  </div>

                  <div>
                    <label className={labelClass}>
                      Phone Number <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="tel"
                      name="phoneNumber"
                      value={formData.phoneNumber}
                      onChange={handleInputChange}
                      className={`${inputClass} ${MILIK_ORANGE_RING} ${MILIK_ORANGE_BORDER_FOCUS}`}
                      placeholder="+254 XXX XXX XXX"
                      required
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className={labelClass}>Location</label>
                    <input
                      type="text"
                      name="location"
                      value={formData.location}
                      onChange={handleInputChange}
                      className={`${inputClass} ${MILIK_ORANGE_RING} ${MILIK_ORANGE_BORDER_FOCUS}`}
                      placeholder="e.g., Nairobi CBD, Westlands, etc."
                    />
                  </div>
                </div>
                </div>
              </div>

              {/* Attachments */}
              <div className="xl:col-span-12 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
                  <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-700">Attachments</h3>
                </div>
                <div className="p-3">

                <div className="flex gap-2 mb-4">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className={`px-4 py-2 text-sm text-white rounded-lg flex items-center gap-2 ${MILIK_ORANGE_BG} ${MILIK_ORANGE_BG_HOVER} transition-colors`}
                  >
                    <FaPaperclip className="text-xs" />
                    Add File
                  </button>

                  <button
                    type="button"
                    onClick={() => setAttachments([])}
                    className="px-4 py-2 text-sm border border-slate-300 rounded-lg flex items-center gap-2 hover:bg-slate-50 transition-colors"
                  >
                    <FaTrashAlt className="text-xs" />
                    Delete All
                  </button>

                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    className="hidden"
                    multiple
                  />
                </div>

                {attachments.length > 0 ? (
                  <div className="overflow-x-auto border border-slate-200 rounded-lg">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-4 py-3 text-left font-bold text-slate-800 border-b">Name</th>
                          <th className="px-4 py-3 text-left font-bold text-slate-800 border-b">Size</th>
                          <th className="px-4 py-3 text-left font-bold text-slate-800 border-b">Date & Time</th>
                          <th className="px-4 py-3 text-left font-bold text-slate-800 border-b">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attachments.map((attachment) => (
                          <tr key={attachment.id} className="hover:bg-slate-50">
                            <td className="px-4 py-3 border-b">{attachment.name}</td>
                            <td className="px-4 py-3 border-b">{attachment.size}</td>
                            <td className="px-4 py-3 border-b">{attachment.dateTime}</td>
                            <td className="px-4 py-3 border-b">
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleDownload(attachment)}
                                  className="text-blue-600 hover:text-blue-800"
                                  title="Download"
                                >
                                  <FaDownload />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteAttachment(attachment.id)}
                                  className="text-red-600 hover:text-red-800"
                                  title="Delete"
                                >
                                  <FaTrash />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-8 text-slate-500 text-sm border border-slate-200 rounded-lg bg-slate-50">
                    No attachments added yet
                  </div>
                )}
                </div>
              </div>
            </div>
          </form>
        </div>

        {/* Sticky footer */}
        <div className="flex-shrink-0 border-t border-slate-200 bg-[#F6FAF8] px-4 py-2.5">
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={isFetching}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            {!isEditMode && (
              <button
                type="button"
                onClick={handleReset}
                disabled={isFetching}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Reset
              </button>
            )}
            <button
              type="submit"
              form="landlord-form"
              disabled={isFetching}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white transition hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isFetching ? <FaSpinner className="animate-spin" /> : <FaSave />}
              {isFetching ? "Saving…" : isEditMode ? "Update Landlord" : "Save Landlord"}
            </button>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default AddLandlord;
