# Project instructions

Keep this a small, personal-use Seats.aero Pro MCP server, based on kwonye/seats-aero-mcp.
Preserve the upstream MIT license and attribution. Keep secrets out of source, logs and fixtures.
Use the official Seats.aero API. Never substitute scraping or advertise live search to Pro users.
Keep requests and responses bounded. Surface quota/freshness and pagination without silently dropping results.
Validate changes with `npm run build` and `npm test`; transport changes require real local HTTP tests.
For deployment work, use a tested source revision or versioned image and verify it through the target environment's MCP client endpoint.
Keep environment-specific endpoints, resource identifiers, credentials and operational records outside this public repository. Use portable examples in documentation.
Do not activate paid hosting or model services. The server does not need an LLM API key.
