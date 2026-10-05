import {readFile, writeFile, mkdir, open, unlink, rename, rm} from "node:fs/promises";
import {join, resolve, basename} from "node:path";
import {createHash} from "node:crypto";
import {readInfo, readListing, parseVersion, compareVersions, setVersion} from "./release-info.mjs";
import {normalizeLocale} from "./factorio-env.mjs";
import {runCommand, withWorkspaceSnapshot} from "./workspace.mjs";
import {ModPortal} from "./mod-portal.mjs";

const portalGalleryFiles = ["02-planner.png", "01-source-survey.png"];
const hash = (bytes, algorithm = "sha256") => createHash(algorithm).update(bytes).digest("hex");
const bundleDirectory = (root, version) => { parseVersion(version); return join(root, ".factorio-test/releases", version); };
const json = async path => JSON.parse(await readFile(path, "utf8"));
async function optionalJSON(path) {
  try { return await json(path); } catch (error) { if (error.code !== "ENOENT") throw error; }
}
async function saveJSON(path, value) {
  await writeFile(path + ".tmp", JSON.stringify(value, null, 2) + "\n");
  await rename(path + ".tmp", path);
}
async function withReleaseLock(root, action) {
  await mkdir(join(root, ".factorio-test"), {recursive: true});
  const path = join(root, ".factorio-test/release.lock");
  let handle;
  try { handle = await open(path, "wx"); }
  catch (error) {
    if (error.code === "EEXIST") throw new Error(`Release task already running or interrupted: ${path}. Check its PID before removing a stale lock.`);
    throw error;
  }
  try { await handle.writeFile(String(process.pid)); return await action(); }
  finally { await handle.close(); await unlink(path); }
}
function fileRecord(file, bytes) { return {file, sha256: hash(bytes), sha1: hash(bytes, "sha1")}; }
function checkImage(bytes, file) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.readUInt32BE(16) !== 1920 || bytes.readUInt32BE(20) !== 1080) throw new Error(`Expected a 1920x1080 PNG: ${file}`);
}
export async function prepareRelease(root, language = "en") {
  language = normalizeLocale(language);
  const info = await readInfo(root);
  const directory = bundleDirectory(root, info.version);
  await mkdir(directory, {recursive: true});
  // A failed new preparation must not leave a previous candidate eligible for publishing.
  await unlink(join(directory, "manifest.json")).catch(error => {if (error.code !== "ENOENT") throw error;});
  return withWorkspaceSnapshot(root, async ({head, tree, snapshot, env}) => {
    const tasks = [["verify"], ["test-ui", "--", language], ["package-smoke"], ["gallery", "--", language]];
    for (const args of tasks) await runCommand(["mise", "run", ...args], {root, env});
    if (await snapshot() !== tree) throw new Error("Source changed during release preparation; no candidate sealed. Rerun release-prepare.");
    const listing = await readListing(root, info);
    const archiveName = `${info.name}_${info.version}.zip`;
    const archiveBytes = await readFile(join(root, archiveName));
    const packaged = await json(join(root, ".factorio-test/package-manifest.json"));
    if (packaged.archive !== archiveName || packaged.sha256 !== hash(archiveBytes)) throw new Error("ZIP differs from the artifact used by package-smoke");
    const galleryRoot = join(root, ".factorio-test/gallery", language);
    const gallery = await json(join(galleryRoot, "native-suite-results.json"));
    if (gallery.mod?.name !== info.name || gallery.mod?.version !== info.version || gallery.locale !== language || gallery.summary?.passed !== 5 || gallery.summary?.failed !== 0 || gallery.uiScale !== 1.25 || gallery.resolution?.join(",") !== "1920,1080" || gallery.screenshots?.length !== 5) throw new Error("Gallery result does not match the prepared mod, locale, and five passing scenes");
    if (portalGalleryFiles.some(file => !gallery.screenshots.includes(file))) throw new Error("Gallery captures are missing a selected Portal scene");
    await rm(join(directory, "gallery"), {recursive: true, force: true});
    await mkdir(join(directory, "gallery"), {recursive: true});
    const images = [];
    for (const file of portalGalleryFiles) {
      if (!/^\d{2}-[a-z-]+\.png$/.test(file)) throw new Error("Unexpected gallery filename");
      const bytes = await readFile(join(galleryRoot, "script-output/gallery", file));
      checkImage(bytes, file);
      images.push(fileRecord(file, bytes));
      await writeFile(join(directory, "gallery", file), bytes);
    }
    if (new Set(images.map(image => image.sha1)).size !== portalGalleryFiles.length) throw new Error("Portal gallery must contain distinct scenes");
    await writeFile(join(directory, archiveName), archiveBytes);
    await writeFile(join(directory, archiveName + ".sha256"), `${hash(archiveBytes)}  ${archiveName}\n`);
    await saveJSON(join(directory, "gallery-results.json"), gallery);
    const manifest = {schema: 1, mod: {name: info.name, version: info.version}, preparedAt: new Date().toISOString(),
      source: {head, tree}, locale: language, engine: gallery.engine, resolution: gallery.resolution, uiScale: gallery.uiScale,
      verifiedTasks: tasks.map(args => args.join(" ")), archive: fileRecord(archiveName, archiveBytes), images, listing};
    if (await snapshot() !== tree) throw new Error("Source changed while sealing artifacts; no candidate written.");
    await saveJSON(join(directory, "manifest.json"), manifest);
    console.log(`Prepared ${info.name} ${info.version}\nSource tree: ${tree}\nZIP SHA256: ${manifest.archive.sha256}\nBundle: ${directory}\nNo publication performed. Inspect Portal state: mise run release-status`);
    return manifest;
  });
}
export async function loadPrepared(root, version) {
  const info = await readInfo(root);
  if (version !== info.version) throw new Error(`Expected version ${version} differs from info.json (${info.version})`);
  const directory = bundleDirectory(root, version);
  const manifest = await optionalJSON(join(directory, "manifest.json"));
  if (!manifest) throw new Error(`No prepared ${info.name} ${version}; run mise run release-prepare -- en`);
  if (manifest.schema !== 1 || manifest.mod?.name !== info.name || manifest.mod?.version !== version) throw new Error("Prepared manifest identity/schema mismatch");
  normalizeLocale(manifest.locale);
  if (manifest.resolution?.join(",") !== "1920,1080" || manifest.uiScale !== 1.25 || manifest.images?.map(image => image.file).join(",") !== portalGalleryFiles.join(",")) throw new Error("Prepared gallery specification differs");
  if (JSON.stringify(manifest.listing) !== JSON.stringify(await readListing(root, info))) throw new Error("Listing changed since preparation; rerun release-prepare");
  await withWorkspaceSnapshot(root, async ({tree}) => {
    if (tree !== manifest.source?.tree) throw new Error("Source changed since preparation; rerun release-prepare. A commit of the same tree remains valid.");
  });
  const load = async (record, folder) => {
    if (!record || typeof record.file !== "string" || basename(record.file) !== record.file || record.file.includes("\\")) throw new Error("Prepared artifact path is not a filename");
    const bytes = await readFile(join(directory, folder, record.file));
    if (hash(bytes) !== record.sha256 || hash(bytes, "sha1") !== record.sha1) throw new Error(`Prepared artifact changed: ${record.file}; rerun release-prepare`);
    return {...record, bytes};
  };
  if (manifest.archive?.file !== `${info.name}_${version}.zip`) throw new Error("Prepared ZIP name differs from info.json");
  const archive = await load(manifest.archive, "");
  const images = [];
  for (const record of manifest.images) {
    if (!/^\d{2}-[a-z-]+\.png$/.test(record.file)) throw new Error("Unexpected prepared image filename");
    const image = await load(record, "gallery");
    checkImage(image.bytes, image.file);
    images.push(image);
  }
  if (new Set(images.map(image => image.sha1)).size !== portalGalleryFiles.length) throw new Error("Prepared gallery scenes are not distinct");
  return {manifest, directory, archive, images};
}
function latestRelease(metadata) {
  return metadata.releases.reduce((latest, release) => !latest || compareVersions(release.version, latest.version) > 0 ? release : latest, undefined);
}
const normalizeText = value => typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : value;
export function publicationDifferences(metadata, bundle, mode) {
  const {manifest} = bundle;
  const differences = [];
  if (mode === "publish") {
    const release = metadata.releases.find(item => item.version === manifest.mod.version);
    if (!release || release.sha1 !== manifest.archive.sha1 || release.file_name !== manifest.archive.file) differences.push("release version/ZIP SHA1");
  }
  if (mode !== "listing") {
    if (metadata.images.map(image => image.id).join(",") !== manifest.images.map(image => image.sha1).join(",")) differences.push("gallery image IDs/order");
  }
  if (mode !== "gallery") {
    for (const [field, expected] of Object.entries(manifest.listing)) {
      const actual = field === "license" ? metadata.license?.id : metadata[field];
      if (normalizeText(actual) !== normalizeText(expected)) differences.push(`listing ${field}`);
    }
  }
  return differences;
}
function confirmedReleaseUpload(receipt, mod) {
  return receipt?.mod?.name === mod.name && receipt.mod.version === mod.version
    && receipt.events?.some(event => event.operation === "release-upload" && event.status === "confirmed");
}

export async function publishPrepared(bundle, mode, {portal = new ModPortal(), uploadKey, editKey, saveReceipt, previousReceipt} = {}) {
  if (!["publish", "gallery", "listing"].includes(mode)) throw new Error("Unknown publishing operation");
  if (mode === "publish" && confirmedReleaseUpload(previousReceipt, bundle.manifest.mod)) throw new Error("This version's ZIP upload was already confirmed. Do not resend it; inspect release-status and finish with gallery-publish/listing-publish.");
  if (!editKey?.trim() || (mode === "publish" && !uploadKey?.trim())) throw new Error(mode === "publish" ? "Set MOD_UPLOAD_API_KEY (Upload Mods) and MOD_EDIT_API_KEY (Edit Mods); no mutations attempted" : "Set MOD_EDIT_API_KEY (Edit Mods); no mutations attempted");
  for (const [name, key] of [["MOD_EDIT_API_KEY", editKey], ...(mode === "publish" ? [["MOD_UPLOAD_API_KEY", uploadKey]] : [])]) {
    try { new Headers({Authorization: `Bearer ${key}`}); }
    catch { throw new Error(`${name} cannot form a valid authorization header; no mutations attempted`); }
  }
  if (!saveReceipt) throw new Error("Publishing requires a durable receipt writer");
  const {manifest} = bundle;
  const {name, version} = manifest.mod;
  const before = await portal.metadata(name);
  const latest = latestRelease(before);
  if (mode === "publish") {
    if (before.releases.some(release => release.version === version) || (latest && compareVersions(version, latest.version) <= 0)) throw new Error(`Portal already has ${version} or a newer release. No mutations attempted; inspect mise run release-status and use gallery-publish/listing-publish for listing-only refreshes.`);
  } else if (latest?.version !== version) throw new Error(`Listing-wide edits require the latest Portal version (${latest?.version ?? "none"}) to match prepared ${version}; no mutations attempted`);
  const receipt = {schema: 1, mod: manifest.mod, mode, source: manifest.source, archiveSha1: manifest.archive.sha1,
    startedAt: new Date().toISOString(), status: "publishing", previousImageIds: before.images.map(image => image.id), events: []};
  await saveReceipt(receipt);
  const mutate = async (operation, action, file) => {
    const event = {operation, ...(file ? {file} : {}), status: "attempting"};
    receipt.events.push(event);
    await saveReceipt(receipt);
    const result = await action();
    event.status = "confirmed";
    await saveReceipt(receipt);
    return result;
  };
  try {
    if (mode === "publish") {
      await mutate("release-upload", () => portal.upload("release", name, bundle.archive, uploadKey), bundle.archive.file);
      const uploaded = await portal.metadata(name);
      const release = uploaded.releases.find(item => item.version === version);
      if (!release || release.sha1 !== bundle.archive.sha1 || release.file_name !== bundle.archive.file) throw new Error("Release upload acknowledged, but public ZIP readback does not match; gallery/listing were not changed");
    }
    if (mode !== "listing") {
      const ids = [];
      const existingIds = new Set(before.images.map(image => image.id));
      for (const image of bundle.images) {
        if (existingIds.has(image.sha1)) {
          ids.push(image.sha1);
          continue;
        }
        const result = await mutate("image-upload", () => portal.upload("image", name, image, editKey), image.file);
        ids.push(result.id);
      }
      await mutate("gallery-order", () => portal.gallery(name, ids, editKey));
    }
    if (mode !== "gallery") await mutate("listing-update", () => portal.listing(name, manifest.listing, editKey));
    const readback = await portal.metadata(name);
    const differences = publicationDifferences(readback, bundle, mode);
    if (differences.length) throw new Error(`Mutations acknowledged, but public readback differs: ${differences.join(", ")}`);
    receipt.status = "verified";
    receipt.finishedAt = new Date().toISOString();
    await saveReceipt(receipt);
    return receipt;
  } catch (error) {
    receipt.status = "stopped";
    receipt.error = error.message;
    await saveReceipt(receipt);
    throw new Error(`${error.message}\nPublication is not transactional. Confirmed/attempted steps are in the receipt; inspect mise run release-status before any further publishing. No automatic retry or rollback.`, {cause: error});
  }
}
async function status(root) {
  const info = await readInfo(root);
  const metadata = await new ModPortal().metadata(info.name);
  const latest = latestRelease(metadata);
  console.log(`Portal: https://mods.factorio.com/mod/${info.name}\nOwner: ${metadata.owner}\nLocal version: ${info.version}\nLatest Portal release: ${latest?.version ?? "none"}\nPortal ZIP SHA1: ${latest?.sha1 ?? "none"}\nGallery IDs: ${metadata.images.map(image => image.id).join(",") || "none"}`);
  const directory = bundleDirectory(root, info.version);
  const publishReceipt = await optionalJSON(join(directory, "publish-receipt.json"));
  if (await optionalJSON(join(directory, "manifest.json"))) {
    try {
      const bundle = await loadPrepared(root, info.version);
      console.log(`Prepared source tree: ${bundle.manifest.source.tree}\nPrepared ZIP SHA1: ${bundle.archive.sha1}\nPrepared manifest: ${join(directory, "manifest.json")}\nPrepared gallery:\n${bundle.manifest.images.map(image => `  ${image.file}: ${image.sha1}`).join("\n")}\nReadback differences: ${publicationDifferences(metadata, bundle, "publish").join(", ") || "none"}`);
      if (latest?.version === info.version) console.log(`Version already released; listing-only commands:\n  mise run gallery-publish -- ${info.version}\n  mise run listing-publish -- ${info.version}`);
      else if (latest && compareVersions(info.version, latest.version) <= 0) console.log(`Local ${info.version} is older than latest Portal ${latest.version}; choose a newer version with release-version, then prepare it.`);
      else if (confirmedReleaseUpload(publishReceipt, info)) console.log("ZIP upload was already confirmed; public readback is unresolved. Do not resend the ZIP. Inspect the publish receipt before finishing gallery/listing work.");
      else console.log(`Explicit publication: mise run release-publish -- ${info.version}`);
    } catch (error) { console.log(`Prepared bundle unusable: ${error.message}`); }
  } else console.log("No prepared bundle. Next: mise run release-prepare -- en");
  for (const mode of ["publish", "gallery", "listing"]) {
    const receipt = mode === "publish" ? publishReceipt : await optionalJSON(join(directory, `${mode}-receipt.json`));
    if (receipt) console.log(`${mode} receipt: ${receipt.status}; target ${receipt.mod.name} ${receipt.mod.version}; source tree ${receipt.source.tree}; ZIP SHA1 ${receipt.archiveSha1}; ${receipt.events.map(event => `${event.operation}${event.file ? ` ${event.file}` : ""}=${event.status}`).join("; ")}\n  ${join(directory, `${mode}-receipt.json`)}`);
  }
}
async function main() {
  const root = resolve(".");
  const [operation, ...args] = process.argv.slice(2);
  if (operation === "status") {
    if (args.length) throw new Error("release-status accepts no arguments");
    return status(root);
  }
  return withReleaseLock(root, async () => {
    if (operation === "version") {
      if (args.length !== 2) throw new Error("Usage: mise run release-version -- <version> <changelog-note>");
      const version = await setVersion(root, args[0], args[1]);
      console.log(`Local release version: ${version}. Review changelog.txt, then run mise run release-prepare -- en. No commit, push, or upload performed.`);
    } else if (operation === "prepare") {
      if (args.length > 1) throw new Error("Usage: mise run release-prepare -- [language]");
      await prepareRelease(root, args[0]);
    } else if (["publish", "gallery", "listing"].includes(operation)) {
      if (args.length !== 1) throw new Error("Publishing requires the exact prepared version as its sole argument");
      const bundle = await loadPrepared(root, args[0]);
      const receiptPath = join(bundle.directory, `${operation}-receipt.json`);
      const previousReceipt = operation === "publish" ? await optionalJSON(receiptPath) : undefined;
      const scope = operation === "publish" ? `new release ZIP, ${bundle.images.length}-image gallery replacement, listing fields` : operation === "gallery" ? `${bundle.images.length}-image gallery replacement only` : "listing fields only";
      console.log(`${operation}: ${bundle.manifest.mod.name} ${args[0]}\nScope: ${scope}\nPrepared source tree: ${bundle.manifest.source.tree}\nPrepared ZIP SHA1: ${bundle.archive.sha1}\nPrepared gallery IDs: ${bundle.images.map(image => image.sha1).join(",")}\nReceipt: ${receiptPath}`);
      await publishPrepared(bundle, operation, {uploadKey: process.env.MOD_UPLOAD_API_KEY, editKey: process.env.MOD_EDIT_API_KEY, previousReceipt, saveReceipt: receipt => saveJSON(receiptPath, receipt)});
      console.log(`Verified ${operation}: https://mods.factorio.com/mod/${bundle.manifest.mod.name}`);
    } else throw new Error("Unknown release operation; use the named mise release tasks");
  });
}
if (import.meta.main) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
