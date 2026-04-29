import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { Scalar } from "@scalar/hono-api-reference";

import type { Env } from "./env";
import { HttpError } from "./lib/errors";
import { createLlmsText } from "./lib/llms";
import { scalarTheme } from "./lib/scalarTheme";
import { avatarRoutes, headerRoutes } from "./routes/images";
import { cacheInvalidateRoutes } from "./routes/cacheInvalidate";
import { metadataRoutes } from "./routes/metadata";
import { nameImageRoutes } from "./routes/nameImage";
import { queryNFTRoutes } from "./routes/queryNFT";

const app = new OpenAPIHono<{ Bindings: Env }>();
const STATIC_CACHE_CONTROL = "public, max-age=3600";
const docsHandler = Scalar<{ Bindings: Env }>(scalarTheme);
const openApiConfig = {
  openapi: "3.1.0",
  info: {
    title: "ENS Metadata - Flarecloud",
    version: "0.1.0",
    description:
      "ENS metadata service on Cloudflare Workers. Serves JSON metadata, avatar, and header records.",
  },
} as const;

app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
});

app.use("*", cors());

app.route("/", avatarRoutes);
app.route("/", headerRoutes);
app.route("/", queryNFTRoutes);
app.route("/", nameImageRoutes);
app.route("/", metadataRoutes);
app.route("/", cacheInvalidateRoutes);

const openApiDocument = app.getOpenAPI31Document(openApiConfig);
const llmsText = createLlmsText(openApiDocument);

function cached(response: Response): Response {
  response.headers.set("cache-control", STATIC_CACHE_CONTROL);
  return response;
}

app.get("/", async (c, next) => {
  const response = await docsHandler(c, next);
  return response ? cached(response) : c.notFound();
});
app.get("/docs", async (c, next) => {
  const response = await docsHandler(c, next);
  return response ? cached(response) : c.notFound();
});
app.get("/favicon.ico", () =>
  new Response(null, {
    status: 204,
    headers: { "cache-control": STATIC_CACHE_CONTROL },
  }),
);
app.get("/openapi.json", () =>
  new Response(JSON.stringify(openApiDocument), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": STATIC_CACHE_CONTROL,
    },
  }),
);
app.get("/llms.txt", (c) => {
  c.header("cache-control", STATIC_CACHE_CONTROL);
  return c.text(llmsText);
});

app.onError((err, c) => {
  if (err instanceof HttpError) {
    return Response.json({ error: err.code ?? "error", message: err.message }, { status: err.status });
  }
  console.error(`unhandled error for ${c.req.method} ${c.req.path}:`, err);
  return Response.json({ error: "internal_error", message: "internal server error" }, { status: 500 });
});

export default app;
