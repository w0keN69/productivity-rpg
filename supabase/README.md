# In Track Cloud Setup

The database schema is in `supabase/schema.sql`.

Authentication adapter: `services/auth.js`.

Configure `config.js` in the repository:
```js
window.INTRACK_SUPABASE_CONFIG={
  url:'https://YOUR_PROJECT.supabase.co',
  anonKey:'YOUR_PUBLIC_ANON_KEY'
};
```

The browser may contain the Supabase **anon/public** key. RLS is what protects user data. Never put a `service_role` key in `config.js`.

Only use the Supabase anon/public key in browser configuration. Never expose a service_role key.

Flow:
1. Supabase Auth creates `auth.users`.
2. The database trigger creates profile, settings, player stats and streak rows.
3. RLS limits user-owned rows to the authenticated user.
4. XP, coins, streaks and other game-critical mutations will later use trusted server-side RPCs.
