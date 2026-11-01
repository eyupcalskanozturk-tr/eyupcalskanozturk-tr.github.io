---
name: portfolyo-yayin
description: Portfolyo sitesini (eyupcalskanozturk-tr.github.io) güvenle yayına alma akışı — güncel main'den dal açma, commit kuralları, PR, kullanıcı onayıyla merge, GitHub Pages workflow'unun takibi ve yeni dosya/klasörlerin deploy.yml'e eklenmesi. Bu repoda commit, push, PR, merge, "yayına al", "canlıya çık", "deploy", "siteye yükle", "neden sitede görünmüyor" gibi her işte ve yeni bir sayfa, klasör ya da kök dosya (robots.txt, sitemap.xml vb.) eklendiğinde kullan.
---

# Portfolyo yayın akışı

`main` dalı canlı sitedir: her push, GitHub Pages workflow'unu (`.github/workflows/deploy.yml`) tetikler ve site birkaç dakika içinde değişir. Bu yüzden `main`'e doğrudan push yapılmaz; her iş bir dalda yapılır, PR'la gösterilir ve kullanıcı onaylayınca merge edilir.

## Adımlar

1. **Güncel main'den dal aç.**
   ```bash
   git fetch origin main && git checkout -B <kisa-dal-adi> origin/main
   ```
   Önceki dalın PR'ı merge edildiyse eski dala commit yığma; yeni işe her zaman güncel main'den başla.

2. **Değiştir ve doğrula.** Tasarım kuralları `portfolyo-tasarim-dili` skill'inde, doğrulama `portfolyo-onizleme` skill'inde. Önizleme temiz değilse PR açma.

3. **Commit at.**
   - Git kimliğini (`user.name` / `user.email`) ezme. Ortamın kendi imzalı kimliği, commit'lerin GitHub'da "Verified" görünmesini sağlar. `-c user.email=...` gibi geçersiz kılmalar "Unverified" etiketine yol açar.
   - Mesaj Türkçe olsun: emir kipinde kısa bir başlık, altında maddeler.
   - Kullanıcı işin gerçek ortağıdır (fikir, yön, onay ondan). Onu ortak yazar olarak ekle; bu, GitHub'daki "Pair Extraordinaire" başarımına da sayılır:
     ```
     Co-authored-by: Eyüp Çalışkanöztürk <239019993+eyupcalskanozturk-tr@users.noreply.github.com>
     ```
     GitHub'ın gizli e-posta adresini kullan, kişisel e-postayı commit'e yazma. Ortamın istediği başka atıf satırları varsa onları da ekle.

4. **Push ve PR.**
   ```bash
   git push -u origin <dal>
   gh api repos/eyupcalskanozturk-tr/eyupcalskanozturk-tr.github.io/pulls \
     -f base=main -f head=<dal> -f title="<başlık>" -F body=@<pr-govdesi.md>
   ```
   Bulut oturumunda `gh pr create` GraphQL kullandığı için engellenebilir; REST (`gh api`) çalışır. PR gövdesi Türkçe: **Özet** (ne değişti, neden) ve **Test** (önizleme sonucu, ekran görüntüleri). Uydurma test sonucu yazma; çalıştırmadığın şeyi "test edildi" diye geçme.

5. **Onay al, sonra merge et.** Ekran görüntülerini kullanıcıya göster ve merge için açıkça sor. Onay gelince:
   ```bash
   gh api -X PUT repos/eyupcalskanozturk-tr/eyupcalskanozturk-tr.github.io/pulls/<no>/merge -f merge_method=merge
   ```

6. **Yayını izle.** `actions/runs?head_sha=<merge-sha>` ile "GitHub Pages yayınlama" çalışmasının `completed/success` olduğunu doğrula. Kullanıcıya eski sürümü görürse Ctrl+Shift+R yapmasını ya da gizli sekmede açmasını söyle.

## Yayın workflow'u tuzağı

`deploy.yml`, sitenin tamamını değil **yalnızca şu yolları** `_site`'a kopyalar: `index.html`, `css/`, `js/`, `assets/`, `PROJE/`, `chen-atolyesi/`, `laravel-vize/`, `python-vize/`.

- Yeni bir alt sayfa klasörü (örneğin `blog/`) ya da kökte yeni bir dosya (`robots.txt`, `sitemap.xml`, `404.html`, `manifest.webmanifest`, ek favicon'lar) eklediğinde onu "Statik dosyaları hazırla" adımına ekle; yoksa yerelde çalışır ama canlıda 404 verir.
- `.claude/` (bu skill'ler) ve `CLAUDE.md` bilerek yayınlanmaz.

## Bağlantılı repo: GitHub profili

Profil README'si (`eyupcalskanozturk-tr/eyupcalskanozturk-tr`) siteye `#work` ve `#about` gibi çapalarla bağlanır. Bölüm id'lerini değiştirirsen profildeki linkleri de güncelle. Sitedeki terminalin `oyna` komutu da profildeki Dörtlü oyununa gider.

## Tek dallı klon notu

Bulut oturumundaki klonlar genelde tek dallı ve sığdır (`--depth 1`). Merge sonrası bir kontrol "dalın uzak karşılığı yok" ya da "push edilmemiş commit var" derse, önce gerçekten push edilip merge edildiğini doğrula; sonra uzak referansı yenile. Merge edilmiş geçmişi yeniden yazma.

```bash
git fetch origin <dal>:refs/remotes/origin/<dal>
git config branch.<dal>.remote origin && git config branch.<dal>.merge refs/heads/<dal>
```
