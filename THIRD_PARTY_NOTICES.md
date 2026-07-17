# Third-party notices

The alpha build and compatibility suite use these pinned projects:

- Hono 4.12.30, MIT license (`vendor/hono/LICENSE`).
- TypeScript 5.9.3, Apache-2.0 license.
- rusqlite 0.40.1 and its Rust dependencies under their published licenses.
- SQLite 3.53.2 amalgamation, public domain.
- libcurl as provided by the target system and licensed by its distributor.
- Test262, BSD-3-Clause license (`vendor/test262/LICENSE`).

Release archives bundle the compiler/runtime source inputs, TypeScript runtime
package, SDK declarations, and these notices. They do not bundle Hono or
Test262; applications install their own npm dependencies and the compatibility
suite keeps the pinned revisions as evidence.
