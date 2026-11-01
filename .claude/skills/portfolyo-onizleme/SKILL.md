---
name: portfolyo-onizleme
description: Portfolyo sitesindeki (eyupcalskanozturk-tr.github.io) bir değişikliği tarayıcıda doğrulama iş akışı — yerel sunucu, Playwright ile masaüstü (1440px) ve mobil (375px) ekran görüntüleri, dört farklı gökyüzü saati, yatay taşma, JS hatası, terminal ve hareket azaltma kontrolü. Bu repoda HTML/CSS/JS değiştirdikten sonra, PR açmadan önce ve kullanıcı "nasıl görünüyor", "ekran görüntüsü al", "mobilde kontrol et", "test et", "bozuk mu", "önizle" dediğinde mutlaka kullan.
---

# Portfolyo önizleme

Kullanıcı sonucu görmeden "oldu" demek, bu projede en çok güven kaybettiren şeydir. Her görsel değişiklikten sonra siteyi gerçek bir tarayıcıda aç, ekran görüntülerine kendin bak ve önemli olanları kullanıcıya göster.

## Tek komut

Repo kökünden çalıştır:

```bash
node .claude/skills/portfolyo-onizleme/scripts/shoot.cjs --out <çıktı-klasörü>
```

Betik, repoyu yerel bir sunucuda açar ve şunları yapar:

- **Masaüstü (1440×900) ve mobil (375×812):** ilk ekran, 07:35 · 13:00 · 18:05 · 22:30 gökyüzü saatleri ve tam sayfa görüntüsü.
- **Yatay taşma:** `scrollWidth`, sayfa genişliğini aşmamalı.
- **JS hataları:** konsol ve sayfa hataları. Dış ağ hataları ayrı sayılır.
- **Terminal:** `/` ile açılıyor mu, `yardim` çıktı veriyor mu.
- **Hareket azaltma:** `prefers-reduced-motion` açıkken animasyonlar duruyor mu.

Sorun yoksa 0, sorun varsa 1 koduyla çıkar ve her bulguyu satır satır yazar.

Seçenekler:

- `--path /chen-atolyesi/` alt sayfayı açar.
- `--times 06:30,19:00` farklı saatleri dener.
- `--no-full` tam sayfa görüntüsünü atlar.
- `--port 8130` sunucu portunu değiştirir.

## Sonuçları yorumlama

- **Bulut ortamında olağan olanlar:** Claude Code bulut oturumunda dış sitelere erişim kapalı olabilir. Bu yüzden müşteri sitelerinin "ölçülemedi" görünmesi ve GitHub API'ye ulaşılamayınca statik repo listesinin gösterilmesi hata değildir. Google Fonts genelde yüklenir.
- **Görüntülere bak:** Görüntüleri Read aracıyla aç. Kontrol listesi:
  - Türkçe harfler (İ, ı, Ş, ğ, Ö, Ü, Ç) doğru görünüyor mu?
  - Dev isim taşıyor mu, Ö/Ü noktaları kırpılıyor mu?
  - Dört saatte de yazılar okunuyor mu?
  - Mobilde menü sığıyor mu, butonlar parmakla basılacak kadar büyük mü?
- **Animasyonlar:** Kare kare görmek istediğinde (örneğin harflerin yükselişi, düşen taşlar) kendi küçük Playwright betiğinde `waitForTimeout` ile iki farklı anda görüntü al.
- **Kullanıcıya göster:** En önemli 2-4 görüntüyü (masaüstü ilk ekran, mobil tam sayfa, değişen bölüm) kullanıcıya gönder, ardından PR veya merge onayı iste. Mobil tam sayfa çok uzunsa parçalara bölüp yan yana tek görselde birleştir.

## Ortam

- **Claude Code bulut oturumu:** Playwright ve Chromium kurulu gelir; `require("playwright")` her dizinden çalışır. Ayrıca kurulum yapma.
- **Kendi bilgisayarında:** bir kez `npm i -D playwright && npx playwright install chromium` çalıştır.
- **Port meşgulse** `--port` ile başka bir port seç.

Sorun bulursan önce `portfolyo-tasarim-dili` skill'indeki kurallara göre düzelt, betiği tekrar çalıştır. Temiz sonuç alınca `portfolyo-yayin` ile yayına geç.
