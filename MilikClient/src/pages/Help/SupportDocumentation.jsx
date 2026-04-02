import React from "react";
import { FaBookOpen, FaEnvelope, FaHeadset, FaLifeRing, FaShieldAlt } from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";

const supportItems = [
  {
    icon: <FaHeadset className="text-[#0B3B2E]" />,
    title: "Support direction",
    description:
      "Use this page as the main in-app help point for onboarding guidance, workflow questions, and support follow-up when users need help using MILIK safely.",
  },
  {
    icon: <FaBookOpen className="text-[#0B3B2E]" />,
    title: "What users should find here",
    description:
      "Product walkthrough guidance, common questions, demo access guidance, and the best contact path for issues that need direct MILIK assistance.",
  },
  {
    icon: <FaShieldAlt className="text-[#0B3B2E]" />,
    title: "Operational note",
    description:
      "Support guidance should protect company isolation and audit integrity. Help users understand actions before changing financial or company-scoped data.",
  },
];

const quickTopics = [
  "Accessing the demo workspace and resuming it from the emailed access link",
  "Navigating properties, tenants, receipting, processed statements and reports",
  "Understanding read-only demo behavior versus live production workspaces",
  "Contacting MILIK for activation, onboarding, implementation or support follow-up",
];

function SupportDocumentation() {
  return (
    <DashboardLayout lockContentScroll>
      <div className="min-h-full bg-gray-50 p-3">
        <div className="mx-auto max-w-6xl space-y-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#FF8C00]">Help & documentation</p>
            <h1 className="mt-2 text-3xl font-black text-slate-900">Support and documentation</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              This page gives users a clean support direction inside MILIK instead of a dead menu link. It is intentionally simple,
              practical, and aligned with the current product stage.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {supportItems.map((item) => (
              <div key={item.title} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="inline-flex rounded-2xl bg-[#0B3B2E]/10 p-3 text-xl">{item.icon}</div>
                <h2 className="mt-4 text-lg font-extrabold text-slate-900">{item.title}</h2>
                <p className="mt-2 text-sm leading-7 text-slate-600">{item.description}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-extrabold text-slate-900">Quick help topics</h2>
              <div className="mt-4 space-y-3">
                {quickTopics.map((topic) => (
                  <div key={topic} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
                    {topic}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-extrabold text-slate-900">Contact MILIK</h2>
              <div className="mt-4 space-y-4 text-sm text-slate-700">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center gap-3 text-slate-900">
                    <FaEnvelope className="text-[#0B3B2E]" />
                    <span className="font-bold">Email support</span>
                  </div>
                  <a
                    href="mailto:miliksystem@gmail.com?subject=MILIK%20Support%20Request"
                    className="mt-3 inline-flex font-semibold text-[#0B3B2E] hover:underline"
                  >
                    miliksystem@gmail.com
                  </a>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center gap-3 text-slate-900">
                    <FaLifeRing className="text-[#0B3B2E]" />
                    <span className="font-bold">Phone / WhatsApp</span>
                  </div>
                  <p className="mt-3 leading-7 text-slate-600">
                    A verified public support phone line is not exposed in the current codebase. Use the email channel above or the
                    onboarding contact path until the official support number is published.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

export default SupportDocumentation;
