// components/Properties/EditProperties.jsx - COMPLETE EDIT FORM WITH FULL FUNCTIONALITY
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import {
  FaSave,
  FaTimes,
  FaPlus,
  FaTrash,
  FaFileInvoice,
  FaBuilding,
  FaCalculator,
  FaChartBar,
  FaShieldAlt,
  FaCog,
  FaBell,
  FaStickyNote,
  FaHome,
  FaWarehouse,
  FaSpinner,
  FaChevronDown,
} from "react-icons/fa";
import { getPropertyById, updateProperty } from "../../redux/propertyRedux";
import { getLandlords } from "../../redux/apiCalls";
import { toast } from "react-toastify";
import MilikConfirmDialog from "../Modals/MilikConfirmDialog";

const MILIK_ORANGE_BG = "bg-orange-600";
const MILIK_ORANGE_BG_HOVER = "hover:bg-orange-700";
const MILIK_ORANGE_RING = "focus:ring-orange-500/30";
const MILIK_ORANGE_BORDER_FOCUS = "focus:border-orange-700";

function Modal({ open, title, onClose, children, maxWidthClass = "max-w-lg" }) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      setTimeout(() => {
        panelRef.current?.querySelector("input,select,textarea,button")?.focus?.();
      }, 0);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999]">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div
          ref={panelRef}
          className={`w-full ${maxWidthClass} rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden`}
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
            <h3 className="text-sm font-extrabold text-slate-900 tracking-tight">
              {title}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="h-9 w-9 rounded-md border border-slate-300 bg-white hover:bg-slate-50 transition"
              aria-label="Close"
            >
              <FaTimes className="mx-auto text-slate-700" />
            </button>
          </div>

          <div className="p-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

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
        <label className="block text-sm font-bold text-slate-800 mb-1 tracking-tight">
          {label} {required ? "*" : ""}
        </label>
      ) : null}

      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((s) => !s)}
        className={[
          "w-full h-10 px-3 rounded-md bg-white text-slate-900 shadow-sm border border-slate-300",
          "transition-all duration-200 ease-out hover:border-slate-400",
          "focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-700",
          "flex items-center justify-between gap-2",
          disabled ? "opacity-50 cursor-not-allowed" : "",
        ].join(" ")}
      >
        <span className="text-sm font-semibold truncate">
          {selectedItem ? getLabel(selectedItem) : <span className="text-slate-400">{placeholder}</span>}
        </span>
        <FaChevronDown className="text-slate-600" />
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
                      "w-full text-left px-3 py-2 text-sm font-semibold transition-colors",
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

const EditProperty = () => {
  const { id } = useParams();
  const location = useLocation();
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const { loading, error, currentProperty } = useSelector((state) => state.property);
  const { currentCompany } = useSelector((state) => state.company);
  const { currentUser } = useSelector((state) => state.auth);

  const landlordsFromStore =
    useSelector((state) => state?.landlord?.landlords) ||
    useSelector((state) => state?.landlords?.items) ||
    useSelector((state) => state?.landlords?.landlords) ||
    [];

  const propertiesFromStore =
    useSelector((state) => state?.property?.properties) ||
    useSelector((state) => state?.properties?.items) ||
    [];

  const [activeTab, setActiveTab] = useState("general");
  const draftStorageKey = currentCompany?._id && id ? `milik:edit-property-draft:${currentCompany._id}:${id}` : null;
  const draftRestoredRef = useRef(false);

  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    title: "",
    message: "",
    isDangerous: false,
    onConfirm: null,
  });

  const initialFormData = useMemo(
    () => ({
      dateAcquired: "",
      letManage: "Managing",
      landlords: [{ name: "", contact: "", isPrimary: true }],
      propertyCode: "",
      propertyName: "",
      lrNumber: "",
      propertyType: "",
      specification: "",
      multiStoreyType: "",
      numberOfFloors: "",
      country: "Kenya",
      townCityState: "",
      estateArea: "",
      roadStreet: "",
      zoneRegion: "",
      address: "",
      grossLettableArea: "",
      netLettableArea: "",
      unitMeasurement: "Sq Ft",
      rentPerMeasure: "",
      rentCurrency: "Kenyan Shilling [KES]",
      accountLedgerType: "Property Control Ledger In GL",
      primaryBank: "",
      alternativeTaxPin: "",
      invoicePrefix: "",
      invoicePaymentTerms: "Please pay your invoice before due date to avoid penalty.",
      mpesaPaybill: true,
      disableMpesaStkPush: false,
      mpesaNarration: "",
      standingCharges: [],
      securityDeposits: [],
      smsExemptions: {
        all: false,
        invoice: false,
        general: false,
        receipt: false,
        balance: false,
      },
      emailExemptions: {
        all: false,
        invoice: false,
        general: false,
        receipt: false,
        balance: false,
      },
      excludeFeeSummary: false,
      exemptFromLatePenalties: false,
      drawerBank: "",
      bankBranch: "",
      accountName: "",
      accountNumber: "",
      notes: "",
      specificContactInfo: "",
      description: "",
      status: "active",
      images: [],
    }),
    []
  );

  const [formData, setFormData] = useState(initialFormData);
  const [fieldErrors, setFieldErrors] = useState({});
  const [generalError, setGeneralError] = useState("");
  const [openAddLandlordModal, setOpenAddLandlordModal] = useState(false);
  const [newLandlord, setNewLandlord] = useState({
    fullName: "",
    email: "",
    phone: "",
  });

  const clearDraftState = () => {
    if (!draftStorageKey) return;
    sessionStorage.removeItem(draftStorageKey);
  };

  const tabs = [
    { id: "general", label: "General Info", icon: <FaHome /> },
    { id: "space", label: "Space/Units", icon: <FaWarehouse /> },
    { id: "accounting", label: "Accounting", icon: <FaCalculator /> },
    { id: "charges", label: "Standing Charges", icon: <FaChartBar /> },
    { id: "communications", label: "Communications", icon: <FaBell /> },
    { id: "banking", label: "Banking", icon: <FaFileInvoice /> },
    { id: "notes", label: "Notes", icon: <FaStickyNote /> },
  ];

  const propertyTypes = [
    "Residential",
    "Commercial",
    "Mixed Use",
    "Industrial",
    "Agricultural",
    "Special Purpose",
  ];

  const buildingTypes = [
    "Multi-Unit/Multi-Spa",
    "Single Storey",
    "Multi Storey",
    "High Rise",
    "Complex",
    "Estate",
  ];

  const zones = [
    "Nairobi CBD",
    "Westlands",
    "Kilimani",
    "Karen",
    "Mombasa Road",
    "Thika Road",
    "Kiambu",
    "Mombasa",
    "Kisumu",
    "Nakuru",
    "Eldoret",
  ];

  const labelClass = "block text-sm font-bold text-slate-800 mb-1 tracking-tight";
  const helperLabelClass = "block text-xs font-medium text-slate-600 mb-1";

  const baseField =
    "w-full rounded-md bg-white text-slate-900 placeholder:text-slate-400 " +
    "border border-slate-300 shadow-sm " +
    "transition-all duration-200 ease-out " +
    `focus:outline-none focus:border-slate-700 focus:ring-2 ${MILIK_ORANGE_RING} ` +
    "hover:border-slate-400";

  const inputClass = `${baseField} h-10 px-3 text-sm font-semibold`;
  const selectClass = `${baseField} h-10 px-3 text-sm font-semibold`;
  const textareaClass = `${baseField} min-h-[96px] px-3 py-2 text-sm font-semibold`;

  const sectionCard = "bg-white border border-slate-200 rounded-lg shadow-sm";
  const sectionHeader = "text-sm font-bold text-slate-900 tracking-tight";

  // Fetch property on mount
  useEffect(() => {
    if (id) {
      dispatch(getPropertyById(id));
    }
  }, [dispatch, id]);

  // Prefill form when property data loads
  useEffect(() => {
    if (currentProperty) {
      const landlordArray = Array.isArray(currentProperty.landlords)
        ? currentProperty.landlords
        : currentProperty.landlords ? [currentProperty.landlords] : [];

      const normalizedLandlords = landlordArray.length > 0
        ? landlordArray.map((landlord, index) => ({
            ...landlord,
            landlordId:
              landlord?.landlordId?._id ||
              landlord?.landlordId ||
              landlord?._id ||
              "",
            name:
              landlord?.name ||
              landlord?.landlordName ||
              landlord?.landlordId?.landlordName ||
              landlord?.landlordId?.fullName ||
              landlord?.landlordId?.name ||
              "",
            contact:
              landlord?.contact ||
              landlord?.landlordId?.email ||
              landlord?.landlordId?.phone ||
              "",
            isPrimary: index === 0 || landlord?.isPrimary === true,
          }))
        : [{ landlordId: "", name: "", contact: "", isPrimary: true }];

      const transformedData = {
        ...currentProperty,
        landlords: normalizedLandlords,
        dateAcquired: currentProperty.dateAcquired
          ? new Date(currentProperty.dateAcquired).toISOString().split('T')[0]
          : "",
        standingCharges: currentProperty.standingCharges || [],
        securityDeposits: currentProperty.securityDeposits || [],
        smsExemptions: currentProperty.smsExemptions || initialFormData.smsExemptions,
        emailExemptions: currentProperty.emailExemptions || initialFormData.emailExemptions,
      };

      let nextFormData = transformedData;
      if (draftStorageKey) {
        try {
          const savedDraft = sessionStorage.getItem(draftStorageKey);
          if (savedDraft) {
            const parsedDraft = JSON.parse(savedDraft);
            if (parsedDraft?.formData && typeof parsedDraft.formData === "object") {
              nextFormData = { ...transformedData, ...parsedDraft.formData };
            }
            if (parsedDraft?.activeTab) {
              setActiveTab(parsedDraft.activeTab);
            }
          }
        } catch (draftError) {
          console.warn("Failed to restore edit property draft", draftError);
        }
      }

      setFormData(nextFormData);
      draftRestoredRef.current = true;
    }
  }, [currentProperty, draftStorageKey, initialFormData]);

  const handleChange = (e, section = null, index = null) => {
    const { name, value, type, checked } = e.target;

    if (fieldErrors[name]) {
      setFieldErrors((prev) => ({ ...prev, [name]: "" }));
    }

    if (generalError) {
      setGeneralError("");
    }

    if (section === "landlords" && index !== null) {
      const updatedLandlords = [...formData.landlords];
      updatedLandlords[index] = {
        ...updatedLandlords[index],
        [name]: value,
        isPrimary: index === 0,
      };
      setFormData((prev) => ({ ...prev, landlords: updatedLandlords }));
      return;
    }

    if (section === "smsExemptions" || section === "emailExemptions") {
      setFormData((prev) => ({
        ...prev,
        [section]: {
          ...prev[section],
          [name]: type === "checkbox" ? checked : value,
        },
      }));
      return;
    }

    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const addStandingCharge = () => {
    setFormData((prev) => ({
      ...prev,
      standingCharges: [
        ...prev.standingCharges,
        {
          serviceCharge: "",
          chargeMode: "Monthly",
          billingCurrency: "KES",
          costPerArea: "",
          chargeValue: "",
          vatRate: "16%",
          escalatesWithRent: false,
        },
      ],
    }));
  };

  const removeStandingCharge = (index) => {
    const updatedCharges = formData.standingCharges.filter((_, i) => i !== index);
    setFormData((prev) => ({ ...prev, standingCharges: updatedCharges }));
  };

  const addSecurityDeposit = () => {
    setFormData((prev) => ({
      ...prev,
      securityDeposits: [
        ...prev.securityDeposits,
        {
          depositType: "",
          chargeMode: "Fixed Amount",
          amount: "",
          currency: "KES",
          refundable: true,
          terms: "",
        },
      ],
    }));
  };

  const removeSecurityDeposit = (index) => {
    const updatedDeposits = formData.securityDeposits.filter((_, i) => i !== index);
    setFormData((prev) => ({ ...prev, securityDeposits: updatedDeposits }));
  };

  const handleSelectLandlord = (landlordId, landlordObj) => {
    const updated = [...formData.landlords];
    const primary = updated[0] || { isPrimary: true };

    const displayName =
      landlordObj?.fullName ||
      landlordObj?.name ||
      landlordObj?.landlordName ||
      landlordObj?.landlord ||
      "";

    if (!displayName || !displayName.trim()) {
      setFieldErrors((prev) => ({ ...prev, landlord: "Landlord name is missing. Please refresh and try again." }));
      return;
    }

    const contact =
      landlordObj?.email ||
      landlordObj?.phone ||
      landlordObj?.contact ||
      "";

    updated[0] = {
      ...primary,
      landlordId,
      name: displayName.trim(),
      contact: contact,
      isPrimary: true,
    };

    setFormData((prev) => ({ ...prev, landlords: updated }));
    if (fieldErrors.landlord) {
      setFieldErrors((prev) => ({ ...prev, landlord: "" }));
    }
  };

  const validatePropertyForm = () => {
    const errors = {};

    if (!formData.dateAcquired?.trim()) {
      errors.dateAcquired = "Date acquired is required.";
    }
    if (!formData.propertyName?.trim()) {
      errors.propertyName = "Property name is required.";
    }
    if (!formData.lrNumber?.trim()) {
      errors.lrNumber = "LR number is required.";
    }
    if (!formData.propertyType?.trim()) {
      errors.propertyType = "Property type is required.";
    }
    if (!formData.landlords?.[0]?.name?.trim()) {
      errors.landlord = "Primary landlord is required.";
    }

    return errors;
  };

  const saveNewLandlordFromModal = async () => {
    if (!newLandlord.fullName.trim()) {
      toast.error("Landlord full name is required");
      return;
    }
    if (!newLandlord.email.trim()) {
      toast.error("Landlord email is required");
      return;
    }

    try {
      const tempId = `temp-${Date.now()}`;
      const created = {
        _id: tempId,
        fullName: newLandlord.fullName,
        email: newLandlord.email,
        phone: newLandlord.phone,
      };

      handleSelectLandlord(created._id, created);
      toast.success("Landlord added (temporary). Connect DB to persist.");
      setOpenAddLandlordModal(false);
      setNewLandlord({ fullName: "", email: "", phone: "" });
    } catch (err) {
      toast.error(err?.message || "Failed to add landlord");
    }
  };

  const handleSubmit = async (e) => {
    e?.preventDefault?.();

    const validationErrors = validatePropertyForm();
    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors);
      const errorMsg = Object.values(validationErrors)[0] || "Please fix highlighted fields.";
      setGeneralError(errorMsg);
      toast.error(errorMsg);
      return;
    }

    const businessId = currentCompany?._id;

    if (!businessId) {
      console.error("Company not found:", currentCompany);
      toast.error("Company information not available. Please refresh and try again.");
      return;
    }

    const cleanedFormData = { ...formData };
    const optionalEnumFields = ['specification', 'multiStoreyType', 'category'];
    optionalEnumFields.forEach(field => {
      if (cleanedFormData[field] === '') {
        delete cleanedFormData[field];
      }
    });

    const propertyData = {
      ...cleanedFormData,
      business: businessId,
      updatedBy: currentUser?._id,
    };

    try {
      setFieldErrors({});
      setGeneralError("");
      const result = await dispatch(updateProperty({ id, propertyData })).unwrap();

      await dispatch(getLandlords({ company: businessId }));

      clearDraftState();
      toast.success(result?.message || "Property updated successfully!");
      navigate("/properties");
    } catch (err) {
      console.error("Property update error:", err);

      let backendMessage = "Failed to update property";

      if (typeof err === 'string') {
        backendMessage = err;
      } else if (err?.message && err.message !== 'Unauthorized') {
        backendMessage = err.message;
      } else if (err?.error) {
        backendMessage = err.error;
      } else if (err?.data?.message) {
        backendMessage = err.data.message;
      } else if (err?.response?.data?.message) {
        backendMessage = err.response.data.message;
      }

      if (err?.fieldErrors && typeof err.fieldErrors === "object") {
        setFieldErrors((prev) => ({ ...prev, ...err.fieldErrors }));
      }

      setGeneralError(backendMessage);
      toast.error(backendMessage);
    }
  };

  const handleReset = () => {
    if (currentProperty) {
      setConfirmDialog({
        isOpen: true,
        title: "Reset Form",
        message: "Are you sure you want to reset all fields to their original values?",
        isDangerous: false,
        onConfirm: () => {
          clearDraftState();
          const landlordArray = Array.isArray(currentProperty.landlords)
            ? currentProperty.landlords
            : currentProperty.landlords ? [currentProperty.landlords] : [];

          const normalizedLandlords = landlordArray.length > 0
            ? landlordArray.map((landlord, index) => ({
                ...landlord,
                landlordId: landlord?.landlordId?._id || landlord?.landlordId || landlord?._id || "",
                name: landlord?.name || landlord?.landlordName || landlord?.landlordId?.landlordName || landlord?.landlordId?.fullName || landlord?.landlordId?.name || "",
                contact: landlord?.contact || landlord?.landlordId?.email || landlord?.landlordId?.phone || "",
                isPrimary: index === 0 || landlord?.isPrimary === true,
              }))
            : [{ landlordId: "", name: "", contact: "", isPrimary: true }];

          const transformedData = {
            ...currentProperty,
            landlords: normalizedLandlords,
            dateAcquired: currentProperty.dateAcquired
              ? new Date(currentProperty.dateAcquired).toISOString().split('T')[0]
              : "",
          };
          setFormData(transformedData);
          setActiveTab("general");
          setConfirmDialog({ ...confirmDialog, isOpen: false });
          toast.info("Form reset successfully");
        },
      });
    }
  };

  const handleNextTab = () => {
    const currentIndex = tabs.findIndex((tab) => tab.id === activeTab);
    if (currentIndex < tabs.length - 1) {
      setActiveTab(tabs[currentIndex + 1].id);
    }
  };

  const handlePreviousTab = () => {
    const currentIndex = tabs.findIndex((tab) => tab.id === activeTab);
    if (currentIndex > 0) {
      setActiveTab(tabs[currentIndex - 1].id);
    }
  };

  const isFirstTab = tabs.findIndex((tab) => tab.id === activeTab) === 0;
  const isLastTab = tabs.findIndex((tab) => tab.id === activeTab) === tabs.length - 1;

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  useEffect(() => {
    if (currentCompany?._id) {
      dispatch(getLandlords({ company: currentCompany._id }));
    }
  }, [currentCompany, dispatch]);

  useEffect(() => {
    if (!draftStorageKey || !draftRestoredRef.current) return;
    try {
      sessionStorage.setItem(
        draftStorageKey,
        JSON.stringify({
          formData,
          activeTab,
        })
      );
    } catch (draftError) {
      console.warn("Failed to persist edit property draft", draftError);
    }
  }, [activeTab, draftStorageKey, formData]);

  // RENDER FUNCTIONS - identical to AddProperties
  const renderGeneralInfo = () => {
    const landlordItems = Array.isArray(landlordsFromStore) ? landlordsFromStore : [];

    const getLandlordId = (l) => l?._id || l?.id || l?.landlordId?._id || l?.landlordId || "";
    const getLandlordLabel = (l) =>
      l?.fullName || l?.name || l?.landlordName || l?.email || "Unnamed";

    const selectedLandlordId = formData.landlords?.[0]?.landlordId?._id || formData.landlords?.[0]?.landlordId || "";

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label className={labelClass}>Date Acquired *</label>
            <input
              type="date"
              name="dateAcquired"
              value={formData.dateAcquired}
              onChange={handleChange}
              className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS} ${fieldErrors.dateAcquired ? "border-red-500 focus:border-red-500 focus:ring-red-200" : ""}`}
              required
            />
            {fieldErrors.dateAcquired && <p className="mt-1 text-xs text-red-600">{fieldErrors.dateAcquired}</p>}
          </div>

          <div>
            <MilikSelect
              label="Let/Manage"
              required
              placeholder="Select..."
              items={["Managing", "Letting", "Both"]}
              value={formData.letManage}
              onChange={(val) => handleChange({ target: { name: "letManage", value: val } })}
              getLabel={(x) => x}
              getValue={(x) => x}
            />
          </div>

          <div>
            <label className={labelClass}>Property Code</label>
            <input
              type="text"
              name="propertyCode"
              value={formData.propertyCode}
              onChange={handleChange}
              className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
              placeholder="Auto-generated"
              readOnly
            />
          </div>

          <div className="md:col-span-2">
            <label className={labelClass}>Property Name *</label>
            <input
              type="text"
              name="propertyName"
              value={formData.propertyName}
              onChange={handleChange}
              className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS} ${fieldErrors.propertyName ? "border-red-500 focus:border-red-500 focus:ring-red-200" : ""}`}
              placeholder="e.g., KITUI HEIGHTS RESIDENTIAL COMPLEX"
              required
            />
            {fieldErrors.propertyName && <p className="mt-1 text-xs text-red-600">{fieldErrors.propertyName}</p>}
          </div>

          <div>
            <label className={labelClass}>LR Number *</label>
            <input
              type="text"
              name="lrNumber"
              value={formData.lrNumber}
              onChange={handleChange}
              className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS} ${fieldErrors.lrNumber ? "border-red-500 focus:border-red-500 focus:ring-red-200" : ""}`}
              placeholder="e.g., 209/1201"
              required
            />
            {fieldErrors.lrNumber && <p className="mt-1 text-xs text-red-600">{fieldErrors.lrNumber}</p>}
          </div>

          <div>
            <MilikSelect
              label="Property Type"
              required
              placeholder="Select Type"
              items={propertyTypes}
              value={formData.propertyType}
              onChange={(val) => handleChange({ target: { name: "propertyType", value: val } })}
              getLabel={(x) => x}
              getValue={(x) => x}
              className={fieldErrors.propertyType ? "border-red-500" : ""}
            />
            {fieldErrors.propertyType && <p className="mt-1 text-xs text-red-600">{fieldErrors.propertyType}</p>}
          </div>

          <div>
            <MilikSelect
              label="Specification"
              placeholder="Select Specification"
              items={buildingTypes}
              value={formData.specification}
              onChange={(val) => handleChange({ target: { name: "specification", value: val } })}
              getLabel={(x) => x}
              getValue={(x) => x}
            />
          </div>

          <div>
            <MilikSelect
              label="Multi Storey Type"
              placeholder="Select Type"
              items={[
                { value: "Low Rise", label: "Low Rise (1-4 floors)" },
                { value: "Mid Rise", label: "Mid Rise (5-9 floors)" },
                { value: "High Rise", label: "High Rise (10+ floors)" },
              ]}
              value={formData.multiStoreyType}
              onChange={(val) => handleChange({ target: { name: "multiStoreyType", value: val } })}
              getLabel={(x) => x.label}
              getValue={(x) => x.value}
            />
          </div>

          <div>
            <label className={labelClass}>No. Of Floors</label>
            <input
              type="number"
              name="numberOfFloors"
              value={formData.numberOfFloors}
              onChange={handleChange}
              className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
              min="0"
            />
          </div>

          <div>
            <label className={labelClass}>Country</label>
            <input
              type="text"
              name="country"
              value={formData.country}
              onChange={handleChange}
              className={`${inputClass} bg-slate-50 ${MILIK_ORANGE_BORDER_FOCUS}`}
              readOnly
            />
          </div>

          <div>
            <label className={labelClass}>Town/City/State</label>
            <input
              type="text"
              name="townCityState"
              value={formData.townCityState}
              onChange={handleChange}
              className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
              placeholder="e.g., Nairobi"
            />
          </div>

          <div>
            <label className={labelClass}>Estate/Area</label>
            <input
              type="text"
              name="estateArea"
              value={formData.estateArea}
              onChange={handleChange}
              className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
              placeholder="e.g., Westlands"
            />
          </div>

          <div>
            <label className={labelClass}>Road/Street</label>
            <input
              type="text"
              name="roadStreet"
              value={formData.roadStreet}
              onChange={handleChange}
              className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
              placeholder="e.g., Moi Avenue"
            />
          </div>

          <div>
            <MilikSelect
              label="Zone/Region"
              placeholder="Select Zone"
              items={zones}
              value={formData.zoneRegion}
              onChange={(val) => handleChange({ target: { name: "zoneRegion", value: val } })}
              getLabel={(x) => x}
              getValue={(x) => x}
            />
          </div>
        </div>

        <div className={`${sectionCard} p-4`}>
          <div className="flex justify-between items-center mb-3">
            <h3 className={sectionHeader}>Landlords *</h3>
            <button
              type="button"
              onClick={() => setOpenAddLandlordModal(true)}
              className={`h-9 px-3 text-sm font-semibold ${MILIK_ORANGE_BG} text-white rounded-md flex items-center gap-2 ${MILIK_ORANGE_BG_HOVER} transition-colors`}
            >
              <FaPlus /> Add Landlord
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div>
              <MilikSelect
                label="Landlord Name"
                required
                placeholder={landlordItems.length ? "Select landlord" : "No landlords loaded"}
                items={landlordItems}
                value={selectedLandlordId}
                disabled={loading}
                getLabel={getLandlordLabel}
                getValue={getLandlordId}
                onChange={(id, obj) => handleSelectLandlord(id, obj)}
              />
              {fieldErrors.landlord && <p className="mt-1 text-xs text-red-600">{fieldErrors.landlord}</p>}
              <p className="mt-1 text-xs text-slate-500">
                Select landlord for this property.
              </p>
            </div>

            <div>
              <label className={labelClass}>Contact Information</label>
              <input
                type="text"
                name="contact"
                value={formData.landlords?.[0]?.contact || ""}
                onChange={(e) => {
                  const updated = [...formData.landlords];
                  updated[0] = { ...(updated[0] || { isPrimary: true }), contact: e.target.value, isPrimary: true };
                  setFormData((p) => ({ ...p, landlords: updated }));
                }}
                className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
                placeholder="Phone/Email"
              />
              <p className="mt-1 text-xs text-slate-500">
                Auto-fills from selected landlord.
              </p>
            </div>

            <div className="flex items-center">
              <div className="text-xs text-slate-500 italic">Primary landlord</div>
            </div>
          </div>
        </div>

        <Modal
          open={openAddLandlordModal}
          title="Add Landlord"
          onClose={() => setOpenAddLandlordModal(false)}
        >
          <div className="space-y-3">
            <div>
              <label className={labelClass}>Full Name *</label>
              <input
                value={newLandlord.fullName}
                onChange={(e) => setNewLandlord((p) => ({ ...p, fullName: e.target.value }))}
                className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
                placeholder="e.g., John Doe"
              />
            </div>

            <div>
              <label className={labelClass}>Email *</label>
              <input
                value={newLandlord.email}
                onChange={(e) => setNewLandlord((p) => ({ ...p, email: e.target.value }))}
                className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
                placeholder="e.g., john@example.com"
              />
            </div>

            <div>
              <label className={labelClass}>Phone</label>
              <input
                value={newLandlord.phone}
                onChange={(e) => setNewLandlord((p) => ({ ...p, phone: e.target.value }))}
                className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
                placeholder="e.g., +2547..."
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setOpenAddLandlordModal(false)}
                className="h-10 px-4 text-sm font-semibold border border-slate-300 rounded-md bg-white hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveNewLandlordFromModal}
                className={`h-10 px-4 text-sm font-semibold ${MILIK_ORANGE_BG} text-white rounded-md ${MILIK_ORANGE_BG_HOVER} transition`}
              >
                Save Landlord
              </button>
            </div>
          </div>
        </Modal>
      </div>
    );
  };

  const renderAccountingBilling = () => (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <MilikSelect
            label="Account Ledger Type"
            placeholder="Select Ledger Type"
            items={[
              "Property Control Ledger In GL",
              "OFF-GL (Property GL)",
            ]}
            value={formData.accountLedgerType}
            onChange={(val) => handleChange({ target: { name: "accountLedgerType", value: val } })}
            getLabel={(x) => x}
            getValue={(x) => x}
          />
        </div>

        <div>
          <label className={labelClass}>Primary Bank/Cash (Operating Account)</label>
          <input
            type="text"
            name="primaryBank"
            value={formData.primaryBank}
            onChange={handleChange}
            className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
            placeholder="Bank name and account"
          />
        </div>

        <div>
          <label className={labelClass}>Alternative Tax PIN</label>
          <input
            type="text"
            name="alternativeTaxPin"
            value={formData.alternativeTaxPin}
            onChange={handleChange}
            className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
            placeholder="e.g., A001234567Z"
          />
        </div>

        <div>
          <label className={labelClass}>Property Invoicing No. Prefix</label>
          <input
            type="text"
            name="invoicePrefix"
            value={formData.invoicePrefix}
            onChange={handleChange}
            className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
            placeholder="e.g., INV"
          />
        </div>
      </div>

      <div>
        <label className={labelClass}>Invoice Payment Terms</label>
        <textarea
          name="invoicePaymentTerms"
          value={formData.invoicePaymentTerms}
          onChange={handleChange}
          rows={4}
          className={`${textareaClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
        />
      </div>

      <div className={`${sectionCard} p-4`}>
        <h3 className={sectionHeader}>LATE PENALTY SETTING</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
          <div className="flex items-center gap-3">
            <label className={helperLabelClass}>Exempt from Late Penalties?</label>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-700 font-semibold">
                <input
                  type="radio"
                  name="exemptFromLatePenalties"
                  checked={formData.exemptFromLatePenalties}
                  onChange={() => setFormData((p) => ({ ...p, exemptFromLatePenalties: true }))}
                />
                Yes
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700 font-semibold">
                <input
                  type="radio"
                  name="exemptFromLatePenalties"
                  checked={!formData.exemptFromLatePenalties}
                  onChange={() => setFormData((p) => ({ ...p, exemptFromLatePenalties: false }))}
                />
                No
              </label>
            </div>
          </div>

          <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-3 text-xs text-amber-800">
            Automatically processed late penalties will skip this property when this option is set to Yes.
          </div>
        </div>
      </div>

      <div className={`${sectionCard} p-4`}>
        <h3 className={sectionHeader}>M-PESA RECEIPTING PREFERENCE</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
          <div className="flex items-center gap-3">
            <label className={helperLabelClass}>M-Pesa Property Paybill:</label>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-700 font-semibold">
                <input
                  type="radio"
                  name="mpesaPaybill"
                  checked={formData.mpesaPaybill}
                  onChange={() => setFormData((p) => ({ ...p, mpesaPaybill: true }))}
                />
                Yes
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700 font-semibold">
                <input
                  type="radio"
                  name="mpesaPaybill"
                  checked={!formData.mpesaPaybill}
                  onChange={() => setFormData((p) => ({ ...p, mpesaPaybill: false }))}
                />
                No
              </label>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className={helperLabelClass}>Disable Mpesa STK Push?:</label>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-700 font-semibold">
                <input
                  type="radio"
                  name="disableMpesaStkPush"
                  checked={formData.disableMpesaStkPush}
                  onChange={() => setFormData((p) => ({ ...p, disableMpesaStkPush: true }))}
                />
                Yes
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700 font-semibold">
                <input
                  type="radio"
                  name="disableMpesaStkPush"
                  checked={!formData.disableMpesaStkPush}
                  onChange={() => setFormData((p) => ({ ...p, disableMpesaStkPush: false }))}
                />
                No
              </label>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <label className={labelClass}>Disable Mpesa STK Push Narration</label>
          <input
            type="text"
            name="mpesaNarration"
            value={formData.mpesaNarration}
            onChange={handleChange}
            className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
          />
        </div>
      </div>
    </div>
  );

  const renderSpaceUnits = () => (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <div>
          <label className={labelClass}>Gross Lettable Area</label>
          <input
            type="number"
            name="grossLettableArea"
            value={formData.grossLettableArea}
            onChange={handleChange}
            className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
            placeholder="0"
            step="0.01"
          />
        </div>

        <div>
          <label className={labelClass}>Net Lettable Area</label>
          <input
            type="number"
            name="netLettableArea"
            value={formData.netLettableArea}
            onChange={handleChange}
            className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
            placeholder="0"
            step="0.01"
          />
        </div>

        <div>
          <MilikSelect
            label="Unit Measurement"
            placeholder="Select Measurement"
            items={["Sq Ft", "Sq M", "Acres", "Hectares"]}
            value={formData.unitMeasurement}
            onChange={(val) => handleChange({ target: { name: "unitMeasurement", value: val } })}
            getLabel={(x) => x}
            getValue={(x) => x}
          />
        </div>

        <div>
          <label className={labelClass}>Rent Per Measure</label>
          <input
            type="number"
            name="rentPerMeasure"
            value={formData.rentPerMeasure}
            onChange={handleChange}
            className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
            placeholder="0.00"
            step="0.01"
          />
        </div>

        <div>
          <MilikSelect
            label="Rent Currency"
            placeholder="Select Currency"
            items={[
              "Kenyan Shilling [KES]",
              "US Dollar [USD]",
              "Euro [EUR]",
              "British Pound [GBP]",
            ]}
            value={formData.rentCurrency}
            onChange={(val) => handleChange({ target: { name: "rentCurrency", value: val } })}
            getLabel={(x) => x}
            getValue={(x) => x}
          />
        </div>
      </div>
    </div>
  );

  const renderStandingCharges = () => (
    <div className="space-y-6">
      <div className={`${sectionCard} p-4`}>
        <div className="flex justify-between items-center mb-3">
          <h3 className={sectionHeader}>DEFAULT STANDING CHARGES</h3>
          <button
            type="button"
            onClick={addStandingCharge}
            className={`h-9 px-3 text-sm font-semibold ${MILIK_ORANGE_BG} text-white rounded-md flex items-center gap-2 ${MILIK_ORANGE_BG_HOVER} transition-colors`}
          >
            <FaPlus /> Add Standing Charge
          </button>
        </div>

        <div className="space-y-3">
          {formData.standingCharges.map((charge, index) => (
            <div
              key={index}
              className="grid grid-cols-1 md:grid-cols-7 gap-3 items-end p-3 border border-slate-200 rounded-lg bg-slate-50/40"
            >
              <div>
                <MilikSelect
                  label="Service Charge/Utility"
                  placeholder="Select Type"
                  items={["Water", "Garbage", "Electricity", "Service Charge", "Security", "Others"]}
                  value={charge.serviceCharge}
                  onChange={(val) => {
                    const updated = [...formData.standingCharges];
                    updated[index].serviceCharge = val;
                    setFormData((p) => ({ ...p, standingCharges: updated }));
                  }}
                  getLabel={(x) => x}
                  getValue={(x) => x}
                />
              </div>

              <div>
                <MilikSelect
                  label="Charge Mode"
                  placeholder="Select Mode"
                  items={["Monthly", "Quarterly", "Annual", "One-time"]}
                  value={charge.chargeMode}
                  onChange={(val) => {
                    const updated = [...formData.standingCharges];
                    updated[index].chargeMode = val;
                    setFormData((p) => ({ ...p, standingCharges: updated }));
                  }}
                  getLabel={(x) => x}
                  getValue={(x) => x}
                />
              </div>

              <div>
                <MilikSelect
                  label="Billing Currency"
                  placeholder="Select Currency"
                  items={["KES", "USD"]}
                  value={charge.billingCurrency}
                  onChange={(val) => {
                    const updated = [...formData.standingCharges];
                    updated[index].billingCurrency = val;
                    setFormData((p) => ({ ...p, standingCharges: updated }));
                  }}
                  getLabel={(x) => x}
                  getValue={(x) => x}
                />
              </div>

              <div>
                <label className={labelClass}>Cost Per Area</label>
                <input
                  type="text"
                  value={charge.costPerArea}
                  onChange={(e) => {
                    const updated = [...formData.standingCharges];
                    updated[index].costPerArea = e.target.value;
                    setFormData((p) => ({ ...p, standingCharges: updated }));
                  }}
                  className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
                  placeholder="e.g., 50"
                />
              </div>

              <div>
                <label className={labelClass}>Charge Value</label>
                <input
                  type="number"
                  value={charge.chargeValue}
                  onChange={(e) => {
                    const updated = [...formData.standingCharges];
                    updated[index].chargeValue = e.target.value;
                    setFormData((p) => ({ ...p, standingCharges: updated }));
                  }}
                  className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
                  placeholder="0.00"
                />
              </div>

              <div>
                <MilikSelect
                  label="VAT Rate"
                  placeholder="Select Rate"
                  items={["0%", "8%", "16%"]}
                  value={charge.vatRate}
                  onChange={(val) => {
                    const updated = [...formData.standingCharges];
                    updated[index].vatRate = val;
                    setFormData((p) => ({ ...p, standingCharges: updated }));
                  }}
                  getLabel={(x) => x}
                  getValue={(x) => x}
                />
              </div>

              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={charge.escalatesWithRent}
                    onChange={(e) => {
                      const updated = [...formData.standingCharges];
                      updated[index].escalatesWithRent = e.target.checked;
                      setFormData((p) => ({ ...p, standingCharges: updated }));
                    }}
                  />
                  Escalates?
                </label>

                {index > 0 && (
                  <button
                    type="button"
                    onClick={() => removeStandingCharge(index)}
                    className="h-9 w-9 flex items-center justify-center rounded-md bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
                    title="Remove"
                  >
                    <FaTrash />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={`${sectionCard} p-4`}>
        <div className="flex justify-between items-center mb-3">
          <h3 className={sectionHeader}>DEFAULT SECURITY DEPOSIT</h3>
          <button
            type="button"
            onClick={addSecurityDeposit}
            className={`h-9 px-3 text-sm font-semibold ${MILIK_ORANGE_BG} text-white rounded-md flex items-center gap-2 ${MILIK_ORANGE_BG_HOVER} transition-colors`}
          >
            <FaPlus /> Add Security Deposit
          </button>
        </div>

        <div className="space-y-3">
          {formData.securityDeposits.map((deposit, index) => (
            <div
              key={index}
              className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end p-3 border border-slate-200 rounded-lg bg-slate-50/40">
              <div>
                <MilikSelect
                  label="Deposit Type"
                  placeholder="Select Type"
                  items={[
                    "Rent Security Deposit",
                    "Water Security Deposit",
                    "Electricity Security Deposit",
                    "Others"
                  ]}
                  value={deposit.depositType}
                  onChange={(val) => {
                    const updated = [...formData.securityDeposits];
                    updated[index].depositType = val;
                    setFormData((p) => ({ ...p, securityDeposits: updated }));
                  }}
                  getLabel={(x) => x}
                  getValue={(x) => x}
                />
              </div>

              <div>
                <MilikSelect
                  label="Charge Mode"
                  placeholder="Select Mode"
                  items={["Percentage", "Fixed Amount"]}
                  value={deposit.chargeMode}
                  onChange={(val) => {
                    const updated = [...formData.securityDeposits];
                    updated[index].chargeMode = val;
                    setFormData((p) => ({ ...p, securityDeposits: updated }));
                  }}
                  getLabel={(x) => x}
                  getValue={(x) => x}
                />
              </div>

              <div>
                <label className={labelClass}>
                  {deposit.chargeMode === "Percentage" ? "Percentage (% of rent)" : "Amount"}
                </label>
                <input
                  type="number"
                  value={deposit.amount}
                  onChange={(e) => {
                    const updated = [...formData.securityDeposits];
                    updated[index].amount = e.target.value;
                    setFormData((p) => ({ ...p, securityDeposits: updated }));
                  }}
                  className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
                  placeholder={deposit.chargeMode === "Percentage" ? "e.g., 100 (for 100%)" : "0.00"}
                  step={deposit.chargeMode === "Percentage" ? "1" : "0.01"}
                  min="0"
                  max={deposit.chargeMode === "Percentage" ? "1000" : undefined}
                />
              </div>

              <div>
                <MilikSelect
                  label="Currency"
                  placeholder="Select Currency"
                  items={["KES", "USD"]}
                  value={deposit.currency}
                  onChange={(val) => {
                    const updated = [...formData.securityDeposits];
                    updated[index].currency = val;
                    setFormData((p) => ({ ...p, securityDeposits: updated }));
                  }}
                  getLabel={(x) => x}
                  getValue={(x) => x}
                />
              </div>

              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={deposit.refundable}
                    onChange={(e) => {
                      const updated = [...formData.securityDeposits];
                      updated[index].refundable = e.target.checked;
                      setFormData((p) => ({ ...p, securityDeposits: updated }));
                    }}
                  />
                  Refundable
                </label>
              </div>

              <div className="flex">
                <button
                  type="button"
                  onClick={() => removeSecurityDeposit(index)}
                  className="h-9 w-9 flex items-center justify-center rounded-md bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
                  title="Remove"
                >
                  <FaTrash />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderCommunications = () => (
    <div className="space-y-5">
      <div className={`${sectionCard} p-4`}>
        <h3 className={sectionHeader}>SMS EXEMPTION</h3>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-3">
          {Object.entries(formData.smsExemptions).map(([key, value]) => (
            <label key={key} className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                name={key}
                checked={value}
                onChange={(e) => handleChange(e, "smsExemptions")}
              />
              {key === "all" ? "Exempt All SMS" : `Exempt ${key} SMS`}
            </label>
          ))}
        </div>
      </div>

      <div className={`${sectionCard} p-4`}>
        <h3 className={sectionHeader}>EMAIL EXEMPTION</h3>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-3">
          {Object.entries(formData.emailExemptions).map(([key, value]) => (
            <label key={key} className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                name={key}
                checked={value}
                onChange={(e) => handleChange(e, "emailExemptions")}
              />
              {key === "all" ? "Exempt All Email" : `Exempt ${key} Email`}
            </label>
          ))}
        </div>
      </div>
    </div>
  );

  const renderBanking = () => (
    <div className="space-y-5">
      <div className={`${sectionCard} p-4`}>
        <h3 className={sectionHeader}>LANDLORD DRAWER BANKING DETAILS</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <div>
            <label className={labelClass}>Drawer Bank</label>
            <input
              type="text"
              name="drawerBank"
              value={formData.drawerBank}
              onChange={handleChange}
              className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
              placeholder="Bank Name"
            />
          </div>

          <div>
            <label className={labelClass}>Bank Branch</label>
            <input
              type="text"
              name="bankBranch"
              value={formData.bankBranch}
              onChange={handleChange}
              className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
              placeholder="Branch Name"
            />
          </div>

          <div>
            <label className={labelClass}>Account Name</label>
            <input
              type="text"
              name="accountName"
              value={formData.accountName}
              onChange={handleChange}
              className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
              placeholder="Account Holder Name"
            />
          </div>

          <div>
            <label className={labelClass}>Account Number</label>
            <input
              type="text"
              name="accountNumber"
              value={formData.accountNumber}
              onChange={handleChange}
              className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
              placeholder="Account Number"
            />
          </div>
        </div>
      </div>
    </div>
  );

  const renderNotes = () => (
    <div className="space-y-5">
      <div className={`${sectionCard} p-4`}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <label className={labelClass}>Exclude In Fee Summary Report:</label>
            <p className="text-xs text-slate-600">
              Choose whether to exclude this property in fee summary reports.
            </p>
          </div>

          <div className="flex items-center gap-5">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input
                type="radio"
                name="excludeFeeSummary"
                checked={formData.excludeFeeSummary}
                onChange={() => setFormData((p) => ({ ...p, excludeFeeSummary: true }))}
              />
              Yes
            </label>

            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input
                type="radio"
                name="excludeFeeSummary"
                checked={!formData.excludeFeeSummary}
                onChange={() => setFormData((p) => ({ ...p, excludeFeeSummary: false }))}
              />
              No
            </label>
          </div>
        </div>

        <div className="mt-4">
          <label className={labelClass}>Notes/Description</label>
          <textarea
            name="notes"
            value={formData.notes}
            onChange={handleChange}
            rows={5}
            className={`${textareaClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
            placeholder="Enter any additional notes or descriptions about the property..."
          />
        </div>

        <div className="mt-4">
          <label className={labelClass}>Specific Contact Info</label>
          <textarea
            name="specificContactInfo"
            value={formData.specificContactInfo}
            onChange={handleChange}
            rows={3}
            className={`${textareaClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
            placeholder="Enter specific contact information..."
          />
        </div>
      </div>
    </div>
  );

  const renderContent = () => {
    switch (activeTab) {
      case "general":
        return renderGeneralInfo();
      case "space":
        return renderSpaceUnits();
      case "accounting":
        return renderAccountingBilling();
      case "charges":
        return renderStandingCharges();
      case "communications":
        return renderCommunications();
      case "banking":
        return renderBanking();
      case "notes":
        return renderNotes();
      default:
        return (
          <div className={`${sectionCard} p-10 text-center`}>
            <FaBuilding className="text-4xl mx-auto mb-3 text-slate-300" />
            <p className="text-sm font-semibold text-slate-700">This section is under development</p>
            <p className="text-xs mt-1 text-slate-500">Coming soon...</p>
          </div>
        );
    }
  };

  if (!formData || formData === initialFormData) {
    return (
      <DashboardLayout>
        <div className="flex justify-center items-center h-full">
          <p className="text-sm font-semibold text-slate-600">Loading property details...</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <>
      <DashboardLayout>
      <style>{`
        select {
          accent-color: #ea580c;
        }
        
        input[type="checkbox"] {
          accent-color: #ea580c;
          width: 18px;
          height: 18px;
          cursor: pointer;
        }
        
        select option {
          background-color: white;
          color: #1e293b;
        }
        
        select option:hover,
        select option:focus,
        select option:active,
        select option:checked {
          background-color: #ea580c !important;
          background: #ea580c !important;
          color: white !important;
          outline: none !important;
        }
      `}</style>
      <div className="p-3 w-full h-full overflow-y-auto bg-slate-50">
        {/* Header */}
        <div className="flex justify-between items-center mb-3">
          <div>
            <h1 className="text-lg font-extrabold text-slate-900 tracking-tight">
              Edit Property
            </h1>
            <p className="text-sm text-slate-600">{formData.propertyName || "Property Details"}</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                clearDraftState();
                navigate("/properties");
              }}
              className="h-10 px-4 text-sm font-semibold border border-slate-300 rounded-md bg-white hover:bg-slate-50 transition-colors"
              disabled={loading}
            >
              <FaTimes className="inline-block mr-2" />
              Cancel
            </button>
          </div>
        </div>

        {/* Tabs Navigation */}
        <div className="border-b border-slate-200 mb-3">
          <div className="flex flex-wrap gap-2">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  disabled={loading}
                  className={[
                    "h-10 px-4 text-sm font-bold flex items-center gap-2 rounded-t-md transition-all duration-200",
                    isActive
                      ? `${MILIK_ORANGE_BG} text-white shadow-sm border-b-2 border-orange-700`
                      : "text-slate-700 hover:bg-slate-100",
                    loading ? "opacity-50 cursor-not-allowed" : "",
                  ].join(" ")}
                >
                  <span className="text-base">{tab.icon}</span>
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Form Content */}
        <div className={`${sectionCard}`}>
          <div className="p-4">
            <form id="edit-property-form" onSubmit={handleSubmit}>{renderContent()}</form>
          </div>
        </div>

        {fieldErrors.business && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {fieldErrors.business}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-between items-center mt-4">
          <div className="text-xs text-slate-500">Fields marked with * are required</div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                clearDraftState();
                navigate("/properties");
              }}
              disabled={loading}
              className="h-10 px-5 text-sm font-semibold border border-slate-300 rounded-md bg-white hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleReset}
              disabled={loading}
              className="h-10 px-5 text-sm font-semibold border border-slate-300 rounded-md bg-white hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              Reset
            </button>

            {!isFirstTab && (
              <button
                type="button"
                onClick={handlePreviousTab}
                disabled={loading}
                className="h-10 px-5 text-sm font-semibold border border-slate-300 rounded-md bg-white hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Previous
              </button>
            )}

            {!isLastTab ? (
              <button
                type="button"
                onClick={handleNextTab}
                disabled={loading}
                className={`h-10 px-5 text-sm font-semibold ${MILIK_ORANGE_BG} text-white rounded-md ${MILIK_ORANGE_BG_HOVER} transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                Next
              </button>
            ) : (
              <button
                type="submit"
                form="edit-property-form"
                disabled={loading}
                className="h-10 px-5 text-sm font-semibold bg-emerald-600 text-white rounded-md hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <FaSpinner className="inline-block mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <FaSave className="inline-block mr-2" />
                    Update Property
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
      </DashboardLayout>

      {/* Milik Confirm Dialog */}
      <MilikConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmText={confirmDialog.isDangerous ? "Delete" : "Yes, Proceed"}
        cancelText="Cancel"
        isDangerous={confirmDialog.isDangerous}
        onConfirm={() => confirmDialog.onConfirm?.()}
        onCancel={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}
      />

      {/* Fixed Error Display - Bottom Left */}
      {generalError && (
        <div className="fixed bottom-4 left-4 z-50 max-w-md animate-in slide-in-from-left-5">
          <div className="bg-red-50 border-l-4 border-red-500 rounded-md shadow-lg p-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0">
                <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-red-800">Error</h3>
                <p className="mt-1 text-sm text-red-700">{generalError}</p>
              </div>
              <button
                onClick={() => setGeneralError("")}
                className="flex-shrink-0 text-red-500 hover:text-red-700 transition-colors"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default EditProperty;