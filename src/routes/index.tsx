import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { ArrowRight, BarChart3, MessageSquare, Sparkles, Users } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  const { user, loading } = useAuth();
  if (!loading && user) return <Navigate to="/dashboard" />;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground font-bold">
            G
          </div>
          <span className="text-lg font-semibold tracking-tight">GroupFlow</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" asChild>
            <Link to="/login">Sign in</Link>
          </Button>
          <Button asChild>
            <Link to="/signup">Get started</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 pt-12 pb-24 sm:pt-20">
        <div className="max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            AI-assisted team intelligence
          </span>
          <h1 className="mt-5 text-5xl font-semibold tracking-tight sm:text-6xl">
            The workspace that <span className="text-accent">understands</span> your team.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
            Tasks, contributions, conversations and team health — in one clean dashboard.
            GroupFlow surfaces who's leading, who's blocked, and where the team should focus next.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button size="lg" asChild>
              <Link to="/signup">
                Start free <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link to="/login">Sign in</Link>
            </Button>
          </div>
        </div>

        <div className="mt-20 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: BarChart3, title: "Team health score", body: "Activity, deadlines, communication." },
            { icon: Users, title: "Best leader", body: "Ranked by consistency and contribution." },
            { icon: MessageSquare, title: "Smart chat", body: "Group + per-task threads." },
            { icon: Sparkles, title: "Insights", body: "Detect inactive members and risks." },
          ].map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="rounded-xl border bg-card p-5 shadow-soft transition hover:shadow-elevated"
            >
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent/15 text-accent">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
