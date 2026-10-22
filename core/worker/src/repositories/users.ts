import type { UserRow } from '@social-auto/shared';
import type { DB } from '../db.js';
import { randomUUID } from 'node:crypto';

export interface NewUser {
  id?: string;
  email: string;
  password_hash: string;
  name: string;
}

export class UsersRepo {
  constructor(private db: DB) {}

  insert(input: NewUser): UserRow {
    const row: UserRow = {
      id: input.id ?? randomUUID(),
      email: input.email,
      password_hash: input.password_hash,
      name: input.name,
      created_at: Date.now(),
    };
    this.db.raw.run(
      `INSERT INTO users (id, email, password_hash, name, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [row.id, row.email, row.password_hash, row.name, row.created_at],
    );
    return row;
  }

  findById(id: string): UserRow | null {
    const result = this.db.raw.exec('SELECT * FROM users WHERE id = ?', [id]);
    const first = result[0]?.values[0];
    if (!first) return null;
    return {
      id: first[0] as string,
      email: first[1] as string,
      password_hash: first[2] as string,
      name: first[3] as string,
      created_at: first[4] as number,
    };
  }

  findByEmail(email: string): UserRow | null {
    const result = this.db.raw.exec('SELECT * FROM users WHERE email = ?', [email]);
    const first = result[0]?.values[0];
    if (!first) return null;
    return {
      id: first[0] as string,
      email: first[1] as string,
      password_hash: first[2] as string,
      name: first[3] as string,
      created_at: first[4] as number,
    };
  }
}
