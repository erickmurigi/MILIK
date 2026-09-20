// A unit that has no agent of its own inherits its project's agent. The listing's own `assignedAgent` is never
// rewritten (forms edit that value); reads add two derived fields instead:
//   effectiveAgent  - the unit's own agent, else its project's agent, else null
//   agentInherited  - true when effectiveAgent comes from the project
// The agent is informational: offers, deals and commissions take their agent from the offer / deal itself.

// Populate spec that loads a listing's project together with the project's agent
export const PROJECT_WITH_AGENT = {
  path: "project",
  select: "name projectNumber assignedAgent",
  populate: { path: "assignedAgent", select: "fullName agentNumber phone" },
};

// `listing` is a lean object with `assignedAgent` and `project.assignedAgent` populated
export const withEffectiveAgent = (listing) => {
  if (!listing) return listing;
  const own = listing.assignedAgent || null;
  const fromProject = !own && listing.project?.assignedAgent ? listing.project.assignedAgent : null;
  return { ...listing, effectiveAgent: own || fromProject || null, agentInherited: Boolean(fromProject) };
};
