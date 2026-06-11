const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' }) : '___________';

const fmtKES = (n) =>
  n != null ? `KES ${Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2 })}` : '___________';

// Shared CSS injected once into every letter
const CSS = `
  <style>
    body { font-family: Arial, sans-serif; font-size: 13px; color: #1a1a1a; line-height: 1.7; margin: 0; }
    .letter-body { max-width: 720px; margin: 0 auto; padding: 0 8px; }
    p { margin: 0 0 12px 0; }
    .ref-line { color: #555; font-size: 12px; margin-bottom: 16px; }
    .subject-line { font-weight: 700; margin-bottom: 16px; text-decoration: underline; }
    .sign-block { margin-top: 40px; }
    .sign-block .sign-line { display: inline-block; min-width: 200px; border-bottom: 1px solid #333; margin-bottom: 2px; }
    ul { margin: 8px 0 12px 20px; }
    li { margin-bottom: 4px; }
    .highlight { font-weight: 700; }
    .terms-table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    .terms-table td { padding: 5px 10px; border: 1px solid #ccc; vertical-align: top; font-size: 12px; }
    .terms-table td:first-child { font-weight: 700; width: 38%; background: #f8f8f8; }
  </style>
`;

const salutation = (emp) => `Dear ${emp.surname} ${emp.otherNames},`;

const signBlock = (company, signatory = null) => `
  <div class="sign-block">
    <p>Yours faithfully,<br><br>
    <span class="sign-line"></span><br>
    <strong>${signatory?.name || company.companyName || 'The Company'}</strong><br>
    <em>${signatory?.title || 'Human Resources'}</em></p>
    <br>
    <p><strong>Acknowledged &amp; Accepted:</strong><br><br>
    <span class="sign-line"></span><br>
    Name: _____________________________ &nbsp;&nbsp; Date: _______________</p>
  </div>
`;

// ── Template definitions ──────────────────────────────────────────────────────

export const LETTER_META = {
  offer: {
    label: 'Offer Letter',
    fields: [
      { key: 'position',       label: 'Position Offered',     type: 'text',   required: true },
      { key: 'department',     label: 'Department',           type: 'text',   required: true },
      { key: 'salary',         label: 'Monthly Gross Salary', type: 'number', required: true },
      { key: 'startDate',      label: 'Proposed Start Date',  type: 'date',   required: true },
      { key: 'probationMonths',label: 'Probation Period (months)', type: 'number', required: false, default: 3 },
      { key: 'reportingTo',    label: 'Reporting To',         type: 'text',   required: false },
      { key: 'location',       label: 'Work Location',        type: 'text',   required: false },
      { key: 'offerDeadline',  label: 'Offer Valid Until',    type: 'date',   required: false },
    ],
  },
  appointment: {
    label: 'Appointment Letter',
    fields: [
      { key: 'position',       label: 'Position',             type: 'text',   required: true },
      { key: 'department',     label: 'Department',           type: 'text',   required: true },
      { key: 'salary',         label: 'Monthly Gross Salary', type: 'number', required: true },
      { key: 'startDate',      label: 'Start Date',           type: 'date',   required: true },
      { key: 'probationMonths',label: 'Probation Period (months)', type: 'number', required: false, default: 3 },
      { key: 'reportingTo',    label: 'Reporting To',         type: 'text',   required: false },
    ],
  },
  confirmation: {
    label: 'Employment Confirmation',
    fields: [
      { key: 'effectiveDate',  label: 'Confirmation Effective Date', type: 'date',   required: true },
      { key: 'confirmedSalary',label: 'Confirmed Monthly Salary',    type: 'number', required: false },
      { key: 'confirmedPosition', label: 'Confirmed Position',       type: 'text',   required: false },
    ],
  },
  increment: {
    label: 'Salary Increment Letter',
    fields: [
      { key: 'currentSalary',  label: 'Current Gross Salary',    type: 'number', required: true },
      { key: 'newSalary',      label: 'New Gross Salary',        type: 'number', required: true },
      { key: 'effectiveDate',  label: 'Effective Date',          type: 'date',   required: true },
      { key: 'reason',         label: 'Reason for Increment',    type: 'text',   required: false },
    ],
  },
  promotion: {
    label: 'Promotion Letter',
    fields: [
      { key: 'currentPosition',label: 'Current Position',        type: 'text',   required: true },
      { key: 'newPosition',    label: 'New Position',            type: 'text',   required: true },
      { key: 'department',     label: 'Department',              type: 'text',   required: false },
      { key: 'currentSalary',  label: 'Current Gross Salary',    type: 'number', required: false },
      { key: 'newSalary',      label: 'New Gross Salary',        type: 'number', required: true },
      { key: 'effectiveDate',  label: 'Effective Date',          type: 'date',   required: true },
    ],
  },
  warning_1: {
    label: '1st Written Warning',
    fields: [
      { key: 'offence',        label: 'Nature of Offence/Misconduct', type: 'textarea', required: true },
      { key: 'incidentDate',   label: 'Date of Incident',             type: 'date',     required: false },
      { key: 'warningDate',    label: 'Warning Issue Date',           type: 'date',     required: true },
      { key: 'conditions',     label: 'Conditions / Expectations',    type: 'textarea', required: false },
    ],
  },
  warning_2: {
    label: '2nd Written Warning',
    fields: [
      { key: 'offence',        label: 'Nature of Offence/Misconduct', type: 'textarea', required: true },
      { key: 'incidentDate',   label: 'Date of Incident',             type: 'date',     required: false },
      { key: 'warningDate',    label: 'Warning Issue Date',           type: 'date',     required: true },
      { key: 'priorWarning',   label: 'Date of 1st Warning',         type: 'date',     required: false },
      { key: 'conditions',     label: 'Final Conditions / Expectations', type: 'textarea', required: false },
    ],
  },
  final_warning: {
    label: 'Final Written Warning',
    fields: [
      { key: 'offence',        label: 'Nature of Offence/Misconduct', type: 'textarea', required: true },
      { key: 'incidentDate',   label: 'Date of Incident',             type: 'date',     required: false },
      { key: 'warningDate',    label: 'Warning Issue Date',           type: 'date',     required: true },
      { key: 'conditions',     label: 'Final Warning Conditions',     type: 'textarea', required: false },
    ],
  },
  termination: {
    label: 'Termination Letter',
    fields: [
      { key: 'terminationDate',   label: 'Last Day of Employment', type: 'date',     required: true },
      { key: 'reason',            label: 'Reason for Termination', type: 'textarea', required: true },
      { key: 'noticePeriod',      label: 'Notice Period Given',    type: 'text',     required: false },
      { key: 'outstandingBenefits', label: 'Outstanding Benefits/Pay', type: 'textarea', required: false },
    ],
  },
  reference: {
    label: 'Reference / Recommendation Letter',
    fields: [
      { key: 'tenure',         label: 'Period of Employment (e.g. Jan 2020 – Dec 2023)', type: 'text', required: true },
      { key: 'position',       label: 'Last Held Position',        type: 'text',     required: true },
      { key: 'assessment',     label: 'Character & Performance Assessment', type: 'textarea', required: false },
      { key: 'addressedTo',    label: 'Addressed To (or "Whom it may concern")', type: 'text', required: false },
    ],
  },
  suspension: {
    label: 'Suspension Letter',
    fields: [
      { key: 'suspensionDate', label: 'Suspension Effective Date', type: 'date',     required: true },
      { key: 'reason',         label: 'Reason for Suspension',     type: 'textarea', required: true },
      { key: 'duration',       label: 'Expected Duration',         type: 'text',     required: false },
      { key: 'withPay',        label: 'Suspension With/Without Pay', type: 'select', options: ['With Pay', 'Without Pay'], required: true, default: 'With Pay' },
    ],
  },
  reinstatement: {
    label: 'Reinstatement Letter',
    fields: [
      { key: 'reinstatementDate', label: 'Reinstatement Date',      type: 'date',     required: true },
      { key: 'position',          label: 'Position Reinstated To',  type: 'text',     required: false },
      { key: 'conditions',        label: 'Conditions of Reinstatement', type: 'textarea', required: false },
    ],
  },
  redundancy: {
    label: 'Redundancy / Retrenchment Letter',
    fields: [
      { key: 'redundancyDate', label: 'Effective Redundancy Date',    type: 'date',     required: true },
      { key: 'reason',         label: 'Reason for Redundancy',        type: 'textarea', required: true },
      { key: 'severancePay',   label: 'Severance / Retrenchment Pay', type: 'text',     required: false },
      { key: 'noticePeriod',   label: 'Notice Period',                type: 'text',     required: false },
    ],
  },
  custom: {
    label: 'Custom Letter',
    fields: [
      { key: 'subject',   label: 'Subject Line', type: 'text',     required: true },
      { key: 'body',      label: 'Letter Body',  type: 'textarea', required: true },
    ],
  },
};

// ── Wrap a pre-rendered body with standard header + footer ───────────────────
export function renderWithCustomBody(employee, company, signatory, renderedBody, letterType = 'custom') {
  const emp = employee || {};
  const co  = company  || {};
  const refCode = (letterType || 'custom').toUpperCase().replace(/_/g, '');
  const header = `${CSS}<div class="letter-body">
<p>${fmtDate(new Date())}</p>
<p class="ref-line">Ref: HR/${refCode}/${emp.employeeNumber || '000'}</p>
<p>${emp.surname} ${emp.otherNames}<br>
${emp.designation?.name || ''}${emp.designation ? ' — ' : ''}${emp.department?.name || ''}<br>
${emp.physicalAddress || ''}</p>`;
  const footer = `${signBlock(co, signatory)}</div>`;
  return `${header}${renderedBody}${footer}`;
}

// ── Custom template placeholder substitution ──────────────────────────────────

export function applyCustomTemplate(bodyHtml, employee, meta, company) {
  const emp = employee || {};
  const m   = meta    || {};
  const co  = company || {};
  return bodyHtml
    .replace(/\{\{salutation\}\}/g,            `Dear ${emp.surname || ''} ${emp.otherNames || ''},`.trim())
    .replace(/\{\{employee\.surname\}\}/g,     emp.surname     || '')
    .replace(/\{\{employee\.otherNames\}\}/g,  emp.otherNames  || '')
    .replace(/\{\{employee\.fullName\}\}/g,    `${emp.surname || ''} ${emp.otherNames || ''}`.trim())
    .replace(/\{\{employee\.number\}\}/g,      emp.employeeNumber || '')
    .replace(/\{\{employee\.designation\}\}/g, emp.designation?.name || emp.designation || '')
    .replace(/\{\{employee\.department\}\}/g,  emp.department?.name  || emp.department  || '')
    .replace(/\{\{employee\.email\}\}/g,       emp.email       || '')
    .replace(/\{\{employee\.phone\}\}/g,       emp.phoneNumber || '')
    .replace(/\{\{employee\.address\}\}/g,     emp.physicalAddress || '')
    .replace(/\{\{employee\.kraPin\}\}/g,      emp.kraPin      || '')
    .replace(/\{\{company\.name\}\}/g,         co.companyName  || '')
    .replace(/\{\{today\}\}/g,                 fmtDate(new Date()))
    .replace(/\{\{meta\.(\w+)\}\}/g,           (_, key) => m[key] != null ? String(m[key]) : '');
}

// ── Template renderers ────────────────────────────────────────────────────────

export function renderLetterBody(letterType, employee, meta, company, signatory = null) {
  const emp = employee;
  const m   = meta || {};
  const co  = company || {};

  const header = `${CSS}<div class="letter-body">
<p>${fmtDate(new Date())}</p>
<p class="ref-line">Ref: HR/${(letterType || 'LTR').toUpperCase().replace('_', '')}/${emp.employeeNumber || '000'}</p>
<p>${emp.surname} ${emp.otherNames}<br>
${emp.designation?.name || ''}${emp.designation ? ' — ' : ''}${emp.department?.name || ''}<br>
${emp.physicalAddress || ''}</p>`;

  const footer = `${signBlock(co, signatory)}</div>`;

  switch (letterType) {
    case 'offer':
      return `${header}
<p>${salutation(emp)}</p>
<p class="subject-line">RE: OFFER OF EMPLOYMENT — ${(m.position || '').toUpperCase()}</p>
<p>Following your successful interview, ${co.companyName || 'the Company'} is pleased to offer you employment as
<span class="highlight">${m.position || ''}</span> in the
<span class="highlight">${m.department || ''}</span> department${m.location ? `, based at ${m.location}` : ''}, subject to the terms and conditions outlined below.</p>
<table class="terms-table">
  <tr><td>Position</td><td>${m.position || ''}</td></tr>
  <tr><td>Department</td><td>${m.department || ''}</td></tr>
  ${m.reportingTo ? `<tr><td>Reporting To</td><td>${m.reportingTo}</td></tr>` : ''}
  <tr><td>Start Date</td><td>${fmtDate(m.startDate)}</td></tr>
  <tr><td>Monthly Gross Salary</td><td><strong>${fmtKES(m.salary)}</strong></td></tr>
  <tr><td>Probation Period</td><td>${m.probationMonths || 3} months</td></tr>
  ${m.location ? `<tr><td>Work Location</td><td>${m.location}</td></tr>` : ''}
</table>
<p>Your employment will be subject to the Company's terms of service, policies, and procedures in force from time to time. The appointment is also subject to satisfactory reference checks and medical examination if required.</p>
<p>Please confirm your acceptance of this offer by signing and returning one copy of this letter${m.offerDeadline ? ` by <strong>${fmtDate(m.offerDeadline)}</strong>` : ' at your earliest convenience'}.</p>
<p>We look forward to welcoming you to our team.</p>
${footer}`;

    case 'appointment':
      return `${header}
<p>${salutation(emp)}</p>
<p class="subject-line">RE: LETTER OF APPOINTMENT — ${(m.position || '').toUpperCase()}</p>
<p>This is to confirm your appointment to the position of <span class="highlight">${m.position || ''}</span> in the <span class="highlight">${m.department || ''}</span> department with effect from <span class="highlight">${fmtDate(m.startDate)}</span>.</p>
<table class="terms-table">
  <tr><td>Position</td><td>${m.position || ''}</td></tr>
  <tr><td>Department</td><td>${m.department || ''}</td></tr>
  ${m.reportingTo ? `<tr><td>Reporting To</td><td>${m.reportingTo}</td></tr>` : ''}
  <tr><td>Start Date</td><td>${fmtDate(m.startDate)}</td></tr>
  <tr><td>Monthly Gross Salary</td><td><strong>${fmtKES(m.salary)}</strong></td></tr>
  <tr><td>Probation Period</td><td>${m.probationMonths || 3} months</td></tr>
</table>
<p>During the probation period, your performance and conduct will be evaluated. Upon successful completion, your employment will be confirmed as a permanent member of staff.</p>
<p>You are required to abide by the Company's policies, code of conduct, and any other regulations communicated to you from time to time.</p>
<p>Kindly sign and return a copy of this letter as acknowledgment of your acceptance of the terms herein.</p>
${footer}`;

    case 'confirmation':
      return `${header}
<p>${salutation(emp)}</p>
<p class="subject-line">RE: CONFIRMATION OF EMPLOYMENT</p>
<p>We are pleased to confirm that your employment with ${co.companyName || 'the Company'} has been confirmed as a <strong>Permanent Employee</strong> with effect from <span class="highlight">${fmtDate(m.effectiveDate)}</span>.</p>
${m.confirmedPosition ? `<p>Your confirmed position is: <strong>${m.confirmedPosition}</strong>.</p>` : ''}
${m.confirmedSalary ? `<p>Your confirmed monthly gross salary is: <strong>${fmtKES(m.confirmedSalary)}</strong>.</p>` : ''}
<p>Your performance during the probation period has been found satisfactory, and we look forward to your continued contribution to the organisation.</p>
<p>Your terms and conditions of employment as outlined in your letter of appointment remain unchanged except where specifically revised herein.</p>
${footer}`;

    case 'increment':
      return `${header}
<p>${salutation(emp)}</p>
<p class="subject-line">RE: SALARY REVIEW / INCREMENT NOTIFICATION</p>
<p>We are pleased to inform you that following a review of your performance and contribution, the Company has approved a revision of your salary as follows:</p>
<table class="terms-table">
  <tr><td>Current Monthly Gross Salary</td><td>${fmtKES(m.currentSalary)}</td></tr>
  <tr><td>New Monthly Gross Salary</td><td><strong>${fmtKES(m.newSalary)}</strong></td></tr>
  <tr><td>Effective Date</td><td>${fmtDate(m.effectiveDate)}</td></tr>
  ${m.reason ? `<tr><td>Basis for Review</td><td>${m.reason}</td></tr>` : ''}
</table>
<p>All other terms and conditions of your employment remain unchanged. We appreciate your dedication and look forward to your continued growth with the organisation.</p>
${footer}`;

    case 'promotion':
      return `${header}
<p>${salutation(emp)}</p>
<p class="subject-line">RE: PROMOTION — ${(m.newPosition || '').toUpperCase()}</p>
<p>Following a review of your performance and contribution to ${co.companyName || 'the Company'}, we are pleased to inform you of your promotion from
<span class="highlight">${m.currentPosition || 'your current position'}</span> to
<span class="highlight">${m.newPosition || ''}</span>
${m.department ? `in the <span class="highlight">${m.department}</span> department` : ''}, effective <span class="highlight">${fmtDate(m.effectiveDate)}</span>.</p>
${m.newSalary ? `
<table class="terms-table">
  ${m.currentSalary ? `<tr><td>Current Monthly Gross Salary</td><td>${fmtKES(m.currentSalary)}</td></tr>` : ''}
  <tr><td>New Monthly Gross Salary</td><td><strong>${fmtKES(m.newSalary)}</strong></td></tr>
  <tr><td>Effective Date</td><td>${fmtDate(m.effectiveDate)}</td></tr>
</table>` : ''}
<p>We recognise your hard work and commitment, and are confident that you will excel in your new role. Congratulations on this well-deserved promotion.</p>
${footer}`;

    case 'warning_1':
      return `${header}
<p>${salutation(emp)}</p>
<p class="subject-line">RE: FIRST WRITTEN WARNING</p>
<p>This letter serves as a <strong>First Written Warning</strong> in accordance with the Company's disciplinary policy.</p>
<p>It has come to the attention of Management that on or around <strong>${fmtDate(m.incidentDate)}</strong>, you were found to have engaged in the following conduct:</p>
<p><em>${m.offence || '...'}</em></p>
<p>This conduct is considered a violation of the Company's standards of conduct and is not acceptable. You are hereby formally warned that a repeat of such conduct or any other misconduct may result in a more severe disciplinary action, up to and including dismissal.</p>
${m.conditions ? `<p><strong>You are required to:</strong><br>${m.conditions}</p>` : ''}
<p>This warning will remain on your personnel file. Please sign below to acknowledge receipt of this letter.</p>
${footer}`;

    case 'warning_2':
      return `${header}
<p>${salutation(emp)}</p>
<p class="subject-line">RE: SECOND WRITTEN WARNING</p>
<p>This letter serves as a <strong>Second Written Warning</strong>${m.priorWarning ? `, following the First Written Warning issued on <strong>${fmtDate(m.priorWarning)}</strong>` : ''}.</p>
<p>On or around <strong>${fmtDate(m.incidentDate)}</strong>, you were found to have engaged in the following conduct:</p>
<p><em>${m.offence || '...'}</em></p>
<p>Despite the previous warning, your conduct continues to fall below the required standard. This is a serious matter and you are hereby placed on formal notice that any further misconduct may result in a <strong>Final Written Warning or Summary Dismissal</strong>.</p>
${m.conditions ? `<p><strong>You are required to:</strong><br>${m.conditions}</p>` : ''}
<p>Please sign below to acknowledge receipt of this letter. This warning will be retained on your personnel file.</p>
${footer}`;

    case 'final_warning':
      return `${header}
<p>${salutation(emp)}</p>
<p class="subject-line">RE: FINAL WRITTEN WARNING</p>
<p>This letter constitutes a <strong>Final Written Warning</strong> — the most severe warning short of dismissal.</p>
<p>On or around <strong>${fmtDate(m.incidentDate)}</strong>, you were found to have engaged in the following conduct:</p>
<p><em>${m.offence || '...'}</em></p>
<p>The Company views this matter with the utmost seriousness. You are hereby placed on final notice that <strong>any further act of misconduct or poor performance will result in immediate termination of your employment</strong> without further warning.</p>
${m.conditions ? `<p><strong>Conditions attached to this warning:</strong><br>${m.conditions}</p>` : ''}
<p>Please sign below to acknowledge receipt of this letter. This warning will remain on your personnel file.</p>
${footer}`;

    case 'termination':
      return `${header}
<p>${salutation(emp)}</p>
<p class="subject-line">RE: TERMINATION OF EMPLOYMENT</p>
<p>This letter serves to formally notify you that your employment with ${co.companyName || 'the Company'} has been terminated effective <span class="highlight">${fmtDate(m.terminationDate)}</span>.</p>
<p><strong>Reason for Termination:</strong><br><em>${m.reason || '...'}</em></p>
${m.noticePeriod ? `<p>You are required to serve a notice period of <strong>${m.noticePeriod}</strong>, during which you are expected to hand over all company property and assist with transition activities.</p>` : ''}
${m.outstandingBenefits ? `<p><strong>Outstanding Benefits / Final Pay:</strong><br>${m.outstandingBenefits}</p>` : ''}
<p>You are required to return all company property, including identification cards, keys, equipment, and any confidential documents, on or before your last working day.</p>
<p>Please note that all confidentiality and non-disclosure obligations under your contract of employment continue to apply following the termination of your employment.</p>
${footer}`;

    case 'reference':
      return `${header}
<p>${m.addressedTo ? `To: <strong>${m.addressedTo}</strong>` : 'To Whom It May Concern:'}</p>
<p class="subject-line">RE: REFERENCE LETTER — ${emp.surname.toUpperCase()} ${emp.otherNames.toUpperCase()}</p>
<p>This is to confirm that <strong>${emp.surname} ${emp.otherNames}</strong> was employed by ${co.companyName || 'this organisation'} as <strong>${m.position || ''}</strong> for the period <strong>${m.tenure || ''}</strong>.</p>
${m.assessment ? `<p>${m.assessment}</p>` : `<p>During their tenure, ${emp.surname} demonstrated professionalism, commitment, and a strong work ethic. They performed their duties diligently and were a valued member of our team.</p>`}
<p>We wish ${emp.surname} every success in their future endeavours and recommend them without reservation.</p>
<p>Should you require further information, please do not hesitate to contact our Human Resources office.</p>
${footer}`;

    case 'suspension':
      return `${header}
<p>${salutation(emp)}</p>
<p class="subject-line">RE: SUSPENSION FROM DUTY</p>
<p>You are hereby informed that you are suspended from duty with effect from <span class="highlight">${fmtDate(m.suspensionDate)}</span>, pending a disciplinary investigation.</p>
<p><strong>Reason for Suspension:</strong><br><em>${m.reason || '...'}</em></p>
<p>The suspension is <strong>${m.withPay || 'With Pay'}</strong>${m.duration ? ` and is expected to last approximately <strong>${m.duration}</strong>` : ''}.</p>
<p>During the suspension period, you are required to:</p>
<ul>
  <li>Remain available to assist with the investigation as required.</li>
  <li>Refrain from contacting any witnesses or parties involved in the matter under investigation.</li>
  <li>Surrender all company property, access cards, and credentials immediately.</li>
  <li>Not attend the workplace unless specifically requested to do so.</li>
</ul>
<p>Please note that this suspension does not imply any finding of guilt. You will be notified of the outcome of the investigation in due course.</p>
${footer}`;

    case 'reinstatement':
      return `${header}
<p>${salutation(emp)}</p>
<p class="subject-line">RE: REINSTATEMENT TO DUTY</p>
<p>Following the conclusion of the disciplinary investigation and review, we are pleased to inform you that you have been reinstated to active duty with effect from <span class="highlight">${fmtDate(m.reinstatementDate)}</span>.</p>
${m.position ? `<p>You are reinstated to the position of <strong>${m.position}</strong>.</p>` : ''}
${m.conditions ? `<p><strong>Conditions of Reinstatement:</strong><br>${m.conditions}</p>` : ''}
<p>Please report to your line manager on the above date. All terms and conditions of your original employment remain in effect.</p>
${footer}`;

    case 'redundancy':
      return `${header}
<p>${salutation(emp)}</p>
<p class="subject-line">RE: NOTICE OF REDUNDANCY</p>
<p>This letter is to formally notify you that your position has been declared redundant by ${co.companyName || 'the Company'}, effective <span class="highlight">${fmtDate(m.redundancyDate)}</span>.</p>
<p><strong>Reason for Redundancy:</strong><br><em>${m.reason || '...'}</em></p>
${m.noticePeriod ? `<p>You are required to serve a notice period of <strong>${m.noticePeriod}</strong>.</p>` : ''}
${m.severancePay ? `<p><strong>Severance / Retrenchment Pay:</strong><br>${m.severancePay}</p>` : ''}
<p>This decision was not a reflection of your performance or conduct. You have been a valued member of our team and we regret that circumstances have necessitated this action.</p>
<p>Please return all company property and assist with handing over your duties before your last working day.</p>
${footer}`;

    default:
      return `${header}<p>${salutation(emp)}</p><p>${m.body || ''}</p>${footer}`;
  }
}

// ── Default body HTML for template editor (placeholder form) ─────────────────
// Returns the body section only — header/footer are always system-generated.
// Uses {{placeholders}} so companies see the available variables.

export function getDefaultBodyHtml(letterType) {
  switch (letterType) {
    case 'offer': return `<p>{{salutation}}</p>
<p class="subject-line">RE: OFFER OF EMPLOYMENT — {{meta.position}}</p>
<p>Following your successful interview, {{company.name}} is pleased to offer you employment as
<span class="highlight">{{meta.position}}</span> in the
<span class="highlight">{{meta.department}}</span> department, subject to the terms and conditions outlined below.</p>
<table class="terms-table">
  <tr><td>Position</td><td>{{meta.position}}</td></tr>
  <tr><td>Department</td><td>{{meta.department}}</td></tr>
  <tr><td>Start Date</td><td>{{meta.startDate}}</td></tr>
  <tr><td>Monthly Gross Salary</td><td><strong>{{meta.salary}}</strong></td></tr>
  <tr><td>Probation Period</td><td>{{meta.probationMonths}} months</td></tr>
</table>
<p>Your employment will be subject to the Company's terms of service, policies, and procedures in force from time to time. The appointment is also subject to satisfactory reference checks and medical examination if required.</p>
<p>Please confirm your acceptance of this offer by signing and returning one copy of this letter at your earliest convenience.</p>
<p>We look forward to welcoming you to our team.</p>`;

    case 'appointment': return `<p>{{salutation}}</p>
<p class="subject-line">RE: LETTER OF APPOINTMENT — {{meta.position}}</p>
<p>This is to confirm your appointment to the position of <span class="highlight">{{meta.position}}</span> in the <span class="highlight">{{meta.department}}</span> department with effect from <span class="highlight">{{meta.startDate}}</span>.</p>
<table class="terms-table">
  <tr><td>Position</td><td>{{meta.position}}</td></tr>
  <tr><td>Department</td><td>{{meta.department}}</td></tr>
  <tr><td>Start Date</td><td>{{meta.startDate}}</td></tr>
  <tr><td>Monthly Gross Salary</td><td><strong>{{meta.salary}}</strong></td></tr>
  <tr><td>Probation Period</td><td>{{meta.probationMonths}} months</td></tr>
</table>
<p>During the probation period, your performance and conduct will be evaluated. Upon successful completion, your employment will be confirmed as a permanent member of staff.</p>
<p>You are required to abide by the Company's policies, code of conduct, and any other regulations communicated to you from time to time.</p>
<p>Kindly sign and return a copy of this letter as acknowledgment of your acceptance of the terms herein.</p>`;

    case 'confirmation': return `<p>{{salutation}}</p>
<p class="subject-line">RE: CONFIRMATION OF EMPLOYMENT</p>
<p>We are pleased to confirm that your employment with {{company.name}} has been confirmed as a <strong>Permanent Employee</strong> with effect from <span class="highlight">{{meta.effectiveDate}}</span>.</p>
<p>Your performance during the probation period has been found satisfactory, and we look forward to your continued contribution to the organisation.</p>
<p>Your terms and conditions of employment as outlined in your letter of appointment remain unchanged except where specifically revised herein.</p>`;

    case 'increment': return `<p>{{salutation}}</p>
<p class="subject-line">RE: SALARY REVIEW / INCREMENT NOTIFICATION</p>
<p>We are pleased to inform you that following a review of your performance and contribution, the Company has approved a revision of your salary as follows:</p>
<table class="terms-table">
  <tr><td>Current Monthly Gross Salary</td><td>{{meta.currentSalary}}</td></tr>
  <tr><td>New Monthly Gross Salary</td><td><strong>{{meta.newSalary}}</strong></td></tr>
  <tr><td>Effective Date</td><td>{{meta.effectiveDate}}</td></tr>
</table>
<p>All other terms and conditions of your employment remain unchanged. We appreciate your dedication and look forward to your continued growth with the organisation.</p>`;

    case 'promotion': return `<p>{{salutation}}</p>
<p class="subject-line">RE: PROMOTION — {{meta.newPosition}}</p>
<p>Following a review of your performance and contribution to {{company.name}}, we are pleased to inform you of your promotion from <span class="highlight">{{meta.currentPosition}}</span> to <span class="highlight">{{meta.newPosition}}</span>, effective <span class="highlight">{{meta.effectiveDate}}</span>.</p>
<p>We recognise your hard work and commitment, and are confident that you will excel in your new role. Congratulations on this well-deserved promotion.</p>`;

    case 'warning_1': return `<p>{{salutation}}</p>
<p class="subject-line">RE: FIRST WRITTEN WARNING</p>
<p>This letter serves as a <strong>First Written Warning</strong> in accordance with the Company's disciplinary policy.</p>
<p>It has come to the attention of Management that on or around <strong>{{meta.incidentDate}}</strong>, you were found to have engaged in the following conduct:</p>
<p><em>{{meta.offence}}</em></p>
<p>This conduct is considered a violation of the Company's standards of conduct and is not acceptable. You are hereby formally warned that a repeat of such conduct may result in more severe disciplinary action, up to and including dismissal.</p>
<p>This warning will remain on your personnel file. Please sign below to acknowledge receipt of this letter.</p>`;

    case 'warning_2': return `<p>{{salutation}}</p>
<p class="subject-line">RE: SECOND WRITTEN WARNING</p>
<p>This letter serves as a <strong>Second Written Warning</strong>.</p>
<p>On or around <strong>{{meta.incidentDate}}</strong>, you were found to have engaged in the following conduct:</p>
<p><em>{{meta.offence}}</em></p>
<p>Despite the previous warning, your conduct continues to fall below the required standard. You are hereby placed on formal notice that any further misconduct may result in a <strong>Final Written Warning or Summary Dismissal</strong>.</p>
<p>Please sign below to acknowledge receipt of this letter.</p>`;

    case 'final_warning': return `<p>{{salutation}}</p>
<p class="subject-line">RE: FINAL WRITTEN WARNING</p>
<p>This letter constitutes a <strong>Final Written Warning</strong> — the most severe warning short of dismissal.</p>
<p>On or around <strong>{{meta.incidentDate}}</strong>, you were found to have engaged in the following conduct:</p>
<p><em>{{meta.offence}}</em></p>
<p>The Company views this matter with the utmost seriousness. You are hereby placed on final notice that <strong>any further act of misconduct will result in immediate termination of your employment</strong> without further warning.</p>
<p>Please sign below to acknowledge receipt of this letter.</p>`;

    case 'termination': return `<p>{{salutation}}</p>
<p class="subject-line">RE: TERMINATION OF EMPLOYMENT</p>
<p>This letter formally notifies you that your employment with {{company.name}} has been terminated effective <span class="highlight">{{meta.terminationDate}}</span>.</p>
<p><strong>Reason for Termination:</strong><br><em>{{meta.reason}}</em></p>
<p>You are required to return all company property, including identification cards, keys, equipment, and confidential documents, on or before your last working day.</p>
<p>All confidentiality obligations under your contract of employment continue to apply following the termination of your employment.</p>`;

    case 'reference': return `<p>To Whom It May Concern:</p>
<p class="subject-line">RE: REFERENCE LETTER — {{employee.fullName}}</p>
<p>This is to confirm that <strong>{{employee.fullName}}</strong> was employed by {{company.name}} as <strong>{{meta.position}}</strong> for the period <strong>{{meta.tenure}}</strong>.</p>
<p>During their tenure, {{employee.surname}} demonstrated professionalism, commitment, and a strong work ethic. They performed their duties diligently and were a valued member of our team.</p>
<p>We wish {{employee.surname}} every success in their future endeavours and recommend them without reservation.</p>`;

    case 'suspension': return `<p>{{salutation}}</p>
<p class="subject-line">RE: SUSPENSION FROM DUTY</p>
<p>You are hereby informed that you are suspended from duty with effect from <span class="highlight">{{meta.suspensionDate}}</span>, pending a disciplinary investigation.</p>
<p><strong>Reason for Suspension:</strong><br><em>{{meta.reason}}</em></p>
<p>The suspension is <strong>{{meta.withPay}}</strong>.</p>
<p>During the suspension period, you are required to remain available to assist with the investigation, refrain from contacting witnesses, and surrender all company property and access credentials immediately.</p>
<p>Please note that this suspension does not imply any finding of guilt.</p>`;

    case 'reinstatement': return `<p>{{salutation}}</p>
<p class="subject-line">RE: REINSTATEMENT TO DUTY</p>
<p>Following the conclusion of the disciplinary investigation, we are pleased to inform you that you have been reinstated to active duty with effect from <span class="highlight">{{meta.reinstatementDate}}</span>.</p>
<p>Please report to your line manager on the above date. All terms and conditions of your original employment remain in effect.</p>`;

    case 'redundancy': return `<p>{{salutation}}</p>
<p class="subject-line">RE: NOTICE OF REDUNDANCY</p>
<p>This letter formally notifies you that your position has been declared redundant by {{company.name}}, effective <span class="highlight">{{meta.redundancyDate}}</span>.</p>
<p><strong>Reason for Redundancy:</strong><br><em>{{meta.reason}}</em></p>
<p>This decision was not a reflection of your performance or conduct. You have been a valued member of our team and we regret that circumstances have necessitated this action.</p>
<p>Please return all company property and assist with handing over your duties before your last working day.</p>`;

    default: return `<p>{{salutation}}</p>\n<p>{{meta.body}}</p>`;
  }
}
