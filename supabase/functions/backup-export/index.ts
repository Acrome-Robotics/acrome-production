// backup-export: tüm public tabloların JSON yedeğini (gzip) döner. Google Apps Script haftalık çağırıp Google Drive'a kaydeder.
// Kimlik: x-backup-token başlığı Vault'taki backup_token ile aynı olmalı. ?check=1 yalnızca özet (tablo/satır sayısı) döner.
// sürüm 2: "sema" alanında veritabanı yapısı (backup_schema_ddl) da var.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  try {
    const { data: tok, error: te } = await db.rpc("backup_get_token");
    if (te || !tok || req.headers.get("x-backup-token") !== tok) return json({ error: "yetkisiz" }, 401);
    const check = new URL(req.url).searchParams.get("check") === "1";
    const { data: tables, error } = await db.rpc("backup_tables");
    if (error) throw error;
    const out: Record<string, unknown> = { kaynak: "acrome-production (Supabase fjgeoxuyrcsiwghkehap)", alindi: new Date().toISOString(), surum: 2, tablolar: {} };
    const counts: Record<string, number> = {}; const errors: Record<string, string> = {};
    for (const t of tables as { name: string; pk: string | null }[]) {
      const rows: unknown[] = [];
      for (let k = 0; ; k += 1000) {
        let q = db.from(t.name).select("*");
        if (t.pk) q = q.order(t.pk, { ascending: true });
        const { data, error: e } = await q.range(k, k + 999);
        if (e) { errors[t.name] = e.message; break; }
        rows.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      counts[t.name] = rows.length;
      (out.tablolar as Record<string, unknown>)[t.name] = rows;
    }
    out.satir_sayilari = counts; if (Object.keys(errors).length) out.hatalar = errors;
    const { data: ddl, error: de } = await db.rpc("backup_schema_ddl");
    if (de) errors["_sema"] = de.message; else out.sema = ddl;
    const text = JSON.stringify(out);
    if (check) return json({ tablo: Object.keys(counts).length, satir: Object.values(counts).reduce((a, b) => a + b, 0), boyut_kb: Math.round(text.length / 1024), sema_kb: Math.round(String(ddl || "").length / 1024), hatalar: errors });
    const gz = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
    return new Response(gz, { headers: { "Content-Type": "application/gzip", "Content-Disposition": "attachment; filename=acrome-site-yedek.json.gz" } });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
