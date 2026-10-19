import { afterEach, expect, test } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { Deferred, Effect, Fiber, FileSystem, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import type { HttpClientRequest } from "effect/http";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { releaseFixture } from "./fixtures/release.ts";
import { PortalMetadata } from "./mod-portal.ts";
import { BoundaryError } from "./projects.ts";
import {
  publicationDifferences,
  PublicationReceipt,
  publishRelease,
} from "./publication.ts";

type Fixture = Awaited<ReturnType<typeof releaseFixture>>;
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const keys = { uploadKey: "fixture-upload-key", editKey: "fixture-edit-key" };
const run = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | HttpClient.HttpClient>,
  client: HttpClient.HttpClient,
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(BunServices.layer),
      Effect.provideService(HttpClient.HttpClient, client),
    ),
  );
function metadata(f: Fixture, version = "1.0.0") {
  return Schema.decodeUnknownSync(PortalMetadata)({
    ...f.manifest.listing,
    name: f.project.info.name,
    license: { id: f.manifest.listing.license },
    releases: [
      {
        version,
        file_name: `primary_${version}.zip`,
        sha1:
          version === f.project.info.version
            ? f.manifest.archive.sha1
            : "0".repeat(40),
      },
    ],
    images: [{ id: "a".repeat(40) }],
  });
}
async function receipts(f: Fixture) {
  const directory = join(
    f.project.outputRoot,
    "publications",
    f.project.info.version,
  );
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return [];
    throw error;
  }
  return Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map(async (name) =>
        Schema.decodeUnknownSync(PublicationReceipt)(
          JSON.parse(await readFile(join(directory, name), "utf8")),
        ),
      ),
  );
}
function server(
  f: Fixture,
  initial = metadata(f),
  options: {
    failImage?: number;
    wrongReleaseHash?: boolean;
    missing?: boolean;
    beforeMutation?: (
      request: HttpClientRequest.HttpClientRequest,
      url: URL,
    ) => Promise<void>;
  } = {},
) {
  let state = initial;
  let imageUploads = 0;
  const posts: string[] = [];
  const client = HttpClient.make((request, url) =>
    Effect.promise(async () => {
      let response: Response;
      if (request.method === "GET")
        response = options.missing
          ? new Response(null, { status: 404 })
          : Response.json(state);
      else {
        posts.push(url.pathname);
        await options.beforeMutation?.(request, url);
        if (request.body._tag !== "FormData")
          throw new Error("Expected multipart Portal request");
        const form = request.body.formData;
        if (url.pathname.endsWith("init_upload"))
          response = Response.json({
            upload_url: "https://upload.example/release",
          });
        else if (url.pathname.endsWith("images/add"))
          response = Response.json({
            upload_url: "https://upload.example/image",
          });
        else if (url.pathname === "/release" || url.pathname === "/image") {
          const image = url.pathname === "/image";
          const file = form.get(image ? "image" : "file");
          if (!(file instanceof File))
            throw new Error("Expected uploaded file");
          const sha1 = new Bun.CryptoHasher("sha1")
            .update(await file.arrayBuffer())
            .digest("hex");
          if (image && ++imageUploads === options.failImage)
            response = new Response(null, { status: 503 });
          else if (image) {
            state = { ...state, images: [...state.images, { id: sha1 }] };
            response = Response.json({ id: sha1 });
          } else {
            state = {
              ...state,
              releases: [
                ...state.releases,
                {
                  version: f.project.info.version,
                  file_name: file.name,
                  sha1: options.wrongReleaseHash ? "0".repeat(40) : sha1,
                },
              ],
            };
            response = Response.json({ success: true });
          }
        } else if (url.pathname.endsWith("images/edit")) {
          const ids = form.get("images");
          if (typeof ids !== "string") throw new Error("Expected gallery IDs");
          state = { ...state, images: ids.split(",").map((id) => ({ id })) };
          response = Response.json({ success: true, images: state.images });
        } else if (url.pathname.endsWith("edit_details")) {
          const fields: Record<string, unknown> = Object.fromEntries(
            form.entries(),
          );
          delete fields.mod;
          state = Schema.decodeUnknownSync(PortalMetadata)({
            ...state,
            ...fields,
            license: { id: fields.license },
          });
          response = Response.json({ success: true });
        } else throw new Error(`Unexpected fixture endpoint: ${url.pathname}`);
      }
      return HttpClientResponse.fromWeb(request, response);
    }),
  );
  return { client, posts, state: () => state };
}

test("all required credentials are validated before readback or mutation", async () => {
  const f = await releaseFixture(roots);
  let requests = 0;
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      requests++;
      return HttpClientResponse.fromWeb(
        request,
        new Response(null, { status: 503 }),
      );
    }),
  );
  for (const supplied of [
    { uploadKey: "upload" },
    { ...keys, editKey: "bad\nkey" },
    { ...keys, uploadKey: "bad key" },
  ])
    expect(
      run(publishRelease(f.project, "1.0.1", "publish", supplied), client),
    ).rejects.toBeInstanceOf(BoundaryError);
  expect(requests).toBe(0);
  expect(await receipts(f)).toEqual([]);
});

test("first publication to an existing empty listing is journaled before every mutation", async () => {
  const f = await releaseFixture(roots);
  const states: string[] = [];
  const initial = { ...metadata(f), releases: [] };
  const remote = server(f, initial, {
    beforeMutation: async () => {
      const journal = (await receipts(f))[0]!;
      states.push(journal.events.at(-1)!.status);
      expect(journal.status).toBe("publishing");
    },
  });
  const result = await run(
    publishRelease(f.project, "1.0.1", "publish", keys),
    remote.client,
  );
  expect(result.status).toBe("verified");
  expect(result.events.map((entry) => [entry.operation, entry.status])).toEqual(
    [
      ["release-upload", "confirmed"],
      ["listing-update", "confirmed"],
    ],
  );
  expect(states).toEqual(["attempting", "attempting", "attempting"]);
  expect(remote.state().releases[0]!.sha1).toBe(f.manifest.archive.sha1);
  expect(remote.state().images).toEqual(initial.images);
  expect((await receipts(f))[0]!.status).toBe("verified");
});

test("missing listings, released versions and stale listing-wide targets never mutate", async () => {
  const f = await releaseFixture(roots, true);
  for (const [mode, current] of [
    ["publish", "1.0.1"],
    ["publish", "1.0.2"],
    ["gallery", "1.0.2"],
    ["listing", "1.0.0"],
  ] as const) {
    const remote = server(f, metadata(f, current));
    expect(
      run(publishRelease(f.project, "1.0.1", mode, keys), remote.client),
    ).rejects.toBeInstanceOf(BoundaryError);
    expect(remote.posts).toEqual([]);
  }
  const missing = server(f, metadata(f), { missing: true });
  expect(
    run(publishRelease(f.project, "1.0.1", "publish", keys), missing.client),
  ).rejects.toBeInstanceOf(BoundaryError);
  expect(missing.posts).toEqual([]);
  expect(await receipts(f)).toEqual([]);
});

test("matching version alone cannot authorize edits for an unverified public ZIP", async () => {
  const f = await releaseFixture(roots, true);
  const state = metadata(f, "1.0.1");
  const remote = server(f, {
    ...state,
    releases: state.releases.map((entry) => ({
      ...entry,
      sha1: "f".repeat(40),
    })),
  });
  for (const mode of ["gallery", "listing"] as const)
    expect(
      run(publishRelease(f.project, "1.0.1", mode, keys), remote.client),
    ).rejects.toBeInstanceOf(BoundaryError);
  expect(remote.posts).toEqual([]);
});

test("acknowledged uploads with wrong public bytes stop before gallery or listing changes", async () => {
  const f = await releaseFixture(roots, true);
  const remote = server(f, metadata(f), { wrongReleaseHash: true });
  expect(
    run(publishRelease(f.project, "1.0.1", "publish", keys), remote.client),
  ).rejects.toBeInstanceOf(BoundaryError);
  const journal = (await receipts(f))[0]!;
  expect(journal.status).toBe("stopped");
  expect(journal.events).toEqual([
    {
      operation: "release-upload",
      file: f.manifest.archive.file,
      status: "confirmed",
    },
  ]);
  expect(remote.posts).toEqual([
    "/api/v2/mods/releases/init_upload",
    "/release",
  ]);
  const again = server(f);
  expect(
    run(publishRelease(f.project, "1.0.1", "publish", keys), again.client),
  ).rejects.toBeInstanceOf(BoundaryError);
  expect(again.posts).toEqual([]);
});

test("late image failure preserves the previous gallery and records the uncertain step", async () => {
  const f = await releaseFixture(roots, true);
  const before = metadata(f, "1.0.1");
  const remote = server(f, before, { failImage: 2 });
  expect(
    run(publishRelease(f.project, "1.0.1", "gallery", keys), remote.client),
  ).rejects.toMatchObject({ _tag: "PortalError", status: 503 });
  expect(remote.state().images.slice(0, before.images.length)).toEqual([
    ...before.images,
  ]);
  expect(remote.posts.filter((path) => path === "/image")).toHaveLength(2);
  expect(remote.posts).not.toContain("/api/v2/mods/images/edit");
  const journal = (await receipts(f))[0]!;
  expect(journal.status).toBe("stopped");
  expect(journal.events.map((event) => event.status)).toEqual([
    "confirmed",
    "attempting",
  ]);
});

test("existing gallery images can be reordered and trimmed without uploading again", async () => {
  const f = await releaseFixture(roots, true);
  const selected = f.loaded.images.map((image) => ({ id: image.sha1 }));
  const before = {
    ...metadata(f, "1.0.1"),
    images: [...selected].reverse().concat({ id: "c".repeat(40) }),
  };
  const remote = server(f, before);
  const result = await run(
    publishRelease(f.project, "1.0.1", "gallery", keys),
    remote.client,
  );
  expect(result.status).toBe("verified");
  expect(result.previousImageIds).toEqual(
    before.images.map((image) => image.id),
  );
  expect(remote.state().images).toEqual(selected);
  expect(remote.posts).toEqual(["/api/v2/mods/images/edit"]);
});

test("interrupted uploads persist an uncertain outcome and cannot be resent automatically", async () => {
  const f = await releaseFixture(roots);
  const remote = server(f);
  let attempts = 0;
  await Effect.runPromise(
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const blocked = HttpClient.make((request, url) => {
        if (url.pathname !== "/release") return remote.client.execute(request);
        attempts++;
        return Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Effect.never),
        );
      });
      const owner = yield* Effect.forkChild(
        publishRelease(f.project, "1.0.1", "publish", keys).pipe(
          Effect.provideService(HttpClient.HttpClient, blocked),
        ),
      );
      yield* Deferred.await(entered);
      yield* Fiber.interrupt(owner);
    }).pipe(Effect.provide(BunServices.layer)),
  );
  const journal = (await receipts(f))[0]!;
  expect(journal.status).toBe("stopped");
  expect(journal.events).toEqual([
    {
      operation: "release-upload",
      file: f.manifest.archive.file,
      status: "attempting",
    },
  ]);
  expect(attempts).toBe(1);
  const next = server(f);
  expect(
    run(publishRelease(f.project, "1.0.1", "publish", keys), next.client),
  ).rejects.toBeInstanceOf(BoundaryError);
  expect(next.posts).toEqual([]);
});

test("publication readback distinguishes order and content drift from line endings", async () => {
  const f = await releaseFixture(roots, true);
  const state = {
    ...metadata(f, "1.0.1"),
    images: f.loaded.images.map((image) => ({ id: image.sha1 })),
    description: "\r\nFixture description.\r\n",
  };
  expect(publicationDifferences(state, f.loaded, "publish")).toEqual([]);
  expect(
    publicationDifferences(
      {
        ...state,
        images: [...state.images].reverse(),
        summary: "Unexpected summary",
      },
      f.loaded,
      "publish",
    ),
  ).toEqual(["gallery image IDs/order", "listing summary"]);
});
