# Gophernicus — the zx.in.net gopher hub. Built from source (no official image),
# fronted by `socat ...,fork` as the per-connection listener on :70 (Gophernicus
# is stdio/inetd-based: it reads one request from stdin and exits).
#
# *** NOT build-tested in the authoring session (no network there). On first
#     `docker compose build gopher`, confirm the clone/make succeed, then byte-
#     compare a fetched file against the source before trusting it with signed
#     artifacts — binary-cleanliness is what the device signature check needs:
#       printf '/pkg/index/v1.dat\r\n' | nc gopher.zx.in.net 70 > got.dat
#       cmp got.dat zxpkg/portal/data/store/index/v1.dat   # must be identical
#     If the build flags/paths drift, check: gophernicus on PATH (make install ->
#     /usr/sbin/gophernicus) and that it serves files raw (no text-mode munging). ***

FROM alpine:3.20

RUN apk add --no-cache socat \
 && apk add --no-cache --virtual .build build-base git autoconf automake \
 && git clone --depth 1 https://github.com/gophernicus/gophernicus /tmp/g \
 && cd /tmp/g \
 && { test -f configure || autoreconf -fi; } \
 && ./configure \
 && make \
 && make install \
 && cd / && rm -rf /tmp/g \
 && apk del .build

EXPOSE 70

# fork a gophernicus per connection; -h = advertised host, -r = the aggregated root.
# su=nobody: socat stays root only to bind :70, but runs gophernicus as an
# unprivileged user (Gophernicus refuses to run as root). nobody must be able to
# read the mounted store (the files are world-readable as the worker writes them).
CMD ["socat", "TCP-LISTEN:70,reuseaddr,fork", \
     "EXEC:gophernicus -h gopher.zx.in.net -r /srv/gopher -w 64,su=nobody"]
