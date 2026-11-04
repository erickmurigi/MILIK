/**
 * KRA eTIMS OSCU (Online Sales Control Unit) client + payload builder.
 *
 * Wire format (KRA eTIMS OSCU/VSCU API spec): JSON POSTs, every call after
 * initialisation carrying `tin`, `bhfId` and `cmcKey` headers; every response
 * is { resultCd, resultMsg, resultDt, data } with resultCd "000" = success.
 *   selectInitOsdcInfo  — device initialisation → { info: { sdcId, mrcNo, cmcKey, ... } }
 *   selectCodeList      — code tables (cheap authenticated call → connection test)
 *   saveTrnsSalesOsdc   — sales/refund transaction → { rcptNo, intrlData, rcptSign, sdcDateTime, ... }
 *
 * Tax categories: A exempt, B 16% standard, C 0% zero-rated, D non-VAT, E 8%.
 * eTIMS amounts are tax-INCLUSIVE: taxblAmt is the inclusive line value and
 * taxAmt the VAT inside it.
 *
 * The provider is an interface ({ initialize, testConnection, saveSales }) so
 * tests and a future VSCU/third-party integrator can swap it out.
 */
import axios from "axios";
import { round2 } from "../../../utils/math.js";

export const ETIMS_DEFAULT_BASE_URLS = {
  sandbox: "https://etims-api-sbx.kra.go.ke/etims-api",
  production: "https://etims-api.kra.go.ke/etims-api",
};

export const ETIMS_QR_BASE_URLS = {
  sandbox: "https://etims-sbx.kra.go.ke/common/link/etims/receipt/indexEtimsReceiptData?Data=",
  production: "https://etims.kra.go.ke/common/link/etims/receipt/indexEtimsReceiptData?Data=",
};

export const ETIMS_PATHS = {
  initialize: "/selectInitOsdcInfo",
  codeList: "/selectCodeList",
  saveSales: "/saveTrnsSalesOsdc",
};

export const ETIMS_TAX_RATES = { A: 0, B: 16, C: 0, D: 0, E: 8 };
const TAX_CATEGORIES = Object.keys(ETIMS_TAX_RATES);

// eTIMS dates are local (EAT) yyyyMMdd / yyyyMMddHHmmss strings.
const eatParts = (value) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date(value));
  const get = (type) => parts.find((p) => p.type === type)?.value || "00";
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour") === "24" ? "00" : get("hour"), mi: get("minute"), s: get("second") };
};
export const etimsDate = (value) => { const p = eatParts(value); return `${p.y}${p.m}${p.d}`; };
export const etimsDateTime = (value) => { const p = eatParts(value); return `${p.y}${p.m}${p.d}${p.h}${p.mi}${p.s}`; };

// Map one invoice line to its eTIMS tax category and inclusive amounts.
export const classifyLine = (line, invoice) => {
  if (invoice.taxCalculation === "line") {
    const type = String(line.taxType || "").toLowerCase();
    const rate = Number(line.taxRate || 0);
    let category = "D";
    if (type === "vat" && rate > 0) category = Math.abs(rate - 8) < 0.001 ? "E" : "B";
    else if (type === "zero_rated") category = "C";
    else if (type === "exempt") category = "A";
    const tax = round2(Number(line.taxAmount || 0));
    const inclusive = round2(Number(line.totalAmount || Number(line.amount || 0) + tax));
    return { category, tax, inclusive };
  }
  // Legacy flat-rate invoice: one vatRate on taxable lines.
  const rate = Number(invoice.vatRate || 0);
  const net = round2(Number(line.amount || 0));
  if (line.taxable === false) return { category: "A", tax: 0, inclusive: net };
  if (rate <= 0) return { category: "C", tax: 0, inclusive: net };
  const tax = round2(net * (rate / 100));
  return { category: Math.abs(rate - 8) < 0.001 ? "E" : "B", tax, inclusive: round2(net + tax) };
};

/**
 * Builds a saveTrnsSalesOsdc body. `document` is an invoice-shaped object
 * ({ issueDate, lineItems, taxCalculation, vatRate }); a credit note is
 * passed through the same shape with receiptType "R" and orgInvcNo set.
 */
export const buildEtimsSalesPayload = ({ document, client = {}, settings = {}, invcNo, orgInvcNo = 0, receiptType = "S", refundReasonCode = null, remark = "", userName = "MILIK", companyName = "", now = new Date() }) => {
  const itemList = [];
  const totals = Object.fromEntries(TAX_CATEGORIES.map((c) => [c, { taxable: 0, tax: 0 }]));

  (document.lineItems || []).forEach((line, index) => {
    const { category, tax, inclusive } = classifyLine(line, document);
    const qty = Number(line.quantity || 1) * Number(line.prorationFactor ?? 1) || 1;
    const discountRate = Number(line.discountPercent || 0);
    const supply = discountRate > 0 && discountRate < 100 ? round2(inclusive / (1 - discountRate / 100)) : inclusive;
    const unitPrice = round2(supply / qty);
    totals[category].taxable = round2(totals[category].taxable + inclusive);
    totals[category].tax = round2(totals[category].tax + tax);
    itemList.push({
      itemSeq: index + 1,
      itemCd: line.etimsItemCode || settings.defaultItemCode || null,
      itemClsCd: line.etimsItemClassCode || settings.defaultItemClassCode || null,
      itemNm: String(line.itemName || line.description || "Service").slice(0, 200),
      bcd: null,
      pkgUnitCd: settings.defaultPkgUnitCode || "NT",
      pkg: qty,
      qtyUnitCd: settings.defaultQtyUnitCode || "U",
      qty,
      prc: unitPrice,
      splyAmt: supply,
      dcRt: discountRate,
      dcAmt: round2(supply - inclusive),
      isrccCd: null,
      isrccNm: null,
      isrcRt: null,
      isrcAmt: null,
      taxTyCd: category,
      taxblAmt: inclusive,
      taxAmt: tax,
      totAmt: inclusive,
    });
  });

  const totTaxblAmt = round2(TAX_CATEGORIES.reduce((s, c) => s + totals[c].taxable, 0));
  const totTaxAmt = round2(TAX_CATEGORIES.reduce((s, c) => s + totals[c].tax, 0));
  const payload = {
    tin: settings.kraPin,
    bhfId: settings.branchId || "00",
    invcNo,
    orgInvcNo: orgInvcNo || 0,
    custTin: client.taxPin || null,
    custNm: client.name || null,
    salesTyCd: "N",
    rcptTyCd: receiptType,
    pmtTyCd: "02", // on credit — the client pays against the invoice later
    salesSttsCd: "02",
    cfmDt: etimsDateTime(now),
    salesDt: etimsDate(document.issueDate || document.noteDate || now),
    stockRlsDt: null,
    cnclReqDt: null,
    cnclDt: null,
    rfdDt: receiptType === "R" ? etimsDateTime(now) : null,
    rfdRsnCd: receiptType === "R" ? refundReasonCode || "13" : null,
    totItemCnt: itemList.length,
    totTaxblAmt,
    totTaxAmt,
    totAmt: totTaxblAmt,
    prchrAcptcYn: "N",
    remark: remark ? String(remark).slice(0, 400) : null,
    regrId: userName,
    regrNm: userName,
    modrId: userName,
    modrNm: userName,
    receipt: {
      custTin: client.taxPin || null,
      custMblNo: client.phone || null,
      rptNo: invcNo,
      trdeNm: companyName || null,
      adrs: null,
      topMsg: companyName || null,
      btmMsg: "Thank you",
      prchrAcptcYn: "N",
    },
    itemList,
  };
  for (const c of TAX_CATEGORIES) {
    payload[`taxblAmt${c}`] = totals[c].taxable;
    payload[`taxRt${c}`] = ETIMS_TAX_RATES[c];
    payload[`taxAmt${c}`] = totals[c].tax;
  }
  return payload;
};

export const buildEtimsQrUrl = ({ environment = "sandbox", kraPin, branchId = "00", receiptSignature }) =>
  receiptSignature ? `${ETIMS_QR_BASE_URLS[environment] || ETIMS_QR_BASE_URLS.sandbox}${kraPin}${branchId}${receiptSignature}` : "";

export class EtimsResponseError extends Error {
  constructor(resultCd, resultMsg, response) {
    super(`eTIMS ${resultCd}: ${resultMsg || "request rejected"}`);
    this.resultCd = resultCd;
    this.response = response;
  }
}

export const createOscuProvider = ({ baseUrl = "", environment = "sandbox", kraPin, branchId = "00", deviceSerial = "", cmcKey = "", http = axios, timeout = 20000 }) => {
  const root = String(baseUrl || ETIMS_DEFAULT_BASE_URLS[environment] || ETIMS_DEFAULT_BASE_URLS.sandbox).replace(/\/+$/, "");
  const post = async (path, body, { authenticated = true } = {}) => {
    const headers = { "Content-Type": "application/json", tin: kraPin, bhfId: branchId };
    if (authenticated) headers.cmcKey = cmcKey;
    const { data } = await http.post(`${root}${path}`, body, { headers, timeout });
    // "001" = no data found: a valid, authenticated answer for list calls.
    if (!data || !["000", "001"].includes(String(data.resultCd))) {
      throw new EtimsResponseError(String(data?.resultCd || "ERR"), data?.resultMsg, data);
    }
    return data;
  };
  return {
    initialize: () => post(ETIMS_PATHS.initialize, { tin: kraPin, bhfId: branchId, dvcSrlNo: deviceSerial }, { authenticated: false }),
    testConnection: () => post(ETIMS_PATHS.codeList, { tin: kraPin, bhfId: branchId, lastReqDt: "20200101000000" }),
    saveSales: (payload) => post(ETIMS_PATHS.saveSales, payload),
  };
};
