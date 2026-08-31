import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  selectCurrentUser,
  selectCurrentCompany,
  selectAllUnits,
  selectAllProperties,
} from "../../redux/selectors";
import { selectCompanySettings } from "../../redux/companySettingsRedux";
import { createTenantInvoice } from "../../redux/invoiceApi";
import { getChartOfAccounts } from "../../redux/apiCalls";
import {
  buildTaxPreviewForComponents,
  getActiveTaxCodes,
  getTaxCodeLabel,
  normalizeCompanyTaxConfig,
  resolveTaxSelectionPayload,
} from "./invoiceTaxUtils";
import AppSelect from "../../components/common/AppSelect";
import { useTerms } from "../../hooks/useTerm";
import { useInvoicePricing } from "./useInvoicePricing";
import {
  MONTH_OPTIONS,
  INVOICE_REVENUE_ACCOUNT_MAP,
  normalizeBillingMode,
  getBillingModeLabel,
  createBookingGroupId,
  resolveBookingAmountsForMode,
  buildCombinedInvoiceMetadata,
  buildUtilityInvoiceMetadata,
  buildScaledBreakdown,
  buildBookingMetadata,
  hasBlockingInvoiceForRequest,
  buildRecurringInvoiceDescription,
  buildUtilityChargeDescription,
  isFutureBillingPeriod,
  clampBillingPeriod,
  getStartOfPeriod,
  getDueDateForPeriod,
  getDaysInMonth,
  normalizeDueDay,
  formatPeriodLabel,
  formatDateDisplay,
  getTenantDisplayName,
  getBookingTaxSelection,
  resolveBookingDateOverride,
} from "./invoiceBookingUtils";

const BOOKABLE_STATUSES = new Set(["active", "overdue"]);

const getUnitDisplayName = (tenant) => {
  const units = Array.isArray(tenant?.additionalUnits) ? tenant.additionalUnits : [];
  const names = [
    tenant?.unit?.unitName || tenant?.unit?.name || tenant?.unit?.unitNumber || tenant?.unitName || "",
    ...units.map((u) => u?.unitName || u?.name || u?.unitNumber || ""),
  ].filter(Boolean);
  return names.length ? names.join(", ") : "N/A";
};

const resolveTenantPropertyName = (tenant, unitsFromStore = [], propertiesFromStore = []) => {
  const directName =
    tenant?.unit?.property?.propertyName ||
    tenant?.property?.propertyName ||
    tenant?.propertyName;
  if (directName) return directName;

  const tenantUnitIdStr = String(tenant?.unit?._id || tenant?.unit || "");
  const matchedUnit = unitsFromStore.find((u) => String(u?._id || "") === tenantUnitIdStr);
  const propertyId = String(
    matchedUnit?.property?._id || matchedUnit?.property || tenant?.property?._id || tenant?.property || ""
  );
  const matchedProperty = propertiesFromStore.find((p) => String(p?._id || "") === propertyId);
  return (
    matchedUnit?.property?.propertyName ||
    matchedProperty?.propertyName ||
    matchedProperty?.name ||
    "N/A"
  );
};

const formatTenantOptionLabel = (opt) => {
  if (!opt) return "";
  const code = opt.tenantCode ? ` · ${opt.tenantCode}` : "";
  return `${opt.name}${code} - ${opt.propertyName} (${opt.unitName})`;
};

/**
 * Shared single-booking modal used from both RentalInvoices and TenantStatement.
 *
 * Props:
 *  - isOpen / onClose / onSuccess
 *  - tenants[]            - for tenant dropdown (pass [] in locked mode)
 *  - activeProperties[]   - for property filter
 *  - leases[]             - for pricing resolution (pass [] if unavailable)
 *  - companyBillingPeriods[] - from company settings
 *  - companyTaxConfig     - raw company tax config from Redux
 *  - existingInvoices[]   - current tenant invoices (for duplicate detection)
 *  - lockedTenant         - (optional) pre-fill and lock the tenant
 *  - lockedMonth          - (optional) pre-fill month (0-based)
 *  - lockedYear           - (optional) pre-fill year
 *  - initialTenantId      - (optional) pre-select tenant by _id in dropdown mode
 */
const SingleBookingModal = ({
  isOpen,
  onClose,
  onSuccess,
  tenants = [],
  activeProperties = [],
  leases = [],
  companyBillingPeriods = [],
  companyTaxConfig = null,
  existingInvoices = [],
  lockedTenant = null,
  lockedMonth = null,
  lockedYear = null,
  initialTenantId = "",
}) => {
  const { tenant: termTenant, unit: termUnit, property: termProperty, rent: termRent } = useTerms("tenant", "unit", "property", "rent");
  const currentUser = useSelector(selectCurrentUser);
  const currentCompany = useSelector(selectCurrentCompany);
  const unitsFromStore = useSelector(selectAllUnits);
  const propertiesFromStore = useSelector(selectAllProperties);
  const storedSettings = useSelector(selectCompanySettings);

  const normalizedTaxConfig = useMemo(
    () => normalizeCompanyTaxConfig(companyTaxConfig ?? storedSettings ?? null),
    [companyTaxConfig, storedSettings]
  );
  const activeTaxCodes = useMemo(() => getActiveTaxCodes(normalizedTaxConfig), [normalizedTaxConfig]);
  const taxCodeOptions = useMemo(
    () => activeTaxCodes.map((c) => ({ value: c.key, label: `${c.name} (${Number(c.rate || 0)}%)` })),
    [activeTaxCodes]
  );
  const companyTaxEnabled = Boolean(normalizedTaxConfig?.taxSettings?.enabled);

  // Derive current booking year fresh each time the modal mounts (not a stale module constant).
  const currentBookingYear = useMemo(() => new Date().getFullYear(), []);

  // O(1) unit and property lookups used in buildInvoicePayload.
  const unitMap = useMemo(() => {
    const m = new Map();
    (Array.isArray(unitsFromStore) ? unitsFromStore : []).forEach((u) => { if (u?._id) m.set(String(u._id), u); });
    return m;
  }, [unitsFromStore]);

  const propertyMap = useMemo(() => {
    const m = new Map();
    (Array.isArray(propertiesFromStore) ? propertiesFromStore : []).forEach((p) => { if (p?._id) m.set(String(p._id), p); });
    return m;
  }, [propertiesFromStore]);

  const [invoiceRevenueAccounts, setInvoiceRevenueAccounts] = useState([]);
  const coaLoadedForCompany = useRef(null);
  useEffect(() => {
    if (!currentCompany?._id || !isOpen) return;
    if (coaLoadedForCompany.current === currentCompany._id) return;
    (async () => {
      try {
        const result = await getChartOfAccounts(currentCompany._id);
        const accounts = Array.isArray(result?.data) ? result.data : [];
        setInvoiceRevenueAccounts(
          accounts.filter((a) => ["4100", "4102"].some((c) => String(a?.code || "") === c))
        );
        coaLoadedForCompany.current = currentCompany._id;
      } catch {}
    })();
  }, [currentCompany?._id, isOpen]);

  const findRevenueAccountId = useCallback(
    (type) => {
      const typeLower = String(type || "rent").toLowerCase();
      const exactCode =
        typeLower === "utility"
          ? invoiceRevenueAccounts.find((acc) => String(acc?.code || "") === "4102")
          : invoiceRevenueAccounts.find((acc) => String(acc?.code || "") === "4100");
      if (exactCode?._id) return exactCode._id;
      const byName =
        typeLower === "utility"
          ? invoiceRevenueAccounts.find((acc) => String(acc?.name || "").toLowerCase().includes("utility"))
          : invoiceRevenueAccounts.find((acc) => String(acc?.name || "").toLowerCase().includes("rent"));
      return byName?._id || null;
    },
    [invoiceRevenueAccounts]
  );

  // ─── Pricing hook ─────────────────────────────────────────────────────────────
  const { getTenantPricing, getTenantPricingForBookingPeriod, resolveTenantBookingPeriod } = useInvoicePricing({
    units: unitsFromStore,
    leases,
    companyBillingPeriods,
  });

  // ─── Form state ───────────────────────────────────────────────────────────────
  const isLocked = Boolean(lockedTenant);

  const getInitialForm = useCallback(() => {
    const now = new Date();
    const { month, year } = clampBillingPeriod(
      lockedMonth ?? now.getMonth(),
      lockedYear ?? now.getFullYear()
    );
    return {
      tenantId: lockedTenant?._id || initialTenantId || "",
      month,
      year,
      dueDay: 5,
      billingMode: "separate",
      invoiceDate: getStartOfPeriod(month, year),
      bookWithInvoiceDate: false,
      taxHandling: "company_default",
      taxCodeKey: normalizedTaxConfig?.taxSettings?.defaultTaxCodeKey || "vat_standard",
      taxMode: "company_default",
    };
  }, [lockedTenant, lockedMonth, lockedYear, initialTenantId, normalizedTaxConfig]);

  const [form, setForm] = useState(getInitialForm);
  const [propertyFilter, setPropertyFilter] = useState("all");
  const [tenantSearch, setTenantSearch] = useState("");
  const [tenantDropdownOpen, setTenantDropdownOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Reset form whenever the modal opens
  useEffect(() => {
    if (isOpen) {
      setForm(getInitialForm());
      setPropertyFilter("all");
      setTenantSearch("");
      setTenantDropdownOpen(false);
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep period clamped when month/year would be future
  const prevPeriodRef = useRef({ month: form.month, year: form.year });
  useEffect(() => {
    if (isFutureBillingPeriod(form.month, form.year)) {
      const prev = prevPeriodRef.current;
      if (!isFutureBillingPeriod(prev.month, prev.year)) {
        setForm((f) => ({ ...f, month: prev.month, year: prev.year }));
      }
    } else {
      prevPeriodRef.current = { month: form.month, year: form.year };
    }
  }, [form.month, form.year]);

  // ─── Derived tenant list ──────────────────────────────────────────────────────
  const tenantLookup = useMemo(() => {
    const m = {};
    tenants.forEach((t) => { if (t?._id) m[String(t._id)] = t; });
    if (lockedTenant?._id) m[String(lockedTenant._id)] = lockedTenant;
    return m;
  }, [tenants, lockedTenant]);

  const propertyOptions = useMemo(
    () => [
      { value: "all", label: "All active properties" },
      ...activeProperties.map((p) => ({ value: p._id, label: p.propertyName || p.name })),
    ],
    [activeProperties]
  );

  const tenantOptions = useMemo(() => {
    if (isLocked) return [];
    const normalizedSearch = String(tenantSearch || "").trim().toLowerCase();

    const mapped = tenants
      .filter((t) => {
        if (!BOOKABLE_STATUSES.has(String(t?.status || "active").toLowerCase())) return false;
        if (propertyFilter !== "all") {
          const propId = String(t?.property?._id || t?.property || t?.unit?.property?._id || t?.unit?.property || "");
          if (propId !== String(propertyFilter)) return false;
        }
        return true;
      })
      .map((t) => ({
        id: t._id,
        name: getTenantDisplayName(t),
        tenantCode: t?.tenantCode || t?.code || t?.tenantNo || "",
        propertyName: resolveTenantPropertyName(t, unitsFromStore, propertiesFromStore),
        unitName: getUnitDisplayName(t),
      }));

    const filtered = normalizedSearch
      ? mapped.filter((o) =>
          `${o.name} ${o.tenantCode} ${o.propertyName} ${o.unitName}`.toLowerCase().includes(normalizedSearch)
        )
      : mapped;

    return filtered.sort((a, b) => a.name.localeCompare(b.name));
  }, [tenants, isLocked, tenantSearch, propertyFilter, unitsFromStore, propertiesFromStore]);

  const selectedTenant = useMemo(
    () => (lockedTenant ? lockedTenant : tenantLookup[form.tenantId] || null),
    [lockedTenant, tenantLookup, form.tenantId]
  );

  const selectedTenantOption = useMemo(() => {
    if (!form.tenantId) return null;
    const t = tenantLookup[form.tenantId];
    if (!t) return null;
    return {
      id: t._id,
      name: getTenantDisplayName(t),
      tenantCode: t?.tenantCode || t?.code || t?.tenantNo || "",
      propertyName: resolveTenantPropertyName(t, unitsFromStore, propertiesFromStore),
      unitName: getUnitDisplayName(t),
    };
  }, [form.tenantId, tenantLookup, unitsFromStore, propertiesFromStore]);

  // ─── Live preview ─────────────────────────────────────────────────────────────
  const preview = useMemo(() => {
    if (!selectedTenant) return null;
    const pricing = getTenantPricingForBookingPeriod(selectedTenant, Number(form.month), Number(form.year));
    const bookingAmounts = resolveBookingAmountsForMode({
      rentAmount: pricing.rentAmount,
      utilityAmount: pricing.utilityAmount,
      billingMode: form.billingMode,
    });
    return {
      periodLabel: formatPeriodLabel(Number(form.month), Number(form.year)),
      rentAmount: pricing.rentAmount,
      utilityAmount: pricing.utilityAmount,
      selectedRentAmount: bookingAmounts.rentAmount,
      selectedUtilityAmount: bookingAmounts.utilityAmount,
      selectedTotalAmount: bookingAmounts.totalAmount,
      propertyName: resolveTenantPropertyName(selectedTenant, unitsFromStore, propertiesFromStore),
      unitName: getUnitDisplayName(selectedTenant),
    };
  }, [selectedTenant, form.billingMode, form.month, form.year, unitsFromStore, propertiesFromStore, getTenantPricingForBookingPeriod]);

  const taxPreview = useMemo(() => {
    if (!preview) return null;
    const components = [
      preview.selectedRentAmount > 0 ? { category: "RENT_CHARGE", amount: preview.selectedRentAmount } : null,
      preview.selectedUtilityAmount > 0 ? { category: "UTILITY_CHARGE", amount: preview.selectedUtilityAmount } : null,
    ].filter(Boolean);
    return buildTaxPreviewForComponents({
      components,
      companyTaxConfig: normalizedTaxConfig,
      selection: getBookingTaxSelection(form),
    });
  }, [preview, normalizedTaxConfig, form.taxHandling, form.taxCodeKey, form.taxMode]);

  // ─── Invoice creation logic ───────────────────────────────────────────────────
  const buildInvoicePayload = useCallback(
    ({ targetTenant, amount, paymentType, month, year, dueDay, description, metadata, taxSelection, bookingDateOverride, bookingGroupId, billingMode }) => {
      const numericAmount = Number(amount || 0);
      if (!targetTenant?._id || !targetTenant?.unit || numericAmount <= 0) throw new Error("Invalid invoice payload");

      const revenueAccountId = findRevenueAccountId(paymentType);
      if (!revenueAccountId) {
        const fallback = INVOICE_REVENUE_ACCOUNT_MAP[paymentType === "utility" ? "utility" : "rent"];
        // proceed without account ID if not found — backend will resolve
        void fallback;
      }

      const unitId =
        targetTenant?.invoiceUnit?._id || targetTenant?.invoiceUnit ||
        targetTenant?.unit?._id || targetTenant?.unit || null;

      const matchedUnit = unitMap.get(String(unitId || "")) || null;

      const propertyId =
        targetTenant?.property?._id || targetTenant?.property ||
        matchedUnit?.property?._id || matchedUnit?.property ||
        targetTenant?.unit?.property?._id || targetTenant?.unit?.property || null;

      const matchedProperty = propertyMap.get(String(propertyId || "")) || null;

      const landlordId =
        matchedProperty?.landlords?.[0]?.landlordId?._id ||
        matchedProperty?.landlords?.[0]?.landlordId ||
        matchedProperty?.landlords?.[0]?._id ||
        matchedProperty?.landlords?.[0] ||
        targetTenant?.landlord?._id || targetTenant?.landlord || null;

      const businessId = targetTenant?.business?._id || targetTenant?.business || currentCompany?._id || null;
      const createdBy = currentUser?._id || null;

      if (!businessId) throw new Error("Missing business context.");
      if (!propertyId) throw new Error("Missing property on tenant.");
      if (!landlordId) throw new Error("Missing landlord on property.");
      if (!unitId) throw new Error("Missing unit on tenant.");
      if (!createdBy) throw new Error("Missing user context.");

      const bookingPeriodContext =
        targetTenant?.bookingPeriodContext && typeof targetTenant.bookingPeriodContext === "object"
          ? targetTenant.bookingPeriodContext
          : null;

      const resolvedBillingPeriodDate =
        bookingPeriodContext?.fromDate || targetTenant?.invoiceDateOverride || getStartOfPeriod(month, year);
      const resolvedBookingDate =
        bookingDateOverride || targetTenant?.bookingDateOverride ||
        bookingPeriodContext?.fromDate || resolvedBillingPeriodDate;
      const resolvedDueDate = bookingPeriodContext?.dueDate || getDueDateForPeriod(month, year, dueDay);

      return {
        business: businessId,
        property: propertyId,
        landlord: landlordId,
        tenant: targetTenant._id,
        unit: unitId,
        category: paymentType === "utility" ? "UTILITY_CHARGE" : "RENT_CHARGE",
        amount: numericAmount,
        description,
        invoiceDate: resolvedBillingPeriodDate,
        bookingDate: resolvedBookingDate,
        dueDate: resolvedDueDate,
        createdBy,
        ...(revenueAccountId ? { chartAccountId: revenueAccountId } : {}),
        metadata: buildBookingMetadata({
          metadata:
            metadata && typeof metadata === "object"
              ? {
                  ...metadata,
                  ...(bookingPeriodContext?.periodKey
                    ? {
                        periodKey: bookingPeriodContext.periodKey,
                        billingPeriodKey: bookingPeriodContext.billingPeriodKey,
                        billingPeriodLabel: bookingPeriodContext.billingPeriodLabel,
                        periodStartDate: bookingPeriodContext.fromDate,
                        periodEndDate: bookingPeriodContext.toDate,
                      }
                    : {}),
                  ...(bookingDateOverride ? { bookWithBookingDate: true } : {}),
                }
              : bookingDateOverride || bookingPeriodContext?.periodKey
              ? {
                  ...(bookingDateOverride ? { bookWithBookingDate: true } : {}),
                  ...(bookingPeriodContext?.periodKey
                    ? {
                        periodKey: bookingPeriodContext.periodKey,
                        billingPeriodKey: bookingPeriodContext.billingPeriodKey,
                        billingPeriodLabel: bookingPeriodContext.billingPeriodLabel,
                        periodStartDate: bookingPeriodContext.fromDate,
                        periodEndDate: bookingPeriodContext.toDate,
                      }
                    : {}),
                }
              : undefined,
          bookingGroupId,
          billingMode,
        }),
        ...resolveTaxSelectionPayload(taxSelection, normalizedTaxConfig),
      };
    },
    [findRevenueAccountId, unitMap, propertyMap, currentCompany, currentUser, normalizedTaxConfig]
  );

  const createBackendEntry = useCallback(
    async (args) => {
      const payload = buildInvoicePayload(args);
      return await createTenantInvoice(payload);
    },
    [buildInvoicePayload]
  );

  const createForTenant = useCallback(
    async (targetTenant, month, year, dueDay = 5, billingMode = "combined", taxSelection = null, bookingDateOverride = null, bookingGroupId = "") => {
      if (!targetTenant?._id) return { created: false, reason: "Invalid tenant" };

      const normalizedMode = normalizeBillingMode(billingMode);
      const effectiveGroupId = bookingGroupId || createBookingGroupId();
      const periodLabel = formatPeriodLabel(month, year);
      const pricing = getTenantPricing(targetTenant);
      const unitContexts = pricing.unitContexts || [];
      const createdInvoiceIds = [];
      let encounteredBlockingInvoice = false;
      let encounteredOutOfCyclePeriod = false;

      if (!unitContexts.length) return { created: false, reason: "No assigned unit was found for this tenant" };

      for (const unitContext of unitContexts) {
        const bookingPeriodContext = resolveTenantBookingPeriod({ tenant: targetTenant, unitContext, month, year });
        if (!bookingPeriodContext?.allowed) { encounteredOutOfCyclePeriod = true; continue; }

        const bookingAmounts = resolveBookingAmountsForMode({
          rentAmount: bookingPeriodContext.rentAmount,
          utilityAmount: bookingPeriodContext.utilityAmount,
          billingMode: normalizedMode,
        });
        const rentAmount = Number(bookingAmounts.rentAmount || 0);
        const utilityAmount = Number(bookingAmounts.utilityAmount || 0);
        const utilityLabel =
          Array.isArray(bookingPeriodContext?.utilityNames) && bookingPeriodContext.utilityNames.length === 1
            ? bookingPeriodContext.utilityNames[0]
            : unitContext.utilityLabel;
        const utilityMetadata = buildUtilityInvoiceMetadata(utilityLabel);

        const targetTenantForUnit = {
          ...targetTenant,
          invoiceUnit: unitContext.unit,
          bookingDateOverride: bookingDateOverride || bookingPeriodContext.fromDate || getStartOfPeriod(month, year),
          invoiceDateOverride: bookingPeriodContext.fromDate || getStartOfPeriod(month, year),
          bookingPeriodContext: {
            periodKey: bookingPeriodContext.periodKey,
            billingPeriodKey: bookingPeriodContext.billingPeriod.key,
            billingPeriodLabel: bookingPeriodContext.billingPeriod.name,
            fromDate: bookingPeriodContext.fromDate,
            toDate: bookingPeriodContext.toDate,
            dueDate: bookingPeriodContext.dueDate,
          },
        };

        if (rentAmount <= 0 && utilityAmount <= 0) continue;

        const billableRows = unitContext.billableUtilityRows || [];
        const rentDesc = buildRecurringInvoiceDescription({ month, year, label: `Rent - ${unitContext.unitName}` });
        const sharedArgs = {
          targetTenant: targetTenantForUnit, month, year, dueDay, taxSelection,
          bookingDateOverride, bookingGroupId: effectiveGroupId, billingMode: normalizedMode,
        };

        if (normalizedMode === "combined" && rentAmount > 0 && utilityAmount > 0) {
          const combinedBlocked = hasBlockingInvoiceForRequest({
            invoices: existingInvoices, tenantId: targetTenant._id, unitId: unitContext.unitId,
            month, year, category: "RENT_CHARGE", periodKey: bookingPeriodContext.periodKey,
          });
          if (combinedBlocked) { encounteredBlockingInvoice = true; continue; }
          const created = await createBackendEntry({
            ...sharedArgs, amount: rentAmount + utilityAmount, paymentType: "rent",
            description: rentDesc, metadata: buildCombinedInvoiceMetadata(billableRows, utilityAmount, utilityLabel),
          });
          createdInvoiceIds.push(created?.invoiceNumber || "AUTO");
          continue;
        }

        const rentBlocked = rentAmount > 0 && hasBlockingInvoiceForRequest({
          invoices: existingInvoices, tenantId: targetTenant._id, unitId: unitContext.unitId,
          month, year, category: "RENT_CHARGE", periodKey: bookingPeriodContext.periodKey,
        });

        if (billableRows.length > 1) {
          if (rentBlocked) encounteredBlockingInvoice = true;
          for (const row of buildScaledBreakdown(billableRows, utilityAmount)) {
            const rowMeta = buildUtilityInvoiceMetadata(row.label);
            const rowBlocked = hasBlockingInvoiceForRequest({
              invoices: existingInvoices, tenantId: targetTenant._id, unitId: unitContext.unitId,
              month, year, category: "UTILITY_CHARGE", metadata: rowMeta, periodKey: bookingPeriodContext.periodKey,
            });
            if (rowBlocked) { encounteredBlockingInvoice = true; continue; }
            const inv = await createBackendEntry({
              ...sharedArgs, amount: row.amount, paymentType: "utility",
              description: buildUtilityChargeDescription({ utilityLabel: row.label, month, year }),
              metadata: rowMeta,
            });
            createdInvoiceIds.push(inv?.invoiceNumber || "AUTO");
          }
        } else {
          const utilityBlocked = utilityAmount > 0 && hasBlockingInvoiceForRequest({
            invoices: existingInvoices, tenantId: targetTenant._id, unitId: unitContext.unitId,
            month, year, category: "UTILITY_CHARGE", metadata: utilityMetadata, periodKey: bookingPeriodContext.periodKey,
          });
          if (rentBlocked || utilityBlocked) encounteredBlockingInvoice = true;
          if (utilityAmount > 0 && !utilityBlocked) {
            const inv = await createBackendEntry({
              ...sharedArgs, amount: utilityAmount, paymentType: "utility",
              description: buildUtilityChargeDescription({ utilityLabel: utilityLabel || "Utility", month, year }),
              metadata: utilityMetadata,
            });
            createdInvoiceIds.push(inv?.invoiceNumber || "AUTO");
          }
        }

        if (rentAmount > 0 && !rentBlocked) {
          const inv = await createBackendEntry({ ...sharedArgs, amount: rentAmount, paymentType: "rent", description: rentDesc });
          createdInvoiceIds.push(inv?.invoiceNumber || "AUTO");
        }
      }

      if (createdInvoiceIds.length === 0 && encounteredBlockingInvoice) {
        return { created: false, reason: "already_exists", periodLabel };
      }
      if (createdInvoiceIds.length === 0 && encounteredOutOfCyclePeriod) {
        return { created: false, reason: "Selected period is not a scheduled billing start for this tenant." };
      }
      return { created: createdInvoiceIds.length > 0, invoiceIds: createdInvoiceIds, periodLabel };
    },
    [getTenantPricing, resolveTenantBookingPeriod, existingInvoices, createBackendEntry]
  );

  // ─── Submit ───────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    if (!selectedTenant) { toast.error("Please select a tenant"); return; }
    if (isFutureBillingPeriod(form.month, form.year)) {
      toast.error("Future invoicing is disabled. Select the current month or an earlier period.");
      return;
    }

    const pricing = getTenantPricingForBookingPeriod(selectedTenant, Number(form.month), Number(form.year));
    const selectedAmounts = resolveBookingAmountsForMode({
      rentAmount: pricing.rentAmount,
      utilityAmount: pricing.utilityAmount,
      billingMode: form.billingMode,
    });
    if (selectedAmounts.totalAmount <= 0) {
      toast.error(`No billable ${getBillingModeLabel(form.billingMode).toLowerCase()} amount for this tenant`);
      return;
    }

    const bookingGroupId = createBookingGroupId();
    setSubmitting(true);
    try {
      const result = await createForTenant(
        selectedTenant,
        Number(form.month),
        Number(form.year),
        Number(form.dueDay || 5),
        form.billingMode,
        getBookingTaxSelection(form),
        resolveBookingDateOverride(form),
        bookingGroupId
      );

      if (!result.created && result.reason === "already_exists") {
        toast.info(`Invoice for ${result.periodLabel} already exists for this tenant`);
        return;
      }
      if (!result.created) {
        toast.error(result.reason || "Failed to create booking");
        return;
      }

      toast.success(`Booked ${result.invoiceIds.join(", ")} for ${getTenantDisplayName(selectedTenant)}`);
      window.dispatchEvent(new Event("invoicesUpdated"));
      onSuccess?.();
      onClose?.();
    } catch (error) {
      toast.error(
        error?.response?.data?.error ||
          error?.response?.data?.message ||
          error?.message ||
          "Failed to create invoice"
      );
    } finally {
      setSubmitting(false);
    }
  }, [submitting, selectedTenant, form, getTenantPricingForBookingPeriod, createForTenant, onSuccess, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
      <div className="flex w-full max-w-3xl flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
          <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide">
            Single Tenant Booking
          </h3>
          <button
            onClick={onClose}
            className="text-white/70 transition-colors hover:text-white"
          >
            Close
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto bg-white px-5 py-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">

            {/* Property filter — hidden in locked mode */}
            {!isLocked && (
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">
                  Property Filter
                </label>
                <AppSelect
                  value={propertyFilter}
                  onChange={(v) => {
                    setPropertyFilter(v ?? "all");
                    setTenantSearch("");
                    setTenantDropdownOpen(false);
                    setForm((prev) => ({ ...prev, tenantId: "" }));
                  }}
                  options={propertyOptions}
                  searchable
                  size="md"
                />
              </div>
            )}

            {/* Tenant selector — locked shows read-only, unlocked shows dropdown */}
            {isLocked ? (
              <div className="md:col-span-3">
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">{termTenant}</label>
                <div className="w-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
                  {getTenantDisplayName(lockedTenant)}
                  {lockedTenant?.tenantCode ? ` · ${lockedTenant.tenantCode}` : ""}
                  <span className="ml-2 text-slate-400 font-normal">
                    {resolveTenantPropertyName(lockedTenant, unitsFromStore, propertiesFromStore)} · {getUnitDisplayName(lockedTenant)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="relative md:col-span-2">
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">{termTenant}</label>
                <input
                  type="text"
                  value={tenantSearch || formatTenantOptionLabel(selectedTenantOption)}
                  onFocus={() => setTenantDropdownOpen(true)}
                  onChange={(e) => {
                    setTenantSearch(e.target.value);
                    setTenantDropdownOpen(true);
                    setForm((prev) => ({ ...prev, tenantId: "" }));
                  }}
                  placeholder="Type tenant name, code, unit, or property…"
                  className="w-full px-3 py-2 pr-9 text-sm border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                />
                <button
                  type="button"
                  onClick={() => setTenantDropdownOpen((o) => !o)}
                  className="absolute right-2 top-[29px] rounded px-2 py-1 text-xs font-black text-slate-500 hover:bg-slate-100"
                  aria-label="Toggle tenant list"
                >
                  ▾
                </button>
                {tenantDropdownOpen && (
                  <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border border-slate-300 bg-white shadow-xl">
                    {tenantOptions.length > 0 ? (
                      tenantOptions.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setForm((prev) => ({ ...prev, tenantId: opt.id }));
                            setTenantSearch(formatTenantOptionLabel(opt));
                            setTenantDropdownOpen(false);
                          }}
                          className={`block w-full border-b border-slate-100 px-3 py-2 text-left text-xs transition last:border-b-0 hover:bg-[#0B3B2E]/5 ${
                            String(form.tenantId) === String(opt.id) ? "bg-[#0B3B2E]/10" : "bg-white"
                          }`}
                        >
                          <span className="block font-black text-slate-900">
                            {opt.name}{opt.tenantCode ? ` · ${opt.tenantCode}` : ""}
                          </span>
                          <span className="mt-0.5 block text-[11px] font-semibold text-slate-500">
                            {opt.propertyName} · {opt.unitName}
                          </span>
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-xs font-semibold text-slate-500">No matching tenants found.</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {!isLocked && (
              <div className="md:col-span-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-600">
                Showing {tenantOptions.length.toLocaleString()} active tenant{tenantOptions.length === 1 ? "" : "s"}.
              </div>
            )}

            {/* Period */}
            <div>
              <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Period</label>
              <AppSelect
                value={form.month}
                onChange={(v) =>
                  setForm((prev) => {
                    const next = clampBillingPeriod(Number(v), prev.year);
                    return { ...prev, month: next.month, year: next.year };
                  })
                }
                options={MONTH_OPTIONS.filter((o) => !isFutureBillingPeriod(o.value, Number(form.year))).map((o) => ({
                  value: o.value,
                  label: o.label,
                }))}
                disabled={isLocked && lockedMonth !== null}
                size="md"
              />
            </div>

            {/* Year */}
            <div>
              <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Year</label>
              <input
                type="number"
                min="2000"
                max={currentBookingYear}
                value={form.year}
                onChange={(e) =>
                  setForm((prev) => {
                    const nextYear = Math.min(Number(e.target.value) || currentBookingYear, currentBookingYear);
                    const next = clampBillingPeriod(prev.month, nextYear);
                    return { ...prev, month: next.month, year: next.year };
                  })
                }
                disabled={isLocked && lockedYear !== null}
                className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20 disabled:bg-slate-100"
              />
            </div>

            {/* Booking date */}
            <div>
              <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Booking Date</label>
              <input
                type="date"
                value={form.invoiceDate ? new Date(form.invoiceDate).toISOString().slice(0, 10) : ""}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    invoiceDate: e.target.value ? new Date(e.target.value) : prev.invoiceDate,
                    bookWithInvoiceDate: true,
                  }))
                }
                className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
              />
              <label className="mt-2 flex items-center gap-2 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={Boolean(form.bookWithInvoiceDate)}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      bookWithInvoiceDate: e.target.checked,
                      invoiceDate: e.target.checked ? prev.invoiceDate : getStartOfPeriod(prev.month, prev.year),
                    }))
                  }
                />
                Book with booking date
              </label>
            </div>

            {/* Due day */}
            <div>
              <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Due Day</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max={getDaysInMonth(Number(form.month), Number(form.year))}
                  value={form.dueDay}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, dueDay: normalizeDueDay(e.target.value, prev.month, prev.year) }))
                  }
                  className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                />
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, dueDay: 5 }))}
                  className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Default 5th
                </button>
              </div>
            </div>

            {/* Billing option */}
            <div>
              <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Booking Option</label>
              <AppSelect
                value={form.billingMode}
                onChange={(v) => setForm((prev) => ({ ...prev, billingMode: v ?? "separate" }))}
                options={[
                  { value: "separate", label: "Rent + Utility (separate)" },
                  { value: "combined", label: "Rent + Utility (combined)" },
                  { value: "rent", label: "Rent only" },
                  { value: "utility", label: "Utility only" },
                ]}
                size="md"
              />
            </div>

            {/* Tax handling */}
            <div>
              <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Tax Handling</label>
              <AppSelect
                value={form.taxHandling}
                onChange={(v) => setForm((prev) => ({ ...prev, taxHandling: v ?? "company_default" }))}
                options={[
                  { value: "company_default", label: "Use company default" },
                  ...(companyTaxEnabled ? [{ value: "taxable", label: "Force taxable" }] : []),
                  { value: "non_taxable", label: "Force non-taxable" },
                ]}
                size="md"
              />
            </div>

            {/* Tax code */}
            <div>
              <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Tax Code</label>
              <AppSelect
                value={form.taxCodeKey}
                onChange={(v) => setForm((prev) => ({ ...prev, taxCodeKey: v ?? "vat_standard" }))}
                options={taxCodeOptions}
                disabled={form.taxHandling === "non_taxable"}
                size="md"
              />
            </div>

            {/* Tax mode */}
            <div>
              <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Tax Mode</label>
              <AppSelect
                value={form.taxMode}
                onChange={(v) => setForm((prev) => ({ ...prev, taxMode: v ?? "company_default" }))}
                options={[
                  { value: "company_default", label: "Use company default" },
                  { value: "exclusive", label: "Exclusive" },
                  { value: "inclusive", label: "Inclusive" },
                ]}
                disabled={form.taxHandling === "non_taxable"}
                size="md"
              />
            </div>
          </div>

          {/* Preview */}
          {preview && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-xs font-semibold text-emerald-800 mb-2">
                Booking Preview — {preview.periodLabel}
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <div>
                  <p className="text-slate-500">{termProperty}</p>
                  <p className="font-semibold text-slate-900">{preview.propertyName}</p>
                </div>
                <div>
                  <p className="text-slate-500">{termUnit}</p>
                  <p className="font-semibold text-slate-900">{preview.unitName}</p>
                </div>
                <div>
                  <p className="text-slate-500">{termRent}</p>
                  <p className="font-semibold text-slate-900">KES {preview.rentAmount.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-slate-500">Utility</p>
                  <p className="font-semibold text-slate-900">KES {preview.utilityAmount.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-slate-500">Booking Date</p>
                  <p className="font-semibold text-slate-900">
                    {formatDateDisplay(
                      form.bookWithInvoiceDate ? form.invoiceDate : getStartOfPeriod(Number(form.month), Number(form.year))
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Due Date</p>
                  <p className="font-semibold text-slate-900">
                    {formatDateDisplay(getDueDateForPeriod(Number(form.month), Number(form.year), Number(form.dueDay || 5)))}
                  </p>
                </div>
              </div>
              <p className="mt-2 text-sm font-bold text-[#0B3B2E]">
                Subtotal: KES {Number(preview.selectedTotalAmount || 0).toLocaleString()}
              </p>
              <p className="mt-1 text-sm font-semibold text-emerald-900">
                Estimated tax: KES {Number(taxPreview?.taxAmount || 0).toLocaleString()}
              </p>
              <p className="mt-1 text-sm font-bold text-[#0B3B2E]">
                Gross total: KES {Number(taxPreview?.grossAmount || preview.selectedTotalAmount || 0).toLocaleString()}
              </p>
              <p className="mt-1 text-[11px] text-emerald-800 font-semibold">
                Mode: {getBillingModeLabel(form.billingMode)}
              </p>
              <p className="mt-1 text-[11px] text-emerald-800 font-semibold">
                Tax:{" "}
                {form.taxHandling === "company_default"
                  ? "Company default"
                  : form.taxHandling === "non_taxable"
                  ? "Forced non-taxable"
                  : `${getTaxCodeLabel(form.taxCodeKey, normalizedTaxConfig)} (${form.taxMode === "company_default" ? "Company mode" : form.taxMode})`}
              </p>
              {!companyTaxEnabled && (
                <p className="mt-1 text-[11px] text-amber-700 font-semibold">
                  Company tax is currently disabled — backend posting will remain non-taxable until enabled.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold border border-slate-300 text-slate-700 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="bg-[#0B3B2E] px-4 py-2 text-xs font-black uppercase tracking-wide text-white hover:bg-[#0d5442] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Creating…" : "Create Booking"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SingleBookingModal;
