import { FaTimes } from "react-icons/fa";

const SIZE_CLASSES = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-2xl",
  wide: "max-w-3xl",
  extraWide: "max-w-5xl",
};

/**
 * Generic modal shell used across all modules.
 * Matches the existing inline Modal pattern exactly — drop-in replacement.
 *
 * Props:
 *   title    {string|node} — header text
 *   icon     {node}        — optional icon rendered before the title
 *   onClose  {function}    — called when × is clicked
 *   children {node}        — body content
 *   footer   {node}        — optional button row rendered below body
 *   size     {string}      — "sm" | "md" (default) | "lg" | "wide" | "extraWide"
 *   wide     {boolean}     — max-w-3xl instead of max-w-xl (back-compat with size="wide")
 *   extraWide {boolean}    — max-w-5xl for very wide content (back-compat with size="extraWide")
 */
const Modal = ({ title, icon, onClose, children, footer, size, wide, extraWide }) => {
  const resolvedSize = size || (extraWide ? "extraWide" : wide ? "wide" : "md");
  return (
    <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
      <div
        className={`w-full border border-slate-200 bg-white shadow-2xl ${SIZE_CLASSES[resolvedSize] || SIZE_CLASSES.md}`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
          <h2 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide">
            {icon}
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-white/80 hover:bg-white/10 hover:text-white"
          >
            <FaTimes />
          </button>
        </div>
        <div className="max-h-[78vh] overflow-y-auto p-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

export default Modal;
