import React, { useState, useEffect, useRef, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import {
  FaSave,
  FaTimes,
  FaChevronDown,
  FaSpinner,
  FaCalculator,
  FaPlus,
  FaTrash,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { getProperties } from "../../redux/propertyRedux";
import { getUnits } from "../../redux/unitRedux";
import { createTenant, getTenants } from "../../redux/tenantsRedux";
import { createTenantInvoice } from "../../redux/apiCalls";
import { adminRequests } from "../../utils/requestMethods";

// Milik theme constants
const MILIK_GREEN_BG = "bg-[#0B3B2E]";
const MILIK_GREEN_BG_HOVER = "hover:bg-[#0A3127]";
const MILIK_ORANGE_BG = "bg-[#FF8C00]";
const MILIK_ORANGE_BG_HOVER = "hover:bg-[#e67e00]";
const MILIK_ORANGE_RING = "focus:ring-orange-500/30";
const MILIK_ORANGE_BORDER_FOCUS = "focus:border-orange-600";

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
});

const normalizeId = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

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
          {label} {required ? "*" : ""}
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

const AddTenant = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const { currentCompany } = useSelector((state) => state.company);
  const currentUser = useSelector((state) => state.auth?.currentUser || state.auth?.user || null);
  const { isFetching: loading } = useSelector(
    (state) => state.tenant || { isFetching: false }
  );
  const properties = useSelector((state) => state.property?.properties || []);
  const units = useSelector((state) => state.unit?.units || []);

  const generateNextTenantCode = () => "";

  const [formData, setFormData] = useState({
    tenantCode: generateNextTenantCode(),
    name: "",
    phone: "",
    idNumber: "",
    property: "",
    unit: "",
    moveInDate: "",
    moveOutDate: "",
    leaseType: "at_will",
    rent: "",
    depositAmount: "",
    depositHeldBy: "Management Company",
    paymentMethod: "",
    status: "active",
    emergencyContactName: "",
    emergencyContactPhone: "",
    emergencyContactRelationship: "Family",
    utilities: [],
  });

  const [fieldErrors, setFieldErrors] = useState({});
  const [generalError, setGeneralError] = useState("");
  const [availableUnits, setAvailableUnits] = useState([]);
  const [additionalUtilities, setAdditionalUtilities] = useState([]);
  const [showInvoicePrompt, setShowInvoicePrompt] = useState(false);
  const [pendingInvoiceContext, setPendingInvoiceContext] = useState(null);
  const [isCreatingInitialInvoices, setIsCreatingInitialInvoices] = useState(false);
  const [openingInvoiceMode, setOpeningInvoiceMode] = useState("separate");
  const [utilityOptions, setUtilityOptions] = useState([]);

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
    if (!formData.property) {
      setAvailableUnits([]);
      setFormData((prev) => ({ ...prev, unit: "", utilities: [] }));
      setAdditionalUtilities([]);
      return;
    }

    const propertyUnits = units.filter((u) => {
      const unitPropertyId = normalizeId(u.property?._id || u.property);
      return unitPropertyId === normalizeId(formData.property);
    });

    const vacant = propertyUnits.filter((u) => {
      const status = String(u.status || "").toLowerCase();
      return status === "vacant" && u.isVacant !== false;
    });

    setAvailableUnits(vacant);
    setFormData((prev) => ({ ...prev, unit: "", utilities: [], rent: "", depositAmount: "" }));
    setAdditionalUtilities([]);
  }, [formData.property, units]);

  useEffect(() => {
    if (!formData.unit || availableUnits.length === 0) return;

    const selectedUnit = availableUnits.find(
      (u) => normalizeId(u._id) === normalizeId(formData.unit)
    );

    if (!selectedUnit) return;

    const mappedUtilities = (selectedUnit.utilities || []).map((util) => {
      let utilityLabel = "Unknown Utility";
      let utilityValue = "";

      if (util.utility && typeof util.utility === "object" && !Array.isArray(util.utility)) {
        utilityValue = util.utility._id || "";
        utilityLabel = util.utility.name || util.utility.utilityName || "Unknown Utility";
      } else if (util.utility && typeof util.utility === "string" && util.utility.trim() !== "") {
        utilityValue = util.utility;
        utilityLabel = util.utility;
      }

      return {
        utility: utilityValue,
        utilityLabel,
        isIncluded: util.isIncluded,
        unitCharge: util.unitCharge || 0,
      };
    });

    setFormData((prev) => ({
      ...prev,
      rent: selectedUnit.rent || "",
      depositAmount:
        prev.depositAmount !== "" && prev.depositAmount !== null && prev.depositAmount !== undefined
          ? prev.depositAmount
          : String(selectedUnit.deposit || selectedUnit.rent || ""),
      utilities: mappedUtilities,
    }));
  }, [formData.unit, availableUnits]);


  const selectedUnitRecord = useMemo(
    () =>
      availableUnits.find((unit) => normalizeId(unit?._id) === normalizeId(formData.unit)) || null,
    [availableUnits, formData.unit]
  );

  const selectedPropertyRecord = useMemo(
    () =>
      properties.find((property) => normalizeId(property?._id) === normalizeId(formData.property)) || null,
    [properties, formData.property]
  );

  const invoicePreviewItems = useMemo(() => {
    const utilityRows = [...(formData.utilities || []), ...additionalUtilities]
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
        detail: `Held by ${formData.depositHeldBy || "Management Company"}`,
      });
    }

    return items;
  }, [additionalUtilities, formData.depositAmount, formData.depositHeldBy, formData.rent, formData.utilities, selectedUnitRecord]);

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
      items: invoicePreviewItems,
      utilityRows: [...(formData.utilities || []), ...additionalUtilities]
        .filter((item) => item && !item.isIncluded && Number(item.unitCharge || 0) > 0)
        .map((item) => ({
          label: item.utilityLabel || item.utility || "Utility",
          amount: Number(item.unitCharge || 0),
        })),
    };
  };

  const inputClass =
    "w-full px-3 py-2 text-sm border border-slate-300 rounded-md shadow-sm transition-all duration-200 ease-out hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-600";

  const labelClass = "block text-sm font-bold text-slate-800 mb-1 tracking-tight";

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

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
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const validateForm = () => {
    const errors = {};

    if (!formData.name?.trim()) errors.name = "Tenant name is required";
    if (!formData.phone?.trim()) errors.phone = "Phone number is required";
    if (!formData.idNumber?.trim()) errors.idNumber = "ID number is required";
    if (!formData.property?.trim()) errors.property = "Property is required";
    if (!formData.unit?.trim()) errors.unit = "Unit is required";
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
    if (!formData.paymentMethod) errors.paymentMethod = "Payment method is required";

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

    setFieldErrors(errors);
    return errors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setGeneralError("");

    const errors = validateForm();
    if (Object.keys(errors).length > 0) {
      toast.error("Please fix validation errors");
      return;
    }

    try {
      const payload = {
        ...formData,
        rent: parseFloat(formData.rent),
        depositAmount: parseFloat(formData.depositAmount || 0),
        business: currentCompany?._id,
        utilities: [
          ...formData.utilities,
          ...additionalUtilities.filter((u) => u.utility),
        ],
        emergencyContact: {
          name: formData.emergencyContactName || "",
          phone: formData.emergencyContactPhone || "",
          relationship: formData.emergencyContactRelationship || "Family",
        },
      };

      const result = await dispatch(createTenant(payload)).unwrap();
      toast.success(result?.message || "Tenant created successfully!");

      setAdditionalUtilities([]);
      dispatch(getTenants({ business: currentCompany?._id }));

      const nextInvoiceContext = buildTenantInvoiceContext(result);
      if (!nextInvoiceContext.items.length) {
        navigate("/tenants");
        return;
      }

      setPendingInvoiceContext(nextInvoiceContext);
      setShowInvoicePrompt(true);
    } catch (err) {
      const errorMsg =
        err?.message ||
        err?.error ||
        err?.data?.message ||
        "Failed to create tenant";
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

if (Number(rentItem?.amount || 0) > 0) {
  invoiceRequests.push({
    ...baseRequest,
    category: "RENT_CHARGE",
    amount:
      openingInvoiceMode === "combined"
        ? Number(rentItem.amount || 0) + Number(utilityTotal || 0)
        : Number(rentItem.amount || 0),
    description:
      openingInvoiceMode === "combined" && utilityTotal > 0
        ? `Opening combined charge (rent + utilities) for ${pendingInvoiceContext.tenant.name || formData.name}`
        : `Opening rent balance for ${pendingInvoiceContext.tenant.name || formData.name}`,
    metadata: buildTakeOnMetadata({
      type: "debit",
      billItemKey: openingInvoiceMode === "combined" ? "rent_utility:combined" : "rent",
      billItemLabel: openingInvoiceMode === "combined" ? "Combined Rent + Utilities" : "Rent",
      invoicePriorityCategory: "rent",
      utilityBreakdown:
        openingInvoiceMode === "combined"
          ? utilityRows.map((item) => ({
              label: item.label,
              amount: Number(item.amount || 0),
            }))
          : undefined,
    }),
  });
}

if (openingInvoiceMode !== "combined" && utilityRows.length > 0) {
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
    description: `Opening deposit balance (${formData.depositHeldBy}) for ${pendingInvoiceContext.tenant.name || formData.name}`,
    metadata: buildTakeOnMetadata({
      type: "debit",
      billItemKey: "deposit:security",
      billItemLabel: "Security Deposit",
      invoicePriorityCategory: "deposit",
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
    navigate("/tenants");
  };

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 py-6 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
              Tenant Details
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Create a new tenant record with billing information
            </p>
          </div>

          {generalError && (
            <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {generalError}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="bg-white shadow-sm rounded-lg border border-slate-200 overflow-hidden">
              <div className="p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className={labelClass}>Tenant Code (Optional)</label>
                    <input
                      type="text"
                      name="tenantCode"
                      value={formData.tenantCode}
                      onChange={handleInputChange}
                      placeholder="Leave blank for auto-generation"
                      className={inputClass}
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Leave blank and the system will auto-assign a code
                    </p>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 mb-4 border-b-2 border-orange-500 pb-2">
                    👤 Tenant Information
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className={labelClass}>
                        Full Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        name="name"
                        value={formData.name}
                        onChange={handleInputChange}
                        placeholder="John Doe"
                        className={`${inputClass} ${fieldErrors.name ? "border-red-500" : ""}`}
                      />
                      {fieldErrors.name && (
                        <p className="mt-1 text-xs text-red-600">{fieldErrors.name}</p>
                      )}
                    </div>

                    <div>
                      <label className={labelClass}>
                        Phone Number <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="tel"
                        name="phone"
                        value={formData.phone}
                        onChange={handleInputChange}
                        placeholder="+254 712 345 678"
                        className={`${inputClass} ${fieldErrors.phone ? "border-red-500" : ""}`}
                      />
                      {fieldErrors.phone && (
                        <p className="mt-1 text-xs text-red-600">{fieldErrors.phone}</p>
                      )}
                    </div>

                    <div>
                      <label className={labelClass}>ID Number</label>
                      <input
                        type="text"
                        name="idNumber"
                        value={formData.idNumber}
                        onChange={handleInputChange}
                        placeholder="12345678"
                        className={`${inputClass} ${fieldErrors.idNumber ? "border-red-500" : ""}`}
                      />
                      {fieldErrors.idNumber && (
                        <p className="mt-1 text-xs text-red-600">{fieldErrors.idNumber}</p>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 mb-4 border-b-2 border-green-500 pb-2">
                    🏢 Property & Unit
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <MilikSelect
                      label="Property"
                      required
                      placeholder="Select Property"
                      items={properties}
                      value={formData.property}
                      onChange={(val) => {
                        setFormData((prev) => ({ ...prev, property: val, unit: "" }));
                        if (fieldErrors.property) {
                          setFieldErrors((prev) => ({ ...prev, property: "" }));
                        }
                      }}
                      getLabel={(p) => p.propertyName || p.name || "Unknown"}
                      getValue={(p) => p._id}
                      error={fieldErrors.property}
                    />

                    <MilikSelect
                      label="Unit (Vacant Only)"
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
                      getValue={(u) => u._id}
                      error={fieldErrors.unit}
                      disabled={!formData.property}
                    />
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 mb-4 border-b-2 border-blue-500 pb-2">
                    💰 Billing Information
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
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
                        className={`${inputClass} ${fieldErrors.depositHeldBy ? "border-red-500" : ""}`}
                      >
                        <option value="Management Company">Management Company</option>
                        <option value="Landlord">Landlord</option>
                      </select>
                      {fieldErrors.depositHeldBy && (
                        <p className="mt-1 text-xs text-red-600">{fieldErrors.depositHeldBy}</p>
                      )}
                    </div>

                    <div className="md:col-span-2">
                      <label className={labelClass}>Utilities & Charges (Ksh)</label>
                      <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-lg p-3 min-h-10 max-h-32 overflow-y-auto">
                        {formData.utilities && formData.utilities.length > 0 ? (
                          <div className="space-y-1">
                            {formData.utilities.map((util, idx) => {
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
                      <div className="bg-gradient-to-br from-orange-100 to-red-50 border-2 border-orange-400 rounded-lg p-3 min-h-10 flex items-center justify-center">
                        <div className="text-center">
                          <p className="text-2xl font-black text-orange-900">
                            {(
                              parseFloat(formData.rent || 0) +
                              (formData.utilities?.reduce(
                                (sum, u) => sum + (parseFloat(u.unitCharge) || 0),
                                0
                              ) || 0)
                            ).toFixed(2)}
                          </p>
                          <p className="text-xs text-orange-700 mt-0.5">Rent + Utilities</p>
                        </div>
                      </div>
                    </div>

                    <div className="md:col-span-4 md:col-start-1">
                      <label className={labelClass}>
                        Payment Method <span className="text-red-500">*</span>
                      </label>
                      <select
                        name="paymentMethod"
                        value={formData.paymentMethod}
                        onChange={handleInputChange}
                        className={`${inputClass} ${fieldErrors.paymentMethod ? "border-red-500" : ""}`}
                      >
                        <option value="">Select Payment Method</option>
                        <option value="bank_transfer">Bank Transfer</option>
                        <option value="mobile_money">Mobile Money</option>
                        <option value="cash">Cash</option>
                        <option value="check">Check</option>
                        <option value="credit_card">Credit Card</option>
                      </select>
                      {fieldErrors.paymentMethod && (
                        <p className="mt-1 text-xs text-red-600">{fieldErrors.paymentMethod}</p>
                      )}
                    </div>

                    <div className="md:col-span-2">
                      <label className={labelClass}>
                        Status <span className="text-red-500">*</span>
                      </label>
                      <select
                        name="status"
                        value={formData.status}
                        onChange={handleInputChange}
                        className={inputClass}
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
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
                    <div className="mt-4 bg-orange-50 border border-orange-200 rounded-lg p-4">
                      <div className="flex items-start gap-2">
                        <FaCalculator className="text-orange-600 mt-1" />
                        <div className="flex-1">
                          <h4 className="font-bold text-orange-900 text-sm mb-2">
                            Prorated Rent Calculation (First Month)
                          </h4>
                          <div className="text-xs text-orange-800 space-y-1">
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
                            <p className="pt-1 border-t border-orange-300">
                              <span className="font-bold text-orange-900">
                                First month bill: Ksh {proratedInfo.proratedAmount.toFixed(2)}
                              </span>
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="bg-gradient-to-br from-blue-50 via-purple-50 to-indigo-50 border-2 border-dashed border-indigo-300 rounded-xl p-6 space-y-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-bold text-indigo-900 flex items-center gap-2">
                        ➕ Additional Utilities (Optional)
                      </h3>
                      <p className="text-xs text-indigo-700 mt-1">
                        Add utilities not included in the unit.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={addAdditionalUtility}
                      className="h-10 px-4 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg flex items-center gap-2 transition-all shadow-sm hover:shadow-md"
                    >
                      <FaPlus /> Add Utility
                    </button>
                  </div>

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
                              disabled={loading}
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
                                  className="rounded border-slate-300 text-orange-600 focus:ring-orange-500"
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
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 mb-4 border-b-2 border-purple-500 pb-2">
                    🚨 Emergency Contact
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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

              <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="w-full sm:w-auto h-10 px-4 rounded-md border border-slate-300 bg-white text-slate-700 text-sm font-semibold shadow-sm hover:bg-slate-100 flex items-center justify-center gap-2"
                >
                  <FaTimes /> Cancel
                </button>

                <button
                  type="submit"
                  disabled={loading}
                  className={`w-full sm:w-auto h-10 px-5 rounded-md text-white text-sm font-semibold shadow-sm flex items-center justify-center gap-2 transition-colors ${
                    loading
                      ? "bg-slate-400 cursor-not-allowed"
                      : `${MILIK_GREEN_BG} ${MILIK_GREEN_BG_HOVER}`
                  }`}
                >
                  {loading ? (
                    <>
                      <FaSpinner className="animate-spin" /> Saving...
                    </>
                  ) : (
                    <>
                      <FaSave /> Save Tenant
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {showInvoicePrompt && pendingInvoiceContext ? (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-2xl overflow-hidden shadow-2xl border border-slate-200 bg-white">
            <div className={`px-6 py-4 ${MILIK_GREEN_BG} text-white`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold tracking-tight">Create tenant invoice now?</h2>
                  <p className="text-sm text-white/80 mt-1">
                    {pendingInvoiceContext.tenant?.name || formData.name} has been saved successfully.
                  </p>
                </div>
                <div className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
                  MILIK
                </div>
              </div>
            </div>

            <div className="px-6 py-5 space-y-4">
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
                  <label className={`rounded-xl border px-4 py-3 cursor-pointer ${openingInvoiceMode === "separate" ? "border-orange-500 bg-orange-50" : "border-slate-200 bg-white"}`}>
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
                  <label className={`rounded-xl border px-4 py-3 cursor-pointer ${openingInvoiceMode === "combined" ? "border-orange-500 bg-orange-50" : "border-slate-200 bg-white"}`}>
                    <input
                      type="radio"
                      name="openingInvoiceMode"
                      value="combined"
                      checked={openingInvoiceMode === "combined"}
                      onChange={(e) => setOpeningInvoiceMode(e.target.value)}
                      className="sr-only"
                    />
                    <p className="font-semibold text-slate-900">Combined</p>
                    <p className="text-xs text-slate-500 mt-1">Combine rent and utilities into one opening rent invoice. Deposit stays separate.</p>
                  </label>
                </div>
              </div>

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
                <div className="px-4 py-3 bg-orange-50 border-t border-orange-100 flex items-center justify-between">
                  <span className="font-semibold text-slate-900">Total opening invoice amount</span>
                  <span className="text-lg font-bold text-slate-900">
                    KES {pendingInvoiceContext.items.reduce((sum, item) => sum + Number(item.amount || 0), 0).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row gap-3 justify-end">
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