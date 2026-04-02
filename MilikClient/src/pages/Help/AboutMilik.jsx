import React from "react";
import { FaBuilding, FaChartLine, FaLayerGroup } from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";

const pillars = [
  {
    icon: <FaBuilding className="text-[#0B3B2E]" />,
    title: "Built for property managers",
    description:
      "MILIK is positioned as a professional property management workspace for managing operations, collections, reporting, and company-scoped workflows from one system.",
  },
  {
    icon: <FaChartLine className="text-[#0B3B2E]" />,
    title: "Grounded in financial discipline",
    description:
      "The product is designed to connect daily operational work with clear accounting visibility so reports feel credible, not decorative.",
  },
  {
    icon: <FaLayerGroup className="text-[#0B3B2E]" />,
    title: "Practical and scalable",
    description:
      "MILIK aims to stay compact, serious, and implementation-ready while preserving company isolation, audit clarity, and a professional user experience.",
  },
];

function AboutMilik() {
  return (
    <DashboardLayout lockContentScroll>
      <div className="min-h-full bg-gray-50 p-3">
        <div className="mx-auto max-w-6xl space-y-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#FF8C00]">About us</p>
            <h1 className="mt-2 text-3xl font-black text-slate-900">About MILIK</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              MILIK is a property management system focused on helping teams run cleaner operations, stronger reporting, and more reliable
              financial workflows from one professional workspace.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {pillars.map((pillar) => (
              <div key={pillar.title} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="inline-flex rounded-2xl bg-[#0B3B2E]/10 p-3 text-xl">{pillar.icon}</div>
                <h2 className="mt-4 text-lg font-extrabold text-slate-900">{pillar.title}</h2>
                <p className="mt-2 text-sm leading-7 text-slate-600">{pillar.description}</p>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-extrabold text-slate-900">What MILIK stands for</h2>
            <p className="mt-3 max-w-4xl text-sm leading-7 text-slate-600">
              A serious property platform should not only look polished. It should also help teams maintain clarity across properties,
              tenants, collections, owner-facing reporting, and core financial controls. That is the direction this product is built for.
            </p>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

export default AboutMilik;
