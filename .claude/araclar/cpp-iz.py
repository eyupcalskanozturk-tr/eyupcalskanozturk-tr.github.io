#!/usr/bin/env python3
"""cpp-temelleri (C++) sayfasının çıktılarını, adım adım izlerini ve test cevaplarını gerçek g++ ile üretir.

Repo kökünden:
    python3 -I .claude/araclar/cpp-iz.py

1. cpp-temelleri/index.html içindeki <figure class="prog" data-prog="..."> bloklarının kodunu okur.
2. Her programı g++ ile derler (-std=c++14, Dev-C++ / Code::Blocks'un kullandığı derleyici). İzlenecek
   programların bir de izli kopyası üretilir: clang'ın AST'si (-ast-dump=json) okunur, her deyimin önüne
   __iz::A, her if/for/while/do koşuluna __iz::K çağrısı yerleştirilir (satır, o ana kadarki çıktı,
   kapsamdaki değişkenler). Değer almamış değişkenler izde "?" görünür (.claude/araclar/cpp/iz.hpp).
3. Programları AYAR'daki girdilerle çalıştırır; girdi konsoldaki gibi çıktının arasına yerleşir
   (.claude/araclar/cpp/calistirici.cpp). Sonucu id="izler" bloğuna yazar.
4. id="sorular" (test) ve id="derleme" (derlenir mi?) bloklarındaki kodları da derleyip çalıştırır, cevapları
   gerçek sonuçla karşılaştırır; g++'ın gerçek hata ve uyarı mesajlarını id="derleme-cikti"ya yazar.
   Tutmayan varsa sayfaya yazmadan durur.

Çökmeler Windows'taki dönüş değeriyle yazılır: tam sayıyı sıfıra bölme 0xC0000094, yakalanmayan istisna
(abort) 3. Gerekenler: g++ ve clang++ (yalnız AST için). Sayfadaki bir kodu ya da soruyu değiştirince
bu betiği yeniden çalıştır.
"""
import argparse
import bisect
import concurrent.futures as cf
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

KOK = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SAYFA = os.path.join(KOK, "cpp-temelleri", "index.html")
YARDIM = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cpp")
ORTAM = dict(os.environ, LC_ALL="C", LANG="C")
GXX = ["g++", "-std=c++14", "-O0", "-g", "-Wall", "-Wextra", "-fno-diagnostics-color", "-fdiagnostics-plain-output"]
GXX_IZ = ["g++", "-std=c++17", "-O0", "-g", "-w", "-fno-diagnostics-color"]
CLANG_AST = ["clang++", "-std=c++17", "-fsyntax-only", "-Xclang", "-ast-dump=json", "-Xclang", "-ast-dump-filter=main"]
MAX_ADIM = 300
# Linux sinyali → Windows'ta aynı durumun dönüş değeri (32 bit işaretli): sıfıra bölme, abort, erişim hatası
WIN_KOD = {-8: -1073741676, -6: 3, -11: -1073741819}
KOD_ACIKLAMA = {-1073741676: "0xC0000094: tam sayı sıfıra bölündü", 3: "abort: yakalanmayan istisna",
                -1073741819: "0xC0000005: bellek erişim hatası"}

# Her program için: senaryolar (ad, girdi satırları), adım adım izlensin mi ("adim"), en çok kaç adım
# ("en_cok"). "derlenmez": kod bilerek hatalı, derleyici mesajı gösterilir. Senaryoda "adim": False o
# senaryoyu izlemez. "girdi_biter": girdi bilerek eksik.
AYAR = {
    # 1. hafta
    "h1-merhaba": {},
    "h1-yazdir": {},
    "h1-cin": {"senaryo": [{"ad": "Zeynep", "girdi": ["Zeynep"]}, {"ad": "Zeynep Kaya", "girdi": ["Zeynep Kaya"]}]},
    "h1-getline": {"senaryo": [{"ad": "Zeynep Kaya · Bilgisayar Programciligi",
                                "girdi": ["Zeynep Kaya", "Bilgisayar Programciligi"]}]},
    "h1-toplam-alg": {"senaryo": [{"ad": "12 ve 30", "girdi": ["12", "30"]}, {"ad": "-7 ve 4", "girdi": ["-7", "4"]},
                                  {"ad": "12 30 (tek satır)", "girdi": ["12 30"]}]},
    # 2. hafta
    "h2-turler": {},
    "h2-boyut": {},
    "h2-sabit": {"senaryo": [{"ad": "5", "girdi": ["5"]}, {"ad": "2.5", "girdi": ["2.5"]},
                             {"ad": "2,5 (virgül)", "girdi": ["2,5"]}]},
    "h2-define": {"senaryo": [{"ad": "250", "girdi": ["250"]}, {"ad": "99.90", "girdi": ["99.90"]}]},
    "h2-hassasiyet": {},
    "h2-donusum": {},
    "h2-ondalik": {"senaryo": [{"ad": "2.5 (nokta)", "girdi": ["2.5"]}, {"ad": "2,5 (virgül)", "girdi": ["2,5"]},
                               {"ad": "iki bucuk", "girdi": ["iki bucuk"]}]},
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
    "h4-gecme": {"senaryo": [{"ad": "40 · 70", "girdi": ["40", "70"]}, {"ad": "90 · 45", "girdi": ["90", "45"]},
                             {"ad": "30 · 50", "girdi": ["30", "50"]}]},
    "h4-artik": {"senaryo": [{"ad": "2024", "girdi": ["2024"]}, {"ad": "1900", "girdi": ["1900"]},
                             {"ad": "2000", "girdi": ["2000"]}, {"ad": "2026", "girdi": ["2026"]}]},
    "h4-enbuyuk": {"senaryo": [{"ad": "8 21 13", "girdi": ["8 21 13"]}, {"ad": "5 5 2", "girdi": ["5 5 2"]}]},
    "h4-icice": {"senaryo": [{"ad": "20 · 85", "girdi": ["20", "85"]}, {"ad": "20 · 55", "girdi": ["20", "55"]},
                             {"ad": "16 · 95", "girdi": ["16", "95"]}]},
    "h4-ternary": {},
    "h4-atama": {},
    # 5. hafta
    "h5-gun": {"senaryo": [{"ad": "3", "girdi": ["3"]}, {"ad": "7", "girdi": ["7"]}, {"ad": "9", "girdi": ["9"]}]},
    "h5-dusme": {"senaryo": [{"ad": "1", "girdi": ["1"]}, {"ad": "2", "girdi": ["2"]}, {"ad": "3", "girdi": ["3"]}]},
    "h5-case-hata": {"derlenmez": True},
    "h5-mevsim": {"senaryo": [{"ad": "1", "girdi": ["1"]}, {"ad": "8", "girdi": ["8"]}, {"ad": "13", "girdi": ["13"]}]},
    "h5-hesap": {"senaryo": [{"ad": "7.5 * 4", "girdi": ["7.5", "*", "4"]}, {"ad": "10 / 4", "girdi": ["10", "/", "4"]},
                             {"ad": "10 / 0", "girdi": ["10", "/", "0"]}, {"ad": "3 % 2", "girdi": ["3", "%", "2"]},
                             {"ad": "7.5*4 (tek satır)", "girdi": ["7.5*4"]}]},
    "h5-notharf": {"senaryo": [{"ad": "95", "girdi": ["95"]}, {"ad": "72", "girdi": ["72"]}, {"ad": "40", "girdi": ["40"]}]},
    "h5-vki": {"senaryo": [{"ad": "68 kg · 1.75 m", "girdi": ["68", "1.75"]}, {"ad": "95 kg · 1.70 m", "girdi": ["95", "1.70"]},
                           {"ad": "1,75 yazarsa", "girdi": ["68", "1,75"]}]},
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
    "h7-faiz": {},
    "h7-basamak": {"senaryo": [{"ad": "4096", "girdi": ["4096"]}, {"ad": "7", "girdi": ["7"]}]},
    "h7-ters": {"senaryo": [{"ad": "1234", "girdi": ["1234"]}, {"ad": "12321", "girdi": ["12321"]}]},
    "h7-ebob": {},
    "h7-nobetci": {"senaryo": [{"ad": "80, 65, 92", "girdi": ["80", "65", "92", "-1"]}, {"ad": "hemen -1", "girdi": ["-1"]}]},
    "h7-dowhile": {"senaryo": [{"ad": "15, 0, 7", "girdi": ["15", "0", "7"]}, {"ad": "4", "girdi": ["4"]}]},
    "h7-dogrulama": {"senaryo": [{"ad": "abc, 15, 7", "girdi": ["abc", "15", "7"]}]},
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
    "h8-tahmin": {"senaryo": [{"ad": "50 · 25 · 37", "girdi": ["50", "25", "37"]}]},
    "h8-sesli": {"senaryo": [{"ad": "Bilgisayar", "girdi": ["Bilgisayar"]}, {"ad": "PROGRAMLAMA", "girdi": ["PROGRAMLAMA"]}]},
}

FIG_RE = re.compile(r'<figure class="(prog[^"]*)" data-prog="([^"]+)"[^>]*>(.*?)</figure>', re.S)
PRE_RE = re.compile(r'<pre class="code"(?: data-dosya="([^"]+)")?[^>]*><code>(.*?)</code></pre>', re.S)
SARMAL_BAS = ("#include <iostream>\n#include <string>\n#include <cmath>\n#include <climits>\n#include <iomanip>\n"
              "using namespace std;\n\nint main()\n{\n")
SARMAL_SON = "\n    return 0;\n}\n"
KAYDIRMA = SARMAL_BAS.count("\n")
SKALER = {"int", "double", "float", "char", "bool", "long", "long long", "short", "unsigned", "unsigned int",
          "unsigned long", "unsigned long long", "unsigned short", "unsigned char", "signed char", "long double"}


class Hata(Exception):
    pass


# ------------------------------------------------------------------------------------------- izleme ekleme
def ast_main(yol):
    r = subprocess.run(CLANG_AST + [yol], capture_output=True, text=True, env=ORTAM, timeout=120)
    if r.returncode:
        raise Hata("clang AST alınamadı:\n" + r.stderr[-2000:])
    s, dec, i = r.stdout, json.JSONDecoder(), 0
    while i < len(s):
        while i < len(s) and s[i].isspace():
            i += 1
        if i >= len(s):
            break
        o, i = dec.raw_decode(s, i)
        if o.get("kind") == "FunctionDecl" and o.get("name") == "main":
            govde = [c for c in o.get("inner", []) if c.get("kind") == "CompoundStmt"]
            if govde:
                return govde[0]
    raise Hata("AST'de main bulunamadı")


def c_metin(s):
    return s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


class Izleyici:
    """main'in gövdesini dolaşır, deyimlerin önüne __iz::A, koşullara __iz::K ekler (C#'taki Izleyici'nin eşi)."""

    KONTROL = ("IfStmt", "ForStmt", "WhileStmt", "DoStmt", "SwitchStmt", "CXXForRangeStmt")

    def __init__(self, kaynak, govde):
        self.k = kaynak
        self.satir_bas = [0] + [i + 1 for i, b in enumerate(kaynak) if b == 10]
        self.ekler, self.degisimler, self.kapsam, self.sira = [], [], [], 0
        self.blok(govde, ana=True)

    def satir(self, off):
        return bisect.bisect_right(self.satir_bas, off)

    @staticmethod
    def bas(n):
        return n["range"]["begin"]["offset"]

    @staticmethod
    def son(n):
        e = n["range"]["end"]
        return e["offset"] + e.get("tokLen", 0)

    def degiskenler(self):
        gorulen, liste = set(), []
        for kap in reversed(self.kapsam):
            for ad, tur in reversed(kap):
                if ad not in gorulen:
                    gorulen.add(ad)
                    liste.append((ad, tur))
        liste.reverse()
        return "{" + ", ".join(f'__iz::v("{ad}", {ad}, "{c_metin(tur)}")' for ad, tur in liste) + "}"

    def ekle(self, off, metin):
        self.sira += 1
        self.ekler.append((off, self.sira, metin))

    def adim(self, off):
        self.ekle(off, f"__iz::A({self.satir(off)}, {self.degiskenler()}); ")

    def blok(self, n, ana=False):
        self.kapsam.append([])
        cocuklar = n.get("inner", [])
        for c in cocuklar:
            self.liste_deyim(c)
        if ana and (not cocuklar or cocuklar[-1].get("kind") != "ReturnStmt"):
            self.adim(n["range"]["end"]["offset"])
        self.kapsam.pop()

    def liste_deyim(self, c):
        alt = c
        while alt and alt.get("kind") in ("CaseStmt", "DefaultStmt"):
            alt = alt["inner"][-1]
        if not alt or alt.get("kind") == "NullStmt":
            return
        if alt.get("kind") != "CompoundStmt":
            self.adim(self.bas(alt))
        self.deyim(alt)

    def deyim(self, n):
        k = n.get("kind")
        if k == "CompoundStmt":
            self.blok(n)
        elif k == "DeclStmt":
            self.bildirim(n)
        elif k == "IfStmt":
            self.if_(n)
        elif k == "ForStmt":
            self.for_(n)
        elif k == "CXXForRangeStmt":
            self.aralik_for(n)
        elif k == "WhileStmt":
            if n.get("hasVar"):
                raise Hata("while koşulunda bildirim desteklenmiyor")
            self.kosul(n["inner"][0])
            self.govde(n["inner"][1])
        elif k == "DoStmt":
            self.govde(n["inner"][0])
            self.kosul(n["inner"][1])
        elif k == "SwitchStmt":
            if n.get("hasInit") or n.get("hasVar"):
                raise Hata("switch içinde bildirim desteklenmiyor")
            self.govde(n["inner"][-1])

    def bildirim(self, n):
        bos = []
        for d in n.get("inner", []):
            if d.get("kind") != "VarDecl":
                continue
            tur = d["type"]["qualType"]
            self.kapsam[-1].append((d["name"], tur))
            if "init" not in d and tur in SKALER:
                bos.append(d["name"])
        if bos:
            self.ekle(self.son(n), " " + " ".join(f"__iz::bos(&{a}, sizeof({a}));" for a in bos))

    def if_(self, n):
        if n.get("hasInit") or n.get("hasVar"):
            raise Hata("if içinde bildirim desteklenmiyor")
        ic = n["inner"]
        self.kosul(ic[0])
        self.govde(ic[1])
        if n.get("hasElse"):
            if ic[2].get("kind") == "IfStmt":
                self.if_(ic[2])
            else:
                self.govde(ic[2])

    def for_(self, n):
        init, _, kosul, _, govde = n["inner"]
        self.kapsam.append([])
        if init and init.get("kind") == "DeclStmt":
            for d in init.get("inner", []):
                if d.get("kind") == "VarDecl":
                    self.kapsam[-1].append((d["name"], d["type"]["qualType"]))
        if kosul:
            self.kosul(kosul)
        self.govde(govde)
        self.kapsam.pop()

    def aralik_for(self, n):
        ic = n["inner"]
        degisken = [(d["name"], d["type"]["qualType"]) for d in ic[6].get("inner", []) if d.get("kind") == "VarDecl"]
        self.kapsam.append(degisken)
        self.govde(ic[7])
        self.kapsam.pop()

    def noktali_virgul(self, off):
        i = off
        while i < len(self.k) and self.k[i] in b" \t\r\n":
            i += 1
        if i >= len(self.k) or self.k[i] != ord(";"):
            raise Hata(f"satır {self.satir(off)}: deyim sonunda ; bulunamadı")
        return i + 1

    def govde(self, n):
        k = n.get("kind")
        if k == "CompoundStmt":
            self.blok(n)
            return
        if not n or k == "NullStmt":
            return
        if k in self.KONTROL:
            raise Hata(f"satır {self.satir(self.bas(n))}: süslü parantezsiz iç içe kontrol deyimi desteklenmiyor")
        a, b = self.bas(n), self.noktali_virgul(self.son(n))
        self.ekle(a, "{ " + f"__iz::A({self.satir(a)}, {self.degiskenler()}); ")
        self.deyim(n)
        self.ekle(b, " }")

    def kosul(self, n):
        ic = n
        while ic.get("kind") in ("ImplicitCastExpr", "ExprWithCleanups") and ic.get("inner"):
            ic = ic["inner"][0]
        if ic.get("kind") in ("CXXBoolLiteralExpr", "IntegerLiteral"):
            return
        a, b = self.bas(n), self.son(n)
        metin = self.k[a:b].decode("utf-8")
        self.degisimler.append((a, b, f"(__iz::_k = static_cast<bool>({metin}), __iz::K({self.satir(a)}, "
                                      f"\"{c_metin(metin)}\", __iz::_k, {self.degiskenler()}))"))

    def uygula(self):
        olaylar = [(a, 0, s, a, m) for a, s, m in self.ekler] + [(a, 1, 0, b, m) for a, b, m in self.degisimler]
        olaylar.sort(key=lambda x: (x[0], x[1], x[2]))
        cikti, konum = bytearray(), 0
        for a, tur, _, b, metin in olaylar:
            if a < konum:
                raise Hata("çakışan düzenleme")
            cikti += self.k[konum:a] + metin.encode("utf-8")
            konum = b if tur == 1 else a
        return bytes(cikti + self.k[konum:])


# ------------------------------------------------------------------------------------------- derleme
def yardimcilari_derle(hedef):
    for ad, std in (("calistirici", "-std=c++14"), ("iz", "-std=c++17")):
        r = subprocess.run(["g++", std, "-O0", "-g", "-c", os.path.join(YARDIM, ad + ".cpp"), "-I", YARDIM,
                            "-o", os.path.join(hedef, ad + ".o")], capture_output=True, text=True, env=ORTAM)
        if r.returncode:
            sys.exit(f"{ad}.cpp derlenemedi:\n{r.stderr}")


TANI_RE = re.compile(r"^main\.cpp:(\d+):(\d+): (error|warning|fatal error|note): (.*)$")


def tanilar(metin):
    """g++ çıktısından hata ve uyarıları ayıklar; hemen ardından gelen "note:" satırları (ör. "crosses
    initialization of 'double tutar'") bir önceki kayda eklenir."""
    hatalar, uyarilar, son = [], [], None
    for s in metin.splitlines():
        m = TANI_RE.match(s)
        if m and m.group(3) == "note":
            if son is not None:
                son.setdefault("notlar", []).append({"satir": int(m.group(1)), "mesaj": m.group(4).strip()})
            continue
        if m:
            son = {"satir": int(m.group(1)), "sutun": int(m.group(2)), "mesaj": m.group(4)}
            (uyarilar if m.group(3) == "warning" else hatalar).append(son)
        elif "undefined reference" in s:
            son = {"satir": 0, "sutun": 0, "mesaj": s.split(": ", 1)[-1]}
            hatalar.append(son)
    return hatalar, uyarilar


def derle(dizin, kod, arac):
    yol = os.path.join(dizin, "main.cpp")
    with open(yol, "w", encoding="utf-8", newline="\n") as f:
        f.write(kod.rstrip("\n") + "\n")
    exe = os.path.join(dizin, "prog")
    r = subprocess.run(GXX + ["main.cpp", os.path.join(arac, "calistirici.o"), "-o", exe], cwd=dizin,
                       capture_output=True, text=True, env=ORTAM, timeout=180)
    hatalar, uyarilar = tanilar(r.stderr)
    if r.returncode and not hatalar:
        hatalar = [{"satir": 0, "sutun": 0, "mesaj": r.stderr.strip()[-500:]}]
    return {"ok": r.returncode == 0, "exe": exe, "hatalar": hatalar, "uyarilar": uyarilar}


def izli_derle(dizin, arac):
    yol = os.path.join(dizin, "main.cpp")
    with open(yol, "rb") as f:
        kaynak = f.read()
    yeni = Izleyici(kaynak, ast_main(yol)).uygula()
    izli = os.path.join(dizin, "izli.cpp")
    with open(izli, "wb") as f:
        f.write(yeni)
    exe = os.path.join(dizin, "prog_iz")
    r = subprocess.run(GXX_IZ + ["-include", os.path.join(YARDIM, "iz.hpp"), "-I", YARDIM, "izli.cpp",
                                 os.path.join(arac, "calistirici.o"), os.path.join(arac, "iz.o"), "-o", exe],
                       cwd=dizin, capture_output=True, text=True, env=ORTAM, timeout=180)
    if r.returncode:
        raise Hata("izli kod derlenmedi:\n" + r.stderr[-3000:])
    return exe


# ------------------------------------------------------------------------------------------- çalıştırma
def kos(exe, girdi, iz_dosya=None, en_cok=MAX_ADIM, girdi_biter=False):
    ortam = dict(ORTAM)
    if not girdi_biter:
        ortam["GIRDI_BITTI_DUR"] = "1"
    if iz_dosya:
        ortam["IZ_DOSYA"] = iz_dosya
        ortam["IZ_EN_COK"] = str(en_cok)
    try:
        r = subprocess.run([exe], input=girdi.encode("utf-8"), capture_output=True, env=ortam, timeout=60)
    except subprocess.TimeoutExpired:
        raise Hata(f"{exe}: program 60 saniyede bitmedi (girdi eksik ya da sonsuz döngü?)")
    return r.stdout, r.stderr.decode("utf-8", "replace"), r.returncode


def cikis_kodu(x):
    return WIN_KOD.get(x, x)


def parcala(out, err):
    """Çıktıyı [["o", metin], ["i", girdi], ["e", hata]] parçalarına ayırır; bayt → görünen karakter haritası."""
    metin = out.decode("utf-8", "replace")
    par, harita = [], {0: 0}
    bayt = kar = 0
    tampon, girdi_mi = [], False

    def bosalt(tur):
        if tampon:
            s = "".join(tampon)
            if par and par[-1][0] == tur:
                par[-1][1] += s
            else:
                par.append([tur, s])
            tampon.clear()

    for ch in metin:
        bayt += len(ch.encode("utf-8"))
        if ch == "\x01":
            bosalt("o")
            girdi_mi = True
        elif ch == "\x02":
            bosalt("i")
            girdi_mi = False
        else:
            tampon.append(ch)
            kar += 1
        harita[bayt] = kar
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


def adimlari_kur(ham, harita):
    """Ham iz satırlarını sayfa biçimine çevirir. if/while/for'un önündeki adım ile aynı satırdaki koşul adımı
    (arada çıktı yoksa) birleşir: hata ayıklayıcı o satırda bir kez durur."""
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
    Her adım: [satır, çıktı konumu, imza no, [değerler], koşul no (-1 yok), koşul sonucu (0/1), not]."""
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
    satirlar = kod.split("\n")
    for i, s in enumerate(satirlar):
        if re.match(r"^\s*int\s+main\s*\(", s):
            girinti = len(s) - len(s.lstrip())
            for j in range(i + 1, len(satirlar)):
                t = satirlar[j]
                if t.strip() == "}" and len(t) - len(t.lstrip()) == girinti:
                    return j + 1
    return len(satirlar)


def calistir_program(pid, prog, arac):
    ayar = AYAR.get(pid, {})
    dizin = tempfile.mkdtemp(prefix="cpp-")
    try:
        kod = prog["kod"]
        d = derle(dizin, kod, arac)
        if ayar.get("derlenmez"):
            if d["ok"]:
                raise Hata(f"{pid}: derlenmemesi gerekiyordu ama derlendi")
            return {"derleme": d["hatalar"][:3]}
        if not d["ok"]:
            raise Hata(f"{pid}: derlenmedi\n" + "\n".join(f"{h['satir']}: {h['mesaj']}" for h in d["hatalar"]))
        uyari = [f"{u['satir']}: {u['mesaj']}" for u in d["uyarilar"]]
        izle = ayar.get("adim", True)
        exe_iz = izli_derle(dizin, arac) if izle else None
        senaryolar = []
        for no, sen in enumerate(ayar.get("senaryo", [{"ad": ""}])):
            girdi = "".join(s + "\n" for s in sen.get("girdi", []))
            out, err, x = kos(d["exe"], girdi, girdi_biter=sen.get("girdi_biter", False))
            if x == 97 and "\x03girdi bitti" in err:
                raise Hata(f"{pid} / {sen.get('ad')}: girdi yetmedi, senaryoya satır ekle\n{out.decode()}")
            par, harita = parcala(out, err)
            kayit = {"ad": sen.get("ad", ""), "t": par, "x": cikis_kodu(x)}
            if exe_iz and sen.get("adim", True):
                iz_yolu = os.path.join(dizin, f"iz-{no}.jsonl")
                en_cok = ayar.get("en_cok", MAX_ADIM)
                out2, err2, x2 = kos(exe_iz, girdi, iz_yolu, en_cok, sen.get("girdi_biter", False))
                if (out2, err2, x2) != (out, err, x):
                    raise Hata(f"{pid}: iz çalıştırması farklı çıktı verdi\n{out2!r}\n{out!r}\n{err2!r}\n{err!r}")
                ham, kesildi = iz_oku(iz_yolu)
                adimlar = adimlari_kur(ham, harita)
                toplam = len(duz([p for p in par if p[0] != "e"]))
                son_v = adimlar[-1]["v"] if adimlar else []
                if x < 0:
                    son = {"l": adimlar[-1]["l"] if adimlar else 0, "o": toplam + len(err), "v": son_v,
                           "n": "Program bu satırda çöktü: " + KOD_ACIKLAMA.get(cikis_kodu(x), f"sinyal {-x}") + "."}
                else:
                    son = {"l": main_kapanis(kod), "o": toplam, "v": son_v,
                           "n": (f"İz {en_cok} adımda kesildi; program sonuna kadar çalıştı, çıktı tam."
                                 if kesildi else f"main bitti, program {x} değerini döndürdü.")}
                adimlar.append(son)
                kayit["cf"], kayit["kt"], kayit["a"] = sikistir(adimlar)
            senaryolar.append(kayit)
        return {"s": senaryolar, "_uyari": uyari}
    finally:
        shutil.rmtree(dizin, ignore_errors=True)


# ------------------------------------------------------------------------------------------- sorular
def tam_kod(k):
    """Parça kodu main'in içine sarar; #include içeren tam program ise olduğu gibi bırakır."""
    if re.search(r"^\s*#include", k, re.M) or re.search(r"\bint\s+main\s*\(", k):
        return k
    return SARMAL_BAS + "\n".join(("    " + s) if s.strip() else "" for s in k.split("\n")) + SARMAL_SON


def kaydirma(k):
    return 0 if tam_kod(k) == k else KAYDIRMA


def dene(arac, kod, girdi=()):
    """("derleme", ilk hata, uyarılar) ya da ("calisti", çıktı, hata, çıkış kodu, uyarılar)."""
    dizin = tempfile.mkdtemp(prefix="cpp-soru-")
    try:
        d = derle(dizin, tam_kod(kod), arac)
        if not d["ok"]:
            return ("derleme", d["hatalar"][0], d["uyarilar"])
        out, err, x = kos(d["exe"], "".join(s + "\n" for s in girdi), girdi_biter=True)
        yalin = re.sub("\x01[^\x02]*\x02\n", "", out.decode("utf-8", "replace"))
        return ("calisti", yalin, err, cikis_kodu(x), d["uyarilar"])
    finally:
        shutil.rmtree(dizin, ignore_errors=True)


def soru_kontrol(sorular, izler, arac):
    """Kodlu soruları çalıştırır. "k" gösterilen kod, "kk" gösterilmeyen kontrol kodu, "p" sayfadaki program.
    Beklenti: "derleme" g++ mesajından bir parça · "cokme": True ise program çöker · yoksa doğru şık çıktıyla
    birebir ("kip": "son"/"ilk" son ya da ilk satırla)."""
    sorun, isler = 0, []
    for no, q in enumerate(sorular, 1):
        c, d = q["c"], q["d"]
        if not (0 <= d < len(c)) or len(set(c)) != len(c):
            print(f"  ✗ soru {no}: şıklar ya da doğru indeks hatalı")
            sorun += 1
            continue
        if "k" in q or "kk" in q or "p" in q:
            isler.append((no, q))

    def tek(is_):
        no, q = is_
        if q.get("p"):
            return no, q, None
        return no, q, dene(arac, q.get("kk") or q["k"], q.get("g", []))

    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        sonuclar = list(ex.map(tek, isler))
    for no, q, r in sonuclar:
        c, d = q["c"], q["d"]
        if r is None:
            sen = izler[q["p"]]["s"][q.get("sen", 0)]
            r = ("calisti", "".join(p[1] for p in sen["t"] if p[0] == "o"),
                 "".join(p[1] for p in sen["t"] if p[0] == "e"), sen["x"], [])
        if "derleme" in q:
            tamam = r[0] == "derleme" and q["derleme"] in r[1]["mesaj"]
            gercek = r[1]["mesaj"] if r[0] == "derleme" else "derlendi"
        elif r[0] == "derleme":
            tamam, gercek = False, "DERLENMEDİ: " + r[1]["mesaj"]
        elif q.get("cokme"):
            tamam = r[3] != 0 and (q["cokme"] is True or q["cokme"] in r[2] + KOD_ACIKLAMA.get(r[3], ""))
            gercek = f"çıkış {r[3]} {r[2][:60]!r}"
        else:
            satirlar = [x.rstrip() for x in r[1].rstrip("\n").split("\n")]
            kip = q.get("kip", "tam")
            gercek = satirlar[-1] if kip == "son" else satirlar[0] if kip == "ilk" else "\n".join(satirlar)
            beklenen = q.get("beklenen", c[d])
            tamam = r[3] == 0 and gercek == beklenen and ("beklenen" in q or c.count(gercek) == 1)
        if not tamam:
            print(f"  ✗ soru {no} ({q.get('s', '')[:50]}…): gerçek {gercek!r}")
            sorun += 1
    return sorun


def derleme_kontrol(kartlar, arac):
    """Derlenir mi? kartları: "b" beklenen sonuç (derlenmez / coker / calisir), "m" mesaj ya da çıktıdan parça.
    "u": derleyici uyarı versin mi (True) — g++ -Wall -Wextra ile."""
    sorun, cikti = 0, []

    def tek(kart):
        return dene(arac, kart["k"], kart.get("g", []))

    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        sonuclar = list(ex.map(tek, kartlar))
    for no, (kart, r) in enumerate(zip(kartlar, sonuclar), 1):
        kay = kaydirma(kart["k"])
        uyarilar = r[-1]
        if r[0] == "derleme":
            h = r[1]
            kayit = {"b": "derlenmez", "s": max(0, h["satir"] - kay), "m": h["mesaj"]}
            tamam = kart["b"] == "derlenmez" and kart.get("m", "") in h["mesaj"]
        elif r[3] != 0:
            kayit = {"b": "coker", "o": r[1], "m": r[2].rstrip("\n"), "x": r[3], "xa": KOD_ACIKLAMA.get(r[3], "")}
            tamam = kart["b"] == "coker" and kart.get("m", "") in (r[2] + kayit["xa"])
        else:
            kayit = {"b": "calisir", "o": r[1]}
            tamam = kart["b"] == "calisir" and kart.get("m", "") in r[1]
        if uyarilar and r[0] != "derleme":
            u = uyarilar[0]
            kayit["u"] = {"s": max(0, u["satir"] - kay), "m": u["mesaj"]}
        if kart.get("u") and "u" not in kayit:
            tamam = False
        if not tamam:
            print(f"  ✗ derleme {no}: beklenen {kart['b']} / {kart.get('m')!r}, gerçek {kayit}")
            sorun += 1
        cikti.append(kayit)
    return sorun, cikti


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


def yaz_kontrol(gorevler, izler):
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


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sayfa", default=SAYFA)
    ap.add_argument("--kuru", action="store_true", help="sayfaya yazma, yalnız kontrol et")
    ap.add_argument("--yalniz", help="yalnız bu program(lar)ı çalıştır (virgülle), diğer izleri koru")
    args = ap.parse_args()
    for arac_adi in ("g++", "clang++"):
        if not shutil.which(arac_adi):
            sys.exit(f"{arac_adi} bulunamadı")

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

    arac = tempfile.mkdtemp(prefix="cpp-arac-")
    try:
        yardimcilari_derle(arac)
        eski = blok_oku(sayfa, "izler", {})
        secili = set(args.yalniz.split(",")) if args.yalniz else None
        izler, sorun = {}, 0

        def tek(pid):
            if secili is not None and pid not in secili:
                return pid, eski.get(pid), None
            try:
                return pid, calistir_program(pid, programlar[pid], arac), None
            except Hata as e:
                return pid, None, str(e)

        with cf.ThreadPoolExecutor(max_workers=8) as ex:
            for pid, iz, hata in ex.map(tek, list(programlar)):
                if hata:
                    print(f"  ✗ {pid}: {hata}")
                    sorun += 1
                    continue
                if iz is None:
                    continue
                for u in iz.pop("_uyari", []):
                    print(f"  ! {pid}: uyarı {u}")
                izler[pid] = iz
                if secili is not None and pid not in secili:
                    continue
                if "derleme" in iz:
                    print(f"  ✓ {pid:16} derlenmedi (beklenen) · {iz['derleme'][0]['mesaj'][:60]}")
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
        sorun += soru_kontrol(sorular, izler, arac)
        sorun += yaz_kontrol(gorevler, izler)
        s2, derleme_cikti = derleme_kontrol(kartlar, arac)
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
