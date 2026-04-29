type OpenApiInfo = {
  title?: string;
  version?: string;
  description?: string;
};

type OpenApiServer = {
  url?: string;
  description?: string;
};

type OpenApiSchema = {
  type?: string | string[];
  format?: string;
  description?: string;
  enum?: unknown[];
  items?: OpenApiSchema | ReferenceObject;
  additionalProperties?: boolean | OpenApiSchema | ReferenceObject;
  properties?: Record<string, OpenApiSchema | ReferenceObject>;
  oneOf?: Array<OpenApiSchema | ReferenceObject>;
  anyOf?: Array<OpenApiSchema | ReferenceObject>;
  allOf?: Array<OpenApiSchema | ReferenceObject>;
};

type ReferenceObject = {
  $ref: string;
};

type ParameterObject = {
  name?: string;
  in?: string;
  required?: boolean;
  description?: string;
  schema?: OpenApiSchema | ReferenceObject;
};

type MediaTypeObject = {
  schema?: OpenApiSchema | ReferenceObject;
};

type RequestBodyObject = {
  description?: string;
  required?: boolean;
  content?: Record<string, MediaTypeObject>;
};

type ResponseObject = {
  description?: string;
  content?: Record<string, MediaTypeObject>;
};

type OperationObject = {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  parameters?: Array<ParameterObject | ReferenceObject>;
  requestBody?: RequestBodyObject | ReferenceObject;
  responses?: Record<string, ResponseObject | ReferenceObject>;
};

type PathItemObject = {
  parameters?: Array<ParameterObject | ReferenceObject>;
} & Partial<Record<HttpMethod, OperationObject>>;

type OpenApiDocument = {
  info?: OpenApiInfo;
  servers?: OpenApiServer[];
  paths?: Record<string, PathItemObject | undefined>;
};

const HTTP_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "patch",
  "options",
  "head",
  "trace",
] as const;

type HttpMethod = (typeof HTTP_METHODS)[number];

function isReferenceObject(value: unknown): value is ReferenceObject {
  return typeof value === "object" && value !== null && "$ref" in value;
}

function cleanText(value?: string): string | null {
  if (!value) return null;
  return value.replace(/\s+/g, " ").trim() || null;
}

function formatSchema(schema?: OpenApiSchema | ReferenceObject): string | null {
  if (!schema) return null;
  if (isReferenceObject(schema)) return schema.$ref;

  if (Array.isArray(schema.type) && schema.type.length > 0) {
    return schema.type.join(" | ");
  }

  if (typeof schema.type === "string") {
    if (schema.type === "array") {
      const items = formatSchema(schema.items);
      return items ? `array<${items}>` : "array";
    }

    if (schema.type === "object" && schema.additionalProperties) {
      const additionalType =
        schema.additionalProperties === true
          ? "unknown"
          : formatSchema(schema.additionalProperties) ?? "unknown";
      return `object<string, ${additionalType}>`;
    }

    return schema.format ? `${schema.type} (${schema.format})` : schema.type;
  }

  if (schema.oneOf?.length) {
    return `oneOf(${schema.oneOf.map((entry) => formatSchema(entry) ?? "unknown").join(", ")})`;
  }

  if (schema.anyOf?.length) {
    return `anyOf(${schema.anyOf.map((entry) => formatSchema(entry) ?? "unknown").join(", ")})`;
  }

  if (schema.allOf?.length) {
    return `allOf(${schema.allOf.map((entry) => formatSchema(entry) ?? "unknown").join(", ")})`;
  }

  if (schema.properties && Object.keys(schema.properties).length > 0) {
    return "object";
  }

  return null;
}

function formatParameter(parameter: ParameterObject | ReferenceObject): string {
  if (isReferenceObject(parameter)) return `- Ref: \`${parameter.$ref}\``;

  const location = parameter.in ? `${parameter.in}.` : "";
  const name = parameter.name ?? "unknown";
  const detailParts = [];

  if (parameter.required) detailParts.push("required");

  const schema = formatSchema(parameter.schema);
  if (schema) detailParts.push(schema);

  const description = cleanText(parameter.description);
  const details = detailParts.length > 0 ? ` (${detailParts.join(", ")})` : "";
  return `- \`${location}${name}\`${details}${description ? `: ${description}` : ""}`;
}

function formatContent(content?: Record<string, MediaTypeObject>): string[] {
  if (!content) return [];

  return Object.entries(content)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([contentType, media]) => {
      const schema = formatSchema(media.schema);
      return schema ? `- \`${contentType}\`: ${schema}` : `- \`${contentType}\``;
    });
}

function formatRequestBody(body: RequestBodyObject | ReferenceObject): string[] {
  if (isReferenceObject(body)) return [`- Ref: \`${body.$ref}\``];

  const lines: string[] = [];
  const description = cleanText(body.description);
  if (description) lines.push(`- ${description}`);
  if (body.required) lines.push("- Required");
  return [...lines, ...formatContent(body.content)];
}

function formatResponses(responses?: Record<string, ResponseObject | ReferenceObject>): string[] {
  if (!responses) return [];

  return Object.entries(responses)
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .flatMap(([status, response]) => {
      if (isReferenceObject(response)) return [`- \`${status}\`: Ref \`${response.$ref}\``];

      const description = cleanText(response.description);
      const header = description ? `- \`${status}\`: ${description}` : `- \`${status}\``;
      const contentLines = formatContent(response.content).map((line) => `  ${line}`);
      return [header, ...contentLines];
    });
}

function formatOperation(
  path: string,
  method: HttpMethod,
  pathItem: PathItemObject,
  operation: OperationObject,
): string[] {
  const lines = [`## ${method.toUpperCase()} ${path}`];
  const summary = cleanText(operation.summary);
  const description = cleanText(operation.description);

  if (summary) lines.push("", summary);
  if (description && description !== summary) lines.push("", description);
  if (operation.operationId) lines.push("", `Operation ID: \`${operation.operationId}\``);
  if (operation.tags && operation.tags.length > 0) {
    lines.push("", `Tags: ${operation.tags.map((tag) => `\`${tag}\``).join(", ")}`);
  }

  const parameters = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])];
  if (parameters.length > 0) {
    lines.push("", "Parameters", "", ...parameters.map((parameter) => formatParameter(parameter)));
  }

  if (operation.requestBody) {
    const requestLines = formatRequestBody(operation.requestBody);
    if (requestLines.length > 0) lines.push("", "Request Body", "", ...requestLines);
  }

  const responseLines = formatResponses(operation.responses);
  if (responseLines.length > 0) {
    lines.push("", "Responses", "", ...responseLines);
  }

  return lines;
}

export function createLlmsText(document: OpenApiDocument): string {
  const lines: string[] = [];
  const title = cleanText(document.info?.title) ?? "API Reference";
  const version = cleanText(document.info?.version);
  const description = cleanText(document.info?.description);

  lines.push(`# ${title}`);
  if (version) lines.push("", `Version: ${version}`);
  if (description) lines.push("", description);

  if (document.servers && document.servers.length > 0) {
    lines.push("", "## Servers", "");
    for (const server of document.servers) {
      if (!server.url) continue;
      const serverDescription = cleanText(server.description);
      lines.push(`- \`${server.url}\`${serverDescription ? `: ${serverDescription}` : ""}`);
    }
  }

  const paths = Object.entries(document.paths ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  for (const [path, pathItem] of paths) {
    if (!pathItem) continue;
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;
      lines.push("", ...formatOperation(path, method, pathItem, operation));
    }
  }

  return `${lines.join("\n").trim()}\n`;
}
