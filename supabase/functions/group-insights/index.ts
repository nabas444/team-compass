// AI-powered group insights: synthesizes behavior data + at-risk tasks into
// short, actionable alerts using the Lovable AI gateway.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface BehaviorRow {
  user_id: string;
  total_actions: number;
  tasks_completed: number;
  tasks_late: number;
  late_ratio: number;
  days_since_last_action: number | null;
  flags: string[];
}

interface TaskRow {
  id: string;
  title: string;
  status: string;
  deadline: string | null;
  assigned_to: string | null;
  updated_at: string;
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
      return new Response(JSON.stringify({ error: "Missing auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { group_id, lookback_days = 30 } = await req.json();
    if (!group_id) {
      return new Response(JSON.stringify({ error: "group_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    // Get behavior insights
    const { data: behavior, error: bErr } = await supabase.rpc(
      "behavior_insights",
      { _group_id: group_id, _lookback_days: lookback_days },
    );
    if (bErr) throw bErr;

    // Get at-risk tasks (open with deadline soon or overdue)
    const { data: tasks, error: tErr } = await supabase
      .from("tasks")
      .select("id, title, status, deadline, assigned_to, updated_at")
      .eq("group_id", group_id)
      .neq("status", "completed");
    if (tErr) throw tErr;

    // Get profiles for naming
    const userIds = new Set<string>();
    (behavior ?? []).forEach((b: BehaviorRow) => userIds.add(b.user_id));
    (tasks ?? []).forEach((t: TaskRow) => t.assigned_to && userIds.add(t.assigned_to));
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, name, email")
      .in("id", Array.from(userIds));
    const nameOf = new Map<string, string>();
    (profiles ?? []).forEach((p: any) => nameOf.set(p.id, p.name || p.email || "Member"));

    const now = Date.now();
    const atRisk = (tasks ?? [])
      .map((t: TaskRow) => {
        const dl = t.deadline ? new Date(t.deadline).getTime() : null;
        const overdue = dl !== null && dl < now;
        const dueSoon = dl !== null && dl >= now && dl - now < 1000 * 60 * 60 * 48;
        return { ...t, overdue, dueSoon };
      })
      .filter((t: any) => t.overdue || t.dueSoon);

    // Compose compact prompt for AI
    const behaviorSummary = (behavior ?? []).map((b: BehaviorRow) => ({
      name: nameOf.get(b.user_id) ?? "Member",
      actions: b.total_actions,
      completed: b.tasks_completed,
      late: b.tasks_late,
      days_idle: b.days_since_last_action,
      flags: b.flags,
    }));

    const tasksSummary = atRisk.slice(0, 25).map((t: any) => ({
      title: t.title,
      status: t.status,
      assignee: t.assigned_to ? nameOf.get(t.assigned_to) : null,
      deadline: t.deadline,
      overdue: t.overdue,
      due_soon: t.dueSoon,
    }));

    const prompt = `You are a team operations coach. Based on the data below, generate 3-6 short, specific, actionable alerts for the team leader. Each alert must be one sentence (<=160 chars), reference a real person/task when possible, and have severity "high", "medium", or "low".

LOOKBACK: ${lookback_days} days
BEHAVIOR:
${JSON.stringify(behaviorSummary, null, 2)}

AT-RISK TASKS:
${JSON.stringify(tasksSummary, null, 2)}`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You generate concise team alerts." },
          { role: "user", content: prompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "emit_alerts",
              description: "Emit team alerts",
              parameters: {
                type: "object",
                properties: {
                  alerts: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        severity: { type: "string", enum: ["high", "medium", "low"] },
                        category: {
                          type: "string",
                          enum: ["inactive_member", "at_risk_task", "overdue_task", "low_engagement", "general"],
                        },
                        title: { type: "string" },
                        message: { type: "string" },
                      },
                      required: ["severity", "category", "title", "message"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["alerts"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "emit_alerts" } },
      }),
    });

    if (!aiRes.ok) {
      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit reached. Try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiRes.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const text = await aiRes.text();
      console.error("AI gateway error", aiRes.status, text);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiRes.json();
    const toolCall = aiData?.choices?.[0]?.message?.tool_calls?.[0];
    let alerts: any[] = [];
    try {
      alerts = JSON.parse(toolCall?.function?.arguments ?? "{}").alerts ?? [];
    } catch (e) {
      console.error("Failed to parse alerts", e);
    }

    return new Response(
      JSON.stringify({
        alerts,
        behavior: behaviorSummary,
        at_risk_tasks: tasksSummary,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("group-insights error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
