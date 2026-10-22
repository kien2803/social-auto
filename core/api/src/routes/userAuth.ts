/**
 * Copyright (c) 2026 Kien Nguyen
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { FastifyInstance } from 'fastify';
import type { AuthService } from '../services/authService.js';

export interface UserAuthRoutesDeps {
  authService: AuthService;
}

export function registerUserAuthRoutes(app: FastifyInstance, deps: UserAuthRoutesDeps) {
  const { authService } = deps;

  // POST /auth/register - Register a new user
  app.post('/auth/register', async (request, reply) => {
    try {
      const body = request.body as { email?: string; password?: string; name?: string };

      if (!body.email || !body.password || !body.name) {
        return reply.status(400).send({
          error: 'Missing required fields: email, password, name',
        });
      }

      // Basic validation
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

  // GET /auth/me - Get current user info
  app.get('/auth/me', async (request, reply) => {
    try {
      const token = request.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        return reply.status(401).send({
          error: 'Missing authorization token',
        });
      }

      const { userId } = authService.verifyToken(token);
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
      if (error instanceof Error && error.message === 'Invalid or expired token') {
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
}
