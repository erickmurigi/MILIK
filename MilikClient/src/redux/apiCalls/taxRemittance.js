import { adminRequests } from "../../utils/requestMethods";

export const getVatReturnSummary = async (params = {}) => {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== "")
  ).toString();
  const res = await adminRequests.get(`/vat-remittance/summary${query ? `?${query}` : ""}`);
  return res.data;
};

export const getVatRemittanceHistory = async (params = {}) => {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== "")
  ).toString();
  const res = await adminRequests.get(`/vat-remittance${query ? `?${query}` : ""}`);
  return res.data;
};

export const remitVat = async (data) => {
  const res = await adminRequests.post("/vat-remittance/remit", data);
  return res.data;
};

export const voidVatRemittance = async (id, data) => {
  const res = await adminRequests.patch(`/vat-remittance/${id}/void`, data);
  return res.data;
};

export const getWhtReturnSummary = async (params = {}) => {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== "")).toString();
  const res = await adminRequests.get(`/wht-remittance/summary${query ? `?${query}` : ""}`);
  return res.data;
};

export const getWhtRemittanceHistory = async (params = {}) => {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== "")).toString();
  const res = await adminRequests.get(`/wht-remittance${query ? `?${query}` : ""}`);
  return res.data;
};

export const remitWht = async (data) => {
  const res = await adminRequests.post("/wht-remittance/remit", data);
  return res.data;
};

export const voidWhtRemittance = async (id, data) => {
  const res = await adminRequests.patch(`/wht-remittance/${id}/void`, data);
  return res.data;
};
