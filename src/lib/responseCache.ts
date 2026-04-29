export async function respondFromCache(
  cache: Pick<Cache, "match" | "put">,
  request: Request,
  ctx: ExecutionContext,
  handler: () => Promise<Response>,
): Promise<Response> {
  const cached = await cache.match(request).catch(() => null);
  if (cached) return cached;

  const response = await handler();
  if (!response.ok) return response;

  ctx.waitUntil(Promise.resolve(cache.put(request, response.clone())).catch(() => {}));
  return response;
}
