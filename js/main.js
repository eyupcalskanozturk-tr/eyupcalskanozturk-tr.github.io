(() => {
  "use strict";

  // Formspree hesabın varsa paneldeki /f/... form adresini bu alana yaz.
  // Boş bırakıldığında gerçek e-posta adresine bir mailto taslağı açılır.
  const CONFIG = Object.freeze({
    github: "eyupcalskanozturk-tr",
    email: "eyupcalskanofficial@gmail.com",
    linkedin: "https://www.linkedin.com/in/eyüp-çalişkanöztürk-413208273",
    formspreeEndpoint: "",
    maxRepos: 6,
    timeZone: "Europe/Istanbul",
    utcOffset: 3,   // Türkiye 2016'dan beri yıl boyu UTC+3
    lat: 40.1553,   // Çanakkale
    lon: 26.4142
  });
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  let reducedMotion = motionPreference.matches;
  let userPaused = false;
  try { userPaused = localStorage.getItem("portfolio-motion") === "paused"; } catch { /* Depolama isteğe bağlıdır. */ }
  const motionPaused = () => userPaused || reducedMotion || document.hidden;
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

  // Bağlantılarda sadece web protokollerine izin ver; API metnini HTML olarak işleme.
  function webURL(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
      const url = new URL(value);
      return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
    } catch { return ""; }
  }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  async function fetchWithTimeout(url, options = {}, ms = 12000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ms);
    try { return await fetch(url, { ...options, signal: controller.signal }); }
    finally { clearTimeout(timeout); }
  }

  function initMotion() {
    const button = $("#motion-toggle");
    button.hidden = false;
    function update() {
      const paused = motionPaused();
      document.documentElement.classList.toggle("motion-paused", paused);
      button.disabled = reducedMotion;
      button.setAttribute("aria-pressed", String(userPaused || reducedMotion));
      button.textContent = reducedMotion ? "Hareket azaltma açık" : userPaused ? "Hareketi başlat" : "Hareketi durdur";
      document.dispatchEvent(new CustomEvent("motionchange", { detail: paused }));
    }
    button.addEventListener("click", () => {
      userPaused = !userPaused;
      try { localStorage.setItem("portfolio-motion", userPaused ? "paused" : "running"); } catch { /* Tercih bu oturumda uygulanır. */ }
      update();
    });
    motionPreference.addEventListener("change", (event) => { reducedMotion = event.matches; update(); });
    document.addEventListener("visibilitychange", update);
    update();
  }

  function initClock() {
    const target = $("#clock-footer");
    if (!target) return;
    let format;
    try { format = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: CONFIG.timeZone }); }
    catch { return; }
    const tick = () => { target.textContent = format.format(new Date()); };
    tick();
    setInterval(tick, 30000);
  }

  // ───────── Renk yardımcıları ─────────
  const hex = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const rgb = (c, alpha = 1) => {
    const [r, g, b] = c.map((v) => Math.round(clamp(v, 0, 255)));
    return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1).toFixed(3)})`;
  };
  const toHex = (c) => "#" + c.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("");
  const luminance = (c) => {
    const [r, g, b] = c.map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
    return .2126 * r + .7152 * g + .0722 * b;
  };

  // ───────── Güneşin konumu (USNO yaklaşık formülü, yaklaşık 1° hassasiyet) ─────────
  function sunPosition(date) {
    const rad = Math.PI / 180;
    const d = date.getTime() / 86400000 - 10957.5;           // J2000.0'dan beri geçen gün
    const g = (357.529 + 0.98560028 * d) * rad;              // ortalama anomali
    const q = 280.459 + 0.98564736 * d;                      // ortalama boylam
    const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad;
    const e = (23.439 - 0.00000036 * d) * rad;               // eksen eğikliği
    const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / rad;
    const dec = Math.asin(Math.sin(e) * Math.sin(L));
    const gmst = 18.697374558 + 24.06570982441908 * d;
    const hourAngle = (((gmst * 15 + CONFIG.lon - ra) % 360) + 540) % 360 - 180;
    const lat = CONFIG.lat * rad;
    const alt = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle * rad)) / rad;
    return { alt, hourAngle };
  }

  // Güneşin yüksekliğine göre palet: [yükseklik°, gök üstü, gök ortası, ufuk, güneş, hale, vurgu]
  const NIGHT = [
    [-90, "#10154a", "#2a2f86", "#5b4fb8", "#f4f1e8", "#5560d6", "#8f9bff"],
    [-18, "#121852", "#31358f", "#6a52b8", "#f4f1e8", "#6a5ad6", "#9a8cff"],
    [-12, "#151c5c", "#3c3a9a", "#8a5ab8", "#ffd9e6", "#9a62d6", "#b292ff"]
  ];
  const DAY = [
    [20, "#1d5cbf", "#4b92de", "#a9d4f5", "#ffffff", "#ffe9a8", "#63b3ff"],
    [90, "#154fb5", "#3b88e6", "#9ccdf7", "#ffffff", "#fff4c7", "#5cc8ff"]
  ];
  const parseRow = ([alt, ...colors]) => ({ alt, colors: colors.map(hex) });
  const DUSK = [...NIGHT,
    [-6, "#18206a", "#4a3a9a", "#d0607e", "#ffc9b5", "#ff6f91", "#ff7aa8"],
    [-2, "#22307a", "#7a4296", "#ff7a59", "#ffb48a", "#ff6a3d", "#ff8a5c"],
    [2, "#2a4290", "#b8567e", "#ffa34d", "#fff1c1", "#ff8c3a", "#ffa64d"],
    [8, "#2c5fb0", "#d98a72", "#ffd08a", "#fff6dc", "#ffb347", "#ffc35a"],
    ...DAY].map(parseRow);
  const DAWN = [...NIGHT,
    [-6, "#1a2268", "#4f3f9c", "#e07aa0", "#ffd6e0", "#ff8fb8", "#ff8fc0"],
    [-2, "#24307a", "#8a5aa8", "#ff9d8a", "#ffc9b0", "#ff8f8f", "#ff9db0"],
    [2, "#2c4796", "#c0789a", "#ffc28a", "#fff4d6", "#ffb070", "#ffb88a"],
    [8, "#2b66be", "#8fb3e0", "#ffe0b0", "#fffaf0", "#ffd59a", "#8fcfff"],
    ...DAY].map(parseRow);
  const KEYS = ["top", "mid", "hor", "sun", "glow", "accent"];
  function palette(alt, morning) {
    const rows = morning ? DAWN : DUSK;
    let i = rows.findIndex((row) => row.alt >= alt);
    if (i === -1) i = rows.length - 1;
    if (i === 0) i = 1;
    const a = rows[i - 1], b = rows[i];
    const t = clamp((alt - a.alt) / (b.alt - a.alt), 0, 1);
    const out = {};
    KEYS.forEach((key, k) => { out[key] = mix(a.colors[k], b.colors[k], t); });
    return out;
  }
  function phaseName(alt, morning, hourAngle) {
    if (alt > 8 && Math.abs(hourAngle) < 15) return "öğle";
    if (alt > 8) return morning ? "sabah" : "öğleden sonra";
    if (alt > 0) return morning ? "gün doğumu" : "altın saat";
    if (alt > -6) return morning ? "şafak" : "gün batımı";
    if (alt > -12) return "mavi saat";
    if (alt > -18) return "alacakaranlık";
    return "gece";
  }

  // ───────── Çanakkale gökyüzü: sitenin bütün renkleri buradan gelir ─────────
  function initSky() {
    const root = document.documentElement;
    const range = $("#sky-time");
    const nowButton = $("#sky-now");
    const state = $("#sky-state");
    const dial = $("#sky-dial");
    const themeMeta = $('meta[name="theme-color"]');
    const icon = $('link[rel="icon"]');
    let parts;
    try {
      parts = new Intl.DateTimeFormat("en-GB", { timeZone: CONFIG.timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    } catch { return null; }
    const now = () => {
      const p = Object.fromEntries(parts.formatToParts(new Date()).map(({ type, value }) => [type, value]));
      return { y: +p.year, m: +p.month, d: +p.day, minutes: (+p.hour % 24) * 60 + +p.minute };
    };
    const dateAt = (day, minutes) => new Date(Date.UTC(day.y, day.m - 1, day.d) - CONFIG.utcOffset * 3600000 + minutes * 60000);
    const clock = (minutes) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    let today = now(), live = true, current = today.minutes, info = null, iconTimer = 0;
    const iconCanvas = document.createElement("canvas");
    iconCanvas.width = iconCanvas.height = 64;

    function compute(minutes) {
      const { alt, hourAngle } = sunPosition(dateAt(today, minutes));
      const morning = hourAngle < 0;
      return { alt, hourAngle, morning, minutes, colors: palette(alt, morning), phase: phaseName(alt, morning, hourAngle) };
    }
    function describe() {
      if (!info) return "";
      const deg = Math.round(Math.abs(info.alt));
      const where = `güneş ufkun ${deg}° ${info.alt >= 0 ? "üstünde" : "altında"}`;
      return live
        ? `${clock(info.minutes)} · Çanakkale'de ${info.phase} · ${where}`
        : `Simülasyon ${clock(info.minutes)} · ${info.phase} · ${where}`;
    }

    function apply(minutes) {
      info = compute(minutes);
      const { alt, hourAngle, colors: c } = info;
      const sunVisible = clamp((alt + 14) / 12, 0, 1);
      const bg = mix(c.mid, [6, 6, 8], .88);
      const moonHourAngle = ((hourAngle + 360) % 360) - 180;
      const vars = {
        "--sky-top": rgb(c.top), "--sky-mid": rgb(c.mid), "--sky-hor": rgb(c.hor),
        "--sun": rgb(c.sun, sunVisible), "--glow": rgb(c.glow, sunVisible), "--glow-soft": rgb(c.glow, .45 * sunVisible),
        "--accent": rgb(c.accent), "--accent-soft": rgb(c.accent, .16),
        "--sea": rgb(mix(c.mid, [4, 16, 31], .6)), "--sea-deep": rgb(mix(c.top, [2, 6, 17], .75)),
        "--refl": rgb(c.sun, alt > 0 ? clamp(.85 - alt / 60, .18, .85) : clamp((alt + 3) / 3, 0, 1) * .35),
        "--sun-x": `${clamp(50 + hourAngle / 2.2, -12, 112).toFixed(2)}%`,
        "--sun-e": clamp(alt / 70, -1.5, 1).toFixed(3),
        "--moon-x": `${clamp(50 + moonHourAngle / 2.2, -12, 112).toFixed(2)}%`,
        "--moon-e": clamp(-alt / 60, 0, .9).toFixed(3),
        "--moon-a": clamp((-alt - 4) / 8, 0, 1).toFixed(3),
        "--stars": clamp((-alt - 5) / 9, 0, 1).toFixed(3),
        "--bg": rgb(bg), "--bg-raise": rgb(mix(c.mid, [14, 14, 18], .84)),
        "--ink-on-sky": luminance(mix(c.top, c.mid, .45)) > .3 ? "#0b0b09" : "#f6f1e6"
      };
      Object.entries(vars).forEach(([name, value]) => root.style.setProperty(name, value));
      state.textContent = describe();
      if (Math.abs(+range.value - minutes) >= 5) range.value = String(minutes - (minutes % 5));
      range.setAttribute("aria-valuetext", `${clock(minutes)}, ${info.phase}`);
      nowButton.disabled = live;
      nowButton.textContent = live ? "● canlı" : "↺ şimdiye dön";
      if (themeMeta) themeMeta.content = toHex(bg);
      if (!iconTimer) iconTimer = setTimeout(drawIcon, live ? 0 : 300);
    }

    // Günün renk şeridi: 20 dakikada bir gökyüzü örneği
    function buildStrip() {
      const stops = [];
      for (let m = 0; m <= 1440; m += 20) {
        const { colors } = compute(m);
        stops.push(`${rgb(mix(colors.mid, colors.hor, .5))} ${(m / 14.4).toFixed(2)}%`);
      }
      root.style.setProperty("--day-strip", `linear-gradient(90deg, ${stops.join(", ")})`);
      root.style.setProperty("--now-pos", `${(today.minutes / 14.4).toFixed(2)}%`);
    }

    // Sekme simgesi: küçük bir Çanakkale gökyüzü
    function drawIcon() {
      iconTimer = 0;
      const ctx = icon && info && iconCanvas.getContext("2d");
      if (!ctx) return;
      const c = info.colors, size = 64, horizon = size * .68;
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(0, 0, size, size, 16); else ctx.rect(0, 0, size, size);
      ctx.clip();
      const sky = ctx.createLinearGradient(0, 0, 0, horizon);
      sky.addColorStop(0, rgb(c.top)); sky.addColorStop(.6, rgb(c.mid)); sky.addColorStop(1, rgb(c.hor));
      ctx.fillStyle = sky; ctx.fillRect(0, 0, size, size);
      const visible = clamp((info.alt + 14) / 12, 0, 1);
      if (visible > 0) {
        ctx.globalAlpha = visible;
        ctx.fillStyle = rgb(c.sun);
        ctx.beginPath();
        ctx.arc(size * clamp(50 + info.hourAngle / 2.2, 8, 92) / 100, horizon - clamp(info.alt / 70, -.3, 1) * size * .52, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = "#f4f1e8";
        ctx.beginPath(); ctx.arc(size * .64, size * .3, 7, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = rgb(mix(c.mid, [4, 16, 31], .6));
      ctx.fillRect(0, horizon, size, size - horizon);
      ctx.restore();
      icon.type = "image/png";
      icon.href = iconCanvas.toDataURL("image/png");
    }

    function setLive() { live = true; today = now(); buildStrip(); apply(today.minutes); }
    function setMinutes(minutes) { live = false; current = clamp(Math.round(minutes), 0, 1439); apply(current); }

    range.addEventListener("input", () => setMinutes(+range.value));
    nowButton.addEventListener("click", setLive);
    setInterval(() => {
      const next = now();
      const newDay = next.d !== today.d || next.m !== today.m || next.y !== today.y;
      today = next;
      if (newDay) buildStrip(); else root.style.setProperty("--now-pos", `${(today.minutes / 14.4).toFixed(2)}%`);
      if (live) apply(today.minutes); else if (newDay) apply(current);
    }, 30000);

    dial.hidden = false;
    buildStrip();
    apply(today.minutes);
    return { setMinutes, setLive, describe, info: () => info };
  }

  // ───────── Nefes alan isim: harfler imlece göre genişler, her satırın genişliği sabit kalır ─────────
  function initName() {
    const box = $(".hero-name");
    const hero = $(".hero");
    const lines = $$(".hero-name .fit");
    if (!box || !hero || !lines.length) return;
    const MIN = 62, MAX = 125;
    const baseWidth = () => (innerWidth < 640 ? 72 : 80);
    const rows = lines.map((line) => {
      const letters = [], nodes = [];
      [...line.childNodes].forEach((node) => {
        if (node.nodeType !== Node.TEXT_NODE) { nodes.push(node); return; }
        Array.from(node.textContent.replace(/\s+/g, "")).forEach((char) => { const span = element("span", "ch", char); letters.push(span); nodes.push(span); });
      });
      line.replaceChildren(...nodes);
      return { line, letters, a: [], b: [], cur: [], cx: [], cy: [], groups: [], h: 1 };
    });
    let base = baseWidth(), pointer = null, lastInput = 0, frame = 0, visible = true;

    const setWidth = (row, i, value) => { row.cur[i] = value; row.letters[i].style.fontVariationSettings = `"wdth" ${value.toFixed(1)}`; };
    const setRow = (row, value) => row.letters.forEach((_, i) => setWidth(row, i, value));
    const widthsAt = (row, value) => { setRow(row, value); return row.letters.map((letter) => letter.getBoundingClientRect().width); };

    // Satırları kutuya oturt; her harfin genişliğini wdth eksenine göre doğrusal modelle (w = a + b·wdth)
    // ve harf merkezlerini ölç. Aynı görsel satırdaki harfler bir grup olur.
    function fit() {
      base = baseWidth();
      rows.forEach((row) => setRow(row, base));
      lines.forEach((line) => { line.style.fontSize = "100px"; });
      const widest = Math.max(...lines.map((line) => line.scrollWidth));
      const available = box.clientWidth * .985;
      if (!widest || !available) return;
      const size = Math.min(100 * available / widest, innerHeight * .32);
      lines.forEach((line) => { line.style.fontSize = `${size.toFixed(2)}px`; });
      rows.forEach((row) => {
        const low = widthsAt(row, MIN), high = widthsAt(row, MAX);
        row.b = low.map((w, i) => (high[i] - w) / (MAX - MIN));
        row.a = low.map((w, i) => w - row.b[i] * MIN);
        setRow(row, base);
        const frameRect = row.line.getBoundingClientRect();
        const rects = row.letters.map((letter) => letter.getBoundingClientRect());
        row.cx = rects.map((r) => r.left - frameRect.left + r.width / 2);
        row.cy = rects.map((r) => r.top - frameRect.top + r.height / 2);
        row.h = rects.length ? rects[0].height : frameRect.height;
        const groups = new Map();
        row.cy.forEach((y, i) => { const key = Math.round(y / 4); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(i); });
        row.groups = [...groups.values()];
      });
      kick();
    }

    function step(now) {
      frame = 0;
      if (motionPaused() || !visible) { rows.forEach((row) => setRow(row, base)); return; }
      const boxRect = box.getBoundingClientRect();
      let target = pointer && now - lastInput < 4000 ? pointer : null, strength = 1.4;
      const wave = !target && !finePointer.matches;
      if (wave) {
        target = { x: boxRect.left + boxRect.width * (.5 + .46 * Math.sin(now / 1900)), y: boxRect.top + boxRect.height * (.5 + .4 * Math.sin(now / 3100)) };
        strength = 1;
      }
      const sigmaX = boxRect.width * (finePointer.matches ? .09 : .14);
      const rects = rows.map((row) => row.line.getBoundingClientRect());
      let moving = false;
      rows.forEach((row, r) => {
        const rect = rects[r];
        const sigmaY = row.h * .9;
        const wish = row.cx.map((cx, i) => {
          if (!target) return base;
          const dx = target.x - (rect.left + cx), dy = target.y - (rect.top + row.cy[i]);
          return base + (MAX - base) * strength * Math.exp(-(dx * dx) / (2 * sigmaX * sigmaX) - (dy * dy) / (2 * sigmaY * sigmaY));
        });
        // Her görsel satırda toplam genişlik sabit kalsın diye o satırdaki harfleri aynı miktarda daralt.
        row.groups.forEach((group) => {
          const sumB = group.reduce((sum, i) => sum + row.b[i], 0) || 1;
          const shift = group.reduce((sum, i) => sum + row.b[i] * (wish[i] - base), 0) / sumB;
          group.forEach((i) => {
            const goal = clamp(wish[i] - shift, MIN, MAX);
            if (Math.abs(goal - row.cur[i]) > .05) { setWidth(row, i, row.cur[i] + (goal - row.cur[i]) * .16); moving = true; }
          });
        });
      });
      if (moving || wave) frame = requestAnimationFrame(step);
    }
    function kick() { if (!frame) frame = requestAnimationFrame(step); }

    hero.addEventListener("pointermove", (event) => { pointer = { x: event.clientX, y: event.clientY }; lastInput = performance.now(); kick(); }, { passive: true });
    hero.addEventListener("pointerleave", () => { pointer = null; kick(); });
    document.addEventListener("motionchange", kick);
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; kick(); }).observe(hero);
    }
    let resizeFrame = 0, lastWidth = innerWidth;
    window.addEventListener("resize", () => {
      if (innerWidth === lastWidth) return; // mobil adres çubuğu yüksekliği değişince yeniden ölçme
      lastWidth = innerWidth;
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(fit);
    }, { passive: true });
    fit();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  }

  // Gökyüzü sahnelerinde güneş, kutunun en-boy oranı ne olursa olsun daire kalsın.
  function initRoundSun() {
    if (!("ResizeObserver" in window)) return;
    const observer = new ResizeObserver((entries) => {
      entries.forEach(({ target, contentRect }) => {
        const rx = parseFloat(getComputedStyle(target).getPropertyValue("--sun-rx")) || 7;
        const height = target.getBoundingClientRect().height || contentRect.height;
        if (height) target.style.setProperty("--sun-ry", `${(rx * target.getBoundingClientRect().width / height).toFixed(2)}%`);
      });
    });
    $$(".sky-fill").forEach((scene) => observer.observe(scene));
  }

  function initReveal() {
    const targets = $$(".section-label, .work-row, .services article, .tool-list li, .repo-list, .contact-title, .contact-row");
    targets.forEach((target) => target.classList.add("reveal"));
    if (!("IntersectionObserver" in window) || motionPaused()) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(({ isIntersecting, target }) => {
        if (isIntersecting) { target.classList.remove("is-pending"); observer.unobserve(target); }
      });
    }, { threshold: 0.12 });
    targets.forEach((target) => {
      if (target.getBoundingClientRect().top > innerHeight) target.classList.add("is-pending");
      observer.observe(target);
    });
    document.addEventListener("motionchange", (event) => {
      if (event.detail) { targets.forEach((target) => target.classList.remove("is-pending")); observer.disconnect(); }
    });
  }

  // Hakkımda metni: kaydırdıkça kelime kelime yanar; son cümle gökyüzü rengini alır.
  function initStatement() {
    const statement = $("#statement");
    if (!statement) return;
    const words = statement.textContent.trim().split(/\s+/);
    const from = statement.dataset.highlight;
    const highlight = from ? words.findIndex((word) => word.toLocaleLowerCase("tr").startsWith(from)) : -1;
    statement.replaceChildren(...words.flatMap((word, index) => {
      const span = element("span", highlight >= 0 && index >= highlight ? "w hl" : "w", word);
      return index < words.length - 1 ? [span, document.createTextNode(" ")] : [span];
    }));
    const spans = $$("#statement .w");
    let ticking = false;
    function update() {
      ticking = false;
      if (motionPaused()) { spans.forEach((span) => span.classList.add("on")); return; }
      const rect = statement.getBoundingClientRect();
      // Metnin üstü ekranın %85'ine gelince başlar, altı %65'e gelince bütün kelimeler yanmış olur.
      const start = innerHeight * .85, finish = innerHeight * .65;
      const progress = clamp((start - rect.top) / (start - finish + rect.height), 0, 1);
      const lit = Math.round(progress * spans.length);
      spans.forEach((span, index) => span.classList.toggle("on", index < lit));
    }
    const request = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
    window.addEventListener("scroll", request, { passive: true });
    window.addEventListener("resize", request, { passive: true });
    document.addEventListener("motionchange", request);
    update();
  }

  // İş satırlarının üzerine gelince imleci yumuşakça takip eden önizleme kartı.
  function initPreview() {
    const preview = $("#preview");
    const strip = $("#preview-strip");
    const list = $("#work-list");
    const rows = $$(".work-row");
    if (!preview || !strip || !list || !rows.length) return;
    let x = innerWidth / 2, y = innerHeight / 2, tx = x, ty = y, scale = 0, targetScale = 0, frame = 0;
    function draw() {
      const instant = motionPaused();
      x += (tx - x) * (instant ? 1 : .14);
      y += (ty - y) * (instant ? 1 : .14);
      scale += (targetScale - scale) * (instant ? 1 : .16);
      preview.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(${scale.toFixed(3)})`;
      frame = Math.abs(tx - x) > .3 || Math.abs(ty - y) > .3 || Math.abs(targetScale - scale) > .002 ? requestAnimationFrame(draw) : 0;
    }
    const kick = () => { if (!frame) frame = requestAnimationFrame(draw); };
    rows.forEach((row, index) => {
      row.addEventListener("mouseenter", () => {
        if (!finePointer.matches) return;
        strip.style.transform = `translateY(${-index * 100}%)`;
        targetScale = 1; kick();
      });
    });
    list.addEventListener("mouseleave", () => { targetScale = 0; kick(); });
    window.addEventListener("mousemove", (event) => { tx = event.clientX; ty = event.clientY; if (targetScale) kick(); }, { passive: true });
    window.addEventListener("scroll", () => { if (targetScale && !list.matches(":hover")) { targetScale = 0; kick(); } }, { passive: true });
  }

  // Manyetik öğeler imlece doğru hafifçe çekilir.
  function initMagnetic() {
    $$(".magnetic").forEach((item) => {
      item.addEventListener("pointermove", (event) => {
        if (!finePointer.matches || motionPaused()) return;
        const rect = item.getBoundingClientRect();
        const dx = event.clientX - (rect.left + rect.width / 2);
        const dy = event.clientY - (rect.top + rect.height / 2);
        item.style.transform = `translate(${dx * .3}px, ${dy * .3}px)`;
      });
      item.addEventListener("pointerleave", () => { item.style.transform = ""; });
    });
  }

  // Canlı ölçüm: no-cors istek tamamlanırsa site erişilebilirdir. Ulaşılamazsa "ölçülemedi" yazılır.
  function initStatus() {
    const cells = $$(".state[data-url]");
    const summary = $("#board-summary");
    if (!cells.length || !window.fetch) return;
    function set(cell, state, text) { cell.dataset.state = state; cell.querySelector(".state-text").textContent = text; }
    async function measure(cell) {
      const url = webURL(cell.dataset.url);
      if (!url) return null;
      set(cell, "checking", "ölçülüyor");
      const started = performance.now();
      try {
        await fetchWithTimeout(url, { mode: "no-cors", cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" }, 8000);
        const ms = Math.round(performance.now() - started);
        set(cell, "live", `canlı · ${ms} ms`);
        return ms;
      } catch { set(cell, "unknown", "ölçülemedi"); return null; }
    }
    Promise.all(cells.map(measure)).then((results) => {
      const live = results.filter((value) => value !== null);
      summary.textContent = live.length ? `7 proje · ${live.length}/${cells.length} site şu an yanıt veriyor` : "7 proje · 5'i canlıda";
    });
  }

  // ───────── Gizli terminal ─────────
  function initTerminal(sky) {
    const dialog = $("#terminal");
    if (!dialog || typeof dialog.showModal !== "function") return;
    const out = $("#term-out"), form = $("#term-form"), input = $("#term-input"), body = $("#term-body"), canvas = $("#term-matrix");
    const PROMPT = "eyup@canakkale:~$";
    const history = [];
    let historyIndex = 0, opener = null, greeted = false, stopMatrix = null;

    $$("[data-terminal]").forEach((button) => { button.hidden = false; button.addEventListener("click", open); });
    $$("[data-terminal-hint]").forEach((hint) => { hint.hidden = false; });

    const fold = (text) => text.toLocaleLowerCase("tr").replace(/[çğıöşü]/g, (ch) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" })[ch]);
    const print = (text = "", className = "") => { const p = element("p", className, text); out.append(p); return p; };
    const printAll = (list, className) => list.forEach((text) => print(text, className));
    function printLink(label, text, href, external = true) {
      const p = print(label);
      const link = element("a", "", text);
      link.href = href;
      if (external) { link.target = "_blank"; link.rel = "noopener noreferrer"; }
      p.append(link);
    }
    const scrollDown = () => { body.scrollTop = body.scrollHeight; };
    const SECTIONS = { isler: "#work", hakkimda: "#about", ders: "#classroom", depolar: "#repos", iletisim: "#contact", "~": "#top", "": "#top" };
    const parseTime = (value) => {
      const match = /^(\d{1,2})[:.](\d{2})$/.exec(value || "");
      if (!match) return null;
      const h = +match[1], m = +match[2];
      return h < 24 && m < 60 ? h * 60 + m : null;
    };
    const PROJECTS = [
      ["TEKYAZ IT", "masaüstü · WPF / .NET 8 · v1.7", ""],
      ["İdeal Hukuk Kulübü", "kulüp sitesi · PHP / Three.js", ""],
      ["efomat.com", "matbaa · PHP / MySQL", "https://efomat.com"],
      ["matbaakent.com", "matbaa · PHP / MySQL", "https://matbaakent.com"],
      ["bedirhanikincielspot.com", "ikinci el ticaret · PHP / MySQL", "https://bedirhanikincielspot.com"],
      ["canakkalesehitlik.com", "turizm · PHP / MySQL", "https://canakkalesehitlik.com"],
      ["on7reklam.com", "reklam ajansı · PHP / MySQL", "https://on7reklam.com"]
    ];

    const COMMANDS = {
      yardim: () => printAll([
        "Kullanılabilir komutlar:",
        "  hakkimda          kısa tanıtım",
        "  isler             projeler ve canlı siteler",
        "  ls · cd <bölüm>   sayfada gez (örnek: cd isler)",
        "  gokyuzu [ss:dd]   sitenin rengini o saate çevir (gokyuzu 19:30 · gokyuzu simdi)",
        "  saat              Çanakkale'de saat ve güneşin konumu",
        "  neofetch          sistem bilgisi",
        "  cmatrix           Türkçe matrix yağmuru (durdurmak için bir tuşa bas)",
        "  oyna              GitHub profilimde bota karşı Dörtlü oyna",
        "  iletisim          e-posta ve bağlantılar",
        "  istatistik        ziyaret sayımı hakkında · beni-sayma / beni-say",
        "  temizle · cikis   ekranı temizle · terminali kapat (Esc)"
      ]),
      hakkimda: () => printAll([
        "Eyüp Çalışkanöztürk — full-stack developer, Çanakkale.",
        "Bilgisayar Programcılığı öğrencisi; freelance olarak canlıya çıkan projeler geliştiriyor.",
        "Şema → backend → admin paneli → arayüz → yayın → güvenlik. Hepsi tek elden."
      ]),
      isler: () => {
        PROJECTS.forEach(([name, meta, href]) => {
          const p = print("");
          if (href) { const link = element("a", "", name); link.href = href; link.target = "_blank"; link.rel = "noopener noreferrer"; p.append(link); }
          else p.append(element("span", "accent", name));
          p.append(document.createTextNode(`${" ".repeat(Math.max(2, 27 - name.length))}${meta}`));
        });
        print("Sayfada görmek için: cd isler", "dim");
      },
      ls: () => print("isler/  hakkimda/  ders/  depolar/  iletisim/  gizli.txt", "accent"),
      cd: ([target = "~"]) => {
        const key = fold(target).replace(/\/+$/, "");
        const id = SECTIONS[key];
        if (!id) { print(`cd: ${target}: Böyle bir dizin yok`, "err"); return; }
        close();
        const section = $(id);
        if (section) section.scrollIntoView({ behavior: motionPaused() ? "auto" : "smooth" });
      },
      cat: ([file]) => {
        if (!file) { print("cat: dosya adı gerekli", "err"); return; }
        if (fold(file) === "gizli.txt") { printAll(["Bunu bulduğuna göre detaylara önem veriyorsun.", "Ben de öyle. Birlikte iyi iş çıkarırız → iletisim"], "accent"); return; }
        print(`cat: ${file}: Böyle bir dosya yok`, "err");
      },
      saat: () => print(sky ? sky.describe() : new Date().toLocaleTimeString("tr-TR", { timeZone: CONFIG.timeZone })),
      gokyuzu: ([arg]) => {
        if (!sky) { print("gokyuzu: bu tarayıcıda kullanılamıyor", "err"); return; }
        if (!arg) { print(sky.describe()); print("Kullanım: gokyuzu 19:30 · gokyuzu simdi", "dim"); return; }
        if (["simdi", "now", "canli"].includes(fold(arg))) { sky.setLive(); print(`Canlı gökyüzüne dönüldü · ${sky.describe()}`, "accent"); return; }
        const minutes = parseTime(arg);
        if (minutes === null) { print(`gokyuzu: '${arg}' geçerli bir saat değil (örnek: 06:45)`, "err"); return; }
        sky.setMinutes(minutes);
        print(`Gökyüzü ${arg} saatine ayarlandı · ${sky.info().phase}. Arkadaki sayfaya bak.`, "accent");
      },
      neofetch: () => {
        const info = sky && sky.info();
        const art = [" ▄▄▄▄▄   ▄▄▄▄", " █       █", " █▀▀▀    █", " █▄▄▄▄   █▄▄▄▄", "            ¸", "", "", ""];
        const facts = [
          "eyup@canakkale", "──────────────",
          "Konum    Çanakkale · 40.15°K 26.41°D",
          "Rol      Full-stack developer",
          "Stack    PHP · C# .NET 8 · Next.js · Node.js",
          "Canlı    5 müşteri sitesi",
          `Gökyüzü  ${info ? info.phase : "—"}`,
          "Kahve    %87"
        ];
        out.append(element("pre", "neofetch", facts.map((fact, i) => `${(art[i] || "").padEnd(16)}${fact}`).join("\n")));
      },
      cmatrix: () => matrix(),
      iletisim: () => {
        printLink("e-posta    ", CONFIG.email, `mailto:${CONFIG.email}`, false);
        printLink("github     ", `github.com/${CONFIG.github}`, `https://github.com/${CONFIG.github}`);
        printLink("linkedin   ", "linkedin.com/in/eyüp-çalişkanöztürk", webURL(CONFIG.linkedin));
        printLink("instagram  ", "@eyupcalskanozturk", "https://instagram.com/eyupcalskanozturk");
      },
      oyna: () => {
        printAll(["GitHub profilimde bota karşı Dörtlü oynayabilirsin.", "Tahtada bir sütuna tıkla, açılan sayfada Create'e bas; bot birkaç saniyede cevap verir."], "accent");
        printLink("tahta      ", `github.com/${CONFIG.github}`, `https://github.com/${CONFIG.github}`);
        print("Bot 6 hamle ileriyi düşünür ama yenilebilir. Bol şans!", "dim");
      },
      github: () => { window.open(`https://github.com/${CONFIG.github}`, "_blank", "noopener"); print("GitHub yeni sekmede açıldı."); },
      whoami: () => print("ziyaretci — ama bir mesajla müşteri olabilirsin → iletisim"),
      istatistik: () => {
        let kapali = false;
        try { kapali = localStorage.getItem("umami.disabled") === "1"; } catch { /* depolama kapalı */ }
        printAll([
          "Bu site ziyaretleri Umami ile sayar: çerez kullanmaz, kim olduğunu bilmez.",
          "Görülen: hangi sayfa, ülke/şehir, cihaz ve tarayıcı, nereden gelindiği.",
          kapali ? "Bu tarayıcı sayılmıyor. Yeniden sayılmak için: beni-say" : "Bu tarayıcıyı saymanın dışında bırakmak için: beni-sayma"
        ]);
      },
      "beni-sayma": () => {
        try { localStorage.setItem("umami.disabled", "1"); print("Tamam: bu tarayıcıdan gelen ziyaretler artık sayılmayacak.", "accent"); }
        catch { print("Tarayıcı yerel depolamaya izin vermiyor; ayar kaydedilemedi.", "err"); }
      },
      "beni-say": () => {
        try { localStorage.removeItem("umami.disabled"); print("Bu tarayıcıdan gelen ziyaretler yeniden sayılacak.", "accent"); }
        catch { print("Tarayıcı yerel depolamaya izin vermiyor; ayar kaydedilemedi.", "err"); }
      },
      sudo: () => printAll(["[sudo] eyup için parola: ********", "sudo: Yetki reddedildi. Root erişimi için önce bir proje konuşalım → iletisim"], "err"),
      echo: (args) => print(args.join(" ")),
      temizle: () => out.replaceChildren(),
      cikis: () => close()
    };
    const ALIASES = { help: "yardim", "?": "yardim", about: "hakkimda", projects: "isler", projeler: "isler", contact: "iletisim", mail: "iletisim", clear: "temizle", cls: "temizle", exit: "cikis", quit: "cikis", sky: "gokyuzu", time: "saat", date: "saat", tarih: "saat", matrix: "cmatrix", dir: "ls", dortlu: "oyna", oyun: "oyna", play: "oyna", game: "oyna", stats: "istatistik", analytics: "istatistik" };

    function run(raw) {
      const text = raw.trim();
      const echo = print("", "echo");
      echo.append(element("span", "term-prompt", PROMPT), document.createTextNode(` ${text}`));
      if (text) {
        history.push(text);
        historyIndex = history.length;
        const [word, ...args] = text.split(/\s+/);
        const name = ALIASES[fold(word)] || fold(word);
        const command = Object.prototype.hasOwnProperty.call(COMMANDS, name) ? COMMANDS[name] : null;
        if (command) command(args); else print(`komut bulunamadı: ${word} — 'yardim' yaz.`, "err");
      }
      if (dialog.open) scrollDown();
    }

    // Türkçe cmatrix: yağmur o anki gökyüzü renginde yağar.
    function matrix() {
      if (motionPaused()) { print("cmatrix: hareket şu an kapalı (hareket azaltma ya da 'Hareketi durdur'). Yağmur başlatılmadı.", "dim"); return; }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      dialog.classList.add("is-matrix");
      const { width, height } = dialog.getBoundingClientRect();
      const scale = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      const size = 16;
      const drops = Array.from({ length: Math.ceil(width / size) }, () => Math.floor(Math.random() * -height / size * .6));
      const glyphs = Array.from("ÇĞİÖŞÜçğıöşü0123456789{}<>/=;$#*+PHPC#");
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#4dff7c";
      const pick = () => glyphs[(Math.random() * glyphs.length) | 0];
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
      ctx.font = `500 ${size}px "JetBrains Mono", monospace`;
      ctx.textBaseline = "top";
      let raf = 0, last = 0;
      function draw(time) {
        raf = requestAnimationFrame(draw);
        if (time - last < 40) return;
        last = time;
        ctx.fillStyle = "rgba(0, 0, 0, 0.16)";
        ctx.fillRect(0, 0, width, height);
        drops.forEach((row, i) => {
          const x = i * size, y = row * size;
          ctx.fillStyle = accent; ctx.fillText(pick(), x, y - size);
          ctx.fillStyle = "#f6f1e6"; ctx.fillText(pick(), x, y);
          drops[i] = y > height && Math.random() > .97 ? 0 : row + 1;
        });
      }
      const onStop = (event) => { event.preventDefault(); stop(); };
      function stop(report = true) {
        cancelAnimationFrame(raf);
        dialog.classList.remove("is-matrix");
        dialog.removeEventListener("keydown", onStop, true);
        canvas.removeEventListener("pointerdown", onStop);
        stopMatrix = null;
        if (report) { print("cmatrix sonlandı.", "dim"); input.focus(); scrollDown(); }
      }
      stopMatrix = stop;
      raf = requestAnimationFrame(draw);
      setTimeout(() => { if (stopMatrix === stop) { dialog.addEventListener("keydown", onStop, true); canvas.addEventListener("pointerdown", onStop); } }, 0);
    }

    function open() {
      if (dialog.open) return;
      opener = document.activeElement;
      dialog.showModal();
      if (!greeted) {
        greeted = true;
        printAll(["eyup-os 1.0 · Çanakkale · tty1", "Komutları görmek için 'yardim' yaz. Kapatmak için Esc."], "dim");
      }
      input.focus();
      scrollDown();
    }
    function close() { if (dialog.open) dialog.close(); }

    form.addEventListener("submit", (event) => { event.preventDefault(); const value = input.value; input.value = ""; run(value); });
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowUp" && historyIndex > 0) { historyIndex -= 1; input.value = history[historyIndex]; event.preventDefault(); }
      else if (event.key === "ArrowDown" && historyIndex < history.length) { historyIndex += 1; input.value = history[historyIndex] || ""; event.preventDefault(); }
      else if (event.key === "Tab" && !event.shiftKey && input.value.trim()) {
        event.preventDefault();
        const value = fold(input.value.trimStart());
        const [first, second = ""] = value.split(/\s+/);
        const pool = value.includes(" ") && first === "cd" ? Object.keys(SECTIONS).filter((key) => key && key !== "~").map((key) => `cd ${key}`) : Object.keys(COMMANDS);
        const needle = value.includes(" ") && first === "cd" ? `cd ${second}` : first;
        const matches = pool.filter((option) => option.startsWith(needle));
        if (matches.length === 1) input.value = `${matches[0]} `;
        else if (matches.length > 1) { print(matches.join("   "), "dim"); scrollDown(); }
      }
    });
    dialog.addEventListener("cancel", (event) => { if (stopMatrix) { event.preventDefault(); stopMatrix(); } });
    dialog.addEventListener("close", () => { if (stopMatrix) stopMatrix(false); if (opener && typeof opener.focus === "function") opener.focus(); });
    dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); });
    $("#term-close").addEventListener("click", close);
    body.addEventListener("click", () => { if (!stopMatrix && !String(window.getSelection())) input.focus(); });

    document.addEventListener("keydown", (event) => {
      if (dialog.open || event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const combo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
      const single = !event.ctrlKey && !event.metaKey && !event.altKey && (event.key === "/" || event.key === "`");
      if (combo || single) { event.preventDefault(); open(); }
    });
  }

  const REPO_NOTES = Object.freeze({
    "gold-password-generator": "Parola üretimi ve güç kontrolünü altın-siyah bir arayüzde birleştiren web aracı.",
    "Eyup-Challenge": "TypeScript çalışma deposu.",
    "funnyofcomu": "HTML tabanlı web çalışmam.",
    "eyupcalskanozturk-tr.github.io": "Bu sitenin kaynak kodu: portfolyo, Chen Atölyesi ve IP2 Vize Kampı."
  });
  function repoRow(repo) {
    const item = element("li");
    const link = element("a");
    link.href = webURL(repo.html_url);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const description = REPO_NOTES[repo.name] || (typeof repo.description === "string" && repo.description) || "Kaynak kodu ve güncel geliştirmeler GitHub'da.";
    link.append(
      element("span", "repo-name", repo.name),
      element("span", "repo-desc", description),
      element("span", "repo-lang mono", typeof repo.language === "string" ? repo.language : "—")
    );
    item.append(link);
    return item;
  }

  async function loadRepos() {
    const status = $("#project-status");
    const retry = $("#retry-projects");
    const list = $("#repo-list");
    retry.hidden = true;
    list.setAttribute("aria-busy", "true");
    status.textContent = "GitHub depoları güncelleniyor…";
    try {
      const response = await fetchWithTimeout(`https://api.github.com/users/${encodeURIComponent(CONFIG.github)}/repos?sort=updated&per_page=100`, { headers: { Accept: "application/vnd.github+json" } });
      if (!response.ok) throw new Error(`GitHub: ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error("Geçersiz depo yanıtı");
      const repos = data.filter((repo) => repo && typeof repo.name === "string" && !repo.fork && !repo.archived && !repo.private && repo.name.toLowerCase() !== CONFIG.github.toLowerCase() && webURL(repo.html_url)).slice(0, CONFIG.maxRepos);
      if (repos.length) list.replaceChildren(...repos.map(repoRow));
      status.textContent = repos.length ? "GitHub'dan canlı · son güncellenenler" : "Henüz herkese açık depo yok";
    } catch {
      status.textContent = "GitHub'a ulaşılamadı; kayıtlı liste";
      retry.hidden = false;
    } finally { list.setAttribute("aria-busy", "false"); }
  }

  function initContact() {
    const form = $("#contact-form");
    const button = $("#submit-button");
    const status = $("#form-status");
    const endpoint = webURL(CONFIG.formspreeEndpoint);
    const useFormspree = /^https:\/\/formspree\.io\/f\/[a-zA-Z0-9]+$/.test(endpoint);
    const emailLink = $("#email-link");
    emailLink.href = `mailto:${CONFIG.email}`;
    emailLink.textContent = CONFIG.email;
    $("#github-link").href = `https://github.com/${encodeURIComponent(CONFIG.github)}`;
    $("#linkedin-link").href = webURL(CONFIG.linkedin);
    $("#form-fields").disabled = false;
    if (useFormspree) {
      button.textContent = "Mesajı gönder";
      $("#form-note").textContent = "Mesajın ve e-posta adresin Formspree üzerinden iletilir.";
    }
    const defaultLabel = button.textContent;
    form.addEventListener("input", (event) => {
      if (event.target.setCustomValidity) event.target.setCustomValidity("");
      status.textContent = "";
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (form.elements._gotcha.value) return;
      const name = form.elements.name.value.trim();
      const email = form.elements.email.value.trim();
      const message = form.elements.message.value.trim();
      form.elements.name.setCustomValidity(name.length >= 2 ? "" : "Lütfen en az 2 karakterlik bir ad yaz.");
      form.elements.message.setCustomValidity(message.length >= 10 ? "" : "Lütfen en az 10 karakterlik bir mesaj yaz.");
      if (!form.reportValidity()) return;
      status.dataset.state = "info";
      if (!useFormspree) {
        const subject = encodeURIComponent(`Portfolyo iletişim — ${name}`);
        const body = encodeURIComponent(`Ad: ${name}\nE-posta: ${email}\n\n${message}`);
        window.location.href = `mailto:${CONFIG.email}?subject=${subject}&body=${body}`;
        status.textContent = "E-posta taslağı açılması istendi; mesaj henüz gönderilmedi. Uygulama açılmadıysa yukarıdaki adresi kullanabilirsin.";
        return;
      }
      button.disabled = true;
      button.textContent = "Gönderiliyor…";
      form.setAttribute("aria-busy", "true");
      const data = new FormData(form);
      data.set("name", name); data.set("email", email); data.set("message", message);
      // Veriyi aldıktan sonra kilitle; beklerken yazılan metin kaybolmasın.
      $("#form-fields").disabled = true;
      try {
        const response = await fetchWithTimeout(endpoint, { method: "POST", body: data, headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error("Gönderim kabul edilmedi");
        form.reset();
        status.textContent = "Mesajın gönderildi. Teşekkür ederim!";
        status.dataset.state = "success";
      } catch {
        status.textContent = "Gönderim doğrulanamadı. Mesajın formda duruyor; yeniden deneyebilir veya e-posta bağlantısını kullanabilirsin.";
        status.dataset.state = "error";
      } finally {
        $("#form-fields").disabled = false;
        button.disabled = false;
        button.textContent = defaultLabel;
        form.setAttribute("aria-busy", "false");
      }
    });
  }

  $("#year").textContent = new Date().getFullYear();
  initMotion();
  initClock();
  const sky = initSky();
  initName();
  initRoundSun();
  initReveal();
  initStatement();
  initPreview();
  initMagnetic();
  initStatus();
  initTerminal(sky);
  initContact();
  $("#retry-projects").addEventListener("click", loadRepos);
  loadRepos();
})();
