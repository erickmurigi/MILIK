import { useEffect, useState } from "react";

// Drop-in replacement for `<input type="number">` on money fields: shows
// thousands-separated, 2dp formatting (KES 27,000.00) while at rest, and
// switches to a plain editable number while focused (format-on-blur — avoids
// the cursor-jump bugs of live comma-insertion while typing).
//
// onChange fires exactly like a normal input's onChange — `e.target.value` is
// the raw numeric string (no commas) — so existing `(e) => fc(field, e.target.value)`
// handlers work unchanged; only the <input> element itself needs swapping.
const toRaw = (v) => String(v ?? "").replace(/,/g, "");

const formatDisplay = (v) => {
  const raw = toRaw(v);
  if (raw === "" || raw === "-") return raw;
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const CurrencyInput = ({
  value,
  onChange,
  prefix = "KES",
  placeholder = "0.00",
  disabled,
  name,
  className = "",
  inputClassName,
  ...props
}) => {
  const [focused, setFocused] = useState(false);
  const [raw, setRaw] = useState(toRaw(value));

  useEffect(() => {
    if (!focused) setRaw(toRaw(value));
  }, [value, focused]);

  const handleChange = (e) => {
    let next = e.target.value.replace(/[^0-9.]/g, "");
    const parts = next.split(".");
    if (parts.length > 2) next = `${parts[0]}.${parts.slice(1).join("")}`;
    setRaw(next);
    // Forward `name` so generic name-keyed handlers (e.target.name) keep working unchanged.
    onChange?.({ target: { name, value: next } });
  };

  const displayValue = focused ? raw : formatDisplay(value);

  return (
    <div className={`relative ${className}`}>
      {prefix && (
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-slate-400">
          {prefix}
        </span>
      )}
      <input
        type="text"
        inputMode="decimal"
        name={name}
        value={displayValue}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        className={
          inputClassName ||
          `h-7 w-full border bg-white text-sm text-slate-900 placeholder:text-slate-500 outline-none transition border-slate-300 focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20 text-right tabular-nums ${prefix ? "pl-10" : "px-2.5"} pr-2.5`
        }
        {...props}
      />
    </div>
  );
};

export default CurrencyInput;
