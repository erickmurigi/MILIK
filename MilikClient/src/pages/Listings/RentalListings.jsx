import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

const API_BASE = String(import.meta.env?.VITE_API_URL || "/api").replace(/\/$/, "");

const UNIT_TYPE_LABELS = {
  studio: "Studio",
  "1bed": "1 Bedroom",
  "2bed": "2 Bedrooms",
  "3bed": "3 Bedrooms",
  "4bed": "4 Bedrooms",
  commercial: "Commercial",
};

const FURNISHED_CONFIG = {
  furnished:       { label: "Furnished",       cls: "bg-emerald-100 text-emerald-700" },
  "semi-furnished":{ label: "Semi-Furnished",  cls: "bg-amber-100 text-amber-700" },
  unfurnished:     { label: "Unfurnished",     cls: "bg-slate-100 text-slate-600" },
};

const fmtKES = (n) => `Ksh ${Number(n || 0).toLocaleString("en-KE")}`;

const availableLabel = (vacantSince) => {
  if (!vacantSince) return { text: "Available Now", now: true };
  const d = new Date(vacantSince);
  if (d <= new Date()) return { text: "Available Now", now: true };
  return { text: `From ${d.toLocaleDateString("en-KE", { month: "long", year: "numeric" })}`, now: false };
};

const toWhatsApp = (phone) => {
  if (!phone) return null;
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("0") && d.length === 10) return "254" + d.slice(1);
  if ((d.startsWith("7") || d.startsWith("1")) && d.length === 9) return "254" + d;
  if (d.startsWith("254")) return d;
  return d;
};

const buildWhatsAppLink = (phone, unit, propName) => {
  const wa = toWhatsApp(phone);
  if (!wa) return null;
  const type = UNIT_TYPE_LABELS[unit.unitType] || unit.unitType || "unit";
  const msg = encodeURIComponent(
    `Hi, I'm interested in the ${type} (${unit.unitNumber}) at ${propName || "your property"}. Is it still available?`
  );
  return `https://wa.me/${wa}?text=${msg}`;
};

const ListingCard = ({ unit, bizPhone }) => {
  const [imgError, setImgError] = useState(false);
  const prop = unit.property || {};

  const img = (!imgError && (unit.images?.[0] || prop.images?.[0])) || null;
  const location = [prop.estateArea, prop.townCityState].filter(Boolean).join(", ");
  const typeLabel = UNIT_TYPE_LABELS[unit.unitType] || unit.unitType;
  const furnished = FURNISHED_CONFIG[unit.furnished];
  const avail = availableLabel(unit.vacantSince);
  const contactPhone = prop.specificContactInfo || bizPhone;
  const waLink = buildWhatsAppLink(contactPhone, unit, prop.propertyName);
  const callLink = contactPhone ? `tel:${contactPhone.replace(/\D/g, "")}` : null;
  const includedUtils = (unit.utilities || []).filter((u) => u.isIncluded).map((u) => u.utility);
  const extraUtils = (unit.utilities || []).filter((u) => !u.isIncluded).map((u) => u.utility);

  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden hover:shadow-md transition-shadow">
      {/* Image */}
      <div className="relative h-48 bg-slate-100 flex-shrink-0">
        {img && !imgError ? (
          <img
            src={img}
            alt={prop.propertyName}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-slate-300">
            <svg className="w-12 h-12 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              <polyline strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} points="9 22 9 12 15 12 15 22" />
            </svg>
            <span className="text-xs text-slate-400">{prop.propertyType || "Property"}</span>
          </div>
        )}
        {/* Availability badge overlay */}
        <span className={`absolute top-2 left-2 rounded-full px-2.5 py-0.5 text-[10px] font-bold ${avail.now ? "bg-green-500 text-white" : "bg-blue-500 text-white"}`}>
          {avail.text}
        </span>
      </div>

      {/* Body */}
      <div className="flex flex-col flex-1 p-4 gap-3">
        {/* Property name + location */}
        <div>
          <p className="font-bold text-slate-900 text-sm leading-tight line-clamp-1">{prop.propertyName || "Property"}</p>
          {location && <p className="text-xs text-slate-500 mt-0.5">{location}</p>}
        </div>

        {/* Type + furnished badges */}
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-full bg-[#0B3B2E] text-white text-[10px] font-bold px-2.5 py-0.5">{typeLabel}</span>
          {furnished && (
            <span className={`rounded-full text-[10px] font-bold px-2.5 py-0.5 ${furnished.cls}`}>{furnished.label}</span>
          )}
        </div>

        {/* Rent */}
        <div>
          <p className="text-xl font-black text-[#0B3B2E]">{fmtKES(unit.rent)} <span className="text-xs font-semibold text-slate-400">/ mo</span></p>
          <p className="text-xs text-slate-500">Deposit: {fmtKES(unit.deposit)}</p>
        </div>

        {/* Size */}
        {unit.areaSqFt > 0 && (
          <p className="text-xs text-slate-600">{unit.areaSqFt.toLocaleString()} sq ft</p>
        )}

        {/* Amenities */}
        {unit.amenities?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {unit.amenities.slice(0, 4).map((a) => (
              <span key={a} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-600">{a}</span>
            ))}
            {unit.amenities.length > 4 && (
              <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-400">+{unit.amenities.length - 4} more</span>
            )}
          </div>
        )}

        {/* Utilities */}
        {(includedUtils.length > 0 || extraUtils.length > 0) && (
          <div className="text-[10px] text-slate-500 space-y-0.5">
            {includedUtils.length > 0 && (
              <p><span className="text-green-600 font-bold">Included:</span> {includedUtils.join(", ")}</p>
            )}
            {extraUtils.length > 0 && (
              <p><span className="text-slate-400 font-bold">Extra:</span> {extraUtils.join(", ")}</p>
            )}
          </div>
        )}

        {/* Description */}
        {unit.description && (
          <p className="text-xs text-slate-500 line-clamp-2">{unit.description}</p>
        )}

        {/* CTA buttons */}
        <div className="mt-auto pt-2 flex gap-2">
          {waLink && (
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-[#25D366] py-2 text-xs font-bold text-white hover:bg-[#1ebe5d] transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              WhatsApp
            </a>
          )}
          {callLink && (
            <a
              href={callLink}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.948V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              Call
            </a>
          )}
        </div>
      </div>
    </div>
  );
};

const UNIT_TYPES = ["studio", "1bed", "2bed", "3bed", "4bed", "commercial"];

const RentalListings = () => {
  const { businessId } = useParams();
  const [business, setBusiness] = useState(null);
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ unitType: "", maxRent: "", furnished: "", area: "" });
  const rentRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/public/listings/${businessId}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.message || "Failed to load listings");
      setBusiness(data.business);
      setListings(data.listings || []);
    } catch (err) {
      setError(err.message || "Failed to load listings");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const { unitType, maxRent, furnished, area } = filters;
    const maxR = maxRent ? Number(maxRent) : null;
    const areaLow = area.trim().toLowerCase();
    return listings.filter((u) => {
      if (unitType && u.unitType !== unitType) return false;
      if (maxR && u.rent > maxR) return false;
      if (furnished && u.furnished !== furnished) return false;
      if (areaLow) {
        const p = u.property || {};
        const haystack = `${p.propertyName || ""} ${p.townCityState || ""} ${p.estateArea || ""} ${p.zoneRegion || ""} ${p.roadStreet || ""}`.toLowerCase();
        if (!haystack.includes(areaLow)) return false;
      }
      return true;
    });
  }, [listings, filters]);

  const setFilter = (key, val) => setFilters((p) => ({ ...p, [key]: val }));

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-slate-500 text-sm mb-3">{error}</p>
          <button onClick={load} className="rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127]">Try Again</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-[#0B3B2E] text-white sticky top-0 z-10 shadow-md">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {business?.logo && (
              <img src={business.logo} alt="logo" className="h-8 w-8 rounded-full object-cover flex-shrink-0" onError={(e) => { e.currentTarget.style.display = "none"; }} />
            )}
            <div className="min-w-0">
              <p className="font-black text-sm leading-tight truncate">{business?.companyName || "Rental Listings"}</p>
              {business?.slogan && <p className="text-[10px] text-green-200 truncate">{business.slogan}</p>}
            </div>
          </div>
          {business?.phoneNo && (
            <a href={`tel:${business.phoneNo.replace(/\D/g, "")}`} className="flex-shrink-0 flex items-center gap-1.5 rounded-lg border border-white/30 px-3 py-1.5 text-xs font-bold hover:bg-white/10 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.948V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              {business.phoneNo}
            </a>
          )}
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Page title */}
        <div className="mb-5">
          <h1 className="text-lg font-black text-slate-900">Available Rental Units</h1>
          {!loading && (
            <p className="text-xs text-slate-500 mt-0.5">
              {filtered.length} {filtered.length === 1 ? "unit" : "units"} available{filters.area ? ` in "${filters.area}"` : ""}
            </p>
          )}
        </div>

        {/* Filters */}
        <div className="mb-6 rounded-xl border border-slate-200 bg-white shadow-sm p-4 space-y-3">
          {/* Unit type pills */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button
              onClick={() => setFilter("unitType", "")}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold transition-colors ${!filters.unitType ? "bg-[#0B3B2E] text-white" : "border border-slate-200 text-slate-600 hover:border-[#0B3B2E] hover:text-[#0B3B2E]"}`}
            >
              All Types
            </button>
            {UNIT_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setFilter("unitType", filters.unitType === t ? "" : t)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold transition-colors ${filters.unitType === t ? "bg-[#0B3B2E] text-white" : "border border-slate-200 text-slate-600 hover:border-[#0B3B2E] hover:text-[#0B3B2E]"}`}
              >
                {UNIT_TYPE_LABELS[t]}
              </button>
            ))}
          </div>

          {/* Secondary filters */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              placeholder="Area or location..."
              value={filters.area}
              onChange={(e) => setFilter("area", e.target.value)}
              className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] focus:border-[#0B3B2E]"
            />
            <input
              ref={rentRef}
              type="number"
              placeholder="Max budget (Ksh)..."
              value={filters.maxRent}
              onChange={(e) => setFilter("maxRent", e.target.value)}
              className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] focus:border-[#0B3B2E]"
            />
            <select
              value={filters.furnished}
              onChange={(e) => setFilter("furnished", e.target.value)}
              className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] appearance-none"
            >
              <option value="">Any furnishing</option>
              <option value="furnished">Furnished</option>
              <option value="semi-furnished">Semi-Furnished</option>
              <option value="unfurnished">Unfurnished</option>
            </select>
          </div>

          {/* Clear filters */}
          {(filters.unitType || filters.maxRent || filters.furnished || filters.area) && (
            <button
              onClick={() => setFilters({ unitType: "", maxRent: "", furnished: "", area: "" })}
              className="text-[10px] font-bold text-slate-400 hover:text-slate-600 underline"
            >
              Clear all filters
            </button>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="rounded-xl border border-slate-200 bg-white overflow-hidden animate-pulse">
                <div className="h-48 bg-slate-100" />
                <div className="p-4 space-y-2">
                  <div className="h-4 bg-slate-100 rounded w-3/4" />
                  <div className="h-3 bg-slate-100 rounded w-1/2" />
                  <div className="h-6 bg-slate-100 rounded w-2/3 mt-4" />
                  <div className="h-3 bg-slate-100 rounded w-1/3" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty */}
        {!loading && filtered.length === 0 && (
          <div className="text-center py-16">
            <svg className="w-12 h-12 text-slate-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
            <p className="text-slate-500 text-sm font-semibold">No units match your search</p>
            <p className="text-slate-400 text-xs mt-1">Try adjusting your filters or check back soon.</p>
            {business?.phoneNo && (
              <a href={`tel:${business.phoneNo.replace(/\D/g, "")}`} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127]">
                Call us for more options
              </a>
            )}
          </div>
        )}

        {/* Grid */}
        {!loading && filtered.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((unit) => (
              <ListingCard key={unit._id} unit={unit} bizPhone={business?.phoneNo} />
            ))}
          </div>
        )}

        {/* Footer */}
        {!loading && (
          <p className="text-center text-[10px] text-slate-400 mt-10">
            Powered by MILIK Property Management
          </p>
        )}
      </div>
    </div>
  );
};

export default RentalListings;
