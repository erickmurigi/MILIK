export const parsePage  = (v, def = 1)            => Math.max(parseInt(v, 10) || def, 1);
export const parseLimit = (v, def = 50, max = 200) => Math.min(Math.max(parseInt(v, 10) || def, 1), max);
