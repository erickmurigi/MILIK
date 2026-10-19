// Report Center PDF generation — one route, dispatched by :reportId to the matching data builder in
// saleReportPdfData.js, then rendered through the exact same listPageHtml + renderHtmlToPdf pipeline
// already used by the PMS Landlord Statement (and the other existing PDF services) — a real PDF buffer,
// not a client-side window.print() popup, so the frontend can preview it in the browser's own PDF
// viewer the same way Statements.jsx already does.
import Company from "../../../models/Company.js";
import { listPageHtml } from "../../../utils/printKitCore.js";
import { renderHtmlToPdf } from "../../../utils/pdfRender.js";
import { resolveActiveBusinessId } from "../services/businessScope.js";
import { createError } from "../../../utils/error.js";
import { SALE_REPORTS } from "../services/saleReportPdfData.js";

export const generateReportPdf = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const report = SALE_REPORTS[req.params.reportId];
    if (!report) return next(createError(404, "Unknown report"));

    const [company, spec] = await Promise.all([
      Company.findById(business).lean(),
      report.build(business, req),
    ]);

    const html = listPageHtml({
      title: report.title,
      kicker: report.kicker,
      company,
      orientation: "landscape",
      ...spec,
    });
    const pdf = await renderHtmlToPdf(html, report.title);

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${req.params.reportId}-${new Date().toISOString().slice(0, 10)}.pdf"`,
      "Content-Length": pdf.length,
    });
    res.send(pdf);
  } catch (err) {
    next(err);
  }
};
