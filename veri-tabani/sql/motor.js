/*
 * motor.js · Veri Tabanı I, 8–9. hafta SQL pratiği
 *
 * Kitaptaki vt1 veri tabanını tarayıcıda kurar ve MySQL 8.4 gibi davranmaya
 * çalışır. Altta SQLite'ın resmî WebAssembly derlemesi çalışır
 * (vendor/sqlite3.mjs). Bu dosya MySQL yazımını SQLite'a çevirir ve şunları
 * MySQL'deki gibi yapar:
 *   - utf8mb4_turkish_ci karşılaştırma düzeni (i/İ, ı/I; Ö, P'den önce gelir)
 *   - kesin ondalık: 10 / 4 = 2.5000, 0.1 + 0.2 = 0.3 doğrudur, ücret 1000.00
 *   - hata numaraları: 1054, 1064, 1146, 3065, 1140, 1055 …
 *   - CONCAT'ta NULL, Türkçe UPPER/LOWER, YEAR, DATEDIFF, LIKE …
 * Her çalıştırma bir SAVEPOINT içinde yapılır ve sonunda geri alınır; veri
 * tabanı her zaman kitaptaki hâlinde kalır.
 */

export const DUZEN = 'utf8mb4_turkish_ci';
const GOSTERIM_SINIRI = 500;
const SAYIM_SINIRI = 100000;
const SURE_SINIRI = 4000;

/* ===================================================================
 * 1. Türkçe karşılaştırma düzeni (utf8mb4_turkish_ci benzeri)
 * =================================================================== */

const TR_HARFLER = 'abcçdefgğhıijklmnoöpqrsştuüvwxyz';
const HARF_AGIRLIK = new Map();
for (let i = 0; i < TR_HARFLER.length; i++) HARF_AGIRLIK.set(TR_HARFLER[i], 600 + i);

function karAgirlik(ch) {
  let k;
  if (ch === 'I') k = 'ı';
  else if (ch === 'İ') k = 'i';
  else k = ch.toLowerCase();
  let w = HARF_AGIRLIK.get(k);
  if (w !== undefined) return w;
  const c = k.charCodeAt(0);
  if (c >= 48 && c <= 57) return 500 + (c - 48);
  if (k.length === 1 && c < 128) return 200 + c;
  const taban = k.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (taban.length === 1 && taban !== k) {
    w = HARF_AGIRLIK.get(taban);
    if (w !== undefined) return w;
  }
  return Math.min(0xfffe, 1000 + k.codePointAt(0));
}

const anahtarBellek = new Map();
export function trAnahtar(s) {
  let k = anahtarBellek.get(s);
  if (k !== undefined) return k;
  let n = s.length;
  while (n > 0 && s.charCodeAt(n - 1) === 32) n--; // PAD SPACE
  k = '';
  for (const ch of s.slice(0, n)) k += String.fromCharCode(karAgirlik(ch));
  if (anahtarBellek.size > 50000) anahtarBellek.clear();
  anahtarBellek.set(s, k);
  return k;
}

export function trKarsilastir(a, b) {
  const x = trAnahtar(a);
  const y = trAnahtar(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

const agirliklar = (s) => Array.from(String(s), karAgirlik);

/** MySQL LIKE: % ve _ jokerleri, Türkçe büyük/küçük harf duyarsız. */
export function trBenzer(metin, desen, kacis) {
  const ogeler = [];
  const p = Array.from(desen);
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (kacis && ch === kacis && i + 1 < p.length) {
      ogeler.push(karAgirlik(p[++i]));
      continue;
    }
    if (ch === '%') {
      if (ogeler[ogeler.length - 1] !== -1) ogeler.push(-1);
      continue;
    }
    if (ch === '_') {
      ogeler.push(-2);
      continue;
    }
    ogeler.push(karAgirlik(ch));
  }
  const m = agirliklar(metin);
  let i = 0;
  let j = 0;
  let yildiz = -1;
  let iz = 0;
  while (j < m.length) {
    if (i < ogeler.length && (ogeler[i] === -2 || ogeler[i] === m[j])) {
      i++;
      j++;
    } else if (i < ogeler.length && ogeler[i] === -1) {
      yildiz = i++;
      iz = j;
    } else if (yildiz >= 0) {
      i = yildiz + 1;
      j = ++iz;
    } else return 0;
  }
  while (i < ogeler.length && ogeler[i] === -1) i++;
  return i === ogeler.length ? 1 : 0;
}

function trBul(alt, ust, bas = 1) {
  const a = agirliklar(alt);
  const u = agirliklar(ust);
  for (let i = Math.max(0, bas - 1); i + a.length <= u.length; i++) {
    let tamam = true;
    for (let k = 0; k < a.length; k++) {
      if (u[i + k] !== a[k]) {
        tamam = false;
        break;
      }
    }
    if (tamam) return i + 1;
  }
  return 0;
}

/* ===================================================================
 * 2. vt1 şeması ve verisi (kitabın 8. hafta başlangıç paketi)
 * =================================================================== */

const tablo = (ad, sutunlar, ek) => ({
  ad,
  sutunlar: sutunlar.map(([s, tip, bos]) => ({ ad: s, tip, bos: !!bos })),
  pk: [],
  uq: [],
  ck: [],
  fk: [],
  ...ek,
});

export const SEMA = [
  tablo('bolum', [['bolum_id', 'INT'], ['bolum_kodu', 'CHAR(3)'], ['bolum_adi', 'VARCHAR(50)']], {
    pk: ['bolum_id'],
    uq: [['uq_bolum_kodu', ['bolum_kodu']]],
  }),
  tablo('ders', [['ders_id', 'INT'], ['ders_kodu', 'VARCHAR(10)'], ['ders_adi', 'VARCHAR(80)'], ['akts', 'TINYINT'], ['bolum_id', 'INT']], {
    pk: ['ders_id'],
    uq: [['uq_ders_kodu', ['ders_kodu']]],
    ck: [['ck_ders_akts', 'akts > 0']],
    fk: [['fk_ders_bolum', ['bolum_id'], 'bolum', ['bolum_id']]],
  }),
  tablo('donem', [['donem_id', 'INT'], ['donem_kodu', 'VARCHAR(12)'], ['baslangic', 'DATE'], ['bitis', 'DATE']], {
    pk: ['donem_id'],
    uq: [['uq_donem_kodu', ['donem_kodu']]],
    ck: [['ck_donem_tarih', 'bitis > baslangic']],
  }),
  tablo('kisi', [['kisi_id', 'INT'], ['kisi_no', 'VARCHAR(10)'], ['ad', 'VARCHAR(50)'], ['soyad', 'VARCHAR(50)'], ['eposta', 'VARCHAR(100)', true]], {
    pk: ['kisi_id'],
    uq: [['uq_kisi_no', ['kisi_no']]],
  }),
  tablo('ogrenci', [['ogrenci_id', 'INT'], ['ogrenci_no', 'CHAR(7)'], ['kayit_yili', 'SMALLINT'], ['bolum_id', 'INT']], {
    pk: ['ogrenci_id'],
    uq: [['uq_ogrenci_no', ['ogrenci_no']]],
    fk: [
      ['fk_ogrenci_kisi', ['ogrenci_id'], 'kisi', ['kisi_id']],
      ['fk_ogrenci_bolum', ['bolum_id'], 'bolum', ['bolum_id']],
    ],
  }),
  tablo('ogretim_elemani', [['eleman_id', 'INT'], ['sicil_no', 'VARCHAR(10)'], ['unvan', 'VARCHAR(30)'], ['bolum_id', 'INT']], {
    pk: ['eleman_id'],
    uq: [['uq_sicil_no', ['sicil_no']]],
    fk: [
      ['fk_eleman_kisi', ['eleman_id'], 'kisi', ['kisi_id']],
      ['fk_eleman_bolum', ['bolum_id'], 'bolum', ['bolum_id']],
    ],
  }),
  tablo('ders_acma', [['acma_id', 'INT'], ['ders_id', 'INT'], ['donem_id', 'INT'], ['sube_no', 'TINYINT'], ['kontenjan', 'SMALLINT'], ['eleman_id', 'INT']], {
    pk: ['acma_id'],
    uq: [['uq_ders_acma', ['ders_id', 'donem_id', 'sube_no']]],
    ck: [['ck_acma_kontenjan', 'kontenjan > 0']],
    fk: [
      ['fk_acma_ders', ['ders_id'], 'ders', ['ders_id']],
      ['fk_acma_donem', ['donem_id'], 'donem', ['donem_id']],
      ['fk_acma_eleman', ['eleman_id'], 'ogretim_elemani', ['eleman_id']],
    ],
  }),
  tablo('degerlendirme', [['acma_id', 'INT'], ['sira_no', 'TINYINT'], ['tur', 'VARCHAR(30)'], ['agirlik', 'TINYINT']], {
    pk: ['acma_id', 'sira_no'],
    ck: [['ck_degerlendirme_agirlik', 'agirlik > 0 AND agirlik <= 100']],
    fk: [['fk_degerlendirme_acma', ['acma_id'], 'ders_acma', ['acma_id']]],
  }),
  tablo('kayit', [['ogrenci_id', 'INT'], ['acma_id', 'INT'], ['kayit_tarihi', 'DATE'], ['basari_notu', 'TINYINT', true], ['ucret', 'DECIMAL(8,2)']], {
    pk: ['ogrenci_id', 'acma_id'],
    ck: [
      ['ck_kayit_not', 'basari_notu BETWEEN 0 AND 100'],
      ['ck_kayit_ucret', 'ucret >= 0'],
    ],
    fk: [
      ['fk_kayit_ogrenci', ['ogrenci_id'], 'ogrenci', ['ogrenci_id']],
      ['fk_kayit_acma', ['acma_id'], 'ders_acma', ['acma_id']],
    ],
  }),
  tablo('ders_onkosul', [['ders_id', 'INT'], ['onkosul_ders_id', 'INT']], {
    pk: ['ders_id', 'onkosul_ders_id'],
    ck: [['ck_onkosul_farkli', 'ders_id <> onkosul_ders_id']],
    fk: [
      ['fk_onkosul_ders', ['ders_id'], 'ders', ['ders_id']],
      ['fk_onkosul_onceki', ['onkosul_ders_id'], 'ders', ['ders_id']],
    ],
  }),
];

export const VERI = {
  bolum: [
    [1, 'BIL', 'Bilişim'],
    [2, 'MAT', 'Matematik'],
    [3, 'TAS', 'Tasarım'],
  ],
  ders: [
    [10, 'VT1', 'Veri Tabanı I', 5, 1],
    [11, 'PR1', 'Programlama I', 6, 1],
    [12, 'VT2', 'Veri Tabanı II', 5, 1],
    [20, 'MAT1', 'Matematik I', 4, 2],
    [30, 'TAS1', 'Tasarım I', 3, 3],
  ],
  donem: [
    [1, '2026-GUZ', '2026-09-14', '2027-01-15'],
    [2, '2027-BAHAR', '2027-02-15', '2027-06-18'],
  ],
  kisi: [
    [101, 'K101', 'Öğrenci', '101', 'o101@example.invalid'],
    [102, 'K102', 'Öğrenci', '102', null],
    [103, 'K103', 'Öğrenci', '103', 'o103@example.invalid'],
    [104, 'K104', 'Öğrenci', '104', null],
    [105, 'K105', 'Öğrenci', '105', 'o105@example.invalid'],
    [106, 'K106', 'Öğrenci', '106', null],
    [301, 'K301', 'Öğretim Elemanı', '301', 'k301@example.invalid'],
    [302, 'K302', 'Öğretim Elemanı', '302', 'k302@example.invalid'],
    [303, 'K303', 'Öğretim Elemanı', '303', null],
    [401, 'K401', 'Personel', '401', null],
  ],
  ogrenci: [
    [101, '2026001', 2026, 1],
    [102, '2026002', 2026, 1],
    [103, '2026003', 2026, 1],
    [104, '2026004', 2026, 2],
    [105, '2026005', 2026, 2],
    [106, '2026006', 2026, 3],
    [302, '2025901', 2025, 1],
  ],
  ogretim_elemani: [
    [301, 'S301', 'Doç. Dr.', 1],
    [302, 'S302', 'Arş. Gör.', 1],
    [303, 'S303', 'Dr. Öğr. Üyesi', 2],
  ],
  ders_acma: [
    [1001, 10, 1, 1, 3, 301],
    [1002, 11, 1, 1, 4, 302],
    [1003, 20, 1, 1, 2, 303],
    [1004, 10, 1, 2, 3, 301],
    [2001, 12, 2, 1, 3, 301],
  ],
  degerlendirme: [
    [1001, 1, 'Ara sınav', 40],
    [1001, 2, 'Final', 60],
    [1002, 1, 'Ara sınav', 40],
    [1002, 2, 'Final', 60],
  ],
  kayit: [
    [101, 1001, '2026-09-14', 80, 1000],
    [101, 1002, '2026-09-14', 90, 750],
    [102, 1001, '2026-09-15', 60, 1000],
    [102, 1003, '2026-09-15', null, 500],
    [103, 1002, '2026-09-14', 90, 750],
    [104, 1003, '2026-09-15', 40, 500],
    [105, 1001, '2026-09-16', null, 1000],
    [105, 2001, '2027-02-15', null, 1200],
  ],
  ders_onkosul: [
    [12, 10],
    [12, 11],
  ],
};

const SEMA_HARITA = new Map(SEMA.map((t) => [t.ad, t]));

/** MySQL'in yabancı anahtar için kendiliğinden kurduğu dizinler. */
function fkDizinleri(t) {
  const mevcut = [t.pk, ...t.uq.map((u) => u[1])];
  const sonuc = [];
  for (const [ad, s] of t.fk) {
    if (!mevcut.some((d) => s.every((c, i) => d[i] === c))) {
      sonuc.push([ad, s]);
      mevcut.push(s);
    }
  }
  return sonuc;
}

function sqliteKomutlari(t) {
  const satirlar = t.sutunlar.map(
    (c) => `  ${c.ad} ${c.tip}${c.bos ? '' : ' NOT NULL'}${/CHAR/i.test(c.tip) ? ' COLLATE ' + DUZEN : ''}`,
  );
  satirlar.push(`  CONSTRAINT pk_${t.ad} PRIMARY KEY (${t.pk.join(', ')})`);
  for (const [ad, s] of t.uq) satirlar.push(`  CONSTRAINT ${ad} UNIQUE (${s.join(', ')})`);
  for (const [ad, e] of t.ck) satirlar.push(`  CONSTRAINT ${ad} CHECK (${e})`);
  for (const [ad, s, h, hs] of t.fk) satirlar.push(`  CONSTRAINT ${ad} FOREIGN KEY (${s.join(', ')}) REFERENCES ${h} (${hs.join(', ')})`);
  // WITHOUT ROWID: satırlar InnoDB gibi birincil anahtar sırasıyla durur.
  const komutlar = [`CREATE TABLE ${t.ad} (\n${satirlar.join(',\n')}\n) WITHOUT ROWID`];
  for (const [ad, s] of fkDizinleri(t)) komutlar.push(`CREATE INDEX ${ad} ON ${t.ad} (${s.join(', ')})`);
  return komutlar;
}

function anahtarTuru(t, sutun) {
  if (t.pk.includes(sutun)) return 'PRI';
  if (t.uq.some(([, s]) => s.length === 1 && s[0] === sutun)) return 'UNI';
  const dizinler = [...t.uq.map((u) => u[1]), ...fkDizinleri(t).map((d) => d[1])];
  if (dizinler.some((d) => d[0] === sutun)) return 'MUL';
  return '';
}

/** Şema paneli için bir tablonun DESCRIBE benzeri tanımı (motor yüklenmeden çalışır). */
export function tabloTanimi(ad) {
  const t = SEMA_HARITA.get(ad);
  if (!t) return null;
  return t.sutunlar.map((c) => {
    const fk = t.fk.find(([, s]) => s.length === 1 && s[0] === c.ad);
    const m = /DECIMAL\(\d+,\s*(\d+)\)/i.exec(c.tip);
    return { ad: c.ad, tip: c.tip.toLowerCase(), bos: c.bos, anahtar: anahtarTuru(t, c.ad), hedef: fk ? fk[2] : null, ondalik: m ? +m[1] : null };
  });
}

function mysqlOlusturMetni(t) {
  const q = (s) => '`' + s + '`';
  const ck = (e) => e.replace(/\b[a-z_]+\b/g, (m) => (/^(and|between)$/i.test(m) ? m.toLowerCase() : q(m)));
  const s = t.sutunlar.map((c) => `  ${q(c.ad)} ${c.tip.toLowerCase()} ${c.bos ? 'DEFAULT NULL' : 'NOT NULL'}`);
  s.push(`  PRIMARY KEY (${t.pk.map(q).join(',')})`);
  for (const [ad, k] of t.uq) s.push(`  UNIQUE KEY ${q(ad)} (${k.map(q).join(',')})`);
  for (const [ad, k] of fkDizinleri(t)) s.push(`  KEY ${q(ad)} (${k.map(q).join(',')})`);
  for (const [ad, k, h, hs] of [...t.fk].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    s.push(`  CONSTRAINT ${q(ad)} FOREIGN KEY (${k.map(q).join(',')}) REFERENCES ${q(h)} (${hs.map(q).join(',')})`);
  }
  for (const [ad, e] of t.ck) s.push(`  CONSTRAINT ${q(ad)} CHECK ((${ck(e)}))`);
  return `CREATE TABLE ${q(t.ad)} (\n${s.join(',\n')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_turkish_ci`;
}

/* ===================================================================
 * 3. Sözcükleme (MySQL kuralları)
 * =================================================================== */

const BOSLUKLAR = new Set([' ', '\t', '\n', '\r', '\f', '\v', ' ', '​', '﻿', ' ', ' ']);
const TIPOGRAFIK = new Set(['‘', '’', '“', '”', '′', '″', '«', '»', '‚', '„', '´', '–', '—', '−']);
const rakamMi = (c) => c >= '0' && c <= '9';
const harfMi = (c) =>
  !!c && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '$' || (c >= '\u0080' && !BOSLUKLAR.has(c) && !TIPOGRAFIK.has(c)));
const COK_OP = ['<=>', '->>', '<>', '!=', '<=', '>=', '||', '&&', ':=', '<<', '>>', '->'];
const KACIS = { 0: '\0', "'": "'", '"': '"', b: '\b', n: '\n', r: '\r', t: '\t', Z: '\x1a', '\\': '\\', '%': '\\%', _: '\\_' };

export function sozcukle(src) {
  const t = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    const s = i;
    if (BOSLUKLAR.has(c)) {
      while (i < n && BOSLUKLAR.has(src[i])) i++;
      t.push({ tur: 'bosluk', s, e: i });
      continue;
    }
    if (c === '#' || (c === '-' && src[i + 1] === '-' && (i + 2 >= n || BOSLUKLAR.has(src[i + 2]) || src.charCodeAt(i + 2) < 32))) {
      while (i < n && src[i] !== '\n') i++;
      t.push({ tur: 'yorum', s, e: i });
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const k = src.indexOf('*/', i + 2);
      if (k < 0) {
        t.push({ tur: 'hata', neden: 'yorum', s, e: n });
        i = n;
        continue;
      }
      i = k + 2;
      t.push({ tur: 'yorum', s, e: i });
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      let v = '';
      let kapandi = false;
      while (j < n) {
        const d = src[j];
        if (d === '\\' && j + 1 < n) {
          const x = src[j + 1];
          v += KACIS[x] !== undefined ? KACIS[x] : x;
          j += 2;
          continue;
        }
        if (d === c) {
          if (src[j + 1] === c) {
            v += c;
            j += 2;
            continue;
          }
          kapandi = true;
          j++;
          break;
        }
        v += d;
        j++;
      }
      if (!kapandi) {
        t.push({ tur: 'hata', neden: 'tirnak', s, e: n });
        i = n;
        continue;
      }
      t.push({ tur: 'metin', s, e: j, deger: v, tirnak: c });
      i = j;
      continue;
    }
    if (c === '`') {
      let j = i + 1;
      let v = '';
      let kapandi = false;
      while (j < n) {
        if (src[j] === '`') {
          if (src[j + 1] === '`') {
            v += '`';
            j += 2;
            continue;
          }
          kapandi = true;
          j++;
          break;
        }
        v += src[j];
        j++;
      }
      if (!kapandi) {
        t.push({ tur: 'hata', neden: 'ters', s, e: n });
        i = n;
        continue;
      }
      t.push({ tur: 'kelime', s, e: j, deger: v, tirnakli: true, ust: null });
      i = j;
      continue;
    }
    if (TIPOGRAFIK.has(c)) {
      i++;
      t.push({ tur: 'akilli', s, e: i });
      continue;
    }
    if (rakamMi(c) || (c === '.' && rakamMi(src[i + 1]))) {
      let j = i;
      let alt = 'tam';
      if (c === '0' && (src[i + 1] === 'x' || src[i + 1] === 'X') && /[0-9a-fA-F]/.test(src[i + 2] || '')) {
        j = i + 2;
        while (j < n && /[0-9a-fA-F]/.test(src[j])) j++;
        alt = 'hex';
      } else {
        while (j < n && rakamMi(src[j])) j++;
        if (src[j] === '.') {
          alt = 'ondalik';
          j++;
          while (j < n && rakamMi(src[j])) j++;
        }
        if ((src[j] === 'e' || src[j] === 'E') && (rakamMi(src[j + 1]) || ((src[j + 1] === '+' || src[j + 1] === '-') && rakamMi(src[j + 2])))) {
          alt = 'kayan';
          j += 2;
          while (j < n && rakamMi(src[j])) j++;
        }
      }
      if (alt === 'tam' && harfMi(src[j])) {
        while (j < n && (harfMi(src[j]) || rakamMi(src[j]))) j++;
        const ham = src.slice(s, j);
        t.push({ tur: 'kelime', s, e: j, deger: ham, tirnakli: false, ust: ham.toUpperCase() });
        i = j;
        continue;
      }
      t.push({ tur: 'sayi', s, e: j, alt });
      i = j;
      continue;
    }
    if (c === '@') {
      let j = i + 1;
      if (src[j] === '@') j++;
      while (j < n && (harfMi(src[j]) || rakamMi(src[j]) || src[j] === '.')) j++;
      t.push({ tur: 'degisken', s, e: j });
      i = j;
      continue;
    }
    if (harfMi(c)) {
      let j = i + 1;
      while (j < n && (harfMi(src[j]) || rakamMi(src[j]))) j++;
      const ham = src.slice(s, j);
      t.push({ tur: 'kelime', s, e: j, deger: ham, tirnakli: false, ust: ham.toUpperCase() });
      i = j;
      continue;
    }
    const op = COK_OP.find((o) => src.startsWith(o, i)) || c;
    i += op.length;
    t.push({ tur: 'op', s, e: i, deger: op });
  }
  for (const x of t) x.ham = src.slice(x.s, x.e);
  return t;
}

/** Noktalı virgülle ayrılmış komutlar; her biri boşluksuz sözcük dizisi. */
function komutlaraBol(sozcukler) {
  const parcalar = [];
  let simdiki = [];
  for (const tk of sozcukler) {
    if (tk.tur === 'op' && tk.deger === ';') {
      parcalar.push(simdiki);
      simdiki = [];
      continue;
    }
    if (tk.tur !== 'bosluk' && tk.tur !== 'yorum') simdiki.push(tk);
  }
  parcalar.push(simdiki);
  return parcalar.filter((p) => p.length);
}

/* ===================================================================
 * 4. Çözümleme (SELECT ağırlıklı, MySQL öncelik sırası)
 * =================================================================== */

class CozumHatasi extends Error {
  constructor(i, mesaj, kesin) {
    super(mesaj || 'sozdizimi');
    this.i = i;
    this.kesin = !!kesin;
  }
}

const TAKMA_OLAMAZ = new Set(
  ('FROM WHERE GROUP HAVING ORDER LIMIT UNION INTERSECT EXCEPT INTO WINDOW FOR LOCK ON USING JOIN INNER LEFT RIGHT CROSS NATURAL STRAIGHT_JOIN OFFSET ' +
    'AND OR XOR NOT IS IN BETWEEN LIKE REGEXP RLIKE ESCAPE CASE WHEN THEN ELSE END COLLATE ASC DESC DIV MOD AS SET VALUES SELECT DISTINCT ALL ' +
    'NULL TRUE FALSE EXISTS INTERVAL BINARY SOUNDS MEMBER PARTITION OVER WITH KEY BY TABLE RANK ROW ROWS INDEX CHECK DEFAULT DISTINCTROW ' +
    'INSERT UPDATE DELETE CREATE DROP ALTER USE SHOW DESCRIBE EXPLAIN PRIMARY UNIQUE FOREIGN REFERENCES CONSTRAINT').split(' '),
);
const PARANTEZSIZ = {
  CURRENT_DATE: 'curdate',
  CURRENT_TIME: 'curtime',
  CURRENT_TIMESTAMP: 'now',
  LOCALTIME: 'now',
  LOCALTIMESTAMP: 'now',
  CURRENT_USER: 'current_user',
  UTC_DATE: 'utc_date',
};

class Cozumleyici {
  constructor(ft) {
    this.t = ft;
    this.i = 0;
  }

  bak(k = 0) {
    return this.t[this.i + k];
  }

  al() {
    return this.t[this.i++];
  }

  hata(mesaj, kesin) {
    return new CozumHatasi(Math.min(this.i, this.t.length), mesaj, kesin);
  }

  kel(tk, ...ks) {
    return !!tk && tk.tur === 'kelime' && !tk.tirnakli && ks.includes(tk.ust);
  }

  isKel(...ks) {
    return this.kel(this.bak(), ...ks);
  }

  isOp(...os) {
    const tk = this.bak();
    return !!tk && tk.tur === 'op' && os.includes(tk.deger);
  }

  bekleKel(k) {
    if (!this.isKel(k)) throw this.hata(k + ' bekleniyordu');
    return this.al();
  }

  bekleOp(o) {
    if (!this.isOp(o)) throw this.hata("'" + o + "' bekleniyordu");
    return this.al();
  }

  dugum(tur, bas, ek) {
    return Object.assign({ tur, bas, son: this.i }, ek);
  }

  /* ---- sorgu ---- */

  sorgu() {
    const bas = this.i;
    let cte = null;
    if (this.isKel('WITH')) {
      this.al();
      if (this.isKel('RECURSIVE')) this.al();
      cte = [];
      do {
        const adTok = this.al();
        if (!adTok || adTok.tur !== 'kelime') throw this.hata('CTE adı', true);
        let sutunlar = null;
        if (this.isOp('(')) {
          this.al();
          sutunlar = [];
          do sutunlar.push(this.al().deger);
          while (this.isOp(',') && this.al());
          this.bekleOp(')');
        }
        this.bekleKel('AS');
        this.bekleOp('(');
        const q = this.sorgu();
        this.bekleOp(')');
        cte.push({ ad: adTok.deger, sutunlar, q });
      } while (this.isOp(',') && this.al());
    }
    const cekirdekler = [this.cekirdek()];
    const baglar = [];
    while (this.isKel('UNION', 'INTERSECT', 'EXCEPT')) {
      const op = this.al().ust;
      let tum = false;
      if (this.isKel('ALL')) {
        this.al();
        tum = true;
      } else if (this.isKel('DISTINCT')) this.al();
      baglar.push({ op, tum });
      cekirdekler.push(this.cekirdek());
    }
    let sirala = null;
    let sinir = null;
    if (this.isKel('ORDER')) sirala = this.siralama();
    if (this.isKel('LIMIT')) sinir = this.sinir();
    return this.dugum('sorgu', bas, { cte, cekirdekler, baglar, sirala, sinir });
  }

  cekirdek() {
    const bas = this.i;
    if (this.isOp('(')) {
      this.al();
      const q = this.sorgu();
      this.bekleOp(')');
      return this.dugum('parantezSorgu', bas, { alt: q });
    }
    this.bekleKel('SELECT');
    let tekil = false;
    if (this.isKel('DISTINCT', 'DISTINCTROW')) {
      this.al();
      tekil = true;
    } else if (this.isKel('ALL')) this.al();
    const ogeler = [this.secOge(true)];
    while (this.isOp(',')) {
      this.al();
      ogeler.push(this.secOge(false));
    }
    let kaynak = null;
    let fromIdx = null;
    let nerede = null;
    let grup = null;
    let sahip = null;
    if (this.isKel('INTO')) throw this.hata('INTO', true);
    if (this.isKel('FROM')) {
      fromIdx = this.i;
      this.al();
      kaynak = this.kaynaklar();
    }
    if (this.isKel('WHERE')) {
      this.al();
      nerede = this.ifade(0);
    }
    if (this.isKel('GROUP')) {
      this.al();
      this.bekleKel('BY');
      grup = [];
      do {
        const e = this.ifade(0);
        if (this.isKel('ASC', 'DESC')) throw this.hata('GROUP BY ASC/DESC', true);
        grup.push({ e });
      } while (this.isOp(',') && this.al());
      if (this.isKel('WITH')) throw this.hata('WITH ROLLUP desteklenmiyor');
    }
    if (this.isKel('HAVING')) {
      this.al();
      sahip = this.ifade(0);
    }
    if (this.isKel('WINDOW')) throw this.hata('WINDOW desteklenmiyor');
    return this.dugum('cekirdek', bas, { tekil, ogeler, kaynak, fromIdx, nerede, grup, sahip });
  }

  secOge(ilk) {
    const bas = this.i;
    if (this.isOp('*')) {
      if (!ilk) throw this.hata('* yalnız ilk sırada', true);
      this.al();
      return { tur: 'oge', yildiz: true, e: { tur: 'yildiz', bas, son: this.i, tablo: null }, bas, son: this.i, ifadeSon: this.i, takma: null };
    }
    const e = this.ifade(0);
    const ifadeSon = this.i;
    let takma = null;
    let ortuk = false;
    if (this.isKel('AS')) {
      this.al();
      const tk = this.bak();
      if (!tk || !(tk.tur === 'metin' || (tk.tur === 'kelime' && (tk.tirnakli || !TAKMA_OLAMAZ.has(tk.ust))))) throw this.hata('takma ad', true);
      this.al();
      takma = tk.deger;
    } else {
      const tk = this.bak();
      if (tk && (tk.tur === 'metin' || (tk.tur === 'kelime' && (tk.tirnakli || !TAKMA_OLAMAZ.has(tk.ust))))) {
        this.al();
        takma = tk.deger;
        ortuk = true;
      }
    }
    return { tur: 'oge', yildiz: e.tur === 'yildiz', e, takma, ortuk, bas, son: this.i, ifadeSon };
  }

  kaynaklar() {
    const liste = [this.tabloRef()];
    for (;;) {
      if (this.isOp(',')) {
        this.al();
        liste.push(this.tabloRef());
        continue;
      }
      if (this.isKel('JOIN', 'INNER', 'CROSS', 'LEFT', 'RIGHT', 'NATURAL', 'STRAIGHT_JOIN')) {
        const bas = this.i;
        let tur = 'INNER';
        if (this.isKel('NATURAL')) {
          this.al();
          tur = 'NATURAL';
        }
        if (this.isKel('LEFT', 'RIGHT')) {
          tur = this.al().ust;
          if (this.isKel('OUTER')) this.al();
        } else if (this.isKel('INNER', 'CROSS')) this.al();
        if (this.isKel('STRAIGHT_JOIN')) this.al();
        else this.bekleKel('JOIN');
        const sag = this.tabloRef();
        let kosul = null;
        if (this.isKel('ON')) {
          this.al();
          kosul = this.ifade(0);
        } else if (this.isKel('USING')) {
          this.al();
          this.bekleOp('(');
          do this.al();
          while (this.isOp(',') && this.al());
          this.bekleOp(')');
        }
        liste.push(this.dugum('join', bas, { tur, sag, kosul }));
        continue;
      }
      break;
    }
    return liste;
  }

  tabloRef() {
    const bas = this.i;
    if (this.isOp('(')) {
      this.al();
      if (this.isKel('SELECT', 'WITH')) {
        const q = this.sorgu();
        this.bekleOp(')');
        const takma = this.tabloTakma();
        if (!takma) {
          const h = this.hata('türetilmiş tablo', true);
          h.kod = 1248;
          throw h;
        }
        return this.dugum('turetilmis', bas, { alt: q, takma });
      }
      const ic = this.kaynaklar();
      this.bekleOp(')');
      return this.dugum('grup', bas, { ic });
    }
    const tk = this.al();
    if (!tk || tk.tur !== 'kelime' || (!tk.tirnakli && TAKMA_OLAMAZ.has(tk.ust))) {
      this.i--;
      throw this.hata('tablo adı bekleniyordu', true);
    }
    let ad = tk.deger;
    let db = null;
    if (this.isOp('.')) {
      this.al();
      const t2 = this.al();
      if (!t2 || t2.tur !== 'kelime') throw this.hata('tablo adı', true);
      db = ad;
      ad = t2.deger;
    }
    const takma = this.tabloTakma();
    return this.dugum('tablo', bas, { ad, db, takma });
  }

  tabloTakma() {
    if (this.isKel('AS')) {
      this.al();
      const tk = this.al();
      if (!tk || tk.tur !== 'kelime') throw this.hata('takma ad', true);
      return tk.deger;
    }
    const tk = this.bak();
    if (tk && tk.tur === 'kelime' && (tk.tirnakli || !TAKMA_OLAMAZ.has(tk.ust))) {
      this.al();
      return tk.deger;
    }
    return null;
  }

  siralama() {
    this.bekleKel('ORDER');
    this.bekleKel('BY');
    const terimler = [];
    do {
      const bas = this.i;
      const e = this.ifade(0);
      const eSon = this.i;
      let yon = null;
      if (this.isKel('ASC', 'DESC')) yon = this.al().ust;
      terimler.push({ e, yon, bas, eSon, son: this.i });
    } while (this.isOp(',') && this.al());
    return terimler;
  }

  sinir() {
    this.bekleKel('LIMIT');
    const a = this.ifade(0);
    let b = null;
    if (this.isOp(',')) {
      this.al();
      b = this.ifade(0);
    } else if (this.isKel('OFFSET')) {
      this.al();
      b = this.ifade(0);
    }
    for (const x of [a, b]) {
      if (x && x.tur !== 'sayi') throw this.hata('LIMIT sabit ister', true);
    }
    return { a, b };
  }

  /* ---- ifadeler ---- */

  araEk() {
    const tk = this.bak();
    if (!tk) return null;
    if (tk.tur === 'op') {
      switch (tk.deger) {
        case '||':
          return { onc: 1, sinif: 'mantik', op: '||' };
        case '&&':
          return { onc: 3, sinif: 'mantik', op: '&&' };
        case '=':
        case '<=>':
        case '<>':
        case '!=':
        case '<':
        case '<=':
        case '>':
        case '>=':
          return { onc: 5, sinif: 'karsilastir', op: tk.deger };
        case '|':
          return { onc: 6, sinif: 'aritmetik', op: '|' };
        case '&':
          return { onc: 7, sinif: 'aritmetik', op: '&' };
        case '<<':
        case '>>':
          return { onc: 8, sinif: 'aritmetik', op: tk.deger };
        case '+':
        case '-':
          return { onc: 9, sinif: 'aritmetik', op: tk.deger };
        case '*':
        case '/':
        case '%':
          return { onc: 10, sinif: 'aritmetik', op: tk.deger };
        case '^':
          return { onc: 11, sinif: 'aritmetik', op: '^' };
        default:
          return null;
      }
    }
    if (tk.tur === 'kelime' && !tk.tirnakli) {
      switch (tk.ust) {
        case 'OR':
          return { onc: 1, sinif: 'mantik', op: 'OR' };
        case 'XOR':
          return { onc: 2, sinif: 'mantik', op: 'XOR' };
        case 'AND':
          return { onc: 3, sinif: 'mantik', op: 'AND' };
        case 'IS':
        case 'LIKE':
        case 'REGEXP':
        case 'RLIKE':
        case 'IN':
        case 'BETWEEN':
          return { onc: 5, sinif: tk.ust };
        case 'NOT': {
          const s = this.bak(1);
          if (this.kel(s, 'LIKE', 'REGEXP', 'RLIKE', 'IN', 'BETWEEN')) return { onc: 5, sinif: s.ust, degil: true };
          return null;
        }
        case 'DIV':
        case 'MOD':
          return { onc: 10, sinif: 'aritmetik', op: tk.ust };
        case 'COLLATE':
          return { onc: 14, sinif: 'COLLATE' };
        default:
          return null;
      }
    }
    return null;
  }

  ifade(minOnc) {
    const bas = this.i;
    let sol = this.onEk();
    for (;;) {
      const ek = this.araEk();
      if (!ek || ek.onc < minOnc) break;
      sol = this.ekIsle(sol, ek, bas);
    }
    return sol;
  }

  ekIsle(sol, ek, bas) {
    const opIdx = this.i;
    if (ek.sinif === 'mantik' || ek.sinif === 'aritmetik' || ek.sinif === 'karsilastir') {
      this.al();
      if (ek.sinif === 'karsilastir' && this.isKel('ANY', 'ALL', 'SOME')) throw this.hata('ANY/ALL desteklenmiyor');
      const sag = this.ifade(ek.onc + 1);
      return this.dugum('ikili', bas, { op: ek.op, a: sol, b: sag, opIdx, sinif: ek.sinif });
    }
    if (ek.sinif === 'COLLATE') {
      this.al();
      const ad = this.al();
      if (!ad || (ad.tur !== 'kelime' && ad.tur !== 'metin')) throw this.hata('COLLATE adı', true);
      return this.dugum('collate', bas, { a: sol, ad: String(ad.deger).toLowerCase(), adIdx: this.i - 1 });
    }
    let degil = false;
    if (ek.degil) {
      this.al();
      degil = true;
    }
    this.al();
    switch (ek.sinif) {
      case 'IS': {
        let isDegil = false;
        if (this.isKel('NOT')) {
          this.al();
          isDegil = true;
        }
        const tk = this.bak();
        if (!this.kel(tk, 'NULL', 'TRUE', 'FALSE', 'UNKNOWN')) throw this.hata('IS sonrası', true);
        this.al();
        return this.dugum('is', bas, { a: sol, degil: isDegil, deger: tk.ust, degerIdx: this.i - 1 });
      }
      case 'LIKE':
      case 'REGEXP':
      case 'RLIKE': {
        const sag = this.ifade(6);
        let kacis = null;
        if (ek.sinif === 'LIKE' && this.isKel('ESCAPE')) {
          this.al();
          kacis = this.ifade(6);
        }
        return this.dugum('benzer', bas, { op: ek.sinif === 'RLIKE' ? 'REGEXP' : ek.sinif, a: sol, b: sag, kacis, degil });
      }
      case 'IN': {
        this.bekleOp('(');
        if (this.isKel('SELECT', 'WITH')) {
          const q = this.sorgu();
          this.bekleOp(')');
          return this.dugum('icinde', bas, { a: sol, alt: q, degil });
        }
        const liste = [this.ifade(0)];
        while (this.isOp(',')) {
          this.al();
          liste.push(this.ifade(0));
        }
        this.bekleOp(')');
        return this.dugum('icinde', bas, { a: sol, liste, degil });
      }
      case 'BETWEEN': {
        const alt = this.ifade(6);
        this.bekleKel('AND');
        const ust = this.ifade(6);
        return this.dugum('arasinda', bas, { a: sol, alt, ust, degil });
      }
      default:
        throw this.hata(ek.sinif + ' desteklenmiyor');
    }
  }

  onEk() {
    const tk = this.bak();
    if (!tk) throw this.hata('ifade bekleniyordu', true);
    const bas = this.i;
    if (this.kel(tk, 'NOT')) {
      this.al();
      const a = this.ifade(4);
      return this.dugum('tekli', bas, { op: 'NOT', a });
    }
    if (tk.tur === 'op' && tk.deger === '!') {
      this.al();
      const a = this.ifade(13);
      return this.dugum('tekli', bas, { op: '!', a });
    }
    if (tk.tur === 'op' && (tk.deger === '-' || tk.deger === '+' || tk.deger === '~')) {
      this.al();
      const a = this.ifade(12);
      return this.dugum('tekli', bas, { op: tk.deger, a });
    }
    if (this.kel(tk, 'BINARY') && !(this.bak(1) && this.bak(1).tur === 'op' && this.bak(1).deger === '(')) {
      this.al();
      const a = this.ifade(14);
      return this.dugum('tekli', bas, { op: 'BINARY', a });
    }
    if (this.kel(tk, 'EXISTS')) {
      this.al();
      this.bekleOp('(');
      const q = this.sorgu();
      this.bekleOp(')');
      return this.dugum('var', bas, { alt: q });
    }
    if (this.kel(tk, 'INTERVAL')) {
      this.al();
      const a = this.ifade(9);
      const birim = this.al();
      if (!birim || birim.tur !== 'kelime') throw this.hata('INTERVAL birimi', true);
      return this.dugum('aralik', bas, { a, birim: birim.ust, birimIdx: this.i - 1 });
    }
    return this.birincil();
  }

  birincil() {
    const bas = this.i;
    const tk = this.al();
    if (!tk) throw this.hata('ifade bekleniyordu', true);
    switch (tk.tur) {
      case 'sayi':
        return this.dugum('sayi', bas, { alt: tk.alt, ham: tk.ham });
      case 'metin': {
        let deger = tk.deger;
        const ekler = [];
        while (this.bak() && this.bak().tur === 'metin') {
          ekler.push(this.i);
          deger += this.al().deger;
        }
        return this.dugum('metin', bas, { deger, ekler, metinIdx: bas });
      }
      case 'degisken':
        return this.dugum('degisken', bas, {});
      case 'op':
        if (tk.deger === '(') {
          if (this.isKel('SELECT', 'WITH')) {
            const q = this.sorgu();
            this.bekleOp(')');
            return this.dugum('altsorgu', bas, { alt: q });
          }
          const liste = [this.ifade(0)];
          while (this.isOp(',')) {
            this.al();
            liste.push(this.ifade(0));
          }
          this.bekleOp(')');
          return liste.length === 1 ? this.dugum('parantez', bas, { a: liste[0] }) : this.dugum('satir', bas, { liste });
        }
        if (tk.deger === '*') return this.dugum('yildiz', bas, { tablo: null });
        this.i--;
        throw this.hata('beklenmedik ' + tk.deger, true);
      case 'kelime': {
        if (!tk.tirnakli) {
          const u = tk.ust;
          if (u === 'NULL' || u === 'TRUE' || u === 'FALSE') return this.dugum('sabit', bas, { deger: u });
          if (u === 'CASE') return this.durum(bas);
          if ((u === 'DATE' || u === 'TIME' || u === 'TIMESTAMP') && this.bak() && this.bak().tur === 'metin') {
            const m = this.al();
            return this.dugum('metin', bas, { deger: m.deger, ekler: [], metinIdx: bas + 1, tarihAnahtar: u, anahtarIdx: bas });
          }
          if (PARANTEZSIZ[u] && !this.isOp('(')) return this.dugum('fonk', bas, { ad: u.toLowerCase(), adHam: tk.ham, args: [], parantezsiz: true, adIdx: bas });
          if (this.isOp('(')) return this.fonksiyon(tk, bas);
          if (TAKMA_OLAMAZ.has(u)) {
            this.i--;
            throw this.hata('beklenmedik ' + tk.ham, true);
          }
        } else if (this.isOp('(')) return this.fonksiyon(tk, bas);
        const parcalar = [tk.deger];
        while (this.isOp('.')) {
          this.al();
          const s = this.bak();
          if (s && s.tur === 'op' && s.deger === '*') {
            this.al();
            return this.dugum('yildiz', bas, { tablo: parcalar[parcalar.length - 1] });
          }
          if (!s || s.tur !== 'kelime') throw this.hata('ad bekleniyordu', true);
          this.al();
          parcalar.push(s.deger);
        }
        return this.dugum('sutun', bas, {
          ad: parcalar[parcalar.length - 1],
          tablo: parcalar.length >= 2 ? parcalar[parcalar.length - 2] : null,
          db: parcalar.length === 3 ? parcalar[0] : null,
        });
      }
      default:
        this.i--;
        throw this.hata('beklenmedik', true);
    }
  }

  durum(bas) {
    let deger = null;
    if (!this.isKel('WHEN')) deger = this.ifade(0);
    const dallar = [];
    while (this.isKel('WHEN')) {
      this.al();
      const kosul = this.ifade(0);
      this.bekleKel('THEN');
      const sonuc = this.ifade(0);
      dallar.push({ kosul, sonuc });
    }
    if (!dallar.length) throw this.hata('WHEN bekleniyordu', true);
    let degilse = null;
    if (this.isKel('ELSE')) {
      this.al();
      degilse = this.ifade(0);
    }
    this.bekleKel('END');
    return this.dugum('case', bas, { deger, dallar, degilse });
  }

  fonksiyon(adTok, bas) {
    const ad = String(adTok.deger).toLowerCase();
    this.bekleOp('(');
    const d = { ad, adHam: adTok.ham, args: [], adIdx: bas, tekil: false, ozel: null };
    switch (ad) {
      case 'cast':
      case 'convert': {
        d.args.push(this.ifade(0));
        if (ad === 'convert' && this.isKel('USING')) {
          const ub = this.i;
          this.al();
          this.al();
          d.ozel = { tur: 'using', bas: ub, son: this.i };
          this.bekleOp(')');
          return this.dugum('fonk', bas, d);
        }
        if (ad === 'cast') this.bekleKel('AS');
        else this.bekleOp(',');
        const tipBas = this.i;
        const tipTok = this.al();
        if (!tipTok || tipTok.tur !== 'kelime') throw this.hata('tür bekleniyordu', true);
        const tip = tipTok.ust;
        let p = null;
        let s = null;
        if ((tip === 'SIGNED' || tip === 'UNSIGNED') && this.isKel('INT', 'INTEGER')) this.al();
        if (this.isOp('(')) {
          this.al();
          p = parseInt(this.al().ham, 10);
          if (this.isOp(',')) {
            this.al();
            s = parseInt(this.al().ham, 10);
          }
          this.bekleOp(')');
        }
        d.ozel = { tur: 'tip', tip, p, s, tipBas, tipSon: this.i };
        this.bekleOp(')');
        return this.dugum('fonk', bas, d);
      }
      case 'extract': {
        const b = this.al();
        if (!b || b.tur !== 'kelime') throw this.hata('birim', true);
        d.ozel = { tur: 'extract', birim: b.ust, birimIdx: this.i - 1 };
        d.ozel.fromIdx = this.i;
        this.bekleKel('FROM');
        d.args.push(this.ifade(0));
        this.bekleOp(')');
        return this.dugum('fonk', bas, d);
      }
      case 'timestampdiff':
      case 'timestampadd': {
        const b = this.al();
        if (!b || b.tur !== 'kelime') throw this.hata('birim', true);
        d.ozel = { tur: 'birim', birim: b.ust, birimIdx: this.i - 1 };
        this.bekleOp(',');
        d.args.push(this.ifade(0));
        this.bekleOp(',');
        d.args.push(this.ifade(0));
        this.bekleOp(')');
        return this.dugum('fonk', bas, d);
      }
      case 'trim': {
        let yon = null;
        let yonIdx = null;
        if (this.isKel('BOTH', 'LEADING', 'TRAILING')) {
          yonIdx = this.i;
          yon = this.al().ust;
        }
        if (this.isKel('FROM')) {
          const fromIdx = this.i;
          this.al();
          d.args.push(this.ifade(0));
          d.ozel = { tur: 'trim', yon, yonIdx, fromIdx, kalip: null };
        } else {
          const ilk = this.ifade(0);
          if (this.isKel('FROM')) {
            const fromIdx = this.i;
            this.al();
            d.args.push(this.ifade(0));
            d.ozel = { tur: 'trim', yon, yonIdx, fromIdx, kalip: ilk };
          } else {
            if (yon) throw this.hata('TRIM', true);
            d.args.push(ilk);
          }
        }
        this.bekleOp(')');
        return this.dugum('fonk', bas, d);
      }
      case 'position': {
        d.args.push(this.ifade(6));
        const inIdx = this.i;
        this.bekleKel('IN');
        d.args.push(this.ifade(0));
        d.ozel = { tur: 'position', inIdx };
        this.bekleOp(')');
        return this.dugum('fonk', bas, d);
      }
      case 'substring':
      case 'substr': {
        d.args.push(this.ifade(0));
        if (this.isKel('FROM')) {
          const fromIdx = this.i;
          this.al();
          d.args.push(this.ifade(0));
          let forIdx = null;
          if (this.isKel('FOR')) {
            forIdx = this.i;
            this.al();
            d.args.push(this.ifade(0));
          }
          d.ozel = { tur: 'substrFrom', fromIdx, forIdx };
          this.bekleOp(')');
          return this.dugum('fonk', bas, d);
        }
        while (this.isOp(',')) {
          this.al();
          d.args.push(this.ifade(0));
        }
        this.bekleOp(')');
        return this.dugum('fonk', bas, d);
      }
      case 'group_concat': {
        if (this.isKel('DISTINCT')) {
          this.al();
          d.tekil = true;
        }
        d.args.push(this.ifade(0));
        while (this.isOp(',')) {
          this.al();
          d.args.push(this.ifade(0));
        }
        if (this.isKel('ORDER')) d.sirala = this.siralama();
        if (this.isKel('SEPARATOR')) {
          const sepIdx = this.i;
          this.al();
          const sep = this.al();
          if (!sep || sep.tur !== 'metin') throw this.hata('SEPARATOR', true);
          d.ozel = { tur: 'ayrac', sepIdx, deger: sep.deger };
        }
        this.bekleOp(')');
        return this.pencere(this.dugum('fonk', bas, d));
      }
      default:
        break;
    }
    if (this.isOp(')')) {
      this.al();
      return this.pencere(this.dugum('fonk', bas, d));
    }
    if (this.isKel('DISTINCT')) {
      this.al();
      d.tekil = true;
    } else if (this.isKel('ALL')) this.al();
    if (this.isOp('*')) {
      const yb = this.i;
      this.al();
      d.args.push({ tur: 'yildiz', bas: yb, son: this.i, tablo: null });
    } else {
      d.args.push(this.ifade(0));
      while (this.isOp(',')) {
        this.al();
        d.args.push(this.ifade(0));
      }
    }
    this.bekleOp(')');
    return this.pencere(this.dugum('fonk', bas, d));
  }

  pencere(d) {
    if (this.isKel('OVER')) {
      this.al();
      if (this.isOp('(')) {
        let derinlik = 0;
        do {
          const tk = this.al();
          if (!tk) throw this.hata('OVER');
          if (tk.tur === 'op' && tk.deger === '(') derinlik++;
          else if (tk.tur === 'op' && tk.deger === ')') derinlik--;
        } while (derinlik > 0);
      } else this.al();
      d.pencere = true;
      d.son = this.i;
    }
    return d;
  }
}

/* ===================================================================
 * 5. Türler ve kesin ondalık
 * =================================================================== */

const TIP = {
  int: { t: 'int' },
  text: { t: 'text' },
  date: { t: 'date' },
  datetime: { t: 'datetime' },
  float: { t: 'float' },
  nul: { t: 'null' },
  any: { t: 'any' },
  dec: (s) => ({ t: 'dec', s: Math.max(0, Math.min(30, s)) }),
};
const SAYISAL = new Set(['int', 'dec', 'float']);

function tipBirlestir(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.t === 'null') return b;
  if (b.t === 'null') return a;
  if (a.t === 'any' || b.t === 'any') return TIP.any;
  if (SAYISAL.has(a.t) && SAYISAL.has(b.t)) {
    if (a.t === 'float' || b.t === 'float') return TIP.float;
    if (a.t === 'dec' || b.t === 'dec') return TIP.dec(Math.max(a.s || 0, b.s || 0));
    return TIP.int;
  }
  if (a.t === b.t) return a;
  if ((a.t === 'date' || a.t === 'datetime') && (b.t === 'date' || b.t === 'datetime')) return TIP.datetime;
  return TIP.text;
}

function mysqlTip(tipMetni) {
  const u = tipMetni.toUpperCase();
  if (/INT/.test(u)) return TIP.int;
  const m = /DECIMAL\((\d+),\s*(\d+)\)/.exec(u);
  if (m) return TIP.dec(+m[2]);
  if (/CHAR|TEXT/.test(u)) return TIP.text;
  if (u === 'DATE') return TIP.date;
  if (u === 'DATETIME' || u === 'TIMESTAMP') return TIP.datetime;
  if (/FLOAT|DOUBLE|REAL/.test(u)) return TIP.float;
  return TIP.any;
}

function aritTip(op, ta, tb) {
  if (ta.t === 'any' || tb.t === 'any') return TIP.any;
  if (ta.t === 'null' || tb.t === 'null') return TIP.nul;
  if (op === '|' || op === '&' || op === '<<' || op === '>>' || op === '^' || op === 'DIV') return TIP.int;
  const sayi = (x) => (SAYISAL.has(x.t) ? x : TIP.float);
  ta = sayi(ta);
  tb = sayi(tb);
  if (ta.t === 'float' || tb.t === 'float') return TIP.float;
  const sa = ta.t === 'dec' ? ta.s : 0;
  const sb = tb.t === 'dec' ? tb.s : 0;
  const ikisiTam = ta.t === 'int' && tb.t === 'int';
  switch (op) {
    case '+':
    case '-':
      return ikisiTam ? TIP.int : TIP.dec(Math.max(sa, sb));
    case '*':
      return ikisiTam ? TIP.int : TIP.dec(sa + sb);
    case '/':
      return TIP.dec(sa + 4);
    case '%':
    case 'MOD':
      return ikisiTam ? TIP.int : TIP.dec(Math.max(sa, sb));
    default:
      return TIP.any;
  }
}

const FONK_TIP = {};
for (const a of 'concat concat_ws upper lower ucase lcase left right lpad rpad repeat reverse space substring substr mid trim ltrim rtrim replace format date_format monthname dayname hex char version database schema user current_user session_user system_user group_concat substring_index elt curtime current_time time'.split(' ')) FONK_TIP[a] = TIP.text;
for (const a of 'char_length character_length length octet_length bit_length locate instr position strcmp ascii ord year month day dayofmonth dayofweek dayofyear weekday quarter week weekofyear hour minute second datediff timestampdiff count sign field extract row_number rank dense_rank ntile'.split(' ')) FONK_TIP[a] = TIP.int;
for (const a of 'curdate current_date date last_day utc_date adddate subdate date_add date_sub'.split(' ')) FONK_TIP[a] = TIP.date;
for (const a of 'now current_timestamp sysdate localtime localtimestamp timestampadd'.split(' ')) FONK_TIP[a] = TIP.datetime;
for (const a of 'rand sqrt exp ln log log10 log2 pow power sin cos tan cot asin acos atan atan2 degrees radians percent_rank cume_dist'.split(' ')) FONK_TIP[a] = TIP.float;
FONK_TIP.pi = TIP.dec(6);

const ON = (n) => 10n ** BigInt(n);
function kesinOku(ham) {
  const [tam, kesir = ''] = ham.split('.');
  return { b: BigInt((tam || '0') + kesir), s: kesir.length };
}
function kesinHizala(x, y) {
  const s = Math.max(x.s, y.s);
  return [x.b * ON(s - x.s), y.b * ON(s - y.s), s];
}
function kesinBol(x, y) {
  if (y.b === 0n) return null;
  const S = x.s + 4;
  const pay = x.b * ON(y.s + S);
  const payda = y.b * ON(x.s);
  let q = pay / payda;
  const r = pay % payda;
  const mutlak = (v) => (v < 0n ? -v : v);
  if (r !== 0n && 2n * mutlak(r) >= mutlak(payda)) q += pay < 0n !== payda < 0n ? -1n : 1n;
  return { b: q, s: S };
}
function kesinYaz(x) {
  const neg = x.b < 0n;
  let d = (neg ? -x.b : x.b).toString();
  if (x.s > 0) {
    d = d.padStart(x.s + 1, '0');
    d = d.slice(0, -x.s) + '.' + d.slice(-x.s);
  }
  return (neg ? '-' : '') + d;
}

/** Yalnız kesin sayı sabitlerinden oluşan bir ifadeyi MySQL gibi tam hesaplar. */
function kesinDeger(d) {
  switch (d.tur) {
    case 'sayi':
      return d.alt === 'tam' || d.alt === 'ondalik' ? kesinOku(d.ham) : null;
    case 'parantez':
      return kesinDeger(d.a);
    case 'tekli': {
      if (d.op !== '-' && d.op !== '+') return null;
      const v = kesinDeger(d.a);
      if (!v || v.mantik !== undefined) return null;
      return d.op === '-' ? { b: -v.b, s: v.s } : v;
    }
    case 'ikili': {
      const a = kesinDeger(d.a);
      const b = kesinDeger(d.b);
      if (!a || !b || a.mantik !== undefined || b.mantik !== undefined) return null;
      switch (d.op) {
        case '+': {
          const [x, y, s] = kesinHizala(a, b);
          return { b: x + y, s };
        }
        case '-': {
          const [x, y, s] = kesinHizala(a, b);
          return { b: x - y, s };
        }
        case '*':
          return { b: a.b * b.b, s: a.s + b.s };
        case '/':
          return kesinBol(a, b);
        case '=':
        case '<=>':
        case '<>':
        case '!=':
        case '<':
        case '<=':
        case '>':
        case '>=': {
          const [x, y] = kesinHizala(a, b);
          const c = x < y ? -1 : x > y ? 1 : 0;
          const r = { '=': c === 0, '<=>': c === 0, '<>': c !== 0, '!=': c !== 0, '<': c < 0, '<=': c <= 0, '>': c > 0, '>=': c >= 0 }[d.op];
          return { mantik: r ? 1 : 0 };
        }
        default:
          return null;
      }
    }
    default:
      return null;
  }
}

/* ===================================================================
 * 6. Çeviri: MySQL ağacı → SQLite metni, denetimler, ipuçları
 * =================================================================== */

const sqlMetin = (s) => "'" + String(s).replace(/\0/g, '').replace(/'/g, "''") + "'";
const tirnakla = (s) => '`' + String(s).replace(/`/g, '``') + '`';
const OP_ESLE = { '||': 'OR', '&&': 'AND', '<=>': 'IS', '/': '* 1.0 /' };

function sozcukYaz(tk) {
  switch (tk.tur) {
    case 'metin':
      return sqlMetin(tk.deger);
    case 'kelime':
      return tk.tirnakli ? tirnakla(tk.deger) : tk.ham;
    case 'op':
      return OP_ESLE[tk.deger] ?? tk.deger;
    default:
      return tk.ham;
  }
}

class Yazici {
  constructor(ft) {
    this.ft = ft;
    this.once = ft.map(() => '');
    this.sonra = ft.map(() => '');
    this.yerine = ft.map(() => null);
  }

  onceEkle(i, s) {
    this.once[i] = s + this.once[i];
  }

  sonraEkle(i, s) {
    this.sonra[i] += s;
  }

  degistir(i, s) {
    this.yerine[i] = s;
  }

  uret() {
    const kodlayici = new TextEncoder();
    const parcalar = [];
    const harita = [];
    let bayt = 0;
    const ekle = (s, tok) => {
      if (!s) return;
      if (parcalar.length) {
        parcalar.push(' ');
        bayt += 1;
      }
      harita.push({ bayt, tok });
      parcalar.push(s);
      bayt += kodlayici.encode(s).length;
    };
    this.ft.forEach((tk, i) => {
      ekle(this.once[i], i);
      ekle(this.yerine[i] !== null ? this.yerine[i] : sozcukYaz(tk), i);
      ekle(this.sonra[i], i);
    });
    return { sql: parcalar.join(''), harita };
  }
}

export const MYSQL_FONK = new Set(
  ('abs acos asin atan atan2 avg bit_length ceil ceiling char char_length character_length coalesce concat concat_ws cos cot count curdate ' +
    'current_date current_time current_timestamp current_user curtime database date date_add date_format date_sub datediff day dayname ' +
    'dayofmonth dayofweek dayofyear degrees elt exp extract field floor format greatest group_concat hex hour if ifnull instr last_day lcase ' +
    'least left length ln localtime localtimestamp locate log log10 log2 lower lpad ltrim max mid min minute mod month monthname now nullif ' +
    'octet_length ord pi position pow power quarter radians rand repeat replace reverse right round rpad rtrim schema second session_user sign ' +
    'sin space sqrt strcmp subdate substr substring substring_index sum sysdate system_user tan time timestampadd timestampdiff trim truncate ' +
    'ucase upper user utc_date version week weekday weekofyear year adddate cast convert any_value row_number rank dense_rank percent_rank ' +
    'cume_dist ntile lag lead first_value last_value nth_value').split(' '),
);
const MYSQL_VAR_YOK = new Set(
  ('str_to_date std stddev stddev_pop stddev_samp variance var_pop var_samp bit_and bit_or bit_xor conv bin oct json_object json_array ' +
    'json_extract json_arrayagg json_objectagg md5 sha1 sha2 uuid soundex makedate maketime period_add period_diff to_days from_days ' +
    'unix_timestamp from_unixtime sec_to_time time_to_sec timediff addtime subtime convert_tz yearweek microsecond find_in_set insert quote ' +
    'regexp_replace regexp_substr regexp_instr regexp_like weight_string charset collation coercibility benchmark sleep found_rows row_count ' +
    'last_insert_id connection_id').split(' '),
);
const ARG_SAYISI = {
  abs: [1, 1], ceil: [1, 1], ceiling: [1, 1], floor: [1, 1], round: [1, 2], truncate: [2, 2], mod: [2, 2], pow: [2, 2], power: [2, 2],
  sqrt: [1, 1], sign: [1, 1], rand: [0, 1], pi: [0, 0], exp: [1, 1], ln: [1, 1], log: [1, 2], log10: [1, 1], log2: [1, 1],
  concat: [1, 1e9], concat_ws: [2, 1e9], upper: [1, 1], lower: [1, 1], ucase: [1, 1], lcase: [1, 1], length: [1, 1], octet_length: [1, 1],
  char_length: [1, 1], character_length: [1, 1], bit_length: [1, 1], left: [2, 2], right: [2, 2], lpad: [3, 3], rpad: [3, 3],
  repeat: [2, 2], reverse: [1, 1], space: [1, 1], locate: [2, 3], instr: [2, 2], substring: [2, 3], substr: [2, 3], mid: [3, 3],
  replace: [3, 3], ltrim: [1, 1], rtrim: [1, 1], strcmp: [2, 2], format: [2, 3], substring_index: [3, 3], ascii: [1, 1], ord: [1, 1],
  hex: [1, 1], field: [2, 1e9], elt: [2, 1e9], year: [1, 1], month: [1, 1], day: [1, 1], dayofmonth: [1, 1], dayofweek: [1, 1],
  dayofyear: [1, 1], weekday: [1, 1], quarter: [1, 1], week: [1, 2], weekofyear: [1, 1], hour: [1, 1], minute: [1, 1], second: [1, 1],
  dayname: [1, 1], monthname: [1, 1], datediff: [2, 2], date_format: [2, 2], last_day: [1, 1], date: [1, 1], time: [1, 1],
  date_add: [2, 2], date_sub: [2, 2], adddate: [2, 2], subdate: [2, 2], curdate: [0, 0], current_date: [0, 0], curtime: [0, 1],
  current_time: [0, 1], now: [0, 1], current_timestamp: [0, 1], sysdate: [0, 1], localtime: [0, 1], localtimestamp: [0, 1],
  utc_date: [0, 0], coalesce: [1, 1e9], ifnull: [2, 2], nullif: [2, 2], if: [3, 3], greatest: [2, 1e9], least: [2, 1e9],
  count: [1, 1], sum: [1, 1], avg: [1, 1], min: [1, 1], max: [1, 1], version: [0, 0], database: [0, 0], schema: [0, 0],
  user: [0, 0], current_user: [0, 0], session_user: [0, 0], system_user: [0, 0], any_value: [1, 1], char: [1, 1e9],
};
const AD_ESLE = {
  current_date: 'curdate',
  current_time: 'curtime',
  current_timestamp: 'now',
  localtime: 'now',
  localtimestamp: 'now',
  sysdate: 'now',
  ucase: 'upper',
  lcase: 'lower',
  character_length: 'char_length',
  octet_length: 'length',
  mid: 'substring',
  substr: 'substring',
  ceiling: 'ceil',
  power: 'pow',
  schema: 'database',
  session_user: 'user',
  system_user: 'user',
  current_user: 'user',
};
const METIN_FONK = new Set(
  'concat concat_ws char_length character_length length octet_length bit_length lpad rpad left right substring substr mid upper lower ucase lcase reverse replace locate instr repeat trim ltrim rtrim substring_index strcmp'.split(' '),
);
const TOPLAMA = new Set(['count', 'sum', 'avg', 'min', 'max', 'group_concat']);

export function mysqlHata(kod, durum, mesaj, ek) {
  return Object.assign({ tur: 'hata', kod, durum, mesaj }, ek);
}

class Isleyici {
  constructor(src, ft) {
    this.src = src;
    this.ft = ft;
    this.y = new Yazici(ft);
    this.kullanimlar = [];
    this.ipuclari = [];
    this.hata = null;
    this.ust = null;
  }

  metin(bas, son) {
    if (son <= bas) return '';
    return this.src.slice(this.ft[bas].s, this.ft[son - 1].e);
  }

  normMetin(d) {
    return this.ft
      .slice(d.bas, d.son)
      .map((t) => (t.tur === 'kelime' ? String(t.deger).toLowerCase() : t.tur === 'metin' ? sqlMetin(t.deger) : t.ham))
      .join(' ');
  }

  hataKoy(h) {
    if (!this.hata) this.hata = h;
  }

  ipucu(tur, metin) {
    if (!this.ipuclari.some((x) => x.tur === tur)) this.ipuclari.push({ tur, metin });
  }

  /* ---- kapsam ---- */

  sutunKaynagi(kapsam, s) {
    const ad = s.ad.toLowerCase();
    const tablo = s.tablo ? s.tablo.toLowerCase() : null;
    for (let k = kapsam; k; k = k.ust) {
      for (const kay of k.kaynaklar) {
        if (tablo && kay.gorunen !== tablo) continue;
        if (!kay.sutunlar) return { kaynak: kay, ad: s.ad, tip: TIP.any, bilinmiyor: true, dis: k !== kapsam };
        const sut = kay.sutunlar.find((c) => c.ad.toLowerCase() === ad);
        if (sut) return { kaynak: kay, ad: sut.ad, tip: sut.tip, dis: k !== kapsam };
      }
    }
    return null;
  }

  sutunlar(d, sonuc = [], toplamaHaric = false) {
    if (!d || typeof d !== 'object') return sonuc;
    if (d.tur === 'sutun') {
      sonuc.push(d);
      return sonuc;
    }
    if (d.tur === 'altsorgu' || d.tur === 'var') return sonuc;
    if (toplamaHaric && d.tur === 'fonk' && TOPLAMA.has(d.ad) && !d.pencere) return sonuc;
    for (const anahtar of ['a', 'b', 'alt', 'ust', 'kacis', 'deger', 'degilse']) {
      const c = d[anahtar];
      if (c && typeof c === 'object' && c.tur && c.tur !== 'sorgu') this.sutunlar(c, sonuc, toplamaHaric);
    }
    for (const listeAd of ['liste', 'args']) if (Array.isArray(d[listeAd])) for (const c of d[listeAd]) this.sutunlar(c, sonuc, toplamaHaric);
    if (d.dallar) for (const dal of d.dallar) {
      this.sutunlar(dal.kosul, sonuc, toplamaHaric);
      this.sutunlar(dal.sonuc, sonuc, toplamaHaric);
    }
    return sonuc;
  }

  toplamaIcerir(d) {
    if (!d || typeof d !== 'object') return false;
    if (d.tur === 'fonk' && TOPLAMA.has(d.ad) && !d.pencere) return true;
    if (d.tur === 'altsorgu' || d.tur === 'var' || d.tur === 'sorgu') return false;
    for (const anahtar of ['a', 'b', 'alt', 'ust', 'kacis', 'deger', 'degilse']) {
      const c = d[anahtar];
      if (c && typeof c === 'object' && c.tur && this.toplamaIcerir(c)) return true;
    }
    for (const listeAd of ['liste', 'args']) if (Array.isArray(d[listeAd]) && d[listeAd].some((c) => this.toplamaIcerir(c))) return true;
    if (d.dallar && d.dallar.some((dal) => this.toplamaIcerir(dal.kosul) || this.toplamaIcerir(dal.sonuc))) return true;
    return false;
  }

  /* ---- türler ---- */

  tip(d, kapsam) {
    if (!d) return TIP.any;
    switch (d.tur) {
      case 'sayi':
        if (d.alt === 'ondalik') return TIP.dec((d.ham.split('.')[1] || '').length);
        if (d.alt === 'kayan') return TIP.float;
        return TIP.int;
      case 'metin':
        return d.tarihAnahtar === 'DATE' ? TIP.date : d.tarihAnahtar ? TIP.datetime : TIP.text;
      case 'sabit':
        return d.deger === 'NULL' ? TIP.nul : TIP.int;
      case 'sutun': {
        const k = this.sutunKaynagi(kapsam, d);
        if (k) return k.tip;
        if (!d.tablo && kapsam && kapsam.takmalar && kapsam.takmalar.has(d.ad.toLowerCase())) return kapsam.takmalar.get(d.ad.toLowerCase()).tip;
        return TIP.any;
      }
      case 'parantez':
      case 'collate':
        return this.tip(d.a, kapsam);
      case 'tekli': {
        if (d.op === 'NOT' || d.op === '!') return TIP.int;
        const t = this.tip(d.a, kapsam);
        if (d.op === '~') return TIP.int;
        if (d.op === 'BINARY') return t;
        return SAYISAL.has(t.t) || t.t === 'null' || t.t === 'any' ? t : TIP.float;
      }
      case 'ikili':
        if (d.sinif !== 'aritmetik') return TIP.int;
        return aritTip(d.op, this.tip(d.a, kapsam), this.tip(d.b, kapsam));
      case 'is':
      case 'benzer':
      case 'icinde':
      case 'arasinda':
      case 'var':
        return TIP.int;
      case 'case': {
        let t = null;
        for (const dal of d.dallar) t = tipBirlestir(t, this.tip(dal.sonuc, kapsam));
        return tipBirlestir(t, d.degilse ? this.tip(d.degilse, kapsam) : TIP.nul);
      }
      case 'altsorgu': {
        const c = d.alt.cekirdekler[0];
        return c && c.sutunBilgi && c.sutunBilgi[0] ? c.sutunBilgi[0].tip : TIP.any;
      }
      case 'fonk':
        return this.fonkTip(d, kapsam);
      default:
        return TIP.any;
    }
  }

  fonkTip(d, kapsam) {
    const a = d.args;
    const t0 = () => this.tip(a[0], kapsam);
    switch (d.ad) {
      case 'round':
      case 'truncate': {
        const t = t0();
        if (t.t === 'null' || t.t === 'any') return t;
        if (t.t === 'int') return TIP.int;
        if (t.t !== 'dec') return TIP.float;
        let n = 0;
        if (a[1]) {
          const v = kesinDeger(a[1]);
          if (!v || v.mantik !== undefined || v.s !== 0) return TIP.any;
          n = Number(v.b);
        }
        return TIP.dec(Math.max(0, Math.min(n, t.s)));
      }
      case 'abs': {
        const t = t0();
        return SAYISAL.has(t.t) || t.t === 'null' || t.t === 'any' ? t : TIP.float;
      }
      case 'ceil':
      case 'ceiling':
      case 'floor': {
        const t = t0();
        return t.t === 'int' || t.t === 'dec' ? TIP.int : t.t === 'null' || t.t === 'any' ? t : TIP.float;
      }
      case 'mod':
        return aritTip('%', t0(), this.tip(a[1], kapsam));
      case 'sum': {
        const t = t0();
        if (t.t === 'int') return TIP.dec(0);
        if (t.t === 'dec' || t.t === 'any') return t;
        return TIP.float;
      }
      case 'avg': {
        const t = t0();
        if (t.t === 'int') return TIP.dec(4);
        if (t.t === 'dec') return TIP.dec(t.s + 4);
        if (t.t === 'any') return t;
        return TIP.float;
      }
      case 'min':
      case 'max':
      case 'any_value':
      case 'nullif':
      case 'lag':
      case 'lead':
      case 'first_value':
      case 'last_value':
      case 'nth_value':
        return t0();
      case 'coalesce':
      case 'ifnull':
      case 'greatest':
      case 'least': {
        let t = null;
        for (const x of a) t = tipBirlestir(t, this.tip(x, kapsam));
        return t || TIP.any;
      }
      case 'if':
        return tipBirlestir(this.tip(a[1], kapsam), this.tip(a[2], kapsam));
      case 'cast':
      case 'convert': {
        const oz = d.ozel;
        if (!oz || oz.tur !== 'tip') return t0();
        switch (oz.tip) {
          case 'SIGNED':
          case 'UNSIGNED':
          case 'INTEGER':
          case 'INT':
            return TIP.int;
          case 'DECIMAL':
          case 'NUMERIC':
          case 'DEC':
          case 'FIXED':
            return TIP.dec(oz.s ?? 0);
          case 'DATE':
            return TIP.date;
          case 'DATETIME':
          case 'TIMESTAMP':
            return TIP.datetime;
          case 'DOUBLE':
          case 'FLOAT':
          case 'REAL':
            return TIP.float;
          default:
            return TIP.text;
        }
      }
      default:
        return FONK_TIP[d.ad] || TIP.any;
    }
  }

  /* ---- yürüyüş ---- */

  sorguIsle(q, ust, cteler) {
    cteler = new Map(cteler || []);
    if (q.cte) {
      for (const c of q.cte) {
        const bilgi = this.sorguIsle(c.q, ust, cteler);
        const sutunlar = bilgi.sutunlar.map((s, i) => ({ ad: c.sutunlar ? c.sutunlar[i] : s.ad, tip: s.tip }));
        cteler.set(c.ad.toLowerCase(), { sutunlar });
      }
    }
    const bilgiler = q.cekirdekler.map((c) => this.cekirdekIsle(c, ust, cteler));
    const ilk = bilgiler[0];
    const birlesim = q.cekirdekler.length > 1;
    if (birlesim) {
      ilk.sutunlar = ilk.sutunlar.map((s, i) => {
        let t = s.tip;
        for (const b of bilgiler.slice(1)) t = tipBirlestir(t, b.sutunlar[i] ? b.sutunlar[i].tip : TIP.any);
        return { ad: s.ad, tip: t };
      });
    }
    if (q.sirala) {
      const kapsam = ilk.kapsam || { kaynaklar: [], ust, takmalar: new Map() };
      for (const terim of q.sirala) {
        this.ifadeIsle(terim.e, kapsam, 'order clause');
        if (terim.e.tur !== 'collate') this.y.sonraEkle(terim.eSon - 1, ' COLLATE ' + DUZEN);
      }
      if (!birlesim && ilk.cekirdek && ilk.cekirdek.tekil) this.tekilSiraDenetle(q.sirala, ilk);
      if (q === this.kok) this.siralama = q.sirala.map((t) => this.siraTerimiCoz(t, ilk));
    }
    if (q.sinir && !q.sirala) this.ipucu('sirasizLimit', 'ORDER BY olmadan LIMIT: hangi satırların geleceği güvence altında değil. “İlk n” anlamlı olsun diye önce sırala.');
    return { sutunlar: ilk.sutunlar, kapsam: ilk.kapsam, cekirdek: ilk.cekirdek };
  }

  cekirdekIsle(c, ust, cteler) {
    if (c.tur === 'parantezSorgu') return this.sorguIsle(c.alt, ust, cteler);
    const kapsam = { kaynaklar: [], ust, cteler, takmalar: new Map() };
    if (c.kaynak) this.kaynakIsle(c.kaynak, kapsam, c);
    const sutunlar = [];
    c.ogeler.forEach((oge) => {
      if (oge.yildiz) {
        const kaynaklar = oge.e.tablo ? kapsam.kaynaklar.filter((k) => k.gorunen === oge.e.tablo.toLowerCase()) : kapsam.kaynaklar;
        if (oge.e.tablo && !kaynaklar.length) {
          this.hataKoy(mysqlHata(1051, '42S02', `Unknown table '${oge.e.tablo}'`));
          return;
        }
        if (!oge.e.tablo && !kaynaklar.length) {
          this.hataKoy(mysqlHata(1096, 'HY000', 'No tables used'));
          return;
        }
        for (const k of kaynaklar) {
          if (!k.sutunlar) sutunlar.push({ ad: '?', tip: TIP.any, bilinmiyor: true });
          else for (const s of k.sutunlar) sutunlar.push({ ad: s.ad, tip: s.tip });
        }
        return;
      }
      this.ifadeIsle(oge.e, kapsam, 'field list');
      const tip = this.tip(oge.e, kapsam);
      let ad = oge.takma;
      if (ad === null) {
        if (oge.e.tur === 'sutun') {
          const k = this.sutunKaynagi(kapsam, oge.e);
          ad = k && !k.bilinmiyor ? k.ad : oge.e.ad;
        } else if (oge.e.tur === 'metin' && !oge.e.tarihAnahtar) ad = oge.e.deger;
        else ad = this.metin(oge.bas, oge.ifadeSon);
        if (oge.e.tur !== 'sutun') this.y.sonraEkle(oge.son - 1, ' AS ' + tirnakla(ad));
      }
      sutunlar.push({ ad, tip, oge });
      if (oge.takma) kapsam.takmalar.set(oge.takma.toLowerCase(), { tip, oge });
      if (oge.ortuk && oge.e.tur === 'sutun' && this.sutunKaynagi(kapsam, { ad: oge.takma, tablo: null })) {
        this.ipucu(
          'virgul',
          `“${this.metin(oge.bas, oge.son)}”: iki sütun arasında virgül unutulmuş olabilir. MySQL bunu “${oge.e.ad} sütununa ${oge.takma} takma adı” diye okur ve tek sütun getirir.`,
        );
      }
    });
    c.sutunBilgi = sutunlar;
    if (c.nerede) {
      this.ifadeIsle(c.nerede, kapsam, 'where clause');
      this.takmaWhereDenetle(c, kapsam);
      this.oncelikIpucu(c.nerede);
    }
    if (c.grup) for (const g of c.grup) this.ifadeIsle(g.e, kapsam, 'group statement');
    if (c.sahip) this.ifadeIsle(c.sahip, kapsam, 'having clause');
    this.grupDenetle(c, kapsam);
    return { sutunlar, kapsam, cekirdek: c };
  }

  kaynakIsle(liste, kapsam, c) {
    for (const k of liste) {
      if (k.tur === 'tablo') {
        if (!k.db && k.ad.toUpperCase() === 'DUAL' && liste.length === 1 && c && c.fromIdx !== null) {
          this.y.degistir(c.fromIdx, '');
          this.y.degistir(k.bas, '');
          continue;
        }
        if (k.db) {
          if (k.db.toLowerCase() !== 'vt1') {
            this.hataKoy(mysqlHata(1146, '42S02', `Table '${k.db}.${k.ad}' doesn't exist`, { tablo: k.ad }));
            continue;
          }
          this.y.degistir(k.bas, '');
          this.y.degistir(k.bas + 1, '');
        }
        const ad = k.ad.toLowerCase();
        const cte = kapsam.cteler && kapsam.cteler.get(ad);
        const t = SEMA_HARITA.get(ad);
        kapsam.kaynaklar.push({
          gorunen: (k.takma || k.ad).toLowerCase(),
          tablo: cte ? null : t ? t.ad : null,
          sutunlar: cte ? cte.sutunlar : t ? t.sutunlar.map((s) => ({ ad: s.ad, tip: mysqlTip(s.tip) })) : null,
        });
      } else if (k.tur === 'turetilmis') {
        const bilgi = this.sorguIsle(k.alt, kapsam.ust, kapsam.cteler);
        kapsam.kaynaklar.push({ gorunen: k.takma.toLowerCase(), tablo: null, sutunlar: bilgi.sutunlar.map((s) => ({ ad: s.ad, tip: s.tip })) });
      } else if (k.tur === 'join') {
        this.kaynakIsle([k.sag], kapsam, null);
        if (k.kosul) this.ifadeIsle(k.kosul, kapsam, 'on clause');
      } else if (k.tur === 'grup') this.kaynakIsle(k.ic, kapsam, null);
    }
  }

  katla(d, v) {
    const metin = v.mantik !== undefined ? String(v.mantik) : kesinYaz(v);
    this.y.degistir(d.bas, '(' + metin + ')');
    for (let i = d.bas + 1; i < d.son; i++) this.y.degistir(i, '');
  }

  ifadeIsle(d, kapsam, baglam) {
    if (!d || typeof d !== 'object') return;
    if ((d.tur === 'ikili' || d.tur === 'tekli' || d.tur === 'parantez') && d.son - d.bas > 1) {
      const v = kesinDeger(d);
      if (v) {
        this.katla(d, v);
        return;
      }
    }
    switch (d.tur) {
      case 'sutun':
        this.kullanimlar.push({ ad: d.tablo ? d.tablo + '.' + d.ad : d.ad, yalin: d.ad, baglam, d });
        if (d.db) {
          if (d.db.toLowerCase() !== 'vt1') this.hataKoy(mysqlHata(1054, '42S22', `Unknown column '${d.db}.${d.tablo}.${d.ad}' in '${baglam}'`));
          this.y.degistir(d.bas, '');
          this.y.degistir(d.bas + 1, '');
        }
        return;
      case 'metin':
        if (d.tarihAnahtar) this.y.degistir(d.anahtarIdx, '');
        if (d.ekler.length) {
          this.y.degistir(d.metinIdx, sqlMetin(d.deger));
          for (const i of d.ekler) this.y.degistir(i, '');
        }
        return;
      case 'sayi':
      case 'sabit':
      case 'yildiz':
        return;
      case 'degisken':
        this.hataKoy(mysqlHata(null, null, 'Kullanıcı değişkenleri (@ad) bu çalışma alanında desteklenmiyor.', { destek: true }));
        return;
      case 'tekli':
        this.ifadeIsle(d.a, kapsam, baglam);
        if (d.op === '!') {
          this.y.degistir(d.bas, '(NOT');
          this.y.sonraEkle(d.son - 1, ')');
        } else if (d.op === 'BINARY') this.y.degistir(d.bas, '');
        return;
      case 'ikili':
        if (d.b && d.b.tur === 'aralik' && (d.op === '+' || d.op === '-')) d.b.ebeveyn = true;
        this.ifadeIsle(d.a, kapsam, baglam);
        this.ifadeIsle(d.b, kapsam, baglam);
        if (d.op === 'DIV') {
          this.y.onceEkle(d.a.bas, 'CAST((');
          this.y.degistir(d.opIdx, ') / (');
          this.y.sonraEkle(d.b.son - 1, ') AS INTEGER)');
        } else if (d.op === 'MOD' || d.op === '%') {
          this.y.onceEkle(d.a.bas, 'mod(');
          this.y.degistir(d.opIdx, ',');
          this.y.sonraEkle(d.b.son - 1, ')');
        } else if (d.op === 'XOR') {
          this.y.onceEkle(d.a.bas, '((');
          this.y.degistir(d.opIdx, ') IS TRUE) <> ((');
          this.y.sonraEkle(d.b.son - 1, ') IS TRUE)');
        } else if (d.op === '^') {
          this.hataKoy(mysqlHata(null, null, 'Bit düzeyinde XOR (^) bu çalışma alanında desteklenmiyor.', { destek: true }));
        } else if (d.b.tur === 'aralik') {
          this.y.onceEkle(d.a.bas, d.op === '+' ? 'mysql_tarih_ekle(' : 'mysql_tarih_cikar(');
          this.y.degistir(d.opIdx, ',');
          this.y.degistir(d.b.bas, '');
          this.y.degistir(d.b.birimIdx, ", '" + d.b.birim + "')");
        }
        if (d.op === '||') this.ipucu('veya', 'MySQL’de || metin birleştirmez; VEYA (OR) anlamına gelir. Metinleri birleştirmek için CONCAT(ad, \' \', soyad) yaz.');
        if (d.sinif === 'karsilastir' && (d.a.tur === 'sabit' && d.a.deger === 'NULL' || d.b.tur === 'sabit' && d.b.deger === 'NULL') && d.op !== '<=>') {
          this.ipucu('esitNull', 'NULL ile = ya da <> karşılaştırması her satır için UNKNOWN olur; hiçbir satır gelmez ve MySQL uyarı da vermez. Boşluğu IS NULL / IS NOT NULL ile sor.');
        }
        return;
      case 'is':
        this.ifadeIsle(d.a, kapsam, baglam);
        if (d.deger === 'UNKNOWN') this.y.degistir(d.degerIdx, 'NULL');
        return;
      case 'benzer':
        this.ifadeIsle(d.a, kapsam, baglam);
        this.ifadeIsle(d.b, kapsam, baglam);
        this.ifadeIsle(d.kacis, kapsam, baglam);
        return;
      case 'icinde':
        this.ifadeIsle(d.a, kapsam, baglam);
        if (d.alt) this.sorguIsle(d.alt, kapsam, kapsam && kapsam.cteler);
        else for (const x of d.liste) this.ifadeIsle(x, kapsam, baglam);
        if (d.liste && d.liste.some((x) => x.tur === 'sabit' && x.deger === 'NULL') && d.degil) {
          this.ipucu('notInNull', 'NOT IN listesinde NULL varsa hiçbir satır gelmez: x <> NULL her zaman UNKNOWN’dır.');
        }
        return;
      case 'arasinda':
        this.ifadeIsle(d.a, kapsam, baglam);
        this.ifadeIsle(d.alt, kapsam, baglam);
        this.ifadeIsle(d.ust, kapsam, baglam);
        return;
      case 'collate': {
        this.ifadeIsle(d.a, kapsam, baglam);
        const ad = d.ad;
        if (ad === DUZEN) return;
        if (/_bin$/.test(ad)) this.y.degistir(d.adIdx, 'BINARY');
        else if (/^utf8(mb[34])?_|^latin1_|^ascii_/.test(ad)) this.y.degistir(d.adIdx, DUZEN);
        else this.hataKoy(mysqlHata(1273, 'HY000', `Unknown collation: '${ad}'`));
        return;
      }
      case 'case':
        this.ifadeIsle(d.deger, kapsam, baglam);
        for (const dal of d.dallar) {
          this.ifadeIsle(dal.kosul, kapsam, baglam);
          this.ifadeIsle(dal.sonuc, kapsam, baglam);
        }
        this.ifadeIsle(d.degilse, kapsam, baglam);
        return;
      case 'altsorgu':
      case 'var':
        this.sorguIsle(d.alt, kapsam, kapsam && kapsam.cteler);
        return;
      case 'parantez':
        this.ifadeIsle(d.a, kapsam, baglam);
        return;
      case 'satir':
        for (const x of d.liste) this.ifadeIsle(x, kapsam, baglam);
        return;
      case 'aralik':
        this.ifadeIsle(d.a, kapsam, baglam);
        if (!d.ebeveyn) this.hataKoy(mysqlHata(null, null, 'INTERVAL yalnız DATE_ADD / DATE_SUB içinde ya da tarih + INTERVAL n DAY biçiminde kullanılabilir.', { destek: true }));
        return;
      case 'fonk':
        this.fonkIsle(d, kapsam, baglam);
        return;
      default:
        return;
    }
  }

  fonkIsle(d, kapsam, baglam) {
    const ad = d.ad;
    const tarihFonk = ad === 'date_add' || ad === 'date_sub' || ad === 'adddate' || ad === 'subdate';
    for (const a of d.args) {
      if (a.tur === 'aralik' && tarihFonk) a.ebeveyn = true;
      this.ifadeIsle(a, kapsam, baglam);
    }
    if (d.sirala) for (const s of d.sirala) this.ifadeIsle(s.e, kapsam, baglam);
    if (d.parantezsiz) {
      this.y.degistir(d.adIdx, PARANTEZSIZ[d.ad.toUpperCase()] + '()');
      return;
    }
    if (!MYSQL_FONK.has(ad)) {
      if (MYSQL_VAR_YOK.has(ad)) this.hataKoy(mysqlHata(null, null, `${d.adHam}() MySQL’de var, ama bu tarayıcı çalışma alanında desteklenmiyor.`, { destek: true }));
      else this.hataKoy(mysqlHata(1305, '42000', `FUNCTION vt1.${d.adHam} does not exist`, { fonk: d.adHam }));
      return;
    }
    const ar = ARG_SAYISI[ad];
    if (ar && (d.args.length < ar[0] || d.args.length > ar[1])) {
      this.hataKoy(mysqlHata(1582, '42000', `Incorrect parameter count in the call to native function '${d.adHam}'`));
      return;
    }
    if (d.args.some((a) => a.tur === 'yildiz') && ad !== 'count') {
      this.hataKoy(mysqlHata(1064, '42000', 'You have an error in your SQL syntax', { konumIdx: d.args.find((a) => a.tur === 'yildiz').bas }));
      return;
    }
    const oz = d.ozel;
    switch (ad) {
      case 'cast':
      case 'convert': {
        if (oz.tur === 'using') {
          this.y.degistir(d.adIdx, '');
          for (let i = oz.bas; i < oz.son; i++) this.y.degistir(i, '');
          return;
        }
        const sil = () => {
          for (let i = oz.tipBas - 1; i < oz.tipSon; i++) this.y.degistir(i, '');
        };
        switch (oz.tip) {
          case 'SIGNED':
          case 'UNSIGNED':
          case 'INTEGER':
          case 'INT':
            this.y.degistir(d.adIdx, 'mysql_tamsayi');
            sil();
            break;
          case 'DECIMAL':
          case 'NUMERIC':
          case 'DEC':
          case 'FIXED':
            this.y.degistir(d.adIdx, 'mysql_ondalikla');
            sil();
            this.y.sonraEkle(oz.tipSon - 1, ', ' + (oz.s ?? 0));
            break;
          case 'CHAR':
          case 'NCHAR':
          case 'VARCHAR': {
            this.y.degistir(d.adIdx, 'mysql_metin');
            sil();
            const t = this.tip(d.args[0], kapsam);
            if (t.t === 'dec') this.y.sonraEkle(oz.tipSon - 1, ', ' + t.s);
            break;
          }
          case 'DATE':
            this.y.degistir(d.adIdx, 'mysql_tarih');
            sil();
            break;
          case 'DATETIME':
          case 'TIMESTAMP':
            this.y.degistir(d.adIdx, 'mysql_tarihsaat');
            sil();
            break;
          case 'TIME':
            this.y.degistir(d.adIdx, 'mysql_saat');
            sil();
            break;
          case 'DOUBLE':
          case 'FLOAT':
          case 'REAL':
            this.y.degistir(d.adIdx, 'mysql_kayan');
            sil();
            break;
          default:
            this.hataKoy(mysqlHata(null, null, `CAST(… AS ${oz.tip}) bu çalışma alanında desteklenmiyor.`, { destek: true }));
        }
        return;
      }
      case 'extract':
        this.y.degistir(d.adIdx, 'mysql_extract');
        this.y.degistir(oz.birimIdx, sqlMetin(oz.birim));
        this.y.degistir(oz.fromIdx, ',');
        return;
      case 'timestampdiff':
      case 'timestampadd':
        this.y.degistir(d.adIdx, 'mysql_' + ad);
        this.y.degistir(oz.birimIdx, sqlMetin(oz.birim));
        return;
      case 'trim':
        if (oz) {
          const yeni = oz.yon === 'LEADING' ? 'ltrim' : oz.yon === 'TRAILING' ? 'rtrim' : 'trim';
          this.y.degistir(d.adIdx, yeni);
          if (oz.yonIdx !== null) this.y.degistir(oz.yonIdx, '');
          if (oz.kalip) {
            if (oz.kalip.tur !== 'metin') {
              this.hataKoy(mysqlHata(null, null, 'TRIM(… FROM …) içinde kaldırılacak değer sabit bir metin olmalı.', { destek: true }));
              return;
            }
            for (let i = oz.kalip.bas; i < oz.kalip.son; i++) this.y.degistir(i, '');
            this.y.sonraEkle(d.args[0].son - 1, ', ' + sqlMetin(oz.kalip.deger));
          }
          this.y.degistir(oz.fromIdx, '');
        }
        return;
      case 'position':
        this.y.degistir(d.adIdx, 'locate');
        this.y.degistir(oz.inIdx, ',');
        return;
      case 'substring':
      case 'substr':
        this.y.degistir(d.adIdx, 'substring');
        if (oz) {
          this.y.degistir(oz.fromIdx, ',');
          if (oz.forIdx !== null) this.y.degistir(oz.forIdx, ',');
        }
        break;
      case 'group_concat':
        if (oz) {
          if (d.tekil) {
            this.hataKoy(mysqlHata(null, null, 'GROUP_CONCAT(DISTINCT … SEPARATOR …) bu çalışma alanında desteklenmiyor.', { destek: true }));
            return;
          }
          this.y.degistir(oz.sepIdx, '');
          this.y.degistir(oz.sepIdx + 1, '');
          this.y.sonraEkle(d.args[d.args.length - 1].son - 1, ', ' + sqlMetin(oz.deger));
        }
        return;
      case 'date_add':
      case 'date_sub':
      case 'adddate':
      case 'subdate': {
        const ekle = ad === 'date_add' || ad === 'adddate';
        const a2 = d.args[1];
        this.y.degistir(d.adIdx, ekle ? 'mysql_tarih_ekle' : 'mysql_tarih_cikar');
        if (a2.tur === 'aralik') {
          this.y.degistir(a2.bas, '');
          this.y.degistir(a2.birimIdx, ', ' + sqlMetin(a2.birim));
        } else if (ad === 'adddate' || ad === 'subdate') this.y.sonraEkle(a2.son - 1, ", 'DAY'");
        else this.hataKoy(mysqlHata(1064, '42000', 'You have an error in your SQL syntax', { konumIdx: a2.bas }));
        return;
      }
      case 'any_value':
        this.y.degistir(d.adIdx, '');
        return;
      default:
        break;
    }
    if (AD_ESLE[ad]) this.y.degistir(d.adIdx, AD_ESLE[ad]);
    if (METIN_FONK.has(ad)) {
      for (const a of d.args) {
        const t = this.tip(a, kapsam);
        if (t.t === 'dec') {
          this.y.onceEkle(a.bas, 'mysql_ondalik(');
          this.y.sonraEkle(a.son - 1, ', ' + t.s + ')');
        }
      }
    }
  }

  /* ---- MySQL denetimleri ---- */

  /** ORDER BY terimini sonuçtaki sütun sırasına çözer (denetim için). */
  siraTerimiCoz(t, bilgi) {
    const e = t.e.tur === 'collate' ? t.e.a : t.e;
    const sutunlar = bilgi.sutunlar || [];
    let idx = -1;
    if (e.tur === 'sayi' && e.alt === 'tam') {
      const k = parseInt(e.ham, 10) - 1;
      if (k >= 0 && k < sutunlar.length) idx = k;
    } else if (e.tur === 'sutun') {
      const ad = e.ad.toLowerCase();
      if (!e.tablo) idx = sutunlar.findIndex((s) => s.oge && s.oge.takma && s.oge.takma.toLowerCase() === ad);
      if (idx < 0) {
        idx = sutunlar.findIndex(
          (s) => s.oge && s.oge.e.tur === 'sutun' && s.oge.e.ad.toLowerCase() === ad && (!e.tablo || !s.oge.e.tablo || s.oge.e.tablo.toLowerCase() === e.tablo.toLowerCase()),
        );
      }
      if (idx < 0) idx = sutunlar.findIndex((s) => !s.oge && s.ad.toLowerCase() === ad);
    } else {
      const norm = this.normMetin(e);
      idx = sutunlar.findIndex((s) => s.oge && this.normMetin(s.oge.e) === norm);
    }
    return { idx, ad: e.tur === 'sutun' ? e.ad : null, azalan: t.yon === 'DESC' };
  }

  takmaWhereDenetle(c, kapsam) {
    for (const s of this.sutunlar(c.nerede)) {
      if (s.tablo) continue;
      const ad = s.ad.toLowerCase();
      if (!kapsam.takmalar.has(ad)) continue;
      if (this.sutunKaynagi(kapsam, s)) continue;
      this.hataKoy(mysqlHata(1054, '42S22', `Unknown column '${s.ad}' in 'where clause'`, { takmaWhere: s.ad }));
      return;
    }
  }

  tekilSiraDenetle(terimler, bilgi) {
    const { kapsam, cekirdek } = bilgi;
    const ogeler = cekirdek.ogeler;
    terimler.forEach((t, i) => {
      if (this.hata) return;
      const e = t.e.tur === 'collate' ? t.e.a : t.e;
      if (e.tur === 'sayi') return;
      const norm = this.normMetin(e);
      if (ogeler.some((o) => !o.yildiz && this.normMetin(o.e) === norm)) return;
      for (const s of this.sutunlar(e)) {
        if (!s.tablo && kapsam.takmalar.has(s.ad.toLowerCase())) continue;
        const k = this.sutunKaynagi(kapsam, s);
        if (!k || k.bilinmiyor || k.dis) continue;
        const secildi = ogeler.some((o) => {
          if (o.yildiz) return !o.e.tablo || o.e.tablo.toLowerCase() === k.kaynak.gorunen;
          if (o.e.tur !== 'sutun') return false;
          const ok = this.sutunKaynagi(kapsam, o.e);
          return ok && ok.kaynak === k.kaynak && ok.ad === k.ad;
        });
        if (secildi) continue;
        const tam = k.kaynak.tablo ? `vt1.${k.kaynak.tablo}.${k.ad}` : k.ad;
        this.hataKoy(
          mysqlHata(3065, 'HY000', `Expression #${i + 1} of ORDER BY clause is not in SELECT list, references column '${tam}' which is not in SELECT list; this is incompatible with DISTINCT`),
        );
        return;
      }
    });
  }

  grupDenetle(c, kapsam) {
    const toplamaVar = c.ogeler.some((o) => !o.yildiz && this.toplamaIcerir(o.e)) || (c.sahip && this.toplamaIcerir(c.sahip));
    if (!c.grup && !toplamaVar) return;
    const grupSutunlari = [];
    const grupMetinleri = new Set();
    const grupTakmalari = new Set();
    if (c.grup) {
      for (const g of c.grup) {
        const e = g.e;
        grupMetinleri.add(this.normMetin(e));
        if (e.tur === 'sutun') {
          const k = this.sutunKaynagi(kapsam, e);
          if (!k && !e.tablo && kapsam.takmalar.has(e.ad.toLowerCase())) grupTakmalari.add(e.ad.toLowerCase());
          else if (k) grupSutunlari.push(k);
        } else if (e.tur === 'sayi') {
          const o = c.ogeler[parseInt(e.ham, 10) - 1];
          if (o && !o.yildiz) grupMetinleri.add(this.normMetin(o.e));
        }
      }
    }
    const tamAd = (k) => (k.kaynak.tablo ? `vt1.${k.kaynak.tablo}.${k.ad}` : k.ad);
    c.ogeler.forEach((o, i) => {
      if (this.hata) return;
      let adaylar;
      if (o.yildiz) {
        const kaynaklar = o.e.tablo ? kapsam.kaynaklar.filter((k) => k.gorunen === o.e.tablo.toLowerCase()) : kapsam.kaynaklar;
        adaylar = [];
        for (const kay of kaynaklar) if (kay.sutunlar) for (const s of kay.sutunlar) adaylar.push({ kaynak: kay, ad: s.ad });
      } else {
        if (o.takma && grupTakmalari.has(o.takma.toLowerCase())) return;
        if (grupMetinleri.has(this.normMetin(o.e))) return;
        adaylar = this.sutunlar(o.e, [], true)
          .map((s) => this.sutunKaynagi(kapsam, s))
          .filter((k) => k && !k.bilinmiyor && !k.dis);
      }
      for (const k of adaylar) {
        if (!c.grup) {
          this.hataKoy(
            mysqlHata(1140, '42000', `In aggregated query without GROUP BY, expression #${i + 1} of SELECT list contains nonaggregated column '${tamAd(k)}'; this is incompatible with sql_mode=only_full_group_by`),
          );
          return;
        }
        if (grupSutunlari.some((g) => g.kaynak === k.kaynak && g.ad === k.ad)) continue;
        if (k.kaynak.tablo) {
          const t = SEMA_HARITA.get(k.kaynak.tablo);
          if (t && t.pk.every((p) => grupSutunlari.some((g) => g.kaynak === k.kaynak && g.ad === p))) continue;
        }
        this.hataKoy(
          mysqlHata(1055, '42000', `Expression #${i + 1} of SELECT list is not in GROUP BY clause and contains nonaggregated column '${tamAd(k)}' which is not functionally dependent on columns in GROUP BY clause; this is incompatible with sql_mode=only_full_group_by`),
        );
        return;
      }
    });
  }

  oncelikIpucu(d) {
    const bak = (x) => {
      if (!x || x.tur !== 'ikili' || x.sinif !== 'mantik') return false;
      const veya = x.op === 'OR' || x.op === '||';
      if (veya && [x.a, x.b].some((y) => y.tur === 'ikili' && (y.op === 'AND' || y.op === '&&'))) return true;
      return bak(x.a) || bak(x.b);
    };
    if (bak(d)) {
      this.ipucu('oncelik', 'Koşulda AND ile OR parantezsiz birlikte geçiyor. AND önce değerlendirilir: “a OR b AND c”, “a OR (b AND c)” demektir. Niyetin farklıysa parantezle yaz.');
    }
  }

  sozcukIpuclari() {
    const t = this.ft;
    for (let i = 0; i + 4 < t.length; i++) {
      const [a, m1, b, m2, c] = t.slice(i, i + 5);
      if (
        a.tur === 'sayi' && a.alt === 'tam' && a.ham.length === 4 && m1.tur === 'op' && m1.deger === '-' && b.tur === 'sayi' && b.alt === 'tam' &&
        b.ham.length <= 2 && m2.tur === 'op' && m2.deger === '-' && c.tur === 'sayi' && c.alt === 'tam' && c.ham.length <= 2 &&
        a.e === m1.s && m1.e === b.s && b.e === m2.s && m2.e === c.s
      ) {
        const sonuc = +a.ham - +b.ham - +c.ham;
        this.ipucu('tarihTirnak', `${a.ham}-${b.ham}-${c.ham} tırnaksız yazılmış: MySQL bunu bir çıkarma işlemi olarak okur (= ${sonuc}). Tarihi tek tırnakla yaz: '${a.ham}-${b.ham}-${c.ham}'.`);
        break;
      }
    }
  }
}

/* ===================================================================
 * 7. MySQL fonksiyonları (SQLite'a eklenen)
 * =================================================================== */

const kodlayici = new TextEncoder();
const cozucu = new TextDecoder();

function kisaSayi(v) {
  if (!Number.isFinite(v)) return String(v);
  return String(Number(v.toPrecision(15)));
}

function metinYap(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : kisaSayi(v);
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Uint8Array) return cozucu.decode(v);
  return String(v);
}

function sayiYap(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  const m = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(metinYap(v));
  return m ? parseFloat(m[0]) : 0;
}

/** Ondalık metni yarımı sıfırdan uzağa yuvarlar (MySQL kesin sayı kuralı). */
function ondalikMetin(v, s) {
  if (v === null || v === undefined) return null;
  let x = typeof v === 'number' ? v : sayiYap(v);
  if (!Number.isFinite(x)) return String(x);
  const neg = x < 0;
  x = Math.abs(x);
  let d = String(x);
  if (/e/i.test(d)) d = x.toFixed(Math.min(100, Math.max(s + 2, 20)));
  let [tam, kesir = ''] = d.split('.');
  if (kesir.length > s) {
    const yuvarla = kesir.charCodeAt(s) >= 53;
    let govde = tam + kesir.slice(0, s);
    if (yuvarla) {
      let dizi = govde.split('');
      let k = dizi.length - 1;
      while (k >= 0) {
        if (dizi[k] === '9') {
          dizi[k] = '0';
          k--;
        } else {
          dizi[k] = String.fromCharCode(dizi[k].charCodeAt(0) + 1);
          break;
        }
      }
      if (k < 0) dizi = ['1', ...dizi];
      govde = dizi.join('');
    }
    tam = govde.slice(0, govde.length - s) || '0';
    kesir = govde.slice(govde.length - s);
  } else kesir = kesir.padEnd(s, '0');
  const sonuc = s > 0 ? `${tam}.${kesir}` : tam;
  return neg && /[1-9]/.test(sonuc) ? '-' + sonuc : sonuc;
}

function yuvarla(x, n = 0) {
  if (x === null || n === null) return null;
  const v = sayiYap(x);
  const k = Math.trunc(sayiYap(n));
  if (k >= 0) return Number(ondalikMetin(v, k));
  const c = 10 ** -k;
  return Number(ondalikMetin(v / c, 0)) * c;
}

function kes(x, n) {
  if (x === null || n === null) return null;
  const v = sayiYap(x);
  const k = Math.trunc(sayiYap(n));
  const c = 10 ** k;
  return Math.trunc(Number((v * c).toPrecision(15))) / c;
}

function tarihAyir(v) {
  if (v === null || v === undefined) return null;
  const s = metinYap(v);
  let m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/.exec(s);
  if (!m) {
    const n = /^\s*(\d{4})(\d{2})(\d{2})\s*$/.exec(s);
    if (!n) return null;
    m = [n[0], n[1], n[2], n[3]];
  }
  const y = +m[1];
  const ay = +m[2];
  const g = +m[3];
  if (ay < 1 || ay > 12 || g < 1 || g > ayGun(y, ay)) return null;
  return { y, ay, g, sa: +(m[4] || 0), dk: +(m[5] || 0), sn: +(m[6] || 0), saatVar: m[4] !== undefined };
}
const artikMi = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const ayGun = (y, m) => [31, artikMi(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
const gunNo = (t) => Math.floor(Date.UTC(t.y, t.ay - 1, t.g) / 86400000);
const iki = (n) => String(n).padStart(2, '0');
const tarihYaz = (t) => `${String(t.y).padStart(4, '0')}-${iki(t.ay)}-${iki(t.g)}`;
const tarihSaatYaz = (t) => `${tarihYaz(t)} ${iki(t.sa)}:${iki(t.dk)}:${iki(t.sn)}`;
const haftaGunu = (t) => new Date(Date.UTC(t.y, t.ay - 1, t.g)).getUTCDay();
const yilGunu = (t) => gunNo(t) - gunNo({ y: t.y, ay: 1, g: 1 }) + 1;
const GUN_ADLARI = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const AY_ADLARI = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function hafta0(t) {
  const ilkPazar = ((7 - haftaGunu({ y: t.y, ay: 1, g: 1 })) % 7) + 1;
  const g = yilGunu(t);
  return g < ilkPazar ? 0 : Math.floor((g - ilkPazar) / 7) + 1;
}

function isoHafta(t) {
  const d = new Date(Date.UTC(t.y, t.ay - 1, t.g));
  const gun = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - gun + 3);
  const ilk = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - ilk) / 86400000 - 3 + ((ilk.getUTCDay() + 6) % 7)) / 7);
}

function saatAyir(v) {
  const s = metinYap(v);
  const t = tarihAyir(s);
  if (t && t.saatVar) return t;
  const m = /^\s*(-?\d{1,3}):(\d{1,2})(?::(\d{1,2}))?/.exec(s || '');
  if (!m) return t ? { ...t } : null;
  return { sa: +m[1], dk: +m[2], sn: +(m[3] || 0) };
}

function simdi() {
  const d = new Date();
  return { y: d.getFullYear(), ay: d.getMonth() + 1, g: d.getDate(), sa: d.getHours(), dk: d.getMinutes(), sn: d.getSeconds(), saatVar: true };
}

function tarihEkle(v, n, birim, isaret) {
  const t = tarihAyir(v);
  if (!t || n === null) return null;
  const k = Math.round(sayiYap(n)) * isaret;
  const u = String(birim).toUpperCase();
  if (u === 'MONTH' || u === 'QUARTER' || u === 'YEAR') {
    const aylar = u === 'MONTH' ? k : u === 'QUARTER' ? 3 * k : 12 * k;
    const toplam = t.y * 12 + (t.ay - 1) + aylar;
    const y = Math.floor(toplam / 12);
    const ay = (toplam % 12) + 1;
    const sonuc = { ...t, y, ay, g: Math.min(t.g, ayGun(y, ay)) };
    return t.saatVar ? tarihSaatYaz(sonuc) : tarihYaz(sonuc);
  }
  const saniye = { SECOND: 1, MINUTE: 60, HOUR: 3600, DAY: 86400, WEEK: 604800 }[u];
  if (!saniye) return null;
  const ms = Date.UTC(t.y, t.ay - 1, t.g, t.sa, t.dk, t.sn) + k * saniye * 1000;
  const d = new Date(ms);
  const sonuc = { y: d.getUTCFullYear(), ay: d.getUTCMonth() + 1, g: d.getUTCDate(), sa: d.getUTCHours(), dk: d.getUTCMinutes(), sn: d.getUTCSeconds() };
  return t.saatVar || saniye < 86400 ? tarihSaatYaz(sonuc) : tarihYaz(sonuc);
}

function tarihBicimle(v, bicim) {
  const t = tarihAyir(v);
  if (!t || bicim === null) return null;
  const sa12 = t.sa % 12 || 12;
  const ek = (g) => (g % 100 >= 11 && g % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][g % 10] || 'th');
  return metinYap(bicim).replace(/%(.)/g, (_, c) => {
    switch (c) {
      case 'a':
        return GUN_ADLARI[haftaGunu(t)].slice(0, 3);
      case 'b':
        return AY_ADLARI[t.ay - 1].slice(0, 3);
      case 'c':
        return String(t.ay);
      case 'D':
        return t.g + ek(t.g);
      case 'd':
        return iki(t.g);
      case 'e':
        return String(t.g);
      case 'f':
        return '000000';
      case 'H':
        return iki(t.sa);
      case 'h':
      case 'I':
        return iki(sa12);
      case 'i':
        return iki(t.dk);
      case 'j':
        return String(yilGunu(t)).padStart(3, '0');
      case 'k':
        return String(t.sa);
      case 'l':
        return String(sa12);
      case 'M':
        return AY_ADLARI[t.ay - 1];
      case 'm':
        return iki(t.ay);
      case 'p':
        return t.sa < 12 ? 'AM' : 'PM';
      case 'r':
        return `${iki(sa12)}:${iki(t.dk)}:${iki(t.sn)} ${t.sa < 12 ? 'AM' : 'PM'}`;
      case 'S':
      case 's':
        return iki(t.sn);
      case 'T':
        return `${iki(t.sa)}:${iki(t.dk)}:${iki(t.sn)}`;
      case 'U':
        return iki(hafta0(t));
      case 'v':
        return iki(isoHafta(t));
      case 'W':
        return GUN_ADLARI[haftaGunu(t)];
      case 'w':
        return String(haftaGunu(t));
      case 'Y':
        return String(t.y).padStart(4, '0');
      case 'y':
        return iki(t.y % 100);
      case '%':
        return '%';
      default:
        return c;
    }
  });
}

function ayFarki(a, b) {
  let ay = (b.y - a.y) * 12 + (b.ay - a.ay);
  const ia = [a.g, a.sa, a.dk, a.sn];
  const ib = [b.g, b.sa, b.dk, b.sn];
  const kucuk = (x, y) => {
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i];
    return false;
  };
  if (ay > 0 && kucuk(ib, ia)) ay--;
  else if (ay < 0 && kucuk(ia, ib)) ay++;
  return ay;
}

function fonksiyonlariKaydet(db, motor) {
  const f = (ad, fn, deterministik = true) =>
    db.createFunction({ name: ad, xFunc: (pCtx, ...a) => fn(...a), arity: -1, deterministic: deterministik });
  const bosVarsa = (fn) => (...a) => (a.some((x) => x === null || x === undefined) ? null : fn(...a));

  f('concat', (...a) => (a.some((x) => x === null) ? null : a.map(metinYap).join('')));
  f('upper', bosVarsa((s) => metinYap(s).toLocaleUpperCase('tr-TR')));
  f('lower', bosVarsa((s) => metinYap(s).toLocaleLowerCase('tr-TR')));
  f('length', bosVarsa((s) => kodlayici.encode(metinYap(s)).length));
  f('bit_length', bosVarsa((s) => 8 * kodlayici.encode(metinYap(s)).length));
  f('char_length', bosVarsa((s) => Array.from(metinYap(s)).length));
  f('left', bosVarsa((s, n) => Array.from(metinYap(s)).slice(0, Math.max(0, Math.round(sayiYap(n)))).join('')));
  f('right', bosVarsa((s, n) => {
    const k = Math.round(sayiYap(n));
    return k <= 0 ? '' : Array.from(metinYap(s)).slice(-k).join('');
  }));
  const doldur = (solMu) => bosVarsa((s, n, p) => {
    const a = Array.from(metinYap(s));
    const k = Math.round(sayiYap(n));
    if (k < 0) return null;
    if (a.length >= k) return a.slice(0, k).join('');
    const pp = Array.from(metinYap(p));
    if (!pp.length) return null;
    const ek = [];
    while (ek.length < k - a.length) ek.push(pp[ek.length % pp.length]);
    return solMu ? ek.join('') + a.join('') : a.join('') + ek.join('');
  });
  f('lpad', doldur(true));
  f('rpad', doldur(false));
  f('repeat', bosVarsa((s, n) => metinYap(s).repeat(Math.max(0, Math.round(sayiYap(n))))));
  f('reverse', bosVarsa((s) => Array.from(metinYap(s)).reverse().join('')));
  f('space', bosVarsa((n) => ' '.repeat(Math.max(0, Math.round(sayiYap(n))))));
  f('locate', (alt, s, bas) => (alt === null || s === null || bas === null ? null : trBul(metinYap(alt), metinYap(s), bas === undefined ? 1 : Math.round(sayiYap(bas)))));
  f('instr', bosVarsa((s, alt) => trBul(metinYap(alt), metinYap(s))));
  f('substring', (s, p, n) => {
    if (s === null || p === null || n === null) return null;
    const a = Array.from(metinYap(s));
    const pos = Math.round(sayiYap(p));
    if (pos === 0) return '';
    const bas = pos > 0 ? pos - 1 : a.length + pos;
    if (bas < 0 || bas >= a.length) return '';
    if (n === undefined) return a.slice(bas).join('');
    const k = Math.round(sayiYap(n));
    return k <= 0 ? '' : a.slice(bas, bas + k).join('');
  });
  f('substring_index', bosVarsa((s, ayrac, n) => {
    const m = metinYap(s);
    const a = metinYap(ayrac);
    const k = Math.round(sayiYap(n));
    if (!a || k === 0) return '';
    const parcalar = m.split(a);
    return k > 0 ? parcalar.slice(0, k).join(a) : parcalar.slice(k).join(a);
  }));
  f('strcmp', bosVarsa((a, b) => trKarsilastir(metinYap(a), metinYap(b))));
  f('ascii', bosVarsa((s) => {
    const b = kodlayici.encode(metinYap(s));
    return b.length ? b[0] : 0;
  }));
  f('ord', bosVarsa((s) => {
    const b = kodlayici.encode(Array.from(metinYap(s))[0] || '');
    let v = 0;
    for (const x of b) v = v * 256 + x;
    return v;
  }));
  f('hex', bosVarsa((v) => {
    if (typeof v === 'number') return Math.trunc(v).toString(16).toUpperCase();
    return Array.from(kodlayici.encode(metinYap(v)), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  }));
  f('field', (s, ...liste) => {
    if (s === null) return 0;
    const sayisal = typeof s === 'number';
    const i = liste.findIndex((x) => x !== null && (sayisal ? sayiYap(x) === s : trKarsilastir(metinYap(x), metinYap(s)) === 0));
    return i + 1;
  });
  f('elt', (n, ...liste) => {
    const k = n === null ? 0 : Math.round(sayiYap(n));
    return k >= 1 && k <= liste.length ? liste[k - 1] : null;
  });
  f('format', (x, d, yerel) => {
    if (x === null || d === null) return null;
    const k = Math.max(0, Math.min(30, Math.round(sayiYap(d))));
    const tr = yerel !== undefined && /^tr/i.test(metinYap(yerel) || '');
    const [tam, kesir] = ondalikMetin(sayiYap(x), k).replace('-', '').split('.');
    const neg = sayiYap(x) < 0 && /[1-9]/.test(tam + (kesir || ''));
    const gruplu = tam.replace(/\B(?=(\d{3})+(?!\d))/g, tr ? '.' : ',');
    return (neg ? '-' : '') + gruplu + (k ? (tr ? ',' : '.') + kesir : '');
  });
  f('round', (x, n) => (x === null || n === null ? null : yuvarla(x, n === undefined ? 0 : n)));
  f('truncate', bosVarsa((x, n) => kes(x, n)));
  f('log', (a, b) => {
    if (a === null || b === null) return null;
    if (b === undefined) {
      const v = sayiYap(a);
      return v > 0 ? Math.log(v) : null;
    }
    const t = sayiYap(a);
    const v = sayiYap(b);
    return t > 0 && t !== 1 && v > 0 ? Math.log(v) / Math.log(t) : null;
  });
  f('cot', bosVarsa((x) => 1 / Math.tan(sayiYap(x))));
  f('rand', () => Math.random(), false);
  f('greatest', (...a) => {
    if (a.some((x) => x === null)) return null;
    if (a.every((x) => typeof x === 'number')) return Math.max(...a);
    return a.map(metinYap).reduce((m, x) => (trKarsilastir(x, m) > 0 ? x : m));
  });
  f('least', (...a) => {
    if (a.some((x) => x === null)) return null;
    if (a.every((x) => typeof x === 'number')) return Math.min(...a);
    return a.map(metinYap).reduce((m, x) => (trKarsilastir(x, m) < 0 ? x : m));
  });
  f('like', (desen, metin, kacis) => {
    if (desen === null || metin === null || kacis === null) return null;
    const k = kacis === undefined ? '\\' : Array.from(metinYap(kacis))[0] || '';
    return trBenzer(metinYap(metin), metinYap(desen), k);
  });
  f('regexp', (desen, metin) => {
    if (desen === null || metin === null) return null;
    let re;
    try {
      re = new RegExp(metinYap(desen), 'iu');
    } catch (e) {
      throw new Error('MYSQL 3685 Illegal argument to a regular expression.');
    }
    return re.test(metinYap(metin)) ? 1 : 0;
  });

  // tarih ve saat
  const tarihli = (fn) => (v) => {
    const t = tarihAyir(v);
    return t ? fn(t) : null;
  };
  f('year', tarihli((t) => t.y));
  f('month', tarihli((t) => t.ay));
  f('day', tarihli((t) => t.g));
  f('dayofmonth', tarihli((t) => t.g));
  f('dayofweek', tarihli((t) => haftaGunu(t) + 1));
  f('weekday', tarihli((t) => (haftaGunu(t) + 6) % 7));
  f('dayofyear', tarihli((t) => yilGunu(t)));
  f('quarter', tarihli((t) => Math.ceil(t.ay / 3)));
  f('dayname', tarihli((t) => GUN_ADLARI[haftaGunu(t)]));
  f('monthname', tarihli((t) => AY_ADLARI[t.ay - 1]));
  f('week', (v, mod) => {
    const t = tarihAyir(v);
    if (!t) return null;
    const m = mod === undefined || mod === null ? 0 : Math.round(sayiYap(mod));
    return m === 3 || m === 1 ? isoHafta(t) : hafta0(t);
  });
  f('weekofyear', tarihli((t) => isoHafta(t)));
  f('last_day', tarihli((t) => tarihYaz({ y: t.y, ay: t.ay, g: ayGun(t.y, t.ay) })));
  const saatli = (fn) => (v) => {
    const t = saatAyir(v);
    return t ? fn(t) : null;
  };
  f('hour', saatli((t) => t.sa));
  f('minute', saatli((t) => t.dk));
  f('second', saatli((t) => t.sn));
  f('datediff', (a, b) => {
    const x = tarihAyir(a);
    const y = tarihAyir(b);
    return x && y ? gunNo(x) - gunNo(y) : null;
  });
  f('date_format', (v, b) => tarihBicimle(v, b));
  f('curdate', () => tarihYaz(simdi()), false);
  f('utc_date', () => new Date().toISOString().slice(0, 10), false);
  f('now', () => tarihSaatYaz(simdi()), false);
  f('curtime', () => {
    const t = simdi();
    return `${iki(t.sa)}:${iki(t.dk)}:${iki(t.sn)}`;
  }, false);
  f('mysql_tarih_ekle', (v, n, b) => tarihEkle(v, n, b, 1));
  f('mysql_tarih_cikar', (v, n, b) => tarihEkle(v, n, b, -1));
  f('mysql_extract', (birim, v) => {
    const t = tarihAyir(v) || saatAyir(v);
    if (!t) return null;
    switch (String(birim).toUpperCase()) {
      case 'YEAR':
        return t.y ?? null;
      case 'MONTH':
        return t.ay ?? null;
      case 'DAY':
        return t.g ?? null;
      case 'HOUR':
        return t.sa;
      case 'MINUTE':
        return t.dk;
      case 'SECOND':
        return t.sn;
      case 'QUARTER':
        return t.ay ? Math.ceil(t.ay / 3) : null;
      case 'WEEK':
        return t.y ? hafta0(t) : null;
      case 'YEAR_MONTH':
        return t.y ? t.y * 100 + t.ay : null;
      default:
        return null;
    }
  });
  f('mysql_timestampdiff', (birim, a, b) => {
    const x = tarihAyir(a);
    const y = tarihAyir(b);
    if (!x || !y) return null;
    const u = String(birim).toUpperCase();
    if (u === 'MONTH' || u === 'QUARTER' || u === 'YEAR') {
      const ay = ayFarki(x, y);
      return u === 'MONTH' ? ay : Math.trunc(ay / (u === 'QUARTER' ? 3 : 12));
    }
    const sn = (Date.UTC(y.y, y.ay - 1, y.g, y.sa, y.dk, y.sn) - Date.UTC(x.y, x.ay - 1, x.g, x.sa, x.dk, x.sn)) / 1000;
    const bolen = { SECOND: 1, MINUTE: 60, HOUR: 3600, DAY: 86400, WEEK: 604800 }[u];
    return bolen ? Math.trunc(sn / bolen) : null;
  });
  f('mysql_timestampadd', (birim, n, v) => tarihEkle(v, n, birim, 1));

  // dönüşümler
  f('mysql_tamsayi', (v) => {
    if (v === null) return null;
    if (typeof v === 'string') {
      const m = /^\s*[-+]?\d+/.exec(v);
      return m ? parseInt(m[0], 10) : 0;
    }
    return Number(ondalikMetin(sayiYap(v), 0));
  });
  f('mysql_ondalikla', (v, s) => (v === null ? null : Number(ondalikMetin(sayiYap(v), s))));
  f('mysql_ondalik', (v, s) => (v === null ? null : typeof v === 'number' ? ondalikMetin(v, s) : metinYap(v)));
  f('mysql_metin', (v, s) => (v === null ? null : s !== undefined && typeof v === 'number' ? ondalikMetin(v, s) : metinYap(v)));
  f('mysql_tarih', (v) => {
    const t = tarihAyir(v);
    return t ? tarihYaz(t) : null;
  });
  f('mysql_tarihsaat', (v) => {
    const t = tarihAyir(v);
    return t ? tarihSaatYaz(t) : null;
  });
  f('mysql_saat', (v) => {
    const t = saatAyir(v);
    return t ? `${iki(t.sa)}:${iki(t.dk)}:${iki(t.sn)}` : null;
  });
  f('mysql_kayan', (v) => (v === null ? null : sayiYap(v)));

  // oturum
  f('version', () => motor.surum);
  f('database', () => 'vt1');
  f('user', () => 'ogrenci@localhost');
}

/* ===================================================================
 * 8. Gösterim
 * =================================================================== */

export function goster(v, tip) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') v = Number(v);
  if (v instanceof Uint8Array) return '0x' + Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  const t = tip ? tip.t : 'any';
  if (typeof v === 'number') {
    if (t === 'dec') return ondalikMetin(v, tip.s);
    if (t === 'int') return Number.isInteger(v) ? String(v) : ondalikMetin(v, 0);
    if (t === 'float') return String(v);
    return Number.isInteger(v) ? String(v) : kisaSayi(v);
  }
  if (typeof v === 'string' && t === 'dec' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return ondalikMetin(parseFloat(v), tip.s);
  return String(v);
}

function tabloSonucu(sutunlar, satirlar) {
  return {
    tur: 'tablo',
    sutunlar,
    tipler: sutunlar.map(() => TIP.text),
    satirlar,
    metinler: satirlar.map((s) => s.map((v) => (v === null ? null : String(v)))),
    satirSayisi: satirlar.length,
    kesildi: false,
    ipuclari: [],
  };
}

const destekYok = (ne) => mysqlHata(null, null, `${ne} bu çalışma alanında desteklenmiyor. Burada sorgular (SELECT) ve kısa denemeler için INSERT/UPDATE/DELETE çalışır.`, { destek: true });

function benzerAd(ad, adlar) {
  const uzaklik = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    return d[a.length][b.length];
  };
  let en = null;
  let enU = 3;
  for (const x of adlar) {
    const u = uzaklik(ad.toLowerCase(), x.toLowerCase());
    if (u < enU) {
      en = x;
      enU = u;
    }
  }
  return en;
}

/* ===================================================================
 * 9. Motor
 * =================================================================== */

export class Motor {
  static async kur(sqlite3InitModule) {
    const sqlite3 = await sqlite3InitModule({ print: () => {}, printErr: () => {} });
    // Kütüphanenin kendi konsol uyarılarını sustur; hatalar zaten yakalanıp gösteriliyor.
    if (sqlite3.config) for (const k of ['warn', 'log', 'debug', 'error']) sqlite3.config[k] = () => {};
    const m = new Motor(sqlite3);
    m.baslat();
    return m;
  }

  constructor(sqlite3) {
    this.sqlite3 = sqlite3;
    this.capi = sqlite3.capi;
    this.wasm = sqlite3.wasm;
    this.surum = '8.4.0 (tarayıcıda SQLite ' + sqlite3.version.libVersion + ' ile)';
    this.bitis = 0;
  }

  baslat() {
    const { oo1, capi, wasm } = this.sqlite3;
    if (this.db) {
      try {
        this.db.close();
      } catch (e) {
        /* yoksay */
      }
    }
    this.db = new oo1.DB(':memory:', 'c');
    const ozucu = new TextDecoder();
    capi.sqlite3_create_collation_v2(
      this.db.pointer,
      DUZEN,
      capi.SQLITE_UTF8,
      0,
      (p, n1, p1, n2, p2) => {
        const h = wasm.heap8u();
        return trKarsilastir(ozucu.decode(h.subarray(p1, p1 + n1)), ozucu.decode(h.subarray(p2, p2 + n2)));
      },
      0,
    );
    fonksiyonlariKaydet(this.db, this);
    this.db.exec('PRAGMA foreign_keys = ON');
    for (const t of SEMA) for (const k of sqliteKomutlari(t)) this.db.exec(k);
    for (const t of SEMA) {
      const yer = t.sutunlar.map(() => '?').join(', ');
      for (const s of VERI[t.ad]) this.db.exec({ sql: `INSERT INTO ${t.ad} VALUES (${yer})`, bind: s });
    }
    const zaman = typeof performance !== 'undefined' ? performance : Date;
    capi.sqlite3_progress_handler(this.db.pointer, 5000, () => (this.bitis && zaman.now() > this.bitis ? 1 : 0), 0);
    this.zaman = zaman;
  }

  /** Bir ya da daha çok komutu çalıştırır; veri tabanı sonunda eski hâline döner. */
  calistir(src) {
    const sozcukler = sozcukle(src);
    const komutlar = komutlaraBol(sozcukler);
    const sonuclar = [];
    if (!komutlar.length) return { sonuclar };
    this.db.exec('SAVEPOINT pratik');
    try {
      for (const ft of komutlar) {
        const bas = this.zaman.now();
        let r;
        try {
          r = this.komut(src, ft);
        } catch (e) {
          r = mysqlHata(null, null, 'Beklenmedik bir hata: ' + (e && e.message ? e.message : String(e)));
        }
        r.sql = src.slice(ft[0].s, ft[ft.length - 1].e);
        r.sure = this.zaman.now() - bas;
        sonuclar.push(r);
        if (r.tur === 'hata') break;
      }
    } finally {
      try {
        this.db.exec('ROLLBACK TO pratik');
        this.db.exec('RELEASE pratik');
      } catch (e) {
        this.baslat();
      }
    }
    return { sonuclar };
  }

  komut(src, ft) {
    const kotu = ft.find((x) => x.tur === 'hata' || x.tur === 'akilli');
    if (kotu) return this.sozcukHatasi(src, ft, kotu);
    const ilk = ft[0];
    const u = ilk.tur === 'kelime' && !ilk.tirnakli ? ilk.ust : null;
    const ikinci = ft[1];
    if (u === 'USE') {
      const ad = ikinci && ikinci.tur === 'kelime' ? ikinci.deger : '';
      if (ft.length !== 2) return this.sozdizimi(src, ft, ft.length > 2 ? 2 : 1);
      return ad.toLowerCase() === 'vt1' ? { tur: 'mesaj', metin: 'Database changed' } : mysqlHata(1049, '42000', `Unknown database '${ad}'`);
    }
    if (u === 'SHOW') return this.goster(src, ft);
    if (u === 'DESCRIBE' || u === 'DESC' || (u === 'EXPLAIN' && ikinci && ikinci.tur === 'kelime' && !['SELECT', 'WITH', 'FORMAT', 'ANALYZE', 'UPDATE', 'DELETE', 'INSERT', 'TABLE'].includes(ikinci.ust))) {
      return this.tanimla(src, ft);
    }
    if (u === 'EXPLAIN') return destekYok('EXPLAIN');
    if (u === 'TABLE') {
      const kalan = src.slice(ft[1] ? ft[1].s : ilk.e, ft[ft.length - 1].e);
      const yeni = 'SELECT * FROM ' + kalan;
      const r = this.sorgu(yeni, komutlaraBol(sozcukle(yeni))[0]);
      return r;
    }
    if (u === 'SELECT' || u === 'WITH' || (ilk.tur === 'op' && ilk.deger === '(')) return this.sorgu(src, ft);
    if (['INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'CREATE', 'DROP', 'ALTER', 'TRUNCATE'].includes(u)) return this.degistir(src, ft, u);
    if (
      ['BEGIN', 'START', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE', 'SET', 'PRAGMA', 'ATTACH', 'DETACH', 'VACUUM', 'ANALYZE', 'REINDEX', 'GRANT', 'REVOKE', 'LOCK', 'UNLOCK', 'FLUSH', 'KILL', 'CALL', 'DO', 'HANDLER', 'LOAD', 'PREPARE', 'EXECUTE', 'DEALLOCATE', 'SOURCE'].includes(u)
    ) {
      return destekYok(u);
    }
    return this.sozdizimi(src, ft, 0);
  }

  sorgu(src, ft) {
    const isl = new Isleyici(src, ft);
    isl.sozcukIpuclari();
    let agac = null;
    let cozumHatasi = null;
    try {
      const c = new Cozumleyici(ft);
      agac = c.sorgu();
      if (c.i < ft.length) throw new CozumHatasi(c.i, 'fazla', true);
    } catch (e) {
      if (!(e instanceof CozumHatasi)) throw e;
      cozumHatasi = e;
      agac = null;
    }
    if (cozumHatasi) {
      if (cozumHatasi.kod === 1248) return mysqlHata(1248, '42000', 'Every derived table must have its own alias');
      if (cozumHatasi.kesin) return this.sozdizimi(src, ft, cozumHatasi.i);
      const ham = new Isleyici(src, ft);
      const { sql, harita } = ham.y.uret();
      const r = this.yurut(src, ft, sql, harita, ham, null);
      if (r.tur !== 'hata') r.ipuclari = isl.ipuclari;
      return r;
    }
    if (agac.sirala) isl.siralamaMetinleri = agac.sirala.map((t) => isl.metin(t.bas, t.eSon));
    isl.kok = agac;
    isl.siralama = [];
    const bilgi = isl.sorguIsle(agac, null, null);
    if (isl.hata) {
      if (isl.hata.konumIdx !== undefined) return this.sozdizimi(src, ft, isl.hata.konumIdx);
      return isl.hata;
    }
    const { sql, harita } = isl.y.uret();
    return this.yurut(src, ft, sql, harita, isl, bilgi);
  }

  degistir(src, ft, u) {
    const isl = new Isleyici(src, ft);
    if (u === 'TRUNCATE') {
      isl.y.degistir(0, 'DELETE FROM');
      if (ft[1] && ft[1].tur === 'kelime' && ft[1].ust === 'TABLE') isl.y.degistir(1, '');
    }
    if (u === 'CREATE') {
      ft.forEach((tk, i) => {
        if (tk.tur === 'kelime' && !tk.tirnakli && ['AUTO_INCREMENT', 'UNSIGNED'].includes(tk.ust)) isl.y.degistir(i, '');
        if (tk.tur === 'kelime' && !tk.tirnakli && ['ENGINE', 'CHARSET', 'CHARACTER'].includes(tk.ust)) {
          for (let k = i; k < ft.length; k++) isl.y.degistir(k, '');
        }
      });
    }
    const { sql, harita } = isl.y.uret();
    return this.yurut(src, ft, sql, harita, isl, null);
  }

  yurut(src, ft, sql, harita, isl, bilgi) {
    let stmt;
    this.bitis = this.zaman.now() + SURE_SINIRI;
    try {
      stmt = this.db.prepare(sql);
    } catch (e) {
      this.bitis = 0;
      return this.hataCevir(e, src, ft, harita, isl);
    }
    try {
      const adlar = stmt.columnCount ? stmt.getColumnNames() : [];
      if (!adlar.length) {
        while (stmt.step()) {
          /* sonuçsuz komut */
        }
        return { tur: 'tamam', etkilenen: this.db.changes() };
      }
      const satirlar = [];
      let sayi = 0;
      while (stmt.step()) {
        if (sayi < GOSTERIM_SINIRI) satirlar.push(stmt.get([]));
        sayi++;
        if (sayi >= SAYIM_SINIRI) break;
      }
      const tipler = bilgi && bilgi.sutunlar.length === adlar.length && !bilgi.sutunlar.some((s) => s.bilinmiyor) ? bilgi.sutunlar.map((s) => s.tip) : adlar.map(() => TIP.any);
      return {
        tur: 'tablo',
        sutunlar: adlar,
        tipler,
        satirlar,
        metinler: satirlar.map((s) => s.map((v, i) => goster(v, tipler[i]))),
        satirSayisi: sayi,
        kesildi: sayi > satirlar.length,
        cokFazla: sayi >= SAYIM_SINIRI,
        ipuclari: isl ? isl.ipuclari : [],
        siralama: isl && isl.siralama ? isl.siralama : null,
      };
    } catch (e) {
      return this.hataCevir(e, src, ft, harita, isl);
    } finally {
      try {
        stmt.finalize();
      } catch (e) {
        /* yoksay */
      }
      this.bitis = 0;
    }
  }

  sozdizimi(src, ft, tokIdx) {
    const bas = ft[0].s;
    const son = ft[ft.length - 1].e;
    const yer = tokIdx === null || tokIdx === undefined || tokIdx >= ft.length ? son : ft[tokIdx].s;
    const yakin = src.slice(yer, son).slice(0, 80);
    const satir = 1 + (src.slice(bas, yer).match(/\n/g) || []).length;
    return mysqlHata(1064, '42000', `You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near '${yakin}' at line ${satir}`, {
      konum: yer,
    });
  }

  sozcukHatasi(src, ft, tk) {
    if (tk.tur === 'akilli') {
      const h = this.sozdizimi(src, ft, ft.indexOf(tk));
      h.ozel = 'akilli';
      h.karakter = tk.ham;
      return h;
    }
    const h = this.sozdizimi(src, ft, ft.indexOf(tk));
    h.ozel = tk.neden;
    return h;
  }

  hataCevir(e, src, ft, harita, isl) {
    const ham = String((e && e.message) || e);
    const mesaj = ham.replace(/^SQLITE_[A-Z_]+:\s*/, '').replace(/^sqlite3 result code \d+:\s*/, '');
    const ofset = this.capi.sqlite3_error_offset(this.db.pointer);
    let m;
    const baglamBul = (ad) => {
      if (!isl) return 'field list';
      const k = isl.kullanimlar.find((x) => x.ad.toLowerCase() === ad.toLowerCase() || x.yalin.toLowerCase() === ad.toLowerCase());
      return k ? k.baglam : 'field list';
    };
    if ((m = /^no such column: (.+)$/.exec(mesaj))) {
      const ad = m[1].replace(/^"(.*)"$/, '$1');
      return mysqlHata(1054, '42S22', `Unknown column '${ad}' in '${baglamBul(ad)}'`, { sutun: ad });
    }
    if ((m = /^no such table: (?:main\.)?(.+)$/.exec(mesaj))) return mysqlHata(1146, '42S02', `Table 'vt1.${m[1]}' doesn't exist`, { tablo: m[1] });
    if ((m = /^ambiguous column name: (.+)$/.exec(mesaj))) {
      const ad = m[1].replace(/^.*\./, '');
      return mysqlHata(1052, '23000', `Column '${ad}' in ${baglamBul(ad)} is ambiguous`);
    }
    if (/syntax error|incomplete input|unrecognized token/.test(mesaj)) {
      let tok = null;
      if (ofset >= 0 && harita) {
        for (const h of harita) {
          if (h.bayt <= ofset) tok = h.tok;
          else break;
        }
      }
      if (/incomplete input/.test(mesaj)) tok = null;
      return this.sozdizimi(src, ft, tok);
    }
    if ((m = /^no such function: (.+)$/.exec(mesaj))) return mysqlHata(1305, '42000', `FUNCTION vt1.${m[1]} does not exist`);
    if ((m = /^wrong number of arguments to function (.+)\(\)$/.exec(mesaj))) return mysqlHata(1582, '42000', `Incorrect parameter count in the call to native function '${m[1]}'`);
    if (/^misuse of aggregate/.test(mesaj) || /^misuse of window function/.test(mesaj)) return mysqlHata(1111, 'HY000', 'Invalid use of group function');
    if ((m = /^CHECK constraint failed: (.+)$/.exec(mesaj))) return mysqlHata(3819, 'HY000', `Check constraint '${m[1]}' is violated.`);
    if ((m = /^UNIQUE constraint failed: (.+)$/.exec(mesaj))) {
      const [t, c] = m[1].split(', ')[0].split('.');
      const tablo = SEMA_HARITA.get(t);
      let anahtar = 'PRIMARY';
      if (tablo) {
        const uq = tablo.uq.find(([, s]) => s.includes(c));
        if (uq && !tablo.pk.includes(c)) anahtar = uq[0];
      }
      return mysqlHata(1062, '23000', `Duplicate entry for key '${t}.${anahtar}'`);
    }
    if (/^FOREIGN KEY constraint failed/.test(mesaj)) {
      const u = ft[0].ust;
      return u === 'DELETE' || u === 'DROP'
        ? mysqlHata(1451, '23000', 'Cannot delete or update a parent row: a foreign key constraint fails')
        : mysqlHata(1452, '23000', 'Cannot add or update a child row: a foreign key constraint fails');
    }
    if ((m = /^NOT NULL constraint failed: \w+\.(\w+)$/.exec(mesaj))) return mysqlHata(1048, '23000', `Column '${m[1]}' cannot be null`);
    if ((m = /^table (\w+) already exists$/.exec(mesaj))) return mysqlHata(1050, '42S01', `Table '${m[1]}' already exists`);
    if ((m = /^(\d+)\w* ORDER BY term (?:does not match any column in the result set|out of range)/.exec(mesaj))) {
      const terim = isl && isl.siralamaMetinleri ? isl.siralamaMetinleri[+m[1] - 1] : null;
      return mysqlHata(1054, '42S22', `Unknown column '${terim ?? m[1]}' in 'order clause'`);
    }
    if (/^sub-select returns \d+ columns - expected 1$/.test(mesaj) || /^row value misused$/.test(mesaj)) return mysqlHata(1241, '21000', 'Operand should contain 1 column(s)');
    if (/do not have the same number of result columns/.test(mesaj)) return mysqlHata(1222, '21000', 'The used SELECT statements have a different number of columns');
    if (/interrupted/.test(mesaj)) return mysqlHata(3024, 'HY000', 'Query execution was interrupted, maximum statement execution time exceeded', { zaman: true });
    if ((m = /MYSQL (\d+) (.+)$/.exec(mesaj))) return mysqlHata(+m[1], 'HY000', m[2]);
    if (/scalar subquery|more than one row/.test(mesaj)) return mysqlHata(1242, '21000', 'Subquery returns more than 1 row');
    return mysqlHata(null, null, mesaj, { sqlite: true });
  }

  goster(src, ft) {
    const w = ft.map((t) => (t.tur === 'kelime' && !t.tirnakli ? t.ust : t.tur === 'kelime' ? t.deger : t.deger ?? t.ham));
    let i = 1;
    const full = w[i] === 'FULL';
    if (full) i++;
    if (w[i] === 'TABLES') {
      let adlar = SEMA.map((t) => t.ad).sort();
      const likeIdx = w.indexOf('LIKE');
      if (likeIdx > 0 && ft[likeIdx + 1] && ft[likeIdx + 1].tur === 'metin') adlar = adlar.filter((a) => trBenzer(a, ft[likeIdx + 1].deger, '\\'));
      return tabloSonucu(full ? ['Tables_in_vt1', 'Table_type'] : ['Tables_in_vt1'], adlar.map((a) => (full ? [a, 'BASE TABLE'] : [a])));
    }
    if (w[i] === 'DATABASES' || w[i] === 'SCHEMAS') return tabloSonucu(['Database'], [['information_schema'], ['mysql'], ['performance_schema'], ['sys'], ['vt1']]);
    if (w[i] === 'COLUMNS' || w[i] === 'FIELDS') {
      const k = ft.findIndex((t, j) => j > i && t.tur === 'kelime' && (t.ust === 'FROM' || t.ust === 'IN'));
      return this.tanimTablosu(ft, k + 1);
    }
    if (w[i] === 'CREATE' && w[i + 1] === 'TABLE') {
      const t = this.tabloAdiOku(ft, i + 2);
      if (!t.tablo) return mysqlHata(1146, '42S02', `Table 'vt1.${t.ad}' doesn't exist`, { tablo: t.ad });
      return tabloSonucu(['Table', 'Create Table'], [[t.tablo.ad, mysqlOlusturMetni(t.tablo)]]);
    }
    if (w[i] === 'INDEX' || w[i] === 'INDEXES' || w[i] === 'KEYS') {
      const k = ft.findIndex((t, j) => j > i && t.tur === 'kelime' && (t.ust === 'FROM' || t.ust === 'IN'));
      const t = this.tabloAdiOku(ft, k + 1);
      if (!t.tablo) return mysqlHata(1146, '42S02', `Table 'vt1.${t.ad}' doesn't exist`, { tablo: t.ad });
      const tb = t.tablo;
      const satirlar = [];
      const ekle = (ad, sutunlar, tekil) => sutunlar.forEach((c, j) => satirlar.push([tb.ad, tekil ? 0 : 1, ad, j + 1, c]));
      ekle('PRIMARY', tb.pk, true);
      for (const [ad, s] of tb.uq) ekle(ad, s, true);
      for (const [ad, s] of fkDizinleri(tb)) ekle(ad, s, false);
      return tabloSonucu(['Table', 'Non_unique', 'Key_name', 'Seq_in_index', 'Column_name'], satirlar);
    }
    if (w[i] === 'WARNINGS' || w[i] === 'ERRORS') return tabloSonucu(['Level', 'Code', 'Message'], []);
    return destekYok('Bu SHOW komutu');
  }

  tabloAdiOku(ft, i) {
    let tk = ft[i];
    if (!tk) return { ad: '', tablo: null };
    if (ft[i + 1] && ft[i + 1].tur === 'op' && ft[i + 1].deger === '.' && ft[i + 2]) {
      if (String(tk.deger).toLowerCase() !== 'vt1') return { ad: `${tk.deger}.${ft[i + 2].deger}`, tablo: null };
      tk = ft[i + 2];
    }
    const ad = String(tk.deger ?? tk.ham);
    return { ad, tablo: SEMA_HARITA.get(ad.toLowerCase()) || null };
  }

  tanimla(src, ft) {
    return this.tanimTablosu(ft, 1);
  }

  tanimTablosu(ft, i) {
    const t = this.tabloAdiOku(ft, i);
    if (!t.ad) return this.sozdizimi('', ft, ft.length);
    if (!t.tablo) return mysqlHata(1146, '42S02', `Table 'vt1.${t.ad}' doesn't exist`, { tablo: t.ad });
    const tb = t.tablo;
    return tabloSonucu(
      ['Field', 'Type', 'Null', 'Key', 'Default', 'Extra'],
      tb.sutunlar.map((c) => [c.ad, c.tip.toLowerCase(), c.bos ? 'YES' : 'NO', anahtarTuru(tb, c.ad), null, '']),
    );
  }
}

/* ===================================================================
 * 10. Hata açıklamaları (Türkçe)
 * =================================================================== */

const METIN_DEGERLERI = new Set();
for (const t of SEMA) {
  VERI[t.ad].forEach((satir) =>
    satir.forEach((v, i) => {
      if (typeof v === 'string' && /CHAR/.test(t.sutunlar[i].tip)) METIN_DEGERLERI.add(v.toLowerCase());
    }),
  );
}

export function hataAciklamasi(h) {
  if (!h || h.tur !== 'hata') return null;
  if (h.ozel === 'akilli') return `“${h.karakter}” bir yazı tipi işareti; SQL'de tırnak olarak düz tek tırnak ( ' ), eksi için düz kısa çizgi ( - ) yazılır. Kitaptan ya da sunumdan kopyaladıysan tırnakları yeniden yaz.`;
  if (h.ozel === 'tirnak') return 'Bir tırnak açılmış ama kapanmamış. Metin değerleri iki tek tırnak arasında yazılır: \'VT1\'.';
  if (h.ozel === 'yorum') return 'Bir /* yorum */ açılmış ama kapanmamış.';
  if (h.ozel === 'ters') return 'Bir ` ters tırnak açılmış ama kapanmamış.';
  switch (h.kod) {
    case 1054: {
      if (h.takmaWhere) return `“${h.takmaWhere}” SELECT’te verdiğin bir takma ad. WHERE, SELECT’ten önce çalışır; o anda takma ad henüz yoktur. Koşulda ifadeyi yeniden yaz (takma adı ORDER BY’da kullanabilirsin).`;
      const ad = (h.sutun || (/'([^']+)'/.exec(h.mesaj) || [])[1] || '').replace(/^.*\./, '');
      if (/^\d+$/.test(ad)) return `ORDER BY ${ad}: sonuçta ${ad}. sütun yok. Sıra numarası 1 ile SELECT listesindeki sütun sayısı arasında olmalı.`;
      const tablolar = SEMA.filter((t) => t.sutunlar.some((c) => c.ad === ad.toLowerCase())).map((t) => t.ad);
      if (METIN_DEGERLERI.has(ad.toLowerCase())) return `“${ad}” bir sütun adı değil, verideki bir değer gibi görünüyor. Metin değerleri tek tırnakla yazılır: '${ad}'.`;
      if (tablolar.length) return `Bu sorgunun tablosunda “${ad}” sütunu yok; ${tablolar.join(', ')} tablosunda var. Doğru tabloyu seçtiğinden emin ol (DESCRIBE ${tablolar[0]};).`;
      const benzer = benzerAd(ad, SEMA.flatMap((t) => t.sutunlar.map((c) => c.ad)));
      return `“${ad}” adında bir sütun yok.${benzer ? ` Şunu mu demek istedin: ${benzer}?` : ''} Sütun adlarını DESCRIBE tablo; ile görebilirsin.`;
    }
    case 1146: {
      const benzer = benzerAd(String(h.tablo || '').replace(/^.*\./, ''), SEMA.map((t) => t.ad));
      return `Bu adla bir tablo yok.${benzer ? ` Şunu mu demek istedin: ${benzer}?` : ''} Tabloları SHOW TABLES; ile görebilirsin.`;
    }
    case 1064:
      return 'Sözdizimi hatası: MySQL komutu okuyamadı. “near” sonrasında gösterilen yer hatanın başladığı yerdir; çoğu zaman hemen öncesinde eksik bir virgül, tırnak ya da parantez vardır, ya da parçalar yanlış sırada yazılmıştır (SELECT … FROM … WHERE … ORDER BY … LIMIT).';
    case 3065:
      return 'DISTINCT kullanılan bir sorguda ORDER BY yalnız seçilen sütunlara göre yapılabilir. Sıralama sütununu SELECT listesine ekle ya da başka bir sütuna göre sırala.';
    case 1140:
    case 1055:
      return 'Toplama fonksiyonu (COUNT, SUM, AVG…) kullanılan bir sorguda, toplanmayan her sütun GROUP BY’da yazılmalı.';
    case 1305:
      return 'MySQL’de bu adla bir fonksiyon yok. Adı doğru mu yazdın? (Örneğin uzunluk için CHAR_LENGTH, birleştirme için CONCAT.)';
    case 1582:
      return 'Fonksiyona yanlış sayıda argüman verildi.';
    case 1111:
      return 'Toplama fonksiyonları (COUNT, SUM, AVG, MIN, MAX) WHERE içinde kullanılamaz.';
    case 1052:
      return 'Bu sütun birden çok tabloda var; hangisini istediğini tablo adıyla belirt: kisi.ad gibi.';
    case 1248:
      return 'FROM içindeki alt sorguya bir takma ad ver: (SELECT …) AS t.';
    case 1049:
      return 'Bu çalışma alanında yalnız vt1 veri tabanı var: USE vt1;';
    case 3819:
      return 'Bu değer tablonun CHECK kuralını çiğniyor (örneğin not 0–100 arasında olmalı). Değişiklik yapılmadı.';
    case 1062:
      return 'Aynı anahtar değeri zaten var; birincil ya da benzersiz anahtar tekrar edemez.';
    case 1451:
    case 1452:
      return 'Yabancı anahtar kuralı: başka tablodaki bir satır bu kayda bağlı ya da bağlanılan kayıt yok.';
    case 1048:
      return 'Bu sütun boş (NULL) kalamaz.';
    case 1241:
      return 'Tek değer beklenen yerde birden çok sütun döndüren bir ifade var.';
    case 1222:
      return 'UNION ile birleştirilen sorgular aynı sayıda sütun döndürmeli.';
    case 3024:
      return 'Sorgu çok uzun sürdü ve durduruldu. Çok büyük bir sonuç (örneğin koşulsuz tablo çarpımı) üretiyor olabilir.';
    case 1273:
      return 'Bu adla bir karşılaştırma düzeni yok. vt1’in düzeni utf8mb4_turkish_ci.';
    default:
      return null;
  }
}

/* ===================================================================
 * 11. Sonuç karşılaştırma (görev denetimi)
 * =================================================================== */

function hucreNorm(v, harfDuyarsiz) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') v = Number(v);
  if (typeof v === 'number') return Math.round(v * 1e6) / 1e6;
  if (typeof v === 'string') {
    const t = v.trim();
    if (/^-?\d+(\.\d+)?$/.test(t)) return Math.round(parseFloat(t) * 1e6) / 1e6;
    return harfDuyarsiz ? v.toLocaleLowerCase('tr-TR') : v;
  }
  return String(v);
}
const hucreAnahtar = (x) => (x === null ? '\u0000N' : typeof x === 'number' ? 'n:' + x : 's:' + x);

function cokluKume(dizi) {
  const m = new Map();
  for (const x of dizi) {
    const k = hucreAnahtar(x);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

function kumeEsit(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

/** MySQL sıralaması: NULL en küçük, sayılar sayısal, metinler Türkçe düzen. */
function siraKarsilastir(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'number') return -1;
  if (typeof b === 'number') return 1;
  return trKarsilastir(String(a), String(b));
}

const vektorler = (sonuc, hd) => sonuc.sutunlar.map((_, j) => sonuc.satirlar.map((s) => hucreNorm(s[j], hd)));

/** Referans sütunlarını (alt) kullanıcının sütunlarına değerleriyle eşler. */
function eslestir(alt, refVek, kulVek, kulAdlar, refAdlar, n) {
  const adaylar = alt.map((j) => {
    const hedef = cokluKume(refVek[j]);
    const liste = [];
    kulVek.forEach((v, k) => {
      if (kumeEsit(cokluKume(v), hedef)) liste.push(k);
    });
    const ayniAd = (k) => (kulAdlar[k].toLowerCase() === refAdlar[j] ? 0 : 1);
    liste.sort((a, b) => ayniAd(a) - ayniAd(b) || a - b);
    return liste;
  });
  const secim = [];
  const kullanildi = new Set();
  const anahtar = (cols, vek, i) => cols.map((c) => hucreAnahtar(vek[c][i])).join('\u0001');
  const dene = (p) => {
    if (p === alt.length) {
      const a = new Map();
      const r = new Map();
      for (let i = 0; i < n; i++) {
        const ka = anahtar(secim, kulVek, i);
        const kr = anahtar(alt, refVek, i);
        a.set(ka, (a.get(ka) || 0) + 1);
        r.set(kr, (r.get(kr) || 0) + 1);
      }
      return kumeEsit(a, r);
    }
    for (const k of adaylar[p]) {
      if (kullanildi.has(k)) continue;
      kullanildi.add(k);
      secim.push(k);
      if (dene(p + 1)) return true;
      secim.pop();
      kullanildi.delete(k);
    }
    return false;
  };
  return dene(0) ? [...secim] : null;
}

function ornekDegerler(sonuc, j) {
  const v = sonuc.metinler.map((s) => (s[j] === null ? 'NULL' : s[j]));
  const essiz = [...new Set(v)];
  return essiz.slice(0, 5).join(', ') + (essiz.length > 5 ? ', …' : '');
}

/** Satır sayısı farklıysa fazla ve eksik satırları anahtar sütunlarla gösterir. */
function satirFarki(kul, ref, alternatifler) {
  const refAdlar = ref.sutunlar.map((s) => s.toLowerCase());
  for (const alt of alternatifler) {
    const eslesme = alt.map((j) => kul.sutunlar.findIndex((ad) => ad.toLowerCase() === refAdlar[j]));
    if (eslesme.some((k) => k < 0)) continue;
    const anahtar = (sonuc, cols, i) => cols.map((c) => (sonuc.satirlar[i][c] === null ? 'NULL' : sonuc.metinler[i][c])).join(' · ');
    const say = (sonuc, cols) => {
      const m = new Map();
      for (let i = 0; i < sonuc.satirlar.length; i++) {
        const a = anahtar(sonuc, cols, i);
        m.set(a, (m.get(a) || 0) + 1);
      }
      return m;
    };
    const kulSay = say(kul, eslesme);
    const refSay = say(ref, alt);
    const fazla = [];
    const eksik = [];
    for (const [a, s] of kulSay) for (let i = 0; i < s - (refSay.get(a) || 0); i++) fazla.push(a);
    for (const [a, s] of refSay) for (let i = 0; i < s - (kulSay.get(a) || 0); i++) eksik.push(a);
    if (!fazla.length && !eksik.length) return null;
    const baslik = alt.map((j) => ref.sutunlar[j]).join(' · ');
    const parca = [];
    if (fazla.length) parca.push(`fazladan gelen ${fazla.length}: ${fazla.slice(0, 4).join(' | ')}${fazla.length > 4 ? ' …' : ''}`);
    if (eksik.length) parca.push(`eksik kalan ${eksik.length}: ${eksik.slice(0, 4).join(' | ')}${eksik.length > 4 ? ' …' : ''}`);
    return `(${baslik}) ${parca.join('; ')}`;
  }
  return null;
}

/**
 * Kullanıcının sonucunu görevin referans sonucuyla karşılaştırır.
 * kural: {
 *   mod: 'tam' (yalnız istenen sütunlar) | 'anahtar' (istenen sütunlar bulunsun, fazlası serbest),
 *   anahtar: [[sütun, …], …]   // 'anahtar' kipinde yeterli sütun takımları (biri yeter)
 *   sira: [[sütun, 'ASC'|'DESC'], …]   // istenen sıralama; eşitlikler serbest
 *   adlar: { refSütun: 'başlık' }      // istenen sütun başlığı (takma ad)
 *   yanlislar: { <satır sayısı>: 'ipucu', deger: 'ipucu' }
 *   gerekli: [{ re, mesaj }]           // sorgu metninde bulunması istenen yazılış
 * }
 */
export function karsilastir(kul, ref, kural = {}, sql = '') {
  const sonuc = { dogru: false, durum: 'yanlis', mesajlar: [] };
  if (!kul || kul.tur !== 'tablo') {
    sonuc.mesajlar.push('Sonuç tablosu gelmedi; önce sorgunun çalıştığından emin ol.');
    return sonuc;
  }
  const refAdlar = ref.sutunlar.map((s) => s.toLowerCase());
  const idx = (ad) => {
    const j = refAdlar.indexOf(String(ad).toLowerCase());
    if (j < 0) throw new Error('kuralda bilinmeyen sütun: ' + ad);
    return j;
  };
  const tamMod = (kural.mod || 'tam') === 'tam';
  const alternatifler = tamMod ? [refAdlar.map((_, j) => j)] : (kural.anahtar || [ref.sutunlar]).map((alt) => alt.map(idx));
  const sira = (kural.sira || []).map(([ad, yon]) => ({ j: idx(ad), azalan: /^desc$/i.test(yon || '') }));
  const n = ref.satirSayisi;

  if (kul.satirSayisi !== n) {
    sonuc.mesajlar.push(`Beklenen ${n} satır; senin sorgun ${kul.satirSayisi} satır getirdi.`);
    const ozel = kural.yanlislar && kural.yanlislar[kul.satirSayisi];
    if (ozel) sonuc.mesajlar.push(ozel);
    const fark = satirFarki(kul, ref, alternatifler);
    if (fark) sonuc.mesajlar.push(fark);
    return sonuc;
  }

  for (const hd of [false, true]) {
    const refVek = vektorler(ref, hd);
    const kulVek = vektorler(kul, hd);
    for (const alt of alternatifler) {
      const eslesme = eslestir(alt, refVek, kulVek, kul.sutunlar, refAdlar, n);
      if (!eslesme) continue;
      if (hd) {
        const refCs = vektorler(ref, false);
        const kulCs = vektorler(kul, false);
        const farkli = alt.filter((j, p) => !kumeEsit(cokluKume(kulCs[eslesme[p]]), cokluKume(refCs[j])));
        sonuc.durum = 'yakin';
        sonuc.mesajlar.push(
          'Satırlar doğru, yalnız büyük/küçük harf farkı var: ' +
            farkli.map((j) => `“${ref.sutunlar[j]}” (beklenen: ${ornekDegerler(ref, j)})`).join('; ') +
            '.',
        );
        return sonuc;
      }
      return sonucuTamamla(sonuc, { kul, ref, kural, sql, alt, eslesme, sira, tamMod, refVek, kulVek, refAdlar, n });
    }
  }

  sonuc.mesajlar.push('Satır sayısı tutuyor ama değerler beklenenden farklı.');
  const refVek = vektorler(ref, false);
  const kulVek = vektorler(kul, false);
  const alt = alternatifler[0];
  const eksik = alt.filter((j) => !kulVek.some((v) => kumeEsit(cokluKume(v), cokluKume(refVek[j]))));
  if (eksik.length) {
    const parca = eksik.slice(0, 2).map((j) => {
      const k = kul.sutunlar.findIndex((ad) => ad.toLowerCase() === refAdlar[j]);
      const senin = k >= 0 ? ` · seninki: ${ornekDegerler(kul, k)}` : '';
      return `“${ref.sutunlar[j]}” (beklenen: ${ornekDegerler(ref, j)}${senin})`;
    });
    sonuc.mesajlar.push(`Şu sütun sonuçta yok ya da değerleri farklı: ${parca.join('; ')}.`);
  } else sonuc.mesajlar.push('Sütunların her biri tek başına doğru, ama satırlarda değerler yanlış eşleşmiş.');
  if (kural.yanlislar && kural.yanlislar.deger) sonuc.mesajlar.push(kural.yanlislar.deger);
  return sonuc;
}

function sonucuTamamla(sonuc, b) {
  const { kul, ref, kural, sql, alt, eslesme, sira, tamMod, refVek, kulVek, refAdlar, n } = b;
  const notlar = [];
  if (kural.sirali || sira.length) {
    let siraTamam;
    const eksikSira = sira.filter((s) => !alt.includes(s.j)).map((s) => s.j);
    const genis = [...alt, ...eksikSira];
    const genisEslesme = eksikSira.length ? eslestir(genis, refVek, kulVek, kul.sutunlar, refAdlar, n) : eslesme;
    if (sira.length && genisEslesme) {
      const sutun = (j) => genisEslesme[genis.indexOf(j)];
      siraTamam = true;
      for (let i = 1; i < n && siraTamam; i++) {
        for (const s of sira) {
          const k = sutun(s.j);
          let c = siraKarsilastir(kul.satirlar[i - 1][k], kul.satirlar[i][k]);
          if (s.azalan) c = -c;
          if (c < 0) break;
          if (c > 0) {
            siraTamam = false;
            break;
          }
        }
      }
    } else {
      siraTamam = eslesme.every((k, p) => kulVek[k].every((x, i) => hucreAnahtar(x) === hucreAnahtar(refVek[alt[p]][i])));
    }
    const istenen = sira.length ? sira.map((s) => `${ref.sutunlar[s.j]}${s.azalan ? ' DESC' : ''}`).join(', ') : 'soruda istenen sıra';
    if (!siraTamam) {
      sonuc.durum = 'yakin';
      sonuc.mesajlar.push(`Satırlar doğru ama sıra yanlış. İstenen sıralama: ORDER BY ${istenen}.`);
      return sonuc;
    }
    if (sira.length && Array.isArray(kul.siralama)) {
      const ters = new Map();
      const ileri = new Map();
      if (genisEslesme) {
        genis.forEach((j, p) => {
          ters.set(genisEslesme[p], j);
          ileri.set(j, genisEslesme[p]);
        });
      }
      const deger = (k, i) => kul.satirlar[i][k];
      for (let p = 0; p < sira.length; p++) {
        const t = kul.siralama[p];
        const g = sira[p];
        if (!t) {
          sonuc.durum = 'yakin';
          sonuc.mesajlar.push(
            `Satırlar bu veride doğru sırada geldi, ama eşit değerlerin sırası güvence altında değil: ${p + 1}. sıralama ölçütü (${ref.sutunlar[g.j]}${g.azalan ? ' DESC' : ''}) eksik. İstenen: ORDER BY ${istenen}.`,
          );
          return sonuc;
        }
        const j = t.idx >= 0 && ters.has(t.idx) ? ters.get(t.idx) : t.ad ? refAdlar.indexOf(t.ad.toLowerCase()) : -1;
        if (j === g.j && t.azalan === g.azalan) continue;
        // Farklı yazılmış ama aynı sırayı veren ölçüt (ör. gun DESC yerine kayit_tarihi DESC) kabul edilir.
        let esdeger = false;
        const kR = ileri.get(g.j);
        const onceki = sira.slice(0, p).map((x) => ileri.get(x.j));
        if (t.idx >= 0 && kR !== undefined && onceki.every((k) => k !== undefined)) {
          esdeger = true;
          for (let a = 0; a < n && esdeger; a++) {
            for (let b = a + 1; b < n; b++) {
              if (onceki.some((k) => siraKarsilastir(deger(k, a), deger(k, b)) !== 0)) continue;
              const su = Math.sign(siraKarsilastir(deger(t.idx, a), deger(t.idx, b))) * (t.azalan ? -1 : 1);
              const sr = Math.sign(siraKarsilastir(deger(kR, a), deger(kR, b))) * (g.azalan ? -1 : 1);
              if (su !== sr) {
                esdeger = false;
                break;
              }
            }
          }
        }
        if (!esdeger) {
          sonuc.durum = 'yakin';
          sonuc.mesajlar.push(`Sıralama ölçütleri sorudakiyle aynı değil. İstenen: ORDER BY ${istenen}.`);
          return sonuc;
        }
      }
    }
  }
  if (tamMod && kul.sutunlar.length > ref.sutunlar.length) {
    const fazla = kul.sutunlar.filter((_, k) => !eslesme.includes(k));
    sonuc.durum = 'yakin';
    sonuc.mesajlar.push(`Satırlar doğru, ama soru şu sütunları istemiyor: ${fazla.join(', ')}. Yalnız istenenleri yaz: ${ref.sutunlar.join(', ')}.`);
    return sonuc;
  }
  if (kural.adlar) {
    for (const [refAd, istenen] of Object.entries(kural.adlar)) {
      const p = alt.indexOf(refAdlar.indexOf(refAd.toLowerCase()));
      if (p < 0) continue;
      if (kul.sutunlar[eslesme[p]].toLowerCase() !== istenen.toLowerCase()) {
        sonuc.durum = 'yakin';
        sonuc.mesajlar.push(`Değerler doğru; yalnız sütun başlığı “${istenen}” olmalı: … AS ${istenen}`);
        return sonuc;
      }
    }
  }
  for (const g of kural.gerekli || []) {
    if (!g.re.test(sql)) {
      sonuc.durum = 'yakin';
      sonuc.mesajlar.push('Sonuç doğru. ' + g.mesaj);
      return sonuc;
    }
  }
  if (tamMod && eslesme.some((k, p) => k !== p)) notlar.push('Sütunların sırası kitaptakinden farklı; sonuç yine doğru.');
  sonuc.dogru = true;
  sonuc.durum = 'dogru';
  sonuc.mesajlar = notlar;
  return sonuc;
}

/** "Hatayı bilerek yap" deneyleri: beklenen hata ya da satır sayısı. */
export function deneyDenetle(sonuclar, deney, sql) {
  const r = { dogru: false, durum: 'yanlis', mesajlar: [] };
  const son = sonuclar[sonuclar.length - 1];
  if (!son) {
    r.mesajlar.push('Önce bir sorgu yaz ve çalıştır.');
    return r;
  }
  for (const g of deney.gerekli || []) {
    if (!g.re.test(sql)) {
      r.mesajlar.push(g.mesaj);
      return r;
    }
  }
  if (deney.hata !== undefined) {
    if (son.tur === 'hata' && son.kod === deney.hata) {
      r.dogru = true;
    } else {
      r.mesajlar.push(son.tur === 'hata' ? `Bu deneyde ERROR ${deney.hata} bekleniyordu; gelen ERROR ${son.kod ?? '?'}.` : `Bu deneyde ERROR ${deney.hata} bekleniyordu, ama sorgu çalıştı.`);
      return r;
    }
  }
  if (deney.satir !== undefined) {
    if (son.tur !== 'tablo') {
      r.mesajlar.push('Sorgu çalışmadı; deneyde bir sonuç tablosu bekleniyor.');
      return r;
    }
    if (son.satirSayisi !== deney.satir) {
      r.mesajlar.push(`Bu deneyde ${deney.satir} satır bekleniyordu; senin sorgun ${son.satirSayisi} satır getirdi.`);
      return r;
    }
    r.dogru = true;
  }
  if (deney.nullSayisi !== undefined && son.tur === 'tablo') {
    const var_ = son.sutunlar.some((_, j) => son.satirlar.filter((s) => s[j] === null).length === deney.nullSayisi);
    if (!var_) {
      r.dogru = false;
      r.mesajlar.push(`Bir sütunda ${deney.nullSayisi} NULL görmen bekleniyordu.`);
      return r;
    }
  }
  if (deney.ilkSatir && son.tur === 'tablo') {
    const ilk = (son.metinler[0] || []).map((x) => (x === null ? 'NULL' : x));
    if (ilk.length !== deney.ilkSatir.length || ilk.some((x, i) => x !== deney.ilkSatir[i])) {
      r.dogru = false;
      r.mesajlar.push(`Beklenen satır: ${deney.ilkSatir.join(' | ')}`);
      return r;
    }
    r.dogru = true;
  }
  if (r.dogru) r.durum = 'dogru';
  return r;
}
