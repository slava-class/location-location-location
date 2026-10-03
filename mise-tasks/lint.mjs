import { resolve } from "node:path";
const cache = resolve(".factorio-test/tools");
const child = Bun.spawn(["lua", `${cache}/luacheck-1.2.0/bin/luacheck.lua`, "control.lua", "data.lua", "location_location_location", "tests", "--codes", "--no-default-config"], {
  env: { ...Bun.env, LUA_PATH: `${cache}/luacheck-1.2.0/src/?.lua;${cache}/luacheck-1.2.0/src/?/init.lua;${cache}/argparse-0.7.1/src/?.lua;;`, LUA_CPATH: `${cache}/?.so;;` },
  stdout: "inherit", stderr: "inherit"
});
process.exitCode = await child.exited;
