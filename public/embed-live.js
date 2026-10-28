/* waterlevels.lk embed widgets: the only script on a static widget page (no framework). Re-reads this same address every 5 minutes
   (30 s while there is nothing to show) and swaps the widget's content, tells a parent page that uses /embed.js how tall it is, and sends
   one anonymous "embed_view" event (embedding site's hostname only) when the widget is shown on someone else's site. */
(function () {
  var wrap = document.getElementById("wl");
  if (!wrap) return;
  var widget = (document.currentScript && document.currentScript.getAttribute("data-widget")) || "";
  var EVERY = 300000, last = Date.now();
  function empty() { return !wrap.querySelector("h1,a,li,p.flex"); }
  function refresh() {
    fetch(location.href, { cache: "default" }).then(function (r) { return r.ok ? r.text() : null; }).then(function (t) {
      if (!t) return;
      var n = new DOMParser().parseFromString(t, "text/html").getElementById("wl");
      if (n && n.innerHTML !== wrap.innerHTML) wrap.innerHTML = n.innerHTML;
      last = Date.now();
    }).catch(function () {});
  }
  var timer = setInterval(refresh, EVERY);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && Date.now() - last > EVERY) refresh(); });
  var prev = 0;
  function send() {
    var h = Math.ceil(wrap.getBoundingClientRect().height);
    if (h !== prev && window.parent !== window) { prev = h; window.parent.postMessage({ type: "waterlevels-embed-height", h: h }, "*"); }
  }
  send();
  if (window.ResizeObserver) new ResizeObserver(send).observe(wrap);
  var host = "";
  try { host = document.referrer ? new URL(document.referrer).hostname : ""; } catch (e) {}
  if (host && host !== location.hostname && host !== "waterlevels.lk" && host !== "localhost") {
    var s = document.createElement("script");
    s.src = "https://analytics.freshpixl.com/script.js"; s.defer = true;
    s.setAttribute("data-website-id", "a15ed279-5a97-4e07-8aa6-3d7431957c94"); s.setAttribute("data-auto-track", "false");
    s.onload = function () { try { window.umami && window.umami.track("embed_view", { site: host, widget: widget }); } catch (e) {} };
    document.head.appendChild(s);
  }
})();
