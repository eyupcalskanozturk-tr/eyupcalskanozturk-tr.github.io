#!/usr/bin/env python3
"""programlama-temelleri (C#) sayfasının çıktılarını, adım adım izlerini ve test cevaplarını gerçek .NET ile üretir.

Repo kökünden:
    python3 -I .claude/araclar/programlama-iz.py

1. programlama-temelleri/index.html içindeki <figure class="prog" data-prog="..."> bloklarının kodunu okur.
2. Bütün programları tek seferde Roslyn ile derler (.claude/araclar/programlama-cs/Derleyici.cs; .NET 8 SDK'nın
   kendi Microsoft.CodeAnalysis kitaplıkları). İzlenecek programların bir de izli kopyası derlenir: her deyimden
   önce __Iz.A, her if/for/while/do koşulunda __Iz.K çağrısı (satır, o ana kadarki çıktı, kapsamdaki değişkenler).
3. Programları AYAR'daki girdilerle Türkçe bölge ayarında (tr-TR: 2,5 · ₺) çalıştırır; girdi Visual Studio
   konsolundaki gibi çıktının arasına yerleşir. Sonucu id="izler" bloğuna yazar.
4. id="sorular" (test) ve id="derleme" (derlenir mi?) bloklarındaki kodları da derleyip
   çalıştırır, cevapları gerçek sonuçla karşılaştırır; derleyicinin gerçek mesajlarını (CS kodu, İngilizce ve
   Türkçe) id="derleme-cikti"ya yazar. Tutmayan varsa sayfaya yazmadan durur.

Gerekenler: .NET 8 SDK (dotnet). Sayfadaki bir kodu ya da soruyu değiştirdiğinde bu betiği yeniden çalıştır.
"""
import argparse
import concurrent.futures as cf
import glob
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

KOK = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SAYFA = os.path.join(KOK, "programlama-temelleri", "index.html")
CS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "programlama-cs")
ORTAM = dict(os.environ, DOTNET_CLI_TELEMETRY_OPTOUT="1", DOTNET_NOLOGO="1", DOTNET_SKIP_FIRST_TIME_EXPERIENCE="1")
ORTAM.pop("DOTNET_SYSTEM_GLOBALIZATION_INVARIANT", None)
MAX_ADIM = 300
# Linux'ta yakalanmamış istisna süreci abort ile bitirir (SIGABRT: -6 ya da 134). Windows'ta Visual Studio konsolu aynı durumu
# -532462766 (0xe0434352) koduyla gösterir; sayfa Windows'u canlandırdığı için o kod yazılır.
WIN_ISTISNA = -532462766

# Her program için: senaryolar (ad, girdi satırları), adım adım izlensin mi ("adim"), en çok kaç adım
# ("en_cok"). "derlenmez": kod bilerek hatalı, derleyici mesajı gösterilir. Senaryoda "adim": False o
# senaryoyu izlemez. "girdi_biter": girdi bilerek eksik (ReadLine null döner).
AYAR = {
    # 1. hafta
    "h1-merhaba": {},
    "h1-yazdir": {},
    "h1-girdi": {"senaryo": [{"ad": "Zeynep · Bilgisayar Programcılığı", "girdi": ["Zeynep", "Bilgisayar Programcılığı"]}]},
    "h1-toplam-alg": {"senaryo": [{"ad": "12 ve 30", "girdi": ["12", "30"]}, {"ad": "-7 ve 4", "girdi": ["-7", "4"]}]},
    # 2. hafta
    "h2-turler": {},
    "h2-sabit": {"senaryo": [{"ad": "5", "girdi": ["5"]}, {"ad": "2,5", "girdi": ["2,5"]}]},
    "h2-donusum": {},
    "h2-ondalik": {"senaryo": [{"ad": "2,5 (virgül)", "girdi": ["2,5"]}, {"ad": "2.5 (nokta)", "girdi": ["2.5"]},
                               {"ad": "iki buçuk", "girdi": ["iki buçuk"]}]},
    "h2-bicim": {},
    "h2-tasma": {},
    "h2-char": {},
    # 3. hafta
    "h3-aritmetik": {},
    "h3-atama": {},
    "h3-artis": {},
    "h3-karsilastirma": {},
    "h3-mantiksal": {},
    "h3-oncelik": {},
    "h3-math": {},
    "h3-saniye": {"senaryo": [{"ad": "3725", "girdi": ["3725"]}, {"ad": "86399", "girdi": ["86399"]}]},
    "h3-basamak": {"senaryo": [{"ad": "472", "girdi": ["472"]}, {"ad": "905", "girdi": ["905"]}]},
    "h3-sicaklik": {},
    # 4. hafta
    "h4-tekcift": {"senaryo": [{"ad": "14", "girdi": ["14"]}, {"ad": "7", "girdi": ["7"]}, {"ad": "-3", "girdi": ["-3"]}]},
    "h4-notharf": {"senaryo": [{"ad": "92", "girdi": ["92"]}, {"ad": "70", "girdi": ["70"]}, {"ad": "49", "girdi": ["49"]},
                               {"ad": "105", "girdi": ["105"]}]},
    "h4-enbuyuk": {"senaryo": [{"ad": "8, 21, 13", "girdi": ["8", "21", "13"]}, {"ad": "5, 5, 2", "girdi": ["5", "5", "2"]}]},
    "h4-artik": {"senaryo": [{"ad": "2024", "girdi": ["2024"]}, {"ad": "1900", "girdi": ["1900"]},
                             {"ad": "2000", "girdi": ["2000"]}, {"ad": "2026", "girdi": ["2026"]}]},
    "h4-gecme": {"senaryo": [{"ad": "40 · 70", "girdi": ["40", "70"]}, {"ad": "90 · 45", "girdi": ["90", "45"]},
                             {"ad": "30 · 50", "girdi": ["30", "50"]}]},
    "h4-icice": {"senaryo": [{"ad": "20 · 85", "girdi": ["20", "85"]}, {"ad": "20 · 55", "girdi": ["20", "55"]},
                             {"ad": "16 · 95", "girdi": ["16", "95"]}]},
    "h4-ternary": {},
    # 5. hafta
    "h5-gun": {"senaryo": [{"ad": "3", "girdi": ["3"]}, {"ad": "7", "girdi": ["7"]}, {"ad": "9", "girdi": ["9"]}]},
    "h5-mevsim": {"senaryo": [{"ad": "1", "girdi": ["1"]}, {"ad": "8", "girdi": ["8"]}, {"ad": "13", "girdi": ["13"]}]},
    "h5-hesap": {"senaryo": [{"ad": "7,5 * 4", "girdi": ["7,5", "*", "4"]}, {"ad": "10 / 4", "girdi": ["10", "/", "4"]},
                             {"ad": "10 / 0", "girdi": ["10", "/", "0"]}, {"ad": "3 % 2", "girdi": ["3", "%", "2"]}]},
    "h5-ifade": {},
    "h5-vki": {"senaryo": [{"ad": "68 kg · 1,75 m", "girdi": ["68", "1,75"]}, {"ad": "95 kg · 1,70 m", "girdi": ["95", "1,70"]},
                           {"ad": "1.75 yazarsa", "girdi": ["68", "1.75"]}]},
    "h5-dusme-hata": {"derlenmez": True},
    # 6. hafta
    "h6-for": {},
    "h6-adim": {},
    "h6-toplam": {"senaryo": [{"ad": "5", "girdi": ["5"]}, {"ad": "100", "girdi": ["100"], "adim": False}]},
    "h6-faktoriyel": {"senaryo": [{"ad": "5", "girdi": ["5"]}, {"ad": "20", "girdi": ["20"]}, {"ad": "0", "girdi": ["0"]}]},
    "h6-carpim": {"senaryo": [{"ad": "7", "girdi": ["7"]}]},
    "h6-us": {},
    "h6-notlar": {"senaryo": [{"ad": "4 öğrenci", "girdi": ["4", "70", "85", "40", "92"]},
                              {"ad": "1 öğrenci", "girdi": ["1", "55"]}]},
    # 7. hafta
    "h7-while": {},
    "h7-basamak": {"senaryo": [{"ad": "4096", "girdi": ["4096"]}, {"ad": "7", "girdi": ["7"]}]},
    "h7-ters": {"senaryo": [{"ad": "1234", "girdi": ["1234"]}, {"ad": "12321", "girdi": ["12321"]}]},
    "h7-ebob": {},
    "h7-faiz": {},
    "h7-nobetci": {"senaryo": [{"ad": "80, 65, 92", "girdi": ["80", "65", "92", "-1"]}, {"ad": "hemen -1", "girdi": ["-1"]}]},
    "h7-dowhile": {"senaryo": [{"ad": "15, 0, 7", "girdi": ["15", "0", "7"]}, {"ad": "4", "girdi": ["4"]}]},
    "h7-menu": {"senaryo": [{"ad": "örnek oturum", "girdi": ["1", "2", "250", "3", "2000", "3", "400", "1", "5", "0"]}]},
    # 8. hafta
    "h8-break": {},
    "h8-whiletrue": {"senaryo": [{"ad": "5, -3, 12, 0", "girdi": ["5", "-3", "12", "0"]}]},
    "h8-asal": {"senaryo": [{"ad": "97", "girdi": ["97"]}, {"ad": "91", "girdi": ["91"]}, {"ad": "1", "girdi": ["1"]}]},
    "h8-carpim": {},
    "h8-yildiz": {},
    "h8-asal-liste": {"adim": False},
    "h8-mukemmel": {"adim": False},
    "h8-fibonacci": {},
    "h8-tahmin": {"senaryo": [{"ad": "50 · 25 · 12 · …", "girdi": ["50", "25", "12", "18", "15", "16"]}]},
    "h8-sesli": {"senaryo": [{"ad": "Bilgisayar", "girdi": ["Bilgisayar"]}, {"ad": "IŞIK", "girdi": ["IŞIK"]}]},
}


FIG_RE = re.compile(r'<figure class="(prog[^"]*)" data-prog="([^"]+)"[^>]*>(.*?)</figure>', re.S)
PRE_RE = re.compile(r'<pre class="code"(?: data-dosya="([^"]+)")?[^>]*><code>(.*?)</code></pre>', re.S)
SARMAL = "using System;\n\nclass Program\n{\n    static void Main()\n    {\n%s\n    }\n}\n"


# ------------------------------------------------------------------------------------------- .NET bulma
def dotnet_bul():
    dn = shutil.which("dotnet")
    if not dn:
        sys.exit("dotnet bulunamadı (.NET 8 SDK gerekli)")
    r = subprocess.run([dn, "--list-sdks"], capture_output=True, text=True, env=ORTAM)
    sdkler = []
    for s in r.stdout.splitlines():
        m = re.match(r"^(8\.\d+\.\d+)\s+\[(.+)\]$", s.strip())
        if m:
            sdkler.append((tuple(int(x) for x in m.group(1).split(".")), os.path.join(m.group(2), m.group(1))))
    if not sdkler:
        sys.exit(".NET 8 SDK bulunamadı:\n" + r.stdout)
    sdk = max(sdkler)[1]
    kok = os.path.dirname(os.path.dirname(sdk))
    paketler = sorted(glob.glob(os.path.join(kok, "packs", "Microsoft.NETCore.App.Ref", "8.*", "ref", "net8.0")),
                      key=lambda p: [int(x) for x in p.split(os.sep)[-3].split(".") if x.isdigit()])
    if not paketler:
        sys.exit("Microsoft.NETCore.App.Ref 8.x bulunamadı")
    roslyn = os.path.join(sdk, "Roslyn", "bincore")
    if not os.path.isfile(os.path.join(roslyn, "csc.dll")):
        sys.exit("Roslyn (csc.dll) bulunamadı: " + roslyn)
    return dn, roslyn, paketler[-1]


def arac_derle(dn, roslyn, ref, hedef):
    """Derleyici.cs'i SDK'daki csc ile derler; Roslyn kitaplıklarını (Türkçe kaynaklarıyla) yanına kopyalar."""
    for ad in ("Microsoft.CodeAnalysis.dll", "Microsoft.CodeAnalysis.CSharp.dll"):
        shutil.copy(os.path.join(roslyn, ad), hedef)
    os.makedirs(os.path.join(hedef, "tr"), exist_ok=True)
    for p in glob.glob(os.path.join(roslyn, "tr", "Microsoft.CodeAnalysis*.resources.dll")):
        shutil.copy(p, os.path.join(hedef, "tr"))
    komut = [dn, "exec", os.path.join(roslyn, "csc.dll"), "-nologo", "-langversion:latest", "-nullable:disable",
             "-target:exe", "-out:" + os.path.join(hedef, "Derleyici.dll")]
    komut += ["-r:" + p for p in sorted(glob.glob(os.path.join(ref, "*.dll")))]
    komut += ["-r:" + os.path.join(hedef, "Microsoft.CodeAnalysis.dll"),
              "-r:" + os.path.join(hedef, "Microsoft.CodeAnalysis.CSharp.dll"), os.path.join(CS, "Derleyici.cs")]
    r = subprocess.run(komut, capture_output=True, text=True, env=ORTAM)
    if r.returncode:
        sys.exit("Derleyici.cs derlenemedi:\n" + r.stdout + r.stderr)
    with open(os.path.join(hedef, "Derleyici.runtimeconfig.json"), "w") as f:
        f.write('{"runtimeOptions":{"tfm":"net8.0","framework":{"name":"Microsoft.NETCore.App","version":"8.0.0"}}}')


def toplu_derle(dn, arac, ref, isler):
    """isler: [{"id", "kod", "izle"}] → {id: {"ok", "izli", "hatalar", "uyarilar", "dll"}}"""
    kaynak = os.path.join(arac, "kaynak")
    tanim = {"referanslar": ref, "yardimcilar": [os.path.join(CS, "Calistirici.cs")], "iz": os.path.join(CS, "Iz.cs"),
             "isler": []}
    for i, j in enumerate(isler):
        d = os.path.join(kaynak, str(i))
        os.makedirs(d, exist_ok=True)
        yol = os.path.join(d, "Program.cs")
        with open(yol, "w", encoding="utf-8", newline="\n") as f:
            f.write(j["kod"].rstrip("\n") + "\n")
        tanim["isler"].append({"id": j["id"], "dosyalar": [{"ad": "Program.cs", "yol": yol}], "izle": j.get("izle", False),
                               "cikti": os.path.join(d, "bin", "Program.dll")})
    yol = os.path.join(arac, "isler.json")
    with open(yol, "w", encoding="utf-8") as f:
        json.dump(tanim, f, ensure_ascii=False)
    r = subprocess.run([dn, os.path.join(arac, "Derleyici.dll"), yol], capture_output=True, text=True, env=ORTAM,
                       timeout=900)
    if r.returncode:
        sys.exit("Derleyici hata verdi:\n" + r.stdout[-2000:] + r.stderr[-4000:])
    if r.stderr.strip():
        print(r.stderr.rstrip())
    sonuc = {}
    for satir, j in zip(r.stdout.splitlines(), tanim["isler"]):
        x = json.loads(satir)
        x["hatalar"].sort(key=lambda h: (h["satir"], h["sutun"]))
        x["dll"] = j["cikti"]
        sonuc[x["id"]] = x
    if len(sonuc) != len(isler):
        sys.exit(f"Derleyici {len(isler)} işten {len(sonuc)} sonuç döndürdü")
    return sonuc


# ------------------------------------------------------------------------------------------- çalıştırma
def kos(dn, dll, girdi, iz_dosya=None, en_cok=MAX_ADIM, girdi_biter=False):
    ortam = dict(ORTAM)
    if not girdi_biter:
        ortam["GIRDI_BITTI_DUR"] = "1"
    if iz_dosya:
        ortam["IZ_DOSYA"] = iz_dosya
        ortam["IZ_EN_COK"] = str(en_cok)
    try:
        r = subprocess.run([dn, dll], input=girdi.encode("utf-8"), capture_output=True, env=ortam, timeout=60)
    except subprocess.TimeoutExpired:
        sys.exit(f"{dll}: program 60 saniyede bitmedi (girdi eksik ya da sonsuz döngü?)")
    return r.stdout.decode("utf-8"), r.stderr.decode("utf-8"), r.returncode


def istisna_temizle(err):
    """dotnet'in yakalanmamış istisna metnini Visual Studio konsolundaki gibi kısaltır: ilk satır (tür ve mesaj)
    ve kullanıcı kodundaki çerçeveler ("at Program.Main() in Program.cs:line 7"); .NET'in iç çerçeveleri atılır."""
    if not err:
        return ""
    satirlar = err.rstrip("\n").split("\n")
    kalan = [satirlar[0]]
    for s in satirlar[1:]:
        if re.match(r"^\s+at Program\.", s):
            kalan.append(re.sub(r" in .*?Program\.cs:line", " in Program.cs:line", s))
    return "\n".join(kalan) + "\n"


def cikis_kodu(x):
    return WIN_ISTISNA if x in (134, -6) else x


def parcala(out, err):
    """Çıktıyı [["o", metin], ["i", girdi], ["e", hata]] parçalarına ayırır; ham karakter → görünen karakter haritası."""
    par, harita = [], {0: 0}
    kar = 0
    tampon, girdi_mi = [], False

    def bosalt(tur):
        if tampon:
            s = "".join(tampon)
            if par and par[-1][0] == tur:
                par[-1][1] += s
            else:
                par.append([tur, s])
            tampon.clear()

    for ham, ch in enumerate(out, 1):
        if ch == "\x01":
            bosalt("o")
            girdi_mi = True
        elif ch == "\x02":
            bosalt("i")
            girdi_mi = False
        else:
            tampon.append(ch)
            kar += 1
        harita[ham] = kar
    bosalt("i" if girdi_mi else "o")
    if err:
        par.append(["e", err])
    return par, harita


def duz(par):
    return "".join(p[1] for p in par)


def iz_oku(yol):
    adimlar, kesildi = [], False
    if not os.path.exists(yol):
        return adimlar, kesildi
    with open(yol, encoding="utf-8") as f:
        for s in f:
            s = s.strip()
            if not s:
                continue
            a = json.loads(s)
            if a.get("kesildi"):
                kesildi = True
                continue
            adimlar.append(a)
    return adimlar, kesildi


def adimlari_kur(ham, harita, kod):
    """Ham iz satırlarını sayfa biçimine çevirir. if/while/for'un önündeki adım ile aynı satırdaki koşul adımı
    (arada çıktı yoksa) birleşir: Visual Studio o satırda bir kez durur."""
    adimlar = []
    for a in ham:
        yeni = {"l": a["l"], "o": harita.get(a["o"], 0), "v": a["v"]}
        if "k" in a:
            yeni["k"], yeni["r"] = a["k"], a["r"]
        onceki = adimlar[-1] if adimlar else None
        if onceki and "k" in yeni and "k" not in onceki and onceki["l"] == yeni["l"] and onceki["o"] == yeni["o"]:
            adimlar[-1] = yeni
            continue
        adimlar.append(yeni)
    return adimlar


def sikistir(adimlar):
    """Değişken adları ve türleri senaryoda bir kez yazılır ("cf": [[adlar], [türler]]), koşul metinleri de ("kt").
    Her adım: [satır, çıktı konumu, imza no, [değerler], koşul no (-1 yok), koşul sonucu (0/1)]."""
    imza, tablo, kosul, kt = {}, [], {}, []
    yeni = []
    for a in adimlar:
        anahtar = (tuple(v[0] for v in a["v"]), tuple(v[2] for v in a["v"]))
        if anahtar not in imza:
            imza[anahtar] = len(tablo)
            tablo.append([list(anahtar[0]), list(anahtar[1])])
        k = -1
        if "k" in a:
            if a["k"] not in kosul:
                kosul[a["k"]] = len(kt)
                kt.append(a["k"])
            k = kosul[a["k"]]
        satir = [a["l"], a["o"], imza[anahtar], [v[1] for v in a["v"]]]
        if k >= 0:
            satir += [k, 1 if a["r"] else 0]
        if a.get("n"):
            satir += [-1, 0, a["n"]] if k < 0 else [a["n"]]
        yeni.append(satir)
    return tablo, kt, yeni


def main_kapanis(kod):
    """Main'in kapanış süslü parantezinin satırı (son adım burada gösterilir)."""
    satirlar = kod.split("\n")
    for i, s in enumerate(satirlar):
        if re.search(r"\bstatic\s+void\s+Main\s*\(", s):
            girinti = len(s) - len(s.lstrip())
            for j in range(i + 1, len(satirlar)):
                t = satirlar[j]
                if t.strip() == "}" and len(t) - len(t.lstrip()) == girinti:
                    return j + 1
    return len(satirlar)


def calistir_program(dn, pid, prog, derlemeler):
    ayar = AYAR.get(pid, {})
    d = derlemeler[pid]
    if ayar.get("derlenmez"):
        if d["ok"]:
            sys.exit(f"{pid}: derlenmemesi gerekiyordu ama derlendi")
        return {"dosya": "Program.cs", "derleme": d["hatalar"]}
    if not d["ok"]:
        sys.exit(f"{pid}: derlenmedi\n" + "\n".join(f"{h['satir']}: {h['kod']} {h['mesaj']}" for h in d["hatalar"]))
    for u in d["uyarilar"]:
        print(f"  ! {pid}: uyarı {u['kod']} satır {u['satir']}: {u['mesaj']}")
    izli = derlemeler.get(pid + "#iz")
    kod = prog["kod"]
    senaryolar = []
    for sen in ayar.get("senaryo", [{"ad": ""}]):
        girdi = "".join(s + "\n" for s in sen.get("girdi", []))
        out, err, x = kos(dn, d["dll"], girdi, girdi_biter=sen.get("girdi_biter", False))
        if x == 97 and "\x03girdi bitti" in err:
            sys.exit(f"{pid} / {sen.get('ad')}: girdi yetmedi, senaryoya satır ekle\n{out}")
        err = istisna_temizle(err)
        par, harita = parcala(out, err)
        kayit = {"ad": sen.get("ad", ""), "t": par, "x": cikis_kodu(x)}
        if izli and sen.get("adim", True):
            if not izli["izli"]:
                sys.exit(f"{pid}: izli derlenemedi")
            iz_yolu = os.path.join(os.path.dirname(izli["dll"]), "iz-%d.jsonl" % len(senaryolar))
            en_cok = ayar.get("en_cok", MAX_ADIM)
            out2, err2, x2 = kos(dn, izli["dll"], girdi, iz_yolu, en_cok, sen.get("girdi_biter", False))
            err2 = istisna_temizle(err2)
            if (out2, err2, x2) != (out, err, x):
                sys.exit(f"{pid}: iz çalıştırması farklı çıktı verdi\n{out2!r}\n{out!r}\n{err2!r}\n{err!r}")
            ham, kesildi = iz_oku(iz_yolu)
            adimlar = adimlari_kur(ham, harita, kod)
            toplam = len(duz([p for p in par if p[0] != "e"]))
            son_v = adimlar[-1]["v"] if adimlar else []
            if err:
                m = re.search(r"Program\.cs:line (\d+)", err)
                son = {"l": int(m.group(1)) if m else (adimlar[-1]["l"] if adimlar else 0), "o": toplam + len(err),
                       "v": son_v, "n": "Yakalanmamış istisna: program bu satırda durdu."}
            else:
                son = {"l": main_kapanis(kod), "o": toplam, "v": son_v,
                       "n": (f"İz {en_cok} adımda kesildi; program sonuna kadar çalıştı, çıktı tam."
                             if kesildi else "Main bitti, program sona erdi.")}
            # Main'in sonundaki adım (kapanış parantezi) varsa son adımla birleşir
            if adimlar and adimlar[-1]["l"] == son["l"] and adimlar[-1]["o"] == son["o"] and "k" not in adimlar[-1]:
                adimlar[-1]["n"] = son["n"]
            else:
                adimlar.append(son)
            kayit["cf"], kayit["kt"], kayit["a"] = sikistir(adimlar)
        senaryolar.append(kayit)
    return {"s": senaryolar}


# ------------------------------------------------------------------------------------------- sorular
def tam_kod(k):
    """Parça kodu klasik Main şablonunun içine sarar; tam program ise olduğu gibi bırakır."""
    if re.search(r"\bclass\s+\w+", k) or re.search(r"static\s+void\s+Main", k):
        return k
    return SARMAL % "\n".join(("        " + s) if s.strip() else "" for s in k.split("\n"))


def dene(dn, d, girdi=()):
    """("derleme", ilk hata) ya da ("calisti", çıktı, hata, çıkış kodu)."""
    if not d["ok"]:
        return ("derleme", d["hatalar"][0])
    out, err, x = kos(dn, d["dll"], "".join(s + "\n" for s in girdi))
    yalin = re.sub("\x01[^\x02]*\x02\n", "", out)  # yankılanan girdi satırları karşılaştırılmaz
    return ("calisti", yalin, istisna_temizle(err), cikis_kodu(x))


def istisna_adi(err):
    m = re.search(r"Unhandled exception\. ([\w.]+)(?::\s*(.*))?", err)
    if not m:
        return None, None
    return m.group(1).split(".")[-1], (m.group(2) or "").strip()


def soru_isleri(sorular, onek):
    isler = []
    for no, q in enumerate(sorular, 1):
        if "k" in q or "kk" in q:
            isler.append({"id": f"{onek}{no}", "kod": tam_kod(q.get("kk") or q["k"])})
    return isler


def soru_kontrol(dn, sorular, programlar, derlemeler, onek, ad):
    """Kodlu soruları çalıştırır. "k" gösterilen kod, "kk" gösterilmeyen kontrol kodu, "p" sayfadaki program.
    Beklenti: "derleme" CS kodu ya da mesaj parçası · "e" istisna adı · yoksa doğru şık çıktıyla birebir
    ("kip": "son"/"ilk" son ya da ilk satırla)."""
    sorun = 0
    isler = []
    for no, q in enumerate(sorular, 1):
        c, d = q["c"], q["d"]
        if not (0 <= d < len(c)) or len(set(c)) != len(c):
            print(f"  ✗ {ad} {no}: şıklar ya da doğru indeks hatalı")
            sorun += 1
            continue
        if "k" in q or "kk" in q or "p" in q:
            isler.append((no, q))

    def tek(is_):
        no, q = is_
        if q.get("p"):
            return no, q, None
        return no, q, dene(dn, derlemeler[f"{onek}{no}"], q.get("g", []))

    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        sonuclar = list(ex.map(tek, isler))
    for no, q, r in sonuclar:
        c, d = q["c"], q["d"]
        if r is None:
            sen = programlar[q["p"]]["s"][q.get("sen", 0)]
            r = ("calisti", "".join(p[1] for p in sen["t"] if p[0] == "o"),
                 "".join(p[1] for p in sen["t"] if p[0] == "e"), sen["x"])
        if "derleme" in q:
            tamam = r[0] == "derleme" and (q["derleme"] == r[1]["kod"] or q["derleme"] in r[1]["mesaj"])
            gercek = f"{r[1]['kod']} {r[1]['mesaj']}" if r[0] == "derleme" else "derlendi"
        elif r[0] == "derleme":
            tamam, gercek = False, f"DERLENMEDİ: {r[1]['kod']} {r[1]['mesaj']}"
        elif "e" in q:
            adi, _ = istisna_adi(r[2])
            tamam = r[3] != 0 and adi == q["e"]
            gercek = f"{adi} (çıkış {r[3]})"
        else:
            satirlar = [x.rstrip() for x in r[1].rstrip("\n").split("\n")]
            kip = q.get("kip", "tam")
            gercek = satirlar[-1] if kip == "son" else satirlar[0] if kip == "ilk" else "\n".join(satirlar)
            beklenen = q.get("beklenen", c[d])
            tamam = r[3] == 0 and gercek == beklenen and ("beklenen" in q or c.count(gercek) == 1)
        if not tamam:
            print(f"  ✗ {ad} {no} ({q.get('s', '')[:50]}…): gerçek {gercek!r}")
            sorun += 1
    return sorun


def yaz_kontrol(gorevler, izler):
    """Çıktıyı yaz figürleri (class="prog yaz"): beklenen çıktı programın gerçek çıktısıdır; burada yalnız
    programın girdisiz ve hatasız çalıştığı denetlenir."""
    sorun = 0
    for pid in gorevler:
        iz = izler.get(pid)
        if not iz or "s" not in iz:
            print(f"  ✗ yaz {pid}: çalışmadı")
            sorun += 1
            continue
        s = iz["s"][0]
        if s["x"] != 0 or any(p[0] != "o" for p in s["t"]):
            print(f"  ✗ yaz {pid}: girdisiz ve hatasız çalışmalı")
            sorun += 1
    return sorun


def derleme_kontrol(dn, kartlar, derlemeler):
    """Derlenir mi? kartları: "b" beklenen sonuç (derlenmez / coker / calisir), "m" CS kodu ya da mesajdan parça."""
    sorun = 0
    cikti = []

    def tek(no):
        return dene(dn, derlemeler[f"d{no}"], kartlar[no - 1].get("g", []))

    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        sonuclar = list(ex.map(tek, range(1, len(kartlar) + 1)))
    for no, (kart, r) in enumerate(zip(kartlar, sonuclar), 1):
        if r[0] == "derleme":
            h = r[1]
            kayit = {"b": "derlenmez", "kod": h["kod"], "s": h["satir"] - kaydirma(kart["k"]), "m": h["mesaj"],
                     "mt": h["mesaj_tr"]}
            tamam = kart["b"] == "derlenmez" and kart.get("m", "") in (h["kod"] + " " + h["mesaj"])
        elif r[3] != 0:
            kay = kaydirma(kart["k"])
            msj = re.sub(r"Program\.cs:line (\d+)", lambda m: f"Program.cs:line {int(m.group(1)) - kay}", r[2].rstrip("\n"))
            kayit = {"b": "coker", "o": r[1], "m": msj, "x": r[3]}
            tamam = kart["b"] == "coker" and kart.get("m", "") in r[2]
        else:
            kayit = {"b": "calisir", "o": r[1]}
            tamam = kart["b"] == "calisir" and kart.get("m", "") in r[1]
        if not tamam:
            print(f"  ✗ derleme {no}: beklenen {kart['b']} / {kart.get('m')!r}, gerçek {kayit}")
            sorun += 1
        cikti.append(kayit)
    return sorun, cikti


def kaydirma(k):
    """Parça kod şablona sarılınca satır numarası 6 kayar; kartta gösterilen satır parçanınkidir."""
    return 0 if tam_kod(k) == k else 6


# ------------------------------------------------------------------------------------------- sayfa
def blok_yaz(sayfa, kimlik, veri):
    m = re.search(r'(<script type="application/json" id="%s">)(.*?)(</script>)' % kimlik, sayfa, re.S)
    if not m:
        sys.exit(f"{kimlik} bloğu yok")
    metin = json.dumps(veri, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    return sayfa[:m.start(2)] + metin + sayfa[m.end(2):], len(metin.encode("utf-8"))


def blok_oku(sayfa, kimlik, yedek):
    m = re.search(r'<script type="application/json" id="%s">(.*?)</script>' % kimlik, sayfa, re.S)
    return json.loads(m.group(1)) if m and m.group(1).strip() else yedek


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sayfa", default=SAYFA)
    ap.add_argument("--kuru", action="store_true", help="sayfaya yazma, yalnız kontrol et")
    ap.add_argument("--yalniz", help="yalnız bu program(lar)ı çalıştır (virgülle), diğer izleri koru")
    args = ap.parse_args()

    with open(args.sayfa, encoding="utf-8") as f:
        sayfa = f.read()

    programlar = {}
    for m in FIG_RE.finditer(sayfa):
        pid = m.group(2)
        if pid in programlar:
            sys.exit(f"{pid}: aynı id iki kez kullanılmış")
        kodlar = [html.unescape(k).rstrip("\n") for _, k in PRE_RE.findall(m.group(3))]
        if len(kodlar) != 1:
            sys.exit(f'{pid}: tek bir <pre class="code"><code> bloğu olmalı')
        programlar[pid] = {"kod": kodlar[0], "sinif": m.group(1).split()}
    sorular = blok_oku(sayfa, "sorular", [])
    kartlar = blok_oku(sayfa, "derleme", [])
    gorevler = [pid for pid, p in programlar.items() if "yaz" in p["sinif"]]

    dn, roslyn, ref = dotnet_bul()
    arac = tempfile.mkdtemp(prefix="cs-arac-")
    try:
        arac_derle(dn, roslyn, ref, arac)
        isler = []
        secili = set(args.yalniz.split(",")) if args.yalniz else None
        eski = blok_oku(sayfa, "izler", {})
        for pid, p in programlar.items():
            if secili is not None and pid not in secili:
                continue
            ayar = AYAR.get(pid, {})
            isler.append({"id": pid, "kod": p["kod"]})
            if not ayar.get("derlenmez") and ayar.get("adim", True):
                isler.append({"id": pid + "#iz", "kod": p["kod"], "izle": True})
        isler += soru_isleri(sorular, "s")
        isler += [{"id": f"d{no}", "kod": tam_kod(k["k"])} for no, k in enumerate(kartlar, 1)]
        derlemeler = toplu_derle(dn, arac, ref, isler)

        izler = {}

        def tek(pid):
            if secili is not None and pid not in secili:
                return pid, eski.get(pid)
            return pid, calistir_program(dn, pid, programlar[pid], derlemeler)

        with cf.ThreadPoolExecutor(max_workers=6) as ex:
            for pid, iz in ex.map(tek, list(programlar)):
                if iz is None:
                    continue
                izler[pid] = iz
                if secili is not None and pid not in secili:
                    continue
                if "derleme" in iz:
                    h = iz["derleme"][0]
                    print(f"  ✓ {pid:16} derlenmedi (beklenen) · {h['kod']} {h['mesaj'][:56]}")
                    continue
                for s in iz["s"]:
                    adim = len(s.get("a", []))
                    metin = duz(s["t"]).replace("\n", "⏎")
                    print(f"  ✓ {pid:16} {s['ad'][:14]:14} çıkış {s['x']} · {adim:3} adım · {metin[:60]}")
        for pid in AYAR:
            if pid not in programlar:
                print(f"  ! {pid}: AYAR'da var ama sayfada yok")
        for pid in programlar:
            if pid not in AYAR and "yaz" not in programlar[pid]["sinif"]:
                print(f"  ! {pid}: AYAR'da yok, girdisiz çalıştırıldı")

        sorun = soru_kontrol(dn, sorular, izler, derlemeler, "s", "soru")
        sorun += yaz_kontrol(gorevler, izler)
        s2, derleme_cikti = derleme_kontrol(dn, kartlar, derlemeler)
        sorun += s2
    finally:
        shutil.rmtree(arac, ignore_errors=True)

    print(f"\n{len(izler)} program, {len(sorular)} test sorusu, {len(gorevler)} çıktıyı yaz, "
          f"{len(kartlar)} derlenir mi kartı, {sorun} sorun")
    if sorun:
        sys.exit(1)
    sayfa, n1 = blok_yaz(sayfa, "izler", izler)
    if kartlar:
        sayfa, _ = blok_yaz(sayfa, "derleme-cikti", derleme_cikti)
    if args.kuru:
        print(f"kuru çalıştırma: izler {n1 // 1024} KB olurdu")
        return
    with open(args.sayfa, "w", encoding="utf-8") as f:
        f.write(sayfa)
    print(f"izler yazıldı: {n1 // 1024} KB")


if __name__ == "__main__":
    main()
