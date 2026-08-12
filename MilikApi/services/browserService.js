// Shared Puppeteer browser — one instance for all PDF services.
// Uses a launch Promise so concurrent callers share the same init rather than polling.
// Keeps one pre-warmed page ready so the next PDF render skips newPage() latency.
import puppeteer from "puppeteer";

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
];

let browser = null;
let launchPromise = null;
let warmPagePromise = null; // pre-warmed page for next render

const isBrowserUsable = (b) =>
  b != null && (typeof b.isConnected !== "function" || b.isConnected());

export const getBrowser = async () => {
  if (isBrowserUsable(browser)) return browser;
  if (launchPromise) return launchPromise;

  launchPromise = puppeteer
    .launch({ headless: true, args: LAUNCH_ARGS })
    .then((b) => {
      browser = b;
      launchPromise = null;
      b.on("disconnected", () => {
        browser = null;
        launchPromise = null;
        warmPagePromise = null;
      });
      return b;
    })
    .catch((err) => {
      launchPromise = null;
      throw err;
    });

  return launchPromise;
};

export const resetBrowser = async () => {
  warmPagePromise = null;
  const b = browser;
  browser = null;
  launchPromise = null;
  if (b) {
    try { await b.close(); } catch { /* ignore */ }
  }
};

const startWarmingPage = () => {
  if (warmPagePromise) return;
  warmPagePromise = getBrowser()
    .then((b) => openPage(b))
    .catch(() => null);
};

export const createPage = async () => {
  // Use the pre-warmed page if available — skips newPage() round-trip
  if (warmPagePromise) {
    const warm = warmPagePromise;
    warmPagePromise = null;
    try {
      const page = await warm;
      if (page && !page.isClosed()) {
        startWarmingPage();
        return page;
      }
    } catch { /* fall through to fresh page */ }
  }

  let b = await getBrowser();
  try {
    const page = await openPage(b);
    startWarmingPage();
    return page;
  } catch {
    await resetBrowser();
    b = await getBrowser();
    return openPage(b);
  }
};

async function openPage(b) {
  const page = await b.newPage();
  page.on("error", () => {});
  page.on("pageerror", () => {});
  return page;
}
