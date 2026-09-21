// Letter printout on the shared print kit: company letterhead, the letter's own (already sanitised) HTML body, footer and the
// "Powered by Milik" stamp. Used by HR/HRLetters.jsx and ESS/ESSLetters.jsx.
import DOMPurify from "dompurify";
import { getCompanyDetails, letterheadHtml, footerHtml, wrapPage, pageBoxCss, openPrintWindow, formatDate } from "./printKit";

const LETTER_CSS = `
  .letter { font-family: "Segoe UI", Arial, Helvetica, sans-serif; font-size: 12px; line-height: 1.6; color: #0f172a; margin-top: 6px; }
  .letter p { margin-bottom: 8px; }
`;

/**
 * spec: { company, kicker (letter type), title (subject), body (HTML, sanitised here), issuedDate, status: { label, tone }, footerLeft, footerRight }
 * Returns the print window, or null when pop-ups are blocked.
 */
export const printLetterDocument = ({ company, kicker = "Letter", title = "", body = "", issuedDate = null, status = null, footerLeft = "", footerRight = "Private & Confidential" }) => {
  const win = openPrintWindow(null, "width=980,height=1100");
  if (!win) return null;
  const co = getCompanyDetails(company);
  const page = wrapPage({
    title: `${kicker}${title ? ` — ${title}` : ""}`,
    css: LETTER_CSS,
    body: `
      ${letterheadHtml(company, { kicker, title, status, subtitle: issuedDate ? `Issued ${formatDate(issuedDate)}` : "", printed: false })}
      <div class="letter">${DOMPurify.sanitize(body || "")}</div>
      ${footerHtml(company, { left: footerLeft || co.name, right: footerRight })}`,
    pageCss: pageBoxCss({ size: "A4", margin: "14mm 20mm 18mm", left: co.name }),
  });
  win.document.open();
  win.document.write(page);
  win.document.close();
  setTimeout(() => { win.focus(); win.print(); }, 450);
  return win;
};
