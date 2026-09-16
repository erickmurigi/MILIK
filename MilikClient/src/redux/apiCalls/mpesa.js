import { adminRequests } from "../../utils/requestMethods";

export const listMpesaCollections = async (params = {}) => {
  const res = await adminRequests.get("/mpesa-collections", { params });
  return res.data;
};

export const deleteMpesaCollection = async (id, params = {}) => {
  const res = await adminRequests.delete(`/mpesa-collections/${id}`, { params });
  return res.data;
};

export const importMpesaBatch = async (payload = {}) => {
  const res = await adminRequests.post("/mpesa-collections/import-batch", payload);
  return res.data;
};
