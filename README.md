# Seats.aero MCP v2 Server

An MCP v2 server for the Seats.aero partner API. It supports local stdio and Streamable HTTP transports.

Published package: [`@kwonye/seats-aero-mcp`](https://www.npmjs.com/package/@kwonye/seats-aero-mcp)

## Requirements

- Node.js 20+
- A Seats.aero commercial partner key or eligible Pro API key

## Configuration

```sh
export SEATS_AERO_API_KEY='your-key'
export SEATS_AERO_PLAN='pro' # pro or commercial
```

Optional settings:

```sh
export SEATS_AERO_REQUEST_TIMEOUT_MS=30000
export MCP_HTTP_HOST=127.0.0.1
export MCP_HTTP_PORT=3000
export MCP_HTTP_BEARER_TOKEN='required-for-non-loopback-http'
```

Pro mode supports cached search, bulk availability, trips, routes, destinations, and cached refresh. Commercial mode supports all of those except cached refresh and adds Live Search. Seats.aero controls eligibility, quotas, and commercial-use permissions.

## Run

```sh
npm install
npm run build
npm start
```

Or run the published CLI directly:

```sh
npx @kwonye/seats-aero-mcp
```

The default transport is stdio. To run Streamable HTTP:

```sh
npm run start:http
```

The MCP endpoint is `/mcp`.

## Tools

- `seats_aero_cached_search`
- `seats_aero_bulk_availability`
- `seats_aero_get_trips`
- `seats_aero_get_routes`
- `seats_aero_get_destinations`
- `seats_aero_refresh_cached_data` — Pro only
- `seats_aero_live_search` — commercial only

Refresh calls return the upstream asynchronous status. Repeat the same availability IDs to poll; do not use IDs returned by Live Search with other endpoints.

## Test

```sh
npm test
```

## Publishing

Releases are published by GitHub Actions using npm Trusted Publishing (GitHub
OIDC), matching the `kwonye/yahoo-fantasy-mcp` setup. The workflow requires no
long-lived npm token and publishes the version represented by the GitHub
release tag.

Bootstrap the initial package publication once with an npm-authenticated
publish. After the package exists, configure its npm trusted publisher with
GitHub owner `kwonye`, repository `seats-aero-mcp`, and workflow filename
`release.yml`; then remove any temporary npm token and use Trusted Publishing
for subsequent releases.

With npm CLI 11.15 or newer, the trusted publisher can be configured with:

```sh
npm trust github @kwonye/seats-aero-mcp \
  --repo kwonye/seats-aero-mcp \
  --file release.yml \
  --allow-publish
```
