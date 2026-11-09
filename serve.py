"""可选：本地静态服务器（直接双击 index.html 也能运行，本脚本仅供需要 http 访问时使用）。
用法：python serve.py [端口]   然后浏览器打开 http://127.0.0.1:8765/
"""
import http.server
import os
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
os.chdir(os.path.dirname(os.path.abspath(__file__)))


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 128  # Windows 默认积压队列过小，并发请求时会被重置
    daemon_threads = True


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'  # 长连接，避免 Windows 上频繁断开连接导致的 ERR_CONNECTION_RESET
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript; charset=utf-8'}

    def copyfile(self, source, outputfile):
        # 一次性读入后整体发送，避免分块写入时被中断
        data = source.read()
        outputfile.write(data)
        outputfile.flush()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


if __name__ == '__main__':
    with Server(('127.0.0.1', PORT), Handler) as httpd:
        print(f'Serving on http://127.0.0.1:{PORT}/', flush=True)
        httpd.serve_forever()
