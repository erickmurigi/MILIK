// Regression coverage for the landlord-portal 403 found during manual testing: a stray
// staff-session cookie (sent automatically by the browser on any same-origin request,
// regardless of which axios instance made the call) was getting decoded into req.user by
// the global /api gate, and enforceRequestedCompanyScope then rejected it for having no
// `company` claim — a shape portal-session tokens (ESS, landlord-portal) never have and were
// never supposed to be checked against.
import { describe, it, expect, vi } from "vitest";
import { enforceRequestedCompanyScope } from "./verifyToken.js";

const callGuard = (req) => {
  const next = vi.fn();
  enforceRequestedCompanyScope(req, {}, next);
  return next;
};

describe("enforceRequestedCompanyScope", () => {
  it("passes through a landlordPortal-role user with no company claim", () => {
    const next = callGuard({ path: "/api/landlord-portal/statements", user: { role: "landlordPortal" } });
    expect(next).toHaveBeenCalledWith();
  });

  it("passes through an hrEmployee-role user with no company claim", () => {
    const next = callGuard({ path: "/api/hr/ess/leave-applications", user: { role: "hrEmployee" } });
    expect(next).toHaveBeenCalledWith();
  });

  it("passes through any request under /api/landlord-portal regardless of req.user shape", () => {
    // Covers the login route specifically: no landlordPortal token exists yet at that
    // point, so only a path-based exemption (not a role-based one) can protect it from a
    // leftover staff cookie that happens to decode successfully.
    const next = callGuard({ path: "/api/landlord-portal/auth/login", user: { isSystemAdmin: false } });
    expect(next).toHaveBeenCalledWith();
  });

  it("still blocks a real staff user with no company on an unrelated route", () => {
    const next = callGuard({ path: "/api/landlords", user: { isSystemAdmin: false } });
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeTruthy();
    expect(err.status).toBe(403);
  });

  it("still allows a real staff user whose company matches the request", () => {
    const next = callGuard({ path: "/api/landlords", query: {}, body: {}, params: {}, user: { company: "64a000000000000000000001" } });
    expect(next).toHaveBeenCalledWith();
  });
});
