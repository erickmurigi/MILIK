// Shared helpers for printing the Property Sales reports with the standard report layout (utils/printList.js: company
// header, title and filters, summary bar, table with a totals row, A4 landscape).
import { toast } from "react-toastify";
import printTabularList from "../../utils/printList";
import { openPrintWindow } from "../../utils/printKit";

export const POPUP_BLOCKED = "Pop-up blocked — allow pop-ups for this site to print";
export const money = (v) => Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const shortDate = (v) => (v ? new Date(v).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

/** Print rows that are already on screen. */
export const printNow = (spec) => {
  if (!printTabularList(spec)) toast.error(POPUP_BLOCKED);
};

/**
 * Print rows that must be fetched first. The window is opened straight away, inside the click, so the browser does not
 * treat it as a pop-up; it is closed again if the fetch fails.
 */
export const printAfterFetch = async (fetchRows, buildSpec) => {
  const win = window.open("", "_blank", "width=1200,height=800");
  if (!win) { toast.error(POPUP_BLOCKED); return; }
  try {
    win.document.write("<p style=\"font-family:Arial;padding:24px;color:#475569\">Preparing report…</p>");
    printTabularList({ ...buildSpec(await fetchRows()), win });
  } catch (error) {
    win.close();
    toast.error(error?.response?.data?.message || "Could not prepare the report for printing");
  }
};

/**
 * Print a document that has to be fetched first (a receipt, a deal statement...) from a button on a list, the way the receipts
 * page does: the print dialog opens over the current screen. `run(win)` fetches and prints into the window that is opened
 * straight away, inside the click, so the browser does not treat it as a pop-up; it is closed again if the fetch fails.
 */
export const printSaleDocument = async (run) => {
  const win = openPrintWindow(null, "width=980,height=1100");
  if (!win) { toast.error(POPUP_BLOCKED); return; }
  try {
    win.document.write("<p style=\"font-family:Arial;padding:24px;color:#475569\">Preparing document…</p>");
    await run(win);
  } catch (error) {
    win.close();
    toast.error(error?.response?.data?.message || "Could not prepare the document for printing");
  }
};

/** Every page of a paged list endpoint (the sale endpoints cap one page at 200). */
export const fetchAllPages = async (fetcher, params, { pageSize = 200, maxPages = 25 } = {}) => {
  const rows = [];
  let extra = null;
  for (let page = 1; page <= maxPages; page += 1) {
    const res = await fetcher({ ...params, page, limit: pageSize });
    rows.push(...(res.data || []));
    extra = res;
    if (page >= (res.pages || 1)) break;
  }
  return { rows, last: extra };
};
