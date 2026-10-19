// Mirrors listingAgent.js exactly, for advocate instead of agent. A unit that has no advocate of its
// own inherits its project's advocate (conveyancing is normally handled per-development); a standalone
// listing (no project) uses its own assignedAdvocate directly. The listing's own `assignedAdvocate` is
// never rewritten by this (forms edit that value); reads add two derived fields instead:
//   effectiveAdvocate  - the unit's own advocate, else its project's advocate, else null
//   advocateInherited  - true when effectiveAdvocate comes from the project
// This is purely informational, for prefilling a deal's advocate suggestion — the actual visibility
// scoping (middleware/advocateScope.js) and a deal's real advocate (SaleDeal.advocate, which can
// override this suggestion) are resolved independently, server-side, at query/creation time.

// Populate spec that loads a listing's project together with the project's advocate
export const PROJECT_WITH_ADVOCATE = {
  path: "project",
  select: "name projectNumber assignedAdvocate",
  populate: { path: "assignedAdvocate", select: "fullName advocateNumber firm phone" },
};

// `listing` is a lean object with `assignedAdvocate` and `project.assignedAdvocate` populated
export const withEffectiveAdvocate = (listing) => {
  if (!listing) return listing;
  const own = listing.assignedAdvocate || null;
  const fromProject = !own && listing.project?.assignedAdvocate ? listing.project.assignedAdvocate : null;
  return { ...listing, effectiveAdvocate: own || fromProject || null, advocateInherited: Boolean(fromProject) };
};
