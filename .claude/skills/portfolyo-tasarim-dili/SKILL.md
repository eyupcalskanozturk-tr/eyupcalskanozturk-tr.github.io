---
name: portfolyo-tasarim-dili
description: Eyüp'ün portfolyo sitesinin (eyupcalskanozturk-tr.github.io) tasarım dili ve kod haritası — Çanakkale gökyüzü renk sistemi, Archivo değişken font + JetBrains Mono, bileşenler, hareket, erişilebilirlik ve içerik kuralları. Bu repoda index.html, css/style.css ya da js/main.js'e dokunan her işte, yeni bölüm/sayfa/özellik eklerken, renk-yazı-animasyon değişikliğinde ya da "siteye X ekle", "şu kısmı güzelleştir", "mobilde bozuk", "redesign", UI/UX, CSS isteklerinde bu skill'i kullan; kullanıcı açıkça istemese bile önce bunu oku, sonra değiştir.
---

# Portfolyo tasarım dili

Bu site şablon gibi görünmesin diye bilinçli kararlarla kuruldu. Değişiklik yaparken bu kararları korumak, siteyi tutarlı ve "vay be" dedirten hâlinde tutar. Önce buradaki haritayı oku, sonra ilgili dosyanın ilgili bölümüne git.

## Fikir

- **Renk Çanakkale'nin canlı gökyüzünden gelir.** Tarayıcı güneşin Çanakkale'deki (40.1553°K, 26.4142°D) konumunu hesaplar; zemin, vurgu rengi ve soyadının harflerinin içindeki gökyüzü buna göre değişir. Ziyaretçi alttaki saat şeridiyle günü sürükleyebilir.
- **İş öne çıkar.** Canlı müşteri siteleri, TEKYAZ IT, ders araçları, GitHub depoları. Süs, kanıtın önüne geçmez.
- **İlke:** "Proje canlıya çıkana kadar bitmiş sayılmaz."
- **Kullanıcının zevki:** koyu tema, altın ve neon vurgular, glassmorphism, terminal/cmatrix estetiği. Kullanıcıya "Başkan" ya da Eyüp diye hitap edilir.

## Dosya haritası

Derleme adımı yok: düz HTML, CSS ve JavaScript; GitHub Pages yayınlar.

**index.html** (bölümler sırasıyla)
- `header.site-header` — `mix-blend-mode: difference` ile her zeminde okunan sabit üst bar; `›_ terminal` düğmesi (`data-terminal`).
- `section.hero#top` — dev isim (`.hero-name .fit`; soyadı `.sky-letters` = gökyüzü penceresi), `#sky-state`, dönen `.badge`, saat şeridi `#sky-dial` (`input#sky-time`).
- `.marquee` — gökyüzü renkli kayan teknoloji şeridi.
- `section#work` — `ul.work-list > li.work-row`; fareyle gelen önizleme kartları `#preview-strip` içindeki `.pv-*` öğeleri. Kartlar satırla **aynı sıradadır** (indeksle eşlenir): satır eklersen kartı da aynı sıraya ekle.
- `section#about` — `#statement` (kaydırdıkça kelime kelime yanar; `data-highlight` ile başlayan kelimeden sona kadar vurgu rengi), `.services`.
- `section#classroom` — `chen-atolyesi/`, `laravel-vize/`, `python-vize/`, `ntp-vize/` ve `mesleki-ingilizce/` alt sayfalarına bağlantılar.
- `section#repos` — `#repo-list` (JS yokken görünen statik yedek; JS, GitHub API'den günceller).
- `section#contact.sky-fill` — gökyüzü sahnesi + cam panel `.contact-panel` (sosyal linkler, mailto/Formspree formu, alt bilgi, hareket düğmesi).
- `dialog#terminal` — gizli Türkçe terminal (`/` tuşu, Ctrl+K).

**css/style.css** — Tokenlar → Üst bar → Hero → `.sky-fill` sahnesi → saat şeridi → marquee → bölümler → iş listesi → önizleme kartları → hakkımda → ders araçları → depolar → iletişim/cam panel → terminal → animasyon anahtar kareleri → hareket kapalı blokları → duyarlı (900px ve 640px kırılımları).

**js/main.js** — tek IIFE; en üstte `CONFIG` (e-posta, GitHub kullanıcı adı, LinkedIn, Formspree adresi, saat dilimi, koordinatlar). Başlatma sırası:
`initMotion` (hareket tercihi) → `initClock` → `initSky` (güneş konumu + palet → CSS değişkenleri, favicon, theme-color) → `initName` (isim harflerini kutuya oturtur, imlece göre `wdth` akordeonu) → `initRoundSun` → `initReveal` → `initStatement` → `initPreview` → `initMagnetic` → `initStatus` (müşteri sitelerine `no-cors` ölçüm) → `initTerminal` → `initContact` → `loadRepos`.

**Alt sayfalar** (`chen-atolyesi/`, `laravel-vize/`, `python-vize/`, `ntp-vize/`, `mesleki-ingilizce/`, `kalite-kontrol/`, `programlama-temelleri/`, `cpp-temelleri/`, `rehber-vize/`, `sinav-gunu/`, `spam/`, `veri-tabani/` (ve `veri-tabani/sql/`: açık temalı SQL pratiği), `PROJE/`) kendi stillerini taşır; istenmedikçe dokunma, ana sayfadan bağlantıları koru.

## Renk sistemi

- Bütün renkler CSS değişkenidir. `initSky()` güneşin yüksekliğine göre `:root`'a `--sky-top/mid/hor`, `--sun`, `--glow`, `--accent`, `--bg`, `--bg-raise`, `--sea`, `--stars` gibi değerleri yazar. CSS'teki `:root` değerleri JavaScript yokken kullanılan **gün batımı varsayılanıdır**.
- **Yeni bileşende sabit renk yazma.** `var(--accent)`, `var(--ink)`, `var(--muted)`, `var(--dim)`, `var(--line)`, `var(--bg-raise)` kullan; böylece bileşen günün her saatinde temaya uyar.
- **İki sabit renk vardır ve anlamları korunur:** `--gold` (#e6b443) markanın rengi ve birincil eylemdir ("EYÜP", "Mesaj yaz" düğmesi, rozet oku). `--live` (#4dff7c) yalnızca "canlı/çalışıyor" anlamında kullanılır (LED, ölçüm sonucu).
- Zemin her saatte koyu kalır (gökyüzü ortasının %12'si). Gökyüzü sahnesinin üstündeki yazıda `--ink-on-sky` kullan; JS onu parlaklığa göre seçer.
- Palet tabloları `palette()` içindedir (NIGHT, DAY, DUSK, DAWN). Profil README'sindeki başlık (`eyupcalskanozturk-tr` reposu, `scripts/sky-banner.mjs`) aynı tabloyu kullanır; birini değiştirirsen ikisini birlikte güncelle ki site ile profil aynı gökyüzünü göstersin.

## Tipografi

- **Archivo** (Google Fonts, değişken: `wdth` 62–125, `wght` 100–900). Başlıklar dar ve ağırdır: `font-variation-settings: "wdth" 62–85`, ağırlık 700–900. Gövde metni Archivo 400.
- **JetBrains Mono**: küçük etiketler, meta bilgi, terminal.
- Dev isim `initName()` tarafından genişliğe oturtulur ve harf harf `.ch` span'lerine bölünür. `<br class="name-break">` mobilde soyadını ikiye böler; bu yapıyı ve `.fit` sınıfını koru, yoksa akordeon ve gökyüzü penceresi bozulur.
- Türkçe büyük harfler (İ, I, Ş, Ğ, Ö, Ü, Ç) için metni HTML'de doğrudan büyük harfle yaz; sayfa `lang="tr"`.

## Bileşen tarifleri

- **Yeni iş satırı:** bir `li.work-row` kopyala (linkliyse `a.row-inner`, canlı siteyse `p.row-status.state[data-url]`); `#preview-strip`'e aynı sıraya bir `.pv-<ad>` kartı ekle ve CSS'te arka planını ver.
- **Yeni terminal komutu:** `initTerminal` içindeki `COMMANDS` nesnesine ekle, `yardim` listesine bir satır yaz, gerekirse `ALIASES`'a Türkçe/İngilizce kısaltma ekle. Çıktı için `print`, `printAll`, `printLink` kullan; `innerHTML` kullanma.
- **Yeni bölüm:** `section.section.wrap` + `.section-label` (küçük başlık + sağda mono açıklama). Okunurluk için en fazla ~42em satır genişliği.
- **Cam yüzey:** `.contact-panel` desenini kullan (yarı saydam koyu zemin + `backdrop-filter: blur(22px)` + ince açık kenarlık).

## Hareket

- Her animasyon hareket tercihine uyar: `motionPaused()` (sistemde "hareket azaltma" açık, kullanıcı "Hareketi durdur"a basmış ya da sekme gizli). CSS'te `.motion-paused` ve `@media (prefers-reduced-motion: reduce)` blokları var; yeni sürekli animasyonu bu iki bloğa da ekle.
- JS animasyonunda `requestAnimationFrame` kullan, ekranda değilken dur (`IntersectionObserver`) ve `motionchange` olayını dinle.
- Az ama anlamlı hareket. Arka plan partikülü, sürekli dönen dekor ya da kaydırmayı kaçıran efekt yok.

## Erişilebilirlik ve güvenlik

- **Ziyaret istatistiği:** Umami Cloud, çerezsiz. Her sayfanın `<head>`'inde `/assets/istatistik.js` var (kimlik orada, yalnız canlı alan adında yüklenir); ana sayfanın alt bilgisinde açıklama satırı (`.stat-note`), terminalde `istatistik` / `beni-sayma` / `beni-say`. Yeni sayfa eklerken bu satırı unutma.

- Skip link, landmark'lar, `aria-label`, `role="status"` alanları, `:focus-visible`, form etiketleri korunur. Terminal native `<dialog>`; Esc ile kapanır.
- Dış veriyi (GitHub API) `textContent` ile bas, linkleri `webURL()` ile doğrula, `target="_blank"` ise `rel="noopener noreferrer"` ekle.
- JavaScript kapalıyken site çalışmalı: statik repo listesi, form uyarısı ve gün batımı paleti bunun için var.

## İçerik ve ton

- Türkçe, samimi ama profesyonel, somut.
- **Bilgi uydurma.** Müşteri, sayı, tarih, özellik ve yanıt süresi gibi iddiaları yalnızca kullanıcının verdiği kaynaklardan al: profil README'si (`eyupcalskanozturk-tr` reposu) ya da kullanıcının kendi söyledikleri. Emin olmadığın bir cümleyi eklersen kullanıcıya açıkça işaretle.

## Kaçınılacak şablon kalıpları

Partikül canvas · eş boyutlu kart ızgarası · her başlıkta BÜYÜK HARF etiket ve "01/02" numarası · "Merhaba, ben X" daktilo efekti · genel mor-mavi gradyan · emoji yığını · stok ikon seti · ortalanmış tek sütun "hero + üç özellik kartı" düzeni. Bunlar siteyi tanıdık bir yapay zekâ şablonuna benzetir; bu sitenin kimliği gökyüzü, tipografi ve gerçek işlerdir.

## Değişiklikten sonra

1. `portfolyo-onizleme` skill'iyle masaüstü ve mobil ekran görüntüsü al, taşma ve hata kontrolünü geçir.
2. `portfolyo-yayin` skill'iyle dal, PR ve onaylı merge akışını izle.
