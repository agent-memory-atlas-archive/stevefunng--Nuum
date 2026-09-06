import type { SidebarOrganization } from "@nuum/protocol";

export const EMPTY_SIDEBAR: SidebarOrganization = { pinnedAgentIds: [], sections: [] };
export const UNASSIGNED_SECTION = "__unassigned__";
export const PINNED_SECTION = "__pinned__";

export function toggleSidebarPin(state: SidebarOrganization, id: string): SidebarOrganization {
  return { ...state, pinnedAgentIds: state.pinnedAgentIds.includes(id) ? state.pinnedAgentIds.filter((item) => item !== id) : [...state.pinnedAgentIds, id] };
}

export function assignSidebarAgent(state: SidebarOrganization, id: string, sectionId: string): SidebarOrganization {
  if (sectionId === PINNED_SECTION) return state.pinnedAgentIds.includes(id) ? state : toggleSidebarPin(state, id);
  if (sectionId !== UNASSIGNED_SECTION && !state.sections.some((section) => section.id === sectionId)) return state;
  return {
    pinnedAgentIds: state.pinnedAgentIds.filter((item) => item !== id),
    sections: state.sections.map((section) => ({ ...section, agentIds: [...section.agentIds.filter((item) => item !== id), ...(section.id === sectionId ? [id] : [])] }))
  };
}

export function removeSidebarSection(state: SidebarOrganization, id: string): SidebarOrganization {
  return { ...state, sections: state.sections.filter((section) => section.id !== id) };
}

export function reorderSidebarPin(state: SidebarOrganization, id: string, beforeId: string): SidebarOrganization {
  if (id === beforeId) return state;
  const remaining = state.pinnedAgentIds.filter((item) => item !== id);
  const index = remaining.indexOf(beforeId);
  remaining.splice(index < 0 ? remaining.length : index, 0, id);
  return { ...state, pinnedAgentIds: remaining };
}

export function projectSidebarAgents<T extends { profile: { id: string } }>(agents: readonly T[], state: SidebarOrganization) {
  const byId = new Map(agents.map((agent) => [agent.profile.id, agent]));
  const pinned = state.pinnedAgentIds.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []);
  const pinnedIds = new Set(state.pinnedAgentIds);
  const groupedIds = new Set(state.sections.flatMap((section) => section.agentIds));
  return {
    pinned,
    sections: state.sections.map((section) => ({ ...section, agents: agents.filter((agent) => !pinnedIds.has(agent.profile.id) && section.agentIds.includes(agent.profile.id)) })),
    unassigned: agents.filter((agent) => !pinnedIds.has(agent.profile.id) && !groupedIds.has(agent.profile.id))
  };
}
