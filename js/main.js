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
  const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
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
    motionPreference.addEventListener("change", (event) => {
      reducedMotion = event.matches;
      update();
    });
    document.addEventListener("visibilitychange", update);
    update();
  }

  function initClock() {
    const target = $("#clock");
    let format;
    try { format = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: CONFIG.timeZone }); }
    catch { target.parentElement.hidden = true; return; }
    const tick = () => { target.textContent = format.format(new Date()); };
    tick();
    setInterval(tick, 30000);
  }

  function initReveal() {
    if (!("IntersectionObserver" in window) || motionPaused()) return;
    const targets = document.querySelectorAll(".reveal");
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(({ isIntersecting, target }) => {
        if (isIntersecting) { target.classList.remove("is-pending"); observer.unobserve(target); }
      });
    }, { threshold: 0.08 });
    targets.forEach((target) => {
      if (target.getBoundingClientRect().top > innerHeight) target.classList.add("is-pending");
      observer.observe(target);
    });
    document.addEventListener("motionchange", (event) => {
      if (event.detail) {
        targets.forEach((target) => target.classList.remove("is-pending"));
        observer.disconnect();
      }
    });
  }

  // Canlı pano: her siteye tarayıcıdan no-cors istek atılır. Yanıt içeriği okunamaz,
  // ama isteğin tamamlanması sitenin erişilebilir olduğunu gösterir.
  // Ulaşılamazsa "kapalı" demek yerine dürüstçe "ölçülemedi" yazılır.
  function initStatusBoard() {
    const cells = [...document.querySelectorAll(".state[data-url]")];
    const summary = $("#board-summary");
    const button = $("#recheck");
    if (!cells.length || !window.fetch) return;

    function set(cell, state, text) {
      cell.dataset.state = state;
      cell.querySelector(".state-text").textContent = text;
    }
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
      } catch {
        set(cell, "unknown", "ölçülemedi");
        return null;
      }
    }
    async function run() {
      button.disabled = true;
      summary.textContent = "Tarayıcından ölçülüyor…";
      const results = await Promise.all(cells.map(measure));
      const live = results.filter((value) => value !== null);
      const average = live.length ? Math.round(live.reduce((a, b) => a + b, 0) / live.length) : 0;
      summary.textContent = live.length
        ? `${live.length}/${cells.length} site yanıt verdi · ort. ${average} ms`
        : "Şu an ölçülemedi (ağ veya tarayıcı engeli olabilir)";
      button.disabled = false;
    }
    button.hidden = false;
    button.addEventListener("click", run);
    // Boot animasyonu bitince ölç; hareket kapalıysa hemen.
    setTimeout(run, motionPaused() ? 0 : 1700);
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
      element("span", "repo-lang", typeof repo.language === "string" ? repo.language : "—")
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
      status.textContent = repos.length ? "GitHub'dan canlı çekildi. Fork ve arşiv depoları gösterilmez." : "Henüz gösterilecek herkese açık bir depo yok.";
    } catch {
      status.textContent = "GitHub'a şu an ulaşılamıyor; kayıtlı liste gösteriliyor.";
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
  initReveal();
  initStatusBoard();
  initContact();
  $("#retry-projects").addEventListener("click", loadRepos);
  loadRepos();
})();
