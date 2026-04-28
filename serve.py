"""
Static-only local server for ./public.

NOTE: This serves the HTML, CSS, and Chart.js assets, but it does NOT serve
the /api/oauth/* routes that the OAuth flow needs. The dashboard will load
but the "Sign in with YNAB" button will fail with "Could not load OAuth
config" because /api/config returns 404 from this server.

For full OAuth-capable local dev, use Wrangler instead:

    npx wrangler dev

That runs the actual Worker locally on http://localhost:8787, including the
OAuth proxy routes. Make sure you have a .dev.vars file with YNAB_CLIENT_ID
and YNAB_CLIENT_SECRET (see .dev.vars.example).

This script remains useful for: previewing visual changes, working offline,
or browsing the dashboard with already-cached tokens.
"""
import os
from http.server import HTTPServer, SimpleHTTPRequestHandler

class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'public'))
print('Serving static assets at http://localhost:3131/')
print('NOTE: OAuth endpoints will 404. Use `npx wrangler dev` for full OAuth flow.')
print('Press Ctrl+C to stop.')
HTTPServer(('', 3131), NoCacheHandler).serve_forever()
