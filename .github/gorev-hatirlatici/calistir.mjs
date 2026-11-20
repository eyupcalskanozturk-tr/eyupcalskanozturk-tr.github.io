/*
 * Görev hatırlatıcısı · Telegram botu
 *
 * GitHub Actions bunu 5 dakikada bir çalıştırır (.github/workflows/gorev-hatirlatici.yml).
 * Her çalışmada:
 *  1. Gizli veri deposundaki gorevler.json okunur.
 *  2. Telegram'a gelen mesajlar ve buton basışları alınır (getUpdates).
 *  3. Komutlar uygulanır; zamanı gelen hatırlatmalar ve günlük özetler hazırlanır.
 *  4. Değişiklik varsa veri dosyasına yazılır. Bu sırada site de yazdıysa en güncel
 *     sürüm yeniden okunur ve aynı işlemler onun üstüne uygulanır.
 *  5. Mesajlar ancak kayıt başarılı olunca gönderilir; böylece aynı hatırlatma iki kez gitmez.
 *
 * Actions kayıtları herkese açık: günlüğe görev metni yazılmaz, yalnız sayılar.
 * Gerekenler (depo sırları): TELEGRAM_BOT_TOKEN, GOREV_TOKEN. İsteğe bağlı: TELEGRAM_CHAT_ID.
 */
import { pathToFileURL } from 'node:url';
import * as O from '../../gorevler/ortak.js';

const KOMUT_SURUMU = 1;
const LISTE_DUGME_SINIRI = 8;
const MESAJ_SINIRI = 3900;

const KLAVYE = {
  keyboard: [
    [{ text: '📋 Bugün' }, { text: '📅 Hafta' }],
    [{ text: '🗂 Tümü' }, { text: '❓ Yardım' }],
  ],
  resize_keyboard: true,
  is_persistent: true,
  input_field_placeholder: 'Görev yaz: yarın 14:00 ödev #okul',
};
const DUGME_KOMUT = { '📋 Bugün': 'bugun', '📅 Hafta': 'hafta', '🗂 Tümü': 'liste', '❓ Yardım': 'yardim' };

const KOMUT_LISTESI = [
  ['bugun', 'Bugünün ve gecikenlerin listesi'],
  ['yarin', 'Yarının görevleri'],
  ['hafta', 'Önümüzdeki 7 gün'],
  ['liste', 'Bütün açık görevler'],
  ['ekle', 'Görev ekle · /ekle yarın 14:00 ödev'],
  ['bitti', 'Tamamla · /bitti 12'],
  ['ertele', 'Ertele · /ertele 12 1s'],
  ['sil', 'Sil · /sil 12'],
  ['geri', 'Geri al · /geri 12'],
  ['cop', 'Son silinenler'],
  ['site', 'Görev sayfasının bağlantısı'],
  ['yardim', 'Komutlar ve örnekler'],
];

const kacis = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const kisalt = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/* ───────── ayarlar ───────── */

export function ayarlariOku(ortam) {
  const sahip = (ortam.GITHUB_REPOSITORY_OWNER || (ortam.GITHUB_REPOSITORY || '').split('/')[0] || '').trim().toLowerCase();
  const site = (ortam.SITE_URL || (sahip ? `https://${sahip}.github.io/gorevler/` : '')).trim();
  return {
    tgToken: (ortam.TELEGRAM_BOT_TOKEN || '').trim(),
    ghToken: (ortam.GOREV_TOKEN || '').trim(),
    depo: (ortam.GOREV_REPO || (sahip ? `${sahip}/gorev-verisi` : '')).trim(),
    dosya: (ortam.GOREV_DOSYA || 'gorevler.json').trim(),
    sabitChatId: (ortam.TELEGRAM_CHAT_ID || '').trim() || null,
    siteUrl: site && !site.endsWith('/') ? site + '/' : site,
    actionsToken: (ortam.GH_TOKEN || '').trim(),
    siteDeposu: (ortam.GITHUB_REPOSITORY || '').trim(),
    workflow: (ortam.GOREV_WORKFLOW || 'gorev-hatirlatici.yml').trim(),
  };
}

/* ───────── mesaj parçaları ───────── */

function gorevSatiri(g, simdi, { gunGoster = false } = {}) {
  const parca = [];
  if (g.zaman) {
    const z = new Date(g.zaman);
    if (gunGoster) parca.push(O.tarihMetni(z, simdi, g.tumGun));
    else parca.push(g.tumGun ? 'gün boyu' : O.saatMetni(z));
  }
  const ek = [];
  if (g.tekrar) ek.push('🔁');
  if (g.kategori) ek.push(kacis(g.kategori));
  const onc = g.oncelik === 'yuksek' ? '❗ ' : '';
  const zaman = parca.length ? `<code>${parca[0]}</code> ` : '';
  return `${zaman}${onc}${kacis(kisalt(g.baslik, 90))} <i>#${g.no}</i>${ek.length ? ' · ' + ek.join(' ') : ''}`;
}

function bolum(baslik, gorevler, simdi, secenek) {
  if (!gorevler.length) return '';
  return `${baslik} · ${gorevler.length}\n` + gorevler.map((g) => gorevSatiri(g, simdi, secenek)).join('\n');
}

function parcalariBirlestir(parcalar) {
  let metin = parcalar.filter(Boolean).join('\n\n');
  if (metin.length > MESAJ_SINIRI) {
    const satirlar = metin.split('\n');
    let kesik = '';
    let kalan = 0;
    for (const s of satirlar) {
      if (kesik.length + s.length + 1 < MESAJ_SINIRI - 60) kesik += (kesik ? '\n' : '') + s;
      else kalan++;
    }
    metin = kesik + `\n\n… ve ${kalan} satır daha. Hepsi için siteyi aç.`;
  }
  return metin;
}

function tamamlaDugmeleri(gorevler) {
  return gorevler.slice(0, LISTE_DUGME_SINIRI).map((g) => [{ text: `✅ #${g.no} ${kisalt(g.baslik, 28)}`, callback_data: `t:${g.id}:l` }]);
}

function siteDugmesi(ayar, metin = '🌐 Siteyi aç', id = null) {
  if (!/^https:\/\//.test(ayar.siteUrl || '')) return null;
  return { text: metin, url: ayar.siteUrl + (id ? `#g=${encodeURIComponent(id)}` : '') };
}

function gorevKarti(g, simdi) {
  const satir = [`<b>${kacis(g.baslik)}</b> <i>#${g.no}</i>`];
  const bilgi = [];
  if (g.zaman) bilgi.push(`📅 ${O.tarihMetni(new Date(g.zaman), simdi, g.tumGun)}`);
  if (g.zaman && g.hatirlat && g.hatirlat.length) bilgi.push(`🔔 ${O.hatirlatmaMetni(g.hatirlat)}`);
  if (bilgi.length) satir.push(bilgi.join(' · '));
  const ek = [];
  if (g.tekrar) ek.push(`🔁 ${O.tekrarMetni(g.tekrar)}`);
  if (g.kategori) ek.push(`📁 ${kacis(g.kategori)}`);
  if (g.oncelik === 'yuksek') ek.push('❗ Yüksek öncelik');
  if (ek.length) satir.push(ek.join(' · '));
  if (g.not) satir.push(`📝 ${kacis(kisalt(g.not, 300))}`);
  return satir.join('\n');
}

function hatirlatmaMetni(g, simdi, oge) {
  const z = new Date(g.zaman);
  let ust;
  if (oge.ertele) ust = `⏰ <b>Ertelenen görev</b>`;
  else if (oge.dakika === 0) ust = `🔔 <b>Zamanı geldi</b>`;
  else ust = `⏰ <b>Hatırlatma</b> · ${O.goreceMetin(z, simdi)}`;
  const satir = [ust, '', `<b>${kacis(g.baslik)}</b> <i>#${g.no}</i>`];
  const bilgi = [`📅 ${O.tarihMetni(z, simdi, g.tumGun)}`];
  if (g.tekrar) bilgi.push(`🔁 ${O.tekrarMetni(g.tekrar)}`);
  satir.push(bilgi.join(' · '));
  const ek = [];
  if (g.kategori) ek.push(`📁 ${kacis(g.kategori)}`);
  if (g.oncelik === 'yuksek') ek.push('❗ Yüksek öncelik');
  if (ek.length) satir.push(ek.join(' · '));
  if (g.not) satir.push(`📝 ${kacis(kisalt(g.not, 300))}`);
  return satir.join('\n');
}

function hatirlatmaDugmeleri(g) {
  return {
    inline_keyboard: [
      [{ text: '✅ Tamamlandı', callback_data: `t:${g.id}:h` }],
      [
        { text: '⏰ 15 dk', callback_data: `e:${g.id}:15` },
        { text: '⏰ 1 saat', callback_data: `e:${g.id}:60` },
        { text: '📅 Yarın', callback_data: `y:${g.id}` },
      ],
    ],
  };
}

function yardimMetni(ayar) {
  const s = [
    '<b>Görev ekle:</b> bana yazman yeterli.',
    '• yarın 14:00 veritabanı ödevi #okul',
    '• her pazartesi 09:00 haftalık plan',
    '• 2 saat sonra çamaşırları as',
    "• cuma akşam 8'de sinema !",
    "• her ayın 15'i kira öde",
    '• hafta içi 07:30 kalk',
    '• rapor yaz // not: 3. bölüm eksik',
    '',
    '<b>İşaretler:</b> #kategori · ! yüksek öncelik · "1 saat önce hatırlat" · "sessiz"',
    '',
    '<b>Komutlar</b>',
    '/bugun · /yarin · /hafta · /liste',
    '/bitti 12 · /ertele 12 1s · /ertele 12 yarın',
    '/sil 12 · /geri 12 · /cop · /site',
    '',
    '⏱ Bot mesajları birkaç dakikada bir toplu okur; cevap 5–15 dk sürebilir. Hatırlatmalar planlanan saatte (en çok 5 dk erken) gelir.',
  ];
  if (ayar.siteUrl) s.push('', `🌐 ${kacis(ayar.siteUrl)}`);
  return s.join('\n');
}

/* ───────── özetler ───────── */

function bugunTamamlanan(v, simdi) {
  const bugun = O.gunAnahtari(simdi);
  return v.gorevler.filter((g) => (g.durum === 'bitti' && g.bitis && O.gunAnahtari(new Date(g.bitis)) === bugun) || (g.sonTamamlanma && O.gunAnahtari(new Date(g.sonTamamlanma)) === bugun)).length;
}

function tarihBasligi(simdi) {
  const p = O.yerel(simdi);
  return `${p.g} ${O.AYLAR[p.a - 1]} ${O.GUNLER[p.hg]}`;
}

function sabahOzeti(v, simdi) {
  const s = O.grupla(v, simdi);
  const hitap = v.ayarlar.hitap ? ` ${kacis(v.ayarlar.hitap)}` : '';
  const parcalar = [`☀️ <b>Günaydın${hitap}</b> · ${tarihBasligi(simdi)}`];
  if (!s.geciken.length && !s.bugun.length) {
    let bos = 'Bugün için planlı görev yok.';
    if (s.tarihsiz.length) bos += ` Tarihsiz listende ${s.tarihsiz.length} görev bekliyor.`;
    parcalar.push(bos);
  }
  parcalar.push(bolum('⚠️ <b>Gecikmiş</b>', s.geciken, simdi, { gunGoster: true }));
  parcalar.push(bolum('📌 <b>Bugün</b>', s.bugun, simdi));
  if (s.yarin.length) parcalar.push(`📅 Yarın ${s.yarin.length} görev var.`);
  const dugmeler = tamamlaDugmeleri([...s.geciken, ...s.bugun]);
  return { metin: parcalariBirlestir(parcalar), klavye: dugmeler.length ? { inline_keyboard: dugmeler } : undefined };
}

function aksamOzeti(v, simdi) {
  const s = O.grupla(v, simdi);
  const biten = bugunTamamlanan(v, simdi);
  const kalan = [...s.geciken, ...s.bugun];
  if (!kalan.length && !s.yarin.length && !biten) return null;
  const parcalar = [`🌙 <b>Gün sonu</b> · ${tarihBasligi(simdi)}`];
  if (biten) parcalar.push(`✅ Bugün ${biten} görev tamamlandı.`);
  parcalar.push(bolum('⏳ <b>Kalan</b>', kalan, simdi, { gunGoster: true }));
  parcalar.push(bolum('📅 <b>Yarın</b>', s.yarin, simdi));
  const dugmeler = tamamlaDugmeleri(kalan);
  return { metin: parcalariBirlestir(parcalar), klavye: dugmeler.length ? { inline_keyboard: dugmeler } : undefined };
}

/* ───────── komutlar ───────── */

function listeMesaji(v, simdi, tur, ayar) {
  const s = O.grupla(v, simdi);
  let parcalar = [];
  let dugmeGorev = [];
  if (tur === 'bugun') {
    parcalar = [`📋 <b>Bugün</b> · ${tarihBasligi(simdi)}`, bolum('⚠️ <b>Gecikmiş</b>', s.geciken, simdi, { gunGoster: true }), bolum('📌 <b>Bugün</b>', s.bugun, simdi)];
    if (!s.geciken.length && !s.bugun.length) parcalar.push('Bugün boş görünüyor ✨');
    if (s.yarin.length) parcalar.push(`Yarın ${s.yarin.length} görev var · /yarin`);
    dugmeGorev = [...s.geciken, ...s.bugun];
  } else if (tur === 'yarin') {
    parcalar = [`📅 <b>Yarın</b> · ${tarihBasligi(O.gunEkle(simdi, 1))}`, bolum('📌 <b>Görevler</b>', s.yarin, simdi)];
    if (!s.yarin.length) parcalar.push('Yarın için planlı görev yok.');
    dugmeGorev = s.yarin;
  } else if (tur === 'hafta') {
    parcalar = ['📅 <b>Önümüzdeki 7 gün</b>'];
    parcalar.push(bolum('⚠️ <b>Gecikmiş</b>', s.geciken, simdi, { gunGoster: true }));
    const gunler = new Map();
    for (const g of [...s.bugun, ...s.yarin, ...s.hafta]) {
      const k = O.gunAnahtari(new Date(g.zaman));
      if (!gunler.has(k)) gunler.set(k, []);
      gunler.get(k).push(g);
    }
    for (const [, liste] of gunler) parcalar.push(bolum(`<b>${O.tarihMetni(new Date(liste[0].zaman), simdi, true)}</b>`, liste, simdi));
    if (!gunler.size && !s.geciken.length) parcalar.push('Bu hafta için planlı görev yok.');
    dugmeGorev = [...s.geciken, ...s.bugun];
  } else {
    const toplam = Object.values(s).reduce((t, x) => t + x.length, 0);
    parcalar = [`🗂 <b>Açık görevler</b> · ${toplam}`];
    parcalar.push(bolum('⚠️ <b>Gecikmiş</b>', s.geciken, simdi, { gunGoster: true }));
    parcalar.push(bolum('📌 <b>Bugün</b>', s.bugun, simdi));
    parcalar.push(bolum('📅 <b>Yarın</b>', s.yarin, simdi));
    parcalar.push(bolum('🗓 <b>Bu hafta</b>', s.hafta, simdi, { gunGoster: true }));
    parcalar.push(bolum('🔭 <b>Daha sonra</b>', s.sonra, simdi, { gunGoster: true }));
    parcalar.push(bolum('📥 <b>Tarihsiz</b>', s.tarihsiz, simdi));
    if (!toplam) parcalar.push('Hiç açık görev yok. Yeni görev için bana yazman yeterli.');
    dugmeGorev = [...s.geciken, ...s.bugun];
  }
  const satirlar = tamamlaDugmeleri(dugmeGorev);
  const site = siteDugmesi(ayar);
  if (site) satirlar.push([site]);
  return { metin: parcalariBirlestir(parcalar), klavye: satirlar.length ? { inline_keyboard: satirlar } : undefined };
}

function numaralar(arguman) {
  return [...String(arguman || '').matchAll(/#?(\d+)/g)].map((m) => m[1]);
}

/**
 * Güncellemeleri, hatırlatmaları ve özetleri işler. Ağa çıkmaz; veriyi (v) yerinde
 * değiştirir ve gönderilecekleri döndürür. Aynı girdiyle her zaman aynı sonucu verir;
 * kayıt çakışırsa en güncel veriyle yeniden çağrılır.
 */
export function isle(v, guncellemeler, simdi, ayar, ek = {}) {
  O.veriDuzelt(v);
  const giden = [];
  const iso = O.isoYaz(simdi);
  if (ek.botBilgi) v.durum.bot = ek.botBilgi;
  if (ek.komutlarKuruldu) v.durum.komutSurumu = KOMUT_SURUMU;
  if (ek.canliTut) v.durum.canliTut = iso;
  let sahip = ayar.sabitChatId || v.telegram.chatId || null;

  const mesaj = (chatId, metin, klavye, anahtarlar) => {
    const govde = { chat_id: chatId, text: metin, parse_mode: 'HTML', link_preview_options: { is_disabled: true } };
    if (klavye) govde.reply_markup = klavye;
    giden.push({ yontem: 'sendMessage', govde, anahtarlar });
  };
  const duzenle = (cbMesaj, metin, klavye) => {
    const govde = { chat_id: cbMesaj.chat.id, message_id: cbMesaj.message_id, text: metin, parse_mode: 'HTML', link_preview_options: { is_disabled: true } };
    govde.reply_markup = klavye || { inline_keyboard: [] };
    giden.push({ yontem: 'editMessageText', govde, sessiz: true });
  };

  const baslayan = new Set(); // bu turda /start'a cevap verilen sohbetler (üst üste /start'a tek cevap)
  for (const u of [...guncellemeler].sort((a, b) => a.update_id - b.update_id)) {
    if (!(u.update_id > (v.durum.tgSon || 0))) continue;
    v.durum.tgSon = u.update_id;
    const m = u.message;
    const cb = u.callback_query;
    const chat = m ? m.chat : cb && cb.message ? cb.message.chat : null;
    if (!chat || chat.type !== 'private') continue;
    const metin = (m && (m.text || m.caption)) || '';
    // "30 dk sonra" gibi süreler botun mesajı okuduğu andan değil, mesajın gönderildiği andan sayılır
    const mesajAni = m && m.date > 0 && m.date * 1000 < simdi.getTime() ? new Date(m.date * 1000) : simdi;
    const startMi = /^\/start(?:@\w+)?(?:\s|$)/.test(metin);

    // eşleştirme: /start KOD (sitede üretilen, 30 dk geçerli kod)
    const kod = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{4,64})\s*$/.exec(metin);
    if (m && kod && !ayar.sabitChatId) {
      const t = v.telegram;
      if (t.kod && kod[1].toUpperCase() === String(t.kod).toUpperCase() && t.kodSonu && new Date(t.kodSonu) > simdi) {
        v.telegram = { ...t, chatId: chat.id, ad: (m.from && m.from.first_name) || null, kod: null, kodSonu: null, eslesme: iso };
        sahip = chat.id;
        const hitap = v.ayarlar.hitap ? ` ${kacis(v.ayarlar.hitap)}` : '';
        mesaj(chat.id, `👋 <b>Merhaba${hitap}!</b> Bağlantı tamam ✓\nHatırlatmalar ve günlük özetler artık buraya gelecek.\n\n${yardimMetni(ayar)}`, KLAVYE);
        baslayan.add(String(chat.id));
        continue;
      }
    }
    if (sahip == null || String(chat.id) !== String(sahip)) {
      if (m && sahip == null) mesaj(chat.id, `Bu bot kişisel bir görev hatırlatıcısı.\nBağlamak için görev sayfasındaki <b>Telegram'ı bağla</b> adımında verilen kodu gönder: <code>/start KOD</code>\n\nChat ID: <code>${chat.id}</code>`);
      continue;
    }

    if (cb) {
      geriCagir(v, cb, simdi, ayar, { mesaj, duzenle, giden });
      continue;
    }
    if (!metin.trim()) {
      mesaj(chat.id, 'Şimdilik yalnız yazılı mesajları anlıyorum. Görev eklemek için yaz: <i>yarın 14:00 ödev</i>');
      continue;
    }
    if (startMi) {
      if (baslayan.has(String(chat.id))) continue;
      baslayan.add(String(chat.id));
    }
    komut(v, chat.id, metin.trim(), u.update_id, simdi, ayar, { mesaj }, mesajAni);
  }

  O.tekrarIlerlet(v, simdi);

  if (sahip != null) {
    // görev hatırlatmaları: görev başına tek mesaj
    const gruplar = new Map();
    for (const oge of O.hatirlatmaPlani(v, simdi)) {
      if (!gruplar.has(oge.gorev.id)) gruplar.set(oge.gorev.id, []);
      gruplar.get(oge.gorev.id).push(oge);
    }
    for (const [, ogeler] of gruplar) {
      const son = ogeler[ogeler.length - 1];
      const anahtarlar = ogeler.map((o) => o.anahtar);
      for (const k of anahtarlar) v.durum.gonderilen[k] = iso;
      mesaj(sahip, hatirlatmaMetni(son.gorev, simdi, son), hatirlatmaDugmeleri(son.gorev), anahtarlar);
    }
    // günlük özetler
    for (const oz of O.ozetPlani(v, simdi)) {
      v.durum.gonderilen[oz.anahtar] = iso;
      const icerik = oz.tur === 'sabah' ? sabahOzeti(v, simdi) : aksamOzeti(v, simdi);
      if (icerik) mesaj(sahip, icerik.metin, icerik.klavye, [oz.anahtar]);
    }
  }
  O.gonderilenTemizle(v, simdi);
  O.bitenleriBuda(v, simdi);
  return giden;
}

function komut(v, chatId, metin, updateId, simdi, ayar, { mesaj }, mesajAni = simdi) {
  let ad;
  let arguman = '';
  if (DUGME_KOMUT[metin]) ad = DUGME_KOMUT[metin];
  else if (metin.startsWith('/')) {
    const k = /^\/([A-Za-z0-9_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(metin);
    ad = k ? k[1].toLowerCase() : '';
    arguman = k && k[2] ? k[2].trim() : '';
  } else {
    ad = 'ekle';
    arguman = metin;
  }
  const takma = { help: 'yardim', start: 'yardim', today: 'bugun', tum: 'liste', hepsi: 'liste', list: 'liste', tamam: 'bitti', done: 'bitti', tamamla: 'bitti', yap: 'ekle', add: 'ekle', copkutusu: 'cop' };
  ad = takma[ad] || ad;

  switch (ad) {
    case 'yardim':
      return mesaj(chatId, yardimMetni(ayar), KLAVYE);
    case 'site': {
      const d = siteDugmesi(ayar, '🌐 Görev sayfasını aç');
      return mesaj(chatId, 'Görevlerini sitede düzenleyebilir, sürükleyip tarih verebilir, ayarları değiştirebilirsin.', d ? { inline_keyboard: [[d]] } : undefined);
    }
    case 'bugun':
    case 'yarin':
    case 'hafta':
    case 'liste': {
      const l = listeMesaji(v, simdi, ad, ayar);
      return mesaj(chatId, l.metin, l.klavye);
    }
    case 'ekle': {
      if (!arguman) return mesaj(chatId, 'Ne ekleyeyim? Örnek: <code>/ekle yarın 14:00 veritabanı ödevi</code>');
      // Virgülle ya da alt alta yazılmış birden çok iş ayrı görev olur; zaman mesajın gönderildiği andan sayılır.
      const liste = O.cokluAyristir(arguman, mesajAni, v.ayarlar);
      const taban = `tg${updateId.toString(36)}`;
      const eklenen = [];
      liste.forEach((r, i) => {
        const yeni = O.gorevEkle(v, { baslik: r.baslik, not: r.not, zaman: r.zaman, tumGun: r.tumGun, tekrar: r.tekrar, kategori: r.kategori, oncelik: r.oncelik, hatirlat: r.hatirlat, kaynak: 'telegram' }, mesajAni, liste.length === 1 ? taban : `${taban}-${i + 1}`);
        if (yeni) eklenen.push(yeni);
        if (r.kategori && !v.ayarlar.kategoriler.includes(r.kategori)) v.ayarlar.kategoriler = [...v.ayarlar.kategoriler, r.kategori];
      });
      if (!eklenen.length) return null;
      if (eklenen.length > 1) {
        const satir = eklenen.map((x) => `• <b>${kacis(x.baslik)}</b> <i>#${x.no}</i>${x.zaman ? ' · ' + O.tarihMetni(new Date(x.zaman), simdi, x.tumGun) : ''}`);
        const dugmeler = [[{ text: '↩️ Hepsini geri al', callback_data: `xx:${taban}` }]];
        const site = siteDugmesi(ayar);
        if (site) dugmeler[0].push(site);
        return mesaj(chatId, `✅ <b>${eklenen.length} görev eklendi</b>\n\n${satir.join('\n')}`, { inline_keyboard: dugmeler });
      }
      const g = eklenen[0];
      const satirlar = [[{ text: '↩️ Geri al', callback_data: `x:${g.id}:k` }]];
      const d = siteDugmesi(ayar, '✏️ Düzenle', g.id);
      if (d) satirlar[0].push(d);
      let ipucu = '';
      if (!g.zaman) ipucu = '\n\n<i>Tarih vermedin; tarihsiz listeye ekledim.</i>';
      return mesaj(chatId, `✅ <b>Eklendi</b>\n\n${gorevKarti(g, simdi)}${ipucu}`, { inline_keyboard: satirlar });
    }
    case 'bitti': {
      const nolar = numaralar(arguman);
      if (!nolar.length) return mesaj(chatId, 'Hangi görev? Örnek: <code>/bitti 12</code> (numaralar listede #12 diye görünür)');
      const sonuc = [];
      for (const no of nolar) {
        const g = O.gorevBul(v, no);
        if (!g) {
          sonuc.push(`#${no} bulunamadı`);
          continue;
        }
        const r = O.tamamla(v, g.id, simdi);
        if (!r) sonuc.push(`#${no} zaten tamamlanmış`);
        else if (r.tekrar) sonuc.push(`✅ ${kacis(g.baslik)} <i>#${g.no}</i> · sonraki: ${O.tarihMetni(new Date(g.zaman), simdi, g.tumGun)}`);
        else sonuc.push(`✅ <s>${kacis(g.baslik)}</s> <i>#${g.no}</i>`);
      }
      return mesaj(chatId, sonuc.join('\n'));
    }
    case 'geri': {
      const nolar = numaralar(arguman);
      if (!nolar.length) return mesaj(chatId, 'Hangi görev? Örnek: <code>/geri 12</code>');
      const sonuc = [];
      for (const no of nolar) {
        const g = O.gorevBul(v, no);
        const r = g ? O.geriAl(v, g.id, simdi) : O.copGeriAl(v, no, simdi);
        sonuc.push(r ? `↩️ ${kacis(r.baslik)} <i>#${r.no}</i> yeniden açık` : `#${no} için geri alınacak bir şey yok`);
      }
      return mesaj(chatId, sonuc.join('\n'));
    }
    case 'sil': {
      const nolar = numaralar(arguman);
      if (!nolar.length) return mesaj(chatId, 'Hangi görev? Örnek: <code>/sil 12</code>');
      const sonuc = [];
      const dugmeler = [];
      for (const no of nolar) {
        const g = O.gorevSil(v, no, simdi);
        if (!g) sonuc.push(`#${no} bulunamadı`);
        else {
          sonuc.push(`🗑 <s>${kacis(g.baslik)}</s> <i>#${g.no}</i>`);
          dugmeler.push([{ text: `↩️ #${g.no} geri getir`, callback_data: `r:${g.id}:k` }]);
        }
      }
      return mesaj(chatId, sonuc.join('\n'), dugmeler.length ? { inline_keyboard: dugmeler.slice(0, LISTE_DUGME_SINIRI) } : undefined);
    }
    case 'ertele': {
      const k = /^#?(\d+)\s*([\s\S]*)$/.exec(arguman);
      if (!k) return mesaj(chatId, 'Örnek: <code>/ertele 12 1s</code> · <code>/ertele 12 30dk</code> · <code>/ertele 12 yarın 10:00</code>');
      const g = O.gorevBul(v, k[1]);
      if (!g) return mesaj(chatId, `#${k[1]} bulunamadı`);
      const zaman = O.erteleZamani(k[2], simdi);
      if (!zaman || zaman <= simdi) return mesaj(chatId, 'Süreyi anlayamadım. Örnek: <code>1s</code>, <code>30dk</code>, <code>yarın</code>, <code>pazartesi 10:00</code>');
      const r = O.ertele(v, g.id, zaman, simdi);
      if (!r) return mesaj(chatId, `#${k[1]} ertelenemedi (tamamlanmış olabilir)`);
      return mesaj(chatId, `⏰ ${kacis(g.baslik)} <i>#${g.no}</i> → ${O.tarihMetni(zaman, simdi)}`);
    }
    case 'cop': {
      if (!v.cop.length) return mesaj(chatId, 'Çöp kutusu boş.');
      const son = v.cop.slice(0, LISTE_DUGME_SINIRI);
      return mesaj(
        chatId,
        `🗑 <b>Son silinenler</b>\n` + son.map((c) => `<s>${kacis(kisalt(c.gorev.baslik, 80))}</s> <i>#${c.gorev.no}</i>`).join('\n'),
        { inline_keyboard: son.map((c) => [{ text: `↩️ #${c.gorev.no} geri getir`, callback_data: `r:${c.gorev.id}:k` }]) },
      );
    }
    default:
      return mesaj(chatId, `/${kacis(ad)} komutunu tanımıyorum. Görev eklemek için düz yazman yeterli; komutlar için /yardim`);
  }
}

function geriCagir(v, cb, simdi, ayar, { mesaj, duzenle, giden }) {
  const veri = String(cb.data || '');
  const [tur, id, ek] = veri.split(':');
  const cbMesaj = cb.message;
  let bildirim = '';
  const g = id ? O.gorevBul(v, id) : null;
  const zamanMetni = (x) => (x.zaman ? O.tarihMetni(new Date(x.zaman), simdi, x.tumGun) : 'tarihsiz');

  if (tur === 't') {
    if (!g) bildirim = 'Görev bulunamadı (silinmiş olabilir)';
    else {
      const r = O.tamamla(v, g.id, simdi);
      if (!r) bildirim = 'Zaten tamamlanmış';
      else {
        bildirim = '✅ Tamamlandı';
        if (ek === 'l') {
          const klavye = (cbMesaj.reply_markup && cbMesaj.reply_markup.inline_keyboard) || [];
          const yeni = klavye.map((satir) => satir.map((d) => (d.callback_data === veri ? { text: `☑️ #${g.no} tamamlandı`, callback_data: 'n' } : d)));
          giden.push({ yontem: 'editMessageReplyMarkup', govde: { chat_id: cbMesaj.chat.id, message_id: cbMesaj.message_id, reply_markup: { inline_keyboard: yeni } }, sessiz: true });
        } else {
          const durum = r.tekrar ? `Bu seferlik tamam · sonraki: ${zamanMetni(g)}` : `Tamamlandı · ${O.saatMetni(simdi)}`;
          const baslik = r.tekrar ? `<b>${kacis(g.baslik)}</b>` : `<s>${kacis(g.baslik)}</s>`;
          duzenle(cbMesaj, `✅ ${baslik} <i>#${g.no}</i>\n<i>${durum}</i>`, { inline_keyboard: [[{ text: '↩️ Geri al', callback_data: `g:${g.id}:h` }]] });
        }
      }
    }
  } else if (tur === 'e' || tur === 'y') {
    if (!g) bildirim = 'Görev bulunamadı';
    else {
      let zaman;
      if (tur === 'e') zaman = new Date(simdi.getTime() + Math.max(5, Math.min(1440, Number(ek) || 60)) * 60000);
      else {
        const yarin = O.gunEkle(O.gunBasi(simdi), 1);
        const p = O.yerel(yarin);
        const s = g.zaman && !g.tumGun ? O.yerel(new Date(g.zaman)) : { sa: 9, dk: 0 };
        zaman = O.yerelTarih(p.y, p.a, p.g, s.sa, s.dk);
      }
      const r = O.ertele(v, g.id, zaman, simdi);
      if (!r) bildirim = 'Ertelenemedi (tamamlanmış olabilir)';
      else {
        bildirim = `⏰ ${O.tarihMetni(zaman, simdi)}`;
        duzenle(cbMesaj, `⏰ <b>${kacis(g.baslik)}</b> <i>#${g.no}</i>\n<i>Ertelendi → ${O.tarihMetni(zaman, simdi)}</i>`);
      }
    }
  } else if (tur === 'g') {
    const r = id ? O.geriAl(v, id, simdi) : null;
    if (!r) bildirim = 'Geri alınacak bir şey yok';
    else {
      bildirim = '↩️ Geri alındı';
      duzenle(cbMesaj, `⏰ <b>${kacis(r.baslik)}</b> <i>#${r.no}</i>\n📅 ${zamanMetni(r)}\n<i>Tamamlanma geri alındı</i>`, hatirlatmaDugmeleri(r));
    }
  } else if (tur === 'x') {
    const r = id ? O.gorevSil(v, id, simdi) : null;
    if (!r) bildirim = 'Görev zaten yok';
    else {
      bildirim = '🗑 Silindi';
      duzenle(cbMesaj, `🗑 <s>${kacis(r.baslik)}</s> <i>#${r.no}</i>\n<i>Eklenen görev geri alındı</i>`, { inline_keyboard: [[{ text: '↩️ Geri getir', callback_data: `r:${r.id}:k` }]] });
    }
  } else if (tur === 'r') {
    const r = id ? O.copGeriAl(v, id, simdi) : null;
    if (!r) bildirim = 'Geri getirilecek görev yok';
    else {
      bildirim = '↩️ Geri getirildi';
      duzenle(cbMesaj, `↩️ <b>Geri getirildi</b>\n\n${gorevKarti(r, simdi)}`, { inline_keyboard: [[{ text: '🗑 Yine sil', callback_data: `x:${r.id}:k` }]] });
    }
  } else if ((tur === 'xx' || tur === 'rx') && id) {
    // tek mesajla eklenen görevlerin hepsi: kimlikleri "tg<güncelleme>-1", "-2"…
    const ait = (gid) => gid === id || gid.startsWith(`${id}-`);
    const liste = (x) => x.map((g) => `${tur === 'xx' ? `<s>${kacis(g.baslik)}</s>` : `<b>${kacis(g.baslik)}</b>`} <i>#${g.no}</i>`).join('\n');
    if (tur === 'xx') {
      const silinen = v.gorevler.filter((g) => ait(g.id)).map((g) => O.gorevSil(v, g.id, simdi)).filter(Boolean);
      bildirim = silinen.length ? `🗑 ${silinen.length} görev silindi` : 'Görevler zaten yok';
      if (silinen.length) duzenle(cbMesaj, `🗑 <b>${silinen.length} görev geri alındı</b>\n\n${liste(silinen)}`, { inline_keyboard: [[{ text: '↩️ Geri getir', callback_data: `rx:${id}` }]] });
    } else {
      const gelen = v.cop.filter((c) => ait(c.gorev.id)).map((c) => O.copGeriAl(v, c.gorev.id, simdi)).filter(Boolean);
      bildirim = gelen.length ? `↩️ ${gelen.length} görev geri geldi` : 'Geri getirilecek görev yok';
      if (gelen.length) duzenle(cbMesaj, `↩️ <b>${gelen.length} görev geri getirildi</b>\n\n${liste(gelen)}`, { inline_keyboard: [[{ text: '↩️ Hepsini geri al', callback_data: `xx:${id}` }]] });
    }
  }
  giden.unshift({ yontem: 'answerCallbackQuery', govde: { callback_query_id: cb.id, text: bildirim || undefined }, sessiz: true });
  void mesaj;
}

/* ───────── GitHub ve Telegram ───────── */

class Hata extends Error {
  constructor(mesaj, ozellik = {}) {
    super(mesaj);
    Object.assign(this, ozellik);
  }
}

function istemciler(ayar, fetchFn, bekle) {
  const gizle = (s) => {
    let t = String(s);
    for (const sir of [ayar.tgToken, ayar.ghToken, ayar.actionsToken]) if (sir) t = t.split(sir).join('***');
    return t;
  };

  async function gh(yol, secenek = {}, token = ayar.ghToken) {
    const yanit = await fetchFn(`https://api.github.com${yol}`, {
      ...secenek,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'gorev-hatirlatici',
        ...(secenek.body ? { 'content-type': 'application/json' } : {}),
      },
    });
    return yanit;
  }

  async function veriOku() {
    const yanit = await gh(`/repos/${ayar.depo}/contents/${encodeURIComponent(ayar.dosya)}`);
    if (yanit.status === 404) {
      // Depo yoksa ya da anahtar depoyu göremiyorsa da 404 gelir; ayırt etmek için depoya bak.
      const depo = await gh(`/repos/${ayar.depo}`);
      if (depo.status !== 200) throw new Hata(`veri deposuna erişilemedi (${depo.status})`, { erisim: true, durum: depo.status });
      return { veri: O.bosVeri(), sha: null, yeni: true };
    }
    if (yanit.status === 401 || yanit.status === 403) throw new Hata(`GOREV_TOKEN reddedildi (${yanit.status})`, { erisim: true, durum: yanit.status });
    if (!yanit.ok) throw new Hata(`veri okunamadı (${yanit.status})`, { durum: yanit.status });
    const j = await yanit.json();
    let veri;
    try {
      veri = JSON.parse(Buffer.from(j.content || '', 'base64').toString('utf8') || '{}');
    } catch {
      throw new Hata('gorevler.json bozuk: JSON okunamadı', { bozuk: true });
    }
    return { veri: O.veriDuzelt(veri), sha: j.sha, yeni: false };
  }

  async function veriYaz(veri, sha, mesaj) {
    const govde = { message: mesaj, content: Buffer.from(JSON.stringify(veri, null, 1) + '\n', 'utf8').toString('base64') };
    if (sha) govde.sha = sha;
    const yanit = await gh(`/repos/${ayar.depo}/contents/${encodeURIComponent(ayar.dosya)}`, { method: 'PUT', body: JSON.stringify(govde) });
    if (yanit.status === 409 || yanit.status === 422) throw new Hata('kayıt çakıştı', { cakisma: true });
    if (yanit.status === 401 || yanit.status === 403 || yanit.status === 404) throw new Hata(`veri yazılamadı (${yanit.status}); GOREV_TOKEN'ın Contents izni "Read and write" olmalı`, { erisim: true, durum: yanit.status });
    if (!yanit.ok) throw new Hata(`veri yazılamadı (${yanit.status})`, { durum: yanit.status });
    const j = await yanit.json();
    return j.content && j.content.sha;
  }

  async function tg(yontem, govde, deneme = 0) {
    let yanit;
    try {
      yanit = await fetchFn(`https://api.telegram.org/bot${ayar.tgToken}/${yontem}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(govde || {}),
      });
    } catch (e) {
      throw new Hata(`Telegram ${yontem}: ağ hatası (${gizle(e.message)})`, { ag: true });
    }
    const j = await yanit.json().catch(() => ({}));
    if (j.ok) return j.result;
    const bekleSn = j.parameters && j.parameters.retry_after;
    if (yanit.status === 429 && bekleSn && bekleSn <= 15 && deneme < 2) {
      await bekle(bekleSn * 1000);
      return tg(yontem, govde, deneme + 1);
    }
    throw new Hata(`Telegram ${yontem}: ${j.error_code || yanit.status} ${gizle(j.description || '')}`.trim(), { kod: j.error_code || yanit.status, aciklama: j.description || '' });
  }

  return { gh, veriOku, veriYaz, tg, gizle };
}

/** Kurulum ya da erişim hatasında günde iki kez (09:00 ve 18:00 civarı) alarm verilir. */
function alarmPenceresi(simdi) {
  const p = O.yerel(simdi);
  return (p.sa === 9 || p.sa === 18) && p.dk < 10;
}

/* ───────── ana akış ───────── */

export async function calistir(secenek = {}) {
  const gunluk = secenek.gunluk || console.log;
  const simdi = (secenek.simdi || (() => new Date()))();
  try {
    return await calistirIc({ ...secenek, simdi: () => simdi });
  } catch (e) {
    // GitHub ya da Telegram'daki geçici bir kesinti her 5 dakikada hata e-postası doğurmasın.
    const ortam = secenek.ortam || process.env;
    const gizli = [ortam.TELEGRAM_BOT_TOKEN, ortam.GOREV_TOKEN, ortam.GH_TOKEN].filter(Boolean);
    const t = gizli.reduce((x, sir) => x.split(sir).join('***'), String((e && e.message) || e));
    gunluk(`Beklenmeyen hata: ${t}`);
    return { kod: alarmPenceresi(simdi) ? 1 : 0, hata: t };
  }
}

async function calistirIc({ ortam = process.env, fetch: fetchFn = globalThis.fetch, simdi: saat = () => new Date(), gunluk = console.log, bekle = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const ayar = ayarlariOku(ortam);
  const eksik = [];
  if (!ayar.tgToken) eksik.push('TELEGRAM_BOT_TOKEN');
  if (!ayar.ghToken) eksik.push('GOREV_TOKEN');
  if (!ayar.depo) eksik.push('GOREV_REPO');
  if (eksik.length) {
    gunluk(`Kurulum tamamlanmamış: ${eksik.join(', ')} tanımlı değil. Görev sayfasındaki kurulum adımlarını izle; o zamana kadar bu çalışma bir şey yapmaz.`);
    return { kod: 0, kurulumEksik: eksik };
  }
  const { gh, veriOku, veriYaz, tg, gizle } = istemciler(ayar, fetchFn, bekle);
  const simdi = saat();
  const rapor = { guncelleme: 0, hatirlatma: 0, ozet: 0, yanit: 0, yazildi: false, hata: [] };

  // 1) veri
  let okunan;
  try {
    okunan = await veriOku();
  } catch (e) {
    const neden = gizle(e.message);
    gunluk(`Veri okunamadı: ${neden}`);
    if (e.erisim) gunluk(`Kontrol et: GOREV_REPO (${ayar.depo}) doğru mu, GOREV_TOKEN süresi dolmuş olabilir mi, token bu depoya "Contents: Read and write" izniyle erişebiliyor mu?`);
    if (alarmPenceresi(simdi)) {
      if (ayar.sabitChatId) await tg('sendMessage', { chat_id: ayar.sabitChatId, text: `⚠️ Görev hatırlatıcısı veriye ulaşamıyor: ${neden}. GOREV_TOKEN'ı yenilemen gerekebilir.` }).catch(() => {});
      return { kod: 1, hata: neden };
    }
    return { kod: 0, hata: neden };
  }

  // 2) bot kimliği, komut listesi, workflow canlı tutma (haftada bir)
  const ek = {};
  const sonKontrol = okunan.veri.durum.bot && okunan.veri.durum.bot.kontrol ? new Date(okunan.veri.durum.bot.kontrol).getTime() : 0;
  if (!okunan.veri.durum.bot || simdi.getTime() - sonKontrol > 7 * 86400e3) {
    try {
      const ben = await tg('getMe', {});
      ek.botBilgi = { kullaniciAdi: ben.username || null, ad: ben.first_name || null, kontrol: O.isoYaz(simdi) };
    } catch (e) {
      rapor.hata.push(gizle(e.message));
      if (e.kod === 401) {
        gunluk('TELEGRAM_BOT_TOKEN geçersiz (401). BotFather\'dan aldığın tokeni depo sırrı olarak yeniden ekle.');
        return { kod: alarmPenceresi(simdi) ? 1 : 0, hata: 'TELEGRAM_BOT_TOKEN geçersiz' };
      }
    }
  }
  if (okunan.veri.durum.komutSurumu !== KOMUT_SURUMU) {
    try {
      await tg('setMyCommands', { commands: KOMUT_LISTESI.map(([command, description]) => ({ command, description })) });
      ek.komutlarKuruldu = true;
    } catch (e) {
      rapor.hata.push(gizle(e.message));
    }
  }
  const canliTut = okunan.veri.durum.canliTut ? new Date(okunan.veri.durum.canliTut).getTime() : 0;
  if (ayar.actionsToken && ayar.siteDeposu && simdi.getTime() - canliTut > 7 * 86400e3) {
    // Herkese açık depoda 60 gün hareketsiz kalan zamanlanmış workflow kapanır; yeniden etkinleştirmek sayacı sıfırlar.
    try {
      const y = await gh(`/repos/${ayar.siteDeposu}/actions/workflows/${encodeURIComponent(ayar.workflow)}/enable`, { method: 'PUT' }, ayar.actionsToken);
      if (y.ok || y.status === 204) ek.canliTut = true;
      else rapor.hata.push(`workflow etkinleştirilemedi (${y.status})`);
    } catch (e) {
      rapor.hata.push(gizle(e.message));
    }
  }

  // 3) Telegram güncellemeleri
  let guncellemeler = [];
  const al = () => tg('getUpdates', { offset: (okunan.veri.durum.tgSon || 0) + 1, timeout: 0, limit: 100, allowed_updates: ['message', 'callback_query'] });
  try {
    guncellemeler = await al();
  } catch (e) {
    if (e.kod === 409 && /webhook/i.test(e.aciklama)) {
      await tg('deleteWebhook', { drop_pending_updates: false }).catch(() => {});
      guncellemeler = await al().catch((e2) => {
        rapor.hata.push(gizle(e2.message));
        return [];
      });
    } else rapor.hata.push(gizle(e.message));
  }
  rapor.guncelleme = guncellemeler.length;

  // 4) işle ve kaydet (çakışmada en güncel veriyle baştan)
  let giden = [];
  let sha = okunan.sha;
  for (let deneme = 1; ; deneme++) {
    const once = JSON.stringify(okunan.veri);
    const v = JSON.parse(once);
    giden = isle(v, guncellemeler, simdi, ayar, ek);
    if (okunan.yeni || JSON.stringify(v) !== once) {
      try {
        const n = giden.filter((g) => g.anahtarlar).length;
        sha = await veriYaz(v, sha, `bot: ${guncellemeler.length} mesaj, ${n} bildirim`);
        rapor.yazildi = true;
      } catch (e) {
        if (e.cakisma && deneme < 5) {
          gunluk(`Kayıt çakıştı (site aynı anda yazmış olabilir); yeniden deneniyor (${deneme}).`);
          okunan = await veriOku();
          sha = okunan.sha;
          continue;
        }
        gunluk(`Kaydedilemedi, mesaj gönderilmiyor: ${gizle(e.message)}`);
        return { kod: alarmPenceresi(simdi) ? 1 : 0, hata: gizle(e.message) };
      }
    }
    okunan = { veri: v, sha, yeni: false };
    break;
  }

  // 5) gönder
  const basarisizAnahtar = [];
  for (const oge of giden) {
    try {
      await tg(oge.yontem, oge.govde);
      if (oge.yontem === 'sendMessage') {
        if (!oge.anahtarlar) rapor.yanit++;
        else if (oge.anahtarlar.some((k) => k.startsWith('ozet|'))) rapor.ozet++;
        else rapor.hatirlatma++;
      }
    } catch (e) {
      if (oge.sessiz) continue; // süresi geçmiş buton cevabı, değişmeyen mesaj vb.
      rapor.hata.push(gizle(e.message));
      if (oge.anahtarlar) basarisizAnahtar.push(...oge.anahtarlar);
    }
  }

  // 6) gönderilemeyen hatırlatmaları bir sonraki çalışmaya bırak; sağlık durumunu güncelle
  const saglik = rapor.hata.length ? { hata: rapor.hata.slice(0, 3).join(' | ').slice(0, 300), zaman: O.isoYaz(simdi) } : {};
  const saglikDegisti = ((okunan.veri.durum.saglik && okunan.veri.durum.saglik.hata) || '') !== (saglik.hata || '');
  if (basarisizAnahtar.length || saglikDegisti) {
    for (let deneme = 1; deneme <= 4; deneme++) {
      const v = JSON.parse(JSON.stringify(okunan.veri));
      for (const k of basarisizAnahtar) delete v.durum.gonderilen[k];
      v.durum.saglik = saglik;
      try {
        sha = await veriYaz(v, sha, 'bot: durum');
        break;
      } catch (e) {
        if (!e.cakisma) {
          rapor.hata.push(gizle(e.message));
          break;
        }
        okunan = await veriOku();
        sha = okunan.sha;
      }
    }
  }

  gunluk(
    `Görev: ${okunan.veri.gorevler.filter((g) => g.durum !== 'bitti').length} açık · Telegram: ${rapor.guncelleme} güncelleme · ` +
      `gönderilen: ${rapor.hatirlatma} hatırlatma, ${rapor.ozet} özet, ${rapor.yanit} yanıt · kayıt: ${rapor.yazildi ? 'yazıldı' : 'değişiklik yok'}` +
      (okunan.veri.telegram.chatId || ayar.sabitChatId ? '' : ' · Telegram henüz bağlanmadı') +
      (rapor.hata.length ? `\nUyarılar: ${rapor.hata.join(' | ')}` : ''),
  );
  return { kod: 0, rapor };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  calistir()
    .then((s) => {
      process.exitCode = s.kod || 0;
    })
    .catch((e) => {
      const t = String((e && e.stack) || e);
      const gizli = [process.env.TELEGRAM_BOT_TOKEN, process.env.GOREV_TOKEN, process.env.GH_TOKEN].filter(Boolean);
      console.error('Beklenmeyen hata:', gizli.reduce((s, x) => s.split(x).join('***'), t));
      process.exitCode = 1;
    });
}
