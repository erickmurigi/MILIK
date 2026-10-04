// Shared PDF rendering: a bounded queue of headless-browser renders with a timeout on each one.
// Print documents that don't need their own cache use this so they share the same limits.
import { createPage, resetBrowser } from '../services/browserService.js';

const MAX_CONCURRENT_PDF_RENDERS = 3;
const QUEUE_TIMEOUT_MS = 120_000;
const RENDER_TIMEOUT_MS = 90_000;
let activeRenderCount = 0;
const waitQueue = [];

const withTimeout = (promise, ms, message) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);

const acquireSlot = async () => {
  if (activeRenderCount < MAX_CONCURRENT_PDF_RENDERS) {
    activeRenderCount += 1;
    return;
  }
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = waitQueue.indexOf(resolve);
      if (idx !== -1) waitQueue.splice(idx, 1);
      reject(new Error('PDF render queue timeout'));
    }, QUEUE_TIMEOUT_MS);
    waitQueue.push(() => {
      clearTimeout(timer);
      resolve();
    });
  });
  activeRenderCount += 1;
};

const releaseSlot = () => {
  activeRenderCount = Math.max(0, activeRenderCount - 1);
  const next = waitQueue.shift();
  if (next) next();
};

/** Renders a full HTML document (from documentPageHtml) to an A4 PDF buffer. */
export const renderHtmlToPdf = async (html, label = 'PDF') => {
  await acquireSlot();
  let page = null;
  try {
    page = await createPage();
    page.setDefaultNavigationTimeout(30_000);
    page.setDefaultTimeout(30_000);
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const pdfBuffer = await withTimeout(
      page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' },
      }),
      RENDER_TIMEOUT_MS,
      `${label} render timed out`
    );
    try { await page.close(); } catch { /* ignore */ }
    return Buffer.from(pdfBuffer);
  } catch (error) {
    await resetBrowser();
    throw error;
  } finally {
    releaseSlot();
  }
};
