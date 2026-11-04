/* Ziyaretçi istatistiği: Umami Cloud (çerez kullanmaz, kişiyi tanımaz; sayfa, ülke, cihaz, nereden gelindiği).
   Kimlik tek yerde: UMAMI_ID (Umami panelinde sitenin "website ID"si). Boşsa hiçbir şey yüklenmez.
   Yalnız canlı alan adında sayar: yerel önizlemeler ve testler istatistiğe karışmaz.
   Bir tarayıcıyı saymanın dışında bırakmak için sitenin terminalinde "beni-sayma" yaz
   (Umami'nin kendi anahtarı: localStorage "umami.disabled"). Her sayfanın <head>'inde bu dosya var. */
(function () {
  "use strict";
  var UMAMI_ID = "07708f7a-94d6-4b2d-83fd-ecd1f5cce99f";
  var ALAN = "eyupcalskanozturk-tr.github.io";
  if (!UMAMI_ID || location.hostname !== ALAN) return;
  var s = document.createElement("script");
  s.defer = true;
  s.src = "https://cloud.umami.is/script.js";
  s.setAttribute("data-website-id", UMAMI_ID);
  s.setAttribute("data-domains", ALAN);
  document.head.appendChild(s);
})();
