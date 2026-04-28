"""
Local dev server — serves ./public with no-cache headers so the browser
always fetches the latest version of the file.
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
print('Serving YNAB Dashboard at http://localhost:3131/')
print('Press Ctrl+C to stop.')
HTTPServer(('', 3131), NoCacheHandler).serve_forever()
