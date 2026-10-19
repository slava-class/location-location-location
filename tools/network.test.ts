import { expect, test } from "bun:test";
import { Effect } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { BoundaryError } from "./projects.ts";
import { getBytes } from "./network.ts";
const factorio = { origin: "factorio", redirects: true } as const;
const bun = { origin: "github-release", redirects: true } as const;
function transport(handle: (url: URL) => Response) {
  return HttpClient.make((request, url) =>
    Effect.sync(() => HttpClientResponse.fromWeb(request, handle(url))),
  );
}
test("a Factorio redirect cannot cross into the separate Bun release capability", async () => {
  const requested: string[] = [];
  const client = transport((url) => {
    requested.push(url.href);
    return new Response(null, {
      status: 302,
      headers: {
        location:
          "https://github.com/oven-sh/bun/releases/download/file?token=private-sentinel",
      },
    });
  });
  const error = await Effect.runPromise(
    Effect.flip(
      getBytes(
        "https://mods.factorio.com/download/file?token=private-sentinel",
        "dependency",
        16,
        factorio,
      ),
    ).pipe(Effect.provideService(HttpClient.HttpClient, client)),
  );
  expect(error).toBeInstanceOf(BoundaryError);
  expect(requested).toEqual([
    "https://mods.factorio.com/download/file?token=private-sentinel",
  ]);
  expect(error.message).not.toContain("private-sentinel");
});
test("Bun release redirects are bounded and cannot downgrade or change authority", async () => {
  const withCredentials = new URL("https://github.com/archive");
  withCredentials.username = "fixture";
  withCredentials.password = crypto.randomUUID();
  for (const location of [
    "https://factorio.com/archive",
    "http://github.com/archive",
    "https://github.com:444/archive",
    "https://github.com.evil.invalid/archive",
    withCredentials.href,
  ]) {
    let requests = 0;
    const client = transport(() => {
      requests++;
      return new Response(null, { status: 302, headers: { location } });
    });
    const error = await Effect.runPromise(
      Effect.flip(
        getBytes(
          "https://github.com/oven-sh/bun/releases/download/file",
          "Bun",
          16,
          bun,
        ),
      ).pipe(Effect.provideService(HttpClient.HttpClient, client)),
    );
    expect(error).toBeInstanceOf(BoundaryError);
    expect(requests).toBe(1);
  }
  let requests = 0;
  const loop = transport(() => {
    requests++;
    return new Response(null, {
      status: 302,
      headers: {
        location: "https://release-assets.githubusercontent.com/loop",
      },
    });
  });
  expect(
    await Effect.runPromise(
      Effect.flip(getBytes("https://github.com/file", "Bun", 16, bun)).pipe(
        Effect.provideService(HttpClient.HttpClient, loop),
      ),
    ),
  ).toBeInstanceOf(BoundaryError);
  expect(requests).toBe(4);
});
test("the streamed download limit accepts its boundary and rejects the next byte", async () => {
  for (const length of [4, 5]) {
    const requested: string[] = [];
    const client = transport((url) => {
      requested.push(url.hostname);
      if (url.hostname === "github.com")
        return new Response(null, {
          status: 302,
          headers: {
            location: "https://release-assets.githubusercontent.com/archive",
          },
        });
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2]));
            controller.enqueue(new Uint8Array(length - 2).fill(3));
            controller.close();
          },
        }),
      );
    });
    const effect = getBytes("https://github.com/file", "Bun", 4, bun).pipe(
      Effect.provideService(HttpClient.HttpClient, client),
    );
    if (length === 4)
      expect(Array.from(await Effect.runPromise(effect))).toEqual([1, 2, 3, 3]);
    else
      expect(await Effect.runPromise(Effect.flip(effect))).toBeInstanceOf(
        BoundaryError,
      );
    expect(requested).toEqual([
      "github.com",
      "release-assets.githubusercontent.com",
    ]);
  }
});

test("source archive downloads cannot cross into release or credential-bearing Factorio origins", async () => {
  for (const location of [
    "https://github.com/archive",
    "https://mods.factorio.com/download/archive",
  ]) {
    const requested: string[] = [];
    const client = transport((url) => {
      requested.push(url.href);
      return new Response(null, { status: 302, headers: { location } });
    });
    const error = await Effect.runPromise(
      Effect.flip(
        getBytes(
          "https://codeload.github.com/owner/repo/tar.gz/tag",
          "Lua source",
          1024,
          { origin: "github-source", redirects: true },
        ),
      ).pipe(Effect.provideService(HttpClient.HttpClient, client)),
    );
    expect(error).toBeInstanceOf(BoundaryError);
    expect(requested).toEqual([
      "https://codeload.github.com/owner/repo/tar.gz/tag",
    ]);
  }
});
