# Seats.aero Pro MCP

Personal-use award-search MCP server, maintained from [kwonye/seats-aero-mcp](https://github.com/kwonye/seats-aero-mcp) at commit `9905c2b28f6c9de95c1aae87348552f41a511a8a`. The original MIT license and attribution are preserved.

This is an unofficial community project and is not affiliated with or endorsed by Seats.aero. Every user must provide their own eligible Seats.aero API credential. Seats.aero permits Pro API use for non-commercial purposes; commercial use requires a written agreement. Your use of the API remains subject to the [Seats.aero terms and API requirements](https://developers.seats.aero/reference/getting-started-p).

## Behavior

- Pro mode exposes cached search, bulk availability, trips, routes, destinations and explicit cached refresh. Commercial live search is absent from Pro discovery.
- Search defaults to 25 summaries, maximum 100 results. Cursor and `hasMore` are preserved; no automatic pagination. `format=full` retains upstream search fields.
- Trips/routes/destinations expose local `offset`/`limit` pages (25 default, 50 maximum). Each page makes a new upstream request and can change as inventory changes.
- Responses include `meta.fetchedAt`, `quotaRemaining` (null when unknown), UTC quota reset time, and request attempts. The outer `data` contains the upstream result or documented projection.
- HTTP upstream responses are capped at 4 MiB; tool output at 64 KiB. Oversized responses produce a clear error, never a silently truncated itinerary.
- Refresh accepts up to 10 IDs and deduplicates them. Each newly queued ID may consume one daily credit. Poll explicitly at least 10 seconds apart, stop after two minutes, and wait 15 minutes after failed refreshes. There is no background refresh/polling loop.
- Reads retry at most once for HTTP 502/503/504 within a 30-second total deadline. Auth errors, HTTP 429, exhausted quota and POST refreshes are never automatically retried. Long Retry-After values are surfaced rather than ignored.
- HTTP requires a separate bearer token when binding beyond loopback. Browser Origin headers are denied unless explicitly allowed. Upstream error bodies and network exception strings are not exposed.

Cached availability is not a booking guarantee. Check `UpdatedAt`, inspect itineraries, and verify with the booking airline before transferring points. Missing seat counts are unknown. Times and taxes retain upstream representation; do not assume UTC or decimal currency units.

## Install

The default transport is STDIO. Load your Seats.aero API key into the environment from a secret manager or other protected local store. After the first npm release, run the published package:

```sh
export SEATS_AERO_API_KEY="your-key"
npx -y @olsonbd/seats-aero-mcp@0.2.1
```

Do not put the key directly in shell commands, committed configuration, logs, or issue reports.

### Codex

Add this user-level configuration to `~/.codex/config.toml` so it is available across trusted projects:

```toml
[mcp_servers.seats_aero]
command = "npx"
args = ["-y", "@olsonbd/seats-aero-mcp@0.2.1"]
env_vars = ["SEATS_AERO_API_KEY", "SEATS_AERO_PLAN"]
```

Set `SEATS_AERO_API_KEY` before starting Codex. `SEATS_AERO_PLAN` defaults to `pro`; set it to `commercial` only if you have a written commercial API agreement. Codex forwards the named variables from its environment to the STDIO server. See the [Codex MCP documentation](https://developers.openai.com/codex/mcp).

## Develop and test

The Dockerfile pins Node.js 24.18.0. For local development, use the same version; the package declares Node.js 20+ compatibility.

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run test:package
cp .env.example .env
# Enter secrets locally; .env is ignored by git and Docker.
node --env-file=.env dist/index.js --http
```

`/mcp` is authenticated Streamable HTTP. `/health` is a liveness check that makes no Seats.aero API call. Startup requires `SEATS_AERO_API_KEY`; health does not verify its eligibility or validity. Omit `--http` and set `MCP_TRANSPORT=stdio` for STDIO.

The server makes no LLM calls and needs no model API key. It requires eligible Seats.aero API access and an environment that can run Node.js or Docker and reach the Seats.aero API.

## Deployment

Run from source on a Node.js host, or build the committed Dockerfile for a Docker host or container platform. Both build and tests run in the Docker build stage. The runtime image runs as the unprivileged `node` user and contains production dependencies only.

Store `SEATS_AERO_API_KEY` and a separate `MCP_HTTP_BEARER_TOKEN` in your environment's secret store or a protected local environment file. Inject them at **runtime**, never as build arguments or image contents. Use `SEATS_AERO_PLAN=pro`, `MCP_TRANSPORT=http`, `MCP_HTTP_HOST=0.0.0.0`, and `MCP_HTTP_PORT=3000` for container deployments; these are the image defaults.

For a local Docker deployment, populate `.env` as described above, then run:

```sh
docker build -t seats-aero-mcp:local .
docker run -d --name seats-aero-mcp --restart unless-stopped \
  --env-file .env --read-only --cap-drop=ALL \
  -p 127.0.0.1:3000:3000 seats-aero-mcp:local
```

Connect a Streamable HTTP MCP client to `http://127.0.0.1:3000/mcp` and send `Authorization: Bearer <MCP_HTTP_BEARER_TOKEN>`. Do not use the Seats.aero API key as the client credential. Use `/health` for liveness monitoring; it does not validate upstream API access.

For remote access, put the server behind an HTTPS reverse proxy or MCP gateway. Keep the upstream port private, and configure the proxy to support Streamable HTTP. A containerized gateway can reach `http://seats-aero-mcp:3000/mcp` when both containers share a Docker network; configure it to send the server's bearer token. If the gateway has its own client authentication, use that credential at the gateway's public endpoint. Browser clients must also have their exact origins listed in `MCP_ALLOWED_ORIGINS`.

Deploy tested source revisions or versioned images, and retain the preceding tested image for rollback. Do not edit the running container or fetch unpinned packages at startup.

## Sources

- [Seats.aero API access](https://developers.seats.aero/reference/getting-started-p)
- [Cached search](https://developers.seats.aero/reference/cached-search)
- [Refresh charging and polling](https://developers.seats.aero/reference/refresh-cached-data)
