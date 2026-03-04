document.addEventListener('DOMContentLoaded', function() {
    AOS.init({ duration: 800, once: false, offset: 20 });
});

window.addEventListener('scroll', function() {
    const scrollPos = window.scrollY;
    const heroContent = document.querySelector('.hero-content');
    const heroBg = document.querySelector('.hero-bg-container');
    const nav = document.querySelector('#mainNav');

    // Kaybolma ve Parallax
    let opacityValue = 1 - (scrollPos / 600);
    if (opacityValue < 0) opacityValue = 0;
    
    if (heroContent) heroContent.style.opacity = opacityValue;
    if (heroBg) {
        heroBg.style.opacity = opacityValue;
        heroBg.style.transform = `translateY(${scrollPos * 0.15}px)`; 
    }

    // Navbar
    if (scrollPos > 50) {
        nav.classList.add('navbar-scrolled');
    } else {
        nav.classList.remove('navbar-scrolled');
    }
});