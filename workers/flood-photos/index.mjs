// PUT /obj/<key> (body = a JPEG already stripped of EXIF by the caller), GET /obj/<key> (owner review), DELETE /obj/<key>.
// Every request needs the x-photo-secret header; without it (or with a wrong one) the answer is 404, so the Worker looks empty to anyone else.
// Keys are limited to reports/<digits>/<hex>.jpg. Nothing is ever listed or served publicly.
const KEY = /^reports\/\d{1,12}\/[a-f0-9]{16,64}\.jpg$/;
const MAX = 6 * 1024 * 1024;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const nope = () => new Response("not found", { status: 404 });
    if (!env.PHOTO_SECRET || req.headers.get("x-photo-secret") !== env.PHOTO_SECRET) return nope();
    if (!url.pathname.startsWith("/obj/")) return nope();
    const key = decodeURIComponent(url.pathname.slice(5));
    if (!KEY.test(key)) return new Response("bad key", { status: 400 });
    if (req.method === "PUT") {
      const len = Number(req.headers.get("content-length") || 0);
      if (len > MAX) return new Response("too large", { status: 413 });
      const body = await req.arrayBuffer();
      if (body.byteLength > MAX || body.byteLength < 100) return new Response("bad size", { status: 413 });
      await env.PHOTOS.put(key, body, { httpMetadata: { contentType: "image/jpeg", cacheControl: "private, no-store" } });
      return Response.json({ ok: true, key, bytes: body.byteLength });
    }
    if (req.method === "GET") {
      const o = await env.PHOTOS.get(key);
      if (!o) return nope();
      return new Response(o.body, { headers: { "content-type": "image/jpeg", "cache-control": "private, no-store" } });
    }
    if (req.method === "DELETE") { await env.PHOTOS.delete(key); return Response.json({ ok: true }); }
    return new Response("method not allowed", { status: 405 });
  },
};
