// Mirrors utils/saleAgent.js exactly, for advocate instead of agent. A unit with no advocate of its own
// inherits its project's advocate. The server returns `effectiveAdvocate` (own advocate, else the
// project's) and `advocateInherited` on every listing; `assignedAdvocate` stays the unit's OWN advocate
// (what forms edit).

export const listingAdvocateName = (row) => row?.effectiveAdvocate?.fullName ?? row?.assignedAdvocate?.fullName ?? null;

// Plain-text form for panels, print sheets and tooltips: "Jane" or "Jane (from project)"
export const listingAdvocateText = (row, projectWord = "project") => {
  const name = listingAdvocateName(row);
  if (!name) return null;
  return row?.advocateInherited ? `${name} (from ${projectWord})` : name;
};
