// notify-mail: support dışı bildirimleri (stok sayımı, yoklama hatırlatması) e-postayla gönderir.
// Yalnızca veritabanındaki notify_mail_flush() çağırır (x-push-token ile).
// Gönderim: Google Workspace SMTP (SMTP_USER + SMTP_PASS = uygulama şifresi; SMTP_HOST/PORT varsayılan smtp.gmail.com:465)
// ya da RESEND_API_KEY + MAIL_FROM.
// Gönderici: MAIL_FROM yoksa "Acrome <noreply@acrome.net>". Gmail'de bu adres SMTP_USER hesabına "Farklı gönder" takma adı olarak
// tanımlı değilse Gmail göndereni otomatik olarak SMTP_USER adresine çevirir (gönderim yine olur).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import nodemailer from "npm:nodemailer@6.9.13";

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const env = (k: string) => (Deno.env.get(k) || "").trim();
const SITE = env("SITE_URL") || "https://acrome-robotics.github.io/acrome-production/";
const FROM = env("MAIL_FROM") || "Acrome <noreply@acrome.net>";
const escH = (s: string) => s.replace(/[&<>\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const smtpOn = () => !!(env("SMTP_USER") && env("SMTP_PASS"));

async function send(to: string, subject: string, text: string, html: string, replyTo?: string) {
  if (env("RESEND_API_KEY")) {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], subject, text, html, ...(replyTo ? { reply_to: replyTo } : {}) }) });
    if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return;
  }
  if (smtpOn()) {
    const port = +(env("SMTP_PORT") || 465);
    const t = nodemailer.createTransport({ host: env("SMTP_HOST") || "smtp.gmail.com", port, secure: port === 465,
      auth: { user: env("SMTP_USER"), pass: env("SMTP_PASS").replace(/\s+/g, "") } });
    await t.sendMail({ from: FROM, to, subject, text, html, ...(replyTo ? { replyTo } : {}) });
    return;
  }
  throw new Error("mail ayarı yok");
}

const body = (name: string, title: string, url: string) => {
  const hi = name ? `Merhaba ${name},` : "Merhaba,";
  return {
    text: `${hi}\n\n${title}\n\nAçmak için: ${url}\n\nAcrome Üretim · Satış · Support`,
    html: `<p>${escH(hi)}</p><p style="font-size:15px"><b>${escH(title)}</b></p><p><a href="${escH(url)}" style="display:inline-block;background:#1b2530;color:#fff;padding:9px 16px;border-radius:6px;text-decoration:none">Sitede aç</a></p><p style="color:#777;font-size:12px">Acrome Üretim · Satış · Support — bu e-posta otomatik gönderildi.</p>`,
  };
};

Deno.serve(async (req) => {
  try {
    const { data: cfg } = await db.rpc("push_get_config");
    if (!cfg?.token || req.headers.get("x-push-token") !== cfg.token) return json({ error: "yetkisiz" }, 401);
    if (!env("RESEND_API_KEY") && !smtpOn()) return json({ sent: 0, note: "mail ayarı yok" });
    const action = new URL(req.url).searchParams.get("action");
    if (action === "test") {
      const to = new URL(req.url).searchParams.get("to") || "";
      const { data: p } = await db.from("profiles").select("email,full_name").eq("email", to).maybeSingle();
      if (!p) return json({ error: "bu adres bir kullanıcıya ait değil" }, 400);
      const b = body((p.full_name || "").split(" ")[0], "Test: stok sayımı e-postaları bu adrese gelecek.", SITE + "#/bildirimler");
      await send(p.email, "Acrome · Test e-postası", b.text, b.html);
      return json({ sent: 1 });
    }
    let sent = 0, failed = 0; const errs: string[] = [];
    // 1) kullanıcı bildirimleri (stok sayımı vb.)
    const { data: pend } = await db.from("support_notifications").select("id,user_id,kind,title,link").neq("kind", "support").is("emailed_at", null).limit(200);
    if (pend?.length) {
      const ids = [...new Set(pend.map((p) => p.user_id))];
      const { data: people } = await db.from("profiles").select("id,email,full_name").in("id", ids);
      for (const n of pend) {
        const u = people?.find((p) => p.id === n.user_id);
        if (!u?.email) continue;
        const b = body((u.full_name || "").split(" ")[0], n.title || "Yeni bir bildiriminiz var.", SITE + (n.link || "#/bildirimler"));
        try { await send(u.email, /^sayim/.test(n.kind) ? "Acrome · Stok sayımı" : "Acrome · Bildirim", b.text, b.html); sent++;
          await db.from("support_notifications").update({ emailed_at: new Date().toISOString() }).eq("id", n.id); }
        catch (e) { failed++; errs.push(String((e as Error)?.message || e).slice(0, 160)); }
      }
    }
    // 2) e-posta kuyruğu (hesabı olmayanlar dahil; ör. yoklama hatırlatması) — 2 günden eskiler gönderilmez
    const since = new Date(Date.now() - 2 * 864e5).toISOString();
    // body_text dolu satır (ör. müşteriye support kayıt e-postası): metin olduğu gibi gider, site bağlantısı yok
    const { data: box } = await db.from("mail_outbox").select("id,to_email,to_name,subject,title,link,body_text,reply_to").is("sent_at", null).gte("created_at", since).limit(200);
    for (const m of box || []) {
      const b = m.body_text ? { text: m.body_text, html: `<div style="font-family:Arial,sans-serif;font-size:14px;white-space:pre-wrap">${escH(m.body_text)}</div>` }
        : body((m.to_name || "").split(" ")[0], m.title, SITE + (m.link || ""));
      try { await send(m.to_email, m.subject, b.text, b.html, m.reply_to || undefined); sent++; await db.from("mail_outbox").update({ sent_at: new Date().toISOString(), error: null }).eq("id", m.id); }
      catch (e) { failed++; const msg = String((e as Error)?.message || e).slice(0, 160); errs.push(msg); await db.from("mail_outbox").update({ error: msg }).eq("id", m.id); }
    }
    return json({ sent, failed, errors: errs.slice(0, 3) });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
