import express from "express";
import TrialRequest from "../models/TrialRequest.js";
import { sendTrialRequestNotification } from "../utils/trialRequestMailer.js";

const router = express.Router();

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeText(value = "") {
  return String(value || "").trim();
}

const BLOCKED_TLDS = new Set(["local", "internal", "test", "invalid", "localhost", "example"]);

function isValidEmail(value = "") {
  const email = String(value || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return false;
  const tld = email.split(".").pop().toLowerCase();
  return !BLOCKED_TLDS.has(tld);
}

function isValidPhone(value = "") {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 7;
}

function isValidName(value = "") {
  const name = String(value || "").trim();
  return name.length >= 3 && /\S/.test(name);
}

router.post("/", async (req, res) => {
  try {
    const payload = req.body || {};
    const name = normalizeText(payload.name);
    const email = normalizeEmail(payload.email);
    const phone = normalizeText(payload.phone);
    const company =
      normalizeText(payload.company) ||
      normalizeText(payload.companyName) ||
      normalizeText(payload.businessName);
    const role = ["property_manager", "landlord"].includes(normalizeText(payload.role))
      ? normalizeText(payload.role)
      : "property_manager";
    const portfolioSize = normalizeText(payload.portfolioSize);
    const city = normalizeText(payload.city);
    const country = normalizeText(payload.country) || "Kenya";
    const notes = normalizeText(payload.notes);

    const VALID_MODULES = new Set([
      "property_management", "car_wash", "human_resources", "inventory_pos", "property_sales",
    ]);
    const selectedModules = Array.isArray(payload.modules)
      ? payload.modules.filter((m) => VALID_MODULES.has(String(m).trim()))
      : [];

    if (!isValidName(name)) {
      return res.status(400).json({ success: false, message: "Please provide your full name (at least 3 characters)" });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Please provide a valid business email address" });
    }

    if (!isValidPhone(phone)) {
      return res.status(400).json({ success: false, message: "Please provide a valid phone number" });
    }

    const updateFields = {
      name, phone, company, role,
      portfolioSize, city, country, notes,
      rawPayload: payload,
    };
    if (selectedModules.length > 0) updateFields.selectedModules = selectedModules;

    // Atomic upsert — avoids E11000 duplicate key errors from race conditions or
    // retried submissions. $setOnInsert keeps status/email unchanged on updates.
    const before = await TrialRequest.findOne({ email }, { _id: 1 }).lean();
    const trial = await TrialRequest.findOneAndUpdate(
      { email },
      {
        $set: updateFields,
        $setOnInsert: { email, status: "pending" },
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );

    const isNew = !before;
    const emailNotification = await sendTrialRequestNotification(trial).catch(() => ({
      attempted: false, sent: false, skipped: true, error: "Notification failed silently",
    }));

    return res.status(isNew ? 201 : 200).json({
      success: true,
      message: "Your request has been received. Our team will reach out shortly.",
      trialRequestId: trial._id,
      emailNotification,
    });
  } catch (error) {
    console.error("Trial request error:", error);
    const isClientError = error?.status === 400 || error?.isValidation === true;
    return res.status(isClientError ? 400 : 500).json({
      success: false,
      message: isClientError
        ? error.message
        : "An unexpected error occurred. Please try again.",
    });
  }
});

export default router;
