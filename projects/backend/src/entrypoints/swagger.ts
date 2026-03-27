/** Swagger UI + OpenAPI spec for auto-bot serverless (CDN-based, no npm deps). */

export function getOpenApiSpec(): object {
  return {
    openapi: "3.0.0",
    info: {
      title: "API for DataModule",
      description:
        'Auto-generated docs for DataModule<br><br><a id="health-check-btn" href="/health">View Health Check Status</a>',
      version: "1.0",
    },
    paths: {
      "/audit/test-by-rid": {
        post: {
          tags: ["Audit"],
          summary: "Start an audit for a standard date-leg record",
          operationId: "testByRid",
          parameters: [
            { name: "rid", in: "query", required: true, schema: { type: "string" }, description: "QuickBase Record ID" },
            { name: "callback_url", in: "query", required: false, schema: { type: "string" }, description: "URL to POST results to when complete" },
            { name: "override", in: "query", required: false, schema: { type: "string" }, description: "Override the recording ID lookup" },
            { name: "audit_id", in: "query", required: false, schema: { type: "string" }, description: "Custom audit/job ID (auto-generated if omitted)" },
          ],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    record: { type: "object", description: "Full QuickBase record (optional, fetched if omitted)" },
                    recordingIdField: { type: "string", default: "Genie", description: "Field name containing the recording ID" },
                    owner: { type: "string", default: "api" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Audit queued", content: { "application/json": { schema: { type: "object", properties: { jobId: { type: "string" }, findingId: { type: "string" }, status: { type: "string" } } } } } },
            "400": { description: "Missing rid parameter" },
          },
        },
      },
      "/audit/package-by-rid": {
        post: {
          tags: ["Audit"],
          summary: "Start an audit for a package record",
          operationId: "packageByRid",
          parameters: [
            { name: "rid", in: "query", required: true, schema: { type: "string" }, description: "QuickBase Record ID" },
            { name: "callback_url", in: "query", required: false, schema: { type: "string" }, description: "URL to POST results to when complete" },
          ],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    record: { type: "object", description: "Full QuickBase record (optional)" },
                    recordingIdField: { type: "string", default: "GenieNumber" },
                    owner: { type: "string", default: "api" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Audit queued" },
            "400": { description: "Missing rid parameter" },
          },
        },
      },
      "/audit/finding": {
        get: {
          tags: ["Audit"],
          summary: "Retrieve an audit finding by ID",
          operationId: "getFinding",
          parameters: [
            { name: "id", in: "query", required: true, schema: { type: "string" }, description: "Finding ID" },
          ],
          responses: {
            "200": { description: "The audit finding" },
            "400": { description: "Missing id parameter" },
            "404": { description: "Finding not found" },
          },
        },
      },
      "/health": {
        get: {
          tags: ["Health"],
          summary: "Health check",
          operationId: "healthCheck",
          responses: {
            "200": {
              description: "Service is healthy",
              content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, ts: { type: "number" } } } } },
            },
          },
        },
      },
      "/audit/step/init": {
        post: { tags: ["Pipeline (internal)"], summary: "Step: Init", operationId: "stepInit", responses: { "200": { description: "OK" } } },
      },
      "/audit/step/transcribe": {
        post: { tags: ["Pipeline (internal)"], summary: "Step: Transcribe", operationId: "stepTranscribe", responses: { "200": { description: "OK" } } },
      },
      "/audit/step/transcribe-complete": {
        post: { tags: ["Pipeline (internal)"], summary: "Step: Transcribe callback", operationId: "stepTranscribeCb", responses: { "200": { description: "OK" } } },
      },
      "/audit/step/prepare": {
        post: { tags: ["Pipeline (internal)"], summary: "Step: Prepare", operationId: "stepPrepare", responses: { "200": { description: "OK" } } },
      },
      "/audit/step/ask-batch": {
        post: { tags: ["Pipeline (internal)"], summary: "Step: Ask batch", operationId: "stepAskBatch", responses: { "200": { description: "OK" } } },
      },
      "/audit/step/finalize": {
        post: { tags: ["Pipeline (internal)"], summary: "Step: Finalize", operationId: "stepFinalize", responses: { "200": { description: "OK" } } },
      },
      "/audit/step/cleanup": {
        post: { tags: ["Pipeline (internal)"], summary: "Step: Cleanup", operationId: "stepCleanup", responses: { "200": { description: "OK" } } },
      },
    },
  };
}

export function getSwaggerHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Auto-Bot API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
#swagger-ui > section > div.topbar > div > div {
  display: flex;
}
#swagger-ui > section > div.topbar {
  background-color: #f8f9fa !important;
  box-shadow: 0px 4px 6px rgba(0, 0, 0, 0.1),
              0px 1px 3px rgba(0, 0, 0, 0.06);
  border-radius: 8px;
  transition: box-shadow 0.3s ease-in-out;
}
div.topbar {
  height: 80px;
  display: flex;
}
#health-check-btn {
  padding: 0.375rem 0.75rem;
  font-size: 1rem;
  font-weight: 400;
  line-height: 1.5;
  color: #6c757d;
  background-color: transparent;
  border: 1px solid #6c757d;
  border-radius: 0.375rem;
  text-decoration: none;
  transition: color .15s ease-in-out, background-color .15s ease-in-out, border-color .15s ease-in-out;
}
#health-check-btn:hover {
  color: #fff;
  background-color: #6c757d;
  border-color: #6c757d;
}
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: "/api/openapi.json",
      dom_id: "#swagger-ui",
      persistAuthorization: true,
      defaultModelsExpandDepth: -1,
      docExpansion: "none",
    });
  </script>
</body>
</html>`;
}

export function getDocsIndexHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>API Documentation Index</title>
  <link
    rel="stylesheet"
    href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css"
    crossorigin="anonymous"
  >
  <style>
    body {
      background-color: #f8f9fa;
    }
    .heading {
      font-size: 2rem;
      font-weight: 700;
      margin-bottom: 0.75rem;
    }
    .subheading {
      font-size: 1.1rem;
      color: #6c757d;
      margin-bottom: 1.5rem;
    }
    .shadow-custom {
      box-shadow: 0 0.25rem 0.5rem rgba(0, 0, 0, 0.1);
    }
  </style>
</head>
<body>
  <div class="container py-5">
    <div class="row justify-content-center text-center mb-4">
      <div class="col-12 col-md-8">
        <h1 class="heading">Available API Docs</h1>
        <p class="subheading">Choose a link below to open its Swagger Docs</p>
      </div>
    </div>
    <div class="row justify-content-center">
      <div class="col-12 col-md-8">
        <ul class="list-group list-group-flush shadow-custom">
          <li class="list-group-item">
            <a
              href="/docs/datamodule"
              class="text-decoration-none fw-semibold d-inline-flex align-items-center gap-2"
            >
              <span>DATAMODULE</span>
            </a>
          </li>
        </ul>
      </div>
    </div>
  </div>
  <script
    src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"
    crossorigin="anonymous">
  </script>
</body>
</html>`;
}
