import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow, format, isToday, isYesterday } from "date-fns";
import {
  AtSign,
  Check,
  Hash,
  Loader2,
  MessageSquare,
  Send,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentGroup } from "@/lib/useCurrentGroup";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/chat")({
  component: ChatPage,
});

interface ProfileLite {
  id: string;
  name: string;
  email: string;
}

interface MessageRow {
  id: string;
  group_id: string;
  task_id: string | null;
  author_id: string;
  body: string;
  created_at: string;
}

interface TaskLite {
  id: string;
  title: string;
}

interface SuggestionRow {
  id: string;
  group_id: string;
  message_id: string;
  suggested_title: string;
  suggested_assignee: string | null;
  suggested_deadline: string | null;
  status: "pending" | "accepted" | "dismissed";
  created_task_id: string | null;
  created_at: string;
}

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((s) => s[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function ChatPage() {
  const { group, loading: groupLoading } = useCurrentGroup();
  const { user } = useAuth();

  const [members, setMembers] = useState<ProfileLite[]>([]);
  const [tasks, setTasks] = useState<TaskLite[]>([]);
  const [activeThread, setActiveThread] = useState<string | null>(null); // null = group, otherwise task id
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestionRow[]>([]);
  const [extractingId, setExtractingId] = useState<string | null>(null);

  // Mention picker state
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load members + tasks
  useEffect(() => {
    if (!group?.id) return;
    let cancelled = false;
    (async () => {
      const [{ data: m }, { data: t }] = await Promise.all([
        supabase.from("memberships").select("user_id").eq("group_id", group.id),
        supabase
          .from("tasks")
          .select("id, title")
          .eq("group_id", group.id)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      if (cancelled) return;
      const ids = (m ?? []).map((r: { user_id: string }) => r.user_id);
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, name, email")
          .in("id", ids);
        if (!cancelled) {
          setMembers(
            (profs ?? []).map((p: any) => ({
              id: p.id,
              name: p.name?.trim() || p.email,
              email: p.email,
            })),
          );
        }
      } else {
        setMembers([]);
      }
      setTasks((t ?? []) as TaskLite[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [group?.id]);

  // Load messages & suggestions for active thread + realtime
  useEffect(() => {
    if (!group?.id) return;
    let cancelled = false;
    setLoadingMessages(true);

    const loadMessages = async () => {
      let q = supabase
        .from("messages")
        .select("id, group_id, task_id, author_id, body, created_at")
        .eq("group_id", group.id)
        .order("created_at", { ascending: true })
        .limit(200);
      q = activeThread ? q.eq("task_id", activeThread) : q.is("task_id", null);
      const { data } = await q;
      if (!cancelled) {
        setMessages((data ?? []) as MessageRow[]);
        setLoadingMessages(false);
      }
    };

    const loadSuggestions = async () => {
      const { data } = await supabase
        .from("task_suggestions")
        .select(
          "id, group_id, message_id, suggested_title, suggested_assignee, suggested_deadline, status, created_task_id, created_at",
        )
        .eq("group_id", group.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(20);
      if (!cancelled) setSuggestions((data ?? []) as SuggestionRow[]);
    };

    loadMessages();
    loadSuggestions();

    const channel = supabase
      .channel(`chat-${group.id}-${activeThread ?? "group"}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `group_id=eq.${group.id}` },
        (payload) => {
          const row = payload.new as MessageRow;
          const matches = activeThread ? row.task_id === activeThread : row.task_id === null;
          if (matches) setMessages((prev) => [...prev, row]);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "task_suggestions",
          filter: `group_id=eq.${group.id}`,
        },
        () => loadSuggestions(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [group?.id, activeThread]);

  // Autoscroll
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, loadingMessages]);

  const profileById = useMemo(() => {
    const map = new Map<string, ProfileLite>();
    members.forEach((m) => map.set(m.id, m));
    return map;
  }, [members]);

  const taskById = useMemo(() => {
    const map = new Map<string, TaskLite>();
    tasks.forEach((t) => map.set(t.id, t));
    return map;
  }, [tasks]);

  const filteredMembers = useMemo(() => {
    const q = mentionQuery.toLowerCase();
    return members.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 6);
  }, [members, mentionQuery]);

  const handleDraftChange = (value: string) => {
    setDraft(value);
    const el = textareaRef.current;
    if (!el) return;
    const cursor = el.selectionStart ?? value.length;
    const upTo = value.slice(0, cursor);
    const at = upTo.lastIndexOf("@");
    if (at === -1) {
      setMentionOpen(false);
      return;
    }
    const between = upTo.slice(at + 1);
    if (/\s/.test(between)) {
      setMentionOpen(false);
      return;
    }
    setMentionQuery(between);
    setMentionStart(at);
    setMentionOpen(true);
  };

  const insertMention = (m: ProfileLite) => {
    if (mentionStart === null) return;
    const cursor = textareaRef.current?.selectionStart ?? draft.length;
    const before = draft.slice(0, mentionStart);
    const after = draft.slice(cursor);
    const inserted = `@${m.name.replace(/\s+/g, "_")} `;
    const next = before + inserted + after;
    setDraft(next);
    setMentionOpen(false);
    setMentionStart(null);
    requestAnimationFrame(() => {
      const pos = (before + inserted).length;
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(pos, pos);
    });
  };

  const send = useCallback(async () => {
    if (!group?.id || !user?.id) return;
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    const { data, error } = await supabase
      .from("messages")
      .insert({
        group_id: group.id,
        task_id: activeThread,
        author_id: user.id,
        body,
      })
      .select("id, group_id, task_id, author_id, body, created_at")
      .maybeSingle();
    setSending(false);
    if (error || !data) {
      toast.error(error?.message ?? "Failed to send message");
      return;
    }
    setDraft("");
    // Fire-and-forget AI extraction
    setExtractingId(data.id);
    supabase.functions
      .invoke("extract-task", {
        body: { message_id: data.id, group_id: group.id },
      })
      .then(({ data: res, error: fnErr }) => {
        setExtractingId(null);
        if (fnErr) return; // silent
        const sug = (res as any)?.suggestion;
        if (sug) toast.success("AI detected a task in your message");
      })
      .catch(() => setExtractingId(null));
  }, [group?.id, user?.id, draft, activeThread]);

  const acceptSuggestion = async (s: SuggestionRow) => {
    if (!group?.id || !user?.id) return;
    const { data: task, error: tErr } = await supabase
      .from("tasks")
      .insert({
        group_id: group.id,
        created_by: user.id,
        title: s.suggested_title,
        assigned_to: s.suggested_assignee,
        deadline: s.suggested_deadline,
      })
      .select("id")
      .maybeSingle();
    if (tErr || !task) {
      toast.error(tErr?.message ?? "Could not create task");
      return;
    }
    const { error: uErr } = await supabase
      .from("task_suggestions")
      .update({
        status: "accepted",
        created_task_id: task.id,
        resolved_at: new Date().toISOString(),
        resolved_by: user.id,
      })
      .eq("id", s.id);
    if (uErr) toast.error(uErr.message);
    else toast.success("Task created from message");
  };

  const dismissSuggestion = async (s: SuggestionRow) => {
    if (!user?.id) return;
    const { error } = await supabase
      .from("task_suggestions")
      .update({
        status: "dismissed",
        resolved_at: new Date().toISOString(),
        resolved_by: user.id,
      })
      .eq("id", s.id);
    if (error) toast.error(error.message);
  };

  // Group messages by day
  const grouped = useMemo(() => {
    const buckets: Record<string, MessageRow[]> = {};
    for (const m of messages) {
      const key = format(new Date(m.created_at), "yyyy-MM-dd");
      (buckets[key] ??= []).push(m);
    }
    return Object.entries(buckets).sort(([a], [b]) => a.localeCompare(b));
  }, [messages]);

  if (groupLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-[600px] w-full" />
      </div>
    );
  }

  if (!group) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground">
          Select a group to open chat.
        </CardContent>
      </Card>
    );
  }

  const threadLabel = activeThread
    ? taskById.get(activeThread)?.title ?? "Task thread"
    : `# ${group.name}`;

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr_280px]">
      {/* Threads sidebar */}
      <Card className="lg:max-h-[calc(100vh-7rem)]">
        <CardContent className="space-y-4 p-3">
          <div>
            <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Channels
            </p>
            <button
              onClick={() => setActiveThread(null)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                activeThread === null
                  ? "bg-accent/15 text-accent-foreground"
                  : "hover:bg-muted",
              )}
            >
              <Hash className="h-4 w-4" />
              <span className="truncate">{group.name}</span>
            </button>
          </div>
          <Separator />
          <div>
            <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Task threads
            </p>
            <ScrollArea className="h-[calc(100vh-22rem)] pr-1">
              <div className="space-y-0.5">
                {tasks.length === 0 && (
                  <p className="px-2 py-3 text-xs text-muted-foreground">No tasks yet.</p>
                )}
                {tasks.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setActiveThread(t.id)}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                      activeThread === t.id
                        ? "bg-accent/15 text-accent-foreground"
                        : "hover:bg-muted",
                    )}
                  >
                    <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{t.title}</span>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>
        </CardContent>
      </Card>

      {/* Messages pane */}
      <Card className="flex flex-col lg:max-h-[calc(100vh-7rem)]">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            {activeThread ? (
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Hash className="h-4 w-4 text-muted-foreground" />
            )}
            <h2 className="font-semibold">{threadLabel}</h2>
            {activeThread && (
              <Badge variant="outline" className="text-xs">
                Task thread
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            {members.length}
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
          {loadingMessages ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <MessageSquare className="h-10 w-10 opacity-40" />
              <p className="text-sm">No messages yet. Start the conversation.</p>
              <p className="text-xs">Tip: type @ to mention a teammate.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {grouped.map(([day, items]) => {
                const d = new Date(day);
                const label = isToday(d)
                  ? "Today"
                  : isYesterday(d)
                  ? "Yesterday"
                  : format(d, "MMM d, yyyy");
                return (
                  <div key={day} className="space-y-3">
                    <div className="flex items-center gap-3">
                      <Separator className="flex-1" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {label}
                      </span>
                      <Separator className="flex-1" />
                    </div>
                    {items.map((m) => {
                      const author = profileById.get(m.author_id);
                      const name = author?.name ?? "Unknown";
                      return (
                        <div key={m.id} className="flex gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="bg-accent/15 text-xs text-accent">
                              {initialsOf(name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2">
                              <span className="text-sm font-semibold">{name}</span>
                              <span className="text-[11px] text-muted-foreground">
                                {formatDistanceToNow(new Date(m.created_at), {
                                  addSuffix: true,
                                })}
                              </span>
                              {extractingId === m.id && (
                                <span className="flex items-center gap-1 text-[11px] text-accent">
                                  <Sparkles className="h-3 w-3 animate-pulse" />
                                  scanning…
                                </span>
                              )}
                            </div>
                            <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                              {renderBody(m.body)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="relative border-t p-3">
          {mentionOpen && filteredMembers.length > 0 && (
            <div className="absolute bottom-full left-3 right-3 mb-2 max-h-56 overflow-auto rounded-lg border bg-popover p-1 shadow-lg">
              {filteredMembers.map((m) => (
                <button
                  key={m.id}
                  onClick={() => insertMention(m)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className="bg-accent/15 text-[10px] text-accent">
                      {initialsOf(m.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="font-medium">{m.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{m.email}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <Textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => handleDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !mentionOpen) {
                  e.preventDefault();
                  send();
                }
                if (e.key === "Escape") setMentionOpen(false);
              }}
              placeholder={`Message ${activeThread ? "this task" : `#${group.name}`}… (@ to mention)`}
              rows={2}
              className="min-h-[44px] resize-none"
              disabled={sending}
            />
            <Button onClick={send} disabled={sending || !draft.trim()} size="icon">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Sparkles className="h-3 w-3" /> AI scans messages for actionable tasks.
          </p>
        </div>
      </Card>

      {/* Right rail: AI suggestions + members */}
      <div className="space-y-4 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent" />
              <h3 className="text-sm font-semibold">Task suggestions</h3>
              <Badge variant="secondary" className="ml-auto text-[10px]">
                {suggestions.length}
              </Badge>
            </div>
            {suggestions.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No pending suggestions. AI proposals from chat appear here.
              </p>
            ) : (
              <div className="space-y-2">
                {suggestions.map((s) => {
                  const assignee = s.suggested_assignee
                    ? profileById.get(s.suggested_assignee)?.name
                    : null;
                  return (
                    <div
                      key={s.id}
                      className="rounded-md border bg-muted/40 p-3 text-xs"
                    >
                      <p className="text-sm font-medium text-foreground">
                        {s.suggested_title}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                        {assignee && (
                          <span className="inline-flex items-center gap-1">
                            <AtSign className="h-3 w-3" />
                            {assignee}
                          </span>
                        )}
                        {s.suggested_deadline && (
                          <span>
                            due {format(new Date(s.suggested_deadline), "MMM d")}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex gap-1.5">
                        <Button
                          size="sm"
                          variant="default"
                          className="h-7 text-xs"
                          onClick={() => acceptSuggestion(s)}
                        >
                          <Check className="mr-1 h-3 w-3" /> Create task
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => dismissSuggestion(s)}
                        >
                          <X className="mr-1 h-3 w-3" /> Dismiss
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Members</h3>
              <Badge variant="secondary" className="ml-auto text-[10px]">
                {members.length}
              </Badge>
            </div>
            <div className="space-y-1">
              {members.map((m) => (
                <div key={m.id} className="flex items-center gap-2 text-sm">
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className="bg-accent/15 text-[10px] text-accent">
                      {initialsOf(m.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate">{m.name}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function renderBody(body: string) {
  // Highlight @mentions
  const parts = body.split(/(@[A-Za-z0-9_]+)/g);
  return parts.map((p, i) =>
    p.startsWith("@") ? (
      <span
        key={i}
        className="rounded bg-accent/15 px-1 font-medium text-accent"
      >
        {p}
      </span>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}
