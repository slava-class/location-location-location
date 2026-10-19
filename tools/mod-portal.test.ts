import { expect, test } from "bun:test";
import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import type { HttpClientRequest } from "effect/http";
import { makeModPortal } from "./mod-portal.ts";

const mod = "boundary-probe";
const metadata = (name = mod, version = "1.0.0") => ({
  name,
  releases: [
    { version, file_name: `${name}_${version}.zip`, sha1: "a".repeat(40) },
  ],
  images: [],
});
const file = () => {
  const bytes = new TextEncoder().encode("synthetic archive bytes");
  return {
    file: "boundary-probe_1.0.0.zip",
    bytes,
    sha1: new Bun.CryptoHasher("sha1").update(bytes).digest("hex"),
  };
};
function transport(
  handle: (request: HttpClientRequest.HttpClientRequest, url: URL) => Response,
) {
  return HttpClient.make((request, url) =>
    Effect.sync(() =>
      HttpClientResponse.fromWeb(request, handle(request, url)),
    ),
  );
}
function run<A, E>(
  operation: Effect.Effect<A, E, HttpClient.HttpClient>,
  client: HttpClient.HttpClient,
) {
  return Effect.runPromise(
    operation.pipe(Effect.provideService(HttpClient.HttpClient, client)),
  );
}

test("fresh metadata readbacks bypass stale URL-keyed responses", async () => {
  let version = "1.0.0";
  const cache = new Map<string, ReturnType<typeof metadata>>();
  const client = transport((_request, url) => {
    if (!cache.has(url.href)) cache.set(url.href, metadata(mod, version));
    return Response.json(cache.get(url.href));
  });
  const portal = makeModPortal();
  const before = await run(portal.metadata(mod), client);
  version = "1.0.1";
  const after = await run(portal.metadata(mod), client);
  expect(
    before.status === "found" && before.metadata.releases[0]?.version,
  ).toBe("1.0.0");
  expect(after.status === "found" && after.metadata.releases[0]?.version).toBe(
    "1.0.1",
  );
});

test("a missing listing is distinct from server failure and mismatched identity", async () => {
  const portal = makeModPortal();
  const missing = await run(
    portal.metadata(mod),
    transport(() => new Response(null, { status: 404 })),
  );
  expect(missing.status).toBe("missing");
  expect(missing.mod).toBe(mod);
  expect(
    run(
      portal.metadata(mod),
      transport(() => new Response(null, { status: 503 })),
    ),
  ).rejects.toMatchObject({ _tag: "PortalError", kind: "http", status: 503 });
  expect(
    run(
      portal.metadata(mod),
      transport(() => Response.json(metadata("other-mod"))),
    ),
  ).rejects.toMatchObject({ _tag: "BoundaryError", boundary: mod });
});

test("malformed UTF-8 and malformed success objects cannot become successful readbacks", async () => {
  const portal = makeModPortal();
  const malformed = new Uint8Array([
    ...new TextEncoder().encode('{"name":"'),
    0xff,
    ...new TextEncoder().encode('"}'),
  ]);
  for (const response of [
    new Response(malformed),
    Response.json({ name: mod, releases: [], images: "not-an-array" }),
  ]) {
    expect(
      run(
        portal.metadata(mod),
        transport(() => response),
      ),
    ).rejects.toMatchObject({ _tag: "PortalError", kind: "response" });
  }
});

test("oversized responses fail before JSON decoding", async () => {
  const client = transport(
    () => new Response(new Uint8Array(16 * 1024 * 1024 + 1)),
  );
  expect(run(makeModPortal().metadata(mod), client)).rejects.toMatchObject({
    _tag: "PortalError",
    kind: "response",
  });
});

test("API credentials remain on initialization, never the delegated file upload", async () => {
  const seen: { url: string; authorization: string | undefined }[] = [];
  const client = transport((request, url) => {
    seen.push({ url: url.href, authorization: request.headers.authorization });
    return Response.json(
      url.pathname.endsWith("init_upload")
        ? { upload_url: "https://upload.example/sealed-file" }
        : { success: true },
    );
  });
  await run(
    makeModPortal().upload("release", mod, file(), "private-test-key"),
    client,
  );
  expect(seen).toEqual([
    {
      url: "https://mods.factorio.com/api/v2/mods/releases/init_upload",
      authorization: "Bearer private-test-key",
    },
    { url: "https://upload.example/sealed-file", authorization: undefined },
  ]);
});

test("unsafe upload addresses stop before file disclosure", async () => {
  for (const upload_url of [
    "http://upload.example/file",
    "https://user:private@upload.example/file",
    "not-a-url",
  ]) {
    const calls: string[] = [];
    const client = transport((_request, url) => {
      calls.push(url.href);
      return Response.json({ upload_url });
    });
    expect(
      run(makeModPortal().upload("release", mod, file(), "test-key"), client),
    ).rejects.toMatchObject({ _tag: "PortalError", kind: "response" });
    expect(calls).toEqual([
      "https://mods.factorio.com/api/v2/mods/releases/init_upload",
    ]);
  }
});

test("changed upload bytes and malformed keys stop before any request", async () => {
  let requests = 0;
  const client = transport(() => {
    requests++;
    return Response.json({ success: true });
  });
  const changed = file();
  changed.bytes[0] = 0;
  expect(
    run(makeModPortal().upload("release", mod, changed, "test-key"), client),
  ).rejects.toMatchObject({ _tag: "BoundaryError" });
  expect(
    run(makeModPortal().upload("release", mod, file(), "bad\nkey"), client),
  ).rejects.toMatchObject({ _tag: "BoundaryError" });
  expect(requests).toBe(0);
});

test("upload initialization cannot change the already-sealed outgoing bytes", async () => {
  const upload = file();
  const original = new Uint8Array(upload.bytes);
  let sent: FormDataEntryValue | null = null;
  const client = transport((request, url) => {
    if (url.pathname.endsWith("init_upload")) {
      upload.bytes.fill(0);
      return Response.json({ upload_url: "https://upload.example/file" });
    }
    if (request.body._tag === "FormData")
      sent = request.body.formData.get("file");
    return Response.json({ success: true });
  });
  await run(makeModPortal().upload("release", mod, upload, "test-key"), client);
  const transmitted = sent as FormDataEntryValue | null;
  if (!(transmitted instanceof File))
    throw new Error("Expected a sealed file upload");
  expect(new Uint8Array(await transmitted.arrayBuffer())).toEqual(original);
});

test("unconfirmed mutations are not retried and server payloads are not disclosed", async () => {
  let requests = 0;
  const secret = "private-server-error-marker";
  const client = transport((_request, url) => {
    requests++;
    return Response.json(
      url.pathname.endsWith("init_upload")
        ? { upload_url: "https://upload.example/file" }
        : { error: secret, message: secret },
    );
  });
  const outcome = await run(
    makeModPortal()
      .upload("release", mod, file(), "test-key")
      .pipe(Effect.exit),
    client,
  );
  expect(Exit.isFailure(outcome)).toBe(true);
  if (Exit.isFailure(outcome))
    expect(Cause.pretty(outcome.cause)).not.toContain(secret);
  expect(requests).toBe(2);
});

test("redirects and incorrect image acknowledgements cannot certify uploads", async () => {
  let requests = 0;
  const redirect = transport(() => {
    requests++;
    return new Response(null, {
      status: 302,
      headers: { location: "https://other.example/file" },
    });
  });
  expect(
    run(makeModPortal().upload("image", mod, file(), "test-key"), redirect),
  ).rejects.toMatchObject({ _tag: "PortalError", kind: "http", status: 302 });
  expect(requests).toBe(1);
  const wrongHash = transport((_request, url) =>
    Response.json(
      url.pathname.endsWith("/images/add")
        ? { upload_url: "https://upload.example/image" }
        : { id: "0".repeat(40) },
    ),
  );
  expect(
    run(makeModPortal().upload("image", mod, file(), "test-key"), wrongHash),
  ).rejects.toMatchObject({ _tag: "BoundaryError" });
});

test("duplicate gallery IDs and reordered acknowledgements are rejected", async () => {
  const ids = ["a".repeat(40), "b".repeat(40)];
  let requests = 0;
  const client = transport(() => {
    requests++;
    return Response.json({
      success: true,
      images: [...ids].reverse().map((id) => ({ id })),
    });
  });
  expect(
    run(makeModPortal().gallery(mod, [ids[0]!, ids[0]!], "test-key"), client),
  ).rejects.toMatchObject({ _tag: "BoundaryError" });
  expect(requests).toBe(0);
  expect(
    run(makeModPortal().gallery(mod, ids, "test-key"), client),
  ).rejects.toMatchObject({ _tag: "BoundaryError" });
  expect(requests).toBe(1);
});

test("cancelling an in-flight mutation does not start another request", async () => {
  let requests = 0;
  let finished = false;
  await Effect.runPromise(
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const client = HttpClient.make((request, url) => {
        requests++;
        if (url.pathname.endsWith("init_upload"))
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              Response.json({ upload_url: "https://upload.example/file" }),
            ),
          );
        return Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(
            Effect.sync(() => {
              finished = true;
            }),
          ),
        );
      });
      const worker = yield* Effect.forkChild(
        makeModPortal()
          .upload("release", mod, file(), "test-key")
          .pipe(Effect.provideService(HttpClient.HttpClient, client)),
      );
      yield* Deferred.await(entered);
      yield* Fiber.interrupt(worker);
    }),
  );
  expect(finished).toBe(true);
  expect(requests).toBe(2);
});
