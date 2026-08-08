import { useCallback, useMemo } from "react";
import {
  canonicalBillingPeriodKey,
  addMonthsPreservingDay,
  buildSchedulePeriodKey,
  formatScheduleLabel,
  extractUtilityLabel,
  FALLBACK_BILLING_PERIOD_MONTHS,
} from "./invoiceBookingUtils";

/**
 * Shared hook for computing tenant invoice pricing and resolving billing periods.
 * Used by RentalInvoices (single + batch booking) and SingleBookingModal.
 *
 * @param {object[]} units  - all units from store
 * @param {object[]} leases - active leases (from store or local fetch)
 * @param {object[]} companyBillingPeriods - from company settings
 */
export function useInvoicePricing({ units = [], leases = [], companyBillingPeriods = [] }) {
  const unitLookupById = useMemo(() => {
    const m = new Map();
    (Array.isArray(units) ? units : []).forEach((u) => { if (u?._id) m.set(String(u._id), u); });
    return m;
  }, [units]);

  const normalizedBillingPeriods = useMemo(() => {
    const source =
      Array.isArray(companyBillingPeriods) && companyBillingPeriods.length > 0
        ? companyBillingPeriods
        : [{ key: "monthly", name: "Monthly", durationInMonths: 1, isActive: true }];
    const seen = new Set();
    const list = source
      .map((item) => ({
        key: canonicalBillingPeriodKey(item?.key || item?.name || "monthly"),
        name: String(item?.name || item?.label || item?.key || "Monthly").trim() || "Monthly",
        durationInMonths: Math.max(
          1,
          Number(item?.durationInMonths || FALLBACK_BILLING_PERIOD_MONTHS[canonicalBillingPeriodKey(item?.key || item?.name)] || 1)
        ),
        isActive: item?.isActive !== false,
      }))
      .filter((item) => {
        if (!item.key || seen.has(item.key)) return false;
        seen.add(item.key);
        return true;
      });
    const byKey = new Map(list.map((p) => [p.key, p]));
    return { list, byKey };
  }, [companyBillingPeriods]);

  const leaseLookup = useMemo(() => {
    const byTenant = new Map();
    const byTenantUnit = new Map();
    const activeLeases = (Array.isArray(leases) ? leases : [])
      .filter((lease) => ["active", "draft", "pending_signature"].includes(String(lease?.status || "").toLowerCase()))
      .sort((a, b) => new Date(b?.startDate || b?.createdAt || 0) - new Date(a?.startDate || a?.createdAt || 0));

    activeLeases.forEach((lease) => {
      const tenantKey = String(lease?.tenant?._id || lease?.tenant || "");
      const unitKey = String(lease?.unit?._id || lease?.unit || "");
      if (tenantKey && !byTenant.has(tenantKey)) byTenant.set(tenantKey, lease);
      if (tenantKey && unitKey) {
        const compositeKey = `${tenantKey}:${unitKey}`;
        if (!byTenantUnit.has(compositeKey)) byTenantUnit.set(compositeKey, lease);
      }
    });

    return { byTenant, byTenantUnit };
  }, [leases]);

  const resolveBillingPeriodDefinition = useCallback(
    (billingPeriodKey = "monthly") => {
      const normalizedKey = canonicalBillingPeriodKey(billingPeriodKey);
      return (
        normalizedBillingPeriods.byKey.get(normalizedKey) ||
        normalizedBillingPeriods.byKey.get("monthly") ||
        { key: "monthly", name: "Monthly", durationInMonths: 1, isActive: true }
      );
    },
    [normalizedBillingPeriods]
  );

  const resolveLeaseForTenantUnit = useCallback(
    (tenant, unitId = null) => {
      const tenantKey = String(tenant?._id || "");
      const unitKey = String(unitId || tenant?.invoiceUnit?._id || tenant?.invoiceUnit || tenant?.unit?._id || tenant?.unit || "");
      if (tenantKey && unitKey) {
        const exact = leaseLookup.byTenantUnit.get(`${tenantKey}:${unitKey}`);
        if (exact) return exact;
      }
      return tenantKey ? leaseLookup.byTenant.get(tenantKey) || null : null;
    },
    [leaseLookup]
  );

  const resolveTenantBookingPeriod = useCallback(
    ({ tenant, unitContext, month, year }) => {
      const lease = resolveLeaseForTenantUnit(tenant, unitContext?.unitId);
      const invoiceMonthStart = new Date(Number(year), Number(month), 1, 0, 0, 0, 0);
      if (Number.isNaN(invoiceMonthStart.getTime())) {
        return { allowed: false, reason: "Invalid billing period selected." };
      }

      const billingPeriod = resolveBillingPeriodDefinition(
        lease?.billingPeriodKey ||
          tenant?.billingPeriodKey ||
          tenant?.billingFrequency ||
          unitContext?.unit?.billingPeriodKey ||
          unitContext?.unit?.billingFrequency ||
          "monthly"
      );

      const leaseStartDate = new Date(lease?.startDate || tenant?.moveInDate || invoiceMonthStart);
      leaseStartDate.setHours(0, 0, 0, 0);
      const scheduleAnchor = new Date(leaseStartDate);
      const leaseEndDate = lease?.endDate ? new Date(lease.endDate) : null;
      if (leaseEndDate && !Number.isNaN(leaseEndDate.getTime())) {
        leaseEndDate.setHours(23, 59, 59, 999);
      }

      let currentDate = new Date(scheduleAnchor);
      while (currentDate <= invoiceMonthStart) {
        const nextDate = addMonthsPreservingDay(currentDate, billingPeriod.durationInMonths) || new Date(invoiceMonthStart);
        const periodEnd = new Date(nextDate.getTime() - 1);

        if (
          invoiceMonthStart.getFullYear() === currentDate.getFullYear() &&
          invoiceMonthStart.getMonth() === currentDate.getMonth()
        ) {
          const periodKey = buildSchedulePeriodKey({ startDate: currentDate, billingPeriodKey: billingPeriod.key });
          const rawAdjustments = Array.isArray(lease?.billingScheduleAdjustments) ? lease.billingScheduleAdjustments : [];
          const adjustment =
            rawAdjustments.find((item) => String(item?.periodKey || "") === String(periodKey)) ||
            rawAdjustments.find((item) => {
              const itemFrom = item?.fromDate ? new Date(item.fromDate) : null;
              return itemFrom && itemFrom.getFullYear() === currentDate.getFullYear() && itemFrom.getMonth() === currentDate.getMonth();
            }) ||
            null;

          if (adjustment?.status === "deleted") {
            return { allowed: false, reason: "Selected billing period has been deleted from the lease schedule." };
          }
          if (adjustment?.status === "frozen") {
            return { allowed: false, reason: "Selected billing period is frozen in the lease schedule." };
          }
          if (leaseEndDate && currentDate > leaseEndDate) {
            return { allowed: false, reason: "Selected billing period falls outside the lease term." };
          }

          const fromDate = adjustment?.fromDate ? new Date(adjustment.fromDate) : currentDate;
          const toDate = adjustment?.toDate ? new Date(adjustment.toDate) : periodEnd;
          const paymentDueDay = Math.max(1, Math.min(28, Number(lease?.paymentDueDay || 5)));
          const dueDate = new Date(fromDate);
          dueDate.setDate(Math.min(paymentDueDay, new Date(dueDate.getFullYear(), dueDate.getMonth() + 1, 0).getDate()));
          dueDate.setHours(23, 59, 59, 999);

          return {
            allowed: true,
            lease,
            billingPeriod,
            periodKey,
            fromDate,
            toDate,
            dueDate,
            description: formatScheduleLabel({ startDate: fromDate, endDate: toDate, billingPeriod }),
            rentAmount: Number(adjustment?.rentAmount ?? Number(unitContext?.rentAmount || 0) * billingPeriod.durationInMonths),
            utilityAmount: Number(adjustment?.utilityAmount ?? Number(unitContext?.utilityAmount || 0) * billingPeriod.durationInMonths),
            utilityNames: Array.isArray(adjustment?.utilityNames) ? adjustment.utilityNames : [],
          };
        }
        currentDate = nextDate;
      }

      return { allowed: false, reason: "Selected month is not a scheduled billing start for this tenant's billing frequency." };
    },
    [resolveLeaseForTenantUnit, resolveBillingPeriodDefinition]
  );

  const getAssignedUnitContexts = useCallback(
    (tenant) => {
      const rawUnits = [tenant?.unit, ...(Array.isArray(tenant?.additionalUnits) ? tenant.additionalUnits : [])]
        .filter(Boolean)
        .map((unitRef) => {
          const unitId = unitRef?._id || unitRef;
          return unitLookupById.get(String(unitId)) || unitRef || null;
        })
        .filter(Boolean);

      const seen = new Set();
      return rawUnits
        .filter((unit) => {
          const key = String(unit?._id || unit || "");
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((unit) => ({
          unit,
          unitId: unit?._id || unit,
          unitName: unit?.unitName || unit?.name || unit?.unitNumber || "N/A",
          propertyId: unit?.property?._id || unit?.property || null,
          rentAmount: Number(unit?.rent || unit?.monthlyRent || 0) || 0,
          utilityRows: Array.isArray(unit?.utilities) ? unit.utilities : [],
        }));
    },
    [unitLookupById]
  );

  const getTenantPricing = useCallback(
    (tenant) => {
      const assignedUnitContexts = getAssignedUnitContexts(tenant);
      if (!assignedUnitContexts.length) {
        return { rentAmount: 0, utilityAmount: 0, utilityLabel: "", total: 0, unitContexts: [] };
      }

      const unitContexts = assignedUnitContexts.map((context) => {
        const tenantUtilities = Array.isArray(tenant?.utilities) ? tenant.utilities : [];
        const utilitiesFromTenant = tenantUtilities.reduce((sum, utility) => {
          if (utility?.isIncluded === true) return sum;
          return sum + (Number(utility?.unitCharge || utility?.amount || 0) || 0);
        }, 0);

        const useTenantUtilities = utilitiesFromTenant > 0 && assignedUnitContexts.length === 1;
        const sourceRows = useTenantUtilities ? tenantUtilities : context.utilityRows;
        let utilitiesFromUnit = 0;
        const billableUtilityRows = sourceRows.reduce((acc, item) => {
          if (item?.isIncluded === true) return acc;
          const amount = Number(item?.unitCharge || item?.amount || 0);
          utilitiesFromUnit += amount;
          const label = extractUtilityLabel(item);
          if (label && amount > 0) acc.push({ label, amount });
          return acc;
        }, []);

        return {
          ...context,
          utilityAmount: useTenantUtilities ? utilitiesFromTenant : utilitiesFromUnit,
          utilityLabel: billableUtilityRows.map((r) => r.label).join(", "),
          billableUtilityRows,
        };
      });

      const rentAmount = unitContexts.reduce((sum, item) => sum + Number(item.rentAmount || 0), 0);
      const utilityAmount = unitContexts.reduce((sum, item) => sum + Number(item.utilityAmount || 0), 0);
      const utilityLabels = Array.from(new Set(unitContexts.map((item) => item.utilityLabel).filter(Boolean)));

      return {
        rentAmount,
        utilityAmount,
        utilityLabel: utilityLabels.join(", "),
        total: rentAmount + utilityAmount,
        unitContexts,
      };
    },
    [getAssignedUnitContexts]
  );

  const getTenantPricingForBookingPeriod = useCallback(
    (tenant, month, year) => {
      const pricing = getTenantPricing(tenant);
      const scheduleAwareUnitContexts = pricing.unitContexts
        .map((context) => {
          const bookingPeriod = resolveTenantBookingPeriod({ tenant, unitContext: context, month, year });
          if (!bookingPeriod?.allowed) return null;
          return {
            ...context,
            rentAmount: bookingPeriod.rentAmount,
            utilityAmount: bookingPeriod.utilityAmount,
            utilityLabel:
              Array.isArray(bookingPeriod.utilityNames) && bookingPeriod.utilityNames.length === 1
                ? bookingPeriod.utilityNames[0]
                : context.utilityLabel,
          };
        })
        .filter(Boolean);

      if (!scheduleAwareUnitContexts.length) {
        return { rentAmount: 0, utilityAmount: 0, utilityLabel: "", total: 0, unitContexts: [] };
      }

      const rentAmount = scheduleAwareUnitContexts.reduce((sum, item) => sum + Number(item.rentAmount || 0), 0);
      const utilityAmount = scheduleAwareUnitContexts.reduce((sum, item) => sum + Number(item.utilityAmount || 0), 0);
      const utilityLabels = Array.from(new Set(scheduleAwareUnitContexts.map((item) => item.utilityLabel).filter(Boolean)));

      return {
        rentAmount,
        utilityAmount,
        utilityLabel: utilityLabels.join(", "),
        total: rentAmount + utilityAmount,
        unitContexts: scheduleAwareUnitContexts,
      };
    },
    [getTenantPricing, resolveTenantBookingPeriod]
  );

  const getTenantPropertyId = useCallback(
    (tenant) => {
      const directPropertyId = tenant?.property?._id || tenant?.property;
      if (directPropertyId) return directPropertyId;
      const tenantUnitId = String(tenant?.unit?._id || tenant?.unit || "");
      const matchedUnit = unitLookupById.get(tenantUnitId);
      return matchedUnit?.property?._id || matchedUnit?.property || null;
    },
    [unitLookupById]
  );

  return {
    getTenantPricing,
    getTenantPricingForBookingPeriod,
    getTenantPropertyId,
    getAssignedUnitContexts,
    resolveTenantBookingPeriod,
  };
}
