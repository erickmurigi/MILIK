// Centralized property filtering utility
export const propertyBelongsToLandlord = (property, landlordId, landlordName) => {
  if (!landlordId && !landlordName) return false;
  const entries = Array.isArray(property?.landlords) ? property.landlords : [];
  const normalizedLandlordId = landlordId ? String(landlordId) : null;
  const normalizedLandlordName = landlordName ? String(landlordName).trim() : null;
  return entries.some((entry) => {
    if (entry?.landlordId && normalizedLandlordId && String(entry.landlordId) === normalizedLandlordId) return true;
    if (entry?.name && normalizedLandlordName && String(entry.name).trim() === normalizedLandlordName) return true;
    return false;
  });
};
