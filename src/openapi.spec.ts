import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { buildOpenApiDocument, configureApp } from './app.setup';

type Schema = Record<string, unknown> & { properties?: Record<string, Record<string, unknown>> };

/**
 * Guards the contract the website generates types from. The app is created but
 * never initialised, so no DB connection is needed.
 */
describe('OpenAPI document', () => {
  let app: INestApplication;
  let doc: OpenAPIObject;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    doc = buildOpenApiDocument(app);
  });

  afterAll(async () => {
    await app.close();
  });

  const schema = (name: string) => doc.components?.schemas?.[name] as Schema;

  it('exposes the v1 routes with stable operation ids', () => {
    expect(doc.paths['/api/v1/health']?.get?.operationId).toBe('getHealth');
    expect(doc.paths['/api/v1/queries']?.post?.operationId).toBe('createQuery');
    expect(doc.paths['/api/v1/queries']?.get?.operationId).toBe('listQueries');
    expect(doc.paths['/api/v1/queries']?.get?.security).toEqual([{ session: [] }]);
  });

  it('documents request and response bodies', () => {
    expect(schema('CreateQueryDto').required).toEqual(['name', 'email', 'requirements']);
    expect(schema('CreateQueryResponseDto_Output').required).toEqual(['id', 'createdAt']);
    expect(schema('ErrorResponseDto').required).toEqual(['error']);
  });

  it('renders nullable fields as nullable scalars (not arrays)', () => {
    expect(schema('QueryDto_Output').properties?.organization).toEqual({
      type: 'string',
      nullable: true,
    });
  });
});
