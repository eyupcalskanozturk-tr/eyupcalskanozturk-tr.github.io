#!/usr/bin/env python3
"""python-vize sayfasının çıktılarını ve adım adım izlerini gerçek Python ile üretir.

Repo kökünden:
    python3 -I .claude/araclar/python-vize-iz.py --vt /yol/vt.db

1. python-vize/index.html içindeki <figure class="prog" data-prog="..."> bloklarının kodunu okur.
2. Her programı AYAR'daki girdilerle geçici bir klasörde çalıştırır. Çıktıyı (klavye girdileri ayrı
   işaretli) ve satır satır izi (sıradaki satır, değişkenler, koşul notu, o ana kadarki çıktı) toplar.
3. Sonucu sayfadaki <script type="application/json" id="izler"> bloğuna yazar.
4. <script type="application/json" id="sorular"> ve id="deneme" içindeki kodlu soruların doğru şıkkını
   gerçek çıktıyla karşılaştırır. Tutmayan soru varsa sayfaya yazmadan durur.

--vt verilmezse veritabanı kullanan programların önceki izleri korunur, onların soruları atlanır.
Sayfadaki kodu değiştirdiğinde bu betiği yeniden çalıştır.
"""
import argparse
import builtins
import html
import inspect
import io
import json
import keyword
import linecache
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import tokenize
import traceback
import types

KOK = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SAYFA = os.path.join(KOK, "python-vize", "index.html")
MAX_ADIM = 700

BIRDEN_ONA = [str(i) for i in range(1, 11)]

# Her program için: girdi senaryoları, hazırlanacak dosyalar, izlenecek dosyalar.
# Görünen dosya adı sayfadaki figcaption'ın <b> etiketinden gelir (Hafta1/Ornek2.py → Ornek2.py).
# "@id" sayfadaki o id'li bloğun içeriği demektir. "klasor/" boş klasör oluşturur.
AYAR = {
    # Hafta 1
    "h1-tip": {},
    "h1-metin": {},
    "h1-girdi": {"senaryo": [{"ad": "5 ve 3", "girdi": ["5", "3"]}]},
    "h1-hesap": {"senaryo": [
        {"ad": "8 + 2", "girdi": ["8", "2", "+"]},
        {"ad": "8 / 2", "girdi": ["8", "2", "/"]},
        {"ad": "7 / 0", "girdi": ["7", "0", "/"]},
        {"ad": "8 % 2", "girdi": ["8", "2", "%"]},
        {"ad": "3.5 yaz", "girdi": ["3.5"]},
    ]},
    "h1-buyuk": {"senaryo": [
        {"ad": "4, 9, 2", "girdi": ["4", "9", "2"]},
        {"ad": "5, 5, 3", "girdi": ["5", "5", "3"]},
        {"ad": "1, 2, 3", "girdi": ["1", "2", "3"]},
    ]},
    "h1-buyuk-duz": {"senaryo": [
        {"ad": "5, 5, 3", "girdi": ["5", "5", "3"]},
        {"ad": "4, 9, 2", "girdi": ["4", "9", "2"]},
        {"ad": "1, 2, 3", "girdi": ["1", "2", "3"]},
    ]},
    "h1-toplam": {"senaryo": [
        {"ad": "1'den 10'a", "girdi": BIRDEN_ONA},
        {"ad": "hepsi 7", "girdi": ["7"] * 10},
    ]},
    "h1-y1": {},
    "h1-y2": {},
    "h1-y3": {},
    # Hafta 2
    "h2-hesap": {"senaryo": [
        {"ad": "8 * 2", "girdi": ["8", "2", "*"]},
        {"ad": "8 x 2", "girdi": ["8", "2", "x"]},
    ]},
    "h2-liste": {},
    "h2-asal": {"senaryo": [
        {"ad": "9", "girdi": ["9"]},
        {"ad": "13", "girdi": ["13"]},
        {"ad": "2", "girdi": ["2"]},
        {"ad": "1", "girdi": ["1"]},
    ]},
    "h2-asal-duz": {"senaryo": [
        {"ad": "1", "girdi": ["1"]},
        {"ad": "9", "girdi": ["9"]},
        {"ad": "13", "girdi": ["13"]},
    ]},
    "h2-toplam": {"senaryo": [{"ad": "1'den 10'a", "girdi": BIRDEN_ONA}]},
    "h2-y1": {},
    "h2-y2": {},
    "h2-y3": {},
    # Hafta 3
    "h3-break": {},
    "h3-continue": {},
    "h3-while": {},
    "h3-while-break": {"senaryo": [{"ad": "5, 7, 0", "girdi": ["5", "7", "0"]}]},
    "h3-fonk": {},
    "h3-fak": {"senaryo": [
        {"ad": "5", "girdi": ["5"]},
        {"ad": "0", "girdi": ["0"]},
        {"ad": "-3", "girdi": ["-3"]},
    ]},
    "h3-class": {},
    "h3-class-hata": {},
    "h3-class-self": {},
    "h3-class-init": {},
    "h3-kaynak": {"calisma": False},
    "h3-hesap": {"modul": {"kaynak.py": "h3-kaynak"}, "adim": False},
    "h3-y1": {},
    "h3-y2": {},
    "h3-y3": {},
    "h3-y4": {},
    # Hafta 4
    "h4-olustur": {"izle": ["ogrenciler.txt"], "senaryo": [
        {"ad": "1. çalıştırma", "kac": 1},
        {"ad": "2. çalıştırma", "kac": 2},
    ]},
    "h4-musteri": {"calisma": False},
    "h4-oku": {"hazirla": {"musteriler.txt": "@h4-musteri"}},
    "h4-oku-duz": {"hazirla": {"musteriler.txt": "@h4-musteri"}},
    "h4-with": {"hazirla": {"musteriler.txt": "@h4-musteri"}},
    "h4-split": {"hazirla": {"musteriler.txt": "@h4-musteri"}},
    "h4-sil": {"izle": ["ogrenciler.txt", "dizin"], "senaryo": [
        {"ad": "ikisi de yok"},
        {"ad": "ikisi de var", "hazirla": {"ogrenciler.txt": "\nEyüp", "dizin/": None}},
    ]},
    "h4-vt": {"vt": True},
    "h4-vt-param": {"vt": True},
    "h4-where-group": {"vt": True},
    "h4-grup": {"vt": True},
    "h4-bos-vt": {"izle": ["vt2.db"]},
    "h4-y1": {},
    "h4-y2": {},
}

FIG_RE = re.compile(r'<figure class="prog([^"]*)" data-prog="([^"]+)"[^>]*>(.*?)</figure>', re.S)
KOD_RE = re.compile(r'<pre class="code"><code>(.*?)</code></pre>', re.S)
KOSUL_RE = re.compile(r"^\s*(if|elif|while)\b\s*(.*?)\s*:\s*(#.*)?$")
FOR_RE = re.compile(r"^\s*for\s+(\w+)\s+in\s+(.+?)\s*:\s*(#.*)?$")


def u16(s):
    """JavaScript'in string.length'i ile aynı uzunluk."""
    return len(s.encode("utf-16-le")) // 2


class Cikti(io.TextIOBase):
    def __init__(self):
        super().__init__()
        self.par = []

    def ekle(self, tur, s):
        if not s:
            return
        if self.par and self.par[-1][0] == tur:
            self.par[-1][1] += s
        else:
            self.par.append([tur, s])

    def write(self, s):
        self.ekle("o", s)
        return len(s)

    def uzunluk(self):
        return sum(u16(p[1]) for p in self.par)

    def metin(self):
        return "".join(p[1] for p in self.par)


def tur_adi(v):
    if isinstance(v, io.TextIOWrapper):
        return "dosya"
    if isinstance(v, (types.FunctionType, types.BuiltinFunctionType)):
        return "fonksiyon"
    if isinstance(v, type):
        return "sınıf"
    if isinstance(v, types.ModuleType):
        return "modül"
    return type(v).__name__


def goster(v):
    if isinstance(v, io.TextIOWrapper):
        return f"<{os.path.basename(v.name)} · '{v.mode}'{' · kapalı' if v.closed else ''}>"
    if isinstance(v, sqlite3.Connection):
        return "<vt bağlantısı>"
    if isinstance(v, sqlite3.Cursor):
        return "<sorgu sonucu>"
    if isinstance(v, types.FunctionType):
        return "<lambda>" if v.__name__ == "<lambda>" else f"<{v.__name__}()>"
    if isinstance(v, type):
        return f"<{v.__name__}>"
    if isinstance(v, types.ModuleType):
        return f"<{v.__name__}>"
    if type(v).__module__ == "__main__":
        alanlar = " ".join(f"{k}={goster(x)}" for k, x in vars(v).items()) if hasattr(v, "__dict__") else ""
        return f"<{type(v).__name__} nesnesi{(' ' + alanlar) if alanlar else ''}>"
    r = repr(v)
    return r if len(r) <= 90 else r[:87] + "…"


def degiskenler(sozluk):
    return [[ad, goster(v), tur_adi(v)] for ad, v in list(sozluk.items()) if not ad.startswith("__")]


def sinif_govdesi(frame):
    co = frame.f_code
    return co.co_name != "<module>" and not (co.co_flags & inspect.CO_OPTIMIZED)


def cerceve(frame, g):
    """None (modül), ("sinif", ad) ya da ("fonk", görünen ad)."""
    co = frame.f_code
    if co.co_name == "<module>":
        return None
    if sinif_govdesi(frame):
        return ("sinif", co.co_name)
    if co.co_name == "<lambda>":
        for ad, v in g.items():
            if isinstance(v, types.FunctionType) and v.__code__ is co:
                return ("fonk", ad)
        return ("fonk", "lambda")
    return ("fonk", co.co_qualname)


def bul(ad, frame):
    if ad in frame.f_locals:
        return frame.f_locals[ad]
    if ad in frame.f_globals:
        return frame.f_globals[ad]
    return KeyError


def yerine_koy(ifade, frame):
    """Koşuldaki değişken adlarının yerine değerlerini yazar: sayi1>sayi2 → 5>5."""
    try:
        toklar = list(tokenize.generate_tokens(io.StringIO(ifade).readline))
    except (tokenize.TokenError, SyntaxError):
        return ifade
    parca, son, onceki = [], 0, None
    for t in toklar:
        if t.type in (tokenize.NEWLINE, tokenize.NL, tokenize.ENDMARKER) or t.start[0] != 1:
            continue
        if t.type == tokenize.NAME and not keyword.iskeyword(t.string) and not (onceki and onceki.string == "."):
            v = bul(t.string, frame)
            if isinstance(v, (bool, int, float, str)):
                parca.append(ifade[son:t.start[1]])
                parca.append(repr(v))
                son = t.end[1]
        onceki = t
    parca.append(ifade[son:])
    return "".join(parca)


def satir_notu(metin, frame):
    kod = metin.split("#")[0].strip() if '"' not in metin and "'" not in metin else metin.strip()
    m = KOSUL_RE.match(metin)
    if m:
        anahtar, ifade = m.group(1), m.group(2)
        try:
            deger = bool(eval(ifade, frame.f_globals, frame.f_locals))  # noqa: S307 — sayfadaki kendi kodumuz
        except Exception:  # noqa: BLE001
            return None
        yeni = yerine_koy(ifade, frame)
        zincir = ifade + (f"  ⇒  {yeni}" if yeni != ifade else "") + f"  ⇒  {deger}"
        if anahtar == "while":
            eki = "döngü sürüyor" if deger else "döngü bitiyor"
        else:
            eki = "altındaki blok çalışacak" if deger else "blok atlanacak"
        return f"Koşul: {zincir} · {eki}"
    if kod == "break":
        return "break: döngü burada biter"
    if kod == "continue":
        return "continue: turun kalanı atlanır, döngü başa döner"
    m = re.match(r"def\s+(\w+)", kod)
    if m:
        if sinif_govdesi(frame):
            return f"{m.group(1)} metodu tanımlanıyor"
        return f"{m.group(1)} tanımlanıyor; gövdesi çağrılınca çalışır"
    m = re.match(r"class\s+(\w+)", kod)
    if m:
        return f"{m.group(1)} sınıfı tanımlanıyor"
    if re.match(r"\w+\s*=\s*lambda\b", kod):
        return "lambda oluşturuluyor; gövdesi çağrılınca çalışır"
    if kod.startswith(("import ", "from ")):
        return "modül yükleniyor"
    if "input(" in kod:
        return "input(): program durup klavyeden değer bekler" + (
            "; int() yazılanı tam sayıya çevirir" if "int(input(" in kod else "")
    for desen, aciklama in YONTEM_NOTLARI:
        if re.search(desen, kod):
            return aciklama
    return None


YONTEM_NOTLARI = [
    (r"\.readlines\(\)", "readlines(): bütün satırlar liste olarak okunur"),
    (r"\.readline\(\)", "readline(): sıradaki tek satır okunur"),
    (r"\.read\(\)", "read(): dosyanın tamamı okunur, okuma imleci sona gider"),
    (r"\.seek\(0\)", "seek(0): okuma imleci dosyanın başına sarılır"),
    (r"\.write\(", "write(): metin dosyaya yazılır; satır sonu kendiliğinden eklenmez"),
    (r"\bopen\(.*[\"']a[\"']", "open(..., \"a\"): dosya yoksa oluşur, varsa sonuna eklenir"),
    (r"\bopen\(.*[\"']w[\"']", "open(..., \"w\"): dosya yoksa oluşur, varsa içi silinir"),
    (r"\bopen\(", "open(): dosya okumak için açılır"),
    (r"\.close\(\)", "close(): dosya ya da bağlantı kapanır"),
    (r"sqlite3\.connect\(", "connect(): veritabanına bağlanılır; dosya yoksa boş bir dosya oluşur"),
    (r"\.execute\(", "execute(): SQL sorgusu çalışır, sonuç satır satır okunabilir"),
    (r"\.fetchall\(\)", "fetchall(): bütün satırlar liste olarak alınır"),
    (r"os\.remove\(", "os.remove(): dosya silinir"),
    (r"os\.rmdir\(", "os.rmdir(): boş klasör silinir"),
    (r"\.insert\(", "insert(i, x): x, i. sıraya eklenir; sonrakiler sağa kayar"),
    (r"\.append\(", "append(x): x listenin sonuna eklenir"),
    (r"\.pop\(", "pop(i): i. sıradaki eleman silinir"),
    (r"\.remove\(", "remove(x): değeri x olan ilk eleman silinir"),
    (r"\.reverse\(\)", "reverse(): liste ters çevrilir"),
]


ELSE_NOTU = "Üstteki koşul tutmadı, else bloğu çalışıyor"


def else_basi(satirlar, no):
    """Satır bir else bloğunun ilk satırıysa else satırının numarasını döndürür."""
    metin = satirlar[no - 1]
    girinti = len(metin) - len(metin.lstrip())
    for j in range(no - 1, 0, -1):
        onceki = satirlar[j - 1]
        if not onceki.strip() or onceki.strip().startswith("#"):
            continue
        if onceki.strip().startswith("else") and len(onceki) - len(onceki.lstrip()) < girinti:
            return j
        return None
    return None


def dongu_notlari(adimlar, satirlar):
    govdeler = {}
    for i, metin in enumerate(satirlar, 1):
        m = FOR_RE.match(metin)
        if not m:
            continue
        girinti = len(metin) - len(metin.lstrip())
        govde = set()
        for j in range(i + 1, len(satirlar) + 1):
            t = satirlar[j - 1]
            if not t.strip() or t.strip().startswith("#"):
                continue
            if len(t) - len(t.lstrip()) <= girinti:
                break
            govde.add(j)
        govdeler[i] = (m.group(1), govde)
    for k, a in enumerate(adimlar):
        if a.get("r") or a.get("l") not in govdeler:
            continue
        degisken, govde = govdeler[a["l"]]
        sonraki = adimlar[k + 1] if k + 1 < len(adimlar) else None
        onceki = adimlar[k - 1] if k > 0 else None
        giris = not (onceki and onceki.get("l") in govde and onceki.get("f") == a.get("f"))
        if sonraki and sonraki.get("l") in govde and sonraki.get("f") == a.get("f"):
            liste = sonraki.get("fv") if sonraki.get("f") else sonraki["v"]
            deger = next((x[1] for x in liste if x[0] == degisken), "?")
            yeni = f"Sıradaki tur: {degisken} = {deger}"
        elif giris:
            yeni = "Döngü hiç dönmedi: dönülecek eleman yok, döngüden sonraki satıra geçiliyor"
        else:
            yeni = "Döngü bitti, döngüden sonraki satıra geçiliyor"
        a["n"] = (ELSE_NOTU + " · " if a.get("e") else "") + yeni
    for a in adimlar:
        a.pop("e", None)


def iz_al(kod, dosya_adi, girdiler, dizin, adim_al=True):
    satirlar = kod.split("\n")
    out = Cikti()
    adimlar = []
    g = {"__name__": "__main__", "__builtins__": builtins}
    kalan = iter(girdiler)
    yeni = set()

    def sahte_input(istem=""):
        out.ekle("o", str(istem))
        try:
            v = next(kalan)
        except StopIteration:
            raise RuntimeError("girdi yetmedi") from None
        out.ekle("i", v)
        out.ekle("o", "\n")
        return v

    def kaydet(frame, olay, arg=None):
        if len(adimlar) >= MAX_ADIM:
            raise RuntimeError("adım sınırı aşıldı")
        no = frame.f_lineno
        metin = satirlar[no - 1] if 0 < no <= len(satirlar) else ""
        tip = cerceve(frame, g)
        if tip and tip[0] == "sinif" and (olay == "return" or no == frame.f_code.co_firstlineno):
            return
        adim = {"l": no, "v": degiskenler(g), "o": out.uzunluk()}
        if tip:
            adim["f"] = f"{tip[1]}()" if tip[0] == "fonk" else f"{tip[1]} sınıfının gövdesi"
            adim["fv"] = degiskenler(dict(frame.f_locals))
        not_ = None
        if olay == "line":
            if id(frame) in yeni:
                yeni.discard(id(frame))
                if tip and tip[0] == "fonk":
                    args = ", ".join(f"{k} = {goster(v)}" for k, v in dict(frame.f_locals).items())
                    not_ = f"{tip[1]}() çağrıldı" + (f": {args}" if args else "")
            if not_ is None:
                not_ = satir_notu(metin, frame)
            es = else_basi(satirlar, no) if 0 < no <= len(satirlar) else None
            if es and (not adimlar or adimlar[-1].get("l", 0) < es):
                adim["e"] = 1
                not_ = ELSE_NOTU + (" · " + not_ if not_ else "")
        else:
            if not tip or tip[0] != "fonk":
                return
            yok = arg is None and not metin.strip().startswith("return")
            not_ = f"↩ {tip[1]}() {goster(arg)} döndürüyor" + (" (return yazılmamış)" if yok else "")
            adim["r"] = 1
        if not_:
            adim["n"] = not_
        adimlar.append(adim)

    def izci(frame, olay, arg):
        if frame.f_code.co_filename != dosya_adi:
            return None
        if olay == "call":
            yeni.add(id(frame))
        elif olay == "line":
            kaydet(frame, "line")
        elif olay == "return":
            kaydet(frame, "return", arg)
            yeni.discard(id(frame))
        return izci

    nesne = compile(kod, dosya_adi, "exec")
    linecache.cache[dosya_adi] = (len(kod), None, [s + "\n" for s in satirlar], dosya_adi)
    eski = (sys.stdout, builtins.input, os.getcwd())
    sys.stdout, builtins.input = out, sahte_input
    os.chdir(dizin)
    sys.path.insert(0, dizin)
    hata = None
    if adim_al:
        sys.settrace(izci)
    try:
        exec(nesne, g)  # noqa: S102 — sayfadaki kendi kodumuz, geçici klasörde
    except BaseException as e:  # noqa: BLE001
        hata = e
    finally:
        sys.settrace(None)
        sys.stdout, builtins.input = eski[0], eski[1]
        os.chdir(eski[2])
        sys.path.remove(dizin)
        for ad in list(sys.modules):
            if (getattr(sys.modules[ad], "__file__", None) or "").startswith(dizin):
                del sys.modules[ad]
        for v in list(g.values()):
            if isinstance(v, (io.IOBase, sqlite3.Connection)):
                try:
                    v.close()
                except Exception:  # noqa: BLE001
                    pass
    cikis = 0
    if hata is not None:
        if isinstance(hata, RuntimeError) and str(hata) in ("girdi yetmedi", "adım sınırı aşıldı"):
            raise hata
        te = traceback.TracebackException.from_exception(hata)
        te.stack = traceback.StackSummary.from_list(
            [fs for fs in te.stack if fs.filename == dosya_adi or fs.filename.startswith(dizin)])
        metin = "".join(te.format()).replace(dizin + os.sep, "")
        out.ekle("e", metin)
        cikis = 1
    if adim_al:
        son = {"l": 0, "v": degiskenler(g), "o": out.uzunluk(),
               "n": "Program bitti" if not cikis else f"{type(hata).__name__}: program burada durdu"}
        adimlar.append(son)
        dongu_notlari(adimlar, satirlar)
    return out, adimlar, cikis


def hazirla(dizin, tanim, kodlar):
    for ad, icerik in (tanim or {}).items():
        yol = os.path.join(dizin, ad)
        if ad.endswith("/"):
            os.makedirs(yol, exist_ok=True)
            continue
        if isinstance(icerik, str) and icerik.startswith("@"):
            icerik = kodlar[icerik[1:]]["kod"]
        with open(yol, "w", encoding="utf-8", newline="") as f:
            f.write(icerik)


def dosya_durumu(dizin, adlar):
    sonuc = []
    for ad in adlar:
        yol = os.path.join(dizin, ad)
        if os.path.isdir(yol):
            sonuc.append({"ad": ad, "var": True, "klasor": True})
        elif os.path.isfile(yol):
            with open(yol, "rb") as f:
                ham = f.read()
            try:
                metin = ham.decode("utf-8")
            except UnicodeDecodeError:
                metin = None
            sonuc.append({"ad": ad, "var": True, "icerik": metin, "bayt": len(ham)})
        else:
            sonuc.append({"ad": ad, "var": False})
    return sonuc


def calistir(pid, kodlar, vt):
    ayar = AYAR.get(pid, {})
    kod = kodlar[pid]["kod"]
    dosya = ayar.get("dosya") or kodlar[pid]["dosya"]
    senaryolar = []
    for sen in ayar.get("senaryo", [{"ad": ""}]):
        dizin = tempfile.mkdtemp(prefix="pyvize-")
        try:
            hazirla(dizin, sen.get("hazirla", ayar.get("hazirla")), kodlar)
            for ad, kaynak in ayar.get("modul", {}).items():
                hazirla(dizin, {ad: "@" + kaynak}, kodlar)
            if ayar.get("vt"):
                shutil.copy(vt, os.path.join(dizin, "vt.db"))
            for _ in range(sen.get("kac", 1)):
                out, adimlar, cikis = iz_al(kod, dosya, list(sen.get("girdi", [])), dizin,
                                            adim_al=ayar.get("adim", True))
            kayit = {"ad": sen.get("ad", ""), "t": out.par, "x": cikis}
            if adimlar:
                kayit["a"] = adimlar
            if ayar.get("izle"):
                kayit["d"] = dosya_durumu(dizin, ayar["izle"])
            senaryolar.append(kayit)
        finally:
            shutil.rmtree(dizin, ignore_errors=True)
    return {"dosya": dosya, "s": senaryolar}


def soru_kontrol(sorular, kodlar, vt, ad="soru"):
    """Kodlu soruları çalıştırır. "k" gösterilen kod, "kk" gösterilmeyen kontrol kodu, "p" sayfadaki bir program."""
    sorun = 0
    for no, q in enumerate(sorular, 1):
        c, d = q["c"], q["d"]
        if not (0 <= d < len(c)) or len(set(c)) != len(c):
            print(f"  ✗ {ad} {no}: şıklar ya da doğru indeks hatalı")
            sorun += 1
            continue
        if "k" not in q and "kk" not in q and "p" not in q:
            continue
        if q.get("vt") or (q.get("p") and AYAR.get(q["p"], {}).get("vt")):
            if not vt:
                print(f"  · {ad} {no}: vt.db yok, atlandı")
                continue
        kod = q.get("k") or q.get("kk") or kodlar[q["p"]]["kod"]
        dizin = tempfile.mkdtemp(prefix="pyvize-soru-")
        try:
            if q.get("p"):
                hazirla(dizin, AYAR.get(q["p"], {}).get("hazirla"), kodlar)
            if q.get("vt") or (q.get("p") and AYAR.get(q["p"], {}).get("vt")):
                shutil.copy(vt, os.path.join(dizin, "vt.db"))
            out, _, cikis = iz_al(kod, "soru.py", list(q.get("g", [])), dizin, adim_al=False)
        finally:
            shutil.rmtree(dizin, ignore_errors=True)
        metin = out.metin()
        if "e" in q:
            tamam = cikis == 1 and (q["e"] + ":") in metin
            gercek = metin.strip().splitlines()[-1] if metin.strip() else ""
        else:
            # print(..., end=" ") satır sonuna görünmez boşluk bırakır; karşılaştırmada yok sayılır.
            satirlar = [x.rstrip() for x in metin.rstrip("\n").split("\n")]
            kip = q.get("kip", "tam")
            gercek = satirlar[-1] if kip == "son" else satirlar[0] if kip == "ilk" else "\n".join(satirlar)
            beklenen = q.get("beklenen", c[d])
            tamam = cikis == 0 and gercek == beklenen and ("beklenen" in q or c.count(gercek) == 1)
        if not tamam:
            sorun += 1
            print(f"  ✗ {ad} {no} ({q['s'][:50]}…): gerçek çıktı {gercek!r}")
    return sorun


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--vt", help="Hafta4/vt.db dosyası (veritabanı programları için)")
    ap.add_argument("--sayfa", default=SAYFA)
    ap.add_argument("--kuru", action="store_true", help="sayfaya yazma, yalnız kontrol et")
    args = ap.parse_args()
    vt = args.vt if args.vt and os.path.isfile(args.vt) else None

    with open(args.sayfa, encoding="utf-8") as f:
        sayfa = f.read()

    kodlar = {}
    for m in FIG_RE.finditer(sayfa):
        pid = m.group(2)
        k = KOD_RE.search(m.group(3))
        if not k:
            sys.exit(f"{pid}: <pre class=\"code\"><code> bloğu yok")
        if pid in kodlar:
            sys.exit(f"{pid}: aynı id iki kez kullanılmış")
        b = re.search(r"<figcaption><b>(.*?)</b>", m.group(3), re.S)
        dosya = html.unescape(b.group(1)).split("/")[-1] if b else "program.py"
        kodlar[pid] = {"kod": html.unescape(k.group(1)).rstrip("\n"), "sinif": m.group(1).split(), "dosya": dosya}

    eski = {}
    m = re.search(r'(<script type="application/json" id="izler">)(.*?)(</script>)', sayfa, re.S)
    if not m:
        sys.exit("izler bloğu yok")
    if m.group(2).strip():
        eski = json.loads(m.group(2))

    izler = {}
    for pid in kodlar:
        ayar = AYAR.get(pid)
        if ayar is None and "yaz" not in kodlar[pid]["sinif"]:
            print(f"  ! {pid}: AYAR'da yok, girdisiz çalıştırılıyor")
        if ayar is not None and ayar.get("calisma") is False:
            continue
        if (ayar or {}).get("vt") and not vt:
            if pid in eski:
                izler[pid] = eski[pid]
                print(f"  · {pid}: vt.db verilmedi, eski iz korundu")
                continue
            sys.exit(f"{pid}: vt.db gerekiyor (--vt)")
        izler[pid] = calistir(pid, kodlar, vt)
        for s in izler[pid]["s"]:
            adim = len(s.get("a", []))
            metin = "".join(p[1] for p in s["t"]).replace("\n", "⏎")
            print(f"  ✓ {pid:16} {s['ad'][:14]:14} çıkış {s['x']} · {adim:3} adım · {metin[:70]}")
    for pid in AYAR:
        if pid not in kodlar:
            print(f"  ! {pid}: AYAR'da var ama sayfada yok")

    s = re.search(r'<script type="application/json" id="sorular">(.*?)</script>', sayfa, re.S)
    sorular = json.loads(s.group(1)) if s else []
    sorun = soru_kontrol(sorular, kodlar, vt)
    s = re.search(r'<script type="application/json" id="deneme">(.*?)</script>', sayfa, re.S)
    deneme = json.loads(s.group(1)) if s else []
    sorun += soru_kontrol(deneme, kodlar, vt, ad="deneme")
    print(f"\n{len(izler)} program, {len(sorular)} test sorusu, {len(deneme)} deneme sorusu, {sorun} sorunlu soru")
    if sorun:
        sys.exit(1)

    veri = json.dumps(izler, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    yeni = sayfa[:m.start(2)] + veri + sayfa[m.end(2):]
    if args.kuru:
        print(f"kuru çalıştırma: izler {len(veri) // 1024} KB olurdu")
        return
    with open(args.sayfa, "w", encoding="utf-8") as f:
        f.write(yeni)
    print(f"izler yazıldı: {len(veri) // 1024} KB")


if __name__ == "__main__":
    main()
