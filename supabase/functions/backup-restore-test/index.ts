// backup-restore-test: bir yedek dosyasını (json.gz) ayrı bir deneme şemasına (restore_test) yükler,
// canlı tablolarla satır satır karşılaştırır, sonra deneme şemasını siler. Canlı tablolara HİÇ yazmaz.
// Kimlik: x-backup-token başlığı (backup-export ile aynı anahtar).
// Gövde: Apps Script'in gönderdiği Drive yedeği (gzip). ?kaynak=canli verilirse yedeği anında kendisi üretip onu dener.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const BASE = Deno.env.get("SUPABASE_URL")!;
const db = createClient(BASE, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const { data: tok, error: te } = await db.rpc("backup_get_token");
  if (te || !tok || req.headers.get("x-backup-token") !== tok) return json({ error: "yetkisiz" }, 401);
  const url = new URL(req.url);
  const source = url.searchParams.get("kaynak") === "canli" ? "canli" : "drive";
  const fileName = url.searchParams.get("dosya");

  let buf: ArrayBuffer;
  if (source === "canli") {
    const r = await fetch(`${BASE}/functions/v1/backup-export`, { method: "POST", headers: { "x-backup-token": tok as string } });
    if (!r.ok) return json({ error: "Canlı yedek alınamadı: " + r.status }, 502);
    buf = await r.arrayBuffer();
  } else {
    buf = await req.arrayBuffer();
    if (buf.byteLength < 1000) return json({ error: "Yedek dosyası gelmedi" }, 400);
  }

  let b: { alindi?: string; tablolar?: Record<string, unknown[]>; satir_sayilari?: Record<string, number> };
  try {
    const text = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    b = JSON.parse(text);
  } catch (e) {
    return json({ ok: false, error: "Dosya açılamadı (bozuk gzip/JSON): " + String((e as Error)?.message || e) }, 200);
  }
  if (!b || typeof b.tablolar !== "object") return json({ ok: false, error: "Dosyada tablo verisi yok" }, 200);

  const tablolar: Record<string, unknown> = {};
  const sorunlar: string[] = [];
  let rowsB = 0, rowsR = 0;
  const reset = await db.rpc("restore_test_reset");
  if (reset.error) return json({ ok: false, error: "Deneme alanı hazırlanamadı: " + reset.error.message }, 500);
  try {
    for (const [t, rowsAny] of Object.entries(b.tablolar)) {
      const rows = Array.isArray(rowsAny) ? rowsAny : [];
      const expected = b.satir_sayilari?.[t] ?? rows.length;
      let n = 0; let hata: string | null = null;
      for (let i = 0; i < rows.length; i += 400) {
        const { data, error } = await db.rpc("restore_test_load", { p_table: t, p_rows: rows.slice(i, i + 400) });
        if (error) { hata = error.message; break; }
        n += (data as number) || 0;
      }
      const { data: cmp, error: ce } = await db.rpc("restore_test_compare", { p_table: t });
      if (ce && !hata) hata = ce.message;
      rowsB += expected; rowsR += n;
      const c = (cmp || {}) as Record<string, number>;
      tablolar[t] = { yedekte: expected, yuklenen: n, canli: c.live, sadece_yedekte: c.only_backup, sadece_canlida: c.only_live, ...(hata ? { hata } : {}) };
      if (hata || n !== expected || rows.length !== expected) sorunlar.push(t);
    }
  } finally {
    await db.rpc("restore_test_drop");
  }
  const { data: live } = await db.rpc("backup_tables");
  const yedekten_sonra_eklenen = ((live || []) as { name: string }[]).map((x) => x.name).filter((n) => !(n in (b.tablolar || {})));
  const ok = sorunlar.length === 0;
  const details = { tablolar, sorunlu_tablolar: sorunlar, yedekten_sonra_eklenen };
  await db.from("backup_checks").insert({
    source, file_name: fileName, file_taken_at: b.alindi || null, ok,
    tables: Object.keys(b.tablolar).length, rows_backup: rowsB, rows_restored: rowsR, details,
  });
  return json({ ok, kaynak: source, dosya: fileName, yedek_zamani: b.alindi, tablo: Object.keys(b.tablolar).length, satir_yedekte: rowsB, satir_yuklenen: rowsR, sorunlu_tablolar: sorunlar, yedekten_sonra_eklenen });
});
