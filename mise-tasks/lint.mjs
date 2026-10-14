import { resolve } from "node:path";
import { root } from "./lib.mjs";
const cache = resolve(root, ".factorio-test/tools");
const process = Bun.spawn(["lua", `${cache}/luacheck-1.2.0/bin/luacheck.lua`, "data.lua", "data-final-fixes.lua", "control.lua", "dossier", "tests", "--codes", "--no-default-config"], {
  cwd: root, stdout: "inherit", stderr: "inherit",
  env: { ...Bun.env, LUA_PATH: `${cache}/luacheck-1.2.0/src/?.lua;${cache}/luacheck-1.2.0/src/?/init.lua;${cache}/argparse-0.7.1/src/?.lua;;`, LUA_CPATH: `${cache}/?.so;;` },
});
if (await process.exited !== 0) throw new Error("Luacheck failed");
