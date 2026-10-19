import { Cause, Effect, Exit, FileSystem, Schema } from "effect";
import { join } from "node:path";
import { ModIdentity, Sha1 } from "./contracts.ts";
import { compareVersions } from "./dependencies.ts";
import { withReleaseLock } from "./locks.ts";
import { RunId } from "./logs.ts";
import {
  makeModPortal,
  PortalKey,
  PortalLookup,
  PortalMetadata,
} from "./mod-portal.ts";
import {
  BoundaryError,
  decode,
  prepareOutputDirectory,
  readJSON,
  RelativePath,
  Version,
} from "./projects.ts";
import type { ResolvedProject } from "./projects.ts";
import {
  inspectPrepared,
  loadPrepared,
  PreparedStatus,
  saveReleaseJSON,
} from "./release.ts";
import type { PreparedRelease } from "./release.ts";
import { SourceSeal } from "./source.ts";

export const PublicationMode = Schema.Literals([
  "publish",
  "gallery",
  "listing",
]);
const Operation = Schema.Literals([
  "release-upload",
  "image-upload",
  "gallery-order",
  "listing-update",
]);
const PublicationEvent = Schema.Struct({
  operation: Operation,
  file: Schema.NullOr(RelativePath),
  status: Schema.Literals(["attempting", "confirmed"]),
});
export const PublicationReceipt = Schema.Struct({
  schema: Schema.Literal(1),
  runId: RunId,
  mod: ModIdentity,
  mode: PublicationMode,
  source: SourceSeal,
  archiveSha1: Sha1,
  startedAt: Schema.NonEmptyString,
  finishedAt: Schema.NullOr(Schema.NonEmptyString),
  status: Schema.Literals(["publishing", "stopped", "verified"]),
  previousImageIds: Schema.Array(Sha1),
  events: Schema.Array(PublicationEvent),
  error: Schema.NullOr(Schema.String),
});
const requirePublication = (condition: boolean, message: string) =>
  condition
    ? Effect.void
    : Effect.fail(new BoundaryError({ boundary: "publication", message }));
const historyDirectory = (project: ResolvedProject) =>
  join(project.outputRoot, "publications", project.info.version);
function latestRelease(metadata: typeof PortalMetadata.Type) {
  return metadata.releases.reduce<
    (typeof metadata.releases)[number] | undefined
  >(
    (latest, entry) =>
      latest === undefined || compareVersions(entry.version, latest.version) > 0
        ? entry
        : latest,
    undefined,
  );
}
const normalizeText = (value: unknown) =>
  typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : value;
export function publicationDifferences(
  metadata: typeof PortalMetadata.Type,
  bundle: PreparedRelease,
  mode: typeof PublicationMode.Type,
) {
  const { manifest } = bundle;
  const differences: string[] = [];
  const release = metadata.releases.find(
    (entry) => entry.version === manifest.mod.version,
  );
  if (
    !release ||
    release.sha1 !== manifest.archive.sha1 ||
    release.file_name !== manifest.archive.file
  )
    differences.push("release version/ZIP SHA1");
  if (
    mode !== "listing" &&
    bundle.images.length !== 0 &&
    metadata.images.map((image) => image.id).join(",") !==
      bundle.images.map((image) => image.sha1).join(",")
  )
    differences.push("gallery image IDs/order");
  if (mode !== "gallery") {
    for (const [field, expected] of Object.entries(manifest.listing)) {
      const actual =
        field === "license"
          ? metadata.license?.id
          : metadata[field as keyof typeof metadata];
      if (normalizeText(actual) !== normalizeText(expected))
        differences.push(`listing ${field}`);
    }
  }
  return differences;
}
function readHistory(project: ResolvedProject) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = historyDirectory(project);
    if (!(yield* fs.exists(directory))) return [];
    yield* requirePublication(
      (yield* fs.realPath(directory)) === directory,
      "Publication history is redirected",
    );
    const receipts: (typeof PublicationReceipt.Type)[] = [];
    for (const name of (yield* fs.readDirectory(directory)).sort()) {
      const path = join(directory, name);
      yield* requirePublication(
        (yield* fs.realPath(path)) === path,
        "Publication receipt is redirected",
      );
      const receipt = yield* readJSON(PublicationReceipt, path);
      yield* requirePublication(
        name === `${receipt.runId}.json` &&
          receipt.mod.name === project.info.name &&
          receipt.mod.version === project.info.version,
        "Publication history contains a mismatched target or identity",
      );
      receipts.push(receipt);
    }
    return receipts;
  });
}

export function publishRelease(
  project: ResolvedProject,
  inputVersion: string,
  inputMode: typeof PublicationMode.Type,
  keys: { uploadKey?: string; editKey?: string },
) {
  return withReleaseLock(
    project,
    Effect.gen(function* () {
      const mode = yield* decode(
        PublicationMode,
        inputMode,
        "publication mode",
      );
      const editKey = yield* decode(
        PortalKey,
        keys.editKey,
        "MOD_EDIT_API_KEY (Edit Mods)",
      );
      const uploadKey =
        mode === "publish"
          ? yield* decode(
              PortalKey,
              keys.uploadKey,
              "MOD_UPLOAD_API_KEY (Upload Mods)",
            )
          : null;
      const bundle = yield* loadPrepared(project, inputVersion);
      const previous = yield* readHistory(project);
      yield* requirePublication(
        mode !== "publish" ||
          !previous.some((receipt) =>
            receipt.events.some(
              (event) => event.operation === "release-upload",
            ),
          ),
        "This version already has a release-upload attempt. Inspect release-status and its journal; do not automatically resend an acknowledged or uncertain ZIP upload",
      );
      yield* requirePublication(
        mode !== "gallery" || bundle.images.length !== 0,
        "This prepared product has no gallery replacement",
      );
      const portal = makeModPortal();
      const lookup = yield* portal.metadata(project.info.name);
      if (lookup.status === "missing")
        return yield* Effect.fail(
          new BoundaryError({
            boundary: project.info.name,
            message:
              "Portal listing does not exist; creation is a separate explicitly authorized operation",
          }),
        );
      const before = lookup.metadata;
      const latest = latestRelease(before);
      const { manifest } = bundle;
      if (mode === "publish") {
        yield* requirePublication(
          !before.releases.some(
            (entry) => entry.version === manifest.mod.version,
          ) &&
            (latest === undefined ||
              compareVersions(manifest.mod.version, latest.version) > 0),
          "Portal already has this version or a newer release; no mutation attempted",
        );
      } else {
        yield* requirePublication(
          latest?.version === manifest.mod.version &&
            latest.sha1 === manifest.archive.sha1 &&
            latest.file_name === manifest.archive.file,
          "Listing-wide edits require the latest published version and exact ZIP to match the prepared product",
        );
      }
      const runId = crypto.randomUUID();
      const path = join(historyDirectory(project), `${runId}.json`);
      const events: {
        operation: typeof Operation.Type;
        file: string | null;
        status: "attempting" | "confirmed";
      }[] = [];
      const receipt = {
        schema: 1 as const,
        runId,
        mod: manifest.mod,
        mode,
        source: manifest.source,
        archiveSha1: manifest.archive.sha1,
        startedAt: new Date().toISOString(),
        finishedAt: null as string | null,
        status: "publishing" as "publishing" | "stopped" | "verified",
        previousImageIds: before.images.map((image) => image.id),
        events,
        error: null as string | null,
      };
      const persist = () => saveReleaseJSON(path, PublicationReceipt, receipt);
      yield* prepareOutputDirectory(historyDirectory(project));
      yield* persist();
      function mutate<A, E, R>(
        operation: typeof Operation.Type,
        action: Effect.Effect<A, E, R>,
        file: string | null = null,
      ) {
        return Effect.gen(function* () {
          const event = {
            operation,
            file,
            status: "attempting" as "attempting" | "confirmed",
          };
          events.push(event);
          yield* persist();
          const result = yield* action;
          event.status = "confirmed";
          yield* persist();
          return result;
        });
      }
      return yield* Effect.gen(function* () {
        if (mode === "publish") {
          yield* mutate(
            "release-upload",
            portal.upload(
              "release",
              manifest.mod.name,
              bundle.archive,
              uploadKey!,
            ),
            bundle.archive.file,
          );
          const uploaded = yield* portal.metadata(manifest.mod.name);
          yield* requirePublication(
            uploaded.status === "found" &&
              uploaded.metadata.releases.some(
                (entry) =>
                  entry.version === manifest.mod.version &&
                  entry.sha1 === manifest.archive.sha1 &&
                  entry.file_name === manifest.archive.file,
              ),
            "Upload acknowledged but public ZIP readback differs; gallery and listing were not changed",
          );
        }
        if (mode !== "listing" && bundle.images.length !== 0) {
          const existing = new Set(before.images.map((image) => image.id));
          for (const image of bundle.images) {
            if (!existing.has(image.sha1))
              yield* mutate(
                "image-upload",
                portal.upload("image", manifest.mod.name, image, editKey),
                image.file,
              );
          }
          yield* mutate(
            "gallery-order",
            portal.gallery(
              manifest.mod.name,
              bundle.images.map((image) => image.sha1),
              editKey,
            ),
          );
        }
        if (mode !== "gallery")
          yield* mutate(
            "listing-update",
            portal.listing(manifest.mod.name, manifest.listing, editKey),
          );
        const readback = yield* portal.metadata(manifest.mod.name);
        if (readback.status === "missing")
          return yield* Effect.fail(
            new BoundaryError({
              boundary: manifest.mod.name,
              message:
                "Listing disappeared during publication; inspect the journal",
            }),
          );
        const differences = publicationDifferences(
          readback.metadata,
          bundle,
          mode,
        );
        yield* requirePublication(
          differences.length === 0,
          `Public readback differs: ${differences.join(", ")}; no retry or rollback attempted`,
        );
        receipt.status = "verified";
        receipt.finishedAt = new Date().toISOString();
        yield* persist();
        return yield* decode(PublicationReceipt, receipt, "publication result");
      }).pipe(
        Effect.onExit((exit) =>
          Effect.gen(function* () {
            if (Exit.isSuccess(exit)) return;
            receipt.status = "stopped";
            receipt.finishedAt = new Date().toISOString();
            receipt.error = Cause.pretty(exit.cause);
            yield* persist();
          }),
        ),
      );
    }),
  );
}

const ReleaseStatus = Schema.Struct({
  mod: ModIdentity,
  portal: PortalLookup,
  latest: Schema.NullOr(Version),
  prepared: PreparedStatus,
  differences: Schema.NullOr(Schema.Array(Schema.String)),
  publications: Schema.Array(PublicationReceipt),
  commands: Schema.Array(Schema.Array(Schema.String)),
});
export function releaseStatus(project: ResolvedProject) {
  return Effect.gen(function* () {
    const portal = yield* makeModPortal().metadata(project.info.name);
    const publications = yield* readHistory(project);
    const { status: prepared, bundle } = yield* inspectPrepared(project);
    const differences =
      bundle === null
        ? null
        : portal.status === "found"
          ? publicationDifferences(portal.metadata, bundle, "publish")
          : ["Portal listing is missing"];
    const latest =
      portal.status === "found" ? latestRelease(portal.metadata) : undefined;
    const commands = [
      ["mise", "run", "release-status", "--", project.info.name],
    ];
    if (prepared.state !== "ready")
      commands.push([
        "mise",
        "run",
        "release-prepare",
        "--",
        project.info.name,
      ]);
    // Recovery readbacks never authorize or repeat a mutation.
    return yield* decode(
      ReleaseStatus,
      {
        mod: { name: project.info.name, version: project.info.version },
        portal,
        latest: latest?.version ?? null,
        prepared,
        differences,
        publications,
        commands,
      },
      "release status",
    );
  });
}
