import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

export const SWAGGER_PATH = 'docs';
export const BEARER_SCHEME = 'session';
export const INTERNAL_TOKEN_SCHEME = 'internalToken';

export function buildOpenApiDocument(
  app: INestApplication,
  version: string,
): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('WMC PMS Onboarding API')
    .setDescription(
      'Backend for JioBlackRock PMS customer onboarding. All errors use the {error:{code,message,retryable},request_id} envelope.',
    )
    .setVersion(version)
    .addBearerAuth({ type: 'http', scheme: 'bearer' }, BEARER_SCHEME)
    .addApiKey(
      { type: 'apiKey', in: 'header', name: 'X-Internal-Token' },
      INTERNAL_TOKEN_SCHEME,
    )
    .addGlobalParameters({
      name: 'X-Correlation-ID',
      in: 'header',
      required: false,
      schema: { type: 'string', maxLength: 128 },
      description:
        'Caller-supplied correlation id; generated when absent and echoed back.',
    })
    .build();
  return SwaggerModule.createDocument(app, config);
}

export function setupSwagger(
  app: INestApplication,
  version: string,
): OpenAPIObject {
  const document = buildOpenApiDocument(app, version);
  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    jsonDocumentUrl: `${SWAGGER_PATH}-json`,
  });
  return document;
}
