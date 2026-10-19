import { Socket } from "node:net";
import { Data, Effect, Schema } from "effect";
import { decode } from "./projects.ts";

export const RconOptions = Schema.Struct({
  host: Schema.Literal("127.0.0.1"),
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
  password: Schema.NonEmptyString.check(
    Schema.makeFilter(
      (value) => Buffer.byteLength(value) <= 1024 && !/[\0\r\n]/.test(value),
    ),
  ),
  timeoutMs: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 60000 })),
});
const Command = Schema.NonEmptyString.check(
  Schema.makeFilter(
    (value) => !value.includes("\0") && Buffer.byteLength(value) <= 65536,
  ),
);
const Length = Schema.Int.check(
  Schema.isBetween({ minimum: 10, maximum: 1024 * 1024 }),
);
const Header = Schema.Struct({ id: Schema.Int, type: Schema.Literals([0, 2]) });
const decodeLength = Schema.decodeUnknownSync(Length);
const decodeHeader = Schema.decodeUnknownSync(Header);
const utf8 = new TextDecoder("utf-8", { fatal: true });

export class RconError extends Data.TaggedError("RconError")<{
  readonly code:
    | "connect"
    | "authentication"
    | "protocol"
    | "timeout"
    | "disconnected"
    | "busy"
    | "cancelled";
  readonly message: string;
  readonly outcomeUnknown: boolean;
}> {}

interface Pending {
  readonly kind: "connect" | "authenticate" | "command";
  readonly id: number;
  readonly resolve: (body: string) => void;
  readonly reject: (error: RconError) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly signal: AbortSignal;
  readonly abort: () => void;
  authPreamble: boolean;
  sent: boolean;
}

// Factorio returns one response frame, including empty and large responses.
// Source's type-0 sentinel is not supported. Fragmentation is TCP framing,
// not a reason to send another command or replay a mutation.
class Connection {
  private readonly socket = new Socket();
  private readonly prefix = Buffer.alloc(4);
  private prefixBytes = 0;
  private frame: Buffer | undefined;
  private frameBytes = 0;
  private nextId = 1;
  private authenticated = false;
  private pending: Pending | undefined;
  private terminal: RconError | undefined;

  constructor(private readonly options: typeof RconOptions.Type) {
    this.socket.on("data", (chunk: Buffer) => this.receive(chunk));
    this.socket.on("error", () =>
      this.fail("disconnected", "RCON socket failed; connection is terminal"),
    );
    this.socket.on("end", () =>
      this.fail("disconnected", "RCON peer ended the connection"),
    );
    this.socket.on("close", () =>
      this.fail("disconnected", "RCON connection closed"),
    );
  }

  private clear(pending: Pending) {
    clearTimeout(pending.timer);
    pending.signal.removeEventListener("abort", pending.abort);
    this.pending = undefined;
  }

  private fail(code: RconError["code"], message: string) {
    if (this.terminal) return;
    const pending = this.pending;
    this.terminal = new RconError({
      code,
      message,
      outcomeUnknown: pending?.kind === "command" && pending.sent,
    });
    this.authenticated = false;
    if (pending) {
      this.clear(pending);
      pending.reject(this.terminal);
    }
    this.frame = undefined;
    this.socket.destroy();
  }

  close() {
    this.fail("disconnected", "RCON scope closed");
  }

  private operation(
    kind: Pending["kind"],
    id: number,
    signal: AbortSignal,
    send: () => void,
  ) {
    if (this.terminal) return Promise.reject(this.terminal);
    if (this.pending)
      return Promise.reject(
        new RconError({
          code: "busy",
          message: "RCON permits one in-flight operation",
          outcomeUnknown: false,
        }),
      );
    return new Promise<string>((resolve, reject) => {
      const abort = () =>
        this.fail(
          "cancelled",
          "RCON operation cancelled; connection is terminal",
        );
      const timer = setTimeout(
        () =>
          this.fail(
            "timeout",
            "RCON operation timed out; connection is terminal",
          ),
        this.options.timeoutMs,
      );
      this.pending = {
        kind,
        id,
        resolve,
        reject,
        timer,
        signal,
        abort,
        authPreamble: false,
        sent: false,
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      try {
        this.pending.sent = kind === "command";
        send();
      } catch {
        this.fail(
          kind === "connect" ? "connect" : "disconnected",
          "RCON operation could not be dispatched",
        );
      }
    });
  }

  private request(
    kind: "authenticate" | "command",
    text: string,
    signal: AbortSignal,
  ) {
    if (this.nextId > 2147483647) {
      this.fail("protocol", "RCON request IDs exhausted");
      return Promise.reject(this.terminal);
    }
    const id = this.nextId++;
    return this.operation(kind, id, signal, () => {
      const length = Buffer.byteLength(text);
      const packet = Buffer.alloc(length + 14);
      packet.writeInt32LE(length + 10, 0);
      packet.writeInt32LE(id, 4);
      packet.writeInt32LE(kind === "authenticate" ? 3 : 2, 8);
      packet.write(text, 12, length, "utf8");
      this.socket.write(packet);
    });
  }

  async authenticate(signal: AbortSignal) {
    await this.operation("connect", 0, signal, () => {
      this.socket.connect(this.options.port, this.options.host, () => {
        const pending = this.pending;
        if (!pending || pending.kind !== "connect" || this.terminal) return;
        this.clear(pending);
        pending.resolve("");
      });
    });
    await this.request("authenticate", this.options.password, signal);
    if (this.terminal) throw this.terminal;
    this.authenticated = true;
  }

  async execute(command: string, signal: AbortSignal) {
    if (this.terminal)
      throw new RconError({
        code: "disconnected",
        message: "RCON connection is terminal; command was not sent",
        outcomeUnknown: false,
      });
    if (!this.authenticated)
      throw new RconError({
        code: "authentication",
        message: "RCON is not authenticated",
        outcomeUnknown: false,
      });
    return await this.request("command", command, signal);
  }

  private receive(chunk: Buffer) {
    if (this.terminal) return;
    let offset = 0;
    let completed: string | undefined;
    try {
      while (offset < chunk.length) {
        if (completed !== undefined) throw new Error("Extra response bytes");
        if (!this.frame) {
          const count = Math.min(4 - this.prefixBytes, chunk.length - offset);
          chunk.copy(this.prefix, this.prefixBytes, offset, offset + count);
          offset += count;
          this.prefixBytes += count;
          if (this.prefixBytes < 4) continue;
          this.frame = Buffer.alloc(decodeLength(this.prefix.readInt32LE(0)));
          this.frameBytes = 0;
          this.prefixBytes = 0;
        }
        const frame = this.frame;
        const count = Math.min(
          frame.length - this.frameBytes,
          chunk.length - offset,
        );
        chunk.copy(frame, this.frameBytes, offset, offset + count);
        offset += count;
        this.frameBytes += count;
        if (this.frameBytes < frame.length) continue;
        this.frame = undefined;
        const header = decodeHeader({
          id: frame.readInt32LE(0),
          type: frame.readInt32LE(4),
        });
        if (frame[frame.length - 2] !== 0 || frame[frame.length - 1] !== 0)
          throw new Error("Invalid terminators");
        const body = utf8.decode(frame.subarray(8, frame.length - 2));
        const pending = this.pending;
        if (!pending || pending.kind === "connect")
          throw new Error("Unsolicited response");
        if (pending.kind === "authenticate" && header.id === -1) {
          this.fail("authentication", "RCON authentication rejected");
          return;
        }
        if (header.id !== pending.id) throw new Error("Response ID mismatch");
        if (
          pending.kind === "authenticate" &&
          header.type === 0 &&
          body === "" &&
          !pending.authPreamble
        ) {
          pending.authPreamble = true;
          continue;
        }
        if (header.type !== (pending.kind === "authenticate" ? 2 : 0))
          throw new Error("Response type mismatch");
        if (pending.kind === "authenticate" && body !== "")
          throw new Error("Unexpected authentication body");
        completed = body;
      }
      if (completed !== undefined) {
        const pending = this.pending;
        if (!pending) throw new Error("Completed response has no request");
        this.clear(pending);
        pending.resolve(completed);
      }
    } catch {
      this.fail(
        "protocol",
        "Invalid or unexpected bounded Factorio RCON frame",
      );
    }
  }
}

export function withFactorioRcon<A, E, R>(
  input: typeof RconOptions.Type,
  use: (client: {
    readonly execute: (
      command: string,
    ) => Effect.Effect<
      string,
      RconError | import("./projects.ts").BoundaryError
    >;
  }) => Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const options = yield* decode(RconOptions, input, "private RCON options");
    const connection = new Connection(options);
    const acquire = Effect.tryPromise({
      try: (signal) => connection.authenticate(signal),
      catch: (error) => error as RconError,
    }).pipe(Effect.interruptible);
    return yield* Effect.acquireUseRelease(
      acquire,
      () =>
        use({
          execute: (command) =>
            Effect.gen(function* () {
              const validated = yield* decode(
                Command,
                command,
                "bounded RCON command",
              );
              return yield* Effect.tryPromise({
                try: (signal) => connection.execute(validated, signal),
                catch: (error) => error as RconError,
              });
            }),
        }),
      () => Effect.sync(() => connection.close()),
    );
  });
}
