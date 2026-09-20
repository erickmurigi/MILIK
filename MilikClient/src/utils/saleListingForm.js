import { todayISO } from "../services/propertySaleApi";

export const blankListingForm = (propertyType = "plot") => ({
  title: "", propertyType, description: "", size: "", sizeUnit: "sqm",
  location: "", town: "", county: "", country: "Kenya", askingPrice: "",
  negotiable: true, titleDeedAvailable: false, titleDeedNumber: "",
  assignedAgent: "", listedDate: todayISO(), amenities: "", notes: "",
  unitNumber: "", block: "", attributes: {},
});

// Form values for editing an existing listing or unit
export const listingFormFromRow = (row) => ({
  title: row.title || "", propertyType: row.propertyType || "plot",
  description: row.description || "", size: row.size || "",
  sizeUnit: row.sizeUnit || "sqm", location: row.location || "",
  town: row.town || "", county: row.county || "", country: row.country || "Kenya",
  askingPrice: row.askingPrice || "", negotiable: row.negotiable !== false,
  titleDeedAvailable: row.titleDeedAvailable || false,
  titleDeedNumber: row.titleDeedNumber || "",
  assignedAgent: row.assignedAgent?._id || row.assignedAgent || "",
  listedDate: row.listedDate ? new Date(row.listedDate).toISOString().split("T")[0] : todayISO(),
  amenities: Array.isArray(row.amenities) ? row.amenities.join(", ") : "",
  notes: row.notes || "",
  unitNumber: row.unitNumber || "", block: row.block || "", attributes: row.attributes || {},
});

// The property type's definition (extra fields + hidden standard fields) for a listing, from useSaleFormOptions().propertyTypeDefs
export const typeDefOf = (defs, row) => defs?.[String(row?.propertyType || "").toLowerCase()] ?? { fields: [], hiddenFields: [] };

// [label, text] rows for the custom fields of a listing, for detail panels and print sheets (blank values skipped)
export const customFieldRows = (row, fields = []) =>
  fields
    .map((f) => {
      const v = row?.attributes?.[f.key];
      if (v === undefined || v === null || v === "") return [f.label, null];
      if (f.kind === "boolean") return [f.label, v ? "Yes" : "No"];
      return [f.label, String(v)];
    })
    .filter(([, v]) => v);

// Create/Edit modal — owns the form, staged photos and its own save/upload state (and the post-create "Done" mode),
// so typing here never re-renders the page or its table.
