import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { FaChevronDown, FaSearch, FaTimes } from "react-icons/fa";

/**
 * AppSelect — drop-in replacement for <select> across the app.
 *
 * Props:
 *   value          — current selected value (primitive, matched against option.value)
 *   onChange       — (value) => void
 *   options        — [{ value, label, description?, disabled? }]
 *   placeholder    — string shown when nothing is selected
 *   searchable     — shows search input when true (use for lists > ~10 items)
 *   disabled       — disables the control
 *   clearable      — shows × to clear selection
 *   size           — "sm" (h-7, text-xs, toolbar) | "md" (h-9, text-sm, forms)
 *   label          — renders a label above the control
 *   required       — appends * to label
 *   hint           — small help text below the control
 *   emptyMessage   — text shown when filter returns no results
 *   className      — extra classes on the outer wrapper
 *   error          — truthy to show red border + error text
 *   warning        — truthy to show amber border + warning text (use for control account notices)
 */
const AppSelect = ({
  value,
  onChange,
  options = [],
  placeholder = "Select...",
  searchable = false,
  disabled = false,
  clearable = false,
  size = "md",
  compact = false,
  label = "",
  required = false,
  hint = "",
  emptyMessage = "No options found",
  className = "",
  error = "",
  warning = "",
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [dropdownStyle, setDropdownStyle] = useState({});

  const triggerRef = useRef(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);

  const selectedOption = useMemo(
    () => options.find((o) => String(o.value ?? "") === String(value ?? "")) ?? null,
    [options, value]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const term = search.trim().toLowerCase();
    return options.filter(
      (o) =>
        String(o.label ?? "").toLowerCase().includes(term) ||
        String(o.description ?? "").toLowerCase().includes(term)
    );
  }, [options, search]);

  const close = useCallback(() => {
    setOpen(false);
    setSearch("");
    setHighlightedIndex(-1);
  }, []);

  const selectOption = useCallback(
    (opt) => {
      if (opt.disabled) return;
      onChange?.(opt.value);
      close();
    },
    [onChange, close]
  );

  const openDropdown = useCallback(() => {
    if (disabled) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const vp = window.innerHeight;
    const spaceBelow = vp - rect.bottom;
    const spaceAbove = rect.top;
    const dropUp = spaceBelow < 260 && spaceAbove > spaceBelow;

    setDropdownStyle({
      position: "fixed",
      left: rect.left,
      width: rect.width,
      ...(dropUp
        ? { bottom: vp - rect.top + 4 }
        : { top: rect.bottom + 4 }),
      zIndex: 9999,
    });

    setOpen(true);
    setHighlightedIndex(
      options.findIndex((o) => String(o.value ?? "") === String(value ?? ""))
    );
  }, [disabled, options, value]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (
        !triggerRef.current?.contains(e.target) &&
        !document.getElementById("app-select-portal")?.contains(e.target)
      ) {
        close();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, close]);

  // Close on scroll / resize so the dropdown doesn't float away.
  // Ignore scroll events that originate inside the portal itself (scrolling the options list).
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (document.getElementById("app-select-portal")?.contains(e.target)) return;
      close();
    };
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler);
    };
  }, [open, close]);

  // Focus search input when opening
  useEffect(() => {
    if (open && searchable) {
      const t = setTimeout(() => searchRef.current?.focus(), 20);
      return () => clearTimeout(t);
    }
  }, [open, searchable]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex < 0 || !listRef.current) return;
    const el = listRef.current.children[highlightedIndex];
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  const handleTriggerKeyDown = (e) => {
    if (disabled) return;
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        openDropdown();
      }
      return;
    }
    handleListKeyDown(e);
  };

  const handleListKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      triggerRef.current?.focus();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((p) => Math.min(p + 1, filtered.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((p) => Math.max(p - 1, 0));
    }
    if (e.key === "Enter" && highlightedIndex >= 0 && filtered[highlightedIndex]) {
      e.preventDefault();
      selectOption(filtered[highlightedIndex]);
    }
  };

  const heightCls = compact ? "h-[20px] text-[9px]" : size === "sm" ? "h-7 text-xs" : "h-9 text-sm";
  const roundedCls = compact ? "rounded-none" : "rounded-lg";
  const paddingCls = compact ? "px-1.5" : "px-3";
  const minWidthCls = compact ? "min-w-[70px]" : "min-w-[110px]";
  const hasError = Boolean(error);
  const hasWarning = !hasError && Boolean(warning);

  return (
    <div className={`${label ? "w-full" : minWidthCls} ${className}`}>
      {label && (
        <label className="mb-1 block text-xs font-bold text-slate-700">
          {label}
          {required && <span className="ml-0.5 text-rose-500">*</span>}
        </label>
      )}

      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? close() : openDropdown())}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={[
          `flex w-full items-center justify-between gap-1.5 ${roundedCls} border ${paddingCls} text-left transition-all`,
          heightCls,
          disabled
            ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
            : hasError
            ? "cursor-pointer border-rose-400 bg-white hover:border-rose-500 focus:border-rose-500 focus:ring-2 focus:ring-rose-200"
            : hasWarning
            ? "cursor-pointer border-amber-400 bg-amber-50/60 hover:border-amber-500 focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
            : open
            ? "cursor-pointer border-[#0B3B2E] bg-white ring-2 ring-[#0B3B2E]/20"
            : "cursor-pointer border-slate-300 bg-white hover:border-slate-400 focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/20",
          "focus:outline-none",
        ].join(" ")}
      >
        <span
          className={`flex-1 truncate ${
            selectedOption ? "font-medium text-slate-900" : "text-slate-400"
          }`}
        >
          {selectedOption?.label ?? placeholder}
        </span>

        <div className="flex shrink-0 items-center gap-1">
          {clearable && selectedOption && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              onMouseDown={(e) => {
                e.stopPropagation();
                onChange?.(null);
              }}
              className="rounded p-0.5 text-slate-400 hover:text-slate-700"
              aria-label="Clear"
            >
              <FaTimes size={9} />
            </span>
          )}
          <FaChevronDown
            size={compact ? 7 : 10}
            className={`shrink-0 text-slate-400 transition-transform duration-150 ${
              open ? "rotate-180" : ""
            }`}
          />
        </div>
      </button>

      {hint && !hasError && !hasWarning && (
        <p className="mt-1 text-[11px] text-slate-500">{hint}</p>
      )}
      {hasWarning && (
        <p className="mt-1 text-[11px] font-semibold text-amber-700">{warning}</p>
      )}
      {hasError && (
        <p className="mt-1 text-[11px] font-semibold text-rose-600">{error}</p>
      )}

      {open &&
        createPortal(
          <div
            id="app-select-portal"
            style={dropdownStyle}
            className={compact
              ? "border border-slate-300 bg-white shadow-lg"
              : "rounded-xl border border-slate-200 bg-white shadow-2xl"}
          >
            {searchable && (
              <div className={`flex items-center gap-2 border-b border-slate-100 ${compact ? "px-2 py-1" : "px-3 py-2"}`}>
                <FaSearch size={10} className="shrink-0 text-slate-400" />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setHighlightedIndex(0);
                  }}
                  onKeyDown={handleListKeyDown}
                  placeholder="Search..."
                  className={`flex-1 bg-transparent text-slate-800 placeholder:text-slate-400 focus:outline-none ${compact ? "text-[11px]" : "text-xs"}`}
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch("");
                      searchRef.current?.focus();
                    }}
                    className="shrink-0 text-slate-400 hover:text-slate-700"
                  >
                    <FaTimes size={9} />
                  </button>
                )}
              </div>
            )}

            <ul
              ref={listRef}
              role="listbox"
              className={`overflow-auto py-0.5 ${compact ? "max-h-52" : "max-h-60"}`}
            >
              {filtered.length === 0 ? (
                <li className={`text-center text-slate-400 ${compact ? "px-2 py-3 text-[9px]" : "px-4 py-6 text-xs"}`}>
                  {emptyMessage}
                </li>
              ) : (
                filtered.map((opt, idx) => {
                  const isSelected =
                    String(opt.value ?? "") === String(value ?? "");
                  const isHighlighted = idx === highlightedIndex;
                  return (
                    <li
                      key={String(opt.value ?? idx)}
                      role="option"
                      aria-selected={isSelected}
                      aria-disabled={opt.disabled}
                      onMouseEnter={() => !opt.disabled && setHighlightedIndex(idx)}
                      onClick={() => selectOption(opt)}
                      className={[
                        `flex flex-col transition-colors ${compact ? "px-1.5 py-0.5 text-[9px]" : "px-3 py-2 text-xs"}`,
                        opt.disabled
                          ? "cursor-not-allowed opacity-40"
                          : "cursor-pointer",
                        isSelected
                          ? "bg-emerald-50"
                          : isHighlighted
                          ? "bg-slate-50"
                          : "hover:bg-slate-50",
                      ].join(" ")}
                    >
                      <span
                        className={`leading-snug ${
                          isSelected
                            ? "font-bold text-[#0B3B2E]"
                            : "font-medium text-slate-900"
                        }`}
                      >
                        {opt.label}
                      </span>
                      {opt.description && (
                        <span className={`leading-snug text-slate-500 ${compact ? "mt-0 text-[8px]" : "mt-0.5 text-[11px]"}`}>
                          {opt.description}
                        </span>
                      )}
                    </li>
                  );
                })
              )}
            </ul>
          </div>,
          document.body
        )}
    </div>
  );
};
export default AppSelect;