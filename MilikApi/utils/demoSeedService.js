import Company from "../models/Company.js";
import Landlord from "../models/Landlord.js";
import Property from "../models/Property.js";
import Unit from "../models/Unit.js";
import Tenant from "../models/Tenant.js";
import ProcessedStatement from "../models/ProcessedStatement.js";
import TenantInvoice from "../models/TenantInvoice.js";
import RentPayment from "../models/RentPayment.js";
import PaymentVoucher from "../models/PaymentVoucher.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
import { ensureSystemChartOfAccounts, findSystemAccountByCode } from "../services/chartOfAccountsService.js";
import { ensurePropertyControlAccount } from "../services/propertyAccountingService.js";

const DEMO_TAG = "MILIK_DEMO_SEED_V1";
const DEMO_WORKSPACE_NAME = "MILIK DEMO WORKSPACE";
const DEMO_WORKSPACE_EMAIL = "demo.workspace@milik.local";


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
      statement: {
        sourceStatementNumber: "DPS-GV-2026-02",
        periodStart: "2026-02-01",
        periodEnd: "2026-02-28",
        totalRentInvoiced: 95000,
        totalRentReceived: 75000,
        commissionPercentage: 10,
        commissionBasis: "received",
        commissionAmount: 7500,
        netAmountDue: 67500,
        occupiedUnits: 2,
        vacantUnits: 1,
        status: "part_paid",
        amountPaid: 40000,
        totalExpenses: 12000,
        netAfterExpenses: 55500,
        tenantRows: [
          { unit: "A1", tenantName: "John Kamau", rentPerMonth: 45000, openingBalance: 0, totalInvoiced: 45000, txnNo: "DINV-001", totalReceived: 45000, closingBalance: 0 },
          { unit: "A2", tenantName: "Mary Njeri", rentPerMonth: 50000, openingBalance: 0, totalInvoiced: 50000, txnNo: "DINV-002", totalReceived: 30000, closingBalance: 20000 },
        ],
      },
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
      statement: {
        sourceStatementNumber: "DPS-SR-2026-02",
        periodStart: "2026-02-01",
        periodEnd: "2026-02-28",
        totalRentInvoiced: 82000,
        totalRentReceived: 82000,
        commissionPercentage: 10,
        commissionBasis: "received",
        commissionAmount: 8200,
        netAmountDue: 73800,
        occupiedUnits: 2,
        vacantUnits: 1,
        status: "unpaid",
        amountPaid: 0,
        totalExpenses: 8500,
        netAfterExpenses: 65300,
        tenantRows: [
          { unit: "C1", tenantName: "Peter Kariuki", rentPerMonth: 38000, openingBalance: 0, totalInvoiced: 38000, txnNo: "DINV-003", totalReceived: 38000, closingBalance: 0 },
          { unit: "C2", tenantName: "Susan Achieng", rentPerMonth: 44000, openingBalance: 0, totalInvoiced: 44000, txnNo: "DINV-004", totalReceived: 44000, closingBalance: 0 },
        ],
      },
    },
  ],
};

const BALANCE_TEMPLATE = {
  "1110": 478000,
  "1200": 172000,
  "1230": 120000,
  "2100": 120000,
  "2110": 486000,
  "2120": 33500,
  "3100": 300000,
  "3200": 100000,
  "4200": 102000,
  "4210": 90000,
  "4300": 15000,
  "5200": 25000,
  "5201": 4500,
  "5202": 12500,
};

function getCompanySeedKey(companyId) {
  return String(companyId || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-6)
    .toUpperCase() || "DEMO01";
}

function suffixValue(base, suffix) {
  return `${String(base || "").trim()}-${suffix}`;
}

function buildCompanyScopedSampleData(companyId) {
  const seedKey = getCompanySeedKey(companyId);

  return {
    landlords: SAMPLE_DATA.landlords.map((item, index) => {
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
    }),
    properties: SAMPLE_DATA.properties.map((item, propertyIndex) => {
      const propertyNo = String(propertyIndex + 1).padStart(2, "0");
      const propertyCode = suffixValue(item.propertyCode, seedKey);
      const landlordCode = suffixValue(item.landlordCode, seedKey);

      return {
        ...item,
        propertyCode,
        lrNumber: suffixValue(item.lrNumber, seedKey),
        landlordCode,
        statement: {
          ...item.statement,
          sourceStatementNumber: suffixValue(item.statement?.sourceStatementNumber, seedKey),
          tenantRows: Array.isArray(item.statement?.tenantRows)
            ? item.statement.tenantRows.map((row, rowIndex) => ({
                ...row,
                txnNo: suffixValue(row.txnNo || `DINV-${propertyNo}-${rowIndex + 1}`, seedKey),
              }))
            : [],
        },
        tenants: Array.isArray(item.tenants)
          ? item.tenants.map((tenant, tenantIndex) => {
              const tenantNo = `${propertyNo}${String(tenantIndex + 1).padStart(2, "0")}`;
              return {
                ...tenant,
                tenantCode: suffixValue(tenant.tenantCode, seedKey),
                idNumber: `DMO-TN-${seedKey}-${tenantNo}`,
                phone: `+254711${seedKey.replace(/[^0-9]/g, "").padEnd(6, "0").slice(0, 4)}${String(tenantIndex + 1).padStart(3, "0")}`,
              };
            })
          : [],
      };
    }),
  };
}

function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}

async function upsertLandlord(companyId, userId, payload) {
  const update = {
    ...payload,
    company: companyId,
    createdBy: userId,
    status: "Active",
    portalAccess: "Disabled",
  };

  return Landlord.findOneAndUpdate(
    {
      company: companyId,
      $or: [
        { landlordCode: payload.landlordCode },
        { regId: payload.regId },
        { idNumber: payload.idNumber },
      ],
    },
    { $set: update },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

async function upsertProperty(companyId, userId, landlord, payload) {
  const update = {
    business: companyId,
    propertyCode: payload.propertyCode,
    propertyName: payload.propertyName,
    lrNumber: payload.lrNumber,
    propertyType: payload.propertyType,
    specification: payload.specification,
    country: "Kenya",
    townCityState: payload.townCityState,
    estateArea: payload.estateArea,
    roadStreet: payload.roadStreet,
    address: payload.address,
    accountLedgerType: "Property Control Ledger In GL",
    invoicePaymentTerms: "Please pay your invoice before due date to avoid penalty.",
    description: `${payload.propertyName} sample property for the Milik demo workspace`,
    totalUnits: payload.totalUnits,
    occupiedUnits: payload.occupiedUnits,
    vacantUnits: payload.vacantUnits,
    status: "active",
    commissionPercentage: payload.commissionPercentage,
    commissionRecognitionBasis: payload.commissionRecognitionBasis,
    commissionPaymentMode: payload.commissionPaymentMode,
    tenantsPaysTo: payload.tenantsPaysTo,
    depositHeldBy: payload.depositHeldBy,
    landlords: [
      {
        landlordId: landlord._id,
        name: landlord.landlordName,
        contact: landlord.phoneNumber,
        isPrimary: true,
      },
    ],
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

async function upsertTenant(companyId, property, unit, payload) {
  const tenant = await Tenant.findOneAndUpdate(
    { business: companyId, tenantCode: payload.tenantCode },
    {
      $set: {
        tenantCode: payload.tenantCode,
        name: payload.name,
        phone: payload.phone,
        idNumber: payload.idNumber,
        unit: unit._id,
        rent: payload.rent,
        balance: payload.balance,
        status: "active",
        depositAmount: unit.deposit,
        depositHeldBy: "Management Company",
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
      lastPaymentDate: new Date("2026-02-05"),
      nextPaymentDate: new Date("2026-03-05"),
    },
  });

  return tenant;
}

async function seedInvoicesAndPayments({ companyId, property, landlord, tenantsByUnit, userId }) {
  const rentIncomeAccount = await findSystemAccountByCode(companyId, "4100");
  const utilityIncomeAccount = await findSystemAccountByCode(companyId, "4102");

  const invoiceSpecs = [
    {
      invoiceNumber: `DINV-${property.propertyCode}-001`,
      unitNumber: Object.keys(tenantsByUnit)[0],
      category: "RENT_CHARGE",
      amount: tenantsByUnit[Object.keys(tenantsByUnit)[0]].rent,
      description: `${property.propertyName} monthly rent invoice`,
      invoiceDate: new Date("2026-02-01"),
      dueDate: new Date("2026-02-05"),
      status: "paid",
      chartAccount: rentIncomeAccount?._id,
    },
    {
      invoiceNumber: `DINV-${property.propertyCode}-002`,
      unitNumber: Object.keys(tenantsByUnit)[1],
      category: "UTILITY_CHARGE",
      amount: 2300,
      description: `${property.propertyName} utility recharge invoice`,
      invoiceDate: new Date("2026-02-01"),
      dueDate: new Date("2026-02-07"),
      status: "pending",
      chartAccount: utilityIncomeAccount?._id || rentIncomeAccount?._id,
    },
  ].filter((item) => item.unitNumber && item.chartAccount);

  for (const spec of invoiceSpecs) {
    const tenant = tenantsByUnit[spec.unitNumber];
    await TenantInvoice.findOneAndUpdate(
      { business: companyId, invoiceNumber: spec.invoiceNumber },
      {
        $set: {
          business: companyId,
          property: property._id,
          landlord: landlord._id,
          tenant: tenant._id,
          unit: tenant.unit,
          invoiceNumber: spec.invoiceNumber,
          category: spec.category,
          amount: spec.amount,
          description: spec.description,
          invoiceDate: spec.invoiceDate,
          dueDate: spec.dueDate,
          status: spec.status,
          createdBy: userId,
          chartAccount: spec.chartAccount,
          postingStatus: "not_applicable",
          ledgerMode: "on_ledger",
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  }

  const paymentSpecs = [
    {
      referenceNumber: `DRCP-${property.propertyCode}-001`,
      receiptNumber: `RCP-${property.propertyCode}-001`,
      unitNumber: Object.keys(tenantsByUnit)[0],
      amount: tenantsByUnit[Object.keys(tenantsByUnit)[0]].rent,
      paymentMethod: "mobile_money",
      receiptDate: new Date("2026-02-05"),
    },
  ].filter((item) => item.unitNumber);

  for (const spec of paymentSpecs) {
    const tenant = tenantsByUnit[spec.unitNumber];
    await RentPayment.findOneAndUpdate(
      { business: companyId, referenceNumber: spec.referenceNumber },
      {
        $set: {
          tenant: tenant._id,
          unit: tenant.unit,
          amount: spec.amount,
          paymentType: "rent",
          paymentDate: spec.receiptDate,
          bankingDate: spec.receiptDate,
          recordDate: spec.receiptDate,
          dueDate: new Date("2026-02-05"),
          referenceNumber: spec.referenceNumber,
          description: `${property.propertyName} demo rent receipt`,
          isConfirmed: true,
          confirmedBy: userId,
          confirmedAt: spec.receiptDate,
          paymentMethod: spec.paymentMethod,
          cashbook: "Bank Accounts",
          paidDirectToLandlord: false,
          receiptNumber: spec.receiptNumber,
          month: 2,
          year: 2026,
          breakdown: { rent: spec.amount, utilities: [], total: spec.amount },
          business: companyId,
          postingStatus: "posted",
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  }
}

async function upsertProcessedStatement({ companyId, property, landlord, statement, userId }) {
  return ProcessedStatement.findOneAndUpdate(
    {
      business: companyId,
      property: property._id,
      landlord: landlord._id,
      sourceStatementNumber: statement.sourceStatementNumber,
    },
    {
      $set: {
        business: companyId,
        landlord: landlord._id,
        property: property._id,
        sourceStatementNumber: statement.sourceStatementNumber,
        periodStart: toDate(statement.periodStart),
        periodEnd: toDate(statement.periodEnd),
        statementType: "final",
        totalRentInvoiced: statement.totalRentInvoiced,
        totalRentReceived: statement.totalRentReceived,
        totalRentReceivedByManager: statement.totalRentReceived,
        totalRentReceivedByLandlord: 0,
        totalUtilitiesCollected: 2300,
        depositsHeldByManager: 0,
        depositsHeldByLandlord: 0,
        unappliedPayments: 0,
        commissionPercentage: statement.commissionPercentage,
        commissionBasis: statement.commissionBasis,
        commissionAmount: statement.commissionAmount,
        netAmountDue: statement.netAmountDue,
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
          net: statement.netAmountDue,
        },
        financialEvents: [],
        occupiedUnits: statement.occupiedUnits,
        vacantUnits: statement.vacantUnits,
        tenantRows: statement.tenantRows,
        status: statement.status,
        amountPaid: statement.amountPaid,
        balanceDue: Math.max(statement.netAmountDue - statement.amountPaid, 0),
        paymentHistory:
          statement.amountPaid > 0
            ? [
                {
                  amount: statement.amountPaid,
                  paymentDate: new Date("2026-03-05"),
                  paymentMethod: "bank_transfer",
                  paymentReference: `DPMT-${property.propertyCode}-001`,
                  notes: "Demo remittance payment",
                  createdBy: userId,
                },
              ]
            : [],
        paidDate: statement.amountPaid > 0 ? new Date("2026-03-05") : null,
        paymentMethod: statement.amountPaid > 0 ? "bank_transfer" : null,
        paymentReference: statement.amountPaid > 0 ? `DPMT-${property.propertyCode}-001` : null,
        notes: `Sample processed landlord statement for ${property.propertyName}`,
        closedBy: userId,
        closedAt: new Date("2026-03-01"),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

async function upsertVoucher({ companyId, property, landlord, userId }) {
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
        amount: 8500,
        dueDate: new Date("2026-03-10"),
        reference: `MAINT-${property.propertyCode}-001`,
        narration: `${property.propertyName} demo maintenance voucher`,
        liabilityAccount: accruedExpenses._id,
        debitAccount: propertyControl._id,
        approvedBy: userId,
        approvedAt: new Date("2026-03-08"),
        business: companyId,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

async function applyDemoBalances(companyId, controlAccounts) {
  await ensureSystemChartOfAccounts(companyId);

  const baseUpdates = Object.entries(BALANCE_TEMPLATE).map(([code, balance]) => ({ code, balance }));
  const controlUpdates = controlAccounts.map((account, index) => ({
    code: account.code,
    balance: index === 0 ? 245000 : 182500,
  }));

  for (const item of [...baseUpdates, ...controlUpdates]) {
    await ChartOfAccount.findOneAndUpdate(
      { business: companyId, code: item.code },
      { $set: { balance: item.balance } },
      { new: true }
    );
  }
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

export async function ensureDemoWorkspaceSeed({ companyId, userId }) {
  if (!companyId) throw new Error("companyId is required to seed demo workspace data");
  if (!userId) throw new Error("userId is required to seed demo workspace data");

  await assertDemoWorkspaceCompany(companyId);

  await ensureSystemChartOfAccounts(companyId);

  const scopedSampleData = buildCompanyScopedSampleData(companyId);

  const landlordsByCode = {};
  for (const landlordData of scopedSampleData.landlords) {
    landlordsByCode[landlordData.landlordCode] = await upsertLandlord(companyId, userId, landlordData);
  }

  const propertyResults = [];
  const controlAccounts = [];

  for (const propertyData of scopedSampleData.properties) {
    const landlord = landlordsByCode[propertyData.landlordCode];
    const property = await upsertProperty(companyId, userId, landlord, propertyData);
    const controlAccount = await ensurePropertyControlAccount({
      businessId: companyId,
      propertyId: property._id,
      propertyCode: property.propertyCode,
      propertyName: property.propertyName,
    });
    controlAccounts.push(controlAccount);

    const unitsByNumber = {};
    for (const unitData of propertyData.units) {
      unitsByNumber[unitData.unitNumber] = await upsertUnit(companyId, property, unitData);
    }

    const tenantsByUnit = {};
    for (const tenantData of propertyData.tenants) {
      const unit = unitsByNumber[tenantData.unitNumber];
      tenantsByUnit[tenantData.unitNumber] = await upsertTenant(companyId, property, unit, tenantData);
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
    });

    const processedStatement = await upsertProcessedStatement({
      companyId,
      property,
      landlord,
      statement: propertyData.statement,
      userId,
    });

    const voucher = await upsertVoucher({ companyId, property, landlord, userId });

    propertyResults.push({
      propertyId: property._id,
      propertyCode: property.propertyCode,
      processedStatementId: processedStatement?._id || null,
      voucherId: voucher?._id || null,
    });
  }

  await applyDemoBalances(companyId, controlAccounts);

  return {
    seeded: true,
    tag: DEMO_TAG,
    companyId,
    landlords: scopedSampleData.landlords.length,
    properties: scopedSampleData.properties.length,
    units: scopedSampleData.properties.reduce((sum, item) => sum + item.units.length, 0),
    tenants: scopedSampleData.properties.reduce((sum, item) => sum + item.tenants.length, 0),
    processedStatements: scopedSampleData.properties.length,
    propertyResults,
  };
}

export default ensureDemoWorkspaceSeed;
