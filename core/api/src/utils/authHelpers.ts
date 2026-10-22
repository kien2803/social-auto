/**
 * Copyright (c) 2026 Kien Nguyen
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { FastifyRequest } from 'fastify';

export interface AuthenticatedRequest extends FastifyRequest {
  userId?: string;
}

/**
 * Get userId from authenticated request.
 * During migration phase, falls back to 'default-user' if userId is not set.
 * TODO: Remove fallback after all routes require authentication.
 */
export function getUserId(req: FastifyRequest): string {
  const userId = (req as AuthenticatedRequest).userId;
  return userId || 'default-user';
}
