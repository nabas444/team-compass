import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Check, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Status = "not_started" | "in_progress" | "completed";

export interface TaskRecord {
  id: string;
  group_id: string;
  title: string;
  description: string | null;
  status: Status;
  deadline: string | null;
  assigned_to: string | null;
  created_by: string;
}

export interface MemberOption {
  user_id: string;
  name: string;
  email: string;
}

interface Subtask {
  id: string;
  title: string;
  completed: boolean;
  task_id: string;
  created_by: string;
}

interface Comment {
  id: string;
  body: string;
  author_id: string;
  created_at: string;
}

const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
];

const UNASSIGNED = "__none__";

export function TaskDetailSheet({
  task,
  members,
  open,
  onOpenChange,
  onSaved,
}: {
  task: TaskRecord | null;
  members: MemberOption[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<Status>("not_started");
  const [deadline, setDeadline] = useState("");
  const [deadlineError, setDeadlineError] = useState<string | null>(null);
  const [assignee, setAssignee] = useState<string>(UNASSIGNED);
  const [saving, setSaving] = useState(false);

  // Validates the deadline string. Returns an error message or null when valid.
  const validateDeadline = (value: string): string | null => {
    const v = value.trim();
    if (!v) return "Deadline is required";
    // HTML date input format: YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return "Use the format YYYY-MM-DD";
    const d = new Date(`${v}T00:00:00`);
    if (Number.isNaN(d.getTime())) return "That date doesn't exist";
    const year = d.getFullYear();
    if (year < 2000 || year > 2100) return "Year must be between 2000 and 2100";
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (d < today) return "Deadline cannot be in the past";
    return null;
  };

  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [newSubtask, setNewSubtask] = useState("");
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [loadingChildren, setLoadingChildren] = useState(false);

  // Hydrate form state when task changes
  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description ?? "");
    setStatus(task.status);
    setDeadline(task.deadline ? task.deadline.slice(0, 10) : "");
    setAssignee(task.assigned_to ?? UNASSIGNED);
  }, [task]);

  // Load subtasks + comments
  useEffect(() => {
    if (!task || !open) return;
    let cancelled = false;
    (async () => {
      setLoadingChildren(true);
      const [{ data: st }, { data: cm }] = await Promise.all([
        supabase
          .from("subtasks")
          .select("id, title, completed, task_id, created_by")
          .eq("task_id", task.id)
          .order("created_at", { ascending: true }),
        supabase
          .from("comments")
          .select("id, body, author_id, created_at")
          .eq("task_id", task.id)
          .order("created_at", { ascending: true }),
      ]);
      if (!cancelled) {
        setSubtasks((st ?? []) as Subtask[]);
        setComments((cm ?? []) as Comment[]);
        setLoadingChildren(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [task, open]);

  if (!task) return null;

  const memberName = (id: string | null) => {
    if (!id) return "Unknown";
    const m = members.find((x) => x.user_id === id);
    return m?.name?.trim() || m?.email || "Unknown";
  };

  const saveDetails = async () => {
    if (!title.trim()) return toast.error("Title is required");
    setSaving(true);
    const { error } = await supabase
      .from("tasks")
      .update({
        title: title.trim(),
        description: description.trim() || null,
        status,
        deadline: deadline ? new Date(deadline).toISOString() : null,
        assigned_to: assignee === UNASSIGNED ? null : assignee,
      })
      .eq("id", task.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Task updated");
    onSaved();
  };

  const addSubtask = async () => {
    const t = newSubtask.trim();
    if (!t || !user) return;
    if (t.length > 200) return toast.error("Subtask too long");
    const { data, error } = await supabase
      .from("subtasks")
      .insert({ task_id: task.id, title: t, created_by: user.id })
      .select("id, title, completed, task_id, created_by")
      .single();
    if (error) return toast.error(error.message);
    setSubtasks((s) => [...s, data as Subtask]);
    setNewSubtask("");
  };

  const toggleSubtask = async (s: Subtask) => {
    const next = !s.completed;
    setSubtasks((arr) => arr.map((x) => (x.id === s.id ? { ...x, completed: next } : x)));
    const { error } = await supabase
      .from("subtasks")
      .update({ completed: next })
      .eq("id", s.id);
    if (error) {
      setSubtasks((arr) => arr.map((x) => (x.id === s.id ? { ...x, completed: s.completed } : x)));
      toast.error(error.message);
    }
  };

  const deleteSubtask = async (id: string) => {
    const prev = subtasks;
    setSubtasks((arr) => arr.filter((x) => x.id !== id));
    const { error } = await supabase.from("subtasks").delete().eq("id", id);
    if (error) {
      setSubtasks(prev);
      toast.error(error.message);
    }
  };

  const addComment = async () => {
    const body = newComment.trim();
    if (!body || !user) return;
    if (body.length > 2000) return toast.error("Comment too long");
    const { data, error } = await supabase
      .from("comments")
      .insert({ task_id: task.id, body, author_id: user.id })
      .select("id, body, author_id, created_at")
      .single();
    if (error) return toast.error(error.message);
    setComments((c) => [...c, data as Comment]);
    setNewComment("");
  };

  const deleteComment = async (id: string) => {
    const prev = comments;
    setComments((arr) => arr.filter((x) => x.id !== id));
    const { error } = await supabase.from("comments").delete().eq("id", id);
    if (error) {
      setComments(prev);
      toast.error(error.message);
    }
  };

  const completedCount = subtasks.filter((s) => s.completed).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Task details</SheetTitle>
          <SheetDescription>Edit the task and manage subtasks & discussion.</SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="details" className="mt-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="subtasks">
              Subtasks {subtasks.length > 0 && `(${completedCount}/${subtasks.length})`}
            </TabsTrigger>
            <TabsTrigger value="comments">
              Comments {comments.length > 0 && `(${comments.length})`}
            </TabsTrigger>
          </TabsList>

          {/* DETAILS */}
          <TabsContent value="details" className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="e-title">Title</Label>
              <Input
                id="e-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="e-desc">Description</Label>
              <Textarea
                id="e-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                maxLength={2000}
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
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="e-deadline">Deadline</Label>
                <Input
                  id="e-deadline"
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Assignee</Label>
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {m.name?.trim() || m.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={saveDetails} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save changes
              </Button>
            </div>
          </TabsContent>

          {/* SUBTASKS */}
          <TabsContent value="subtasks" className="space-y-4 pt-4">
            <div className="flex gap-2">
              <Input
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addSubtask()}
                placeholder="Add a subtask…"
                maxLength={200}
              />
              <Button onClick={addSubtask} size="icon" aria-label="Add subtask">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {loadingChildren ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : subtasks.length === 0 ? (
              <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                No subtasks yet.
              </p>
            ) : (
              <ul className="space-y-1">
                {subtasks.map((s) => (
                  <li
                    key={s.id}
                    className="group flex items-center gap-3 rounded-lg border bg-card px-3 py-2"
                  >
                    <Checkbox checked={s.completed} onCheckedChange={() => toggleSubtask(s)} />
                    <span
                      className={`flex-1 text-sm ${s.completed ? "line-through text-muted-foreground" : ""}`}
                    >
                      {s.title}
                    </span>
                    {s.created_by === user?.id && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 opacity-0 group-hover:opacity-100"
                        onClick={() => deleteSubtask(s.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          {/* COMMENTS */}
          <TabsContent value="comments" className="space-y-4 pt-4">
            {loadingChildren ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : comments.length === 0 ? (
              <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                No comments yet.
              </p>
            ) : (
              <ul className="space-y-3">
                {comments.map((c) => (
                  <li key={c.id} className="rounded-lg border bg-card p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="grid h-7 w-7 place-items-center rounded-full bg-accent/15 text-xs font-semibold text-accent-foreground">
                          {(memberName(c.author_id)[0] ?? "?").toUpperCase()}
                        </div>
                        <div className="text-sm">
                          <span className="font-medium">{memberName(c.author_id)}</span>
                          <span className="ml-2 text-xs text-muted-foreground">
                            {format(new Date(c.created_at), "MMM d, h:mm a")}
                          </span>
                        </div>
                      </div>
                      {c.author_id === user?.id && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => deleteComment(c.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      )}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm">{c.body}</p>
                  </li>
                ))}
              </ul>
            )}
            <Separator />
            <div className="space-y-2">
              <Textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Write a comment…"
                rows={3}
                maxLength={2000}
              />
              <div className="flex justify-end">
                <Button onClick={addComment} size="sm" className="gap-2">
                  <Check className="h-4 w-4" /> Post comment
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
