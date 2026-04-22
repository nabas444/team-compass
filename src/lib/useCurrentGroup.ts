import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export interface CurrentGroup {
  id: string;
  name: string;
  description: string | null;
}

/**
 * Returns the current user's first group. If they have none, auto-creates
 * "My Workspace" and a leader membership so the app is immediately usable.
 */
export function useCurrentGroup() {
  const { user } = useAuth();
  const [group, setGroup] = useState<CurrentGroup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);

      // Find groups the user is a member of
      const { data: memberships, error: mErr } = await supabase
        .from("memberships")
        .select("group_id, groups(id, name, description)")
        .eq("user_id", user.id)
        .limit(1);

      if (mErr) {
        if (!cancelled) {
          setError(mErr.message);
          setLoading(false);
        }
        return;
      }

      const existing = memberships?.[0]?.groups as CurrentGroup | undefined;
      if (existing) {
        if (!cancelled) {
          setGroup(existing);
          setLoading(false);
        }
        return;
      }

      // Auto-create a workspace
      const { data: newGroup, error: gErr } = await supabase
        .from("groups")
        .insert({ name: "My Workspace", created_by: user.id })
        .select("id, name, description")
        .single();

      if (gErr || !newGroup) {
        if (!cancelled) {
          setError(gErr?.message ?? "Failed to create workspace");
          setLoading(false);
        }
        return;
      }

      await supabase.from("memberships").insert({
        group_id: newGroup.id,
        user_id: user.id,
        role: "leader",
      });

      if (!cancelled) {
        setGroup(newGroup);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  return { group, loading, error };
}
