// support-mail-ingest: Google Apps Script'in (Serhan'ın Google hesabında, günde 2 kez) gönderdiği support@acrome.net
// mail konularını Acrome Support sistemine yazar. Gmail'de hiçbir şey değiştirilmez; Apps Script yalnız okur.
// Yeni konular needs_triage=true ile açılır; sınıflandırma/birleştirme/özet işini Claude'un yapay zekâ görevi yapar.
// Kimlik: x-backup-token.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

type Addr = { name: string; email: string };
type Msg = { id: string; date: string; from: string; to?: string; cc?: string; replyTo?: string; subject?: string; body?: string; attachments?: string[]; trashed?: boolean };
type Thread = { id: string; messages: Msg[] };

const ACROME = /@acrome\.net$/i;
function addrs(s?: string): Addr[] {
  const out: Addr[] = [];
  if (!s) return out;
  const re = /(?:"([^"]*)"|([^"<,]*?))\s*<([^<>\s]+@[^<>\s]+)>|([^\s,<>"]+@[^\s,<>"]+)/g;
  for (const m of s.matchAll(re)) out.push({ name: (m[1] ?? m[2] ?? "").trim(), email: (m[3] || m[4] || "").trim().toLowerCase() });
  return out;
}
const strip = (s: string) => (s || "").replace(/^\s*((re|fw|fwd|ynt|ilt|aw|wg|tr)\s*:\s*)+/i, "").trim();
const norm = (s: string) => strip(s).toLowerCase().replace(/\s+/g, " ");

// Yalnız bu mesajın yeni metni: alıntılanan eski yazışma, ">" satırları ve imza ayracı sonrası atılır.
function clean(body: string, isFwd: boolean) {
  const L = (body || "").replace(/\r/g, "").split("\n");
  const cutAt = (i: number) => {
    const l = L[i], two = l + " " + (L[i + 1] || "");
    if (/^\s*On\b.{4,250}\bwrote:\s*$/i.test(l) || /^\s*On\b.{4,250}\bwrote:\s*$/i.test(two)) return true;
    if (/tarihinde.{0,200}(şunu yazdı|yazdı)\s*:?\s*$/i.test(l) || /tarihinde.{0,200}(şunu yazdı|yazdı)\s*:?\s*$/i.test(two)) return true;
    if (/^\s*(Le\b.{4,250}a écrit|Am\b.{4,250}schrieb|El\b.{4,250}escribió|Il\b.{4,250}ha scritto)\s*:?\s*$/i.test(l)) return true;
    if (/^\s*-{2,}\s*(Original Message|Orijinal İleti|Özgün İleti)\s*-*\s*$/i.test(l)) return true;
    if (/^\s*_{10,}\s*$/.test(l) && /^\s*(From|Kimden):/i.test(L[i + 1] || "")) return true;
    if (!isFwd && /^\s*(From|Kimden):\s.+/i.test(l) && L.slice(i + 1, i + 5).some((x) => /^\s*(Sent|Date|Gönderildi|Tarih):/i.test(x))) return true;
    if (/^--\s*$/.test(l)) return true;
    return false;
  };
  const keep: string[] = [];
  for (let i = 0; i < L.length; i++) {
    if (cutAt(i)) break;
    if (/^\s*>/.test(L[i])) continue;
    keep.push(L[i]);
  }
  let t = keep.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!t) t = (body || "").trim();
  return t.length > 6000 ? t.slice(0, 6000) + "\n[…]" : t;
}

function msgOf(m: Msg, thread: string, hesap: string) {
  let from = addrs(m.from)[0] || { name: m.from || "", email: "" };
  // "Ad via Support" <support@acrome.net>: gerçek gönderen Reply-To'dadır
  if (/via\s+support/i.test(from.name) || from.email === "support@acrome.net") {
    const rt = addrs(m.replyTo).find((a) => !ACROME.test(a.email));
    if (rt) from = { name: from.name.replace(/\s*via\s+support\s*/i, "").trim() || rt.name || rt.email, email: rt.email };
  }
  const rcpt = [...addrs(m.to), ...addrs(m.cc)];
  const dir = !ACROME.test(from.email) ? "in" : rcpt.some((a) => !ACROME.test(a.email)) ? "out" : "internal";
  let url: string | null = null;
  try { url = `https://mail.google.com/mail/?authuser=${hesap}#all/thread-f:${BigInt("0x" + thread)}|msg-f:${BigInt("0x" + m.id)}`; } catch { /* id hex değilse link yok */ }
  return {
    external_id: m.id, source: "gmail", direction: dir, dedupe: true, thread_id: thread,
    from_name: from.name || from.email, from_email: from.email || null,
    to_emails: rcpt.map((a) => a.email).join(", ") || null,
    sent_at: m.date, subject: m.subject || null,
    body: clean(m.body || "", /^\s*(fw|fwd|ilt|wg|tr)\s*:/i.test(m.subject || "")),
    url, attachments: (m.attachments || []).slice(0, 30).map((n) => ({ name: n })),
  };
}

Deno.serve(async (req) => {
  try {
    const { data: tok } = await db.rpc("backup_get_token");
    if (!tok || req.headers.get("x-backup-token") !== tok) return json({ error: "yetkisiz" }, 401);
    const p = await req.json() as { hesap?: string; threads?: Thread[]; bitti?: boolean };
    const hesap = p.hesap || "";
    const rapor = { konu: 0, yeni_mesaj: 0, yeni_konu: [] as number[], eklenen: [] as number[], hatalar: [] as string[] };

    for (const th of p.threads || []) {
      const all = (th.messages || []).filter((m) => m.id && m.date && !m.trashed);
      if (!all.length) continue;
      const { data: have } = await db.from("support_messages").select("external_id").in("external_id", all.map((m) => m.id));
      const known = new Set((have || []).map((x) => x.external_id));
      const fresh = all.filter((m) => !known.has(m.id)).sort((a, b) => a.date.localeCompare(b.date));
      if (!fresh.length) continue;
      const msgs = fresh.map((m) => msgOf(m, th.id, hesap));

      let { data: t } = await db.from("support_tickets").select("id").contains("gmail_thread_ids", [th.id]).limit(1).maybeSingle();
      const first = all.map((m) => msgOf(m, th.id, hesap)).find((m) => m.direction === "in");
      const subj = strip(all[0].subject || "") || "(konu yok)";
      // Gmail konu değişince yeni thread açar: aynı başlık + aynı müşteri alan adı, son 45 gün → aynı konu
      if (!t && first?.from_email && norm(subj).length >= 6) {
        const dom = first.from_email.split("@")[1];
        const generic = /^(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|yandex|me|msn|aol|proton|protonmail)\./i.test(dom);
        const cq = db.from("support_tickets").select("id,subject,contact_email")
          .gte("last_activity_at", new Date(Date.now() - 45 * 864e5).toISOString()).neq("category", "other");
        const likeEsc = (x: string) => x.replace(/[\\%_]/g, (c) => "\\" + c);
        const { data: cand } = await (generic ? cq.eq("contact_email", first.from_email) : cq.ilike("contact_email", `%@${likeEsc(dom)}`)).limit(50);
        t = (cand || []).find((k) => norm(k.subject) === norm(subj)) || null;
      }
      const ticket: Record<string, unknown> = { gmail_thread_id: th.id };
      if (t) ticket.ticket_id = t.id;
      else Object.assign(ticket, { subject: subj, category: "support", opened_at: all[0].date, contact_email: first?.from_email || null, customer_name: first?.from_name || null });

      const { data: tid, error } = await db.rpc("support_ingest", { p: { ticket, messages: msgs } });
      if (error) { rapor.hatalar.push(`${th.id}: ${error.message}`); continue; }
      if (!t) { await db.from("support_tickets").update({ needs_triage: true }).eq("id", tid); rapor.yeni_konu.push(tid as number); }
      else rapor.eklenen.push(tid as number);
      rapor.konu++; rapor.yeni_mesaj += msgs.length;
    }

    let bildirim: string | null = null;
    if (p.bitti) {
      const { data: b } = await db.rpc("support_push_flush"); bildirim = b as string;
      await db.from("support_sync_state").upsert({ key: "gmail", value: { last: new Date().toISOString(), kaynak: "apps-script" }, updated_at: new Date().toISOString() });
    }
    return json({ ok: rapor.hatalar.length === 0, ...rapor, bildirim });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
