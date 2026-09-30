// Shared list-page toolbar — the compact filter/action row standardized on the
// Properties/Units/Tenants pages: h-[20px] controls, text-[9px] labels, no rounded
// corners, a single horizontally-scrollable row. Pairs with MilikTable + PaginationBar.
import React from "react";

const VARIANTS = {
  primary: "bg-[#0B3B2E] hover:bg-[#0A3127] text-white",
  accent: "bg-[#FF8C00] hover:bg-[#e67e00] text-white",
  danger: "bg-red-600 hover:bg-red-700 text-white",
  toggle: "bg-orange-600 hover:bg-orange-700 text-white",
  dark: "bg-slate-700 hover:bg-slate-800 text-white",
  outline: "border border-gray-300 text-gray-600 hover:bg-gray-50",
  outlineOk: "border border-green-300 bg-green-50 text-green-700 hover:bg-green-100",
};

export function ListToolbar({ children, className = "" }) {
  return (
    <div className="flex-none sticky top-0 z-30 border-b border-gray-200 bg-white shadow-sm">
      <div className={`filter-bar flex items-center gap-0.5 overflow-x-auto px-2 py-1 ${className}`}>
        {children}
      </div>
    </div>
  );
}

ListToolbar.Divider = function Divider() {
  return <div className="h-3 w-px shrink-0 bg-slate-200" />;
};

ListToolbar.Input = React.forwardRef(function Input({ className = "", width = "w-24", ...props }, ref) {
  return (
    <input
      ref={ref}
      {...props}
      className={`h-[20px] ${width} shrink-0 border border-slate-200 bg-white px-1.5 text-[9px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] ${className}`}
    />
  );
});

ListToolbar.Button = function ToolbarButton({
  icon: Icon,
  children,
  variant = "primary",
  disabled,
  className = "",
  iconSize = 7,
  ...props
}) {
  const styleClass = disabled ? "bg-gray-400 text-white cursor-not-allowed" : (VARIANTS[variant] || VARIANTS.primary);
  return (
    <button
      type="button"
      disabled={disabled}
      className={`h-[20px] shrink-0 flex items-center gap-0.5 px-2.5 text-[9px] font-semibold ${styleClass} ${className}`}
      {...props}
    >
      {Icon && <Icon size={iconSize} />} {children}
    </button>
  );
};

// Dropdown menu triggered by a ListToolbar.Button — handles the fixed-position
// measure-on-open + click-outside-to-close boilerplate every bulk "Actions" menu repeats.
ListToolbar.Menu = function ToolbarMenu({ open, onClose, anchorRef, children, width = "w-40" }) {
  const menuRef = React.useRef(null);
  const [pos, setPos] = React.useState({ top: 0, right: 0 });

  React.useEffect(() => {
    if (!open) return;
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target) && !anchorRef.current?.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open, onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;
  return (
    <div
      ref={menuRef}
      style={{ position: "fixed", top: pos.top, right: pos.right, zIndex: 9999 }}
      className={`${width} bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden`}
    >
      {children}
    </div>
  );
};

ListToolbar.MenuItem = function ToolbarMenuItem({ icon: Icon, children, disabled, className = "", ...props }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 ${
        disabled ? "cursor-not-allowed bg-gray-50 text-gray-400" : "hover:bg-gray-50"
      } ${className}`}
      {...props}
    >
      {Icon && <Icon className="text-xs text-gray-700" />} {children}
    </button>
  );
};

export default ListToolbar;
