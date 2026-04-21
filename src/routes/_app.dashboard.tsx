import { createFileRoute } from "@tanstack/react-router";
import { PageStub } from "@/components/PageStub";

export const Route = createFileRoute("/_app/dashboard")({
  component: () => (
    <PageStub
      title="Dashboard"
      description="Summary cards, charts, and quick insights for your team."
    />
  ),
});
