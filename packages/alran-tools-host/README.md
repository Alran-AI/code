# @alran/alran-tools-host

Host-neutral Node.js lifecycle for an embedded `alran-tools` artifact. The package validates the
versioned artifact, starts the local OAuth lease broker, installs profile-scoped launchers and owns
their cleanup.

The host remains the only credential-store, Refresh Token, refresh and logout owner. The host OAuth
Core persists credentials in its profile-scoped `auth.json`; this package and the embedded child
only receive short-lived Access Token leases. This package depends on `@alran/oauth-lease-protocol`;
it must not depend on Electron, `@alran/oauth-core` or a credential store.

Generated launchers clear inherited sandbox, API/auth URL, client and scope overrides before setting
the host-owned shared-broker coordinates. This keeps Desktop and TUI on the artifact's baked
business API profile while a lease is in use.

## Built-in resources and the system proxy

The system proxy discovery and the initialisation of the Node fetch are handled by the newer
alran-tools CLI itself. The host only provides the authentication broker and the distribution of
the resources; it injects no proxy address and does not copy the business domain mapping of the CLI.

The resource check stays compatible with the old schema v3. Schema v4 allows the CLI, the
registry-js license and the prebuilt Windows x64/arm64/ia32 files; it verifies the complete set of
resources and their SHA-256 and rejects symbolic links. `resource-manifest.mjs` is used by the
runtime, by the Desktop/TUI packaging and by the acceptance of the build output; the packaging
pins the SHA-256 of the v4 manifest, and the pinned hashes of the native resources are compiled
into the CLI.
