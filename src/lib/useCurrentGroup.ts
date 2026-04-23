// Backwards-compatible shim around the new GroupsProvider context.
import { useGroups } from "@/lib/groups";

export interface CurrentGroup {
  id: string;
  name: string;
  description: string | null;
}

export function useCurrentGroup() {
  const { currentGroup, loading, error } = useGroups();
  const group: CurrentGroup | null = currentGroup
    ? {
        id: currentGroup.id,
        name: currentGroup.name,
        description: currentGroup.description,
      }
    : null;
  return { group, loading, error };
}
