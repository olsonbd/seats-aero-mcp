# Contributing

Contributions that keep this server small, bounded, secure, and compatible with the official Seats.aero API are welcome.

## Development

Use Node.js 20 or newer. The container uses Node.js 26.8; Node.js 24 remains the primary development version and typings baseline. CI covers Node.js 20, 22, 24, and 26.

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run test:package
```

Tests must use fake credentials and deterministic mock responses. Do not spend a contributor's Seats.aero quota in automated tests. Keep credentials, private endpoints, personal travel data, and complete upstream responses out of source, fixtures, logs, issues, and pull requests.

## Pull requests

Keep each change focused and explain its user-visible effect. Add meaningful tests for behavior, protocol, transport, or release-artifact changes. Preserve bounded requests and responses, explicit pagination, quota and freshness metadata, and the distinction between Pro and commercial API features.

Before opening a pull request, run the build and full test suite. Packaging, entrypoint, dependency, or Node.js compatibility changes should also pass the packed-artifact smoke test.

By contributing, you agree that your contribution is licensed under the repository's MIT license.

Maintainers should follow the [release guide](docs/releasing.md) for versioning, npm Trusted Publishing, and provenance.
