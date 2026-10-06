import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './utils';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('GET /api/v1/health → 200 { status: "ok" } with a request id', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toEqual(expect.any(String));
  });

  it('echoes a well-formed incoming x-request-id', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('x-request-id', 'abc-123')
      .expect(200);
    expect(res.headers['x-request-id']).toBe('abc-123');
  });

  it('returns 503 SERVICE_UNAVAILABLE in the error shape when the DB is down', async () => {
    jest
      .spyOn(app.get(PrismaService), '$queryRaw')
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(503);
    expect(res.body).toEqual({
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Database unavailable' },
    });
  });

  it('sets security headers (helmet) and CORS for allowed origins only', async () => {
    const allowed = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:8080')
      .expect(200);
    expect(allowed.headers['x-content-type-options']).toBe('nosniff');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:8080');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const denied = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'https://evil.example')
      .expect(200);
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
