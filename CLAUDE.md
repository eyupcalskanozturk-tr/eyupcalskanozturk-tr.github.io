# Eyüp'ün portfolyosu — proje hafızası

Eyüp Çalışkanöztürk'ün kişisel sitesi: https://eyupcalskanozturk-tr.github.io (GitHub Pages). Türkçe; derleme adımı yok, düz HTML/CSS/JavaScript (`index.html`, `css/style.css`, `js/main.js`, `assets/`). Alt sayfalar: `chen-atolyesi/`, `laravel-vize/`, `PROJE/`.

Kullanıcıya "Başkan" ya da Eyüp diye hitap et. Koyu tema, altın ve neon vurgular, glassmorphism ve terminal estetiğini sever.

## Bu repodaki skill'ler

- `portfolyo-tasarim-dili` — tasarım dili ve kod haritası. Siteye dokunan her işten önce oku.
- `portfolyo-onizleme` — değişiklikten sonra ekran görüntüsü ve otomatik kontroller (`.claude/skills/portfolyo-onizleme/scripts/shoot.cjs`).
- `portfolyo-yayin` — dal, PR, onaylı merge ve Pages yayını; `deploy.yml` kopyalama listesi tuzağı.

## Değişmez kurallar

- `main` canlı sitedir: doğrudan push yok; dal + PR + kullanıcı onayıyla merge.
- Bilgi uydurma: müşteri, sayı ve özellik iddialarını yalnızca kullanıcının verdiği kaynaklardan al.
- Erişilebilirlik ve hareket azaltma desteğini koru; yeni animasyonlar `motionPaused()` ve `.motion-paused` kurallarına uyar.
- Kökte yeni dosya ya da yeni klasör eklersen `.github/workflows/deploy.yml` kopyalama adımına da ekle.
