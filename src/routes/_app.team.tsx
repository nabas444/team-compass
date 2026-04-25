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
  Trash2,
  UserCog,
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
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_app/team")({
  component: TeamPage,
});

type Role = "leader" | "co_leader" | "member";

interface Member {
  id: string;
  user_id: string;
  role: Role;
  custom_title: string | null;
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
interface Proposal {
  id: string;
  target_user_id: string;
  proposed_by: string;
  proposed_role: Role;
  proposed_title: string | null;
  status: "pending" | "accepted" | "declined" | "cancelled";
  decline_reason: string | null;
  created_at: string;
}

const PRESET_TITLES = [
  "Co-leader",
  "Secretary",
  "Treasurer",
  "Writer",
  "Editor",
  "Organizer",
  "Designer",
  "Developer",
  "Researcher",
  "Spokesperson",
  "Member",
];

function generateCode(len = 8) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

function roleLabel(r: Role) {
  return r === "co_leader" ? "Co-leader" : r === "leader" ? "Leader" : "Member";
}

function TeamPage() {
  const { user } = useAuth();
  const { currentGroup, isLeader, refresh } = useGroups();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignOpen, setAssignOpen] = useState<{ userId: string; name: string } | null>(null);
  const [transferTarget, setTransferTarget] = useState<Member | null>(null);
  const [proposeFor, setProposeFor] = useState<Member | null>(null);
  const [proposedRole, setProposedRole] = useState<Role>("member");
  const [proposedTitle, setProposedTitle] = useState<string>("Member");
  const [customTitle, setCustomTitle] = useState("");
  const [declineFor, setDeclineFor] = useState<Proposal | null>(null);
  const [declineReason, setDeclineReason] = useState("");

  const loadAll = useCallback(async () => {
    if (!currentGroup) return;
    setLoading(true);

    const [{ data: mRaw }, { data: inv }, { data: reqRaw }, { data: t }, { data: prop }] =
      await Promise.all([
        supabase
          .from("memberships")
          .select("id, user_id, role, custom_title, created_at")
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
        (supabase as any)
          .from("role_proposals")
          .select(
            "id, target_user_id, proposed_by, proposed_role, proposed_title, status, decline_reason, created_at",
          )
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
    setProposals((prop as any) ?? []);
    setLoading(false);
  }, [currentGroup]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const me = members.find((m) => m.user_id === user?.id) ?? null;
  const myPending = useMemo(
    () => proposals.filter((p) => p.target_user_id === user?.id && p.status === "pending"),
    [proposals, user?.id],
  );
  const sentProposals = useMemo(
    () => proposals.filter((p) => p.status !== "cancelled").slice(0, 25),
    [proposals],
  );

  // ---------- Invite codes (leader only) ----------
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
    if (error) return toast.error(error.message);
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

  // ---------- Join requests (leader only) ----------
  const approve = async (req: JoinRequest) => {
    if (!currentGroup || !user) return;
    const { error: insErr } = await supabase.from("memberships").insert({
      group_id: currentGroup.id,
      user_id: req.user_id,
      role: "member",
    });
    if (insErr && insErr.code !== "23505") return toast.error(insErr.message);
    const { error: updErr } = await supabase
      .from("group_join_requests")
      .update({ status: "approved", resolved_at: new Date().toISOString(), resolved_by: user.id })
      .eq("id", req.id);
    if (updErr) return toast.error(updErr.message);
    toast.success(`${req.profile?.name || req.profile?.email} added`);
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

  // ---------- Role proposals ----------
  const openProposeFor = (m: Member) => {
    setProposeFor(m);
    setProposedRole(m.role === "leader" ? "leader" : m.role);
    setProposedTitle(m.custom_title || roleLabel(m.role));
    setCustomTitle("");
  };

  const submitProposal = async () => {
    if (!proposeFor || !currentGroup) return;
    const finalTitle =
      proposedTitle === "__custom__" ? customTitle.trim() : proposedTitle.trim();
    if (proposedTitle === "__custom__" && !finalTitle) {
      toast.error("Enter a custom title");
      return;
    }
    const { error } = await (supabase as any).rpc("propose_role_change", {
      _group_id: currentGroup.id,
      _target_user_id: proposeFor.user_id,
      _proposed_role: proposedRole,
      _proposed_title: finalTitle || null,
    });
    if (error) return toast.error(error.message);
    if (proposeFor.user_id === user?.id) {
      toast.success("Your title was updated");
    } else {
      toast.success(`Proposal sent to ${proposeFor.profile?.name || "member"}`);
    }
    setProposeFor(null);
    loadAll();
    refresh();
  };

  const acceptProposal = async (p: Proposal) => {
    const { error } = await (supabase as any).rpc("respond_role_proposal", {
      _proposal_id: p.id,
      _accept: true,
    });
    if (error) return toast.error(error.message);
    toast.success("Role accepted");
    loadAll();
    refresh();
  };

  const submitDecline = async () => {
    if (!declineFor) return;
    if (declineReason.trim().length < 3) {
      toast.error("Please provide a justification (min 3 characters)");
      return;
    }
    const { error } = await (supabase as any).rpc("respond_role_proposal", {
      _proposal_id: declineFor.id,
      _accept: false,
      _reason: declineReason.trim(),
    });
    if (error) return toast.error(error.message);
    toast.info("Proposal declined");
    setDeclineFor(null);
    setDeclineReason("");
    loadAll();
  };

  // ---------- Leadership transfer (leader only) ----------
  const transferLeadership = async (target: Member) => {
    if (!isLeader || !me) return toast.error("Only the leader can transfer leadership");
    if (target.user_id === me.user_id) return;
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
      await supabase.from("memberships").update({ role: "leader" }).eq("id", me.id);
      return toast.error(e2.message);
    }
    toast.success(`Leadership transferred to ${target.profile?.name || "member"}`);
    setTransferTarget(null);
    loadAll();
    refresh();
  };

  const removeMember = async (member: Member) => {
    if (member.role === "leader") return toast.error("Transfer leadership first");
    if (!confirm(`Remove ${member.profile?.name || member.profile?.email}?`)) return;
    const { error } = await supabase.from("memberships").delete().eq("id", member.id);
    if (error) return toast.error(error.message);
    toast.success("Member removed");
    loadAll();
    refresh();
  };

  // ---------- Quick assign task (leader only) ----------
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
                ? `You are a co-leader${me.custom_title ? ` (${me.custom_title})` : ""}`
                : `You are a member${me?.custom_title ? ` (${me.custom_title})` : ""}`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadAll}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </div>

      {/* My pending offers — visible to ANY user that has one */}
      {myPending.length > 0 && (
        <Card className="border-accent">
          <CardHeader>
            <CardTitle className="text-base">Role offers from your leader</CardTitle>
            <CardDescription>
              Accept to take on the new role. Declining requires a short justification.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {myPending.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center gap-3 rounded-md border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {p.proposed_title || roleLabel(p.proposed_role)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Proposed role: {roleLabel(p.proposed_role)} ·{" "}
                    {format(new Date(p.created_at), "MMM d, p")}
                  </p>
                </div>
                <Button size="sm" onClick={() => acceptProposal(p)}>
                  <Check className="mr-1 h-4 w-4" /> Accept
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDeclineFor(p);
                    setDeclineReason("");
                  }}
                >
                  <X className="mr-1 h-4 w-4" /> Decline
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members">Members</TabsTrigger>
          {isLeader && (
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
              <TabsTrigger value="proposals">Role proposals</TabsTrigger>
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
                            {m.profile?.email} · joined{" "}
                            {format(new Date(m.created_at), "MMM d, yyyy")}
                          </p>
                        </div>
                        {m.custom_title && (
                          <Badge variant="outline" className="hidden sm:inline-flex">
                            {m.custom_title}
                          </Badge>
                        )}
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
                          {roleLabel(m.role)}
                        </Badge>
                        {isLeader && (
                          <div className="flex items-center gap-1">
                            {m.user_id !== user?.id && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setAssignOpen({ userId: m.user_id, name })}
                              >
                                Assign task
                              </Button>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              title={
                                m.user_id === user?.id
                                  ? "Edit your title"
                                  : "Propose role / title"
                              }
                              onClick={() => openProposeFor(m)}
                            >
                              <UserCog className="h-4 w-4" />
                            </Button>
                            {m.user_id !== user?.id && m.role !== "leader" && (
                              <Button
                                size="icon"
                                variant="ghost"
                                title="Transfer leadership"
                                onClick={() => setTransferTarget(m)}
                              >
                                <Crown className="h-4 w-4" />
                              </Button>
                            )}
                            {m.user_id !== user?.id && m.role !== "leader" && (
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
          {!isLeader && (
            <p className="mt-3 text-xs text-muted-foreground">
              Only the group leader can manage roles, invites, and join requests.
            </p>
          )}
        </TabsContent>

        {/* Requests — leader only */}
        {isLeader && (
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
                              {r.profile?.email} ·{" "}
                              {format(new Date(r.created_at), "MMM d, yyyy p")}
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

        {/* Invites — leader only */}
        {isLeader && (
          <TabsContent value="invites" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="text-base">Invite codes</CardTitle>
                  <CardDescription>
                    Share a code so people can join. Codes expire after 14 days.
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
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => revokeInvite(inv.id)}
                            >
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

        {/* Sent role proposals — leader only */}
        {isLeader && (
          <TabsContent value="proposals" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Role proposals you've sent</CardTitle>
                <CardDescription>
                  Members must accept a proposal before their role/title changes.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {sentProposals.length === 0 ? (
                  <p className="px-6 py-10 text-center text-sm text-muted-foreground">
                    No proposals yet.
                  </p>
                ) : (
                  <ul className="divide-y">
                    {sentProposals.map((p) => {
                      const target = members.find((m) => m.user_id === p.target_user_id);
                      const name =
                        target?.profile?.name || target?.profile?.email || "Unknown";
                      return (
                        <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {name} → {p.proposed_title || roleLabel(p.proposed_role)}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {format(new Date(p.created_at), "MMM d, p")} · role:{" "}
                              {roleLabel(p.proposed_role)}
                            </p>
                            {p.status === "declined" && p.decline_reason && (
                              <p className="mt-1 text-xs text-destructive">
                                Declined: {p.decline_reason}
                              </p>
                            )}
                          </div>
                          <Badge
                            variant={
                              p.status === "accepted"
                                ? "default"
                                : p.status === "pending"
                                  ? "outline"
                                  : "secondary"
                            }
                          >
                            {p.status}
                          </Badge>
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

      {/* Propose role / title */}
      <Dialog open={!!proposeFor} onOpenChange={(o) => !o && setProposeFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {proposeFor?.user_id === user?.id
                ? "Edit your title"
                : `Propose a role for ${proposeFor?.profile?.name || "member"}`}
            </DialogTitle>
            <DialogDescription>
              {proposeFor?.user_id === user?.id
                ? "As the leader, your title updates immediately. Your role stays as Leader."
                : "The member will receive a notification and must accept the role before it takes effect."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {proposeFor?.user_id !== user?.id && (
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={proposedRole} onValueChange={(v) => setProposedRole(v as Role)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="co_leader">Co-leader</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Select value={proposedTitle} onValueChange={setProposedTitle}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRESET_TITLES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                  <SelectItem value="__custom__">Custom…</SelectItem>
                </SelectContent>
              </Select>
              {proposedTitle === "__custom__" && (
                <Input
                  placeholder="e.g. Event Coordinator"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  maxLength={40}
                />
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setProposeFor(null)}>
              Cancel
            </Button>
            <Button onClick={submitProposal}>
              {proposeFor?.user_id === user?.id ? "Save" : "Send proposal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Decline proposal — must justify */}
      <Dialog open={!!declineFor} onOpenChange={(o) => !o && setDeclineFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decline this role offer</DialogTitle>
            <DialogDescription>
              Please tell your leader why you're declining. Your justification will be
              shared with them.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={declineReason}
            onChange={(e) => setDeclineReason(e.target.value)}
            placeholder="e.g. I don't have the bandwidth for this role right now."
            rows={4}
            maxLength={500}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeclineFor(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={submitDecline}>
              Decline with reason
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
              {(transferTarget?.profile?.name || transferTarget?.profile?.email) ??
                "This member"}
              {" will become the leader of "}
              {currentGroup.name}
              {". You will be demoted to co-leader. A group can only have one leader."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTransferTarget(null)}>
              Cancel
            </Button>
            <Button onClick={() => transferTarget && transferLeadership(transferTarget)}>
              <Crown className="mr-2 h-4 w-4" /> Transfer leadership
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
