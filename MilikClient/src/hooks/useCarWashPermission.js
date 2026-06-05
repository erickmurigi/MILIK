import { useSelector } from "react-redux";
import { selectCurrentCompany, selectCurrentUser } from "../redux/selectors";
import { hasCompanyPermission } from "../utils/permissions";

/**
 * Returns true if the current user has the given carwash permission.
 *
 * Usage:
 *   const canCreate = useCarWashPermission("carwash-jobs", "create");
 *   const canManage = useCarWashPermission("carwash-services", "manage");
 */
const useCarWashPermission = (resource, action = "view") => {
  const user    = useSelector(selectCurrentUser);
  const company = useSelector(selectCurrentCompany);
  return hasCompanyPermission(user || {}, company, resource, action, "carwash");
};

export default useCarWashPermission;
