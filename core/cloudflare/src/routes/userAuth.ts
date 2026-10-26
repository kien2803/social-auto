import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { UsersRepo } from '../repos/users';
import { signToken } from '../lib/jwt';
import type { Env } from '../env';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SALT_ROUNDS = 10;

// bcryptjs can't find a RNG at module-init time under workerd — point it at
// WebCrypto and compute the timing-equalizer hash lazily inside the handler.
bcrypt.setRandomFallback((len) => crypto.getRandomValues(new Uint8Array(len)));
let dummyHash: string | null = null;
function getDummyHash(): string {
  return (dummyHash ??= bcrypt.hashSync('timing-equalizer', SALT_ROUNDS));
}

export const userAuthRoutes = new Hono<{ Bindings: Env }>();

userAuthRoutes.post('/auth/register', async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { email?: string; password?: string; name?: string }
    | null;
  if (!body?.email || !body.password || !body.name) {
    return c.json({ error: 'Missing required fields: email, password, name' }, 400);
  }
  if (!EMAIL_RE.test(body.email)) return c.json({ error: 'Invalid email format' }, 400);
  if (body.password.length < 6) return c.json({ error: 'Password must be at least 6 characters' }, 400);

  const users = new UsersRepo(c.env.DB);
  if (await users.findByEmail(body.email)) {
    return c.json({ error: 'Email already registered' }, 409);
  }
  const password_hash = await bcrypt.hash(body.password, SALT_ROUNDS);
  const user = await users.insert({ email: body.email, password_hash, name: body.name });
  const token = await signToken(user.id, c.env.JWT_SECRET);
  return c.json({ token, user: { id: user.id, email: user.email, name: user.name } }, 201);
});

userAuthRoutes.post('/auth/login', async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { email?: string; password?: string }
    | null;
  if (!body?.email || !body.password) {
    return c.json({ error: 'Missing required fields: email, password' }, 400);
  }
  const users = new UsersRepo(c.env.DB);
  const user = await users.findByEmail(body.email);
  const hash = user ? await users.getPasswordHash(user.id) : null;
  const valid = await bcrypt.compare(body.password, hash ?? getDummyHash());
  if (!user || !valid) return c.json({ error: 'Invalid email or password' }, 401);
  const token = await signToken(user.id, c.env.JWT_SECRET);
  return c.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});
