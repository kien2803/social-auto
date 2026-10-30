import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.js';
import { Field, TextInput } from '../components/ui/Field.js';
import { Button } from '../components/ui/Button.js';

export function RegisterPage() {
  const navigate = useNavigate();
  const { register } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await register(email, password, name);
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-surface-muted px-4 dark:bg-[#1c1917]">
      <div className="max-w-md w-full">
        <div className="card p-8">
          <h1 className="font-display text-2xl font-semibold mb-1 text-center text-ink dark:text-stone-100">Create Account</h1>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-sm text-red-800 text-sm dark:bg-red-500/10 dark:border-red-900/60 dark:text-red-300">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Name" required>
              <TextInput
                type="text"
                value={name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
                placeholder="Your name"
                className="w-full"
              />
            </Field>

            <Field label="Email" required>
              <TextInput
                type="email"
                value={email}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full"
              />
            </Field>

            <Field label="Password" required>
              <TextInput
                type="password"
                value={password}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                placeholder="•••••••••"
                className="w-full"
              />
            </Field>

            <Button
              type="submit"
              disabled={loading}
              className="w-full"
            >
              {loading ? 'Creating account...' : 'Sign Up'}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-ink-muted dark:text-stone-400">
            Already have an account?{' '}
            <Link to="/login" className="text-brand-600 hover:underline dark:text-brand-100">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
