import TenantInvoiceNote from '../models/TenantInvoiceNote.js';
import { documentPageHtml, formatMoney } from '../utils/printKitCore.js';
import { COMPANY_PRINT_FIELDS } from '../utils/printCompanyFields.js';
import { renderHtmlToPdf } from '../utils/pdfRender.js';

const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

const categoryLabel = (category = '') => {
  const map = {
    RENT_CHARGE: 'Rent Charge',
    UTILITY_CHARGE: 'Utility Charge',
    DEPOSIT_CHARGE: 'Deposit',
    LATE_PENALTY_CHARGE: 'Late Penalty',
    OTHER_CHARGE: 'Other Charge',
  };
  return map[category] || String(category || '').replace(/_/g, ' ');
};

const WORDING = {
  DEBIT_NOTE: 'This debit note adds the amount above to the tenant account.',
  CREDIT_NOTE: 'This credit note reduces the tenant account by the amount above.',
};

/** Debit or credit note PDF. Same letterhead rule as invoices: the landlord is the supplier. */
export const generateNotePdf = async (noteId, businessId) => {
  const note = await TenantInvoiceNote.findOne({ _id: noteId, business: businessId })
    .populate('tenant', 'name email tenantCode phone')
    .populate('unit', 'unitNumber name')
    .populate('property', 'propertyName propertyCode')
    .populate('sourceInvoice', 'invoiceNumber')
    .populate('landlord', 'landlordName taxPin postalAddress location phoneNumber email')
    .populate('business', COMPANY_PRINT_FIELDS)
    .lean();

  if (!note) { const e = new Error('Note not found or access denied'); e.status = 404; throw e; }

  const company = note.business || {};
  const landlord = note.landlord && typeof note.landlord === 'object' ? note.landlord : null;
  const supplier = company;
  const tenant = note.tenant || {};
  const property = note.property || {};
  const unit = note.unit || {};
  const unitNumber = unit.unitNumber || unit.name || '';
  const propertyLabel = property.propertyName
    ? `${property.propertyName}${property.propertyCode ? ` (${property.propertyCode})` : ''}`
    : '';

  const isDebit = String(note.noteType || '').toUpperCase() === 'DEBIT_NOTE';
  const docType = isDebit ? 'Debit Note' : 'Credit Note';
  const currency = company.baseCurrency || 'KES';
  const amount = Math.abs(Number(note.amount || 0));
  const status = String(note.status || '').toLowerCase();
  const isVoid = ['cancelled', 'reversed'].includes(status);
  const statusLabel = status === 'reversed' ? 'Reversed' : status === 'cancelled' ? 'Cancelled' : isDebit ? 'Debit' : 'Credit';
  const statusTone = status === 'reversed' ? 'danger' : status === 'cancelled' ? 'neutral' : 'info';

  const html = documentPageHtml({
    company: supplier,
    docType,
    docNumber: note.noteNumber || '',
    status: { label: statusLabel, tone: statusTone },
    watermark: isVoid ? 'VOID' : '',
    meta: [
      ['Note date', formatDate(note.noteDate) || '—'],
      ['Source invoice', note.sourceInvoice?.invoiceNumber || '—'],
    ],
    parties: [
      {
        heading: 'Billed to',
        name: tenant.name || '',
        lines: [
          tenant.tenantCode ? `Tenant code: ${tenant.tenantCode}` : '',
          tenant.phone || '',
          tenant.email || '',
        ],
      },
      {
        heading: 'Property',
        name: propertyLabel,
        lines: [landlord?.landlordName ? `Landlord: ${landlord.landlordName}` : '', unitNumber ? `Unit: ${unitNumber}` : ''],
      },
    ],
    details: {
      heading: 'Note details',
      rows: [
        ['Type', docType],
        ['Category', categoryLabel(note.category)],
        ['Currency', currency],
      ],
    },
    table: {
      columns: [
        { label: 'Description', value: (r) => r.label, sub: (r) => r.sub },
        { label: `Amount (${currency})`, align: 'right', value: (r) => r.amount },
      ],
      rows: [
        { label: categoryLabel(note.category), sub: note.description || '', amount: formatMoney(amount) },
      ],
    },
    totals: [
      { label: isDebit ? 'Total debit' : 'Total credit', value: `${currency} ${formatMoney(amount)}`, hero: true },
    ],
    amountWords: { amount, currency },
    notes: [{ heading: isDebit ? 'Debit note' : 'Credit note', text: WORDING[String(note.noteType || '').toUpperCase()] || '' }],
    footerNote: 'Thank you for your business.',
  });

  return renderHtmlToPdf(html, docType);
};
