#!/usr/bin/env python3
"""mesleki-ingilizce sayfasının verisini doğrular.

Repo kökünden:
    python3 -I .claude/araclar/ingilizce-dogrula.py [--kaynak sunum-metni.txt]

Sayfadaki <script type="application/json" id="veri"> bloğunu okur ve şunları kontrol eder:
  - okuma metnindeki her İngilizce cümle (ek işaretli olanlar hariç) sunum metninde birebir geçiyor mu
    (--kaynak verilirse; sunum metni repoda tutulmaz),
  - "What is ...?" cevapları, boşluk doldurma cümleleri ve tanımlar okuma metninden mi alınmış,
  - her sorunun doğru cevabı şıklarda bir kez mi var, şıklar birbirinden farklı mı,
  - sözlükteki terimler metinde geçiyor mu (geçmeyenler uyarı olarak listelenir).
Bir hata varsa 1 ile çıkar; sayfaya yazmaz.
"""
import argparse
import html
import json
import os
import re
import sys

KOK = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SAYFA = os.path.join(KOK, "mesleki-ingilizce", "index.html")


def norm(s):
    s = html.unescape(s).replace("’", "'").replace("‘", "'").lower()
    return re.sub(r"\s+", " ", s).strip()


def kirp(s):
    return norm(s).rstrip(".")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sayfa", default=SAYFA)
    ap.add_argument("--kaynak", help="sunumlardan çıkarılmış düz metin (repoda yok)")
    a = ap.parse_args()

    sayfa = open(a.sayfa, encoding="utf-8").read()
    m = re.search(r'<script type="application/json" id="veri">(.*?)</script>', sayfa, re.S)
    if not m:
        sys.exit("veri bloğu bulunamadı")
    v = json.loads(m.group(1))
    hata, uyari = [], []

    cumleler, idler = [], set()
    for h in v["haftalar"]:
        for b in h["bolumler"]:
            if b["id"] in idler:
                hata.append(f"bölüm id tekrar: {b['id']}")
            idler.add(b["id"])
            for p in b["p"]:
                for c in (p if isinstance(p, list) else p["c"]):
                    if not c[1].strip():
                        hata.append(f"Türkçesi boş: {c[0][:50]}")
                    if len(c) < 3 or not c[2]:
                        cumleler.append(c[0])
    metin = " ".join(norm(c) for c in cumleler)

    if a.kaynak:
        kaynak = norm(open(a.kaynak, encoding="utf-8").read())
        for c in cumleler:
            if kirp(c) not in kaynak:
                hata.append(f"sunumda yok: {c[:70]}")

    for s in v["sorular"]:
        if kirp(s[3]) not in metin:
            hata.append(f"cevap metinde yok: {s[1]}")

    def siklar(ad, dogru, yanlis):
        tum = [dogru] + list(yanlis)
        if len(tum) != 4 or len({x.lower() for x in tum}) != 4:
            hata.append(f"{ad}: şıklar 4 farklı değer değil: {tum}")

    for b in v["bosluk"]:
        if b[1].count("____") != 1:
            hata.append(f"boşluk işareti yok ya da birden fazla: {b[1][:50]}")
        elif kirp(b[1].replace("____", b[2])) not in metin:
            hata.append(f"boşluk cümlesi metinde yok: {b[1][:60]} → {b[2]}")
        siklar("boşluk " + b[2], b[2], b[3])

    for t in v["tanim"]:
        if kirp(t[1]) not in metin:
            hata.append(f"tanım metinde yok: {t[1][:60]}")
        siklar("tanım " + t[2], t[2], t[3])

    for d in v["dy"]:
        if not isinstance(d[3], bool):
            hata.append(f"doğru/yanlış değeri bool değil: {d[1][:50]}")

    gorulen = set()
    for t in v["sozluk"]:
        anahtar = t[0].lower()
        if anahtar in gorulen:
            hata.append(f"sözlükte tekrar: {t[0]}")
        gorulen.add(anahtar)
        adaylar = [x for x in t[4].split("|") if x] + [re.sub(r"\s*\(.*?\)", "", t[0])]
        if not any(re.search(r"(?<![\w-])" + re.escape(x.lower()) + r"(?![\w-])", metin) for x in adaylar):
            uyari.append(t[0])

    say = (f"{len(cumleler)} cümle, {len(v['sozluk'])} terim, {len(v['kaliplar'])} kalıp, "
           f"{len(v['sorular'])} soru-cevap, {len(v['bosluk'])} boşluk, {len(v['dy'])} doğru-yanlış, {len(v['tanim'])} tanım")
    print(say)
    if uyari:
        print(f"uyarı: metinde geçmeyen terimler ({len(uyari)}): " + ", ".join(uyari))
    for h in hata:
        print("✗", h)
    print("sorun yok" if not hata else f"{len(hata)} sorun")
    sys.exit(1 if hata else 0)


if __name__ == "__main__":
    main()
