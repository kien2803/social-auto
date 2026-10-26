/** Async D1 users repo — mirrors core/api repositories/users.ts. */

export interface User {
  id: string;
  email: string;
  name: string;
  created_at: number;
}

export class UsersRepo {
  constructor(private db: D1Database) {}

  async insert(input: { email: string; password_hash: string; name: string; id?: string }): Promise<User> {
    const id = input.id ?? crypto.randomUUID();
    const now = Date.now();
    await this.db
      .prepare('INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, input.email, input.password_hash, input.name, now)
      .run();
    return { id, email: input.email, name: input.name, created_at: now };
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.db
      .prepare('SELECT id, email, name, created_at FROM users WHERE email = ?')
      .bind(email)
      .first<User>();
  }

  async findById(id: string): Promise<User | null> {
    return this.db
      .prepare('SELECT id, email, name, created_at FROM users WHERE id = ?')
      .bind(id)
      .first<User>();
  }

  async getPasswordHash(id: string): Promise<string | null> {
    const row = await this.db
      .prepare('SELECT password_hash FROM users WHERE id = ?')
      .bind(id)
      .first<{ password_hash: string }>();
    return row?.password_hash ?? null;
  }
}
