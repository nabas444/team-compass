import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  Check,
  Copy,
  Crown,
  Plus,
  RefreshCw,
  Shield,
  ShieldOff,
  Trash2,
  UserMinus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useGroups } from "@/lib/groups";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_app/team")({
  component: TeamPage,
});

type Role = "leader" | "co_leader" | "member";

interface Member {
  id: string;
  user_id: string;
  role: Role;
  created_at: string;
  profile: { name: string | null; email: string } | null;
}
interface Invite {
  id: string;
  code: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}
interface JoinRequest {
  id: string;
  user_id: string;
  status: string;
  created_at: string;
  profile: { name: string | null; email: string } | null;
}
interface TaskRow {
  id: string;
  title: string;
  status: string;
  assigned_to: string | null;
}

function generateCode(len = 8) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

function TeamPage() {
  const { user } = useAuth();
  const { currentGroup, isLeader, canManage, refresh } = useGroups();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignOpen, setAssignOpen] = useState<{ userId: string; name: string } | null>(null);
  const [transferTarget, setTransferTarget] = useState<Member | null>(null);

  const loadAll = useCallback(async () => {
    if (!currentGroup) return;
    setLoading(true);

    const [{ data: mRaw }, { data: inv }, { data: reqRaw }, { data: t }] = await Promise.all([
      supabase
        .from("memberships")
        .select("id, user_id, role, created_at")
        .eq("group_id", currentGroup.id),
      supabase
        .from("group_invites")
        .select("id, code, created_at, expires_at, revoked_at")
        .eq("group_id", currentGroup.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("group_join_requests")
        .select("id, user_id, status, created_at")
        .eq("group_id", currentGroup.id)
        .eq("status", "pending"),
      supabase
        .from("tasks")
        .select("id, title, status, assigned_to")
        .eq("group_id", currentGroup.id)
        .order("created_at", { ascending: false }),
    ]);

    const userIds = Array.from(
      new Set([
        ...((mRaw ?? []).map((r: any) => r.user_id) as string[]),
        ...((reqRaw ?? []).map((r: any) => r.user_id) as string[]),
      ]),
    );
    let profileMap: Record<string, { name: string | null; email: string }> = {};
    if (userIds.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, name, email")
        .in("id", userIds);
      profileMap = Object.fromEntries(
        (profs ?? []).map((p: any) => [p.id, { name: p.name, email: p.email }]),
      );
    }

    setMembers(
      ((mRaw as any) ?? []).map((m: any) => ({
        ...m,
        profile: profileMap[m.user_id] ?? null,
      })),
    );
    setInvites((inv as any) ?? []);
    setRequests(
      ((reqRaw as any) ?? []).map((r: any) => ({
        ...r,
        profile: profileMap[r.user_id] ?? null,
      })),
    );
    setTasks((t as any) ?? []);
    setLoading(false);
  }, [currentGroup]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const leaderCount = useMemo(() => members.filter((m) => m.role === "leader").length, [members]);

  // ---------- Invite codes ----------
  const createInvite = async () => {
    if (!currentGroup || !user) return;
    const code = generateCode();
    const expires = new Date(Date.now() + 14 * 86400 * 1000).toISOString();
    const { error } = await supabase.from("group_invites").insert({
      group_id: currentGroup.id,
      code,
      created_by: user.id,
      expires_at: expires,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Invite code created");
    loadAll();
  };
  const revokeInvite = async (id: string) => {
    const { error } = await supabase
      .from("group_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Invite revoked");
    loadAll();
  };
  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success("Code copied");
  };

  // ---------- Join requests ----------
  const approve = async (req: JoinRequest) => {
    if (!currentGroup || !user) return;
    const { error: insErr } = await supabase.from("memberships").insert({
      group_id: currentGroup.id,
      user_id: req.user_id,
      role: "member",
    });
    if (insErr && insErr.code !== "23505") {
      toast.error(insErr.message);
      return;
    }
    const { error: updErr } = await supabase
      .from("group_join_requests")
      .update({ status: "approved", resolved_at: new Date().toISOString(), resolved_by: user.id })
      .eq("id", req.id);
    if (updErr) return toast.error(updErr.message);
    toast.success(`${req.profile?.name || req.profile?.email} added to the group`);
    loadAll();
  };
  const decline = async (req: JoinRequest) => {
    if (!user) return;
    const { error } = await supabase
      .from("group_join_requests")
      .update({ status: "declined", resolved_at: new Date().toISOString(), resolved_by: user.id })
      .eq("id", req.id);
    if (error) return toast.error(error.message);
    toast.info("Request declined");
    loadAll();
  };

  // ---------- Member actions ----------
  const me = members.find((m) => m.user_id === user?.id) ?? null;

  // Promote a member to co-leader (any leader/co-leader can do)
  const promoteToCoLeader = async (member: Member) => {
    const { error } = await supabase
      .from("memberships")
      .update({ role: "co_leader" })
      .eq("id", member.id);
    if (error) return toast.error(error.message);
    toast.success(`${member.profile?.name || "Member"} is now a co-leader`);
    loadAll();
    refresh();
  };

  // Demote a co-leader back to member (leader/co-leader can do; cannot target the leader)
  const demoteToMember = async (member: Member) => {
    if (member.role === "leader") {
      toast.error("Transfer leadership first");
      return;
    }
    const { error } = await supabase
      .from("memberships")
      .update({ role: "member" })
      .eq("id", member.id);
    if (error) return toast.error(error.message);
    toast.success(`Role updated`);
    loadAll();
    refresh();
  };

  // Transfer leadership to another member: current leader becomes co-leader, target becomes leader.
  // Only the current leader may do this.
  const transferLeadership = async (target: Member) => {
    if (!isLeader || !me) return toast.error("Only the leader can transfer leadership");
    if (target.user_id === me.user_id) return;
    // Step down current leader to co_leader first to avoid two leaders momentarily.
    const { error: e1 } = await supabase
      .from("memberships")
      .update({ role: "co_leader" })
      .eq("id", me.id);
    if (e1) return toast.error(e1.message);
    const { error: e2 } = await supabase
      .from("memberships")
      .update({ role: "leader" })
      .eq("id", target.id);
    if (e2) {
      // Roll back
      await supabase.from("memberships").update({ role: "leader" }).eq("id", me.id);
      return toast.error(e2.message);
    }
    toast.success(`Leadership transferred to ${target.profile?.name || "member"}`);
    setTransferTarget(null);
    loadAll();
    refresh();
  };

  const removeMember = async (member: Member) => {
    if (member.role === "leader") {
      toast.error("Transfer leadership before removing the leader");
      return;
    }
    if (!confirm(`Remove ${member.profile?.name || member.profile?.email} from the group?`)) return;
    const { error } = await supabase.from("memberships").delete().eq("id", member.id);
    if (error) return toast.error(error.message);
    toast.success("Member removed");
    loadAll();
    refresh();
  };

  // ---------- Quick assign task ----------
  const assignTask = async (taskId: string, userId: string) => {
    const { error } = await supabase.from("tasks").update({ assigned_to: userId }).eq("id", taskId);
    if (error) return toast.error(error.message);
    toast.success("Task assigned");
    loadAll();
    setAssignOpen(null);
  };

  if (!currentGroup) {
    return (
      <div className="grid place-items-center py-16 text-muted-foreground">
        Select a group from the switcher to get started.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{currentGroup.name}</h2>
          <p className="text-sm text-muted-foreground">
            {members.length} member{members.length === 1 ? "" : "s"} ·{" "}
            {isLeader
              ? "You are the leader of this group"
              : me?.role === "co_leader"
                ? "You are a co-leader"
                : "You are a member"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadAll}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </div>

      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members">Members</TabsTrigger>
          {canManage && (
            <>
              <TabsTrigger value="requests">
                Requests
                {requests.length > 0 && (
                  <Badge className="ml-2" variant="destructive">
                    {requests.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="invites">Invites</TabsTrigger>
            </>
          )}
        </TabsList>

        {/* Members */}
        <TabsContent value="members" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {loading ? (
                <div className="space-y-2 p-4">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : (
                <ul className="divide-y">
                  {members.map((m) => {
                    const name = m.profile?.name || m.profile?.email || "Unknown";
                    const initials =
                      name
                        .split(/\s+/)
                        .map((s) => s[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase() || "?";
                    return (
                      <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                        <div className="grid h-9 w-9 place-items-center rounded-full bg-accent/20 text-accent text-sm font-semibold">
                          {initials}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {m.profile?.email} · joined {format(new Date(m.created_at), "MMM d, yyyy")}
                          </p>
                        </div>
                        <Badge
                          variant={
                            m.role === "leader"
                              ? "default"
                              : m.role === "co_leader"
                                ? "outline"
                                : "secondary"
                          }
                        >
                          {m.role === "leader" && <Crown className="mr-1 h-3 w-3" />}
                          {m.role === "co_leader" && <Shield className="mr-1 h-3 w-3" />}
                          {m.role === "co_leader" ? "co-leader" : m.role}
                        </Badge>
                        {canManage && m.user_id !== user?.id && (
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setAssignOpen({ userId: m.user_id, name })
                              }
                            >
                              Assign task
                            </Button>
                            {m.role === "member" && (
                              <Button
                                size="icon"
                                variant="ghost"
                                title="Promote to co-leader"
                                onClick={() => promoteToCoLeader(m)}
                              >
                                <Shield className="h-4 w-4" />
                              </Button>
                            )}
                            {m.role === "co_leader" && (
                              <Button
                                size="icon"
                                variant="ghost"
                                title="Demote to member"
                                onClick={() => demoteToMember(m)}
                              >
                                <ShieldOff className="h-4 w-4" />
                              </Button>
                            )}
                            {isLeader && m.role !== "leader" && (
                              <Button
                                size="icon"
                                variant="ghost"
                                title="Transfer leadership"
                                onClick={() => setTransferTarget(m)}
                              >
                                <Crown className="h-4 w-4" />
                              </Button>
                            )}
                            {m.role !== "leader" && (
                              <Button
                                size="icon"
                                variant="ghost"
                                title="Remove member"
                                onClick={() => removeMember(m)}
                              >
                                <UserMinus className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Requests */}
        {canManage && (
          <TabsContent value="requests" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Pending join requests</CardTitle>
                <CardDescription>
                  Approve to add the user as a member, decline to reject.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <Skeleton className="m-4 h-12" />
                ) : requests.length === 0 ? (
                  <p className="px-6 py-10 text-center text-sm text-muted-foreground">
                    No pending requests.
                  </p>
                ) : (
                  <ul className="divide-y">
                    {requests.map((r) => {
                      const name = r.profile?.name || r.profile?.email || "Unknown";
                      return (
                        <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{name}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {r.profile?.email} · {format(new Date(r.created_at), "MMM d, yyyy p")}
                            </p>
                          </div>
                          <Button size="sm" onClick={() => approve(r)}>
                            <Check className="mr-1 h-4 w-4" /> Approve
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => decline(r)}>
                            <X className="mr-1 h-4 w-4" /> Decline
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Invites */}
        {canManage && (
          <TabsContent value="invites" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="text-base">Invite codes</CardTitle>
                  <CardDescription>
                    Share a code so people can request to join. Codes expire after 14 days.
                  </CardDescription>
                </div>
                <Button onClick={createInvite}>
                  <Plus className="mr-2 h-4 w-4" /> New code
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {invites.length === 0 ? (
                  <p className="px-6 py-10 text-center text-sm text-muted-foreground">
                    No invite codes yet.
                  </p>
                ) : (
                  <ul className="divide-y">
                    {invites.map((inv) => {
                      const expired =
                        !!inv.revoked_at ||
                        (inv.expires_at && new Date(inv.expires_at) < new Date());
                      return (
                        <li key={inv.id} className="flex items-center gap-3 px-4 py-3">
                          <code className="rounded-md bg-muted px-3 py-1.5 font-mono text-sm tracking-wider">
                            {inv.code}
                          </code>
                          <div className="min-w-0 flex-1 text-xs text-muted-foreground">
                            Created {format(new Date(inv.created_at), "MMM d")} ·{" "}
                            {inv.revoked_at
                              ? "Revoked"
                              : inv.expires_at
                                ? `Expires ${format(new Date(inv.expires_at), "MMM d")}`
                                : "No expiry"}
                          </div>
                          {expired ? (
                            <Badge variant="secondary">Inactive</Badge>
                          ) : (
                            <Badge variant="outline">Active</Badge>
                          )}
                          <Button size="icon" variant="ghost" onClick={() => copyCode(inv.code)}>
                            <Copy className="h-4 w-4" />
                          </Button>
                          {!expired && (
                            <Button size="icon" variant="ghost" onClick={() => revokeInvite(inv.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* Quick assign */}
      <Dialog open={!!assignOpen} onOpenChange={(o) => !o && setAssignOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign a task to {assignOpen?.name}</DialogTitle>
            <DialogDescription>
              Pick an existing task to reassign to this member.
            </DialogDescription>
          </DialogHeader>
          {tasks.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No tasks in this group yet.
            </p>
          ) : (
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {tasks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => assignOpen && assignTask(t.id, assignOpen.userId)}
                  className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  <span className="truncate">{t.title}</span>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {t.status.replace("_", " ")}
                  </Badge>
                </button>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAssignOpen(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transfer leadership confirm */}
      <Dialog open={!!transferTarget} onOpenChange={(o) => !o && setTransferTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transfer leadership?</DialogTitle>
            <DialogDescription>
              {transferTarget?.profile?.name || transferTarget?.profile?.email} will become the
              leader of <span className="font-medium">{currentGroup.name}</span>. You will be
              demoted to co-leader. A group can only have one leader at a time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTransferTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => transferTarget && transferLeadership(transferTarget)}
            >
              <Crown className="mr-2 h-4 w-4" /> Transfer leadership
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
