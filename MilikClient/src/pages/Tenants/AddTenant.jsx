import React, { useState, useEffect, useRef, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  selectCurrentUser,
  selectCurrentCompany,
  selectAllProperties,
  selectAllUnits,
} from "../../redux/selectors";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import {
  FaSave,
  FaTimes,
  FaChevronDown,
  FaSpinner,
  FaCalculator,
  FaPlus,
  FaTrash,
  FaUser,
  FaBuilding,
  FaMoneyBillWave,
  FaEnvelope,
  FaExclamationTriangle,
  FaPhone,
  FaIdCard,
  FaBolt,
  FaArrowLeft,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { getProperties } from "../../redux/propertyRedux";
import { getUnits } from "../../redux/unitRedux";
import { createTenant, getTenants, updateTenant } from "../../redux/tenantsRedux";
import { createTenantInvoice } from "../../redux/apiCalls";
import { adminRequests } from "../../utils/requestMethods";
import { isSelfManagingLandlordCompany } from "../../utils/companyModules";
import { hasCompanyPermission } from "../../utils/permissions";
import { normalizeUppercaseInput } from "../../utils/listingPageUtils";

// Milik theme constants
const MILIK_GREEN_BG = "bg-[#0B3B2E]";
const MILIK_GREEN_BG_HOVER = "hover:bg-[#0A3127]";
const MILIK_ORANGE_BG = "bg-[#FF8C00]";
const MILIK_ORANGE_BG_HOVER = "hover:bg-[#e67e00]";
const MILIK_ORANGE_RING = "";
const MILIK_ORANGE_BORDER_FOCUS = "";

const slugifyTakeOnValue = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "other";

const buildTakeOnMetadata = (config = {}) => ({
  isTakeOnBalance: true,
  takeOn: true,
  takeOnSource: "tenant_take_on",
  takeOnType: config.type || "debit",
  takeOnBillItemKey: config.billItemKey || "other",
  takeOnBillItemLabel: config.billItemLabel || "Take-On Balance",
  utilityType: config.utilityType || undefined,
  meterUtilityType: config.utilityType || undefined,
  invoicePriorityCategory: config.invoicePriorityCategory || undefined,
  takeOnUtilityBreakdown: Array.isArray(config.utilityBreakdown) ? config.utilityBreakdown : undefined,
  depositHeldBy: config.depositHeldBy || undefined,
  ledgerMode: config.ledgerMode || undefined,
});

const normalizeId = (value) => {
  if (!value) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") {
    if (value._id) return normalizeId(value._id);
    if (value.id) return normalizeId(value.id);
  }
  return String(value);
};

const parseTakeOnPreselection = (location) => {
  try {
    const params = new URLSearchParams(location?.search || "");
    const state = location?.state || {};
    const propertyId = normalizeId(state.preselectedPropertyId || params.get("propertyId"));
    const unitId = normalizeId(state.preselectedUnitId || params.get("unitId") || params.get("unit"));

    if (!propertyId || !unitId) {
      return null;
    }

    return {
      propertyId,
      unitId,
      source: String(state.preselectionSource || params.get("source") || "availability_status"),
      snapshot: state.preselectedUnitSnapshot && typeof state.preselectedUnitSnapshot === "object"
        ? state.preselectedUnitSnapshot
        : null,
    };
  } catch (error) {
    return null;
  }
};


const sanitizeTenantSaveError = (error, fallback = "Failed to save tenant") => {
  const rawMessage =
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.data?.message ||
    error?.message ||
    error?.error ||
    fallback;

  if (/E11000|duplicate key|MongoServerError|Milik\.leases|agreementNumber/i.test(String(rawMessage || ""))) {
    return "Tenant could not be created because the lease agreement number already exists. Please try again.";
  }

  return String(rawMessage || fallback);
};

const normalizeDepositHolder = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (["landlord", "held_by_landlord"].includes(normalized)) return "landlord";
  if (
    [
      "management company",
      "management_company",
      "propertymanager",
      "property manager",
      "property_manager",
      "manager",
    ].includes(normalized)
  ) {
    return "manager";
  }
  return "";
};

const getUnitPropertyId = (unit = {}) =>
  normalizeId(unit?.property?._id || unit?.property?.id || unit?.property);

const dedupeUnitsById = (items = []) =>
  (Array.isArray(items) ? items : []).filter((item, index, list) => {
    const itemId = normalizeId(item?._id || item?.id || item);
    return itemId && list.findIndex((candidate) => normalizeId(candidate?._id || candidate?.id || candidate) === itemId) === index;
  });

const formatDateInput = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
};

const normalizeUtilityEntry = (util = {}) => {
  let utilityLabel = "Unknown Utility";
  let utilityValue = "";

  if (util.utility && typeof util.utility === "object" && !Array.isArray(util.utility)) {
    utilityValue = util.utility._id || util.utility.name || util.utility.utilityName || "";
    utilityLabel = util.utility.name || util.utility.utilityName || "Unknown Utility";
  } else if (typeof util.utility === "string" && util.utility.trim() !== "") {
    utilityValue = util.utility.trim();
    utilityLabel = util.utilityLabel || util.utility.trim();
  } else if (typeof util.utilityLabel === "string" && util.utilityLabel.trim() !== "") {
    utilityLabel = util.utilityLabel.trim();
  }

  return {
    utility: utilityValue,
    utilityLabel,
    isIncluded: !!util.isIncluded,
    unitCharge: Number(util.unitCharge || 0),
  };
};

const buildUtilitySignature = (item = {}) => {
  return [
    String(item.utility || "").trim().toLowerCase(),
    String(item.utilityLabel || "").trim().toLowerCase(),
    Number(item.unitCharge || 0).toFixed(2),
    item.isIncluded ? "1" : "0",
  ].join("|");
};

const mergeUtilityEntries = (utilities = []) => {
  const merged = new Map();

  (Array.isArray(utilities) ? utilities : []).forEach((entry) => {
    const normalized = normalizeUtilityEntry(entry);
    const utilityValue = String(normalized.utility || normalized.utilityLabel || "").trim();
    const utilityLabel = String(normalized.utilityLabel || utilityValue || "").trim();
    const unitCharge = Number(normalized.unitCharge || 0);
    const isIncluded = !!normalized.isIncluded;

    if (!utilityValue && !utilityLabel) {
      return;
    }

    const signature = [utilityValue.toLowerCase(), utilityLabel.toLowerCase(), isIncluded ? "1" : "0"].join("|");
    const current = merged.get(signature) || {
      utility: utilityValue || utilityLabel,
      utilityLabel: utilityLabel || utilityValue,
      unitCharge: 0,
      isIncluded,
    };

    current.unitCharge = Number(current.unitCharge || 0) + unitCharge;
    if (!current.utility && utilityValue) current.utility = utilityValue;
    if (!current.utilityLabel && utilityLabel) current.utilityLabel = utilityLabel;

    merged.set(signature, current);
  });

  return Array.from(merged.values()).map((item) => ({
    utility: item.utility || item.utilityLabel || "",
    utilityLabel: item.utilityLabel || item.utility || "",
    unitCharge: Number(item.unitCharge || 0),
    isIncluded: !!item.isIncluded,
  }));
};

const buildUtilitiesPayload = ({ inheritedUtilities = [], customUtilities = [] } = {}) =>
  mergeUtilityEntries([
    ...(Array.isArray(inheritedUtilities) ? inheritedUtilities : []),
    ...(Array.isArray(customUtilities) ? customUtilities : []).map((item) => ({
      utility: String(item?.utility || item?.utilityLabel || "").trim(),
      utilityLabel: String(item?.utilityLabel || item?.utility || "").trim(),
      unitCharge: Number(item?.unitCharge || 0),
      isIncluded: !!item?.isIncluded,
    })),
  ]);

/**
 * Custom dropdown with Milik styling
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
  error,
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
          {label} {required ? <span className="text-red-500">*</span> : null}
        </label>
      ) : null}

      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((s) => !s)}
        className={[
          "w-full h-10 px-3 rounded-md bg-white text-slate-900 shadow-sm border",
          error ? "border-red-500" : "border-slate-300",
          "transition-all duration-200 ease-out hover:border-slate-400",
          `focus:outline-none focus:ring-2 ${MILIK_ORANGE_RING} ${MILIK_ORANGE_BORDER_FOCUS}`,
          "flex items-center justify-between gap-2",
          disabled ? "opacity-50 cursor-not-allowed" : "",
        ].join(" ")}
      >
        <span className="text-sm font-semibold truncate">
          {selectedItem ? (
            getLabel(selectedItem)
          ) : (
            <span className="text-slate-400">{placeholder}</span>
          )}
        </span>
        <FaChevronDown className="text-slate-600" />
      </button>

      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}

      {open && !disabled && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden">
          <div className="max-h-56 overflow-auto">
            {items.length === 0 ? (
              <div className="px-3 py-3 text-sm text-slate-500">No items available</div>
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
                        : "text-slate-800 hover:bg-slate-50",
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

const AddTenant = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { id: routeTenantId } = useParams();
  const isEditMode = Boolean(routeTenantId);

  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const canSaveTenant = isEditMode
    ? hasCompanyPermission(currentUser || {}, currentCompany, "tenants", "update", "propertyManagement")
    : hasCompanyPermission(currentUser || {}, currentCompany, "tenants", "create", "propertyManagement");
  const isSelfManagingLandlordMode = useMemo(
    () => isSelfManagingLandlordCompany(currentCompany || currentUser?.company || null),
    [currentCompany, currentUser?.company]
  );
  const { isFetching: loading } = useSelector(
    (state) => state.tenant || { isFetching: false }
  );
  const unitLoading = useSelector((state) => state.unit?.isFetching || false);
  const properties = useSelector(selectAllProperties);
  const units = useSelector(selectAllUnits);
  const activeProperties = useMemo(
    () => properties.filter((property) => String(property?.status || "active").toLowerCase() !== "archived"),
    [properties]
  );

  const generateNextTenantCode = () => "";

  const [formData, setFormData] = useState({
    tenantCode: generateNextTenantCode(),
    name: "",
    phone: "",
    email: "",
    idNumber: "",
    property: "",
    unit: "",
    additionalUnits: [],
    moveInDate: "",
    moveOutDate: "",
    leaseType: "at_will",
    rent: "",
    depositAmount: "",
    depositHeldBy: isSelfManagingLandlordMode ? "Landlord" : "Management Company",
    status: "active",
    emergencyContactName: "",
    emergencyContactPhone: "",
    emergencyContactRelationship: "Family",
    utilities: [],
    createLeaseFeeInvoice: false,
    leaseFeeAmount: "",
    leaseFeeDescription: "",
  });

  const [fieldErrors, setFieldErrors] = useState({});
  const [generalError, setGeneralError] = useState("");
  const [availableUnits, setAvailableUnits] = useState([]);
  const [currentEditUnit, setCurrentEditUnit] = useState(null);
  const [currentEditAdditionalUnits, setCurrentEditAdditionalUnits] = useState([]);
  const [additionalUtilities, setAdditionalUtilities] = useState([]);
  const [showAdditionalUnits, setShowAdditionalUnits] = useState(false);
  const [showInvoicePrompt, setShowInvoicePrompt] = useState(false);
  const [pendingInvoiceContext, setPendingInvoiceContext] = useState(null);
  const [isCreatingInitialInvoices, setIsCreatingInitialInvoices] = useState(false);
  const [tenantLoading, setTenantLoading] = useState(false);
  const [openingInvoiceMode, setOpeningInvoiceMode] = useState("separate");
  const [utilityOptions, setUtilityOptions] = useState([]);
  const draftStorageKey = currentCompany?._id ? `milik:new-tenant-draft:${currentCompany._id}:${currentUser?._id || currentUser?.id || currentUser?.email || "user"}` : null;
  const draftRestoredRef = useRef(false);
  const lastPropertyRef = useRef("");
  const skipNextUnitAutofillRef = useRef(false);
  const additionalUtilitiesSectionRef = useRef(null);
  const utilityActionAppliedRef = useRef(false);
  const takeOnPreselectionAppliedRef = useRef(false);
  const [takeOnPreselection, setTakeOnPreselection] = useState(null);
  const [takeOnSelectionLocked, setTakeOnSelectionLocked] = useState(false);

  useEffect(() => {
    if (currentCompany?._id) {
      dispatch(getProperties({ business: currentCompany._id }));
      dispatch(getUnits({ business: currentCompany._id }));
      adminRequests
        .get(`/company-settings/${currentCompany._id}`)
        .then((res) => {
          const names = Array.from(new Set((res?.data?.utilityTypes || [])
            .filter((item) => item?.isActive !== false && item?.name)
            .map((item) => String(item.name))));
          setUtilityOptions(names);
        })
        .catch(() => setUtilityOptions([]));
    }
  }, [dispatch, currentCompany]);

  useEffect(() => {
    if (utilityActionAppliedRef.current) return;
    if (location.state?.focusSection !== "additional-utilities") return;
    if (loading || tenantLoading) return;

    utilityActionAppliedRef.current = true;

    if (location.state?.autoAddUtility && additionalUtilities.length === 0) {
      setAdditionalUtilities((prev) =>
        prev.length > 0 ? prev : [{ utility: "", unitCharge: "", isIncluded: false }]
      );
    }

    const scrollToUtilities = () => {
      additionalUtilitiesSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    };

    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(scrollToUtilities);
    } else {
      scrollToUtilities();
    }
  }, [location.state, loading, tenantLoading, additionalUtilities.length]);

  useEffect(() => {
    if (isEditMode) return;

    const parsedPreselection = parseTakeOnPreselection(location);
    if (!parsedPreselection?.propertyId || !parsedPreselection?.unitId) return;

    const preselectionChanged =
      normalizeId(takeOnPreselection?.propertyId) !== normalizeId(parsedPreselection.propertyId) ||
      normalizeId(takeOnPreselection?.unitId) !== normalizeId(parsedPreselection.unitId);

    if (takeOnPreselectionAppliedRef.current && !preselectionChanged) {
      return;
    }

    takeOnPreselectionAppliedRef.current = true;
    setTakeOnPreselection(parsedPreselection);
    setTakeOnSelectionLocked(true);
    setShowAdditionalUnits(false);
    setAdditionalUtilities([]);
    setGeneralError("");
    lastPropertyRef.current = parsedPreselection.propertyId;

    setFormData((prev) => ({
      ...prev,
      property: parsedPreselection.propertyId,
      unit: parsedPreselection.unitId,
      additionalUnits: [],
      rent: "",
      depositAmount: "",
      utilities: [],
    }));

    setFieldErrors((prev) => ({
      ...prev,
      property: "",
      unit: "",
      additionalUnits: "",
    }));
  }, [isEditMode, location, takeOnPreselection?.propertyId, takeOnPreselection?.unitId]);

  useEffect(() => {
    if (!formData.property) {
      lastPropertyRef.current = "";
      setAvailableUnits([]);
      setShowAdditionalUnits(false);
      setFormData((prev) => ({ ...prev, unit: "", additionalUnits: [], utilities: [] }));
      setAdditionalUtilities([]);
      return;
    }

    if (unitLoading && (!Array.isArray(units) || units.length === 0) && !currentEditUnit) {
      return;
    }

    const propertyId = normalizeId(formData.property);
    const propertyUnitsFromStore = (Array.isArray(units) ? units : []).filter(
      (unit) => getUnitPropertyId(unit) === propertyId
    );

    const propertyUnitsForEdit = dedupeUnitsById(
      [currentEditUnit, ...(Array.isArray(currentEditAdditionalUnits) ? currentEditAdditionalUnits : [])].filter(
        (unit) => getUnitPropertyId(unit) === propertyId
      )
    );

    const propertyUnits = dedupeUnitsById([...propertyUnitsFromStore, ...propertyUnitsForEdit]);

    const vacant = propertyUnits.filter((unit) => {
      const status = String(unit?.status || "").toLowerCase();
      return status === "vacant" && unit?.isVacant !== false;
    });

    const selectedUnitIds = new Set(
      [
        normalizeId(formData.unit),
        ...(Array.isArray(formData.additionalUnits)
          ? formData.additionalUnits.map((unitId) => normalizeId(unitId))
          : []),
      ].filter(Boolean)
    );

    const selectedOccupiedUnits = propertyUnits.filter((unit) =>
      selectedUnitIds.has(normalizeId(unit?._id || unit?.id || unit))
    );

    const unitOptions = dedupeUnitsById([...selectedOccupiedUnits, ...vacant]);

    setAvailableUnits(unitOptions);

    if (lastPropertyRef.current && lastPropertyRef.current !== formData.property) {
      setShowAdditionalUnits(false);
      setFormData((prev) => ({ ...prev, unit: "", additionalUnits: [], utilities: [], rent: "", depositAmount: "" }));
      setAdditionalUtilities([]);
    }

    lastPropertyRef.current = formData.property;
  }, [
    currentEditAdditionalUnits,
    currentEditUnit,
    formData.additionalUnits,
    formData.property,
    formData.unit,
    unitLoading,
    units,
  ]);


useEffect(() => {
  if (!formData.unit) {
    if (Array.isArray(formData.additionalUnits) && formData.additionalUnits.length > 0) {
      setFormData((prev) => ({ ...prev, additionalUnits: [] }));
    }
    return;
  }

  const cleanedAdditionalUnits = Array.from(
    new Set((Array.isArray(formData.additionalUnits) ? formData.additionalUnits : []).filter((unitId) => normalizeId(unitId) !== normalizeId(formData.unit)))
  );

  const assignedUnits = availableUnits.filter((unit) =>
    [formData.unit, ...cleanedAdditionalUnits].some((unitId) => normalizeId(unitId) === normalizeId(unit?._id))
  );

  const computedRent = assignedUnits.reduce((sum, unit) => sum + Number(unit?.rent || 0), 0);
  const nextRent = computedRent > 0 ? String(computedRent) : formData.rent;
  const additionalChanged = cleanedAdditionalUnits.join(",") !== (Array.isArray(formData.additionalUnits) ? formData.additionalUnits.map((unitId) => normalizeId(unitId)).join(",") : "");
  const rentChanged = nextRent !== String(formData.rent ?? "");

  if (!additionalChanged && !rentChanged) {
    return;
  }

  setFormData((prev) => ({
    ...prev,
    additionalUnits: additionalChanged ? cleanedAdditionalUnits : prev.additionalUnits,
    rent: rentChanged ? nextRent : prev.rent,
  }));
}, [availableUnits, formData.additionalUnits, formData.rent, formData.unit]);

  useEffect(() => {
    if (!formData.unit || availableUnits.length === 0) return;

    const assignedUnitRecords = availableUnits.filter((unit) =>
      [formData.unit, ...(Array.isArray(formData.additionalUnits) ? formData.additionalUnits : [])].some(
        (unitId) => normalizeId(unitId) === normalizeId(unit?._id)
      )
    );

    const selectedUnit = assignedUnitRecords.find(
      (u) => normalizeId(u._id) === normalizeId(formData.unit)
    );

    if (!selectedUnit) return;

    const mappedUtilities = mergeUtilityEntries(
      assignedUnitRecords.flatMap((unit) => (unit?.utilities || []).map((util) => normalizeUtilityEntry(util)))
    );

    if (skipNextUnitAutofillRef.current) {
      skipNextUnitAutofillRef.current = false;
      return;
    }

    setFormData((prev) => ({
      ...prev,
      depositAmount:
        prev.depositAmount !== "" && prev.depositAmount !== null && prev.depositAmount !== undefined
          ? prev.depositAmount
          : String(selectedUnit.deposit || selectedUnit.rent || ""),
      utilities: mappedUtilities,
    }));
  }, [availableUnits, formData.additionalUnits, formData.unit]);


  const selectedUnitRecord = useMemo(() => {
    const selectedUnitId = normalizeId(formData.unit);
    if (!selectedUnitId) return null;

    return (
      availableUnits.find((unit) => normalizeId(unit?._id || unit?.id || unit) === selectedUnitId) ||
      (normalizeId(currentEditUnit?._id || currentEditUnit?.id || currentEditUnit) === selectedUnitId
        ? currentEditUnit
        : null) ||
      null
    );
  }, [availableUnits, currentEditUnit, formData.unit]);

  const selectedAdditionalUnitRecords = useMemo(() => {
    const selectedIds = new Set(
      Array.isArray(formData.additionalUnits)
        ? formData.additionalUnits.map((unitId) => normalizeId(unitId)).filter(Boolean)
        : []
    );

    return dedupeUnitsById([
      ...availableUnits.filter((unit) =>
        selectedIds.has(normalizeId(unit?._id || unit?.id || unit))
      ),
      ...(Array.isArray(currentEditAdditionalUnits) ? currentEditAdditionalUnits.filter((unit) =>
        selectedIds.has(normalizeId(unit?._id || unit?.id || unit))
      ) : []),
    ]);
  }, [availableUnits, currentEditAdditionalUnits, formData.additionalUnits]);

  const inheritedUnitUtilities = useMemo(
    () => mergeUtilityEntries([...(Array.isArray(formData.utilities) ? formData.utilities : [])]),
    [formData.utilities]
  );

  const combinedUtilitiesPreview = useMemo(
    () => buildUtilitiesPayload({ inheritedUtilities: inheritedUnitUtilities, customUtilities: additionalUtilities }),
    [additionalUtilities, inheritedUnitUtilities]
  );


  const selectedPropertyRecord = useMemo(
    () =>
      properties.find((property) => normalizeId(property?._id) === normalizeId(formData.property)) || null,
    [properties, formData.property]
  );

  const isLettingProperty = selectedPropertyRecord?.letManage === "Letting";

  const computedLettingFee = useMemo(() => {
    if (!isLettingProperty) return 0;
    const rent = parseFloat(formData.rent) || 0;
    const feeMode = selectedPropertyRecord?.lettingFeeMode || "percentage";
    const feeValue = parseFloat(selectedPropertyRecord?.lettingFeeValue ?? 100) || 0;
    if (feeMode === "fixed") return Math.round(feeValue * 100) / 100;
    return Math.round((feeValue / 100) * rent * 100) / 100;
  }, [isLettingProperty, formData.rent, selectedPropertyRecord?.lettingFeeMode, selectedPropertyRecord?.lettingFeeValue]);

  useEffect(() => {
    if (isEditMode) return;
    if (!isLettingProperty) {
      setFormData((prev) => {
        if (!prev.createLeaseFeeInvoice && prev.leaseFeeAmount === "") return prev;
        return { ...prev, createLeaseFeeInvoice: false, leaseFeeAmount: "", leaseFeeDescription: "" };
      });
      return;
    }
    setFormData((prev) => ({
      ...prev,
      createLeaseFeeInvoice: true,
      leaseFeeAmount: prev.leaseFeeAmount || (computedLettingFee > 0 ? String(computedLettingFee) : ""),
      leaseFeeDescription: prev.leaseFeeDescription || "Letting fee",
    }));
  }, [isEditMode, isLettingProperty, computedLettingFee]);

  const selectedPrimaryUnitStatus = useMemo(() => {
    const unitRecord = selectedUnitRecord || (Array.isArray(units)
      ? units.find((unit) => normalizeId(unit?._id || unit?.id || unit) === normalizeId(formData.unit))
      : null);
    const rawStatus = String(unitRecord?.status || takeOnPreselection?.snapshot?.status || "").toLowerCase();
    if (rawStatus === "reserved") return "Reserved";
    if (rawStatus === "vacant" || unitRecord?.isVacant !== false) return "Vacant";
    if (rawStatus === "occupied") return "Occupied";
    if (rawStatus === "under_maintenance") return "Under Maintenance";
    if (rawStatus === "off_market" || rawStatus === "archived") return "Off Market";
    return rawStatus ? rawStatus.replace(/[_-]+/g, " ") : "Unknown";
  }, [formData.unit, selectedUnitRecord, takeOnPreselection?.snapshot?.status, units]);

  const preselectedUnitBanner = useMemo(() => {
    if (!takeOnPreselection) return null;
    const propertyName =
      selectedPropertyRecord?.propertyName ||
      selectedPropertyRecord?.name ||
      takeOnPreselection?.snapshot?.propertyName ||
      "Selected Property";
    const unitNumber =
      selectedUnitRecord?.unitNumber ||
      selectedUnitRecord?.unitName ||
      takeOnPreselection?.snapshot?.unitNumber ||
      "Selected Unit";
    return {
      propertyName,
      unitNumber,
      statusLabel: takeOnPreselection?.snapshot?.statusLabel || selectedPrimaryUnitStatus,
      rentLabel:
        selectedUnitRecord?.rent !== undefined && selectedUnitRecord?.rent !== null
          ? `Ksh ${Number(selectedUnitRecord.rent || 0).toLocaleString("en-KE")}`
          : null,
    };
  }, [selectedPrimaryUnitStatus, selectedPropertyRecord, selectedUnitRecord, takeOnPreselection]);

  useEffect(() => {
    if (isEditMode) return;
    if (!isSelfManagingLandlordMode) return;
    if (formData.depositHeldBy === "Landlord") return;

    setFormData((prev) => ({
      ...prev,
      depositHeldBy: "Landlord",
    }));
  }, [formData.depositHeldBy, isEditMode, isSelfManagingLandlordMode]);

  useEffect(() => {
    if (isEditMode || !draftStorageKey) {
      draftRestoredRef.current = true;
      return;
    }
    try {
      const savedDraft = sessionStorage.getItem(draftStorageKey);
      if (!savedDraft) return;
      const parsedDraft = JSON.parse(savedDraft);
      if (parsedDraft?.formData && typeof parsedDraft.formData === "object") {
        lastPropertyRef.current = parsedDraft.formData.property || "";
        setFormData((prev) => ({ ...prev, ...parsedDraft.formData }));
      }
      if (Array.isArray(parsedDraft?.additionalUtilities)) {
        setAdditionalUtilities(parsedDraft.additionalUtilities);
      }
      if (parsedDraft?.openingInvoiceMode) {
        setOpeningInvoiceMode(parsedDraft.openingInvoiceMode);
      }
      if (typeof parsedDraft?.showAdditionalUnits === "boolean") {
        setShowAdditionalUnits(parsedDraft.showAdditionalUnits);
      }
    } catch (draftError) {
      console.warn("Failed to restore tenant draft", draftError);
    } finally {
      draftRestoredRef.current = true;
    }
  }, [draftStorageKey, isEditMode]);

  useEffect(() => {
    if (isEditMode || !draftStorageKey || !draftRestoredRef.current) return;
    try {
      sessionStorage.setItem(
        draftStorageKey,
        JSON.stringify({
          formData,
          additionalUtilities,
          openingInvoiceMode,
          showAdditionalUnits,
        })
      );
    } catch (draftError) {
      console.warn("Failed to persist tenant draft", draftError);
    }
  }, [additionalUtilities, draftStorageKey, formData, isEditMode, openingInvoiceMode, showAdditionalUnits]);


  useEffect(() => {
    if (!isEditMode || !routeTenantId) return;

    let isMounted = true;

    const loadTenantForEdit = async () => {
      setTenantLoading(true);
      setGeneralError("");

      try {
        const response = await adminRequests.get(`/tenants/${routeTenantId}`, {
          params: currentCompany?._id ? { business: currentCompany._id } : undefined,
        });

        const tenant = response?.data?.data || response?.data?.tenant || response?.data;
        if (!tenant?._id) {
          throw new Error("Tenant record could not be loaded for editing.");
        }

        const unitId = normalizeId(tenant.unit?._id || tenant.unit?.id || tenant.unit);
        const propertyId = normalizeId(
          tenant.property?._id ||
          tenant.property?.id ||
          tenant.property ||
          tenant.unit?.property?._id ||
          tenant.unit?.property?.id ||
          tenant.unit?.property
        );
        const normalizedTenantUtilities = Array.isArray(tenant.utilities)
          ? tenant.utilities.map((item) => normalizeUtilityEntry(item))
          : [];
        const normalizedAssignedUnitUtilities = mergeUtilityEntries(
          [tenant.unit, ...(Array.isArray(tenant.additionalUnits) ? tenant.additionalUnits : [])].flatMap((unitRecord) =>
            (Array.isArray(unitRecord?.utilities) ? unitRecord.utilities : []).map((item) => normalizeUtilityEntry(item))
          )
        );

        const unitUtilityCounts = normalizedAssignedUnitUtilities.reduce((map, item) => {
          const signature = buildUtilitySignature(item);
          map.set(signature, (map.get(signature) || 0) + 1);
          return map;
        }, new Map());

        const derivedAdditionalUtilities = [];
        normalizedTenantUtilities.forEach((item) => {
          const signature = buildUtilitySignature(item);
          const currentCount = unitUtilityCounts.get(signature) || 0;
          if (currentCount > 0) {
            unitUtilityCounts.set(signature, currentCount - 1);
          } else {
            derivedAdditionalUtilities.push(item);
          }
        });

        if (!isMounted) return;

        skipNextUnitAutofillRef.current = true;
        lastPropertyRef.current = propertyId || "";
        setCurrentEditUnit(tenant.unit || null);
        setCurrentEditAdditionalUnits(
          Array.isArray(tenant.additionalUnits) ? tenant.additionalUnits.filter(Boolean) : []
        );
        setFormData((prev) => ({
          ...prev,
          tenantCode: tenant.tenantCode || "",
          name: tenant.name || "",
          phone: tenant.phone || "",
          email: tenant.email || "",
          idNumber: tenant.idNumber || "",
          property: propertyId,
          unit: unitId,
          additionalUnits: Array.isArray(tenant.additionalUnits) ? tenant.additionalUnits.map((item) => normalizeId(item?._id || item?.id || item)) : [],
          moveInDate: formatDateInput(tenant.moveInDate),
          moveOutDate: formatDateInput(tenant.moveOutDate),
          leaseType: tenant.leaseType || "at_will",
          rent:
            tenant.rent !== undefined && tenant.rent !== null ? String(tenant.rent) : "",
          depositAmount:
            tenant.depositAmount !== undefined && tenant.depositAmount !== null
              ? String(tenant.depositAmount)
              : "",
          depositHeldBy: tenant.depositHeldBy || "Management Company",
          status: tenant.status || "active",
          emergencyContactName: tenant.emergencyContact?.name || "",
          emergencyContactPhone: tenant.emergencyContact?.phone || "",
          emergencyContactRelationship:
            tenant.emergencyContact?.relationship || "Family",
          utilities: normalizedAssignedUnitUtilities.length
            ? normalizedAssignedUnitUtilities
            : normalizedTenantUtilities,
        }));
        setAdditionalUtilities(derivedAdditionalUtilities);
        setShowAdditionalUnits(
          Array.isArray(tenant.additionalUnits) && tenant.additionalUnits.length > 0
        );
      } catch (error) {
        if (!isMounted) return;
        const message =
          error?.response?.data?.message ||
          error?.message ||
          "Failed to load tenant details for editing.";
        setGeneralError(message);
        toast.error(message);
      } finally {
        if (isMounted) {
          setTenantLoading(false);
        }
      }
    };

    loadTenantForEdit();

    return () => {
      isMounted = false;
    };
  }, [currentCompany?._id, isEditMode, routeTenantId]);

  useEffect(() => {
    if (!isEditMode) return;
    if (currentEditUnit || !formData.unit || !Array.isArray(units) || units.length === 0) return;

    const matchedUnit = units.find(
      (unit) => normalizeId(unit?._id || unit?.id || unit) === normalizeId(formData.unit)
    );

    if (matchedUnit) {
      setCurrentEditUnit(matchedUnit);
    }
  }, [currentEditUnit, formData.unit, isEditMode, units]);

  useEffect(() => {
    if (!isEditMode || formData.unit || !currentEditUnit) return;

    const currentUnitId = normalizeId(currentEditUnit?._id || currentEditUnit?.id || currentEditUnit);
    if (!currentUnitId) return;

    setFormData((prev) => (prev.unit ? prev : { ...prev, unit: currentUnitId }));
  }, [currentEditUnit, formData.unit, isEditMode]);

  const clearDraftState = () => {
    if (isEditMode || !draftStorageKey) return;
    sessionStorage.removeItem(draftStorageKey);
  };

  const invoicePreviewItems = useMemo(() => {
    const utilityRows = combinedUtilitiesPreview
      .filter((item) => item && !item.isIncluded && Number(item.unitCharge || 0) > 0)
      .map((item) => ({
        label: item.utilityLabel || item.utility || "Utility",
        amount: Number(item.unitCharge || 0),
      }));

    const utilityTotal = utilityRows.reduce((sum, item) => sum + Number(item.amount || 0), 0);

    const items = [];

    if (Number(formData.rent || 0) > 0) {
      items.push({
        key: "rent",
        title: "Rent",
        amount: Number(formData.rent || 0),
        detail: selectedUnitRecord?.unitNumber
          ? `Monthly rent for Unit ${selectedUnitRecord.unitNumber}`
          : "Monthly rent charge",
      });
    }

    if (utilityTotal > 0) {
      items.push({
        key: "utility",
        title: "Utilities",
        amount: utilityTotal,
        detail: utilityRows.map((row) => row.label).join(", "),
      });
    }

    if (Number(formData.depositAmount || 0) > 0) {
      items.push({
        key: "deposit",
        title: "Deposit",
        amount: Number(formData.depositAmount || 0),
        detail: `Held by ${formData.depositHeldBy || (isSelfManagingLandlordMode ? "Landlord" : "Management Company")}`,
      });
    }

    return items;
  }, [combinedUtilitiesPreview, formData.depositAmount, formData.depositHeldBy, formData.rent, selectedUnitRecord]);


  const buildTenantInvoiceContext = (savedTenantPayload) => {
    const savedTenant =
      savedTenantPayload?.data && typeof savedTenantPayload.data === "object"
        ? savedTenantPayload.data
        : savedTenantPayload;

    if (!savedTenant?._id) {
      throw new Error("Saved tenant record was not returned from the backend.");
    }

    const propertyId =
      selectedPropertyRecord?._id ||
      selectedUnitRecord?.property?._id ||
      selectedUnitRecord?.property ||
      savedTenant?.property?._id ||
      savedTenant?.property ||
      formData.property;

    const landlordId =
      selectedPropertyRecord?.landlords?.[0]?.landlordId?._id ||
      selectedPropertyRecord?.landlords?.[0]?.landlordId ||
      selectedPropertyRecord?.landlords?.[0]?._id ||
      selectedPropertyRecord?.landlords?.[0] ||
      null;

    const unitId =
      savedTenant?.unit?._id ||
      savedTenant?.unit ||
      selectedUnitRecord?._id ||
      formData.unit;

    if (!currentCompany?._id || !propertyId || !landlordId || !unitId) {
      throw new Error("Tenant was saved, but invoice context is incomplete for property, landlord, or unit.");
    }

    const invoiceDate = formData.moveInDate ? new Date(formData.moveInDate) : new Date();
    const dueDate = new Date(invoiceDate.getFullYear(), invoiceDate.getMonth() + 1, 0);

    return {
      tenant: savedTenant,
      business: currentCompany._id,
      property: propertyId,
      landlord: landlordId,
      unit: unitId,
      invoiceDate,
      dueDate,
      leaseFeeAmount: formData.createLeaseFeeInvoice ? parseFloat(formData.leaseFeeAmount || 0) : 0,
      isLettingFee: isLettingProperty,
      items: invoicePreviewItems,
      utilityRows: combinedUtilitiesPreview
        .filter((item) => item && !item.isIncluded && Number(item.unitCharge || 0) > 0)
        .map((item) => ({
          label: item.utilityLabel || item.utility || "Utility",
          amount: Number(item.unitCharge || 0),
        })),
    };
  };

  const inputClass =
    "w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";

  const labelClass = "mb-0.5 block text-xs font-semibold text-slate-700";

  const uppercaseTenantFields = new Set(["tenantCode", "name", "idNumber", "emergencyContactName"]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    const nextValue = uppercaseTenantFields.has(name) ? normalizeUppercaseInput(value) : value;
    setFormData((prev) => ({ ...prev, [name]: nextValue }));

    if (fieldErrors[name]) {
      setFieldErrors((prev) => ({ ...prev, [name]: "" }));
    }
    if (generalError) {
      setGeneralError("");
    }
  };

  const calculateProratedRent = () => {
    if (!formData.moveInDate || !formData.rent) return null;

    const startDate = new Date(formData.moveInDate);
    const day = startDate.getDate();
    if (day === 1) return null;

    const month = startDate.getMonth();
    const year = startDate.getFullYear();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const remainingDays = daysInMonth - day + 1;
    const monthlyRent = parseFloat(formData.rent) || 0;
    const dailyRate = monthlyRent / daysInMonth;
    const proratedAmount = dailyRate * remainingDays;

    return {
      daysInMonth,
      remainingDays,
      dailyRate,
      proratedAmount,
    };
  };

  const proratedInfo = calculateProratedRent();

  const addAdditionalUtility = () => {
    setAdditionalUtilities((prev) => [
      ...prev,
      { utility: "", unitCharge: "", isIncluded: false },
    ]);
  };

  const removeAdditionalUtility = (index) => {
    setAdditionalUtilities((prev) => prev.filter((_, i) => i !== index));
  };

  const updateAdditionalUtility = (index, field, value) => {
    setAdditionalUtilities((prev) => {
      const updated = [...prev];
      const normalizedValue = field === "utility" ? String(value || "").trim() : value;
      updated[index] = {
        ...updated[index],
        [field]: normalizedValue,
        ...(field === "utility" ? { utilityLabel: normalizedValue } : {}),
      };
      return updated;
    });
  };

  const validateForm = () => {
    const errors = {};

    if (!formData.name?.trim()) errors.name = "Tenant name is required";
    if (formData.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      errors.email = "Enter a valid email address";
    }
    if (!formData.property?.trim()) errors.property = "Property is required";
    if (!formData.unit?.trim()) errors.unit = "Unit is required";
    if (Array.isArray(formData.additionalUnits) && formData.additionalUnits.some((unitId) => normalizeId(unitId) === normalizeId(formData.unit))) {
      errors.additionalUnits = "Additional units cannot include the primary unit";
    }
    if (!formData.moveInDate) errors.moveInDate = "Move-in date is required (billing anchor)";
    if (!formData.rent || parseFloat(formData.rent) <= 0) {
      errors.rent = "Valid monthly rent is required";
    }
    if (formData.depositAmount === "" || Number(formData.depositAmount) < 0) {
      errors.depositAmount = "Deposit amount is required";
    }
    if (!["Management Company", "Landlord"].includes(formData.depositHeldBy)) {
      errors.depositHeldBy = "Choose who holds the deposit";
    }

    const invalidAdditionalUtility = (Array.isArray(additionalUtilities) ? additionalUtilities : []).find((item) => {
      const hasAnyValue = String(item?.utility || item?.utilityLabel || "").trim() || String(item?.unitCharge || "").trim();
      if (!hasAnyValue) return false;
      return !String(item?.utility || item?.utilityLabel || "").trim() || Number(item?.unitCharge || 0) < 0;
    });

    if (invalidAdditionalUtility) {
      errors.additionalUtilities = "Complete each added utility with a utility type and a valid charge.";
    }

    if (formData.leaseType === "fixed" && !formData.moveOutDate) {
      errors.moveOutDate = "Move-out date is required for fixed-term leases";
    }

    if (formData.leaseType === "fixed" && formData.moveInDate && formData.moveOutDate) {
      const moveIn = new Date(formData.moveInDate);
      const moveOut = new Date(formData.moveOutDate);
      if (moveOut <= moveIn) {
        errors.moveOutDate = "Move-out date must be after move-in date";
      }
    }

    if (!isEditMode && formData.createLeaseFeeInvoice) {
      if (formData.leaseFeeAmount === "" || Number(formData.leaseFeeAmount) <= 0) {
        errors.leaseFeeAmount = "Enter a valid lease / agreement fee amount";
      }
    }

    setFieldErrors(errors);
    return errors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSaveTenant) {
      toast.error(isEditMode ? "You do not have permission to update tenants" : "You do not have permission to create tenants");
      return;
    }
    setGeneralError("");

    const errors = validateForm();
    if (Object.keys(errors).length > 0) {
      toast.error("Please fix validation errors");
      return;
    }

    const selectedUnitForSubmission =
      selectedUnitRecord ||
      (Array.isArray(units)
        ? units.find((unit) => normalizeId(unit?._id || unit?.id || unit) === normalizeId(formData.unit))
        : null);

    if (!isEditMode) {
      const currentUnitStatus = String(selectedUnitForSubmission?.status || "").toLowerCase();
      const isUnitAssignable =
        (currentUnitStatus === "vacant" && selectedUnitForSubmission?.isVacant !== false) ||
        currentUnitStatus === "reserved";

      if (!selectedUnitForSubmission || !isUnitAssignable) {
        const availabilityMessage = "The selected unit is no longer available for tenant take-on. Refresh the Availability Status page and choose another unit.";
        setGeneralError(availabilityMessage);
        setFieldErrors((prev) => ({ ...prev, unit: availabilityMessage }));
        toast.error(availabilityMessage);
        return;
      }
    }

    try {
      const payload = {
        ...formData,
        additionalUnits: showAdditionalUnits
          ? Array.from(new Set((Array.isArray(formData.additionalUnits) ? formData.additionalUnits : []).map((unitId) => normalizeId(unitId)).filter(Boolean)))
          : [],
        rent: parseFloat(formData.rent),
        depositAmount: parseFloat(formData.depositAmount || 0),
        business: currentCompany?._id,
        utilities: buildUtilitiesPayload({
          inheritedUtilities: inheritedUnitUtilities,
          customUtilities: additionalUtilities,
        }),
        emergencyContact: {
          name: formData.emergencyContactName || "",
          phone: formData.emergencyContactPhone || "",
          relationship: formData.emergencyContactRelationship || "Family",
        },
        createLeaseFeeInvoice: !isEditMode && !!formData.createLeaseFeeInvoice,
        leaseFeeAmount: !isEditMode && formData.createLeaseFeeInvoice ? parseFloat(formData.leaseFeeAmount || 0) : 0,
        leaseFeeDescription: !isEditMode && formData.createLeaseFeeInvoice ? formData.leaseFeeDescription || "" : "",
      };

      const result = isEditMode
        ? await dispatch(updateTenant({ id: routeTenantId, tenantData: payload })).unwrap()
        : await dispatch(createTenant(payload)).unwrap();
      clearDraftState();
      toast.success(result?.message || `Tenant ${isEditMode ? "updated" : "created"} successfully!`);

      setAdditionalUtilities([]);
      dispatch(getTenants({ business: currentCompany?._id }));

      if (isEditMode) {
        navigate("/tenants");
        return;
      }

      const nextInvoiceContext = buildTenantInvoiceContext(result);
      if (!nextInvoiceContext.items.length) {
        navigate("/tenants");
        return;
      }

      setPendingInvoiceContext(nextInvoiceContext);
      setShowInvoicePrompt(true);
    } catch (err) {
      const errorMsg = sanitizeTenantSaveError(
        err,
        `Failed to ${isEditMode ? "update" : "create"} tenant`
      );
      setGeneralError(errorMsg);
      toast.error(errorMsg);
    }
  };

  const handleConfirmInitialInvoicing = async () => {
    if (!pendingInvoiceContext?.tenant?._id) {
      toast.error("Saved tenant invoice context is missing.");
      setShowInvoicePrompt(false);
      navigate("/tenants");
      return;
    }

    try {
      setIsCreatingInitialInvoices(true);

      const actorId =
        currentUser?._id ||
        currentUser?.id ||
        pendingInvoiceContext.tenant?.createdBy?._id ||
        pendingInvoiceContext.tenant?.createdBy ||
        null;

      const baseRequest = {
        business: pendingInvoiceContext.business,
        property: pendingInvoiceContext.property,
        landlord: pendingInvoiceContext.landlord,
        tenant: pendingInvoiceContext.tenant._id,
        unit: pendingInvoiceContext.unit,
        invoiceDate: pendingInvoiceContext.invoiceDate,
        dueDate: pendingInvoiceContext.dueDate,
        createdBy: actorId,
      };

const invoiceRequests = [];
const rentItem = pendingInvoiceContext.items.find((item) => item.key === "rent");
const utilityRows = pendingInvoiceContext.utilityRows.filter(
  (item) => Number(item.amount || 0) > 0
);
const utilityTotal = utilityRows.reduce(
  (sum, item) => sum + Number(item.amount || 0),
  0
);
const depositItem = pendingInvoiceContext.items.find((item) => item.key === "deposit");
const normalizedDepositHolder = normalizeDepositHolder(formData.depositHeldBy) || "manager";
const depositLedgerMode = normalizedDepositHolder === "landlord" ? "off_ledger" : undefined;

if (Number(rentItem?.amount || 0) > 0) {
  invoiceRequests.push({
    ...baseRequest,
    category: "RENT_CHARGE",
    amount: Number(rentItem.amount || 0),
    description: `Opening rent balance for ${pendingInvoiceContext.tenant.name || formData.name}`,
    metadata: buildTakeOnMetadata({
      type: "debit",
      billItemKey: "rent",
      billItemLabel: "Rent",
      invoicePriorityCategory: "rent",
    }),
  });
}

if (utilityRows.length > 0) {
  utilityRows.forEach((item) => {
    const utilityLabel = item.label || "Utility";
    invoiceRequests.push({
      ...baseRequest,
      category: "UTILITY_CHARGE",
      amount: Number(item.amount || 0),
      description: `Opening ${utilityLabel} balance for ${pendingInvoiceContext.tenant.name || formData.name}`,
      metadata: buildTakeOnMetadata({
        type: "debit",
        billItemKey: `utility:${slugifyTakeOnValue(utilityLabel)}`,
        billItemLabel: utilityLabel,
        utilityType: utilityLabel,
        meterUtilityType: utilityLabel,
        statementUtilityType: utilityLabel,
        invoicePriorityCategory: "utility",
      }),
    });
  });
}

if (Number(depositItem?.amount || 0) > 0) {
  invoiceRequests.push({
    ...baseRequest,
    category: "DEPOSIT_CHARGE",
    amount: Number(depositItem.amount || 0),
    depositHeldBy: normalizedDepositHolder,
    ledgerMode: depositLedgerMode,
    description: `Opening deposit balance (${formData.depositHeldBy}) for ${pendingInvoiceContext.tenant.name || formData.name}`,
    metadata: buildTakeOnMetadata({
      type: "debit",
      billItemKey: "deposit:security",
      billItemLabel: "Security Deposit",
      invoicePriorityCategory: "deposit",
      depositHeldBy: normalizedDepositHolder,
      ledgerMode: depositLedgerMode,
    }),
  });
}

for (const request of invoiceRequests) {
  await createTenantInvoice(request);
}

      toast.success("Tenant saved and opening invoice(s) created successfully.");
      setShowInvoicePrompt(false);
      setPendingInvoiceContext(null);
      navigate("/tenants");
    } catch (error) {
      const message =
        error?.response?.data?.error ||
        error?.response?.data?.message ||
        error?.message ||
        "Tenant saved, but invoice creation failed.";
      toast.error(message);
    } finally {
      setIsCreatingInitialInvoices(false);
    }
  };

  const handleSkipInitialInvoicing = () => {
    setShowInvoicePrompt(false);
    setPendingInvoiceContext(null);
    toast.info("Tenant was saved without creating invoice(s).");
    navigate("/tenants");
  };

  const handleCancel = () => {
    clearDraftState();
    navigate("/tenants");
  };

  const handleReset = () => {
    if (isEditMode) return;
    setFormData({
      tenantCode: generateNextTenantCode(),
      name: "", phone: "", email: "", idNumber: "",
      property: "", unit: "", additionalUnits: [],
      moveInDate: "", moveOutDate: "",
      leaseType: "at_will", rent: "", depositAmount: "",
      depositHeldBy: isSelfManagingLandlordMode ? "Landlord" : "Management Company",
      status: "active",
      emergencyContactName: "", emergencyContactPhone: "", emergencyContactRelationship: "Family",
      utilities: [], createLeaseFeeInvoice: false, leaseFeeAmount: "", leaseFeeDescription: "",
    });
    setFieldErrors({});
    setGeneralError("");
    clearDraftState();
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">
        {/* Sticky dark header */}
        <div className="flex-shrink-0 bg-[#0B3B2E] px-4 py-2.5">
          <div className="flex items-center gap-3">
            <button type="button" onClick={handleCancel} className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#B7C9C0] hover:text-white transition">
              <FaArrowLeft /> Back
            </button>
            <div className="h-4 w-px bg-[#2A5C4A]" />
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#B7C9C0]">Tenants</div>
              <h1 className="text-sm font-black text-white leading-none">{isEditMode ? "Edit Tenant" : "New Tenant"}</h1>
            </div>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {generalError && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {generalError}
            </div>
          )}

          {isEditMode && tenantLoading ? (
            <div className="rounded-lg border border-slate-200 bg-white px-6 py-10 flex items-center justify-center gap-3 text-slate-700">
              <FaSpinner className="animate-spin text-[#0B3B2E]" />
              <span className="text-xs font-semibold">Loading tenant details...</span>
            </div>
          ) : (
          <form id="tenant-form" onSubmit={handleSubmit}>
            <div className="space-y-3">

              {/* ── Tenant Information ── */}
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center gap-2.5 border-b border-slate-200 bg-slate-50 px-3 py-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded bg-[#0B3B2E]/10 text-[#0B3B2E]"><FaUser size={13} /></span>
                  <div>
                    <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-700 leading-tight">Tenant Information</h3>
                    <p className="text-[10px] text-slate-500 leading-tight">Identity and contact details</p>
                  </div>
                  <div className="ml-auto">
                    <input
                      type="text"
                      name="tenantCode"
                      value={formData.tenantCode}
                      onChange={handleInputChange}
                      placeholder="Tenant Code (auto)"
                      className="h-7 w-36 rounded border border-slate-200 bg-white px-2 text-xs font-mono text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/30"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <label className={labelClass}>Full Name <span className="text-red-500">*</span></label>
                    <div className="relative">
                      <FaUser className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={11} />
                      <input type="text" name="name" value={formData.name} onChange={handleInputChange} placeholder="John Doe"
                        className={`${inputClass} pl-8 ${fieldErrors.name ? "border-red-400" : ""}`} />
                    </div>
                    {fieldErrors.name && <p className="mt-1 text-xs text-red-600">{fieldErrors.name}</p>}
                  </div>

                  <div>
                    <label className={labelClass}>Phone Number <span className="text-red-500">*</span></label>
                    <div className="relative">
                      <FaPhone className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={11} />
                      <input type="tel" name="phone" value={formData.phone} onChange={handleInputChange} placeholder="+254 712 345 678"
                        className={`${inputClass} pl-8 ${fieldErrors.phone ? "border-red-400" : ""}`} />
                    </div>
                    {fieldErrors.phone && <p className="mt-1 text-xs text-red-600">{fieldErrors.phone}</p>}
                  </div>

                  <div>
                    <label className={labelClass}>Email Address</label>
                    <div className="relative">
                      <FaEnvelope className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={11} />
                      <input type="email" name="email" value={formData.email} onChange={handleInputChange} placeholder="tenant@example.com"
                        className={`${inputClass} pl-8 ${fieldErrors.email ? "border-red-400" : ""}`} />
                    </div>
                    {fieldErrors.email
                      ? <p className="mt-1 text-xs text-red-600">{fieldErrors.email}</p>
                      : <p className="mt-1 text-[11px] text-slate-400">Used for email notifications &amp; receipts</p>}
                  </div>

                  <div>
                    <label className={labelClass}>ID / Passport Number <span className="text-red-500">*</span></label>
                    <div className="relative">
                      <FaIdCard className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={11} />
                      <input type="text" name="idNumber" value={formData.idNumber} onChange={handleInputChange} placeholder="12345678"
                        className={`${inputClass} pl-8 ${fieldErrors.idNumber ? "border-red-400" : ""}`} />
                    </div>
                    {fieldErrors.idNumber && <p className="mt-1 text-xs text-red-600">{fieldErrors.idNumber}</p>}
                  </div>
                </div>
              </div>

              {/* ── Property & Unit ── */}
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center gap-2.5 border-b border-slate-200 bg-slate-50 px-3 py-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded bg-emerald-100 text-emerald-600"><FaBuilding size={13} /></span>
                  <div>
                    <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-700 leading-tight">Property &amp; Unit</h3>
                    <p className="text-[10px] text-slate-500 leading-tight">Assign a property and unit to this tenant</p>
                  </div>
                </div>
                <div className="p-4 space-y-4">

                  {preselectedUnitBanner && !isEditMode && (
                    <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Availability Status handoff</p>
                          <p className="mt-1 text-sm font-bold text-slate-900">
                            {preselectedUnitBanner.propertyName} • {preselectedUnitBanner.unitNumber}
                          </p>
                          <p className="mt-1 text-xs text-slate-600">
                            Status: <span className="font-semibold text-slate-800">{preselectedUnitBanner.statusLabel}</span>
                            {preselectedUnitBanner.rentLabel ? ` • Rent: ${preselectedUnitBanner.rentLabel}` : ""}
                          </p>
                          <p className="mt-2 text-xs text-slate-500">
                            This unit was opened directly from Availability Status.
                            {takeOnSelectionLocked
                              ? " Property and unit are locked to avoid assigning the wrong space."
                              : " You can now change the property or unit selection manually."}
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {takeOnSelectionLocked ? (
                            <button
                              type="button"
                              onClick={() => setTakeOnSelectionLocked(false)}
                              className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-bold text-emerald-800 shadow-sm transition-colors hover:bg-emerald-100"
                            >
                              Change Selection
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setTakeOnSelectionLocked(true);
                                if (takeOnPreselection?.propertyId && takeOnPreselection?.unitId) {
                                  lastPropertyRef.current = takeOnPreselection.propertyId;
                                  setShowAdditionalUnits(false);
                                  setAdditionalUtilities([]);
                                  setFormData((prev) => ({
                                    ...prev,
                                    property: takeOnPreselection.propertyId,
                                    unit: takeOnPreselection.unitId,
                                    additionalUnits: [],
                                    rent: "",
                                    depositAmount: "",
                                    utilities: [],
                                  }));
                                }
                              }}
                              className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-bold text-emerald-800 shadow-sm transition-colors hover:bg-emerald-100"
                            >
                              Re-lock Selected Unit
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    <MilikSelect
                      label="Property"
                      required
                      placeholder="Select Property"
                      items={activeProperties}
                      value={formData.property}
                      onChange={(val) => {
                        setFormData((prev) => ({ ...prev, property: val, unit: "", additionalUnits: [] }));
                        if (fieldErrors.property) {
                          setFieldErrors((prev) => ({ ...prev, property: "" }));
                        }
                      }}
                      getLabel={(p) => p.propertyName || p.name || "Unknown"}
                      getValue={(p) => p._id || p.id}
                      error={fieldErrors.property}
                      disabled={Boolean(takeOnPreselection && takeOnSelectionLocked)}
                    />

                    <MilikSelect
                      label={isEditMode ? "Unit" : "Unit (Vacant Only)"}
                      required
                      placeholder="Select Unit"
                      items={availableUnits}
                      value={formData.unit}
                      onChange={(val) => {
                        setFormData((prev) => ({ ...prev, unit: val }));
                        if (fieldErrors.unit) {
                          setFieldErrors((prev) => ({ ...prev, unit: "" }));
                        }
                      }}
                      getLabel={(u) => `${u.unitNumber} - Ksh ${(u.rent || 0).toLocaleString()}`}
                      getValue={(u) => u._id || u.id}
                      error={fieldErrors.unit}
                      disabled={!formData.property || Boolean(takeOnPreselection && takeOnSelectionLocked)}
                    />
                  </div>

                  {formData.property && availableUnits.length > 1 && (
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <label className="flex items-center gap-3 text-sm font-semibold text-slate-800">
                        <input
                          type="checkbox"
                          checked={showAdditionalUnits}
                          disabled={Boolean(takeOnPreselection && takeOnSelectionLocked)}
                          onChange={(e) => {
                            const enabled = e.target.checked;
                            setShowAdditionalUnits(enabled);
                            if (!enabled) {
                              setFormData((prev) => ({ ...prev, additionalUnits: [] }));
                            }
                            if (fieldErrors.additionalUnits) {
                              setFieldErrors((prev) => ({ ...prev, additionalUnits: "" }));
                            }
                          }}
                          className="rounded border-slate-300 text-[#0B3B2E] focus:ring-[#0B3B2E]/30 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                        Assign additional units to this tenant
                      </label>
                      <p className="mt-1 text-xs text-slate-500">Keep the selected unit as the primary unit, then reveal and tick extra units only when this tenant should occupy more than one unit.</p>
                      {showAdditionalUnits && selectedAdditionalUnitRecords.length > 0 && (
                        <p className="mt-2 text-xs font-semibold text-emerald-700">{selectedAdditionalUnitRecords.length} additional unit(s) selected.</p>
                      )}
                      {showAdditionalUnits ? (
                        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                          {availableUnits
                            .filter((unit) => normalizeId(unit?._id) !== normalizeId(formData.unit))
                            .map((unit) => {
                              const checked = Array.isArray(formData.additionalUnits) && formData.additionalUnits.some((unitId) => normalizeId(unitId) === normalizeId(unit?._id));
                              return (
                                <label key={unit._id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                                  <span>{unit.unitNumber} - Ksh {Number(unit.rent || 0).toLocaleString()}</span>
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      setFormData((prev) => ({
                                        ...prev,
                                        additionalUnits: e.target.checked
                                          ? [...(Array.isArray(prev.additionalUnits) ? prev.additionalUnits : []), unit._id || unit.id]
                                          : (Array.isArray(prev.additionalUnits) ? prev.additionalUnits : []).filter((unitId) => normalizeId(unitId) !== normalizeId(unit._id)),
                                      }));
                                      if (fieldErrors.additionalUnits) {
                                        setFieldErrors((prev) => ({ ...prev, additionalUnits: "" }));
                                      }
                                    }}
                                  />
                                </label>
                              );
                            })}
                        </div>
                      ) : null}
                      {fieldErrors.additionalUnits && <p className="mt-2 text-xs text-red-600">{fieldErrors.additionalUnits}</p>}
                    </div>
                  )}

                </div>
              </div>

              {/* ── Billing Information ── */}
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center gap-2.5 border-b border-slate-200 bg-slate-50 px-3 py-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded bg-blue-100 text-blue-600"><FaMoneyBillWave size={13} /></span>
                  <div>
                    <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-700 leading-tight">Billing Information</h3>
                    <p className="text-[10px] text-slate-500 leading-tight">Rent, deposit and billing settings</p>
                  </div>
                </div>
                <div className="p-4 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                    <div>
                      <label className={labelClass}>
                        Move-In Date (Billing Anchor) <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        name="moveInDate"
                        value={formData.moveInDate}
                        onChange={handleInputChange}
                        className={`${inputClass} ${fieldErrors.moveInDate ? "border-red-500" : ""}`}
                      />
                      {fieldErrors.moveInDate && (
                        <p className="mt-1 text-xs text-red-600">{fieldErrors.moveInDate}</p>
                      )}
                    </div>

                    <div>
                      <label className={labelClass}>
                        Monthly Rent (Ksh) <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="number"
                        name="rent"
                        value={formData.rent}
                        onChange={handleInputChange}
                        placeholder="30000"
                        step="0.01"
                        min="0"
                        className={`${inputClass} ${fieldErrors.rent ? "border-red-500" : ""}`}
                      />
                      {fieldErrors.rent && (
                        <p className="mt-1 text-xs text-red-600">{fieldErrors.rent}</p>
                      )}
                    </div>

                    <div>
                      <label className={labelClass}>
                        Deposit Amount (Ksh) <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="number"
                        name="depositAmount"
                        value={formData.depositAmount}
                        onChange={handleInputChange}
                        placeholder="30000"
                        step="0.01"
                        min="0"
                        className={`${inputClass} ${fieldErrors.depositAmount ? "border-red-500" : ""}`}
                      />
                      {fieldErrors.depositAmount && (
                        <p className="mt-1 text-xs text-red-600">{fieldErrors.depositAmount}</p>
                      )}
                    </div>

                    <div>
                      <label className={labelClass}>
                        Who Holds Deposit? <span className="text-red-500">*</span>
                      </label>
                      <select
                        name="depositHeldBy"
                        value={formData.depositHeldBy}
                        onChange={handleInputChange}
                        disabled={isSelfManagingLandlordMode}
                        className={`${inputClass} ${fieldErrors.depositHeldBy ? "border-red-500" : ""} ${isSelfManagingLandlordMode ? "bg-slate-100 text-slate-600 cursor-not-allowed" : ""}`}
                      >
                        {isSelfManagingLandlordMode ? (
                          <option value="Landlord">Landlord</option>
                        ) : (
                          <>
                            <option value="Management Company">Management Company</option>
                            <option value="Landlord">Landlord</option>
                          </>
                        )}
                      </select>
                      <p className="mt-1 text-xs text-slate-500">
                        {isSelfManagingLandlordMode
                          ? "This company is operating as the owner, so deposits default to landlord-held for new tenants."
                          : "Choose whether the security deposit is held by the management company or the landlord."}
                      </p>
                      {fieldErrors.depositHeldBy && (
                        <p className="mt-1 text-xs text-red-600">{fieldErrors.depositHeldBy}</p>
                      )}
                    </div>

                    <div className="md:col-span-2">
                      <label className={labelClass}>Utilities & Charges (Ksh)</label>
                      <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-lg p-3 min-h-10 max-h-32 overflow-y-auto">
                        {combinedUtilitiesPreview.length > 0 ? (
                          <div className="space-y-1">
                            {combinedUtilitiesPreview.map((util, idx) => {
                              const charge = parseFloat(util.unitCharge) || 0;
                              return (
                                <div key={idx} className="text-xs flex justify-between items-center">
                                  <span className="text-green-700 font-medium">
                                    {util.utilityLabel}:
                                  </span>
                                  <span className="text-green-900 font-bold">
                                    Ksh {charge.toFixed(2)}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-green-600">No utilities</p>
                        )}
                      </div>
                    </div>

                    <div>
                      <label className={labelClass}>Total Monthly Bill (Ksh)</label>
                      <div className="bg-gradient-to-br from-[#0B3B2E]/10 to-slate-50 border border-[#0B3B2E]/30 rounded-lg p-3 min-h-10 flex items-center justify-center">
                        <div className="text-center">
                          <p className="text-2xl font-black text-[#0B3B2E]">
                            {(
                              parseFloat(formData.rent || 0) +
                              (combinedUtilitiesPreview.reduce(
                                (sum, u) => sum + (parseFloat(u.unitCharge) || 0),
                                0
                              ) || 0)
                            ).toFixed(2)}
                          </p>
                          <p className="text-xs text-[#0B3B2E]/70 mt-0.5">Rent + Utilities</p>
                        </div>
                      </div>
                    </div>

                    <div className="md:col-span-1">
                      <label className={labelClass}>
                        Lease Type <span className="text-red-500">*</span>
                      </label>
                      <select
                        name="leaseType"
                        value={formData.leaseType}
                        onChange={handleInputChange}
                        className={inputClass}
                      >
                        <option value="at_will">At Will</option>
                        <option value="fixed">Fixed Term</option>
                      </select>
                      <p className="mt-1 text-xs text-gray-600">At Will / Fixed Term</p>
                    </div>
</div>

                  {!isEditMode && (
                    <div className={`mt-4 rounded-xl border p-4 ${isLettingProperty ? "border-blue-200 bg-blue-50/70" : "border-[#0B3B2E]/20 bg-[#0B3B2E]/5"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className={`text-sm font-bold ${isLettingProperty ? "text-blue-900" : "text-[#0B3B2E]"}`}>
                            {isLettingProperty ? "Letting Fee" : "Lease / Agreement Fee"}
                          </h4>
                          <p className={`mt-1 text-xs ${isLettingProperty ? "text-blue-800" : "text-[#0B3B2E]/70"}`}>
                            {isLettingProperty
                              ? `This property is managed under Letting. A letting fee is automatically applied based on the property setting (${
                                  selectedPropertyRecord?.lettingFeeMode === "fixed"
                                    ? `fixed Ksh ${Number(selectedPropertyRecord?.lettingFeeValue || 0).toLocaleString()}`
                                    : `${selectedPropertyRecord?.lettingFeeValue ?? 100}% of rent`
                                }).`
                              : "Create a one-time tenant onboarding charge. This is posted as manager/company income and excluded from landlord statements."}
                          </p>
                          {isLettingProperty && computedLettingFee > 0 && (
                            <p className="mt-1 text-xs font-semibold text-blue-900">
                              Computed fee: Ksh {computedLettingFee.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                          )}
                        </div>
                        <label className={`inline-flex items-center gap-2 text-sm font-semibold ${isLettingProperty ? "text-blue-900" : "text-[#0B3B2E]"}`}>
                          <input
                            type="checkbox"
                            name="createLeaseFeeInvoice"
                            checked={!!formData.createLeaseFeeInvoice}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setFormData((prev) => ({
                                ...prev,
                                createLeaseFeeInvoice: checked,
                                leaseFeeAmount: checked ? prev.leaseFeeAmount : "",
                                leaseFeeDescription: checked ? prev.leaseFeeDescription : "",
                              }));
                              if (!checked) {
                                setFieldErrors((prev) => ({ ...prev, leaseFeeAmount: undefined }));
                              }
                            }}
                            className="h-4 w-4 rounded border-slate-300 text-[#0B3B2E] focus:ring-[#0B3B2E]/30"
                          />
                          Apply fee
                        </label>
                      </div>

                      {formData.createLeaseFeeInvoice && (
                        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className={labelClass}>
                              {isLettingProperty ? "Letting Fee Amount (Ksh)" : "Lease / Agreement Fee Amount (Ksh)"}{" "}
                              <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="number"
                              name="leaseFeeAmount"
                              value={formData.leaseFeeAmount}
                              onChange={handleInputChange}
                              placeholder="5000"
                              step="0.01"
                              min="0"
                              className={`${inputClass} ${fieldErrors.leaseFeeAmount ? "border-red-500" : ""}`}
                            />
                            {isLettingProperty && computedLettingFee > 0 && (
                              <p className="mt-1 text-xs text-blue-600">
                                Auto-computed: Ksh {computedLettingFee.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} — adjust if needed
                              </p>
                            )}
                            {fieldErrors.leaseFeeAmount && (
                              <p className="mt-1 text-xs text-red-600">{fieldErrors.leaseFeeAmount}</p>
                            )}
                          </div>

                          <div>
                            <label className={labelClass}>Fee Description</label>
                            <input
                              type="text"
                              name="leaseFeeDescription"
                              value={formData.leaseFeeDescription}
                              onChange={handleInputChange}
                              placeholder={isLettingProperty ? "Letting fee" : "Lease preparation and agreement fee"}
                              className={inputClass}
                            />
                            <p className="mt-1 text-xs text-slate-500">
                              Posting uses the Lease / Agreement Fee Income Account under Accounting Defaults when configured.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}


                  {formData.leaseType === "fixed" && (
                    <div className="mt-4">
                      <label className={labelClass}>
                        Move-Out Date (End of Lease) <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        name="moveOutDate"
                        value={formData.moveOutDate}
                        onChange={handleInputChange}
                        className={`${inputClass} ${fieldErrors.moveOutDate ? "border-red-500" : ""}`}
                      />
                      {fieldErrors.moveOutDate && (
                        <p className="mt-1 text-xs text-red-600">{fieldErrors.moveOutDate}</p>
                      )}
                    </div>
                  )}

                  {proratedInfo && (
                    <div className="mt-4 bg-[#0B3B2E]/5 border border-[#0B3B2E]/20 rounded-lg p-4">
                      <div className="flex items-start gap-2">
                        <FaCalculator className="text-[#0B3B2E] mt-1" />
                        <div className="flex-1">
                          <h4 className="font-bold text-[#0B3B2E] text-sm mb-2">
                            Prorated Rent Calculation (First Month)
                          </h4>
                          <div className="text-xs text-[#0B3B2E]/70 space-y-1">
                            <p>
                              • Days in month:{" "}
                              <span className="font-bold">{proratedInfo.daysInMonth}</span>
                            </p>
                            <p>
                              • Remaining days (including start date):{" "}
                              <span className="font-bold">{proratedInfo.remainingDays}</span>
                            </p>
                            <p>
                              • Daily rate:{" "}
                              <span className="font-bold">
                                Ksh {proratedInfo.dailyRate.toFixed(2)}
                              </span>
                            </p>
                            <p className="pt-1 border-t border-[#0B3B2E]/20">
                              <span className="font-bold text-[#0B3B2E]">
                                First month bill: Ksh {proratedInfo.proratedAmount.toFixed(2)}
                              </span>
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Additional Utilities ── */}
              <div ref={additionalUtilitiesSectionRef} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between gap-2.5 border-b border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded bg-indigo-100 text-indigo-600"><FaBolt size={13} /></span>
                    <div>
                      <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-700 leading-tight">Additional Utilities</h3>
                      <p className="text-[10px] text-slate-500 leading-tight">Add utilities beyond the unit's defaults</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={addAdditionalUtility}
                    className="h-7 px-3 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded flex items-center gap-1.5 transition-all"
                  >
                    <FaPlus size={10} /> Add Utility
                  </button>
                </div>
                <div className="p-4 space-y-3">

                  {additionalUtilities.length === 0 ? (
                    <div className="text-center py-8 text-indigo-600">
                      <p className="text-sm font-medium">No additional utilities added yet</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {additionalUtilities.map((util, idx) => (
                        <div
                          key={idx}
                          className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end p-4 bg-white border border-indigo-200 rounded-lg hover:shadow-md transition-shadow"
                        >
                          <div>
                            <MilikSelect
                              label="Utility Type"
                              placeholder="Select"
                              items={Array.from(new Set([...utilityOptions, "Water", "Garbage", "Electricity", "Service Charge", "Security", "Others"]))}
                              value={util.utility}
                              onChange={(val) => updateAdditionalUtility(idx, "utility", val)}
                              getLabel={(x) => x}
                              getValue={(x) => x}
                              disabled={!canSaveTenant || loading || tenantLoading}
                            />
                          </div>

                          <div>
                            <label className={labelClass}>Charge (Ksh)</label>
                            <input
                              type="number"
                              value={util.unitCharge}
                              onChange={(e) =>
                                updateAdditionalUtility(idx, "unitCharge", e.target.value)
                              }
                              placeholder="0.00"
                              step="0.01"
                              min="0"
                              className={inputClass}
                            />
                          </div>

                          <div className="md:col-span-2">
                            <label className={labelClass}>Included?</label>
                            <div className="h-10 flex items-center">
                              <label className="inline-flex items-center gap-2 text-sm text-slate-700 font-medium">
                                <input
                                  type="checkbox"
                                  checked={!!util.isIncluded}
                                  onChange={(e) =>
                                    updateAdditionalUtility(idx, "isIncluded", e.target.checked)
                                  }
                                  className="rounded border-slate-300 text-[#0B3B2E] focus:ring-[#0B3B2E]/30"
                                />
                                Included in rent
                              </label>
                            </div>
                          </div>

                          <div>
                            <button
                              type="button"
                              onClick={() => removeAdditionalUtility(idx)}
                              className="w-full h-10 px-3 text-sm font-semibold bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg flex items-center justify-center gap-2 transition-colors"
                            >
                              <FaTrash /> Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {fieldErrors.additionalUtilities && (
                    <p className="mt-3 text-xs text-red-600">{fieldErrors.additionalUtilities}</p>
                  )}
                </div>
              </div>

              {/* ── Emergency Contact ── */}
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center gap-2.5 border-b border-slate-200 bg-slate-50 px-3 py-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded bg-red-100 text-red-500"><FaExclamationTriangle size={13} /></span>
                  <div>
                    <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-700 leading-tight">Emergency Contact</h3>
                    <p className="text-[10px] text-slate-500 leading-tight">Optional backup contact for this tenant</p>
                  </div>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className={labelClass}>Contact Name</label>
                      <input
                        type="text"
                        name="emergencyContactName"
                        value={formData.emergencyContactName}
                        onChange={handleInputChange}
                        placeholder="Jane Doe"
                        className={inputClass}
                      />
                    </div>

                    <div>
                      <label className={labelClass}>Contact Phone</label>
                      <input
                        type="tel"
                        name="emergencyContactPhone"
                        value={formData.emergencyContactPhone}
                        onChange={handleInputChange}
                        placeholder="+254 700 000 000"
                        className={inputClass}
                      />
                    </div>

                    <div>
                      <label className={labelClass}>Relationship</label>
                      <select
                        name="emergencyContactRelationship"
                        value={formData.emergencyContactRelationship}
                        onChange={handleInputChange}
                        className={inputClass}
                      >
                        <option value="Family">Family</option>
                        <option value="Friend">Friend</option>
                        <option value="Guardian">Guardian</option>
                        <option value="Colleague">Colleague</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </form>
          )}
        </div>

        {/* Sticky footer */}
        <div className="flex-shrink-0 border-t border-slate-200 bg-[#F6FAF8] px-4 py-2.5">
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            {!isEditMode && (
              <button
                type="button"
                onClick={handleReset}
                disabled={loading}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Reset
              </button>
            )}
            <button
              type="submit"
              form="tenant-form"
              disabled={loading || tenantLoading}
              className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-black text-white transition ${loading || tenantLoading ? "bg-slate-400 cursor-not-allowed" : "bg-[#0B3B2E] hover:bg-[#0A3127]"}`}
            >
              {loading ? <FaSpinner className="animate-spin" /> : <FaSave />}
              {loading ? (isEditMode ? "Updating…" : "Saving…") : (isEditMode ? "Update Tenant" : "Save Tenant")}
            </button>
          </div>
        </div>
      </div>

      {showInvoicePrompt && pendingInvoiceContext ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm sm:items-center sm:p-6">
          <div className="flex w-full max-w-2xl max-h-[calc(100vh-2rem)] flex-col overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white shadow-2xl sm:max-h-[calc(100vh-3rem)]">
            <div className={`sticky top-0 z-20 px-6 py-4 ${MILIK_GREEN_BG} text-white`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold tracking-tight">Create tenant invoice now?</h2>
                  <p className="text-sm text-white/80 mt-1">
                    {pendingInvoiceContext.tenant?.name || formData.name} has been saved successfully.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleSkipInitialInvoicing}
                  disabled={isCreatingInitialInvoices}
                  className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-wide transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <FaTimes /> Close
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-slate-500 text-xs uppercase tracking-wide">Tenant</p>
                  <p className="font-semibold text-slate-900">
                    {pendingInvoiceContext.tenant?.name || formData.name}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-slate-500 text-xs uppercase tracking-wide">Unit / Property</p>
                  <p className="font-semibold text-slate-900">
                    {selectedUnitRecord?.unitNumber || "-"} • {selectedPropertyRecord?.propertyName || selectedPropertyRecord?.name || "-"}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                <p className="text-xs uppercase tracking-wide text-slate-500 mb-2">Opening invoice mode</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className={`rounded-xl border px-4 py-3 cursor-pointer ${openingInvoiceMode === "separate" ? "border-[#0B3B2E] bg-[#0B3B2E]/5" : "border-slate-200 bg-white"}`}>
                    <input
                      type="radio"
                      name="openingInvoiceMode"
                      value="separate"
                      checked={openingInvoiceMode === "separate"}
                      onChange={(e) => setOpeningInvoiceMode(e.target.value)}
                      className="sr-only"
                    />
                    <p className="font-semibold text-slate-900">Separate</p>
                    <p className="text-xs text-slate-500 mt-1">Create rent and utility invoices separately so each hits the correct ledger.</p>
                  </label>
                </div>
              </div>

              {pendingInvoiceContext?.leaseFeeAmount > 0 && (
                <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm">
                  <p className="font-semibold text-blue-900">
                    {pendingInvoiceContext?.isLettingFee ? "Letting fee" : "Lease / Agreement fee"} already created
                  </p>
                  <p className="text-xs text-blue-700 mt-0.5">
                    KES {Number(pendingInvoiceContext.leaseFeeAmount).toLocaleString()} was invoiced automatically when the tenant was saved.
                  </p>
                </div>
              )}

              <div className="rounded-2xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                  <h3 className="font-bold text-slate-900">What will be invoiced</h3>
                </div>
                <div className="divide-y divide-slate-200">
                  {pendingInvoiceContext.items.map((item) => (
                    <div key={item.key} className="px-4 py-3 flex items-start justify-between gap-4">
                      <div>
                        <p className="font-semibold text-slate-900">{item.title}</p>
                        <p className="text-xs text-slate-500 mt-1">{item.detail}</p>
                      </div>
                      <p className="font-bold text-slate-900">
                        KES {Number(item.amount || 0).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                  <span className="font-semibold text-slate-900">Total opening invoice amount</span>
                  <span className="text-lg font-bold text-slate-900">
                    KES {pendingInvoiceContext.items.reduce((sum, item) => sum + Number(item.amount || 0), 0).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 z-20 flex flex-col justify-end gap-3 border-t border-slate-200 bg-slate-50/95 px-6 py-4 backdrop-blur-sm sm:flex-row">
              <button
                type="button"
                onClick={handleSkipInitialInvoicing}
                disabled={isCreatingInitialInvoices}
                className="w-full sm:w-auto h-10 px-4 rounded-md border border-slate-300 bg-white text-slate-700 text-sm font-semibold shadow-sm hover:bg-slate-100 disabled:opacity-60"
              >
                Skip for now
              </button>
              <button
                type="button"
                onClick={handleConfirmInitialInvoicing}
                disabled={isCreatingInitialInvoices}
                className={`w-full sm:w-auto h-10 px-5 rounded-md text-white text-sm font-semibold shadow-sm flex items-center justify-center gap-2 transition-colors ${
                  isCreatingInitialInvoices
                    ? "bg-slate-400 cursor-not-allowed"
                    : `${MILIK_ORANGE_BG} ${MILIK_ORANGE_BG_HOVER}`
                }`}
              >
                {isCreatingInitialInvoices ? (
                  <>
                    <FaSpinner className="animate-spin" /> Creating invoice(s)...
                  </>
                ) : (
                  <>
                    <FaSave /> Continue & Invoice
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </DashboardLayout>
  );
};

export default AddTenant;