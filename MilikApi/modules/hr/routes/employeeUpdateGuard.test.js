// A plain employee update must not be able to set the ESS login fields (an unhashed password would break that login).
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { routeHandler } from "../../../test/routeHandler.js";
import { createTestCompany, createTestUser } from "../../../test/factories.js";
import HREmployee from "../models/HREmployee.js";
import "../models/HRDepartment.js"; // the update populates these refs
import "../models/HRDesignation.js";
import employeesRouter from "./employees.js";

const updateEmployee = routeHandler(employeesRouter, "put", "/:id");

describe("PUT /hr/employees/:id", () => {
  it("updates ordinary fields but ignores essPassword and essEnabled", async () => {
    const company = await createTestCompany({ modules: { hr: true } });
    const user = await createTestUser({ company });
    const emp = await HREmployee.create({ company: company._id, surname: "Otieno", otherNames: "Sam", phoneNumber: "0700111222", employmentType: "Permanent", dateJoined: new Date("2024-01-15"), essEnabled: false, essPassword: "" });
    const { statusCode, payload } = await callController(updateEmployee, {
      user, params: { id: String(emp._id) },
      body: { otherNames: "Samuel", essPassword: "plain-text", essEnabled: true },
    });
    expect(statusCode, JSON.stringify(payload)).toBe(200);
    const saved = await HREmployee.findById(emp._id).lean();
    expect(saved.otherNames).toBe("Samuel");
    expect(saved.essPassword).toBe("");
    expect(saved.essEnabled).toBe(false);
  });
});
