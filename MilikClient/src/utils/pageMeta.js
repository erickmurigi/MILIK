const ensureHead = (sel, tag, attrs = {}) => {
  let el = document.head.querySelector(sel);
  if (!el) {
    el = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    document.head.appendChild(el);
  }
  return el;
};

export const setTitle = (t) => { document.title = t; };
export const setDesc = (c) => ensureHead('meta[name="description"]', "meta", { name: "description" }).setAttribute("content", c);
export const setCanonical = (h) => ensureHead('link[rel="canonical"]', "link", { rel: "canonical" }).setAttribute("href", h);
export const setOg = (p, c) => ensureHead(`meta[property="${p}"]`, "meta", { property: p }).setAttribute("content", c);
export const setTw = (n, c) => ensureHead(`meta[name="${n}"]`, "meta", { name: n }).setAttribute("content", c);
