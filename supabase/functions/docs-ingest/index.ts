// docs-ingest: product_docs tablosundaki bir PDF'i (Webflow'daki courseware / user manual / infosheet) indirir,
// sayfa sayfa metnini çıkarır ve product_doc_chunks'a yazar. Webflow'da hiçbir şey değiştirmez (yalnız GET).
// Kimlik: x-backup-token. Gövde: { "id": <product_docs.id> }
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { extractText, getDocumentProxy } from "npm:unpdf@0.12.1";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const ALLOWED = /^https:\/\/(cdn\.prod\.website-files\.com|uploads-ssl\.webflow\.com|s3\.amazonaws\.com\/webflow-prod-assets)\//;

Deno.serve(async (req) => {
  let id = 0;
  try {
    const { data: tok } = await db.rpc("backup_get_token");
    if (!tok || req.headers.get("x-backup-token") !== tok) return json({ error: "yetkisiz" }, 401);
    id = Number((await req.json()).id);
    const { data: d } = await db.from("product_docs").select("id,url,title").eq("id", id).maybeSingle();
    if (!d) return json({ ok: false, error: "doküman yok" }, 404);
    if (!ALLOWED.test(d.url)) throw new Error("izinli olmayan adres");
    const r = await fetch(d.url, { headers: { "User-Agent": "Acrome Production Site (doküman kütüphanesi)" } });
    if (!r.ok) throw new Error("indirme hatası " + r.status);
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length > 40e6) throw new Error("dosya çok büyük");
    const pdf = await getDocumentProxy(buf);
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const pages = (text as string[]).map((t) => (t || "").replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim());
    const rows: { doc_id: number; page: number; part: number; content: string }[] = [];
    pages.forEach((t, i) => { if (!t) return; for (let k = 0, p = 1; k < t.length; k += 3500, p++) rows.push({ doc_id: id, page: i + 1, part: p, content: t.slice(k, k + 3500) }); });
    await db.from("product_doc_chunks").delete().eq("doc_id", id);
    for (let i = 0; i < rows.length; i += 200) { const { error } = await db.from("product_doc_chunks").insert(rows.slice(i, i + 200)); if (error) throw error; }
    const chars = pages.reduce((a, t) => a + t.length, 0);
    await db.from("product_docs").update({ pages: totalPages, chars, status: chars > 200 ? "hazir" : "hata", error: chars > 200 ? null : "metin çıkmadı (taranmış görsel PDF olabilir)", fetched_at: new Date().toISOString() }).eq("id", id);
    return json({ ok: true, id, title: d.title, pages: totalPages, chars, parcalar: rows.length });
  } catch (e) {
    const m = String((e as Error)?.message || e);
    if (id) await db.from("product_docs").update({ status: "hata", error: m.slice(0, 300), fetched_at: new Date().toISOString() }).eq("id", id);
    return json({ ok: false, id, error: m }, 500);
  }
});
