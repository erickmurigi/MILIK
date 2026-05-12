import { Link } from "react-router-dom";
import { FaHome, FaArrowLeft } from "react-icons/fa";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#f7f8f5] px-4 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-[#0B3B2E]/10">
        <span className="text-4xl font-extrabold text-[#0B3B2E]">404</span>
      </div>

      <h1 className="mb-2 text-2xl font-bold text-[#0B3B2E]">Page not found</h1>
      <p className="mb-8 max-w-sm text-sm text-slate-500">
        The page you are looking for does not exist or may have been moved. Check the URL and try again.
      </p>

      <div className="flex flex-wrap justify-center gap-3">
        <button
          onClick={() => window.history.back()}
          className="inline-flex items-center gap-2 rounded-full border border-[#0B3B2E]/20 bg-white px-5 py-2.5 text-sm font-semibold text-[#0B3B2E] transition hover:bg-[#0B3B2E]/5"
        >
          <FaArrowLeft size={12} />
          Go back
        </button>
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-full bg-[#0B3B2E] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0d4a39]"
        >
          <FaHome size={12} />
          Home
        </Link>
      </div>

      <p className="mt-12 text-xs text-slate-400">
        &copy; {new Date().getFullYear()} Milik Property Management System
      </p>
    </div>
  );
}
