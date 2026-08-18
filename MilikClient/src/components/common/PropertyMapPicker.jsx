import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix broken default icon paths that occur when Leaflet is bundled with Vite
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl: "", shadowUrl: "", iconRetinaUrl: "" });

const NAIROBI = [-1.2921, 36.8219];

const PIN_ICON = L.divIcon({
  html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 32" width="30" height="40">
    <filter id="shadow"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#00000044"/></filter>
    <path filter="url(#shadow)" d="M12 0C5.4 0 0 5.4 0 12c0 9.5 12 20 12 20S24 21.5 24 12C24 5.4 18.6 0 12 0z" fill="#ea580c"/>
    <circle cx="12" cy="12" r="5.5" fill="white"/>
    <circle cx="12" cy="12" r="3" fill="#ea580c"/>
  </svg>`,
  className: "",
  iconSize: [30, 40],
  iconAnchor: [15, 40],
});

const TILE_LAYERS = {
  street: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
    maxZoom: 19,
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri",
    maxZoom: 19,
  },
};

export default function PropertyMapPicker({ lat, lng, onLocationChange, addressHint = "" }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const tileRef = useRef(null);

  const [ready, setReady] = useState(false);
  const [tileMode, setTileMode] = useState("street");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [copied, setCopied] = useState(false);

  const parsedLat = lat !== "" && lat != null ? parseFloat(lat) : null;
  const parsedLng = lng !== "" && lng != null ? parseFloat(lng) : null;
  const hasCoords = parsedLat != null && !isNaN(parsedLat) && parsedLng != null && !isNaN(parsedLng);

  const buildMarker = useCallback((map, newLat, newLng) => {
    if (markerRef.current) {
      markerRef.current.setLatLng([newLat, newLng]);
      return markerRef.current;
    }
    const m = L.marker([newLat, newLng], { draggable: true, icon: PIN_ICON }).addTo(map);
    m.on("dragend", (e) => {
      const { lat: dLat, lng: dLng } = e.target.getLatLng();
      onLocationChange({ lat: dLat.toFixed(6), lng: dLng.toFixed(6) });
    });
    markerRef.current = m;
    return m;
  }, [onLocationChange]);

  // Initialize map once the container becomes visible
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const init = () => {
      if (mapRef.current) return;

      const centerLat = hasCoords ? parsedLat : NAIROBI[0];
      const centerLng = hasCoords ? parsedLng : NAIROBI[1];

      const map = L.map(el, {
        center: [centerLat, centerLng],
        zoom: hasCoords ? 15 : 13,
        zoomControl: false,
      });

      L.control.zoom({ position: "bottomright" }).addTo(map);

      const tile = TILE_LAYERS.street;
      tileRef.current = L.tileLayer(tile.url, {
        attribution: tile.attribution,
        maxZoom: tile.maxZoom,
      }).addTo(map);

      if (hasCoords) buildMarker(map, parsedLat, parsedLng);

      map.on("click", (e) => {
        const { lat: cLat, lng: cLng } = e.latlng;
        buildMarker(map, cLat, cLng);
        onLocationChange({ lat: cLat.toFixed(6), lng: cLng.toFixed(6) });
      });

      mapRef.current = map;
      setReady(true);
    };

    // If already visible, init immediately; otherwise wait (handles hidden tabs)
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      init();
    } else {
      const observer = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) { init(); observer.disconnect(); }
      }, { threshold: 0.01 });
      observer.observe(el);
      return () => {
        observer.disconnect();
        if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; markerRef.current = null; }
      };
    }

    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; markerRef.current = null; }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync external coord changes to marker
  useEffect(() => {
    if (!mapRef.current) return;
    if (hasCoords) {
      buildMarker(mapRef.current, parsedLat, parsedLng);
    } else if (markerRef.current) {
      mapRef.current.removeLayer(markerRef.current);
      markerRef.current = null;
    }
  }, [parsedLat, parsedLng, hasCoords, buildMarker]);

  // Switch tile layer
  useEffect(() => {
    if (!mapRef.current || !tileRef.current) return;
    mapRef.current.removeLayer(tileRef.current);
    const tile = TILE_LAYERS[tileMode];
    tileRef.current = L.tileLayer(tile.url, { attribution: tile.attribution, maxZoom: tile.maxZoom }).addTo(mapRef.current);
  }, [tileMode]);

  const geocode = useCallback(async (searchQuery) => {
    const q = String(searchQuery || "").trim();
    if (!q) return;
    setSearching(true);
    setSearchError("");
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`,
        { headers: { "Accept-Language": "en" } }
      );
      const data = await res.json();
      if (!data.length) { setSearchError("Not found — try a different name or address."); return; }
      const newLat = parseFloat(data[0].lat).toFixed(6);
      const newLng = parseFloat(data[0].lon).toFixed(6);
      onLocationChange({ lat: newLat, lng: newLng });
      if (mapRef.current) {
        mapRef.current.setView([parseFloat(newLat), parseFloat(newLng)], 16);
        buildMarker(mapRef.current, parseFloat(newLat), parseFloat(newLng));
      }
    } catch {
      setSearchError("Search failed — check your internet connection.");
    } finally {
      setSearching(false);
    }
  }, [onLocationChange, buildMarker]);

  const handleManualChange = (field, value) => {
    const newLat = field === "lat" ? value : (parsedLat ?? "");
    const newLng = field === "lng" ? value : (parsedLng ?? "");
    onLocationChange({ lat: newLat, lng: newLng });
    if (mapRef.current && value !== "") {
      const nLat = field === "lat" ? parseFloat(value) : parsedLat;
      const nLng = field === "lng" ? parseFloat(value) : parsedLng;
      if (nLat != null && nLng != null && !isNaN(nLat) && !isNaN(nLng)) {
        mapRef.current.setView([nLat, nLng], 16);
      }
    }
  };

  const copyCoords = () => {
    if (!hasCoords) return;
    navigator.clipboard?.writeText(`${parsedLat.toFixed(6)}, ${parsedLng.toFixed(6)}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-2">
      {/* Search row */}
      <form
        onSubmit={(e) => { e.preventDefault(); geocode(query || addressHint); }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <svg viewBox="0 0 24 24" fill="none" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="m16.5 16.5 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search place — e.g. Westlands, Nairobi or Kilimani"
            className="w-full rounded border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/20"
          />
        </div>
        <button
          type="submit"
          disabled={searching}
          className="h-8 px-3 text-xs font-bold bg-orange-600 hover:bg-orange-700 text-white rounded transition-colors disabled:opacity-60 shrink-0"
        >
          {searching ? "Searching…" : "Search"}
        </button>
        {addressHint && (
          <button
            type="button"
            onClick={() => geocode(addressHint)}
            disabled={searching}
            title={`Geocode: ${addressHint}`}
            className="h-8 px-3 text-xs font-bold border border-[#0B3B2E] text-[#0B3B2E] rounded hover:bg-[#0B3B2E]/5 transition-colors disabled:opacity-60 shrink-0"
          >
            Use Address ↑
          </button>
        )}
      </form>

      {searchError && <p className="text-[11px] text-red-500">{searchError}</p>}

      {/* Map container */}
      <div className="relative overflow-hidden rounded-xl border border-slate-200 shadow-sm" style={{ height: 300 }}>
        <div ref={containerRef} className="h-full w-full" style={{ zIndex: 0 }} />

        {!ready && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-50">
            <svg className="h-5 w-5 animate-spin text-slate-400" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            <span className="text-xs text-slate-400">Loading map…</span>
          </div>
        )}

        {/* Tile toggle — top-left */}
        {ready && (
          <div className="absolute left-2 top-2 z-[400] flex overflow-hidden rounded shadow-md">
            <button
              type="button"
              onClick={() => setTileMode("street")}
              className={`px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide transition-colors ${
                tileMode === "street" ? "bg-[#0B3B2E] text-white" : "bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              Map
            </button>
            <button
              type="button"
              onClick={() => setTileMode("satellite")}
              className={`px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide transition-colors border-l border-slate-200 ${
                tileMode === "satellite" ? "bg-[#0B3B2E] text-white" : "bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              Satellite
            </button>
          </div>
        )}

        {/* Drop-pin hint */}
        {ready && !hasCoords && (
          <div className="pointer-events-none absolute bottom-8 left-1/2 z-[400] -translate-x-1/2 rounded-full bg-black/60 px-4 py-1.5 text-[10px] font-bold text-white shadow-lg">
            Click anywhere on the map to drop a pin
          </div>
        )}
      </div>

      {/* Manual inputs */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Latitude</label>
          <input
            type="number"
            step="any"
            value={parsedLat ?? ""}
            onChange={(e) => handleManualChange("lat", e.target.value)}
            placeholder="-1.292100"
            className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/20"
          />
        </div>
        <div>
          <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Longitude</label>
          <input
            type="number"
            step="any"
            value={parsedLng ?? ""}
            onChange={(e) => handleManualChange("lng", e.target.value)}
            placeholder="36.821900"
            className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/20"
          />
        </div>
      </div>

      {/* Status row */}
      {hasCoords ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="rounded bg-[#0B3B2E]/8 px-2 py-0.5 font-mono text-[11px] text-[#0B3B2E]">
            {parsedLat.toFixed(6)}, {parsedLng.toFixed(6)}
          </span>
          <button
            type="button"
            onClick={copyCoords}
            className="flex items-center gap-1 font-bold text-slate-500 hover:text-slate-700 transition-colors"
          >
            {copied ? (
              <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3 text-green-500"><path d="m4 12 6 6L20 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="1.8" /></svg>
            )}
            {copied ? "Copied!" : "Copy"}
          </button>
          <a
            href={`https://www.google.com/maps?q=${parsedLat},${parsedLng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 font-bold text-blue-600 hover:text-blue-800 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3"><path d="M15 3h6v6M10 14 21 3M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Google Maps
          </a>
          <button
            type="button"
            onClick={() => onLocationChange({ lat: "", lng: "" })}
            className="ml-auto flex items-center gap-1 font-bold text-red-400 hover:text-red-600 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            Clear Pin
          </button>
        </div>
      ) : (
        <p className="text-[11px] text-slate-400">No location set — search, use the address above, or click the map.</p>
      )}
    </div>
  );
}
