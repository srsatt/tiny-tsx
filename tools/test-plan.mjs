const command = (executable, ...args) => ({command: executable, args});
const nodeTests = (...files) => command("node", "--test", ...files);
const npmPrefix = (directory, script) => command("npm", "--prefix", directory, "run", script);
const ports = (...values) => values.map(value => `port:${value}`);

const frontend = ["setup:frontend"];
const compiler = ["setup:compiler"];
const native = [...frontend, ...compiler];

export const tasks = [
  {id: "setup:frontend-deps", hidden: true, commands: [command("npm", "ci", "--prefix", "frontend")]},
  {id: "setup:eslint", hidden: true, commands: [command("npm", "ci", "--prefix", "packages/eslint-plugin-tinytsx")]},
  {id: "setup:node-server", hidden: true, commands: [command("npm", "ci", "--prefix", "tests/compat/node-server")]},
  {id: "setup:stytch", hidden: true, commands: [command("npm", "ci", "--prefix", "tests/compat/stytch-auth")]},
  {id: "setup:zod", hidden: true, commands: [command("npm", "ci", "--prefix", "tests/compat/zod-openapi")]},
  {
    id: "setup:frontend",
    hidden: true,
    dependencies: ["setup:frontend-deps"],
    resources: ["frontend-dist"],
    commands: [npmPrefix("frontend", "build")],
  },
  {
    id: "setup:compiler",
    hidden: true,
    resources: ["cargo-target"],
    commands: [command("cargo", "build", "-p", "tinytsx")],
  },
  {
    id: "test:runner",
    commands: [nodeTests("tests/tools/test-runner.test.mjs")],
  },
  {
    id: "test:eslint-plugin",
    dependencies: ["setup:eslint"],
    commands: [
      npmPrefix("packages/eslint-plugin-tinytsx", "test"),
      npmPrefix("packages/eslint-plugin-tinytsx", "pack:check"),
    ],
  },
  {
    id: "test:frontend",
    dependencies: [...frontend, "setup:node-server", "setup:stytch"],
    commands: [{command: "node", args: ["--test"], globs: ["frontend/dist/test/*.test.js"]}],
  },
  {id: "test:dev", dependencies: native, exclusive: true, commands: [{command: "node", args: ["--test"], globs: ["tests/dev/*.test.mjs"]}]},
  {id: "test:env-native", dependencies: native, resources: ports(39462), commands: [nodeTests("tests/compat/env/native.test.mjs")]},
  {id: "test:fs-native", dependencies: native, resources: ports(39463), commands: [nodeTests("tests/compat/fs/native.test.mjs")]},
  {id: "test:actors-native", dependencies: native, commands: [nodeTests("tests/compat/actors/native.test.mjs")]},
  {id: "test:hono-actor-multi-reference", commands: [command("bun", "test", "--tsconfig-override", "benchmarks/bun/hono-runtime-tsconfig.json", "tests/compat/actors/multi-reference.test.ts")]},
  {id: "test:hono-actor-supervision-reference", commands: [command("bun", "test", "--tsconfig-override", "benchmarks/bun/hono-runtime-tsconfig.json", "tests/compat/actors/supervision-reference.test.ts")]},
  {id: "test:sqlite-reference", commands: [command("bun", "test", "tests/compat/sqlite/reference.behavior.test.ts")]},
  {id: "test:hono-sqlite-wal-reference", commands: [command("bun", "test", "--tsconfig-override", "benchmarks/bun/hono-runtime-tsconfig.json", "tests/compat/sqlite/wal-reference.test.ts")]},
  {id: "test:hono-sqlite-idempotency-reference", commands: [command("bun", "test", "--tsconfig-override", "benchmarks/bun/hono-runtime-tsconfig.json", "tests/compat/sqlite/idempotency-reference.test.ts")]},
  {id: "test:hono-sqlite-rollback-reference", commands: [command("bun", "test", "--tsconfig-override", "benchmarks/bun/hono-runtime-tsconfig.json", "tests/compat/sqlite/rollback-reference.test.ts")]},
  {id: "test:sqlite-readonly-native", dependencies: native, resources: ports(39496), commands: [nodeTests("tests/compat/sqlite/readonly-native.test.mjs")]},
  {
    id: "test:sqlite-native",
    dependencies: native,
    resources: ports(39465, 39466, 39492, 39493, 39494, 39497, 39498, 39499),
    commands: [nodeTests("tests/compat/sqlite/native.test.mjs")],
  },
  {id: "test:assets-native", dependencies: native, resources: ports(39497, 39498), commands: [nodeTests("tests/compat/assets/native.test.mjs")]},
  {id: "test:hono-nested-profile-native", dependencies: native, resources: ports(39505), commands: [nodeTests("tests/compat/hono/nested-profile-native.test.mjs")]},
  {id: "test:hono-nested-profile-reference", commands: [command("bun", "test", "--tsconfig-override", "benchmarks/bun/hono-runtime-tsconfig.json", "tests/compat/hono/nested-profile-reference.test.ts")]},
  {
    id: "test:hono-intake",
    dependencies: [...frontend, "setup:stytch"],
    commands: [nodeTests(
      "tests/compat/hono/docs-matrix.test.mjs",
      "tests/compat/hono/examples-intake.test.mjs",
      "tests/compat/hono/stytch-auth-intake.test.mjs",
    )],
  },
  {id: "test:hono-stytch-session", dependencies: [...native, "setup:stytch"], resources: ports(39491), commands: [nodeTests("tests/compat/hono/stytch-session-native.test.mjs")]},
  {id: "test:hono-stytch-todo", dependencies: [...native, "setup:stytch"], resources: ports(39492, 39493), commands: [nodeTests("tests/compat/hono/stytch-todo-native.test.mjs")]},
  {id: "test:hono-stytch-todo-reference", dependencies: ["setup:stytch"], commands: [command("bun", "test", "tests/compat/hono/stytch-todo-reference.test.ts")]},
  {
    id: "test:hono-alpha-native",
    dependencies: native,
    resources: ports(39481, 39482, 39483, 39484, 39488, 39489, 39490, 39491, 39492, 39493, 39494),
    commands: [nodeTests("tests/compat/hono/alpha-native.test.mjs")],
  },
  {id: "test:hono-user-auth", dependencies: native, resources: ports(39487), commands: [nodeTests("tests/compat/hono/user-auth-native.test.mjs")]},
  {id: "test:hono-basic-reference", commands: [command("bun", "run", "--tsconfig-override", "tests/compat/hono/jsx-ssr-bun-tsconfig.json", "tests/compat/hono/basic.behavior.test.ts")]},
  {id: "test:hono-body-limit-reference", commands: [command("bun", "run", "--tsconfig-override", "tests/compat/hono/jsx-ssr-bun-tsconfig.json", "tests/compat/hono/body-limit.behavior.test.ts")]},
  {id: "test:hono-request-id-reference", commands: [command("bun", "run", "--tsconfig-override", "tests/compat/hono/jsx-ssr-bun-tsconfig.json", "tests/compat/hono/request-id.behavior.test.ts")]},
  {id: "test:hono-secure-headers-reference", commands: [command("bun", "run", "--tsconfig-override", "tests/compat/hono/jsx-ssr-bun-tsconfig.json", "tests/compat/hono/secure-headers.behavior.test.ts")]},
  {id: "test:hono-context-variables-native", dependencies: native, resources: ports(39496), commands: [nodeTests("tests/compat/hono/context-variables-native.test.mjs")]},
  {id: "test:hono-context-variables-reference", commands: [command("bun", "test", "--tsconfig-override", "benchmarks/bun/hono-runtime-tsconfig.json", "tests/compat/hono/context-variables-reference.test.ts")]},
  {id: "test:hono-map-native", dependencies: native, resources: ports(39497), commands: [nodeTests("tests/compat/hono/map-native.test.mjs")]},
  {id: "test:hono-map-reference", commands: [command("bun", "test", "--tsconfig-override", "benchmarks/bun/hono-runtime-tsconfig.json", "tests/compat/hono/map-reference.test.ts")]},
  {id: "test:hono-json-body-native", dependencies: native, resources: ports(39495), commands: [nodeTests("tests/compat/hono/json-body-native.test.mjs")]},
  {id: "test:hono-json-body-reference", commands: [command("bun", "test", "--tsconfig-override", "benchmarks/bun/hono-runtime-tsconfig.json", "tests/compat/hono/json-body-reference.test.ts")]},
  {id: "test:node-server-reference", dependencies: ["setup:node-server"], resources: ports(39480), commands: [nodeTests("tests/compat/node-server/reference.behavior.test.mjs")]},
  {id: "test:hono-jsx-reference", commands: [command("bun", "run", "--jsx-import-source", "hono/jsx", "--tsconfig-override", "tests/compat/hono/jsx-ssr-bun-tsconfig.json", "tests/compat/hono/jsx-ssr.behavior.test.ts")]},
  {id: "test:test262-intake", commands: [nodeTests("tests/compat/test262/intake.test.mjs")]},
  {id: "test:test262-native", dependencies: native, commands: [nodeTests("tests/compat/test262/native.test.mjs")]},
  {id: "test:wpt-intake", commands: [nodeTests("tests/compat/wpt/intake.test.mjs")]},
  {id: "test:wpt-native", dependencies: native, commands: [nodeTests("tests/compat/wpt/native.test.mjs")]},
  {id: "test:benchmarks", commands: [command("python3", "-m", "unittest", "discover", "-s", "benchmarks/tests", "-p", "test_*.py")]},
  {id: "test:wasm", resources: ["cargo-target"], commands: [command("cargo", "test", "-p", "tinytsx-runtime-wasm", "--features", "interpreter")]},
  {id: "test:workspace", dependencies: frontend, resources: ["cargo-target"], commands: [command("cargo", "test", "--workspace")]},
  {
    id: "test:zod-openapi-reference",
    dependencies: ["setup:zod"],
    commands: [command("bun", "test", "tests/compat/zod-openapi/reference.behavior.test.ts")],
  },
  {
    id: "test:zod-openapi",
    dependencies: [...native, "setup:zod"],
    resources: ports(39461),
    commands: [
      command("frontend/node_modules/.bin/tsc", "-p", "tests/compat/zod-openapi/tsconfig.json"),
      nodeTests("tests/compat/zod-openapi/native.test.mjs"),
    ],
  },
];

export const defaultSuiteIds = tasks
  .filter(task => task.id.startsWith("test:") && !task.id.startsWith("test:zod-openapi"))
  .map(task => task.id);

export const profiles = {
  default: defaultSuiteIds,
  release: [...defaultSuiteIds, "test:zod-openapi-reference", "test:zod-openapi"],
};
