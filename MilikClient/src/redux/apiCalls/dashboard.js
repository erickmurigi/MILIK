import { adminRequests } from "../../utils/requestMethods";

export const getDashboardSummary = async (business) => {
  const res = await adminRequests.get(`/dashboard/summary?business=${business}`);
  return res.data;
};
