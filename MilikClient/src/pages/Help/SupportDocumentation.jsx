import React from "react";
import { FaEnvelope, FaWhatsapp, FaQuestionCircle, FaFileAlt, FaBuilding, FaUsers } from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";

const topics = [
  { icon: <FaBuilding />, title: "Properties & Units", desc: "Adding properties, setting up units, managing landlords and zones." },
  { icon: <FaUsers />, title: "Tenants & Leases", desc: "Onboarding tenants, linking to units, managing lease terms and deposits." },
  { icon: <FaFileAlt />, title: "Invoices & Receipts", desc: "Raising rent and utility invoices, recording payments, allocating receipts." },
  { icon: <FaQuestionCircle />, title: "Reports", desc: "Paid & Balance, Rental Collection, Income Summary and portfolio reports." },
];

function SupportDocumentation() {
  return (
    <DashboardLayout lockContentScroll>
      <div className="min-h-full bg-slate-50 p-4">
        <div className="mx-auto max-w-4xl space-y-4">

          {/* Header */}
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#0B3B2E]">Milik PMS</p>
            <h1 className="mt-1 text-2xl font-black text-slate-900">Help &amp; Support</h1>
            <p className="mt-1.5 text-sm text-slate-500">
              For questions, onboarding assistance, or to report an issue — contact the Milik support team directly.
            </p>
          </div>

          {/* Topics */}
          <div className="grid gap-3 sm:grid-cols-2">
            {topics.map((t) => (
              <div key={t.title} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm">
                <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[#0B3B2E]/10 text-[#0B3B2E] text-sm">{t.icon}</div>
                <div>
                  <p className="text-sm font-bold text-slate-800">{t.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500 leading-relaxed">{t.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Contact */}
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
            <h2 className="text-sm font-bold text-slate-800 mb-3">Contact Support</h2>
            <div className="flex flex-col gap-3 sm:flex-row">
              <a
                href="mailto:info@milikproperty.com?subject=Milik%20Support%20Request"
                className="flex flex-1 items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 transition hover:border-[#0B3B2E] hover:bg-[#0B3B2E]/5"
              >
                <FaEnvelope className="text-[#0B3B2E] text-base flex-shrink-0" />
                <div>
                  <p className="text-xs font-bold text-slate-700">Email</p>
                  <p className="text-xs text-[#0B3B2E] font-semibold">info@milikproperty.com</p>
                </div>
              </a>
              <a
                href="https://wa.me/254790607640"
                target="_blank"
                rel="noreferrer"
                className="flex flex-1 items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 transition hover:border-[#25D366] hover:bg-[#25D366]/5"
              >
                <FaWhatsapp className="text-[#25D366] text-base flex-shrink-0" />
                <div>
                  <p className="text-xs font-bold text-slate-700">WhatsApp / Phone</p>
                  <p className="text-xs text-[#25D366] font-semibold">0790 607 640 &nbsp;·&nbsp; 0141 455 841</p>
                </div>
              </a>
            </div>
          </div>

        </div>
      </div>
    </DashboardLayout>
  );
}

export default SupportDocumentation;
