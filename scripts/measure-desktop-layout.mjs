/**
 * Owner round 34: measure the desktop chat layout.
 *
 * The owner reported that the message bar / bottom row is cut off at the
 * bottom of the desktop viewport. This script opens a real conversation in
 * the built web app, prints the geometry of every box that matters and
 * saves a screenshot, so the fix can be checked against numbers instead of
 * guesses.
 *
 *   node scripts/measure-desktop-layout.mjs [baseUrl] [convId]
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:8099";
const convId =
  process.argv[3] ?? "c_2541ac80-ecb9-4a68-96e5-1dda334fdc52_f9864c26-b413-48ba-9b7f-be64fed8d6d6";
const token = readFileSync("/tmp/kp_token.txt", "utf8").trim();
const width = Number(process.env.VIEW_W ?? 1440);
const height = Number(process.env.VIEW_H ?? 900);

mkdirSync("/tmp/kp-shots", { recursive: true });

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width, height } });
page.on("console", (m) => {
  if (m.type() === "error") console.log("  [console error]", m.text().slice(0, 200));
});

await page.goto(`${baseUrl}/chats/${encodeURIComponent(convId)}`, {
  waitUntil: "domcontentloaded",
});
await page.evaluate((value) => {
  window.localStorage.setItem("kp.token", value);
}, token);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".composer", { timeout: 30_000 }).catch(() => {});
await page.waitForTimeout(4000);

const report = await page.evaluate(() => {
  const box = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      selector,
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      height: Math.round(r.height),
      width: Math.round(r.width),
    };
  };
  const composer = document.querySelector(".composer");
  const rows = composer
    ? Array.from(
        composer.querySelectorAll(".composer__row, .composer__hint, .composer__error"),
      ).map((el) => {
        const r = el.getBoundingClientRect();
        return {
          cls: el.className,
          top: Math.round(r.top),
          bottom: Math.round(r.bottom),
          height: Math.round(r.height),
        };
      })
    : [];
  return {
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
    scrollHeight: document.scrollingElement?.scrollHeight ?? 0,
    scrollTop: document.scrollingElement?.scrollTop ?? 0,
    bodyScrollHeight: document.body.scrollHeight,
    boxes: [
      box(".kp-app"),
      box(".preview-banner"),
      box(".workspace"),
      box(".conversation-pane"),
      box(".conversation-header"),
      box(".transcript"),
      box(".outbox-bar"),
      box(".composer"),
    ],
    composerRows: rows,
  };
});

console.log(JSON.stringify(report, null, 2));
const composer = report.boxes.find((b) => b?.selector === ".composer");
if (composer) {
  const cut = composer.bottom - report.innerHeight;
  console.log(
    `\ncomposer bottom=${composer.bottom} viewport=${report.innerHeight} => ${
      cut > 0 ? `CUT OFF by ${cut}px` : `fully visible (${-cut}px spare)`
    }`,
  );
  for (const row of report.composerRows) {
    const rowCut = row.bottom - report.innerHeight;
    console.log(
      `  row ${row.cls}: top=${row.top} bottom=${row.bottom} => ${
        rowCut > 0 ? `CUT OFF by ${rowCut}px` : "visible"
      }`,
    );
  }
}
await page.screenshot({ path: "/tmp/kp-shots/desktop-chat.png", fullPage: false });
console.log("screenshot: /tmp/kp-shots/desktop-chat.png");
await browser.close();
