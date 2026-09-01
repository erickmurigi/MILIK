/**
 * Standard modal/form field label + wrapper.
 * Matches the established label markup used across Modals/*.jsx and modal-embedded forms.
 *
 * Props:
 *   label     {string|node} — field label (pass a term string from useTerm/useTerms as needed)
 *   required  {boolean}     — appends a red asterisk to the label
 *   hint      {string|node} — optional helper text rendered below children
 *   error     {string|node} — optional error text rendered below children (red)
 *   className {string}      — extra classes on the outer wrapper div
 *   labelClassName {string} — override the default label classes
 *   children  {node}        — the actual input/select/textarea
 */
const FormField = ({ label, required, hint, error, className = "", labelClassName, children }) => (
  <div className={className}>
    {label && (
      <label className={labelClassName || "mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-600"}>
        {label} {required && <span className="text-red-500">*</span>}
      </label>
    )}
    {children}
    {error ? (
      <p className="mt-1 text-xs text-red-600">{error}</p>
    ) : hint ? (
      <p className="mt-1 text-xs text-slate-400">{hint}</p>
    ) : null}
  </div>
);

export default FormField;
