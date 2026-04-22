import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ListChecks,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentGroup } from "@/lib/useCurrentGroup";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_app/dashboard")({
  component: DashboardPage,
});

interface TaskRow {
  id: string;
  title: string;
  status: "not_started" | "in_progress" | "completed";
  deadline: string | null;
  updated_at: string;
}
interface ActivityRow {
  id: string;
  action: string;
  created_at: string;
  details: Record<string, unknown> | null;
}

function DashboardPage() {
  const { group, loading: groupLoading } = useCurrentGroup();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!group) return;
    (async () => {
      setLoading(true);
      const [{ data: t }, { data: a }] = await Promise.all([
        supabase
          .from("tasks")
          .select("id, title, status, deadline, updated_at")
          .eq("group_id", group.id),
        supabase
          .from("activity_logs")
          .select("id, action, created_at, details")
          .eq("group_id", group.id)
          .order("created_at", { ascending: false })
          .limit(8),
      ]);
      setTasks((t ?? []) as TaskRow[]);
      setActivity((a ?? []) as ActivityRow[]);
      setLoading(false);
    })();
  }, [group]);

  const stats = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === "completed").length;
    const inProgress = tasks.filter((t) => t.status === "in_progress").length;
    const now = Date.now();
    const overdue = tasks.filter(
      (t) => t.status !== "completed" && t.deadline && new Date(t.deadline).getTime() < now,
    ).length;
    const completion = total ? Math.round((completed / total) * 100) : 0;
    return { total, completed, inProgress, overdue, completion };
  }, [tasks]);

  const statusData = useMemo(
    () => [
      { name: "Not started", value: tasks.filter((t) => t.status === "not_started").length },
      { name: "In progress", value: stats.inProgress },
      { name: "Completed", value: stats.completed },
    ],
    [tasks, stats],
  );

  const weekData = useMemo(() => {
    const days: { name: string; completed: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toDateString();
      days.push({
        name: d.toLocaleDateString(undefined, { weekday: "short" }),
        completed: tasks.filter(
          (t) => t.status === "completed" && new Date(t.updated_at).toDateString() === key,
        ).length,
      });
    }
    return days;
  }, [tasks]);

  if (groupLoading || loading) return <DashboardSkeleton />;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Dashboard</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Overview of {group?.name ?? "your workspace"}.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total tasks" value={stats.total} icon={ListChecks} accent="bg-primary/10 text-primary" />
        <StatCard
          label="Completion rate"
          value={`${stats.completion}%`}
          icon={TrendingUp}
          accent="bg-accent/15 text-accent-foreground"
        />
        <StatCard
          label="In progress"
          value={stats.inProgress}
          icon={Clock}
          accent="bg-warning/15 text-warning-foreground"
        />
        <StatCard
          label="Overdue"
          value={stats.overdue}
          icon={AlertTriangle}
          accent="bg-destructive/10 text-destructive"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 shadow-soft">
          <CardHeader>
            <CardTitle className="text-base">Completed this week</CardTitle>
            <CardDescription>Tasks marked completed over the last 7 days</CardDescription>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weekData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--muted-foreground)" fontSize={12} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    color: "var(--popover-foreground)",
                  }}
                />
                <Bar dataKey="completed" fill="var(--accent)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardHeader>
            <CardTitle className="text-base">Status breakdown</CardTitle>
            <CardDescription>Distribution of task statuses</CardDescription>
          </CardHeader>
          <CardContent className="h-64">
            {stats.total === 0 ? (
              <EmptyHint label="No tasks yet" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={45}
                    outerRadius={80}
                    paddingAngle={3}
                  >
                    {statusData.map((_, i) => (
                      <Cell
                        key={i}
                        fill={["var(--muted)", "var(--chart-3)", "var(--success)"][i]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      color: "var(--popover-foreground)",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent activity */}
      <Card className="shadow-soft">
        <CardHeader>
          <CardTitle className="text-base">Recent activity</CardTitle>
          <CardDescription>Latest events across the workspace</CardDescription>
        </CardHeader>
        <CardContent>
          {activity.length === 0 ? (
            <EmptyHint label="No activity yet — create a task to get started." />
          ) : (
            <ul className="divide-y">
              {activity.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted">
                      <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{prettyAction(a.action)}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    {a.action.split("_")[0]}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number | string;
  icon: typeof ListChecks;
  accent: string;
}) {
  return (
    <Card className="shadow-soft">
      <CardContent className="flex items-center gap-4 p-5">
        <div className={`grid h-11 w-11 place-items-center rounded-xl ${accent}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="text-2xl font-semibold tracking-tight">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyHint({ label }: { label: string }) {
  return (
    <div className="grid h-full place-items-center text-sm text-muted-foreground">{label}</div>
  );
}

function prettyAction(action: string) {
  return action.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 lg:col-span-2" />
        <Skeleton className="h-72" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
