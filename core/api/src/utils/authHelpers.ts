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
 * Get userId from an authenticated request. Returns undefined when the
 * optional-auth middleware ran without credentials (OAuth callbacks
 * redirect unauthenticated users to login instead of attributing work
 * to a shared placeholder account).
 */
export function getUserId(req: FastifyRequest): string | undefined {
  return (req as AuthenticatedRequest).userId;
}
