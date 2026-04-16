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
import {
  getCompanyOperatingModeLabel,
  isSelfManagingLandlordCompany,
} from "../../utils/companyModules";

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
  const operatingModeLabel = getCompanyOperatingModeLabel(
    currentCompany?.companyMode || currentUser?.company?.companyMode
  );
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
      className={`sticky top-0 z-20 border-b shadow-sm ${
        darkMode ? "border-gray-700 bg-gray-900" : "border-[#dbe7e1] bg-white"
      }`}
    >
      <div className="px-3 py-2 sm:px-5">
        <div className="flex items-center justify-between gap-3 sm:gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              onClick={() => setSidebarOpen?.(true)}
              className={`lg:hidden rounded-xl p-2 transition-colors ${
                darkMode
                  ? "text-gray-300 hover:bg-gray-700"
                  : "text-gray-700 hover:bg-[#eef5f1]"
              }`}
            >
              <FaBars />
            </button>

            <div className="flex min-w-0 items-center gap-3">
              <CompanyAvatar
                logo={companyLogo}
                name={companyName}
                darkMode={darkMode}
                size="h-11 w-11 sm:h-12 sm:w-12"
              />
              <div className="min-w-0">
                <h1
                  className={`truncate text-base font-bold tracking-tight sm:text-lg ${
                    darkMode ? "text-white" : "text-[#183a2d]"
                  }`}
                  title={companyName}
                >
                  {companyName}
                </h1>
                <p
                  className={`truncate text-xs font-medium ${
                    darkMode ? "text-gray-300" : "text-[#5b6f67]"
                  }`}
                >
                  {operatingModeLabel} • Active company
                </p>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <div
              className={`hidden rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] lg:inline-flex ${
                darkMode
                  ? "bg-gray-800 text-gray-200"
                  : isLandlordMode
                  ? "bg-orange-50 text-orange-700 ring-1 ring-orange-100"
                  : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
              }`}
            >
              {operatingModeLabel}
            </div>

            <button
              onClick={() => setDarkMode?.(!darkMode)}
              className={`rounded-xl p-2 transition-colors duration-200 ${
                darkMode
                  ? "bg-gray-800 text-yellow-400 hover:bg-gray-700"
                  : "bg-[#f4f8f6] text-[#1f4a35] hover:bg-[#e7f0eb]"
              }`}
              aria-label="Toggle theme"
            >
              {darkMode ? <FaSun className="text-lg" /> : <FaMoon className="text-lg" />}
            </button>

            <button
              className={`relative hidden rounded-xl p-2 transition-colors duration-200 sm:inline-flex ${
                darkMode
                  ? "text-gray-400 hover:bg-gray-800"
                  : "text-[#597167] hover:bg-[#f4f8f6]"
              }`}
            >
              <FaBell className="text-lg" />
              <span className="absolute right-1 top-1 h-2 w-2 animate-pulse rounded-full bg-red-500" />
            </button>

            <div
              className={`flex items-center gap-2 border-l pl-2 sm:gap-3 sm:pl-4 ${
                darkMode ? "border-gray-700" : "border-[#e3ece7]"
              }`}
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#31694E] to-[#1f4a35] shadow-sm">
                <span className="text-xs font-semibold text-white">
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
                <p className={`text-sm font-medium ${darkMode ? "text-white" : "text-[#1f4a35]"}`}>
                  {userName}
                </p>
                <p className={`text-xs ${darkMode ? "text-gray-400" : "text-[#6d7f77]"}`}>{profile}</p>
              </div>
              <button
                onClick={handleLogout}
                className={`rounded-xl p-2 transition-colors duration-200 ${
                  darkMode
                    ? "text-gray-400 hover:bg-gray-800 hover:text-red-400"
                    : "text-[#597167] hover:bg-red-50 hover:text-red-600"
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
