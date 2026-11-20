/*
 * uygulama.js · Görev sayfası
 *
 * Veri, gizli depodaki gorevler.json'dadır (GitHub Contents API, kullanıcının
 * kendi erişim anahtarıyla). Her değişiklik bir "işlem" olarak kuyruğa girer,
 * ekranda hemen görünür ve arka planda en güncel dosyaya uygulanıp kaydedilir.
 * Telegram botu aynı anda yazmışsa dosya yeniden okunur, işlemler onun üstüne
 * uygulanır; kimsenin değişikliği kaybolmaz. Kuyruk tarayıcıda saklanır, bu
 * yüzden çevrimdışı yapılan değişiklikler bağlantı gelince kaydedilir.
 */
import * as O from './ortak.js';

const SAHIP = /\.github\.io$/i.test(location.hostname) ? location.hostname.split('.')[0].toLowerCase() : 'eyupcalskanozturk-tr';
const SITE_DEPO = `${SAHIP}/${SAHIP}.github.io`;
const DOSYA = 'gorevler.json';
const WORKFLOW = 'gorev-hatirlatici.yml';
const K = { baglanti: 'gorevler.baglanti', onbellek: 'gorevler.onbellek', kuyruk: 'gorevler.kuyruk', filtre: 'gorevler.filtre', tgSonra: 'gorevler.tgSonra' };
const HATIRLAT_SECENEK = [
  [1440, '1 gün önce'],
  [180, '3 saat önce'],
  [60, '1 saat önce'],
  [30, '30 dk önce'],
  [15, '15 dk önce'],
  [0, 'Zamanında'],
];
const GRUPLAR = [
  ['geciken', 'Gecikmiş'],
  ['bugun', 'Bugün'],
  ['yarin', 'Yarın'],
  ['hafta', 'Bu hafta'],
  ['sonra', 'Daha sonra'],
  ['tarihsiz', 'Tarihsiz'],
];
const KISA_GUN = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

const SVG = {
  tik: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  saat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M5 3 2 6M19 3l3 3"/></svg>',
};

/* ───────── yardımcılar ───────── */

const $ = (s, k = document) => k.querySelector(s);
const $$ = (s, k = document) => [...k.querySelectorAll(s)];

function h(etiket, ozellik, ...cocuklar) {
  const e = document.createElement(etiket);
  for (const [k, v] of Object.entries(ozellik || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v; // yalnız sabit SVG için
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of cocuklar.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}

const sakla = {
  oku(k) {
    for (const ad of ['localStorage', 'sessionStorage']) {
      try {
        const v = window[ad].getItem(k);
        if (v != null) return JSON.parse(v);
      } catch {
        /* depolama kapalı olabilir */
      }
    }
    return null;
  },
  yaz(k, v, kalici = true) {
    try {
      window[kalici ? 'localStorage' : 'sessionStorage'].setItem(k, JSON.stringify(v));
      window[kalici ? 'sessionStorage' : 'localStorage'].removeItem(k);
    } catch {
      /* depolama kapalıysa bu oturumla sınırlı */
    }
  },
  sil(k) {
    for (const ad of ['localStorage', 'sessionStorage']) {
      try {
        window[ad].removeItem(k);
      } catch {
        /* yok say */
      }
    }
  },
};

const b64Coz = (b64) => new TextDecoder().decode(Uint8Array.from(atob(String(b64).replace(/\s/g, '')), (c) => c.charCodeAt(0)));
function b64Yap(s) {
  const b = new TextEncoder().encode(s);
  let t = '';
  for (let i = 0; i < b.length; i += 0x8000) t += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(t);
}
const iki = (n) => String(n).padStart(2, '0');
const tarihGirdisi = (d) => {
  const p = O.yerel(d);
  return `${p.y}-${iki(p.a)}-${iki(p.g)}`;
};

/* ───────── durum ───────── */

const D = {
  baglanti: null, // { depo, token, hatirla }
  uzak: null, // { veri, sha, etag } – son okunan/yazılan dosya
  kuyruk: [], // kaydedilmeyi bekleyen işlemler
  eskiSha: new Set(), // kendi yazdığımızdan eski sürümler (önbellek gecikmesine karşı)
  kaydediliyor: false,
  tekrarKaydet: false,
  hata: null,
  sonCekme: 0,
  sonKayit: 0,
  calisma: null, // son workflow çalışması
  filtre: 'hepsi',
  gorunen: null,
  acikMenu: null,
};

class BagHata extends Error {
  constructor(tur, durum, mesaj) {
    super(mesaj || tur);
    this.tur = tur;
    this.durum = durum;
  }
}

function hataMetni(e) {
  if (!navigator.onLine) return 'İnternet yok. Değişiklikler bu cihazda bekliyor; bağlantı gelince kaydedilecek.';
  if (e instanceof BagHata) {
    switch (e.tur) {
      case 'token':
        return 'Erişim anahtarı geçersiz ya da süresi dolmuş. Yeni bir anahtar oluşturup yeniden bağlan.';
      case 'depo':
        return 'Veri deposu bulunamadı ya da anahtar bu depoyu göremiyor. Anahtarda “Only select repositories” altında gorev-verisi seçili mi?';
      case 'yazma':
        return 'Anahtarın yazma izni yok. Anahtar ayarında Contents iznini “Read and write” yap.';
      case 'sinir':
        return 'GitHub istek sınırına takıldı; biraz sonra kendiliğinden yeniden denenecek.';
      case 'bozuk':
        return 'gorevler.json okunamadı (bozuk JSON). Depodaki dosyayı kontrol et.';
      default:
        return `GitHub bağlantı hatası (${e.durum || e.message}). Yeniden denenecek.`;
    }
  }
  return `Bağlantı hatası: ${e.message || e}`;
}

/* ───────── GitHub ───────── */

async function gh(yol, { yontem = 'GET', govde, basliklar = {}, token, anahtarsiz = false } = {}) {
  const t = anahtarsiz ? null : token || (D.baglanti && D.baglanti.token);
  const hd = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...basliklar };
  if (t) hd.Authorization = `Bearer ${t}`;
  if (govde) hd['Content-Type'] = 'application/json';
  return fetch(`https://api.github.com${yol}`, { method: yontem, headers: hd, body: govde ? JSON.stringify(govde) : undefined, cache: 'no-store' });
}
const dosyaYolu = (depo) => `/repos/${depo}/contents/${DOSYA}`;

async function cek({ zorla = false } = {}) {
  const b = D.baglanti;
  const y = await gh(dosyaYolu(b.depo), { basliklar: !zorla && D.uzak && D.uzak.etag ? { 'If-None-Match': D.uzak.etag } : {} });
  if (y.status === 304) {
    D.sonCekme = Date.now();
    return false;
  }
  if (y.status === 404) {
    const r = await gh(`/repos/${b.depo}`);
    if (r.status !== 200) throw new BagHata(r.status === 401 ? 'token' : 'depo', r.status);
    D.uzak = { veri: O.bosVeri(), sha: null, etag: null };
    D.sonCekme = Date.now();
    return true; // dosyayı ilk kayıt oluşturur
  }
  if (y.status === 401) throw new BagHata('token', 401);
  if (y.status === 429 || (y.status === 403 && y.headers.get('x-ratelimit-remaining') === '0')) throw new BagHata('sinir', y.status);
  if (y.status === 403) throw new BagHata('depo', 403);
  if (!y.ok) throw new BagHata('ag', y.status);
  const j = await y.json();
  if (D.eskiSha.has(j.sha)) return false;
  let veri;
  try {
    veri = O.veriDuzelt(JSON.parse(b64Coz(j.content || '') || '{}'));
  } catch {
    throw new BagHata('bozuk', 0);
  }
  const degisti = !D.uzak || D.uzak.sha !== j.sha;
  D.uzak = { veri, sha: j.sha, etag: y.headers.get('ETag') };
  D.sonCekme = Date.now();
  if (D.hata && D.hata.tur !== 'yazma') D.hata = null;
  onbellekYaz();
  return degisti;
}

let kayitZamanlayici = null;
let yenidenDeneZamanlayici = null;
function kaydetZamanla(ms = 450) {
  clearTimeout(kayitZamanlayici);
  kayitZamanlayici = setTimeout(() => kaydet(), ms);
}

async function kaydet() {
  if (!D.baglanti || !D.uzak) return;
  if (D.kaydediliyor) {
    D.tekrarKaydet = true;
    return;
  }
  if (!D.kuyruk.length && D.uzak.sha) return;
  D.kaydediliyor = true;
  esitlemeCiz();
  try {
    for (let deneme = 1; ; deneme++) {
      const islemler = D.kuyruk.slice();
      const v = uygula(D.uzak.veri, islemler);
      const govde = {
        message: islemler.length ? `site: ${islemler.length} değişiklik` : 'site: veri dosyası oluşturuldu',
        content: b64Yap(JSON.stringify(v, null, 1) + '\n'),
      };
      if (D.uzak.sha) govde.sha = D.uzak.sha;
      const y = await gh(dosyaYolu(D.baglanti.depo), { yontem: 'PUT', govde });
      if (y.ok) {
        const j = await y.json();
        if (D.uzak.sha) D.eskiSha.add(D.uzak.sha);
        D.uzak = { veri: v, sha: j.content && j.content.sha, etag: null };
        D.kuyruk = D.kuyruk.slice(islemler.length);
        D.hata = null;
        D.sonKayit = Date.now();
        kuyrukYaz();
        onbellekYaz();
        break;
      }
      if ((y.status === 409 || y.status === 422) && deneme < 6) {
        await cek({ zorla: true }); // bot ya da başka bir cihaz yazmış: güncel dosyaya yeniden uygula
        continue;
      }
      if (y.status === 401) throw new BagHata('token', 401);
      if (y.status === 403 || y.status === 404) throw new BagHata(y.headers.get('x-ratelimit-remaining') === '0' ? 'sinir' : 'yazma', y.status);
      throw new BagHata('ag', y.status);
    }
  } catch (e) {
    D.hata = e instanceof BagHata ? e : new BagHata('ag', 0, e.message);
    if (['ag', 'sinir'].includes(D.hata.tur)) {
      clearTimeout(yenidenDeneZamanlayici);
      yenidenDeneZamanlayici = setTimeout(() => kaydet(), 30000);
    }
  } finally {
    D.kaydediliyor = false;
    ciz();
    if (D.tekrarKaydet) {
      D.tekrarKaydet = false;
      kaydetZamanla(60);
    }
  }
}

function uygula(temel, islemler) {
  const v = JSON.parse(JSON.stringify(temel));
  for (const i of islemler) {
    try {
      O.islemUygula(v, i, new Date(i.an));
    } catch (e) {
      console.warn('İşlem uygulanamadı:', i.tur, e);
    }
  }
  return v;
}

const kalici = () => !D.baglanti || D.baglanti.hatirla !== false;
function onbellekYaz() {
  if (D.uzak && D.uzak.sha) sakla.yaz(K.onbellek, { depo: D.baglanti.depo, veri: D.uzak.veri, sha: D.uzak.sha, etag: D.uzak.etag }, kalici());
}
function kuyrukYaz() {
  if (D.kuyruk.length) sakla.yaz(K.kuyruk, D.kuyruk, kalici());
  else sakla.sil(K.kuyruk);
}

function islemEkle(islem) {
  islem.an = new Date().toISOString();
  D.kuyruk.push(islem);
  kuyrukYaz();
  ciz();
  kaydetZamanla();
}

/* ───────── workflow durumu ───────── */

async function calismaKontrol() {
  if (!D.baglanti) return;
  const yol = `/repos/${SITE_DEPO}/actions/workflows/${WORKFLOW}/runs?per_page=1&exclude_pull_requests=true`;
  try {
    let y = await gh(yol);
    if (!y.ok) y = await gh(yol, { anahtarsiz: true }); // herkese açık veri; anahtar izin vermezse anahtarsız dene
    if (y.status === 404) D.calisma = { yok: true };
    else if (y.ok) {
      const j = await y.json();
      D.calisma = (j.workflow_runs && j.workflow_runs[0]) || { hic: true };
    }
  } catch {
    /* sessiz: bir sonraki turda yeniden */
  }
  saglikCiz();
}

/* ───────── çizim ───────── */

function gorunum() {
  const v = uygula(D.uzak.veri, D.kuyruk);
  O.tekrarIlerlet(v, new Date());
  return v;
}

function odakKaydet() {
  const a = document.activeElement;
  if (!a || a === document.body) return null;
  const sat = a.closest('[data-id]');
  return sat ? { id: sat.dataset.id, sinif: a.classList[0] } : a.id ? { elId: a.id } : null;
}
function odakGeriYukle(o) {
  if (!o) return;
  let el = null;
  if (o.elId) el = document.getElementById(o.elId);
  else {
    const sat = document.querySelector(`[data-id="${CSS.escape(o.id)}"]`);
    el = sat && (sat.querySelector(`.${o.sinif}`) || sat.querySelector('button'));
  }
  if (el && el !== document.activeElement) el.focus({ preventScroll: true });
}

function ciz() {
  $('#yukleniyor').hidden = !!(D.uzak || !D.baglanti);
  if (!D.baglanti) {
    $('#kurulum').hidden = false;
    $('#uygulama').hidden = true;
    $('#saglik').hidden = true;
    $('#ayarlar-ac').hidden = true;
    return;
  }
  $('#kurulum').hidden = true;
  if (!D.uzak) {
    $('#uygulama').hidden = true;
    if (D.hata) {
      $('#yukleniyor').hidden = false;
      $('#yukleniyor').textContent = hataMetni(D.hata);
    }
    return;
  }
  const odak = odakKaydet();
  const simdi = new Date();
  const v = (D.gorunen = gorunum());
  $('#uygulama').hidden = false;
  $('#saglik').hidden = false;
  $('#ayarlar-ac').hidden = false;

  const s = O.grupla(v, simdi);
  kahramanCiz(s, simdi);
  uyarilarCiz(v);
  telegramKartiCiz(v, simdi);
  filtreCiz(v, s);
  $('#ornekler').hidden = Object.values(s).flat().length >= 3;
  listeCiz(s, simdi);
  bitenCiz(v, simdi);
  copCiz(v);
  esitlemeCiz();
  saglikCiz();
  $('#kategori-listesi').replaceChildren(...v.ayarlar.kategoriler.map((k) => h('option', { value: k })));
  odakGeriYukle(odak);
}

function kahramanCiz(s, simdi) {
  const p = O.yerel(simdi);
  $('#bugun-tarih').textContent = `›_ ${p.g} ${O.AYLAR[p.a - 1]} ${O.GUNLER[p.hg]}`;
  const n = s.geciken.length + s.bugun.length;
  const acik = Object.values(s).reduce((t, x) => t + x.length, 0);
  const baslik = $('#ozet-baslik');
  if (!acik) baslik.replaceChildren('Liste ', h('em', { text: 'tertemiz.' }));
  else if (!n) baslik.replaceChildren('Bugün ', h('em', { text: 'boş.' }));
  else baslik.replaceChildren('Bugün ', h('em', { text: `${n} görev` }));
  const alt = [];
  if (s.geciken.length) alt.push(`${s.geciken.length} gecikmiş`);
  if (s.yarin.length) alt.push(`yarın ${s.yarin.length}`);
  if (acik) alt.push(`toplam ${acik} açık`);
  else alt.push('Yeni görev için aşağıya yaz.');
  $('#ozet-alt').textContent = alt.join(' · ');
}

function uyarilarCiz(v) {
  const kutu = $('#uyarilar');
  const parca = [];
  if (D.hata && D.hata.tur !== 'ag') {
    const dugmeler = [h('button', { class: 'dugme kucuk', type: 'button', text: 'Yeniden dene', onclick: () => yenile(true) })];
    if (['token', 'depo', 'yazma'].includes(D.hata.tur)) dugmeler.push(h('button', { class: 'dugme kucuk', type: 'button', text: 'Anahtarı değiştir', onclick: cikis }));
    parca.push(h('div', { class: 'uyari', role: 'alert' }, h('strong', { text: 'Kaydedilemiyor. ' }), hataMetni(D.hata), h('div', { class: 'dugmeler' }, dugmeler)));
  }
  const sag = v.durum && v.durum.saglik;
  if (sag && sag.hata) parca.push(h('div', { class: 'uyari' }, h('strong', { text: 'Hatırlatıcı uyarısı: ' }), sag.hata, sag.zaman ? ` (${O.goreceMetin(new Date(sag.zaman), new Date())})` : ''));
  kutu.replaceChildren(...parca);
}

function telegramKartiCiz(v, simdi) {
  const kart = $('#telegram-kart');
  const bagli = !!v.telegram.chatId;
  const sonra = sakla.oku(K.tgSonra);
  kart.hidden = bagli || (sonra && Date.now() - sonra < 3 * 86400e3);
  if (kart.hidden) return;
  $('#sir-ekle').href = `https://github.com/${SITE_DEPO}/settings/secrets/actions`;
  $('#workflow-ac').href = `https://github.com/${SITE_DEPO}/actions/workflows/${WORKFLOW}`;
  const bot = v.durum.bot && v.durum.bot.kullaniciAdi;
  const durum = $('#tg-bot-durum');
  durum.firstElementChild.className = 'led ' + (bot ? 'yesil' : 'sari');
  durum.lastElementChild.textContent = bot ? `Bot çalışıyor: @${bot}` : 'Bot henüz çalışmadı: sırları ekledikten sonra ilk çalışmayı bekle (en çok ~15 dk).';
  const kod = v.telegram.kod && v.telegram.kodSonu && new Date(v.telegram.kodSonu) > simdi ? v.telegram.kod : null;
  $('#tg-kod-kutu').hidden = !kod;
  if (kod) {
    $('#tg-kod').textContent = `/start ${kod}`;
    const ac = $('#tg-ac');
    ac.hidden = !bot;
    if (bot) ac.href = `https://t.me/${encodeURIComponent(bot)}?start=${encodeURIComponent(kod)}`;
    $('#tg-mesaj').textContent = `Kod ${O.saatMetni(new Date(v.telegram.kodSonu))}'e kadar geçerli. Bot birkaç dakikada bir kontrol eder; eşleşince bu kart kapanır.`;
    $('#tg-kod-uret').textContent = 'Yeni kod üret';
  } else {
    $('#tg-mesaj').textContent = '';
    $('#tg-kod-uret').textContent = 'Eşleştirme kodu üret';
  }
}

function filtreCiz(v, s) {
  const acik = Object.values(s).flat();
  const kategoriler = [...new Set(acik.map((g) => g.kategori).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
  if (D.filtre !== 'hepsi' && D.filtre !== 'oncelikli' && !kategoriler.includes(D.filtre)) D.filtre = 'hepsi';
  const secenek = [['hepsi', 'Hepsi'], ...(acik.some((g) => g.oncelik === 'yuksek') ? [['oncelikli', '❗ Öncelikli']] : []), ...kategoriler.map((k) => [k, k])];
  const kutu = $('#filtre');
  kutu.hidden = secenek.length < 2;
  kutu.replaceChildren(
    ...secenek.map(([deger, ad]) =>
      h('button', {
        type: 'button',
        'aria-pressed': String(D.filtre === deger),
        text: ad,
        onclick: () => {
          D.filtre = deger;
          sakla.yaz(K.filtre, deger);
          ciz();
        },
      }),
    ),
  );
}

const suzgec = (g) => D.filtre === 'hepsi' || (D.filtre === 'oncelikli' ? g.oncelik === 'yuksek' : g.kategori === D.filtre);

function listeCiz(s, simdi) {
  const kutu = $('#liste');
  const bolumler = [];
  for (const [anahtar, ad] of GRUPLAR) {
    const liste = s[anahtar].filter(suzgec);
    if (!liste.length) continue;
    bolumler.push(
      h(
        'section',
        { class: `grup ${anahtar}`, 'aria-label': ad },
        h('div', { class: 'grup-baslik' }, h('h2', { text: ad }), h('span', { class: 'sayi', text: String(liste.length) })),
        h('ul', { class: 'gorevler' }, liste.map((g) => gorevSatiri(g, simdi, anahtar))),
      ),
    );
  }
  if (!bolumler.length) {
    const hic = !Object.values(s).flat().length;
    bolumler.push(
      h(
        'div',
        { class: 'cam bos' },
        h('strong', { text: hic ? 'Henüz görev yok' : 'Bu süzgeçte görev yok' }),
        hic ? 'Yukarıya doğal Türkçeyle yaz: “yarın 14:00 veritabanı ödevi #okul”. Telegram bağlıysa bota yazman da yeter.' : 'Başka bir süzgeç seç.',
      ),
    );
  }
  kutu.replaceChildren(...bolumler);
}

function zamanEtiketi(g, simdi, grup) {
  if (!g.zaman) return null;
  const z = new Date(g.zaman);
  if (grup === 'geciken') return h('span', { class: 'gec', text: `${O.tarihMetni(z, simdi, g.tumGun)} · ${g.tumGun ? 'gecikti' : O.goreceMetin(z, simdi)}` });
  if (grup === 'bugun' || grup === 'yarin') {
    if (g.tumGun) return h('span', { text: 'gün boyu' });
    const fark = z - simdi;
    if (fark > 0 && fark < 3 * 3600e3) return h('span', { class: 'yakin', text: `${O.saatMetni(z)} · ${O.goreceMetin(z, simdi)}` });
    return h('span', { text: O.saatMetni(z) });
  }
  return h('span', { text: O.tarihMetni(z, simdi, g.tumGun) });
}

function gorevSatiri(g, simdi, grup) {
  const biten = g.durum === 'bitti';
  const meta = [];
  if (!biten) meta.push(zamanEtiketi(g, simdi, grup));
  else if (g.bitis) meta.push(h('span', { text: `✓ ${O.tarihMetni(new Date(g.bitis), simdi)}` }));
  if (g.tekrar) meta.push(h('span', { text: `↻ ${O.tekrarMetni(g.tekrar)}` }));
  if (!biten && g.ertele) meta.push(h('span', { class: 'yakin', text: `⏰ ${O.tarihMetni(new Date(g.ertele), simdi)}` }));
  if (!biten && g.zaman && !g.tumGun && !(g.hatirlat || []).length) meta.push(h('span', { text: '🔕 sessiz' }));
  if (g.kategori) meta.push(h('span', { class: 'kat', text: g.kategori }));
  const govde = h(
    'button',
    { class: 'govde', type: 'button', 'aria-label': `${g.baslik}: düzenle`, onclick: () => duzenleAc(g.id) },
    h('span', { class: 'baslik', style: 'display:block', text: g.baslik }),
    meta.filter(Boolean).length ? h('span', { class: 'meta', style: 'display:flex' }, meta.filter(Boolean)) : null,
    g.not && !biten ? h('span', { class: 'gorev-not', style: 'display:-webkit-box', text: g.not }) : null,
  );
  const li = h('li', { class: `gorev cam${biten ? ' biten' : ''}`, 'data-id': g.id, 'data-oncelik': g.oncelik });
  const tik = h('button', {
    class: 'tik',
    type: 'button',
    'aria-label': biten ? `Yeniden aç: ${g.baslik}` : `Tamamla: ${g.baslik}`,
    html: SVG.tik,
    onclick: () => tamamlaTikla(g, li),
  });
  li.append(tik, govde);
  if (!biten)
    li.append(
      h('button', {
        class: 'ertele-ac',
        type: 'button',
        'aria-label': `Ertele: ${g.baslik}`,
        'aria-haspopup': 'menu',
        'aria-expanded': 'false',
        html: SVG.saat,
        onclick: (e) => erteleMenusu(li, g, e.currentTarget),
      }),
    );
  return li;
}

function bitenCiz(v, simdi) {
  const sinir = simdi.getTime() - 30 * 86400e3;
  const liste = v.gorevler
    .filter((g) => g.durum === 'bitti' && (!g.bitis || new Date(g.bitis).getTime() >= sinir))
    .sort((a, b) => (b.bitis || '').localeCompare(a.bitis || ''))
    .slice(0, 60);
  const d = $('#biten');
  d.hidden = !liste.length;
  $('.sayi', d).textContent = liste.length ? String(liste.length) : '';
  $('ul', d).replaceChildren(...liste.map((g) => gorevSatiri(g, simdi, 'biten')));
}

function copCiz(v) {
  const d = $('#cop');
  d.hidden = !v.cop.length;
  $('.sayi', d).textContent = v.cop.length ? String(v.cop.length) : '';
  $('.cop-liste', d).replaceChildren(
    ...v.cop.map((c) =>
      h(
        'div',
        { class: 'cop-oge', 'data-id': c.gorev.id },
        h('p', {}, c.gorev.baslik, ' ', h('small', { text: `#${c.gorev.no} · ${O.tarihMetni(new Date(c.silinme), new Date())}` })),
        h('button', {
          class: 'dugme kucuk',
          type: 'button',
          text: 'Geri getir',
          onclick: () => {
            islemEkle({ tur: 'copGeriAl', id: c.gorev.id });
            bildir(`↩ ${c.gorev.baslik} geri geldi`);
          },
        }),
      ),
    ),
  );
}

function esitlemeCiz() {
  const e = $('#esitleme');
  if (!e) return;
  if (D.kaydediliyor) e.textContent = '↻ kaydediliyor…';
  else if (D.kuyruk.length && (!navigator.onLine || (D.hata && D.hata.tur === 'ag'))) e.textContent = `● ${D.kuyruk.length} değişiklik bu cihazda bekliyor; bağlantı gelince kaydedilecek`;
  else if (D.kuyruk.length) e.textContent = `● ${D.kuyruk.length} değişiklik kaydedilecek…`;
  else if (D.hata) e.textContent = `✕ ${hataMetni(D.hata)}`;
  else {
    const son = Math.max(D.sonCekme, D.sonKayit);
    e.textContent = son ? `✓ eşitlendi · ${O.saatMetni(new Date(son))}` : '';
  }
}

function saglikDurumu() {
  const v = D.gorunen;
  const c = D.calisma;
  let led = '';
  let metin = '…';
  let ayrinti = 'Çalışma bilgisi alınıyor…';
  if (c && c.yok) {
    metin = 'kurulmadı';
    ayrinti = 'Görev hatırlatıcısı workflow’u site deposunda bulunamadı.';
  } else if (c && c.hic) {
    led = 'sari';
    metin = 'henüz çalışmadı';
    ayrinti = 'Workflow henüz hiç çalışmadı. İlk zamanlanmış çalışma birkaç dakika sürebilir.';
  } else if (c) {
    const zaman = new Date(c.updated_at || c.run_started_at || c.created_at);
    const once = O.goreceMetin(zaman, new Date());
    if (c.status !== 'completed') {
      led = 'yesil';
      metin = 'çalışıyor';
      ayrinti = `Şu an çalışıyor (${once} başladı).`;
    } else if (c.conclusion !== 'success') {
      led = 'kirmizi';
      metin = 'hata verdi';
      ayrinti = `Son çalışma ${once} hatayla bitti. Ayrıntı için Çalışmalar bağlantısına bak.`;
    } else if (Date.now() - zaman > 40 * 60e3) {
      led = 'sari';
      metin = `gecikmeli · ${once}`;
      ayrinti = `Son başarılı çalışma ${once}. GitHub zamanlanmış çalışmaları yoğunlukta geciktirebilir.`;
    } else {
      led = 'yesil';
      metin = `açık · ${once}`;
      ayrinti = `Son çalışma ${once} başarıyla bitti; 5 dakikada bir çalışır.`;
    }
  }
  if (v && !(v.durum && v.durum.bot) && !(c && c.yok)) {
    led = 'sari';
    metin = 'bot kurulmadı';
    ayrinti = 'Bot henüz veriyi okumadı. TELEGRAM_BOT_TOKEN ve GOREV_TOKEN sırları ekli mi?';
  } else if (v && !v.telegram.chatId) {
    led = 'sari';
    metin = 'Telegram bağlı değil';
  } else if (v && v.durum.saglik && v.durum.saglik.hata) {
    led = 'sari';
    metin = 'uyarı var';
  }
  return { led, metin, ayrinti };
}

function saglikCiz() {
  const d = saglikDurumu();
  const p = $('#saglik');
  p.firstElementChild.className = `led ${d.led}`;
  p.lastElementChild.textContent = d.metin;
  p.title = d.ayrinti;
  p.setAttribute('aria-label', `Hatırlatıcı durumu: ${d.metin}. Ayarları aç.`);
  if ($('#ayarlar').open) ayarDurumCiz();
}

/* ───────── etkileşimler ───────── */

const hareketAzalt = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('motion-paused');

function tamamlaTikla(g, li) {
  if (g.durum === 'bitti') {
    islemEkle({ tur: 'geriAl', id: g.id });
    bildir(`↩ ${g.baslik} yeniden açık`);
    return;
  }
  const yap = () => {
    islemEkle({ tur: 'tamamla', id: g.id });
    bildir(g.tekrar ? `✓ ${g.baslik} · sıradaki tekrara geçti` : `✓ ${g.baslik} tamamlandı`, () => islemEkle({ tur: 'geriAl', id: g.id }));
  };
  if (hareketAzalt()) return yap();
  li.querySelector('.tik').classList.add('dolu');
  li.style.opacity = '.45';
  setTimeout(yap, 260);
}

function erteleSecenekleri(simdi) {
  const p = O.yerel(simdi);
  const bugun = O.gunBasi(simdi);
  const gunde = (gun, sa, dk = 0) => {
    const q = O.yerel(gun);
    return O.yerelTarih(q.y, q.a, q.g, sa, dk);
  };
  const s = [
    ['1 saat', new Date(simdi.getTime() + 3600e3)],
    ['3 saat', new Date(simdi.getTime() + 3 * 3600e3)],
  ];
  if (p.sa < 18) s.push(['Bu akşam', gunde(bugun, 19)]);
  s.push(['Yarın sabah', gunde(O.gunEkle(bugun, 1), 9)]);
  if (p.hg >= 1 && p.hg <= 4) s.push(['Hafta sonu', gunde(O.gunEkle(bugun, 6 - p.hg), 10)]);
  s.push(['Haftaya', gunde(O.gunEkle(bugun, 7 - ((p.hg + 6) % 7)), 9)]);
  return s;
}

function menuKapat() {
  if (!D.acikMenu) return;
  const { menu, dugme } = D.acikMenu;
  menu.remove();
  const satir = dugme.closest('.gorev');
  if (satir) satir.classList.remove('menu-acik');
  dugme.setAttribute('aria-expanded', 'false');
  D.acikMenu = null;
}

function erteleMenusu(li, g, dugme) {
  const acikti = D.acikMenu && D.acikMenu.dugme === dugme;
  menuKapat();
  if (acikti) return;
  const simdi = new Date();
  const menu = h(
    'div',
    { class: 'menu', role: 'menu', 'aria-label': 'Ertele' },
    erteleSecenekleri(simdi).map(([ad, zaman]) =>
      h(
        'button',
        {
          type: 'button',
          role: 'menuitem',
          onclick: () => {
            menuKapat();
            islemEkle({ tur: 'ertele', id: g.id, zaman: O.isoYaz(zaman) });
            bildir(`⏰ ${g.baslik} → ${O.tarihMetni(zaman, new Date())}`);
          },
        },
        ad,
        h('span', { text: O.tarihMetni(zaman, simdi) }),
      ),
    ),
    h(
      'button',
      {
        type: 'button',
        role: 'menuitem',
        onclick: () => {
          menuKapat();
          duzenleAc(g.id, 'tarih');
        },
      },
      'Tarih seç…',
      h('span', { text: '' }),
    ),
  );
  li.append(menu);
  li.classList.add('menu-acik');
  dugme.setAttribute('aria-expanded', 'true');
  D.acikMenu = { menu, dugme };
  menu.querySelector('button').focus();
}

document.addEventListener('click', (e) => {
  if (D.acikMenu && !D.acikMenu.menu.contains(e.target) && !D.acikMenu.dugme.contains(e.target)) menuKapat();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && D.acikMenu) {
    const d = D.acikMenu.dugme;
    menuKapat();
    d.focus();
  }
  if (e.key === '/' && !e.ctrlKey && !e.metaKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && !document.querySelector('dialog[open]') && !$('#uygulama').hidden) {
    e.preventDefault();
    $('#girdi').focus();
  }
});

let bildirimZaman = null;
function bildir(metin, geriAl) {
  const b = $('#bildirim');
  b.querySelector('span').textContent = metin;
  const dugme = b.querySelector('button');
  dugme.hidden = !geriAl;
  dugme.onclick = geriAl
    ? () => {
        geriAl();
        b.hidden = true;
      }
    : null;
  b.hidden = false;
  clearTimeout(bildirimZaman);
  bildirimZaman = setTimeout(() => (b.hidden = true), geriAl ? 6500 : 3500);
}

/* ───────── hızlı ekleme ───────── */

function onizlemeCiz() {
  const metin = $('#girdi').value;
  const kutu = $('#onizleme');
  if (!metin.trim() || !D.gorunen) return kutu.replaceChildren();
  const simdi = new Date();
  const cip = (t, sinif = '') => h('span', { class: `cip ${sinif}`, text: t });
  const liste = O.cokluAyristir(metin, simdi, D.gorunen.ayarlar);
  if (liste.length > 1) {
    // birden çok görev: her biri başlığı ve zamanıyla
    return kutu.replaceChildren(
      cip(`🧩 ${liste.length} görev eklenecek`, 'altin'),
      ...liste.map((x) => cip(`“${x.baslik}”${x.zaman ? ' · ' + O.tarihMetni(new Date(x.zaman), simdi, x.tumGun) : ''}`)),
    );
  }
  const r = liste[0];
  const c = [cip(`“${r.baslik}”`, 'altin')];
  c.push(cip(r.zaman ? `📅 ${O.tarihMetni(new Date(r.zaman), simdi, r.tumGun)}` : '📥 tarihsiz'));
  if (r.tekrar) c.push(cip(`↻ ${O.tekrarMetni(r.tekrar)}`));
  if (r.zaman && !r.tumGun) {
    const hat = r.hatirlat || D.gorunen.ayarlar.varsayilanHatirlatma;
    c.push(cip(hat.length ? `🔔 ${O.hatirlatmaMetni(hat)}` : '🔕 sessiz'));
  } else if (r.zaman) c.push(cip('☀️ sabah özetinde'));
  if (r.kategori) c.push(cip(`📁 ${r.kategori}`));
  if (r.oncelik === 'yuksek') c.push(cip('❗ yüksek', 'kirmizi'));
  if (r.not) c.push(cip(`📝 ${r.not.length > 40 ? r.not.slice(0, 39) + '…' : r.not}`));
  kutu.replaceChildren(...c);
}

function hizliEkle(e) {
  e.preventDefault();
  const girdi = $('#girdi');
  const metin = girdi.value.trim();
  if (!metin) return girdi.focus();
  const liste = O.cokluAyristir(metin, new Date(), D.gorunen.ayarlar);
  const kimlikler = [];
  const yeniKategoriler = [];
  for (const r of liste) {
    const id = O.yeniKimlik();
    kimlikler.push(id);
    islemEkle({ tur: 'ekle', id, alanlar: { baslik: r.baslik, not: r.not, zaman: r.zaman, tumGun: r.tumGun, tekrar: r.tekrar, kategori: r.kategori, oncelik: r.oncelik, hatirlat: r.hatirlat, kaynak: 'site' } });
    if (r.kategori && !D.gorunen.ayarlar.kategoriler.includes(r.kategori) && !yeniKategoriler.includes(r.kategori)) yeniKategoriler.push(r.kategori);
  }
  if (yeniKategoriler.length) islemEkle({ tur: 'ayarlar', alanlar: { kategoriler: [...D.gorunen.ayarlar.kategoriler, ...yeniKategoriler] } });
  girdi.value = '';
  onizlemeCiz();
  const geriAl = () => kimlikler.forEach((id) => islemEkle({ tur: 'sil', id }));
  if (liste.length > 1) return bildir(`+ ${liste.length} görev eklendi`, geriAl);
  const r = liste[0];
  bildir(`+ ${r.baslik}${r.zaman ? ' · ' + O.tarihMetni(new Date(r.zaman), new Date(), r.tumGun) : ''}`, geriAl);
}

/* ───────── düzenleme ───────── */

let duzenlenen = null;

function secimleriKur() {
  $('#gunler-secim').replaceChildren(...[1, 2, 3, 4, 5, 6, 0].map((n) => h('label', {}, h('input', { type: 'checkbox', name: 'gun', value: String(n) }), h('span', { text: KISA_GUN[n] }))));
  const hat = (kap, ad) => kap.replaceChildren(...HATIRLAT_SECENEK.map(([m, t]) => h('label', {}, h('input', { type: 'checkbox', name: ad, value: String(m) }), h('span', { text: t }))));
  hat($('#hatirlat-secim'), 'hatirlat');
  hat($('#ayar-hatirlat'), 'varsayilan');
}

function tekrarSecimi(t) {
  if (!t) return '';
  if (t.tur === 'hafta' && t.gunler && t.gunler.length) return t.gunler.length === 5 && [1, 2, 3, 4, 5].every((x) => t.gunler.includes(x)) ? 'haftaici' : 'gunler';
  return t.tur;
}

function duzenleAlanlari() {
  const f = $('#duzenle-form');
  const tur = f.tekrar.value;
  const aralikAd = { gun: 'kaç günde bir', hafta: 'kaç haftada bir', ay: 'kaç ayda bir', yil: 'kaç yılda bir' }[tur];
  $('#aralik-alan').hidden = !aralikAd;
  if (aralikAd) $('#aralik-alan span').textContent = aralikAd;
  $('#gunler-alan').hidden = tur !== 'gunler';
  f.saat.disabled = f.tumGun.checked;
  const saatli = !!f.tarih.value && !f.tumGun.checked;
  for (const k of $$('#hatirlat-secim input')) k.disabled = !saatli;
  $('#duzenle-bilgi').textContent = !f.tarih.value && tur ? 'Tekrar için bir başlangıç tarihi gerekir; boş kalırsa bugünden başlar.' : f.tarih.value && f.tumGun.checked ? 'Gün boyu görevler o günün sabah özetinde hatırlatılır.' : duzenleBilgi();
}

function duzenleBilgi() {
  if (!duzenlenen) return '';
  const g = duzenlenen;
  const parca = [`#${g.no}`];
  if (g.olusturma) parca.push(`${O.tarihMetni(new Date(g.olusturma), new Date())} eklendi`);
  if (g.kaynak === 'telegram') parca.push("Telegram'dan");
  if (g.tamamlanmaSayisi) parca.push(`${g.tamamlanmaSayisi} kez tamamlandı`);
  if (g.kacirilan) parca.push(`${g.kacirilan} tekrar kaçırıldı`);
  return parca.join(' · ');
}

function duzenleAc(id, odak) {
  const g = D.gorunen && D.gorunen.gorevler.find((x) => x.id === id);
  if (!g) return bildir('Görev bulunamadı (silinmiş olabilir).');
  duzenlenen = g;
  const f = $('#duzenle-form');
  f.reset();
  f.baslik.value = g.baslik;
  f.not.value = g.not || '';
  f.tarih.value = g.zaman ? tarihGirdisi(new Date(g.zaman)) : '';
  f.saat.value = g.zaman && !g.tumGun ? O.saatMetni(new Date(g.zaman)) : '';
  f.tumGun.checked = !!(g.zaman && g.tumGun);
  f.tekrar.value = tekrarSecimi(g.tekrar);
  f.aralik.value = String((g.tekrar && g.tekrar.aralik) || 1);
  for (const k of $$('#gunler-secim input')) k.checked = !!(g.tekrar && g.tekrar.gunler && g.tekrar.gunler.includes(+k.value));
  for (const k of $$('#hatirlat-secim input')) k.checked = (g.hatirlat || []).includes(+k.value);
  f.kategori.value = g.kategori || '';
  for (const r of $$('#oncelik-secim input')) r.checked = r.value === g.oncelik;
  duzenleAlanlari();
  const d = $('#duzenle');
  d.showModal();
  if (odak === 'tarih') f.tarih.focus();
}

function duzenleKaydet() {
  const g = duzenlenen;
  if (!g) return;
  const f = $('#duzenle-form');
  const simdi = new Date();
  let zaman = null;
  let tumGun = false;
  const tur = f.tekrar.value;
  let tarih = f.tarih.value;
  if (!tarih && tur) tarih = tarihGirdisi(simdi);
  if (tarih) {
    const [y, a, gun] = tarih.split('-').map(Number);
    if (f.tumGun.checked || !f.saat.value) {
      zaman = O.yerelTarih(y, a, gun, 9, 0);
      tumGun = true;
    } else {
      const [sa, dk] = f.saat.value.split(':').map(Number);
      zaman = O.yerelTarih(y, a, gun, sa, dk);
    }
  } else if (f.saat.value) {
    const [sa, dk] = f.saat.value.split(':').map(Number);
    const p = O.yerel(simdi);
    zaman = O.yerelTarih(p.y, p.a, p.g, sa, dk);
    if (zaman <= simdi) zaman = O.gunEkle(zaman, 1);
  }
  let tekrar = null;
  const aralik = Math.max(1, Math.min(30, parseInt(f.aralik.value, 10) || 1));
  if (tur === 'haftaici') tekrar = { tur: 'hafta', gunler: [1, 2, 3, 4, 5] };
  else if (tur === 'gunler') {
    let gunler = $$('#gunler-secim input:checked').map((k) => +k.value);
    if (!gunler.length && zaman) gunler = [O.yerel(zaman).hg];
    tekrar = { tur: 'hafta', gunler };
  } else if (tur) tekrar = aralik > 1 ? { tur, aralik } : { tur };
  // "Seçili günler" ya da "hafta içi" seçildiyse tarih ilk uygun güne kayar
  if (zaman && tekrar && tekrar.gunler && tekrar.gunler.length) for (let i = 0; i < 7 && !tekrar.gunler.includes(O.yerel(zaman).hg); i++) zaman = O.gunEkle(zaman, 1);
  const hatirlat = tumGun || !zaman ? [] : $$('#hatirlat-secim input:checked').map((k) => +k.value);
  const oncelik = ($$('#oncelik-secim input:checked')[0] || {}).value || 'normal';
  const kategori = f.kategori.value.trim() || null;
  islemEkle({
    tur: 'guncelle',
    id: g.id,
    alanlar: { baslik: f.baslik.value.trim() || g.baslik, not: f.not.value.trim(), zaman: zaman ? O.isoYaz(zaman) : null, tumGun, tekrar, hatirlat, kategori, oncelik },
  });
  if (kategori && !D.gorunen.ayarlar.kategoriler.includes(kategori)) islemEkle({ tur: 'ayarlar', alanlar: { kategoriler: [...D.gorunen.ayarlar.kategoriler, kategori] } });
  bildir('✓ Kaydedildi');
}

/* ───────── ayarlar ───────── */

function ayarlarAc() {
  const v = D.gorunen;
  const f = $('#ayarlar-form');
  f.sabahOzeti.value = v.ayarlar.sabahOzeti || '';
  f.aksamOzeti.value = v.ayarlar.aksamOzeti || '';
  f.kategoriler.value = v.ayarlar.kategoriler.join(', ');
  f.hitap.value = v.ayarlar.hitap || '';
  for (const k of $$('#ayar-hatirlat input')) k.checked = (v.ayarlar.varsayilanHatirlatma || []).includes(+k.value);
  const tok = D.baglanti.token;
  $('#ayar-baglanti').textContent = `Veri deposu: ${D.baglanti.depo} · anahtar: ${tok.slice(0, 11)}…${tok.slice(-4)} (${D.baglanti.hatirla === false ? 'yalnız bu oturum' : 'bu cihazda kayıtlı'})`;
  $('#ayar-actions').href = `https://github.com/${SITE_DEPO}/actions/workflows/${WORKFLOW}`;
  ayarDurumCiz();
  $('#ayarlar').showModal();
  calismaKontrol();
}

function ayarDurumCiz() {
  const v = D.gorunen;
  const d = saglikDurumu();
  const c = $('#ayar-calisma');
  c.firstElementChild.className = `led ${d.led}`;
  c.lastElementChild.textContent = d.ayrinti;
  const t = $('#ayar-telegram');
  const bagli = !!v.telegram.chatId;
  t.firstElementChild.className = `led ${bagli ? 'yesil' : 'sari'}`;
  const bot = v.durum.bot && v.durum.bot.kullaniciAdi ? `@${v.durum.bot.kullaniciAdi}` : 'bot';
  t.lastElementChild.textContent = bagli ? `Telegram bağlı: ${bot} → ${v.telegram.ad || 'sohbet'}` : `Telegram bağlı değil (${bot})`;
  $('#ayar-ayir').hidden = !bagli;
  $('#ayar-eslestir').textContent = bagli ? 'Başka hesaba bağla' : "Telegram'ı bağla";
  const s = $('#ayar-saglik');
  s.hidden = !(v.durum.saglik && v.durum.saglik.hata);
  if (!s.hidden) s.textContent = `Son uyarı: ${v.durum.saglik.hata}`;
}

function ayarlarKaydet() {
  const f = $('#ayarlar-form');
  const kategoriler = [...new Set(f.kategoriler.value.split(',').map((k) => k.trim()).filter(Boolean))].slice(0, 30);
  islemEkle({
    tur: 'ayarlar',
    alanlar: {
      sabahOzeti: f.sabahOzeti.value || '',
      aksamOzeti: f.aksamOzeti.value || '',
      kategoriler,
      hitap: f.hitap.value.trim(),
      varsayilanHatirlatma: $$('#ayar-hatirlat input:checked').map((k) => +k.value),
    },
  });
  bildir('✓ Ayarlar kaydedildi');
}

function eslestirmeBaslat() {
  const harf = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  const kod = Array.from(a, (b) => harf[b % harf.length]).join('');
  sakla.sil(K.tgSonra);
  islemEkle({ tur: 'telegram', alanlar: { kod, kodSonu: O.isoYaz(new Date(Date.now() + 30 * 60e3)) } });
  takipBaslat();
  if ($('#ayarlar').open) $('#ayarlar').close();
  requestAnimationFrame(() => $('#telegram-kart').scrollIntoView({ behavior: hareketAzalt() ? 'auto' : 'smooth', block: 'center' }));
}

function indir() {
  const v = D.gorunen;
  const blob = new Blob([JSON.stringify({ ...v, durum: undefined }, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `gorevler-${tarihGirdisi(new Date())}.json` });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

function cikis() {
  if (D.kuyruk.length && !confirm(`${D.kuyruk.length} değişiklik henüz kaydedilmedi; çıkarsan kaybolur. Yine de çıkılsın mı?`)) return;
  for (const k of Object.values(K)) sakla.sil(k);
  location.hash = '';
  location.reload();
}

/* ───────── bağlanma ───────── */

async function baglan(e) {
  e.preventDefault();
  const mesaj = $('#baglan-mesaj');
  const dugme = $('#baglan-dugme');
  const depo = $('#baglan-depo')
    .value.trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  const token = $('#baglan-token').value.trim();
  const hatirla = $('#baglan-hatirla').checked;
  const yaz = (t, sinif = '') => {
    mesaj.textContent = t;
    mesaj.className = `mesaj-satiri ${sinif}`;
  };
  if (!/^[\w.-]+\/[\w.-]+$/.test(depo)) return yaz('Depo “kullanıcı/depo” biçiminde olmalı, örneğin ' + `${SAHIP}/gorev-verisi`, 'hata');
  if (!/^(github_pat_|ghp_)\w{20,}$/.test(token)) return yaz('Bu bir GitHub anahtarına benzemiyor; github_pat_ ile başlamalı.', 'hata');
  dugme.disabled = true;
  yaz('Bağlanılıyor…');
  try {
    const r = await gh(`/repos/${depo}`, { token });
    if (r.status === 401) throw new BagHata('token', 401);
    if (r.status !== 200) throw new BagHata('depo', r.status);
    const bilgi = await r.json();
    if (!bilgi.private && !confirm(`${depo} herkese açık bir depo! Görevlerini herkes görebilir. Depoyu GitHub'da Private yapman önerilir. Yine de bağlanılsın mı?`)) throw new Error('Vazgeçildi.');
    D.baglanti = { depo, token, hatirla };
    D.uzak = null;
    D.kuyruk = [];
    await cek({ zorla: true });
    if (!D.uzak.sha) await kaydet(); // veri dosyasını oluştur (yazma izni de denenmiş olur)
    if (D.hata) throw D.hata;
    sakla.yaz(K.baglanti, D.baglanti, hatirla);
    yaz('Bağlandı ✓', 'iyi');
    $('#baglan-token').value = '';
    ciz();
    calismaKontrol();
    bildir('Bağlandı ✓ İlk görevini yaz.');
    if (matchMedia('(pointer: fine)').matches) $('#girdi').focus();
  } catch (err) {
    D.baglanti = null;
    D.uzak = null;
    D.hata = null;
    yaz(err instanceof BagHata ? hataMetni(err) : err.message, 'hata');
  } finally {
    dugme.disabled = false;
  }
}

/* ───────── zamanlayıcılar ───────── */

async function yenile(zorla = false) {
  if (!D.baglanti || D.kaydediliyor) return;
  try {
    const degisti = await cek({ zorla });
    if (D.kuyruk.length || (D.uzak && !D.uzak.sha)) kaydet();
    if (degisti || zorla) ciz();
    else {
      esitlemeCiz();
      // göreli zamanlar ("5 dk sonra") dakika dakika güncellensin
      ciz();
    }
  } catch (e) {
    D.hata = e;
    ciz();
  }
}

let takipZamanlayici = null;
function takipBaslat() {
  clearInterval(takipZamanlayici);
  const bitis = Date.now() + 30 * 60e3;
  takipZamanlayici = setInterval(() => {
    const v = D.gorunen;
    if (Date.now() > bitis || (v && v.telegram.chatId)) {
      clearInterval(takipZamanlayici);
      if (v && v.telegram.chatId) bildir("✓ Telegram bağlandı! Hatırlatmalar artık telefonuna gelecek.");
      return;
    }
    if (document.visibilityState === 'visible') yenile();
  }, 15000);
}

function zamanlayicilariKur() {
  let tur = 0;
  setInterval(() => {
    if (document.visibilityState !== 'visible' || document.querySelector('dialog[open]') || D.acikMenu) return;
    yenile();
    if (++tur % 3 === 0) calismaKontrol();
  }, 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && D.baglanti && Date.now() - D.sonCekme > 20000) {
      yenile();
      calismaKontrol();
    }
  });
  addEventListener('online', () => {
    kaydet();
    yenile();
  });
  addEventListener('offline', esitlemeCiz);
}

function derinBaglanti() {
  const m = /^#g=([\w-]+)$/.exec(location.hash);
  if (!m || !D.gorunen) return;
  history.replaceState(null, '', location.pathname + location.search);
  duzenleAc(m[1]);
}

/* ───────── başlat ───────── */

function baslat() {
  try {
    if (localStorage.getItem('portfolio-motion') === 'paused') document.documentElement.classList.add('motion-paused');
  } catch {
    /* tercih yok */
  }
  secimleriKur();
  $('#baglan-depo').value = `${SAHIP}/gorev-verisi`;
  $('#anahtar-olustur').href =
    'https://github.com/settings/personal-access-tokens/new?' +
    new URLSearchParams({ name: 'Görev hatırlatıcısı', description: 'gorevler sayfası ve Telegram botu için: yalnız gorev-verisi deposu, Contents read/write', expires_in: '366', contents: 'write' }).toString();
  $('#baglan-form').addEventListener('submit', baglan);
  $('#hizli').addEventListener('submit', hizliEkle);
  $('#girdi').addEventListener('input', onizlemeCiz);
  $('#girdi').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.currentTarget.value = '';
      onizlemeCiz();
    }
  });
  for (const b of $$('#ornekler button'))
    b.addEventListener('click', () => {
      $('#girdi').value = b.textContent;
      onizlemeCiz();
      $('#girdi').focus();
    });
  $('#duzenle-form').addEventListener('change', duzenleAlanlari);
  $('#duzenle-form').addEventListener('submit', (e) => {
    if (e.submitter && e.submitter.value === 'kaydet') duzenleKaydet();
  });
  for (const b of $$('#duzenle-form button[value=vazgec], #ayarlar-form button[value=vazgec]')) b.formNoValidate = true;
  $('#duzenle-sil').addEventListener('click', () => {
    const g = duzenlenen;
    $('#duzenle').close();
    if (!g) return;
    islemEkle({ tur: 'sil', id: g.id });
    bildir(`🗑 ${g.baslik} silindi`, () => islemEkle({ tur: 'copGeriAl', id: g.id }));
  });
  $('#ayarlar-ac').addEventListener('click', ayarlarAc);
  $('#saglik').addEventListener('click', ayarlarAc);
  $('#ayarlar-form').addEventListener('submit', (e) => {
    if (e.submitter && e.submitter.value === 'kaydet') ayarlarKaydet();
  });
  $('#ayar-eslestir').addEventListener('click', eslestirmeBaslat);
  $('#ayar-ayir').addEventListener('click', () => {
    if (!confirm('Telegram bağlantısı kesilsin mi? Hatırlatmalar gelmez.')) return;
    islemEkle({ tur: 'telegram', alanlar: { chatId: null, ad: null, kod: null, kodSonu: null } });
    $('#ayarlar').close();
    bildir('Telegram bağlantısı kesildi');
  });
  $('#ayar-indir').addEventListener('click', indir);
  $('#ayar-cikis').addEventListener('click', () => {
    if (confirm('Bu tarayıcıdaki anahtar ve önbellek silinsin mi? Görevlerin depoda kalır.')) cikis();
  });
  $('#tg-kod-uret').addEventListener('click', eslestirmeBaslat);
  $('#tg-sonra').addEventListener('click', () => {
    sakla.yaz(K.tgSonra, Date.now());
    ciz();
  });
  $('#cop-bosalt').addEventListener('click', () => {
    if (confirm('Çöp kutusundaki görevler kalıcı olarak silinsin mi?')) islemEkle({ tur: 'copBosalt' });
  });
  addEventListener('hashchange', derinBaglanti);

  D.filtre = sakla.oku(K.filtre) || 'hepsi';
  D.baglanti = sakla.oku(K.baglanti);
  if (!D.baglanti || !D.baglanti.token) {
    D.baglanti = null;
    ciz();
    return;
  }
  const onb = sakla.oku(K.onbellek);
  if (onb && onb.depo === D.baglanti.depo && onb.veri) D.uzak = { veri: O.veriDuzelt(onb.veri), sha: onb.sha, etag: onb.etag };
  D.kuyruk = sakla.oku(K.kuyruk) || [];
  ciz();
  derinBaglanti();
  cek()
    .catch((e) => {
      D.hata = e;
    })
    .finally(() => {
      ciz();
      derinBaglanti();
      if (D.kuyruk.length || (D.uzak && !D.uzak.sha)) kaydet();
      const v = D.gorunen;
      if (v && v.telegram.kod && !v.telegram.chatId && new Date(v.telegram.kodSonu) > new Date()) takipBaslat();
    });
  calismaKontrol();
  zamanlayicilariKur();
}

baslat();
