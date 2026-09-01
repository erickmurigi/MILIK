// Generic version of the invokeMeterReadingAction pattern already used in production
// (see controllers/propertyController/meterReadings.js) for batch-calling a controller
// without an HTTP server + JWT round trip. Reused here as a shared test helper so any
// Express-style controller `(req, res, next) => {}` can be exercised directly.
//
// Usage:
//   import { callController } from "../test/callController.js";
//   import { getSomething } from "../controllers/propertyController/someController.js";
//
//   const { statusCode, payload } = await callController(getSomething, {
//     params: { id: someId },
//     user: fakeReqUser, // shape from createTestUser()
//   });
//   expect(statusCode).toBe(200);
//
// On next(err) the promise rejects with err — use `await expect(callController(...)).rejects.toThrow(...)`
// for controllers that are expected to fail.
export const callController = (handlerFn, { params = {}, query = {}, body = {}, user = {}, headers = {}, ...reqOverrides } = {}) => {
  return new Promise((resolve, reject) => {
    let settled = false;

    const req = {
      params,
      query,
      body,
      user,
      headers,
      cookies: {},
      ...reqOverrides,
    };

    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        if (!settled) {
          settled = true;
          resolve({ statusCode: this.statusCode || 200, payload });
        }
        return this;
      },
    };

    const next = (err) => {
      if (!settled) {
        settled = true;
        reject(err || new Error("Controller called next() without a response."));
      }
    };

    Promise.resolve(handlerFn(req, res, next)).catch((err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
};

export default callController;
