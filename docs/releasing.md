# Releasing to npm

The package is published publicly as `@olsonbd/seats-aero-mcp`. Releases use npm Trusted Publishing from `.github/workflows/release.yml`; no long-lived npm token belongs in GitHub.

## First publication

The first publication requires an npm account that owns the `@olsonbd` scope and has two-factor authentication enabled. Use npm 11.15.0 or newer so the `npm trust` command is available.

1. Make the GitHub repository public so npm can attach provenance to releases.
2. Confirm that `package.json` and the root package entries in `package-lock.json` contain the intended version.
3. From a clean checkout, run `npm ci --ignore-scripts`, `npm test`, `npm run test:package`, and `npm audit --omit=dev --audit-level=moderate`.
4. Authenticate locally with npm and run `npm publish`. The committed `publishConfig` makes the scoped package public.
5. Configure the trusted publisher:

   ```sh
   npm trust github @olsonbd/seats-aero-mcp \
     --repo olsonbd/seats-aero-mcp \
     --file release.yml \
     --allow-publish
   ```

6. In the npm package settings, require two-factor authentication and disallow token-based publishing after the trusted workflow succeeds.

## Subsequent releases

1. Update the version in `package.json` and `package-lock.json` in a reviewed pull request. Update version-pinned installation examples when appropriate.
2. Merge only after CI passes.
3. Create a `v<version>` tag on that exact commit and publish a GitHub release from the tag.
4. Confirm that the Release workflow validates, packs, tests, and publishes the package with provenance.

The workflow refuses to publish when the Git tag, package manifest, and lockfile versions differ. Never reuse or move a published release tag.
