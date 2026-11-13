import { Router } from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from './openapi.js';

export const swaggerRouter = Router();
// Override only the docs policy: the current VPS uses HTTP, so upgrading its
// self-hosted assets to HTTPS would break the documentation page.
swaggerRouter.use(helmet.contentSecurityPolicy({
  directives: {
    upgradeInsecureRequests: null,
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    connectSrc: ["'self'"],
    imgSrc: ["'self'", 'data:'],
  },
}));
swaggerRouter.get('/openapi.json', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(openApiDocument);
});
swaggerRouter.use(swaggerUi.serve, swaggerUi.setup(openApiDocument, {
  customSiteTitle: 'Secure Notes · API Documentation',
  customCss: `
    body { background: #f5f8f7; }
    .swagger-ui { color: #193037; font-family: system-ui, -apple-system, sans-serif; }
    .swagger-ui .topbar { display: none; }
    .swagger-ui .wrapper { max-width: 1180px; padding: 0 28px; }
    .swagger-ui .info { margin: 36px 0 26px; padding: 28px; border: 1px solid #dce5e5; border-radius: 14px; background: white; }
    .swagger-ui .info .title { color: #193037; font-size: 34px; letter-spacing: -1px; }
    .swagger-ui .info p, .swagger-ui .info li { color: #455c60; line-height: 1.7; }
    .swagger-ui .info h3 { color: #176f65; font-size: 18px; }
    .swagger-ui .scheme-container { background: white; border-top: 1px solid #dce5e5; border-bottom: 1px solid #dce5e5; box-shadow: none; }
    .swagger-ui .btn.authorize { border-color: #176f65; color: #176f65; border-radius: 8px; }
    .swagger-ui .btn.authorize svg { fill: #176f65; }
    .swagger-ui .opblock { border-radius: 9px; box-shadow: none; overflow: hidden; }
    .swagger-ui .opblock-tag { color: #193037; font-size: 21px; }
    .swagger-ui .opblock .opblock-summary-method { border-radius: 5px; }
    .swagger-ui .opblock-description-wrapper p { line-height: 1.65; }
    .swagger-ui section.models { border-radius: 10px; background: white; }
    .swagger-ui input, .swagger-ui select, .swagger-ui textarea { border-radius: 6px; }
    @media (max-width: 600px) {
      .swagger-ui .wrapper { padding: 0 12px; }
      .swagger-ui .info { margin-top: 18px; padding: 18px; }
      .swagger-ui .info .title { font-size: 27px; }
      .swagger-ui .opblock .opblock-summary-path { font-size: 13px; }
    }
  `,
  swaggerOptions: {
    docExpansion: 'list',
    defaultModelsExpandDepth: 0,
    filter: true,
    deepLinking: true,
    displayRequestDuration: true,
    persistAuthorization: false,
    validatorUrl: null,
    supportedSubmitMethods: ['get', 'post', 'patch', 'delete'],
  },
}));
