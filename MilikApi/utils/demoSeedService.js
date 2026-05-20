import Company from "../models/Company.js";
import Landlord from "../models/Landlord.js";
import Property from "../models/Property.js";
import Unit from "../models/Unit.js";
import Tenant from "../models/Tenant.js";
import Lease from "../models/Lease.js";
import Maintenance from "../models/Maintenance.js";
import LandlordStatement from "../models/LandlordStatement.js";
import LandlordStatementLine from "../models/LandlordStatementLine.js";
import ProcessedStatement from "../models/ProcessedStatement.js";
import LandlordStandingOrder from "../models/LandlordStandingOrder.js";
import LandlordAdvancement from "../models/LandlordAdvancement.js";
import TenantInvoice from "../models/TenantInvoice.js";
import RentPayment from "../models/RentPayment.js";
import PaymentVoucher from "../models/PaymentVoucher.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import { aggregateChartOfAccountBalances } from "../services/chartAccountAggregationService.js";
import { ensureSystemChartOfAccounts, findSystemAccountByCode } from "../services/chartOfAccountsService.js";
import { ensurePropertyControlAccount } from "../services/propertyAccountingService.js";

const DEMO_TAG = "MILIK_DEMO_SEED_V2";
const DEMO_WORKSPACE_NAME = "MILIK DEMO WORKSPACE";
const DEMO_WORKSPACE_EMAIL = "demo.workspace@milik.local";
const DEMO_PROFILES = {
  PROPERTY_MANAGER: "property_manager",
  SELF_MANAGING_LANDLORD: "self_managing_landlord",
};

const SAMPLE_DATA = {
  landlords: [
    {
      landlordCode: "DLL001",
      landlordType: "Individual",
      landlordName: "James Mwangi",
      regId: "DMO-JM-001",
      idNumber: "DMO-JM-001",
      taxPin: "A123456789X",
      email: "james.mwangi.demo@milik.local",
      phoneNumber: "+254700111001",
      postalAddress: "P.O Box 100, Nairobi",
      location: "Kilimani",
    },
    {
      landlordCode: "DLL002",
      landlordType: "Individual",
      landlordName: "Amina Hassan",
      regId: "DMO-AH-002",
      idNumber: "DMO-AH-002",
      taxPin: "A987654321Y",
      email: "amina.hassan.demo@milik.local",
      phoneNumber: "+254700111002",
      postalAddress: "P.O Box 200, Nairobi",
      location: "Westlands",
    },
  ],
  properties: [
    {
      propertyCode: "DGV01",
      propertyName: "Greenview Apartments",
      lrNumber: "LR-DGV01-2026",
      propertyType: "Residential",
      specification: "Multi-Unit/Multi-Spa",
      townCityState: "Nairobi",
      estateArea: "Kilimani",
      roadStreet: "Argwings Kodhek Rd",
      address: "Argwings Kodhek Road, Kilimani, Nairobi",
      totalUnits: 3,
      occupiedUnits: 2,
      vacantUnits: 1,
      commissionPercentage: 10,
      commissionRecognitionBasis: "received",
      commissionPaymentMode: "percentage",
      tenantsPaysTo: "propertyManager",
      depositHeldBy: "propertyManager",
      landlordCode: "DLL001",
      units: [
        { unitNumber: "A1", unitType: "2bed", rent: 45000, deposit: 45000, status: "occupied", isVacant: false },
        { unitNumber: "A2", unitType: "2bed", rent: 50000, deposit: 50000, status: "occupied", isVacant: false },
        { unitNumber: "B1", unitType: "1bed", rent: 32000, deposit: 32000, status: "vacant", isVacant: true },
      ],
      tenants: [
        {
          tenantCode: "DTN001",
          name: "John Kamau",
          phone: "+254711000001",
          idNumber: "D-TN-001",
          unitNumber: "A1",
          rent: 45000,
          balance: 0,
          paymentMethod: "mobile_money",
          moveInDate: "2025-06-01",
        },
        {
          tenantCode: "DTN002",
          name: "Mary Njeri",
          phone: "+254711000002",
          idNumber: "D-TN-002",
          unitNumber: "A2",
          rent: 50000,
          balance: 20000,
          paymentMethod: "bank_transfer",
          moveInDate: "2025-09-01",
        },
      ],
    },
    {
      propertyCode: "DSR01",
      propertyName: "Sunrise Residency",
      lrNumber: "LR-DSR01-2026",
      propertyType: "Residential",
      specification: "Multi-Unit/Multi-Spa",
      townCityState: "Nairobi",
      estateArea: "Westlands",
      roadStreet: "Brookside Drive",
      address: "Brookside Drive, Westlands, Nairobi",
      totalUnits: 3,
      occupiedUnits: 2,
      vacantUnits: 1,
      commissionPercentage: 10,
      commissionRecognitionBasis: "received",
      commissionPaymentMode: "percentage",
      tenantsPaysTo: "propertyManager",
      depositHeldBy: "propertyManager",
      landlordCode: "DLL002",
      units: [
        { unitNumber: "C1", unitType: "1bed", rent: 38000, deposit: 38000, status: "occupied", isVacant: false },
        { unitNumber: "C2", unitType: "2bed", rent: 44000, deposit: 44000, status: "occupied", isVacant: false },
        { unitNumber: "C3", unitType: "1bed", rent: 30000, deposit: 30000, status: "vacant", isVacant: true },
      ],
      tenants: [
        {
          tenantCode: "DTN003",
          name: "Peter Kariuki",
          phone: "+254711000003",
          idNumber: "D-TN-003",
          unitNumber: "C1",
          rent: 38000,
          balance: 0,
          paymentMethod: "mobile_money",
          moveInDate: "2025-04-15",
        },
        {
          tenantCode: "DTN004",
          name: "Susan Achieng",
          phone: "+254711000004",
          idNumber: "D-TN-004",
          unitNumber: "C2",
          rent: 44000,
          balance: 0,
          paymentMethod: "bank_transfer",
          moveInDate: "2025-07-01",
        },
      ],
    },
  ],
};

function makeDate(year, month, day, hour = 9) {
  return new Date(year, month - 1, day, hour, 0, 0, 0);
}

function addDays(dateValue, days = 0) {
  const date = new Date(dateValue);
  date.setDate(date.getDate() + Number(days || 0));
  return date;
}

function round2(value) {
  return Number(Number(value || 0).toFixed(2));
}

function resolveDemoProfile(value = "") {
  return String(value || "").trim().toLowerCase() === DEMO_PROFILES.SELF_MANAGING_LANDLORD
    ? DEMO_PROFILES.SELF_MANAGING_LANDLORD
    : DEMO_PROFILES.PROPERTY_MANAGER;
}

function getCurrentSeedYear() {
  return new Date().getFullYear();
}

function getExpectedDemoPropertyCount(companyId, demoProfile = DEMO_PROFILES.PROPERTY_MANAGER) {
  return buildCompanyScopedSampleData(companyId, demoProfile).properties.length;
}

function buildDemoCalendar() {
  const year = getCurrentSeedYear();
  const now = new Date();

  return {
    year,
    now,
    jan1: makeDate(year, 1, 1),
    feb1: makeDate(year, 2, 1),
    feb5: makeDate(year, 2, 5),
    feb7: makeDate(year, 2, 7),
    feb12: makeDate(year, 2, 12),
    mar1: makeDate(year, 3, 1),
    mar5: makeDate(year, 3, 5),
    mar8: makeDate(year, 3, 8),
    mar12: makeDate(year, 3, 12),
    apr1: makeDate(year, 4, 1),
    apr4: makeDate(year, 4, 4),
    apr6: makeDate(year, 4, 6),
    apr8: makeDate(year, 4, 8),
    apr10: makeDate(year, 4, 10),
    currentMonthStart: new Date(now.getFullYear(), now.getMonth(), 1, 9, 0, 0, 0),
    currentMonthDue: new Date(now.getFullYear(), now.getMonth(), 5, 9, 0, 0, 0),
    currentMonthCollectionDate: new Date(now.getFullYear(), now.getMonth(), Math.min(now.getDate(), 8), 9, 0, 0, 0),
    leaseSoonEnd: addDays(now, 20),
    leaseLaterEnd: addDays(now, 120),
    maintenanceSoon: addDays(now, 2),
    maintenanceInProgress: addDays(now, 5),
    voucherDueSoon: addDays(now, 6),
  };
}

function getCompanySeedKey(companyId) {
  return String(companyId || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-6)
    .toUpperCase() || "DEMO01";
}

function suffixValue(base, suffix) {
  return `${String(base || "").trim()}-${suffix}`;
}

function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}

function first(arr = []) {
  return Array.isArray(arr) && arr.length ? arr[0] : null;
}

function second(arr = []) {
  return Array.isArray(arr) && arr.length > 1 ? arr[1] : null;
}

function buildInvoicePlans(propertyData, calendar) {
  const tenantOne = first(propertyData.tenants);
  const tenantTwo = second(propertyData.tenants);

  const plans = [];

  if (tenantOne) {
    plans.push(
      {
        key: "feb-rent-1",
        invoiceNumber: `DINV-${propertyData.propertyCode}-FEB-R1`,
        unitNumber: tenantOne.unitNumber,
        category: "RENT_CHARGE",
        amount: tenantOne.rent,
        description: `${propertyData.propertyName} February rent`,
        invoiceDate: calendar.feb1,
        dueDate: calendar.feb5,
        status: "paid",
        chartAccountCode: "4100",
      },
      {
        key: "mar-rent-1",
        invoiceNumber: `DINV-${propertyData.propertyCode}-MAR-R1`,
        unitNumber: tenantOne.unitNumber,
        category: "RENT_CHARGE",
        amount: tenantOne.rent,
        description: `${propertyData.propertyName} March rent`,
        invoiceDate: calendar.mar1,
        dueDate: calendar.mar5,
        status: "paid",
        chartAccountCode: "4100",
      },
      {
        key: "current-rent-1",
        invoiceNumber: `DINV-${propertyData.propertyCode}-CUR-R1`,
        unitNumber: tenantOne.unitNumber,
        category: "RENT_CHARGE",
        amount: tenantOne.rent,
        description: `${propertyData.propertyName} current month rent`,
        invoiceDate: calendar.currentMonthStart,
        dueDate: calendar.currentMonthDue,
        status: "pending",
        chartAccountCode: "4100",
      }
    );
  }

  if (tenantTwo) {
    plans.push(
      {
        key: "feb-rent-2",
        invoiceNumber: `DINV-${propertyData.propertyCode}-FEB-R2`,
        unitNumber: tenantTwo.unitNumber,
        category: "RENT_CHARGE",
        amount: tenantTwo.rent,
        description: `${propertyData.propertyName} February rent`,
        invoiceDate: calendar.feb1,
        dueDate: calendar.feb5,
        status: "partially_paid",
        chartAccountCode: "4100",
      },
      {
        key: "feb-utility-2",
        invoiceNumber: `DINV-${propertyData.propertyCode}-FEB-U2`,
        unitNumber: tenantTwo.unitNumber,
        category: "UTILITY_CHARGE",
        amount: propertyData.propertyCode.startsWith("DGV") ? 2300 : 1800,
        description: `${propertyData.propertyName} February utility recharge`,
        invoiceDate: calendar.feb1,
        dueDate: calendar.feb7,
        status: "pending",
        chartAccountCode: "4102",
      },
      {
        key: "mar-rent-2",
        invoiceNumber: `DINV-${propertyData.propertyCode}-MAR-R2`,
        unitNumber: tenantTwo.unitNumber,
        category: "RENT_CHARGE",
        amount: tenantTwo.rent,
        description: `${propertyData.propertyName} March rent`,
        invoiceDate: calendar.mar1,
        dueDate: calendar.mar5,
        status: "paid",
        chartAccountCode: "4100",
      },
      {
        key: "current-rent-2",
        invoiceNumber: `DINV-${propertyData.propertyCode}-CUR-R2`,
        unitNumber: tenantTwo.unitNumber,
        category: "RENT_CHARGE",
        amount: tenantTwo.rent,
        description: `${propertyData.propertyName} current month rent`,
        invoiceDate: calendar.currentMonthStart,
        dueDate: calendar.currentMonthDue,
        status: "pending",
        chartAccountCode: "4100",
      }
    );
  }

  return plans;
}

function buildPaymentPlans(propertyData, calendar) {
  const tenantOne = first(propertyData.tenants);
  const tenantTwo = second(propertyData.tenants);

  const plans = [];

  if (tenantOne) {
    plans.push(
      {
        key: "feb-pay-1",
        referenceNumber: `DRCP-${propertyData.propertyCode}-FEB-1`,
        receiptNumber: `RCP-${propertyData.propertyCode}-FEB-1`,
        unitNumber: tenantOne.unitNumber,
        amount: tenantOne.rent,
        paymentMethod: "mobile_money",
        receiptDate: calendar.feb5,
        isConfirmed: true,
        postingStatus: "posted",
        allocations: [{ invoiceKey: "feb-rent-1", appliedAmount: tenantOne.rent }],
      },
      {
        key: "mar-pay-1",
        referenceNumber: `DRCP-${propertyData.propertyCode}-MAR-1`,
        receiptNumber: `RCP-${propertyData.propertyCode}-MAR-1`,
        unitNumber: tenantOne.unitNumber,
        amount: tenantOne.rent,
        paymentMethod: "bank_transfer",
        receiptDate: calendar.mar5,
        isConfirmed: true,
        postingStatus: "posted",
        allocations: [{ invoiceKey: "mar-rent-1", appliedAmount: tenantOne.rent }],
      },
      {
        key: "current-pay-1",
        referenceNumber: `DRCP-${propertyData.propertyCode}-CUR-1`,
        receiptNumber: `RCP-${propertyData.propertyCode}-CUR-1`,
        unitNumber: tenantOne.unitNumber,
        amount: Math.round(tenantOne.rent * 0.44),
        paymentMethod: "mobile_money",
        receiptDate: calendar.currentMonthCollectionDate,
        isConfirmed: true,
        postingStatus: "posted",
        allocations: [{ invoiceKey: "current-rent-1", appliedAmount: Math.round(tenantOne.rent * 0.44) }],
      }
    );
  }

  if (tenantTwo) {
    const febPartial = propertyData.propertyCode.startsWith("DGV") ? 30000 : 44000;
    plans.push(
      {
        key: "feb-pay-2",
        referenceNumber: `DRCP-${propertyData.propertyCode}-FEB-2`,
        receiptNumber: `RCP-${propertyData.propertyCode}-FEB-2`,
        unitNumber: tenantTwo.unitNumber,
        amount: febPartial,
        paymentMethod: "bank_transfer",
        receiptDate: calendar.feb12,
        isConfirmed: true,
        postingStatus: "posted",
        allocations: [{ invoiceKey: "feb-rent-2", appliedAmount: febPartial }],
      },
      {
        key: "mar-pay-2",
        referenceNumber: `DRCP-${propertyData.propertyCode}-MAR-2`,
        receiptNumber: `RCP-${propertyData.propertyCode}-MAR-2`,
        unitNumber: tenantTwo.unitNumber,
        amount: tenantTwo.rent,
        paymentMethod: "bank_transfer",
        receiptDate: calendar.mar8,
        isConfirmed: true,
        postingStatus: "posted",
        allocations: [{ invoiceKey: "mar-rent-2", appliedAmount: tenantTwo.rent }],
      },
      {
        key: "current-unposted-2",
        referenceNumber: `DRCP-${propertyData.propertyCode}-CUR-UP2`,
        receiptNumber: `RCP-${propertyData.propertyCode}-CUR-UP2`,
        unitNumber: tenantTwo.unitNumber,
        amount: Math.round(tenantTwo.rent * 0.32),
        paymentMethod: "mobile_money",
        receiptDate: addDays(calendar.currentMonthCollectionDate, 1),
        isConfirmed: false,
        postingStatus: "unposted",
        allocations: [],
      }
    );
  }

  return plans;
}

function buildGreenviewStatement(propertyData, calendar) {
  const tenantOne = first(propertyData.tenants);
  const tenantTwo = second(propertyData.tenants);

  return {
    statementNumber: `STM-${propertyData.propertyCode}-${calendar.year}-02`,
    periodStart: calendar.feb1,
    periodEnd: new Date(calendar.year, 1, 28, 23, 59, 59, 999),
    totalRentInvoiced: 95000,
    totalRentReceived: 75000,
    commissionPercentage: 10,
    commissionBasis: "received",
    commissionAmount: 7500,
    netAmountDue: 55300,
    occupiedUnits: 2,
    vacantUnits: 1,
    status: "part_paid",
    amountPaid: 40000,
    totalExpenses: 12000,
    netAfterExpenses: 55300,
    tenantRows: [
      { unit: tenantOne?.unitNumber || "A1", tenantName: tenantOne?.name || "John Kamau", rentPerMonth: 45000, openingBalance: 0, totalInvoiced: 45000, txnNo: `DINV-${propertyData.propertyCode}-FEB-R1`, totalReceived: 45000, closingBalance: 0 },
      { unit: tenantTwo?.unitNumber || "A2", tenantName: tenantTwo?.name || "Mary Njeri", rentPerMonth: 50000, openingBalance: 20000, totalInvoiced: 50000, txnNo: `DINV-${propertyData.propertyCode}-FEB-R2`, totalReceived: 30000, closingBalance: 40000 },
      { unit: "B1", tenantName: "VACANT", rentPerMonth: 32000, openingBalance: 0, totalInvoiced: 0, txnNo: "-", totalReceived: 0, closingBalance: 0 },
    ],
    workspace: {
      propertyLabel: propertyData.propertyName,
      landlordLabel: "James Mwangi",
      rows: [
        {
          unit: "A1",
          accountNo: tenantOne?.tenantCode || "DTN001",
          tenantName: tenantOne?.name || "John Kamau",
          perMonth: 45000,
          openingBalance: 0,
          invoicedRent: 45000,
          paidRent: 45000,
          utilities: {
            water: { key: "water", label: "Water", invoiced: 1200, paid: 1200 },
            garbage: { key: "garbage", label: "Garbage", invoiced: 800, paid: 800 },
          },
          closingBalance: 0,
        },
        {
          unit: "A2",
          accountNo: tenantTwo?.tenantCode || "DTN002",
          tenantName: tenantTwo?.name || "Mary Njeri",
          perMonth: 50000,
          openingBalance: 20000,
          invoicedRent: 50000,
          paidRent: 30000,
          utilities: {
            water: { key: "water", label: "Water", invoiced: 1300, paid: 900 },
            garbage: { key: "garbage", label: "Garbage", invoiced: 1000, paid: 700 },
          },
          closingBalance: 40700,
        },
        {
          unit: "B1",
          accountNo: "-",
          tenantName: "VACANT",
          perMonth: 32000,
          openingBalance: 0,
          invoicedRent: 0,
          paidRent: 0,
          utilities: {
            water: { key: "water", label: "Water", invoiced: 0, paid: 0 },
            garbage: { key: "garbage", label: "Garbage", invoiced: 0, paid: 0 },
          },
          closingBalance: 0,
        },
      ],
      utilityColumns: [
        { key: "water", label: "Water", invoiced: 2500, paid: 2100 },
        { key: "garbage", label: "Garbage", invoiced: 1800, paid: 1500 },
      ],
      totals: {
        perMonth: 127000,
        openingBalance: 20000,
        invoicedRent: 95000,
        paidRent: 75000,
        closingBalance: 40700,
        utilities: [
          { key: "water", label: "Water", invoiced: 2500, paid: 2100 },
          { key: "garbage", label: "Garbage", invoiced: 1800, paid: 1500 },
        ],
      },
      additionRows: [
        { date: calendar.feb7, description: "Lease administration recharge", amount: 2500 },
      ],
      expenseRows: [
        { date: calendar.feb12, description: "Plumbing repair - bathroom leak", amount: 10000 },
        { date: calendar.feb12, description: "Caretaker float reimbursement", amount: 2000 },
      ],
      directToLandlordRows: [
        { date: calendar.feb5, description: "Direct M-Pesa receipt acknowledged by landlord", amount: 8000 },
      ],
      summary: {
        settlementBasisLabel: "Manager-held collections",
        settlementBasisAmount: 75000,
        utilityPassThroughLabel: "Utilities billed",
        utilityPassThroughAmount: 4300,
        commissionBaseLabel: "Commission base",
        commissionBaseAmount: 75000,
        commissionAmount: 7500,
        nonCommissionDeductions: 12000,
        totalExpenses: 12000,
        directToLandlordCollections: 8000,
        additions: 2500,
        openingSettlementBalance: 0,
        settlementLabel: "Net payable to landlord",
        netStatement: 54300,
      },
    },
  };
}

function buildSunriseStatement(propertyData, calendar) {
  const tenantOne = first(propertyData.tenants);
  const tenantTwo = second(propertyData.tenants);

  return {
    statementNumber: `STM-${propertyData.propertyCode}-${calendar.year}-02`,
    periodStart: calendar.feb1,
    periodEnd: new Date(calendar.year, 1, 28, 23, 59, 59, 999),
    totalRentInvoiced: 82000,
    totalRentReceived: 82000,
    commissionPercentage: 10,
    commissionBasis: "received",
    commissionAmount: 8200,
    netAmountDue: 55100,
    occupiedUnits: 2,
    vacantUnits: 1,
    status: "unpaid",
    amountPaid: 0,
    totalExpenses: 8500,
    netAfterExpenses: 55100,
    tenantRows: [
      { unit: tenantOne?.unitNumber || "C1", tenantName: tenantOne?.name || "Peter Kariuki", rentPerMonth: 38000, openingBalance: 0, totalInvoiced: 38000, txnNo: `DINV-${propertyData.propertyCode}-FEB-R1`, totalReceived: 38000, closingBalance: 0 },
      { unit: tenantTwo?.unitNumber || "C2", tenantName: tenantTwo?.name || "Susan Achieng", rentPerMonth: 44000, openingBalance: 0, totalInvoiced: 44000, txnNo: `DINV-${propertyData.propertyCode}-FEB-R2`, totalReceived: 44000, closingBalance: 0 },
      { unit: "C3", tenantName: "VACANT", rentPerMonth: 30000, openingBalance: 0, totalInvoiced: 0, txnNo: "-", totalReceived: 0, closingBalance: 0 },
    ],
    workspace: {
      propertyLabel: propertyData.propertyName,
      landlordLabel: "Amina Hassan",
      rows: [
        {
          unit: "C1",
          accountNo: tenantOne?.tenantCode || "DTN003",
          tenantName: tenantOne?.name || "Peter Kariuki",
          perMonth: 38000,
          openingBalance: 0,
          invoicedRent: 38000,
          paidRent: 38000,
          utilities: {
            water: { key: "water", label: "Water", invoiced: 900, paid: 900 },
            garbage: { key: "garbage", label: "Garbage", invoiced: 400, paid: 400 },
          },
          closingBalance: 0,
        },
        {
          unit: "C2",
          accountNo: tenantTwo?.tenantCode || "DTN004",
          tenantName: tenantTwo?.name || "Susan Achieng",
          perMonth: 44000,
          openingBalance: 0,
          invoicedRent: 44000,
          paidRent: 44000,
          utilities: {
            water: { key: "water", label: "Water", invoiced: 1000, paid: 1000 },
            garbage: { key: "garbage", label: "Garbage", invoiced: 500, paid: 500 },
          },
          closingBalance: 0,
        },
        {
          unit: "C3",
          accountNo: "-",
          tenantName: "VACANT",
          perMonth: 30000,
          openingBalance: 0,
          invoicedRent: 0,
          paidRent: 0,
          utilities: {
            water: { key: "water", label: "Water", invoiced: 0, paid: 0 },
            garbage: { key: "garbage", label: "Garbage", invoiced: 0, paid: 0 },
          },
          closingBalance: 0,
        },
      ],
      utilityColumns: [
        { key: "water", label: "Water", invoiced: 1900, paid: 1900 },
        { key: "garbage", label: "Garbage", invoiced: 900, paid: 900 },
      ],
      totals: {
        perMonth: 112000,
        openingBalance: 0,
        invoicedRent: 82000,
        paidRent: 82000,
        closingBalance: 0,
        utilities: [
          { key: "water", label: "Water", invoiced: 1900, paid: 1900 },
          { key: "garbage", label: "Garbage", invoiced: 900, paid: 900 },
        ],
      },
      additionRows: [],
      expenseRows: [
        { date: calendar.feb12, description: "Security gate repair", amount: 8500 },
      ],
      directToLandlordRows: [
        { date: calendar.feb7, description: "Direct tenant bank transfer acknowledged by landlord", amount: 12000 },
      ],
      summary: {
        settlementBasisLabel: "Manager-held collections",
        settlementBasisAmount: 82000,
        utilityPassThroughLabel: "Utilities billed",
        utilityPassThroughAmount: 2800,
        commissionBaseLabel: "Commission base",
        commissionBaseAmount: 82000,
        commissionAmount: 8200,
        nonCommissionDeductions: 8500,
        totalExpenses: 8500,
        directToLandlordCollections: 12000,
        additions: 0,
        openingSettlementBalance: 0,
        settlementLabel: "Net payable to landlord",
        netStatement: 56100,
      },
    },
  };
}


function buildSelfManagingLandlordStatement(baseStatement, propertyData) {
  const additions = round2(
    (baseStatement?.workspace?.additionRows || []).reduce((sum, row) => sum + Number(row?.amount || 0), 0)
  );
  const expenses = round2(baseStatement?.totalExpenses || 0);
  const rentReceived = round2(baseStatement?.totalRentReceived || 0);
  const utilityAmount = round2(baseStatement?.workspace?.summary?.utilityPassThroughAmount || 0);
  const netStatement = round2(rentReceived + additions - expenses);

  return {
    ...baseStatement,
    commissionPercentage: 0,
    commissionAmount: 0,
    netAmountDue: netStatement,
    netAfterExpenses: netStatement,
    status: "paid",
    amountPaid: netStatement,
    workspace: {
      ...(baseStatement?.workspace || {}),
      landlordLabel: propertyData.landlordCode,
      directToLandlordRows: [],
      summary: {
        ...(baseStatement?.workspace?.summary || {}),
        settlementBasisLabel: "Collections received",
        settlementBasisAmount: rentReceived,
        utilityPassThroughLabel: "Utilities billed",
        utilityPassThroughAmount: utilityAmount,
        commissionBaseLabel: "Platform deductions",
        commissionBaseAmount: 0,
        commissionAmount: 0,
        nonCommissionDeductions: expenses,
        totalExpenses: expenses,
        directToLandlordCollections: 0,
        additions,
        openingSettlementBalance: 0,
        settlementLabel: "Net cash after expenses",
        netStatement,
      },
    },
  };
}

function buildStandingOrderPlans(propertyData, calendar, demoProfile) {
  if (demoProfile !== DEMO_PROFILES.SELF_MANAGING_LANDLORD) return [];

  return [
    {
      referenceNo: `DSO-${propertyData.propertyCode}-001`,
      title: `${propertyData.propertyName} caretaker retainer`,
      amount: propertyData.propertyCode.startsWith("DGV") ? 6000 : 4500,
      frequency: "monthly",
      dayOfMonth: 3,
      startDate: calendar.mar1,
      endDate: null,
      paymentMethod: propertyData.propertyCode.startsWith("DGV") ? "mpesa" : "bank_transfer",
      destination: propertyData.propertyCode.startsWith("DGV")
        ? { mobileNumber: "+254711222333", accountName: "Site Caretaker" }
        : { accountName: "CleanEdge Services", accountNumber: "0012457890", bankName: "KCB" },
      narration: `${propertyData.propertyName} scheduled operational payout`,
      status: "active",
      nextRunDate: calendar.currentMonthDue,
      runHistory:
        propertyData.propertyCode.startsWith("DGV")
          ? [
              {
                runDate: calendar.apr6,
                dueDate: calendar.apr4,
                periodStart: calendar.apr1,
                periodEnd: addDays(calendar.apr1, 29),
                periodKey: `${calendar.year}-04`,
                periodLabel: "Apr " + calendar.year,
                amount: 6000,
                note: "Demo standing order run already processed.",
                referenceNo: `DSOR-${propertyData.propertyCode}-APR`,
                processedBy: null,
              },
            ]
          : [],
    },
  ];
}

function buildAdvancementPlans(propertyData, calendar, demoProfile) {
  if (demoProfile !== DEMO_PROFILES.SELF_MANAGING_LANDLORD || !propertyData.propertyCode.startsWith("DGV")) {
    return [];
  }

  return [
    {
      referenceNo: `DADV-${propertyData.propertyCode}-001`,
      title: "Roof waterproofing advance",
      advanceType: "future_recoverable",
      amount: 18000,
      interestRate: 0,
      interestType: "simple_flat",
      scheduledInterestTotal: 0,
      totalRecoverableAmount: 18000,
      recoveredAmount: 6000,
      interestRecoveredAmount: 0,
      balanceOutstanding: 12000,
      frequency: "monthly",
      dayOfMonth: 10,
      disbursementDate: calendar.mar8,
      startDate: calendar.apr1,
      periodMonths: 3,
      gracePeriodMonths: 0,
      endDate: addDays(calendar.currentMonthStart, 60),
      paymentMethod: "bank_transfer",
      status: "recovering",
      narration: `${propertyData.propertyName} advance recoverable from future property cashflows.`,
      submittedAt: calendar.mar8,
      approvedAt: calendar.mar8,
      disbursedAt: calendar.mar8,
      recoveryHistory: [
        {
          processedAt: calendar.apr10,
          dueDate: calendar.apr10,
          periodStart: calendar.apr1,
          periodEnd: addDays(calendar.apr1, 29),
          periodKey: `${calendar.year}-04`,
          periodLabel: `Apr ${calendar.year}`,
          amount: 6000,
          principalAmount: 6000,
          interestAmount: 0,
          note: "First scheduled recovery already captured in the demo workspace.",
          referenceNo: `DADVREC-${propertyData.propertyCode}-APR`,
          processedBy: null,
        },
      ],
    },
  ];
}

function buildCompanyScopedSampleData(companyId, demoProfile = DEMO_PROFILES.PROPERTY_MANAGER) {
  const resolvedProfile = resolveDemoProfile(demoProfile);
  const seedKey = getCompanySeedKey(companyId);
  const calendar = buildDemoCalendar();

  // Self-managing landlord is the business owner — no separate client landlord records needed
  const landlords = resolvedProfile === DEMO_PROFILES.SELF_MANAGING_LANDLORD
    ? []
    : SAMPLE_DATA.landlords.map((item, index) => {
        const landlordNo = String(index + 1).padStart(3, "0");
        return {
          ...item,
          landlordCode: suffixValue(item.landlordCode, seedKey),
          regId: `DMO-LD-${seedKey}-${landlordNo}`,
          idNumber: `DMO-LD-${seedKey}-${landlordNo}`,
          taxPin: `DMOTAX${seedKey}${landlordNo}`.slice(0, 20),
          email: `demo.landlord.${landlordNo.toLowerCase()}.${seedKey.toLowerCase()}@milik.local`,
          phoneNumber: `+254700${seedKey.replace(/[^0-9]/g, "").padEnd(6, "0").slice(0, 6)}${String(index + 1)}`,
        };
      });

  const properties = SAMPLE_DATA.properties.map((item, propertyIndex) => {
    const propertyNo = String(propertyIndex + 1).padStart(2, "0");
    const propertyCode = suffixValue(item.propertyCode, seedKey);
    const landlordCode = suffixValue(item.landlordCode, seedKey);

    const tenants = Array.isArray(item.tenants)
      ? item.tenants.map((tenant, tenantIndex) => {
          const tenantNo = `${propertyNo}${String(tenantIndex + 1).padStart(2, "0")}`;
          return {
            ...tenant,
            tenantCode: suffixValue(tenant.tenantCode, seedKey),
            idNumber: `DMO-TN-${seedKey}-${tenantNo}`,
            phone: `+254711${seedKey.replace(/[^0-9]/g, "").padEnd(6, "0").slice(0, 4)}${String(tenantIndex + 1).padStart(3, "0")}`,
            depositHeldBy:
              resolvedProfile === DEMO_PROFILES.SELF_MANAGING_LANDLORD ? "Landlord" : "Management Company",
          };
        })
      : [];

    const propertyData = {
      ...item,
      propertyCode,
      lrNumber: suffixValue(item.lrNumber, seedKey),
      landlordCode,
      tenants,
      tenantsPaysTo:
        resolvedProfile === DEMO_PROFILES.SELF_MANAGING_LANDLORD ? "landlord" : item.tenantsPaysTo,
      depositHeldBy:
        resolvedProfile === DEMO_PROFILES.SELF_MANAGING_LANDLORD ? "landlord" : item.depositHeldBy,
      commissionPercentage:
        resolvedProfile === DEMO_PROFILES.SELF_MANAGING_LANDLORD ? 0 : item.commissionPercentage,
      commissionRecognitionBasis: item.commissionRecognitionBasis,
      commissionPaymentMode: item.commissionPaymentMode,
    };

    const baseStatement =
      item.propertyCode === "DGV01"
        ? buildGreenviewStatement(propertyData, calendar)
        : buildSunriseStatement(propertyData, calendar);

    const statement =
      resolvedProfile === DEMO_PROFILES.SELF_MANAGING_LANDLORD
        ? buildSelfManagingLandlordStatement(baseStatement, propertyData)
        : baseStatement;

    return {
      ...propertyData,
      statement: {
        ...statement,
        statementNumber: suffixValue(statement.statementNumber, seedKey),
      },
      invoicePlans: buildInvoicePlans(propertyData, calendar),
      paymentPlans: buildPaymentPlans(propertyData, calendar).map((plan, planIndex) => ({
        ...plan,
        paidDirectToLandlord:
          resolvedProfile === DEMO_PROFILES.SELF_MANAGING_LANDLORD
            ? Boolean(plan.paidDirectToLandlord || planIndex === 0)
            : false,
      })),
      leasePlans: [
        {
          unitNumber: tenants[0]?.unitNumber,
          tenantCode: tenants[0]?.tenantCode,
          startDate: makeDate(calendar.year - 1, 5, 1),
          endDate: calendar.leaseSoonEnd,
          rentAmount: tenants[0]?.rent || 0,
          depositAmount: item.units.find((unit) => unit.unitNumber === tenants[0]?.unitNumber)?.deposit || 0,
          paymentDueDay: 5,
          lateFee: 1500,
          terms: `${propertyData.propertyName} demo lease due on the 5th of each month.`,
          signedDate: makeDate(calendar.year - 1, 5, 1),
        },
        {
          unitNumber: tenants[1]?.unitNumber,
          tenantCode: tenants[1]?.tenantCode,
          startDate: makeDate(calendar.year - 1, 7, 1),
          endDate: calendar.leaseLaterEnd,
          rentAmount: tenants[1]?.rent || 0,
          depositAmount: item.units.find((unit) => unit.unitNumber === tenants[1]?.unitNumber)?.deposit || 0,
          paymentDueDay: 5,
          lateFee: 1500,
          terms: `${propertyData.propertyName} demo lease with standard monthly billing.`,
          signedDate: makeDate(calendar.year - 1, 7, 1),
        },
      ].filter((plan) => plan.unitNumber && plan.tenantCode),
      maintenancePlans:
        item.propertyCode === "DGV01"
          ? [
              {
                unitNumber: tenants[1]?.unitNumber,
                tenantCode: tenants[1]?.tenantCode,
                title: "Kitchen sink leak",
                description: "Tenant reported a recurring kitchen sink leak awaiting contractor visit.",
                priority: "high",
                status: "pending",
                assignedTo: "SwiftFix Plumbing",
                estimatedCost: 6500,
                scheduledDate: calendar.maintenanceSoon,
              },
            ]
          : [
              {
                unitNumber: tenants[0]?.unitNumber,
                tenantCode: tenants[0]?.tenantCode,
                title: "Common area lighting inspection",
                description: "Routine electrical review already underway for staircase lights.",
                priority: "medium",
                status: "in_progress",
                assignedTo: "Bright Spark Electricals",
                estimatedCost: 3200,
                scheduledDate: calendar.maintenanceInProgress,
              },
            ],
      standingOrderPlans: buildStandingOrderPlans(propertyData, calendar, resolvedProfile),
      advancementPlans: buildAdvancementPlans(propertyData, calendar, resolvedProfile),
    };
  });

  return {
    calendar,
    landlords,
    properties,
    demoProfile: resolvedProfile,
  };
}


function computeReceiptBreakdown(allocations = [], fallbackAmount = 0) {
  const breakdown = {
    rent: 0,
    utilities: [],
    total: round2(fallbackAmount),
  };
  const utilityMap = new Map();

  allocations.forEach((row) => {
    const amount = round2(row?.appliedAmount || 0);
    const category = String(row?.category || "").toUpperCase();
    if (category === "RENT_CHARGE") {
      breakdown.rent += amount;
      return;
    }
    if (category === "UTILITY_CHARGE") {
      const utilityName = row?.utilityType || "Utility";
      const current = utilityMap.get(utilityName) || { name: utilityName, amount: 0 };
      current.amount += amount;
      utilityMap.set(utilityName, current);
    }
  });

  breakdown.utilities = Array.from(utilityMap.values()).map((item) => ({
    utility: null,
    name: item.name,
    amount: round2(item.amount),
    billingCycle: "",
  }));

  return {
    ...breakdown,
    rent: round2(breakdown.rent),
  };
}

function computeAllocationSummary(allocations = [], receiptAmount = 0) {
  const summary = {
    rent: 0,
    deposit: 0,
    utility: 0,
    latePenalty: 0,
    debitNote: 0,
    other: 0,
    unapplied: 0,
  };

  allocations.forEach((row) => {
    const amount = round2(row?.appliedAmount || 0);
    const category = String(row?.category || "").toUpperCase();
    if (category === "RENT_CHARGE") summary.rent += amount;
    else if (category === "UTILITY_CHARGE") summary.utility += amount;
    else if (category === "DEPOSIT_CHARGE") summary.deposit += amount;
    else if (category === "LATE_PENALTY_CHARGE") summary.latePenalty += amount;
    else summary.other += amount;
  });

  const allocated = round2(
    summary.rent + summary.deposit + summary.utility + summary.latePenalty + summary.debitNote + summary.other
  );
  summary.unapplied = round2(Math.max(0, Number(receiptAmount || 0) - allocated));

  return summary;
}

async function upsertLandlord(companyId, userId, payload) {
  const update = {
    ...payload,
    company: companyId,
    createdBy: userId,
    status: "Active",
    portalAccess: false,
    notes: `${DEMO_TAG} landlord seed`,
  };

  return Landlord.findOneAndUpdate(
    { company: companyId, landlordCode: payload.landlordCode },
    { $set: update },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

async function upsertProperty(companyId, userId, landlord, payload) {
  const update = {
    propertyCode: payload.propertyCode,
    propertyName: payload.propertyName,
    lrNumber: payload.lrNumber,
    propertyType: payload.propertyType,
    specification: payload.specification,
    townCityState: payload.townCityState,
    estateArea: payload.estateArea,
    roadStreet: payload.roadStreet,
    address: payload.address,
    totalUnits: payload.totalUnits,
    occupiedUnits: payload.occupiedUnits,
    vacantUnits: payload.vacantUnits,
    commissionPercentage: payload.commissionPercentage,
    commissionRecognitionBasis: payload.commissionRecognitionBasis,
    commissionPaymentMode: payload.commissionPaymentMode,
    tenantsPaysTo: payload.tenantsPaysTo,
    depositHeldBy: payload.depositHeldBy,
    landlords: landlord
      ? [{ landlordId: landlord._id, name: landlord.landlordName, contact: landlord.phoneNumber, isPrimary: true }]
      : [],
    notes: `${DEMO_TAG} - curated sample property for demo users`,
    createdBy: userId,
    updatedBy: userId,
  };

  return Property.findOneAndUpdate(
    { business: companyId, propertyCode: payload.propertyCode },
    { $set: update },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

async function upsertUnit(companyId, property, payload) {
  return Unit.findOneAndUpdate(
    { property: property._id, unitNumber: payload.unitNumber },
    {
      $set: {
        property: property._id,
        unitNumber: payload.unitNumber,
        unitType: payload.unitType,
        rent: payload.rent,
        deposit: payload.deposit,
        status: payload.status,
        isVacant: payload.isVacant,
        amenities: ["Water", "Security", "Parking"],
        billingFrequency: "monthly",
        description: `${property.propertyName} ${payload.unitNumber} demo unit`,
        business: companyId,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

async function upsertTenant(companyId, property, unit, payload, calendar, landlordId) {
  const tenant = await Tenant.findOneAndUpdate(
    { business: companyId, tenantCode: payload.tenantCode },
    {
      $set: {
        tenantCode: payload.tenantCode,
        name: payload.name,
        phone: payload.phone,
        idNumber: payload.idNumber,
        unit: unit._id,
        landlord: landlordId || null,
        rent: payload.rent,
        balance: payload.balance,
        status: "active",
        depositAmount: unit.deposit,
        depositHeldBy: payload.depositHeldBy || (property?.depositHeldBy === "landlord" ? "Landlord" : "Management Company"),
        paymentMethod: payload.paymentMethod,
        leaseType: "fixed",
        moveInDate: toDate(payload.moveInDate),
        moveOutDate: null,
        emergencyContact: {
          name: "Demo Emergency Contact",
          phone: "+254799000000",
          relationship: "Relative",
        },
        profileImage: "",
        business: companyId,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  await Unit.findByIdAndUpdate(unit._id, {
    $set: {
      status: "occupied",
      isVacant: false,
      lastTenant: tenant._id,
      vacantSince: null,
      daysVacant: 0,
      lastPaymentDate: calendar.currentMonthCollectionDate,
      nextPaymentDate: addDays(calendar.currentMonthDue, 30),
    },
  });

  return tenant;
}

async function seedInvoicesAndPayments({
  companyId,
  property,
  landlord,
  tenantsByUnit,
  userId,
  invoicePlans = [],
  paymentPlans = [],
}) {
  const chartAccounts = {
    "4100": await findSystemAccountByCode(companyId, "4100"),
    "4102": await findSystemAccountByCode(companyId, "4102"),
  };

  const invoicesByKey = {};

  for (const plan of invoicePlans) {
    const tenant = tenantsByUnit[plan.unitNumber];
    const chartAccount = chartAccounts[plan.chartAccountCode];
    if (!tenant || !chartAccount) continue;

    const invoice = await TenantInvoice.findOneAndUpdate(
      { business: companyId, invoiceNumber: plan.invoiceNumber },
      {
        $set: {
          business: companyId,
          property: property._id,
          landlord: landlord._id,
          tenant: tenant._id,
          unit: tenant.unit,
          invoiceNumber: plan.invoiceNumber,
          category: plan.category,
          amount: plan.amount,
          description: plan.description,
          invoiceDate: toDate(plan.invoiceDate),
          bookingDate: toDate(plan.bookingDate || plan.invoiceDate),
          dueDate: toDate(plan.dueDate),
          status: plan.status,
          createdBy: userId,
          chartAccount: chartAccount._id,
          postingStatus: "not_applicable",
          ledgerMode: "on_ledger",
          metadata: {
            demoSeedTag: DEMO_TAG,
            includeInLandlordStatement: true,
            depositHeldBy: plan.depositHeldBy || property.depositHeldBy || null,
            demoProfile: property.tenantsPaysTo === "landlord" ? DEMO_PROFILES.SELF_MANAGING_LANDLORD : DEMO_PROFILES.PROPERTY_MANAGER,
          },
          depositHeldBy: plan.depositHeldBy || property.depositHeldBy || null,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    await TenantInvoice.collection.updateOne(
      { _id: invoice._id },
      { $set: { createdAt: plan.invoiceDate, updatedAt: plan.invoiceDate } }
    );

    invoicesByKey[plan.key] = invoice;
  }

  for (const plan of paymentPlans) {
    const tenant = tenantsByUnit[plan.unitNumber];
    if (!tenant) continue;

    const allocations = (Array.isArray(plan.allocations) ? plan.allocations : []).reduce((items, allocation) => {
      if (!allocation || typeof allocation !== "object") return items;

      const invoice = allocation.invoiceKey ? invoicesByKey[allocation.invoiceKey] : null;
      if (!invoice?._id) return items;

      const appliedAmount = round2(allocation.appliedAmount);
      const invoiceAmount = round2(invoice.amount);

      items.push({
        invoice: invoice._id,
        invoiceNumber: invoice.invoiceNumber || "",
        category: invoice.category || "",
        priorityGroup: invoice.category === "RENT_CHARGE" ? "rent" : "utilities",
        utilityType: invoice.category === "UTILITY_CHARGE" ? allocation.utilityType || "Utility" : "",
        appliedAmount,
        beforeOutstanding: invoiceAmount,
        afterOutstanding: Math.max(0, invoiceAmount - appliedAmount),
        invoiceDate: invoice?.invoiceDate || invoice?.createdAt || plan.receiptDate || null,
        dueDate: invoice?.dueDate || plan.receiptDate || null,
        description: invoice?.description || "",
      });

      return items;
    }, []);

    const payment = await RentPayment.findOneAndUpdate(
      { business: companyId, referenceNumber: plan.referenceNumber },
      {
        $set: {
          tenant: tenant._id,
          unit: tenant.unit,
          amount: plan.amount,
          paymentType: "rent",
          paymentDate: plan.receiptDate,
          bankingDate: plan.receiptDate,
          recordDate: plan.receiptDate,
          dueDate: plan.receiptDate,
          referenceNumber: plan.referenceNumber,
          description: `${property.propertyName} demo receipt`,
          isConfirmed: Boolean(plan.isConfirmed),
          confirmedBy: plan.isConfirmed ? userId : null,
          confirmedAt: plan.isConfirmed ? plan.receiptDate : null,
          paymentMethod: plan.paymentMethod,
          cashbook: "Bank Accounts",
          paidDirectToLandlord: Boolean(plan.paidDirectToLandlord),
          receiptNumber: plan.receiptNumber,
          month: plan.receiptDate.getMonth() + 1,
          year: plan.receiptDate.getFullYear(),
          breakdown: computeReceiptBreakdown(allocations, plan.amount),
          allocations,
          allocationSummary: computeAllocationSummary(allocations, plan.amount),
          business: companyId,
          postingStatus: plan.postingStatus || "posted",
          ledgerMode: plan.ledgerMode || (plan.paidDirectToLandlord ? "off_ledger" : "on_ledger"),
          metadata: {
            demoSeedTag: DEMO_TAG,
            depositHeldBy: plan.depositHeldBy || property.depositHeldBy || null,
            demoProfile: property.tenantsPaysTo === "landlord" ? DEMO_PROFILES.SELF_MANAGING_LANDLORD : DEMO_PROFILES.PROPERTY_MANAGER,
          },
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    await RentPayment.collection.updateOne(
      { _id: payment._id },
      { $set: { createdAt: plan.receiptDate, updatedAt: plan.receiptDate } }
    );
  }

  return invoicesByKey;
}

async function createStatementSnapshot({ companyId, property, landlord, statement, userId, demoProfile = DEMO_PROFILES.PROPERTY_MANAGER }) {
  const entryCount =
    (statement?.workspace?.rows?.length || 0) +
    (statement?.workspace?.additionRows?.length || 0) +
    (statement?.workspace?.expenseRows?.length || 0) +
    (statement?.workspace?.directToLandlordRows?.length || 0);

  return LandlordStatement.create({
    business: companyId,
    property: property._id,
    landlord: landlord._id,
    periodStart: toDate(statement.periodStart),
    periodEnd: toDate(statement.periodEnd),
    statementNumber: statement.statementNumber,
    version: 1,
    status: "approved",
    openingBalance: 0,
    periodNet: round2(statement.workspace?.summary?.netStatement || statement.netAmountDue || 0),
    closingBalance: round2(statement.workspace?.summary?.netStatement || statement.netAmountDue || 0),
    currency: "KES",
    totalsByCategory: {
      rentInvoiced: round2(statement.totalRentInvoiced || 0),
      rentReceived: round2(statement.totalRentReceived || 0),
      expenses: round2(statement.totalExpenses || 0),
      commission: round2(statement.commissionAmount || 0),
    },
    entryCount,
    lineCount: 0,
    ledgerEntryCount: 0,
    ledgerEntryIds: [],
    generatedAt: new Date(),
    approvedAt: new Date(),
    approvedBy: userId,
    notes: `${DEMO_TAG} approved statement snapshot`,
    metadata: {
      seedTag: DEMO_TAG,
      demoProfile: resolveDemoProfile(demoProfile),
      workspace: statement.workspace || {},
    },
  });
}

async function upsertProcessedStatement({ companyId, property, landlord, statement, sourceStatement, userId }) {
  return ProcessedStatement.findOneAndUpdate(
    {
      business: companyId,
      property: property._id,
      landlord: landlord._id,
      sourceStatementNumber: statement.statementNumber,
    },
    {
      $set: {
        business: companyId,
        landlord: landlord._id,
        property: property._id,
        sourceStatement: sourceStatement?._id || null,
        sourceStatementNumber: statement.statementNumber,
        periodStart: toDate(statement.periodStart),
        periodEnd: toDate(statement.periodEnd),
        statementType: "final",
        totalRentInvoiced: statement.totalRentInvoiced,
        totalRentReceived: statement.totalRentReceived,
        totalRentReceivedByManager: statement.totalRentReceived,
        totalRentReceivedByLandlord: round2(statement.workspace?.summary?.directToLandlordCollections || 0),
        totalUtilitiesCollected: round2(statement.workspace?.summary?.utilityPassThroughAmount || 0),
        depositsHeldByManager: 0,
        depositsHeldByLandlord: 0,
        unappliedPayments: 0,
        commissionPercentage: statement.commissionPercentage,
        commissionBasis: statement.commissionBasis,
        commissionAmount: statement.commissionAmount,
        netAmountDue: round2(statement.workspace?.summary?.netStatement || statement.netAmountDue || 0),
        totalExpenses: statement.totalExpenses,
        recurringDeductions: 0,
        advanceRecoveries: 0,
        expensesByCategory: { repairs: statement.totalExpenses },
        netAfterExpenses: statement.netAfterExpenses,
        isNegativeStatement: false,
        amountPayableByLandlordToManager: 0,
        summaryBuckets: {
          receivable: statement.totalRentInvoiced,
          collected: statement.totalRentReceived,
          commission: statement.commissionAmount,
          net: round2(statement.workspace?.summary?.netStatement || statement.netAmountDue || 0),
        },
        workspaceSnapshot: statement.workspace || {},
        financialEvents: [],
        occupiedUnits: statement.occupiedUnits,
        vacantUnits: statement.vacantUnits,
        tenantRows: statement.tenantRows,
        status: statement.status,
        amountPaid: statement.amountPaid,
        balanceDue: Math.max(round2(statement.workspace?.summary?.netStatement || statement.netAmountDue || 0) - Number(statement.amountPaid || 0), 0),
        paymentHistory:
          statement.amountPaid > 0
            ? [
                {
                  amount: statement.amountPaid,
                  paymentDate: addDays(statement.periodEnd, 5),
                  paymentMethod: "bank_transfer",
                  paymentReference: `DPMT-${property.propertyCode}-001`,
                  notes: "Demo remittance payment",
                  createdBy: userId,
                },
              ]
            : [],
        paidDate: statement.amountPaid > 0 ? addDays(statement.periodEnd, 5) : null,
        paymentMethod: statement.amountPaid > 0 ? "bank_transfer" : null,
        paymentReference: statement.amountPaid > 0 ? `DPMT-${property.propertyCode}-001` : null,
        notes: `Sample processed landlord statement for ${property.propertyName}`,
        closedBy: userId,
        closedAt: addDays(statement.periodEnd, 1),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

async function upsertApprovedVoucher({ companyId, property, landlord, userId, dueDate }) {
  const accruedExpenses = await findSystemAccountByCode(companyId, "2120");
  const propertyControl = await ChartOfAccount.findOne({ business: companyId, code: `PCTRL-${property.propertyCode}` });
  if (!accruedExpenses || !propertyControl) return null;

  return PaymentVoucher.findOneAndUpdate(
    { business: companyId, voucherNo: `DPV-${property.propertyCode}-001` },
    {
      $set: {
        voucherNo: `DPV-${property.propertyCode}-001`,
        category: "landlord_maintenance",
        status: "approved",
        property: property._id,
        landlord: landlord._id,
        amount: property.propertyCode.startsWith("DGV") ? 12000 : 8500,
        dueDate,
        reference: `MAINT-${property.propertyCode}-001`,
        narration: `${property.propertyName} demo maintenance voucher`,
        liabilityAccount: accruedExpenses._id,
        debitAccount: propertyControl._id,
        approvedBy: userId,
        approvedAt: dueDate,
        business: companyId,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

async function upsertDraftVoucher({ companyId, property, landlord, dueDate }) {
  const accruedExpenses = await findSystemAccountByCode(companyId, "2120");
  const propertyControl = await ChartOfAccount.findOne({ business: companyId, code: `PCTRL-${property.propertyCode}` });
  if (!accruedExpenses || !propertyControl) return null;

  return PaymentVoucher.findOneAndUpdate(
    { business: companyId, voucherNo: `DPV-${property.propertyCode}-002` },
    {
      $set: {
        voucherNo: `DPV-${property.propertyCode}-002`,
        category: "landlord_other",
        status: "draft",
        property: property._id,
        landlord: landlord._id,
        amount: property.propertyCode.startsWith("DGV") ? 6500 : 4800,
        dueDate,
        reference: `OPS-${property.propertyCode}-002`,
        narration: `${property.propertyName} draft voucher awaiting approval`,
        liabilityAccount: accruedExpenses._id,
        debitAccount: propertyControl._id,
        business: companyId,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

async function upsertLease(companyId, tenant, unit, plan) {
  const agreementNumber = String(
    plan?.agreementNumber ||
      `DAGR-${String(tenant?.tenantCode || tenant?._id || "TENANT").replace(/\s+/g, "").toUpperCase()}-${String(
        unit?.unitNumber || unit?._id || "UNIT"
      )
        .replace(/\s+/g, "")
        .toUpperCase()}`
  ).trim();

  return Lease.findOneAndUpdate(
    { business: companyId, tenant: tenant._id, unit: unit._id },
    {
      $set: {
        agreementNumber,
        tenant: tenant._id,
        unit: unit._id,
        landlord: tenant?.landlord || null,
        startDate: plan.startDate,
        endDate: plan.endDate,
        rentAmount: plan.rentAmount,
        depositAmount: plan.depositAmount,
        paymentDueDay: plan.paymentDueDay,
        lateFee: plan.lateFee,
        terms: plan.terms,
        status: "active",
        signedByTenant: true,
        signedByLandlord: true,
        signedDate: plan.signedDate,
        business: companyId,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

async function upsertMaintenance(companyId, tenant, unit, plan) {
  return Maintenance.findOneAndUpdate(
    { business: companyId, unit: unit._id, title: plan.title },
    {
      $set: {
        unit: unit._id,
        tenant: tenant?._id || null,
        title: plan.title,
        description: plan.description,
        priority: plan.priority,
        status: plan.status,
        assignedTo: plan.assignedTo,
        estimatedCost: plan.estimatedCost,
        scheduledDate: plan.scheduledDate,
        business: companyId,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

async function seedLeasesAndMaintenance({ companyId, unitsByNumber, tenantsByUnit, leasePlans = [], maintenancePlans = [] }) {
  for (const plan of leasePlans) {
    const unit = unitsByNumber[plan.unitNumber];
    const tenant = tenantsByUnit[plan.unitNumber];
    if (!unit || !tenant) continue;
    await upsertLease(companyId, tenant, unit, plan);
  }

  for (const plan of maintenancePlans) {
    const unit = unitsByNumber[plan.unitNumber];
    const tenant = tenantsByUnit[plan.unitNumber];
    if (!unit) continue;
    await upsertMaintenance(companyId, tenant, unit, plan);
  }
}

async function createLedgerEntry({
  companyId,
  propertyId,
  landlordId,
  accountId,
  amount,
  direction,
  transactionDate,
  sourceTransactionId,
  notes,
  createdBy,
}) {
  return FinancialLedgerEntry.create({
    business: companyId,
    property: propertyId,
    landlord: landlordId,
    tenant: null,
    unit: null,
    sourceTransactionType: "system_migration",
    sourceTransactionId,
    transactionDate,
    statementPeriodStart: new Date(transactionDate.getFullYear(), transactionDate.getMonth(), 1, 0, 0, 0, 0),
    statementPeriodEnd: new Date(transactionDate.getFullYear(), transactionDate.getMonth() + 1, 0, 23, 59, 59, 999),
    category: "ADJUSTMENT",
    accountId,
    debit: direction === "debit" ? amount : 0,
    credit: direction === "credit" ? amount : 0,
    amount,
    direction,
    payer: "system",
    receiver: "system",
    notes,
    status: "approved",
    metadata: { seedTag: DEMO_TAG },
    createdBy,
    approvedBy: createdBy,
    approvedAt: transactionDate,
  });
}

async function seedReportLedgerEntries({ companyId, property, landlord, userId, calendar, demoProfile }) {
  const accountCodes = ["1110", "1200", "1230", "2100", "2110", "3100", "4200", "4210", "5200", "5201", "5202"];
  const accounts = {};

  for (const code of accountCodes) {
    accounts[code] = await findSystemAccountByCode(companyId, code);
  }

  const sequences = [
    {
      prefix: "OPEN",
      date: calendar.jan1,
      note: "Opening position for demo workspace",
      lines: [
        { code: "1110", direction: "debit", amount: 420000 },
        { code: "1200", direction: "debit", amount: 95000 },
        { code: "1230", direction: "debit", amount: 120000 },
        { code: "2100", direction: "credit", amount: 120000 },
        { code: "2110", direction: "credit", amount: 365000 },
        { code: "3100", direction: "credit", amount: 150000 },
      ],
    },
    {
      prefix: "FEB-COMM-1",
      date: calendar.feb12,
      note: "February management fee retained from landlord collections",
      lines: [
        { code: "2110", direction: "debit", amount: 16500 },
        { code: "4200", direction: "credit", amount: 16500 },
      ],
    },
    {
      prefix: "FEB-COMM-2",
      date: calendar.feb12,
      note: "February collection commission income",
      lines: [
        { code: "1110", direction: "debit", amount: 5000 },
        { code: "4210", direction: "credit", amount: 5000 },
      ],
    },
    {
      prefix: "FEB-OPS-1",
      date: calendar.feb12,
      note: "February operating expense",
      lines: [
        { code: "5200", direction: "debit", amount: 12000 },
        { code: "1110", direction: "credit", amount: 12000 },
      ],
    },
    {
      prefix: "FEB-OPS-2",
      date: calendar.feb12,
      note: "February bank charges",
      lines: [
        { code: "5201", direction: "debit", amount: 1800 },
        { code: "1110", direction: "credit", amount: 1800 },
      ],
    },
    {
      prefix: "FEB-OPS-3",
      date: calendar.feb12,
      note: "February compliance cost",
      lines: [
        { code: "5202", direction: "debit", amount: 4200 },
        { code: "1110", direction: "credit", amount: 4200 },
      ],
    },
    {
      prefix: "MAR-COMM-1",
      date: calendar.mar8,
      note: "March management fee retained from landlord collections",
      lines: [
        { code: "2110", direction: "debit", amount: 18000 },
        { code: "4200", direction: "credit", amount: 18000 },
      ],
    },
    {
      prefix: "MAR-COMM-2",
      date: calendar.mar8,
      note: "March collection commission income",
      lines: [
        { code: "1110", direction: "debit", amount: 6500 },
        { code: "4210", direction: "credit", amount: 6500 },
      ],
    },
    {
      prefix: "MAR-OPS-1",
      date: calendar.mar8,
      note: "March operating expense",
      lines: [
        { code: "5200", direction: "debit", amount: 9500 },
        { code: "1110", direction: "credit", amount: 9500 },
      ],
    },
    {
      prefix: "MAR-OPS-2",
      date: calendar.mar8,
      note: "March bank charges",
      lines: [
        { code: "5201", direction: "debit", amount: 1200 },
        { code: "1110", direction: "credit", amount: 1200 },
      ],
    },
    {
      prefix: "APR-COMM-1",
      date: calendar.currentMonthCollectionDate,
      note: "Current month management fee retained from landlord collections",
      lines: [
        { code: "2110", direction: "debit", amount: 14800 },
        { code: "4200", direction: "credit", amount: 14800 },
      ],
    },
    {
      prefix: "APR-COMM-2",
      date: calendar.currentMonthCollectionDate,
      note: "Current month collection commission income",
      lines: [
        { code: "1110", direction: "debit", amount: 4200 },
        { code: "4210", direction: "credit", amount: 4200 },
      ],
    },
    {
      prefix: "APR-OPS-1",
      date: calendar.currentMonthCollectionDate,
      note: "Current month operating expense",
      lines: [
        { code: "5200", direction: "debit", amount: 8700 },
        { code: "1110", direction: "credit", amount: 8700 },
      ],
    },
    {
      prefix: "APR-OPS-2",
      date: calendar.currentMonthCollectionDate,
      note: "Current month compliance cost",
      lines: [
        { code: "5202", direction: "debit", amount: 2500 },
        { code: "1110", direction: "credit", amount: 2500 },
      ],
    },
  ];

  const COMMISSION_PREFIXES = ["FEB-COMM-1", "FEB-COMM-2", "MAR-COMM-1", "MAR-COMM-2", "APR-COMM-1", "APR-COMM-2"];
  const filteredSequences = demoProfile === DEMO_PROFILES.SELF_MANAGING_LANDLORD
    ? sequences.filter((seq) => !COMMISSION_PREFIXES.includes(seq.prefix))
    : sequences;

  for (const sequence of filteredSequences) {
    for (let index = 0; index < sequence.lines.length; index += 1) {
      const line = sequence.lines[index];
      const account = accounts[line.code];
      if (!account) continue;

      await createLedgerEntry({
        companyId,
        propertyId: property._id,
        landlordId: landlord._id,
        accountId: account._id,
        amount: line.amount,
        direction: line.direction,
        transactionDate: sequence.date,
        sourceTransactionId: `${sequence.prefix}-${index + 1}`,
        notes: sequence.note,
        createdBy: userId,
      });
    }
  }

  await aggregateChartOfAccountBalances(companyId);
}


async function seedLandlordStandingOrders({ companyId, property, landlord, userId, standingOrderPlans = [] }) {
  if (!Array.isArray(standingOrderPlans) || standingOrderPlans.length === 0) return [];

  const bankAccount = await findSystemAccountByCode(companyId, "1110");
  const mpesaAccount = await findSystemAccountByCode(companyId, "1130");
  const rows = [];

  for (const plan of standingOrderPlans) {
    const cashbook = String(plan.paymentMethod || "").toLowerCase() === "mpesa" ? mpesaAccount : bankAccount;
    const doc = await LandlordStandingOrder.findOneAndUpdate(
      { business: companyId, referenceNo: plan.referenceNo },
      {
        $set: {
          business: companyId,
          landlord: landlord._id,
          property: property._id,
          title: plan.title,
          amount: plan.amount,
          frequency: plan.frequency || "monthly",
          dayOfMonth: plan.dayOfMonth || 5,
          startDate: toDate(plan.startDate),
          endDate: plan.endDate ? toDate(plan.endDate) : null,
          paymentMethod: plan.paymentMethod || "bank_transfer",
          cashbook: cashbook?._id || null,
          destination: plan.destination || {},
          narration: plan.narration || "",
          status: plan.status || "active",
          nextRunDate: plan.nextRunDate ? toDate(plan.nextRunDate) : null,
          lastRunDate: Array.isArray(plan.runHistory) && plan.runHistory.length ? toDate(plan.runHistory[0].runDate) : null,
          createdBy: userId,
          updatedBy: userId,
          notes: `${DEMO_TAG} standing order seed`,
          referenceNo: plan.referenceNo,
          standingOrderNo: plan.referenceNo,
          runHistory: Array.isArray(plan.runHistory) ? plan.runHistory : [],
          totalRuns: Array.isArray(plan.runHistory) ? plan.runHistory.filter((row) => !row?.cancelledAt).length : 0,
          totalProcessedAmount: round2(
            (Array.isArray(plan.runHistory) ? plan.runHistory : []).reduce((sum, row) => sum + Number(row?.amount || 0), 0)
          ),
          lastRunAt: Array.isArray(plan.runHistory) && plan.runHistory.length ? toDate(plan.runHistory[0].runDate) : null,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    rows.push(doc);
  }

  return rows;
}

async function seedLandlordAdvancements({ companyId, property, landlord, userId, advancementPlans = [] }) {
  if (!Array.isArray(advancementPlans) || advancementPlans.length === 0) return [];

  const bankAccount = await findSystemAccountByCode(companyId, "1110");
  const rows = [];

  for (const plan of advancementPlans) {
    const doc = await LandlordAdvancement.findOneAndUpdate(
      { business: companyId, referenceNo: plan.referenceNo },
      {
        $set: {
          business: companyId,
          landlord: landlord._id,
          property: property._id,
          advanceType: plan.advanceType || "future_recoverable",
          title: plan.title,
          referenceNo: plan.referenceNo,
          amount: plan.amount,
          interestRate: plan.interestRate || 0,
          interestType: plan.interestType || "simple_flat",
          scheduledInterestTotal: plan.scheduledInterestTotal || 0,
          interestRecoveredAmount: plan.interestRecoveredAmount || 0,
          totalRecoverableAmount: plan.totalRecoverableAmount || plan.amount,
          recoveredAmount: plan.recoveredAmount || 0,
          balanceOutstanding: plan.balanceOutstanding || Math.max(Number(plan.amount || 0) - Number(plan.recoveredAmount || 0), 0),
          payableSnapshotAmount: 0,
          payableAvailableAtDisbursement: 0,
          payableBalanceAfterDisbursement: 0,
          frequency: plan.frequency || "monthly",
          dayOfMonth: plan.dayOfMonth || 5,
          disbursementDate: toDate(plan.disbursementDate),
          startDate: toDate(plan.startDate),
          periodMonths: plan.periodMonths || null,
          gracePeriodMonths: plan.gracePeriodMonths || 0,
          endDate: plan.endDate ? toDate(plan.endDate) : null,
          paymentMethod: plan.paymentMethod || "bank_transfer",
          cashbook: bankAccount?._id || null,
          status: plan.status || "recovering",
          narration: plan.narration || "",
          notes: `${DEMO_TAG} advancement seed`,
          submittedAt: plan.submittedAt ? toDate(plan.submittedAt) : null,
          submittedBy: userId,
          approvedAt: plan.approvedAt ? toDate(plan.approvedAt) : null,
          approvedBy: userId,
          disbursedAt: plan.disbursedAt ? toDate(plan.disbursedAt) : null,
          createdBy: userId,
          updatedBy: userId,
          recoveryHistory: Array.isArray(plan.recoveryHistory) ? plan.recoveryHistory : [],
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    rows.push(doc);
  }

  return rows;
}

async function getDemoWorkspaceSeedValidation(companyId, demoProfile = DEMO_PROFILES.PROPERTY_MANAGER) {
  const resolvedProfile = resolveDemoProfile(demoProfile);
  const expectedProperties = getExpectedDemoPropertyCount(companyId, resolvedProfile);

  const [
    seededInvoices,
    seededPayments,
    seededPropertiesCount,
    seededStatementsCount,
    seededLandlordsCount,
  ] = await Promise.all([
    TenantInvoice.find({
      business: companyId,
      "metadata.demoSeedTag": DEMO_TAG,
      "metadata.demoProfile": resolvedProfile,
    })
      .select("_id invoiceNumber invoiceDate createdAt")
      .lean(),
    RentPayment.find({
      business: companyId,
      "metadata.demoSeedTag": DEMO_TAG,
      "metadata.demoProfile": resolvedProfile,
    })
      .select("_id referenceNumber receiptNumber allocations")
      .lean(),
    Property.countDocuments({ business: companyId }).catch(() => 0),
    LandlordStatement.countDocuments({
      business: companyId,
      "metadata.seedTag": DEMO_TAG,
      "metadata.demoProfile": resolvedProfile,
    }).catch(() => 0),
    Landlord.countDocuments({ company: companyId }).catch(() => 0),
  ]);

  if (seededInvoices.length < expectedProperties) {
    return {
      valid: false,
      reason: `Expected seeded invoices for ${resolvedProfile}, found ${seededInvoices.length}.`,
    };
  }

  const invoiceIds = [];
  for (const payment of seededPayments) {
    const allocations = Array.isArray(payment?.allocations) ? payment.allocations : [];
    for (const allocation of allocations) {
      if (allocation?.invoice) {
        invoiceIds.push(String(allocation.invoice));
      }
      if (allocation?.invoice && !allocation?.invoiceDate) {
        return {
          valid: false,
          reason: `Seeded receipt ${payment?.receiptNumber || payment?.referenceNumber || payment?._id} has an allocation without invoiceDate.`,
        };
      }
    }
  }

  const uniqueInvoiceIds = [...new Set(invoiceIds.filter(Boolean))];
  if (uniqueInvoiceIds.length > 0) {
    const linkedInvoices = await TenantInvoice.find({
      business: companyId,
      _id: { $in: uniqueInvoiceIds },
    })
      .select("_id invoiceDate createdAt")
      .lean();

    const linkedInvoiceMap = new Map(linkedInvoices.map((invoice) => [String(invoice._id), invoice]));

    for (const payment of seededPayments) {
      const allocations = Array.isArray(payment?.allocations) ? payment.allocations : [];
      for (const allocation of allocations) {
        if (!allocation?.invoice) continue;

        const linkedInvoice = linkedInvoiceMap.get(String(allocation.invoice));
        if (!linkedInvoice) {
          return {
            valid: false,
            reason: `Seeded receipt ${payment?.receiptNumber || payment?.referenceNumber || payment?._id} references a missing invoice allocation.`,
          };
        }

        if (!linkedInvoice?.invoiceDate && !linkedInvoice?.createdAt && !allocation?.invoiceDate) {
          return {
            valid: false,
            reason: `Seeded receipt ${payment?.receiptNumber || payment?.referenceNumber || payment?._id} references an invoice without a usable invoiceDate.`,
          };
        }
      }
    }
  }

  if (seededPropertiesCount < expectedProperties) {
    return {
      valid: false,
      reason: `Expected ${expectedProperties} demo properties, found ${seededPropertiesCount}.`,
    };
  }

  // Self-managing landlord demo has no client landlords and therefore no statements or vouchers
  if (resolvedProfile !== DEMO_PROFILES.SELF_MANAGING_LANDLORD) {
    if (seededStatementsCount < expectedProperties) {
      return {
        valid: false,
        reason: `Expected ${expectedProperties} landlord statements, found ${seededStatementsCount}.`,
      };
    }

    if (seededLandlordsCount <= 0) {
      return {
        valid: false,
        reason: "No demo landlords found in the demo workspace.",
      };
    }
  }

  return {
    valid: true,
    reason: null,
  };
}

async function getExistingDemoSeedSummary(companyId, demoProfile = DEMO_PROFILES.PROPERTY_MANAGER) {
  const resolvedProfile = resolveDemoProfile(demoProfile);

  // Self-managing landlord demo has no statements — detect via seeded invoices instead
  if (resolvedProfile === DEMO_PROFILES.SELF_MANAGING_LANDLORD) {
    const existingInvoice = await TenantInvoice.findOne({
      business: companyId,
      "metadata.demoSeedTag": DEMO_TAG,
      "metadata.demoProfile": resolvedProfile,
    })
      .select("_id invoiceDate createdAt")
      .lean();

    if (!existingInvoice?._id) return null;
  } else {
    const existingSeed = await LandlordStatement.findOne({
      business: companyId,
      "metadata.seedTag": DEMO_TAG,
      "metadata.demoProfile": resolvedProfile,
    })
      .select("_id")
      .lean();

    if (!existingSeed) return null;
  }

  const seededInvoice = await TenantInvoice.findOne({
    business: companyId,
    "metadata.demoSeedTag": DEMO_TAG,
    "metadata.demoProfile": resolvedProfile,
  })
    .select("_id invoiceDate createdAt")
    .lean();

  if (!seededInvoice?._id) return null;

  const [
    landlords,
    properties,
    units,
    tenants,
    leases,
    maintenanceRequests,
    processedStatements,
    vouchers,
    standingOrders,
    advancements,
  ] = await Promise.all([
    Landlord.countDocuments({ company: companyId, notes: new RegExp(DEMO_TAG, "i") }).catch(() => 0),
    Property.countDocuments({ business: companyId, notes: new RegExp(DEMO_TAG, "i") }).catch(() => 0),
    Unit.countDocuments({ business: companyId }).catch(() => 0),
    Tenant.countDocuments({ business: companyId }).catch(() => 0),
    Lease.countDocuments({ business: companyId }).catch(() => 0),
    Maintenance.countDocuments({ business: companyId }).catch(() => 0),
    ProcessedStatement.countDocuments({ business: companyId }).catch(() => 0),
    PaymentVoucher.countDocuments({ business: companyId }).catch(() => 0),
    LandlordStandingOrder.countDocuments({ business: companyId }).catch(() => 0),
    LandlordAdvancement.countDocuments({ business: companyId }).catch(() => 0),
  ]);

  const propertyResults = await ProcessedStatement.find({ business: companyId })
    .select("property sourceStatement sourceStatementNumber")
    .lean();

  return {
    seeded: true,
    tag: DEMO_TAG,
    companyId,
    landlords,
    properties,
    units,
    tenants,
    leases,
    maintenanceRequests,
    processedStatements,
    vouchers,
    standingOrders,
    advancements,
    demoProfile: resolvedProfile,
    propertyResults: propertyResults.map((item) => ({
      propertyId: item.property || null,
      propertyCode: null,
      sourceStatementId: item.sourceStatement || null,
      processedStatementId: item._id || null,
      approvedVoucherId: null,
      draftVoucherId: null,
    })),
  };
}

async function resetDemoWorkspaceSeedData(companyId) {
  await Promise.all([
    FinancialLedgerEntry.deleteMany({ business: companyId }),
    ProcessedStatement.deleteMany({ business: companyId }),
    LandlordStatementLine.deleteMany({ business: companyId }),
    LandlordStatement.deleteMany({ business: companyId }),
    TenantInvoice.deleteMany({ business: companyId }),
    RentPayment.deleteMany({ business: companyId }),
    PaymentVoucher.deleteMany({ business: companyId }),
    LandlordStandingOrder.deleteMany({ business: companyId }),
    LandlordAdvancement.deleteMany({ business: companyId }),
    Lease.deleteMany({ business: companyId }),
    Maintenance.deleteMany({ business: companyId }),
    Tenant.deleteMany({ business: companyId }),
    Unit.deleteMany({ business: companyId }),
    Property.deleteMany({ business: companyId }),
    Landlord.deleteMany({ company: companyId }),
  ]);
}

function normalizeComparableText(value = "") {
  return String(value || "").trim().toLowerCase();
}

async function assertDemoWorkspaceCompany(companyId) {
  const company = await Company.findById(companyId)
    .select("companyName email isDemoWorkspace")
    .lean();

  if (!company) {
    throw new Error("Demo workspace company not found");
  }

  if (!company.isDemoWorkspace) {
    throw new Error(
      "Demo seed can only run against a dedicated demo workspace company flagged with isDemoWorkspace=true"
    );
  }

  return company;
}

async function runDemoWorkspaceSeed({ companyId, userId, resolvedProfile }) {
  const scopedSampleData = buildCompanyScopedSampleData(companyId, resolvedProfile);
  const landlordsByCode = {};

  for (const landlordData of scopedSampleData.landlords) {
    landlordsByCode[landlordData.landlordCode] = await upsertLandlord(companyId, userId, landlordData);
  }

  const propertyResults = [];
  const allUnits = [];
  const allTenants = [];
  const allMaintenances = [];
  const allLeases = [];
  const allVouchers = [];
  const allStandingOrders = [];
  const allAdvancements = [];

  for (const propertyData of scopedSampleData.properties) {
    const landlord = landlordsByCode[propertyData.landlordCode];
    const property = await upsertProperty(companyId, userId, landlord, propertyData);

    await ensurePropertyControlAccount({
      businessId: companyId,
      propertyId: property._id,
      propertyCode: property.propertyCode,
      propertyName: property.propertyName,
    });

    const unitsByNumber = {};
    for (const unitData of propertyData.units) {
      const unit = await upsertUnit(companyId, property, unitData);
      unitsByNumber[unitData.unitNumber] = unit;
      allUnits.push(unit);
    }

    const tenantsByUnit = {};
    for (const tenantData of propertyData.tenants) {
      const unit = unitsByNumber[tenantData.unitNumber];
      const tenant = await upsertTenant(companyId, property, unit, tenantData, scopedSampleData.calendar, landlord._id);
      tenantsByUnit[tenantData.unitNumber] = tenant;
      allTenants.push(tenant);
    }

    await Property.findByIdAndUpdate(property._id, {
      $set: {
        totalUnits: propertyData.units.length,
        occupiedUnits: propertyData.units.filter((u) => !u.isVacant).length,
        vacantUnits: propertyData.units.filter((u) => u.isVacant).length,
        notes: `${DEMO_TAG} - curated sample property for demo users`,
      },
    });

    await seedInvoicesAndPayments({
      companyId,
      property,
      landlord,
      tenantsByUnit,
      userId,
      invoicePlans: propertyData.invoicePlans,
      paymentPlans: propertyData.paymentPlans,
    });

    await seedLeasesAndMaintenance({
      companyId,
      unitsByNumber,
      tenantsByUnit,
      leasePlans: propertyData.leasePlans,
      maintenancePlans: propertyData.maintenancePlans,
    });

    // Statements, vouchers, standing orders, and advancements all require a landlord reference.
    // For the self-managing landlord profile no client landlords are seeded, so skip these.
    let sourceStatement = null;
    let processedStatement = null;
    let approvedVoucher = null;
    let draftVoucher = null;

    if (landlord) {
      sourceStatement = await createStatementSnapshot({
        companyId,
        property,
        landlord,
        statement: propertyData.statement,
        userId,
        demoProfile: resolvedProfile,
      });

      processedStatement = await upsertProcessedStatement({
        companyId,
        property,
        landlord,
        statement: propertyData.statement,
        sourceStatement,
        userId,
      });

      approvedVoucher = await upsertApprovedVoucher({
        companyId,
        property,
        landlord,
        userId,
        dueDate: addDays(propertyData.statement.periodEnd, 10),
      });

      draftVoucher = await upsertDraftVoucher({
        companyId,
        property,
        landlord,
        dueDate: scopedSampleData.calendar.voucherDueSoon,
      });
    }

    const standingOrders = await seedLandlordStandingOrders({
      companyId,
      property,
      landlord: landlord || {},
      userId,
      standingOrderPlans: landlord ? propertyData.standingOrderPlans : [],
    });

    const advancements = await seedLandlordAdvancements({
      companyId,
      property,
      landlord: landlord || {},
      userId,
      advancementPlans: landlord ? propertyData.advancementPlans : [],
    });

    const propertyLeases = await Lease.find({ business: companyId, unit: { $in: Object.values(unitsByNumber).map((item) => item._id) } }).lean();
    const propertyMaintenances = await Maintenance.find({ business: companyId, unit: { $in: Object.values(unitsByNumber).map((item) => item._id) } }).lean();
    allLeases.push(...propertyLeases);
    allMaintenances.push(...propertyMaintenances);
    if (approvedVoucher) allVouchers.push(approvedVoucher);
    if (draftVoucher) allVouchers.push(draftVoucher);
    allStandingOrders.push(...standingOrders);
    allAdvancements.push(...advancements);

    propertyResults.push({
      propertyId: property._id,
      propertyCode: property.propertyCode,
      sourceStatementId: sourceStatement?._id || null,
      processedStatementId: processedStatement?._id || null,
      approvedVoucherId: approvedVoucher?._id || null,
      draftVoucherId: draftVoucher?._id || null,
      standingOrderIds: standingOrders.map((item) => item?._id).filter(Boolean),
      advancementIds: advancements.map((item) => item?._id).filter(Boolean),
    });
  }

  const anchorPropertyCode = scopedSampleData.properties[0]?.propertyCode;
  const anchorLandlordCode = scopedSampleData.properties[0]?.landlordCode;
  const anchorProperty = await Property.findOne({ business: companyId, propertyCode: anchorPropertyCode });
  const anchorLandlord = landlordsByCode[anchorLandlordCode];

  if (anchorProperty && anchorLandlord) {
    await seedReportLedgerEntries({
      companyId,
      property: anchorProperty,
      landlord: anchorLandlord,
      userId,
      calendar: scopedSampleData.calendar,
      demoProfile: resolvedProfile,
    });
  }

  return {
    seeded: true,
    tag: DEMO_TAG,
    companyId,
    landlords: scopedSampleData.landlords.length,
    properties: scopedSampleData.properties.length,
    units: allUnits.length,
    tenants: allTenants.length,
    leases: allLeases.length,
    maintenanceRequests: allMaintenances.length,
    processedStatements: propertyResults.filter((r) => r.processedStatementId).length,
    vouchers: allVouchers.length,
    standingOrders: allStandingOrders.length,
    advancements: allAdvancements.length,
    demoProfile: resolvedProfile,
    propertyResults,
  };
}

export async function ensureDemoWorkspaceSeed({
  companyId,
  userId,
  demoProfile = DEMO_PROFILES.PROPERTY_MANAGER,
  forceReseed = false,
}) {
  if (!companyId) throw new Error("companyId is required to seed demo workspace data");
  if (!userId) throw new Error("userId is required to seed demo workspace data");

  await assertDemoWorkspaceCompany(companyId);
  await ensureSystemChartOfAccounts(companyId);

  const resolvedProfile = resolveDemoProfile(demoProfile);

  if (!forceReseed) {
    const existingSeedSummary = await getExistingDemoSeedSummary(companyId, resolvedProfile);
    if (existingSeedSummary) {
      const validation = await getDemoWorkspaceSeedValidation(companyId, resolvedProfile);
      if (validation?.valid) {
        return existingSeedSummary;
      }

      console.warn(
        `Demo workspace seed for ${resolvedProfile} failed integrity validation. Rebuilding workspace. ${validation?.reason || ""}`.trim()
      );
    }
  }

  await resetDemoWorkspaceSeedData(companyId);

  try {
    const seededWorkspace = await runDemoWorkspaceSeed({ companyId, userId, resolvedProfile });
    const validation = await getDemoWorkspaceSeedValidation(companyId, resolvedProfile);
    if (!validation?.valid) {
      throw new Error(validation?.reason || "Demo workspace seed validation failed after rebuild.");
    }
    return seededWorkspace;
  } catch (error) {
    console.warn("Demo seed failed on first attempt. Resetting workspace and retrying once.", error);
    await resetDemoWorkspaceSeedData(companyId);
    const seededWorkspace = await runDemoWorkspaceSeed({ companyId, userId, resolvedProfile });
    const validation = await getDemoWorkspaceSeedValidation(companyId, resolvedProfile);
    if (!validation?.valid) {
      throw new Error(validation?.reason || "Demo workspace seed validation failed after retry.");
    }
    return seededWorkspace;
  }
}

export default ensureDemoWorkspaceSeed;
