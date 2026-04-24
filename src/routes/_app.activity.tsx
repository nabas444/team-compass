import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Activity as ActivityIcon,
  CheckCircle2,
  CircleDashed,
  ListChecks,
  ListPlus,
  MessageCircle,
  MessageSquare,
  PlayCircle,
  Sparkles,
  Trash2,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentGroup } from "@/lib/useCurrentGroup";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/activity")({
  component: ActivityPage,
});

type ActivityAction =
  | "task_created"
  | "task_status_changed"
  | "task_assigned"
  | "task_deleted"
  | "comment_added"
  | "subtask_created"
  | "subtask_completed"
  | "message_sent"
  | "task_suggested"
  | "meeting_notes_created";

interface ActivityRow {
  id: string;
  group_id: string;
  task_id: string | null;
  actor_id: string | null;
  action: ActivityAction;
  details: Record<string, any>;
  created_at: string;
}

interface ProfileLite {
  id: string;
  name: string;
  email: string;
}

interface TaskLite {
  id: string;
  title: string;
}

type FilterKey = "all" | "tasks" | "comments" | "messages";

const ACTION_META: Record<
  ActivityAction,
  { icon: LucideIcon; label: string; tone: string; group: Exclude<FilterKey, "all"> }
> = {
  task_created: {
    icon: ListPlus,
    label: "created task",
    tone: "bg-primary/15 text-primary",
    group: "tasks",
  },
  task_status_changed: {
    icon: PlayCircle,
    label: "updated task status",
    tone: "bg-warning/20 text-warning-foreground",
    group: "tasks",
  },
  task_assigned: {
    icon: UserPlus,
    label: "reassigned task",
    tone: "bg-accent/30 text-accent-foreground",
    group: "tasks",
  },
  task_deleted: {
    icon: Trash2,
    label: "deleted task",
    tone: "bg-destructive/15 text-destructive",
    group: "tasks",
  },
  comment_added: {
    icon: MessageCircle,
    label: "commented on a task",
    tone: "bg-secondary text-secondary-foreground",
    group: "comments",
  },
  subtask_created: {
    icon: ListChecks,
    label: "added a subtask",
    tone: "bg-muted text-foreground",
    group: "tasks",
  },
  subtask_completed: {
    icon: CheckCircle2,
    label: "completed a subtask",
    tone: "bg-success/20 text-success-foreground",
    group: "tasks",
  },
  message_sent: {
    icon: MessageSquare,
    label: "sent a message",
    tone: "bg-primary/10 text-primary",
    group: "messages",
  },
  task_suggested: {
    icon: Sparkles,
    label: "suggested a task",
    tone: "bg-accent/30 text-accent-foreground",
    group: "tasks",
  },
  meeting_notes_created: {
    icon: CircleDashed,
    label: "added meeting notes",
    tone: "bg-secondary text-secondary-foreground",
    group: "tasks",
  },
};

function statusLabel(value: unknown) {
  if (typeof value !== "string") return "—";
  return value.replace(/_/g, " ");
}

function describe(
  row: ActivityRow,
  taskMap: Map<string, TaskLite>,
  profileMap: Map<string, ProfileLite>,
): string {
  const task = row.task_id ? taskMap.get(row.task_id) : null;
  const taskTitle = task?.title ?? (row.details?.title as string | undefined);
  switch (row.action) {
    case "task_created":
      return taskTitle ? `“${taskTitle}”` : "a new task";
    case "task_status_changed":
      return `${taskTitle ? `“${taskTitle}” ` : ""}${statusLabel(
        row.details?.from,
      )} → ${statusLabel(row.details?.to)}`;
    case "task_assigned": {
      const to = row.details?.to as string | undefined;
      const name = to ? profileMap.get(to)?.name || profileMap.get(to)?.email : null;
      return `${taskTitle ? `“${taskTitle}” ` : ""}→ ${name ?? "unassigned"}`;
    }
    case "task_deleted":
      return taskTitle ? `“${taskTitle}”` : "a task";
    case "comment_added":
      return taskTitle ? `on “${taskTitle}”` : "on a task";
    case "subtask_created":
    case "subtask_completed":
      return row.details?.title
        ? `“${row.details.title}”${taskTitle ? ` · ${taskTitle}` : ""}`
        : taskTitle ?? "";
    case "message_sent":
      return row.details?.has_task && taskTitle ? `linked to “${taskTitle}”` : "in chat";
    case "task_suggested":
      return row.details?.title ? `“${row.details.title}”` : "from a message";
    case "meeting_notes_created":
      return row.details?.title ? `“${row.details.title}”` : "";
    default:
      return "";
  }
}

function initials(name: string, email: string) {
  const base = (name || email || "?").trim();
  const parts = base.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

function groupByDay(rows: ActivityRow[]) {
  const groups: { label: string; items: ActivityRow[] }[] = [];
  const map = new Map<string, ActivityRow[]>();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  for (const row of rows) {
    const d = new Date(row.created_at);
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const key = String(day);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(row);
  }

  const sortedKeys = Array.from(map.keys()).sort((a, b) => Number(b) - Number(a));
  for (const key of sortedKeys) {
    const day = new Date(Number(key));
    let label: string;
    if (day.getTime() === today.getTime()) label = "Today";
    else if (day.getTime() === yesterday.getTime()) label = "Yesterday";
    else
      label = day.toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
      });
    groups.push({ label, items: map.get(key)! });
  }
  return groups;
}

function ActivityPage() {
  const { group, loading: groupLoading } = useCurrentGroup();
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [profiles, setProfiles] = useState<Map<string, ProfileLite>>(new Map());
  const [tasks, setTasks] = useState<Map<string, TaskLite>>(new Map());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");

  useEffect(() => {
    if (!group?.id) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      const { data, error } = await supabase
        .from("activity_logs")
        .select("id, group_id, task_id, actor_id, action, details, created_at")
        .eq("group_id", group.id)
        .order("created_at", { ascending: false })
        .limit(150);

      if (cancelled) return;
      if (error) {
        setRows([]);
        setLoading(false);
        return;
      }
      const list = (data ?? []) as ActivityRow[];
      setRows(list);

      // Hydrate profiles + tasks referenced by the feed
      const userIds = new Set<string>();
      const taskIds = new Set<string>();
      for (const r of list) {
        if (r.actor_id) userIds.add(r.actor_id);
        if (r.task_id) taskIds.add(r.task_id);
        const to = r.details?.to;
        if (typeof to === "string" && to.length > 20) userIds.add(to);
      }

      const [profRes, taskRes] = await Promise.all([
        userIds.size
          ? supabase
              .from("profiles")
              .select("id, name, email")
              .in("id", Array.from(userIds))
          : Promise.resolve({ data: [] as ProfileLite[], error: null }),
        taskIds.size
          ? supabase
              .from("tasks")
              .select("id, title")
              .in("id", Array.from(taskIds))
          : Promise.resolve({ data: [] as TaskLite[], error: null }),
      ]);

      if (cancelled) return;
      const pMap = new Map<string, ProfileLite>();
      (profRes.data ?? []).forEach((p: any) =>
        pMap.set(p.id, { id: p.id, name: p.name ?? "", email: p.email ?? "" }),
      );
      setProfiles(pMap);

      const tMap = new Map<string, TaskLite>();
      (taskRes.data ?? []).forEach((t: any) => tMap.set(t.id, { id: t.id, title: t.title }));
      setTasks(tMap);

      setLoading(false);
    })();

    // Realtime subscription for this group's activity
    const channel = supabase
      .channel(`activity-${group.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "activity_logs",
          filter: `group_id=eq.${group.id}`,
        },
        async (payload) => {
          const row = payload.new as ActivityRow;
          setRows((prev) => {
            if (prev.some((r) => r.id === row.id)) return prev;
            return [row, ...prev].slice(0, 200);
          });

          // Hydrate any new actor / task referenced
          const needProfile = row.actor_id && !profiles.has(row.actor_id);
          const needTask = row.task_id && !tasks.has(row.task_id);
          if (needProfile) {
            const { data } = await supabase
              .from("profiles")
              .select("id, name, email")
              .eq("id", row.actor_id!)
              .maybeSingle();
            if (data)
              setProfiles((prev) => {
                const next = new Map(prev);
                next.set(data.id, {
                  id: data.id,
                  name: data.name ?? "",
                  email: data.email ?? "",
                });
                return next;
              });
          }
          if (needTask) {
            const { data } = await supabase
              .from("tasks")
              .select("id, title")
              .eq("id", row.task_id!)
              .maybeSingle();
            if (data)
              setTasks((prev) => {
                const next = new Map(prev);
                next.set(data.id, { id: data.id, title: data.title });
                return next;
              });
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.id]);

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => ACTION_META[r.action]?.group === filter);
  }, [rows, filter]);

  const grouped = useMemo(() => groupByDay(filtered), [filtered]);

  const counts = useMemo(() => {
    const c = { all: rows.length, tasks: 0, comments: 0, messages: 0 };
    for (const r of rows) {
      const g = ACTION_META[r.action]?.group;
      if (g) c[g] += 1;
    }
    return c;
  }, [rows]);

  if (groupLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!group) {
    return (
      <div className="rounded-2xl border border-dashed bg-card p-12 text-center">
        <p className="text-sm text-muted-foreground">
          Select or create a group to see its activity.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Activity</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Real-time feed of task updates, comments, and messages in{" "}
            <span className="font-medium text-foreground">{group.name}</span>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1">
            <span className="size-1.5 rounded-full bg-success animate-pulse" />
            Live
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              // Re-trigger effect by toggling loading state through filter no-op
              setLoading(true);
              setRows([]);
              // Force re-fetch by replaying effect dependency
              setTimeout(() => {
                supabase
                  .from("activity_logs")
                  .select("id, group_id, task_id, actor_id, action, details, created_at")
                  .eq("group_id", group.id)
                  .order("created_at", { ascending: false })
                  .limit(150)
                  .then(({ data }) => {
                    setRows((data ?? []) as ActivityRow[]);
                    setLoading(false);
                  });
              }, 0);
            }}
          >
            Refresh
          </Button>
        </div>
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterKey)}>
        <TabsList>
          <TabsTrigger value="all">All · {counts.all}</TabsTrigger>
          <TabsTrigger value="tasks">Tasks · {counts.tasks}</TabsTrigger>
          <TabsTrigger value="comments">Comments · {counts.comments}</TabsTrigger>
          <TabsTrigger value="messages">Messages · {counts.messages}</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-12 text-center">
            <ActivityIcon className="size-8 text-muted-foreground" />
            <p className="text-sm font-medium">No activity yet</p>
            <p className="text-xs text-muted-foreground">
              Create tasks, leave comments, or send messages and they’ll show up here in real time.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {grouped.map((g) => (
            <section key={g.label}>
              <div className="mb-3 flex items-center gap-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {g.label}
                </h3>
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">{g.items.length}</span>
              </div>
              <ol className="relative space-y-3 border-l border-border/60 pl-6">
                {g.items.map((row) => {
                  const meta = ACTION_META[row.action];
                  const Icon = meta?.icon ?? ActivityIcon;
                  const actor = row.actor_id ? profiles.get(row.actor_id) : null;
                  const actorName =
                    actor?.name?.trim() || actor?.email || "Someone";
                  return (
                    <li key={row.id} className="relative">
                      <span
                        className={cn(
                          "absolute -left-[33px] top-2 grid size-6 place-items-center rounded-full ring-4 ring-background",
                          meta?.tone ?? "bg-muted text-foreground",
                        )}
                      >
                        <Icon className="size-3.5" />
                      </span>
                      <Card className="border-border/70 transition hover:border-border">
                        <CardContent className="flex items-start gap-3 p-3">
                          <Avatar className="size-8">
                            <AvatarFallback className="text-xs">
                              {actor ? initials(actor.name, actor.email) : "??"}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm leading-snug">
                              <span className="font-medium">{actorName}</span>{" "}
                              <span className="text-muted-foreground">
                                {meta?.label ?? row.action}
                              </span>{" "}
                              <span className="text-foreground">
                                {describe(row, tasks, profiles)}
                              </span>
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(row.created_at), {
                                addSuffix: true,
                              })}
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
