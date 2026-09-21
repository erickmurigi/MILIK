// Payslip printout on the shared print kit: company letterhead, employee card, earnings / deductions side by side, net pay
// banner with the amount in words, footer and the "Powered by Milik" stamp. Used by HR/Payslip.jsx and ESS/ESSPayslips.jsx.
import {
  BRAND, escapeHtml, formatMoney, formatDate, amountInWords, getCompanyDetails,
  letterheadHtml, footerHtml, wrapPage, pageBoxCss, openPrintWindow,
} from "./printKit";

const money = (v) => `KES ${formatMoney(v)}`;

const PAYSLIP_CSS = `
  .emp { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 16px; border: 1px solid #e2e8f0; border-radius: 4px; padding: 10px 14px; margin-bottom: 14px; background: #f8fafc; }
  .emp h4 { grid-column: 1 / -1; font-size: 8.5px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; color: ${BRAND.gold}; }
  .emp-l { font-size: 8.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #94a3b8; }
  .emp-v { font-size: 11.5px; font-weight: 800; color: ${BRAND.ink}; }
  .emp-v.mono { font-family: Consolas, monospace; font-size: 11px; }
  .pay { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 0; align-items: start; }
  table.pt { width: 100%; border-collapse: collapse; font-size: 11px; }
  table.pt thead th { background: ${BRAND.green}; color: #fff; text-align: left; padding: 7px 10px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
  table.pt thead th.num { text-align: right; }
  table.pt td { padding: 6px 10px; border-bottom: 1px solid #e2e8f0; }
  table.pt td.num { text-align: right; font-variant-numeric: tabular-nums; }
  table.pt td.neg { color: #b91c1c; }
  table.pt tbody tr:nth-child(even) td { background: #f8fafc; }
  table.pt tfoot td { padding: 7px 10px; font-weight: 800; background: #eef7f2; color: ${BRAND.green}; border-top: 2px solid ${BRAND.green}; }
  table.pt tfoot td.neg { color: #b91c1c; background: #fef2f2; }
  table.pt tr { page-break-inside: avoid; }
  .net { display: flex; justify-content: space-between; align-items: center; gap: 16px; background: ${BRAND.green}; color: #fff; padding: 14px 18px; margin: 14px 0 10px; border-radius: 4px; page-break-inside: avoid; }
  .net-l { font-size: 9px; font-weight: 700; letter-spacing: .22em; text-transform: uppercase; color: #a7f3d0; }
  .net-v { font-size: 24px; font-weight: 800; font-variant-numeric: tabular-nums; margin-top: 2px; }
  .net-info { text-align: right; font-size: 10.5px; color: #d1fae5; line-height: 1.55; }
  .net-info b { color: #fff; }
  .words { border-left: 3px solid ${BRAND.gold}; background: #fbf8ef; padding: 8px 12px; margin-bottom: 12px; font-size: 10.5px; page-break-inside: avoid; }
  .words b { display: block; font-size: 8.5px; letter-spacing: .16em; text-transform: uppercase; color: ${BRAND.gold}; margin-bottom: 2px; }
  .words i { font-style: normal; font-weight: 700; }
  .verify { font-size: 9px; color: #94a3b8; margin-top: 8px; text-align: center; }
`;

/**
 * spec: { company, payslip, snapshot, periodLabel, periodStatus }
 * payslip: { basicSalary, allowances[{name,amount}], paye, nhif, nssf, ahl, otherDeductions[{name,amount}], grossSalary, totalDeductions, netSalary }
 * snapshot: { name, employeeNumber, department, designation, kraPin, nhifNo, nssfNo, paymentMethod, bankName, bankAccountNumber, mpesaNumber }
 */
export const payslipPageHtml = ({ company, payslip: ps, snapshot: snap = {}, periodLabel = "", periodStatus = "" }) => {
  const co = getCompanyDetails(company);
  const empName = snap.name || "Employee";
  const empNo = snap.employeeNumber || "";
  const docNumber = [periodLabel, empNo].filter(Boolean).join(" · ");

  const earnings = [{ name: "Basic Salary", amount: ps.basicSalary }, ...(ps.allowances || [])];
  const deductions = [
    ps.paye > 0 && { name: "PAYE (Tax)", amount: ps.paye },
    ps.nhif > 0 && { name: "SHA / NHIF", amount: ps.nhif },
    ps.nssf > 0 && { name: "NSSF", amount: ps.nssf },
    ps.ahl > 0 && { name: "Housing Levy (AHL)", amount: ps.ahl },
    ...(ps.otherDeductions || []),
  ].filter(Boolean);

  const field = (label, value, mono) => value ? `<div><div class="emp-l">${escapeHtml(label)}</div><div class="emp-v${mono ? " mono" : ""}">${escapeHtml(value)}</div></div>` : "";
  const rows = (list, tone = "") => list.map((r) => `<tr><td>${escapeHtml(r.name)}</td><td class="num ${tone}">${escapeHtml(money(r.amount))}</td></tr>`).join("")
    || `<tr><td colspan="2" style="text-align:center;color:#94a3b8;padding:14px">None</td></tr>`;

  const statusTone = periodStatus === "Paid" ? "success" : periodStatus === "Approved" ? "info" : "neutral";
  const body = `
    ${letterheadHtml(company, {
      kicker: "Payslip", title: periodLabel || "Payslip", printed: false,
      status: periodStatus ? { label: periodStatus, tone: statusTone } : null,
      meta: [["Employee No.", empNo || "—"], ["Printed", formatDate(new Date())]],
    })}
    <div class="emp">
      <h4>Employee</h4>
      ${field("Employee Name", empName)}
      ${field("Employee No.", empNo, true)}
      ${field("Department", snap.department || "—")}
      ${field("Designation", snap.designation || "—")}
      ${field("KRA PIN", snap.kraPin, true)}
      ${field("SHA No.", snap.nhifNo, true)}
      ${field("NSSF No.", snap.nssfNo, true)}
    </div>
    <div class="pay">
      <table class="pt"><thead><tr><th>Earnings</th><th class="num">Amount</th></tr></thead>
        <tbody>${rows(earnings)}</tbody>
        <tfoot><tr><td>Gross Salary</td><td class="num">${escapeHtml(money(ps.grossSalary))}</td></tr></tfoot></table>
      <table class="pt"><thead><tr><th>Deductions</th><th class="num">Amount</th></tr></thead>
        <tbody>${rows(deductions, "neg")}</tbody>
        <tfoot><tr><td class="neg">Total Deductions</td><td class="num neg">${escapeHtml(money(ps.totalDeductions))}</td></tr></tfoot></table>
    </div>
    <div class="net">
      <div><div class="net-l">Net Pay</div><div class="net-v">${escapeHtml(money(ps.netSalary))}</div></div>
      ${snap.paymentMethod ? `<div class="net-info"><b>${escapeHtml(snap.paymentMethod)}</b>${snap.bankName ? `<br>${escapeHtml(snap.bankName)}` : ""}${snap.bankAccountNumber ? `<br>${escapeHtml(snap.bankAccountNumber)}` : ""}${snap.mpesaNumber ? `<br>${escapeHtml(snap.mpesaNumber)}` : ""}</div>` : ""}
    </div>
    <div class="words"><b>Net pay in words</b><i>${escapeHtml(amountInWords(ps.netSalary, co.currency))}</i></div>
    <div class="verify">This is a computer-generated payslip and requires no signature. Confidential — for ${escapeHtml(empName)} only.</div>
    ${footerHtml(company, { left: `${co.name}${docNumber ? ` · ${docNumber}` : ""}`, right: `${empName}${empNo ? ` · ${empNo}` : ""}` })}`;

  return wrapPage({
    title: `Payslip — ${empName}${periodLabel ? ` — ${periodLabel}` : ""}`,
    css: PAYSLIP_CSS,
    body,
    pageCss: pageBoxCss({ size: "A4", margin: "12mm 14mm 16mm", left: co.name }),
  });
};

/** Opens the print window and prints the payslip; returns the window, or null when pop-ups are blocked. */
export const printPayslipDocument = (spec) => {
  const win = openPrintWindow(null, "width=980,height=1100");
  if (!win) return null;
  win.document.open();
  win.document.write(payslipPageHtml(spec));
  win.document.close();
  setTimeout(() => { win.focus(); win.print(); }, 450);
  return win;
};
