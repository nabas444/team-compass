import { createFileRoute } from "@tanstack/react-router";
import { PageStub } from "@/components/PageStub";

export const Route = createFileRoute("/_app/chat")({
  component: () => (
    <PageStub
      title="Chat"
      description="Group + per-task threads, mentions, and message extraction."
    />
  ),
});
