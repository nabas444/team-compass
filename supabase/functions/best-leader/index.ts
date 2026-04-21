// Phase 7: Best Leader AI rationale
// Computes leader suggestions, joins names, asks Lovable AI to explain why
// the top-ranked member is the suggested leader.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface LeaderRow {
  user_id: string;
  consistency_score: number;
  contribution_score: number;
  coordination_score: number;
  total_score: number;
  rank: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
      Deno.env.get("SUPABASE_ANON_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const groupId: string | undefined = body.group_id;
    const lookbackDays: number = Number.isFinite(body.lookback_days) ? body.lookback_days : 30;

    if (!groupId || typeof groupId !== "string") {
      return new Response(JSON.stringify({ error: "group_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    // Group + leader scores (parallel where possible)
    const [{ data: group, error: gErr }, { data: leaders, error: lErr }] = await Promise.all([
      supabase.from("groups").select("id, name").eq("id", groupId).maybeSingle(),
      supabase.rpc("compute_leader_suggestions", {
        _group_id: groupId,
        _lookback_days: lookbackDays,
      }),
    ]);

    if (gErr || !group) {
      return new Response(JSON.stringify({ error: "Group not found or access denied" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (lErr) {
      console.error("compute_leader_suggestions error:", lErr);
      return new Response(JSON.stringify({ error: lErr.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rows = (leaders ?? []) as LeaderRow[];
    if (rows.length === 0) {
      return new Response(JSON.stringify({
        group: { id: group.id, name: group.name },
        leaders: [],
        rationale: "No members with activity in this window.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Resolve names
    const userIds = rows.map((r) => r.user_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, name, email")
      .in("id", userIds);

    const nameById = new Map<string, string>();
    for (const p of profiles ?? []) {
      nameById.set(p.id, p.name?.trim() || p.email || "Unknown");
    }

    const enriched = rows.map((r) => ({
      name: nameById.get(r.user_id) ?? "Unknown",
      ...r,
    }));
    const top = enriched[0];

    const systemPrompt =
      "You are a team analytics coach. Given member scores (consistency, contribution, coordination — each 0-100), explain in 2-3 short sentences why the top-ranked member is the suggested leader. Compare them to the runner-up if present. Be specific, reference scores, no fluff, no emojis.";

    const userPrompt = `Group: ${group.name}
Lookback: ${lookbackDays} days
Ranked members:
${JSON.stringify(enriched.slice(0, 5), null, 2)}

Suggested leader: ${top.name} (total ${top.total_score}/100).
Write the rationale.`;

    const aiRes = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      },
    );

    if (!aiRes.ok) {
      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiRes.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add funds in Lovable workspace settings." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await aiRes.text();
      console.error("AI gateway error:", aiRes.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiRes.json();
    const rationale: string = aiJson.choices?.[0]?.message?.content ?? "";

    return new Response(
      JSON.stringify({
        group: { id: group.id, name: group.name },
        lookback_days: lookbackDays,
        suggested_leader: { user_id: top.user_id, name: top.name, total_score: top.total_score },
        leaders: enriched,
        rationale,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("best-leader error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
