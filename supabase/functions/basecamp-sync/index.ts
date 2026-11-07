// basecamp-sync: Basecamp "Customer Support" projesindeki Supports panosundan, son çalışmadan beri değişen
// kartları ve yorumları Acrome Support sistemine aktarır. Basecamp'te HİÇBİR ŞEY değiştirmez (yalnız GET).
//  - GET ?code=...            : Basecamp OAuth dönüşü (bir kez, bağlantı kurulurken)
//  - POST + x-backup-token    : senkron (pg_cron 09:36 ve 16:36'da basecamp_sync_run() ile çağırır)
//  - POST ?check=1            : yalnız bağlantı kontrolü
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const BASE = Deno.env.get("SUPABASE_URL")!;
const db = createClient(BASE, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const ACC = "4261505", P = "13493378";
const API = `https://3.basecampapi.com/${ACC}`;
const REDIRECT = "https://fjgeoxuyrcsiwghkehap.supabase.co/functions/v1/basecamp-sync";
const UA = "Acrome Production Site (https://acrome-robotics.github.io/acrome-production/)";
const COLS: Record<string, string> = { "5437218311": "Triage", "5437218312": "Not now", "5437218313": "BackLog", "5437218314": "In progress", "5437218315": "Done" };
const ST: Record<string, string> = { "Done": "closed", "In progress": "ours", "BackLog": "ours", "Triage": "new", "Not now": "ours" };

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const escH = (x: string) => String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const page = (msg: string, ok: boolean) => new Response(`<!doctype html><meta charset="utf-8"><title>Basecamp bağlantısı</title><body style="font-family:system-ui;padding:40px;max-width:560px"><h2 style="color:${ok ? "#1a7f37" : "#b42318"}">${ok ? "✓ Basecamp bağlandı" : "Basecamp bağlanamadı"}</h2><p>${msg}</p></body>`, { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8" } });
const sec = async (n: string) => (await db.rpc("integ_secret_get", { p_name: n })).data as string | null;
const setSec = async (n: string, v: string) => { const { error } = await db.rpc("integ_secret_set", { p_name: n, p_value: v }); if (error) throw error; };

function text(h: string | null | undefined) {
  if (!h) return "";
  let s = h.replace(/<bc-attachment[^>]*filename="([^"]*)"[^>]*>[\s\S]*?<\/bc-attachment>/g, "[ek: $1]");
  s = s.replace(/<br\s*\/?>|<\/div>|<\/p>|<\/li>/g, "\n").replace(/<[^>]+>/g, "");
  s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
       .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

async function launchpad(params: Record<string, string>) {
  const r = await fetch("https://launchpad.37signals.com/authorization/token?" + new URLSearchParams(params), { method: "POST", headers: { "User-Agent": UA } });
  const t = await r.text();
  if (!r.ok) throw new Error("Basecamp token hatası " + r.status + ": " + t.slice(0, 200));
  return JSON.parse(t) as { access_token: string; refresh_token?: string; expires_in?: number };
}

async function saveTokens(t: { access_token: string; refresh_token?: string; expires_in?: number }) {
  await setSec("basecamp_access_token", t.access_token);
  if (t.refresh_token) await setSec("basecamp_refresh_token", t.refresh_token);
  await setSec("basecamp_token_expires", new Date(Date.now() + (t.expires_in || 1209600) * 1000).toISOString());
}

async function accessToken() {
  const [tok, exp, refresh, cid, csec] = await Promise.all(["basecamp_access_token", "basecamp_token_expires", "basecamp_refresh_token", "basecamp_client_id", "basecamp_client_secret"].map(sec));
  if (!refresh || !cid || !csec) throw new Error("BAGLI_DEGIL");
  if (tok && exp && new Date(exp).getTime() - Date.now() > 3600_000) return tok;
  const t = await launchpad({ type: "refresh", refresh_token: refresh, client_id: cid, redirect_uri: REDIRECT, client_secret: csec });
  await saveTokens(t);
  return t.access_token;
}

let TOKEN = "";
async function bc(url: string): Promise<unknown[]> {
  const out: unknown[] = [];
  let next: string | null = url.startsWith("http") ? url : API + url;
  while (next) {
    let r: Response;
    for (let i = 0; ; i++) {
      r = await fetch(next, { headers: { Authorization: "Bearer " + TOKEN, "User-Agent": UA } });
      if (r.status === 429 && i < 3) { await new Promise((ok) => setTimeout(ok, (+(r.headers.get("Retry-After") || 5)) * 1000)); continue; }
      break;
    }
    if (!r!.ok) throw new Error("Basecamp API " + r!.status + " " + next);
    const d = await r!.json();
    if (Array.isArray(d)) out.push(...d); else return [d];
    const m = (r!.headers.get("Link") || "").match(/<([^>]+)>;\s*rel="next"/);
    next = m ? m[1] : null;
  }
  return out;
}

const norm = (s: string) => (s || "").toLowerCase().replace(/^((re|fw|fwd|ynt|ilt)\s*:\s*)+/i, "").replace(/\s+/g, " ").trim();

type Card = { id: number; title: string; content: string; created_at: string; updated_at: string; app_url: string; comments_count: number; creator: { name: string; email_address?: string } };
type Com = { id: number; content: string; created_at: string; creator: { name: string; email_address?: string } };

async function sync() {
  TOKEN = await accessToken();
  const { data: stRow } = await db.from("support_sync_state").select("value").eq("key", "basecamp_cards").maybeSingle();
  const since = (stRow?.value as { last?: string })?.last || "2026-11-04T06:30:00Z";
  const now = new Date().toISOString();
  const rapor = { kart: 0, mesaj: 0, eklenen: [] as number[], yeni_konu: [] as number[], kapatilan: [] as number[] };
  for (const [cid, cname] of Object.entries(COLS)) {
    const cards = await bc(`/buckets/${P}/card_tables/lists/${cid}/cards.json`) as Card[];
    for (const c of cards) {
      if (!(Date.parse(c.updated_at || "") > Date.parse(since))) continue;
      const msgs: Record<string, unknown>[] = [{ external_id: `bccard:${c.id}`, source: "basecamp", direction: "internal", from_name: c.creator?.name,
        sent_at: c.created_at, subject: c.title, body: (text(c.content) || "(kart açıklaması yok)").slice(0, 8000), url: c.app_url }];
      if (c.comments_count) {
        for (const x of await bc(`/buckets/${P}/recordings/${c.id}/comments.json`) as Com[]) {
          msgs.push({ external_id: `bccom:${x.id}`, source: "basecamp", direction: "internal", from_name: x.creator?.name, from_email: x.creator?.email_address || null,
            sent_at: x.created_at, body: text(x.content).slice(0, 8000), url: `${c.app_url}#__recording_${x.id}` });
        }
      }
      // konuyu bul: 1) bu kart zaten bağlı mı  2) aynı konu başlıklı, son 45 günde açılmış konu (Basecamp'e yönlendirilen mail)
      let { data: t } = await db.from("support_tickets").select("id,status,last_inbound_at,last_outbound_at").contains("basecamp_urls", [c.app_url]).limit(1).maybeSingle();
      if (!t && norm(c.title).length >= 6) {
        const { data: cand } = await db.from("support_tickets").select("id,subject,status,last_inbound_at,last_outbound_at")
          .gte("opened_at", new Date(Date.parse(c.created_at) - 45 * 864e5).toISOString()).neq("category", "other").order("last_activity_at", { ascending: false }).limit(300);
        t = (cand || []).find((k) => norm(k.subject) === norm(c.title)) || null;
      }
      const ticket: Record<string, unknown> = { basecamp_url: c.app_url };
      if (t) {
        ticket.ticket_id = t.id;
        const answered = !t.last_inbound_at || (t.last_outbound_at && t.last_outbound_at >= t.last_inbound_at);
        if (cname === "Done" && ["ours", "new"].includes(t.status) && answered) { ticket.status = "closed"; rapor.kapatilan.push(t.id); }
      } else {
        Object.assign(ticket, { subject: c.title, opened_at: c.created_at, status: ST[cname], category: "support" });
      }
      const { data: tid, error } = await db.rpc("support_ingest", { p: { ticket, messages: msgs } });
      if (error) throw new Error(`Kart ${c.id}: ${error.message}`);
      if (!t) { await db.from("support_tickets").update({ needs_triage: true }).eq("id", tid); rapor.yeni_konu.push(tid as number); }
      else rapor.eklenen.push(tid as number);
      rapor.kart++; rapor.mesaj += msgs.length;
    }
  }
  await db.from("support_sync_state").upsert({ key: "basecamp_cards", value: { last: now, kaynak: "basecamp-sync" }, updated_at: now });
  return rapor;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  try {
    // OAuth dönüşü
    if (req.method === "GET" && (url.searchParams.has("code") || url.searchParams.has("error"))) {
      if (url.searchParams.has("error")) return page("Basecamp izni verilmedi.", false);
      const state = url.searchParams.get("state");
      if (!state || !/^[0-9a-f]{48}$/.test(state)) return page("Geçersiz bağlantı isteği.", false);
      const since = new Date(Date.now() - 20 * 60_000).toISOString();
      // state tek seferlik: kontrol ve tüketme aynı işlemde
      const { data: st } = await db.from("integ_oauth_states").update({ used_at: new Date().toISOString() })
        .eq("provider", "basecamp").eq("state", state).is("used_at", null).gte("created_at", since).select("state").maybeSingle();
      if (!st) return page("Bağlantı linkinin süresi dolmuş ya da daha önce kullanılmış. SQL Editor'da basecamp_connect_url komutunu yeniden çalıştırıp yeni linki açın.", false);
      const [cid, csec] = await Promise.all([sec("basecamp_client_id"), sec("basecamp_client_secret")]);
      const t = await launchpad({ type: "web_server", client_id: cid!, redirect_uri: REDIRECT, client_secret: csec!, code: url.searchParams.get("code")! });
      const who = await (await fetch("https://launchpad.37signals.com/authorization.json", { headers: { Authorization: "Bearer " + t.access_token, "User-Agent": UA } })).json();
      if (!(who?.accounts || []).some((a: { id: number }) => String(a.id) === ACC)) return page("Bu Basecamp hesabının Acrome hesabına (4261505) erişimi yok.", false);
      await saveTokens(t);
      return page(`${escH(who?.identity?.first_name || "")} hesabıyla bağlandı. Support panosu her gün 09:36 ve 16:36'da salt okunur olarak siteye aktarılacak. Bu sekmeyi kapatabilirsiniz.`, true);
    }
    const { data: tok } = await db.rpc("backup_get_token");
    if (!tok || req.headers.get("x-backup-token") !== tok) return json({ error: "yetkisiz" }, 401);
    if (url.searchParams.get("check") === "1") {
      TOKEN = await accessToken();
      const cards = await bc(`/buckets/${P}/card_tables/lists/5437218311/cards.json`);
      return json({ ok: true, triage_kart: cards.length });
    }
    const r = await sync();
    return json({ ok: true, ...r });
  } catch (e) {
    const m = String((e as Error)?.message || e);
    if (req.method === "GET") { console.error(m); return page("Bağlantı sırasında bir hata oluştu; tekrar deneyin.", false); }
    if (m === "BAGLI_DEGIL") return json({ ok: false, error: "Basecamp bağlantısı kurulmamış" }, 200);
    return json({ ok: false, error: m }, 500);
  }
});
