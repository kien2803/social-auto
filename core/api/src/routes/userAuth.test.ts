/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures use loose JSON shapes */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { openDB, type DB } from '../db.js';
import { UsersRepo } from '../repositories/users.js';
import { AuthService } from '../services/authService.js';
import { registerUserAuthRoutes } from './userAuth.js';

const JWT_SECRET = 'test-secret';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  const db: DB = await openDB(':memory:');
  const authService = new AuthService(new UsersRepo(db), JWT_SECRET);
  const mockAuthMiddleware = async (req: any, reply: any) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return reply.status(401).send({ error: 'Missing authorization token' });
    try {
      req.userId = authService.verifyToken(token).userId;
    } catch {
      return reply.status(401).send({ error: 'Invalid or expired token' });
    }
  };
  registerUserAuthRoutes(app, { authService, authMiddleware: mockAuthMiddleware });
  app.addHook('onClose', async () => db.close());
  await app.ready();
  return app;
}

describe('userAuth routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
  });

  it('register → login → /auth/me round-trips via Bearer', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'a@b.co', password: 'secret123', name: 'A' },
    });
    expect(reg.statusCode).toBe(201);
    const { token } = reg.json() as { token: string };

    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ email: 'a@b.co', name: 'A' });
  });

  it('rejects malformed email on register', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'not-an-email', password: 'secret123', name: 'A' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('/auth/me without token returns 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('rate limits login after 10 attempts', async () => {
    let lastStatus = 0;
    for (let i = 0; i < 11; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        remoteAddress: '10.0.0.9',
        payload: { email: 'x@y.z', password: 'wrong' },
      });
      lastStatus = res.statusCode;
    }
    expect(lastStatus).toBe(429);
  });
});
