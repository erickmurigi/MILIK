import RentPayment from '../models/RentPayment.js';
import Unit from '../models/Unit.js';
import Property from '../models/Property.js';
import Landlord from '../models/Landlord.js';
import { documentPageHtml, formatMoney } from '../utils/printKitCore.js';
import { COMPANY_PRINT_FIELDS } from '../utils/printCompanyFields.js';
import { renderHtmlToPdf } from '../utils/pdfRender.js';

const pdfBufferCache = new Map();
const pdfRenderPromises = new Map();
const MAX_PDF_CACHE_ENTRIES = 24;

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';

const esc = (value = '') =>
  String(value || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

const humanizeSnake = (s = '') =>
  String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const rememberPdfBuffer = (cacheKey, buffer) => {
  if (!cacheKey || !buffer) return;
  pdfBufferCache.set(cacheKey, Buffer.from(buffer));
  while (pdfBufferCache.size > MAX_PDF_CACHE_ENTRIES) {
    pdfBufferCache.delete(pdfBufferCache.keys().next().value);
  }
};

const getCachedPdfBuffer = (cacheKey) => {
  if (!cacheKey || !pdfBufferCache.has(cacheKey)) return null;
  const cached = pdfBufferCache.get(cacheKey);
  pdfBufferCache.delete(cacheKey);
  pdfBufferCache.set(cacheKey, cached);
  return Buffer.from(cached);
};


// A receipt belongs to a unit's property; the property's primary landlord is the supplier.
const resolvePrimaryLandlordId = async (unitId) => {
  if (!unitId) return null;
  const unit = await Unit.findById(unitId).select('property').lean();
  if (!unit?.property) return null;
  const property = await Property.findById(unit.property).select('landlords').lean();
  const list = Array.isArray(property?.landlords) ? property.landlords : [];
  return (list.find((l) => l.isPrimary) || list[0])?.landlordId || null;
};

export const generateReceiptPdf = async (receiptId, businessId) => {
  // Cheap, indexed lookup (just enough to build the cache key and enforce access) so a cache
  // hit never pays for the full populated fetch below — that one only runs on an actual miss.
  const receiptStub = await RentPayment.findOne({ _id: receiptId, business: businessId })
    .select('_id updatedAt unit')
    .lean();

  if (!receiptStub) { const e = new Error('Receipt not found or access denied'); e.status = 404; throw e; }

  // The supplier block prints the landlord's name and KRA PIN, so the landlord's update time is
  // part of the key: editing the landlord must not leave a cached receipt with the old PIN.
  const stubLandlordId = await resolvePrimaryLandlordId(receiptStub.unit);
  const stubLandlord = stubLandlordId ? await Landlord.findById(stubLandlordId).select('updatedAt').lean() : null;
  const cacheKey = `receipt::${String(receiptStub._id)}::${receiptStub.updatedAt ? new Date(receiptStub.updatedAt).toISOString() : ''}::${stubLandlord?.updatedAt ? new Date(stubLandlord.updatedAt).toISOString() : ''}`;
  const cached = getCachedPdfBuffer(cacheKey);
  if (cached) return cached;

  if (pdfRenderPromises.has(cacheKey)) {
    return Buffer.from(await pdfRenderPromises.get(cacheKey));
  }

  const renderPromise = (async () => {
    const receipt = await RentPayment.findOne({ _id: receiptId, business: businessId })
      .populate('tenant', 'name email tenantCode phone')
      .populate({ path: 'unit', select: 'unitNumber name property', populate: { path: 'property', select: 'propertyName propertyCode address' } })
      .populate('business', COMPANY_PRINT_FIELDS)
      .lean();

    if (!receipt) { const e = new Error('Receipt not found or access denied'); e.status = 404; throw e; }

    // Normalise field names so the rest of the service works unchanged
    receipt.property = receipt.unit?.property || {};
    receipt.receiptDate = receipt.paymentDate || receipt.createdAt;

    const company = receipt.business || {};
    // The landlord is the supplier, so the letterhead carries the landlord's name, address and KRA
    // PIN. The company (the managing agent) is only the fallback when no landlord is linked.
    const landlordId = await resolvePrimaryLandlordId(receipt.unit?._id || receipt.unit);
    const landlord = landlordId
      ? await Landlord.findById(landlordId).select('landlordName taxPin postalAddress location phoneNumber email').lean()
      : null;
    const supplier = company;
    const tenant = receipt.tenant || {};
    const property = receipt.property || {};
    const unit = receipt.unit || {};
    const unitNumber = unit.unitNumber || unit.name || '';
    const currency = company.baseCurrency || 'KES';
    const money = (v) => `${currency} ${formatMoney(v)}`;

    const amount = Number(receipt.amount || 0);
    const confirmed = Boolean(receipt.isConfirmed);

    // Build allocation rows from allocationSummary
    const alloc = receipt.allocationSummary || {};
    const allocRows = [
      { label: 'Rent', amount: Number(alloc.rent || 0) },
      { label: 'Utilities', amount: Number(alloc.utility || 0) },
      { label: 'Security Deposit', amount: Number(alloc.deposit || 0) },
      { label: 'Late Penalty', amount: Number(alloc.latePenalty || 0) },
      { label: 'Debit Note', amount: Number(alloc.debitNote || 0) },
      { label: 'Other Charges', amount: Number(alloc.other || 0) },
      { label: 'Unapplied / Advance', amount: Number(alloc.unapplied || 0) },
    ].filter((r) => r.amount > 0);
    const rows = allocRows.length > 0
      ? allocRows.map((r) => ({ label: r.label, sub: '', amount: formatMoney(r.amount) }))
      : [{ label: humanizeSnake(receipt.paymentType || 'Payment'), sub: receipt.description || '', amount: formatMoney(amount) }];

    const preparedBy = receipt.confirmedBy?.name || '';
    const companyName = company.companyName || company.name || 'the company';

    const html = documentPageHtml({
      company: supplier,
      docType: 'Receipt',
      docNumber: receipt.receiptNumber || receipt.referenceNumber || '',
      status: confirmed ? { label: 'Confirmed', tone: 'success' } : { label: 'Pending confirmation', tone: 'warning' },
      watermark: confirmed ? 'PAID' : '',
      meta: [
        ['Date', formatDate(receipt.receiptDate || receipt.paymentDate || receipt.createdAt)],
        ['Method', humanizeSnake(receipt.paymentMethod || 'Payment')],
        ...(receipt.referenceNumber ? [['Reference', receipt.referenceNumber]] : []),
      ],
      parties: [
        {
          heading: 'Received from',
          name: tenant.name || '',
          lines: [tenant.tenantCode ? `Tenant code: ${tenant.tenantCode}` : '', tenant.phone || ''],
        },
        {
          heading: 'Property',
          name: property.propertyName || '',
          lines: [landlord?.landlordName ? `Landlord: ${landlord.landlordName}` : '', unitNumber ? `Unit: ${unitNumber}` : ''],
        },
      ],
      details: { heading: 'Payment', rows: [['Cashbook', receipt.cashbook || ''], ['Status', confirmed ? 'Confirmed' : 'Pending confirmation']] },
      table: {
        columns: [
          { label: 'Applied to', value: (r) => r.label, sub: (r) => r.sub },
          { label: `Amount (${currency})`, align: 'right', value: (r) => r.amount },
        ],
        rows,
      },
      totals: [{ label: 'Total received', value: money(amount), hero: true }],
      amountWords: { amount, currency },
      notes: [
        confirmed
          ? { heading: 'Payment confirmed', text: `This receipt confirms that the payment of ${money(amount)} was received by ${companyName}. Please keep it as proof of payment.` }
          : { heading: 'Pending confirmation', text: `This payment is awaiting confirmation by ${companyName}. Please keep this document until you receive the confirmed receipt.` },
      ],
      signatures: [{ label: 'Received by', name: preparedBy }],
      stamp: true,
      footerNote: 'Thank you for your payment.',
    });

    const pdfBuffer = await renderHtmlToPdf(html, 'Receipt PDF');
    rememberPdfBuffer(cacheKey, pdfBuffer);
    return pdfBuffer;
  })();

  pdfRenderPromises.set(cacheKey, renderPromise);
  try {
    return Buffer.from(await renderPromise);
  } finally {
    pdfRenderPromises.delete(cacheKey);
  }
};
