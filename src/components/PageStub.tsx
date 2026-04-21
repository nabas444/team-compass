import type { ReactNode } from "react";

export function PageStub({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="rounded-2xl border border-dashed bg-card p-12 text-center shadow-soft">
        <p className="text-sm font-medium text-muted-foreground">Coming in the next step.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          The backend for this page is ready — UI lands in the next phase.
        </p>
        {children}
      </div>
    </div>
  );
}
