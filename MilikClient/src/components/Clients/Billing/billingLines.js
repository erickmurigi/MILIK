// UI line <-> API line mapping and validation for the line editor (LineItemsEditor.jsx).
import { newLineKey } from './billingShared';

export const blankLine = (defaultTaxCodeKey = '', mode = 'contract') => ({
  key: newLineKey(),
  lineKey: '',
  itemName: '',
  description: '',
  quantity: '1',
  unitPrice: '',
  discountPercent: '',
  taxCodeKey: defaultTaxCodeKey,
  billingFrequency: mode === 'invoice' ? 'one_off' : 'monthly',
  billingTiming: 'advance',
  revenueRecognition: 'on_invoice',
  incomeAccount: '',
  startDate: '',
  endDate: '',
  servicePeriodStart: '',
  servicePeriodEnd: '',
  open: false,
});

/** UI line → API contract/quote line. */
export const toContractLine = (l) => ({
  ...(l.lineKey ? { lineKey: l.lineKey } : {}),
  itemName: l.itemName.trim(),
  description: l.description.trim(),
  quantity: Number(l.quantity || 0),
  unitPrice: Number(l.unitPrice || 0),
  discountPercent: Number(l.discountPercent || 0),
  taxCodeKey: l.taxCodeKey || null,
  billingFrequency: l.billingFrequency,
  billingTiming: l.billingTiming,
  revenueRecognition: l.revenueRecognition,
  incomeAccount: l.incomeAccount || null,
  startDate: l.startDate || null,
  endDate: l.endDate || null,
});

/** UI line → API invoice line item. */
export const toInvoiceLine = (l) => ({
  itemName: l.itemName.trim(),
  description: l.description.trim() || l.itemName.trim(),
  quantity: Number(l.quantity || 0),
  unitPrice: Number(l.unitPrice || 0),
  discountPercent: Number(l.discountPercent || 0),
  taxCodeKey: l.taxCodeKey || null,
  servicePeriodStart: l.servicePeriodStart || null,
  servicePeriodEnd: l.servicePeriodEnd || null,
  revenueRecognition: l.revenueRecognition,
  incomeAccount: l.incomeAccount || null,
});

const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
/** API line (contract/quote/invoice) → UI line. */
export const fromApiLine = (l) => ({
  key: newLineKey(),
  lineKey: l.lineKey || '',
  itemName: l.itemName || l.description || '',
  description: l.itemName ? (l.description || '') : '',
  quantity: String(l.quantity ?? 1),
  unitPrice: String(l.unitPrice ?? ''),
  discountPercent: l.discountPercent ? String(l.discountPercent) : '',
  taxCodeKey: l.taxCodeKey || '',
  billingFrequency: l.billingFrequency || 'monthly',
  billingTiming: l.billingTiming || 'advance',
  revenueRecognition: l.revenueRecognition || 'on_invoice',
  incomeAccount: (l.incomeAccount && typeof l.incomeAccount === 'object' ? l.incomeAccount._id : l.incomeAccount) || '',
  startDate: iso(l.startDate),
  endDate: iso(l.endDate),
  servicePeriodStart: iso(l.servicePeriodStart),
  servicePeriodEnd: iso(l.servicePeriodEnd),
  open: false,
});

/** Shared client-side validation; returns an error string or "". */
export const validateLines = (lines, mode) => {
  if (!lines.length) return 'Add at least one line';
  for (const [i, l] of lines.entries()) {
    if (!l.itemName.trim()) return `Line ${i + 1}: item / service name is required`;
    if (!(Number(l.quantity) > 0)) return `Line ${i + 1}: quantity must be greater than zero`;
    if (Number(l.discountPercent || 0) > 100) return `Line ${i + 1}: discount cannot exceed 100%`;
    if (mode === 'invoice') {
      if (l.servicePeriodStart && l.servicePeriodEnd && l.servicePeriodEnd < l.servicePeriodStart) return `Line ${i + 1}: service period ends before it starts`;
      if (l.revenueRecognition === 'straight_line' && !(l.servicePeriodStart && l.servicePeriodEnd)) return `Line ${i + 1}: straight-line recognition needs a service period`;
    } else {
      if (l.startDate && l.endDate && l.endDate < l.startDate) return `Line ${i + 1}: ends before it starts`;
      if (l.revenueRecognition === 'straight_line' && l.billingFrequency === 'one_off' && !(l.startDate && l.endDate)) return `Line ${i + 1}: a one-off straight-line line needs start and end dates`;
    }
  }
  return '';
};

