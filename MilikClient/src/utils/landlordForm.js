export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const INITIAL_LANDLORD_FORM = {
  landlordCode: "",
  landlordType: "Individual",
  landlordName: "",
  regId: "",
  taxPin: "",
  status: "Active",
  phoneNumber: "",
  email: "",
  location: "",
  postalAddress: "",
  bankName: "",
  branchName: "",
  accountName: "",
  accountNumber: "",
  mobileNumber: "",
};

// Kenyan mobile, stored and shown as 0712 345 678 (the same format tenants use)
export const toKenyanMobile = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  let local = digits;
  if (digits.length === 12 && digits.startsWith("254")) local = `0${digits.slice(3)}`;
  else if (digits.length === 9) local = `0${digits}`;
  return /^0[17]\d{8}$/.test(local) ? local : null;
};

export const formatMobile = (local) => `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;

// "-" means no phone on record, the same as email. It is stored as an empty phone.
export const resolveLandlordPhone = (raw) => {
  const trimmed = String(raw ?? "").trim();
  if (trimmed === "-") return { value: "-" };
  const mobile = toKenyanMobile(trimmed);
  return mobile ? { value: mobile } : { error: "Enter one valid mobile, e.g. 0712 345 678, or -" };
};

export const validateLandlordForm = (form) => {
  const errors = {};
  if (!form.landlordName.trim()) errors.landlordName = "Required";

  const phone = resolveLandlordPhone(form.phoneNumber);
  if (phone.error) errors.phoneNumber = phone.error;

  const email = form.email.trim();
  if (!email) errors.email = "Required, or -";
  else if (email !== "-" && !EMAIL_PATTERN.test(email)) errors.email = "Invalid email, or -";

  if (form.mobileNumber.trim() && !toKenyanMobile(form.mobileNumber)) {
    errors.mobileNumber = "Invalid M-Pesa number";
  }
  return errors;
};

// The payload the server stores for a landlord, whichever form created it
export const buildLandlordPayload = (form, companyId) => ({
  ...form,
  phoneNumber: resolveLandlordPhone(form.phoneNumber).value ?? "",
  email: form.email.trim(),
  mobileNumber: form.mobileNumber.trim() ? toKenyanMobile(form.mobileNumber) : "",
  portalAccess: "Disabled",
  company: companyId,
});
