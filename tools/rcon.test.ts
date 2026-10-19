import { afterEach, expect, test } from "bun:test";
import { createServer } from "node:net";
import type { AddressInfo, Server, Socket } from "node:net";
import { setImmediate } from "node:timers/promises";
import { Effect, Exit, Fiber } from "effect";
import { RconError, withFactorioRcon } from "./rcon.ts";

interface Packet {
  id: number;
  type: number;
  body: string;
}
const servers: { server: Server; sockets: Set<Socket> }[] = [];
afterEach(async () => {
  for (const { server, sockets } of servers.splice(0)) {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
function frame(id: number, type: number, body: string | Buffer = "") {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const packet = Buffer.alloc(bytes.length + 14);
  packet.writeInt32LE(bytes.length + 10, 0);
  packet.writeInt32LE(id, 4);
  packet.writeInt32LE(type, 8);
  bytes.copy(packet, 12);
  return packet;
}
async function peer(handler: (packet: Packet, socket: Socket) => void) {
  const sockets = new Set<Socket>();
  const packets: Packet[] = [];
  const closed = Promise.withResolvers<void>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.setNoDelay(true);
    socket.on("error", () => {});
    socket.on("close", () => {
      sockets.delete(socket);
      closed.resolve();
    });
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4 && buffer.length >= buffer.readInt32LE(0) + 4) {
        const size = buffer.readInt32LE(0);
        const packet = {
          id: buffer.readInt32LE(4),
          type: buffer.readInt32LE(8),
          body: buffer.toString("utf8", 12, size + 2),
        };
        buffer = buffer.subarray(size + 4);
        packets.push(packet);
        handler(packet, socket);
      }
    });
  });
  servers.push({ server, sockets });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    options: {
      host: "127.0.0.1" as const,
      port: (server.address() as AddressInfo).port,
      password: crypto.randomUUID(),
      timeoutMs: 1000,
    },
    packets,
    closed: closed.promise,
  };
}
const authenticate = (packet: Packet, socket: Socket) =>
  socket.write(frame(packet.id, 2));

// TCP write boundaries need not survive delivery; these deliberately separated
// writes exercise partial lengths, partial bodies, and a coalesced auth pair.
test("fragmented authentication and UTF-8 responses preserve empty and large command results", async () => {
  const sends: Promise<void>[] = [];
  let commands = 0;
  const large = "café🙂".repeat(4000) + "\n";
  const f = await peer((packet, socket) => {
    const response =
      packet.type === 3
        ? Buffer.concat([frame(packet.id, 0), frame(packet.id, 2)])
        : frame(packet.id, 0, commands++ === 0 ? "" : large);
    sends.push(
      (async () => {
        for (let i = 0; i < Math.min(17, response.length); i++) {
          socket.write(response.subarray(i, i + 1));
          await setImmediate();
        }
        if (response.length > 17) socket.write(response.subarray(17));
      })(),
    );
  });
  const result = await Effect.runPromise(
    withFactorioRcon(f.options, (c) =>
      Effect.gen(function* () {
        const empty = yield* c.execute("empty");
        const text = yield* c.execute("large");
        return { empty, text };
      }),
    ),
  );
  expect(result).toEqual({ empty: "", text: large });
  await Promise.all(sends);
  await f.closed;
  expect(f.packets.map((p) => p.type)).toEqual([3, 2, 2]);
});

test("authentication rejection never dispatches a command or exposes its password", async () => {
  const f = await peer((_packet, socket) => socket.write(frame(-1, 2)));
  const error = await Effect.runPromise(
    Effect.flip(withFactorioRcon(f.options, (c) => c.execute("mutation"))),
  );
  expect(error).toBeInstanceOf(RconError);
  expect(error).toMatchObject({
    code: "authentication",
    outcomeUnknown: false,
  });
  expect(String(error)).not.toContain(f.options.password);
  await f.closed;
  expect(f.packets.map((p) => p.type)).toEqual([3]);
});

const malformed: [string, (id: number) => Buffer][] = [
  [
    "short length",
    () => {
      const b = Buffer.alloc(4);
      b.writeInt32LE(9);
      return b;
    },
  ],
  [
    "oversized length",
    () => {
      const b = Buffer.alloc(4);
      b.writeInt32LE(1024 * 1024 + 1);
      return b;
    },
  ],
  ["foreign request ID", (id) => frame(id + 1, 0, "foreign")],
  ["wrong response type", (id) => frame(id, 2)],
  [
    "missing terminator",
    (id) => {
      const b = frame(id, 0, "value");
      b[b.length - 1] = 1;
      return b;
    },
  ],
  ["invalid UTF-8", (id) => frame(id, 0, Buffer.from([0xc3, 0x28]))],
  [
    "coalesced unexpected second response",
    (id) => Buffer.concat([frame(id, 0, "first"), frame(id, 0, "second")]),
  ],
];
for (const [name, invalid] of malformed)
  test(`malformed ${name} poisons the connection without replay`, async () => {
    const f = await peer((packet, socket) =>
      packet.type === 3
        ? authenticate(packet, socket)
        : socket.write(invalid(packet.id)),
    );
    const errors = await Effect.runPromise(
      withFactorioRcon(f.options, (c) =>
        Effect.gen(function* () {
          const first = yield* Effect.flip(c.execute("mutation"));
          const next = yield* Effect.flip(c.execute("another-mutation"));
          return { first, next };
        }),
      ),
    );
    expect(errors.first).toMatchObject({
      code: "protocol",
      outcomeUnknown: true,
    });
    expect(errors.next).toMatchObject({
      code: "disconnected",
      outcomeUnknown: false,
    });
    await f.closed;
    expect(f.packets.filter((p) => p.type === 2).map((p) => p.body)).toEqual([
      "mutation",
    ]);
  });

test("duplicate auth preambles fail instead of leaving authentication pending", async () => {
  const f = await peer((packet, socket) =>
    socket.write(
      Buffer.concat([
        frame(packet.id, 0),
        frame(packet.id, 0),
        frame(packet.id, 2),
      ]),
    ),
  );
  const error = await Effect.runPromise(
    Effect.flip(withFactorioRcon(f.options, (c) => c.execute("mutation"))),
  );
  expect(error).toMatchObject({ code: "protocol", outcomeUnknown: false });
  await f.closed;
  expect(f.packets).toHaveLength(1);
});

for (const mode of ["timeout", "disconnect"] as const)
  test(`${mode} after dispatch reports an unknown outcome and never retries`, async () => {
    const f = await peer((packet, socket) => {
      if (packet.type === 3) authenticate(packet, socket);
      else if (mode === "disconnect") socket.end();
    });
    const error = await Effect.runPromise(
      Effect.flip(
        withFactorioRcon({ ...f.options, timeoutMs: 100 }, (c) =>
          c.execute("mutation"),
        ),
      ),
    );
    expect(error).toMatchObject({
      code: mode === "timeout" ? "timeout" : "disconnected",
      outcomeUnknown: true,
    });
    await f.closed;
    expect(f.packets.filter((p) => p.type === 2).map((p) => p.body)).toEqual([
      "mutation",
    ]);
  });

test("a complete response followed by disconnect remains a completed operation", async () => {
  const f = await peer((packet, socket) =>
    packet.type === 3
      ? authenticate(packet, socket)
      : socket.end(frame(packet.id, 0, "committed\n")),
  );
  expect(
    await Effect.runPromise(
      withFactorioRcon(f.options, (c) => c.execute("mutation")),
    ),
  ).toBe("committed\n");
  await f.closed;
});

test("concurrent requests reject the second without cancelling the first", async () => {
  const received = Promise.withResolvers<{ packet: Packet; socket: Socket }>();
  const f = await peer((packet, socket) =>
    packet.type === 3
      ? authenticate(packet, socket)
      : received.resolve({ packet, socket }),
  );
  const result = await Effect.runPromise(
    withFactorioRcon(f.options, (c) =>
      Effect.gen(function* () {
        const first = yield* c.execute("first").pipe(Effect.forkChild);
        const active = yield* Effect.promise(() => received.promise);
        const second = yield* Effect.flip(c.execute("second"));
        active.socket.write(frame(active.packet.id, 0, "first-result"));
        return { first: yield* Fiber.join(first), second };
      }),
    ),
  );
  expect(result.first).toBe("first-result");
  expect(result.second).toMatchObject({ code: "busy", outcomeUnknown: false });
  expect(f.packets.filter((p) => p.type === 2).map((p) => p.body)).toEqual([
    "first",
  ]);
});

test("cancellation closes the active socket without replaying an accepted mutation", async () => {
  const dispatched = Promise.withResolvers<void>();
  const f = await peer((packet, socket) =>
    packet.type === 3 ? authenticate(packet, socket) : dispatched.resolve(),
  );
  const controller = new AbortController();
  const result = Effect.runPromiseExit(
    withFactorioRcon(f.options, (c) => c.execute("mutation")),
    { signal: controller.signal },
  );
  await dispatched.promise;
  controller.abort();
  expect(Exit.isFailure(await result)).toBe(true);
  await f.closed;
  expect(f.packets.filter((p) => p.type === 2).map((p) => p.body)).toEqual([
    "mutation",
  ]);
});

test("invalid endpoints and commands fail before their respective network side effects", async () => {
  const f = await peer(authenticate);
  for (const options of [
    { ...f.options, host: "0.0.0.0" },
    { ...f.options, password: f.options.password + "\0" },
    { ...f.options, timeoutMs: 0 },
  ]) {
    const result = await Effect.runPromiseExit(
      withFactorioRcon(options as typeof f.options, (c) =>
        c.execute("mutation"),
      ),
    );
    expect(Exit.isFailure(result)).toBe(true);
  }
  expect(f.packets).toEqual([]);
  await Effect.runPromise(
    withFactorioRcon(f.options, (c) =>
      Effect.gen(function* () {
        for (const command of ["", "bad\0command", "🙂".repeat(16385)]) {
          const rejected = yield* Effect.exit(c.execute(command));
          expect(Exit.isFailure(rejected)).toBe(true);
        }
      }),
    ),
  );
  await f.closed;
  expect(f.packets.map((p) => p.type)).toEqual([3]);
});
