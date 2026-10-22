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
      // OAuth start/callback are browser navigations, so Authorization is
      // absent there — the SPA drops the JWT into an `oauth_token` cookie
      // before navigating and the callback picks it up on the way back.
      // Only optional-auth routes accept the cookie; required-auth API
      // routes stay Bearer-only so the cookie can't widen the CSRF surface.
      const token =
        request.headers.authorization?.replace('Bearer ', '') ??
        (!required ? request.cookies?.['oauth_token'] : undefined);

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
