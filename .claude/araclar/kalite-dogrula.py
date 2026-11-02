#!/usr/bin/env python3
"""kalite-kontrol sayfasının verisini denetler (Konfeksiyonda Kalite Kontrol, vize çalışma).

Repo kökünden:
    python3 -I .claude/araclar/kalite-dogrula.py [--kaynak <sayfa-metinleri-klasörü>]

Sayfa kartları, soruları, listeleri ve sıralamaları <script type="application/json" id="veri"> bloğundan
çizer. Bu betik:
1. Yapıyı denetler: ünite numarası, boş alan, şık sayısı ve tekrar, doğru cevap, sayfa numarası.
2. --kaynak verilirse (kitap sayfalarının metni: s004.txt, s005.txt … biçiminde; repoda yok, çünkü kitap
   metninin tamamı yayımlanmaz) her kartın ve sorunun "k" kanıt ifadesinin kitabın o sayfasında
   (ya da sayfa geçişi için bir önceki/sonraki sayfasında) gerçekten geçtiğini arar.
Tutmayan bir şey varsa 1 ile çıkar.
"""
import argparse
import glob
import json
import os
import re
import sys

KOK = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SAYFA = os.path.join(KOK, "kalite-kontrol", "index.html")


def normal(s):
    s = s.replace("İ", "i").replace("I", "ı").lower().replace("̇", "")
    s = re.sub(r"[^\w]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sayfa", default=SAYFA)
    ap.add_argument("--kaynak", help="kitap sayfalarının metin klasörü (sNNN.txt)")
    args = ap.parse_args()

    with open(args.sayfa, encoding="utf-8") as f:
        html = f.read()
    m = re.search(r'<script type="application/json" id="veri">(.*?)</script>', html, re.S)
    if not m:
        sys.exit("id=\"veri\" bloğu yok")
    veri = json.loads(m.group(1))
    uniteler = {int(k) for k in veri["uniteler"]}
    sorun = []

    def kontrol(kosul, mesaj):
        if not kosul:
            sorun.append(mesaj)

    for i, k in enumerate(veri["kartlar"], 1):
        kontrol(k["u"] in uniteler, f"kart {i}: ünite {k['u']} yok")
        kontrol(k["o"].strip() and k["a"].strip(), f"kart {i}: boş yüz")
        kontrol(isinstance(k["p"], int) and k.get("k"), f"kart {i}: sayfa ya da kanıt eksik")
    onler = [k["o"] for k in veri["kartlar"]]
    for o in {x for x in onler if onler.count(x) > 1}:
        sorun.append(f"aynı ön yüzlü iki kart: {o}")

    for i, q in enumerate(veri["sorular"], 1):
        kontrol(q["u"] in uniteler, f"soru {i}: ünite {q['u']} yok")
        kontrol(q.get("a", "").strip(), f"soru {i}: açıklama yok")
        kontrol(isinstance(q["p"], int) and q.get("k"), f"soru {i}: sayfa ya da kanıt eksik")
        if q["t"] == "c":
            c = q["c"]
            kontrol(len(c) == 4 and len(set(map(str.strip, c))) == 4, f"soru {i}: dört farklı şık olmalı")
            kontrol(0 <= q["d"] < len(c), f"soru {i}: doğru şık indeksi hatalı")
        elif q["t"] == "dy":
            kontrol(isinstance(q["d"], bool), f"soru {i}: doğru/yanlış değeri bool olmalı")
        else:
            sorun.append(f"soru {i}: bilinmeyen tür {q['t']}")

    for i, l in enumerate(veri["listeler"], 1):
        kontrol(l["u"] in uniteler and len(l["m"]) >= 2, f"liste {i}: ünite ya da madde sayısı hatalı")
        kontrol(len(set(l["m"])) == len(l["m"]), f"liste {i}: tekrar eden madde")
    for s in veri["siralar"]:
        duz = [x for grup in s["m"] for x in grup]
        kontrol(len(duz) == len(set(duz)) and len(duz) >= 3, f"sıralama {s['id']}: tekrar ya da az madde")

    if args.kaynak:
        metin = {}
        for yol in glob.glob(os.path.join(args.kaynak, "s*.txt")):
            no = int(re.findall(r"\d+", os.path.basename(yol))[0])
            with open(yol, encoding="utf-8") as f:
                metin[no] = normal(f.read())
        def var(p, k):
            n = normal(k)
            return any(n in metin.get(x, "") for x in (p, p - 1, p + 1)) or \
                n in (metin.get(p - 1, "") + " " + metin.get(p, "")) or n in (metin.get(p, "") + " " + metin.get(p + 1, ""))
        for tur, liste in (("kart", veri["kartlar"]), ("soru", veri["sorular"])):
            for i, x in enumerate(liste, 1):
                if x["p"] not in metin:
                    sorun.append(f"{tur} {i}: s.{x['p']} kaynakta yok")
                elif not var(x["p"], x["k"]):
                    sorun.append(f"{tur} {i}: kanıt s.{x['p']}'de bulunamadı: {x['k']!r}")
        for i, l in enumerate(veri["listeler"], 1):
            kontrol(l["p"] in metin, f"liste {i}: s.{l['p']} kaynakta yok")
        print(f"kaynak: {len(metin)} sayfa metni")

    print(f"{len(veri['kartlar'])} kart, {len(veri['sorular'])} soru, {len(veri['listeler'])} liste, "
          f"{len(veri['siralar'])} sıralama · {len(sorun)} sorun")
    for s in sorun:
        print("  ✗", s)
    sys.exit(1 if sorun else 0)


if __name__ == "__main__":
    main()
