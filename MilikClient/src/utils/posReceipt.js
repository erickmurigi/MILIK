const fmt = (n) =>
  Number(n || 0).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const fmtDate = (iso) =>
  iso
    ? new Date(iso).toLocaleString("en-KE", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      })
    : "";

const esc = (str) =>
  String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/**
 * Opens a print-ready receipt in a new window.
 * Compatible with 80mm thermal printers (set printer paper size to 80mm roll).
 *
 * @param {object} sale      - POSSale document returned by the API
 * @param {object} company   - currentCompany from Redux (name, phone, email, etc.)
 * @param {object} ctx       - { locationName, tillName } from terminal state (fallback if not populated on sale)
 */
export function printReceipt(sale, company = {}, ctx = {}) {
  const bizName     = esc(company?.name       || "POS Terminal");
  const bizPhone    = esc(company?.phone      || company?.phoneNumber || "");
  const bizEmail    = esc(company?.email      || "");
  const bizAddress  = esc(company?.address    || company?.physicalAddress || "");

  const receiptNo   = esc(sale.receiptNumber  || "");
  const saleDate    = fmtDate(sale.createdAt);
  const cashier     = esc(sale.cashier?.name  || sale.cashier?.fullName || "");
  const locName     = esc(sale.location?.name || ctx.locationName || "");
  const tillName    = esc(sale.session?.till?.name || ctx.tillName || "");
  const custName    = esc(sale.customerName   || "");
  const custPhone   = esc(sale.customerPhone  || "");
  const saleNotes   = esc(sale.notes          || "");

  const lines       = sale.lines ?? [];
  const payments    = sale.payments ?? [];

  const linesHtml = lines
    .map((l) => {
      const hasDisc = Number(l.discount || 0) > 0;
      const discLine = hasDisc
        ? `<tr class="disc-row">
             <td colspan="2" class="indent text-muted">Discount</td>
             <td class="r text-muted">-${fmt(l.discount * l.qty)}</td>
           </tr>`
        : "";
      return `
        <tr class="item-row">
          <td class="product-name">${esc(l.productName)}</td>
          <td class="r qty-cell">×${l.qty}</td>
          <td class="r amount-cell">${fmt(l.lineTotal)}</td>
        </tr>
        ${discLine}`;
    })
    .join("");

  const hasDiscount = Number(sale.totalDiscount || 0) > 0;
  const hasVat      = Number(sale.totalVat      || 0) > 0;

  const totalsHtml = `
    ${hasDiscount ? `
    <tr>
      <td colspan="2">Subtotal</td>
      <td class="r">${fmt(sale.subtotal)}</td>
    </tr>
    <tr>
      <td colspan="2" class="text-muted">Discount</td>
      <td class="r text-muted">-${fmt(sale.totalDiscount)}</td>
    </tr>` : ""}
    ${hasVat ? `
    <tr>
      <td colspan="2" class="text-muted">VAT</td>
      <td class="r text-muted">${fmt(sale.totalVat)}</td>
    </tr>` : ""}
    <tr class="total-row">
      <td colspan="2"><strong>TOTAL</strong></td>
      <td class="r"><strong>KES ${fmt(sale.grandTotal)}</strong></td>
    </tr>`;

  const paymentsHtml = payments
    .map((p) => {
      const label = p.method === "mpesa" ? "M-Pesa"
        : p.method.charAt(0).toUpperCase() + p.method.slice(1);
      return `<tr>
        <td colspan="2">${label}</td>
        <td class="r">${fmt(p.amount)}</td>
      </tr>`;
    })
    .join("");

  const changeHtml =
    Number(sale.change || 0) > 0
      ? `<tr><td colspan="2" class="text-muted">Change</td><td class="r text-muted">${fmt(sale.change)}</td></tr>`
      : "";

  const customerHtml =
    custName || custPhone
      ? `<div class="section">
           ${custName  ? `<div><span class="label">Customer:</span> ${custName}</div>`  : ""}
           ${custPhone ? `<div><span class="label">Phone:</span> ${custPhone}</div>` : ""}
         </div>`
      : "";

  const notesHtml = saleNotes
    ? `<div class="section"><span class="label">Note:</span> ${saleNotes}</div>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Receipt ${receiptNo}</title>
  <style>
    @page {
      size: 80mm auto;
      margin: 4mm 4mm;
    }
    @media print {
      body { width: 72mm; }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: 11px;
      line-height: 1.5;
      color: #000;
      background: #fff;
      width: 72mm;
      padding: 2mm 1mm;
    }
    .center   { text-align: center; }
    .r        { text-align: right; }
    .bold     { font-weight: bold; }
    .text-muted { opacity: 0.65; }
    .indent   { padding-left: 8px; }

    .biz-name {
      font-size: 15px;
      font-weight: bold;
      text-align: center;
      letter-spacing: 0.5px;
      margin-bottom: 1px;
    }
    .biz-sub  { font-size: 10px; text-align: center; opacity: 0.8; }

    hr {
      border: none;
      border-top: 1px dashed #000;
      margin: 4px 0;
    }
    hr.solid  { border-top: 1px solid #000; }
    hr.double { border-top: 3px double #000; }

    .meta-table { width: 100%; }
    .meta-table td { padding: 0; font-size: 10px; }
    .meta-table td.label { white-space: nowrap; padding-right: 4px; }
    .meta-table td.r    { text-align: right; }

    .section  { margin: 3px 0; font-size: 10px; }
    .section .label { font-weight: bold; }

    .items-table { width: 100%; border-collapse: collapse; }
    .items-table th { font-size: 9px; text-align: left; padding-bottom: 2px; font-weight: bold; border-bottom: 1px solid #000; }
    .items-table th.r { text-align: right; }
    .items-table td { padding: 2px 0; vertical-align: top; font-size: 10.5px; }
    .product-name { word-break: break-word; max-width: 120px; }
    .qty-cell { white-space: nowrap; padding: 0 6px; }
    .amount-cell { white-space: nowrap; }
    .item-row + .disc-row td { font-size: 9.5px; }

    .totals-table  { width: 100%; border-collapse: collapse; }
    .totals-table td { padding: 1px 0; font-size: 10.5px; }
    .total-row td  { padding-top: 3px; font-size: 13px; border-top: 1px solid #000; }

    .payments-table { width: 100%; border-collapse: collapse; }
    .payments-table td { padding: 1px 0; font-size: 10.5px; }

    .footer {
      text-align: center;
      font-size: 10px;
      margin-top: 6px;
      line-height: 1.6;
    }
    .powered {
      text-align: center;
      font-size: 9px;
      opacity: 0.55;
      margin-top: 2px;
    }
    /* Extra whitespace at bottom so thermal paper feeds past the cutter */
    .feed { height: 20mm; }
  </style>
</head>
<body>

  <!-- Business Header -->
  <div class="biz-name">${bizName}</div>
  ${bizAddress ? `<div class="biz-sub">${bizAddress}</div>` : ""}
  ${bizPhone   ? `<div class="biz-sub">Tel: ${bizPhone}</div>` : ""}
  ${bizEmail   ? `<div class="biz-sub">${bizEmail}</div>` : ""}

  <hr class="double">

  <!-- Receipt Meta -->
  <table class="meta-table">
    <tr>
      <td class="label">Receipt&nbsp;#</td>
      <td class="r bold">${receiptNo}</td>
    </tr>
    <tr>
      <td class="label">Date</td>
      <td class="r">${saleDate}</td>
    </tr>
    ${locName  ? `<tr><td class="label">Branch</td><td class="r">${locName}</td></tr>` : ""}
    ${tillName ? `<tr><td class="label">Till</td><td class="r">${tillName}</td></tr>` : ""}
    ${cashier  ? `<tr><td class="label">Cashier</td><td class="r">${cashier}</td></tr>` : ""}
  </table>

  <hr>

  <!-- Line Items -->
  <table class="items-table">
    <thead>
      <tr>
        <th>DESCRIPTION</th>
        <th class="r">QTY</th>
        <th class="r">AMOUNT</th>
      </tr>
    </thead>
    <tbody>
      ${linesHtml}
    </tbody>
  </table>

  <hr class="solid">

  <!-- Totals -->
  <table class="totals-table">
    ${totalsHtml}
  </table>

  <hr>

  <!-- Payments -->
  <table class="payments-table">
    ${paymentsHtml}
    ${changeHtml}
  </table>

  ${customerHtml || notesHtml ? "<hr>" : ""}
  ${customerHtml}
  ${notesHtml}

  <hr class="double">

  <div class="footer">
    Thank you for your business!<br>
    Please come again.
  </div>
  <div class="powered">Powered by Milik &bull; milikproperty.com</div>

  <div class="feed"></div>

  <script>
    window.addEventListener('load', function () {
      window.print();
      // Close the window after print dialog is dismissed
      window.addEventListener('afterprint', function () { window.close(); });
    });
  </script>
</body>
</html>`;

  const win = window.open("", "_blank", "width=420,height=640,menubar=no,toolbar=no");
  if (!win) {
    alert(
      "Pop-up blocked — please allow pop-ups for this site to print receipts, then try again."
    );
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
