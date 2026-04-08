import React from "react";
import { useDispatch } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { loginSuccess } from "../../redux/authSlice";
import { getCompanySuccess } from "../../redux/companiesRedux";

const API_BASE = String(import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");

const DemoAccessEntry = () => {
  const dispatch = useDispatch();
  const location = useLocation();
  const navigate = useNavigate();

  React.useEffect(() => {
    const params = new URLSearchParams(location.search);
    const accessToken = params.get("token") || params.get("demoAccess");

    if (!accessToken) {
      navigate("/home", { replace: true });
      return undefined;
    }

    let cancelled = false;

    const restoreDemoAccess = async () => {
      try {
        const response = await fetch(`${API_BASE}/trial/access`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken }),
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok || !data?.success || !data?.demoAvailable || !data?.token || !data?.user) {
          throw new Error(data?.message || "Failed to restore demo access.");
        }

        if (cancelled) return;

        dispatch(loginSuccess({ token: data.token, user: data.user }));

        if (data.user?.company?._id) {
          dispatch(getCompanySuccess(data.user.company));
          localStorage.setItem("milik_active_company_id", data.user.company._id);
        }

        toast.success(data?.message || "Welcome back. Resuming your remaining demo time.");
        navigate(data.redirectTo || "/dashboard", { replace: true, state: { restoredFromDemoEmail: true } });
      } catch (error) {
        if (cancelled) return;
        const message = error?.message || "Failed to restore demo access.";
        toast.error(message);
        navigate("/home", { replace: true, state: { demoRestoreError: message } });
      }
    };

    restoreDemoAccess();

    return () => {
      cancelled = true;
    };
  }, [dispatch, location.search, navigate]);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(11,59,46,0.14),_transparent_34%),linear-gradient(135deg,#ffffff_0%,#f7fbf8_45%,#eef5f1_100%)] px-4 py-10 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[70vh] max-w-3xl items-center justify-center">
        <div className="w-full rounded-[32px] border border-slate-200 bg-white/95 p-8 text-center shadow-xl shadow-slate-200/60 backdrop-blur sm:p-10">
          <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full bg-[#0B3B2E]/10 text-[#0B3B2E]">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
          </div>
          <p className="mt-6 text-xs font-extrabold uppercase tracking-[0.24em] text-[#FF8C00]">MILIK demo access</p>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
            Opening your demo workspace
          </h1>
          <p className="mt-4 text-sm leading-7 text-slate-600 sm:text-base">
            We are validating your secure access link and taking you straight to the demo dashboard.
          </p>
        </div>
      </div>
    </div>
  );
};

export default DemoAccessEntry;
