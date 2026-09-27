// Swagger UI for the published API. The spec sits next to this page (../openapi.yaml),
// so the relative server "api/v1" resolves to the same host and path prefix (/banquet on production).
window.ui = SwaggerUIBundle({
  url: new URL("../openapi.yaml", window.location.href).toString(),
  dom_id: "#swagger-ui",
  deepLinking: true,
  persistAuthorization: true,
  displayRequestDuration: true,
  tryItOutEnabled: true,
  defaultModelsExpandDepth: 0,
});
