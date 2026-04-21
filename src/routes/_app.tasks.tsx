import { createFileRoute } from "@tanstack/react-router";
import { PageStub } from "@/components/PageStub";

export const Route = createFileRoute("/_app/tasks")({
  component: () => (
    <PageStub
      title="Tasks"
      description="List + Kanban view, task detail, subtasks and comments."
    />
  ),
});
