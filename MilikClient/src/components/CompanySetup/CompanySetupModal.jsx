import React, { useEffect } from "react";

const CompanySetupModal = ({ open, onClose, children }) => {
  // close on ESC
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    if (open) window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[999]">
      {/* Backdrop */}
      <button
        aria-label="Close company setup"
        className="absolute inset-0 w-full h-full bg-black/35 backdrop-blur-[6px]"
        onClick={onClose}
      />

      {/* Windows 11 style centered panel */}
      <div className="absolute left-1/2 top-1/2 w-[92vw] max-w-[820px] -translate-x-1/2 -translate-y-1/2">
        <div className="relative rounded-3xl border border-white/30 bg-white/70 shadow-2xl backdrop-blur-xl">
          <div className="rounded-3xl bg-gradient-to-b from-white/70 to-white/40">
            {children}
          </div>
        </div>

        {/* small hint */}
        <div className="mt-3 text-center text-xs text-white/80 select-none">
          Press <span className="font-semibold">Esc</span> to close
        </div>
      </div>
    </div>
  );
};

export default CompanySetupModal;
