const _fmt2 = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const _fmt0 = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Formats a number as KES currency.
 * @param {number|string} value
 * @param {number} [decimals=2] - pass 0 for whole-number display
 */
export const formatMoney = (value, decimals = 2) =>
  (decimals === 0 ? _fmt0 : _fmt2).format(Number(value || 0));
