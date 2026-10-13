import React from "react";
import { Link } from "react-router-dom";
import { FaCheckCircle } from "react-icons/fa";
import FreeTrialModal from "../../components/FreeTrialModal";

/** Shared chrome for the five module pages (Property, Car Wash, HR,
 * Inventory, Property Sales). `children` is a render-prop that receives
 * `openTrialModal(moduleKey)` so each page can pre-select itself in the
 * demo form — e.g. the Car Wash page should open the modal with Car Wash
 * already checked, not a generic blank picker. */
export default function ModulePageShell({ children }) {
  const [showModal, setShowModal] = React.useState(false);
  const [moduleKey, setModuleKey] = React.useState(null);

  const openTrialModal = (key = null) => {
    setModuleKey(key);
    setShowModal(true);
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-white text-slate-900">
      <nav className="sticky top-0 z-50 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <Link to="/" className="relative inline-block">
            <img src="/logo.png" alt="Milik" className="h-8 w-auto object-contain" style={{ maxWidth: "140px" }} />
          </Link>
          <div className="hidden items-center gap-7 md:flex">
            <Link to="/" className="text-sm font-semibold text-slate-600 transition hover:text-[#0B3B2E]">Home</Link>
            <Link to="/#modules" className="text-sm font-semibold text-slate-600 transition hover:text-[#0B3B2E]">Modules</Link>
            <Link to="/#pricing" className="text-sm font-semibold text-slate-600 transition hover:text-[#0B3B2E]">Pricing</Link>
            <button
              type="button"
              onClick={() => openTrialModal()}
              className="border border-[#0B3B2E] bg-[#0B3B2E] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#0A3127]"
            >
              Request a Free Demo
            </button>
            <Link to="/login" className="border border-[#0B3B2E] px-4 py-2 text-sm font-bold text-[#0B3B2E] transition hover:bg-[#0B3B2E] hover:text-white">
              Sign in
            </Link>
          </div>
          <div className="flex items-center gap-2 md:hidden">
            <button
              type="button"
              onClick={() => openTrialModal()}
              className="border border-[#0B3B2E] bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#0A3127]"
            >
              Trial
            </button>
            <Link to="/login" className="border border-[#0B3B2E] px-4 py-2 text-xs font-bold text-[#0B3B2E] transition hover:bg-[#0B3B2E] hover:text-white">
              Sign in
            </Link>
          </div>
        </div>
      </nav>

      {/* Accounting included callout — shown on every module page */}
      <div className="border-b border-[#0B3B2E]/10 bg-[#0B3B2E]">
        <div className="mx-auto max-w-7xl px-4 py-2.5 sm:px-6 lg:px-8">
          <p className="flex items-center justify-center gap-2 text-center text-xs font-bold tracking-wide text-white">
            <FaCheckCircle className="shrink-0 text-emerald-300" />
            Accounting included with every module — Chart of Accounts, Trial Balance, Income Statement and financial reports. No extra cost.
          </p>
        </div>
      </div>

      <main>{children(openTrialModal)}</main>

      <footer className="border-t border-slate-200 bg-[#0B3B2E] py-8 text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 text-sm text-white/80 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex items-center gap-3">
            <img src="/milik-icon-white.png" alt="Milik" className="h-10 w-10 object-contain" />
            <div>
              <p className="font-bold text-white">Milik Business Suite</p>
              <p className="text-xs uppercase tracking-[0.2em] text-white/60">Property · Car Wash · HR · Inventory · Sales</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs font-semibold uppercase tracking-[0.18em] text-white/65">
            <Link to="/" className="text-white/65 transition hover:text-white">Home</Link>
            <Link to="/#modules" className="text-white/65 transition hover:text-white">Modules</Link>
            <Link to="/#pricing" className="text-white/65 transition hover:text-white">Pricing</Link>
            <a href="mailto:miliksystem@gmail.com" className="text-white/65 transition hover:text-white">Contact Us</a>
            <Link to="/login" className="text-white/65 transition hover:text-white">Sign In</Link>
          </div>
        </div>
      </footer>

      <FreeTrialModal isOpen={showModal} onClose={() => setShowModal(false)} initialModules={moduleKey ? [moduleKey] : []} />
    </div>
  );
}
