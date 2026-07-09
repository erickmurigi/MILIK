const ensureHead = (sel, tag, attrs = {}) => {
  let el = document.head.querySelector(sel);
  if (!el) {
    el = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    document.head.appendChild(el);
  }
  return el;
};

export const setTitle      = (t) => { document.title = t; };
export const setDesc       = (c) => ensureHead('meta[name="description"]', "meta", { name: "description" }).setAttribute("content", c);
export const setKeywords   = (c) => ensureHead('meta[name="keywords"]',    "meta", { name: "keywords" }).setAttribute("content", c);
export const setRobots     = (c) => ensureHead('meta[name="robots"]',      "meta", { name: "robots" }).setAttribute("content", c);
export const setCanonical  = (h) => ensureHead('link[rel="canonical"]',    "link", { rel: "canonical" }).setAttribute("href", h);
export const setOg         = (p, c) => ensureHead(`meta[property="${p}"]`, "meta", { property: p }).setAttribute("content", c);
export const setTw         = (n, c) => ensureHead(`meta[name="${n}"]`,     "meta", { name: n }).setAttribute("content", c);

export const setSchema = (id, data) => {
  const elId = `schema-${id}`;
  let el = document.head.querySelector(`#${elId}`);
  if (!el) {
    el = document.createElement("script");
    el.type = "application/ld+json";
    el.id = elId;
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
};

export const removeSchema = (id) => {
  const el = document.head.querySelector(`#schema-${id}`);
  if (el) el.remove();
};
