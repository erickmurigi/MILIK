import { adminRequests } from "../../utils/requestMethods";
import { extractList } from "./shared";

// Get chart of accounts
export const getChartOfAccounts = async (params = {}) => {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      search.append(key, value);
    }
  });

  const query = search.toString();
  const res = await adminRequests.get(`/chart-of-accounts${query ? `?${query}` : ""}`);
  return extractList(res.data);
};
