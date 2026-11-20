/*
 * ortak.js · Görev hatırlatıcısının ortak çekirdeği
 *
 * Bu dosyayı iki taraf kullanır:
 *  - sitedeki görev sayfası (tarayıcı),
 *  - GitHub Actions'ta çalışan Telegram hatırlatıcısı (Node).
 * İçinde Türkçe tarih/saat ayrıştırma, tekrar eden görevler, görev işlemleri,
 * hatırlatma planı ve ortak biçimlendirme var.
 *
 * Bütün saatler Türkiye saatidir. Türkiye 2016'dan beri yaz saati uygulamıyor,
 * saat sabit UTC+3.
 */

export const SAAT_FARKI = 3 * 3600e3;
export const VERI_SURUMU = 1;
/** Hatırlatmalar en çok bu kadar erken gider (zamanlanmış çalışma 5 dakikada bir). */
export const ONBAKIS = 5 * 60e3;
/** Bundan daha eski kaçmış hatırlatma gönderilmez; görev özetlerde görünür. */
export const GEC_SINIR = 6 * 3600e3;
export const COP_SINIRI = 30;

export const VARSAYILAN_AYARLAR = {
  sabahOzeti: '08:00',
  aksamOzeti: '21:00',
  varsayilanHatirlatma: [60, 0],
  kategoriler: ['Okul', 'İş', 'Kişisel'],
  hitap: 'Başkan',
};

export function bosVeri() {
  return {
    surum: VERI_SURUMU,
    ayarlar: JSON.parse(JSON.stringify(VARSAYILAN_AYARLAR)),
    sayac: 0,
    gorevler: [],
    cop: [],
    telegram: { chatId: null, ad: null, kod: null, kodSonu: null },
    durum: { tgSon: 0, gonderilen: {}, bot: null, saglik: {} },
  };
}

/** Eksik alanları tamamlar (eski ya da elle düzenlenmiş dosyalar için). */
export function veriDuzelt(v) {
  const t = v && typeof v === 'object' && !Array.isArray(v) ? v : bosVeri();
  const bos = bosVeri();
  t.surum = t.surum || VERI_SURUMU;
  t.ayarlar = { ...bos.ayarlar, ...(t.ayarlar || {}) };
  t.sayac = Number.isFinite(t.sayac) ? t.sayac : 0;
  t.gorevler = Array.isArray(t.gorevler) ? t.gorevler.filter((g) => g && g.id) : [];
  t.cop = Array.isArray(t.cop) ? t.cop.filter((c) => c && c.gorev && c.gorev.id) : [];
  t.telegram = { ...bos.telegram, ...(t.telegram || {}) };
  t.durum = { ...bos.durum, ...(t.durum || {}) };
  if (!t.durum.gonderilen || typeof t.durum.gonderilen !== 'object') t.durum.gonderilen = {};
  for (const g of [...t.gorevler, ...t.cop.map((c) => c.gorev)]) if (Number.isFinite(g.no) && g.no > t.sayac) t.sayac = g.no;
  return t;
}

/* ───────── Türkiye saati ───────── */

const iki = (n) => String(n).padStart(2, '0');
export const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
export const GUNLER = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

/** Bir anın Türkiye saatindeki parçaları. hg: haftanın günü (0 = Pazar). */
export function yerel(d) {
  const t = new Date(d.getTime() + SAAT_FARKI);
  return { y: t.getUTCFullYear(), a: t.getUTCMonth() + 1, g: t.getUTCDate(), sa: t.getUTCHours(), dk: t.getUTCMinutes(), hg: t.getUTCDay() };
}
export const yerelTarih = (y, a, g, sa = 0, dk = 0) => new Date(Date.UTC(y, a - 1, g, sa, dk) - SAAT_FARKI);
export function isoYaz(d) {
  const p = yerel(d);
  return `${p.y}-${iki(p.a)}-${iki(p.g)}T${iki(p.sa)}:${iki(p.dk)}:00+03:00`;
}
export function gunAnahtari(d) {
  const p = yerel(d);
  return `${p.y}-${iki(p.a)}-${iki(p.g)}`;
}
export function gunBasi(d) {
  const p = yerel(d);
  return yerelTarih(p.y, p.a, p.g);
}
export const gunEkle = (d, n) => new Date(d.getTime() + n * 86400e3);
export const ayGunSayisi = (y, a) => new Date(Date.UTC(y, a, 0)).getUTCDate();
export function saatMetni(d) {
  const p = yerel(d);
  return `${iki(p.sa)}:${iki(p.dk)}`;
}
const gunParcalari = (d) => {
  const p = yerel(d);
  return [p.y, p.a, p.g];
};

/** "Bugün 14:00", "Yarın", "Cuma 09:30", "3 Aralık Perşembe 10:00". */
export function tarihMetni(d, simdi, tumGun = false) {
  const fark = Math.round((gunBasi(d) - gunBasi(simdi)) / 86400e3);
  const p = yerel(d);
  let gun;
  if (fark === 0) gun = 'Bugün';
  else if (fark === 1) gun = 'Yarın';
  else if (fark === -1) gun = 'Dün';
  else if (fark > 1 && fark < 7) gun = GUNLER[p.hg];
  else gun = `${p.g} ${AYLAR[p.a - 1]}${p.y !== yerel(simdi).y ? ' ' + p.y : ''} ${GUNLER[p.hg]}`;
  return tumGun ? gun : `${gun} ${iki(p.sa)}:${iki(p.dk)}`;
}

/** "25 dk sonra", "1 sa 30 dk sonra", "3 saat önce", "2 gün sonra". */
export function goreceMetin(d, simdi) {
  const ms = d - simdi;
  const dk = Math.round(Math.abs(ms) / 60000);
  if (dk < 1) return 'şimdi';
  let m;
  if (dk < 60) m = `${dk} dk`;
  else if (dk < 1410) {
    const sa = Math.floor(dk / 60);
    const kalan = dk % 60;
    m = sa < 3 && kalan >= 5 && kalan <= 55 ? `${sa} sa ${kalan} dk` : `${Math.round(dk / 60)} saat`;
  } else m = `${Math.round(dk / 1440)} gün`;
  return ms < 0 ? `${m} önce` : `${m} sonra`;
}

/* ───────── metin parçaları ───────── */

function sayiEki(n) {
  // 1'i, 2'si, 3'ü, 4'ü, 5'i, 6'sı, 7'si, 8'i, 9'u, 10'u, 20'si, 30'u
  const son = n % 10;
  if (son === 0) return { 1: 'u', 2: 'si', 3: 'u' }[Math.floor(n / 10) % 10] || 'u';
  return { 1: 'i', 2: 'si', 3: 'ü', 4: 'ü', 5: 'i', 6: 'sı', 7: 'si', 8: 'i', 9: 'u' }[son];
}

const pazartesiSira = (x) => (x + 6) % 7;

export function tekrarMetni(t) {
  if (!t) return '';
  const n = t.aralik && t.aralik > 1 ? t.aralik : 1;
  switch (t.tur) {
    case 'gun':
      return n > 1 ? `${n} günde bir` : 'Her gün';
    case 'hafta': {
      const gunler = (t.gunler || []).slice().sort((a, b) => pazartesiSira(a) - pazartesiSira(b));
      if (gunler.length === 5 && [1, 2, 3, 4, 5].every((x) => gunler.includes(x))) return 'Hafta içi her gün';
      if (gunler.length === 2 && gunler.includes(6) && gunler.includes(0)) return 'Her hafta sonu';
      if (gunler.length === 7) return 'Her gün';
      if (gunler.length) return 'Her ' + gunler.map((x) => GUNLER[x]).join(', ');
      return n > 1 ? `${n} haftada bir` : 'Her hafta';
    }
    case 'ay':
      if (t.ayGunu >= 31) return 'Her ayın son günü';
      if (t.ayGunu) return `Her ayın ${t.ayGunu}'${sayiEki(t.ayGunu)}`;
      return n > 1 ? `${n} ayda bir` : 'Her ay';
    case 'yil':
      return n > 1 ? `${n} yılda bir` : 'Her yıl';
    default:
      return '';
  }
}

export function sureMetni(m) {
  if (m === 0) return 'zamanında';
  if (m % 1440 === 0) return `${m / 1440} gün önce`;
  if (m % 60 === 0) return `${m / 60} saat önce`;
  return `${m} dk önce`;
}

export function hatirlatmaMetni(dakikalar) {
  if (!dakikalar || !dakikalar.length) return 'yalnız günlük özet';
  return dakikalar
    .slice()
    .sort((a, b) => b - a)
    .map(sureMetni)
    .join(', ');
}

export const ONCELIKLER = { yuksek: 'Yüksek', normal: 'Normal', dusuk: 'Düşük' };

/* ───────── tekrar eden görevler ───────── */

function tekrarAdimi(t, d) {
  const n = t.aralik && t.aralik > 1 ? t.aralik : 1;
  const p = yerel(d);
  switch (t.tur) {
    case 'gun':
      return gunEkle(d, n);
    case 'hafta': {
      if (t.gunler && t.gunler.length) {
        let s = gunEkle(d, 1);
        for (let i = 0; i < 8 && !t.gunler.includes(yerel(s).hg); i++) s = gunEkle(s, 1);
        return s;
      }
      return gunEkle(d, 7 * n);
    }
    case 'ay': {
      let a = p.a + n;
      let y = p.y;
      while (a > 12) {
        a -= 12;
        y++;
      }
      return yerelTarih(y, a, Math.min(t.ayGunu || p.g, ayGunSayisi(y, a)), p.sa, p.dk);
    }
    case 'yil':
      return yerelTarih(p.y + n, p.a, Math.min(p.g, ayGunSayisi(p.y + n, p.a)), p.sa, p.dk);
    default:
      return null;
  }
}

/** Tekrar eden görevin şu andan sonraki ilk zamanı. */
export function sonrakiZaman(g, simdi) {
  if (!g.tekrar || !g.zaman) return null;
  let s = tekrarAdimi(g.tekrar, new Date(g.zaman));
  for (let i = 0; s && s <= simdi && i < 5000; i++) s = tekrarAdimi(g.tekrar, s);
  return s;
}

/**
 * Tamamlanmadan geçen tekrarları ilerletir: "her gün 22:00 ilaç" işaretlenmese de
 * ertesi gün yine hatırlatılır. Sonraki tekrarın günü başladığında (ya da ilk
 * hatırlatması yaklaştığında) görev bir sonraki zamana geçer.
 * Site de bot da aynı kuralı uygular; sonuç belirlenimlidir.
 */
export function tekrarIlerlet(veri, simdi, onBakis = ONBAKIS) {
  const degisen = [];
  const t = simdi.getTime();
  for (const g of veri.gorevler) {
    if (g.durum === 'bitti' || !g.tekrar || !g.zaman) continue;
    let z = new Date(g.zaman);
    if (z.getTime() > t) continue;
    const enErken = Math.max(0, ...(g.hatirlat || [])) * 60000;
    let s = tekrarAdimi(g.tekrar, z);
    let n = 0;
    while (s && Math.min(gunBasi(s).getTime(), s.getTime() - enErken - onBakis) <= t && n < 5000) {
      z = s;
      s = tekrarAdimi(g.tekrar, z);
      n++;
    }
    if (n) {
      g.zaman = isoYaz(z);
      g.kacirilan = (g.kacirilan || 0) + n;
      g.ertele = null;
      delete g.oncekiZaman;
      degisen.push(g);
    }
  }
  return degisen;
}

/* ───────── görev işlemleri (site ve bot aynı kuralları kullanır) ───────── */

export function yeniKimlik() {
  const a = new Uint8Array(6);
  if (globalThis.crypto && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(a);
  else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
  return Array.from(a, (b) => (b % 36).toString(36)).join('') + Date.now().toString(36).slice(-2);
}

function normalGorev(g, ayarlar) {
  const x = {
    id: String(g.id),
    no: g.no,
    baslik: String(g.baslik || '').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Görev',
    not: String(g.not || '').slice(0, 2000),
    kategori: g.kategori ? String(g.kategori).trim().slice(0, 40) || null : null,
    oncelik: ONCELIKLER[g.oncelik] ? g.oncelik : 'normal',
    zaman: g.zaman && !Number.isNaN(new Date(g.zaman).getTime()) ? isoYaz(new Date(g.zaman)) : null,
    tumGun: false,
    hatirlat: Array.isArray(g.hatirlat) ? [...new Set(g.hatirlat.map(Number).filter((m) => Number.isInteger(m) && m >= 0 && m <= 43200))].sort((a, b) => b - a) : null,
    tekrar: null,
    durum: g.durum === 'bitti' ? 'bitti' : 'acik',
    olusturma: g.olusturma,
    guncelleme: g.guncelleme,
    bitis: g.durum === 'bitti' ? g.bitis || null : null,
    ertele: g.ertele || null,
  };
  x.tumGun = !!(x.zaman && g.tumGun);
  x.tekrar = x.zaman && g.tekrar && g.tekrar.tur ? g.tekrar : null;
  if (x.hatirlat === null) x.hatirlat = x.zaman && !x.tumGun ? [...(ayarlar.varsayilanHatirlatma || [60, 0])] : [];
  if (!x.zaman) x.hatirlat = [];
  for (const k of ['sonTamamlanma', 'tamamlanmaSayisi', 'oncekiZaman', 'kacirilan', 'kaynak', 'zamanAyari']) if (g[k] !== undefined && g[k] !== null) x[k] = g[k];
  return x;
}

export function gorevBul(veri, kimlikVeyaNo) {
  const s = String(kimlikVeyaNo).trim().replace(/^#/, '');
  return veri.gorevler.find((g) => g.id === s) || veri.gorevler.find((g) => String(g.no) === s) || null;
}

export function gorevEkle(veri, alanlar, simdi, kimlik) {
  const var_ = kimlik && veri.gorevler.find((g) => g.id === kimlik);
  if (var_) return var_;
  if (kimlik && veri.cop.some((c) => c.gorev.id === kimlik)) return null; // eklenip silinmiş; yeniden doğmasın
  veri.sayac = (veri.sayac || 0) + 1;
  const zaman = isoYaz(simdi);
  const g = normalGorev({ ...alanlar, id: kimlik || yeniKimlik(), no: veri.sayac, durum: 'acik', olusturma: zaman, guncelleme: zaman }, veri.ayarlar);
  if (g.zaman) g.zamanAyari = zaman; // bu andan önceki hatırlatmalar gönderilmez
  veri.gorevler.push(g);
  return g;
}

export function gorevGuncelle(veri, id, alanlar, simdi) {
  const i = veri.gorevler.findIndex((g) => g.id === id);
  if (i < 0) return null;
  const eski = veri.gorevler[i];
  const zamanDegisti = 'zaman' in alanlar && (alanlar.zaman ? isoYaz(new Date(alanlar.zaman)) : null) !== eski.zaman;
  const yeni = normalGorev({ ...eski, ...alanlar, id: eski.id, no: eski.no, olusturma: eski.olusturma, guncelleme: isoYaz(simdi) }, veri.ayarlar);
  if (zamanDegisti) {
    yeni.ertele = null;
    delete yeni.oncekiZaman;
    delete yeni.kacirilan;
    yeni.zamanAyari = isoYaz(simdi);
  }
  veri.gorevler[i] = yeni;
  return yeni;
}

/** Tamamlar. Tekrar eden görev bitmez, bir sonraki zamanına geçer. */
export function tamamla(veri, id, simdi) {
  const g = gorevBul(veri, id);
  if (!g || g.durum === 'bitti') return null;
  g.guncelleme = isoYaz(simdi);
  g.ertele = null;
  if (g.tekrar && g.zaman) {
    const s = sonrakiZaman(g, simdi);
    g.oncekiZaman = g.zaman;
    g.zaman = isoYaz(s);
    g.sonTamamlanma = isoYaz(simdi);
    g.tamamlanmaSayisi = (g.tamamlanmaSayisi || 0) + 1;
    g.kacirilan = 0;
    return { gorev: g, tekrar: true };
  }
  g.durum = 'bitti';
  g.bitis = isoYaz(simdi);
  return { gorev: g, tekrar: false };
}

export function geriAl(veri, id, simdi) {
  const g = gorevBul(veri, id);
  if (!g) return null;
  if (g.durum === 'bitti') {
    g.durum = 'acik';
    g.bitis = null;
  } else if (g.tekrar && g.oncekiZaman) {
    g.zaman = g.oncekiZaman;
    delete g.oncekiZaman;
    g.tamamlanmaSayisi = Math.max(0, (g.tamamlanmaSayisi || 1) - 1);
  } else return null;
  g.guncelleme = isoYaz(simdi);
  return g;
}

/** Siler; görev çöp kutusuna gider (son 30 silinen geri alınabilir). */
export function gorevSil(veri, id, simdi = new Date()) {
  const g = gorevBul(veri, id);
  if (!g) return null;
  veri.gorevler = veri.gorevler.filter((x) => x !== g);
  veri.cop = [{ gorev: g, silinme: isoYaz(simdi) }, ...veri.cop.filter((c) => c.gorev.id !== g.id)].slice(0, COP_SINIRI);
  return g;
}

export function copGeriAl(veri, id, simdi) {
  const s = String(id).replace(/^#/, '');
  const c = veri.cop.find((x) => x.gorev.id === s) || veri.cop.find((x) => String(x.gorev.no) === s);
  if (!c) return null;
  veri.cop = veri.cop.filter((x) => x !== c);
  if (veri.gorevler.some((g) => g.id === c.gorev.id)) return null;
  const g = { ...c.gorev, guncelleme: isoYaz(simdi) };
  veri.gorevler.push(g);
  return g;
}

export function ertele(veri, id, zaman, simdi) {
  const g = gorevBul(veri, id);
  if (!g || g.durum === 'bitti' || !zaman || Number.isNaN(zaman.getTime())) return null;
  g.guncelleme = isoYaz(simdi);
  if (!g.tekrar && (!g.zaman || new Date(g.zaman) <= simdi || zaman >= new Date(g.zaman))) {
    // Tek seferlik görev ertelenince doğrudan yeni zamanına taşınır.
    g.zaman = isoYaz(zaman);
    g.zamanAyari = isoYaz(simdi);
    g.tumGun = false;
    g.ertele = null;
    if (!g.hatirlat || !g.hatirlat.length) g.hatirlat = [0];
    else if (!g.hatirlat.includes(0)) g.hatirlat = [...g.hatirlat, 0];
    g.hatirlat = g.hatirlat.filter((m) => new Date(g.zaman).getTime() - m * 60000 > simdi.getTime() || m === 0);
  } else g.ertele = isoYaz(zaman);
  return g;
}

/** Sitenin kayıt kuyruğundaki ve botun işlemleri en güncel veriye bu fonksiyonla uygulanır. */
export function islemUygula(veri, islem, simdi) {
  switch (islem.tur) {
    case 'ekle':
      return gorevEkle(veri, islem.alanlar, simdi, islem.id);
    case 'guncelle':
      return gorevGuncelle(veri, islem.id, islem.alanlar, simdi);
    case 'tamamla':
      return tamamla(veri, islem.id, simdi);
    case 'geriAl':
      return geriAl(veri, islem.id, simdi);
    case 'sil':
      return gorevSil(veri, islem.id, simdi);
    case 'copGeriAl':
      return copGeriAl(veri, islem.id, simdi);
    case 'copBosalt':
      veri.cop = [];
      return true;
    case 'ertele':
      return ertele(veri, islem.id, new Date(islem.zaman), simdi);
    case 'ayarlar':
      veri.ayarlar = { ...veri.ayarlar, ...islem.alanlar };
      return veri.ayarlar;
    case 'telegram':
      veri.telegram = { ...veri.telegram, ...islem.alanlar };
      return veri.telegram;
    default:
      return null;
  }
}

/* ───────── listeler ve hatırlatma planı ───────── */

/** Açık görevleri gruplar: geciken, bugün, yarın, hafta (7 gün), sonra, tarihsiz. */
export function grupla(veri, simdi) {
  const bugun = gunAnahtari(simdi);
  const yarin = gunAnahtari(gunEkle(simdi, 1));
  const haftaSonu = gunAnahtari(gunEkle(simdi, 7));
  const s = { geciken: [], bugun: [], yarin: [], hafta: [], sonra: [], tarihsiz: [] };
  for (const g of veri.gorevler) {
    if (g.durum === 'bitti') continue;
    if (!g.zaman) {
      s.tarihsiz.push(g);
      continue;
    }
    const z = new Date(g.zaman);
    const k = gunAnahtari(z);
    if (k < bugun || (!g.tumGun && z < simdi)) s.geciken.push(g);
    else if (k === bugun) s.bugun.push(g);
    else if (k === yarin) s.yarin.push(g);
    else if (k < haftaSonu) s.hafta.push(g);
    else s.sonra.push(g);
  }
  const onc = { yuksek: 0, normal: 1, dusuk: 2 };
  const zamanSira = (a, b) =>
    gunAnahtari(new Date(a.zaman)).localeCompare(gunAnahtari(new Date(b.zaman))) ||
    (a.tumGun ? 1 : 0) - (b.tumGun ? 1 : 0) ||
    new Date(a.zaman) - new Date(b.zaman) ||
    onc[a.oncelik] - onc[b.oncelik] ||
    a.no - b.no;
  for (const k of ['geciken', 'bugun', 'yarin', 'hafta', 'sonra']) s[k].sort(zamanSira);
  s.tarihsiz.sort((a, b) => onc[a.oncelik] - onc[b.oncelik] || a.no - b.no);
  return s;
}

/**
 * Şu an gönderilmesi gereken görev hatırlatmaları (daha önce gönderilenler hariç).
 * Aynı görevin birden çok hatırlatması birikmişse hepsi döner; gönderen taraf
 * görev başına tek mesaj atar ve hepsini gönderildi sayar.
 */
export function hatirlatmaPlani(veri, simdi, onBakis = ONBAKIS) {
  const t = simdi.getTime();
  const plan = [];
  for (const g of veri.gorevler) {
    if (g.durum === 'bitti' || !g.zaman) continue;
    const z = new Date(g.zaman).getTime();
    const ert = g.ertele ? new Date(g.ertele).getTime() : 0;
    const ayar = g.zamanAyari ? new Date(g.zamanAyari).getTime() : 0;
    for (const m of g.hatirlat || []) {
      const an = z - m * 60000;
      if (ert && an < ert) continue; // erteleme bu hatırlatmanın yerini aldı
      if (an < ayar) continue; // zaman verildiğinde zaten geçmiş olan hatırlatma
      if (an <= t + onBakis && an >= t - GEC_SINIR) plan.push({ anahtar: `${g.id}|${g.zaman}|${m}`, gorev: g, dakika: m, an });
    }
    if (ert && ert <= t + onBakis && ert >= t - GEC_SINIR) plan.push({ anahtar: `${g.id}|E|${g.ertele}`, gorev: g, dakika: null, ertele: true, an: ert });
  }
  return plan.filter((p) => !veri.durum.gonderilen[p.anahtar]).sort((a, b) => a.an - b.an);
}

/** Zamanı gelen günlük özetler ("sabah", "aksam"). */
export function ozetPlani(veri, simdi, onBakis = ONBAKIS) {
  const sonuc = [];
  const p = yerel(simdi);
  for (const [tur, saat] of [
    ['sabah', veri.ayarlar.sabahOzeti],
    ['aksam', veri.ayarlar.aksamOzeti],
  ]) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(saat || '');
    if (!m) continue;
    const an = yerelTarih(p.y, p.a, p.g, +m[1], +m[2]).getTime();
    const anahtar = `ozet|${tur}|${gunAnahtari(simdi)}`;
    if (veri.durum.gonderilen[anahtar]) continue;
    if (simdi.getTime() + onBakis >= an && simdi.getTime() < an + 3 * 3600e3) sonuc.push({ tur, anahtar, an });
  }
  return sonuc;
}

/** 60 günden eski tamamlanmış görevleri siler; veri dosyası zamanla şişmesin. */
export function bitenleriBuda(veri, simdi, gun = 60) {
  const sinir = simdi.getTime() - gun * 86400e3;
  const once = veri.gorevler.length;
  veri.gorevler = veri.gorevler.filter((g) => !(g.durum === 'bitti' && g.bitis && new Date(g.bitis).getTime() < sinir));
  return once - veri.gorevler.length;
}

/** Eski "gönderildi" kayıtlarını temizler (4 günden eski). */
export function gonderilenTemizle(veri, simdi) {
  const sinir = simdi.getTime() - 4 * 86400e3;
  for (const [k, v] of Object.entries(veri.durum.gonderilen)) if (!(new Date(v).getTime() >= sinir)) delete veri.durum.gonderilen[k];
}

/* ───────── Türkçe ayrıştırıcı ───────── */

const H = '\\p{L}\\p{N}';
const B = `(?<![${H}])`; // kelime başı (Türkçe harfleri de tanır)
const S = `(?![${H}])`; // kelime sonu
const GUN_RE = '(pazartesi|salı|sali|çarşamba|carsamba|perşembe|persembe|cumartesi|cuma|pazar)';
const AY_RE = '(ocak|şubat|subat|mart|nisan|mayıs|mayis|haziran|temmuz|ağustos|agustos|eylül|eylul|ekim|kasım|kasim|aralık|aralik)';
const GUN_NO = { pazar: 0, pazartesi: 1, salı: 2, sali: 2, çarşamba: 3, carsamba: 3, perşembe: 4, persembe: 4, cuma: 5, cumartesi: 6 };
const AY_NO = { ocak: 1, şubat: 2, subat: 2, mart: 3, nisan: 4, mayıs: 5, mayis: 5, haziran: 6, temmuz: 7, ağustos: 8, agustos: 8, eylül: 9, eylul: 9, ekim: 10, kasım: 11, kasim: 11, aralık: 12, aralik: 12 };
const SAYI = { yarım: 0.5, bir: 1, iki: 2, üç: 3, dört: 4, beş: 5, altı: 6, yedi: 7, sekiz: 8, dokuz: 9, on: 10, onbeş: 15, 'on beş': 15, yirmi: 20, otuz: 30, kırk: 40, kırkbeş: 45, 'kırk beş': 45, doksan: 90 };
const SAYI_RE = '(\\d+(?:[.,]\\d+)?|yarım|on\\s+beş|kırk\\s+beş|onbeş|kırkbeş|bir|iki|üç|dört|beş|altı|yedi|sekiz|dokuz|on|yirmi|otuz|kırk|doksan)';
const BIRIM = { dk: 1, dak: 1, dakika: 1, sa: 60, saat: 60, gün: 1440, hafta: 10080 };
const YER = `(?:\\s*['’]?\\s*(?:d[ae]|t[ae]|y?[ae]))?`; // 14:30'da, 9 da, 8'e
const KADAR = '(?:\\s+kadar)?';
const GUN_EK = `(\\s*['’]?\\s*(?:y?[ae]|d[ae]|t[ae]|y?[ıiuü]n?d[ae]|n?[ıiuü]n|s[ıiuü]))?`;
const AY_EK = `(?:\\s*['’]\\s*\\p{L}+|(?:t[ae]|d[ae]|y?[ae]|n[ae]|nd[ae]|[ıiuü]n(?:d[ae])?|ki))?`;
const DP_SAYI = `(?:\\s+(?:saat\\s*)?(\\d{1,2})(?:[:.](\\d{2}))?${YER})?`;
const GUN_PARCALARI = { sabah: [9, 0], öğle: [12, 0], öğlen: [12, 0], 'öğleden sonra': [15, 0], ikindi: [16, 0], akşam: [19, 0], gece: [22, 0], 'gece yarısı': [23, 59] };

function sayi(s) {
  const k = String(s).replace(/\s+/g, ' ');
  if (k in SAYI) return SAYI[k];
  return parseFloat(k.replace(',', '.'));
}

/**
 * Serbest Türkçe metinden görev çıkarır.
 * "yarın 14:00 veritabanı ödevi #okul !" → { baslik, zaman, tumGun, tekrar, kategori, oncelik, hatirlat, not }
 * zaman ISO metnidir (+03:00) ya da null. "metin // not" biçiminde not eklenebilir.
 */
export function ayristir(girdi, simdi = new Date(), ayarlar = VARSAYILAN_AYARLAR) {
  const parcalar = String(girdi || '').split(/\s+\/\/\s+/);
  const orj = parcalar[0].replace(/\s+/g, ' ');
  const not = parcalar.slice(1).join(' // ').trim();
  let K = orj.toLocaleLowerCase('tr-TR');
  if (K.length !== orj.length) K = orj.toLowerCase();
  let O = orj;
  const tuket = (bas, son) => {
    K = K.slice(0, bas) + ' '.repeat(son - bas) + K.slice(son);
    O = O.slice(0, bas) + ' '.repeat(son - bas) + O.slice(son);
  };
  const hepsi = (kaynak) => [...K.matchAll(new RegExp(kaynak, 'gu'))];
  const ilk = (kaynak) => new RegExp(kaynak, 'u').exec(K);
  const al = (m) => tuket(m.index, m.index + m[0].length);

  const r = { baslik: '', zaman: null, tumGun: false, tekrar: null, kategori: null, oncelik: 'normal', hatirlat: null, not };
  let gun = null; // yerel gece yarısı (Date)
  let saat = null; // [sa, dk]
  let ciplak = false; // "9'da", "saat 3" gibi öğleden önce/sonra belirsiz saat
  let gunParcasi = null;
  let goreli = null;
  let haftaGunu = null;
  let m;

  // kategori: #okul
  for (const x of hepsi(`#(\\p{L}[${H}_-]*)`)) {
    const ad = x[1];
    const kayitli = (ayarlar.kategoriler || []).find((k) => k.toLocaleLowerCase('tr-TR') === ad);
    r.kategori = kayitli || O.charAt(x.index + 1).toLocaleUpperCase('tr-TR') + O.slice(x.index + 2, x.index + x[0].length);
    al(x);
  }
  // öncelik: ! tek başına, ya da kelime sonunda !! / !!!
  for (const x of hepsi('(?<!\\S)!{1,3}(?!\\S)|!{2,3}(?!\\S)')) {
    r.oncelik = 'yuksek';
    al(x);
  }
  // hatırlatma: "1 saat önce hatırlat", "30 dk önceden haber ver", "sessiz"
  if ((m = ilk(`${B}${SAYI_RE}\\s*(dk|dak|dakika|sa|saat|gün)\\s*önce(?:den)?\\s*(?:hatırlat\\p{L}*|haber\\s+ver\\p{L}*)${S}`))) {
    r.hatirlat = [Math.round(sayi(m[1]) * BIRIM[m[2]]), 0];
    al(m);
  } else if ((m = ilk(`${B}(?:sessiz|hatırlatma(?:sız|\\s+yok))${S}`))) {
    r.hatirlat = [];
    al(m);
  }

  // tekrar
  if ((m = ilk(`${B}(?:her\\s+)?hafta\\s*içi(?:\\s+her\\s+gün)?${S}`))) {
    r.tekrar = { tur: 'hafta', gunler: [1, 2, 3, 4, 5] };
    al(m);
  } else if ((m = ilk(`${B}her\\s+hafta\\s*sonu${S}`))) {
    r.tekrar = { tur: 'hafta', gunler: [6, 0] };
    al(m);
  } else if ((m = ilk(`${B}her\\s+${GUN_RE}(?:\\s*(?:,|ve)\\s*${GUN_RE})*${GUN_EK}(?:\\s+günü)?${S}`))) {
    const gunler = [...m[0].matchAll(new RegExp(GUN_RE, 'gu'))].map((x) => GUN_NO[x[1]]);
    r.tekrar = { tur: 'hafta', gunler: [...new Set(gunler)] };
    al(m);
  } else if ((m = ilk(`${B}her\\s+(sabah|öğlen?|akşam|gece)${DP_SAYI}${S}`))) {
    r.tekrar = { tur: 'gun' };
    gunParcasi = m[1];
    if (m[2] && +m[2] < 24) {
      saat = [+m[2], m[3] ? +m[3] : 0];
      ciplak = true;
    }
    al(m);
  } else if ((m = ilk(`${B}(?:her\\s*gün|hergün)${S}`))) {
    r.tekrar = { tur: 'gun' };
    al(m);
  } else if ((m = ilk(`${B}(?:her\\s+)?${SAYI_RE}\\s+(günde|haftada|ayda|yılda)\\s+bir${S}`))) {
    const tur = { günde: 'gun', haftada: 'hafta', ayda: 'ay', yılda: 'yil' }[m[2]];
    r.tekrar = { tur, aralik: Math.max(1, Math.round(sayi(m[1]))) };
    al(m);
  } else if ((m = ilk(`${B}her\\s+ay[ıi]n\\s+(?:son\\s+gün\\p{L}*|(\\d{1,2})(?:\\s*['’]\\s*\\p{L}+|\\p{L}+)?)${S}`))) {
    r.tekrar = { tur: 'ay', ayGunu: m[1] ? Math.min(31, Math.max(1, +m[1])) : 31 };
    al(m);
  } else if ((m = ilk(`${B}her\\s+ay${S}`))) {
    r.tekrar = { tur: 'ay' };
    al(m);
  } else if ((m = ilk(`${B}her\\s+hafta${S}`))) {
    r.tekrar = { tur: 'hafta' };
    al(m);
  } else if ((m = ilk(`${B}her\\s+(?:yıl|sene)${S}`))) {
    r.tekrar = { tur: 'yil' };
    al(m);
  }

  // göreli: "2 saat sonra", "yarım saat sonra", "3 gün sonra"
  if ((m = ilk(`${B}${SAYI_RE}\\s*(dk|dak|dakika|sa|saat|gün|hafta)\\s+sonra${S}`))) {
    const dk = Math.round(sayi(m[1]) * BIRIM[m[2]]);
    if (m[2] === 'gün' || m[2] === 'hafta') gun = gunBasi(new Date(simdi.getTime() + dk * 60000));
    else goreli = new Date(simdi.getTime() + dk * 60000);
    al(m);
  }

  // saat: "14:00", "saat 9", "8'de"
  if (!goreli) {
    if ((m = ilk(`${B}(?:saat\\s*)?(\\d{1,2}):(\\d{2})${YER}${KADAR}${S}`)) && +m[1] < 24 && +m[2] < 60) {
      saat = [+m[1], +m[2]];
      al(m);
    } else if ((m = ilk(`${B}saat\\s*(\\d{1,2})(?:[.](\\d{2}))?${YER}${KADAR}${S}`)) && +m[1] < 24 && (!m[2] || +m[2] < 60)) {
      saat = [+m[1], m[2] ? +m[2] : 0];
      ciplak = !m[2];
      al(m);
    } else if ((m = ilk(`${B}(\\d{1,2})\\s*['’]\\s*(?:d[ae]|t[ae]|y?[ae])${KADAR}${S}`)) && +m[1] < 24) {
      saat = [+m[1], 0];
      ciplak = true;
      al(m);
    }
  }

  // tarih: 2026-11-25
  if ((m = ilk(`${B}(\\d{4})-(\\d{2})-(\\d{2})${S}`)) && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) {
    gun = yerelTarih(+m[1], +m[2], Math.min(+m[3], ayGunSayisi(+m[1], +m[2])));
    al(m);
  }
  // tarih ya da saat: "25.11", "25/11/2026", "14.30"
  for (const x of hepsi(`${B}(\\d{1,2})[./](\\d{1,2})(?:[./](\\d{2,4}))?${YER}${KADAR}${S}`)) {
    const a = +x[1];
    const b = +x[2];
    const yil = x[3] ? (x[3].length === 2 ? 2000 + +x[3] : +x[3]) : null;
    const tarihOlur = b >= 1 && b <= 12 && a >= 1 && a <= 31;
    const saatOlur = !yil && !goreli && a < 24 && b < 60 && x[2].length === 2;
    const dakikaGibi = saatOlur && b % 5 === 0;
    if (!gun && tarihOlur && (yil || saat || !dakikaGibi)) {
      gun = tarihCoz(a, b, yil, simdi);
      al(x);
    } else if (!saat && saatOlur) {
      saat = [a, b];
      al(x);
    } else if (!gun && tarihOlur) {
      gun = tarihCoz(a, b, yil, simdi);
      al(x);
    }
  }
  // tarih: "25 kasım", "3 aralık 2026", "1 ocakta"
  if (!gun && (m = ilk(`${B}(\\d{1,2})\\s+${AY_RE}${AY_EK}(?:\\s+(\\d{4}))?${KADAR}${S}`)) && +m[1] >= 1 && +m[1] <= 31) {
    gun = tarihCoz(+m[1], AY_NO[m[2]], m[3] ? +m[3] : null, simdi);
    al(m);
  }
  // tarih: "ayın 15'i", "ay sonu", "hafta sonu"
  if (!gun && (m = ilk(`${B}ay[ıi]n\\s+(\\d{1,2})(?:\\s*['’]\\s*\\p{L}+|\\p{L}+)?${KADAR}${S}`)) && +m[1] >= 1 && +m[1] <= 31) {
    const p = yerel(simdi);
    let aday = yerelTarih(p.y, p.a, Math.min(+m[1], ayGunSayisi(p.y, p.a)));
    if (aday < gunBasi(simdi)) {
      const a = p.a === 12 ? 1 : p.a + 1;
      const y = p.a === 12 ? p.y + 1 : p.y;
      aday = yerelTarih(y, a, Math.min(+m[1], ayGunSayisi(y, a)));
    }
    gun = aday;
    al(m);
  }
  if (!gun && (m = ilk(`${B}(?:bu\\s+)?ay\\s*sonu(?:na|nda)?${KADAR}${S}`))) {
    const p = yerel(simdi);
    gun = yerelTarih(p.y, p.a, ayGunSayisi(p.y, p.a));
    al(m);
  }
  if (!gun && (m = ilk(`${B}(?:bu\\s+)?hafta\\s*sonu(?:na|nda)?${KADAR}${S}`))) {
    const hg = yerel(simdi).hg;
    gun = gunEkle(gunBasi(simdi), hg === 6 || hg === 0 ? 0 : 6 - hg);
    al(m);
  }
  // kelimeyle tarih
  if (!gun && (m = ilk(`${B}(bugün(?:kü)?|yarından\\s+sonra|öbür\\s*gün|ertesi\\s+gün|yarın(?:a|ki|da)?)${KADAR}${S}`))) {
    const k = m[1];
    const fark = k.startsWith('bugün') ? 0 : k.startsWith('yarın') && !k.startsWith('yarından') ? 1 : 2;
    gun = gunEkle(gunBasi(simdi), fark);
    al(m);
  }
  // haftanın günü: "cuma", "haftaya salı", "pazartesiye kadar", "cuma günü"
  if (!gun) {
    for (const x of hepsi(`${B}(?:(haftaya|gelecek\\s+hafta(?:nın)?|önümüzdeki\\s+hafta(?:nın)?|bu(?:\\s+hafta(?:nın)?)?)\\s+)?${GUN_RE}${GUN_EK}(\\s+günü?(?:ne|nde)?)?${KADAR}${S}`)) {
      // "pazara git", "pazarda" gibi kullanımlar çarşı anlamına da gelir; gün sayma.
      if (x[2] === 'pazar' && x[3] && !x[4]) continue;
      haftaGunu = { hg: GUN_NO[x[2]], haftaya: !!x[1] && !x[1].startsWith('bu') };
      al(x);
      break;
    }
    if (!haftaGunu && (m = ilk(`${B}(?:haftaya|gelecek\\s+hafta|önümüzdeki\\s+hafta)${S}`))) {
      gun = gunEkle(gunBasi(simdi), 7);
      al(m);
    }
  }

  // gün parçası: sabah / öğlen / akşam / gece / öğleden sonra (+ isteğe bağlı saat)
  if (!gunParcasi && (m = ilk(`${B}(?:bu\\s+)?(öğleden\\s+sonra|gece\\s+yarısı|sabah|öğlen?|ikindi|akşam|gece)(?:ın|leyin|ları|y?e|a|ki)?(?! yeme)${DP_SAYI}${KADAR}${S}`))) {
    const dp = m[1].replace(/\s+/g, ' ');
    // "09:00 sabah koşusu": saat zaten açıkça verilmiş ve gün parçası onu değiştirmiyorsa başlığın parçasıdır
    if (!(saat && !ciplak && !m[2] && !saatiDegistirir(dp, saat[0]))) {
      gunParcasi = dp;
      if (m[2] && !saat && +m[2] < 24) {
        saat = [+m[2], m[3] ? +m[3] : 0];
        ciplak = true;
      }
      al(m);
    }
  }
  // "9 da", "3 te" (boşluklu ek)
  if (!saat && !goreli && (m = ilk(`${B}(\\d{1,2})\\s+(?:d[ae]|t[ae])${KADAR}${S}`)) && +m[1] < 24) {
    saat = [+m[1], 0];
    ciplak = true;
    al(m);
  }

  // saati gün parçasına ya da akla yatkın olana göre düzelt
  if (gunParcasi) {
    if (saat) {
      const [sa, dk] = saat;
      if (gunParcasi === 'gece yarısı') saat = [23, 59];
      else if ((gunParcasi === 'akşam' || gunParcasi === 'öğleden sonra' || gunParcasi === 'ikindi') && sa < 12) saat = [sa + 12, dk];
      else if (gunParcasi === 'gece' && sa === 12) saat = [23, 59];
      else if (gunParcasi === 'gece' && sa >= 6 && sa < 12) saat = [sa + 12, dk];
      else if ((gunParcasi === 'öğle' || gunParcasi === 'öğlen') && sa < 6) saat = [sa + 12, dk];
    } else saat = GUN_PARCALARI[gunParcasi] || null;
  } else if (saat && ciplak) {
    const [sa, dk] = saat;
    if (sa >= 1 && sa <= 5) saat = [sa + 12, dk];
    else if (sa >= 6 && sa <= 11 && !gun && !haftaGunu && !r.tekrar) {
      // "9'da" dendiğinde sabah 9 geçtiyse akşam 9 kastedilir
      const bugun = gunParcalari(simdi);
      if (yerelTarih(...bugun, sa, dk) <= simdi && yerelTarih(...bugun, sa + 12, dk) > simdi) saat = [sa + 12, dk];
    }
  }

  if (haftaGunu) gun = haftaGunuTarihi(haftaGunu, simdi, saat);

  // zaman
  if (goreli) {
    r.zaman = goreli;
  } else if (gun) {
    r.zaman = yerelTarih(...gunParcalari(gun), saat ? saat[0] : 9, saat ? saat[1] : 0);
    r.tumGun = !saat;
  } else if (saat) {
    let z = yerelTarih(...gunParcalari(simdi), saat[0], saat[1]);
    if (z <= simdi) z = gunEkle(z, 1);
    r.zaman = z;
  }
  if (r.tekrar) {
    r.zaman = ilkTekrar(r.tekrar, r.zaman, saat, simdi);
    r.tumGun = !saat && !goreli;
  }

  // başlık
  let baslik = O.replace(/\s+/g, ' ').trim();
  baslik = baslik.replace(/^[\s\-–—,:;.]+|[\s\-–—,:;]+$/gu, '').trim();
  baslik = baslik.replace(new RegExp(`^(?:ve|saat)${S}\\s*`, 'iu'), '').replace(new RegExp(`\\s*${B}(?:ve|saat)$`, 'iu'), '').trim();
  if (!baslik) baslik = 'Görev';
  r.baslik = baslik.charAt(0).toLocaleUpperCase('tr-TR') + baslik.slice(1);
  if (r.zaman) r.zaman = isoYaz(r.zaman);
  return r;
}

function saatiDegistirir(dp, sa) {
  if (dp === 'gece yarısı') return true;
  if (dp === 'akşam' || dp === 'öğleden sonra' || dp === 'ikindi') return sa < 12;
  if (dp === 'gece') return (sa >= 6 && sa <= 12);
  if (dp === 'öğle' || dp === 'öğlen') return sa < 6;
  return false;
}

function tarihCoz(g, a, yil, simdi) {
  let y = yil || yerel(simdi).y;
  if (!yil && yerelTarih(y, a, Math.min(g, ayGunSayisi(y, a))) < gunEkle(gunBasi(simdi), -60)) y++;
  return yerelTarih(y, a, Math.min(g, ayGunSayisi(y, a)));
}

function haftaGunuTarihi({ hg, haftaya }, simdi, saat) {
  const bugun = gunBasi(simdi);
  const buHg = yerel(simdi).hg;
  if (haftaya) {
    // "haftaya salı": gelecek haftanın (pazartesiyle başlayan) salısı
    const pazartesi = gunEkle(bugun, -pazartesiSira(buHg));
    return gunEkle(pazartesi, 7 + pazartesiSira(hg));
  }
  let fark = (hg - buHg + 7) % 7;
  if (fark === 0 && saat && yerelTarih(...gunParcalari(bugun), saat[0], saat[1]) <= simdi) fark = 7;
  return gunEkle(bugun, fark);
}

function ilkTekrar(t, zaman, saat, simdi) {
  const [sa, dk] = saat || (zaman ? [yerel(zaman).sa, yerel(zaman).dk] : [9, 0]);
  const bugun = gunBasi(simdi);
  const gunde = (d) => yerelTarih(...gunParcalari(d), sa, dk);
  const gecmedi = (d) => (saat ? gunde(d) > simdi : gunBasi(d) >= bugun);
  if (t.tur === 'hafta' && t.gunler && t.gunler.length) {
    let d = zaman && zaman > simdi ? gunBasi(zaman) : bugun;
    for (let i = 0; i < 15; i++, d = gunEkle(d, 1)) if (t.gunler.includes(yerel(d).hg) && gecmedi(d)) return gunde(d);
  }
  if (t.tur === 'ay' && t.ayGunu && !zaman) {
    const p = yerel(simdi);
    let z = yerelTarih(p.y, p.a, Math.min(t.ayGunu, ayGunSayisi(p.y, p.a)), sa, dk);
    if (!gecmedi(z)) {
      const a = p.a === 12 ? 1 : p.a + 1;
      const y = p.a === 12 ? p.y + 1 : p.y;
      z = yerelTarih(y, a, Math.min(t.ayGunu, ayGunSayisi(y, a)), sa, dk);
    }
    return z;
  }
  if (zaman) return zaman;
  return gecmedi(bugun) ? gunde(bugun) : gunde(gunEkle(bugun, 1));
}

/** Ertele süresi: "30dk", "1s", "2 saat", "yarın", "akşam", "pazartesi 10:00". */
export function erteleZamani(metin, simdi) {
  const t = String(metin || '').trim().toLocaleLowerCase('tr-TR');
  if (!t) return new Date(simdi.getTime() + 3600e3);
  const m = t.match(/^(\d+(?:[.,]\d+)?)\s*(d|dk|dak|dakika|s|sa|saat|g|gün)$/u);
  if (m) {
    const birim = { d: 1, dk: 1, dak: 1, dakika: 1, s: 60, sa: 60, saat: 60, g: 1440, gün: 1440 }[m[2]];
    return new Date(simdi.getTime() + Math.round(parseFloat(m[1].replace(',', '.')) * birim) * 60000);
  }
  const r = ayristir(t, simdi);
  if (!r.zaman) return null;
  const z = new Date(r.zaman);
  return r.tumGun ? yerelTarih(...gunParcalari(z), 9, 0) : z;
}
