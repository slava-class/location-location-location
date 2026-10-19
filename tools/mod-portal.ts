import { Data, Effect, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { Sha1 } from "./contracts.ts";
import { readResponseBytes } from "./network.ts";
import {
  BoundaryError,
  decode,
  decodeJSON,
  ModId,
  RelativePath,
  Version,
} from "./projects.ts";
import { Listing } from "./release-info.ts";

const origin = "https://mods.factorio.com";
export const PortalKey = Schema.String.check(
  Schema.isPattern(/^[\x21-\x7e]+$(?![\s\S])/u),
);
const OptionalText = Schema.optionalKey(Schema.NullOr(Schema.String));
export const PortalMetadata = Schema.Struct({
  name: ModId,
  releases: Schema.Array(
    Schema.Struct({
      version: Version,
      file_name: Schema.NonEmptyString,
      sha1: Sha1,
    }),
  ),
  images: Schema.Array(Schema.Struct({ id: Sha1 })),
  title: OptionalText,
  summary: OptionalText,
  description: OptionalText,
  category: OptionalText,
  homepage: OptionalText,
  source_url: OptionalText,
  license: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ id: Schema.String })),
  ),
});
export const PortalLookup = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("found"),
    mod: ModId,
    checkedAt: Schema.NonEmptyString,
    metadata: PortalMetadata,
  }),
  Schema.Struct({
    status: Schema.Literal("missing"),
    mod: ModId,
    checkedAt: Schema.NonEmptyString,
  }),
]);
class PortalError extends Data.TaggedError("PortalError")<{
  readonly operation: string;
  readonly kind: "http" | "api" | "response" | "transport";
  readonly status: number | null;
  readonly message: string;
}> {}
const APIError = Schema.Struct({ error: Schema.Json });
const ErrorCode = Schema.Literals([
  "InvalidApiKey",
  "InvalidRequest",
  "InternalError",
  "Forbidden",
  "Unknown",
  "InvalidModRelease",
  "InvalidModUpload",
  "UnknownMod",
  "InvalidImageUpload",
]);
const Acknowledgement = Schema.Struct({ success: Schema.Literal(true) });
const ImageAcknowledgement = Schema.Struct({ id: Sha1 });
const GalleryAcknowledgement = Schema.Struct({
  success: Schema.Literal(true),
  images: Schema.Array(ImageAcknowledgement),
});
const UploadInitialization = Schema.Struct({
  upload_url: Schema.NonEmptyString,
});
const UploadKind = Schema.Literals(["release", "image"]);
const UploadIdentity = Schema.Struct({
  file: RelativePath.check(Schema.isPattern(/^[^/]+$(?![\s\S])/u)),
  sha1: Sha1,
});
export type PortalFile = typeof UploadIdentity.Type & {
  readonly bytes: Uint8Array;
};

function request<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  address: string,
  operation: string,
  options: {
    fields?: Readonly<Record<string, string>>;
    key?: string;
    body?: FormData;
  } = {},
) {
  return Effect.scoped(
    Effect.gen(function* () {
      const url = yield* Effect.try({
        try: () => new URL(address),
        catch: () =>
          new PortalError({
            operation,
            kind: "response",
            status: null,
            message: "Invalid Portal address; address withheld",
          }),
      });
      if (url.protocol !== "https:" || url.username || url.password)
        return yield* Effect.fail(
          new PortalError({
            operation,
            kind: "response",
            status: null,
            message:
              "Portal addresses must use HTTPS without embedded credentials",
          }),
        );
      let body = options.body;
      if (options.fields !== undefined) {
        body = new FormData();
        for (const [name, value] of Object.entries(options.fields))
          body.set(name, value);
      }
      let outgoing =
        body === undefined
          ? HttpClientRequest.get(url)
          : HttpClientRequest.post(url).pipe(
              HttpClientRequest.bodyFormData(body),
            );
      if (options.key !== undefined) {
        const key = yield* decode(PortalKey, options.key, "Portal API key");
        if (url.origin !== origin || !url.pathname.startsWith("/api/v2/mods/"))
          return yield* Effect.fail(
            new PortalError({
              operation,
              kind: "response",
              status: null,
              message:
                "API keys may only be sent to official authenticated Portal endpoints",
            }),
          );
        outgoing = outgoing.pipe(
          HttpClientRequest.setHeader("Authorization", `Bearer ${key}`),
        );
      }
      const client = yield* HttpClient.HttpClient;
      const response = yield* client.execute(outgoing);
      if (response.status < 200 || response.status >= 300)
        return yield* Effect.fail(
          new PortalError({
            operation,
            kind: "http",
            status: response.status,
            message: `Portal HTTP ${response.status}; any attempted mutation is unconfirmed`,
          }),
        );
      const value = yield* decodeJSON(
        Schema.Json,
        yield* readResponseBytes(response, operation, 16 * 1024 * 1024),
        operation,
      );
      if (Schema.is(APIError)(value)) {
        const code = Schema.is(ErrorCode)(value.error)
          ? value.error
          : "UnrecognizedError";
        return yield* Effect.fail(
          new PortalError({
            operation,
            kind: "api",
            status: response.status,
            message: `Portal ${code}; server message withheld`,
          }),
        );
      }
      return yield* decode(schema, value, operation, true);
    }),
  ).pipe(
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
    Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
    Effect.provideService(HttpClient.TracerPropagationEnabled, false),
    Effect.timeout(120000),
    Effect.mapError((error) =>
      error instanceof PortalError
        ? error
        : new PortalError({
            operation,
            kind: error instanceof BoundaryError ? "response" : "transport",
            status: null,
            message:
              "Portal request failed, timed out, or returned invalid data; credentials, addresses and response text are withheld; any attempted mutation is unconfirmed",
          }),
    ),
  );
}

export function makeModPortal() {
  return {
    metadata: (input: string) =>
      Effect.gen(function* () {
        const mod = yield* decode(ModId, input, "Portal target");
        const result = yield* request(
          PortalMetadata,
          `${origin}/api/mods/${encodeURIComponent(mod)}/full?readback=${crypto.randomUUID()}`,
          "Portal readback",
        ).pipe(
          Effect.map((metadata) => ({ status: "found" as const, metadata })),
          Effect.catchTag("PortalError", (error) =>
            error.kind === "http" && error.status === 404
              ? Effect.succeed({ status: "missing" as const })
              : Effect.fail(error),
          ),
        );
        if (result.status === "found" && result.metadata.name !== mod)
          return yield* Effect.fail(
            new BoundaryError({
              boundary: mod,
              message: "Portal readback returned a different mod identity",
            }),
          );
        return yield* decode(
          PortalLookup,
          { ...result, mod, checkedAt: new Date().toISOString() },
          "Portal lookup",
        );
      }),
    upload: (
      inputKind: "release" | "image",
      inputMod: string,
      file: PortalFile,
      inputKey: string,
    ) =>
      Effect.gen(function* () {
        const kind = yield* decode(UploadKind, inputKind, "Portal upload kind");
        const mod = yield* decode(ModId, inputMod, "Portal target");
        const key = yield* decode(PortalKey, inputKey, "Portal API key");
        const identity = yield* decode(
          UploadIdentity,
          { file: file.file, sha1: file.sha1 },
          "Portal upload identity",
        );
        if (
          new Bun.CryptoHasher("sha1").update(file.bytes).digest("hex") !==
          identity.sha1
        )
          return yield* Effect.fail(
            new BoundaryError({
              boundary: identity.file,
              message:
                "Upload bytes differ from their sealed identity; no request attempted",
            }),
          );
        if (!(file.bytes.buffer instanceof ArrayBuffer))
          return yield* Effect.fail(
            new BoundaryError({
              boundary: identity.file,
              message: "Uploads require owned, non-shared byte storage",
            }),
          );
        // Blob snapshots these validated bytes before the first asynchronous request.
        const body = new FormData();
        body.set(
          kind === "release" ? "file" : "image",
          new Blob([file.bytes as Uint8Array<ArrayBuffer>], {
            type: kind === "release" ? "application/zip" : "image/png",
          }),
          identity.file,
        );
        const initialization = yield* request(
          UploadInitialization,
          `${origin}/api/v2/mods/${kind === "release" ? "releases/init_upload" : "images/add"}`,
          `${kind} upload initialization`,
          { fields: { mod }, key },
        );
        // Signed upload URLs receive bytes, never the API key or redirected credentials.
        if (kind === "release") {
          yield* request(
            Acknowledgement,
            initialization.upload_url,
            "Release upload",
            { body },
          );
          return { kind, sha1: identity.sha1 };
        }
        const uploaded = yield* request(
          ImageAcknowledgement,
          initialization.upload_url,
          "Image upload",
          { body },
        );
        if (uploaded.id !== identity.sha1)
          return yield* Effect.fail(
            new BoundaryError({
              boundary: identity.file,
              message:
                "Portal image acknowledgement differs from the uploaded SHA1",
            }),
          );
        return { kind, sha1: uploaded.id };
      }),
    gallery: (
      inputMod: string,
      inputIds: readonly string[],
      inputKey: string,
    ) =>
      Effect.gen(function* () {
        const mod = yield* decode(ModId, inputMod, "Portal target");
        const key = yield* decode(PortalKey, inputKey, "Portal API key");
        const ids = yield* decode(
          Schema.Array(Sha1).check(Schema.isMinLength(1)),
          inputIds,
          "Portal gallery IDs",
        );
        if (new Set(ids).size !== ids.length)
          return yield* Effect.fail(
            new BoundaryError({
              boundary: mod,
              message: "Gallery IDs must be distinct",
            }),
          );
        const result = yield* request(
          GalleryAcknowledgement,
          `${origin}/api/v2/mods/images/edit`,
          "Gallery ordering",
          { fields: { mod, images: ids.join(",") }, key },
        );
        if (result.images.map((image) => image.id).join(",") !== ids.join(","))
          return yield* Effect.fail(
            new BoundaryError({
              boundary: mod,
              message: "Portal did not confirm the requested gallery order",
            }),
          );
        return result;
      }),
    listing: (
      inputMod: string,
      inputFields: typeof Listing.Type,
      inputKey: string,
    ) =>
      Effect.gen(function* () {
        const mod = yield* decode(ModId, inputMod, "Portal target");
        const key = yield* decode(PortalKey, inputKey, "Portal API key");
        const fields = yield* decode(
          Listing,
          inputFields,
          "Portal listing request",
        );
        return yield* request(
          Acknowledgement,
          `${origin}/api/v2/mods/edit_details`,
          "Listing update",
          { fields: { mod, ...fields }, key },
        );
      }),
  };
}
