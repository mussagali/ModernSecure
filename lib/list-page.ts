type PageResult<T, E> = { data: T[] | null; count: number | null; error: E | null };

// PostgREST can return 416 when an offset is past the last row. Recover after
// filters, deletions, or a stale bookmarked URL without hiding genuine errors.
export async function loadListPage<T, E>(load: (page: number) => PromiseLike<PageResult<T, E>>, requested: number, pageSize = 25) {
  let page = requested;
  let result = await load(page);
  if (page > 1 && !result.data?.length) {
    const first = await load(1);
    if (!first.error) {
      page = Math.max(1, Math.ceil((first.count ?? 0) / pageSize));
      result = page === 1 ? first : await load(page);
    }
  }
  return { ...result, page };
}
