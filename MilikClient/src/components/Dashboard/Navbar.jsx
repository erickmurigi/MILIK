import React from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  FaBars,
  FaBell,
  FaSignOutAlt,
  FaMoon,
  FaSun,
} from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import { clearAuth } from "../../redux/authSlice";
import { logoutUser } from "../../redux/apiCalls";
import { clearCompanyState } from "../../redux/companiesRedux";
import { clearClientSessionStorage } from "../../utils/sessionCleanup";
import { selectCurrentUser, selectCurrentCompany } from "../../redux/selectors";

const POST_LOGOUT_LANDING_KEY = "milik_post_logout_landing";

const initialsFromName = (value = "") =>
  String(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "CO";

const CompanyAvatar = ({ logo, name, darkMode, size = "h-11 w-11" }) => {
  if (logo) {
    return (
      <div
        className={`${size} overflow-hidden rounded-2xl border shadow-sm ${
          darkMode ? "border-gray-700 bg-gray-800" : "border-[#d9e6df] bg-white"
        }`}
      >
        <img src={logo} alt={name} className="h-full w-full object-contain p-1.5" />
      </div>
    );
  }

  return (
    <div
      className={`${size} rounded-2xl flex items-center justify-center shadow-sm ${
        darkMode
          ? "bg-gradient-to-br from-[#31694E] to-[#1f4a35] text-white"
          : "bg-[#eef5f1] text-[#1f4a35] border border-[#d9e6df]"
      }`}
    >
      <span className="text-sm font-extrabold">{initialsFromName(name)}</span>
    </div>
  );
};

const Navbar = React.memo(({ setSidebarOpen, darkMode, setDarkMode }) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const currentUser = useSelector(selectCurrentUser);
  const currentCompany = useSelector(selectCurrentCompany);

  const isSystemAdmin = Boolean(currentUser?.isSystemAdmin || currentUser?.superAdminAccess);

  const companyName =
    currentCompany?.companyName ||
    currentUser?.company?.companyName ||
    (isSystemAdmin ? "Select company" : "No active company");
  const userName = currentUser
    ? `${currentUser.surname || ""} ${currentUser.otherNames || ""}`.trim()
    : "User";
  const handleLogout = async () => {
    try {
      await dispatch(logoutUser());
    } catch (_error) {
      clearClientSessionStorage();
      dispatch(clearAuth());
      dispatch(clearCompanyState());
    }

    try {
      sessionStorage.setItem(POST_LOGOUT_LANDING_KEY, "dashboard");
    } catch (_error) {
      // Ignore storage write failures and continue redirect.
    }

    navigate("/login", { replace: true });
  };

  return (
    <nav
      className={`sticky top-0 z-20 border-b shadow-sm ${
        darkMode ? "border-gray-700 bg-gray-900" : "border-[#dbe7e1] bg-white"
      }`}
    >
      <div className="px-2 py-0 sm:px-3">
        <div className="flex min-h-[22px] items-center justify-between gap-1.5 sm:gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <button
              onClick={() => setSidebarOpen?.(true)}
              className={`lg:hidden rounded-lg p-1.5 transition-colors ${
                darkMode
                  ? "text-gray-300 hover:bg-gray-700"
                  : "text-gray-700 hover:bg-[#eef5f1]"
              }`}
            >
              <FaBars />
            </button>

            <div className="flex min-w-0 items-center">
              <div className="min-w-0 leading-tight">
                <h1
                  className={`truncate text-[12px] font-bold leading-none tracking-tight sm:text-[13px] ${
                    darkMode ? "text-white" : "text-[#183a2d]"
                  }`}
                  title={companyName}
                >
                  {companyName}
                </h1>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <button
              onClick={() => setDarkMode?.(!darkMode)}
              className={`rounded-md p-1 transition-colors duration-200 ${
                darkMode
                  ? "bg-gray-800 text-yellow-400 hover:bg-gray-700"
                  : "bg-[#f4f8f6] text-[#1f4a35] hover:bg-[#e7f0eb]"
              }`}
              aria-label="Toggle theme"
            >
              {darkMode ? <FaSun className="text-xs" /> : <FaMoon className="text-xs" />}
            </button>

            <button
              className={`relative hidden rounded-md p-1 transition-colors duration-200 sm:inline-flex ${
                darkMode
                  ? "text-gray-400 hover:bg-gray-800"
                  : "text-[#597167] hover:bg-[#f4f8f6]"
              }`}
            >
              <FaBell className="text-xs" />
              <span className="absolute right-1 top-1 h-2 w-2 animate-pulse rounded-full bg-red-500" />
            </button>

            <div
              className={`flex items-center gap-1.5 border-l pl-1.5 sm:gap-2 sm:pl-2 ${
                darkMode ? "border-gray-700" : "border-[#e3ece7]"
              }`}
            >
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-[#31694E] to-[#1f4a35] shadow-sm">
                <span className="text-[10px] font-semibold text-white">
                  {userName
                    .split(" ")
                    .filter(Boolean)
                    .map((n) => n[0])
                    .join("")
                    .toUpperCase()
                    .substring(0, 2)}
                </span>
              </div>
              <div className="hidden text-right lg:block">
                <p className={`text-[11px] font-semibold leading-none ${darkMode ? "text-white" : "text-[#1f4a35]"}`}>
                  {userName}
                </p>
              </div>
              <button
                onClick={handleLogout}
                className={`rounded-md p-1 transition-colors duration-200 ${
                  darkMode
                    ? "text-gray-400 hover:bg-gray-800 hover:text-red-400"
                    : "text-[#597167] hover:bg-red-50 hover:text-red-600"
                }`}
                title="Logout"
              >
                <FaSignOutAlt className="text-xs" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
});

export default Navbar;
