const fmtKES = (n) =>
  `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;

function emailShell(bodyContent) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<div style="max-width:620px;margin:0 auto;padding:24px 16px">
${bodyContent}
<p style="margin:20px 0 0;text-align:center;font-size:10px;color:#94a3b8">
  This is a computer-generated document. Please do not reply to this email.
</p>
</div>
</body>
</html>`;
}

function brandHeader(company, badgeText, headline, subline) {
  const { companyName = '', logo = '', roadStreet = '', town = '', email: ce = '', phoneNo = '' } = company;
  const addr = [roadStreet, town].filter(Boolean).join(', ');
  return `
<div style="background:#1B3D2F;border-radius:12px 12px 0 0;padding:20px 24px 18px">
  <table style="width:100%;border-collapse:collapse"><tr>
    <td style="vertical-align:middle">
      ${logo ? `<img src="${logo}" alt="${companyName}" style="height:38px;width:auto;border-radius:4px;display:block;margin-bottom:8px">` : ''}
      <p style="margin:0 0 2px;color:#6ee7b7;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.18em">${badgeText}</p>
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:900;line-height:1.2">${headline}</h1>
      ${subline ? `<p style="margin:4px 0 0;color:#a7f3d0;font-size:11px">${subline}</p>` : ''}
    </td>
    <td style="text-align:right;vertical-align:top;font-size:10px;color:#a7f3d0;line-height:1.7">
      <strong style="color:#fff;display:block">${companyName}</strong>
      ${addr  ? `${addr}<br>` : ''}
      ${ce    ? `${ce}<br>` : ''}
      ${phoneNo ? phoneNo : ''}
    </td>
  </tr></table>
</div>`;
}

// ── Payslip ───────────────────────────────────────────────────────────────────
const MONTHS = ['','January','February','March','April','May','June','July','August','September','October','November','December'];

export function buildPayslipEmail({ payslip, company }) {
  const snap   = payslip.snapshot || {};
  const period = payslip.payrollPeriod;
  const periodLabel = period ? `${MONTHS[period.month] || ''} ${period.year}` : '—';

  const earnRows = [
    `<tr><td style="padding:3px 0;font-size:12px;color:#334155">Basic Salary</td><td style="padding:3px 0;text-align:right;font-size:12px;font-family:monospace;color:#0f172a">${fmtKES(payslip.basicSalary)}</td></tr>`,
    ...(payslip.allowances || []).map((a) =>
      `<tr><td style="padding:3px 0;font-size:12px;color:#334155">${a.name}</td><td style="padding:3px 0;text-align:right;font-size:12px;font-family:monospace;color:#0f172a">${fmtKES(a.amount)}</td></tr>`
    ),
  ].join('');

  const dedRows = [
    payslip.paye ? `<tr><td style="padding:3px 0;font-size:12px;color:#334155">PAYE (Tax)</td><td style="padding:3px 0;text-align:right;font-size:12px;font-family:monospace;color:#dc2626">${fmtKES(payslip.paye)}</td></tr>` : '',
    payslip.nhif ? `<tr><td style="padding:3px 0;font-size:12px;color:#334155">SHA / NHIF</td><td style="padding:3px 0;text-align:right;font-size:12px;font-family:monospace;color:#dc2626">${fmtKES(payslip.nhif)}</td></tr>` : '',
    payslip.nssf ? `<tr><td style="padding:3px 0;font-size:12px;color:#334155">NSSF</td><td style="padding:3px 0;text-align:right;font-size:12px;font-family:monospace;color:#dc2626">${fmtKES(payslip.nssf)}</td></tr>` : '',
    payslip.ahl  ? `<tr><td style="padding:3px 0;font-size:12px;color:#334155">Housing Levy (AHL)</td><td style="padding:3px 0;text-align:right;font-size:12px;font-family:monospace;color:#dc2626">${fmtKES(payslip.ahl)}</td></tr>` : '',
    ...(payslip.otherDeductions || []).map((d) =>
      `<tr><td style="padding:3px 0;font-size:12px;color:#334155">${d.name}</td><td style="padding:3px 0;text-align:right;font-size:12px;font-family:monospace;color:#dc2626">${fmtKES(d.amount)}</td></tr>`
    ),
  ].join('');

  const payInfo = snap.paymentMethod ? `
    <td style="text-align:right">
      <p style="margin:0;color:#a7f3d0;font-size:11px;font-weight:700">${snap.paymentMethod}</p>
      ${snap.bankName          ? `<p style="margin:2px 0 0;color:#6ee7b7;font-size:10px">${snap.bankName}</p>` : ''}
      ${snap.bankAccountNumber ? `<p style="margin:2px 0 0;color:#6ee7b7;font-size:10px;font-family:monospace">${snap.bankAccountNumber}</p>` : ''}
      ${snap.mpesaNumber       ? `<p style="margin:2px 0 0;color:#6ee7b7;font-size:10px;font-family:monospace">${snap.mpesaNumber}</p>` : ''}
    </td>` : '';

  const body = `
${brandHeader(company, 'Pay Slip · Confidential', periodLabel, `For ${snap.name || 'Employee'}`)}

<div style="background:#fff;padding:16px 24px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0">
  <table style="width:100%;border-collapse:collapse">
    <tr><td style="padding:3px 0;font-size:10px;font-weight:700;text-transform:uppercase;color:#94a3b8;width:40%">Employee</td><td style="padding:3px 0;font-size:13px;font-weight:900;color:#0f172a">${snap.name || '—'}</td></tr>
    <tr><td style="padding:3px 0;font-size:10px;font-weight:700;text-transform:uppercase;color:#94a3b8">Employee No.</td><td style="padding:3px 0;font-size:12px;font-family:monospace;color:#334155">${snap.employeeNumber || '—'}</td></tr>
    <tr><td style="padding:3px 0;font-size:10px;font-weight:700;text-transform:uppercase;color:#94a3b8">Department</td><td style="padding:3px 0;font-size:12px;color:#334155">${snap.department || '—'}</td></tr>
    <tr><td style="padding:3px 0;font-size:10px;font-weight:700;text-transform:uppercase;color:#94a3b8">Designation</td><td style="padding:3px 0;font-size:12px;color:#334155">${snap.designation || '—'}</td></tr>
  </table>
</div>

<div style="background:#fff;padding:16px 24px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;border-top:1px solid #f1f5f9">
  <table style="width:100%;border-collapse:collapse"><tr>
    <td style="width:48%;vertical-align:top;padding-right:12px">
      <p style="margin:0 0 8px;font-size:9px;font-weight:900;color:#059669;text-transform:uppercase;letter-spacing:0.15em">Earnings</p>
      <table style="width:100%;border-collapse:collapse">
        ${earnRows}
        <tr><td colspan="2" style="padding:0"><div style="border-top:2px solid #e2e8f0;margin:6px 0 0"></div></td></tr>
        <tr>
          <td style="padding:5px 0 0;font-size:9px;font-weight:900;color:#64748b;text-transform:uppercase">Gross Salary</td>
          <td style="padding:5px 0 0;text-align:right;font-size:12px;font-weight:900;color:#0f172a;font-family:monospace">${fmtKES(payslip.grossSalary)}</td>
        </tr>
      </table>
    </td>
    <td style="width:4%"></td>
    <td style="width:48%;vertical-align:top;padding-left:12px;border-left:1px solid #f1f5f9">
      <p style="margin:0 0 8px;font-size:9px;font-weight:900;color:#dc2626;text-transform:uppercase;letter-spacing:0.15em">Deductions</p>
      <table style="width:100%;border-collapse:collapse">
        ${dedRows}
        <tr><td colspan="2" style="padding:0"><div style="border-top:2px solid #e2e8f0;margin:6px 0 0"></div></td></tr>
        <tr>
          <td style="padding:5px 0 0;font-size:9px;font-weight:900;color:#64748b;text-transform:uppercase">Total Deductions</td>
          <td style="padding:5px 0 0;text-align:right;font-size:12px;font-weight:900;color:#dc2626;font-family:monospace">${fmtKES(payslip.totalDeductions)}</td>
        </tr>
      </table>
    </td>
  </tr></table>
</div>

<div style="background:#1B3D2F;padding:20px 24px;border-radius:0 0 12px 12px">
  <table style="width:100%;border-collapse:collapse"><tr>
    <td>
      <p style="margin:0;color:#6ee7b7;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.2em">Net Pay</p>
      <p style="margin:4px 0 0;color:#fff;font-size:26px;font-weight:900;font-family:monospace">${fmtKES(payslip.netSalary)}</p>
    </td>
    ${payInfo}
  </tr></table>
</div>

<p style="margin:10px 0 0;text-align:center;font-size:10px;color:#94a3b8">
  This payslip is confidential. Generated ${new Date().toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' })}.
</p>`;

  return {
    subject: `Pay Slip — ${periodLabel} | ${company.companyName || 'HR'}`,
    html: emailShell(body),
    text: `Pay Slip — ${periodLabel}\nEmployee: ${snap.name}\nGross: ${fmtKES(payslip.grossSalary)}\nDeductions: ${fmtKES(payslip.totalDeductions)}\nNet Pay: ${fmtKES(payslip.netSalary)}`,
  };
}

// ── HR Letter ─────────────────────────────────────────────────────────────────
const LETTER_LABELS = {
  offer: 'Offer Letter', appointment: 'Appointment Letter', confirmation: 'Employment Confirmation',
  increment: 'Salary Increment Letter', promotion: 'Promotion Letter',
  warning_1: '1st Written Warning', warning_2: '2nd Written Warning', final_warning: 'Final Warning',
  termination: 'Termination Letter', reference: 'Reference Letter',
  suspension: 'Suspension Notice', reinstatement: 'Reinstatement Letter',
  redundancy: 'Redundancy Notice', custom: 'HR Letter',
};

export function buildLetterEmail({ letter, company }) {
  const emp      = letter.employee || {};
  const empName  = [emp.surname, emp.otherNames].filter(Boolean).join(' ') || 'Employee';
  const typeLabel = LETTER_LABELS[letter.letterType] || 'HR Letter';
  const isIssued  = letter.status === 'issued';
  const issuedOn  = isIssued
    ? new Date(letter.issuedDate || Date.now()).toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  const body = `
${brandHeader(company, typeLabel, letter.subject || empName, issuedOn ? `Issued ${issuedOn}` : 'Draft — Not Yet Issued')}

<div style="background:#fff;padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">
  ${!isIssued ? `<div style="background:#fef3c7;border-left:3px solid #f59e0b;padding:8px 12px;margin-bottom:16px;font-size:11px;color:#92400e;font-weight:700">
    DRAFT — This letter has not been officially issued.
  </div>` : ''}
  ${letter.body || '<p style="color:#64748b">No letter content available.</p>'}
</div>`;

  return {
    subject: `${letter.subject || typeLabel} — ${company.companyName || 'HR'}`,
    html: emailShell(body),
    text: `${letter.subject || typeLabel}\n\nPlease find your letter below.\n\n${company.companyName || 'HR Department'}`,
  };
}

// ── Payroll Register (send to management/approver) ────────────────────────────
export function buildRegisterEmail({ register, company }) {
  const { period = {}, rows = [], totals = {} } = register;
  const rowsHtml = rows.slice(0, 30).map((r, i) => `
    <tr style="background:${i % 2 === 0 ? '#fff' : '#f8fafc'}">
      <td style="padding:5px 8px;font-size:11px;font-family:monospace;color:#64748b">${r.employeeNumber}</td>
      <td style="padding:5px 8px;font-size:11px;font-weight:700;color:#0f172a">${r.name}</td>
      <td style="padding:5px 8px;font-size:11px;color:#334155">${r.department || '—'}</td>
      <td style="padding:5px 8px;font-size:11px;text-align:right;font-family:monospace">${fmtKES(r.grossSalary)}</td>
      <td style="padding:5px 8px;font-size:11px;text-align:right;font-family:monospace;color:#dc2626">${fmtKES(r.totalDeductions)}</td>
      <td style="padding:5px 8px;font-size:11px;text-align:right;font-family:monospace;font-weight:900;color:#059669">${fmtKES(r.netSalary)}</td>
    </tr>`).join('');

  const body = `
${brandHeader(company, 'Payroll Register', period.label || 'Payroll Register', `${rows.length} employees · ${period.status || ''}`)}

<div style="background:#fff;padding:16px 20px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0">
  <table style="width:100%;border-collapse:collapse">
    <tr>
      <td style="padding:6px 12px;background:#f8fafc;text-align:center">
        <p style="margin:0;font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase">Gross Payroll</p>
        <p style="margin:2px 0 0;font-size:16px;font-weight:900;color:#0f172a;font-family:monospace">${fmtKES(totals.grossSalary)}</p>
      </td>
      <td style="padding:6px 12px;background:#fef2f2;text-align:center">
        <p style="margin:0;font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase">Total Deductions</p>
        <p style="margin:2px 0 0;font-size:16px;font-weight:900;color:#dc2626;font-family:monospace">${fmtKES(totals.totalDeductions)}</p>
      </td>
      <td style="padding:6px 12px;background:#f0fdf4;text-align:center">
        <p style="margin:0;font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase">Net Pay</p>
        <p style="margin:2px 0 0;font-size:16px;font-weight:900;color:#059669;font-family:monospace">${fmtKES(totals.netSalary)}</p>
      </td>
    </tr>
  </table>
</div>

<div style="background:#fff;border:1px solid #e2e8f0;border-top:none;overflow:hidden;border-radius:0 0 12px 12px">
  <table style="width:100%;border-collapse:collapse">
    <thead>
      <tr style="background:#1B3D2F">
        <th style="padding:8px;text-align:left;font-size:9px;font-weight:700;color:#6ee7b7;text-transform:uppercase;letter-spacing:0.1em">No.</th>
        <th style="padding:8px;text-align:left;font-size:9px;font-weight:700;color:#6ee7b7;text-transform:uppercase;letter-spacing:0.1em">Employee</th>
        <th style="padding:8px;text-align:left;font-size:9px;font-weight:700;color:#6ee7b7;text-transform:uppercase;letter-spacing:0.1em">Dept</th>
        <th style="padding:8px;text-align:right;font-size:9px;font-weight:700;color:#6ee7b7;text-transform:uppercase;letter-spacing:0.1em">Gross</th>
        <th style="padding:8px;text-align:right;font-size:9px;font-weight:700;color:#6ee7b7;text-transform:uppercase;letter-spacing:0.1em">Deductions</th>
        <th style="padding:8px;text-align:right;font-size:9px;font-weight:700;color:#6ee7b7;text-transform:uppercase;letter-spacing:0.1em">Net Pay</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  ${rows.length > 30 ? `<p style="padding:8px 12px;font-size:10px;color:#94a3b8;text-align:center">+ ${rows.length - 30} more employees. Print the full register for the complete list.</p>` : ''}
</div>`;

  return {
    subject: `Payroll Register — ${period.label || 'Period'} | ${company.companyName || 'HR'}`,
    html: emailShell(body),
    text: `Payroll Register — ${period.label}\nEmployees: ${rows.length}\nGross: ${fmtKES(totals.grossSalary)}\nNet Pay: ${fmtKES(totals.netSalary)}`,
  };
}
