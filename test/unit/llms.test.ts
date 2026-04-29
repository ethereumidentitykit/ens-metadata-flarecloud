import { describe, expect, it } from "vitest";
import { createLlmsText } from "../../src/lib/llms";

describe("createLlmsText", () => {
  it("formats OpenAPI metadata, servers, operations, parameters, and responses", () => {
    const text = createLlmsText({
      info: {
        title: "Example API",
        version: "1.2.3",
        description: "Example service\nwith whitespace.",
      },
      servers: [
        { url: "https://api.example", description: "Production" },
        { description: "missing URL" },
      ],
      paths: {
        "/users/{id}": {
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "User ID",
            },
          ],
          get: {
            summary: "Fetch user",
            description: "Fetch user",
            operationId: "getUser",
            tags: ["users"],
            parameters: [
              {
                name: "include",
                in: "query",
                schema: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              { $ref: "#/components/parameters/TraceId" },
            ],
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: { type: "object", additionalProperties: true },
                  },
                },
              },
              "404": { $ref: "#/components/responses/NotFound" },
            },
          },
        },
      },
    });

    expect(text).toContain("# Example API");
    expect(text).toContain("Version: 1.2.3");
    expect(text).toContain("Example service with whitespace.");
    expect(text).toContain("## Servers");
    expect(text).toContain("- `https://api.example`: Production");
    expect(text).toContain("## GET /users/{id}");
    expect(text).toContain("Fetch user");
    expect(text).toContain("Operation ID: `getUser`");
    expect(text).toContain("Tags: `users`");
    expect(text).toContain("- `path.id` (required, string): User ID");
    expect(text).toContain("- `query.include` (array<string>)");
    expect(text).toContain("- Ref: `#/components/parameters/TraceId`");
    expect(text).toContain("- `200`: OK");
    expect(text).toContain("  - `application/json`: object<string, unknown>");
    expect(text).toContain("- `404`: Ref `#/components/responses/NotFound`");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("formats request bodies and complex schema variants", () => {
    const text = createLlmsText({
      info: { title: "Write API" },
      paths: {
        "/write": {
          post: {
            summary: "Create item",
            requestBody: {
              description: "JSON payload",
              required: true,
              content: {
                "application/json": {
                  schema: {
                    oneOf: [
                      { type: "string", format: "uuid" },
                      { allOf: [{ type: "object" }, { $ref: "#/components/schemas/Item" }] },
                    ],
                  },
                },
                "text/plain": {
                  schema: { anyOf: [{ type: "string" }, { type: ["null", "string"] }] },
                },
              },
            },
            responses: {
              "201": { description: "Created" },
            },
          },
        },
      },
    });

    expect(text).toContain("## POST /write");
    expect(text).toContain("Request Body");
    expect(text).toContain("- JSON payload");
    expect(text).toContain("- Required");
    expect(text).toContain(
      "- `application/json`: oneOf(string (uuid), allOf(object, #/components/schemas/Item))",
    );
    expect(text).toContain("- `text/plain`: anyOf(string, null | string)");
  });

  it("sorts paths, methods, content types, and response codes deterministically", () => {
    const text = createLlmsText({
      info: { title: "Sorted API" },
      paths: {
        "/z": {
          post: {
            summary: "Post z",
            responses: {
              "500": { description: "Error" },
              "200": {
                description: "OK",
                content: {
                  "text/plain": { schema: { type: "string" } },
                  "application/json": { schema: { type: "object", properties: { id: { type: "string" } } } },
                },
              },
            },
          },
          get: {
            summary: "Get z",
            responses: { "200": { description: "OK" } },
          },
        },
        "/a": {
          delete: {
            summary: "Delete a",
            responses: { "204": { description: "No content" } },
          },
        },
      },
    });

    expect(text.indexOf("## DELETE /a")).toBeLessThan(text.indexOf("## GET /z"));
    expect(text.indexOf("## GET /z")).toBeLessThan(text.indexOf("## POST /z"));
    expect(text.indexOf("- `200`: OK")).toBeLessThan(text.indexOf("- `500`: Error"));
    expect(text.indexOf("- `application/json`: object")).toBeLessThan(
      text.indexOf("- `text/plain`: string"),
    );
  });
});
