import { Link } from 'react-router-dom';

/**
 * Public privacy policy — required by Google OAuth verification, Meta App
 * Review and TikTok partner review. They check that the URL serves a real
 * policy at the app's domain; keep it reachable without auth.
 */
export function PrivacyPage() {
  return (
    <div className="min-h-screen bg-surface text-ink dark:bg-slate-950 dark:text-slate-200">
      <main className="mx-auto max-w-3xl px-4 py-16 md:px-8">
        <h1 className="text-3xl font-semibold">Privacy Policy</h1>
        <p className="mt-2 text-sm text-ink-subtle dark:text-slate-500">Last updated: October 2026</p>

        <section className="mt-8 space-y-4 text-sm leading-relaxed">
          <h2 className="text-lg font-semibold">1. What we collect</h2>
          <p>
            Social Auto stores your account credentials (email, hashed password), the videos you
            upload, your scheduling preferences, and OAuth tokens for the social platforms you
            explicitly connect (YouTube, TikTok, Instagram, Facebook).
          </p>

          <h2 className="text-lg font-semibold">2. How we use it</h2>
          <p>
            OAuth tokens are used solely to publish and manage the content you schedule on your
            behalf. Tokens are encrypted at rest with AES-256-GCM. We do not sell, share, or use
            your data for advertising.
          </p>

          <h2 className="text-lg font-semibold">3. Third-party platforms</h2>
          <p>
            When you connect a platform, your use is also governed by that platform's terms and
            privacy policy (Google/YouTube, TikTok, Meta). We only request the API scopes needed to
            upload and publish videos on your behalf.
          </p>

          <h2 className="text-lg font-semibold">4. Data retention &amp; deletion</h2>
          <p>
            Your data is kept while your account is active. You may disconnect social accounts,
            delete uploaded videos, or delete your account at any time from the app. Deleting your
            account removes your stored videos, scheduled posts, and OAuth tokens.
          </p>

          <h2 className="text-lg font-semibold">5. Contact</h2>
          <p>
            For privacy questions or data requests, contact the site administrator via the support
            channel listed on the application.
          </p>
        </section>

        <p className="mt-10 text-sm">
          <Link to="/" className="text-indigo-600 hover:underline dark:text-indigo-400">
            ← Back to Social Auto
          </Link>
        </p>
      </main>
    </div>
  );
}
