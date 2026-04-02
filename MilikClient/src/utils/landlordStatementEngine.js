const toDateSafe = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const normalizeId = (value) => {
  if (!value) return "";
  if (typeof value === "object") return String(value._id || value.id || "");
  return String(value);
};

const round2 = (value) => Number(Number(value || 0).toFixed(2));

const getPaymentDate = (payment) => toDateSafe(payment?.paymentDate || payment?.createdAt);

const getPaymentAmount = (payment) =>
  Number(payment?.amount || payment?.amountPaid || payment?.breakdown?.total || 0);

const getPaymentRentAmount = (payment) =>
  Number(payment?.breakdown?.rent || (payment?.paymentType === "rent" ? getPaymentAmount(payment) : 0));

const getPaymentUtilityAmount = (payment) => {
  if (Array.isArray(payment?.breakdown?.utilities)) {
    return payment.breakdown.utilities.reduce((sum, utility) => sum + Number(utility?.amount || 0), 0);
  }
  return Number(payment?.paymentType === "utility" ? getPaymentAmount(payment) : 0);
};

const getPaymentAllocation = (payment) => {
  const type = String(payment?.paymentType || "").toLowerCase();
  if (type === "rent") return "rent";
  if (type === "utility") return "utility";
  if (type === "deposit") return "deposit";
  if (type === "late_fee") return "other_charge";
  return "unapplied";
};

const getPaymentCollector = (payment, property) => {
  if (payment?.paidDirectToLandlord) return "landlord";
  if (String(payment?.receivedBy || "").toLowerCase() === "landlord") return "landlord";
  if (String(property?.tenantsPaysTo || "") === "landlord") return "landlord";
  return "manager";
};

export const buildLandlordStatementFromEvents = ({
  landlord,
  property,
  periodStart,
  periodEnd,
  statementType,
  tenants,
  rentPayments,
  invoiceEntriesByTenant,
  previousPeriodExpenses,
  recurringDeductions,
  managerAdvance,
}) => {
  const events = [];
  const propertyTenantIds = new Set(tenants.map((tenant) => normalizeId(tenant?._id)));

  const validPayments = (rentPayments || []).filter((payment) => {
    const tenantId = normalizeId(payment?.tenant?._id || payment?.tenant || payment?.tenantId?._id || payment?.tenantId);
    if (!propertyTenantIds.has(tenantId)) return false;
    if (typeof payment?.isConfirmed === "boolean" && !payment.isConfirmed) return false;
    if (payment?.isCancelled) return false;
    if (payment?.reversalOf) return false;
    return !!getPaymentDate(payment);
  });

  const tenantRows = tenants.map((tenant) => {
    const tenantId = normalizeId(tenant?._id);
    const unit = tenant?.unit?.unitNumber || tenant?.unitNumber || "N/A";
    const tenantName =
      tenant?.name ||
      tenant?.tenantName ||
      [tenant?.firstName, tenant?.lastName].filter(Boolean).join(" ") ||
      "N/A";

    const rentPerMonth = Number(tenant?.rent || tenant?.unit?.rent || 0);
    const tenantInvoiceEntries = invoiceEntriesByTenant[tenantId] || [];

    const invoicedInPeriod = tenantInvoiceEntries
      .filter((inv) => inv.createdAt && inv.createdAt >= periodStart && inv.createdAt <= periodEnd)
      .reduce((sum, inv) => sum + Number(inv.rentAmount || 0), 0);

    const invoicedBeforePeriod = tenantInvoiceEntries
      .filter((inv) => inv.createdAt && inv.createdAt < periodStart)
      .reduce((sum, inv) => sum + Number(inv.rentAmount || 0), 0);

    const periodPayments = validPayments.filter((payment) => {
      const tenantPaymentId = normalizeId(payment?.tenant?._id || payment?.tenant || payment?.tenantId?._id || payment?.tenantId);
      if (tenantPaymentId !== tenantId) return false;
      const paymentDate = getPaymentDate(payment);
      return paymentDate >= periodStart && paymentDate <= periodEnd;
    });

    const openingPayments = validPayments.filter((payment) => {
      const tenantPaymentId = normalizeId(payment?.tenant?._id || payment?.tenant || payment?.tenantId?._id || payment?.tenantId);
      if (tenantPaymentId !== tenantId) return false;
      const paymentDate = getPaymentDate(payment);
      return paymentDate < periodStart;
    });

    const fallbackMonths =
      (periodEnd.getFullYear() - periodStart.getFullYear()) * 12 +
      (periodEnd.getMonth() - periodStart.getMonth()) +
      1;
    const totalInvoiced = invoicedInPeriod > 0 ? invoicedInPeriod : rentPerMonth * Math.max(fallbackMonths, 1);

    const openingReceived = openingPayments.reduce((sum, p) => sum + getPaymentAmount(p), 0);
    const openingBalance = invoicedBeforePeriod - openingReceived;

    const totalReceived = periodPayments.reduce((sum, p) => sum + getPaymentAmount(p), 0);
    const closingBalance = openingBalance + totalInvoiced - totalReceived;

    if (openingBalance !== 0) {
      events.push({
        eventType: "OPENING_ARREARS_BF",
        bucket: "tenant_obligation",
        amount: round2(openingBalance),
        date: periodStart,
        tenantId,
        unit,
        tenantName,
        meta: { source: "opening_balance" },
      });
    }

    if (totalInvoiced > 0) {
      events.push({
        eventType: "RENT_CHARGED",
        bucket: "rent_income",
        amount: round2(totalInvoiced),
        date: periodStart,
        tenantId,
        unit,
        tenantName,
        meta: { source: "invoice_or_fallback" },
      });
    }

    periodPayments.forEach((payment) => {
      const allocation = getPaymentAllocation(payment);
      const collector = getPaymentCollector(payment, property);
      const date = getPaymentDate(payment);
      const amount = getPaymentAmount(payment);
      const rentAmount = getPaymentRentAmount(payment);
      const utilityAmount = getPaymentUtilityAmount(payment);

      events.push({
        eventType: collector === "landlord" ? "PAYMENT_RECEIVED_LANDLORD" : "PAYMENT_RECEIVED_MANAGER",
        bucket:
          allocation === "deposit"
            ? "deposit_liability"
            : allocation === "utility"
            ? "utility_income"
            : allocation === "rent"
            ? "rent_income"
            : "suspense",
        amount: round2(amount),
        date,
        tenantId,
        unit,
        tenantName,
        reference: payment?.receiptNumber || payment?.referenceNumber || "N/A",
        meta: {
          allocation,
          collector,
          paymentMethod: payment?.paymentMethod || "unknown",
          paymentType: payment?.paymentType || "other",
          rentAmount: round2(rentAmount),
          utilityAmount: round2(utilityAmount),
          paidDirectToLandlord: !!payment?.paidDirectToLandlord,
        },
      });
    });

    return {
      unit,
      tenantName,
      rentPerMonth,
      openingBalance: round2(openingBalance),
      totalInvoiced: round2(totalInvoiced),
      txnNo:
        periodPayments.length > 0
          ? periodPayments.map((p) => p?.receiptNumber || p?.referenceNumber || "N/A").join(", ")
          : "-",
      totalReceived: round2(totalReceived),
      totalReceivedByManager: round2(
        periodPayments
          .filter((payment) => getPaymentCollector(payment, property) === "manager")
          .reduce((sum, payment) => sum + getPaymentAmount(payment), 0)
      ),
      totalReceivedByLandlord: round2(
        periodPayments
          .filter((payment) => getPaymentCollector(payment, property) === "landlord")
          .reduce((sum, payment) => sum + getPaymentAmount(payment), 0)
      ),
      closingBalance: round2(closingBalance),
    };
  });

  (previousPeriodExpenses || []).forEach((expense) => {
    events.push({
      eventType: "EXPENSE_POSTED",
      bucket: "expense_deduction",
      amount: round2(expense?.amount || 0),
      date: toDateSafe(expense?.date) || periodStart,
      reference: expense?._id,
      meta: {
        category: expense?.category || "other",
        description: expense?.description || "",
      },
    });
  });

  const activeRecurringDeductions = (recurringDeductions || []).filter(
    (item) => item?.active && Number(item?.remainingBalance || 0) > 0
  );

  activeRecurringDeductions.forEach((item) => {
    const installment = Math.min(Number(item?.installmentAmount || 0), Number(item?.remainingBalance || 0));
    if (installment <= 0) return;
    events.push({
      eventType: "RECURRING_LANDLORD_DEDUCTION",
      bucket: "expense_deduction",
      amount: round2(installment),
      date: periodEnd,
      reference: item?._id,
      meta: {
        name: item?.name || "Recurring Deduction",
        totalAmount: Number(item?.totalAmount || 0),
      },
    });
  });

  if (managerAdvance && Number(managerAdvance?.remainingBalance || 0) > 0) {
    const recoveryInstallment = Math.min(
      Number(managerAdvance?.recoveryInstallment || 0),
      Number(managerAdvance?.remainingBalance || 0)
    );
    if (recoveryInstallment > 0) {
      events.push({
        eventType: "ADVANCE_RECOVERY",
        bucket: "advance_recovery",
        amount: round2(recoveryInstallment),
        date: periodEnd,
        reference: managerAdvance?._id,
        meta: {
          advanceDate: managerAdvance?.advanceDate || null,
          recoveryMethod: managerAdvance?.recoveryMethod || "installment",
        },
      });
    }
  }

  const totals = events.reduce(
    (acc, event) => {
      const amount = Number(event.amount || 0);
      const allocation = event?.meta?.allocation;
      const collector = event?.meta?.collector;

      if (event.eventType === "RENT_CHARGED") acc.totalRentInvoiced += amount;

      if (event.eventType === "PAYMENT_RECEIVED_MANAGER" || event.eventType === "PAYMENT_RECEIVED_LANDLORD") {
        if (allocation === "rent") {
          if (collector === "manager") acc.rentCollectedByManager += amount;
          if (collector === "landlord") acc.rentCollectedByLandlord += amount;
        }

        if (allocation === "utility") {
          if (collector === "manager") acc.utilitiesCollectedByManager += amount;
          if (collector === "landlord") acc.utilitiesCollectedByLandlord += amount;
        }

        if (allocation === "deposit") {
          if (collector === "manager") acc.depositsHeldByManager += amount;
          if (collector === "landlord") acc.depositsHeldByLandlord += amount;
        }

        if (allocation === "unapplied") {
          acc.unappliedPayments += amount;
        }
      }

      if (event.eventType === "EXPENSE_POSTED") {
        acc.totalExpenses += amount;
      }

      if (event.eventType === "RECURRING_LANDLORD_DEDUCTION") {
        acc.recurringDeductions += amount;
      }

      if (event.eventType === "ADVANCE_RECOVERY") {
        acc.advanceRecoveries += amount;
      }

      if (event.eventType === "OPENING_ARREARS_BF") {
        acc.openingArrears += amount;
      }

      return acc;
    },
    {
      totalRentInvoiced: 0,
      rentCollectedByManager: 0,
      rentCollectedByLandlord: 0,
      utilitiesCollectedByManager: 0,
      utilitiesCollectedByLandlord: 0,
      depositsHeldByManager: 0,
      depositsHeldByLandlord: 0,
      unappliedPayments: 0,
      totalExpenses: 0,
      recurringDeductions: 0,
      advanceRecoveries: 0,
      openingArrears: 0,
      adjustments: 0,
      additionsCredits: 0,
    }
  );

  const commissionPercentage = Number(property?.commissionPercentage || 0);
  const configuredBasis = String(property?.commissionRecognitionBasis || "received").toLowerCase();
  const commissionBasis =
    configuredBasis === "invoiced" || configuredBasis === "received_manager_only" || configuredBasis === "received"
      ? configuredBasis
      : "received";

  const commissionBaseAmount =
    commissionBasis === "invoiced"
      ? totals.totalRentInvoiced
      : commissionBasis === "received_manager_only"
      ? totals.rentCollectedByManager
      : totals.rentCollectedByManager + totals.rentCollectedByLandlord;

  const commissionAmount = round2((commissionBaseAmount * commissionPercentage) / 100);

  const managerCollectedIncome =
    statementType === "provisional" && commissionBasis === "invoiced"
      ? totals.totalRentInvoiced
      : totals.rentCollectedByManager + totals.utilitiesCollectedByManager;

  const netBeforeDeductions =
    managerCollectedIncome +
    totals.additionsCredits -
    commissionAmount -
    totals.totalExpenses -
    totals.recurringDeductions -
    totals.advanceRecoveries -
    totals.adjustments;

  const totalRentReceived = totals.rentCollectedByManager + totals.rentCollectedByLandlord;
  const totalArrears = totals.totalRentInvoiced - totalRentReceived;

  const settlement = {
    netPayableToLandlord: round2(Math.max(netBeforeDeductions, 0)),
    amountPayableByLandlordToManager: round2(Math.max(-netBeforeDeductions, 0)),
    isNegativeStatement: netBeforeDeductions < 0,
  };

  events.push({
    eventType: "MANAGEMENT_COMMISSION_CHARGED",
    bucket: "commission_deduction",
    amount: commissionAmount,
    date: periodEnd,
    meta: {
      basis: commissionBasis,
      percentage: commissionPercentage,
      baseAmount: round2(commissionBaseAmount),
    },
  });

  return {
    tenantRows,
    financialEvents: events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    summaryBuckets: {
      rentIncome: {
        totalRentInvoiced: round2(totals.totalRentInvoiced),
        rentCollectedByManager: round2(totals.rentCollectedByManager),
        rentCollectedByLandlord: round2(totals.rentCollectedByLandlord),
      },
      utilityCharges: {
        utilitiesCollectedByManager: round2(totals.utilitiesCollectedByManager),
        utilitiesCollectedByLandlord: round2(totals.utilitiesCollectedByLandlord),
      },
      securityDeposits: {
        heldByManager: round2(totals.depositsHeldByManager),
        heldByLandlord: round2(totals.depositsHeldByLandlord),
      },
      deductions: {
        commissionAmount: round2(commissionAmount),
        expenses: round2(totals.totalExpenses),
        recurringDeductions: round2(totals.recurringDeductions),
        advanceRecoveries: round2(totals.advanceRecoveries),
        adjustments: round2(totals.adjustments),
      },
      suspense: {
        unappliedPayments: round2(totals.unappliedPayments),
      },
      settlement,
    },
    totals: {
      totalRentInvoiced: round2(totals.totalRentInvoiced),
      totalRentReceived: round2(totalRentReceived),
      totalRentReceivedByManager: round2(totals.rentCollectedByManager),
      totalRentReceivedByLandlord: round2(totals.rentCollectedByLandlord),
      totalUtilitiesCollected: round2(totals.utilitiesCollectedByManager + totals.utilitiesCollectedByLandlord),
      totalExpenses: round2(totals.totalExpenses),
      recurringDeductions: round2(totals.recurringDeductions),
      advanceRecoveries: round2(totals.advanceRecoveries),
      commissionPercentage: round2(commissionPercentage),
      commissionBasis,
      commissionBaseAmount: round2(commissionBaseAmount),
      commissionAmount: round2(commissionAmount),
      managerCollectedIncome: round2(managerCollectedIncome),
      totalArrears: round2(totalArrears),
      netAmountDue: round2(netBeforeDeductions),
      netAfterExpenses: round2(netBeforeDeductions),
      openingArrears: round2(totals.openingArrears),
    },
  };
};
