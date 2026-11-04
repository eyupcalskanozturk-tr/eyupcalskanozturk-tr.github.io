# Eyüp'ün portfolyosu — proje hafızası

Eyüp Çalışkanöztürk'ün kişisel sitesi: https://eyupcalskanozturk-tr.github.io (GitHub Pages). Türkçe; derleme adımı yok, düz HTML/CSS/JavaScript (`index.html`, `css/style.css`, `js/main.js`, `assets/`). Alt sayfalar: `chen-atolyesi/`, `laravel-vize/`, `python-vize/`, `ntp-vize/`, `mesleki-ingilizce/`, `kalite-kontrol/`, `programlama-temelleri/`, `cpp-temelleri/`, `PROJE/`.

Kullanıcıya "Başkan" ya da Eyüp diye hitap et. Koyu tema, altın ve neon vurgular, glassmorphism ve terminal estetiğini sever.

## Bu repodaki skill'ler

- `portfolyo-tasarim-dili` — tasarım dili ve kod haritası. Siteye dokunan her işten önce oku.
- `portfolyo-onizleme` — değişiklikten sonra ekran görüntüsü ve otomatik kontroller (`.claude/skills/portfolyo-onizleme/scripts/shoot.cjs`).
- `portfolyo-yayin` — dal, PR, onaylı merge ve Pages yayını; `deploy.yml` kopyalama listesi tuzağı.

## Araçlar

- `python-vize/` sayfasındaki çıktılar, adım adım izler ve test cevapları elle yazılmaz: `.claude/araclar/python-vize-iz.py` sayfadaki kodları gerçek Python'da çalıştırıp `id="izler"` bloğuna yazar; testteki (`id="sorular"`) ve 50 soruluk deneme sınavındaki (`id="deneme"`) kodlu soruların doğru şıkkını da çalıştırarak doğrular. Sayfada bir kodu ya da soruyu değiştirince `python3 -I .claude/araclar/python-vize-iz.py --vt <vt.db>` ile yeniden üret. `vt.db` repoda yok (kişisel veri içerebilir); verilmezse veritabanı programlarının eski izleri korunur.
- `ntp-vize/` (Java) sayfasındaki çıktılar, adım adım izler (çağrı yığını, nesneler, diziler) ve soruların cevapları da elle yazılmaz: `python3 -I .claude/araclar/ntp-vize-iz.py` sayfadaki programları `javac -g` ile derler, `Kosucu` ile girdili çalıştırır, `Izci` (JDI) ile satır satır izler ve `id="izler"` bloğuna yazar; testteki (`id="sorular"`) kodlu sorular ile derlenir mi kartlarını (`id="derleme"`) gerçek javac/java sonucuyla doğrular. Yardımcı Java sınıfları `.claude/araclar/ntp-java/`'da; senaryolar aracın `AYAR` sözlüğünde. Sayfada bir kodu ya da soruyu değiştirince aracı yeniden çalıştır (JDK 21 gerekir).
- `mesleki-ingilizce/` sayfası metinleri, sözlüğü ve soruları `id="veri"` bloğundan çizer. Veriyi değiştirince `python3 -I .claude/araclar/ingilizce-dogrula.py` çalıştır: soru-cevaplar, boşluk doldurma ve tanımlar okuma metniyle karşılaştırılır; `--kaynak <sunum-metni.txt>` verilirse her cümle sunumla da karşılaştırılır (sunum metni repoda yok).
- `kalite-kontrol/` (Konfeksiyonda Kalite Kontrol) sayfası kartları, soruları, listeleri ve sıralamaları `id="veri"` bloğundan çizer. Veriyi değiştirince `python3 -I .claude/araclar/kalite-dogrula.py` çalıştır; `--kaynak <sayfa-metinleri-klasörü>` verilirse her kartın ve sorunun kanıt ifadesi kitabın ilgili sayfasında aranır (kitap metni telif nedeniyle repoda yok).
- `programlama-temelleri/` (C#, 8 hafta) sayfasındaki çıktılar, adım adım izler (Visual Studio Locals görünümü), test cevapları ve derlenir mi kartlarının derleyici mesajları elle yazılmaz: `python3 -I .claude/araclar/programlama-iz.py` sayfadaki programları .NET 8 SDK'nın Roslyn'iyle tek seferde derler (`.claude/araclar/programlama-cs/Derleyici.cs` her deyimin önüne ve her koşula izleme çağrısı ekler), tr-TR kültüründe girdili çalıştırır ve `id="izler"` ile `id="derleme-cikti"` bloklarına yazar; testteki (`id="sorular"`) kodlu soruları ve kartları (`id="derleme"`) gerçek sonuçla doğrular. Senaryolar aracın `AYAR` sözlüğünde. Sayfada bir kodu ya da soruyu değiştirince aracı yeniden çalıştır (.NET 8 SDK gerekir).
- `cpp-temelleri/` (C++, aynı 8 hafta) sayfası da aynı düzende: `python3 -I .claude/araclar/cpp-iz.py` programları g++ ile derler (`-std=c++14`), clang'ın JSON AST'sinden yararlanarak her deyime ve koşula izleme çağrısı ekler (`.claude/araclar/cpp/`: `iz.hpp`, `iz.cpp`, `calistirici.cpp`; değer almamış değişken izde `?`), girdili çalıştırır ve `id="izler"`, `id="derleme-cikti"` bloklarını yazar; test (`id="sorular"`) ve kartları (`id="derleme"`) g++'ın gerçek hata/uyarı mesajlarıyla doğrular. Çökmeler Windows dönüş değeriyle yazılır (0xC0000094, abort 3). Konsolun son satırları sayfadaki IDE seçimine (Dev-C++, Code::Blocks, Visual Studio) göre değişir. Gerekenler: g++ ve clang++.

## Değişmez kurallar

- `main` canlı sitedir: doğrudan push yok; dal + PR + kullanıcı onayıyla merge.
- Bilgi uydurma: müşteri, sayı ve özellik iddialarını yalnızca kullanıcının verdiği kaynaklardan al.
- Erişilebilirlik ve hareket azaltma desteğini koru; yeni animasyonlar `motionPaused()` ve `.motion-paused` kurallarına uyar.
- Kökte yeni dosya ya da yeni klasör eklersen `.github/workflows/deploy.yml` kopyalama adımına da ekle.
- Ziyaretçi istatistiği Umami Cloud ile tutulur (çerezsiz, anonim). Kimlik tek yerde: `assets/istatistik.js` içindeki `UMAMI_ID`; betik yalnız canlı alan adında yüklenir. Yeni bir HTML sayfası eklersen `<head>`'ine `<script src="/assets/istatistik.js" defer></script>` satırını da ekle. Sitenin terminalinde `istatistik`, `beni-sayma`, `beni-say` komutları var (bir tarayıcıyı sayımın dışında bırakır).
