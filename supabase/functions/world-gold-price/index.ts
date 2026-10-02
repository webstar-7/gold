// Supabase Edge Function: world-gold-price
//
// Proxies a real gold spot price (XAU/USD) and a USD->GHS forex rate to
// the app, so the "World Gold Market" card can show a real feed instead
// of the local random-walk simulation. This has to be a server-side
// function (not a direct browser call) so the MetalAPI key never reaches
// client code or the public GitHub repo.
//
// Deploy:
//   supabase functions deploy world-gold-price --project-ref kgpdapzwxgwnhzfsamro
//   supabase secrets set METALAPI_KEY=mk_live_xxxxxxxx --project-ref kgpdapzwxgwnhzfsamro
//
// MetalAPI (https://www.metalapi.com) supplies XAU/USD. It does not list
// GHS among its supported currencies, so USD->GHS comes from a separate,
// free, no-key forex API (open.er-api.com) instead.
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
    const METALAPI_KEY = Deno.env.get("METALAPI_KEY");
    if (!METALAPI_KEY) {
      return new Response(JSON.stringify({ error: "METALAPI_KEY secret not set on this project" }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // ---- Leg 1: gold spot price in USD/oz ----
    const goldRes = await fetch(
      `https://metalapi.com/api/v1/latest?api_key=${METALAPI_KEY}&base=USD&currencies=XAU`
    );
    const goldJson = await goldRes.json();
    if (!goldRes.ok || !goldJson?.rates) {
      return new Response(JSON.stringify({ error: "Gold price fetch failed", detail: goldJson }), {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    // MetalAPI returns rates.XAU as "XAU per 1 USD" (a tiny decimal) and,
    // in its documented examples, rates.USDXAU as USD per XAU (per troy
    // ounce) directly. Prefer USDXAU; fall back to inverting XAU if the
    // plan/response shape differs.
    const usdOz = goldJson.rates.USDXAU ?? (goldJson.rates.XAU ? 1 / goldJson.rates.XAU : null);
    if (!usdOz) {
      return new Response(JSON.stringify({ error: "Unexpected gold price response shape", detail: goldJson }), {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // ---- Leg 2: USD -> GHS forex (MetalAPI doesn't list GHS, so a
    //             separate free/no-key forex API covers this leg) ----
    const fxRes = await fetch("https://open.er-api.com/v6/latest/USD");
    const fxJson = await fxRes.json();
    const usdGhs = fxJson?.rates?.GHS;
    if (!fxRes.ok || !usdGhs) {
      return new Response(JSON.stringify({ error: "Forex fetch failed", detail: fxJson }), {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        usdOz: Number(usdOz),
        usdGhs: Number(usdGhs),
        asOf: new Date().toISOString(),
        source: "metalapi.com (XAU/USD) + open.er-api.com (USD/GHS)",
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
