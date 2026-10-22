/**
 * Copyright (c) 2026 Kien Nguyen
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AuthService } from '../services/authService.js';

export interface AuthenticatedRequest extends FastifyRequest {
  userId: string;
}

export function createAuthMiddleware(authService: AuthService, required: boolean = true) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const token = request.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        if (required) {
          return reply.status(401).send({
            error: 'Missing authorization token',
          });
        }
        // For optional auth, continue without userId
        return;
      }

      const { userId } = authService.verifyToken(token);

      // Attach userId to request for use in route handlers
      (request as AuthenticatedRequest).userId = userId;
    } catch (error) {
      if (error instanceof Error && error.message === 'Invalid or expired token') {
        if (required) {
          return reply.status(401).send({
            error: error.message,
          });
        }
        // For optional auth, continue without userId
        return;
      }

      if (required) {
        return reply.status(401).send({
          error: 'Authentication failed',
        });
      }
    }
  };
}
