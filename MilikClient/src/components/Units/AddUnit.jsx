// components/Units/AddUnit.jsx
import React, { useState, useEffect, useRef, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useParams } from "react-router-dom";
import DashboardLayout from "../Layout/DashboardLayout";
import { FaSave, FaTimes, FaChevronDown, FaSpinner, FaPlus, FaTrash, FaCalculator, FaArrowLeft } from "react-icons/fa";
import { toast } from "react-toastify";
import { createUnit, getUnits, updateUnit } from "../../redux/unitRedux";
import { getProperties } from "../../redux/propertyRedux";
import { selectCurrentCompany, selectCurrentUser, selectAllProperties } from "../../redux/selectors";
import { adminRequests } from "../../utils/requestMethods";
import { normalizeUppercaseInput } from "../../utils/listingPageUtils";

const MILIK_ORANGE_BG = "bg-[#0B3B2E]";
const normalizeBillingPeriodKey = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

const BILLING_PERIOD_ALIASES = {
  monthly: "monthly",
  quarter: "quarterly",
  quarterly: "quarterly",
  annually: "annual",
  annual: "annual",
  yearly: "annual",
  semi_annual: "semi_annual",
  semiannual: "semi_annual",
  semi_annually: "semi_annual",
  biannual: "semi_annual",
  bi_annually: "semi_annual",
  bi_monthly: "bi_monthly",
  bimonthly: "bi_monthly",
};

const canonicalBillingPeriodKey = (value = "") => {
  const normalized = normalizeBillingPeriodKey(value);
  return BILLING_PERIOD_ALIASES[normalized] || normalized || "monthly";
};

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
        <label className="mb-0.5 block text-xs font-semibold text-slate-700">
          {label} {required ? <span className="text-red-500">*</span> : ""}
        </label>
      ) : null}

      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((s) => !s)}
        className={[
          "w-full h-8 px-3 rounded border bg-white text-slate-900",
          error ? "border-red-500" : "border-slate-200",
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
                      "w-full text-left px-3 py-1.5 text-xs font-semibold transition-colors",
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

const AddUnit = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { id: unitId } = useParams();
  const isEditMode = Boolean(unitId);
  
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const { isFetching: loading, units = [] } = useSelector((state) => state.unit);
  const properties = useSelector(selectAllProperties);
  const activeProperties = useMemo(
    () => properties.filter((property) => String(property?.status || "active").toLowerCase() !== "archived"),
    [properties]
  );

  const [formData, setFormData] = useState({
    unitNumber: "",
    property: "",
    unitType: "",
    areaSqFt: "",
    rent: "",
    deposit: "",
    status: "vacant",
    description: "",
    amenities: "",
    utilities: [],
    billingFrequency: "monthly",
  });

  const [fieldErrors, setFieldErrors] = useState({});
  const [generalError, setGeneralError] = useState("");
  const [utilityOptions, setUtilityOptions] = useState([]);
  const [billingPeriodOptions, setBillingPeriodOptions] = useState([{ key: "monthly", name: "Monthly", durationInMonths: 1 }]);
  const [depositTouched, setDepositTouched] = useState(Boolean(isEditMode));
  const [rentTouched, setRentTouched] = useState(Boolean(isEditMode));
  const draftStorageKey = currentCompany?._id
    ? `milik:${isEditMode ? "edit" : "new"}-unit-draft:${currentCompany._id}${unitId ? `:${unitId}` : ""}`
    : null;
  const draftRestoredRef = useRef(false);

  // Fetch properties and existing unit (if editing) on mount
  useEffect(() => {
    if (currentCompany?._id) {
      dispatch(getProperties({ business: currentCompany._id }));

      // If editing, fetch units to get the current unit data
      if (isEditMode) {
        dispatch(getUnits({ business: currentCompany._id }));
      }

      adminRequests
        .get(`/company-settings/${currentCompany._id}`)
        .then((res) => {
          const names = Array.from(new Set((res?.data?.utilityTypes || [])
            .filter((item) => item?.isActive !== false && item?.name)
            .map((item) => String(item.name))));
          const periods = Array.isArray(res?.data?.billingPeriods)
            ? res.data.billingPeriods
                .filter((item) => item?.isActive !== false)
                .map((item) => ({
                  key: canonicalBillingPeriodKey(item?.key || item?.name || "monthly"),
                  name: String(item?.name || "Billing Period").trim() || "Billing Period",
                  durationInMonths: Math.max(1, Number(item?.durationInMonths || 1)),
                }))
            : [];
          setUtilityOptions(names);
          setBillingPeriodOptions(periods.length > 0 ? periods : [{ key: "monthly", name: "Monthly", durationInMonths: 1 }]);
        })
        .catch(() => {
          setUtilityOptions([]);
          setBillingPeriodOptions([{ key: "monthly", name: "Monthly", durationInMonths: 1 }]);
        });
    }
  }, [dispatch, currentCompany, isEditMode]);

  // Populate form data when editing an existing unit
  useEffect(() => {
    if (isEditMode && units.length > 0) {
      const existingUnit = units.find((u) => u._id === unitId);
      if (existingUnit) {
        setDepositTouched(true);
        setRentTouched(true);
        setFormData({
          unitNumber: existingUnit.unitNumber || "",
          property: existingUnit.property?._id || existingUnit.property || "",
          unitType: existingUnit.unitType || "",
          areaSqFt: existingUnit.areaSqFt?.toString() || "",
          rent: existingUnit.rent?.toString() || "",
          deposit: existingUnit.deposit?.toString() || "",
          status: existingUnit.status || "vacant",
          description: existingUnit.description || "",
          amenities: existingUnit.amenities?.join(", ") || "",
          utilities: existingUnit.utilities || [],
          billingFrequency: canonicalBillingPeriodKey(existingUnit.billingPeriodKey || existingUnit.billingFrequency || "monthly"),
        });
      }
    }
  }, [isEditMode, unitId, units]);

  useEffect(() => {
    if (!draftStorageKey || isEditMode) {
      draftRestoredRef.current = true;
      return;
    }
    try {
      const savedDraft = sessionStorage.getItem(draftStorageKey);
      if (!savedDraft) return;
      const parsedDraft = JSON.parse(savedDraft);
      if (parsedDraft?.formData && typeof parsedDraft.formData === "object") {
        setFormData((prev) => ({ ...prev, ...parsedDraft.formData }));
      }
      if (typeof parsedDraft?.depositTouched === "boolean") {
        setDepositTouched(parsedDraft.depositTouched);
      }
      if (typeof parsedDraft?.rentTouched === "boolean") {
        setRentTouched(parsedDraft.rentTouched);
      }
    } catch (draftError) {
      console.warn("Failed to restore unit draft", draftError);
    } finally {
      draftRestoredRef.current = true;
    }
  }, [draftStorageKey, isEditMode]);

  useEffect(() => {
    if (!draftStorageKey || !draftRestoredRef.current) return;
    try {
      sessionStorage.setItem(
        draftStorageKey,
        JSON.stringify({
          formData,
          depositTouched,
          rentTouched,
        })
      );
    } catch (draftError) {
      console.warn("Failed to persist unit draft", draftError);
    }
  }, [depositTouched, draftStorageKey, formData, rentTouched]);

  const clearDraftState = () => {
    if (!draftStorageKey) return;
    sessionStorage.removeItem(draftStorageKey);
  };

  const selectedProperty = useMemo(
    () => properties.find((item) => String(item?._id) === String(formData.property || "")) || null,
    [formData.property, properties]
  );

  const measurementLabel = selectedProperty?.unitMeasurement || "Sq Ft";

  const roundMoneyString = (value) => {
    const numericValue = Number(value || 0);
    if (!Number.isFinite(numericValue) || numericValue <= 0) return "";
    return numericValue.toFixed(2);
  };

  const calculateRentFromPropertyDefaults = (propertyDoc, areaValue) => {
    const area = Number(areaValue || 0);
    const rate = Number(propertyDoc?.rentPerMeasure || 0);
    if (!Number.isFinite(area) || area <= 0 || !Number.isFinite(rate) || rate <= 0) {
      return 0;
    }
    return Number((area * rate).toFixed(2));
  };

  const calculateDepositFromPropertyDefaults = (propertyDoc, rentAmount) => {
    const normalizedRent = Number(rentAmount || 0);
    const deposits = Array.isArray(propertyDoc?.securityDeposits) ? propertyDoc.securityDeposits : [];
    const rentDeposit =
      deposits.find(
        (item) => String(item?.depositType || "").trim().toLowerCase() === "rent security deposit"
      ) ||
      deposits.find((item) => String(item?.depositType || "").toLowerCase().includes("rent")) ||
      null;

    if (!rentDeposit) {
      return normalizedRent > 0 ? normalizedRent : 0;
    }

    const amount = Number(rentDeposit.amount || 0);
    if (String(rentDeposit.chargeMode || "Fixed Amount") === "Percentage") {
      return normalizedRent > 0 ? Number(((normalizedRent * amount) / 100).toFixed(2)) : 0;
    }

    return Number(amount.toFixed(2));
  };

  useEffect(() => {
    if (!selectedProperty || isEditMode || rentTouched) return;
    const calculatedRent = calculateRentFromPropertyDefaults(selectedProperty, formData.areaSqFt);
    if (calculatedRent > 0) {
      setFormData((prev) => {
        if (String(prev.rent || "") === roundMoneyString(calculatedRent)) return prev;
        return { ...prev, rent: roundMoneyString(calculatedRent) };
      });
    }
  }, [formData.areaSqFt, isEditMode, rentTouched, selectedProperty]);

  useEffect(() => {
    if (!selectedProperty || isEditMode || depositTouched) return;
    const baselineRent = Number(formData.rent || calculateRentFromPropertyDefaults(selectedProperty, formData.areaSqFt) || 0);
    const calculatedDeposit = calculateDepositFromPropertyDefaults(selectedProperty, baselineRent);
    if (calculatedDeposit >= 0) {
      setFormData((prev) => {
        if (String(prev.deposit || "") === roundMoneyString(calculatedDeposit)) return prev;
        return { ...prev, deposit: roundMoneyString(calculatedDeposit) };
      });
    }
  }, [depositTouched, formData.areaSqFt, formData.rent, isEditMode, selectedProperty]);

  // Input classes for consistency
  const inputClass =
    "w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";

  const labelClass = "mb-0.5 block text-xs font-semibold text-slate-700";

  const uppercaseUnitFields = new Set(["unitNumber", "description", "amenities"]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    const nextValue = uppercaseUnitFields.has(name) ? normalizeUppercaseInput(value) : value;

    if (name === "rent") {
      setRentTouched(true);
    }
    if (name === "deposit") {
      setDepositTouched(true);
    }

    if (name === "property") {
      setRentTouched(false);
      setDepositTouched(false);
    }

    setFormData((prev) => {
      const next = { ...prev, [name]: nextValue };
      if (name === "rent" && !depositTouched && !isEditMode) {
        next.deposit = nextValue;
      }
      return next;
    });

    // Clear errors
    if (fieldErrors[name]) {
      setFieldErrors((prev) => ({ ...prev, [name]: "" }));
    }
    if (generalError) {
      setGeneralError("");
    }
  };

  const addUtility = () => {
    setFormData((prev) => ({
      ...prev,
      utilities: [...prev.utilities, { utility: "", isIncluded: false, unitCharge: "" }]
    }));
  };

  const removeUtility = (index) => {
    setFormData((prev) => ({
      ...prev,
      utilities: prev.utilities.filter((_, i) => i !== index)
    }));
  };

  const updateUtility = (index, field, value) => {
    setFormData((prev) => {
      const updated = [...prev.utilities];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, utilities: updated };
    });
  };

  // Calculate monthly rent (base rent only)
  const monthlyRent = parseFloat(formData.rent) || 0;

  // Calculate utility charges not included in rent
  const monthlyUtilityBill = formData.utilities
    .filter((u) => u.utility && !u.isIncluded) // Only utilities NOT marked as included
    .reduce((sum, u) => sum + (parseFloat(u.unitCharge) || 0), 0);

  // Total monthly bill (rent + utilities not included)
  const totalMonthlyBill = monthlyRent + monthlyUtilityBill;

  // Calculate billing amount based on configured periodicity
  const getBillingAmount = () => {
    const selectedPeriodKey = canonicalBillingPeriodKey(formData.billingFrequency || "monthly");
    const selectedPeriod =
      billingPeriodOptions.find((item) => item.key === selectedPeriodKey) ||
      billingPeriodOptions.find((item) => item.key === "monthly") ||
      { durationInMonths: 1 };
    const intervalMonths = Math.max(1, Number(selectedPeriod?.durationInMonths || 1));
    return totalMonthlyBill * intervalMonths;
  };

  const billingAmount = getBillingAmount();

  const validateForm = () => {
    const errors = {};

    if (!formData.property?.trim()) {
      errors.property = "Property is required";
    }
    if (!formData.unitNumber?.trim()) {
      errors.unitNumber = "Unit number is required";
    }
    if (!formData.unitType) {
      errors.unitType = "Unit type is required";
    }
    if (!formData.rent || parseFloat(formData.rent) <= 0) {
      errors.rent = "Valid rent amount is required";
    }
    if (!formData.deposit || parseFloat(formData.deposit) < 0) {
      errors.deposit = "Valid deposit amount is required";
    }

    return errors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const validationErrors = validateForm();
    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors);
      const errorMsg = Object.values(validationErrors)[0];
      setGeneralError(errorMsg);
      toast.error(errorMsg);
      return;
    }

    if (!currentCompany?._id) {
      const msg = "Company information not available. Please refresh and try again.";
      setGeneralError(msg);
      toast.error(msg);
      return;
    }

    // Prepare unit data
    const unitData = {
      unitNumber: formData.unitNumber.trim(),
      property: formData.property,
      unitType: formData.unitType,
      areaSqFt: parseFloat(formData.areaSqFt) || 0,
      rent: parseFloat(formData.rent),
      deposit: parseFloat(formData.deposit),
      ...(isEditMode ? { status: formData.status || "vacant" } : {}),
      description: formData.description?.trim() || "",
      amenities: formData.amenities
        ? formData.amenities.split(",").map((a) => a.trim()).filter(Boolean)
        : [],
      utilities: formData.utilities
        .filter((u) => u.utility) // Only include utilities with a selection
        .map((u) => ({
          utility: u.utility,
          isIncluded: u.isIncluded,
          unitCharge: u.unitCharge ? parseFloat(u.unitCharge) : 0
        })),
      billingFrequency: canonicalBillingPeriodKey(formData.billingFrequency || "monthly"),
      billingPeriodKey: canonicalBillingPeriodKey(formData.billingFrequency || "monthly"),
      business: currentCompany._id,
      ...(isEditMode
        ? {
            isVacant: formData.status === "vacant",
            vacantSince: formData.status === "vacant" ? new Date() : null,
          }
        : {}),
    };

    try {
      setFieldErrors({});
      setGeneralError("");
      
      if (isEditMode) {
        // Update existing unit
        await dispatch(updateUnit({ id: unitId, unitData })).unwrap();
        toast.success("Unit updated successfully!");
      } else {
        // Create new unit
        await dispatch(createUnit(unitData)).unwrap();
        toast.success("Unit created successfully!");
      }
      
      clearDraftState();
      navigate("/units");
    } catch (err) {
      console.error("Unit operation error:", err);
      
      const backendMessage =
        err?.message ||
        err?.error ||
        err?.data?.message ||
        err?.response?.data?.message ||
        (isEditMode ? "Failed to update unit" : "Failed to create unit");

      setGeneralError(backendMessage);
      toast.error(backendMessage);
    }
  };

  const handleCancel = () => {
    clearDraftState();
    navigate(-1);
  };

  const handleReset = () => {
    if (isEditMode) return;
    setFormData({ unitNumber: "", property: "", unitType: "", areaSqFt: "", rent: "", deposit: "", status: "vacant", description: "", amenities: "", utilities: [], billingFrequency: "monthly" });
    setFieldErrors({});
    setGeneralError("");
    clearDraftState();
  };

  const unitTypes = [
    { value: "studio", label: "Studio" },
    { value: "1bed", label: "1 Bedroom" },
    { value: "2bed", label: "2 Bedrooms" },
    { value: "3bed", label: "3 Bedrooms" },
    { value: "4bed", label: "4 Bedrooms" },
    { value: "commercial", label: "Commercial" },
  ];

  const statusOptions = useMemo(() => {
    const baseOptions = [
      { value: "vacant", label: "Vacant" },
      { value: "maintenance", label: "Maintenance" },
      { value: "reserved", label: "Reserved" },
    ];

    if (isEditMode && formData.status === "occupied") {
      return [
        { value: "vacant", label: "Vacant" },
        { value: "occupied", label: "Occupied" },
        { value: "maintenance", label: "Maintenance" },
        { value: "reserved", label: "Reserved" },
      ];
    }

    return baseOptions;
  }, [formData.status, isEditMode]);

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
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#B7C9C0]">Units</div>
              <h1 className="text-sm font-black text-white leading-none">{isEditMode ? "Edit Unit" : "New Unit"}</h1>
            </div>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {/* Form Card */}
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <form id="unit-form" onSubmit={handleSubmit} className="p-3 grid grid-cols-1 xl:grid-cols-12 gap-3">
            {/* Property Selection */}
            <div className="xl:col-span-5">
              <MilikSelect
                label="Property"
                required
                placeholder="Select property"
                items={activeProperties}
                value={formData.property}
                onChange={(val) => handleInputChange({ target: { name: "property", value: val } })}
                getLabel={(p) => `${p.propertyCode} - ${p.propertyName}`}
                getValue={(p) => p._id}
                disabled={loading}
                error={fieldErrors.property}
              />
            </div>

            {selectedProperty && (
              <div className="xl:col-span-7 rounded-lg border border-[#0B3B2E]/20 bg-[#0B3B2E]/5 p-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-[#0B3B2E]/70">Measurement Basis</div>
                    <div className="mt-0.5 text-xs font-bold text-slate-900">{measurementLabel}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-[#0B3B2E]/70">Default Rent Rate</div>
                    <div className="mt-0.5 text-xs font-bold text-slate-900">
                      {Number(selectedProperty.rentPerMeasure || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      {" "}{selectedProperty.rentCurrency || "KES"} / {measurementLabel}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-[#0B3B2E]/70">Default Rent Deposit</div>
                    <div className="mt-0.5 text-xs font-bold text-slate-900">
                      {(() => {
                        const rentDeposit = (selectedProperty.securityDeposits || []).find(
                          (item) => String(item?.depositType || "").toLowerCase().includes("rent")
                        );
                        if (!rentDeposit) return "Falls back to unit rent";
                        return String(rentDeposit.chargeMode || "Fixed Amount") === "Percentage"
                          ? `${Number(rentDeposit.amount || 0).toLocaleString()}% of rent`
                          : `${Number(rentDeposit.amount || 0).toLocaleString()} ${rentDeposit.currency || "KES"}`;
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Unit Number and Type */}
            <div className="xl:col-span-12 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <div>
                <label className={labelClass}>
                  Unit Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="unitNumber"
                  value={formData.unitNumber}
                  onChange={handleInputChange}
                  placeholder="e.g., A101, 5B, Unit 12"
                  className={`${inputClass} ${MILIK_ORANGE_RING} ${MILIK_ORANGE_BORDER_FOCUS} ${
                    fieldErrors.unitNumber ? "border-red-500" : ""
                  }`}
                  disabled={loading}
                />
                {fieldErrors.unitNumber && (
                  <p className="mt-1 text-xs text-red-600">{fieldErrors.unitNumber}</p>
                )}
              </div>

              <div>
                <MilikSelect
                  label="Unit Type"
                  required
                  placeholder="Select unit type"
                  items={unitTypes}
                  value={formData.unitType}
                  onChange={(val) => handleInputChange({ target: { name: "unitType", value: val } })}
                  getLabel={(t) => t.label}
                  getValue={(t) => t.value}
                  disabled={loading}
                  error={fieldErrors.unitType}
                />
              </div>
            </div>

            {/* Area, Rent and Deposit */}
            <div className="xl:col-span-12 grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-3">
              <div>
                <label className={labelClass}>Area ({measurementLabel})</label>
                <input
                  type="number"
                  name="areaSqFt"
                  value={formData.areaSqFt}
                  onChange={handleInputChange}
                  placeholder={`e.g., ${measurementLabel === "Sq Ft" ? "500" : "100"}`}
                  min="0"
                  step="0.01"
                  className={`${inputClass} ${MILIK_ORANGE_RING} ${MILIK_ORANGE_BORDER_FOCUS}`}
                  disabled={loading}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Enter the measured unit area to let the property pricing defaults calculate rent.
                </p>
              </div>

              <div>
                <label className={labelClass}>
                  Monthly Rent (KES) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  name="rent"
                  value={formData.rent}
                  onChange={handleInputChange}
                  placeholder="e.g., 25000"
                  min="0"
                  step="0.01"
                  className={`${inputClass} ${MILIK_ORANGE_RING} ${MILIK_ORANGE_BORDER_FOCUS} ${
                    fieldErrors.rent ? "border-red-500" : ""
                  }`}
                  disabled={loading}
                />
                {fieldErrors.rent && (
                  <p className="mt-1 text-xs text-red-600">{fieldErrors.rent}</p>
                )}
              </div>

              <div>
                <label className={labelClass}>
                  Security Deposit (KES) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  name="deposit"
                  value={formData.deposit}
                  onChange={handleInputChange}
                  placeholder="e.g., 50000"
                  min="0"
                  step="0.01"
                  className={`${inputClass} ${MILIK_ORANGE_RING} ${MILIK_ORANGE_BORDER_FOCUS} ${
                    fieldErrors.deposit ? "border-red-500" : ""
                  }`}
                  disabled={loading}
                />
                {fieldErrors.deposit && (
                  <p className="mt-1 text-xs text-red-600">{fieldErrors.deposit}</p>
                )}
              </div>
            </div>
            {/* Status - edit mode only. New units are created as vacant by backend. */}
            {isEditMode && (
              <div className="xl:col-span-4">
                <MilikSelect
                  label="Status"
                  placeholder="Select status"
                  items={statusOptions}
                  value={formData.status}
                  onChange={(val) => handleInputChange({ target: { name: "status", value: val } })}
                  getLabel={(s) => s.label}
                  getValue={(s) => s.value}
                  disabled={loading}
                />
              </div>
            )}

            {/* ============================================= */}
            {/* UTILITIES & BILLING SECTION */}
            {/* ============================================= */}

            {/* Unit-Specific Utilities */}
            <div className="xl:col-span-7 bg-gradient-to-br from-slate-50 to-slate-100 border border-slate-200 rounded-lg p-4 space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-base font-bold text-slate-900 tracking-tight">Unit-Specific Utilities</h3>
                <button
                  type="button"
                  onClick={addUtility}
                  className="h-8 px-3 text-xs font-semibold bg-[#0B3B2E] hover:bg-[#0A3127] text-white rounded-md flex items-center gap-2 transition-colors"
                >
                  <FaPlus /> Add Utility
                </button>
              </div>

              {formData.utilities.length === 0 ? (
                <div className="text-center py-6 text-slate-500 text-sm">
                  No utilities added yet. Click "Add Utility" to include utilities for this unit.
                </div>
              ) : (
                <div className="space-y-3">
                  {formData.utilities.map((util, idx) => {
                    return (
                      <div
                        key={idx}
                        className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end p-3 bg-white border border-slate-200 rounded-lg hover:shadow-sm transition-shadow"
                      >
                        {/* Utility Selection */}
                        <div>
                          <MilikSelect
                            label="Service Charge/Utility"
                            placeholder="Select Type"
                            items={Array.from(new Set([...utilityOptions, "Water", "Garbage", "Electricity", "Service Charge", "Security", "Others"]))}
                            value={util.utility}
                            onChange={(val) => updateUtility(idx, "utility", val)}
                            getLabel={(x) => x}
                            getValue={(x) => x}
                            disabled={loading}
                          />
                        </div>

                        {/* Unit Charge */}
                        <div>
                          <label className={labelClass}>Unit Charge (KES)</label>
                          <input
                            type="number"
                            value={util.unitCharge}
                            onChange={(e) => updateUtility(idx, "unitCharge", e.target.value)}
                            placeholder="0.00"
                            min="0"
                            step="0.01"
                            className={`${inputClass} ${MILIK_ORANGE_RING} ${MILIK_ORANGE_BORDER_FOCUS}`}
                            disabled={loading}
                          />
                        </div>

                        {/* Include in Rent */}
                        <div className="flex items-center h-10">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={util.isIncluded}
                              onChange={(e) => updateUtility(idx, "isIncluded", e.target.checked)}
                              className="rounded border-slate-300 text-[#0B3B2E] focus:ring-[#0B3B2E]/30"
                              disabled={loading}
                            />
                            <span className="text-xs font-medium text-slate-700">Include in Rent</span>
                          </label>
                        </div>

                        {/* Remove Button */}
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => removeUtility(idx)}
                            className="h-10 px-3 rounded-md bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 transition-colors flex items-center justify-center"
                            disabled={loading}
                          >
                            <FaTrash className="text-xs" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Billing Calculation Summary */}
            <div className="xl:col-span-5 bg-gradient-to-br from-[#0B3B2E]/5 via-white to-slate-50 border border-[#0B3B2E]/20 rounded-lg p-4 space-y-4">
              <h3 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <FaCalculator className="text-[#0B3B2E]" />
                Billing Calculation Summary
              </h3>

              {/* Breakdown Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Monthly Rent */}
                <div className="bg-white border border-slate-200 rounded-lg p-4 boxshadow-sm">
                  <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">
                    Monthly Rent
                  </div>
                  <div className="text-xl font-bold text-slate-900">
                    KES {monthlyRent.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-xs text-slate-500 mt-2">Base rental amount</div>
                </div>

                {/* Utility Charges */}
                <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
                  <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">
                    Utilities (Not in Rent)
                  </div>
                  <div className="text-xl font-bold text-[#0B3B2E]">
                    KES {monthlyUtilityBill.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-xs text-slate-500 mt-2">Additional monthly charges</div>
                </div>

                {/* Total Monthly Bill */}
                <div className="bg-gradient-to-br from-[#0B3B2E] to-[#0A3127] border border-[#0B3B2E] rounded-lg p-4 shadow-md">
                  <div className="text-xs font-semibold text-white/70 uppercase tracking-wide mb-1">
                    Total Monthly Bill
                  </div>
                  <div className="text-xl font-bold text-white">
                    KES {totalMonthlyBill.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-xs text-white/50 mt-2">Rent + utilities</div>
                </div>
              </div>

              {/* Billing Frequency Selector */}
              <div className="bg-white border border-slate-200 rounded-lg p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                  <div>
                    <label className={labelClass}>Billing Frequency</label>
                    <select
                      value={formData.billingFrequency}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, billingFrequency: e.target.value }))
                      }
                      className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                      disabled={loading}
                    >
                      {billingPeriodOptions.map((period) => (
                        <option key={period.key} value={period.key}>
                          {period.name}{Number(period.durationInMonths || 1) > 1 ? ` (Every ${Number(period.durationInMonths || 1)} Months)` : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Billing Amount Display */}
                  <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-lg p-4 text-white shadow-lg">
                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">
                      {(() => {
                        const selectedPeriod = billingPeriodOptions.find((item) => item.key === canonicalBillingPeriodKey(formData.billingFrequency || "monthly"));
                        return `${selectedPeriod?.name || "Configured"} Invoice Amount`;
                      })()}
                    </div>
                    <div className="text-2xl font-bold text-white">
                      KES {billingAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Utilities Included in Rent Notice */}
              {formData.utilities.some((u) => u.isIncluded) && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="flex gap-3">
                    <div className="text-blue-600 text-sm font-semibold">ℹ️</div>
                    <div className="text-sm text-blue-800">
                      <strong>Included Utilities:</strong> {
                        formData.utilities
                          .filter((u) => u.isIncluded)
                          .map(
                            (u) =>
                              String(u.utility || "Unknown")
                          )
                          .join(", ")
                      }{" "}
                      are already included in the monthly rent.
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Amenities */}
            <div className="xl:col-span-6">
              <label className={labelClass}>Amenities</label>
              <input
                type="text"
                name="amenities"
                value={formData.amenities}
                onChange={handleInputChange}
                placeholder="e.g., Parking, Balcony, WiFi (comma separated)"
                className={`${inputClass} ${MILIK_ORANGE_RING} ${MILIK_ORANGE_BORDER_FOCUS}`}
                disabled={loading}
              />
              <p className="mt-1 text-xs text-slate-500">Separate multiple amenities with commas</p>
            </div>

            {/* Description */}
            <div className="xl:col-span-6">
              <label className={labelClass}>Description</label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                placeholder="Additional details about the unit..."
                rows="4"
                className={`${inputClass} ${MILIK_ORANGE_RING} ${MILIK_ORANGE_BORDER_FOCUS} resize-none`}
                disabled={loading}
              />
            </div>

          </form>
        </div>
        </div>

        {/* Sticky footer */}
        <div className="flex-shrink-0 border-t border-slate-200 bg-[#F6FAF8] px-4 py-2.5">
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={loading}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
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
              form="unit-form"
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white transition hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? <FaSpinner className="animate-spin" /> : <FaSave />}
              {loading ? "Saving…" : isEditMode ? "Update Unit" : "Save Unit"}
            </button>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default AddUnit;
