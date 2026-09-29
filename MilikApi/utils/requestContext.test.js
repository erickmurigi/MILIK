// The one rule every controller should use to work out "which company is this request for": a client-supplied id (header,
// body, or query) is honoured only when the caller may actually act as that company; otherwise the caller's own company
// from their verified session is used. This is the fix for the cross-tenant bug documented at the top of resolveBusinessId
// — pin its behaviour down here so a future edit (or a new controller rolling its own version again) can't reintroduce it.
import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { resolveBusinessId, resolveBusinessIdOrThrow } from "./requestContext.js";

const oid = () => new mongoose.Types.ObjectId().toString();

describe("resolveBusinessId", () => {
  it("uses the caller's own company when nothing else is requested", () => {
    const own = oid();
    expect(resolveBusinessId({ user: { company: own }, headers: {}, body: {}, query: {} })).toBe(own);
  });

  it("refuses a company a plain user has no access to, and falls back to their own", () => {
    const own = oid();
    const other = oid();
    const req = { user: { company: own }, headers: {}, body: { business: other }, query: {} };
    expect(resolveBusinessId(req)).toBe(own); // never the requested one
  });

  it("honours an explicit company for a user who is genuinely assigned to it", () => {
    const own = oid();
    const second = oid();
    const req = { user: { company: own, accessibleCompanies: [own, second] }, headers: {}, body: {}, query: { business: second } };
    expect(resolveBusinessId(req)).toBe(second);
  });

  it("honours an explicit company for a system admin, whatever it is", () => {
    const admin = { company: oid(), isSystemAdmin: true };
    const target = oid();
    expect(resolveBusinessId({ user: admin, headers: {}, body: {}, query: { business: target } })).toBe(target);
  });

  it("falls back to the admin's own company when nothing is requested", () => {
    const own = oid();
    const admin = { company: own, superAdminAccess: true };
    expect(resolveBusinessId({ user: admin, headers: {}, body: {}, query: {} })).toBe(own);
  });

  it("reads every recognised header, body and query key, in that order", () => {
    const admin = { company: oid(), isSystemAdmin: true };
    const a = oid(), b = oid(), c = oid(), d = oid(), e = oid(), f = oid();
    expect(resolveBusinessId({ user: admin, headers: { "x-active-company-id": a }, body: {}, query: {} })).toBe(a);
    expect(resolveBusinessId({ user: admin, headers: { "x-company-id": b }, body: {}, query: {} })).toBe(b);
    expect(resolveBusinessId({ user: admin, headers: {}, body: { businessId: c }, query: {} })).toBe(c);
    expect(resolveBusinessId({ user: admin, headers: {}, body: { company: d }, query: {} })).toBe(d);
    expect(resolveBusinessId({ user: admin, headers: {}, body: {}, query: { companyId: e } })).toBe(e);
    expect(resolveBusinessId({ user: admin, headers: {}, body: {}, query: { company: f } })).toBe(f);
  });

  it("accepts a populated company object, not just a bare id", () => {
    const own = { _id: oid(), companyName: "Acme" };
    expect(resolveBusinessId({ user: { company: own }, headers: {}, body: {}, query: {} })).toBe(String(own._id));
  });

  it("returns null rather than throwing when there is nothing to resolve", () => {
    expect(resolveBusinessId({ user: {}, headers: {}, body: {}, query: {} })).toBeNull();
  });
});

describe("resolveBusinessIdOrThrow", () => {
  it("throws a 403 instead of silently proceeding with no company", () => {
    expect(() => resolveBusinessIdOrThrow({ user: {}, headers: {}, body: {}, query: {} }, "widgets"))
      .toThrow(/widgets/);
    try {
      resolveBusinessIdOrThrow({ user: {}, headers: {}, body: {}, query: {} });
    } catch (error) {
      expect(error.status).toBe(403);
    }
  });

  it("returns the resolved id when one is found", () => {
    const own = oid();
    expect(resolveBusinessIdOrThrow({ user: { company: own }, headers: {}, body: {}, query: {} })).toBe(own);
  });
});
