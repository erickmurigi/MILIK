export const round2 = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
