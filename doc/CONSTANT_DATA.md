# Constant data format

Closed values found by AOT staging enter HIR v2 as a canonical constant pool.
Each entry has a numeric ID, source module, binding name, source span, and a
tagged value. Supported value kinds are undefined, null, boolean, finite
JavaScript number, arbitrary-precision bigint, UTF-8 string, ordered array, and
ordered record fields.

The macOS arm64 backend serializes each value at an eight-byte-aligned local
label named `Ltinytsx_constant_<id>` in `__TEXT,__const`. Integers below are
little-endian. Values use this recursive format:

| Tag | Value | Payload |
| --- | --- | --- |
| 0 | null | none |
| 1 | false | none |
| 2 | true | none |
| 3 | number | IEEE-754 `f64` |
| 4 | string | `u32` byte length, then UTF-8 bytes |
| 5 | array | `u32` item count, then encoded items |
| 6 | record | `u32` field count, then fields |
| 7 | undefined | none |
| 8 | bigint | `u32` byte length, then canonical decimal bytes |

Each record field is a `u32` UTF-8 key length, key bytes, and one encoded value.
Field and array order are preserved. HIR validation requires canonical IDs,
known source modules, finite numbers, canonical bigint text, unique record field
names, matching pool statistics, and no more than 128 nested value levels.
Individual lengths and counts are limited to `u32`.

This format is an internal compiler representation, not a runtime ABI and not a
JavaScript object layout. Generated string expressions can return a view into a
staged string blob; arrays and records are not loaded by expression codegen yet.
Their next slice will choose native layouts and may replace this transport
encoding with a later HIR version when the compiler/runtime contract changes.
