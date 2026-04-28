/**
 * YNAB Spending Dashboard — Cloudflare Worker
 *
 * Serves static assets from ./public and provides three small API routes
 * that proxy YNAB's OAuth token endpoint. The proxy exists for one reason:
 * YNAB requires `client_secret` on /oauth/token even when PKCE is used,
 * so the secret has to live somewhere a browser can't read it.
 *
 * Routes:
 *   GET  /api/config           → { client_id }              (public, used by frontend on boot)
 *   POST /api/oauth/exchange   → exchange auth code for tokens
 *   POST /api/oauth/refresh    → refresh expired access token
 *   *                          → static asset from ./public
 *
 * Environment:
 *   YNAB_CLIENT_ID      — public OAuth client ID (set as a Variable)
 *   YNAB_CLIENT_SECRET  — OAuth client secret (set as a Secret)
 *
 * Local dev: put both in .dev.vars (gitignored) and run `npx wrangler dev`.
 */

const YNAB_TOKEN_URL = 'https://app.ynab.com/oauth/token';

const ALLOWED_ORIGINS = new Set([
  'https://ynab-dashboard.org',
  'http://localhost:3131',
  'http://127.0.0.1:3131',
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight for any /api/ route
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (url.pathname === '/api/config') {
      if (!env.YNAB_CLIENT_ID) {
        return jsonResponse(request, { error: 'server_misconfigured', detail: 'YNAB_CLIENT_ID is not set' }, 500);
      }
      return jsonResponse(request, { client_id: env.YNAB_CLIENT_ID });
    }

    if (url.pathname === '/api/oauth/exchange' && request.method === 'POST') {
      return handleExchange(request, env);
    }

    if (url.pathname === '/api/oauth/refresh' && request.method === 'POST') {
      return handleRefresh(request, env);
    }

    // OAuth redirect lands on /oauth/callback. Serve the SPA's index.html so
    // the in-page handler can read ?code= from the URL and finish the flow.
    // The browser still sees /oauth/callback in the URL bar; the SPA cleans
    // it up via history.replaceState after the token exchange succeeds.
    if (url.pathname === '/oauth/callback') {
      const indexUrl = new URL(url.origin);
      return env.ASSETS.fetch(new Request(indexUrl, request));
    }

    // Anything else falls through to static assets
    return env.ASSETS.fetch(request);
  },
};

// ── OAuth handlers ──────────────────────────────────────────

async function handleExchange(request, env) {
  const body = await safeJson(request);
  if (!body) return jsonResponse(request, { error: 'invalid_json' }, 400);

  const { code, code_verifier, redirect_uri } = body;
  if (!code || !code_verifier || !redirect_uri) {
    return jsonResponse(request, {
      error: 'missing_fields',
      required: ['code', 'code_verifier', 'redirect_uri'],
    }, 400);
  }

  return ynabTokenRequest(request, env, {
    grant_type:    'authorization_code',
    code,
    code_verifier,
    redirect_uri,
  });
}

async function handleRefresh(request, env) {
  const body = await safeJson(request);
  if (!body) return jsonResponse(request, { error: 'invalid_json' }, 400);

  const { refresh_token } = body;
  if (!refresh_token) {
    return jsonResponse(request, { error: 'missing_refresh_token' }, 400);
  }

  return ynabTokenRequest(request, env, {
    grant_type:    'refresh_token',
    refresh_token,
  });
}

async function ynabTokenRequest(request, env, params) {
  if (!env.YNAB_CLIENT_ID || !env.YNAB_CLIENT_SECRET) {
    return jsonResponse(request, {
      error: 'server_misconfigured',
      detail: 'YNAB_CLIENT_ID and YNAB_CLIENT_SECRET must both be set',
    }, 500);
  }

  const form = new URLSearchParams({
    client_id:     env.YNAB_CLIENT_ID,
    client_secret: env.YNAB_CLIENT_SECRET,
    ...params,
  });

  let upstream;
  try {
    upstream = await fetch(YNAB_TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    form.toString(),
    });
  } catch (err) {
    return jsonResponse(request, { error: 'upstream_unreachable', detail: err.message }, 502);
  }

  // YNAB returns JSON on both success and error. Pass it through with the same status.
  // Intentionally do NOT log the body — it contains tokens on success.
  const text = await upstream.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { error: 'upstream_non_json', status: upstream.status }; }
  return jsonResponse(request, parsed, upstream.status);
}

// ── Helpers ─────────────────────────────────────────────────

async function safeJson(request) {
  try { return await request.json(); } catch { return null; }
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const headers = {
    'Vary': 'Origin',
  };
  if (ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin']  = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Max-Age']       = '86400';
  }
  return headers;
}

function jsonResponse(request, obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type':  'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders(request),
    },
  });
}
