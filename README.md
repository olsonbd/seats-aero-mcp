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
