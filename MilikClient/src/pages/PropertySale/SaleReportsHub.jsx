import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { FaExternalLinkAlt, FaFilePdf } from "react-icons/fa";
import PropertySaleShell from "./PropertySaleShell";
import Modal from "../../components/common/Modal";
import AppSelect from "../../components/common/AppSelect";
import SaleReportPdfModal from "./SaleReportPdfModal";
import { saleApi } from "../../services/propertySaleApi";
import { useTerms } from "../../hooks/useTerm";

// Reports Center: one page, three columns of clickable report names — no blurb text, nothing to
// read before you've even picked a report. A report either generates a real PDF (small parameter
// modal, then a full-page preview exactly like the PMS Landlord Statement workspace) or opens its
// own already-built page (Monthly Sales, Conversion Funnel, etc. — these have working dedicated
// views; routing straight to the PDF pipeline is a later, purely mechanical extension, not a
// reason to hide a page that already works behind a "coming soon" badge).
const inputCls = "h-7 w-full border border-slate-200 bg-white px-2 text-xs outline-none focus:border-[#0B3B2E]";
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => ymd(new Date());
const yearStart = () => ymd(new Date(new Date().getFullYear(), 0, 1));

const DEAL_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "closed", label: "Closed" },
  { value: "cancelled", label: "Cancelled" },
];
const COMMISSION_STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "paid", label: "Paid" },
  { value: "cancelled", label: "Cancelled" },
  { value: "reversed", label: "Reversed" },
];

const buildGroups = (T) => [
  {
    title: "Collections",
    items: [
      { id: "receivables", label: "Receivables Aging", fields: [{ type: "project" }, { type: "agent" }, { type: "asOf" }] },
      { id: "cash-flow", label: "Cash Flow Forecast", to: "/sale/reports/cash-flow" },
    ],
  },
  {
    title: "Sales & Pipeline",
    items: [
      {
        id: "register", label: "Sales Register",
        fields: [{ type: "project" }, { type: "agent" }, { type: "dateRange" }, { type: "select", key: "status", label: "Status", options: DEAL_STATUS_OPTIONS }, { type: "text", key: "search", label: "Search" }],
      },
      { id: "monthly", label: "Monthly Sales", to: "/sale/reports/sales" },
      { id: "funnel", label: "Conversion Funnel", to: "/sale/reports/funnel" },
    ],
  },
  {
    title: `${T.saleAgent}s & Commissions`,
    items: [
      {
        id: "commissions", label: "Commissions",
        fields: [{ type: "agent" }, { type: "select", key: "status", label: "Status", options: COMMISSION_STATUS_OPTIONS }, { type: "dateRange" }],
      },
      { id: "agent-performance", label: `${T.saleAgent} Performance`, to: "/sale/agents/performance" },
      { id: "projects", label: `${T.saleProject}s Summary`, to: "/sale/projects" },
    ],
  },
];

const defaultValuesFor = (report) => {
  const v = {};
  for (const f of report.fields || []) {
    if (f.type === "project") v.projectId = "";
    else if (f.type === "agent") v.agentId = "";
    else if (f.type === "asOf") v.asOf = today();
    else if (f.type === "dateRange") { v.dateFrom = yearStart(); v.dateTo = today(); }
    else v[f.key] = "";
  }
  return v;
};

const buildParams = (values) => Object.fromEntries(Object.entries(values).filter(([, v]) => v !== "" && v != null));

const Field = ({ field, values, setValues, T, projectOptions, agentOptions }) => {
  const set = (key) => (v) => setValues((s) => ({ ...s, [key]: v ?? "" }));
  switch (field.type) {
    case "project":
      return (
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-slate-600">{T.saleProject}</label>
          <AppSelect value={values.projectId} onChange={set("projectId")} size="sm" searchable clearable placeholder={`All ${T.saleProject.toLowerCase()}s`} options={projectOptions} />
        </div>
      );
    case "agent":
      return (
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-slate-600">{T.saleAgent}</label>
          <AppSelect value={values.agentId} onChange={set("agentId")} size="sm" searchable clearable placeholder={`All ${T.saleAgent.toLowerCase()}s`} options={agentOptions} />
        </div>
      );
    case "asOf":
      return (
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-slate-600">As of</label>
          <input type="date" value={values.asOf} max={today()} onChange={(e) => set("asOf")(e.target.value)} className={inputCls} />
        </div>
      );
    case "dateRange":
      return (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-600">From</label>
            <input type="date" value={values.dateFrom} max={values.dateTo || today()} onChange={(e) => set("dateFrom")(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-600">To</label>
            <input type="date" value={values.dateTo} min={values.dateFrom} max={today()} onChange={(e) => set("dateTo")(e.target.value)} className={inputCls} />
          </div>
        </div>
      );
    case "select":
      return (
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-slate-600">{field.label}</label>
          <AppSelect value={values[field.key]} onChange={set(field.key)} size="sm" clearable placeholder={`All`} options={field.options} />
        </div>
      );
    case "text":
      return (
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-slate-600">{field.label}</label>
          <input value={values[field.key]} onChange={(e) => set(field.key)(e.target.value)} className={inputCls} />
        </div>
      );
    default:
      return null;
  }
};

const ReportParamsModal = ({ report, T, projectOptions, agentOptions, onClose, onGenerate }) => {
  const [values, setValues] = useState(() => defaultValuesFor(report));
  return (
    <Modal
      title={report.label}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="h-8 border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={() => onGenerate(buildParams(values))} className="h-8 bg-[#0B3B2E] px-4 text-xs font-bold text-white hover:bg-[#0A3127]">Generate PDF</button>
        </>
      }
    >
      <div className="space-y-3">
        {(report.fields || []).map((f, i) => (
          <Field key={f.key || f.type || i} field={f} values={values} setValues={setValues} T={T} projectOptions={projectOptions} agentOptions={agentOptions} />
        ))}
        {!report.fields?.length && <p className="text-xs text-slate-500">No filters needed — this report covers everything.</p>}
      </div>
    </Modal>
  );
};

export default function SaleReportsHub() {
  const T = useTerms("saleDeal", "saleBuyer", "saleListing", "saleAgent", "saleProject");
  const navigate = useNavigate();
  const groups = useMemo(() => buildGroups(T), [T]);
  const [activeReport, setActiveReport] = useState(null);
  const [pdfJob, setPdfJob] = useState(null);
  const selectItem = (item) => (item.to ? navigate(item.to) : setActiveReport(item));

  const projects = useQuery({ queryKey: ["sale-rep-projects"], queryFn: () => saleApi.listProjects({ limit: 200 }), staleTime: 300_000 });
  const agents = useQuery({ queryKey: ["sale-rep-agents"], queryFn: () => saleApi.listAgents({ limit: 200 }), staleTime: 300_000 });
  const projectOptions = useMemo(() => (projects.data?.data || []).map((p) => ({ value: p._id, label: [p.projectNumber, p.name].filter(Boolean).join(" · ") })), [projects.data]);
  const agentOptions = useMemo(() => (agents.data?.data || []).map((a) => ({ value: a._id, label: a.fullName })), [agents.data]);

  return (
    <PropertySaleShell title="Reports">
      <div className="grid flex-1 grid-cols-1 gap-px overflow-y-auto bg-slate-200 md:grid-cols-3">
        {groups.map((g) => (
          <div key={g.title} className="bg-white p-4">
            <div className="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{g.title}</div>
            <div className="flex flex-col">
              {g.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectItem(item)}
                  className="flex items-center justify-between gap-2 border-b border-slate-100 py-2.5 text-left text-sm font-semibold text-slate-800 transition hover:text-[#0B3B2E]"
                >
                  {item.label}
                  {item.to ? <FaExternalLinkAlt size={10} className="flex-none text-slate-300" /> : <FaFilePdf size={11} className="flex-none text-slate-300" />}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {activeReport && (
        <ReportParamsModal
          report={activeReport}
          T={T}
          projectOptions={projectOptions}
          agentOptions={agentOptions}
          onClose={() => setActiveReport(null)}
          onGenerate={(params) => {
            setPdfJob({ reportId: activeReport.id, title: activeReport.label, params });
            setActiveReport(null);
          }}
        />
      )}

      <SaleReportPdfModal
        open={Boolean(pdfJob)}
        reportId={pdfJob?.reportId}
        title={pdfJob?.title}
        params={pdfJob?.params}
        onClose={() => setPdfJob(null)}
      />
    </PropertySaleShell>
  );
}
