#!/usr/bin/env node
// veri-tabani/sql/ (Veri Tabanı I · 8–9. hafta SQL pratiği) için sınama aracı.
//
//   node .claude/araclar/vt-sql-sina.cjs [--port 8199]
//
// Sayfayı yerel sunucuda açar ve gorevler.js'teki her görevi arayüzden çözer:
//   - sorgu görevleri: `cozum` editöre yazılır, çalıştırılır; "Doğru" çıkmalı ve
//     sonuç `beklenen` satır sayısını vermeli (kitabın "Beklenen sonuçlar" tablosu),
//   - deneyler: `cozum` (deneyin yazılışı) beklenen hatayı ya da satır sayısını vermeli,
//   - kısa yanıtlı sorular: `cevap` yazılır.
// Ayrıca JS hatası, başarısız istek ve masaüstü/mobil yatay taşma denetlenir.
// Bir görevi, motor.js'i ya da sayfayı değiştirdikten sonra çalıştır. Çıkış kodu: sorun yoksa 0.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright bulunamadı (npm i -D playwright).');
  process.exit(2);
}

const args = process.argv.slice(2);
const secenek = (ad, varsayilan) => {
  const i = args.indexOf(`--${ad}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : varsayilan;
};
const PORT = Number(secenek('port', 8199));
const KOK = path.resolve(__dirname, '..', '..');
const TURLER = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
};

const sunucu = http.createServer((istek, yanit) => {
  let dosya = path.join(KOK, decodeURIComponent(istek.url.split('?')[0]));
  if (!dosya.startsWith(KOK)) {
    yanit.writeHead(403);
    yanit.end();
    return;
  }
  try {
    if (fs.statSync(dosya).isDirectory()) dosya = path.join(dosya, 'index.html');
  } catch {
    /* 404 aşağıda */
  }
  fs.readFile(dosya, (hata, veri) => {
    if (hata) {
      yanit.writeHead(404);
      yanit.end('404');
      return;
    }
    yanit.writeHead(200, { 'content-type': TURLER[path.extname(dosya)] || 'application/octet-stream' });
    yanit.end(veri);
  });
});

(async () => {
  await new Promise((r) => sunucu.listen(PORT, '127.0.0.1', r));
  const adres = `http://127.0.0.1:${PORT}/veri-tabani/sql/`;
  const tarayici = await chromium.launch();
  const sorunlar = [];
  const izle = (sayfa, etiket) => {
    sayfa.on('pageerror', (e) => sorunlar.push(`[${etiket} JS hatası] ${e.message}`));
    sayfa.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource|net::ERR_/i.test(m.text())) sorunlar.push(`[${etiket} konsol] ${m.text()}`);
    });
    sayfa.on('response', (r) => {
      if (r.url().startsWith(`http://127.0.0.1:${PORT}/`) && r.status() >= 400 && !/istatistik|favicon/.test(r.url())) sorunlar.push(`[${etiket} HTTP ${r.status()}] ${r.url()}`);
    });
  };

  const sayfa = await tarayici.newPage({ viewport: { width: 1280, height: 900 } });
  izle(sayfa, 'masaüstü');
  await sayfa.goto(adres, { waitUntil: 'load' });
  await sayfa.waitForSelector('#motor-durum[data-durum="hazir"]', { timeout: 30000 });

  const gorevler = await sayfa.evaluate(async () => {
    const { HAFTALAR } = await import('./gorevler.js');
    return HAFTALAR.flatMap((h) =>
      h.bolumler.flatMap((b) => b.gorevler.map((g) => ({ id: g.id, kod: `${h.no}. hafta ${g.kod}`, tur: g.tur || 'sorgu', cozum: g.cozum || null, cevap: g.cevap || null, beklenen: g.beklenen }))),
    );
  });

  // Referans çözümlerin satır sayıları kitabın beklenen sonuçlarıyla aynı mı?
  const sayilar = await sayfa.evaluate(async () => {
    const m = await window.__vtsql.motorSozu;
    const { HAFTALAR } = await import('./gorevler.js');
    const sonuc = {};
    for (const h of HAFTALAR) {
      for (const b of h.bolumler) {
        for (const g of b.gorevler) {
          if (!g.cozum || g.tur) continue;
          const r = m.calistir(g.cozum).sonuclar;
          const s = r[r.length - 1];
          sonuc[g.id] = s.tur === 'tablo' ? s.satirSayisi : 'hata: ' + s.mesaj;
        }
      }
    }
    return sonuc;
  });

  let gecen = 0;
  for (const g of gorevler) {
    if (g.tur === 'sorgu' && sayilar[g.id] !== g.beklenen) sorunlar.push(`[${g.kod}] çözüm ${sayilar[g.id]} satır veriyor, beklenen ${g.beklenen}`);
    const kart = sayfa.locator('#g-' + g.id);
    if (g.tur === 'soru') {
      await kart.locator('input').fill(g.cevap.join(', '));
      await kart.locator('button', { hasText: 'Kontrol et' }).click();
    } else {
      await kart.locator('textarea.ed-yazi').first().fill(g.cozum);
      await kart.locator('button.calistir').first().click();
    }
    await kart.locator('.gb[data-durum]').waitFor({ timeout: 10000 });
    const durum = await kart.locator('.gb').getAttribute('data-durum');
    if (durum === 'dogru') gecen++;
    else sorunlar.push(`[${g.kod}] ${durum}: ${(await kart.locator('.gb').innerText()).replace(/\s+/g, ' ')}`);
  }
  const sayac = await sayfa.locator('#ilerleme-sayi').innerText();
  const tasma = await sayfa.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (tasma > 0) sorunlar.push(`[masaüstü] ${tasma}px yatay taşma`);

  const mobil = await tarayici.newPage({ viewport: { width: 375, height: 760 }, isMobile: true, hasTouch: true });
  izle(mobil, 'mobil');
  await mobil.goto(adres, { waitUntil: 'load' });
  await mobil.waitForSelector('#motor-durum[data-durum="hazir"]', { timeout: 30000 });
  const mk = mobil.locator('#g-h9-r10');
  await mk.locator('textarea.ed-yazi').fill(gorevler.find((g) => g.id === 'h9-r10').cozum);
  await mk.locator('button.calistir').click();
  await mk.locator('.gb[data-durum]').waitFor({ timeout: 10000 });
  const mtasma = await mobil.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (mtasma > 0) sorunlar.push(`[mobil] ${mtasma}px yatay taşma`);

  await tarayici.close();
  sunucu.close();
  console.log(`Görev: ${gecen} / ${gorevler.length} arayüzden çözüldü · sayaç ${sayac} · masaüstü taşma ${tasma} · mobil taşma ${mtasma}`);
  if (sorunlar.length) {
    console.log('Sorunlar:\n' + sorunlar.map((s) => '  - ' + s).join('\n'));
    process.exit(1);
  }
  console.log('Her şey yolunda.');
})().catch((e) => {
  console.error(e);
  sunucu.close();
  process.exit(1);
});
