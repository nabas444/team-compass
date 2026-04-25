import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export type GroupRole = "leader" | "co_leader" | "member";

export interface GroupSummary {
  id: string;
  name: string;
  description: string | null;
  role: GroupRole;
}

interface GroupsContextValue {
  groups: GroupSummary[];
  currentGroupId: string | null;
  currentGroup: GroupSummary | null;
  /** True when the current user is the sole leader of the current group. */
  isLeader: boolean;
  /** True when the current user has elevated permissions (leader OR co-leader). */
  canManage: boolean;
  loading: boolean;
  error: string | null;
  switchGroup: (id: string) => void;
  refresh: () => Promise<void>;
  createGroup: (name: string, description?: string) => Promise<GroupSummary | null>;
}

const GroupsContext = createContext<GroupsContextValue | undefined>(undefined);

const STORAGE_KEY = "groupflow.currentGroupId";

export function GroupsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [currentGroupId, setCurrentGroupId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadGroups = useCallback(async (): Promise<GroupSummary[]> => {
    if (!user) return [];
    setError(null);
    const { data, error: err } = await supabase
      .from("memberships")
      .select("role, groups(id, name, description)")
      .eq("user_id", user.id);

    if (err) {
      setError(err.message);
      return [];
    }
    const list: GroupSummary[] = (data ?? [])
      .map((row: any) =>
        row.groups
          ? {
              id: row.groups.id,
              name: row.groups.name,
              description: row.groups.description,
              role: row.role as "leader" | "member",
            }
          : null,
      )
      .filter(Boolean) as GroupSummary[];
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [user]);

  const bootstrap = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    let list = await loadGroups();

    // Auto-create a workspace if the user has none
    if (list.length === 0) {
      const { data: newGroup, error: gErr } = await supabase
        .from("groups")
        .insert({ name: "My Workspace", created_by: user.id })
        .select("id, name, description")
        .single();
      if (!gErr && newGroup) {
        await supabase.from("memberships").insert({
          group_id: newGroup.id,
          user_id: user.id,
          role: "leader",
        });
        list = await loadGroups();
      } else if (gErr) {
        setError(gErr.message);
      }
    }

    setGroups(list);

    // Restore selection
    const stored = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    const validStored = stored && list.some((g) => g.id === stored) ? stored : null;
    setCurrentGroupId(validStored ?? list[0]?.id ?? null);
    setLoading(false);
  }, [user, loadGroups]);

  useEffect(() => {
    if (!user) {
      setGroups([]);
      setCurrentGroupId(null);
      setLoading(false);
      return;
    }
    bootstrap();
  }, [user, bootstrap]);

  const switchGroup = useCallback((id: string) => {
    setCurrentGroupId(id);
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, id);
  }, []);

  const refresh = useCallback(async () => {
    const list = await loadGroups();
    setGroups(list);
    if (currentGroupId && !list.some((g) => g.id === currentGroupId)) {
      const next = list[0]?.id ?? null;
      setCurrentGroupId(next);
      if (typeof window !== "undefined" && next) localStorage.setItem(STORAGE_KEY, next);
    }
  }, [loadGroups, currentGroupId]);

  const createGroup = useCallback(
    async (name: string, description?: string): Promise<GroupSummary | null> => {
      if (!user) return null;
      const { data: newGroup, error: gErr } = await supabase
        .from("groups")
        .insert({ name, description: description ?? null, created_by: user.id })
        .select("id, name, description")
        .single();
      if (gErr || !newGroup) {
        setError(gErr?.message ?? "Failed to create group");
        return null;
      }
      await supabase.from("memberships").insert({
        group_id: newGroup.id,
        user_id: user.id,
        role: "leader",
      });
      const created: GroupSummary = {
        id: newGroup.id,
        name: newGroup.name,
        description: newGroup.description,
        role: "leader",
      };
      setGroups((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      switchGroup(created.id);
      return created;
    },
    [user, switchGroup],
  );

  const currentGroup = useMemo(
    () => groups.find((g) => g.id === currentGroupId) ?? null,
    [groups, currentGroupId],
  );

  const value: GroupsContextValue = {
    groups,
    currentGroupId,
    currentGroup,
    isLeader: currentGroup?.role === "leader",
    loading,
    error,
    switchGroup,
    refresh,
    createGroup,
  };

  return <GroupsContext.Provider value={value}>{children}</GroupsContext.Provider>;
}

export function useGroups() {
  const ctx = useContext(GroupsContext);
  if (!ctx) throw new Error("useGroups must be used within GroupsProvider");
  return ctx;
}
