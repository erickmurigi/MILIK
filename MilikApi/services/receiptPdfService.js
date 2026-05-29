import { createPage, resetBrowser } from './browserService.js';
import Receipt from '../models/Receipts.js';

const pdfBufferCache = new Map();
const pdfRenderPromises = new Map();
const MAX_PDF_CACHE_ENTRIES = 24;
const MAX_CONCURRENT_PDF_RENDERS = 3;
const QUEUE_TIMEOUT_MS = 120_000;
const RENDER_TIMEOUT_MS = 90_000;
let activePdfRenderCount = 0;
const pdfRenderWaitQueue = [];

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';

const esc = (value = '') =>
  String(value || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

const humanizeSnake = (s = '') =>
  String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const withTimeout = (promise, ms, message) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);

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

const acquirePdfRenderSlot = async () => {
  if (activePdfRenderCount < MAX_CONCURRENT_PDF_RENDERS) {
    activePdfRenderCount += 1;
    return;
  }
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = pdfRenderWaitQueue.indexOf(resolve);
      if (idx !== -1) pdfRenderWaitQueue.splice(idx, 1);
      reject(new Error('PDF render queue timeout'));
    }, QUEUE_TIMEOUT_MS);
    pdfRenderWaitQueue.push(() => { clearTimeout(timer); resolve(); });
  });
  activePdfRenderCount += 1;
};

const releasePdfRenderSlot = () => {
  activePdfRenderCount = Math.max(0, activePdfRenderCount - 1);
  const next = pdfRenderWaitQueue.shift();
  if (next) next();
};

export const generateReceiptPdf = async (receiptId, businessId) => {
  const receipt = await Receipt.findOne({ _id: receiptId, business: businessId })
    .populate('tenant', 'name email tenantCode phone')
    .populate('property', 'propertyName propertyCode address')
    .populate('unit', 'unitNumber name')
    .populate('business', 'companyName name address phone email logo')
    .lean();

  if (!receipt) throw new Error('Receipt not found or access denied');

  const cacheKey = `receipt::${String(receipt._id)}::${receipt.updatedAt ? new Date(receipt.updatedAt).toISOString() : ''}`;
  const cached = getCachedPdfBuffer(cacheKey);
  if (cached) return cached;

  if (pdfRenderPromises.has(cacheKey)) {
    return Buffer.from(await pdfRenderPromises.get(cacheKey));
  }

  const renderPromise = (async () => {
    const company = receipt.business || {};
    const companyName = esc(company.companyName || company.name || 'Company');
    const companyAddress = esc(company.address || '');
    const companyPhone = esc(company.phone || '');
    const companyEmail = esc(company.email || '');
    const companyLogo = company.logo || '';

    const tenant = receipt.tenant || {};
    const tenantName = esc(tenant.name || '');
    const property = receipt.property || {};
    const propertyName = esc(property.propertyName || '');
    const unit = receipt.unit || {};
    const unitNumber = esc(unit.unitNumber || unit.name || '');

    const amount = Number(receipt.amount || 0);
    const confirmed = receipt.isConfirmed;
    const statusColor = confirmed ? '#16a34a' : '#d97706';
    const statusBgColor = confirmed ? '#dcfce7' : '#fef3c7';
    const statusLabel = confirmed ? 'CONFIRMED' : 'PENDING CONFIRMATION';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Receipt ${esc(receipt.receiptNumber || '')}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 13px; color: #0f172a; background: #fff; }
  .page { width: 794px; min-height: 1123px; margin: 0 auto; padding: 48px 56px; display: flex; flex-direction: column; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 16px; }
  .logo-block { display: flex; flex-direction: column; gap: 4px; }
  .logo-img { max-height: 60px; max-width: 150px; object-fit: contain; border-radius: 6px; }
  .logo-fb { width: 56px; height: 56px; border-radius: 10px; background: #0B3B2E; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 900; }
  .co-detail { font-size: 11px; color: #64748b; }
  .rcpt-title { text-align: right; }
  .rcpt-label { font-size: 38px; font-weight: 900; color: #0f172a; letter-spacing: -0.03em; line-height: 1; }
  .rcpt-number { font-size: 14px; color: #64748b; margin-top: 6px; }
  .divider { height: 2px; background: linear-gradient(90deg, #0B3B2E, #E65F1A); border-radius: 2px; margin: 16px 0 20px; }
  .body-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-bottom: 20px; }
  .sec-label { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.18em; color: #94a3b8; margin-bottom: 12px; }
  .fk { font-size: 10px; color: #94a3b8; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; margin-top: 8px; }
  .fv { font-size: 13px; font-weight: 700; color: #0f172a; }
  .fv.lg { font-size: 16px; font-weight: 800; }
  .status-badge { display: inline-block; padding: 4px 14px; border-radius: 6px; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 18px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  thead tr { background: #1e293b; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  th { padding: 10px 14px; text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #fff; }
  th.r { text-align: right; }
  tbody tr { border-bottom: 1px solid #f1f5f9; }
  td { padding: 11px 14px; font-size: 13px; color: #0f172a; }
  td.r { text-align: right; font-weight: 600; }
  .totals { width: 280px; margin-left: auto; border-top: 1px solid #e2e8f0; padding-top: 10px; }
  .t-row { display: flex; justify-content: space-between; padding: 7px 0; font-size: 13px; border-bottom: 1px solid #f8fafc; }
  .t-row .tl { color: #64748b; }
  .t-row .tv { font-weight: 700; }
  .t-row.grand { border-top: 2px solid #0f172a; border-bottom: none; padding-top: 12px; margin-top: 4px; }
  .t-row.grand .tl, .t-row.grand .tv { font-size: 15px; font-weight: 800; color: #0f172a; }
  .footer-note { margin-top: 28px; padding-top: 12px; border-top: 1px solid #f1f5f9; font-size: 11px; color: #94a3b8; }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="logo-block">
      ${companyLogo ? `<img class="logo-img" src="${esc(companyLogo)}" alt="${companyName}" />` : `<div class="logo-fb">${companyName.slice(0, 1).toUpperCase()}</div>`}
      ${companyAddress ? `<div class="co-detail">${companyAddress}</div>` : ''}
      ${companyPhone ? `<div class="co-detail">Tel: ${companyPhone}</div>` : ''}
      ${companyEmail ? `<div class="co-detail">${companyEmail}</div>` : ''}
    </div>
    <div class="rcpt-title">
      <div class="rcpt-label">RECEIPT</div>
      <div class="rcpt-number"># ${esc(receipt.receiptNumber || receipt.referenceNumber || '-')}</div>
    </div>
  </div>

  <div class="divider"></div>

  <div class="body-grid">
    <div>
      <div class="sec-label">Received From</div>
      <div class="fk">Tenant</div>
      <div class="fv lg">${tenantName}</div>
      ${propertyName ? `<div class="fk">Property</div><div class="fv">${propertyName}</div>` : ''}
      ${unitNumber ? `<div class="fk">Unit</div><div class="fv">${unitNumber}</div>` : ''}
    </div>
    <div>
      <div class="sec-label">Receipt Details</div>
      <div class="fk">Receipt Date</div>
      <div class="fv">${formatDate(receipt.receiptDate || receipt.paymentDate || receipt.createdAt)}</div>
      <div class="fk">Payment Method</div>
      <div class="fv">${esc(humanizeSnake(receipt.paymentMethod || ''))}</div>
      ${receipt.referenceNumber ? `<div class="fk">Reference</div><div class="fv">${esc(receipt.referenceNumber)}</div>` : ''}
      <div class="fk">Cashbook</div>
      <div class="fv">${esc(receipt.cashbook || 'Main Cashbook')}</div>
    </div>
  </div>

  <span class="status-badge" style="background:${statusBgColor};color:${statusColor};">${statusLabel}</span>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th class="r">Amount (KES)</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${esc(humanizeSnake(receipt.paymentType || 'Payment'))}${receipt.description ? `<br/><span style="font-size:11px;color:#64748b;font-weight:400;">${esc(receipt.description)}</span>` : ''}</td>
        <td class="r">${formatCurrency(amount)}</td>
      </tr>
    </tbody>
  </table>

  <div class="totals">
    <div class="t-row grand"><span class="tl">Total Received</span><span class="tv">KES ${formatCurrency(amount)}</span></div>
  </div>

  <div class="footer-note">
    This is an official receipt confirming payment received by ${companyName}.<br/>
    Generated by ${companyName} &bull; Milik Property Management System
  </div>
</div>
</body>
</html>`;

    await acquirePdfRenderSlot();
    let page = null;
    try {
      page = await createPage();
      page.setDefaultNavigationTimeout(30_000);
      page.setDefaultTimeout(30_000);
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const pdfBuffer = await withTimeout(
        page.pdf({ format: 'A4', printBackground: true, margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' } }),
        RENDER_TIMEOUT_MS,
        'Receipt PDF render timed out'
      );
      try { await page.close(); } catch { /* ignore */ }
      rememberPdfBuffer(cacheKey, pdfBuffer);
      return Buffer.from(pdfBuffer);
    } catch (error) {
      await resetBrowser();
      throw error;
    } finally {
      releasePdfRenderSlot();
    }
  })();

  pdfRenderPromises.set(cacheKey, renderPromise);
  try {
    return Buffer.from(await renderPromise);
  } finally {
    pdfRenderPromises.delete(cacheKey);
  }
};
