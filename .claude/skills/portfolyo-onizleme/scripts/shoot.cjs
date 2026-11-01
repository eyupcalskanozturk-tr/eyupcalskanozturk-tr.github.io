#!/usr/bin/env node
// Portfolyo önizleme: yerel sunucu + Playwright ile ekran görüntüsü ve otomatik kontroller.
//
//   node .claude/skills/portfolyo-onizleme/scripts/shoot.cjs --out /tmp/onizleme
//
// Seçenekler:
//   --out <klasör>        ekran görüntülerinin yazılacağı yer (varsayılan: <tmp>/portfolyo-onizleme)
//   --root <klasör>       sitenin kökü (varsayılan: çalışma dizini)
//   --path </yol/>        açılacak sayfa (varsayılan: /; örnek: /chen-atolyesi/)
//   --times 07:35,22:30   denenecek gökyüzü saatleri (varsayılan: 07:35,13:00,18:05,22:30)
//   --no-full             tam sayfa görüntüsünü atla
//   --port <sayı>         yerel sunucu portu (varsayılan: 8123)
//
// Çıkış kodu: sorun yoksa 0, yatay taşma ya da JS hatası varsa 1, Playwright yoksa 2.
"use strict";

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("Playwright bulunamadı. Kurmak için: npm i -D playwright && npx playwright install chromium");
  process.exit(2);
}

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const flag = (name) => args.includes(`--${name}`);

const root = path.resolve(option("root", process.cwd()));
const out = path.resolve(option("out", path.join(os.tmpdir(), "portfolyo-onizleme")));
const pagePath = option("path", "/");
const port = Number(option("port", 8123));
const times = option("times", "07:35,13:00,18:05,22:30").split(",").map((t) => t.trim()).filter((t) => /^\d{1,2}:\d{2}$/.test(t));
const fullPage = !flag("no-full");
fs.mkdirSync(out, { recursive: true });

// ───────── Basit statik sunucu ─────────
const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon", ".woff2": "font/woff2"
};
const server = http.createServer((req, res) => {
  let file = path.join(root, decodeURIComponent(req.url.split("?")[0]));
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  try { if (fs.statSync(file).isDirectory()) file = path.join(file, "index.html"); } catch { /* aşağıda 404 */ }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("404"); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});

// Bulut ortamında dış sitelere (müşteri siteleri vb.) erişim kapalı olabilir: bu ağ hataları ayrı sayılır.
const isNetworkNoise = (text) => /Failed to load resource|net::ERR_|ERR_TUNNEL|CONNECT tunnel/i.test(text);

async function openPage(browser, viewport, extra = {}) {
  const page = await browser.newPage({ viewport, ...extra });
  const errors = [], network = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") (isNetworkNoise(m.text()) ? network : errors).push(m.text()); });
  await page.goto(`http://localhost:${port}${pagePath}`, { waitUntil: "load" });
  await page.waitForTimeout(2800); // açılış animasyonları bitsin
  return { page, errors, network };
}

async function viewportRun(browser, label, viewport, extra) {
  const { page, errors, network } = await openPage(browser, viewport, extra);
  const shots = [];
  const shot = async (name, opts = {}) => { const file = `${label}-${name}.png`; await page.screenshot({ path: path.join(out, file), ...opts }); shots.push(file); };
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  await shot("ilk-ekran");

  // Gökyüzü saatleri (yalnızca ana sayfada saat şeridi var)
  if (await page.$("#sky-time")) {
    for (const time of times) {
      const [h, m] = time.split(":").map(Number);
      await page.evaluate((minutes) => {
        const range = document.querySelector("#sky-time");
        range.value = String(minutes);
        range.dispatchEvent(new Event("input", { bubbles: true }));
      }, h * 60 + m);
      await page.waitForTimeout(300);
      await shot(`gokyuzu-${time.replace(":", "")}`);
    }
  }

  // Tam sayfa: animasyonları durdur, geç beliren öğeleri aç ki görüntü eksiksiz olsun
  if (fullPage) {
    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = "auto";
      document.documentElement.classList.add("motion-paused");
      document.querySelectorAll(".is-pending").forEach((el) => el.classList.remove("is-pending"));
      document.querySelectorAll("#statement .w").forEach((w) => w.classList.add("on"));
    });
    await page.waitForTimeout(300);
    await shot("tam-sayfa", { fullPage: true });
  }
  await page.close();
  return { label, overflow, errors, network: network.length, shots };
}

async function terminalRun(browser) {
  const { page, errors } = await openPage(browser, { width: 1280, height: 800 });
  if (!(await page.$("#terminal"))) { await page.close(); return null; }
  await page.keyboard.press("/");
  await page.waitForTimeout(200);
  await page.keyboard.type("yardim");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  const lines = await page.evaluate(() => document.querySelectorAll("#term-out p").length);
  const open = await page.evaluate(() => document.querySelector("#terminal").open);
  await page.screenshot({ path: path.join(out, "terminal.png") });
  await page.keyboard.press("Escape");
  await page.close();
  return { open, lines, errors };
}

async function reducedMotionRun(browser) {
  const { page, errors } = await openPage(browser, { width: 1280, height: 800 }, { reducedMotion: "reduce" });
  const paused = await page.evaluate(() => document.documentElement.classList.contains("motion-paused"));
  await page.close();
  return { paused, errors };
}

(async () => {
  await new Promise((resolve) => server.listen(port, resolve));
  const browser = await chromium.launch();
  let problems = 0;
  try {
    const runs = [
      await viewportRun(browser, "masaustu", { width: 1440, height: 900 }),
      await viewportRun(browser, "mobil", { width: 375, height: 812 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    ];
    console.log(`Önizleme: http://localhost:${port}${pagePath}  →  ${out}\n`);
    for (const run of runs) {
      const ok = run.overflow <= 0 && run.errors.length === 0;
      if (!ok) problems += 1;
      console.log(`${ok ? "✓" : "✗"} ${run.label}: yatay taşma ${run.overflow > 0 ? `${run.overflow}px` : "yok"} · JS hatası ${run.errors.length} · dış ağ hatası ${run.network} (bulutta normal)`);
      run.errors.forEach((e) => console.log(`    hata: ${e}`));
      console.log(`    görüntüler: ${run.shots.join(", ")}`);
    }
    const term = await terminalRun(browser);
    if (term) {
      const ok = term.open && term.lines > 3 && term.errors.length === 0;
      if (!ok) problems += 1;
      console.log(`${ok ? "✓" : "✗"} terminal: ${term.open ? "açıldı" : "AÇILMADI"} · 'yardim' ${term.lines} satır · görüntü: terminal.png`);
    }
    const reduced = await reducedMotionRun(browser);
    const ok = reduced.errors.length === 0 && (reduced.paused || pagePath !== "/");
    if (!ok) problems += 1;
    console.log(`${ok ? "✓" : "✗"} hareket azaltma: ${reduced.paused ? "animasyonlar durduruldu" : "durdurma sınıfı yok"} · JS hatası ${reduced.errors.length}`);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(problems ? `\n${problems} sorun var.` : "\nHer şey yolunda.");
  process.exit(problems ? 1 : 0);
})().catch((err) => { console.error(err); server.close(); process.exit(1); });
