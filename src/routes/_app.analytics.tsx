import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Award,
  CheckCircle2,
  MessageSquare,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format, subDays, startOfDay } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentGroup } from "@/lib/useCurrentGroup";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/analytics")({
  component: AnalyticsPage,
});

interface TaskRow {
  id: string;
  status: "not_started" | "in_progress" | "completed";
  assigned_to: string | null;
  created_by: string;
  deadline: string | null;
  created_at: string;
  updated_at: string;
}
interface ActivityRow {
  id: string;
  action: string;
  actor_id: string | null;
  created_at: string;
}
interface ContributionRow {
  user_id: string;
  score: number;
  tasks_completed: number;
  tasks_late: number;
  comments_count: number;
  subtasks_completed: number;
}
interface HealthRow {
  health_score: number;
  activity_score: number;
  deadline_score: number;
  communication_score: number;
  computed_at: string;
}
interface ProfileMap {
  [id: string]: { name: string; email: string };
}

const COLORS = [
  "hsl(var(--primary))",
  "hsl(217 91% 60%)",
  "hsl(142 71% 45%)",
  "hsl(38 92% 50%)",
  "hsl(280 87% 65%)",
  "hsl(340 82% 60%)",
  "hsl(190 90% 50%)",
];

function initials(name: string, email: string) {
  const src = name?.trim() || email || "?";
  return src
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

function AnalyticsPage() {
  const { group, loading: groupLoading } = useCurrentGroup();
  const [range, setRange] = useState<"7" | "30" | "90">("30");
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [contributions, setContributions] = useState<ContributionRow[]>([]);
  const [health, setHealth] = useState<HealthRow | null>(null);
  const [profiles, setProfiles] = useState<ProfileMap>({});
  const [memberCount, setMemberCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);

  const days = parseInt(range, 10);

  useEffect(() => {
    if (!group) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const since = subDays(new Date(), days).toISOString();

      const [
        { data: tRows },
        { data: aRows },
        { data: cRows },
        { data: hRows },
        { data: mRows },
      ] = await Promise.all([
        supabase
          .from("tasks")
          .select(
            "id, status, assigned_to, created_by, deadline, created_at, updated_at",
          )
          .eq("group_id", group.id)
          .gte("created_at", subDays(new Date(), days * 2).toISOString()),
        supabase
          .from("activity_logs")
          .select("id, action, actor_id, created_at")
          .eq("group_id", group.id)
          .gte("created_at", since)
          .order("created_at", { ascending: true }),
        supabase
          .from("contributions")
          .select(
            "user_id, score, tasks_completed, tasks_late, comments_count, subtasks_completed",
          )
          .eq("group_id", group.id),
        supabase
          .from("team_health_snapshots")
          .select(
            "health_score, activity_score, deadline_score, communication_score, computed_at",
          )
          .eq("group_id", group.id)
          .order("computed_at", { ascending: false })
          .limit(1),
        supabase
          .from("memberships")
          .select("user_id")
          .eq("group_id", group.id),
      ]);

      if (cancelled) return;

      setTasks((tRows ?? []) as TaskRow[]);
      setActivity((aRows ?? []) as ActivityRow[]);
      setContributions((cRows ?? []) as ContributionRow[]);
      setHealth(((hRows ?? [])[0] as HealthRow) ?? null);
      setMemberCount((mRows ?? []).length);

      // Hydrate profiles for all referenced users
      const ids = new Set<string>();
      (mRows ?? []).forEach((m: any) => m.user_id && ids.add(m.user_id));
      (cRows ?? []).forEach((c: any) => c.user_id && ids.add(c.user_id));
      (aRows ?? []).forEach((a: any) => a.actor_id && ids.add(a.actor_id));
      (tRows ?? []).forEach((t: any) => {
        if (t.assigned_to) ids.add(t.assigned_to);
        if (t.created_by) ids.add(t.created_by);
      });

      if (ids.size > 0) {
        const { data: pRows } = await supabase
          .from("profiles")
          .select("id, name, email")
          .in("id", Array.from(ids));
        if (!cancelled) {
          const map: ProfileMap = {};
          (pRows ?? []).forEach((p: any) => {
            map[p.id] = { name: p.name ?? "", email: p.email ?? "" };
          });
          setProfiles(map);
        }
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [group?.id, days]);

  const recompute = async () => {
    if (!group) return;
    setComputing(true);
    try {
      const [{ error: e1 }, { error: e2 }] = await Promise.all([
        supabase.rpc("compute_contributions", { _group_id: group.id }),
        supabase.rpc("compute_team_health", {
          _group_id: group.id,
          _lookback_days: days,
        }),
      ]);
      if (e1 || e2) throw e1 || e2;
      toast.success("Analytics refreshed");
      // Re-fetch
      const [{ data: cRows }, { data: hRows }] = await Promise.all([
        supabase
          .from("contributions")
          .select(
            "user_id, score, tasks_completed, tasks_late, comments_count, subtasks_completed",
          )
          .eq("group_id", group.id),
        supabase
          .from("team_health_snapshots")
          .select(
            "health_score, activity_score, deadline_score, communication_score, computed_at",
          )
          .eq("group_id", group.id)
          .order("computed_at", { ascending: false })
          .limit(1),
      ]);
      setContributions((cRows ?? []) as ContributionRow[]);
      setHealth(((hRows ?? [])[0] as HealthRow) ?? null);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to refresh");
    } finally {
      setComputing(false);
    }
  };

  // Daily activity series (within range)
  const dailySeries = useMemo(() => {
    const buckets = new Map<
      string,
      { date: string; tasks: number; comments: number; messages: number; total: number }
    >();
    for (let i = days - 1; i >= 0; i--) {
      const d = format(subDays(new Date(), i), "MMM d");
      buckets.set(d, { date: d, tasks: 0, comments: 0, messages: 0, total: 0 });
    }
    activity.forEach((a) => {
      const key = format(new Date(a.created_at), "MMM d");
      const b = buckets.get(key);
      if (!b) return;
      b.total++;
      if (a.action.startsWith("task_") || a.action.startsWith("subtask_"))
        b.tasks++;
      else if (a.action === "comment_added") b.comments++;
      else if (a.action === "message_sent") b.messages++;
    });
    return Array.from(buckets.values());
  }, [activity, days]);

  // Completion trend (cumulative completed in range)
  const completionTrend = useMemo(() => {
    const buckets = new Map<string, { date: string; completed: number; created: number }>();
    for (let i = days - 1; i >= 0; i--) {
      const d = format(subDays(new Date(), i), "MMM d");
      buckets.set(d, { date: d, completed: 0, created: 0 });
    }
    const sinceTs = subDays(new Date(), days).getTime();
    tasks.forEach((t) => {
      const created = new Date(t.created_at).getTime();
      if (created >= sinceTs) {
        const k = format(new Date(t.created_at), "MMM d");
        const b = buckets.get(k);
        if (b) b.created++;
      }
      if (t.status === "completed") {
        const upd = new Date(t.updated_at).getTime();
        if (upd >= sinceTs) {
          const k = format(new Date(t.updated_at), "MMM d");
          const b = buckets.get(k);
          if (b) b.completed++;
        }
      }
    });
    return Array.from(buckets.values());
  }, [tasks, days]);

  // Status distribution
  const statusData = useMemo(() => {
    const counts = { not_started: 0, in_progress: 0, completed: 0 };
    tasks.forEach((t) => {
      counts[t.status]++;
    });
    return [
      { name: "Not started", value: counts.not_started, fill: COLORS[3] },
      { name: "In progress", value: counts.in_progress, fill: COLORS[1] },
      { name: "Completed", value: counts.completed, fill: COLORS[2] },
    ];
  }, [tasks]);

  // Top contributors
  const topContributors = useMemo(() => {
    return [...contributions]
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((c) => {
        const p = profiles[c.user_id];
        const label = p?.name?.trim() || p?.email?.split("@")[0] || "Unknown";
        return {
          user_id: c.user_id,
          name: label,
          email: p?.email ?? "",
          score: c.score,
          tasks: c.tasks_completed,
          late: c.tasks_late,
          comments: c.comments_count,
          subtasks: c.subtasks_completed,
        };
      });
  }, [contributions, profiles]);

  // Workload by assignee (open tasks)
  const workload = useMemo(() => {
    const map = new Map<string, { open: number; done: number }>();
    tasks.forEach((t) => {
      if (!t.assigned_to) return;
      const cur = map.get(t.assigned_to) ?? { open: 0, done: 0 };
      if (t.status === "completed") cur.done++;
      else cur.open++;
      map.set(t.assigned_to, cur);
    });
    return Array.from(map.entries())
      .map(([uid, v]) => {
        const p = profiles[uid];
        return {
          name: p?.name?.trim() || p?.email?.split("@")[0] || "Unknown",
          open: v.open,
          done: v.done,
        };
      })
      .sort((a, b) => b.open + b.done - (a.open + a.done))
      .slice(0, 8);
  }, [tasks, profiles]);

  // KPIs
  const kpis = useMemo(() => {
    const completed = tasks.filter((t) => t.status === "completed").length;
    const total = tasks.length;
    const completionRate = total ? Math.round((completed / total) * 100) : 0;
    const onTime = tasks.filter(
      (t) =>
        t.status === "completed" &&
        (!t.deadline || new Date(t.updated_at) <= new Date(t.deadline)),
    ).length;
    const onTimeRate = completed ? Math.round((onTime / completed) * 100) : 100;
    const totalActions = activity.length;
    const activeDays = new Set(
      activity.map((a) => format(new Date(a.created_at), "yyyy-MM-dd")),
    ).size;
    return { completionRate, onTimeRate, totalActions, activeDays };
  }, [tasks, activity]);

  if (groupLoading || loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      </div>
    );
  }

  if (!group) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Select or create a workspace to see analytics.
        </CardContent>
      </Card>
    );
  }

  const radarData = health
    ? [
        { metric: "Activity", value: Number(health.activity_score) },
        { metric: "Deadlines", value: Number(health.deadline_score) },
        { metric: "Comms", value: Number(health.communication_score) },
        { metric: "Overall", value: Number(health.health_score) },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Analytics</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Performance, contributions, and trends for{" "}
            <span className="font-medium text-foreground">{group.name}</span>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={range} onValueChange={(v) => setRange(v as any)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={recompute} disabled={computing} variant="outline">
            <TrendingUp className="mr-2 h-4 w-4" />
            {computing ? "Computing…" : "Recompute"}
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-4">
        <KpiCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Completion rate"
          value={`${kpis.completionRate}%`}
          hint={`${tasks.filter((t) => t.status === "completed").length} of ${tasks.length} tasks`}
        />
        <KpiCard
          icon={<Award className="h-4 w-4" />}
          label="On-time delivery"
          value={`${kpis.onTimeRate}%`}
          hint="Of completed tasks"
        />
        <KpiCard
          icon={<Activity className="h-4 w-4" />}
          label="Total actions"
          value={kpis.totalActions.toLocaleString()}
          hint={`${kpis.activeDays} active day${kpis.activeDays === 1 ? "" : "s"}`}
        />
        <KpiCard
          icon={<Users className="h-4 w-4" />}
          label="Members"
          value={memberCount.toString()}
          hint={
            health
              ? `Health ${Number(health.health_score).toFixed(0)}/100`
              : "No health data yet"
          }
        />
      </div>

      {/* Activity + completion */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Daily activity</CardTitle>
            <CardDescription>
              Tasks, comments, and messages over the last {days} days
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={dailySeries}>
                <defs>
                  <linearGradient id="gTasks" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS[1]} stopOpacity={0.6} />
                    <stop offset="95%" stopColor={COLORS[1]} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gComments" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS[2]} stopOpacity={0.6} />
                    <stop offset="95%" stopColor={COLORS[2]} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gMessages" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS[4]} stopOpacity={0.6} />
                    <stop offset="95%" stopColor={COLORS[4]} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="tasks" stroke={COLORS[1]} fill="url(#gTasks)" />
                <Area type="monotone" dataKey="comments" stroke={COLORS[2]} fill="url(#gComments)" />
                <Area type="monotone" dataKey="messages" stroke={COLORS[4]} fill="url(#gMessages)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tasks created vs completed</CardTitle>
            <CardDescription>Daily flow over the last {days} days</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={completionTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line
                  type="monotone"
                  dataKey="created"
                  stroke={COLORS[3]}
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="completed"
                  stroke={COLORS[2]}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Status + Health Radar */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status distribution</CardTitle>
            <CardDescription>All tasks in workspace</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={statusData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={3}
                >
                  {statusData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Team health breakdown</CardTitle>
            <CardDescription>
              {health
                ? `Computed ${format(new Date(health.computed_at), "MMM d, p")}`
                : "Click Recompute to generate the latest snapshot"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {health ? (
              <ResponsiveContainer width="100%" height={240}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="hsl(var(--border))" />
                  <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11 }} />
                  <Radar
                    dataKey="value"
                    stroke={COLORS[0]}
                    fill={COLORS[0]}
                    fillOpacity={0.4}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                </RadarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
                No health snapshot yet — recompute to generate.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top contributors + workload */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top contributors</CardTitle>
            <CardDescription>Score from completed work, comments, subtasks</CardDescription>
          </CardHeader>
          <CardContent>
            {topContributors.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No contributions yet — recompute after some activity.
              </div>
            ) : (
              <div className="space-y-3">
                {topContributors.map((c, i) => {
                  const max = topContributors[0].score || 1;
                  const pct = Math.max(4, Math.round((c.score / max) * 100));
                  return (
                    <div key={c.user_id} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-medium">
                            {i + 1}
                          </div>
                          <Avatar className="h-6 w-6">
                            <AvatarFallback className="text-[10px]">
                              {initials(c.name, c.email)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="truncate text-sm font-medium">{c.name}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="secondary" className="font-mono">
                            {c.score}
                          </Badge>
                        </div>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="flex gap-3 text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          {c.tasks} done
                        </span>
                        <span className="flex items-center gap-1">
                          <MessageSquare className="h-3 w-3" />
                          {c.comments}
                        </span>
                        {c.late > 0 && (
                          <span className="text-amber-600">{c.late} late</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Workload by member</CardTitle>
            <CardDescription>Open vs completed tasks per assignee</CardDescription>
          </CardHeader>
          <CardContent>
            {workload.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No assigned tasks yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(240, workload.length * 36)}>
                <BarChart data={workload} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 11 }}
                    stroke="hsl(var(--muted-foreground))"
                    width={90}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="open" stackId="a" fill={COLORS[1]} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="done" stackId="a" fill={COLORS[2]} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{label}</span>
          <span className="text-muted-foreground/70">{icon}</span>
        </div>
        <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}
