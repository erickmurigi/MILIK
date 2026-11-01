import express from "express";
import bcrypt from "bcryptjs";
import Company from "../models/Company.js";
import Landlord from "../models/Landlord.js";
import { signLandlordPortalToken, verifyLandlordPortalToken } from "../middleware/landlordPortalAuth.js";

const router = express.Router();

// Burned at module load so every "account doesn't exist" rejection still pays the same
// bcrypt cost as a real wrong-password rejection — otherwise a fast-path reject (company
// code or landlord code not found) is trivially distinguishable from a slow one (password
// checked) by response time, letting an attacker enumerate valid company/landlord codes.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("milik-landlord-portal-dummy-hash", 10);

// POST /api/landlord-portal/auth/login
router.post("/login", async (req, res) => {
  try {
    const { companyCode, landlordCode, password } = req.body;
    if (!companyCode || !landlordCode || !password) {
      return res.status(400).json({ message: "Company code, landlord code, and password are required" });
    }

    const company = await Company.findOne({ companyCode: String(companyCode).trim().toUpperCase() }).lean();

    const landlord = company
      ? await Landlord.findOne({
          company: company._id,
          landlordCode: String(landlordCode).trim(),
        }).select("+portalPassword landlordName landlordCode email portalAccess status").lean()
      : null;

    if (!company || !landlord || landlord.portalAccess !== "Enabled" || !landlord.portalPassword) {
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      return res.status(401).json({ message: "Portal access not enabled or invalid credentials" });
    }

    const valid = await bcrypt.compare(password, landlord.portalPassword);
    if (!valid) return res.status(401).json({ message: "Invalid credentials" });

    if (landlord.status === "Archived") {
      return res.status(403).json({ message: "This account has been deactivated. Contact your property manager." });
    }

    const token = signLandlordPortalToken(landlord, company);
    // updateOne, not a full-document save — a legacy record with any unrelated validation
    // quirk must never be able to fail login over a field this request didn't touch.
    await Landlord.updateOne({ _id: landlord._id }, { $set: { portalLastLogin: new Date() } });

    res.json({
      token,
      landlord: {
        _id: landlord._id,
        landlordName: landlord.landlordName,
        landlordCode: landlord.landlordCode,
        email: landlord.email,
      },
      company: {
        _id: company._id,
        companyName: company.companyName,
        companyCode: company.companyCode,
        logo: /^https?:\/\//i.test(company.logo || "") ? company.logo : "",
      },
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// POST /api/landlord-portal/auth/change-password
router.post("/change-password", verifyLandlordPortalToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Current and new passwords are required" });
    }
    if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return res.status(400).json({ message: "New password must be at least 8 characters with at least one uppercase letter and one digit" });
    }

    const { landlordId, companyId } = req.landlordPortal;
    const landlord = await Landlord.findOne({ _id: landlordId, company: companyId }).select("+portalPassword").lean();
    if (!landlord) return res.status(404).json({ message: "Landlord not found" });

    const valid = await bcrypt.compare(currentPassword, landlord.portalPassword || "");
    if (!valid) return res.status(400).json({ message: "Current password is incorrect" });

    await Landlord.updateOne({ _id: landlord._id }, { $set: { portalPassword: await bcrypt.hash(newPassword, 10) } });

    res.json({ message: "Password changed successfully" });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

export default router;
