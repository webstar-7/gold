// Supabase Edge Function: create-staff
//
// Why this has to be a server-side function and not a plain browser
// call: creating a Supabase Auth user (auth.admin.createUser) requires
// the SERVICE ROLE key, which must never reach the browser — anyone
// could open devtools and mint themselves an account in any tenant.
// This function holds that key server-side only, and only lets an
// already-authenticated 'owner' create a 'staff' login inside their
// OWN organization.
//
// Deploy with the Supabase CLI from inside this project:
//   supabase functions deploy create-staff --project-ref <your-gold-project-ref>
//   supabase secrets set SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=...
// (service role key: Project Settings -> API -> service_role, in the
// GOLD Supabase project specifically)
//
// Call from the app:
//   const { data, error } = await sb.functions.invoke('create-staff', {
//     body: { fullName, phone, username, password }
//   });
// The caller's session JWT is sent automatically by supabase-js, which
// is how this function knows WHO is asking and WHICH org they own.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const callerToken = authHeader.replace("Bearer ", "");
    if (!callerToken) {
      return new Response(JSON.stringify({ error: "Not signed in" }), { status: 401, headers: cors });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Client scoped to the CALLER's own token -- used only to find out
    // who is calling and confirm they're an owner. It cannot bypass RLS.
    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: callerUser, error: callerErr } = await callerClient.auth.getUser(callerToken);
    if (callerErr || !callerUser?.user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), { status: 401, headers: cors });
    }

    // Admin client -- the only place the service role key is actually used
    // to bypass RLS, and only for the two specific operations below.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: callerProfile, error: profileErr } = await admin
      .from("profiles")
      .select("org_id, role")
      .eq("id", callerUser.user.id)
      .maybeSingle();

    if (profileErr || !callerProfile || callerProfile.role !== "owner") {
      return new Response(JSON.stringify({ error: "Only the dealership owner can add staff" }), { status: 403, headers: cors });
    }

    const body = await req.json();
    const fullName = String(body.fullName || "").trim();
    const phone = String(body.phone || "").trim();
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "").trim();

    if (!fullName || !username || !password) {
      return new Response(JSON.stringify({ error: "Name, username, and password are required" }), { status: 400, headers: cors });
    }
    if (password.length < 8) {
      return new Response(JSON.stringify({ error: "Password must be at least 8 characters" }), { status: 400, headers: cors });
    }

    // Staff don't have a real email -- give them a synthetic one scoped to
    // this org so it can never collide with another tenant's staff member,
    // and so the business owner never has to collect a staff member's
    // personal email just to let them log in.
    const syntheticEmail = `${username}+${callerProfile.org_id}@staff.nyansatek.gold`;

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: syntheticEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (createErr) {
      return new Response(JSON.stringify({ error: `Could not create login: ${createErr.message}` }), { status: 400, headers: cors });
    }
    const newUserId = created.user.id;

    // No auth.users trigger exists in this Supabase project (this
    // environment's connector blocks creating triggers directly on
    // auth.users), so we insert the profile row ourselves instead of
    // relying on a trigger-created row to update.
    const { error: insErr } = await admin
      .from("profiles")
      .insert({
        id: newUserId,
        org_id: callerProfile.org_id,
        display_name: fullName,
        full_name: fullName,
        role: "staff",
        login_username: username,
        phone,
        is_active: true,
        must_change_password: false,
      });

    if (insErr) {
      await admin.auth.admin.deleteUser(newUserId).catch(() => {});
      return new Response(JSON.stringify({ error: `Could not set up the staff profile: ${insErr.message}` }), { status: 400, headers: cors });
    }

    return new Response(JSON.stringify({ ok: true, userId: newUserId, username }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err as Error).message || err) }), { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
  }
});
