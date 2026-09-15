# Deployment verification

See the [README](../README.md#deployment) for Node.js and Docker setup, runtime configuration, and MCP client connection details. This guide applies to a local host, virtual machine, or container platform.

## Prepare a release

1. Select a source revision and run `npm ci --ignore-scripts`, `npm run build`, and `npm test`. The Dockerfile also runs the build and tests before producing the runtime image.
2. Tag the resulting image or record the tested source revision. Retain the preceding tested release for rollback.
3. Inject `SEATS_AERO_API_KEY` and a separate `MCP_HTTP_BEARER_TOKEN` at runtime through your secret store or protected environment file. Never include credentials in build arguments, images, logs, or committed files.
4. For HTTP container deployments, bind the server to `0.0.0.0:3000` inside the container. Keep the host port private and use an HTTPS reverse proxy or MCP gateway for remote access.

## Verify the deployment

1. Check that the process starts successfully and `GET /health` returns HTTP 200. This is a liveness check; it makes no Seats.aero API call and does not validate the API key.
2. Verify that the server's `/mcp` endpoint rejects missing and incorrect bearer tokens when bearer authentication is configured. The public proxy or gateway may enforce additional authentication independently.
3. Connect an authenticated Streamable HTTP MCP client through the intended client endpoint. Initialize a session and list tools. Pro mode should expose seven tools and no commercial live-search tool.
4. Run a small cached search with a bounded result count. Check freshness, quota metadata, and pagination. If results exist, inspect one availability ID with the trips tool. These checks consume API quota; cached results are not a booking guarantee.
5. Restart the service and repeat initialization and tool discovery with a fresh client to verify recovery and runtime configuration persistence.

Cached refresh changes upstream state and can consume additional quota. Exercise it only when needed, using the documented batch and polling limits.

## Runtime and recovery

The container runs as an unprivileged user. Its entrypoint sets `--no-new-privs` in the server process. Use a read-only filesystem and drop container capabilities as shown in the README. Set memory and CPU limits appropriate to your environment and workload.

The Docker image includes a Node.js-based health check and `curl` for container platforms that execute their own HTTP probe inside the container. If using a platform-managed probe, point it at `/health` on the configured internal HTTP port.

To roll back, redeploy the preceding tested image or source revision with the required runtime configuration. Recheck liveness and authenticated tool discovery. Do not patch running containers or download unpinned packages at startup.

Keep actual deployment identifiers, hostnames, authentication arrangements, and incident records in private operational documentation outside this repository.
