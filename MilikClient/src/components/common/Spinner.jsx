import { FaSpinner } from "react-icons/fa";

/**
 * Shared loading spinner.
 * Props:
 *   size  {"sm"|"md"|"lg"}  — icon size (default "md")
 *   className               — extra wrapper classes
 */
const SIZE = { sm: "text-sm", md: "text-lg", lg: "text-2xl" };

const Spinner = ({ size = "md", className = "" }) => (
  <span className={`inline-flex items-center justify-center ${className}`}>
    <FaSpinner className={`animate-spin text-[#0B3B2E] ${SIZE[size] || SIZE.md}`} />
  </span>
);

export default Spinner;
