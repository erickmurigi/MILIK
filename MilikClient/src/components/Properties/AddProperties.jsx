import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useParams } from "react-router-dom";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import AppSelect from "../common/AppSelect";
import {
  FaSave,
  FaTimes,
  FaPlus,
  FaTrash,
  FaFileInvoice,
  FaBuilding,
  FaCalculator,
  FaChartBar,
  FaBell,
  FaStickyNote,
  FaHome,
  FaWarehouse,
  FaSpinner,
  FaCog,
  FaArrowLeft,
} from "react-icons/fa";
import { clearCurrentProperty, createProperty, getPropertyById, updateProperty } from "../../redux/propertyRedux";
import { getLandlords, createLandlord } from "../../redux/apiCalls";
import BankDetailsFields from "../common/BankDetailsFields";
import { INITIAL_LANDLORD_FORM, buildLandlordPayload, formatMobile, toKenyanMobile, validateLandlordForm } from "../../utils/landlordForm";
import { useTerms } from "../../hooks/useTerm";
import { selectCurrentCompany, selectCurrentUser, selectActiveLandlords, selectAllProperties, selectPropertyLoading, selectPropertyError, selectCurrentProperty } from "../../redux/selectors";
import { adminRequests } from "../../utils/requestMethods";
import { toast } from "react-toastify";
import MilikConfirmDialog from "../Modals/MilikConfirmDialog";
import { isSelfManagingLandlordCompany } from "../../utils/companyModules";
import { normalizeUppercaseInput } from "../../utils/listingPageUtils";
const PropertyMapPicker = lazy(() => import("../common/PropertyMapPicker"));

const MILIK_ORANGE_BG = "bg-orange-600";
const MILIK_ORANGE_BG_HOVER = "hover:bg-orange-700";
const MILIK_ORANGE_RING = "focus:ring-orange-500/30";
const MILIK_ORANGE_BORDER_FOCUS = "focus:border-[#0B3B2E]";

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
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div
          ref={panelRef}
          className={`w-full ${maxWidthClass} rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden`}
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
            <h3 className="text-sm font-extrabold text-slate-900 tracking-tight">{title}</h3>
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

const AddProperty = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const loading = useSelector(selectPropertyLoading);
  const error = useSelector(selectPropertyError);
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const {
    property: termProperty,
    unit: termUnit,
    units: termUnits,
    landlord: termLandlord,
    landlords: termLandlords,
    rent: termRent,
    tenant: termTenant,
    meter: termMeter,
    utility: termUtility,
    invoice: termInvoice,
    invoices: termInvoices,
    receipts: termReceipts,
  } = useTerms("property", "properties", "unit", "units", "landlord", "landlords", "rent", "tenant", "meter", "utility", "invoice", "invoices", "receipts");

  const activeCompanyContext = currentCompany || currentUser?.company || null;
  const isSelfManagingLandlordMode = isSelfManagingLandlordCompany(activeCompanyContext);
  const ownerCompanyName = activeCompanyContext?.companyName || "Current company";
  const ownerPrimaryContact =
    activeCompanyContext?.email ||
    activeCompanyContext?.phoneNo ||
    activeCompanyContext?.slogan ||
    "";

  const landlordsFromStore = useSelector(selectActiveLandlords);
  const propertiesFromStore = useSelector(selectAllProperties);

  const [zones, setZones] = useState([]);
  const [activeTab, setActiveTab] = useState("general");
  const { id } = useParams();
  const isEditMode = Boolean(id);
  const currentProperty = useSelector(selectCurrentProperty);
  const draftStorageKey = !isEditMode && currentCompany?._id ? `milik:add-property-draft:${currentCompany._id}:${currentUser?._id || currentUser?.id || currentUser?.email || "user"}` : null;
  const draftReadyRef = useRef(false);
  const [draftReadyNonce, setDraftReadyNonce] = useState(0);

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
      landlords: [{ landlordId: "", name: "", contact: "", isPrimary: true }],
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

  useEffect(() => {
    if (!id) return;
    dispatch(clearCurrentProperty());
    dispatch(getPropertyById(id));
    return () => {
      dispatch(clearCurrentProperty());
    };
  }, [dispatch, id]);

  useEffect(() => {
    if (!isEditMode || !currentProperty) return;
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

    let parsedDate = "";
    if (currentProperty.dateAcquired) {
      const d = new Date(currentProperty.dateAcquired);
      if (!Number.isNaN(d.getTime())) parsedDate = d.toISOString().split("T")[0];
    }

    setFormData({
      ...initialFormData,
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
      listingContact: { ...initialFormData.listingContact, ...(currentProperty.listingContact || {}) },
      nearbyPoints: Array.isArray(currentProperty.nearbyPoints) ? currentProperty.nearbyPoints : [],
      coordinates: {
        lat: currentProperty.coordinates?.lat ?? "",
        lng: currentProperty.coordinates?.lng ?? "",
      },
    });
    draftReadyRef.current = true;
  }, [currentProperty, id, isEditMode, initialFormData]);
  const [fieldErrors, setFieldErrors] = useState({});
  const [generalError, setGeneralError] = useState("");

  const [openAddLandlordModal, setOpenAddLandlordModal] = useState(false);
  const [newLandlord, setNewLandlord] = useState(INITIAL_LANDLORD_FORM);
  const [newLandlordErrors, setNewLandlordErrors] = useState({});
  const [savingLandlord, setSavingLandlord] = useState(false);
  const [utilityTypeOptions, setUtilityTypeOptions] = useState([]);
  const [utilityTypeOptionsLoading, setUtilityTypeOptionsLoading] = useState(false);
  const [depositTypeOptions, setDepositTypeOptions] = useState([]);

  const clearDraftState = () => {
    if (!draftStorageKey || typeof window === "undefined" || !window.sessionStorage) return;
    window.sessionStorage.removeItem(draftStorageKey);
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

  const removeUtilityRate = (index) => {
    setFormData((prev) => ({
      ...prev,
      utilityRates: prev.utilityRates.filter((_, i) => i !== index),
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


  const labelClass = "mb-1 block text-xs font-bold text-slate-900";

  const inputClass = "h-7 w-full border border-slate-300 bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-500 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";
  const textareaClass = "w-full border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-500 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20 min-h-[80px]";

  const sectionCard = "overflow-hidden border border-slate-200 bg-white shadow-sm";
  const sectionHeader = "text-[11px] font-black uppercase tracking-wide text-slate-700";

  const uppercasePropertyFields = new Set(["propertyCode", "propertyName", "zoneRegion", "roadStreet", "estateArea", "townCityState", "invoicePrefix", "specificContactInfo"]);

  const handleChange = (e, section = null, index = null) => {
    const { name, value, type, checked } = e.target;
    const normalizedValue = type === "checkbox" ? checked : (uppercasePropertyFields.has(name) ? normalizeUppercaseInput(value) : value);

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
        [name]: uppercasePropertyFields.has(name) ? normalizeUppercaseInput(value) : value,
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
          [name]: normalizedValue,
        },
      }));
      return;
    }

    setFormData((prev) => {
      const next = { ...prev, [name]: normalizedValue };
      // When switching to Letting mode, default tenantsPaysTo and depositHeldBy
      // to "landlord" so the form reflects the correct business logic immediately.
      // When switching back to Managing, reset them to "propertyManager".
      if (name === "letManage") {
        const v = String(normalizedValue).toLowerCase();
        if (v === "letting") {
          // Pure Letting: landlord collects directly — force routing
          next.tenantsPaysTo = "landlord";
          next.depositHeldBy = "landlord";
        } else if (v === "managing") {
          // Full management: reset letting fee fields
          next.lettingFeeMode = "percentage";
          next.lettingFeeValue = 100;
        }
        // "Both": keep existing tenantsPaysTo / depositHeldBy as-is; user sets them below
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
      setFieldErrors((prev) => ({
        ...prev,
        landlord: `${termLandlord} name is missing. Please refresh and try again.`,
      }));
      return;
    }

    const contact =
      landlordObj?.email ||
      landlordObj?.phoneNumber ||
      landlordObj?.phone ||
      landlordObj?.contact ||
      "";

    updated[0] = {
      ...primary,
      landlordId,
      name: displayName.trim(),
      contact,
      isPrimary: true,
    };

    setFormData((prev) => ({ ...prev, landlords: updated }));

    if (fieldErrors.landlord) {
      setFieldErrors((prev) => ({ ...prev, landlord: "" }));
    }
  };

  const validatePropertyForm = () => {
    const errors = {};

    if (!formData.dateAcquired?.trim()) errors.dateAcquired = "Date acquired is required.";
    if (!formData.propertyName?.trim()) errors.propertyName = `${termProperty} name is required.`;
    if (!formData.propertyType?.trim()) errors.propertyType = `${termProperty} type is required.`;
    if (
      !isSelfManagingLandlordMode &&
      (!formData.landlords?.[0]?.name?.trim() || !formData.landlords?.[0]?.landlordId?.trim())
    ) {
      errors.landlord = "Primary landlord is required.";
    }

    return errors;
  };

  const resetNewLandlord = () => {
    setNewLandlord(INITIAL_LANDLORD_FORM);
    setNewLandlordErrors({});
  };

  const closeAddLandlordModal = () => {
    setOpenAddLandlordModal(false);
    resetNewLandlord();
  };

  const updateNewLandlord = (name, value) => {
    setNewLandlord((prev) => ({ ...prev, [name]: value }));
    if (newLandlordErrors[name]) setNewLandlordErrors((prev) => ({ ...prev, [name]: undefined }));
  };

  const saveNewLandlordFromModal = async () => {
    if (!currentCompany?._id) {
      toast.error("No active company selected. Please create or select a company first.");
      return;
    }

    const errors = validateLandlordForm(newLandlord);
    setNewLandlordErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast.error("Check the highlighted fields");
      return;
    }

    // The same landlord already on file is selected, not duplicated
    const phone = toKenyanMobile(newLandlord.phoneNumber);
    const email = newLandlord.email.trim().toLowerCase();
    const existing = landlordsFromStore.find((l) =>
      (phone && toKenyanMobile(l?.phoneNumber) === phone) ||
      (email && email !== "-" && String(l?.email || "").trim().toLowerCase() === email)
    );
    if (existing) {
      handleSelectLandlord(existing._id, existing);
      toast.info(`${termLandlord} already on file, selected.`);
      closeAddLandlordModal();
      return;
    }

    setSavingLandlord(true);
    try {
      const saved = await dispatch(createLandlord(buildLandlordPayload({ ...newLandlord, status: "Active" }, currentCompany._id)));
      await dispatch(getLandlords({ company: currentCompany._id }));
      handleSelectLandlord(saved._id, saved);
      toast.success(`${termLandlord} added`);
      closeAddLandlordModal();
    } catch (err) {
      toast.error(err?.message || `Failed to add ${termLandlord.toLowerCase()}`);
    } finally {
      setSavingLandlord(false);
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

    const propertyCode = formData.propertyCode?.trim();

    const businessId = currentCompany?._id;

    if (!businessId) {
      const message = "Business context is required to create a property. Please ensure you are logged in with a company account.";
      setGeneralError(message);
      toast.error(message);
      return;
    }

    const cleanedFormData = { ...formData };
    // Remove optional enum fields when empty to avoid Mongoose cast errors on empty strings
    const optionalEnumFields = ["category", "specification", "multiStoreyType"];
    optionalEnumFields.forEach((field) => {
      if (cleanedFormData[field] === "") {
        delete cleanedFormData[field];
      }
    });

    const propertyData = {
      ...cleanedFormData,
      propertyCode,
      business: businessId,
      createdBy: currentUser?._id,
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

    // Images are managed through their own endpoint, never through the main payload
    delete propertyData.images;
    if (isEditMode) delete propertyData.createdBy;

    try {
      setFieldErrors({});
      setGeneralError("");

      const result = await dispatch(
        isEditMode ? updateProperty({ id, propertyData }) : createProperty(propertyData)
      ).unwrap();

      await dispatch(getLandlords({ company: businessId }));

      clearDraftState();
      toast.success(result?.message || `${termProperty} ${isEditMode ? "updated" : "created"} successfully!`);
      navigate("/properties");
    } catch (err) {
      let backendMessage = `Failed to ${isEditMode ? "update" : "create"} ${termProperty.toLowerCase()}`;

      if (typeof err === "string") backendMessage = err;
      else if (err?.message && err.message !== "Unauthorized") backendMessage = err.message;
      else if (err?.error) backendMessage = err.error;
      else if (err?.data?.message) backendMessage = err.data.message;
      else if (err?.response?.data?.message) backendMessage = err.response.data.message;

      if (err?.fieldErrors && typeof err.fieldErrors === "object") {
        setFieldErrors((prev) => ({ ...prev, ...err.fieldErrors }));
      }

      setGeneralError(backendMessage);
      toast.error(backendMessage);
    }
  };

  const handleReset = () => {
    setConfirmDialog({
      isOpen: true,
      title: "Reset Form",
      message: "Are you sure you want to reset all fields? This action cannot be undone.",
      isDangerous: false,
      onConfirm: () => {
        clearDraftState();
        setFormData(initialFormData);
        setActiveTab("general");
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        toast.info("Form reset successfully");
      },
    });
  };

  const activeTabIndex = useMemo(() => tabs.findIndex((t) => t.id === activeTab), [tabs, activeTab]);
  const isFirstTab = activeTabIndex === 0;
  const isLastTab = activeTabIndex === tabs.length - 1;

  // The "Next" and "Save Property" buttons occupy the exact same footer slot —
  // clicking Next on the second-to-last tab swaps that spot to a submit button
  // in the same instant. A rapid double-click (or a second click that lands a
  // beat late) can hit the newly-appeared submit button before the user ever
  // sees the tab they just navigated to, saving the property unintentionally.
  // Brief disable window right after the swap closes that gap without adding
  // any friction to a genuine, deliberate Save click.
  const [justEnteredLastTab, setJustEnteredLastTab] = useState(false);
  useEffect(() => {
    if (!isLastTab) {
      setJustEnteredLastTab(false);
      return;
    }
    setJustEnteredLastTab(true);
    const timer = setTimeout(() => setJustEnteredLastTab(false), 500);
    return () => clearTimeout(timer);
  }, [isLastTab]);

  const handleNextTab = () => {
    if (activeTabIndex < tabs.length - 1) setActiveTab(tabs[activeTabIndex + 1].id);
  };

  const handlePreviousTab = () => {
    if (activeTabIndex > 0) setActiveTab(tabs[activeTabIndex - 1].id);
  };

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
    adminRequests.get('/zones', { params: { limit: 500, isActive: 'true' } })
      .then((res) => setZones((res.data?.zones || []).map((z) => z.name).filter(Boolean)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!currentCompany?._id) return;
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
          setDepositTypeOptions(
            (Array.isArray(res?.data?.depositTypes) ? res.data.depositTypes : []).filter(
              (d) => d?.isActive !== false
            )
          );
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setUtilityTypeOptionsLoading(false); });
    return () => { cancelled = true; };
  }, [currentCompany?._id]);

  // Names-only view of the same configured types, for dropdowns that don't need rate metadata
  const standingChargeOptions = useMemo(
    () => (utilityTypeOptions.length ? utilityTypeOptions.map((u) => u.name) : ["Water", "Garbage", "Electricity", "Service Charge", "Security", "Others"]),
    [utilityTypeOptions]
  );

  // Real company-configured deposit types, falling back to the same single default
  // ("Security Deposit") TenantDeposits.jsx uses when a company has none configured.
  const securityDepositTypeOptions = useMemo(
    () => (depositTypeOptions.length ? depositTypeOptions.map((d) => d.name) : ["Security Deposit"]),
    [depositTypeOptions]
  );

  useEffect(() => {
    draftReadyRef.current = false;

    if (!draftStorageKey || typeof window === "undefined" || !window.sessionStorage) {
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
        if (parsedDraft?.activeTab) {
          setActiveTab(parsedDraft.activeTab);
        }
      }
    } catch (draftError) {
      console.warn("Failed to restore add property draft", draftError);
    } finally {
      window.setTimeout(() => {
        draftReadyRef.current = true;
        setDraftReadyNonce((value) => value + 1);
      }, 0);
    }
  }, [draftStorageKey]);

  useEffect(() => {
    if (!draftStorageKey || !draftReadyRef.current || typeof window === "undefined" || !window.sessionStorage) return;
    try {
      window.sessionStorage.setItem(
        draftStorageKey,
        JSON.stringify({
          formData,
          activeTab,
        })
      );
    } catch (draftError) {
      console.warn("Failed to persist add property draft", draftError);
    }
  }, [activeTab, draftReadyNonce, draftStorageKey, formData]);
  const renderGeneralInfo = () => {
    const landlordItems = Array.isArray(landlordsFromStore) ? landlordsFromStore : [];

    const getLandlordId = (l) => l?._id || l?.id || l?.landlordId?._id || l?.landlordId || "";
    const getLandlordLabel = (l) => l?.fullName || l?.name || l?.landlordName || l?.email || "Unnamed";

    const selectedLandlordId = formData.landlords?.[0]?.landlordId?._id || formData.landlords?.[0]?.landlordId || "";
    const landlordOptions = landlordItems.map((l) => ({ value: getLandlordId(l), label: getLandlordLabel(l) }));

    return (
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-x-3 gap-y-2 md:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className={labelClass}>Date Acquired <span className="text-red-500">*</span></label>
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
            <AppSelect
              label="Let/Manage"
              required
              placeholder="Select..."
              options={["Managing", "Letting", "Both"].map((x) => ({ value: x, label: x }))}
              value={formData.letManage}
              onChange={(val) => handleChange({ target: { name: "letManage", value: val } })}
            />
            {formData.letManage === "Letting" && (
              <p className="mt-1 text-[11px] text-slate-500">
                {termTenant} pays {termRent} directly to the {termLandlord}. A one-time letting fee is charged when placing a {termTenant}.
              </p>
            )}
            {formData.letManage === "Both" && (
              <p className="mt-1 text-[11px] text-slate-500">
                A one-time letting fee is charged when placing a {termTenant}, then the {termProperty} is managed with ongoing commission and {termLandlord} statements.
              </p>
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
                  ? `${formData.lettingFeeValue || 0}% of the ${termTenant}'s monthly ${termRent}`
                  : `Fixed fee of ${Number(formData.lettingFeeValue || 0).toLocaleString()} charged per ${termTenant} placed`}
              </p>
            </div>
          )}

          <div>
            <label className={labelClass}>{termProperty} Code <span className="text-red-500">*</span></label>
            <input
              type="text"
              name="propertyCode"
              value={formData.propertyCode}
              onChange={handleChange}
              className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
              placeholder="Generated by the system if left blank"
            />
          </div>

          <div className="md:col-span-2">
            <label className={labelClass}>{termProperty} Name <span className="text-red-500">*</span></label>
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
            <AppSelect
              label={`${termProperty} Type`}
              required
              placeholder="Select Type"
              options={propertyTypes.map((x) => ({ value: x, label: x }))}
              value={formData.propertyType}
              onChange={(val) => handleChange({ target: { name: "propertyType", value: val } })}
              error={fieldErrors.propertyType}
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
            <AppSelect
              label="Zone/Region"
              placeholder="Select Zone"
              searchable
              options={zones.map((x) => ({ value: x, label: x }))}
              value={formData.zoneRegion}
              onChange={(val) => handleChange({ target: { name: "zoneRegion", value: val } })}
            />
          </div>
        </div>

        {isSelfManagingLandlordMode ? (
          <div className={`${sectionCard} p-4`}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className={sectionHeader}>Ownership</h3>
                <p className="mt-1 text-xs text-slate-500">
                  This property will be linked to the active self-managing landlord company automatically.
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
                {termLandlord} selection is hidden in this mode. Saving will auto-link the {termProperty.toLowerCase()} to this company as the owner and apply direct-to-owner collection defaults.
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
                className="flex items-center gap-1 text-[11px] font-bold text-[#0B3B2E] hover:underline"
              >
                <FaPlus size={9} /> Add {termLandlord}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div>
                <AppSelect
                  label={`${termLandlord} Name`}
                  required
                  searchable
                  placeholder={landlordItems.length ? `Select ${termLandlord}` : `No ${termLandlords} loaded`}
                  options={landlordOptions}
                  value={selectedLandlordId}
                  disabled={loading}
                  onChange={(id) => handleSelectLandlord(id, landlordItems.find((l) => getLandlordId(l) === id))}
                  error={fieldErrors.landlord}
                />
              </div>

              <div>
                <label className={labelClass}>Contact Information</label>
                <input
                  type="text"
                  name="contact"
                  value={formData.landlords?.[0]?.contact || ""}
                  onChange={(e) => {
                    const updated = [...formData.landlords];
                    updated[0] = {
                      ...(updated[0] || { isPrimary: true }),
                      contact: e.target.value,
                      isPrimary: true,
                    };
                    setFormData((p) => ({ ...p, landlords: updated }));
                  }}
                  className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`}
                  placeholder="Phone/Email"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Autofills from selected landlord.
                </p>
              </div>

              <div className="flex items-center">
                <div className="text-xs text-slate-500 italic">Primary landlord</div>
              </div>
            </div>
          </div>
        )}

        <Modal
          open={openAddLandlordModal}
          title={`Add ${termLandlord}`}
          onClose={closeAddLandlordModal}
          maxWidthClass="max-w-3xl"
        >
          {(() => {
            const fieldError = (name) =>
              newLandlordErrors[name] ? <p className="mt-0.5 text-[11px] font-semibold text-red-600">{newLandlordErrors[name]}</p> : null;
            const isIndividual = newLandlord.landlordType === "Individual";
            const landlordTypeOptions = ["Individual", "Company", "Partnership", "Trust"].map((x) => ({ value: x, label: x }));
            const knownBanks = landlordsFromStore.map((l) => l?.bankName).filter(Boolean);

            return (
              <div className="space-y-2">
                <div className="grid grid-cols-1 gap-x-3 gap-y-2 md:grid-cols-3">
                  <div className="md:col-span-2">
                    <label className={labelClass}>{termLandlord} name <span className="text-red-600">*</span></label>
                    <input
                      value={newLandlord.landlordName}
                      onChange={(e) => updateNewLandlord("landlordName", normalizeUppercaseInput(e.target.value))}
                      placeholder="e.g. JOHN DOE"
                      className={`${inputClass} ${newLandlordErrors.landlordName ? "border-red-500" : ""}`}
                    />
                    {fieldError("landlordName")}
                  </div>
                  <div>
                    <AppSelect
                      label={`${termLandlord} type`}
                      options={landlordTypeOptions}
                      value={newLandlord.landlordType}
                      onChange={(val) => updateNewLandlord("landlordType", val || "Individual")}
                    />
                  </div>

                  <div>
                    <label className={labelClass}>Phone <span className="text-red-600">*</span></label>
                    <input
                      value={newLandlord.phoneNumber}
                      onChange={(e) => updateNewLandlord("phoneNumber", e.target.value)}
                      onBlur={() => {
                        const local = toKenyanMobile(newLandlord.phoneNumber);
                        if (local) updateNewLandlord("phoneNumber", formatMobile(local));
                      }}
                      placeholder="0712 345 678"
                      className={`${inputClass} ${newLandlordErrors.phoneNumber ? "border-red-500" : ""}`}
                    />
                    {fieldError("phoneNumber")}
                  </div>
                  <div>
                    <label className={labelClass}>Email <span className="text-red-600">*</span></label>
                    <input
                      value={newLandlord.email}
                      onChange={(e) => updateNewLandlord("email", e.target.value)}
                      placeholder="name@example.com, or -"
                      className={`${inputClass} ${newLandlordErrors.email ? "border-red-500" : ""}`}
                    />
                    {fieldError("email")}
                  </div>
                  <div>
                    <label className={labelClass}>KRA PIN</label>
                    <input
                      value={newLandlord.taxPin}
                      onChange={(e) => updateNewLandlord("taxPin", normalizeUppercaseInput(e.target.value))}
                      placeholder="Leave blank if not known"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>{isIndividual ? "National ID No." : "Registration No."}</label>
                    <input
                      value={newLandlord.regId}
                      onChange={(e) => updateNewLandlord("regId", normalizeUppercaseInput(e.target.value))}
                      placeholder={isIndividual ? "e.g. 12345678" : "e.g. PVT-1234567"}
                      className={inputClass}
                    />
                  </div>
                </div>

                <BankDetailsFields
                  title="Bank & payment details"
                  values={newLandlord}
                  onChange={updateNewLandlord}
                  knownBanks={knownBanks}
                />

                <div className="flex justify-end gap-2 border-t border-slate-200 pt-2">
                  <button
                    type="button"
                    onClick={closeAddLandlordModal}
                    disabled={savingLandlord}
                    className="h-7 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={saveNewLandlordFromModal}
                    disabled={savingLandlord}
                    className="h-7 bg-[#0B3B2E] px-3 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-50"
                  >
                    {savingLandlord ? "Saving…" : `Save ${termLandlord}`}
                  </button>
                </div>
              </div>
            );
          })()}
        </Modal>
      </div>
    );
  };

  const renderAccountingBilling = () => {
    const messageRows = [
      { key: "all", label: "All messages" },
      { key: "invoice", label: termInvoices },
      { key: "receipt", label: termReceipts },
      { key: "balance", label: "Balance" },
      { key: "general", label: "General" },
    ];
    const toggleExemption = (group, key, checked) =>
      handleChange({ target: { name: key, type: "checkbox", checked } }, group);
    const isPropertyGl = formData.accountLedgerType === "property-gl";

    return (
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-x-3 gap-y-2 md:grid-cols-3">
          <div>
            <AppSelect
              label="Account Ledger Type"
              placeholder="Select Ledger Type"
              options={[
                { value: "in-gl", label: "In-GL (Company General Ledger)" },
                { value: "property-gl", label: `${termProperty} GL` },
              ]}
              value={formData.accountLedgerType}
              onChange={(val) => handleChange({ target: { name: "accountLedgerType", value: val } })}
            />
            <p className="mt-1 text-[11px] text-slate-500">
              {isPropertyGl
                ? `Posts to this ${termProperty.toLowerCase()}'s own ledger, not the company GL.`
                : `${termInvoices} and ${termReceipts.toLowerCase()} post to the company GL.`}
            </p>
          </div>

          {isPropertyGl && (
            <div className="flex items-start pt-6">
              <label className="flex items-center gap-2 text-xs font-bold text-slate-900">
                <input
                  type="checkbox"
                  name="propertyLedgerEnabled"
                  checked={!!formData.propertyLedgerEnabled}
                  onChange={(e) => handleChange({ target: { name: "propertyLedgerEnabled", type: "checkbox", checked: e.target.checked } })}
                />
                Enable {termProperty} Ledger
              </label>
            </div>
          )}

          <div>
            <span className={labelClass}>Exempt from late penalties</span>
            <div className="flex h-7 items-center gap-4 text-xs font-bold text-slate-900">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="exemptFromLatePenalties"
                  checked={Boolean(formData.exemptFromLatePenalties)}
                  onChange={() => setFormData((p) => ({ ...p, exemptFromLatePenalties: true }))}
                />
                Yes
              </label>
              <label className="flex items-center gap-1.5">
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
        </div>

        <div>
          <label className={labelClass}>{termInvoice} payment terms</label>
          <textarea
            name="invoicePaymentTerms"
            value={formData.invoicePaymentTerms}
            onChange={handleChange}
            rows={2}
            className={`${textareaClass} min-h-0`}
          />
        </div>

        <div className="border border-slate-200">
          <div className="border-b border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wide text-slate-700">
            Message controls
          </div>
          <table className="w-full text-xs">
            <thead className="text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2.5 py-1">Turn off for</th>
                <th className="w-20 px-2.5 py-1 text-center">SMS</th>
                <th className="w-20 px-2.5 py-1 text-center">Email</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {messageRows.map((row) => (
                <tr key={row.key}>
                  <td className="px-2.5 py-1 font-bold text-slate-900">{row.label}</td>
                  <td className="text-center">
                    <input
                      type="checkbox"
                      checked={Boolean(formData.smsExemptions?.[row.key])}
                      onChange={(e) => toggleExemption("smsExemptions", row.key, e.target.checked)}
                    />
                  </td>
                  <td className="text-center">
                    <input
                      type="checkbox"
                      checked={Boolean(formData.emailExemptions?.[row.key])}
                      onChange={(e) => toggleExemption("emailExemptions", row.key, e.target.checked)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderSpaceUnits = () => {
    const updateCharge = (index, patch) =>
      setFormData((p) => ({ ...p, standingCharges: p.standingCharges.map((c, i) => (i === index ? { ...c, ...patch } : c)) }));
    const updateDeposit = (index, patch) =>
      setFormData((p) => ({ ...p, securityDeposits: p.securityDeposits.map((d, i) => (i === index ? { ...d, ...patch } : d)) }));
    const selectClass = "h-7 text-xs";

    return (
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-x-3 gap-y-2 md:grid-cols-3 lg:grid-cols-5">
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
            <AppSelect
              label={`${termUnit} Measurement`}
              placeholder="Select Measurement"
              options={["Sq Ft", "Sq M", "Acres", "Hectares"].map((x) => ({ value: x, label: x }))}
              value={formData.unitMeasurement}
              onChange={(val) => handleChange({ target: { name: "unitMeasurement", value: val } })}
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
            <AppSelect
              label={`${termRent} Currency`}
              placeholder="Select Currency"
              options={[
                "Kenyan Shilling [KES]",
                "US Dollar [USD]",
                "Euro [EUR]",
                "British Pound [GBP]",
              ].map((x) => ({ value: x, label: x }))}
              value={formData.rentCurrency}
              onChange={(val) => handleChange({ target: { name: "rentCurrency", value: val } })}
            />
          </div>
        </div>

        <div className={sectionCard}>
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-2.5 py-1.5">
            <span className={sectionHeader}>Standing charges</span>
            <button type="button" onClick={addStandingCharge} className="flex items-center gap-1 text-[11px] font-bold text-[#0B3B2E] hover:underline">
              <FaPlus size={9} /> Add charge
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] table-auto text-xs">
              <thead className="text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-2 py-1">{termUtility} / charge</th>
                  <th className="px-2 py-1">Mode</th>
                  <th className="px-2 py-1 text-right">Cost per area</th>
                  <th className="px-2 py-1 text-right">Value</th>
                  <th className="px-2 py-1">VAT</th>
                  <th className="px-2 py-1 text-center">Escalates</th>
                  <th className="px-1 py-1" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {formData.standingCharges.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-2 py-2 text-center italic text-slate-400">No standing charges</td>
                  </tr>
                )}
                {formData.standingCharges.map((charge, index) => (
                  <tr key={index}>
                    <td className="px-1 py-1">
                      <AppSelect
                        size="sm"
                        placeholder="Select type"
                        options={standingChargeOptions.map((x) => ({ value: x, label: x }))}
                        value={charge.serviceCharge}
                        onChange={(val) => updateCharge(index, { serviceCharge: val })}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <AppSelect
                        size="sm"
                        placeholder="Select mode"
                        options={["Monthly", "Quarterly", "Annual", "One-time"].map((x) => ({ value: x, label: x }))}
                        value={charge.chargeMode}
                        onChange={(val) => updateCharge(index, { chargeMode: val })}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="text"
                        value={charge.costPerArea}
                        onChange={(e) => updateCharge(index, { costPerArea: e.target.value })}
                        placeholder="e.g. 50"
                        className={`${inputClass} ${selectClass} text-right`}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        value={charge.chargeValue}
                        onChange={(e) => updateCharge(index, { chargeValue: e.target.value })}
                        placeholder="0.00"
                        className={`${inputClass} ${selectClass} text-right`}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <AppSelect
                        size="sm"
                        placeholder="VAT"
                        options={["0%", "8%", "16%"].map((x) => ({ value: x, label: x }))}
                        value={charge.vatRate}
                        onChange={(val) => updateCharge(index, { vatRate: val })}
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <input
                        type="checkbox"
                        checked={Boolean(charge.escalatesWithRent)}
                        onChange={(e) => updateCharge(index, { escalatesWithRent: e.target.checked })}
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      {index > 0 && (
                        <button type="button" onClick={() => removeStandingCharge(index)} title="Remove" className="p-1 text-slate-400 hover:text-rose-600">
                          <FaTrash size={10} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className={sectionCard}>
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-2.5 py-1.5">
            <span className={sectionHeader}>Security deposit</span>
            <button type="button" onClick={addSecurityDeposit} className="flex items-center gap-1 text-[11px] font-bold text-[#0B3B2E] hover:underline">
              <FaPlus size={9} /> Add deposit
            </button>
          </div>
          <p className="border-b border-slate-100 px-2.5 py-1 text-[11px] text-slate-500">
            Feeds the default deposit when a {termUnit.toLowerCase()} is created for this {termProperty.toLowerCase()}.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] table-auto text-xs">
              <thead className="text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-2 py-1">Deposit type</th>
                  <th className="px-2 py-1">Mode</th>
                  <th className="px-2 py-1 text-right">Amount</th>
                  <th className="px-2 py-1 text-center">Refundable</th>
                  <th className="px-1 py-1" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {formData.securityDeposits.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-2 py-2 text-center italic text-slate-400">No security deposit</td>
                  </tr>
                )}
                {formData.securityDeposits.map((deposit, index) => (
                  <tr key={index}>
                    <td className="px-1 py-1">
                      <AppSelect
                        size="sm"
                        placeholder="Select type"
                        options={securityDepositTypeOptions.map((x) => ({ value: x, label: x }))}
                        value={deposit.depositType}
                        onChange={(val) => updateDeposit(index, { depositType: val })}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <AppSelect
                        size="sm"
                        placeholder="Select mode"
                        options={["Percentage", "Fixed Amount"].map((x) => ({ value: x, label: x }))}
                        value={deposit.chargeMode}
                        onChange={(val) => updateDeposit(index, { chargeMode: val })}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        value={deposit.amount}
                        onChange={(e) => updateDeposit(index, { amount: e.target.value })}
                        placeholder={deposit.chargeMode === "Percentage" ? `% of ${termRent}` : "0.00"}
                        step={deposit.chargeMode === "Percentage" ? "1" : "0.01"}
                        min="0"
                        className={`${inputClass} ${selectClass} text-right`}
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <input type="checkbox" checked={Boolean(deposit.refundable)} onChange={(e) => updateDeposit(index, { refundable: e.target.checked })} />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <button type="button" onClick={() => removeSecurityDeposit(index)} title="Remove" className="p-1 text-slate-400 hover:text-rose-600">
                        <FaTrash size={10} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

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

  const renderNotes = () => {
    const nearbyCategories = ["road", "school", "hospital", "shopping", "transport", "security", "other"].map((x) => ({
      value: x,
      label: x.charAt(0).toUpperCase() + x.slice(1),
    }));

    return (
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className={`${sectionCard} p-2.5`}>
            <div className="mb-2 flex items-center justify-between">
              <span className={sectionHeader}>Internal</span>
              <div className="flex items-center gap-3 text-xs font-bold text-slate-900">
                <span>Exclude from fee summary</span>
                <label className="flex items-center gap-1">
                  <input type="radio" name="excludeFeeSummary" checked={Boolean(formData.excludeFeeSummary)} onChange={() => setFormData((p) => ({ ...p, excludeFeeSummary: true }))} />
                  Yes
                </label>
                <label className="flex items-center gap-1">
                  <input type="radio" name="excludeFeeSummary" checked={!formData.excludeFeeSummary} onChange={() => setFormData((p) => ({ ...p, excludeFeeSummary: false }))} />
                  No
                </label>
              </div>
            </div>
            <label className={labelClass}>Internal notes <span className="font-normal text-slate-400">(not shown publicly)</span></label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              rows={3}
              className={`${textareaClass} min-h-0`}
              placeholder="Internal notes…"
            />
          </div>

          <div className={`${sectionCard} p-2.5`}>
            <div className="mb-2 flex items-center justify-between">
              <span className={sectionHeader}>Public listing</span>
              <label className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                <input type="checkbox" name="listingEnabled" checked={Boolean(formData.listingEnabled)} onChange={handleChange} />
                List this {termProperty.toLowerCase()} publicly
              </label>
            </div>
            {formData.listingEnabled && (
            <>
            <div className="grid grid-cols-1 gap-x-3 gap-y-2 md:grid-cols-3">
              <div>
                <label className={labelClass}>Amenities</label>
                <input type="text" name="amenities" value={formData.amenities} onChange={handleChange} placeholder="Pool, Gym, Generator" className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`} />
              </div>
              <div>
                <label className={labelClass}>Year built</label>
                <input type="number" name="yearBuilt" value={formData.yearBuilt} onChange={handleChange} min="1800" className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`} />
              </div>
              <div>
                <label className={labelClass}>Video URL</label>
                <input type="url" name="videoUrl" value={formData.videoUrl || ""} onChange={handleChange} placeholder="https://youtube.com/…" className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`} />
              </div>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-x-3 gap-y-2 md:grid-cols-2">
              <div>
                <label className={labelClass}>Virtual tour URL</label>
                <input type="url" name="virtualTourUrl" value={formData.virtualTourUrl || ""} onChange={handleChange} placeholder="https://matterport.com/…" className={`${inputClass} ${MILIK_ORANGE_BORDER_FOCUS}`} />
              </div>
              <div>
                <label className={labelClass}>Listing description <span className="font-normal text-slate-400">(shown on listing page)</span></label>
                <textarea name="description" value={formData.description} onChange={handleChange} rows={2} className={`${textareaClass} min-h-0`} placeholder="Location, features, security…" />
              </div>
            </div>
            </>
          )}
          </div>
        </div>

        <div className={`${sectionCard} p-2.5`}>
          <div className="mb-1 flex items-center justify-between">
            <span className={sectionHeader}>Location on map</span>
            <span className="text-[11px] text-slate-500">Search a place, use the address fields, or click the map to pin the {termProperty.toLowerCase()}.</span>
          </div>
          <div className="h-56 overflow-hidden border border-slate-200">
            <Suspense fallback={<div className="flex h-full items-center justify-center text-xs text-slate-400">Loading map…</div>}>
              <PropertyMapPicker
                lat={formData.coordinates?.lat}
                lng={formData.coordinates?.lng}
                onLocationChange={({ lat, lng }) => setFormData((prev) => ({ ...prev, coordinates: { lat, lng } }))}
                addressHint={[formData.estateArea, formData.roadStreet, formData.townCityState].filter(Boolean).join(", ")}
              />
            </Suspense>
          </div>
        </div>

        {formData.listingEnabled && (
        <div className={`${sectionCard} p-2.5`}>
          <div className="mb-2 flex items-center justify-between">
            <span className={sectionHeader}>Listing contact</span>
          </div>
          <div className="grid grid-cols-1 gap-x-3 gap-y-2 md:grid-cols-3 xl:grid-cols-5">
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
              <AppSelect
                label="Preferred method"
                value={formData.listingContact?.preferredMethod || "phone"}
                onChange={(val) => handleListingContactChange("preferredMethod", val)}
                options={[
                  { value: "phone", label: "Phone" },
                  { value: "whatsapp", label: "WhatsApp" },
                  { value: "email", label: "Email" },
                ]}
              />
            </div>
          </div>
        </div>
        )}

        {formData.listingEnabled && (
        <div className={sectionCard}>
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-2.5 py-1.5">
            <span className={sectionHeader}>Nearby points of interest</span>
            <button type="button" onClick={addNearbyPoint} className="flex items-center gap-1 text-[11px] font-bold text-[#0B3B2E] hover:underline">
              <FaPlus size={9} /> Add point
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] table-auto text-xs">
              <thead className="text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-2 py-1">Category</th>
                  <th className="px-2 py-1">Label</th>
                  <th className="px-2 py-1">Distance</th>
                  <th className="px-1 py-1" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {formData.nearbyPoints.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-2 py-2 text-center italic text-slate-400">None added. For example: 400m to Tarmac Road.</td>
                  </tr>
                )}
                {formData.nearbyPoints.map((point, index) => (
                  <tr key={index}>
                    <td className="px-1 py-1">
                      <AppSelect size="sm" options={nearbyCategories} value={point.category} onChange={(val) => updateNearbyPoint(index, "category", val)} />
                    </td>
                    <td className="px-1 py-1">
                      <input type="text" value={point.label} onChange={(e) => updateNearbyPoint(index, "label", e.target.value)} placeholder="e.g. Tarmac Road" className={`${inputClass} h-7 text-xs`} />
                    </td>
                    <td className="px-1 py-1">
                      <input type="text" value={point.distance} onChange={(e) => updateNearbyPoint(index, "distance", e.target.value)} placeholder="400m" className={`${inputClass} h-7 text-xs`} />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <button type="button" onClick={() => removeNearbyPoint(index)} title="Remove" className="p-1 text-slate-400 hover:text-rose-600">
                        <FaTrash size={10} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        )}
      </div>
    );
  };

  const renderUtilityRates = () => {
    const updateRate = (index, patch) =>
      setFormData((p) => ({ ...p, utilityRates: p.utilityRates.map((r, i) => (i === index ? { ...r, ...patch } : r)) }));
    const cycleOptions = ["monthly", "quarterly", "annually", "per_use"].map((x) => ({
      value: x,
      label: x.charAt(0).toUpperCase() + x.slice(1).replace("_", " "),
    }));

    return (
      <div className="space-y-2">
        <p className="text-[11px] text-slate-500">
          Rates here override company defaults for this {termProperty.toLowerCase()}. Order used: reading entry, then the {termUnit.toLowerCase()} rate, then this rate.
        </p>

        <div className={sectionCard}>
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-2.5 py-1.5">
            <span className={sectionHeader}>Meter reading rates</span>
            <button type="button" onClick={addUtilityRate} className="flex items-center gap-1 text-[11px] font-bold text-[#0B3B2E] hover:underline">
              <FaPlus size={9} /> Add rate
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] table-auto text-xs">
              <thead className="text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-2 py-1">{termUtility}</th>
                  <th className="px-2 py-1 text-right">Cost per {termUnit.toLowerCase()} (KES)</th>
                  <th className="px-2 py-1">Billing cycle</th>
                  <th className="px-2 py-1 text-center">Active</th>
                  <th className="px-1 py-1" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {formData.utilityRates.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-2 py-2 text-center italic text-slate-400">No rates set. Company defaults apply.</td>
                  </tr>
                )}
                {formData.utilityRates.map((rate, index) => (
                  <tr key={index}>
                    <td className="px-1 py-1">
                      <AppSelect
                        size="sm"
                        placeholder={utilityTypeOptionsLoading ? "Loading..." : `Select ${termUtility.toLowerCase()}`}
                        options={utilityTypeOptions.map((x) => ({ value: x.name, label: x.name }))}
                        value={rate.utilityType}
                        disabled={utilityTypeOptionsLoading}
                        onChange={(val) => {
                          const item = utilityTypeOptions.find((x) => x.name === val);
                          updateRate(index, {
                            utilityType: val,
                            unitCost: item?.unitCost ?? rate.unitCost,
                            billingCycle: item?.billingCycle ?? rate.billingCycle,
                          });
                        }}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        min="0"
                        value={rate.unitCost}
                        onChange={(e) => updateRate(index, { unitCost: e.target.value })}
                        placeholder="0.00"
                        className={`${inputClass} h-7 text-xs text-right`}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <AppSelect
                        size="sm"
                        placeholder="Select cycle"
                        options={cycleOptions}
                        value={rate.billingCycle}
                        onChange={(val) => updateRate(index, { billingCycle: val })}
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <input type="checkbox" checked={Boolean(rate.isActive)} onChange={(e) => updateRate(index, { isActive: e.target.checked })} />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <button type="button" onClick={() => removeUtilityRate(index)} title="Remove" className="p-1 text-slate-400 hover:text-rose-600">
                        <FaTrash size={10} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };


  return (
    <>
      <DashboardLayout lockContentScroll>
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">
          {/* Tab navigation */}
          <div className="flex-shrink-0 border-b border-slate-200 bg-white px-2">
            <div className="flex flex-wrap gap-0.5">
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    disabled={loading}
                    className={[
                      "h-8 px-3 text-xs font-bold flex items-center gap-1.5 transition-all duration-200",
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
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <div className={`${sectionCard}`}>
            <form id="add-property-form" onSubmit={handleSubmit}>
              <div className="p-2.5">
                <div className={activeTab === "general" ? "" : "hidden"}>{renderGeneralInfo()}</div>
                <div className={activeTab === "space" ? "" : "hidden"}>{renderSpaceUnits()}</div>
                <div className={activeTab === "accounting" ? "" : "hidden"}>{renderAccountingBilling()}</div>
                <div className={activeTab === "utilityRates" ? "" : "hidden"}>{renderUtilityRates()}</div>
                <div className={activeTab === "banking" ? "" : "hidden"}>{renderBanking()}</div>
                <div className={activeTab === "notes" ? "" : "hidden"}>{renderNotes()}</div>
              </div>
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
                <button type="button" onClick={() => { clearDraftState(); navigate(-1); }} disabled={loading} className="border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
                <button type="button" onClick={handleReset} disabled={loading} className="border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Reset</button>
              {!isFirstTab && (
                <button
                  type="button"
                  onClick={handlePreviousTab}
                  disabled={loading}
                  className="border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Previous
                </button>
              )}

              {!isLastTab ? (
                <button
                  type="button"
                  onClick={handleNextTab}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 bg-[#0B3B2E] px-3 py-1.5 text-xs font-black text-white transition hover:bg-[#0A3127] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              ) : (
                <button
                  type="submit"
                  form="add-property-form"
                  disabled={loading || justEnteredLastTab}
                  className="inline-flex items-center gap-1.5 bg-[#0B3B2E] px-3 py-1.5 text-xs font-black text-white transition hover:bg-[#0A3127] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? <><FaSpinner className="animate-spin" /> Saving…</> : <><FaSave /> {isEditMode ? "Update" : "Save"} {termProperty}</>}
                </button>
              )}
              </div>
            </div>
          </div>
        </div>
      </DashboardLayout>

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

export default AddProperty;
