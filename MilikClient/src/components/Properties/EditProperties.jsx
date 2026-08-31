// components/Properties/EditProperties.jsx - COMPLETE EDIT FORM WITH FULL FUNCTIONALITY
import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
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
  FaArrowLeft,
} from "react-icons/fa";
import { getPropertyById, updateProperty, clearCurrentProperty } from "../../redux/propertyRedux";
import { getLandlords } from "../../redux/apiCalls";
import { selectCurrentCompany, selectCurrentUser, selectActiveLandlords, selectAllProperties, selectPropertyLoading, selectPropertyError, selectCurrentProperty } from "../../redux/selectors";
import { adminRequests } from "../../utils/requestMethods";
import { toast } from "react-toastify";
import MilikConfirmDialog from "../Modals/MilikConfirmDialog";
import { getCompanyOperatingModeLabel, isSelfManagingLandlordCompany } from "../../utils/companyModules";
import { useTerms } from "../../hooks/useTerm";
const PropertyMapPicker = lazy(() => import("../common/PropertyMapPicker"));

const MILIK_ORANGE_BG = "bg-orange-600";
const MILIK_ORANGE_BG_HOVER = "hover:bg-orange-700";
const MILIK_ORANGE_RING = "focus:ring-orange-500/30";
const MILIK_ORANGE_BORDER_FOCUS = "focus:border-orange-500";

const normalizePropertyServiceMode = (value = "Managing") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "letting") return "Letting";
  if (normalized === "both") return "Both";
  return "Managing";
};

const hasLettingFee = (mode) => {
  const v = String(mode || "").trim().toLowerCase();
  return v === "letting" || v === "both";
};

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
        <label className="mb-0.5 block text-xs font-semibold text-slate-700">
          {label} {required ? "*" : ""}
        </label>
      ) : null}

      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((s) => !s)}
        className={[
          "w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition",
          "focus:border-orange-500 focus:ring-1 focus:ring-orange-500/20",
          "flex items-center justify-between gap-2",
          disabled ? "opacity-50 cursor-not-allowed" : "",
        ].join(" ")}
      >
        <span className="text-xs truncate">
          {selectedItem ? getLabel(selectedItem) : <span className="text-slate-400">{placeholder}</span>}
        </span>
        <FaChevronDown className="text-slate-500 text-[10px]" />
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

const EditProperty = () => {
  const { id } = useParams();
  const location = useLocation();
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const loading = useSelector(selectPropertyLoading);
  const error = useSelector(selectPropertyError);
  const currentProperty = useSelector(selectCurrentProperty);
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const {
    property: termProperty,
    properties: termProperties,
    unit: termUnit,
    units: termUnits,
    landlord: termLandlord,
    landlords: termLandlords,
    tenant: termTenant,
    rent: termRent,
    meter: termMeter,
    utility: termUtility,
    invoice: termInvoice,
    invoices: termInvoices,
    receipts: termReceipts,
  } = useTerms("property", "properties", "unit", "units", "landlord", "landlords", "tenant", "rent", "meter", "utility", "invoice", "invoices", "receipts");

  const activeCompanyContext = currentCompany || currentUser?.company || null;
  const isSelfManagingLandlordMode = isSelfManagingLandlordCompany(activeCompanyContext);
  const [zones, setZones] = useState([]);
  const operatingModeLabel = getCompanyOperatingModeLabel(activeCompanyContext?.companyMode);
  const ownerCompanyName = activeCompanyContext?.companyName || "Current company";
  const ownerPrimaryContact =
    activeCompanyContext?.email ||
    activeCompanyContext?.phoneNo ||
    activeCompanyContext?.slogan ||
    "";

  const landlordsFromStore = useSelector(selectActiveLandlords);
  const propertiesFromStore = useSelector(selectAllProperties);

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
      letManage: normalizePropertyServiceMode("Managing"),
      lettingFeeMode: "percentage",
      lettingFeeValue: 100,
      landlords: [{ name: "", contact: "", isPrimary: true }],
      propertyCode: "",
      propertyName: "",
      propertyType: "",
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
      accountLedgerType: "in-gl",
      propertyLedgerEnabled: false,
      primaryBank: "",
      alternativeTaxPin: "",
      invoicePrefix: "",
      invoicePaymentTerms: "Please pay your invoice before due date to avoid penalty.",
      mpesaPaybill: true,
      disableMpesaStkPush: false,
      mpesaNarration: "",
      standingCharges: [],
      securityDeposits: [],
      utilityRates: [],
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
      listingEnabled: false,
      amenities: "",
      yearBuilt: "",
      videoUrl: "",
      virtualTourUrl: "",
      listingContact: { name: "", phone: "", whatsapp: "", email: "", preferredMethod: "phone" },
      nearbyPoints: [],
      coordinates: { lat: "", lng: "" },
    }),
    []
  );

  const [formData, setFormData] = useState(initialFormData);
  const [fieldErrors, setFieldErrors] = useState({});

  const [generalError, setGeneralError] = useState("");
  const [utilityTypeOptions, setUtilityTypeOptions] = useState([]);
  const [utilityTypeOptionsLoading, setUtilityTypeOptionsLoading] = useState(false);
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

  const tabs = useMemo(() => [
    { id: "general", label: "General Info", icon: <FaHome /> },
    { id: "space", label: `Space/${termUnits}`, icon: <FaWarehouse /> },
    { id: "accounting", label: "Accounting", icon: <FaCalculator /> },
    { id: "utilityRates", label: `${termMeter} Reading Rates`, icon: <FaCog /> },
    { id: "notes", label: "Listing & Notes", icon: <FaStickyNote /> },
  ], []);

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

  const labelClass = "mb-0.5 block text-xs font-semibold text-slate-700";
  const helperLabelClass = "block text-xs font-medium text-slate-600 mb-1";

  const inputClass = "w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-orange-500 focus:ring-1 focus:ring-orange-500/20";
  const textareaClass = "w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-orange-500 focus:ring-1 focus:ring-orange-500/20 min-h-[80px]";

  const sectionCard = "overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm";
  const sectionHeader = "text-[11px] font-bold uppercase tracking-wide text-slate-700";

  useEffect(() => {
    adminRequests.get('/zones', { params: { limit: 500, isActive: 'true' } })
      .then((res) => setZones((res.data?.zones || []).map((z) => z.name).filter(Boolean)))
      .catch(() => {});
  }, []);

  // Fetch property on mount, clear on unmount
  useEffect(() => {
    if (id) {
      dispatch(clearCurrentProperty());
      dispatch(getPropertyById(id));
    }
    return () => {
      dispatch(clearCurrentProperty());
    };
  }, [dispatch, id]);

  // Prefill form when property data loads
  useEffect(() => {
    if (!currentProperty) return;
    try {
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

      let parsedDate = "";
      try {
        if (currentProperty.dateAcquired) {
          const d = new Date(currentProperty.dateAcquired);
          if (!isNaN(d.getTime())) parsedDate = d.toISOString().split('T')[0];
        }
      } catch (_) {}

      const transformedData = {
        ...currentProperty,
        landlords: normalizedLandlords,
        dateAcquired: parsedDate,
        standingCharges: currentProperty.standingCharges || [],
        securityDeposits: currentProperty.securityDeposits || [],
        utilityRates: currentProperty.utilityRates || [],
        smsExemptions: currentProperty.smsExemptions || initialFormData.smsExemptions,
        emailExemptions: currentProperty.emailExemptions || initialFormData.emailExemptions,
        lettingFeeMode: currentProperty.lettingFeeMode || "percentage",
        lettingFeeValue: currentProperty.lettingFeeValue ?? 100,
        amenities: Array.isArray(currentProperty.amenities) ? currentProperty.amenities.join(", ") : "",
        yearBuilt: currentProperty.yearBuilt ?? "",
        listingContact: {
          ...initialFormData.listingContact,
          ...(currentProperty.listingContact || {}),
        },
        nearbyPoints: Array.isArray(currentProperty.nearbyPoints) ? currentProperty.nearbyPoints : [],
        coordinates: {
          lat: currentProperty.coordinates?.lat ?? "",
          lng: currentProperty.coordinates?.lng ?? "",
        },
      };

      let nextFormData = transformedData;
      if (draftStorageKey) {
        try {
          const savedDraft = sessionStorage.getItem(draftStorageKey);
          if (savedDraft) {
            const parsedDraft = JSON.parse(savedDraft);
            if (parsedDraft?.formData && typeof parsedDraft.formData === "object") {
              // Only restore draft fields that are non-empty to prevent stale/empty drafts from clearing API data.
              // Landlords are excluded if the draft has no valid landlordId — always prefer the server's landlord data.
              const safeDraft = Object.fromEntries(
                Object.entries(parsedDraft.formData).filter(([key, v]) => {
                  if (v === null || v === undefined || v === "") return false;
                  if (key === 'landlords' && Array.isArray(v) && !v[0]?.landlordId) return false;
                  return true;
                })
              );
              nextFormData = { ...transformedData, ...safeDraft };
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
    } catch (prefillError) {
      console.error("Failed to prefill edit property form:", prefillError);
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

    setFormData((prev) => {
      const fieldValue = type === "checkbox" ? checked : value;
      const next = { ...prev, [name]: fieldValue };
      // Keep tenantsPaysTo and depositHeldBy in sync with the selected service mode.
      if (name === "letManage") {
        const v = String(fieldValue).toLowerCase();
        if (v === "letting") {
          next.tenantsPaysTo = "landlord";
          next.depositHeldBy = "landlord";
        } else if (v === "managing") {
          next.lettingFeeMode = "percentage";
          next.lettingFeeValue = 100;
        }
        // "Both": leave tenantsPaysTo / depositHeldBy unchanged so user keeps their settings
      }
      return next;
    });
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

  const addUtilityRate = () => {
    setFormData((prev) => ({
      ...prev,
      utilityRates: [
        ...prev.utilityRates,
        { utilityType: "", unitCost: 0, billingCycle: "monthly", isActive: true },
      ],
    }));
  };

  const addNearbyPoint = () => {
    setFormData((prev) => ({
      ...prev,
      nearbyPoints: [...prev.nearbyPoints, { category: "road", label: "", distance: "" }],
    }));
  };

  const removeNearbyPoint = (index) => {
    setFormData((prev) => ({
      ...prev,
      nearbyPoints: prev.nearbyPoints.filter((_, i) => i !== index),
    }));
  };

  const updateNearbyPoint = (index, field, value) => {
    setFormData((prev) => {
      const updated = [...prev.nearbyPoints];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, nearbyPoints: updated };
    });
  };

  const handleListingContactChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      listingContact: { ...prev.listingContact, [field]: value },
    }));
  };

  const handleCoordinateChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      coordinates: { ...prev.coordinates, [field]: value },
    }));
  };

  const removeUtilityRate = (index) => {
    setFormData((prev) => ({
      ...prev,
      utilityRates: prev.utilityRates.filter((_, i) => i !== index),
    }));
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
      setFieldErrors((prev) => ({ ...prev, landlord: `${termLandlord} name is missing. Please refresh and try again.` }));
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

    if (!formData.propertyName?.trim()) {
      errors.propertyName = `${termProperty} name is required.`;
    }
    if (!formData.propertyType?.trim()) {
      errors.propertyType = `${termProperty} type is required.`;
    }
    if (!isSelfManagingLandlordMode && !formData.landlords?.[0]?.name?.trim()) {
      errors.landlord = "Primary landlord is required.";
    }

    return errors;
  };

  const saveNewLandlordFromModal = async () => {
    if (!newLandlord.fullName.trim()) {
      toast.error(`${termLandlord} full name is required`);
      return;
    }
    if (!newLandlord.email.trim()) {
      toast.error(`${termLandlord} email is required`);
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
      toast.success(`${termLandlord} added (temporary). Connect DB to persist.`);
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
    delete cleanedFormData.lrNumber;
    delete cleanedFormData.specification;
    delete cleanedFormData.multiStoreyType;
    // Images are managed exclusively via /properties/:id/images — never send
    // the stale in-memory snapshot back through the main update payload.
    delete cleanedFormData.images;
    const optionalEnumFields = ['category'];
    optionalEnumFields.forEach(field => {
      if (cleanedFormData[field] === '') {
        delete cleanedFormData[field];
      }
    });

    const propertyData = {
      ...cleanedFormData,
      business: businessId,
      updatedBy: currentUser?._id,
      landlords: isSelfManagingLandlordMode ? [] : cleanedFormData.landlords,
      tenantsPaysTo: isSelfManagingLandlordMode ? "landlord" : cleanedFormData.tenantsPaysTo,
      depositHeldBy: isSelfManagingLandlordMode ? "landlord" : cleanedFormData.depositHeldBy,
      amenities: formData.amenities
        ? formData.amenities.split(",").map((a) => a.trim()).filter(Boolean)
        : [],
      yearBuilt: formData.yearBuilt === "" ? null : Number(formData.yearBuilt),
      coordinates: {
        lat: formData.coordinates?.lat === "" ? null : Number(formData.coordinates?.lat),
        lng: formData.coordinates?.lng === "" ? null : Number(formData.coordinates?.lng),
      },
    };

    try {
      setFieldErrors({});
      setGeneralError("");
      const result = await dispatch(updateProperty({ id, propertyData })).unwrap();

      await dispatch(getLandlords({ company: businessId }));

      clearDraftState();
      toast.success(result?.message || `${termProperty} updated successfully!`);
      navigate("/properties");
    } catch (err) {
      console.error("Property update error:", err);

      let backendMessage = `Failed to update ${termProperty.toLowerCase()}`;

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
    if (isSelfManagingLandlordMode && fieldErrors.landlord) {
      setFieldErrors((prev) => ({ ...prev, landlord: "" }));
    }
  }, [fieldErrors.landlord, isSelfManagingLandlordMode]);

  useEffect(() => {
    if (currentCompany?._id && !isSelfManagingLandlordMode) {
      dispatch(getLandlords({ company: currentCompany._id }));
    }
  }, [currentCompany, dispatch, isSelfManagingLandlordMode]);

  useEffect(() => {
    if (activeTab !== "utilityRates" || !currentCompany?._id) return;
    let cancelled = false;
    setUtilityTypeOptionsLoading(true);
    adminRequests
      .get(`/company-settings/${currentCompany._id}`)
      .then((res) => {
        if (!cancelled) {
          setUtilityTypeOptions(
            (Array.isArray(res?.data?.utilityTypes) ? res.data.utilityTypes : []).filter(
              (u) => u?.isActive !== false
            )
          );
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setUtilityTypeOptionsLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab, currentCompany?._id]);

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

    const getLandlordId = (l) => {
      const raw = l?._id || l?.id || l?.landlordId?._id || l?.landlordId;
      return raw ? String(raw) : "";
    };
    const getLandlordLabel = (l) =>
      l?.fullName || l?.name || l?.landlordName || l?.email || "Unnamed";

    const _rawLandlordId = formData.landlords?.[0]?.landlordId?._id || formData.landlords?.[0]?.landlordId;
    const selectedLandlordId = _rawLandlordId ? String(_rawLandlordId) : "";

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label className={labelClass}>Date Acquired</label>
            <input
              type="date"
              name="dateAcquired"
              value={formData.dateAcquired}
              onChange={handleChange}
              className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
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
            {formData.letManage === "Letting" && (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <span className="font-bold">Letting only:</span> {termTenant} pays {termRent.toLowerCase()} directly to the {termLandlord.toLowerCase()}. Deposit held by {termLandlord.toLowerCase()}. A one-time letting fee is charged when placing a {termTenant.toLowerCase()}. {termLandlord} statements and disbursements are not available.
              </div>
            )}
            {formData.letManage === "Both" && (
              <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                <span className="font-bold">Let &amp; Manage:</span> Charge a one-time letting fee when placing a tenant, then continue managing the property with ongoing commission and landlord statements.
              </div>
            )}
          </div>

          {hasLettingFee(formData.letManage) && (
            <div className="md:col-span-1 lg:col-span-1">
              <label className={labelClass}>Letting Fee Mode</label>
              <select
                name="lettingFeeMode"
                value={formData.lettingFeeMode}
                onChange={handleChange}
                className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
              >
                <option value="percentage">Percentage of {termRent}</option>
                <option value="fixed">Fixed amount</option>
              </select>
            </div>
          )}

          {hasLettingFee(formData.letManage) && (
            <div className="md:col-span-1 lg:col-span-1">
              <label className={labelClass}>
                Letting Fee {formData.lettingFeeMode === "percentage" ? "(%)" : "(Fixed)"}
              </label>
              <input
                type="number"
                name="lettingFeeValue"
                value={formData.lettingFeeValue}
                onChange={handleChange}
                min="0"
                step={formData.lettingFeeMode === "percentage" ? "0.5" : "1"}
                className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
                placeholder={formData.lettingFeeMode === "percentage" ? "e.g. 100 = 1 month" : "e.g. 5000"}
              />
              <p className="mt-1 text-xs text-gray-500">
                {formData.lettingFeeMode === "percentage"
                  ? `${formData.lettingFeeValue || 0}% of the tenant's monthly rent`
                  : `Fixed fee of ${Number(formData.lettingFeeValue || 0).toLocaleString()} charged per tenant placed`}
              </p>
            </div>
          )}

          <div>
            <label className={labelClass}>{termProperty} Code</label>
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
            <label className={labelClass}>{termProperty} Name *</label>
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
            <MilikSelect
              label={`${termProperty} Type`}
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

        {isSelfManagingLandlordMode ? (
          <div className={`${sectionCard} p-4`}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className={sectionHeader}>Ownership</h3>
                <p className="mt-1 text-xs text-slate-500">
                  This property stays linked to the active self-managing landlord company automatically.
                </p>
              </div>
              <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700">
                Auto owner
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className={labelClass}>Owner Company</label>
                <input
                  type="text"
                  value={ownerCompanyName}
                  readOnly
                  className={`${inputClass} bg-slate-50 ${MILIK_ORANGE_BORDER_FOCUS}`}
                />
              </div>

              <div>
                <label className={labelClass}>Primary Contact</label>
                <input
                  type="text"
                  value={ownerPrimaryContact}
                  readOnly
                  placeholder="Pulled from company profile"
                  className={`${inputClass} bg-slate-50 ${MILIK_ORANGE_BORDER_FOCUS}`}
                />
              </div>

              <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-3 text-xs text-amber-800">
                {termLandlord} selection is hidden in this mode. Saving will keep the {termProperty.toLowerCase()} owned by this company and preserve direct-to-owner collection defaults.
              </div>
            </div>
          </div>
        ) : (
          <div className={`${sectionCard} p-4`}>
            <div className="flex justify-between items-center mb-3">
              <h3 className={sectionHeader}>{termLandlords} *</h3>
              <button
                type="button"
                onClick={() => setOpenAddLandlordModal(true)}
                className={`h-9 px-3 text-sm font-semibold ${MILIK_ORANGE_BG} text-white rounded-md flex items-center gap-2 ${MILIK_ORANGE_BG_HOVER} transition-colors`}
              >
                <FaPlus /> Add {termLandlord}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div>
                <MilikSelect
                  label={`${termLandlord} Name`}
                  required
                  placeholder={landlordItems.length ? `Select ${termLandlord.toLowerCase()}` : `No ${termLandlords.toLowerCase()} loaded`}
                  items={landlordItems}
                  value={selectedLandlordId}
                  disabled={loading}
                  getLabel={getLandlordLabel}
                  getValue={getLandlordId}
                  onChange={(id, obj) => handleSelectLandlord(id, obj)}
                />
                {fieldErrors.landlord && <p className="mt-1 text-xs text-red-600">{fieldErrors.landlord}</p>}
                <p className="mt-1 text-xs text-slate-500">
                  Select {termLandlord.toLowerCase()} for this {termProperty.toLowerCase()}.
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
                <div className="text-xs text-slate-500 italic">Primary {termLandlord.toLowerCase()}</div>
              </div>
            </div>
          </div>
        )}

        <Modal
          open={openAddLandlordModal}
          title={`Add ${termLandlord}`}
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
                Save {termLandlord}
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
            items={["in-gl", "property-gl"]}
            value={formData.accountLedgerType}
            onChange={(val) => handleChange({ target: { name: "accountLedgerType", value: val } })}
            getLabel={(x) => x === "property-gl" ? `${termProperty} GL` : "In-GL (Company General Ledger)"}
            getValue={(x) => x}
          />
          {formData.accountLedgerType === "in-gl" && (
            <p className="mt-1 text-[11px] text-blue-600">{termInvoices} and {termReceipts.toLowerCase()} post journal entries into the company GL. Appears in Trial Balance, P&amp;L, and Balance Sheet.</p>
          )}
          {formData.accountLedgerType === "property-gl" && (
            <p className="mt-1 text-[11px] text-purple-600">This {termProperty.toLowerCase()} has its own isolated ledger — no entries post to the company GL. Enable the {termProperty} Ledger below to activate posting.</p>
          )}
        </div>
      </div>

      {formData.accountLedgerType === "property-gl" && (
        <div className="mt-3 rounded-lg border border-purple-200 bg-purple-50 p-4">
          <div className="flex items-start gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                name="propertyLedgerEnabled"
                checked={!!formData.propertyLedgerEnabled}
                onChange={(e) => handleChange({ target: { name: "propertyLedgerEnabled", type: "checkbox", checked: e.target.checked } })}
                className="h-4 w-4 rounded border-purple-300 text-purple-600 focus:ring-purple-500"
              />
              <span className="text-sm font-semibold text-purple-800">Enable {termProperty} Ledger</span>
            </label>
          </div>
          <p className="mt-2 text-[11px] text-purple-700">
            When enabled, {termInvoices.toLowerCase()} and {termReceipts.toLowerCase()} post to this {termProperty.toLowerCase()}&apos;s own isolated ledger — visible via the <strong>{termProperty} Ledger</strong> button on the {termProperties.toLowerCase()} list.
            When disabled, transactions are tracked internally but no journal entries are created.
          </p>
        </div>
      )}

      <div>
        <label className={labelClass}>{termInvoice} Payment Terms</label>
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

      {renderCommunications()}
    </div>
  );

  const renderSpaceUnits = () => {
    const basisArea = parseFloat(formData.netLettableArea || formData.grossLettableArea || 0) || 0;
    const ratePerMeasure = parseFloat(formData.rentPerMeasure || 0) || 0;
    const estimatedRent = basisArea * ratePerMeasure;

    return (
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
              min="0"
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
              min="0"
            />
          </div>

          <div>
            <MilikSelect
              label={`${termUnit} Measurement`}
              placeholder="Select Measurement"
              items={["Sq Ft", "Sq M", "Acres", "Hectares"]}
              value={formData.unitMeasurement}
              onChange={(val) => handleChange({ target: { name: "unitMeasurement", value: val } })}
              getLabel={(x) => x}
              getValue={(x) => x}
            />
          </div>

          <div>
            <label className={labelClass}>{termRent} Per Measure</label>
            <input
              type="number"
              name="rentPerMeasure"
              value={formData.rentPerMeasure}
              onChange={handleChange}
              className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
              placeholder="0.00"
              step="0.01"
              min="0"
            />
          </div>

          <div>
            <MilikSelect
              label={`${termRent} Currency`}
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

        <div className={`${sectionCard} p-4`}>
          <h3 className={sectionHeader}>MEASUREMENT-BASED RENT PREVIEW</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pricing Basis Area</div>
              <div className="mt-1 text-lg font-extrabold text-slate-900">
                {basisArea.toLocaleString()} {formData.unitMeasurement}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Uses net lettable area when present, otherwise gross lettable area.
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rate Per Measure</div>
              <div className="mt-1 text-lg font-extrabold text-slate-900">
                {ratePerMeasure.toLocaleString()} {formData.rentCurrency}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                This default rate is available when pricing units from their measured area.
              </div>
            </div>

            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Estimated Monthly {termRent}</div>
              <div className="mt-1 text-lg font-extrabold text-emerald-900">
                {estimatedRent.toLocaleString()} {formData.rentCurrency}
              </div>
              <div className="mt-1 text-xs text-emerald-700">
                Saved property defaults can now feed unit rent calculation when a unit area is entered.
              </div>
            </div>
          </div>
        </div>

        {renderStandingCharges()}
      </div>
    );
  };

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
                  label={`Service Charge/${termUtility}`}
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

        <div className="mb-3 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          The {termRent.toLowerCase()} security deposit configured here now feeds the main {termUnit.toLowerCase()} deposit default when creating a {termUnit.toLowerCase()} for this {termProperty.toLowerCase()}.
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
                    `${termRent} Security Deposit`,
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
                  {deposit.chargeMode === "Percentage" ? `Percentage (% of ${termRent})` : "Amount"}
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
        <h3 className={sectionHeader}>DISABLE SMSING</h3>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-3">
          {Object.entries(formData.smsExemptions).map(([key, value]) => (
            <label key={key} className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                name={key}
                checked={value}
                onChange={(e) => handleChange(e, "smsExemptions")}
              />
              {key === "all" ? "Disable All SMS" : `Disable ${key} SMS`}
            </label>
          ))}
        </div>
      </div>

      <div className={`${sectionCard} p-4`}>
        <h3 className={sectionHeader}>DISABLE EMAILING</h3>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-3">
          {Object.entries(formData.emailExemptions).map(([key, value]) => (
            <label key={key} className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                name={key}
                checked={value}
                onChange={(e) => handleChange(e, "emailExemptions")}
              />
              {key === "all" ? "Disable All Email" : `Disable ${key} Email`}
            </label>
          ))}
        </div>
      </div>
    </div>
  );

  const renderBanking = () => (
    <div className="space-y-5">
      <div className={`${sectionCard} p-4`}>
        <h3 className={sectionHeader}>{termLandlord} Drawer Banking Details</h3>

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
          <label className={labelClass}>Internal Notes</label>
          <textarea
            name="notes"
            value={formData.notes}
            onChange={handleChange}
            rows={3}
            className={`${textareaClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
            placeholder="Internal notes (not shown publicly)..."
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

      <div className={`${sectionCard} p-4`}>
        <div className="flex items-center justify-between gap-4 mb-3">
          <h3 className={sectionHeader}>PUBLIC LISTING DETAILS</h3>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              name="listingEnabled"
              checked={Boolean(formData.listingEnabled)}
              onChange={handleChange}
              className="h-4 w-4 rounded border-slate-300 text-[#0B3B2E] focus:ring-[#0B3B2E]"
            />
            List this property publicly
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Amenities</label>
            <input
              type="text"
              name="amenities"
              value={formData.amenities}
              onChange={handleChange}
              placeholder="e.g., Pool, Gym, Backup Generator (comma separated)"
              className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
            />
          </div>

          <div>
            <label className={labelClass}>Year Built</label>
            <input
              type="number"
              name="yearBuilt"
              value={formData.yearBuilt}
              onChange={handleChange}
              min="1800"
              className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
            />
          </div>
        </div>

        <div className="mt-4">
          <label className={labelClass}>Location on Map</label>
          <p className="mb-2 text-[11px] text-slate-400">
            Search by place name, click "Use Address ↑" to geocode from the address fields above, or click directly on the map to pin the property.
          </p>
          <Suspense fallback={<div className="h-48 flex items-center justify-center text-xs text-slate-400">Loading map…</div>}>
            <PropertyMapPicker
              lat={formData.coordinates?.lat}
              lng={formData.coordinates?.lng}
              onLocationChange={({ lat, lng }) =>
                setFormData((prev) => ({ ...prev, coordinates: { lat, lng } }))
              }
              addressHint={[formData.estateArea, formData.roadStreet, formData.townCityState]
                .filter(Boolean)
                .join(", ")}
            />
          </Suspense>
        </div>

        <div className="mt-4">
          <label className={labelClass}>{termProperty} Description <span className="font-normal text-slate-400">(shown on listing page)</span></label>
          <textarea
            name="description"
            value={formData.description}
            onChange={handleChange}
            rows={4}
            className={`${textareaClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
            placeholder="Describe the property to prospective tenants — location highlights, building features, security, etc."
          />
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Video URL</label>
            <input
              type="url"
              name="videoUrl"
              value={formData.videoUrl || ""}
              onChange={handleChange}
              placeholder="https://youtube.com/..."
              className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
            />
          </div>
          <div>
            <label className={labelClass}>Virtual Tour URL</label>
            <input
              type="url"
              name="virtualTourUrl"
              value={formData.virtualTourUrl || ""}
              onChange={handleChange}
              placeholder="https://matterport.com/..."
              className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
            />
          </div>
        </div>

        <div className="mt-4">
          <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2">Listing Contact</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-3">
            <div>
              <label className={labelClass}>Name</label>
              <input type="text" value={formData.listingContact?.name || ""} onChange={(e) => handleListingContactChange("name", e.target.value)} className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`} />
            </div>
            <div>
              <label className={labelClass}>Phone</label>
              <input type="text" value={formData.listingContact?.phone || ""} onChange={(e) => handleListingContactChange("phone", e.target.value)} className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`} />
            </div>
            <div>
              <label className={labelClass}>WhatsApp</label>
              <input type="text" value={formData.listingContact?.whatsapp || ""} onChange={(e) => handleListingContactChange("whatsapp", e.target.value)} className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`} />
            </div>
            <div>
              <label className={labelClass}>Email</label>
              <input type="email" value={formData.listingContact?.email || ""} onChange={(e) => handleListingContactChange("email", e.target.value)} className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`} />
            </div>
            <div>
              <label className={labelClass}>Preferred Method</label>
              <select
                value={formData.listingContact?.preferredMethod || "phone"}
                onChange={(e) => handleListingContactChange("preferredMethod", e.target.value)}
                className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS} appearance-none`}
              >
                <option value="phone">Phone</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="email">Email</option>
              </select>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <div className="flex justify-between items-center mb-2">
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide">Nearby Points of Interest</h4>
            <button
              type="button"
              onClick={addNearbyPoint}
              className={`h-8 px-3 text-xs font-semibold ${MILIK_ORANGE_BG} text-white rounded-md flex items-center gap-2 ${MILIK_ORANGE_BG_HOVER} transition-colors`}
            >
              <FaPlus /> Add Point
            </button>
          </div>

          {formData.nearbyPoints.length === 0 ? (
            <div className="text-center py-4 text-slate-400 text-xs border border-dashed border-slate-200 rounded-lg">
              e.g., "400m to Tarmac Road", "Close to Riara Academy"
            </div>
          ) : (
            <div className="space-y-2">
              {formData.nearbyPoints.map((point, index) => (
                <div key={index} className="grid grid-cols-1 md:grid-cols-8 gap-2 items-end p-2 bg-slate-50/60 border border-slate-200 rounded-lg">
                  <div className="md:col-span-2">
                    <label className={labelClass}>Category</label>
                    <select
                      value={point.category}
                      onChange={(e) => updateNearbyPoint(index, "category", e.target.value)}
                      className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS} appearance-none`}
                    >
                      <option value="road">Road</option>
                      <option value="school">School</option>
                      <option value="hospital">Hospital</option>
                      <option value="shopping">Shopping</option>
                      <option value="transport">Transport</option>
                      <option value="security">Security</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div className="md:col-span-4">
                    <label className={labelClass}>Label</label>
                    <input
                      type="text"
                      value={point.label}
                      onChange={(e) => updateNearbyPoint(index, "label", e.target.value)}
                      placeholder="e.g., Tarmac Road"
                      className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
                    />
                  </div>
                  <div className="md:col-span-1">
                    <label className={labelClass}>Distance</label>
                    <input
                      type="text"
                      value={point.distance}
                      onChange={(e) => updateNearbyPoint(index, "distance", e.target.value)}
                      placeholder="400m"
                      className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
                    />
                  </div>
                  <div className="md:col-span-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => removeNearbyPoint(index)}
                      className="h-9 px-3 rounded-md bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 transition-colors flex items-center justify-center"
                    >
                      <FaTrash className="text-xs" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );

  const renderUtilityRates = () => (
    <div className="space-y-6">
      <div className={`${sectionCard} p-4`}>
        <div className="flex justify-between items-center mb-3">
          <div>
            <h3 className={sectionHeader}>METER READING RATES</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Set the charge per unit for each utility at this property. These rates override company defaults and apply when billing meter readings.
            </p>
          </div>
          <button
            type="button"
            onClick={addUtilityRate}
            className={`h-9 px-3 text-sm font-semibold ${MILIK_ORANGE_BG} text-white rounded-md flex items-center gap-2 ${MILIK_ORANGE_BG_HOVER} transition-colors flex-shrink-0`}
          >
            <FaPlus /> Add Rate
          </button>
        </div>

        {formData.utilityRates.length === 0 ? (
          <div className="py-8 text-center border border-dashed border-slate-200 rounded-lg">
            <FaCog className="text-3xl mx-auto mb-2 text-slate-300" />
            <p className="text-sm font-semibold text-slate-500">No utility rates configured</p>
            <p className="text-xs text-slate-400 mt-1">
              Add rates here to override company-level defaults for this property.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {formData.utilityRates.map((rate, index) => (
              <div
                key={index}
                className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end p-3 border border-slate-200 rounded-lg bg-slate-50/40"
              >
                <div>
                  <MilikSelect
                    label={`${termUtility} Type`}
                    placeholder={utilityTypeOptionsLoading ? "Loading..." : `Select ${termUtility}`}
                    items={utilityTypeOptions}
                    value={rate.utilityType}
                    onChange={(val, item) => {
                      const updated = [...formData.utilityRates];
                      updated[index] = {
                        ...updated[index],
                        utilityType: val,
                        unitCost: item?.unitCost ?? updated[index].unitCost,
                        billingCycle: item?.billingCycle ?? updated[index].billingCycle,
                      };
                      setFormData((p) => ({ ...p, utilityRates: updated }));
                    }}
                    getLabel={(x) => x.name}
                    getValue={(x) => x.name}
                    disabled={utilityTypeOptionsLoading}
                  />
                </div>

                <div>
                  <label className={labelClass}>{termUnit} Cost (KES)</label>
                  <input
                    type="number"
                    min="0"
                    value={rate.unitCost}
                    onChange={(e) => {
                      const updated = [...formData.utilityRates];
                      updated[index] = { ...updated[index], unitCost: e.target.value };
                      setFormData((p) => ({ ...p, utilityRates: updated }));
                    }}
                    className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <MilikSelect
                    label="Billing Cycle"
                    placeholder="Select Cycle"
                    items={["monthly", "quarterly", "annually", "per_use"]}
                    value={rate.billingCycle}
                    onChange={(val) => {
                      const updated = [...formData.utilityRates];
                      updated[index] = { ...updated[index], billingCycle: val };
                      setFormData((p) => ({ ...p, utilityRates: updated }));
                    }}
                    getLabel={(x) => x.charAt(0).toUpperCase() + x.slice(1).replace("_", " ")}
                    getValue={(x) => x}
                  />
                </div>

                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={rate.isActive}
                      onChange={(e) => {
                        const updated = [...formData.utilityRates];
                        updated[index] = { ...updated[index], isActive: e.target.checked };
                        setFormData((p) => ({ ...p, utilityRates: updated }));
                      }}
                    />
                    Active
                  </label>
                  <button
                    type="button"
                    onClick={() => removeUtilityRate(index)}
                    className="h-9 w-9 flex items-center justify-center rounded-md bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
                    title="Remove"
                  >
                    <FaTrash />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-lg">
          <p className="text-xs text-blue-700 font-semibold mb-1">Rate Resolution Priority</p>
          <ol className="text-xs text-blue-600 space-y-0.5 list-decimal list-inside">
            <li>Rate entered directly on the {termMeter.toLowerCase()} reading</li>
            <li>Per-{termUnit.toLowerCase()} rate (configured on each {termUnit.toLowerCase()})</li>
            <li>{termProperty} rate (configured here)</li>
          </ol>
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
      case "utilityRates":
        return renderUtilityRates();
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
      <DashboardLayout lockContentScroll>
        <div className="flex justify-center items-center h-full">
          <p className="text-sm font-semibold text-slate-600">Loading property details...</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <>
      <DashboardLayout lockContentScroll>
      <style>{`
        select { accent-color: #ea580c; }
        input[type="checkbox"] { accent-color: #ea580c; width: 18px; height: 18px; cursor: pointer; }
        select option { background-color: white; color: #1e293b; }
        select option:hover, select option:focus, select option:active, select option:checked {
          background-color: #ea580c !important; background: #ea580c !important;
          color: white !important; outline: none !important;
        }
      `}</style>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">

        {/* Sticky dark header */}
        <div className="flex-shrink-0 bg-[#0B3B2E] px-4 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => { clearDraftState(); navigate("/properties"); }}
                disabled={loading}
                className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#B7C9C0] hover:text-white transition disabled:opacity-50"
              >
                <FaArrowLeft /> Back
              </button>
              <div className="h-4 w-px bg-[#2A5C4A]" />
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#B7C9C0]">{termProperties}</div>
                <h1 className="text-sm font-black text-white leading-none">
                  {formData.propertyName || `Edit ${termProperty}`}
                  {isSelfManagingLandlordMode && <span className="ml-2 text-[11px] font-normal text-[#B7C9C0]">· Self-managing</span>}
                </h1>
              </div>
            </div>
            <span className="rounded-lg border border-[#2A5C4A] bg-[#0A3127] px-2.5 py-1 text-[10px] font-bold text-[#B7C9C0]">{operatingModeLabel}</span>
          </div>
        </div>

        {/* Tab navigation */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-3">
          <div className="flex flex-wrap gap-0.5">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  disabled={loading}
                  className={[
                    "h-10 px-4 text-sm font-bold flex items-center gap-2 rounded-t-md transition-all duration-200",
                    isActive ? `${MILIK_ORANGE_BG} text-white shadow-sm` : "text-slate-700 hover:bg-slate-100",
                    loading ? "opacity-50 cursor-not-allowed" : "",
                  ].join(" ")}
                >
                  <span>{tab.icon}</span>
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Scrollable content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className={`${sectionCard}`}>
            <form id="edit-property-form" onSubmit={handleSubmit}>
              <div className="p-3">{renderContent()}</div>
            </form>
          </div>
          {fieldErrors.business && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {fieldErrors.business}
            </div>
          )}
        </div>

        {/* Sticky footer */}
        <div className="flex-shrink-0 border-t border-slate-200 bg-[#F6FAF8] px-4 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-slate-500">Fields marked with * are required</div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => { clearDraftState(); navigate("/properties"); }} disabled={loading} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
              <button type="button" onClick={handleReset} disabled={loading} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Reset</button>
              {!isFirstTab && (
                <button type="button" onClick={handlePreviousTab} disabled={loading} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Previous</button>
              )}
              {!isLastTab && (
                <button type="button" onClick={handleNextTab} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B3B2E] px-3 py-2 text-xs font-black text-white transition hover:bg-[#0A3127] disabled:opacity-50 disabled:cursor-not-allowed">Next</button>
              )}
              <button type="submit" form="edit-property-form" disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-3 py-2 text-xs font-black text-white transition hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed">
                {loading ? <><FaSpinner className="animate-spin" /> Saving…</> : <><FaSave /> Update {termProperty}</>}
              </button>
            </div>
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