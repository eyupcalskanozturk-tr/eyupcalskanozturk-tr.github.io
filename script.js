// Otomatik yıl
document.getElementById("year").textContent = new Date().getFullYear();

// Tema geçişi
const toggle = document.getElementById("themeToggle");
toggle.addEventListener("click", () => {
  document.body.classList.toggle("light");
});

// Fade-in animasyon
const fades = document.querySelectorAll(".fade-in");
window.addEventListener("scroll", () => {
  fades.forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight - 100) el.classList.add("visible");
  });
});
