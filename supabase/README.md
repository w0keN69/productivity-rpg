# In Track Cloud Setup

The application is ready for Supabase authentication, but credentials are intentionally not committed to the repository.

## Required browser configuration

Provide:

    window.INTRACK_SUPABASE_CONFIG = {
      url: 'https://YOUR_PROJECT.supabase.co',
      anonKey: 'YOUR_PUBLIC_ANON_KEY'
    };

Only use the Supabase anon/public key in the browser. Never expose a service_role key.

The database schema is in supabase/schema.sql.

## Authentication flow

1. User creates an account with email/password.
2. Supabase Auth creates auth.users.
3. The database trigger creates the user's profile, settings, player stats and streak record.
4. RLS limits database rows to the authenticated user's user_id.
5. Trusted server-side functions will handle XP, coins, streaks and reward mutations before cloud sync is enabled.
