"""Threaded static file server with caching fully disabled.

Plain `python -m http.server` lets browsers (and the in-app preview pane)
cache JS/CSS across reloads, which makes verifying a fresh code change look
like it "didn't take" until a hard-refresh. This wrapper sends
Cache-Control: no-store on every response and serves requests on threads so
one slow request doesn't block the rest.
"""
import sys
import http.server
import socketserver


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8124
    with ThreadedHTTPServer(('', port), NoCacheHandler) as httpd:
        print('Serving (no-cache) on port', port)
        httpd.serve_forever()
