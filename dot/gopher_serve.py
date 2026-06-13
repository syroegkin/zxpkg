#!/usr/bin/env python3
# gopher_serve.py — minimal BINARY-CLEAN gopher server for ZXPkg LAN bring-up.
# Serves files from a root dir: selector = path under the root, raw bytes, then
# close (gopher EOF = connection close).  No text-mode mangling, no dot-stuffing,
# no terminator — exactly the byte-for-byte behaviour the device's signature
# verify requires (and what a correctly-configured Gophernicus does in prod).
#
#   python3 gopher_serve.py <root> [port]      (default port 7070; 70 needs root)
#
# Test from the host:  printf '/index.dat\r\n' | nc <ip> 7070 | cmp - <root>/index.dat

import socket
import sys
from pathlib import Path

root = Path(sys.argv[1] if len(sys.argv) > 1 else "gopher-root").resolve()
port = int(sys.argv[2]) if len(sys.argv) > 2 else 7070

srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("", port))
srv.listen(4)
print(f"gopher_serve: root={root} port={port}  (Ctrl-C to stop)")

while True:
    conn, addr = srv.accept()
    try:
        conn.settimeout(10)
        line = b""
        while not line.endswith(b"\n") and len(line) < 512:
            chunk = conn.recv(64)
            if not chunk:
                break
            line += chunk
        sel = line.strip().decode("latin1")
        path = (root / sel.lstrip("/")).resolve()
        if root in path.parents or path == root:
            if path.is_file():
                data = path.read_bytes()
                conn.sendall(data)
                print(f"{addr[0]} {sel!r} -> {len(data)} bytes")
            else:
                print(f"{addr[0]} {sel!r} -> NOT FOUND")
        else:
            print(f"{addr[0]} {sel!r} -> path escape REFUSED")
    except Exception as e:  # noqa: BLE001 — log and keep serving
        print(f"{addr[0]} error: {e}")
    finally:
        conn.close()  # close = gopher end-of-item
