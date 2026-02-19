from http.server import HTTPServer, SimpleHTTPRequestHandler

class CORSRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        # Optional: allow more methods if you ever need POST etc.
        # self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        # self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

if __name__ == "__main__":
    port = 8000
    server = HTTPServer(("localhost", port), CORSRequestHandler)
    print(f"Serving at http://localhost:{port} with CORS enabled")
    server.serve_forever()
