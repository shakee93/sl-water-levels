// GET /api/move?to=/path — the one-time hand-over page on the OLD address (sl-water-levels.vercel.app) after the move to
// waterlevels.lk (MIGRATION.md). next.config.ts sends only visitors whose phone keeps saved places here (cookie
// sl_has_data). The page reads their saved data from this address's storage, passes it in the URL fragment (never sent to
// any server), clears the cookie so this happens once, and opens the same page on the new address, where
// app/ImportHandover.tsx stores it. Everyone else gets a plain permanent redirect.
import { SITE } from "@/lib/seo";
import { CARRY_KEYS } from "@/app/SavedDataMarker";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("to") ?? "/";
  // only a path on our own site: no scheme, no host, no protocol-relative "//"
  const to = /^\/(?!\/)[^\s]*$/.test(raw) ? raw : "/";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Sri Lanka Water Levels has moved</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#020617;color:#e2e8f0}main{padding:24px;max-width:28rem;text-align:center}a{color:#38bdf8}</style></head>
<body><main><p><strong>Sri Lanka Water Levels is now at waterlevels.lk</strong></p><p>Moving your saved places…</p>
<p><a id="go" href="${SITE}${to}">Continue to waterlevels.lk</a></p></main>
<script>
(function(){
  var keys=${JSON.stringify(CARRY_KEYS)}, data={};
  try{ keys.forEach(function(k){ var v=localStorage.getItem(k); if(v!=null) data[k]=v; }); }catch(e){}
  function go(){
    document.cookie="sl_has_data=; max-age=0; path=/; SameSite=Lax; Secure";
    var url=${JSON.stringify(SITE)}+${JSON.stringify(to)};
    if(Object.keys(data).length){ try{ url+= "#sl-import="+encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(data))))); }catch(e){} }
    document.getElementById("go").href=url;
    location.replace(url);
  }
  // this address's push subscription (alerts keep arriving through it until the phone turns alerts on at the new address,
  // which then replaces it server-side: no double alerts). At most 1.5 s, then go anyway.
  var done=false, finish=function(){ if(!done){ done=true; go(); } };
  setTimeout(finish,1500);
  try{
    navigator.serviceWorker.getRegistration().then(function(r){ return r && r.pushManager.getSubscription(); })
      .then(function(s){ if(s && s.endpoint) data.sl_push_old=s.endpoint; finish(); }, finish);
  }catch(e){ finish(); }
})();
</script></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
