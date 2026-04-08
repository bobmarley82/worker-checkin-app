import puppeteer, { type Browser } from "puppeteer";

declare global {
  var __dailyReportPdfBrowserPromise: Promise<Browser> | undefined;
}

export async function getPdfBrowser() {
  if (!globalThis.__dailyReportPdfBrowserPromise) {
    globalThis.__dailyReportPdfBrowserPromise = puppeteer.launch({
      headless: true,
    });
  }

  const browser = await globalThis.__dailyReportPdfBrowserPromise;

  if (!browser.connected) {
    globalThis.__dailyReportPdfBrowserPromise = puppeteer.launch({
      headless: true,
    });
    return globalThis.__dailyReportPdfBrowserPromise;
  }

  return browser;
}
