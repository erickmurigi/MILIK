// Contract between the mobile HR screens (MilikMobile/app/(app)/hr/**) and the real HR routes.
// Every request below is built the way the mobile code builds it (same params / body objects, field names, enum values and
// date formats; query values are strings because axios serialises them) and answered by the real route handler. Each test then
// asserts the exact keys the .tsx reads, so a renamed server field or a wrong enum on either side fails here.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { routeHandler } from "../../../test/routeHandler.js";
import { createTestCompany, createTestUser } from "../../../test/factories.js";
import HREmployee from "../models/HREmployee.js";
import HRDepartment from "../models/HRDepartment.js";
import HRDesignation from "../models/HRDesignation.js";
import HRLeaveType from "../models/HRLeaveType.js";
import HRLeaveApplication from "../models/HRLeaveApplication.js";
import HRAttendance from "../models/HRAttendance.js";
import employeesRouter from "./employees.js";
import leaveTypesRouter from "./leaveTypes.js";
import leaveApplicationsRouter from "./leaveApplications.js";
import leaveBalancesRouter from "./leaveBalances.js";
import attendanceRouter from "./attendance.js";
// The mobile helpers themselves, so a drift in a constant / date rule / response adapter is caught here.
import {
  EMPLOYEE_STATUSES, EMPLOYMENT_TYPES, LEAVE_STATUSES, addDaysISO, applicationsOf, dayRange, employeesOf, fmtDuration,
  grossSalary, hrError, leaveRequestBody, leaveTypesOf, personName, recordsOf, refLabel, workingDays,
} from "../../../../MilikMobile/utils/hr.ts";
import { todayISO } from "../../../../MilikMobile/utils/pmsFormat.ts";

// ── how the mobile app sends things ─────────────────────────────────────────────────────────────
// axios: undefined / null params are dropped, everything is a string on the wire. usePmsList also drops '' and adds page / limit.
const wire = (o = {}) => Object.fromEntries(
  Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)]),
);
// JSON body: undefined keys vanish.
const json = (o = {}) => JSON.parse(JSON.stringify(o));

const listEmployees   = routeHandler(employeesRouter, "get", "/");
const employeeStats   = routeHandler(employeesRouter, "get", "/stats");
const getEmployee     = routeHandler(employeesRouter, "get", "/:id");
const listLeaveTypes  = routeHandler(leaveTypesRouter, "get", "/");
const listLeave       = routeHandler(leaveApplicationsRouter, "get", "/");
const createLeave     = routeHandler(leaveApplicationsRouter, "post", "/");
const approveLeave    = routeHandler(leaveApplicationsRouter, "patch", "/:id/approve");
const rejectLeave     = routeHandler(leaveApplicationsRouter, "patch", "/:id/reject");
const cancelLeave     = routeHandler(leaveApplicationsRouter, "patch", "/:id/cancel");
const leaveBalances   = routeHandler(leaveBalancesRouter, "get", "/");
const listAttendance  = routeHandler(attendanceRouter, "get", "/");

let seq = 0;
const day = (n) => new Date(Date.now() + n * 86_400_000);

const setup = async () => {
  const company = await createTestCompany({ modules: { hr: true } });
  const user = await createTestUser({ company });
  const business = company._id;
  const call = (fn, { query = {}, body = {}, params = {} } = {}) =>
    callController(fn, { user, query: wire(query), body: json(body), params, headers: {} });

  const sales = await HRDepartment.create({ company: business, name: "Sales" });
  const finance = await HRDepartment.create({ company: business, name: "Finance" });
  const manager = await HRDesignation.create({ company: business, name: "Manager", department: sales._id });

  const mkEmployee = (over = {}) => {
    const n = ++seq;
    return HREmployee.create({
      company: business, surname: `Surname${n}`, otherNames: `Other${n}`, phoneNumber: `0700${String(n).padStart(6, "0")}`,
      employmentType: "Permanent", dateJoined: new Date("2024-01-15"), ...over,
    });
  };
  const mkType = (over = {}) => HRLeaveType.create({ company: business, name: `Annual ${++seq}`, daysPerYear: 21, ...over });
  const mkLeave = (employee, leaveType, over = {}) => HRLeaveApplication.create({
    company: business, employee: employee._id, leaveType: leaveType._id,
    startDate: new Date("2026-03-02"), endDate: new Date("2026-03-04"), days: 3, status: "Pending", ...over,
  });
  return { company, user, business, call, sales, finance, manager, mkEmployee, mkType, mkLeave };
};

// ── Dashboard (hr/index.tsx) ────────────────────────────────────────────────────────────────────
describe("mobile contract: HR dashboard", () => {
  it("answers every key the dashboard reads (flat counts, byGender / byType maps, byDepartment rows)", async () => {
    const ctx = await setup();
    const { call, sales, finance, manager } = ctx;
    const jane = await ctx.mkEmployee({ surname: "Wanjiku", otherNames: "Jane", gender: "Female", department: sales._id, designation: manager._id });
    await ctx.mkEmployee({ gender: "Male", department: sales._id, employmentType: "Contract" });
    await ctx.mkEmployee({ gender: "Male", department: finance._id, status: "Probation", probationEndDate: day(10) });
    await ctx.mkEmployee({ status: "Suspended" });
    await ctx.mkEmployee({ status: "Terminated", terminationDate: day(-5) });
    const type = await ctx.mkType();
    await ctx.mkLeave(jane, type, { status: "Pending" });
    await ctx.mkLeave(jane, type, { status: "Approved", startDate: day(-1), endDate: day(1) });

    const { statusCode, payload: s } = await call(employeeStats);
    expect(statusCode).toBe(200);
    // the tiles
    expect(s).toMatchObject({ total: 5, active: 2, probation: 1, suspended: 1, terminated: 1, pendingLeave: 1, onLeaveToday: 1 });
    // hero: Male / Female (terminated staff excluded)
    expect(s.byGender.Male).toBe(2);
    expect(s.byGender.Female).toBe(1);
    // department count + bars
    expect(s.byDepartment.map((d) => d.name).sort()).toEqual(["Finance", "Sales", "Unassigned"]);
    expect(s.byDepartment.find((d) => d.name === "Sales").count).toBe(2);
    expect(s.byType.Permanent).toBeGreaterThan(0);
    expect(s.byType.Contract).toBe(1);
    // recent joiners + probation lists are rendered with personName / refLabel
    const joiner = s.recentJoiners.find((e) => String(e._id) === String(jane._id));
    expect(personName(joiner)).toBe("Wanjiku Jane");
    expect(refLabel(joiner.department)).toBe("Sales");
    expect(refLabel(joiner.designation)).toBe("Manager");
    expect(s.recentJoiners[0]).toHaveProperty("dateJoined");
    expect(s.probationEndingSoon).toHaveLength(1);
    expect(s.probationEndingSoon[0]).toHaveProperty("probationEndDate");
    expect(refLabel(s.probationEndingSoon[0].department)).toBe("Finance");
    // the old flat keys the screen used to read do not exist
    for (const gone of ["onProbation", "pendingLeaves", "departments", "maleCount", "femaleCount", "contractExpiring"]) expect(s).not.toHaveProperty(gone);
  });

  it("is scoped to the caller's company", async () => {
    const a = await setup();
    const b = await setup();
    await a.mkEmployee();
    await b.mkEmployee();
    await b.mkEmployee();
    expect((await a.call(employeeStats)).payload.total).toBe(1);
    expect((await b.call(employeeStats)).payload.total).toBe(2);
  });
});

// ── Employees (hr/employees/index.tsx, [id].tsx) ────────────────────────────────────────────────
describe("mobile contract: employees list + profile", () => {
  it("lists with the params the screen sends and adapts through employeesOf", async () => {
    const ctx = await setup();
    const { call, sales } = ctx;
    for (let i = 0; i < 3; i++) await ctx.mkEmployee({ department: sales._id });
    await ctx.mkEmployee({ status: "Probation", employmentType: "Contract" });

    const first = await call(listEmployees, { query: { status: undefined, employmentType: undefined, search: undefined, page: 1, limit: 3 } });
    expect(first.statusCode).toBe(200);
    const page1 = employeesOf(first.payload);
    expect(page1.rows).toHaveLength(3);
    expect(page1.total).toBe(4);
    expect(page1.pages).toBe(2);                 // usePmsList decides hasMore from this
    const page2 = employeesOf((await call(listEmployees, { query: { page: 2, limit: 3 } })).payload);
    expect(page2.rows).toHaveLength(1);

    // the fields the card + profile read exist under the names the phone uses
    const row = page1.rows[0];
    for (const k of ["_id", "surname", "otherNames", "employeeNumber", "phoneNumber", "employmentType", "dateJoined", "status"]) expect(row).toHaveProperty(k);
    expect(EMPLOYEE_STATUSES).toContain(row.status);
    expect(EMPLOYMENT_TYPES).toContain(row.employmentType);

    for (const status of EMPLOYEE_STATUSES) {
      const r = employeesOf((await call(listEmployees, { query: { status, page: 1, limit: 30 } })).payload);
      expect(r.rows.every((e) => e.status === status)).toBe(true);
    }
    const contract = employeesOf((await call(listEmployees, { query: { employmentType: "Contract", page: 1, limit: 30 } })).payload);
    expect(contract.rows).toHaveLength(1);
  });

  it("the search box finds part of a name, the number, the phone (any format), the e-mail and the department", async () => {
    const ctx = await setup();
    const { call, sales, finance } = ctx;
    await ctx.mkEmployee({ surname: "Murigi", otherNames: "Eric Kamau", employeeNumber: "EMP0007", phoneNumber: "+254 712 345 678", email: "eric@acme.co.ke", department: sales._id });
    await ctx.mkEmployee({ surname: "Otieno", otherNames: "Amina", employeeNumber: "EMP0008", phoneNumber: "0799000111", department: finance._id });

    const names = async (search) =>
      employeesOf((await call(listEmployees, { query: { search, page: 1, limit: 30 } })).payload).rows.map((e) => e.surname);
    expect(await names("muri")).toEqual(["Murigi"]);          // used to need the whole word
    expect(await names("eric mur")).toEqual(["Murigi"]);      // every word, any field
    expect(await names("emp0008")).toEqual(["Otieno"]);
    expect(await names("0712345678")).toEqual(["Murigi"]);
    expect(await names("acme.co")).toEqual(["Murigi"]);
    expect(await names("sales")).toEqual(["Murigi"]);         // the placeholder promises the department
    expect(await names("amina fin")).toEqual(["Otieno"]);     // a name word plus a department word
    expect(await names("nobody")).toEqual([]);
    expect(await names(".*")).toEqual([]);
    expect((await names(undefined)).sort()).toEqual(["Murigi", "Otieno"]);
  });

  it("never sends the ESS password hash to the phone", async () => {
    const ctx = await setup();
    const emp = await ctx.mkEmployee({ essEnabled: true, essPassword: "$2a$10$abcdefghijklmnopqrstuv" });
    const list = await ctx.call(listEmployees, { query: { page: 1, limit: 30 } });
    expect(list.payload.employees[0]).not.toHaveProperty("essPassword");
    const one = await ctx.call(getEmployee, { params: { id: String(emp._id) } });
    expect(one.payload).not.toHaveProperty("essPassword");
    expect(one.payload.essEnabled).toBe(true);
  });

  it("returns the profile under the names the screen reads, populated", async () => {
    const ctx = await setup();
    const { call, sales, manager } = ctx;
    const boss = await ctx.mkEmployee({ surname: "Boss", otherNames: "Big" });
    const emp = await ctx.mkEmployee({
      surname: "Kamau", otherNames: "John", gender: "Male", dateOfBirth: new Date("1990-05-04"), nationalId: "12345678",
      kraPin: "a012345678z", nhifNo: "N1", nssfNo: "S1", helbNo: "H1", email: "j@x.co", physicalAddress: "Ruiru", postalAddress: "P.O. Box 1",
      nextOfKinName: "Mary Kamau", nextOfKinRelationship: "Spouse", nextOfKinPhone: "0711000000",
      department: sales._id, designation: manager._id, reportsTo: boss._id, probationEndDate: new Date("2024-04-15"),
      contractStartDate: new Date("2024-01-15"), contractEndDate: new Date("2026-01-14"),
      basicSalary: 100_000, paymentMethod: "Bank Transfer", bankName: "Equity", bankAccountNumber: "0123", bankBranch: "Ruiru",
      salaryComponents: [{ name: "Housing", type: "Allowance", amount: 10, isPercentage: true }, { name: "Transport", type: "Allowance", amount: 5000 }, { name: "Loan", type: "Deduction", amount: 2000 }],
    });

    const { statusCode, payload: e } = await call(getEmployee, { params: { id: String(emp._id) } });
    expect(statusCode).toBe(200);
    for (const k of [
      "employeeNumber", "nationalId", "gender", "dateOfBirth", "phoneNumber", "email", "physicalAddress", "postalAddress",
      "kraPin", "nhifNo", "nssfNo", "helbNo", "nextOfKinName", "nextOfKinRelationship", "nextOfKinPhone",
      "employmentType", "dateJoined", "probationEndDate", "contractStartDate", "contractEndDate",
      "basicSalary", "salaryComponents", "paymentMethod", "bankName", "bankAccountNumber", "bankBranch", "status",
    ]) expect(e).toHaveProperty(k);
    // the names the old screen read do not exist
    for (const gone of ["employeeId", "phone", "joinDate", "dob", "grossSalary", "bankAccount", "nextOfKin", "address"]) expect(e).not.toHaveProperty(gone);
    expect(personName(e)).toBe("Kamau John");
    expect(refLabel(e.department)).toBe("Sales");
    expect(refLabel(e.designation)).toBe("Manager");
    expect(personName(e.reportsTo)).toBe("Boss Big");
    expect(e.kraPin).toBe("A012345678Z");
    // gross = basic + 10% of basic + 5,000 (deductions are not added) — the same as the web profile
    expect(grossSalary(e)).toBe(115_000);
  });

  it("does not show another company's employee, and fails cleanly for a bad id", async () => {
    const a = await setup();
    const b = await setup();
    const theirs = await b.mkEmployee();
    expect((await a.call(getEmployee, { params: { id: String(theirs._id) } })).statusCode).toBe(404);
    const bad = await a.call(getEmployee, { params: { id: "not-an-id" } });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);
    expect(typeof bad.payload.message).toBe("string");
    expect(employeesOf((await a.call(listEmployees, { query: { page: 1, limit: 30 } })).payload).rows).toHaveLength(0);
  });
});

// ── Leave: new application (hr/leave/new.tsx) ───────────────────────────────────────────────────
describe("mobile contract: new leave application", () => {
  const form = (ctx, over = {}) => ({
    employeeId: String(ctx.emp._id), leaveTypeId: String(ctx.type._id), startDate: "2026-09-25", endDate: "2026-09-29", reason: "  Family event ", ...over,
  });

  it("the leave types the picker lists come back as a bare array with daysPerYear / isPaid / requiresApproval", async () => {
    const ctx = await setup();
    await ctx.mkType({ name: "Sick", daysPerYear: 14, isPaid: true });
    await ctx.mkType({ name: "Study", daysPerYear: 0, isPaid: false, requiresApproval: false });
    await ctx.mkType({ name: "Retired", isActive: false });
    const { statusCode, payload } = await ctx.call(listLeaveTypes);
    expect(statusCode).toBe(200);
    expect(Array.isArray(payload)).toBe(true);
    const types = leaveTypesOf(payload);
    expect(types.map((t) => t.name).sort()).toEqual(["Sick", "Study"]);   // inactive types are hidden
    const sick = types.find((t) => t.name === "Sick");
    expect(sick).toMatchObject({ daysPerYear: 14, isPaid: true, requiresApproval: true });
    expect(types.find((t) => t.name === "Study")).toMatchObject({ isPaid: false, requiresApproval: false });
  });

  it("accepts the body exactly as the phone builds it and counts Monday-Friday days like the phone shows", async () => {
    const ctx = await setup();
    ctx.emp = await ctx.mkEmployee();
    ctx.type = await ctx.mkType({ name: "Annual" });
    const f = form(ctx);
    const body = leaveRequestBody(f);
    expect(json(body)).toEqual({ employee: f.employeeId, leaveType: f.leaveTypeId, startDate: "2026-09-25", endDate: "2026-09-29", reason: "Family event" });
    expect(json(body)).not.toHaveProperty("days");   // the server works the days out

    const { statusCode, payload } = await ctx.call(createLeave, { body });
    expect(statusCode).toBe(201);
    expect(payload.status).toBe("Pending");
    expect(payload.days).toBe(workingDays("2026-09-25", "2026-09-29"));   // Fri + Mon + Tue
    expect(payload.days).toBe(3);
    expect(payload.reason).toBe("Family event");
    expect(personName(payload.employee)).toContain(ctx.emp.surname);
    expect(payload.leaveType.name).toBe("Annual");
  });

  it("a weekend-only range counts as one day on both sides; a blank reason is left out", async () => {
    const ctx = await setup();
    ctx.emp = await ctx.mkEmployee();
    ctx.type = await ctx.mkType();
    const f = form(ctx, { startDate: "2026-09-26", endDate: "2026-09-27", reason: "   " });
    expect(workingDays(f.startDate, f.endDate)).toBe(1);
    const body = leaveRequestBody(f);
    expect(json(body)).not.toHaveProperty("reason");
    const { statusCode, payload } = await ctx.call(createLeave, { body });
    expect(statusCode).toBe(201);
    expect(payload.days).toBe(1);
  });

  it("a leave type that needs no approval is approved straight away (the phone says so)", async () => {
    const ctx = await setup();
    ctx.emp = await ctx.mkEmployee();
    ctx.type = await ctx.mkType({ name: "Compassionate", requiresApproval: false });
    const { payload } = await ctx.call(createLeave, { body: leaveRequestBody(form(ctx)) });
    expect(payload.status).toBe("Approved");
  });

  it("the failures the screen shows: overlap, end before start, inactive type, foreign employee", async () => {
    const ctx = await setup();
    ctx.emp = await ctx.mkEmployee();
    ctx.type = await ctx.mkType();
    await ctx.call(createLeave, { body: leaveRequestBody(form(ctx)) });

    const overlap = await ctx.call(createLeave, { body: leaveRequestBody(form(ctx, { startDate: "2026-09-28", endDate: "2026-10-02" })) });
    expect(overlap.statusCode).toBe(400);
    expect(overlap.payload.message).toMatch(/overlapping leave application/i);

    const backwards = await ctx.call(createLeave, { body: leaveRequestBody(form(ctx, { startDate: "2026-11-10", endDate: "2026-11-05" })) });
    expect(backwards.statusCode).toBe(400);
    expect(workingDays("2026-11-10", "2026-11-05")).toBe(0);   // the phone disables Submit before it gets here

    const inactive = await ctx.mkType({ name: "Old", isActive: false });
    const gone = await ctx.call(createLeave, { body: leaveRequestBody(form(ctx, { leaveTypeId: String(inactive._id), startDate: "2026-12-01", endDate: "2026-12-02" })) });
    expect(gone.statusCode).toBe(404);

    const other = await setup();
    const foreign = await other.mkEmployee();
    const cross = await ctx.call(createLeave, { body: leaveRequestBody(form(ctx, { employeeId: String(foreign._id), startDate: "2026-12-01", endDate: "2026-12-02" })) });
    expect(cross.statusCode).toBe(404);
    expect(hrError({ response: { data: { message: cross.payload.message } } }, "x")).toBe(cross.payload.message);
  });

  it("the balance hint reads entitlement / used / pending / remaining for the chosen person and type", async () => {
    const ctx = await setup();
    const emp = await ctx.mkEmployee();
    const other = await ctx.mkEmployee();
    const annual = await ctx.mkType({ name: "Annual", daysPerYear: 21 });
    await ctx.mkLeave(emp, annual, { status: "Approved", days: 5, startDate: new Date("2026-02-02"), endDate: new Date("2026-02-06") });
    await ctx.mkLeave(emp, annual, { status: "Pending", days: 2, startDate: new Date("2026-06-01"), endDate: new Date("2026-06-02") });
    await ctx.mkLeave(other, annual, { status: "Approved", days: 9, startDate: new Date("2026-04-01"), endDate: new Date("2026-04-13") });

    const startDate = "2026-09-25";
    const { statusCode, payload } = await ctx.call(leaveBalances, { query: { year: startDate.slice(0, 4), leaveTypeId: String(annual._id) } });
    expect(statusCode).toBe(200);
    const row = payload.find((r) => String(r.employeeId) === String(emp._id));
    expect(row).toMatchObject({ entitlement: 21, used: 5, pending: 2, remaining: 16 });
  });
});

// ── Leave: list + approve / reject / cancel (hr/leave/index.tsx) ────────────────────────────────
describe("mobile contract: leave list and decisions", () => {
  it("lists with status + search and adapts through applicationsOf", async () => {
    const ctx = await setup();
    const { call, sales, finance } = ctx;
    const jane = await ctx.mkEmployee({ surname: "Wanjiku", otherNames: "Jane", employeeNumber: "EMP0101", department: sales._id });
    const peter = await ctx.mkEmployee({ surname: "Mwangi", otherNames: "Peter", employeeNumber: "EMP0102", department: finance._id });
    const type = await ctx.mkType({ name: "Sick", isPaid: false });
    await ctx.mkLeave(jane, type, { status: "Pending", reason: "Flu" });
    await ctx.mkLeave(jane, type, { status: "Approved", startDate: new Date("2026-05-04"), endDate: new Date("2026-05-05"), days: 2 });
    await ctx.mkLeave(peter, type, { status: "Pending" });

    const res = await call(listLeave, { query: { status: "Pending", search: undefined, page: 1, limit: 2 } });
    expect(res.statusCode).toBe(200);
    const page = applicationsOf(res.payload);
    expect(page.rows).toHaveLength(2);
    expect(page.total).toBe(2);
    expect(page.pages).toBe(1);
    const row = page.rows.find((r) => r.employee.surname === "Wanjiku");
    for (const k of ["_id", "startDate", "endDate", "days", "reason", "status", "createdAt"]) expect(row).toHaveProperty(k);
    expect(personName(row.employee)).toBe("Wanjiku Jane");
    expect(row.employee.employeeNumber).toBe("EMP0101");
    expect(row.leaveType).toMatchObject({ name: "Sick", isPaid: false });
    expect(LEAVE_STATUSES).toContain(row.status);

    const all = applicationsOf((await call(listLeave, { query: { page: 1, limit: 30 } })).payload);
    expect(all.total).toBe(3);
    for (const status of LEAVE_STATUSES) {
      const r = applicationsOf((await call(listLeave, { query: { status, page: 1, limit: 30 } })).payload);
      expect(r.rows.every((a) => a.status === status)).toBe(true);
    }

    const names = async (search, status) =>
      applicationsOf((await call(listLeave, { query: { search, status, page: 1, limit: 30 } })).payload).rows.map((a) => a.employee.surname).sort();
    expect(await names("wanj")).toEqual(["Wanjiku", "Wanjiku"]);     // partial name
    expect(await names("emp0102")).toEqual(["Mwangi"]);              // employee number
    expect(await names("finance")).toEqual(["Mwangi"]);              // department
    expect(await names("jane wan", "Approved")).toEqual(["Wanjiku"]);
    expect(await names("nobody")).toEqual([]);
  });

  it("approve sends {} and the row becomes Approved; asking again is refused with a readable message", async () => {
    const ctx = await setup();
    const emp = await ctx.mkEmployee();
    const app = await ctx.mkLeave(emp, await ctx.mkType());
    const { statusCode, payload } = await ctx.call(approveLeave, { params: { id: String(app._id) }, body: {} });
    expect(statusCode).toBe(200);
    expect(payload.application.status).toBe("Approved");
    expect(payload.application.approvedAt).toBeTruthy();

    const again = await ctx.call(approveLeave, { params: { id: String(app._id) }, body: {} });
    expect(again.statusCode).toBe(400);
    expect(again.payload.message).toMatch(/Cannot approve a Approved application/);
  });

  it("reject carries the optional reason, and the list shows it back as rejectionReason", async () => {
    const ctx = await setup();
    const emp = await ctx.mkEmployee();
    const app = await ctx.mkLeave(emp, await ctx.mkType());
    const rejected = await ctx.call(rejectLeave, { params: { id: String(app._id) }, body: { reason: "Peak season" } });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.payload.application.status).toBe("Rejected");

    const list = applicationsOf((await ctx.call(listLeave, { query: { status: "Rejected", page: 1, limit: 30 } })).payload);
    expect(list.rows[0].rejectionReason).toBe("Peak season");

    // without a reason the phone sends an empty body
    const app2 = await ctx.mkLeave(emp, await ctx.mkType(), { startDate: new Date("2026-08-03"), endDate: new Date("2026-08-04"), days: 2 });
    expect((await ctx.call(rejectLeave, { params: { id: String(app2._id) }, body: {} })).statusCode).toBe(200);
  });

  it("cancel works on Pending and Approved, refuses Rejected / Cancelled, and stores the reason", async () => {
    const ctx = await setup();
    const emp = await ctx.mkEmployee();
    const type = await ctx.mkType();
    const pending = await ctx.mkLeave(emp, type);
    const approved = await ctx.mkLeave(emp, type, { status: "Approved", startDate: new Date("2026-04-06"), endDate: new Date("2026-04-07"), days: 2 });
    const rejected = await ctx.mkLeave(emp, type, { status: "Rejected", startDate: new Date("2026-05-04"), endDate: new Date("2026-05-05"), days: 2 });

    const a = await ctx.call(cancelLeave, { params: { id: String(pending._id) }, body: { reason: "Plans changed" } });
    expect(a.payload.application).toMatchObject({ status: "Cancelled", cancelReason: "Plans changed" });
    const b = await ctx.call(cancelLeave, { params: { id: String(approved._id) }, body: {} });
    expect(b.payload.application.status).toBe("Cancelled");
    const c = await ctx.call(cancelLeave, { params: { id: String(rejected._id) }, body: {} });
    expect(c.statusCode).toBe(400);
    expect(c.payload.message).toMatch(/already Rejected/);
    const d = await ctx.call(cancelLeave, { params: { id: String(pending._id) }, body: {} });
    expect(d.statusCode).toBe(400);
  });

  it("decisions on another company's application or an unknown id fail cleanly", async () => {
    const a = await setup();
    const b = await setup();
    const theirs = await b.mkLeave(await b.mkEmployee(), await b.mkType());
    for (const fn of [approveLeave, rejectLeave, cancelLeave]) {
      expect((await a.call(fn, { params: { id: String(theirs._id) }, body: {} })).statusCode).toBe(404);
      const bad = await a.call(fn, { params: { id: "nope" }, body: {} });
      expect(bad.statusCode).toBe(400);
      expect(bad.payload.message).toMatch(/Invalid/);
    }
    // the phone used to PUT /hr/leave-applications/:id {status}; that route does not exist
    expect(() => routeHandler(leaveApplicationsRouter, "put", "/:id")).toThrow();
  });
});

// ── Attendance (hr/attendance/index.tsx) ────────────────────────────────────────────────────────
describe("mobile contract: attendance", () => {
  const at = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min);   // device-local instant
  const rec = (ctx, employee, checkIn, checkOut, over = {}) => HRAttendance.create({
    company: ctx.business, employee: employee._id,
    date: checkIn.toISOString().slice(0, 10), checkIn, checkOut: checkOut ?? null,
    duration: checkOut ? Math.round((checkOut - checkIn) / 60000) : null, source: "ess", ...over,
  });
  const dayParams = (dayStr, extra = {}) => ({ ...dayRange(dayStr), page: 1, limit: 50, ...extra });

  it("lists one local day (from inclusive, to exclusive) and answers records / total / totalPages", async () => {
    const ctx = await setup();
    const jane = await ctx.mkEmployee({ surname: "Wanjiku", otherNames: "Jane", employeeNumber: "EMP0201" });
    const peter = await ctx.mkEmployee({ surname: "Mwangi", otherNames: "Peter" });
    await rec(ctx, jane, at(2026, 9, 24, 8, 5), at(2026, 9, 24, 17, 20), { note: "Site visit" });
    await rec(ctx, peter, at(2026, 9, 24, 9, 0), null);
    await rec(ctx, peter, at(2026, 9, 23, 23, 59), at(2026, 9, 24, 0, 1));   // started yesterday: yesterday's record
    await rec(ctx, peter, at(2026, 9, 25, 0, 0), null);                       // exactly the next midnight: excluded (to is exclusive)

    const { statusCode, payload } = await ctx.call(listAttendance, { query: dayParams("2026-09-24") });
    expect(statusCode).toBe(200);
    const page = recordsOf(payload);
    expect(page.total).toBe(2);
    expect(page.rows).toHaveLength(2);
    expect(page.pages).toBe(1);
    expect(page.rows.map((r) => r.employee.surname).sort()).toEqual(["Mwangi", "Wanjiku"]);
    expect(page.rows.find((r) => r.employee.surname === "Wanjiku").note).toBe("Site visit");
  });

  it("a check-in just after midnight in Kenya is on that local day even though its stored UTC date is the day before", async () => {
    const ctx = await setup();
    const jane = await ctx.mkEmployee({ surname: "Wanjiku", otherNames: "Jane", employeeNumber: "EMP0201" });
    const early = at(2026, 9, 24, 1, 30);
    const r = await rec(ctx, jane, early, at(2026, 9, 24, 10, 0), { note: "Night shift" });
    // in Nairobi (UTC+3) the stored date is 2026-09-23; on a UTC machine it is 2026-09-24 — the phone must not depend on it
    const { payload } = await ctx.call(listAttendance, { query: dayParams("2026-09-24") });
    const page = recordsOf(payload);
    expect(page.rows.map((x) => String(x._id))).toEqual([String(r._id)]);
    const row = page.rows[0];
    for (const k of ["checkIn", "checkOut", "duration", "note", "source"]) expect(row).toHaveProperty(k);
    expect(personName(row.employee)).toBe("Wanjiku Jane");
    expect(row.employee.employeeNumber).toBe("EMP0201");
    expect(row.duration).toBe(510);
    expect(fmtDuration(row.duration)).toBe("8h 30m");
    expect(row.source).toBe("ess");
    // the neighbouring days are empty
    expect(recordsOf((await ctx.call(listAttendance, { query: dayParams("2026-09-23") })).payload).rows).toHaveLength(0);
    expect(recordsOf((await ctx.call(listAttendance, { query: dayParams("2026-09-25") })).payload).rows).toHaveLength(0);
  });

  it("an open check-in has no checkOut / duration (shown as 'Still in')", async () => {
    const ctx = await setup();
    const jane = await ctx.mkEmployee();
    await rec(ctx, jane, at(2026, 9, 24, 8, 0), null);
    const row = recordsOf((await ctx.call(listAttendance, { query: dayParams("2026-09-24") })).payload).rows[0];
    expect(row.checkOut).toBeNull();
    expect(fmtDuration(row.duration)).toBe("—");
  });

  it("search narrows the day by employee name, number or department; paging uses totalPages", async () => {
    const ctx = await setup();
    const jane = await ctx.mkEmployee({ surname: "Wanjiku", otherNames: "Jane", employeeNumber: "EMP0201", department: ctx.sales._id });
    const peter = await ctx.mkEmployee({ surname: "Mwangi", otherNames: "Peter", employeeNumber: "EMP0202", department: ctx.finance._id });
    await rec(ctx, jane, at(2026, 9, 24, 8, 0), at(2026, 9, 24, 16, 0));
    await rec(ctx, peter, at(2026, 9, 24, 8, 30), at(2026, 9, 24, 16, 30));

    const who = async (search) =>
      recordsOf((await ctx.call(listAttendance, { query: dayParams("2026-09-24", { search }) })).payload).rows.map((r) => r.employee.surname);
    expect(await who("wanj")).toEqual(["Wanjiku"]);
    expect(await who("emp0202")).toEqual(["Mwangi"]);
    expect(await who("financ")).toEqual(["Mwangi"]);
    expect(await who("nobody")).toEqual([]);

    const p1 = recordsOf((await ctx.call(listAttendance, { query: { ...dayRange("2026-09-24"), page: 1, limit: 1 } })).payload);
    expect(p1.rows).toHaveLength(1);
    expect(p1.total).toBe(2);
    expect(p1.pages).toBe(2);
    expect(recordsOf((await ctx.call(listAttendance, { query: { ...dayRange("2026-09-24"), page: 2, limit: 1 } })).payload).rows).toHaveLength(1);
  });

  it("is scoped to the company, and a bad from / to is a clear 400", async () => {
    const a = await setup();
    const b = await setup();
    await rec(b, await b.mkEmployee(), at(2026, 9, 24, 8, 0), null);
    expect(recordsOf((await a.call(listAttendance, { query: dayParams("2026-09-24") })).payload).rows).toHaveLength(0);
    const bad = await a.call(listAttendance, { query: { from: "yesterday", to: "today", page: 1, limit: 50 } });
    expect(bad.statusCode).toBe(400);
    expect(bad.payload.message).toMatch(/valid dates/);
  });

  it("the web's date / month filters still work", async () => {
    const ctx = await setup();
    const jane = await ctx.mkEmployee();
    const r = await rec(ctx, jane, at(2026, 9, 24, 12, 0), at(2026, 9, 24, 13, 0));
    const byDate = await ctx.call(listAttendance, { query: { date: r.date } });
    expect(byDate.payload.records).toHaveLength(1);
    const byMonth = await ctx.call(listAttendance, { query: { month: 9, year: 2026 } });
    expect(byMonth.payload.records).toHaveLength(1);
  });
});

// ── the mobile helpers themselves ───────────────────────────────────────────────────────────────
describe("mobile HR helpers", () => {
  it("workingDays", () => {
    expect(workingDays("2026-09-21", "2026-09-25")).toBe(5);   // Mon-Fri
    expect(workingDays("2026-09-21", "2026-09-27")).toBe(5);   // week incl. weekend
    expect(workingDays("2026-09-25", "2026-09-25")).toBe(1);
    expect(workingDays("2026-09-26", "2026-09-27")).toBe(1);   // weekend only counts as 1 (server rule)
    expect(workingDays("2026-09-29", "2026-09-25")).toBe(0);
    expect(workingDays("", "2026-09-25")).toBe(0);
  });

  it("addDaysISO / dayRange use the local calendar (no toISOString day shift)", () => {
    expect(addDaysISO("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDaysISO("2026-01-01", -1)).toBe("2025-12-31");
    const { from, to } = dayRange("2026-09-24");
    expect(new Date(from).getTime()).toBe(new Date(2026, 8, 24).getTime());
    expect(new Date(to).getTime()).toBe(new Date(2026, 8, 25).getTime());
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("fmtDuration", () => {
    expect(fmtDuration(95)).toBe("1h 35m");
    expect(fmtDuration(40)).toBe("40m");
    expect(fmtDuration(null)).toBe("—");
  });

  it("makes a 403 from the permission guard readable", () => {
    const err = { response: { status: 403, data: { message: "Permission denied for hrLeave.update" } } };
    expect(hrError(err, "x")).toMatch(/don't have permission to do this \(hrLeave\.update\)/);
  });
});
