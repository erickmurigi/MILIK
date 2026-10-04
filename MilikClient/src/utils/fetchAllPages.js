// Loads every page of a paginated list endpoint. The first request tells us how many pages
// exist; the rest run in parallel. Returns the page bodies in page order.
//   fetchPage(page, limit) -> response body shaped { data|array, pages }
export const fetchAllPages = async (fetchPage, limit) => {
  const first = await fetchPage(1, limit);
  const pages = Math.max(1, Number(first?.pages) || 1);
  if (pages === 1) return [first];

  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, index) => fetchPage(index + 2, limit))
  );
  return [first, ...rest];
};
