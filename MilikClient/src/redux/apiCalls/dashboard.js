import { adminRequests } from "../../utils/requestMethods";

export const getDashboardSummary = async (business) => {
  try {
    const res = await adminRequests.get(`/dashboard/summary?business=${business}`);
    return res.data;
  } catch (err) {
    throw err;
  }
};
