import { createFileRoute } from "@tanstack/react-router";
import { PageStub } from "@/components/PageStub";

export const Route = createFileRoute("/_app/activity")({
  component: () => (
    <PageStub
      title="Activity"
      description="Real-time feed of task updates, comments, and messages."
    />
  ),
});
