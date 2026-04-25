import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Sparkles,
  RefreshCw,
  UserX,
  Clock,
  CheckCircle2,
  TrendingDown,
  Activity,
  CalendarClock,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useGroups } from "@/lib/groups";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_app/insights")({
  component: InsightsPage,
});

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

interface ProfileRow {
  id: string;
  name: string;
  email: string;
}

interface AiAlert {
  severity: "high" | "medium" | "low";
  category: string;
  title: string;
  message: string;
}

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function flagLabel(flag: string) {
  const map: Record<string, string> = {
    inactive: "Inactive",
    low_engagement: "Low engagement",
    consistently_late: "Consistently late",
    never_completes: "Never completes",
    healthy: "Healthy",
  };
  return map[flag] ?? flag;
}

function flagVariant(flag: string): "destructive" | "secondary" | "default" | "outline" {
  if (flag === "healthy") return "default";
  if (flag === "inactive" || flag === "never_completes") return "destructive";
  return "secondary";
}

function severityClasses(sev: string) {
  switch (sev) {
    case "high":
      return "border-destructive/40 bg-destructive/5";
    case "medium":
      return "border-amber-500/40 bg-amber-500/5";
    default:
      return "border-border bg-muted/30";
  }
}

function severityIcon(sev: string) {
  if (sev === "high") return <AlertTriangle className="h-4 w-4 text-destructive" />;
  if (sev === "medium") return <Clock className="h-4 w-4 text-amber-500" />;
  return <CheckCircle2 className="h-4 w-4 text-muted-foreground" />;
}

function InsightsPage() {
  const { currentGroupId, currentGroup, loading: groupsLoading } = useGroups();
  const [lookback, setLookback] = useState<number>(30);
  const [behavior, setBehavior] = useState<BehaviorRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [profiles, setProfiles] = useState<Map<string, ProfileRow>>(new Map());
  const [alerts, setAlerts] = useState<AiAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  const loadData = useCallback(async () => {
    if (!currentGroupId) return;
    setLoading(true);
    try {
      const [bRes, tRes] = await Promise.all([
        supabase.rpc("behavior_insights", {
          _group_id: currentGroupId,
          _lookback_days: lookback,
        }),
        supabase
          .from("tasks")
          .select("id, title, status, deadline, assigned_to, updated_at")
          .eq("group_id", currentGroupId),
      ]);

      if (bRes.error) throw bRes.error;
      if (tRes.error) throw tRes.error;

      const bData = (bRes.data ?? []) as BehaviorRow[];
      const tData = (tRes.data ?? []) as TaskRow[];
      setBehavior(bData);
      setTasks(tData);

      const ids = new Set<string>();
      bData.forEach((b) => ids.add(b.user_id));
      tData.forEach((t) => t.assigned_to && ids.add(t.assigned_to));
      if (ids.size > 0) {
        const { data: pData } = await supabase
          .from("profiles")
          .select("id, name, email")
          .in("id", Array.from(ids));
        const map = new Map<string, ProfileRow>();
        (pData ?? []).forEach((p: any) => map.set(p.id, p));
        setProfiles(map);
      }
    } catch (e: any) {
      toast.error(e.message ?? "Failed to load insights");
    } finally {
      setLoading(false);
    }
  }, [currentGroupId, lookback]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const generateAlerts = useCallback(async () => {
    if (!currentGroupId) return;
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("group-insights", {
        body: { group_id: currentGroupId, lookback_days: lookback },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setAlerts((data as any)?.alerts ?? []);
      toast.success("AI alerts generated");
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (msg.includes("429") || msg.toLowerCase().includes("rate")) {
        toast.error("Rate limit reached. Try again shortly.");
      } else if (msg.includes("402") || msg.toLowerCase().includes("credit")) {
        toast.error("AI credits exhausted. Add credits in workspace settings.");
      } else {
        toast.error(msg || "Failed to generate alerts");
      }
    } finally {
      setAiLoading(false);
    }
  }, [currentGroupId, lookback]);

  const now = Date.now();
  const atRiskTasks = useMemo(() => {
    return tasks
      .filter((t) => t.status !== "completed" && t.deadline)
      .map((t) => {
        const dl = new Date(t.deadline!).getTime();
        const diff = dl - now;
        return {
          ...t,
          overdue: diff < 0,
          dueSoon: diff >= 0 && diff < 1000 * 60 * 60 * 48,
          deadlineMs: dl,
        };
      })
      .filter((t) => t.overdue || t.dueSoon)
      .sort((a, b) => a.deadlineMs - b.deadlineMs);
  }, [tasks, now]);

  const inactiveMembers = useMemo(
    () =>
      behavior
        .filter(
          (b) =>
            b.flags.includes("inactive") ||
            b.flags.includes("low_engagement") ||
            (b.days_since_last_action ?? 0) >= 7,
        )
        .sort((a, b) => (b.days_since_last_action ?? 999) - (a.days_since_last_action ?? 999)),
    [behavior],
  );

  const stats = useMemo(() => {
    const totalMembers = behavior.length;
    const inactive = behavior.filter((b) => b.flags.includes("inactive")).length;
    const late = behavior.filter((b) => b.flags.includes("consistently_late")).length;
    const healthy = behavior.filter((b) => b.flags.includes("healthy")).length;
    return { totalMembers, inactive, late, healthy };
  }, [behavior]);

  if (groupsLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!currentGroupId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No workspace selected</CardTitle>
          <CardDescription>Pick or create a workspace to see insights.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Insights</h1>
          <p className="text-sm text-muted-foreground">
            {currentGroup?.name} — inactive members, tasks at risk, and AI-powered alerts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(lookback)} onValueChange={(v) => setLookback(Number(v))}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={generateAlerts} disabled={aiLoading}>
            <Sparkles className={`mr-2 h-4 w-4 ${aiLoading ? "animate-pulse" : ""}`} />
            {aiLoading ? "Analyzing…" : "AI alerts"}
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<Activity className="h-4 w-4" />}
          label="Members"
          value={stats.totalMembers}
        />
        <KpiCard
          icon={<UserX className="h-4 w-4 text-destructive" />}
          label="Inactive"
          value={stats.inactive}
          tone="destructive"
        />
        <KpiCard
          icon={<TrendingDown className="h-4 w-4 text-amber-500" />}
          label="Consistently late"
          value={stats.late}
          tone="warning"
        />
        <KpiCard
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          label="Healthy"
          value={stats.healthy}
          tone="success"
        />
      </div>

      {/* AI Alerts */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI alerts
          </CardTitle>
          <CardDescription>
            Click "AI alerts" above to generate a fresh briefing for this workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {aiLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No alerts yet — generate to get started.</p>
          ) : (
            <ul className="space-y-2">
              {alerts.map((a, i) => (
                <li key={i} className={`rounded-md border p-3 ${severityClasses(a.severity)}`}>
                  <div className="flex items-start gap-2">
                    {severityIcon(a.severity)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm">{a.title}</p>
                        <Badge variant="outline" className="text-xs capitalize">
                          {a.severity}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          {a.category.replace(/_/g, " ")}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{a.message}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Tabs: Members & Tasks */}
      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members">
            Inactive members
            {inactiveMembers.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {inactiveMembers.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="tasks">
            Tasks at risk
            {atRiskTasks.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {atRiskTasks.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="all">All members</TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="space-y-2">
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : inactiveMembers.length === 0 ? (
            <EmptyCard text="No inactive members in the selected window." />
          ) : (
            inactiveMembers.map((b) => (
              <MemberRow key={b.user_id} row={b} profile={profiles.get(b.user_id)} />
            ))
          )}
        </TabsContent>

        <TabsContent value="tasks" className="space-y-2">
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : atRiskTasks.length === 0 ? (
            <EmptyCard text="No tasks at risk. Nice work." />
          ) : (
            atRiskTasks.map((t) => (
              <TaskRowItem
                key={t.id}
                task={t}
                assigneeName={
                  t.assigned_to
                    ? profiles.get(t.assigned_to)?.name ||
                      profiles.get(t.assigned_to)?.email ||
                      "Unassigned"
                    : "Unassigned"
                }
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="all" className="space-y-2">
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : behavior.length === 0 ? (
            <EmptyCard text="No member data yet." />
          ) : (
            behavior
              .slice()
              .sort((a, b) => b.total_actions - a.total_actions)
              .map((b) => (
                <MemberRow key={b.user_id} row={b} profile={profiles.get(b.user_id)} />
              ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: "destructive" | "warning" | "success";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{label}</p>
          {icon}
        </div>
        <p className="text-2xl font-bold mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}

function EmptyCard({ text }: { text: string }) {
  return (
    <Card>
      <CardContent className="py-8 text-center text-sm text-muted-foreground">{text}</CardContent>
    </Card>
  );
}

function MemberRow({ row, profile }: { row: BehaviorRow; profile?: ProfileRow }) {
  const name = profile?.name || profile?.email || "Member";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Avatar className="h-9 w-9">
            <AvatarFallback>{initials(name)}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <p className="font-medium text-sm">{name}</p>
                {profile?.email && (
                  <p className="text-xs text-muted-foreground">{profile.email}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {row.flags.map((f) => (
                  <Badge key={f} variant={flagVariant(f)} className="text-xs">
                    {flagLabel(f)}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-xs">
              <Stat label="Actions" value={row.total_actions} />
              <Stat label="Completed" value={row.tasks_completed} />
              <Stat label="Late" value={row.tasks_late} />
              <Stat
                label="Idle"
                value={
                  row.days_since_last_action === null
                    ? "—"
                    : `${row.days_since_last_action}d`
                }
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md bg-muted/40 px-2 py-1.5">
      <p className="text-muted-foreground text-[11px] uppercase tracking-wide">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

function TaskRowItem({
  task,
  assigneeName,
}: {
  task: TaskRow & { overdue: boolean; dueSoon: boolean; deadlineMs: number };
  assigneeName: string;
}) {
  return (
    <Card className={task.overdue ? "border-destructive/40" : "border-amber-500/40"}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <CalendarClock
            className={`h-5 w-5 mt-0.5 ${task.overdue ? "text-destructive" : "text-amber-500"}`}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="font-medium text-sm">{task.title}</p>
              <Badge variant={task.overdue ? "destructive" : "secondary"} className="text-xs">
                {task.overdue ? "Overdue" : "Due soon"}
              </Badge>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
              <span>Assignee: {assigneeName}</span>
              <span>•</span>
              <span>Status: {task.status.replace(/_/g, " ")}</span>
              <span>•</span>
              <span>
                {task.overdue ? "Overdue " : "Due "}
                {formatDistanceToNow(new Date(task.deadlineMs), { addSuffix: true })}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
