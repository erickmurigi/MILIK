// Shared Puppeteer browser — one instance for all PDF services.
// Uses a launch Promise so concurrent callers share the same init rather than polling.
import puppeteer from "puppeteer";

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
];

let browser = null;
let launchPromise = null;

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
  const b = browser;
  browser = null;
  launchPromise = null;
  if (b) {
    try { await b.close(); } catch { /* ignore */ }
  }
};

export const createPage = async () => {
  let b = await getBrowser();
  try {
    return await openPage(b);
  } catch {
    await resetBrowser();
    b = await getBrowser();
    return openPage(b);
  }
};

async function openPage(b) {
  const page = await b.newPage();
  await page.setCacheEnabled(false);
  page.on("error", () => {});
  page.on("pageerror", () => {});
  return page;
}
