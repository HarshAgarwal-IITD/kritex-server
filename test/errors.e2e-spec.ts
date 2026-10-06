import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp } from './utils';

describe('Error shape (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('unknown routes → 404 NOT_FOUND', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });

  it('routes are only served under /api/v1', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(404);
  });

  it('wrong method on a known path → 404 NOT_FOUND', async () => {
    const res = await request(app.getHttpServer()).delete('/api/v1/queries').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
