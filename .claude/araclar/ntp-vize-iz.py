#!/usr/bin/env python3
"""ntp-vize sayfasının Java çıktılarını ve adım adım izlerini gerçek Java ile üretir.

Repo kökünden:
    python3 -I .claude/araclar/ntp-vize-iz.py

1. ntp-vize/index.html içindeki <figure class="prog" data-prog="..."> bloklarının kodunu okur. Bir
   figürde birden çok <pre class="code" data-dosya="Urun.java"> olabilir (IntelliJ'deki sekmeler).
2. Her programı geçici bir klasörde javac -g ile derler, AYAR'daki girdilerle Kosucu üzerinden
   çalıştırır (girdi IntelliJ konsolundaki gibi çıktının arasına yerleşir) ve istenirse Izci (JDI)
   ile satır satır izler: çağrı yığını, yerel değişkenler, nesneler, diziler, o ana kadarki çıktı.
3. Sonucu sayfadaki <script type="application/json" id="izler"> bloğuna yazar.
4. id="sorular" (test), id="derleme" (derlenir mi?) bloklarındaki kodları derleyip çalıştırır ve
   cevapları gerçek sonuçla karşılaştırır; javac'ın gerçek mesajlarını id="derleme-cikti"ya yazar.
   Tutmayan varsa sayfaya yazmadan durur.

Çıktılar Türkçe bölge ayarıyla alınır (printf %.2f → 7,50), derleyici mesajları İngilizcedir.
Sayfadaki bir kodu ya da soruyu değiştirdiğinde bu betiği yeniden çalıştır.
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
SAYFA = os.path.join(KOK, "ntp-vize", "index.html")
JAVA_KAYNAK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ntp-java")
ORTAM = {k: v for k, v in os.environ.items() if k != "JAVA_TOOL_OPTIONS"}
JVM = ["-Duser.language=tr", "-Duser.country=TR", "-Dstdout.encoding=UTF-8",
       "-Dstderr.encoding=UTF-8", "-Dfile.encoding=UTF-8", "-Xshare:auto"]
JAVAC = ["javac", "-g", "-encoding", "UTF-8", "-J-Duser.language=en", "-J-Duser.country=US"]
MAX_ADIM = 400

# Her program için: senaryolar (ad, girdi satırları, komut satırı argümanları), adım adım izlensin mi,
# en çok kaç adım. "rastgele": çıktı her çalıştırmada değişir (Random), iz alınmaz.
# "derlenmez": kod bilerek hatalı; javac mesajı gösterilir. Senaryoda "adim": False o senaryoyu izlemez.
BIR_ARAC = ["1", "22:00", "06:00", "0"]
VARDIYA = ["1", "08:00", "08:10", "1", "09:00", "09:50", "2", "10:00", "12:30",
           "3", "13:00", "18:00", "1", "22:00", "06:00", "1", "23:30", "01:15", "0"]
DEPO_MENU = ["1", "2", "U-102", "2", "U-999", "3", "U-104", "Kulaklık", "45000", "8", "3", "U-101",
             "4", "U-102", "3", "4", "U-103", "10", "6", "U-103", "5", "7", "5", "5", "9", "0"]
DEPO_DOLU = ["3", "U-104", "Kulaklık", "45000", "8", "3", "U-105", "Kablo", "1500", "40", "3", "1", "0"]
DEPO_NESNE = ["1", "2", "U-104", "Kulaklık", "abc", "2", "U-104", "Kulaklık", "45000", "8",
              "2", "U-101", "Klavye", "100", "1", "2", "U-105", "Kablo", "-5", "3",
              "3", "U-102", "10", "3", "U-102", "2", "3", "U-999", "4", "x", "7", "0"]

AYAR = {
    # 1. soru · Java'nın temelleri
    "t-merhaba": {},
    "t-hafta3": {},
    "t-hafta3-duz": {},
    "t-turler": {},
    "t-sifir": {},
    "t-tuzak": {"senaryo": [{"ad": "5 ve Kalem", "girdi": ["5", "Kalem"]}]},
    "t-tuzak-duz": {"senaryo": [{"ad": "5 ve Kalem", "girdi": ["5", "Kalem"]}]},
    "t-koli": {"senaryo": [{"ad": "2,5", "girdi": ["3", "2,5"]}, {"ad": "2.5", "girdi": ["3", "2.5"]},
                           {"ad": "2.500", "girdi": ["3", "2.500"]}]},
    "t-printf": {},
    "t-artis": {},
    "t-stok": {"senaryo": [{"ad": "0", "girdi": ["0"]}, {"ad": "3", "girdi": ["3"]}, {"ad": "12", "girdi": ["12"]}]},
    "t-equals": {"senaryo": [{"ad": "evet", "girdi": ["evet"]}, {"ad": "Evet", "girdi": ["Evet"]}]},
    "t-switch": {"senaryo": [{"ad": "1, 2, 7, 0", "girdi": ["1", "2", "7", "0"]}]},
    "t-carpim": {"senaryo": [{"ad": "5", "girdi": ["5"]}, {"ad": "3", "girdi": ["3"]}]},
    "t-tahmin": {"rastgele": True, "senaryo": [{"ad": "2 · tut: 37", "girdi": ["2", "37"]},
                                               {"ad": "2 · tut: 100", "girdi": ["2", "100"]}]},
    "t-otopark": {"senaryo": [{"ad": "örnek vardiya", "girdi": VARDIYA, "adim": False},
                              {"ad": "gece yarısı", "girdi": BIR_ARAC},
                              {"ad": "hatalı giriş", "adim": False,
                               "girdi": ["5", "1", "9.05", "10:00", "2", "08:00", "08:15", "0"]}]},
    "t-dizi": {},
    "t-hafta5": {"senaryo": [{"ad": "argümansız"}, {"ad": "elma 42", "arg": ["elma", "42"]}]},
    "t-sinir": {},
    # 2. soru · sınıf, nesne, kurucu
    "s-nesne": {},
    "s-referans": {},
    "s-katalog-null": {},
    "s-hafta6": {},
    "s-kurucu": {},
    "s-thisyok": {},
    "s-metot": {},
    "s-static": {},
    "s-kapsul": {},
    # 3. soru · istisnalar
    "i-yigin": {},
    "i-trycatch": {"senaryo": [{"ad": "25", "girdi": ["25"]}, {"ad": "yirmi", "girdi": ["yirmi"]}]},
    "i-finally": {"senaryo": [{"ad": "0 ve 4", "girdi": ["0", "4"]}, {"ad": "7 ve 2", "girdi": ["7", "2"]},
                              {"ad": "1 ve 0", "girdi": ["1", "0"]}]},
    "i-throw": {},
    "i-throws": {},
    "i-throws-hata": {"derlenmez": True},
    "i-ozel": {},
    # 4. soru · kapsamlı örnek
    "g-depo": {"adim": False, "senaryo": [{"ad": "bütün menü", "girdi": DEPO_MENU},
                                          {"ad": "kapasite dolu", "girdi": DEPO_DOLU}]},
    "g-depo-nesne": {"adim": False, "senaryo": [{"ad": "bütün menü", "girdi": DEPO_NESNE}]},
    # çıktıyı yaz
    "y-bolme": {}, "y-artis": {}, "y-dongu": {}, "y-dusme": {}, "y-dizi": {}, "y-metot": {},
    "y-nesne": {}, "y-kurucu": {}, "y-istisna": {}, "y-throw": {},
    # sınav provası: örnek cevaplar
    "p-a1": {}, "p-a2": {}, "p-a3": {},
    "p-a4": {"adim": False, "senaryo": [{"ad": "3 öğrenci", "girdi": [
        "3", "Ada", "85", "Can", "120", "Can", "45", "Ece", "yetmiş", "Ece", "70"]}]},
    "p-b1": {}, "p-b2": {}, "p-b3": {},
    "p-b4": {"adim": False, "senaryo": [{"ad": "alışveriş", "girdi": [
        "Ekmek", "1250", "2", "Süt", "abc", "Süt", "3990", "0", "Süt", "3990", "1",
        "Peynir", "18950", "1", "Çay", "9900", "1", "bitti"]}]},
}


FIG_RE = re.compile(r'<figure class="(prog[^"]*)" data-prog="([^"]+)"[^>]*>(.*?)</figure>', re.S)
PRE_RE = re.compile(r'<pre class="code"(?: data-dosya="([^"]+)")?[^>]*><code>(.*?)</code></pre>', re.S)
SARMAL = "public class Main {\n    public static void main(String[] args) {\n%s\n    }\n}\n"


def arac_derle():
    hedef = tempfile.mkdtemp(prefix="ntp-arac-")
    kaynak = sorted(glob.glob(os.path.join(JAVA_KAYNAK, "*.java")))
    r = subprocess.run(["javac", "-encoding", "UTF-8", "-d", hedef] + kaynak,
                       capture_output=True, text=True, env=ORTAM)
    if r.returncode:
        sys.exit("yardımcı Java sınıfları derlenemedi:\n" + r.stderr)
    return hedef


def dosyalari_yaz(dizin, dosyalar):
    for ad, kod in dosyalar:
        with open(os.path.join(dizin, ad), "w", encoding="utf-8", newline="\n") as f:
            f.write(kod + "\n")


def derle(dizin):
    kaynak = sorted(glob.glob(os.path.join(dizin, "*.java")))
    r = subprocess.run(JAVAC + ["-d", dizin] + kaynak, capture_output=True, text=True, env=ORTAM, timeout=180)
    mesaj = r.stderr.replace(dizin + os.sep, "")
    return r.returncode == 0, mesaj


def siniflar(dizin):
    return sorted({os.path.basename(p)[:-6] for p in glob.glob(os.path.join(dizin, "*.class"))})


def kos(arac, dizin, ana, girdi, argumanlar):
    try:
        r = subprocess.run(["java", "-cp", f"{arac}{os.pathsep}{dizin}", *JVM, "Kosucu", ana, *argumanlar],
                           input=girdi.encode("utf-8"), capture_output=True, env=ORTAM, timeout=60)
    except subprocess.TimeoutExpired:
        sys.exit(f"{dizin}: program 60 saniyede bitmedi (girdi eksik ya da sonsuz döngü?)")
    return r.stdout, r.stderr, r.returncode


def izle(arac, dizin, ana, girdi, argumanlar, en_cok):
    girdi_yolu = os.path.join(dizin, "_girdi.txt")
    with open(girdi_yolu, "w", encoding="utf-8", newline="\n") as f:
        f.write(girdi)
    onek = os.path.join(dizin, "_iz")
    r = subprocess.run(["java", "-cp", arac, "Izci", f"{arac}{os.pathsep}{dizin}", girdi_yolu, str(en_cok), onek,
                        ",".join(siniflar(dizin)), ana, *argumanlar],
                       capture_output=True, text=True, env=ORTAM, timeout=300)
    if r.returncode:
        sys.exit(f"Izci hata verdi:\n{r.stdout}\n{r.stderr}")
    with open(onek + ".json", encoding="utf-8") as f:
        iz = json.load(f)
    with open(onek + ".out", "rb") as f:
        out = f.read()
    with open(onek + ".err", "rb") as f:
        err = f.read()
    return out, err, iz


def parcala(out, err):
    """Çıktıyı [["o", metin], ["i", girdi], ["e", hata]] parçalarına ayırır; bayt→karakter haritası döner."""
    metin = out.decode("utf-8")
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
    hata = err.decode("utf-8")
    if hata:
        par.append(["e", hata])
    return par, harita


def duz(par):
    return "".join(p[1] for p in par)


def calistir_program(pid, prog, arac):
    ayar = AYAR.get(pid, {})
    dizin = tempfile.mkdtemp(prefix="ntp-")
    try:
        dosyalari_yaz(dizin, prog["dosyalar"])
        ok, mesaj = derle(dizin)
        if ayar.get("derlenmez"):
            if ok:
                sys.exit(f"{pid}: derlenmemesi gerekiyordu ama derlendi")
            return {"dosya": prog["dosyalar"][0][0], "derleme": mesaj}
        if not ok:
            sys.exit(f"{pid}: derlenmedi\n{mesaj}")
        ana = ayar.get("ana", "Main")
        senaryolar = []
        for sen in ayar.get("senaryo", [{"ad": ""}]):
            girdi = "".join(s + "\n" for s in sen.get("girdi", []))
            argumanlar = sen.get("arg", [])
            out, err, x = kos(arac, dizin, ana, girdi, argumanlar)
            par, harita = parcala(out, err)
            if b"NoSuchElementException" in err and not sen.get("girdi_biter"):
                sys.exit(f"{pid} / {sen.get('ad')}: girdi yetmedi\n{err.decode()}")
            kayit = {"ad": sen.get("ad", ""), "t": par, "x": x}
            if argumanlar:
                kayit["arg"] = argumanlar
            if ayar.get("adim", True) and not ayar.get("rastgele") and sen.get("adim", True):
                out2, err2, iz = izle(arac, dizin, ana, girdi, argumanlar, ayar.get("en_cok", MAX_ADIM))
                if (out2, err2) != (out, err) or iz["cikis"] != x:
                    sys.exit(f"{pid}: iz çalıştırması farklı çıktı verdi\n{out2!r}\n{out!r}\n{err2!r}")
                adimlar = []
                for a in iz["adimlar"]:
                    a["o"] = harita.get(a.pop("b"), 0)
                    adimlar.append(a)
                toplam = len(duz([p for p in par if p[0] != "e"]))
                son = {"f": "", "l": 0, "y": adimlar[-1]["y"] if adimlar else [], "o": toplam + len(err.decode())}
                if iz["kesildi"]:
                    son["n"] = (f"İz {len(adimlar)} adımda kesildi; program sonuna kadar çalıştı, çıktı tam. "
                                "main bitti.")
                else:
                    son["n"] = "main bitti, program sona erdi." if x == 0 else "Program istisnayla durdu (exit code 1)."
                adimlar.append(son)
                kayit["cf"] = sikistir(adimlar)
                kayit["a"] = adimlar
            senaryolar.append(kayit)
        return {"dosya": prog["dosyalar"][0][0], "s": senaryolar}
    finally:
        shutil.rmtree(dizin, ignore_errors=True)


def sikistir(adimlar):
    """Çerçeveleri kısaltır: metot, sınıf, değişken adları ve türleri senaryoda bir kez ("cf") yazılır;
    her adımda yalnız [imza no, satır, [değerler]] kalır. "f" Main.java ise yazılmaz.
    Sayfa JS'i açarken aynı tabloyu kullanır."""
    imza, tablo = {}, []
    for a in adimlar:
        if a.get("f") == "Main.java":
            del a["f"]  # varsayılan dosya; JS yokluğu Main.java sayar
        yeni = []
        for f in a["y"]:
            anahtar = (f["m"], f["s"], f.get("k", 0), tuple(v[0] for v in f["v"]), tuple(v[2] for v in f["v"]))
            if anahtar not in imza:
                imza[anahtar] = len(tablo)
                tablo.append([f["m"], f["s"], f.get("k", 0), [v[0] for v in f["v"]], [v[2] for v in f["v"]]])
            yeni.append([imza[anahtar], f["l"], [v[1] for v in f["v"]]])
        a["y"] = yeni
    return tablo


def tam_kod(k):
    """Parça kodu main'in içine sarar; baştaki import satırları sınıfın üstünde kalır."""
    if re.search(r"\bclass\s+\w+", k):
        return k
    satirlar = k.split("\n")
    importlar = []
    while satirlar and satirlar[0].startswith("import "):
        importlar.append(satirlar.pop(0))
    govde = SARMAL % "\n".join(("        " + s) if s.strip() else "" for s in satirlar)
    return ("\n".join(importlar) + "\n\n" + govde) if importlar else govde


def dene(arac, kod, girdi=(), argumanlar=()):
    """Kodu derleyip çalıştırır: ("derleme", mesaj) ya da ("calisti", çıktı, hata, çıkış kodu)."""
    dizin = tempfile.mkdtemp(prefix="ntp-soru-")
    try:
        dosyalari_yaz(dizin, [("Main.java", tam_kod(kod))])
        ok, mesaj = derle(dizin)
        if not ok:
            return ("derleme", mesaj)
        out, err, x = kos(arac, dizin, "Main", "".join(s + "\n" for s in girdi), list(argumanlar))
        # Sorularda yalnız programın yazdığı karşılaştırılır: yankılanan girdi satırları çıkarılır.
        yalin = re.sub("\x01[^\x02]*\x02\n", "", out.decode("utf-8"))
        return ("calisti", yalin, err.decode("utf-8"), x)
    finally:
        shutil.rmtree(dizin, ignore_errors=True)


def ilk_hata(mesaj):
    for s in mesaj.splitlines():
        m = re.match(r"^\S+\.java:(\d+): error: (.*)$", s)
        if m:
            return m.group(2)
    return mesaj.strip().splitlines()[0] if mesaj.strip() else ""


def istisna_adi(err):
    m = re.search(r'Exception in thread "main" ([\w.$]+)(?::\s*(.*))?', err)
    if not m:
        return None, None
    return m.group(1).split(".")[-1], (m.group(2) or "").strip()


def soru_kontrol(sorular, programlar, arac, ad="soru"):
    """Kodlu soruları çalıştırır. "k" gösterilen kod, "kk" gösterilmeyen kontrol kodu, "p" sayfadaki program.
    Beklenti: "e" istisna adı · "derleme" javac mesajından bir parça · yoksa doğru şık çıktıyla birebir."""
    isler = []
    sorun = 0
    for no, q in enumerate(sorular, 1):
        c, d = q["c"], q["d"]
        if not (0 <= d < len(c)) or len(set(c)) != len(c):
            print(f"  ✗ {ad} {no}: şıklar ya da doğru indeks hatalı")
            sorun += 1
            continue
        if "k" not in q and "kk" not in q and "p" not in q:
            continue
        isler.append((no, q))

    def tek(is_):
        no, q = is_
        if q.get("p"):
            return no, q, None
        return no, q, dene(arac, q.get("kk") or q["k"], q.get("g", []), q.get("arg", []))

    with cf.ThreadPoolExecutor(max_workers=6) as ex:
        sonuclar = list(ex.map(tek, isler))
    for no, q, r in sonuclar:
        c, d = q["c"], q["d"]
        if r is None:
            sen = programlar[q["p"]]["s"][q.get("sen", 0)]
            r = ("calisti", duz([p for p in sen["t"] if p[0] != "e"]),
                 "".join(p[1] for p in sen["t"] if p[0] == "e"), sen["x"])
        if "derleme" in q:
            tamam = r[0] == "derleme" and q["derleme"] in r[1]
            gercek = ilk_hata(r[1]) if r[0] == "derleme" else "derlendi"
        elif r[0] == "derleme":
            tamam, gercek = False, "DERLENMEDİ: " + ilk_hata(r[1])
        elif "e" in q:
            adi, _ = istisna_adi(r[2])
            tamam = r[3] == 1 and adi == q["e"]
            gercek = f"{adi} (çıkış {r[3]})"
        else:
            satirlar = [x.rstrip() for x in r[1].rstrip("\n").split("\n")]
            kip = q.get("kip", "tam")
            gercek = satirlar[-1] if kip == "son" else satirlar[0] if kip == "ilk" else "\n".join(satirlar)
            beklenen = q.get("beklenen", c[d])
            tamam = r[3] == 0 and gercek == beklenen and ("beklenen" in q or c.count(gercek) == 1)
        if not tamam:
            print(f"  ✗ {ad} {no} ({q['s'][:50]}…): gerçek {gercek!r}")
            sorun += 1
    return sorun


def derleme_kontrol(kartlar, arac):
    """Derlenir mi? kartları: "b" beklenen sonuç (derlenmez / coker / calisir), "m" mesajdan bir parça."""
    sorun = 0
    cikti = []

    def tek(kart):
        return dene(arac, kart["k"], kart.get("g", []))

    with cf.ThreadPoolExecutor(max_workers=6) as ex:
        sonuclar = list(ex.map(tek, kartlar))
    for no, (kart, r) in enumerate(zip(kartlar, sonuclar), 1):
        if r[0] == "derleme":
            sonuc, mesaj = "derlenmez", ilk_hata(r[1])
        elif r[3] != 0:
            adi, msj = istisna_adi(r[2])
            sonuc, mesaj = "coker", (r[1] + "Exception in thread \"main\" " + r[2].split("Exception in thread \"main\" ", 1)[-1].split("\n")[0]).strip()
        else:
            sonuc, mesaj = "calisir", r[1].rstrip("\n")
        tamam = sonuc == kart["b"] and kart.get("m", "") in mesaj
        if not tamam:
            print(f"  ✗ derleme {no}: beklenen {kart['b']} / {kart.get('m')!r}, gerçek {sonuc} / {mesaj!r}")
            sorun += 1
        cikti.append({"b": sonuc, "m": mesaj})
    return sorun, cikti


def blok_yaz(sayfa, kimlik, veri):
    m = re.search(r'(<script type="application/json" id="%s">)(.*?)(</script>)' % kimlik, sayfa, re.S)
    if not m:
        sys.exit(f"{kimlik} bloğu yok")
    metin = json.dumps(veri, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    return sayfa[:m.start(2)] + metin + sayfa[m.end(2):], len(metin)


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
        dosyalar = [((ad or "Main.java"), html.unescape(kod).rstrip("\n")) for ad, kod in PRE_RE.findall(m.group(3))]
        if not dosyalar:
            sys.exit(f'{pid}: <pre class="code"><code> bloğu yok')
        programlar[pid] = {"dosyalar": dosyalar, "sinif": m.group(1).split()}

    arac = arac_derle()
    try:
        eski = blok_oku(sayfa, "izler", {})
        secili = set(args.yalniz.split(",")) if args.yalniz else None
        izler = {}

        def tek(pid):
            if secili is not None and pid not in secili:
                return pid, eski.get(pid)
            return pid, calistir_program(pid, programlar[pid], arac)

        with cf.ThreadPoolExecutor(max_workers=4) as ex:
            for pid, iz in ex.map(tek, list(programlar)):
                if iz is None:
                    continue
                izler[pid] = iz
                if "derleme" in iz:
                    print(f"  ✓ {pid:18} derlenmedi (beklenen) · {ilk_hata(iz['derleme'])[:60]}")
                    continue
                for s in iz["s"]:
                    adim = len(s.get("a", []))
                    metin = duz(s["t"]).replace("\n", "⏎")
                    print(f"  ✓ {pid:18} {s['ad'][:14]:14} çıkış {s['x']} · {adim:3} adım · {metin[:64]}")
        for pid in AYAR:
            if pid not in programlar:
                print(f"  ! {pid}: AYAR'da var ama sayfada yok")
        for pid in programlar:
            if pid not in AYAR and "yaz" not in programlar[pid]["sinif"]:
                print(f"  ! {pid}: AYAR'da yok, girdisiz çalıştırıldı")

        sorular = blok_oku(sayfa, "sorular", [])
        sorun = soru_kontrol(sorular, izler, arac)
        kartlar = blok_oku(sayfa, "derleme", [])
        s2, derleme_cikti = derleme_kontrol(kartlar, arac)
        sorun += s2
    finally:
        shutil.rmtree(arac, ignore_errors=True)

    print(f"\n{len(izler)} program, {len(sorular)} test sorusu, {len(kartlar)} derlenir mi kartı, {sorun} sorun")
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
