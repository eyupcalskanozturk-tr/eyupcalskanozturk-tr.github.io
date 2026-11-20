#!/usr/bin/env node
/*
 * gorev-sina.mjs · Görev hatırlatıcısının sınaması
 *
 *   node .claude/araclar/gorev-sina.mjs
 *
 * 1. Türkçe ayrıştırıcı: örnek cümleler beklenen başlık/zaman/tekrar sonucunu veriyor mu?
 * 2. Çekirdek işlemler: tamamla, geri al, sil/çöp, ertele, tekrar ilerletme, hatırlatma planı.
 * 3. Telegram botu: sahte GitHub + sahte Telegram ile uçtan uca senaryo (eşleştirme,
 *    görev ekleme, hatırlatma, buton, özet, kayıt çakışması, gönderim hatası, izin hatası).
 * Ağ kullanmaz. Hata varsa çıkış kodu 1.
 */
import * as O from '../../gorevler/ortak.js';
import { calistir } from '../../.github/gorev-hatirlatici/calistir.mjs';

let hata = 0;
let toplam = 0;
const esit = (ad, gercek, beklenen) => {
  toplam++;
  const g = JSON.stringify(gercek);
  const b = JSON.stringify(beklenen);
  if (g !== b) {
    hata++;
    console.log(`  ✗ ${ad}\n      beklenen: ${b}\n      gelen:    ${g}`);
  }
};
const dogru = (ad, kosul, ek = '') => {
  toplam++;
  if (!kosul) {
    hata++;
    console.log(`  ✗ ${ad}${ek ? ' · ' + ek : ''}`);
  }
};
const T = (s) => new Date(s);

/* ───────── 1. ayrıştırıcı ───────── */
console.log('1) Türkçe ayrıştırıcı');
const SIMDI = T('2026-11-20T10:00:00+03:00'); // Cuma 10:00
const ozet = (r) => ({
  b: r.baslik,
  z: r.zaman ? O.tarihMetni(T(r.zaman), SIMDI, r.tumGun) : null,
  ...(r.tekrar ? { t: O.tekrarMetni(r.tekrar) } : {}),
  ...(r.kategori ? { k: r.kategori } : {}),
  ...(r.oncelik !== 'normal' ? { o: r.oncelik } : {}),
  ...(r.hatirlat ? { h: r.hatirlat } : {}),
  ...(r.not ? { n: r.not } : {}),
});
const CUMLELER = [
  ['yarın 14:00 veritabanı ödevi #okul !', { b: 'Veritabanı ödevi', z: 'Yarın 14:00', k: 'Okul', o: 'yuksek' }],
  ["cuma 9'da toplantı", { b: 'Toplantı', z: '27 Kasım Cuma 09:00' }],
  ['her pazartesi 10:00 haftalık rapor', { b: 'Haftalık rapor', z: 'Pazartesi 10:00', t: 'Her Pazartesi' }],
  ['2 saat sonra çamaşırları as', { b: 'Çamaşırları as', z: 'Bugün 12:00' }],
  ['25 kasım sınav', { b: 'Sınav', z: 'Çarşamba' }],
  ['akşam 8 de ilaç', { b: 'İlaç', z: 'Bugün 20:00' }],
  ['her gün 22:00 ilaç iç', { b: 'İlaç iç', z: 'Bugün 22:00', t: 'Her gün' }],
  ['haftaya salı diş randevusu 15:30', { b: 'Diş randevusu', z: 'Salı 15:30' }],
  ['süt al', { b: 'Süt al', z: null }],
  ["her ayın 15'i kira öde", { b: 'Kira öde', z: '15 Aralık Salı', t: "Her ayın 15'i" }],
  ['14.30 da berbere git', { b: 'Berbere git', z: 'Bugün 14:30' }],
  ['berbere git 14.30 da', { b: 'Berbere git', z: 'Bugün 14:30' }],
  ['5.12 doğum günü', { b: 'Doğum günü', z: '5 Aralık Cumartesi' }],
  ['pazartesiye kadar proje teslim', { b: 'Proje teslim', z: 'Pazartesi' }],
  ['yarın sabah koşu', { b: 'Koşu', z: 'Yarın 09:00' }],
  ['bu akşam sinema', { b: 'Sinema', z: 'Bugün 19:00' }],
  ["gece 1'de yedekle", { b: 'Yedekle', z: 'Yarın 01:00' }],
  ["öğlen 1'de yemek", { b: 'Yemek', z: 'Bugün 13:00' }],
  ["saat 3'te ders", { b: 'Ders', z: 'Bugün 15:00' }],
  ["9'da spor", { b: 'Spor', z: 'Bugün 21:00' }],
  ['yarım saat sonra çay', { b: 'Çay', z: 'Bugün 10:30' }],
  ['hafta içi 07:30 kalk', { b: 'Kalk', z: 'Pazartesi 07:30', t: 'Hafta içi her gün' }],
  ['3 gün sonra fatura', { b: 'Fatura', z: 'Pazartesi' }],
  ["İzmir'e bilet al yarın", { b: "İzmir'e bilet al", z: 'Yarın' }],
  ["15 Ocak'ta vize", { b: 'Vize', z: '15 Ocak 2027 Cuma' }],
  ['cumartesi öğleden sonra 3 te maç', { b: 'Maç', z: 'Yarın 15:00' }],
  ['her cuma ve pazartesi spor 18:00', { b: 'Spor', z: 'Bugün 18:00', t: 'Her Pazartesi, Cuma' }],
  ['1 saat önce hatırlat yarın 15:00 dişçi', { b: 'Dişçi', z: 'Yarın 15:00', h: [60, 0] }],
  ['pazara git sebze al', { b: 'Pazara git sebze al', z: null }],
  ['pazar günü pazara git', { b: 'Pazara git', z: 'Pazar' }],
  ['akşam yemeği hazırla', { b: 'Akşam yemeği hazırla', z: null }],
  ['12:00 öğle yemeği', { b: 'Öğle yemeği', z: 'Bugün 12:00' }],
  ['her akşam yemekten sonra ilaç', { b: 'Yemekten sonra ilaç', z: 'Bugün 19:00', t: 'Her gün' }],
  ['her sabah 7 su iç', { b: 'Su iç', z: 'Yarın 07:00', t: 'Her gün' }],
  ['hafta sonu temizlik', { b: 'Temizlik', z: 'Yarın' }],
  ['ay sonu kira', { b: 'Kira', z: '30 Kasım Pazartesi' }],
  ["ayın 25'inde fatura", { b: 'Fatura', z: 'Çarşamba' }],
  ['yarına kadar rapor // 3. bölüm eksik', { b: 'Rapor', z: 'Yarın', n: '3. bölüm eksik' }],
  ['oda #3 temizle', { b: 'Oda #3 temizle', z: null }],
  ['acil maili cevapla!!', { b: 'Acil maili cevapla', z: null, o: 'yuksek' }],
  ['2026-12-01 kayıt yenile', { b: 'Kayıt yenile', z: '1 Aralık Salı' }],
  ['iki haftada bir saç kesimi', { b: 'Saç kesimi', z: 'Bugün', t: '2 haftada bir' }],
  ['her ayın son günü kira', { b: 'Kira', z: '30 Kasım Pazartesi', t: 'Her ayın son günü' }],
  ['yarın gece yarısı teslim', { b: 'Teslim', z: 'Yarın 23:59' }],
  ["21.30'da maç izle", { b: 'Maç izle', z: 'Bugün 21:30' }],
  ['sessiz yarın 10:00 not al', { b: 'Not al', z: 'Yarın 10:00', h: [] }],
  ['gelecek hafta sunum', { b: 'Sunum', z: '27 Kasım Cuma' }],
  ['her hafta sonu bahçe', { b: 'Bahçe', z: 'Yarın', t: 'Her hafta sonu' }],
  ['30 dk sonra fırını kapat', { b: 'Fırını kapat', z: 'Bugün 10:30' }],
  ['bugün 09:00 sabah koşusu', { b: 'Sabah koşusu', z: 'Bugün 09:00' }],
  ['akşam 7:30 yemek', { b: 'Yemek', z: 'Bugün 19:30' }],
  ['21:00 gece koşusu', { b: 'Gece koşusu', z: 'Bugün 21:00' }],
  ["sabah 9'da koşu", { b: 'Koşu', z: 'Yarın 09:00' }],
];
for (const [cumle, beklenen] of CUMLELER) esit(cumle, ozet(O.ayristir(cumle, SIMDI)), beklenen);
console.log(`   ${CUMLELER.length} cümle`);

// tek mesajda birden çok görev
const COKLU = [
  [
    'Yarına Mobil Uygulama projeye başlanıcak,Gömülü Sistemler konu belirlenecek,Claude Eğitimleri için çalışmaya başlanıcak',
    [
      { b: 'Mobil Uygulama projeye başlanıcak', z: 'Yarın' },
      { b: 'Gömülü Sistemler konu belirlenecek', z: 'Yarın' },
      { b: 'Claude Eğitimleri için çalışmaya başlanıcak', z: 'Yarın' },
    ],
  ],
  ['süt, ekmek, yumurta al', [{ b: 'Süt, ekmek, yumurta al', z: null }]],
  [
    'yarın 14:00 rapor yaz, pazartesi sunum hazırla #okul',
    [
      { b: 'Rapor yaz', z: 'Yarın 14:00', k: 'Okul' },
      { b: 'Sunum hazırla', z: 'Pazartesi', k: 'Okul' },
    ],
  ],
  [
    '- süt al\n- yarın 10:00 dişçi\n• kitap oku',
    [
      { b: 'Süt al', z: null },
      { b: 'Dişçi', z: 'Yarın 10:00' },
      { b: 'Kitap oku', z: null },
    ],
  ],
  ['rapor yaz, hocaya gönder // son gün', [{ b: 'Rapor yaz, hocaya gönder', z: null, n: 'son gün' }]],
];
for (const [cumle, beklenen] of COKLU) esit(`çoklu: ${cumle.replace(/\n/g, ' ⏎ ')}`, O.cokluAyristir(cumle, SIMDI).map(ozet), beklenen);

/* ───────── 2. çekirdek ───────── */
console.log('2) Çekirdek işlemler');
{
  const v = O.bosVeri();
  const g = O.gorevEkle(v, { baslik: 'İlaç', zaman: '2026-11-20T22:00:00+03:00', tekrar: { tur: 'gun' } }, SIMDI, 'ilac');
  esit('varsayılan hatırlatma', g.hatirlat, [60, 0]);
  esit('numara', g.no, 1);
  const r = O.tamamla(v, 'ilac', T('2026-11-20T22:05:00+03:00'));
  esit('tekrar eden görev bitmez, ilerler', [r.tekrar, g.zaman, g.durum], [true, '2026-11-21T22:00:00+03:00', 'acik']);
  O.geriAl(v, 'ilac', SIMDI);
  esit('geri al önceki zamana döner', g.zaman, '2026-11-20T22:00:00+03:00');
  // işaretlenmeyen tekrar ertesi günün başında ilerler
  esit('gece yarısından önce ilerlemez', O.tekrarIlerlet(v, T('2026-11-20T23:30:00+03:00')).length, 0);
  O.tekrarIlerlet(v, T('2026-11-21T00:10:00+03:00'));
  esit('ertesi gün ilerler', [g.zaman, g.kacirilan], ['2026-11-21T22:00:00+03:00', 1]);

  const t = O.gorevEkle(v, { baslik: 'Tek seferlik', zaman: '2026-11-20T14:00:00+03:00' }, SIMDI);
  O.tamamla(v, t.id, SIMDI);
  esit('tek seferlik biter', t.durum, 'bitti');
  O.geriAl(v, t.id, SIMDI);
  esit('geri alınca açılır', t.durum, 'acik');
  O.gorevSil(v, t.no, SIMDI);
  esit('silinen çöpe gider', [v.gorevler.length, v.cop.length], [1, 1]);
  O.copGeriAl(v, String(t.no), SIMDI);
  esit('çöpten geri gelir', [v.gorevler.length, v.cop.length], [2, 0]);
  const t2 = O.gorevBul(v, t.id);

  // ertele: zamanı geçmiş tek seferlik görev yeni zamana taşınır
  O.ertele(v, t2.id, T('2026-11-20T16:00:00+03:00'), T('2026-11-20T14:30:00+03:00'));
  esit('geçmiş görev ertelenince taşınır', [t2.zaman, t2.ertele, t2.hatirlat], ['2026-11-20T16:00:00+03:00', null, [60, 0]]);
  // hatırlatma planı
  const plan = O.hatirlatmaPlani(v, T('2026-11-20T14:57:00+03:00'));
  esit('1 saat önce hatırlatma 3 dk erken gelir', plan.map((p) => [p.gorev.id, p.dakika]), [[t2.id, 60]]);
  v.durum.gonderilen[plan[0].anahtar] = O.isoYaz(SIMDI);
  esit('gönderilen tekrar gelmez', O.hatirlatmaPlani(v, T('2026-11-20T15:01:00+03:00')).length, 0);
  // tekrar eden görev ertelenirse önceki hatırlatmalar atlanır
  O.ertele(v, 'ilac', T('2026-11-21T22:30:00+03:00'), T('2026-11-21T21:00:00+03:00'));
  const p2 = O.hatirlatmaPlani(v, T('2026-11-21T22:26:00+03:00'));
  esit('erteleme hatırlatması', p2.map((p) => p.ertele || false), [true]);
  // özet planı
  esit('sabah özeti 07:56', O.ozetPlani(v, T('2026-11-20T07:56:00+03:00')).map((o) => o.tur), ['sabah']);
  esit('sabah özeti 11:30 gönderilmez', O.ozetPlani(v, T('2026-11-20T11:30:00+03:00')).map((o) => o.tur), []);
  // gruplama
  const v2 = O.bosVeri();
  O.gorevEkle(v2, { baslik: 'Geç', zaman: '2026-11-20T09:00:00+03:00' }, SIMDI);
  O.gorevEkle(v2, { baslik: 'Bugün', zaman: '2026-11-20T18:00:00+03:00' }, SIMDI);
  O.gorevEkle(v2, { baslik: 'Gün boyu', zaman: '2026-11-20T09:00:00+03:00', tumGun: true }, SIMDI);
  O.gorevEkle(v2, { baslik: 'Yarın', zaman: '2026-11-21T09:00:00+03:00', tumGun: true }, SIMDI);
  O.gorevEkle(v2, { baslik: 'Tarihsiz' }, SIMDI);
  const gr = O.grupla(v2, SIMDI);
  esit('gruplar', Object.fromEntries(Object.entries(gr).map(([k, x]) => [k, x.map((g) => g.baslik)])), { geciken: ['Geç'], bugun: ['Bugün', 'Gün boyu'], yarin: ['Yarın'], hafta: [], sonra: [], tarihsiz: ['Tarihsiz'] });
  // geçmiş saate eklenen görev için "zamanı geldi" gönderilmez
  const v3 = O.bosVeri();
  O.gorevEkle(v3, { baslik: 'Geçmiş', zaman: '2026-11-20T09:00:00+03:00' }, SIMDI);
  O.gorevEkle(v3, { baslik: 'Az sonra', zaman: '2026-11-20T10:03:00+03:00' }, SIMDI);
  esit('eklenmeden önceki hatırlatmalar gitmez', O.hatirlatmaPlani(v3, SIMDI).map((p) => [p.gorev.baslik, p.dakika]), [['Az sonra', 0]]);
  // 60 günden eski tamamlanmışlar budanır
  const v4 = O.bosVeri();
  const eski = O.gorevEkle(v4, { baslik: 'Eski' }, SIMDI);
  O.tamamla(v4, eski.id, T('2026-08-01T10:00:00+03:00'));
  const yeni = O.gorevEkle(v4, { baslik: 'Yeni' }, SIMDI);
  O.tamamla(v4, yeni.id, SIMDI);
  esit('60 günden eski bitenler budanır', [O.bitenleriBuda(v4, SIMDI), v4.gorevler.map((g) => g.baslik)], [1, ['Yeni']]);
  esit(
    'göreli metin',
    [O.goreceMetin(T('2026-11-20T12:00:00+03:00'), T('2026-11-20T10:00:30+03:00')), O.goreceMetin(T('2026-11-20T11:30:00+03:00'), SIMDI), O.goreceMetin(T('2026-11-20T09:35:00+03:00'), SIMDI)],
    ['2 saat sonra', '1 sa 30 dk sonra', '25 dk önce'],
  );
  esit('ertele süresi 30dk', O.isoYaz(O.erteleZamani('30dk', SIMDI)), '2026-11-20T10:30:00+03:00');
  esit('ertele yarın', O.isoYaz(O.erteleZamani('yarın', SIMDI)), '2026-11-21T09:00:00+03:00');
}

/* ───────── 3. bot (sahte GitHub + Telegram) ───────── */
console.log('3) Telegram botu · uçtan uca');
function sahteDunya() {
  const d = {
    dosya: null, // { metin, sha }
    shaSayac: 0,
    guncellemeler: [],
    giden: [], // { yontem, govde }
    mesajNo: 100,
    putHatasi: null, // bir sonraki PUT için durum kodu
    araYazma: null, // bir sonraki PUT'tan önce dosyayı değiştiren fonksiyon (çakışma)
    tgHatasi: null, // bir sonraki sendMessage için hata
    istek: [],
  };
  d.fetch = async (url, sec = {}) => {
    const yontem = sec.method || 'GET';
    d.istek.push(`${yontem} ${url.replace(/bot[^/]+\//, 'bot***/')}`);
    const cevap = (durum, govde) => new Response(govde === undefined ? null : JSON.stringify(govde), { status: durum, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('https://api.github.com/')) {
      const yol = url.slice('https://api.github.com'.length);
      if (sec.headers.authorization !== 'Bearer gh-sahte' && !yol.includes('/actions/')) return cevap(401, { message: 'Bad credentials' });
      if (yol === '/repos/eyup/gorev-verisi') return cevap(200, { private: true });
      if (yol === '/repos/eyup/gorev-verisi/contents/gorevler.json') {
        if (yontem === 'GET') return d.dosya ? cevap(200, { sha: d.dosya.sha, content: Buffer.from(d.dosya.metin).toString('base64') }) : cevap(404, { message: 'Not Found' });
        if (yontem === 'PUT') {
          if (d.araYazma) {
            const f = d.araYazma;
            d.araYazma = null;
            f(d);
          }
          if (d.putHatasi) {
            const kod = d.putHatasi;
            d.putHatasi = null;
            return cevap(kod, { message: 'hata' });
          }
          const g = JSON.parse(sec.body);
          if ((d.dosya && g.sha !== d.dosya.sha) || (!d.dosya && g.sha)) return cevap(409, { message: 'sha mismatch' });
          d.dosya = { metin: Buffer.from(g.content, 'base64').toString('utf8'), sha: `s${++d.shaSayac}` };
          return cevap(200, { content: { sha: d.dosya.sha } });
        }
      }
      if (yol.endsWith('/actions/workflows/gorev-hatirlatici.yml/enable')) return cevap(204);
      return cevap(404, { message: 'Not Found' });
    }
    if (url.startsWith('https://api.telegram.org/bot')) {
      const m = /\/bot([^/]+)\/(\w+)$/.exec(url);
      if (m[1] !== 'tg-sahte') return cevap(401, { ok: false, error_code: 401, description: 'Unauthorized' });
      const govde = JSON.parse(sec.body || '{}');
      const ok = (result) => cevap(200, { ok: true, result });
      switch (m[2]) {
        case 'getMe':
          return ok({ id: 1, is_bot: true, first_name: 'Görevci', username: 'eyup_gorev_bot' });
        case 'setMyCommands':
        case 'deleteWebhook':
          d.giden.push({ yontem: m[2], govde });
          return ok(true);
        case 'getUpdates': {
          d.guncellemeler = d.guncellemeler.filter((u) => u.update_id >= govde.offset);
          return ok(d.guncellemeler.slice(0, govde.limit || 100));
        }
        case 'sendMessage': {
          if (d.tgHatasi) {
            const h = d.tgHatasi;
            d.tgHatasi = null;
            return cevap(h, { ok: false, error_code: h, description: 'Bad Gateway' });
          }
          d.giden.push({ yontem: m[2], govde });
          return ok({ message_id: ++d.mesajNo, chat: { id: govde.chat_id, type: 'private' }, text: govde.text });
        }
        case 'editMessageText':
        case 'editMessageReplyMarkup':
        case 'answerCallbackQuery':
          d.giden.push({ yontem: m[2], govde });
          return ok(true);
        default:
          return cevap(404, { ok: false, error_code: 404, description: 'Not Found' });
      }
    }
    throw new Error('beklenmeyen adres ' + url);
  };
  d.veri = () => JSON.parse(d.dosya.metin);
  d.yaz = (f) => {
    const v = d.veri();
    f(v);
    d.dosya = { metin: JSON.stringify(v), sha: `s${++d.shaSayac}` };
  };
  return d;
}

const ORTAM = { TELEGRAM_BOT_TOKEN: 'tg-sahte', GOREV_TOKEN: 'gh-sahte', GITHUB_REPOSITORY: 'eyup/eyup.github.io', GITHUB_REPOSITORY_OWNER: 'eyup', GH_TOKEN: 'actions-sahte' };
const SAHIP = 5550001;
const YABANCI = 5550999;
let uid = 1000;
const mesajGuncellemesi = (chatId, metin) => ({ update_id: ++uid, message: { message_id: uid, date: 0, chat: { id: chatId, type: 'private' }, from: { id: chatId, first_name: 'Eyüp' }, text: metin } });
const butonGuncellemesi = (chatId, veri, mesaj) => ({ update_id: ++uid, callback_query: { id: `cb${uid}`, data: veri, from: { id: chatId }, message: { message_id: mesaj.message_id || 1, chat: { id: chatId, type: 'private' }, text: mesaj.text || '', reply_markup: mesaj.reply_markup } } });

const sessiz = () => {};
const kos = async (d, zaman, ortam = ORTAM) => {
  d.giden = [];
  return calistir({ ortam, fetch: d.fetch, simdi: () => T(zaman), gunluk: process.env.AYRINTI ? console.log : sessiz, bekle: async () => {} });
};
const mesajlar = (d) => d.giden.filter((x) => x.yontem === 'sendMessage');

{
  const d = sahteDunya();
  // a) kurulum eksik
  let s = await kos(d, '2026-11-20T10:01:00+03:00', { GITHUB_REPOSITORY: 'eyup/eyup.github.io' });
  esit('kurulum eksikken sessiz çıkar', [s.kod, s.kurulumEksik], [0, ['TELEGRAM_BOT_TOKEN', 'GOREV_TOKEN']]);

  // b) ilk çalışma: veri dosyası yok → oluşturulur, bot bilgisi ve komut listesi kaydedilir
  s = await kos(d, '2026-11-20T10:01:00+03:00');
  dogru('ilk çalışmada veri dosyası oluştu', !!d.dosya);
  esit('bot kullanıcı adı kaydedildi', d.veri().durum.bot.kullaniciAdi, 'eyup_gorev_bot');
  dogru('komut listesi kuruldu', d.giden.some((x) => x.yontem === 'setMyCommands') && d.veri().durum.komutSurumu === 1);
  dogru('workflow canlı tutuldu', !!d.veri().durum.canliTut);

  // c) eşleşmemişken mesaj → bilgi; yanlış kod reddedilir; doğru kod eşleştirir
  d.guncellemeler.push(mesajGuncellemesi(YABANCI, 'merhaba'));
  await kos(d, '2026-11-20T10:06:00+03:00');
  dogru('eşleşmemişken yönlendirme mesajı', mesajlar(d).length === 1 && /eşleştirme|kodu gönder/i.test(mesajlar(d)[0].govde.text));
  d.yaz((v) => O.islemUygula(v, { tur: 'telegram', alanlar: { kod: 'K7Q2ZX', kodSonu: '2026-11-20T10:40:00+03:00' } }, T('2026-11-20T10:10:00+03:00')));
  d.guncellemeler.push(mesajGuncellemesi(YABANCI, '/start YANLIS1'));
  d.guncellemeler.push(mesajGuncellemesi(SAHIP, '/start k7q2zx'));
  await kos(d, '2026-11-20T10:12:00+03:00');
  esit('doğru kodla eşleşti', [d.veri().telegram.chatId, d.veri().telegram.kod], [SAHIP, null]);
  dogru('hoş geldin mesajı ve klavye', mesajlar(d).some((m) => m.govde.chat_id === SAHIP && /Bağlantı tamam/.test(m.govde.text) && m.govde.reply_markup.keyboard));

  // d) görev ekleme
  d.guncellemeler.push(mesajGuncellemesi(SAHIP, 'yarın 14:00 veritabanı ödevi #okul !'));
  d.guncellemeler.push(mesajGuncellemesi(YABANCI, 'yabancı görev'));
  await kos(d, '2026-11-20T10:17:00+03:00');
  let v = d.veri();
  esit('görev eklendi, yabancı yok sayıldı', v.gorevler.map((g) => [g.no, g.baslik, g.zaman, g.kategori, g.oncelik]), [[1, 'Veritabanı ödevi', '2026-11-21T14:00:00+03:00', 'Okul', 'yuksek']]);
  const eklemeYaniti = mesajlar(d).find((m) => m.govde.chat_id === SAHIP);
  dogru('ekleme yanıtı ve geri al düğmesi', eklemeYaniti && /Eklendi/.test(eklemeYaniti.govde.text) && eklemeYaniti.govde.reply_markup.inline_keyboard[0][0].callback_data.startsWith('x:'));
  dogru('yabancıya yanıt yok', !mesajlar(d).some((m) => m.govde.chat_id === YABANCI));
  // aynı güncelleme ikinci kez gelse de (onay gitmemiş gibi) ikinci görev oluşmaz
  d.guncellemeler.push({ ...mesajGuncellemesi(SAHIP, 'x'), update_id: uid - 1 });
  await kos(d, '2026-11-20T10:22:00+03:00');
  esit('aynı güncelleme ikinci kez işlenmez', d.veri().gorevler.length, 1);

  // e) sabah özeti (08:00) bir kez
  await kos(d, '2026-11-21T07:57:00+03:00');
  const ozetler = mesajlar(d).filter((m) => /Günaydın/.test(m.govde.text));
  dogru('sabah özeti geldi', ozetler.length === 1 && /Veritabanı ödevi/.test(ozetler[0].govde.text), JSON.stringify(mesajlar(d).map((m) => m.govde.text.slice(0, 30))));
  await kos(d, '2026-11-21T08:02:00+03:00');
  esit('sabah özeti tekrar gelmez', mesajlar(d).length, 0);

  // f) 1 saat önce hatırlatması 12:56'da (5 dk ön bakış), ikinci çalışmada tekrar yok
  await kos(d, '2026-11-21T12:56:00+03:00');
  let h = mesajlar(d);
  dogru('1 saat önce hatırlatma', h.length === 1 && /Hatırlatma/.test(h[0].govde.text) && /1 sa 4 dk sonra|1 saat sonra/.test(h[0].govde.text), h.map((x) => x.govde.text).join(' | '));
  dogru('hatırlatma düğmeleri', h[0] && h[0].govde.reply_markup.inline_keyboard[0][0].callback_data.startsWith('t:'));
  await kos(d, '2026-11-21T13:01:00+03:00');
  esit('aynı hatırlatma tekrar gelmez', mesajlar(d).length, 0);

  // g) gönderim hatası: zamanında hatırlatması bir sonraki çalışmada yeniden denenir
  d.tgHatasi = 502;
  await kos(d, '2026-11-21T13:57:00+03:00');
  esit('Telegram hatasında mesaj gitmedi', mesajlar(d).length, 0);
  dogru('sağlık durumuna yazıldı', !!d.veri().durum.saglik.hata);
  await kos(d, '2026-11-21T14:01:00+03:00');
  h = mesajlar(d);
  dogru('bir sonraki çalışmada gönderildi', h.length === 1 && /Zamanı geldi/.test(h[0].govde.text));
  dogru('sağlık düzeldi', !d.veri().durum.saglik.hata);

  // h) buton: tamamlandı → görev biter, mesaj düzenlenir
  const id = d.veri().gorevler[0].id;
  d.guncellemeler.push(butonGuncellemesi(SAHIP, `t:${id}:h`, { message_id: 501, text: 'x' }));
  await kos(d, '2026-11-21T14:06:00+03:00');
  esit('buton görevi tamamladı', d.veri().gorevler[0].durum, 'bitti');
  dogru('mesaj düzenlendi ve geri al düğmesi var', d.giden.some((x) => x.yontem === 'editMessageText' && /Tamamlandı/.test(x.govde.text) && x.govde.reply_markup.inline_keyboard[0][0].callback_data === `g:${id}:h`));
  dogru('buton cevabı verildi', d.giden.some((x) => x.yontem === 'answerCallbackQuery'));

  // i) komutlar: /bitti, /ertele, /sil, /geri, /bugun
  d.guncellemeler.push(mesajGuncellemesi(SAHIP, 'her gün 22:00 ilaç iç'));
  d.guncellemeler.push(mesajGuncellemesi(SAHIP, 'süt al'));
  await kos(d, '2026-11-21T15:00:00+03:00');
  v = d.veri();
  const ilac = v.gorevler.find((g) => g.baslik === 'İlaç iç');
  const sut = v.gorevler.find((g) => g.baslik === 'Süt al');
  d.guncellemeler.push(mesajGuncellemesi(SAHIP, `/ertele ${ilac.no} 30dk`));
  d.guncellemeler.push(mesajGuncellemesi(SAHIP, `/sil ${sut.no}`));
  d.guncellemeler.push(mesajGuncellemesi(SAHIP, '/bugun'));
  await kos(d, '2026-11-21T15:05:00+03:00');
  v = d.veri();
  esit('/sil çöpe attı', [v.gorevler.some((g) => g.id === sut.id), v.cop[0].gorev.id], [false, sut.id]);
  esit('/ertele tekrar eden görevi erteledi', v.gorevler.find((g) => g.id === ilac.id).ertele, '2026-11-21T15:35:00+03:00');
  const bugunMesaji = mesajlar(d).find((m) => /📋 <b>Bugün<\/b>/.test(m.govde.text));
  dogru('/bugun listesi ve tamamla düğmeleri', bugunMesaji && /İlaç iç/.test(bugunMesaji.govde.text) && bugunMesaji.govde.reply_markup.inline_keyboard.some((s) => s[0].callback_data === `t:${ilac.id}:l`));
  d.guncellemeler.push(mesajGuncellemesi(SAHIP, `/geri ${sut.no}`));
  await kos(d, '2026-11-21T15:10:00+03:00');
  dogru('/geri çöpten getirdi', d.veri().gorevler.some((g) => g.id === sut.id));

  // j) kayıt çakışması: site araya yazarsa bot en güncel veriye yeniden uygular, sitenin değişikliği kaybolmaz
  d.guncellemeler.push(mesajGuncellemesi(SAHIP, 'pazartesi 10:00 sunum'));
  d.araYazma = (dd) => {
    const x = JSON.parse(dd.dosya.metin);
    O.gorevEkle(x, { baslik: 'Siteden eklenen' }, T('2026-11-21T15:14:00+03:00'), 'site1');
    dd.dosya = { metin: JSON.stringify(x), sha: `s${++dd.shaSayac}` };
  };
  await kos(d, '2026-11-21T15:15:00+03:00');
  v = d.veri();
  dogru('çakışmada iki değişiklik de korundu', v.gorevler.some((g) => g.id === 'site1') && v.gorevler.some((g) => g.baslik === 'Sunum'));
  const sunum = v.gorevler.find((g) => g.baslik === 'Sunum');
  const site1 = v.gorevler.find((g) => g.id === 'site1');
  dogru('numaralar çakışmadı', sunum.no !== site1.no, `${sunum.no} ${site1.no}`);
  dogru('yanıttaki numara kayıttakiyle aynı', mesajlar(d).some((m) => m.govde.text.includes(`#${sunum.no}`)));

  // k) yazma izni yoksa hiçbir mesaj gitmez (aynı hatırlatma her 5 dakikada tekrar etmesin)
  d.putHatasi = 403;
  await kos(d, '2026-11-21T21:57:00+03:00'); // ilaç 22:00 hatırlatması zamanı
  esit('yazılamayınca mesaj gönderilmez', mesajlar(d).length, 0);
  await kos(d, '2026-11-21T22:01:00+03:00');
  dogru('izin düzelince hatırlatma gelir', mesajlar(d).some((m) => /İlaç iç/.test(m.govde.text)));

  // l) işaretlenmeyen günlük görev ertesi gün yine hatırlatılır
  await kos(d, '2026-11-22T20:57:00+03:00');
  dogru('ertesi gün 1 saat önce hatırlatması', mesajlar(d).some((m) => /İlaç iç/.test(m.govde.text) && /Hatırlatma/.test(m.govde.text)));
  esit('kaçırılan sayısı', d.veri().gorevler.find((g) => g.baslik === 'İlaç iç').kacirilan, 1);

  // m) erişim hatası: yanlış GOREV_TOKEN → mesaj yok, alarm penceresi dışında çıkış kodu 0
  s = await kos(d, '2026-11-22T11:00:00+03:00', { ...ORTAM, GOREV_TOKEN: 'yanlis' });
  esit('yanlış token: sessiz çıkış', [s.kod, mesajlar(d).length], [0, 0]);
  s = await kos(d, '2026-11-22T09:03:00+03:00', { ...ORTAM, GOREV_TOKEN: 'yanlis' });
  esit('yanlış token: alarm penceresinde hata kodu', s.kod, 1);

  // n0) tek mesajda virgülle üç görev → üç ayrı görev; "hepsini geri al" ve "geri getir" düğmeleri
  d.guncellemeler.push(mesajGuncellemesi(SAHIP, 'Yarına mobil uygulama projesine başla, gömülü sistemler konusunu belirle, Claude eğitimlerine çalış'));
  await kos(d, '2026-11-22T11:01:00+03:00');
  v = d.veri();
  const uclu = v.gorevler.filter((g) => /^tg[0-9a-z]+-[123]$/.test(g.id));
  esit('üç ayrı görev, hepsi yarın', uclu.map((g) => [g.baslik, g.zaman, g.tumGun]), [
    ['Mobil uygulama projesine başla', '2026-11-23T09:00:00+03:00', true],
    ['Gömülü sistemler konusunu belirle', '2026-11-23T09:00:00+03:00', true],
    ['Claude eğitimlerine çalış', '2026-11-23T09:00:00+03:00', true],
  ]);
  const ucluYanit = mesajlar(d).find((x) => /3 görev eklendi/.test(x.govde.text));
  dogru('çoklu ekleme yanıtı', !!ucluYanit && ucluYanit.govde.reply_markup.inline_keyboard[0][0].callback_data.startsWith('xx:'));
  const taban = ucluYanit.govde.reply_markup.inline_keyboard[0][0].callback_data.slice(3);
  d.guncellemeler.push(butonGuncellemesi(SAHIP, `xx:${taban}`, { message_id: 700, text: 'x' }));
  await kos(d, '2026-11-22T11:06:00+03:00');
  esit('hepsini geri al üçünü de siler', d.veri().gorevler.filter((g) => g.id.startsWith(`${taban}-`)).length, 0);
  dogru('mesaj "geri getir" düğmesiyle düzenlendi', d.giden.some((x) => x.yontem === 'editMessageText' && x.govde.reply_markup.inline_keyboard[0][0].callback_data === `rx:${taban}`));
  d.guncellemeler.push(butonGuncellemesi(SAHIP, `rx:${taban}`, { message_id: 700, text: 'x' }));
  await kos(d, '2026-11-22T11:11:00+03:00');
  esit('geri getir üçünü de getirir', d.veri().gorevler.filter((g) => g.id.startsWith(`${taban}-`)).length, 3);

  // n1) "5 dk sonra" mesajın gönderildiği andan sayılır; bot geç okusa da hatırlatma kaybolmaz
  const gec = mesajGuncellemesi(SAHIP, '5 dk sonra çayı demle');
  gec.message.date = Math.floor(T('2026-11-22T11:00:00+03:00').getTime() / 1000);
  d.guncellemeler.push(gec);
  await kos(d, '2026-11-22T11:12:00+03:00');
  const cay = d.veri().gorevler.find((g) => g.baslik === 'Çayı demle');
  esit('süre mesaj anından sayıldı', cay && cay.zaman, '2026-11-22T11:05:00+03:00');
  dogru('geciken hatırlatma aynı çalışmada gitti', mesajlar(d).some((x) => /Zamanı geldi/.test(x.govde.text) && /Çayı demle/.test(x.govde.text)));

  // n) günlüklerde görev metni ya da sır yok
  const satirlar = [];
  d.guncellemeler.push(mesajGuncellemesi(SAHIP, 'gizli doktor randevusu yarın 10:00'));
  await calistir({ ortam: ORTAM, fetch: d.fetch, simdi: () => T('2026-11-22T11:05:00+03:00'), gunluk: (x) => satirlar.push(x), bekle: async () => {} });
  const gunlukMetni = satirlar.join('\n');
  dogru('günlükte görev metni yok', !/doktor|İlaç|Sunum/i.test(gunlukMetni), gunlukMetni);
  dogru('günlükte sır yok', !/tg-sahte|gh-sahte|actions-sahte/.test(gunlukMetni));
  dogru('istek adreslerinde token gizli', !d.istek.some((x) => x.includes('tg-sahte')));
}

{
  // Eşleşirken /start üst üste birkaç kez gelirse (derin bağlantı + elle yazılan) tek hoş geldin mesajı gider
  const d = sahteDunya();
  // (özet saatlerinin dışında: 12:00 civarı)
  await kos(d, '2026-11-20T12:01:00+03:00');
  d.yaz((v) => O.islemUygula(v, { tur: 'telegram', alanlar: { kod: 'SJNGWS', kodSonu: '2026-11-20T12:30:00+03:00' } }, T('2026-11-20T12:02:00+03:00')));
  d.guncellemeler.push(mesajGuncellemesi(SAHIP, '/start SJNGWS'), mesajGuncellemesi(SAHIP, '/start SJNGWS'), mesajGuncellemesi(SAHIP, '/start'));
  await kos(d, '2026-11-20T12:06:00+03:00');
  const giden = mesajlar(d).filter((x) => x.govde.chat_id === SAHIP);
  esit('üst üste /start: tek mesaj', [giden.length, /Bağlantı tamam/.test((giden[0] || { govde: { text: '' } }).govde.text)], [1, true]);
  d.guncellemeler.push(mesajGuncellemesi(SAHIP, '/start'));
  await kos(d, '2026-11-20T12:11:00+03:00');
  esit('sonraki turda /start yine yardım verir', mesajlar(d).length, 1);
}

console.log(hata ? `\n✗ ${hata} / ${toplam} kontrol başarısız` : `\n✓ ${toplam} kontrolün hepsi geçti`);
process.exitCode = hata ? 1 : 0;
