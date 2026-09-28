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

/**
 * Prints a PDF that was fetched from the server (an invoice, a fee invoice, a statement...) without leaving the page: the print
 * dialog opens over the current screen, like every other printout, instead of the PDF opening in a tab of its own.
 * Falls back to opening the PDF in a tab only if the browser refuses to print from the page.
 */
export const printPdfBlob = (blob) => new Promise((resolve) => {
  const url = URL.createObjectURL(blob);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  const finish = () => { setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 60_000); resolve(); };
  frame.onload = () => {
    // give the PDF viewer inside the frame a moment to lay the pages out before printing
    setTimeout(() => {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      } catch {
        window.open(url, "_blank");
      }
      finish();
    }, 300);
  };
  frame.src = url;
  document.body.appendChild(frame);
});

export const printDocument = (spec) => {
  const win = openPrintWindow(spec.win, "width=980,height=1100");
  return win ? writeAndPrint(win, documentPageHtml(spec)) : null;
};

export const printTabularList = (spec) => {
  const win = openPrintWindow(spec.win);
  return win ? writeAndPrint(win, listPageHtml(spec)) : null;
};
