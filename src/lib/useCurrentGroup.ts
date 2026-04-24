// Backwards-compatible shim around the new GroupsProvider context.
import { useMemo } from "react";
import { useGroups } from "@/lib/groups";

export interface CurrentGroup {
  id: string;
  name: string;
  description: string | null;
}

export function useCurrentGroup() {
  const { currentGroup, loading, error } = useGroups();
  const group: CurrentGroup | null = useMemo(
    () =>
      currentGroup
        ? {
            id: currentGroup.id,
            name: currentGroup.name,
            description: currentGroup.description,
          }
        : null,
    [currentGroup?.id, currentGroup?.name, currentGroup?.description],
  );
  return { group, loading, error };
}
