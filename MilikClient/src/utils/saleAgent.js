// A unit with no agent of its own inherits its project's agent. The server returns `effectiveAgent` (own agent, else
// the project's) and `agentInherited` on every listing; `assignedAgent` stays the unit's OWN agent (what forms edit).

export const listingAgentName = (row) => row?.effectiveAgent?.fullName ?? row?.assignedAgent?.fullName ?? null;

// Plain-text form for panels, print sheets and tooltips: "Jane" or "Jane (from project)"
export const listingAgentText = (row, projectWord = "project") => {
  const name = listingAgentName(row);
  if (!name) return null;
  return row?.agentInherited ? `${name} (from ${projectWord})` : name;
};
