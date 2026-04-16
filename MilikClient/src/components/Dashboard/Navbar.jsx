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
import { getCompanyOperatingModeLabel, isSelfManagingLandlordCompany } from "../../utils/companyModules";

const POST_LOGOUT_LANDING_KEY = "milik_post_logout_landing";

const initialsFromName = (value = "") =>
  String(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "CO";

const CompanyAvatar = ({ logo, name, darkMode, size = "h-10 w-10" }) => {
  if (logo) {
    return (
      <div
        className={`${size} overflow-hidden rounded-2xl border shadow-sm ${
          darkMode ? "border-gray-700 bg-gray-800" : "border-[#d9e6df] bg-white"
        }`}
      >
        <img src={logo} alt={name} className="h-full w-full object-contain p-0.5" />
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

const Navbar = ({ setSidebarOpen, darkMode, setDarkMode }) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { currentUser } = useSelector((state) => state.auth);
  const { currentCompany } = useSelector((state) => state.company || {});

  const isSystemAdmin = Boolean(currentUser?.isSystemAdmin || currentUser?.superAdminAccess);

  const companyName =
    currentCompany?.companyName ||
    currentUser?.company?.companyName ||
    (isSystemAdmin ? "Select company" : "No active company");
  const companyLogo = currentCompany?.logo || currentUser?.company?.logo || "";
  const operatingModeLabel = getCompanyOperatingModeLabel(currentCompany?.companyMode || currentUser?.company?.companyMode);
  const isLandlordMode = isSelfManagingLandlordCompany(currentCompany || currentUser?.company);

  const userName = currentUser
    ? `${currentUser.surname || ""} ${currentUser.otherNames || ""}`.trim()
    : "User";
  const profile = currentUser?.profile || "User";

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
      className={`sticky top-0 z-20 ${
        darkMode ? "bg-gray-900" : "bg-[#dfebed]"
      } border-b ${
        darkMode ? "border-gray-700" : "border-[#c5d9d3]"
      } shadow-sm`}
    >
      <div className="px-3 py-2 sm:px-5">
        <div className="flex items-center justify-between gap-3 sm:gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <button
              onClick={() => setSidebarOpen?.(true)}
              className={`lg:hidden p-2 rounded-lg transition-colors ${
                darkMode
                  ? "hover:bg-gray-700 text-gray-300"
                  : "hover:bg-[#c5d9d3] text-gray-700"
              }`}
            >
              <FaBars />
            </button>

            <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
              <CompanyAvatar logo={companyLogo} name={companyName} darkMode={darkMode} size="h-9 w-9 sm:h-10 sm:w-10" />
              <div className="min-w-0">
                <h1
                  className={`text-base sm:text-lg font-bold tracking-tight truncate ${
                    darkMode ? "text-white" : "text-[#1f4a35]"
                  }`}
                  title={companyName}
                >
                  {companyName}
                </h1>
                <div className={`mt-0.5 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.18em] ${darkMode ? "bg-gray-800 text-gray-200" : isLandlordMode ? "bg-orange-100 text-orange-700" : "bg-emerald-100 text-emerald-700"}`}>
                  {operatingModeLabel}
                </div>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            <button
              onClick={() => setDarkMode?.(!darkMode)}
              className={`p-2 rounded-lg transition-colors duration-200 ${
                darkMode
                  ? "bg-gray-800 hover:bg-gray-700 text-yellow-400"
                  : "bg-[#c5d9d3] hover:bg-[#b3d1c7] text-[#1f4a35]"
              }`}
              aria-label="Toggle theme"
            >
              {darkMode ? <FaSun className="text-lg" /> : <FaMoon className="text-lg" />}
            </button>

            <button
              className={`relative hidden sm:inline-flex p-2 rounded-lg transition-colors duration-200 ${
                darkMode
                  ? "hover:bg-gray-800 text-gray-400"
                  : "hover:bg-[#c5d9d3] text-[#4a6b5e]"
              }`}
            >
              <FaBell className="text-lg" />
              <span className="absolute top-1 right-1 h-2 w-2 bg-red-500 rounded-full animate-pulse"></span>
            </button>

            <div
              className={`flex items-center space-x-2 sm:space-x-3 pl-2 sm:pl-4 border-l ${
                darkMode ? "border-gray-700" : "border-[#c5d9d3]"
              }`}
            >
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-[#31694E] to-[#1f4a35] flex items-center justify-center shadow-sm">
                <span className="text-white text-xs font-semibold">
                  {userName
                    .split(" ")
                    .filter(Boolean)
                    .map((n) => n[0])
                    .join("")
                    .toUpperCase()
                    .substring(0, 2)}
                </span>
              </div>
              <div className="hidden lg:block text-right">
                <p
                  className={`font-medium text-sm ${
                    darkMode ? "text-white" : "text-[#1f4a35]"
                  }`}
                >
                  {userName}
                </p>
                <p
                  className={`text-xs ${
                    darkMode ? "text-gray-400" : "text-[#4a6b5e]"
                  }`}
                >
                  {profile}
                </p>
              </div>
              <button
                onClick={handleLogout}
                className={`p-2 rounded-lg transition-colors duration-200 ${
                  darkMode
                    ? "hover:bg-gray-800 text-gray-400 hover:text-red-400"
                    : "hover:bg-red-100 text-[#4a6b5e] hover:text-red-600"
                }`}
                title="Logout"
              >
                <FaSignOutAlt className="text-lg" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
