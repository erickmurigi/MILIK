// Shared print engine, browser side: opens the print window and prints. The HTML itself comes from printKitCore.js, which the
// server also uses for its PDFs, so every printout carries the same letterhead, typography, footer and "Powered by Milik" stamp.
//
//   printDocument(spec)      customer documents (invoice, receipt, voucher, statement...)  A4 portrait
//   printTabularList(spec)   lists and reports (utils/printList.js re-exports it)          A4 landscape
//
// `spec.win` lets a caller that has to fetch data first open the window straight away inside the click handler (a window
// opened after an await is usually blocked as a pop-up); it is cleared before the document is written into it.
import { documentPageHtml, listPageHtml } from "./printKitCore";

export * from "./printKitCore";

export const openPrintWindow = (target = null, size = "width=1200,height=800") => target || window.open("", "_blank", size);

const writeAndPrint = (win, html) => {
  win.document.open();
  win.document.write(html);
  win.document.close();
  setTimeout(() => { win.focus(); win.print(); }, 450);
  return win;
};

export const printDocument = (spec) => {
  const win = openPrintWindow(spec.win, "width=980,height=1100");
  return win ? writeAndPrint(win, documentPageHtml(spec)) : null;
};

export const printTabularList = (spec) => {
  const win = openPrintWindow(spec.win);
  return win ? writeAndPrint(win, listPageHtml(spec)) : null;
};
