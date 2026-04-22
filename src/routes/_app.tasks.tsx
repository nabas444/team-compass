import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { LayoutGrid, List, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useCurrentGroup } from "@/lib/useCurrentGroup";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/tasks")({
  component: TasksPage,
});

type Status = "not_started" | "in_progress" | "completed";

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: Status;
  deadline: string | null;
  assigned_to: string | null;
  created_by: string;
  created_at: string;
}

const STATUS_META: Record<Status, { label: string; tone: string }> = {
  not_started: { label: "Not started", tone: "bg-muted text-muted-foreground" },
  in_progress: { label: "In progress", tone: "bg-warning/20 text-warning-foreground" },
  completed: { label: "Completed", tone: "bg-success/20 text-success-foreground" },
};

function TasksPage() {
  const { user } = useAuth();
  const { group, loading: groupLoading } = useCurrentGroup();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"list" | "kanban">("list");
  const [open, setOpen] = useState(false);

  const refresh = async () => {
    if (!group) return;
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .eq("group_id", group.id)
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setTasks((data ?? []) as Task[]);
  };

  useEffect(() => {
    if (!group) return;
    (async () => {
      setLoading(true);
      await refresh();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group]);

  const updateStatus = async (id: string, status: Status) => {
    const prev = tasks;
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, status } : t)));
    const { error } = await supabase.from("tasks").update({ status }).eq("id", id);
    if (error) {
      setTasks(prev);
      toast.error(error.message);
    }
  };

  const deleteTask = async (id: string) => {
    const prev = tasks;
    setTasks((ts) => ts.filter((t) => t.id !== id));
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) {
      setTasks(prev);
      toast.error(error.message);
    } else toast.success("Task deleted");
  };

  if (groupLoading || loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Tasks</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {tasks.length} task{tasks.length === 1 ? "" : "s"} in {group?.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={view} onValueChange={(v) => setView(v as "list" | "kanban")}>
            <TabsList>
              <TabsTrigger value="list" className="gap-2">
                <List className="h-4 w-4" /> List
              </TabsTrigger>
              <TabsTrigger value="kanban" className="gap-2">
                <LayoutGrid className="h-4 w-4" /> Kanban
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <CreateTaskDialog
            open={open}
            onOpenChange={setOpen}
            groupId={group?.id ?? ""}
            userId={user?.id ?? ""}
            onCreated={refresh}
          />
        </div>
      </div>

      {tasks.length === 0 ? (
        <EmptyState onCreate={() => setOpen(true)} />
      ) : view === "list" ? (
        <ListView tasks={tasks} onStatus={updateStatus} onDelete={deleteTask} />
      ) : (
        <KanbanView tasks={tasks} onStatus={updateStatus} onDelete={deleteTask} />
      )}
    </div>
  );
}

function ListView({
  tasks,
  onStatus,
  onDelete,
}: {
  tasks: Task[];
  onStatus: (id: string, s: Status) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <Card className="shadow-soft overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Title</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Deadline</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {tasks.map((t) => (
              <tr key={t.id} className="hover:bg-muted/30">
                <td className="px-4 py-3">
                  <div className="font-medium">{t.title}</div>
                  {t.description && (
                    <div className="line-clamp-1 text-xs text-muted-foreground">
                      {t.description}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Select value={t.status} onValueChange={(v) => onStatus(t.id, v as Status)}>
                    <SelectTrigger className="h-8 w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(STATUS_META) as Status[]).map((s) => (
                        <SelectItem key={s} value={s}>
                          {STATUS_META[s].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {t.deadline ? format(new Date(t.deadline), "MMM d, yyyy") : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => onDelete(t.id)}
                    aria-label="Delete task"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function KanbanView({
  tasks,
  onStatus,
  onDelete,
}: {
  tasks: Task[];
  onStatus: (id: string, s: Status) => void;
  onDelete: (id: string) => void;
}) {
  const cols: Status[] = ["not_started", "in_progress", "completed"];
  const grouped = useMemo(() => {
    const m: Record<Status, Task[]> = { not_started: [], in_progress: [], completed: [] };
    tasks.forEach((t) => m[t.status].push(t));
    return m;
  }, [tasks]);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {cols.map((c) => (
        <div key={c} className="rounded-2xl border bg-muted/30 p-3">
          <div className="mb-3 flex items-center justify-between px-1">
            <h3 className="text-sm font-semibold">{STATUS_META[c].label}</h3>
            <Badge variant="secondary">{grouped[c].length}</Badge>
          </div>
          <div className="space-y-2">
            {grouped[c].length === 0 && (
              <p className="px-1 py-6 text-center text-xs text-muted-foreground">No tasks</p>
            )}
            {grouped[c].map((t) => (
              <Card key={t.id} className="shadow-soft">
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium leading-snug">{t.title}</p>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="-mr-1 -mt-1 h-7 w-7"
                      onClick={() => onDelete(t.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                  {t.description && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">{t.description}</p>
                  )}
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <Badge className={cn("text-[10px]", STATUS_META[t.status].tone)} variant="outline">
                      {t.deadline ? format(new Date(t.deadline), "MMM d") : "No deadline"}
                    </Badge>
                    <Select value={t.status} onValueChange={(v) => onStatus(t.id, v as Status)}>
                      <SelectTrigger className="h-7 w-[120px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(STATUS_META) as Status[]).map((s) => (
                          <SelectItem key={s} value={s}>
                            {STATUS_META[s].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CreateTaskDialog({
  open,
  onOpenChange,
  groupId,
  userId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  groupId: string;
  userId: string;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<Status>("not_started");
  const [deadline, setDeadline] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim()) return toast.error("Title is required");
    setSaving(true);
    const { error } = await supabase.from("tasks").insert({
      group_id: groupId,
      created_by: userId,
      title: title.trim(),
      description: description.trim() || null,
      status,
      deadline: deadline ? new Date(deadline).toISOString() : null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Task created");
    setTitle("");
    setDescription("");
    setStatus("not_started");
    setDeadline("");
    onOpenChange(false);
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" /> New task
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create task</DialogTitle>
          <DialogDescription>Add a task to your workspace.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="t-title">Title</Label>
            <Input
              id="t-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Design new landing hero"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="t-desc">Description</Label>
            <Textarea
              id="t-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional details…"
              rows={3}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(STATUS_META) as Status[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_META[s].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="t-deadline">Deadline</Label>
              <Input
                id="t-deadline"
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Creating…" : "Create task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card className="shadow-soft">
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-accent/15 text-accent-foreground">
          <Plus className="h-5 w-5" />
        </div>
        <div>
          <p className="font-medium">No tasks yet</p>
          <p className="text-sm text-muted-foreground">Create your first task to get going.</p>
        </div>
        <Button onClick={onCreate} className="mt-2 gap-2">
          <Plus className="h-4 w-4" /> New task
        </Button>
      </CardContent>
    </Card>
  );
}
