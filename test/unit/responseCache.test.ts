import { describe, expect, it, vi } from "vitest";
import { respondFromCache } from "../../src/lib/responseCache";

function fakeContext(): {
  ctx: ExecutionContext;
  pending: Promise<unknown>[];
} {
  const pending: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil(promise: Promise<unknown>) {
        pending.push(promise);
      },
      passThroughOnException() {},
      props: {},
    },
    pending,
  };
}

describe("respondFromCache", () => {
  it("returns a cached response without calling the handler", async () => {
    const cached = new Response("cached");
    const cache = {
      match: vi.fn(async () => cached),
      put: vi.fn(),
    };
    const { ctx } = fakeContext();
    const handler = vi.fn(async () => new Response("fresh"));

    const response = await respondFromCache(
      cache,
      new Request("https://example.com/item"),
      ctx,
      handler,
    );

    expect(response).toBe(cached);
    expect(handler).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("caches successful responses in waitUntil", async () => {
    const put = vi.fn(async (_request: RequestInfo | URL, _response: Response) => undefined);
    const cache = {
      match: vi.fn(async () => undefined),
      put,
    };
    const { ctx, pending } = fakeContext();

    const response = await respondFromCache(
      cache,
      new Request("https://example.com/item"),
      ctx,
      async () => new Response("fresh", { status: 200 }),
    );

    expect(await response.text()).toBe("fresh");
    expect(put).toHaveBeenCalledOnce();
    expect(put.mock.calls[0]?.[0]).toBeInstanceOf(Request);
    expect(put.mock.calls[0]?.[1]).toBeInstanceOf(Response);
    await expect(Promise.all(pending)).resolves.toEqual([undefined]);
  });

  it("does not cache non-2xx responses", async () => {
    const cache = {
      match: vi.fn(async () => undefined),
      put: vi.fn(),
    };
    const { ctx, pending } = fakeContext();

    const response = await respondFromCache(
      cache,
      new Request("https://example.com/missing"),
      ctx,
      async () => new Response("missing", { status: 404 }),
    );

    expect(response.status).toBe(404);
    expect(cache.put).not.toHaveBeenCalled();
    expect(pending).toEqual([]);
  });

  it("falls through on cache match failures and swallows async cache put failures", async () => {
    const cache = {
      match: vi.fn(async () => {
        throw new Error("match failed");
      }),
      put: vi.fn(async () => {
        throw new Error("put failed");
      }),
    };
    const { ctx, pending } = fakeContext();

    const response = await respondFromCache(
      cache,
      new Request("https://example.com/item"),
      ctx,
      async () => new Response("fresh"),
    );

    expect(response.status).toBe(200);
    expect(cache.put).toHaveBeenCalledOnce();
    await expect(Promise.all(pending)).resolves.toEqual([undefined]);
  });
});
