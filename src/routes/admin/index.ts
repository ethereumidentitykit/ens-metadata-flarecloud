import { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../../env";
import { cacheInvalidateRoutes } from "./invalidate";

// Indexer-only admin endpoints, grouped under one mountable app. Each
// sub-route registers its own absolute path (e.g. /cache/invalidate).
export const adminRoutes = new OpenAPIHono<{ Bindings: Env }>();
adminRoutes.route("/", cacheInvalidateRoutes);
