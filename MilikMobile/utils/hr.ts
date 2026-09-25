// Shared constants + helpers for the HR screens (dashboard, employees, leave, attendance).
// Money / date formatting lives in ./pmsFormat; the list hook in ../hooks/usePmsList.

import { apiError } from './pmsFormat';
import { cwMessage } from './carwash';

export const HC = '#4C1D95';   // HR purple

/** Message for a failed HR call: the server's own message, with "Permission denied for hrLeave.update" made readable. */
export const hrError = (err: unknown, fallback: string): string => cwMessage(apiError(err, fallback));

// ─── Employees ─────────────────────────────────────────────────────────────────

export const EMPLOYEE_STATUSES = ['Active', 'Probation', 'Suspended', 'Terminated'] as const;
export const EMPLOYMENT_TYPES  = ['Permanent', 'Contract', 'Casual', 'Intern'] as const;

type Ref = { _id?: string; name?: string } | string | null | undefined;

export type HrEmployee = {
  _id:                    string;
  employeeNumber?:        string;
  surname:                string;
  otherNames:             string;
  gender?:                string | null;
  dateOfBirth?:           string | null;
  nationalId?:            string;
  kraPin?:                string;
  nhifNo?:                string;
  nssfNo?:                string;
  helbNo?:                string;
  phoneNumber?:           string;
  email?:                 string;
  physicalAddress?:       string;
  postalAddress?:         string;
  nextOfKinName?:         string;
  nextOfKinRelationship?: string;
  nextOfKinPhone?:        string;
  department?:            Ref;
  designation?:           Ref;
  reportsTo?:             { surname?: string; otherNames?: string; employeeNumber?: string } | null;
  employmentType?:        string;
  dateJoined?:            string | null;
  contractStartDate?:     string | null;
  contractEndDate?:       string | null;
  probationEndDate?:      string | null;
  basicSalary?:           number;
  salaryComponents?:      { name: string; type: 'Allowance' | 'Deduction'; amount: number; isPercentage?: boolean }[];
  paymentMethod?:         string;
  bankName?:              string;
  bankAccountNumber?:     string;
  bankBranch?:            string;
  mpesaNumber?:           string;
  status:                 string;
  terminationDate?:       string | null;
  terminationReason?:     string;
};

/** "Surname Other names" — every employee list / leave / attendance row shows a person this way. */
export const personName = (p?: { surname?: string; otherNames?: string } | string | null): string => {
  if (!p) return '—';
  if (typeof p === 'string') return '—';   // an unpopulated id has no name
  return `${p.surname ?? ''} ${p.otherNames ?? ''}`.trim() || '—';
};

export const initialsOf = (p?: { surname?: string; otherNames?: string } | null): string =>
  `${(p?.surname ?? '').charAt(0)}${(p?.otherNames ?? '').charAt(0)}`.toUpperCase() || '?';

/** Name of a populated department / designation. */
export const refLabel = (r: Ref): string => (r && typeof r === 'object' ? (r.name ?? '') : '');

/** Basic + allowances (percentage allowances are of basic) — the same gross the web profile shows. */
export const grossSalary = (e: Pick<HrEmployee, 'basicSalary' | 'salaryComponents'>): number => {
  const basic = Number(e.basicSalary) || 0;
  return basic + (e.salaryComponents ?? [])
    .filter(c => c.type === 'Allowance')
    .reduce((sum, c) => sum + ((c.isPercentage ? (basic * Number(c.amount)) / 100 : Number(c.amount)) || 0), 0);
};

/** The employee list answers { employees, total, totalPages, currentPage }. */
export const employeesOf = (payload: any): { rows: HrEmployee[]; pages?: number; total?: number } => {
  const rows = Array.isArray(payload) ? payload : payload?.employees;
  return {
    rows:  Array.isArray(rows) ? rows : [],
    pages: typeof payload?.totalPages === 'number' ? payload.totalPages : undefined,
    total: typeof payload?.total === 'number' ? payload.total : undefined,
  };
};

// ─── Dashboard (GET /hr/employees/stats) ───────────────────────────────────────

export type HrStats = {
  total?:               number;
  active?:              number;
  probation?:           number;
  suspended?:           number;
  terminated?:          number;
  pendingLeave?:        number;
  onLeaveToday?:        number;
  byType?:              Record<string, number>;
  byGender?:            Record<string, number>;
  byDepartment?:        { _id?: string; name: string; count: number }[];
  recentJoiners?:       (Pick<HrEmployee, '_id' | 'surname' | 'otherNames' | 'dateJoined' | 'department' | 'designation'>)[];
  probationEndingSoon?: (Pick<HrEmployee, '_id' | 'surname' | 'otherNames' | 'probationEndDate' | 'department'>)[];
};

// ─── Leave ─────────────────────────────────────────────────────────────────────

export const LEAVE_STATUSES = ['Pending', 'Approved', 'Rejected', 'Cancelled'] as const;

export type LeaveType = { _id: string; name: string; code?: string; daysPerYear?: number; isPaid?: boolean; requiresApproval?: boolean };

export type LeaveApp = {
  _id:              string;
  employee?:        { _id?: string; surname?: string; otherNames?: string; employeeNumber?: string } | string;
  leaveType?:       { _id?: string; name?: string; code?: string; isPaid?: boolean } | string;
  startDate:        string;
  endDate:          string;
  days:             number;
  reason?:          string;
  status:           string;
  approvalNotes?:   string;
  rejectionReason?: string;
  cancelReason?:    string;
  createdAt?:       string;
};

/** The leave list answers { applications, total, totalPages, currentPage }. */
export const applicationsOf = (payload: any): { rows: LeaveApp[]; pages?: number; total?: number } => {
  const rows = Array.isArray(payload) ? payload : payload?.applications;
  return {
    rows:  Array.isArray(rows) ? rows : [],
    pages: typeof payload?.totalPages === 'number' ? payload.totalPages : undefined,
    total: typeof payload?.total === 'number' ? payload.total : undefined,
  };
};

/** GET /hr/leave-types answers a bare array. */
export const leaveTypesOf = (payload: any): LeaveType[] => {
  const rows = Array.isArray(payload) ? payload : payload?.leaveTypes;
  return Array.isArray(rows) ? rows : [];
};

/** 'YYYY-MM-DD' -> local Date (no UTC shift), or null. */
const parseDay = (s: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

/**
 * Working days between two dates, Monday-Friday, both ends included — the same rule the server applies when it stores the
 * application (a range made only of weekend days still counts as 1). 0 when a date is missing or end is before start.
 */
export const workingDays = (start: string, end: string): number => {
  const s = parseDay(start), e = parseDay(end);
  if (!s || !e || e < s) return 0;
  let count = 0;
  for (const cur = new Date(s); cur <= e; cur.setDate(cur.getDate() + 1)) {
    const d = cur.getDay();
    if (d !== 0 && d !== 6) count++;
  }
  return count || 1;
};

/** The next YYYY-MM-DD after adding `n` days (local calendar arithmetic). */
export const addDaysISO = (s: string, n: number): string => {
  const d = parseDay(s) ?? new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** What the phone posts to POST /hr/leave-applications (days is worked out by the server, so it is not sent). */
export const leaveRequestBody = (f: {
  employeeId: string; leaveTypeId: string; startDate: string; endDate: string; reason: string;
}) => ({
  employee:  f.employeeId,
  leaveType: f.leaveTypeId,
  startDate: f.startDate,
  endDate:   f.endDate,
  reason:    f.reason.trim() || undefined,
});

// ─── Attendance ────────────────────────────────────────────────────────────────

export type AttendanceRec = {
  _id:       string;
  employee?: { _id?: string; surname?: string; otherNames?: string; employeeNumber?: string } | string;
  date:      string;
  checkIn:   string;
  checkOut?: string | null;
  duration?: number | null;   // minutes
  note?:     string;
  source?:   'ess' | 'admin';
};

/** The attendance list answers { records, total, totalPages, currentPage }. */
export const recordsOf = (payload: any): { rows: AttendanceRec[]; pages?: number; total?: number } => {
  const rows = Array.isArray(payload) ? payload : payload?.records;
  return {
    rows:  Array.isArray(rows) ? rows : [],
    pages: typeof payload?.totalPages === 'number' ? payload.totalPages : undefined,
    total: typeof payload?.total === 'number' ? payload.total : undefined,
  };
};

/**
 * The instants bounding one local calendar day, as the `from` (inclusive) / `to` (exclusive) params of GET /hr/attendance.
 * (The record's own `date` is the UTC day, which is the previous day for a check-in before 03:00 in Kenya.)
 */
export const dayRange = (day: string): { from: string; to: string } => {
  const s = parseDay(day) ?? new Date();
  const e = new Date(s);
  e.setDate(e.getDate() + 1);
  return { from: s.toISOString(), to: e.toISOString() };
};

/** "08:05" in the device's local time. */
export const fmtTime = (d: unknown): string => {
  if (!d) return '—';
  const date = new Date(String(d));
  if (Number.isNaN(date.getTime())) return '—';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

/** 95 -> "1h 35m", 40 -> "40m" */
export const fmtDuration = (min: unknown): string => {
  const v = Number(min);
  if (!Number.isFinite(v) || v <= 0) return '—';
  const h = Math.floor(v / 60), m = Math.round(v % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
