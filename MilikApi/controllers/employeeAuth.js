import Employee from "../models/Employee.js";
import Business from "../models/Company.js";
import bcrypt from "bcryptjs";
import { createError } from "../utils/error.js";
import jwt from "jsonwebtoken";

// Get JWT secret with lazy validation
const getJWTSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required");
  }
  return secret;
};

export const Register = async (req, res, next) => {
  try {
    // Security: use authenticated user's company instead of client-provided business data.
    const businessId = req.user?.company;

    if (!businessId) {
      return res.status(400).json({ message: "Business context is required" });
    }

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(req.body.password, salt);

    const newEmployee = new Employee({
      ...req.body,
      password: hash,
      business: businessId,
    });

    const businessExists = await Business.findById(businessId);
    if (!businessExists) {
      return res.status(404).json({ message: "Business not found" });
    }

    const savedEmployee = await newEmployee.save();
    return res.status(201).json(savedEmployee);
  } catch (err) {
    return next(err);
  }
};

export const Login = async (req, res, next) => {
  try {
    const { username, password, businessId } = req.body;

    if (!businessId && username !== "Support") {
      return next(createError(400, "Business ID is required"));
    }

    let employee;

    if (username === "Support") {
      employee = await Employee.findOne({ username });
    } else {
      employee = await Employee.findOne({ username, business: businessId }).populate("business");
    }

    if (!employee) {
      return next(createError(404, "Employee not found"));
    }

    // Determine effective admin status (admin or accountant)
    const effectiveIsAdmin = employee.isAdmin || employee.occupation === "Accountant";

    // Apply business validation to admins and accountants.
    if (effectiveIsAdmin && username !== "Support") {
      if (!employee.business || employee.business._id.toString() !== businessId) {
        return next(createError(403, "Data Mismatch"));
      }
    }

    const isPasswordCorrect = await bcrypt.compare(password, employee.password);
    if (!isPasswordCorrect) {
      return next(createError(404, "Incorrect password"));
    }

    const token = jwt.sign(
      { id: employee._id, isAdmin: effectiveIsAdmin },
      getJWTSecret(),
      { expiresIn: "1d" }
    );

    const { password: pass, isAdmin, business, ...otherDetails } = employee._doc;

    return res.status(200).json({
      details: { ...otherDetails },
      isAdmin: effectiveIsAdmin,
      token,
    });
  } catch (err) {
    console.error("Login error:", err);
    return next(err);
  }
};

// Logout (not needed for token-based auth, but kept for reference)
export const Logout = async (req, res) => {
  // Since we're using tokens, logout is handled client-side by clearing localStorage.
  return res.status(200).json({ message: "User has been logged out." });
};
