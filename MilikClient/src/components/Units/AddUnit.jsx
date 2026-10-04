import MilikSelect from "../common/MilikSelect";
// components/Units/AddUnit.jsx
import React, { useState, useEffect, useRef, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useParams } from "react-router-dom";
import DashboardLayout from "../Layout/DashboardLayout";
import { FaSave, FaTimes, FaChevronDown, FaSpinner, FaPlus, FaTrash, FaCalculator, FaArrowLeft } from "react-icons/fa";
import { toast } from "react-toastify";
import { createUnit, getUnits, updateUnit } from "../../redux/unitRedux";
import { getProperties } from "../../redux/propertyRedux";
import { selectCurrentCompany, selectAllProperties, selectAllUnits, selectUnitIsFetching } from "../../redux/selectors";
import { adminRequests } from "../../utils/requestMethods";
import { normalizeUppercaseInput } from "../../utils/listingPageUtils";
import ListingImagesField from "../common/ListingImagesField";
import { useTerms } from "../../hooks/useTerm";

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


const AddUnit = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { id: unitId } = useParams();
  const isEditMode = Boolean(unitId);
  
  const currentCompany = useSelector(selectCurrentCompany);
  const loading = useSelector(selectUnitIsFetching);
  const {
    unit: termUnit,
    rent: termRent,
    property: termProperty,
    invoice: termInvoice,
    lease: termLease,
  } = useTerms("unit", "units", "rent", "property", "tenant", "invoice", "lease");
  const units = useSelector(selectAllUnits);
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
    deposits: [],
    billingFrequency: "monthly",
    furnished: "unfurnished",
    listingEnabled: false,
    listingTitle: "",
    bedrooms: "",
    bathrooms: "",
    parkingSpaces: "",
    floorNumber: "",
    petsAllowed: false,
    rentNegotiable: false,
    minimumLeaseTermMonths: "",
    videoUrl: "",
    virtualTourUrl: "",
    availableFrom: "",
  });

  const [existingImages, setExistingImages] = useState([]);
  const [stagedImageFiles, setStagedImageFiles] = useState([]);
  const [imagesSaving, setImagesSaving] = useState(false);

  const [fieldErrors, setFieldErrors] = useState({});
  const [generalError, setGeneralError] = useState("");
  const [utilityOptions, setUtilityOptions] = useState([]);
  const [depositTypeOptions, setDepositTypeOptions] = useState([]);
  const [billingPeriodOptions, setBillingPeriodOptions] = useState([{ key: "monthly", name: "Monthly", durationInMonths: 1 }]);
  const [configuredUnitTypes, setConfiguredUnitTypes] = useState([]);
  const [depositTouched, setDepositTouched] = useState(Boolean(isEditMode));
  const [rentTouched, setRentTouched] = useState(Boolean(isEditMode));
  const [utilitiesTouched, setUtilitiesTouched] = useState(Boolean(isEditMode));
  const [unitDepositsTouched, setUnitDepositsTouched] = useState(Boolean(isEditMode));
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
          const depositNames = Array.from(new Set((res?.data?.depositTypes || [])
            .filter((item) => item?.isActive !== false && item?.name)
            .map((item) => String(item.name))));
          setDepositTypeOptions(depositNames);
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
          const activeUnitTypes = Array.isArray(res?.data?.unitTypes)
            ? res.data.unitTypes.filter((t) => t?.isActive !== false && t?.name)
            : [];
          setConfiguredUnitTypes(activeUnitTypes);
        })
        .catch(() => {
          setUtilityOptions([]);
          setDepositTypeOptions([]);
          setBillingPeriodOptions([{ key: "monthly", name: "Monthly", durationInMonths: 1 }]);
        });
    }
  }, [dispatch, currentCompany?._id, isEditMode]);

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
          deposits: existingUnit.deposits || [],
          billingFrequency: canonicalBillingPeriodKey(existingUnit.billingPeriodKey || existingUnit.billingFrequency || "monthly"),
          furnished: existingUnit.furnished || "unfurnished",
          listingEnabled: Boolean(existingUnit.listingEnabled),
          listingTitle: existingUnit.listingTitle || "",
          bedrooms: existingUnit.bedrooms ?? "",
          bathrooms: existingUnit.bathrooms ?? "",
          parkingSpaces: existingUnit.parkingSpaces ?? "",
          floorNumber: existingUnit.floorNumber || "",
          petsAllowed: Boolean(existingUnit.petsAllowed),
          rentNegotiable: Boolean(existingUnit.rentNegotiable),
          minimumLeaseTermMonths: existingUnit.minimumLeaseTermMonths ?? "",
          videoUrl: existingUnit.videoUrl || "",
          virtualTourUrl: existingUnit.virtualTourUrl || "",
          availableFrom: existingUnit.availableFrom
            ? new Date(existingUnit.availableFrom).toISOString().slice(0, 10)
            : "",
        });
      }
    }
  }, [isEditMode, unitId, units]);

  // The units list endpoint omits `images` to keep list payloads light, so
  // fetch the single unit directly to get its current photo gallery.
  useEffect(() => {
    if (!isEditMode || !unitId) return;
    let cancelled = false;
    adminRequests
      .get(`/units/${unitId}`)
      .then((res) => {
        if (!cancelled) setExistingImages(Array.isArray(res.data?.images) ? res.data.images : []);
      })
      .catch(() => {
        if (!cancelled) setExistingImages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isEditMode, unitId]);

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

  useEffect(() => {
    if (!selectedProperty || isEditMode || utilitiesTouched) return;
    const charges = Array.isArray(selectedProperty.standingCharges) ? selectedProperty.standingCharges : [];
    if (charges.length === 0) return;
    const derived = charges
      .filter((c) => c.serviceCharge)
      .map((c) => ({ utility: c.serviceCharge, isIncluded: false, unitCharge: c.chargeValue ? String(c.chargeValue) : "" }));
    if (derived.length === 0) return;
    setFormData((prev) => {
      const alreadySet = prev.utilities.some((u) => u.utility);
      if (alreadySet) return prev;
      return { ...prev, utilities: derived };
    });
  }, [isEditMode, selectedProperty, utilitiesTouched]);

  // Every non-rent deposit type configured on the property auto-populates here (unlike utilities,
  // which start empty) — the rent/security deposit stays exclusively on the dedicated preview above.
  useEffect(() => {
    if (!selectedProperty || isEditMode || unitDepositsTouched) return;
    const propertyDeposits = Array.isArray(selectedProperty.securityDeposits) ? selectedProperty.securityDeposits : [];
    const derived = propertyDeposits
      .filter((d) => d?.depositType && !String(d.depositType).toLowerCase().includes("rent"))
      .map((d) => ({
        depositType: d.depositType,
        amount: d.amount != null ? String(d.amount) : "",
        chargeMode: d.chargeMode === "Percentage" ? "Percentage" : "Fixed Amount",
        refundable: d.refundable !== false,
        currency: d.currency || "KES",
      }));
    setFormData((prev) => ({ ...prev, deposits: derived }));
  }, [isEditMode, selectedProperty, unitDepositsTouched]);

  // Input classes for consistency
  const inputClass =
    "h-7 w-full border border-slate-300 bg-white px-2.5 text-sm text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";

  const labelClass = "mb-1 block text-xs font-bold text-slate-900";

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
      setUtilitiesTouched(false);
      setUnitDepositsTouched(false);
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
    setUtilitiesTouched(true);
    setFormData((prev) => ({
      ...prev,
      utilities: [...prev.utilities, { utility: "", isIncluded: false, unitCharge: "" }]
    }));
  };

  const removeUtility = (index) => {
    setUtilitiesTouched(true);
    setFormData((prev) => ({
      ...prev,
      utilities: prev.utilities.filter((_, i) => i !== index)
    }));
  };

  const updateUtility = (index, field, value) => {
    setUtilitiesTouched(true);
    setFormData((prev) => {
      const updated = [...prev.utilities];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, utilities: updated };
    });
  };

  const addDeposit = () => {
    setUnitDepositsTouched(true);
    setFormData((prev) => ({
      ...prev,
      deposits: [...prev.deposits, { depositType: "", amount: "", chargeMode: "Fixed Amount", refundable: true, currency: "KES" }]
    }));
  };

  const removeDeposit = (index) => {
    setUnitDepositsTouched(true);
    setFormData((prev) => ({
      ...prev,
      deposits: prev.deposits.filter((_, i) => i !== index)
    }));
  };

  const updateDeposit = (index, field, value) => {
    setUnitDepositsTouched(true);
    setFormData((prev) => {
      const updated = [...prev.deposits];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, deposits: updated };
    });
  };

  const handleImageFilesSelected = (files) => {
    setStagedImageFiles((prev) => [...prev, ...files]);
  };

  const handleRemoveStagedImage = (index) => {
    setStagedImageFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleRemoveExistingImage = async (url) => {
    if (!unitId) return;
    setImagesSaving(true);
    try {
      const res = await adminRequests.delete(`/units/${unitId}/images`, { data: { url } });
      setExistingImages(Array.isArray(res.data?.images) ? res.data.images : []);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to remove photo");
    } finally {
      setImagesSaving(false);
    }
  };

  const uploadStagedImages = async (targetUnitId) => {
    if (!targetUnitId || stagedImageFiles.length === 0) return;
    const body = new FormData();
    stagedImageFiles.forEach((file) => body.append("images", file));
    try {
      await adminRequests.post(`/units/${targetUnitId}/images`, body);
      setStagedImageFiles([]);
    } catch (err) {
      toast.error(err?.response?.data?.message || `${termUnit} saved, but photo upload failed`);
    }
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
      errors.property = `${termProperty} is required`;
    }
    if (!formData.unitNumber?.trim()) {
      errors.unitNumber = `${termUnit} number is required`;
    }
    if (!formData.unitType) {
      errors.unitType = `${termUnit} type is required`;
    }
    if (formData.rent && parseFloat(formData.rent) < 0) {
      errors.rent = `${termRent} cannot be negative`;
    }
    if (formData.deposit && parseFloat(formData.deposit) < 0) {
      errors.deposit = "Deposit cannot be negative";
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
      status: formData.status || "vacant",
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
      deposits: formData.deposits
        .filter((d) => d.depositType) // Only include deposits with a selected type
        .map((d) => ({
          depositType: d.depositType,
          amount: d.amount ? parseFloat(d.amount) : 0,
          chargeMode: d.chargeMode === "Percentage" ? "Percentage" : "Fixed Amount",
          refundable: Boolean(d.refundable),
          currency: d.currency || "KES",
        })),
      billingFrequency: canonicalBillingPeriodKey(formData.billingFrequency || "monthly"),
      billingPeriodKey: canonicalBillingPeriodKey(formData.billingFrequency || "monthly"),
      furnished: formData.furnished || "unfurnished",
      listingEnabled: Boolean(formData.listingEnabled),
      listingTitle: formData.listingTitle?.trim() || "",
      bedrooms: formData.bedrooms === "" ? null : Number(formData.bedrooms),
      bathrooms: formData.bathrooms === "" ? null : Number(formData.bathrooms),
      parkingSpaces: formData.parkingSpaces === "" ? 0 : Number(formData.parkingSpaces),
      floorNumber: formData.floorNumber?.trim() || "",
      petsAllowed: Boolean(formData.petsAllowed),
      rentNegotiable: Boolean(formData.rentNegotiable),
      minimumLeaseTermMonths: formData.minimumLeaseTermMonths === "" ? 0 : Number(formData.minimumLeaseTermMonths),
      videoUrl: formData.videoUrl?.trim() || "",
      virtualTourUrl: formData.virtualTourUrl?.trim() || "",
      ...(isEditMode ? { availableFrom: formData.availableFrom || null } : {}),
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
      
      let savedUnit;
      if (isEditMode) {
        // Update existing unit
        savedUnit = await dispatch(updateUnit({ id: unitId, unitData })).unwrap();
        toast.success(`${termUnit} updated successfully!`);
      } else {
        // Create new unit
        savedUnit = await dispatch(createUnit(unitData)).unwrap();
        toast.success(`${termUnit} created successfully!`);
      }

      if (stagedImageFiles.length > 0) {
        setImagesSaving(true);
        await uploadStagedImages(savedUnit?._id || unitId);
        setImagesSaving(false);
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
        (isEditMode ? `Failed to update ${termUnit.toLowerCase()}` : `Failed to create ${termUnit.toLowerCase()}`);

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
    setFormData({
      unitNumber: "", property: "", unitType: "", areaSqFt: "", rent: "", deposit: "",
      status: "vacant", description: "", amenities: "", utilities: [], deposits: [], billingFrequency: "monthly",
      furnished: "unfurnished", listingEnabled: false,
      listingTitle: "", bedrooms: "", bathrooms: "", parkingSpaces: "", floorNumber: "",
      petsAllowed: false, rentNegotiable: false, minimumLeaseTermMonths: "",
      videoUrl: "", virtualTourUrl: "", availableFrom: "",
    });
    setStagedImageFiles([]);
    setFieldErrors({});
    setGeneralError("");
    clearDraftState();
  };

  const DEFAULT_UNIT_TYPES = [
    { value: "studio", label: "Studio" },
    { value: "1bed", label: "1 Bedroom" },
    { value: "2bed", label: "2 Bedrooms" },
    { value: "3bed", label: "3 Bedrooms" },
    { value: "4bed", label: "4 Bedrooms" },
    { value: "commercial", label: "Commercial" },
  ];
  // Store the configured type name verbatim ("Suit"), not a slug — the backend validates
  // against Operational Settings -> Unit Types and keeps that exact name, so a slug here
  // would never match. Fall back to the 6 legacy values only when nothing is configured
  // (those still resolve server-side).
  const unitTypes = (() => {
    const base = configuredUnitTypes.length
      ? configuredUnitTypes.map((t) => ({ value: String(t.name).trim(), label: String(t.name).trim() }))
      : DEFAULT_UNIT_TYPES;
    // When editing a unit whose stored type isn't in the current list (an old legacy value,
    // or a type since renamed/removed), keep it selectable rather than silently blanking.
    const current = String(formData.unitType || "").trim();
    if (current && !base.some((o) => o.value === current)) {
      return [...base, { value: current, label: current }];
    }
    return base;
  })();

  const statusOptions = useMemo(() => {
    const baseOptions = [
      { value: "vacant", label: "Vacant" },
      { value: "maintenance", label: "Maintenance" },
      { value: "reserved", label: "Reserved" },
    ];

    if (formData.status === "occupied") {
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
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <form id="unit-form" onSubmit={handleSubmit} className="space-y-2">
            <div className="border border-slate-200 bg-white">
              <div className="border-b border-slate-200 bg-slate-50 px-2.5 py-1.5">
                <span className="text-[11px] font-black uppercase tracking-wide text-slate-800">{isEditMode ? `Edit ${termUnit}` : `${termUnit} details`}</span>
              </div>
              <div className="grid grid-cols-1 gap-x-3 gap-y-2 p-2.5 md:grid-cols-2 xl:grid-cols-4">
                <div className="md:col-span-2">
                  <MilikSelect
                    label={termProperty}
                    required
                    placeholder={`Select ${termProperty.toLowerCase()}`}
                    items={activeProperties}
                    value={formData.property}
                    onChange={(val) => handleInputChange({ target: { name: "property", value: val } })}
                    getLabel={(p) => `${p.propertyCode} - ${p.propertyName}`}
                    getValue={(p) => p._id}
                    disabled={loading}
                    error={fieldErrors.property}
                  />
                  {selectedProperty && (
                    <p className="mt-1 text-[11px] text-slate-500">
                      Basis: {measurementLabel} · Default {termRent.toLowerCase()}: {Number(selectedProperty.rentPerMeasure || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {selectedProperty.rentCurrency || "KES"} per {measurementLabel}
                    </p>
                  )}
                </div>

                <div>
                  <label className={labelClass}>{termUnit} number <span className="text-red-600">*</span></label>
                  <input
                    type="text"
                    name="unitNumber"
                    value={formData.unitNumber}
                    onChange={handleInputChange}
                    placeholder="e.g. A101, 5B, Unit 12"
                    className={`${inputClass} ${fieldErrors.unitNumber ? "border-red-500" : ""}`}
                    disabled={loading}
                  />
                  {fieldErrors.unitNumber && <p className="mt-0.5 text-[11px] font-semibold text-red-600">{fieldErrors.unitNumber}</p>}
                </div>

                <div>
                  <MilikSelect
                    label={`${termUnit} type`}
                    required
                    placeholder={`Select ${termUnit.toLowerCase()} type`}
                    items={unitTypes}
                    value={formData.unitType}
                    onChange={(val) => handleInputChange({ target: { name: "unitType", value: val } })}
                    getLabel={(t) => t.label}
                    getValue={(t) => t.value}
                    disabled={loading}
                    error={fieldErrors.unitType}
                  />
                </div>

                <div>
                  <label className={labelClass}>Area ({measurementLabel})</label>
                  <input
                    type="number"
                    name="areaSqFt"
                    value={formData.areaSqFt}
                    onChange={handleInputChange}
                    placeholder={`e.g. ${measurementLabel === "Sq Ft" ? "500" : "100"}`}
                    min="0"
                    step="0.01"
                    className={inputClass}
                    disabled={loading}
                  />
                </div>

                <div>
                  <label className={labelClass}>Furnishing</label>
                  <select name="furnished" value={formData.furnished} onChange={handleInputChange} className={inputClass} disabled={loading}>
                    <option value="unfurnished">Unfurnished</option>
                    <option value="semi-furnished">Semi-furnished</option>
                    <option value="furnished">Furnished</option>
                  </select>
                </div>

                <div>
                  <label className={labelClass}>Monthly {termRent} (KES){formData.status !== "owner_occupied" && <span className="text-red-600"> *</span>}</label>
                  <input
                    type="number"
                    name="rent"
                    value={formData.rent}
                    onChange={handleInputChange}
                    placeholder="e.g. 25000"
                    min="0"
                    step="0.01"
                    className={`${inputClass} ${fieldErrors.rent ? "border-red-500" : ""}`}
                    disabled={loading}
                  />
                  {fieldErrors.rent && <p className="mt-0.5 text-[11px] font-semibold text-red-600">{fieldErrors.rent}</p>}
                </div>

                <div>
                  <label className={labelClass}>Security deposit (KES){formData.status !== "owner_occupied" && <span className="text-red-600"> *</span>}</label>
                  <input
                    type="number"
                    name="deposit"
                    value={formData.deposit}
                    onChange={handleInputChange}
                    placeholder="e.g. 50000"
                    min="0"
                    step="0.01"
                    className={`${inputClass} ${fieldErrors.deposit ? "border-red-500" : ""}`}
                    disabled={loading}
                  />
                  {fieldErrors.deposit && <p className="mt-0.5 text-[11px] font-semibold text-red-600">{fieldErrors.deposit}</p>}
                </div>

                {formData.status !== "owner_occupied" && (
                  <div>
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
                <div>
                  <label className={labelClass}>Available from</label>
                  <input type="date" name="availableFrom" value={formData.availableFrom} onChange={handleInputChange} className={inputClass} disabled={loading} />
                </div>
                <label className="flex h-7 items-center gap-2 text-xs font-bold text-slate-900">
                  <input
                    type="checkbox"
                    checked={formData.status === "owner_occupied"}
                    onChange={(e) => setFormData((p) => ({
                      ...p,
                      listingEnabled: e.target.checked ? false : p.listingEnabled,
                      status: e.target.checked ? "owner_occupied" : (p.status === "owner_occupied" ? "vacant" : p.status),
                    }))}
                    disabled={loading}
                  />
                  Owner occupied
                </label>
              </div>
            </div>

            <div className="border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-2.5 py-1.5">
                <span className="text-[11px] font-black uppercase tracking-wide text-slate-800">Utilities</span>
                <button type="button" onClick={addUtility} disabled={loading} className="flex items-center gap-1 text-[11px] font-bold text-[#0B3B2E] hover:underline">
                  <FaPlus size={9} /> Add utility
                </button>
              </div>
              {formData.utilities.length === 0 ? (
                <p className="px-2.5 py-2 text-[11px] italic text-slate-500">No utilities. Add one if this {termUnit.toLowerCase()} is charged for utilities separately.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {formData.utilities.map((util, idx) => (
                    <div key={idx} className="grid grid-cols-1 items-end gap-x-3 gap-y-2 p-2.5 md:grid-cols-[1fr_1fr_auto_auto]">
                      <MilikSelect
                        label="Utility"
                        placeholder="Select type"
                        items={utilityOptions.length ? utilityOptions : ["Water", "Garbage", "Electricity", "Service Charge", "Security", "Others"]}
                        value={util.utility}
                        onChange={(val) => updateUtility(idx, "utility", val)}
                        getLabel={(x) => x}
                        getValue={(x) => x}
                        disabled={loading}
                      />
                      <div>
                        <label className={labelClass}>{termUnit} charge (KES)</label>
                        <input
                          type="number"
                          value={util.unitCharge}
                          onChange={(e) => updateUtility(idx, "unitCharge", e.target.value)}
                          placeholder="0.00"
                          min="0"
                          step="0.01"
                          className={inputClass}
                          disabled={loading}
                        />
                      </div>
                      <label className="flex h-7 items-center gap-2 text-xs font-bold text-slate-900">
                        <input
                          type="checkbox"
                          checked={util.isIncluded}
                          onChange={(e) => updateUtility(idx, "isIncluded", e.target.checked)}
                          disabled={loading}
                        />
                        Included in {termRent.toLowerCase()}
                      </label>
                      <button type="button" onClick={() => removeUtility(idx)} disabled={loading} title="Remove" className="flex h-7 items-center px-2 text-slate-400 hover:text-rose-600">
                        <FaTrash size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-2.5 py-1.5">
                <div>
                  <span className="text-[11px] font-black uppercase tracking-wide text-slate-800">Deposits</span>
                  <span className="ml-2 text-[11px] text-slate-500">Filled from the {termProperty.toLowerCase()}'s deposit types. Rent deposit is above.</span>
                </div>
                <button type="button" onClick={addDeposit} disabled={loading} className="flex items-center gap-1 text-[11px] font-bold text-[#0B3B2E] hover:underline">
                  <FaPlus size={9} /> Add deposit
                </button>
              </div>
              {formData.deposits.length === 0 ? (
                <p className="px-2.5 py-2 text-[11px] italic text-slate-500">No additional deposits.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {formData.deposits.map((dep, idx) => (
                    <div key={idx} className="grid grid-cols-1 items-end gap-x-3 gap-y-2 p-2.5 md:grid-cols-[1fr_1fr_1fr_auto_auto]">
                      <MilikSelect
                        label="Deposit type"
                        placeholder="Select type"
                        items={depositTypeOptions.length ? depositTypeOptions : ["Water Security Deposit", "Electricity Security Deposit", "Others"]}
                        value={dep.depositType}
                        onChange={(val) => updateDeposit(idx, "depositType", val)}
                        getLabel={(x) => x}
                        getValue={(x) => x}
                        disabled={loading}
                      />
                      <MilikSelect
                        label="Mode"
                        placeholder="Select mode"
                        items={["Fixed Amount", "Percentage"]}
                        value={dep.chargeMode}
                        onChange={(val) => updateDeposit(idx, "chargeMode", val)}
                        getLabel={(x) => x}
                        getValue={(x) => x}
                        disabled={loading}
                      />
                      <div>
                        <label className={labelClass}>{dep.chargeMode === "Percentage" ? `% of ${termRent.toLowerCase()}` : "Amount (KES)"}</label>
                        <input
                          type="number"
                          value={dep.amount}
                          onChange={(e) => updateDeposit(idx, "amount", e.target.value)}
                          placeholder="0.00"
                          min="0"
                          step="0.01"
                          className={inputClass}
                          disabled={loading}
                        />
                      </div>
                      <label className="flex h-7 items-center gap-2 text-xs font-bold text-slate-900">
                        <input type="checkbox" checked={dep.refundable} onChange={(e) => updateDeposit(idx, "refundable", e.target.checked)} disabled={loading} />
                        Refundable
                      </label>
                      <button type="button" onClick={() => removeDeposit(idx)} disabled={loading} title="Remove" className="flex h-7 items-center px-2 text-slate-400 hover:text-rose-600">
                        <FaTrash size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border border-slate-200 bg-white">
              <div className="border-b border-slate-200 bg-slate-50 px-2.5 py-1.5">
                <span className="text-[11px] font-black uppercase tracking-wide text-slate-800">Billing</span>
              </div>
              <div className="grid grid-cols-1 items-end gap-x-3 gap-y-2 p-2.5 md:grid-cols-3">
                <div>
                  <label className={labelClass}>Billing frequency</label>
                  <select
                    value={formData.billingFrequency}
                    onChange={(e) => setFormData((prev) => ({ ...prev, billingFrequency: e.target.value }))}
                    className={inputClass}
                    disabled={loading}
                  >
                    {billingPeriodOptions.map((period) => (
                      <option key={period.key} value={period.key}>
                        {period.name}{Number(period.durationInMonths || 1) > 1 ? ` (every ${Number(period.durationInMonths || 1)} months)` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2 text-sm">
                  {(() => {
                    const selectedPeriod = billingPeriodOptions.find((item) => item.key === canonicalBillingPeriodKey(formData.billingFrequency || "monthly"));
                    return (
                      <>
                        <span className="text-xs font-bold text-slate-900">{selectedPeriod?.name || "Configured"} {termInvoice.toLowerCase()} amount: </span>
                        <span className="font-black tabular-nums text-slate-900">KES {billingAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </>
                    );
                  })()}
                  {monthlyUtilityBill > 0 && (
                    <p className="mt-1 text-[11px] text-slate-600">
                      Utilities KES {monthlyUtilityBill.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} a month on top of {termRent.toLowerCase()}. Total KES {totalMonthlyBill.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.
                    </p>
                  )}
                  {formData.utilities.some((u) => u.isIncluded) && (
                    <p className="mt-1 text-[11px] text-slate-600">
                      Included in {termRent.toLowerCase()}: {formData.utilities.filter((u) => u.isIncluded).map((u) => String(u.utility || "Unknown")).join(", ")}.
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-2.5 py-1.5">
                <span className="text-[11px] font-black uppercase tracking-wide text-slate-800">Public listing</span>
                <label className="flex items-center gap-2 text-xs font-bold text-slate-900">
                  <input
                    type="checkbox"
                    checked={Boolean(formData.listingEnabled)}
                    onChange={(e) => setFormData((p) => ({ ...p, listingEnabled: e.target.checked }))}
                    disabled={loading || formData.status === "owner_occupied"}
                  />
                  List this unit publicly
                </label>
              </div>

              {formData.listingEnabled && (
                <div className="space-y-2 p-2.5">
                  <div className="grid grid-cols-1 gap-x-3 gap-y-2 md:grid-cols-3 xl:grid-cols-4">
                    <div className="md:col-span-3 xl:col-span-2">
                      <label className={labelClass}>Listing title</label>
                      <input type="text" name="listingTitle" value={formData.listingTitle} onChange={handleInputChange} placeholder="e.g. Bright 2-bedroom near the mall" className={inputClass} disabled={loading} />
                    </div>
                    <div>
                      <label className={labelClass}>Bedrooms</label>
                      <input type="number" name="bedrooms" value={formData.bedrooms} onChange={handleInputChange} min="0" className={inputClass} disabled={loading} />
                    </div>
                    <div>
                      <label className={labelClass}>Bathrooms</label>
                      <input type="number" name="bathrooms" value={formData.bathrooms} onChange={handleInputChange} min="0" className={inputClass} disabled={loading} />
                    </div>
                    <div>
                      <label className={labelClass}>Parking spaces</label>
                      <input type="number" name="parkingSpaces" value={formData.parkingSpaces} onChange={handleInputChange} min="0" className={inputClass} disabled={loading} />
                    </div>
                    <div>
                      <label className={labelClass}>Floor</label>
                      <input type="text" name="floorNumber" value={formData.floorNumber} onChange={handleInputChange} placeholder="e.g. Ground, 3rd" className={inputClass} disabled={loading} />
                    </div>
                    <div>
                      <label className={labelClass}>Minimum {termLease.toLowerCase()} term (months)</label>
                      <input type="number" name="minimumLeaseTermMonths" value={formData.minimumLeaseTermMonths} onChange={handleInputChange} min="0" className={inputClass} disabled={loading} />
                    </div>
                    <div>
                      <label className={labelClass}>Video URL</label>
                      <input type="text" name="videoUrl" value={formData.videoUrl} onChange={handleInputChange} placeholder="https://" className={inputClass} disabled={loading} />
                    </div>
                    <div>
                      <label className={labelClass}>Virtual tour URL</label>
                      <input type="text" name="virtualTourUrl" value={formData.virtualTourUrl} onChange={handleInputChange} placeholder="https://" className={inputClass} disabled={loading} />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-6 text-xs font-bold text-slate-900">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={Boolean(formData.petsAllowed)} onChange={(e) => setFormData((p) => ({ ...p, petsAllowed: e.target.checked }))} disabled={loading} />
                      Pets allowed
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={Boolean(formData.rentNegotiable)} onChange={(e) => setFormData((p) => ({ ...p, rentNegotiable: e.target.checked }))} disabled={loading} />
                      {termRent} negotiable
                    </label>
                  </div>

                  <ListingImagesField
                    label={`${termUnit} photos`}
                    existingImages={existingImages}
                    stagedFiles={stagedImageFiles}
                    onFilesSelected={handleImageFilesSelected}
                    onRemoveExisting={handleRemoveExistingImage}
                    onRemoveStaged={handleRemoveStagedImage}
                    disabled={loading || imagesSaving}
                    maxImages={12}
                  />

                  <div className="grid grid-cols-1 gap-x-3 gap-y-2 md:grid-cols-2">
                    <div>
                      <label className={labelClass}>Amenities</label>
                      <input type="text" name="amenities" value={formData.amenities} onChange={handleInputChange} placeholder="e.g. Parking, Balcony, WiFi" className={inputClass} disabled={loading} />
                      <p className="mt-1 text-[11px] text-slate-500">Separate with commas</p>
                    </div>
                    <div>
                      <label className={labelClass}>Description</label>
                      <textarea
                        name="description"
                        value={formData.description}
                        onChange={handleInputChange}
                        placeholder="Additional details about the unit"
                        rows={2}
                        className={`${inputClass} h-auto py-1.5 resize-none`}
                        disabled={loading}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </form>
        </div>

        <div className="flex-shrink-0 border-t border-slate-200 bg-white px-3 py-2">
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={handleCancel} disabled={loading} className="h-7 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              Cancel
            </button>
            {!isEditMode && (
              <button type="button" onClick={handleReset} disabled={loading} className="h-7 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                Reset
              </button>
            )}
            <button type="submit" form="unit-form" disabled={loading} className="flex h-7 items-center gap-1.5 bg-[#0B3B2E] px-3 text-xs font-black text-white hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60">
              {loading ? <FaSpinner className="animate-spin" /> : <FaSave />}
              {loading ? "Saving…" : isEditMode ? `Update ${termUnit}` : `Save ${termUnit}`}
            </button>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default AddUnit;