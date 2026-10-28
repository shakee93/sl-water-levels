/* waterlevels.lk embed helper (optional). Lets each waterlevels.lk widget iframe on this page grow or shrink to fit its content.
   Usage: <script src="https://waterlevels.lk/embed.js" async></script>  (once per page). Without it, the iframe's fixed height is used. */
(function () {
  var ORIGIN = "https://waterlevels.lk";
  try { var s = document.currentScript; if (s && s.src) ORIGIN = new URL(s.src).origin; } catch (e) {}
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (e.origin !== ORIGIN || !d || d.type !== "waterlevels-embed-height" || typeof d.h !== "number") return;
    var frames = document.getElementsByTagName("iframe");
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === e.source) { frames[i].style.height = Math.ceil(d.h) + "px"; frames[i].setAttribute("height", Math.ceil(d.h)); }
    }
  });
})();
