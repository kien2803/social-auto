/**
 * Copyright (c) 2026 Kien Nguyen
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { DB } from '../db.js';
import { randomUUID } from 'node:crypto';

export interface User {
  id: string;
  email: string;
  name: string;
  created_at: number;
}

export interface CreateUserInput {
  email: string;
  password_hash: string;
  name: string;
}

export class UsersRepo {
  constructor(private db: DB) {}

  create(input: CreateUserInput): User {
    const id = randomUUID();
    const now = Date.now();

    this.db.raw.run(
      'INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)',
      [id, input.email, input.password_hash, input.name, now],
    );

    return {
      id,
      email: input.email,
      name: input.name,
      created_at: now,
    };
  }

  insert(input: CreateUserInput & { id?: string }): User {
    const id = input.id ?? randomUUID();
    const now = Date.now();

    this.db.raw.run(
      'INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)',
      [id, input.email, input.password_hash, input.name, now],
    );

    return {
      id,
      email: input.email,
      name: input.name,
      created_at: now,
    };
  }

  findByEmail(email: string): User | null {
    const result = this.db.raw.exec('SELECT * FROM users WHERE email = ?', [email]);
    if (!result || result.length === 0 || result[0].values.length === 0) return null;

    const values = result[0].values[0];

    return {
      id: values[0] as string,
      email: values[1] as string,
      name: values[3] as string,
      created_at: values[4] as number,
    };
  }

  findById(id: string): User | null {
    const result = this.db.raw.exec('SELECT * FROM users WHERE id = ?', [id]);
    if (!result || result.length === 0 || result[0].values.length === 0) return null;

    const values = result[0].values[0];

    return {
      id: values[0] as string,
      email: values[1] as string,
      name: values[3] as string,
      created_at: values[4] as number,
    };
  }

  getPasswordHash(id: string): string | null {
    const result = this.db.raw.exec('SELECT password_hash FROM users WHERE id = ?', [id]);
    if (!result || result.length === 0 || result[0].values.length === 0) return null;

    return result[0].values[0][0] as string;
  }

  getPasswordHashByEmail(email: string): string | null {
    const result = this.db.raw.exec('SELECT password_hash FROM users WHERE email = ?', [email]);
    if (!result || result.length === 0 || result[0].values.length === 0) return null;

    return result[0].values[0][0] as string;
  }
}
