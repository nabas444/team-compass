import { useState } from "react";
import { Check, ChevronsUpDown, Plus, LogIn, Users2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useGroups } from "@/lib/groups";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function GroupSwitcher() {
  const { user } = useAuth();
  const { groups, currentGroup, switchGroup, createGroup, refresh } = useGroups();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const g = await createGroup(name.trim(), desc.trim() || undefined);
    setBusy(false);
    if (g) {
      toast.success(`Created “${g.name}”`);
      setName("");
      setDesc("");
      setCreateOpen(false);
    } else {
      toast.error("Could not create group");
    }
  };

  const handleJoin = async () => {
    if (!user) return;
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setBusy(true);
    const { data, error } = await (supabase as any).rpc("redeem_invite_code", {
      _code: trimmed,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message || "Could not redeem invite code");
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.group_id) {
      toast.error("Invalid invite code");
      return;
    }
    if (row.already_member) {
      toast.info(`You're already in "${row.group_name}"`);
    } else {
      toast.success(`Joined "${row.group_name}"`);
    }
    setJoinOpen(false);
    setCode("");
    await refresh();
    switchGroup(row.group_id);
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between gap-2 px-2 py-6 hover:bg-sidebar-accent/60"
          >
            <div className="flex min-w-0 items-center gap-2">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                <Users2 className="h-4 w-4" />
              </div>
              <div className="min-w-0 text-left">
                <p className="truncate text-sm font-medium">
                  {currentGroup?.name ?? "No group"}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {currentGroup?.role === "leader" ? "Leader" : "Member"}
                </p>
              </div>
            </div>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-1" align="start">
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            Your groups
          </div>
          <div className="max-h-64 space-y-0.5 overflow-y-auto">
            {groups.length === 0 && (
              <p className="px-2 py-3 text-sm text-muted-foreground">No groups yet.</p>
            )}
            {groups.map((g) => {
              const active = g.id === currentGroup?.id;
              return (
                <button
                  key={g.id}
                  onClick={() => {
                    switchGroup(g.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent",
                    active && "bg-accent",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Check
                      className={cn("h-4 w-4 shrink-0", active ? "opacity-100" : "opacity-0")}
                    />
                    <span className="truncate">{g.name}</span>
                  </div>
                  <Badge variant={g.role === "leader" ? "default" : "secondary"} className="text-[10px]">
                    {g.role}
                  </Badge>
                </button>
              );
            })}
          </div>
          <div className="my-1 h-px bg-border" />
          <button
            onClick={() => {
              setOpen(false);
              setCreateOpen(true);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent"
          >
            <Plus className="h-4 w-4" /> Create new group
          </button>
          <button
            onClick={() => {
              setOpen(false);
              setJoinOpen(true);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent"
          >
            <LogIn className="h-4 w-4" /> Join with invite code
          </button>
        </PopoverContent>
      </Popover>

      {/* Create group */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create new group</DialogTitle>
            <DialogDescription>
              You'll be the leader. Invite teammates with a code afterwards.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="g-name">Name</Label>
              <Input
                id="g-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Marketing squad"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-desc">Description</Label>
              <Textarea
                id="g-desc"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="What this group works on…"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={busy || !name.trim()}>
              Create group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Join group */}
      <Dialog open={joinOpen} onOpenChange={setJoinOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Join a group</DialogTitle>
            <DialogDescription>
              Enter the invite code shared by a group leader. You'll be added to that group instantly.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="invite-code">Invite code</Label>
            <Input
              id="invite-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABCD1234"
              className="font-mono uppercase tracking-widest"
              maxLength={12}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setJoinOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleJoin} disabled={busy || !code.trim()}>
              Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
