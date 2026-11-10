// support-refresh: Support sayfasındaki "Şimdi güncelle" düğmesi.
// Giriş yapmış Yönetici / Sipariş + Support kullanıcısı çağırır (verify_jwt = true), 10 dakikada bir.
//  1) Gmail: Serhan'ın hesabındaki Apps Script web uygulamasını çağırır (adres: integ secret "support_gmail_webapp_url").
//     Apps Script mevcut mail senkronunu çalıştırır ve mailleri support-mail-ingest'e gönderir. Gmail'de hiçbir şey değiştirilmez.
//  2) Basecamp: basecamp-sync'i çağırır (yalnız okur).
// Yanıt: { wait } (bekleme süresi, sn) ya da { gmail, basecamp, yeni_mesaj }.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const BASE = Deno.env.get("SUPABASE_URL")!;
const db = createClient(BASE, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const short = (s: string) => s.replace(/\s+/g, " ").slice(0, 200);

async function call(url: string, init: RequestInit, ms: number) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { ...init, signal: ac.signal, redirect: "follow" });
    const txt = await r.text();
    let body: unknown = txt; try { body = JSON.parse(txt); } catch { body = short(txt); }
    const fail = body && typeof body === "object" && (body as { ok?: boolean }).ok === false;
    return { ok: r.ok && !fail, status: r.status, body: fail ? String((body as { error?: string }).error || "hata") : body };
  } catch (e) {
    return { ok: false, status: 0, body: (e as Error)?.name === "AbortError" ? "zaman aşımı" : short(String((e as Error)?.message || e)) };
  } finally { clearTimeout(t); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u, error: ue } = await db.auth.getUser(jwt);
    if (ue || !u?.user) return json({ error: "Giriş gerekli" }, 401);
    const { data: wait, error: ce } = await db.rpc("support_refresh_claim", { p_user: u.user.id });
    if (ce) return json({ error: ce.message }, 403);
    if ((wait as number) > 0) return json({ wait });

    const started = new Date().toISOString();
    const { data: tok } = await db.rpc("backup_get_token");
    const { data: url } = await db.rpc("integ_secret_get", { p_name: "support_gmail_webapp_url" });
    const [gmail, basecamp] = await Promise.all([
      url ? call(url as string, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ token: tok, action: "support_sync" }) }, 120_000)
          : Promise.resolve({ ok: false, status: 0, body: "Apps Script bağlantısı henüz kurulmadı" }),
      call(`${BASE}/functions/v1/basecamp-sync`, { method: "POST", headers: { "x-backup-token": String(tok), "Content-Type": "application/json" }, body: "{}" }, 120_000),
    ]);
    const { count } = await db.from("support_messages").select("id", { count: "exact", head: true }).gte("created_at", started);
    await db.from("support_sync_state").update({ value: { by: u.user.id, last: started, gmail: gmail.ok, basecamp: basecamp.ok, yeni: count || 0 } }).eq("key", "manual");
    return json({ gmail, basecamp, yeni_mesaj: count || 0 });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
