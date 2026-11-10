export async function respondFromCache(
  cache: Pick<Cache, "match" | "put">,
  request: Request,
  ctx: ExecutionContext,
  handler: () => Promise<Response>,
  version?: string,
): Promise<Response> {
  const cached = await cache.match(request).catch(() => null);
  if (cached && (!version || cached.headers.get("x-renderer-version") === version)) return cached;

  let response = await handler();
  if (!response.ok) return response;

  if (version) {
    const headers = new Headers(response.headers);
    headers.set("x-renderer-version", version);
    response = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  ctx.waitUntil(Promise.resolve(cache.put(request, response.clone())).catch(() => {}));
  return response;
}
