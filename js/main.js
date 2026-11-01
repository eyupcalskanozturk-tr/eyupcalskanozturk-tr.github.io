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
    timeZone: "Europe/Istanbul"
  });
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  let reducedMotion = motionPreference.matches;
  let userPaused = false;
  try { userPaused = localStorage.getItem("portfolio-motion") === "paused"; } catch { /* Depolama isteğe bağlıdır. */ }
  const motionPaused = () => userPaused || reducedMotion || document.hidden;

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
    const targets = [$("#clock"), $("#clock-footer")].filter(Boolean);
    let format;
    try { format = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: CONFIG.timeZone }); }
    catch { return; }
    const tick = () => { const now = format.format(new Date()); targets.forEach((t) => { t.textContent = now; }); };
    tick();
    setInterval(tick, 30000);
  }

  // Dev ismi kapsayıcının genişliğine tam oturt: en uzun satır genişliği doldurur.
  function initFitText() {
    const lines = $$(".hero-name .fit");
    const box = $(".hero-name");
    if (!lines.length || !box) return;
    function fit() {
      lines.forEach((line) => { line.style.fontSize = "100px"; });
      const widest = Math.max(...lines.map((line) => line.scrollWidth));
      const available = box.clientWidth;
      if (!widest || !available) return;
      const size = Math.min(100 * available / widest, window.innerHeight * 0.36);
      lines.forEach((line) => { line.style.fontSize = `${size.toFixed(2)}px`; });
    }
    fit();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
    let frame;
    window.addEventListener("resize", () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fit); }, { passive: true });
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

  // Hakkımda metni: kaydırdıkça kelime kelime yanar. Metin bölünse de okunuşu aynı kalır.
  function initStatement() {
    const statement = $("#statement");
    if (!statement) return;
    const words = statement.textContent.trim().split(/\s+/);
    statement.replaceChildren(...words.flatMap((word, index) => {
      const span = element("span", "w", word);
      return index < words.length - 1 ? [span, document.createTextNode(" ")] : [span];
    }));
    const spans = $$("#statement .w");
    let ticking = false;
    function update() {
      ticking = false;
      if (motionPaused()) { spans.forEach((s) => s.classList.add("on")); return; }
      const rect = statement.getBoundingClientRect();
      const start = innerHeight * 0.85, end = innerHeight * 0.35;
      const progress = Math.min(1, Math.max(0, (start - rect.top) / (rect.height + start - end)));
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
    const rows = $$(".work-row");
    if (!preview || !strip || !rows.length) return;
    let x = innerWidth / 2, y = innerHeight / 2, tx = x, ty = y, scale = 0, targetScale = 0, frame = 0;
    function draw() {
      const ease = motionPaused() ? 1 : 0.14;
      x += (tx - x) * ease; y += (ty - y) * ease; scale += (targetScale - scale) * (motionPaused() ? 1 : 0.16);
      preview.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(${scale.toFixed(3)})`;
      if (Math.abs(tx - x) > 0.3 || Math.abs(ty - y) > 0.3 || Math.abs(targetScale - scale) > 0.002) frame = requestAnimationFrame(draw);
      else frame = 0;
    }
    const kick = () => { if (!frame) frame = requestAnimationFrame(draw); };
    rows.forEach((row, index) => {
      row.addEventListener("mouseenter", () => {
        if (!finePointer.matches) return;
        strip.style.transform = `translateY(${-index * 100}%)`;
        targetScale = 1; kick();
      });
    });
    $("#work-list").addEventListener("mouseleave", () => { targetScale = 0; kick(); });
    window.addEventListener("mousemove", (event) => { tx = event.clientX; ty = event.clientY; if (targetScale) kick(); }, { passive: true });
    window.addEventListener("scroll", () => { if (targetScale && !$("#work-list").matches(":hover")) { targetScale = 0; kick(); } }, { passive: true });
  }

  // Manyetik öğeler imlece doğru hafifçe çekilir.
  function initMagnetic() {
    $$(".magnetic").forEach((item) => {
      item.addEventListener("pointermove", (event) => {
        if (!finePointer.matches || motionPaused()) return;
        const rect = item.getBoundingClientRect();
        const dx = event.clientX - (rect.left + rect.width / 2);
        const dy = event.clientY - (rect.top + rect.height / 2);
        item.style.transform = `translate(${dx * 0.3}px, ${dy * 0.3}px)`;
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
      summary.textContent = live.length
        ? `7 proje · ${live.length}/${cells.length} site şu an yanıt veriyor`
        : "7 proje · 5'i canlıda";
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
  initFitText();
  initReveal();
  initStatement();
  initPreview();
  initMagnetic();
  initStatus();
  initContact();
  $("#retry-projects").addEventListener("click", loadRepos);
  loadRepos();
})();
