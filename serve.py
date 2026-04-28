"""
Local dev server for spending-chart.html — forces no-cache on every response
so the browser always fetches the latest version of the file.
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
        # Suppress noisy request logging; only show start-up line
        pass

os.chdir(os.path.dirname(os.path.abspath(__file__)))
print('Serving YNAB Dashboard at http://localhost:3131/spending-chart.html')
print('Press Ctrl+C to stop.')
HTTPServer(('', 3131), NoCacheHandler).serve_forever()
