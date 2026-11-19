// support-push: yeni support maili bildirimi (Web Push, içeriksiz). Gateway JWT doğrular.
// action=publicKey -> tarayıcının abone olması için VAPID açık anahtarı (yoksa üretir, vault'a yazar)
// action=flush     -> bekleyen bildirimleri gönderir (ayrıca x-push-token veritabanındaki belirteçle aynı olmalı)
// NOT: bu dosya canlıdan alındı; VAPID "sub" alanındaki yönetici e-posta adresi public depoda durmasın diye yer tutucuya çevrildi.
// Canlıya yeniden yayınlarken gerçek adresi geri koyun (ya da VAPID_SUBJECT ortam değişkenine taşıyın).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-push-token",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const b64u = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = new TextEncoder();

async function getConfig() {
  const { data, error } = await db.rpc("push_get_config");
  if (error) throw error;
  let keys = data?.keys;
  if (!keys) {
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
    const priv = await crypto.subtle.exportKey("jwk", kp.privateKey);
    const pub = b64u(await crypto.subtle.exportKey("raw", kp.publicKey));
    const r = await db.rpc("push_set_keys", { k: { priv, pub } });
    if (r.error) throw r.error;
    const again = await db.rpc("push_get_config");
    keys = again.data?.keys;
  }
  return { keys, token: data?.token as string };
}

async function vapidHeader(endpoint: string, keys: { priv: JsonWebKey; pub: string }) {
  const aud = new URL(endpoint).origin;
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "mailto:YONETICI@example.invalid" })));
  const key = await crypto.subtle.importKey("jwk", keys.priv, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${body}`));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${keys.pub}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const action = new URL(req.url).searchParams.get("action");
  try {
    const cfg = await getConfig();
    if (action === "publicKey") return json({ publicKey: cfg.keys.pub });
    if (action !== "flush") return json({ error: "bilinmeyen işlem" }, 400);
    if (!cfg.token || req.headers.get("x-push-token") !== cfg.token) return json({ error: "yetkisiz" }, 401);

    const { data: pend } = await db.from("support_notifications").select("id,user_id").is("pushed_at", null).limit(500);
    if (!pend?.length) return json({ sent: 0 });
    const users = [...new Set(pend.map((p) => p.user_id))];
    const { data: subs } = await db.from("push_subscriptions").select("id,user_id,endpoint").in("user_id", users);
    let sent = 0, gone = 0, failed = 0;
    for (const s of subs || []) {
      const res = await fetch(s.endpoint, { method: "POST", headers: { TTL: "86400", Urgency: "high", Authorization: await vapidHeader(s.endpoint, cfg.keys), "Content-Length": "0" } });
      if (res.status === 404 || res.status === 410) { gone++; await db.from("push_subscriptions").delete().eq("id", s.id); }
      else if (res.ok) sent++;
      else failed++;
    }
    await db.from("support_notifications").update({ pushed_at: new Date().toISOString() }).in("id", pend.map((p) => p.id));
    return json({ notifications: pend.length, sent, gone, failed });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
