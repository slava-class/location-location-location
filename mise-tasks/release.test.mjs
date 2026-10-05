import {test, expect, afterEach} from "bun:test";
import {mkdtemp, mkdir, writeFile, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {parseVersion, compareVersions, readInfo, setVersion} from "./release-info.mjs";
import {loadPrepared, publishPrepared, publicationDifferences} from "./release.mjs";
import {withWorkspaceSnapshot} from "./workspace.mjs";
import {ModPortal} from "./mod-portal.mjs";

const roots = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true}); });
const digest = (bytes, algorithm) => createHash(algorithm).update(bytes).digest("hex");
const record = (file, bytes) => ({file, sha256: digest(bytes, "sha256"), sha1: digest(bytes, "sha1")});
function bundle() {
  const archiveBytes = Buffer.from("sealed package bytes");
  const archive = {...record("location-location-location_1.0.1.zip", archiveBytes), bytes: archiveBytes};
  const images = ["02-planner.png", "01-source-survey.png"].map((file, index) => {
    // Header-level fixture; real rendered PNGs are exercised by release-prepare.
    const bytes = Buffer.alloc(25);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
    bytes.writeUInt32BE(1920, 16); bytes.writeUInt32BE(1080, 20); bytes[24] = index;
    return {...record(file, bytes), bytes};
  });
  const listing = {title: "Location Location Location", summary: "Plan production", description: "Native planner.", category: "utilities", license: "default_mit", homepage: "https://example.com", source_url: "https://example.com/source"};
  return {archive, images, manifest: {schema: 1, mod: {name: "location-location-location", version: "1.0.1"}, locale: "en", resolution: [1920, 1080], uiScale: 1.25, source: {}, listing,
    archive: record(archive.file, archive.bytes), images: images.map(image => record(image.file, image.bytes))}};
}
const metadata = (version = "1.0.0") => ({name: "location-location-location", releases: [{version, sha1: "0".repeat(40), file_name: `location-location-location_${version}.zip`}], images: [{id: "a".repeat(40)}]});
function receipts() {
  const saved = [];
  return {saved, saveReceipt: async value => saved.push(structuredClone(value))};
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "location-release-test-"));
  roots.push(root);
  const env = {...process.env, MISE_TRUSTED_CONFIG_PATHS: root};
  delete env.GIT_INDEX_FILE;
  const run = async args => {
    const child = Bun.spawn(args, {cwd: root, env, stdout: "pipe", stderr: "pipe"});
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return {stdout, stderr, code};
  };
  const git = async (...args) => {
    const result = await run(["git", ...args]);
    if (result.code) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  const prepared = bundle();
  const info = {...prepared.manifest.mod, title: prepared.manifest.listing.title, description: prepared.manifest.listing.summary, homepage: prepared.manifest.listing.homepage};
  await writeFile(join(root, "info.json"), JSON.stringify(info, null, 4) + "\n");
  await writeFile(join(root, "changelog.txt"), `${"-".repeat(99)}\nVersion: 1.0.1\n  Changes:\n    - Existing notes.\n`);
  await writeFile(join(root, "MOD_PORTAL.md"), "# Listing\n\n- **Category:** Utilities\n- **License:** MIT\n- **Source:** [source](https://example.com/source)\n\n## Description\n\nNative planner.\n");
  await writeFile(join(root, ".gitignore"), ".factorio-test/\n");
  await git("init", "-q", "--initial-branch=main");
  await git("config", "user.name", "Release Test");
  await git("config", "user.email", "release@example.invalid");
  await git("config", "commit.gpgsign", "false");
  await git("config", "core.hooksPath", join(root, "no-hooks"));
  await git("add", "-A"); await git("commit", "-qm", "fixture");
  const directory = join(root, ".factorio-test/releases/1.0.1");
  await mkdir(join(directory, "gallery"), {recursive: true});
  const seal = async () => {
    await withWorkspaceSnapshot(root, async ({head, tree}) => { prepared.manifest.source = {head, tree}; });
    await writeFile(join(directory, prepared.archive.file), prepared.archive.bytes);
    for (const image of prepared.images) await writeFile(join(directory, "gallery", image.file), image.bytes);
    await writeFile(join(directory, "manifest.json"), JSON.stringify(prepared.manifest));
  };
  await seal();
  return {root, directory, prepared, run, git, seal};
}

test("versions compare numerically and reject aliases/out-of-range components", () => {
  expect(compareVersions("1.10.0", "1.9.65535")).toBe(1);
  expect(compareVersions("2.0.0", "1.65535.65535")).toBe(1);
  for (const version of ["01.0.0", "1.0", "1.0.65536", "../1.0.1", "1.0.1-beta"]) expect(() => parseVersion(version)).toThrow();
});
test("versioning preserves prior notes and rejects invalid updates without editing files", async () => {
  const f = await fixture();
  const original = await readFile(join(f.root, "changelog.txt"), "utf8");
  for (const [version, note] of [["1.0.1", "same"], ["1.0.0", "old"], ["1.0.2", "bad\nnote"]]) await expect(setVersion(f.root, version, note)).rejects.toThrow();
  expect((await readInfo(f.root)).version).toBe("1.0.1");
  expect(await readFile(join(f.root, "changelog.txt"), "utf8")).toBe(original);
  await setVersion(f.root, "1.0.2", 'Keep "quotes", $variables, and ; punctuation literal.');
  expect((await readInfo(f.root)).version).toBe("1.0.2");
  const updated = await readFile(join(f.root, "changelog.txt"), "utf8");
  expect(updated.endsWith(original)).toBe(true);
  expect(updated.match(/^Version: (.+)$/m)?.[1]).toBe("1.0.2");
});
test("changed source and explicit version mismatches cannot consume a prepared bundle", async () => {
  const f = await fixture();
  await expect(loadPrepared(f.root, "1.0.0")).rejects.toThrow();
  await writeFile(join(f.root, "new.lua"), "return true\n");
  await expect(loadPrepared(f.root, "1.0.1")).rejects.toThrow();
});
test("a commit of the identical prepared tree remains publishable without disturbing staging", async () => {
  const f = await fixture();
  await writeFile(join(f.root, "new.lua"), "return true\n");
  await f.seal();
  await f.git("add", "new.lua");
  const staged = await f.git("write-tree");
  await loadPrepared(f.root, "1.0.1");
  expect(await f.git("write-tree")).toBe(staged);
  await f.git("commit", "-qm", "same prepared tree");
  const loaded = await loadPrepared(f.root, "1.0.1");
  expect(loaded.manifest.source.head).not.toBe(await f.git("rev-parse", "HEAD"));
  expect(loaded.manifest.source.tree).toBe(await f.git("rev-parse", "HEAD^{tree}"));
});
test("modified frozen ZIP or image bytes fail integrity checks", async () => {
  const f = await fixture();
  await writeFile(join(f.directory, f.prepared.archive.file), "tampered");
  await expect(loadPrepared(f.root, "1.0.1")).rejects.toThrow();
  await f.seal();
  await writeFile(join(f.directory, "gallery", f.prepared.images[0].file), "tampered");
  await expect(loadPrepared(f.root, "1.0.1")).rejects.toThrow();
});
test("extra or reordered scenes invalidate a sealed Portal gallery", async () => {
  const f = await fixture();
  f.prepared.manifest.images.reverse();
  await writeFile(join(f.directory, "manifest.json"), JSON.stringify(f.prepared.manifest));
  await expect(loadPrepared(f.root, "1.0.1")).rejects.toThrow();
  f.prepared.manifest.images.reverse();
  f.prepared.manifest.images.push({...f.prepared.manifest.images[0], file: "03-recipe-picker.png"});
  await writeFile(join(f.directory, "manifest.json"), JSON.stringify(f.prepared.manifest));
  await expect(loadPrepared(f.root, "1.0.1")).rejects.toThrow();
});
test("failed preparation invalidates a previously sealed candidate", async () => {
  const f = await fixture();
  await writeFile(join(f.root, ".mise.toml"), '[tasks.verify]\nrun = "false"\n');
  const result = await f.run(["bun", join(import.meta.dir, "release.mjs"), "prepare", "en"]);
  expect(result.code).not.toBe(0);
  expect(await readFile(join(f.directory, "manifest.json")).catch(error => error.code)).toBe("ENOENT");
}, 15000);
test("all required keys are checked before the release can mutate the Portal", async () => {
  let touched = false;
  const portal = {metadata: async () => {touched = true; throw new Error("unexpected network");}};
  await expect(publishPrepared(bundle(), "publish", {portal, uploadKey: "upload", ...receipts()})).rejects.toThrow();
  await expect(publishPrepared(bundle(), "publish", {portal, uploadKey: "upload", editKey: "invalid\nheader", ...receipts()})).rejects.toThrow();
  expect(touched).toBe(false);
});
test("already released, regressive, and stale listing targets stop before mutations", async () => {
  for (const [mode, current] of [["publish", "1.0.1"], ["publish", "1.0.2"], ["gallery", "1.0.2"], ["listing", "1.0.0"]]) {
    const r = receipts();
    const portal = {metadata: async () => metadata(current)};
    await expect(publishPrepared(bundle(), mode, {portal, uploadKey: "upload", editKey: "edit", ...r})).rejects.toThrow();
    expect(r.saved).toEqual([]);
  }
});
test("an acknowledged ZIP with mismatched public SHA1 stops before gallery/listing changes", async () => {
  const r = receipts(); let uploaded = false;
  const portal = {metadata: async () => metadata(uploaded ? "1.0.1" : "1.0.0"), upload: async kind => {
    if (kind !== "release") throw new Error("unexpected image mutation");
    uploaded = true; return {success: true};
  }};
  await expect(publishPrepared(bundle(), "publish", {portal, uploadKey: "upload", editKey: "edit", ...r})).rejects.toThrow();
  expect(r.saved.at(-1).status).toBe("stopped");
  expect(r.saved.at(-1).events).toEqual([{operation: "release-upload", file: "location-location-location_1.0.1.zip", status: "confirmed"}]);
});
test("a late image failure keeps prior images and records partial/unknown outcomes", async () => {
  const prepared = bundle(), r = receipts(), state = metadata("1.0.1");
  const oldOrder = structuredClone(state.images);
  let uploads = 0;
  const portal = {metadata: async () => state, upload: async (_kind, _mod, image) => {
    if (++uploads === 2) throw new Error("upload outcome unknown");
    state.images.push({id: image.sha1});
    return {id: image.sha1};
  }, gallery: async () => {state.images = []; throw new Error("must not replace gallery");}};
  await expect(publishPrepared(prepared, "gallery", {portal, editKey: "edit", ...r})).rejects.toThrow();
  expect(state.images.slice(0, oldOrder.length)).toEqual(oldOrder);
  const last = r.saved.at(-1);
  expect(last.status).toBe("stopped");
  expect(last.events.map(event => event.status)).toEqual(["confirmed", "attempting"]);
});
test("retained images can be reordered and trimmed without another upload", async () => {
  const prepared = bundle(), r = receipts();
  const retained = prepared.images.map(image => ({id: image.sha1}));
  let state = {...metadata("1.0.1"), images: [...retained].reverse().concat({id: "b".repeat(40)}, {id: "c".repeat(40)}, {id: "d".repeat(40)})};
  const portal = {
    metadata: async () => structuredClone(state),
    upload: async () => {throw new Error("The retained PNG is already uploaded");},
    gallery: async () => {state = {...state, images: retained};},
  };
  const receipt = await publishPrepared(prepared, "gallery", {portal, editKey: "edit", ...r});
  expect(receipt.status).toBe("verified");
  expect(receipt.previousImageIds).toEqual([retained[1].id, retained[0].id, "b".repeat(40), "c".repeat(40), "d".repeat(40)]);
  expect(state.images).toEqual(retained);
});
test("API failures cannot masquerade as success or disclose credentials in errors", async () => {
  const secret = "privateAPIKey";
  const portal = new ModPortal(async () => Response.json({error: secret, message: `https://upload.example/?token=${secret}`}));
  const error = await portal.metadata("location-location-location").catch(error => error);
  expect(error).toBeInstanceOf(Error);
  expect(error.message.includes(secret)).toBe(false);
  const transport = new ModPortal(async () => {throw new Error(`https://upload.example/?token=${secret}`);});
  expect((await transport.metadata("location-location-location").catch(error => error)).message.includes(secret)).toBe(false);
});
test("operational metadata sees writes despite a CDN cache that ignores revalidation headers", async () => {
  let current = metadata("1.0.0");
  const cached = new Map();
  const portal = new ModPortal(async url => {
    if (!cached.has(url)) cached.set(url, structuredClone(current));
    return Response.json(cached.get(url));
  });
  const before = await portal.metadata("location-location-location");
  current = metadata("1.0.1");
  const after = await portal.metadata("location-location-location");
  expect(before.releases[0].version).toBe("1.0.0");
  expect(after.releases[0].version).toBe("1.0.1");
});
test("a confirmed upload in a stopped receipt cannot be submitted again", async () => {
  const prepared = bundle(), r = receipts();
  const previousReceipt = {mod: prepared.manifest.mod, status: "stopped", events: [{operation: "release-upload", status: "confirmed"}]};
  let touched = false;
  const portal = {metadata: async () => {touched = true; return metadata("1.0.0");}};
  await expect(publishPrepared(prepared, "publish", {portal, uploadKey: "upload", editKey: "edit", previousReceipt, ...r})).rejects.toThrow();
  expect(touched).toBe(false);
  expect(r.saved).toEqual([]);
});
test("untrusted upload URLs and incorrect returned image hashes cannot be accepted", async () => {
  let sentFile = false;
  const unsafe = new ModPortal(async (_url, options) => {
    if (options.body?.has("image")) sentFile = true;
    return Response.json({upload_url: "http://insecure.example/upload"});
  });
  await expect(unsafe.upload("image", "location-location-location", bundle().images[0], "edit")).rejects.toThrow();
  expect(sentFile).toBe(false);
  const corrupt = new ModPortal(async url => Response.json(String(url).includes("/images/add") ? {upload_url: "https://upload.example/image"} : {id: "0".repeat(40)}));
  await expect(corrupt.upload("image", "location-location-location", bundle().images[0], "edit")).rejects.toThrow();
});
test("readback distinguishes wrong image order and changed listing content from line endings", async () => {
  const prepared = bundle();
  const fields = prepared.manifest.listing;
  const state = {...metadata("1.0.1"), ...fields, license: {id: fields.license}, images: prepared.images.map(image => ({id: image.sha1}))};
  state.releases[0].sha1 = prepared.archive.sha1;
  state.description = "\r\nNative planner.\r\n";
  expect(publicationDifferences(state, prepared, "publish")).toEqual([]);
  state.images.reverse(); state.summary = "Unexpected summary";
  expect(publicationDifferences(state, prepared, "publish")).toEqual(["gallery image IDs/order", "listing summary"]);
});
