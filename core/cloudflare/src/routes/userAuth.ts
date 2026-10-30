import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { UsersRepo } from '../repos/users';
import { signToken, verifyToken } from '../lib/jwt';
import type { Env } from '../env';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SALT_ROUNDS = 10;

// bcryptjs can't find a RNG at module-init time under workerd — point it at
// WebCrypto and compute the timing-equalizer hash lazily inside the handler.
bcrypt.setRandomFallback((len) => Array.from(crypto.getRandomValues(new Uint8Array(len))));
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
  // Minimum bar for a SaaS facing real users: 8+ chars with a letter and
  // a digit — blocks 'password1'-tier and pure-letter/numeric choices.
  if (body.password.length < 8 || !/[a-zA-Z]/.test(body.password) || !/\d/.test(body.password)) {
    return c.json({ error: 'Password must be at least 8 characters with a letter and a number' }, 400);
  }

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

/** Bearer JWT → userId, or null. */
async function bearerUserId(c: { req: { header: (n: string) => string | undefined }; env: Env }): Promise<string | null> {
  const h = c.req.header('authorization');
  if (!h?.startsWith('Bearer ')) return null;
  try {
    return await verifyToken(h.slice(7), c.env.JWT_SECRET);
  } catch {
    return null;
  }
}

userAuthRoutes.get('/auth/me', async (c) => {
  const userId = await bearerUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const user = await new UsersRepo(c.env.DB).findById(userId);
  if (!user) return c.json({ error: 'User not found' }, 404);
  return c.json(user);
});

userAuthRoutes.patch('/auth/me', async (c) => {
  const userId = await bearerUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const body = (await c.req.json().catch(() => null)) as { name?: string } | null;
  if (!body?.name?.trim() || body.name.length > 100) return c.json({ error: 'Invalid name' }, 400);
  const users = new UsersRepo(c.env.DB);
  await users.updateName(userId, body.name.trim());
  return c.json(await users.findById(userId));
});

userAuthRoutes.delete('/auth/me', async (c) => {
  const userId = await bearerUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  await new UsersRepo(c.env.DB).deleteById(userId);
  return c.json({ success: true });
});

userAuthRoutes.post('/auth/change-password', async (c) => {
  const userId = await bearerUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const body = (await c.req.json().catch(() => null)) as
    | { current_password?: string; new_password?: string }
    | null;
  if (!body?.current_password || !body.new_password || body.new_password.length < 6) {
    return c.json({ error: 'Invalid request' }, 400);
  }
  const users = new UsersRepo(c.env.DB);
  const hash = await users.getPasswordHash(userId);
  if (!hash || !(await bcrypt.compare(body.current_password, hash))) {
    return c.json({ error: 'Current password is incorrect' }, 400);
  }
  await users.updatePasswordHash(userId, await bcrypt.hash(body.new_password, SALT_ROUNDS));
  return c.json({ success: true });
});
