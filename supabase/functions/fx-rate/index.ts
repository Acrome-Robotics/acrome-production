// fx-rate: sipariş formunda USD dışı tutarı USD'ye çevirmek için TCMB döviz satış kuru (ForexSelling).
// Giriş yapmış kullanıcı çağırır (verify_jwt = true). TCMB XML'i tarayıcıdan çekilemez (CORS), bu yüzden burada.
// Gövde: { date: "YYYY-MM-DD", currency: "EUR" } → { currency, date, rate_date, try_rate, usd_try, usd_rate }
//   usd_rate = 1 birim → USD (çapraz kur: CUR/TRY ÷ USD/TRY; TRY için 1 ÷ USD/TRY).
// Kur günü: TCMB'nin 15:30'da ilan ettiği kur ertesi iş günü geçerlidir; D tarihli sipariş için D'den önceki son bülten
// kullanılır (D-1; hafta sonu/tatilde daha geri). Bülten yok sayılan tek durum 404; diğer TCMB hatalarında 502, önbelleğe yazılmaz.
// Önbellek: fx_rates (day = sipariş tarihi, currency), rate_day = bülten günü. Yazılamazsa (tablo yoksa) kur yine döner.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const CURS = ["USD", "EUR", "GBP"]; // önbelleğe yazılanlar; TRY = 1
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const istToday = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10); // Türkiye UTC+3, yaz saati yok

// null: o gün bülten yok (404). Zaman aşımı, 5xx, ağ hatası, bozuk ya da USD'siz içerik: hata fırlatır.
async function bulletin(day: string, ms: number): Promise<Record<string, number> | null> {
  const [y, m, d] = day.split("-");
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(`https://www.tcmb.gov.tr/kurlar/${y}${m}/${d}${m}${y}.xml`, { signal: ac.signal });
    if (r.status === 404) { await r.body?.cancel(); return null; }
    if (!r.ok) throw new Error(`TCMB yanıtı ${r.status}`);
    const x = await r.text();
    if (!new RegExp(`<Tarih_Date[^>]*Tarih="${d}\\.${m}\\.${y}"`).test(x)) throw new Error("TCMB bülteni beklenen tarihte değil");
    const out: Record<string, number> = {};
    for (const c of CURS) {
      const blk = new RegExp(`<Currency[^>]*CurrencyCode="${c}"[^>]*>([\\s\\S]*?)</Currency>`).exec(x)?.[1] || "";
      const v = Number(/<ForexSelling>([\d.]+)<\/ForexSelling>/.exec(blk)?.[1]), u = Number(/<Unit>(\d+)<\/Unit>/.exec(blk)?.[1] || 1);
      if (v > 0) out[c] = v / u;
    }
    if (!out.USD) throw new Error("bültende USD döviz satış kuru yok");
    return out;
  } catch (e) {
    throw (e as Error)?.name === "AbortError" ? new Error("TCMB zaman aşımı") : e;
  } finally { clearTimeout(t); }
}

// D'den önceki son bülten; yalnız 404'te bir gün geri gidilir. İstemci ~15 sn bekliyor, toplam süre buna sığar.
async function rateFor(day: string, budget = 14_000): Promise<{ rates: Record<string, number>; rate_day: string }> {
  const end = Date.now() + budget;
  for (let k = 1; k <= 10; k++) {
    const left = end - Date.now(); if (left < 500) throw new Error("TCMB zaman aşımı");
    const rd = ymd(new Date(Date.parse(day) - k * 864e5)), rates = await bulletin(rd, Math.min(8_000, left));
    if (rates) return { rates, rate_day: rd };
  }
  throw new Error("son 10 günde bülten yok");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u, error: ue } = await db.auth.getUser(jwt);
    if (ue || !u?.user) return json({ error: "Giriş gerekli" }, 401);
    const b = await req.json().catch(() => ({}));
    const cur = String(b.currency || "").toUpperCase(), today = istToday();
    let day = String(b.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < "2020-01-01") return json({ error: "Geçersiz tarih" }, 400);
    if (![...CURS, "TRY"].includes(cur)) return json({ error: "Desteklenmeyen para birimi" }, 400);
    if (day > today) day = today; // gelecek tarih bugünün kuruyla (dünkü bülten); yarının kuru 15:30'dan önce belli değil
    const res = (rates: Record<string, number>, rate_day: string) => {
      const tr = cur === "TRY" ? 1 : rates[cur];
      return json({ currency: cur, date: day, rate_date: rate_day, try_rate: tr, usd_try: rates.USD, usd_rate: Math.round(tr / rates.USD * 1e8) / 1e8, source: "TCMB ForexSelling" });
    };

    const { data: hit } = await db.from("fx_rates").select("currency,try_rate,rate_day").eq("day", day);
    if (hit && hit.some((h) => h.currency === "USD") && (cur === "TRY" || hit.some((h) => h.currency === cur)))
      return res(Object.fromEntries(hit.map((h) => [h.currency, Number(h.try_rate)])), hit[0].rate_day);

    let r;
    try { r = await rateFor(day); } catch (e) { return json({ error: "TCMB kuru alınamadı: " + String((e as Error)?.message || e) }, 502); }
    if (cur !== "TRY" && !r.rates[cur]) return json({ error: `TCMB bülteninde ${cur} yok` }, 502);

    // D'den önceki bülten her zaman yayımlanmış olduğundan sonuç kesin; önbelleğe yazılabilir
    const rows = Object.entries(r.rates).map(([c, v]) => ({ day, currency: c, try_rate: v, rate_day: r.rate_day }));
    await db.from("fx_rates").upsert(rows, { onConflict: "day,currency" }).then(() => {}, () => {});
    return res(r.rates, r.rate_day);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
