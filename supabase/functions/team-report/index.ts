// Phase 5: AI Team Report
// Reads behavior_insights for a group, joins member names, asks Lovable AI
// for a short natural-language team report. Auth required — caller must be a
// group member (enforced by RLS + behavior_insights's own check).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface InsightRow {
  user_id: string;
  total_actions: number;
  tasks_completed: number;
  tasks_late: number;
  late_ratio: number;
  days_since_last_action: number | null;
  flags: string[];
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
    const lookbackDays: number = Number.isFinite(body.lookback_days)
      ? body.lookback_days
      : 30;

    if (!groupId || typeof groupId !== "string") {
      return new Response(JSON.stringify({ error: "group_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // User-scoped client: RLS + behavior_insights's membership check apply
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    // 1. Fetch group name
    const { data: group, error: groupErr } = await supabase
      .from("groups")
      .select("id, name")
      .eq("id", groupId)
      .maybeSingle();

    if (groupErr || !group) {
      return new Response(
        JSON.stringify({ error: "Group not found or access denied" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2. Compute behavior insights
    const { data: insights, error: insightsErr } = await supabase.rpc(
      "behavior_insights",
      { _group_id: groupId, _lookback_days: lookbackDays },
    );

    if (insightsErr) {
      console.error("behavior_insights error:", insightsErr);
      return new Response(JSON.stringify({ error: insightsErr.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rows = (insights ?? []) as InsightRow[];

    // 3. Resolve names from profiles
    const userIds = rows.map((r) => r.user_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, name, email")
      .in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);

    const nameById = new Map<string, string>();
    for (const p of profiles ?? []) {
      nameById.set(p.id, p.name?.trim() || p.email || "Unknown");
    }

    const enriched = rows.map((r) => ({
      name: nameById.get(r.user_id) ?? "Unknown",
      ...r,
    }));

    // 4. Build prompt
    const systemPrompt =
      "You are a concise team analytics coach. Given per-member behavior data, write a short report (max ~180 words) for a team leader. Structure: 1-sentence overview, 2-4 bullet points highlighting members needing attention (consistently_late, inactive, never_completes), 1-2 bullets recognizing healthy contributors, and 1 actionable suggestion. Be direct and constructive — no fluff, no emojis.";

    const userPrompt = `Group: ${group.name}
Lookback window: ${lookbackDays} days
Members (${enriched.length}):
${JSON.stringify(enriched, null, 2)}

Write the report now.`;

    // 5. Call Lovable AI
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
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded, try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (aiRes.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Add funds in Lovable workspace settings." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const t = await aiRes.text();
      console.error("AI gateway error:", aiRes.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiRes.json();
    const report: string = aiJson.choices?.[0]?.message?.content ?? "";

    return new Response(
      JSON.stringify({
        group: { id: group.id, name: group.name },
        lookback_days: lookbackDays,
        insights: enriched,
        report,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("team-report error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
