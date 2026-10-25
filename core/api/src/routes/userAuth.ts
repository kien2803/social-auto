/**
 * Copyright (c) 2026 Kien Nguyen
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { FastifyInstance } from 'fastify';
import type { AuthService } from '../services/authService.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

export interface UserAuthRoutesDeps {
  authService: AuthService;
  authMiddleware?: any;
}

/**
 * Brute-force guard for the credential endpoints. In-memory, per-IP —
 * adequate for a self-hosted single-instance deployment; a multi-replica
 * setup would need a shared store instead.
 */
const RATE_LIMIT_WINDOW_MS = 5 * 60_000;
const RATE_LIMIT_MAX = 10;
/** Hard cap on tracked IPs — without it, a spray of unique source
 * addresses grows this map unboundedly. When full, expired entries are
 * dropped first; if the map is still full we fail open (count as a new
 * window) rather than lock everyone out. */
const RATE_LIMIT_MAX_TRACKED_IPS = 10_000;
const attempts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || rec.resetAt < now) {
    if (attempts.size >= RATE_LIMIT_MAX_TRACKED_IPS) {
      for (const [k, v] of attempts) {
        if (v.resetAt < now) attempts.delete(k);
      }
      if (attempts.size >= RATE_LIMIT_MAX_TRACKED_IPS) attempts.clear();
    }
    attempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  rec.count += 1;
  return rec.count > RATE_LIMIT_MAX;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function registerUserAuthRoutes(app: FastifyInstance, deps: UserAuthRoutesDeps) {
  const { authService } = deps;
  const auth = deps.authMiddleware ? { preHandler: deps.authMiddleware } : {};

  // POST /auth/register - Register a new user
  app.post('/auth/register', async (request, reply) => {
    if (isRateLimited(request.ip)) {
      return reply.status(429).send({ error: 'Too many attempts, try again later' });
    }
    try {
      const body = request.body as { email?: string; password?: string; name?: string };

      if (!body.email || !body.password || !body.name) {
        return reply.status(400).send({
          error: 'Missing required fields: email, password, name',
        });
      }

      if (!EMAIL_RE.test(body.email)) {
        return reply.status(400).send({ error: 'Invalid email format' });
      }

      if (body.password.length < 6) {
        return reply.status(400).send({
          error: 'Password must be at least 6 characters',
        });
      }

      const result = await authService.register(body.email, body.password, body.name);

      return reply.status(201).send(result);
    } catch (error) {
      if (error instanceof Error && error.message === 'Email already registered') {
        return reply.status(409).send({
          error: error.message,
        });
      }

      app.log.error(error);
      return reply.status(500).send({
        error: 'Internal server error',
      });
    }
  });

  // POST /auth/login - Login user
  app.post('/auth/login', async (request, reply) => {
    if (isRateLimited(request.ip)) {
      return reply.status(429).send({ error: 'Too many attempts, try again later' });
    }
    try {
      const body = request.body as { email?: string; password?: string };

      if (!body.email || !body.password) {
        return reply.status(400).send({
          error: 'Missing required fields: email, password',
        });
      }

      const result = await authService.login(body.email, body.password);

      return reply.send(result);
    } catch (error) {
      if (error instanceof Error && error.message === 'Invalid email or password') {
        return reply.status(401).send({
          error: error.message,
        });
      }

      app.log.error(error);
      return reply.status(500).send({
        error: 'Internal server error',
      });
    }
  });

  // POST /auth/change-password - verify current, then rehash
  app.post('/auth/change-password', auth, async (request, reply) => {
    try {
      const userId = (request as AuthenticatedRequest).userId;
      const body = request.body as { current_password?: string; new_password?: string };
      if (!body.current_password || !body.new_password) {
        return reply.status(400).send({ error: 'Missing current_password or new_password' });
      }
      if (body.new_password.length < 6) {
        return reply.status(400).send({ error: 'Password must be at least 6 characters' });
      }
      const hash = authService.getPasswordHash(userId);
      if (!hash || !(await authService.verifyPassword(body.current_password, hash))) {
        return reply.status(401).send({ error: 'Current password is incorrect' });
      }
      authService.updatePassword(userId, await authService.hashPassword(body.new_password));
      // NOTE: existing JWTs remain valid until expiry — there is no token
      // revocation yet, so advise the client to log in again.
      return reply.send({ success: true });
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // PATCH /auth/me - update profile fields (name only for now)
  app.patch('/auth/me', auth, async (request, reply) => {
    try {
      const userId = (request as AuthenticatedRequest).userId;
      const body = request.body as { name?: string };
      if (!body.name || !body.name.trim() || body.name.length > 100) {
        return reply.status(400).send({ error: 'Invalid name' });
      }
      authService.updateName(userId, body.name.trim());
      const user = authService.getUserById(userId);
      return reply.send({ id: user!.id, email: user!.email, name: user!.name, created_at: user!.created_at });
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // DELETE /auth/me - delete account + all owned data (FK cascade)
  app.delete('/auth/me', auth, async (request, reply) => {
    try {
      const userId = (request as AuthenticatedRequest).userId;
      authService.deleteUser(userId);
      return reply.send({ success: true });
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /auth/me - Get current user info
  app.get('/auth/me', auth, async (request, reply) => {
    try {
      const userId = (request as AuthenticatedRequest).userId;
      const user = authService.getUserById(userId);

      if (!user) {
        return reply.status(404).send({
          error: 'User not found',
        });
      }

      return reply.send({
        id: user.id,
        email: user.email,
        name: user.name,
        created_at: user.created_at,
      });
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({
        error: 'Internal server error',
      });
    }
  });
}
