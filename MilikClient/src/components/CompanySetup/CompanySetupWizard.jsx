import React, { useMemo, useState, useContext } from "react";
import { FaBuilding, FaCalendarAlt, FaChevronLeft, FaChevronRight, FaCheck } from "react-icons/fa";
import { BusinessContext } from "../../context/BusinessContext";
import StartMenu from "../../components/StartMenu/StartMenu";

const months = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];

const Field = ({ label, children, hint }) => (
  <label className="block">
    <div className="flex items-end justify-between">
      <span className="text-sm font-semibold text-slate-800">{label}</span>
      {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
    </div>
    <div className="mt-2">{children}</div>
  </label>
);

const Input = (props) => (
  <input
    {...props}
    className={
      "w-full rounded-xl border border-slate-200 bg-white/80 px-4 py-3 text-sm " +
      "outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-200 transition"
    }
  />
);

const Select = (props) => (
  <select
    {...props}
    className={
      "w-full rounded-xl border border-slate-200 bg-white/80 px-4 py-3 text-sm " +
      "outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-200 transition"
    }
  />
);

const SavingAnimation = () => {
  return (
    <div className="py-10">
      <div className="mx-auto w-full max-w-md rounded-2xl border border-white/40 bg-white/60 p-6">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-teal-600/90 flex items-center justify-center text-white">
            <FaBuilding />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-900">Saving configurations</div>
            <div className="text-xs text-slate-600">Setting up your company workspace…</div>
          </div>
        </div>

        {/* “building blocks” animation */}
        <div className="mt-6 grid grid-cols-8 gap-2">
          {Array.from({ length: 24 }).map((_, i) => (
            <div
              key={i}
              className="h-6 rounded-lg bg-slate-200/70 animate-pulse"
              style={{ animationDelay: `${(i % 8) * 70}ms` }}
            />
          ))}
        </div>

        {/* progress bar */}
        <div className="mt-6 h-2 w-full overflow-hidden rounded-full bg-slate-200/60">
          <div className="h-full w-1/2 animate-[milikbar_1.2s_ease-in-out_infinite] rounded-full bg-teal-600/80" />
        </div>

        <style>
          {`
            @keyframes milikbar {
              0% { transform: translateX(-70%); width: 40%; }
              50% { transform: translateX(35%); width: 55%; }
              100% { transform: translateX(160%); width: 40%; }
            }
          `}
        </style>
      </div>
    </div>
  );
};

const CompanySetupWizard = ({ onDone }) => {
  const { dispatch } = useContext(BusinessContext);

  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  const [company, setCompany] = useState({
    companyName: "",
    legalName: "",
    email: "",
    phone: "",
    country: "Kenya",
    city: "Nairobi",
    currency: "KES",
    address: ""
  });

  const [fiscal, setFiscal] = useState({
    fiscalStartMonth: "January",
    fiscalYearLabel: "FY",
    reportingFrequency: "Monthly",
    rentDueDay: "5",
  });

  const canNext = useMemo(() => {
    if (step === 1) {
      return (
        company.companyName.trim() &&
        company.email.trim() &&
        company.phone.trim()
      );
    }
    if (step === 2) {
      return fiscal.fiscalStartMonth && fiscal.reportingFrequency && fiscal.rentDueDay;
    }
    return false;
  }, [step, company, fiscal]);

  const handleSave = async () => {
    setSaving(true);

    // payload you can later send to backend
    const payload = {
      ...company,
      fiscal: { ...fiscal },
      configuredAt: new Date().toISOString()
    };

    // save to BusinessContext + encrypted localStorage (your context already encrypts)
    dispatch({ type: "BUSINESS_DATA_SUCCESS", payload });

    // show animation a bit
    await new Promise((r) => setTimeout(r, 1600));

    setSaving(false);
    onDone?.(payload);
  };

  return (
    <div className="p-6 md:p-8"> 
     <StartMenu/>
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-2xl bg-[#0f766e] text-white flex items-center justify-center shadow">
          {step === 1 ? <FaBuilding /> : <FaCalendarAlt />}
        </div>
        <div className="flex-1">
          <div className="text-lg font-extrabold text-slate-900">Company Setup</div>
          <div className="text-xs text-slate-600">
            {step === 1 ? "Property management company details" : "Fiscal period & defaults"}
          </div>
        </div>

        <div className="text-xs font-semibold text-slate-700 rounded-full bg-slate-100 px-3 py-1 border border-slate-200">
          Step {step} / 2
        </div>
      </div>

      {/* Content */}
      <div className="mt-6">
        {saving ? (
          <SavingAnimation />
        ) : (
          <>
            {step === 1 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Company name *" hint="Displayed in the system">
                  <Input
                    value={company.companyName}
                    onChange={(e) => setCompany({ ...company, companyName: e.target.value })}
                    placeholder="Mi Property Management"
                  />
                </Field>

                <Field label="Legal name" hint="Optional">
                  <Input
                    value={company.legalName}
                    onChange={(e) => setCompany({ ...company, legalName: e.target.value })}
                    placeholder="Milik Prrty Management Ltd"
                  />
                </Field>

                <Field label="Company email *">
                  <Input
                    value={company.email}
                    onChange={(e) => setCompany({ ...company, email: e.target.value })}
                    placeholder="admin@milik.com"
                    type="email"
                  />
                </Field>

                <Field label="Phone number *">
                  <Input
                    value={company.phone}
                    onChange={(e) => setCompany({ ...company, phone: e.target.value })}
                    placeholder="0700 000 000"
                  />
                </Field>

                <Field label="Country">
                  <Input
                    value={company.country}
                    onChange={(e) => setCompany({ ...company, country: e.target.value })}
                    placeholder="Kenya"
                  />
                </Field>

                <Field label="City">
                  <Input
                    value={company.city}
                    onChange={(e) => setCompany({ ...company, city: e.target.value })}
                    placeholder="Nairobi"
                  />
                </Field>

                <Field label="Currency">
                  <Select
                    value={company.currency}
                    onChange={(e) => setCompany({ ...company, currency: e.target.value })}
                  >
                    <option value="KES">KES</option>
                    <option value="USD">USD</option>
                    <option value="UGX">UGX</option>
                    <option value="TZS">TZS</option>
                  </Select>
                </Field>

                <Field label="Address">
                  <Input
                    value={company.address}
                    onChange={(e) => setCompany({ ...company, address: e.target.value })}
                    placeholder="Kasarani, Nairobi"
                  />
                </Field>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Fiscal year start month *">
                  <Select
                    value={fiscal.fiscalStartMonth}
                    onChange={(e) => setFiscal({ ...fiscal, fiscalStartMonth: e.target.value })}
                  >
                    {months.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </Select>
                </Field>

                <Field label="Fiscal label" hint="Optional">
                  <Input
                    value={fiscal.fiscalYearLabel}
                    onChange={(e) => setFiscal({ ...fiscal, fiscalYearLabel: e.target.value })}
                    placeholder="FY"
                  />
                </Field>

                <Field label="Reporting frequency *">
                  <Select
                    value={fiscal.reportingFrequency}
                    onChange={(e) => setFiscal({ ...fiscal, reportingFrequency: e.target.value })}
                  >
                    <option value="Monthly">Monthly</option>
                    <option value="Quarterly">Quarterly</option>
                    <option value="Annually">Annually</option>
                  </Select>
                </Field>

                <Field label="Default rent due day *" hint="1–28 recommended">
                  <Input
                    value={fiscal.rentDueDay}
                    onChange={(e) => setFiscal({ ...fiscal, rentDueDay: e.target.value })}
                    placeholder="5"
                    type="number"
                    min="1"
                    max="28"
                  />
                </Field>

                <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-white/60 p-4">
                  <div className="text-sm font-bold text-slate-900">Preview</div>
                  <div className="mt-2 text-xs text-slate-600">
                    <div><span className="font-semibold">Fiscal start:</span> {fiscal.fiscalStartMonth}</div>
                    <div><span className="font-semibold">Reports:</span> {fiscal.reportingFrequency}</div>
                    <div><span className="font-semibold">Rent due:</span> Day {fiscal.rentDueDay}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Footer buttons */}
            <div className="mt-8 flex items-center justify-between">
              <button
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-white transition disabled:opacity-50"
                onClick={() => setStep((s) => Math.max(1, s - 1))}
                disabled={step === 1}
              >
                <FaChevronLeft /> Back
              </button>

              {step === 1 ? (
                <button
                  className="inline-flex items-center gap-2 rounded-xl bg-[#0f766e] px-5 py-2 text-sm font-semibold text-white hover:opacity-95 transition disabled:opacity-50"
                  onClick={() => setStep(2)}
                  disabled={!canNext}
                >
                  Next <FaChevronRight />
                </button>
              ) : (
                <button
                  className="inline-flex items-center gap-2 rounded-xl bg-[#0f766e] px-5 py-2 text-sm font-semibold text-white hover:opacity-95 transition disabled:opacity-50"
                  onClick={handleSave}
                  disabled={!canNext}
                >
                  Finish <FaCheck />
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default CompanySetupWizard;
