import { Effect, Schema, Stream } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import type { HttpClientResponse } from "effect/http";
import { BoundaryError, decode, decodeJSON } from "./projects.ts";

const DownloadPolicy = Schema.Struct({
  origin: Schema.Literals(["factorio", "github-release", "github-source"]),
  redirects: Schema.Boolean,
});
export function readResponseBytes(
  response: HttpClientResponse.HttpClientResponse,
  label: string,
  maxBytes: number,
) {
  return Effect.gen(function* () {
    const parts: Uint8Array[] = [];
    let length = 0;
    yield* Stream.runForEach(response.stream, (part) =>
      Effect.gen(function* () {
        length += part.byteLength;
        if (length > maxBytes)
          return yield* Effect.fail(
            new BoundaryError({
              boundary: label,
              message: "Response exceeds its size limit",
            }),
          );
        parts.push(part);
      }),
    );
    return Buffer.concat(parts, length);
  });
}

export function getBytes(
  address: string,
  label: string,
  maxBytes: number,
  options: typeof DownloadPolicy.Type,
) {
  return Effect.scoped(
    Effect.gen(function* () {
      const policy = yield* decode(
        DownloadPolicy,
        options,
        label + " download policy",
      );
      const client = yield* HttpClient.HttpClient;
      let url = yield* Effect.try({
        try: () => new URL(address),
        catch: () =>
          new BoundaryError({
            boundary: label,
            message: "Invalid download address",
          }),
      });
      for (let hop = 0; hop <= 3; hop++) {
        const approved =
          policy.origin === "factorio"
            ? url.hostname === "factorio.com" ||
              url.hostname.endsWith(".factorio.com")
            : policy.origin === "github-source"
              ? url.hostname === "codeload.github.com"
              : url.hostname === "github.com" ||
                url.hostname === "release-assets.githubusercontent.com";
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.port !== "" ||
          !approved
        )
          return yield* Effect.fail(
            new BoundaryError({
              boundary: label,
              message: `Download origin is not approved for ${policy.origin}`,
            }),
          );
        const response = yield* client.get(url);
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.location;
          if (!policy.redirects || hop === 3 || location === undefined)
            return yield* Effect.fail(
              new BoundaryError({
                boundary: label,
                message: "Unexpected or excessive download redirect",
              }),
            );
          url = yield* Effect.try({
            try: () => new URL(location, url),
            catch: () =>
              new BoundaryError({
                boundary: label,
                message: "Invalid download redirect",
              }),
          });
          continue;
        }
        if (response.status !== 200)
          return yield* Effect.fail(
            new BoundaryError({
              boundary: label,
              message: `Download failed with HTTP ${response.status}`,
            }),
          );
        return yield* readResponseBytes(response, label, maxBytes);
      }
      return yield* Effect.fail(
        new BoundaryError({
          boundary: label,
          message: "Download did not complete",
        }),
      );
    }),
  ).pipe(
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
    Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
    Effect.provideService(HttpClient.TracerPropagationEnabled, false),
    Effect.timeout(120000),
    Effect.mapError((error) =>
      error instanceof BoundaryError
        ? error
        : new BoundaryError({
            boundary: label,
            message:
              "Download failed or timed out; credentials and signed addresses are withheld",
          }),
    ),
  );
}
export function getJSON<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  address: string,
  label: string,
) {
  return Effect.gen(function* () {
    const bytes = yield* getBytes(address, label, 16 * 1024 * 1024, {
      origin: "factorio",
      redirects: false,
    });
    return yield* decodeJSON(schema, bytes, label, true);
  });
}
