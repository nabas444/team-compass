import { createFileRoute } from "@tanstack/react-router";
import { PageStub } from "@/components/PageStub";

export const Route = createFileRoute("/_app/team")({
  component: () => (
    <PageStub
      title="Team"
      description="Members, contribution scores, and the leaderboard."
    />
  ),
});
