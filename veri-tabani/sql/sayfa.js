/*
 * sayfa.js · SQL pratiği sayfasının arayüzü
 * Görevleri çizer, siyah editörleri kurar, sorguları motor.js ile çalıştırır
 * ve sonucu görevin referans sonucuyla karşılaştırır.
 */
import { Motor, SEMA, VERI, sozcukle, karsilastir, deneyDenetle, hataAciklamasi, tabloTanimi } from './motor.js';
import { HAFTALAR } from './gorevler.js';

/* ---------- küçük yardımcılar ---------- */

function el(etiket, ozellik = {}, ...cocuklar) {
  const d = document.createElement(etiket);
  for (const [k, v] of Object.entries(ozellik)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') d.className = v;
    else if (k === 'text') d.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') d.addEventListener(k.slice(2), v);
    else d.setAttribute(k, v === true ? '' : v);
  }
  for (const c of cocuklar.flat()) if (c !== null && c !== undefined && c !== false) d.append(c);
  return d;
}

/** `kod` işaretli metni güvenle DOM'a çevirir. */
function satirIci(metin) {
  const parca = document.createDocumentFragment();
  String(metin)
    .split(/(`[^`]+`)/)
    .forEach((p) => {
      if (/^`[^`]+`$/.test(p)) parca.append(el('code', { text: p.slice(1, -1) }));
      else if (p) parca.append(document.createTextNode(p));
    });
  return parca;
}

const ANAHTAR = 'vtsql:v1';
const depo = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(ANAHTAR) || '{}');
    return { cozulen: v.cozulen || {}, taslak: v.taslak || {} };
  } catch (e) {
    return { cozulen: {}, taslak: {} };
  }
})();
let kayitSaati = 0;
function kaydet() {
  clearTimeout(kayitSaati);
  kayitSaati = setTimeout(() => {
    try {
      localStorage.setItem(ANAHTAR, JSON.stringify(depo));
    } catch (e) {
      /* özel pencere ya da kapalı depolama: ilerleme bu oturumla sınırlı kalır */
    }
  }, 250);
}

/* ---------- motor ---------- */

const durumEl = document.getElementById('motor-durum');
const motorSozu = import('./vendor/sqlite3.mjs').then(({ default: init }) => Motor.kur(init));
motorSozu.then(
  () => {
    durumEl.textContent = 'vt1 hazır · MySQL 8.4 gibi davranıyor';
    durumEl.dataset.durum = 'hazir';
  },
  (e) => {
    durumEl.textContent = 'Veri tabanı yüklenemedi: ' + ((e && e.message) || e) + ' · Sayfayı yenilemeyi dene.';
    durumEl.dataset.durum = 'hata';
  },
);
window.__vtsql = { motorSozu };

const referanslar = new Map();
async function referans(g) {
  if (!referanslar.has(g.id)) {
    const m = await motorSozu;
    const r = m.calistir(g.cozum).sonuclar;
    referanslar.set(g.id, r[r.length - 1]);
  }
  return referanslar.get(g.id);
}

/* ---------- sözdizimi renklendirme ---------- */

const ANAHTAR_SOZ = new Set(
  ('SELECT FROM WHERE AND OR NOT NULL IS IN BETWEEN LIKE REGEXP ORDER BY GROUP HAVING LIMIT OFFSET AS DISTINCT ASC DESC CASE WHEN THEN ELSE END ' +
    'JOIN INNER LEFT RIGHT CROSS NATURAL ON USING UNION ALL EXISTS INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE DROP ALTER TRUNCATE USE SHOW ' +
    'TABLES DATABASES COLUMNS DESCRIBE EXPLAIN TRUE FALSE COLLATE INTERVAL DIV MOD XOR WITH PRIMARY KEY FOREIGN REFERENCES CONSTRAINT CHECK ' +
    'UNIQUE DEFAULT INDEX ESCAPE UNKNOWN INT INTEGER SMALLINT TINYINT VARCHAR CHAR DATE DECIMAL SIGNED UNSIGNED').split(' '),
);
const kacis = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function renkle(src) {
  const t = sozcukle(src);
  let out = '';
  for (let i = 0; i < t.length; i++) {
    const tk = t[i];
    const h = kacis(tk.ham);
    let s = '';
    switch (tk.tur) {
      case 'yorum':
        s = 'c';
        break;
      case 'metin':
        s = 's';
        break;
      case 'sayi':
        s = 'n';
        break;
      case 'hata':
      case 'akilli':
        s = 'e';
        break;
      case 'degisken':
        s = 'v';
        break;
      case 'kelime': {
        if (tk.tirnakli) {
          s = 'i';
          break;
        }
        let j = i + 1;
        while (t[j] && t[j].tur === 'bosluk') j++;
        const anahtar = ANAHTAR_SOZ.has(tk.ust);
        if (!anahtar && t[j] && t[j].tur === 'op' && t[j].deger === '(') s = 'f';
        else if (anahtar) s = 'k';
        break;
      }
      case 'op':
        if (!',();.'.includes(tk.deger)) s = 'o';
        break;
      default:
        break;
    }
    out += s ? `<span class="t-${s}">${h}</span>` : h;
  }
  return out + (src.endsWith('\n') || !src ? ' ' : '');
}

/* ---------- editör ---------- */

function editorYap({ deger = '', etiket = 'SQL', yer = 'Sorgunu buraya yaz…  (Ctrl + Enter ile çalıştır)', salt = false, calistir, degisti }) {
  const ta = el('textarea', {
    class: 'ed-yazi',
    spellcheck: 'false',
    autocapitalize: 'off',
    autocomplete: 'off',
    autocorrect: 'off',
    'aria-label': etiket + (salt ? ' (salt okunur SQL)' : ' · SQL düzenleyici'),
    placeholder: salt ? null : yer,
  });
  ta.value = deger;
  if (salt) ta.readOnly = true;
  const pre = el('pre', { class: 'ed-renk', 'aria-hidden': 'true' });
  const dugmeler = el('div', { class: 'ed-dugmeler' });
  const kok = el(
    'div',
    { class: 'ed' + (salt ? ' salt' : '') },
    el('div', { class: 'ed-ust' }, el('span', { class: 'ed-isik', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')), el('span', { class: 'ed-etiket', text: etiket }), dugmeler),
    el('div', { class: 'ed-alan' }, pre, ta),
  );
  const guncelle = () => {
    pre.innerHTML = renkle(ta.value);
  };
  ta.addEventListener('input', () => {
    guncelle();
    if (degisti) degisti(ta.value);
  });
  ta.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && calistir) {
      e.preventDefault();
      calistir();
    }
  });
  guncelle();
  let calistirDugmesi = null;
  if (calistir) {
    calistirDugmesi = el('button', { class: 'ed-dugme calistir', type: 'button', onclick: () => calistir() }, el('span', { 'aria-hidden': 'true', text: '▶' }), ' Çalıştır', el('kbd', { class: 'uzun', text: 'Ctrl ↵' }));
    dugmeler.append(calistirDugmesi);
  }
  return {
    kok,
    ta,
    deger: () => ta.value,
    ayarla(v) {
      ta.value = v;
      guncelle();
      if (degisti) degisti(v);
    },
    dugme(metin, tik, baslik) {
      const b = el('button', { class: 'ed-dugme', type: 'button', title: baslik || null, onclick: tik, text: metin });
      dugmeler.prepend(b);
      return b;
    },
    mesgul(evet) {
      if (calistirDugmesi) calistirDugmesi.disabled = evet;
    },
  };
}

/* ---------- sonuç tablosu ---------- */

function sonucKarti(s) {
  if (s.tur === 'tablo') {
    const kart = el('div', { class: 'st' });
    const bas = el('div', { class: 'st-bas' });
    if (s.sql) bas.append(el('span', { class: 'sql', text: s.sql.replace(/\s+/g, ' '), title: s.sql }));
    bas.append(el('span', { class: 'say', text: `${s.satirSayisi}${s.cokFazla ? '+' : ''} satır${typeof s.sure === 'number' ? ` · ${s.sure < 1 ? '<1' : Math.round(s.sure)} ms` : ''}` }));
    kart.append(bas);
    const sayisal = s.tipler ? s.tipler.map((t) => t && ['int', 'dec', 'float'].includes(t.t)) : [];
    const tablo = el('table', { class: 'grid' });
    tablo.append(el('thead', {}, el('tr', {}, s.sutunlar.map((ad) => el('th', { scope: 'col', text: ad })))));
    const govde = el('tbody');
    s.metinler.forEach((satir, i) => {
      govde.append(
        el(
          'tr',
          {},
          satir.map((v, j) => {
            if (v === null) return el('td', { class: 'bos', text: 'NULL' });
            const sag = sayisal[j] || typeof s.satirlar[i][j] === 'number';
            return el('td', { class: sag ? 'say' : null, text: v });
          }),
        ),
      );
    });
    tablo.append(govde);
    kart.append(el('div', { class: 'st-kaydir', tabindex: '0', role: 'region', 'aria-label': 'Sonuç tablosu' }, tablo));
    if (!s.satirSayisi) kart.append(el('div', { class: 'st-bosluk', text: 'Boş sonuç: koşulu sağlayan satır yok. Bu bir hata değil; sorgu çalıştı.' }));
    if (s.kesildi) kart.append(el('div', { class: 'st-bosluk', text: `İlk ${s.metinler.length} satır gösteriliyor.` }));
    if (s.ipuclari && s.ipuclari.length) kart.append(el('ul', { class: 'ipuclari' }, s.ipuclari.map((i) => el('li', { text: i.metin }))));
    return kart;
  }
  if (s.tur === 'hata') {
    const aciklama = hataAciklamasi(s);
    return el(
      'div',
      { class: 'st st-hata' },
      el('code', { class: 'kodlu', text: (s.kod ? `ERROR ${s.kod} (${s.durum}): ` : s.destek ? 'Desteklenmiyor: ' : 'HATA: ') + s.mesaj }),
      aciklama ? el('p', { text: aciklama }) : null,
    );
  }
  if (s.tur === 'mesaj') return el('div', { class: 'st' }, el('div', { class: 'st-mesaj', text: s.metin }));
  if (s.tur === 'tamam') {
    return el('div', { class: 'st' }, el('div', { class: 'st-mesaj', text: `Query OK, ${s.etkilenen} row(s) affected — çalıştırma bitince geri alındı; veri tabanı kitaptaki hâlinde.` }));
  }
  return el('div', { class: 'st' }, el('div', { class: 'st-bosluk', text: 'Çalıştırılacak komut yok.' }));
}

function sonuclariCiz(kap, sonuclar) {
  kap.replaceChildren(...(sonuclar.length ? sonuclar.map(sonucKarti) : [sonucKarti({ tur: 'bos' })]));
}

function geriBildirim(kap, durum, baslik, mesajlar = []) {
  kap.dataset.durum = durum;
  const liste = mesajlar.filter(Boolean);
  kap.replaceChildren(el('strong', { text: baslik }), ...(liste.length ? [el('ul', {}, liste.map((m) => el('li', { text: m })))] : []));
}

/* ---------- ilerleme ---------- */

const tumGorevler = HAFTALAR.flatMap((h) => h.bolumler.flatMap((b) => b.gorevler.map((g) => ({ g, h }))));
document.getElementById('ilerleme-toplam').textContent = String(tumGorevler.length);

function ilerlemeGuncelle() {
  const cozulen = tumGorevler.filter((x) => depo.cozulen[x.g.id]).length;
  document.getElementById('ilerleme-sayi').textContent = String(cozulen);
  for (const h of HAFTALAR) {
    const liste = tumGorevler.filter((x) => x.h === h);
    const say = liste.filter((x) => depo.cozulen[x.g.id]).length;
    const cubuk = document.querySelector(`[data-cubuk="${h.id}"]`);
    if (cubuk) {
      cubuk.querySelector('i').style.width = `${(100 * say) / liste.length}%`;
      cubuk.parentElement.querySelector('[data-cubuk-metin]').textContent = `${say} / ${liste.length} görev çözüldü`;
    }
  }
}

function cozuldu(g, kart) {
  const ilk = !depo.cozulen[g.id];
  depo.cozulen[g.id] = Date.now();
  kaydet();
  kart.dataset.cozuldu = '1';
  if (ilk) {
    kart.classList.remove('yeni-cozuldu');
    void kart.offsetWidth;
    kart.classList.add('yeni-cozuldu');
  }
  ilerlemeGuncelle();
}

/* ---------- görev kartı ---------- */

function gorevKarti(g) {
  const tur = g.tur || 'sorgu';
  const kart = el('article', { class: 'kart gorev', id: 'g-' + g.id, 'data-tur': tur, 'aria-labelledby': 'b-' + g.id });
  if (depo.cozulen[g.id]) kart.dataset.cozuldu = '1';
  kart.append(
    el('div', { class: 'g-ust' }, el('span', { class: 'g-kod', text: g.kod }), el('h4', { class: 'g-baslik', id: 'b-' + g.id, text: g.baslik }), el('span', { class: 'g-rozet', text: '✓ çözüldü' })),
    el('p', { class: 'g-soru' }, satirIci(g.soru)),
  );
  const gb = el('div', { class: 'gb', role: 'status', 'aria-live': 'polite' });
  const aciklamaKutusu = g.aciklama ? el('p', { class: 'g-aciklama', hidden: !depo.cozulen[g.id] }, satirIci(g.aciklama)) : null;

  if (tur === 'soru') {
    const giris = el('input', { type: 'text', inputmode: 'numeric', 'aria-label': g.kod + ' yanıtı', placeholder: 'ör. 101, 102' });
    const kontrol = () => {
      const verilen = [...new Set((giris.value.match(/\d+/g) || []).map(Number))].sort((a, b) => a - b);
      const dogru = [...g.cevap].sort((a, b) => a - b);
      if (!verilen.length) geriBildirim(gb, 'bilgi', 'Önce kimlikleri yaz.');
      else if (verilen.length === dogru.length && verilen.every((v, i) => v === dogru[i])) {
        geriBildirim(gb, 'dogru', '✓ Doğru!');
        kart.dataset.durum = 'dogru';
        if (aciklamaKutusu) aciklamaKutusu.hidden = false;
        cozuldu(g, kart);
      } else {
        const eksik = dogru.filter((v) => !verilen.includes(v));
        const fazla = verilen.filter((v) => !dogru.includes(v));
        geriBildirim(gb, 'yanlis', '✗ Henüz değil', [
          eksik.length ? `${eksik.length} öğrenci eksik.` : null,
          fazla.length ? `Şunlar birinci listede yok ya da kayıtta geçiyor: ${fazla.join(', ')}.` : null,
        ]);
        kart.dataset.durum = 'yanlis';
      }
    };
    giris.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') kontrol();
    });
    kart.append(el('div', { class: 'soru-satir' }, giris, el('button', { class: 'dugme', type: 'button', onclick: kontrol, text: 'Kontrol et' })), gb);
  } else {
    let beklenenKutu = null;
    if (tur === 'sorgu') {
      beklenenKutu = el('div', { class: 'g-beklenen-sonuc', hidden: true });
      const goster = el('button', { class: 'bag-dugme', type: 'button', text: 'beklenen sonucu göster', 'aria-expanded': 'false' });
      goster.addEventListener('click', async () => {
        if (!beklenenKutu.hidden) {
          beklenenKutu.hidden = true;
          goster.textContent = 'beklenen sonucu göster';
          goster.setAttribute('aria-expanded', 'false');
          return;
        }
        const ref = await referans(g);
        const kitap = g.sonuc ? el('p', { class: 'g-not', text: 'Kitaptaki beklenen sonuç: ' + g.sonuc }) : null;
        beklenenKutu.replaceChildren(...[kitap, sonucKarti({ ...ref, sql: null, sure: null, ipuclari: [] })].filter(Boolean));
        beklenenKutu.hidden = false;
        goster.textContent = 'beklenen sonucu gizle';
        goster.setAttribute('aria-expanded', 'true');
      });
      kart.append(el('p', { class: 'g-beklenen' }, 'Beklenen:', el('b', { text: `${g.beklenen} satır` }), goster), beklenenKutu);
    }
    const sonucKap = el('div', { class: 'sonuclar' });
    const ed = editorYap({
      deger: depo.taslak[g.id] || '',
      etiket: `${g.kod} · ${g.baslik}`,
      degisti: (v) => {
        if (v.trim()) depo.taslak[g.id] = v;
        else delete depo.taslak[g.id];
        kaydet();
      },
      calistir: async () => {
        const sql = ed.deger();
        if (!sql.trim()) {
          geriBildirim(gb, 'bilgi', 'Önce bir sorgu yaz.');
          return;
        }
        ed.mesgul(true);
        try {
          if (durumEl.dataset.durum !== 'hazir') geriBildirim(gb, 'bilgi', 'Veri tabanı yükleniyor…');
          const m = await motorSozu;
          const { sonuclar } = m.calistir(sql);
          sonuclariCiz(sonucKap, sonuclar);
          degerlendir(g, kart, gb, sonuclar, sql, aciklamaKutusu);
        } catch (e) {
          geriBildirim(gb, 'yanlis', 'Çalıştırılamadı', [String((e && e.message) || e)]);
        } finally {
          ed.mesgul(false);
        }
      },
    });
    ed.dugme('Temizle', () => {
      ed.ayarla('');
      sonucKap.replaceChildren();
      delete gb.dataset.durum;
      gb.replaceChildren();
      ed.ta.focus();
    });
    kart.append(ed.kok, gb, sonucKap);
  }

  // ipuçları ve çözüm
  const ipucuListesi = el('ol', { class: 'g-ipuclari', hidden: true });
  let acilan = 0;
  const ipuclari = g.ipuclari || [];
  const ipucuDugmesi = el('button', { class: 'dugme', type: 'button', text: `İpucu (${ipuclari.length})` });
  ipucuDugmesi.disabled = !ipuclari.length;
  ipucuDugmesi.addEventListener('click', () => {
    if (acilan >= ipuclari.length) return;
    ipucuListesi.append(el('li', {}, satirIci(ipuclari[acilan++])));
    ipucuListesi.hidden = false;
    ipucuDugmesi.textContent = acilan < ipuclari.length ? `Sonraki ipucu (${ipuclari.length - acilan})` : 'İpuçları bitti';
    ipucuDugmesi.disabled = acilan >= ipuclari.length;
  });
  const alt = el('div', { class: 'g-alt' }, ipucuDugmesi);
  let cozumKutu = null;
  if (g.cozum && tur !== 'soru') {
    const etiketler = tur === 'deney' ? ['Deneyin yazılışı', 'Yazılışı gizle'] : ['Çözümü göster', 'Çözümü gizle'];
    cozumKutu = el('div', { class: 'g-cozum', hidden: true });
    const cozumDugmesi = el('button', { class: 'dugme', type: 'button', text: etiketler[0], 'aria-expanded': 'false' });
    cozumDugmesi.addEventListener('click', () => {
      if (!cozumKutu.childElementCount) {
        // Laboratuvar çözümleri kitapta yok: bu sorgular kitabın beklenen sonucunu veren örnek çözümlerdir.
        const lab = /^h\d+-[sr]\d+$/.test(g.id);
        const etiket = tur === 'deney' ? 'Deneyin yazılışı' : lab ? 'Örnek çözüm · kitabın beklenen sonucunu verir' : 'Kitabın çözümü';
        const salt = editorYap({ deger: g.cozum, etiket, salt: true });
        const editor = kart.querySelector('.ed:not(.salt) .ed-yazi');
        salt.dugme('Editöre al', () => {
          editor.value = g.cozum;
          editor.dispatchEvent(new Event('input'));
          editor.focus();
        });
        cozumKutu.append(salt.kok);
      }
      cozumKutu.hidden = !cozumKutu.hidden;
      cozumDugmesi.textContent = cozumKutu.hidden ? etiketler[0] : etiketler[1];
      cozumDugmesi.setAttribute('aria-expanded', String(!cozumKutu.hidden));
    });
    alt.append(cozumDugmesi);
  }
  kart.append(alt, ipucuListesi);
  if (cozumKutu) kart.append(cozumKutu);
  if (g.not) kart.append(el('p', { class: 'g-not' }, satirIci(g.not)));
  if (aciklamaKutusu) kart.append(aciklamaKutusu);
  return kart;
}

async function degerlendir(g, kart, gb, sonuclar, sql, aciklamaKutusu) {
  const son = sonuclar[sonuclar.length - 1];
  if ((g.tur || 'sorgu') === 'deney') {
    const d = deneyDenetle(sonuclar, g.deney, sql);
    if (d.dogru) {
      geriBildirim(gb, 'dogru', '✓ Deney tamam: beklenen sonuç geldi.');
      kart.dataset.durum = 'dogru';
      if (aciklamaKutusu) aciklamaKutusu.hidden = false;
      cozuldu(g, kart);
    } else {
      geriBildirim(gb, 'yakin', 'Deney henüz beklenen sonucu vermedi', d.mesajlar);
      kart.dataset.durum = 'yakin';
    }
    return;
  }
  if (!son || son.tur === 'hata') {
    geriBildirim(gb, 'yanlis', '✗ Sorgu hata verdi', ['Aşağıdaki MySQL mesajını ve açıklamasını oku, sonra düzeltip yeniden çalıştır.']);
    kart.dataset.durum = 'yanlis';
    return;
  }
  const tablo = [...sonuclar].reverse().find((s) => s.tur === 'tablo');
  if (!tablo) {
    geriBildirim(gb, 'yanlis', '✗ Sonuç tablosu yok', ['Bu görev bir SELECT sorgusu bekliyor.']);
    kart.dataset.durum = 'yanlis';
    return;
  }
  const ref = await referans(g);
  const k = karsilastir(tablo, ref, g.kural, sql);
  if (k.dogru) {
    geriBildirim(gb, 'dogru', '✓ Doğru! Sonuç kitabın beklediğiyle aynı.', k.mesajlar);
    kart.dataset.durum = 'dogru';
    cozuldu(g, kart);
  } else if (k.durum === 'yakin') {
    geriBildirim(gb, 'yakin', '≈ Neredeyse', k.mesajlar);
    kart.dataset.durum = 'yakin';
  } else {
    geriBildirim(gb, 'yanlis', '✗ Henüz değil', k.mesajlar);
    kart.dataset.durum = 'yanlis';
  }
}

/* ---------- notlar ---------- */

function notCiz(n) {
  const govde = el('div', { class: 'not-govde' }, n.govde.map((p) => el('p', {}, satirIci(p))));
  const d = el('details', { class: 'not' }, el('summary', { text: n.baslik }), govde);
  let kuruldu = false;
  d.addEventListener('toggle', () => {
    if (!d.open || kuruldu) return;
    kuruldu = true;
    n.ornekler.forEach((ornek, i) => {
      const sonucKap = el('div', { class: 'sonuclar' });
      const ed = editorYap({
        deger: ornek,
        etiket: `Örnek ${i + 1} · düzenleyip çalıştırabilirsin`,
        calistir: async () => {
          const m = await motorSozu;
          sonuclariCiz(sonucKap, m.calistir(ed.deger()).sonuclar);
        },
      });
      govde.append(ed.kok, sonucKap);
    });
  });
  return d;
}

/* ---------- haftalar ---------- */

function haftaCiz(h) {
  const cubuk = el('span', { class: 'cubuk', 'data-cubuk': h.id }, el('i'));
  const bolum = el(
    'section',
    { class: 'kap hafta', id: h.id, 'aria-labelledby': h.id + '-baslik' },
    el(
      'div',
      { class: 'hafta-bas' },
      el('div', { class: 'hafta-no', 'aria-hidden': 'true' }, String(h.no), el('span', { text: 'hafta' })),
      el('div', {}, el('h2', { id: h.id + '-baslik' }, el('small', { text: `${h.no}. hafta` }), h.baslik), el('p', { text: h.ozet })),
      el('div', { class: 'hafta-cubuk' }, cubuk, el('span', { 'data-cubuk-metin': '' })),
    ),
    el('h3', { text: 'Kısa notlar' }),
    el('p', { class: 'grup-aciklama', text: 'Kitaptaki kuralların özeti. Her örneği açıp çalıştırabilir, değiştirip yeniden deneyebilirsin.' }),
    el('div', { class: 'notlar' }, h.notlar.map(notCiz)),
  );
  for (const b of h.bolumler) {
    bolum.append(el('h3', { id: b.id, text: b.baslik }), el('p', { class: 'grup-aciklama', text: b.aciklama }), el('div', { class: 'gorevler' }, b.gorevler.map(gorevKarti)));
  }
  return bolum;
}

/* ---------- şema paneli ---------- */

function semaCiz(kap) {
  const sekmeler = el('div', { class: 'sema-sekme', role: 'group', 'aria-label': 'Tablo seç' });
  const icerik = el('div', { class: 'sema-icerik', 'aria-live': 'polite' });
  const sec = (ad) => {
    for (const b of sekmeler.children) b.setAttribute('aria-pressed', String(b.dataset.ad === ad));
    const tanim = tabloTanimi(ad);
    const t = SEMA.find((x) => x.ad === ad);
    const liste = el(
      'ul',
      { class: 'sutun-liste', 'aria-label': ad + ' sütunları' },
      tanim.map((c) =>
        el(
          'li',
          {},
          el('span', { class: 'ad', text: c.ad }),
          el('span', { class: 'tip', text: c.tip }),
          c.bos ? el('span', { class: 'bos-ok', text: 'boş olabilir' }) : null,
          c.hedef ? el('span', { class: 'bos-ok', text: '→ ' + c.hedef }) : null,
          c.anahtar ? el('span', { class: 'anah ' + c.anahtar, text: c.anahtar }) : null,
        ),
      ),
    );
    const satirlar = VERI[ad];
    const metinler = satirlar.map((s) => s.map((v, j) => (v === null ? null : tanim[j].ondalik !== null ? Number(v).toFixed(tanim[j].ondalik) : String(v))));
    const tablo = sonucKarti({
      tur: 'tablo',
      sql: `SELECT * FROM ${ad};`,
      sutunlar: t.sutunlar.map((c) => c.ad),
      tipler: tanim.map((c) => ({ t: /int|decimal/.test(c.tip) ? 'int' : 'text' })),
      satirlar,
      metinler,
      satirSayisi: satirlar.length,
      ipuclari: [],
    });
    icerik.replaceChildren(liste, el('div', {}, tablo, el('p', { class: 'sema-not' }, 'Anahtarlar: ', el('b', { text: 'PRI' }), ' birincil, ', el('b', { text: 'UNI' }), ' benzersiz, ', el('b', { text: 'MUL' }), ' dizinli (yabancı anahtar). Aynı bilgiyi konsolda ', el('code', { text: `DESCRIBE ${ad};` }), ' verir.')));
  };
  for (const t of SEMA) {
    sekmeler.append(el('button', { type: 'button', 'data-ad': t.ad, 'aria-pressed': 'false', onclick: () => sec(t.ad), text: t.ad }));
  }
  kap.append(sekmeler, icerik);
  sec('kayit');
}

/* ---------- konsol ---------- */

function konsolCiz(kap) {
  const sonucKap = el('div', { class: 'sonuclar' });
  const ed = editorYap({
    deger: depo.taslak.konsol ?? 'SHOW TABLES;\n\nSELECT *\nFROM kayit;',
    etiket: 'konsol · vt1',
    degisti: (v) => {
      depo.taslak.konsol = v;
      kaydet();
    },
    calistir: async () => {
      ed.mesgul(true);
      try {
        const m = await motorSozu;
        sonuclariCiz(sonucKap, m.calistir(ed.deger()).sonuclar);
      } finally {
        ed.mesgul(false);
      }
    },
  });
  kap.append(ed.kok, sonucKap);
}

/* ---------- kurulum ---------- */

konsolCiz(document.getElementById('konsol-yeri'));
semaCiz(document.getElementById('sema-yeri'));
const haftalarKap = document.getElementById('haftalar');
for (const h of HAFTALAR) haftalarKap.append(haftaCiz(h));
for (const x of tumGorevler) if (depo.cozulen[x.g.id]) document.getElementById('g-' + x.g.id).dataset.durum = 'dogru';
ilerlemeGuncelle();

document.getElementById('ilerleme-sifirla').addEventListener('click', () => {
  if (!window.confirm('Çözülen görevler ve yazdığın bütün taslaklar silinsin mi?')) return;
  try {
    localStorage.removeItem(ANAHTAR);
  } catch (e) {
    /* yoksay */
  }
  location.reload();
});

// adres çubuğundaki #bölüme git (bölümler JS ile çizildiği için)
if (location.hash) {
  const hedef = document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (hedef) hedef.scrollIntoView();
}

// üst menüde bulunulan bölüm
const menu = [...document.querySelectorAll('.ust nav a')];
if ('IntersectionObserver' in window) {
  const gozcu = new IntersectionObserver(
    (girisler) => {
      for (const g of girisler) {
        if (!g.isIntersecting) continue;
        for (const a of menu) a.setAttribute('aria-current', String(a.getAttribute('href') === '#' + g.target.id));
      }
    },
    { rootMargin: '-40% 0px -55% 0px' },
  );
  for (const a of menu) {
    const hedef = document.querySelector(a.getAttribute('href'));
    if (hedef) gozcu.observe(hedef);
  }
}
