import { createFileRoute } from "@tanstack/react-router";
import { PageStub } from "@/components/PageStub";

export const Route = createFileRoute("/_app/insights")({
  component: () => (
    <PageStub
      title="Insights"
      description="Inactive members, tasks at risk, and AI-powered alerts."
    />
  ),
});
