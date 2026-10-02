// Supabase Edge Function: world-gold-price
//
// Proxies a real gold spot price (XAU/USD) and a USD->GHS forex rate to
// the app, so the "World Gold Market" card can show a real feed instead
// of the local random-walk simulation.
//
// HISTORY: originally used metalapi.com for the gold leg. Its free plan
// accepted the API key and counted requests against the quota, but
// actually returned a fixed/stale sample price (matched its own docs'
// example value to 6 decimal places, and was less than half the real
// market price when checked against independent sources) -- their
// pricing page says the free tier only gets "daily updates", not live
// data. Switched to gold-api.com, which needs no key/signup, has no
// rate limit, and was verified against two independent sources to
// return the correct current price.
//
// A sanity floor rejects anything below $1000/oz (gold hasn't traded
// that low in over a decade) so a similarly-wrong response from any
// future provider swap fails loudly instead of silently showing a bad
// number as "live".
//
// Call from the app:
//   const { data, error } = await sb.functions.invoke('world-gold-price');
//   // data: { usdOz: number, usdGhs: number, asOf: string, source: string }

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const goldRes = await fetch("https://api.gold-api.com/price/XAU");
    const goldJson = await goldRes.json().catch(() => null);
    const usdOz = goldJson?.price;
    if (!goldRes.ok || !usdOz || usdOz < 1000) {
      return new Response(JSON.stringify({ error: "Gold price fetch failed or implausible", status: goldRes.status, detail: goldJson }), {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const fxRes = await fetch("https://open.er-api.com/v6/latest/USD");
    const fxJson = await fxRes.json().catch(() => null);
    const usdGhs = fxJson?.rates?.GHS;
    if (!fxRes.ok || !usdGhs) {
      return new Response(JSON.stringify({ error: "Forex fetch failed", status: fxRes.status, detail: fxJson }), {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        usdOz: Number(usdOz),
        usdGhs: Number(usdGhs),
        asOf: new Date().toISOString(),
        source: "gold-api.com (XAU/USD) + open.er-api.com (USD/GHS)",
      }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err as Error).message || err) }), {
      status: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }
});
