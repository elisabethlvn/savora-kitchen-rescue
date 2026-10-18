# Runtime and reproducibility notes

- package.json pins exact direct versions from the existing npm lockfile. package-lock.json preserves the same integrity-pinned transitive package graph, with kitchen-only root metadata. No dependencies are installed by the exporter.
- Use npm ci, not a lockfile regeneration, for the first clean install. Dependency lifecycle scripts may download the FalkorDB module. Review them according to your normal supply-chain policy.
- The development runtime was macOS arm64, native Redis 8.10.2, and FalkorDB module 4.18.3, loaded by falkordblite 0.3.0. The native Redis executable comes from the operating-system package manager; it is **not** pinned by package-lock.json or bundled here.
- The optional platform-package issue means this is not a guaranteed one-command, offline installation. Do not install a differently named platform bundle merely because its filename looks compatible; verify the native architecture.
- Current-platform source/export build and test checks may reuse existing installed dependencies. They do not establish that npm ci or the native runtime works on a fresh machine. Linux x64 and other environments remain unverified until tested there.
- The exporter writes a standard ZIP with fixed timestamps and an explicit file list. export-manifest.json records SHA-256 hashes of every included source/generated file except the manifest itself. No filesystem metadata, home directory paths, env values or existing database contents are added to that manifest.

Official runtime source: https://github.com/FalkorDB/falkordblite-ts
Troubleshooting: https://github.com/FalkorDB/falkordblite-ts/blob/main/TROUBLESHOOTING.md
