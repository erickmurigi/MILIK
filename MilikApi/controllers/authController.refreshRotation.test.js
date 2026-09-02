// Regression test for the refresh-rotation race that was logging out actively-used
// tabs on a plain page refresh: /auth/refresh used to rotate (and immediately
// blacklist) the presented token on EVERY call, so any other open tab — or an
// in-flight request in the same tab — still holding that token 401'd on its very
// next authenticated call. Fix: only rotate when the token is actually close to
// expiring (REFRESH_ROTATION_WINDOW_MS in authController.js); otherwise hand the
// same token back unchanged and leave it un-blacklisted.
import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { callController } from "../test/callController.js";
import { refreshToken } from "./authController.js";

const JWT_ISSUER = "milik-api";
const JWT_AUDIENCE = "milik-client";

const signToken = (expiresIn) =>
  jwt.sign(
    { id: "user-1", email: "test@milik.test", company: null },
    process.env.JWT_SECRET,
    { expiresIn, issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
  );

const callRefresh = (token) =>
  callController(refreshToken, { headers: { authorization: `Bearer ${token}` } });

describe("refreshToken rotation gating", () => {
  it("does NOT rotate or blacklist a token that still has most of its life left", async () => {
    const token = signToken("7d"); // far outside the 2-day rotation window

    const first = await callRefresh(token);
    expect(first.statusCode).toBe(200);
    expect(first.payload.token).toBe(token); // handed back unchanged, not rotated

    // The presented token must still be usable afterwards — proving it was never
    // blacklisted. If rotation had fired unconditionally (the old bug), this
    // second call with the same token would 401.
    const second = await callRefresh(token);
    expect(second.statusCode).toBe(200);
    expect(second.payload.token).toBe(token);
  });

  it("DOES rotate and blacklist a token that is close to expiring", async () => {
    const token = signToken("1h"); // inside the 2-day rotation window

    const first = await callRefresh(token);
    expect(first.statusCode).toBe(200);
    expect(first.payload.token).not.toBe(token); // rotated to a new token

    // The old token is now dead — a second call with it must be rejected (401)
    // rather than silently accepted (that would be a security regression).
    // refreshToken() responds via res.json(), not next(err), so callController
    // resolves here rather than rejecting.
    const second = await callRefresh(token);
    expect(second.statusCode).toBe(401);
  });
});
