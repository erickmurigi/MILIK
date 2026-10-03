import * as XLSX from 'xlsx';

// Take-on balance import: template, parser and row shape. The server re-validates every
// row (tenant, property, duplicates, future dates) — this only catches format problems early.

const BILL_ITEM_VALUES = {
  rent: 'rent',
  utility: 'utility',
  deposit: 'deposit',
  'late penalty': 'late_penalty',
  late_penalty: 'late_penalty',
  latepenalty: 'late_penalty',
};

const normalizeKey = (key = '') =>
  String(key).trim().toLowerCase().replace(/\*/g, '').replace(/[\s_\-/]+/g, '');

const getValue = (row, aliases = []) => {
  const normalizedRow = {};
  Object.keys(row || {}).forEach((key) => { normalizedRow[normalizeKey(key)] = row[key]; });
  for (const alias of aliases) {
    const match = normalizedRow[normalizeKey(alias)];
    if (match !== undefined && match !== null && String(match).trim() !== '') return match;
  }
  return '';
};

const parseDateCell = (value) => {
  if (value === '' || value === null || value === undefined) return '';
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      const d = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
      return Number.isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
    }
  }
  const raw = String(value).trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const native = new Date(raw);
  if (!Number.isNaN(native.getTime())) return native.toISOString().split('T')[0];
  return raw;
};

export const generateTakeOnBalancesTemplate = () => {
  const dataSheet = XLSX.utils.aoa_to_sheet([
    ['Tenant Code *', 'Tenant Name', 'Property Name', 'Bill Item *', 'Utility Type', 'Amount *', 'Posting Account Code', 'Effective Date *', 'Narration'],
    ['TT0011', '', 'KIRUBI 2', 'rent', '', 3000, '', '2026-09-30', 'Opening rent arrears'],
    ['TT0012', '', 'KIRUBI 2', 'rent', '', -1500, '1100', '2026-09-30', 'Opening rent prepayment'],
  ]);
  dataSheet['!cols'] = [
    { wch: 16 }, { wch: 26 }, { wch: 22 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 20 }, { wch: 16 }, { wch: 40 },
  ];

  const instructionsSheet = XLSX.utils.aoa_to_sheet([
    ['TAKE-ON BALANCE IMPORT INSTRUCTIONS'],
    [''],
    ['REQUIRED FIELDS (marked with *)'],
    ['• Tenant Code: the tenant account code shown in MILIK'],
    ['• Tenant Name: optional, for reference only (matching uses Tenant Code)'],
    ['• Bill Item: rent, utility, deposit or late_penalty (see Valid Values)'],
    ['• Amount: KES. Positive = opening debit (arrears owed). Negative = prepayment (opening credit).'],
    ['• Effective Date: YYYY-MM-DD, on or before today'],
    [''],
    ['CONDITIONAL FIELDS'],
    ['• Utility Type: REQUIRED when Bill Item is utility (e.g. Water, Garbage)'],
    ['• Posting Account Code: REQUIRED for negative amounts (prepayments) — the chart account code the credit posts to'],
    ['• Property Name: optional; if given it must match the tenant\'s property'],
    [''],
    ['RULES'],
    ['• A tenant can have only one debit take-on per bill item. Existing ones are rejected.'],
    ['• Prepayments (negative amounts) are not limited by that rule.'],
    ['• Each row is checked before anything is created; rows that fail are listed after the import.'],
  ]);
  instructionsSheet['!cols'] = [{ wch: 100 }];

  const dropdownSheet = XLSX.utils.aoa_to_sheet([
    ['Bill Item'],
    ['rent'],
    ['utility'],
    ['deposit'],
    ['late_penalty'],
  ]);
  dropdownSheet['!cols'] = [{ wch: 30 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, dataSheet, 'Data');
  XLSX.utils.book_append_sheet(workbook, instructionsSheet, 'Instructions & Examples');
  XLSX.utils.book_append_sheet(workbook, dropdownSheet, 'Valid Values');

  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};

export const downloadTakeOnBalancesTemplate = () => {
  const blob = generateTakeOnBalancesTemplate();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `MILIK_TakeOnBalances_Import_Template_${new Date().toISOString().split('T')[0]}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

export const parseTakeOnBalancesExcel = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array', cellDates: false });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { raw: true, defval: '' });

        if (jsonData.length === 0) {
          reject(new Error('No data found in Excel file'));
          return;
        }

        const mappedData = jsonData.map((row, index) => {
          const billItemRaw = String(getValue(row, ['Bill Item', 'billItem', 'BillItem']) || '').trim().toLowerCase();
          const amountRaw = getValue(row, ['Amount', 'amount']);
          const amount = parseFloat(String(amountRaw || '').replace(/,/g, ''));
          return {
            rowNumber: index + 2,
            tenantCode: String(getValue(row, ['Tenant Code', 'tenantCode']) || '').trim(),
            tenantName: String(getValue(row, ['Tenant Name', 'tenantName']) || '').trim(),
            propertyName: String(getValue(row, ['Property Name', 'propertyName', 'Property']) || '').trim(),
            billItem: BILL_ITEM_VALUES[billItemRaw] || '',
            billItemRaw,
            utilityType: String(getValue(row, ['Utility Type', 'utilityType']) || '').trim(),
            amount: Number.isFinite(amount) ? amount : Number.NaN,
            postingAccountCode: String(getValue(row, ['Posting Account Code', 'postingAccountCode', 'Account Code']) || '').trim(),
            effectiveDate: parseDateCell(getValue(row, ['Effective Date', 'effectiveDate', 'Date'])),
            narration: String(getValue(row, ['Narration', 'narration', 'Description', 'description']) || '').trim(),
          };
        });

        const validRecords = [];
        const errors = [];

        mappedData.forEach((record) => {
          const rowErrors = [];
          if (!record.tenantCode) {
            rowErrors.push('Tenant Code is required');
          }
          if (!record.billItem) {
            rowErrors.push(`Bill Item must be rent, utility, deposit or late_penalty (got "${record.billItemRaw || '(blank)'}")`);
          }
          if (record.billItem === 'utility' && !record.utilityType) {
            rowErrors.push('Utility Type is required for utility take-on balances');
          }
          if (!Number.isFinite(record.amount) || record.amount === 0) {
            rowErrors.push('Amount must be a non-zero number (negative = prepayment)');
          }
          if (record.amount < 0 && !record.postingAccountCode) {
            rowErrors.push('Posting Account Code is required for negative amounts (prepayments)');
          }
          if (!/^\d{4}-\d{2}-\d{2}$/.test(record.effectiveDate)) {
            rowErrors.push('Effective Date is required and must be a valid date (YYYY-MM-DD)');
          }

          if (rowErrors.length > 0) {
            errors.push({ row: record.rowNumber, errors: rowErrors, data: record });
          } else {
            validRecords.push({
              rowNumber: record.rowNumber,
              tenantCode: record.tenantCode || undefined,
              tenantName: record.tenantName || undefined,
              propertyName: record.propertyName || undefined,
              billItem: record.billItem,
              utilityType: record.utilityType || undefined,
              amount: record.amount,
              postingAccountCode: record.postingAccountCode || undefined,
              effectiveDate: record.effectiveDate,
              narration: record.narration || undefined,
            });
          }
        });

        resolve({
          valid: validRecords,
          errors,
          total: mappedData.length,
          validCount: validRecords.length,
          errorCount: errors.length,
        });
      } catch (error) {
        reject(new Error(`Failed to parse Excel file: ${error.message}`));
      }
    };

    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
};
