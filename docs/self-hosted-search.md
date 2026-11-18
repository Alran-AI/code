# Self-hosted web search

Alran Code's `web_search` tool calls a search backend directly. You can run your own instead of
bringing a provider key: one Docker container, no account, no per-query fee. This page is the whole
procedure.

## Why run your own

- **No key, no signup, no bill.** The instance queries public search engines itself.
- **Your IP, your quota.** Requests leave your machine, so nobody else's traffic shares your
  reputation or your limits.
- **Private by default.** Queries are not logged (configuration below).

The trade-off: a self-hosted instance scrapes the engines it queries, which is slower and less
reliable than a paid API. If you need guaranteed freshness and ranking, use a provider key
(`BRAVE_API_KEY`, `SERPER_API_KEY`, `TAVILY_API_KEY`) instead — see the README. A key wins over
this option; `SEARXNG_URL` is used only when no key is set.

## 1. Start the container

Create a directory and a `docker-compose.yml`:

```yaml
services:
  searxng:
    image: docker.io/searxng/searxng:latest
    container_name: searxng
    restart: unless-stopped
    # Bind to loopback only. Do not expose this to the internet: it is an open proxy.
    ports:
      - "127.0.0.1:8080:8080"
    volumes:
      - ./searxng:/etc/searxng:rw
    environment:
      # Replace with the output of: openssl rand -hex 32
      - SEARXNG_SECRET=change-me
    mem_limit: 512m
    cpus: 1.0
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - CHOWN
      - SETGID
      - SETUID
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "2"
```

Start it once so it writes its default settings, then stop it:

```bash
docker compose up -d
sleep 10
docker compose down
```

## 2. Turn on the JSON API and turn off query logging

The image writes only a three-line `searxng/settings.yml`. **Replace the whole file** with the
following — it keeps `use_default_settings` (so the engine list stays) and adds what the JSON API
needs:

```yaml
use_default_settings: true

server:
  secret_key: "change-me"      # same value as SEARXNG_SECRET above
  limiter: false               # single user on loopback: no rate limiter
  public_instance: false
  image_proxy: false

search:
  formats:
    - html
    - json                     # required for /search?format=json

# ERROR, not WARNING: WARNING logs upstream request URLs, which carry the query.
logging:
  loglevel: ERROR
```

The `json` entry under `formats` is the part that matters. Without it the endpoint answers `403`
even though the container runs fine.

## 3. Start it for real

```bash
docker compose up -d
sleep 10
curl 'http://127.0.0.1:8080/search?q=test&format=json' | head -c 200
```

You should get JSON back with a `results` array.

## 4. Point Alran Code at it

```bash
export SEARXNG_URL='http://127.0.0.1:8080'
alran
```

That is all. `web_search` now queries your instance.

Use an IPv6 literal in brackets if you bind one: `http://[::1]:8080`.

## 5. If you put a gateway in front

To share one instance between several people, do not expose SearXNG directly. Put a small proxy in
front that checks a key, and give each person their own key:

```bash
export SEARXNG_URL='https://search.example.com'
export SEARXNG_API_KEY='…'    # sent as X-Api-Key
```

SearXNG has no authentication of its own, so an exposed instance is an open proxy that anyone can
query through your IP.

## Notes

- **Do not expose port 8080 to the internet.** SearXNG has no accounts and no rate limiting for
  single-user setups; a public instance gets found and abused.
- **Engine availability changes.** Search engines block scrapers without warning. If results drop,
  check the instance log and disable the failing engine in `settings.yml`.
- **No query logging** depends on `logging.loglevel: ERROR`. At `WARNING` the upstream request URL
  is written to the log, query included.
