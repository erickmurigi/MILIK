import { createPage } from "./browserService.js";

export async function htmlToPdf(html, options = {}) {
  const page = await createPage();
  try {
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
      ...options,
    });
  } finally {
    try { await page.close(); } catch { /* ignore */ }
  }
}
