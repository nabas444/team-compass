// Extracts a possible task suggestion from a chat message using Lovable AI.
// Input: { message_id, group_id }
// Behavior:
//   - Loads the message + group members (for assignee resolution)
//   - Asks the model whether the message represents an actionable task
//   - If yes, inserts a row in public.task_suggestions
//   - Returns { suggestion } or { suggestion: null, reason }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface AiResult {
  is_task: boolean;
  title?: string;
  assignee_name?: string | null;
  deadline_iso?: string | null;
  reason?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY =
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      return json({ error: "LOVABLE_API_KEY not configured" }, 500);
    }
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    const body = await req.json().catch(() => ({}));
    const messageId: string | undefined = body.message_id;
    const groupId: string | undefined = body.group_id;
    if (!messageId || !groupId) return json({ error: "message_id and group_id required" }, 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: msg, error: mErr } = await supabase
      .from("messages")
      .select("id, body, group_id, task_id, author_id")
      .eq("id", messageId)
      .maybeSingle();
    if (mErr || !msg) return json({ error: "Message not found" }, 404);

    // Members for assignee mapping
    const { data: members } = await supabase
      .from("memberships")
      .select("user_id")
      .eq("group_id", groupId);
    const memberIds = (members ?? []).map((m: { user_id: string }) => m.user_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, name, email")
      .in("id", memberIds.length ? memberIds : ["00000000-0000-0000-0000-000000000000"]);

    const memberList = (profiles ?? []).map((p: any) => ({
      id: p.id,
      name: p.name?.trim() || p.email,
    }));

    const sys =
      'You analyze a chat message and decide if it describes a concrete actionable task. Respond ONLY in strict JSON: {"is_task": boolean, "title"?: string (<=80 chars, imperative), "assignee_name"?: string|null, "deadline_iso"?: string|null (ISO 8601 or null), "reason"?: string}. Only set is_task=true when there is a clear ask, deliverable, or commitment. Mentions like @name suggest assignee.';

    const today = new Date().toISOString();
    const userPrompt = `Today: ${today}
Group members (for assignee matching): ${JSON.stringify(memberList)}
Message: "${msg.body}"`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiRes.ok) {
      if (aiRes.status === 429) return json({ error: "Rate limit exceeded" }, 429);
      if (aiRes.status === 402) return json({ error: "AI credits exhausted" }, 402);
      return json({ error: "AI gateway error" }, 500);
    }

    const aiJson = await aiRes.json();
    const content: string = aiJson.choices?.[0]?.message?.content ?? "{}";
    let parsed: AiResult;
    try {
      parsed = JSON.parse(content);
    } catch {
      return json({ suggestion: null, reason: "Unparseable AI response" });
    }

    if (!parsed.is_task || !parsed.title) {
      return json({ suggestion: null, reason: parsed.reason ?? "Not a task" });
    }

    // Resolve assignee by name (case-insensitive contains)
    let assigneeId: string | null = null;
    if (parsed.assignee_name) {
      const want = parsed.assignee_name.trim().toLowerCase();
      const m = memberList.find(
        (m) => m.name?.toLowerCase() === want || m.name?.toLowerCase().includes(want),
      );
      assigneeId = m?.id ?? null;
    }

    // Validate deadline
    let deadlineIso: string | null = null;
    if (parsed.deadline_iso) {
      const d = new Date(parsed.deadline_iso);
      if (!Number.isNaN(d.getTime())) deadlineIso = d.toISOString();
    }

    const { data: inserted, error: iErr } = await supabase
      .from("task_suggestions")
      .insert({
        group_id: groupId,
        message_id: messageId,
        suggested_title: parsed.title.slice(0, 80),
        suggested_assignee: assigneeId,
        suggested_deadline: deadlineIso,
      })
      .select("id, suggested_title, suggested_assignee, suggested_deadline, status")
      .maybeSingle();

    if (iErr) return json({ error: iErr.message }, 400);
    return json({ suggestion: inserted });
  } catch (e) {
    console.error("extract-task error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown" }, 500);
  }

  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
