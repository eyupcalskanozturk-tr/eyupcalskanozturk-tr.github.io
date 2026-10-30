(() => {
  "use strict";

  // Formspree hesabın varsa paneldeki /f/... form adresini bu alana yaz.
  // Boş bırakıldığında gerçek e-posta adresine bir mailto taslağı açılır.
  const CONFIG = Object.freeze({
    github: "eyupcalskanozturk-tr",
    email: "eyupcalskanofficial@gmail.com",
    linkedin: "https://www.linkedin.com/in/eyüp-çalişkanöztürk-413208273",
    formspreeEndpoint: "",
    maxProjects: 6
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
  function externalLink(label, href) {
    const link = element("a", "", label);
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  }
  async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try { return await fetch(url, { ...options, signal: controller.signal }); }
    finally { clearTimeout(timeout); }
  }

  function initNavigation() {
    const button = $(".menu-toggle");
    const nav = $("#navigation");
    const desktop = window.matchMedia("(min-width: 900px)");
    function setOpen(open) {
      button.setAttribute("aria-expanded", String(open));
      nav.classList.toggle("is-open", open);
    }
    button.hidden = false;
    document.documentElement.classList.add("nav-ready");
    button.addEventListener("click", () => setOpen(button.getAttribute("aria-expanded") !== "true"));
    nav.addEventListener("click", (event) => { if (event.target.closest("a")) setOpen(false); });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && button.getAttribute("aria-expanded") === "true") {
        setOpen(false);
        button.focus();
      }
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".site-header")) setOpen(false);
    });
    desktop.addEventListener("change", () => setOpen(false));
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

  function initTyping() {
    const target = $("#typed-role");
    const roles = ["Full-Stack Developer", "Bilgisayar Programcılığı Öğrencisi", "Web Geliştirici"];
    let role = 0, position = roles[0].length, deleting = true, timer;
    function tick() {
      if (motionPaused()) return;
      position += deleting ? -1 : 1;
      target.textContent = roles[role].slice(0, position);
      let delay = deleting ? 35 : 70;
      if (position === 0) { deleting = false; role = (role + 1) % roles.length; delay = 250; }
      else if (position === roles[role].length && !deleting) { deleting = true; delay = 2000; }
      timer = setTimeout(tick, delay);
    }
    function restart() {
      clearTimeout(timer);
      target.textContent = roles[0];
      role = 0; position = roles[0].length; deleting = true;
      if (!motionPaused()) timer = setTimeout(tick, 2000);
    }
    document.addEventListener("motionchange", restart);
    restart();
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

  function initParticles() {
    const canvas = $("#particles");
    const context = canvas.getContext("2d");
    if (!context) return;
    let width, height, points = [], frame = 0, previous = 0;
    function resize() {
      width = innerWidth; height = innerHeight;
      const scale = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
      context.setTransform(scale, 0, 0, scale, 0, 0);
      points = Array.from({ length: Math.min(42, Math.ceil(width * height / 26000)) }, () => ({
        x: Math.random() * width, y: Math.random() * height,
        vx: (Math.random() - .5) * .012, vy: (Math.random() - .5) * .012
      }));
    }
    function draw(time) {
      if (motionPaused()) return;
      frame = requestAnimationFrame(draw);
      if (time - previous < 40) return; // Yaklaşık 25 FPS; arka plan için yeterli.
      const delta = Math.min(time - previous, 80);
      previous = time;
      context.clearRect(0, 0, width, height);
      points.forEach((point, index) => {
        point.x = (point.x + point.vx * delta + width) % width;
        point.y = (point.y + point.vy * delta + height) % height;
        context.fillStyle = "rgba(233,189,105,.5)";
        context.beginPath(); context.arc(point.x, point.y, 1.2, 0, Math.PI * 2); context.fill();
        for (let next = index + 1; next < points.length; next++) {
          const other = points[next];
          const distance = Math.hypot(point.x - other.x, point.y - other.y);
          if (distance < 140) {
            context.strokeStyle = `rgba(233,189,105,${.13 * (1 - distance / 140)})`;
            context.beginPath(); context.moveTo(point.x, point.y); context.lineTo(other.x, other.y); context.stroke();
          }
        }
      });
    }
    function update() {
      cancelAnimationFrame(frame);
      context.clearRect(0, 0, width, height);
      previous = performance.now();
      if (!motionPaused()) frame = requestAnimationFrame(draw);
    }
    resize(); update();
    window.addEventListener("resize", resize, { passive: true });
    document.addEventListener("motionchange", update);
  }

  function projectCard(repo, index) {
    const card = element("article", "project-card glass");
    const art = element("div", `project-art art-${index % 3}`);
    art.setAttribute("aria-hidden", "true");
    art.append(element("span", "", ["{ * }", "< / >", "( ui )"][index % 3]), element("small", "", repo.language || "Kod & fikir"));
    const body = element("div", "project-body");
    const descriptions = {
      "gold-password-generator": "Parola üretimi ve güç kontrolünü altın-siyah bir arayüzde birleştiren web aracı.",
      "Eyup-Challenge": "GitHub'da paylaştığım TypeScript çalışma deposu.",
      "funnyofcomu": "HTML tabanlı web çalışmam. Dosyaları ve geliştirmeleri GitHub'da inceleyebilirsin.",
      "eyupcalskanozturk-tr.github.io": "Kişisel portfolyomun kaynak kodları ve web denemelerim."
    };
    const tags = element("ul", "tags");
    tags.setAttribute("aria-label", "Teknolojiler ve konular");
    const topics = Array.isArray(repo.topics) ? repo.topics.filter((topic) => typeof topic === "string").slice(0, 2) : [];
    [...new Set([repo.language || "GitHub", ...topics])].forEach((tag) => tags.append(element("li", "", tag)));
    const links = element("div", "project-links");
    links.append(externalLink("Kaynak kod ↗", webURL(repo.html_url)));
    const demo = webURL(repo.homepage);
    if (demo) links.append(externalLink("Canlı demo ↗", demo));
    body.append(element("h3", "", repo.name), element("p", "", descriptions[repo.name] || repo.description || "Kaynak kodları ve güncel geliştirmeler GitHub deposunda."), tags, links);
    card.append(art, body);
    return card;
  }

  // Depo olmayan, bu sitede yayınlanan çalışmalar; API listesinin önünde her zaman görünür.
  const FEATURED = Object.freeze([
    {
      name: "Chen Atölyesi",
      description: "Veri Tabanı I için ER modeli ve Chen notasyonunu uygulamalı öğreten atölye: adım adım çözümlü örnek, alıştırmalar ve otomatik kontrollü diyagram kurma.",
      tags: ["HTML", "Veri tabanı"],
      art: "[ ◇ ]",
      label: "Ders aracı",
      demo: "chen-atolyesi/",
      source: "https://github.com/eyupcalskanozturk-tr/eyupcalskanozturk-tr.github.io/tree/main/chen-atolyesi"
    }
  ]);
  function featuredCard(item) {
    const card = element("article", "project-card glass");
    const art = element("div", "project-art art-2");
    art.setAttribute("aria-hidden", "true");
    art.append(element("span", "", item.art), element("small", "", item.label));
    const body = element("div", "project-body");
    const tags = element("ul", "tags");
    tags.setAttribute("aria-label", "Teknolojiler ve konular");
    item.tags.forEach((tag) => tags.append(element("li", "", tag)));
    const links = element("div", "project-links");
    const open = element("a", "", "Atölyeyi aç ↗");
    open.href = item.demo;
    links.append(open, externalLink("Kaynak kod ↗", item.source));
    body.append(element("h3", "", item.name), element("p", "", item.description), tags, links);
    card.append(art, body);
    return card;
  }

  async function loadProjects() {
    const status = $("#project-status");
    const retry = $("#retry-projects");
    const grid = $("#project-grid");
    retry.hidden = true;
    grid.setAttribute("aria-busy", "true");
    status.textContent = "GitHub projeleri güncelleniyor…";
    try {
      const response = await fetchWithTimeout(`https://api.github.com/users/${encodeURIComponent(CONFIG.github)}/repos?sort=updated&per_page=100`, { headers: { Accept: "application/vnd.github+json" } });
      if (!response.ok) throw new Error(`GitHub: ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error("Geçersiz depo yanıtı");
      const repos = data.filter((repo) => repo && typeof repo.name === "string" && !repo.fork && !repo.archived && !repo.private && repo.name.toLowerCase() !== CONFIG.github.toLowerCase() && webURL(repo.html_url)).slice(0, Math.max(0, CONFIG.maxProjects - FEATURED.length));
      grid.replaceChildren(...FEATURED.map(featuredCard), ...repos.map(projectCard));
      status.textContent = repos.length ? "GitHub'daki güncel, herkese açık projelerim. Fork ve arşiv depoları gösterilmez." : "Henüz gösterilecek herkese açık bir proje yok. Yeni çalışmalar burada görünecek.";
    } catch {
      status.textContent = "GitHub'a şu an ulaşılamıyor. Mevcut proje listesi korunuyor; daha sonra yeniden deneyebilirsin.";
      retry.hidden = false;
    } finally { grid.setAttribute("aria-busy", "false"); }
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
      button.textContent = "Mesajı gönder ↗";
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
  initNavigation();
  initMotion();
  initTyping();
  initReveal();
  initParticles();
  initContact();
  $("#retry-projects").addEventListener("click", loadProjects);
  loadProjects();
})();
