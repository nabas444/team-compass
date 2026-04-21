import { createFileRoute } from "@tanstack/react-router";
import { PageStub } from "@/components/PageStub";

export const Route = createFileRoute("/_app/analytics")({
  component: () => (
    <PageStub
      title="Analytics"
      description="Team performance charts, contribution trends, completion metrics."
    />
  ),
});
