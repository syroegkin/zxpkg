#!/usr/bin/env python3
# gopher_fetch.py — host-side reference gopher client: connect, send the selector
# + CRLF, read raw until the server closes, write the bytes to stdout.  This is
# byte-for-byte what the device's `.pkg-get` does — used by `make gopher-test`
# to prove a server (ours or Gophernicus) delivers binary-clean.
#
#   python3 gopher_fetch.py <host> <port> <selector>  > out.bin

import socket
import sys

host, port, sel = sys.argv[1], int(sys.argv[2]), sys.argv[3]
s = socket.create_connection((host, port), timeout=10)
s.sendall(sel.encode("latin1") + b"\r\n")
while True:
    chunk = s.recv(4096)
    if not chunk:
        break  # close = gopher end-of-item
    sys.stdout.buffer.write(chunk)
s.close()
