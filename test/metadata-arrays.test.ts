import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PhantasmaNftRomBuilder } from "phantasma-sdk-ts";
import { loadConfig } from "../src/config";

const TOKEN_SCHEMAS = JSON.stringify({
  seriesMetadata: [{ name: "holderSet", type: "Array_Bytes32" }],
  rom: [
    { name: "name", type: "String" },
    { name: "description", type: "String" },
    { name: "imageURL", type: "String" },
    { name: "infoURL", type: "String" },
    { name: "royalties", type: "Int32" },
    { name: "holders", type: "Array_Bytes32" },
    { name: "keys", type: "Array_Bytes16" },
    { name: "counts", type: "Array_Int32" },
    { name: "labels", type: "Array_String" },
    { name: "signatures", type: "Array_Bytes64" },
  ],
  ram: [],
});

const pattern = (size: number, seed: number): Buffer =>
  Buffer.from(Array.from({ length: size }, (_v, i) => (seed + i * 7) & 0xff));

const HOLDERS = [pattern(32, 1), pattern(32, 101)];
const KEYS = [pattern(16, 3)];
const SIGNATURES = [pattern(64, 5)];

function nftMetadata(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: "Arrays NFT",
    description: "NFT with array fields",
    imageURL: "http://example.invalid/image.png",
    infoURL: "http://example.invalid/info",
    royalties: 10000000,
    holders: HOLDERS.map((b) => b.toString("hex")),
    keys: KEYS.map((b) => b.toString("hex")),
    counts: [1, 2, 300],
    labels: ["alpha", "beta"],
    signatures: SIGNATURES.map((b) => b.toString("hex")),
    ...overrides,
  });
}

function withConfig<T>(metadata: string, read: (configPath: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pha-deploy-arrays-"));
  const configPath = path.join(dir, "config.toml");
  fs.writeFileSync(
    configPath,
    [
      `token_schemas = '''${TOKEN_SCHEMAS}'''`,
      `series_metadata = '''${JSON.stringify({ holderSet: HOLDERS.map((b) => b.toString("hex")) })}'''`,
      `nft_metadata = '''${metadata}'''`,
      "",
    ].join("\n"),
  );
  try {
    return read(configPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// The chain's layout: a string is its UTF-8 bytes and a zero byte, an Int32 four little-endian bytes,
// and an array a four-byte little-endian count followed by its items.
const sz = (s: string) => Buffer.concat([Buffer.from(s, "utf8"), Buffer.from([0])]);
const i32 = (v: number) => {
  const b = Buffer.alloc(4);
  b.writeInt32LE(v);
  return b;
};
const array = (items: Buffer[]) => Buffer.concat([i32(items.length), ...items]);

test("nft_metadata takes JSON arrays for array fields, and the ROM holds each array as the chain reads it", () => {
  const cfg = withConfig(nftMetadata(), (configPath) => loadConfig({ argv: [], configPath }));
  assert.ok(cfg.tokenSchemas);
  assert.ok(cfg.nftMetadata);

  // The same call mint-nft makes with the loaded config.
  const rom = PhantasmaNftRomBuilder.buildAndSerialize(cfg.tokenSchemas.rom, cfg.nftMetadata);

  const expected = Buffer.concat([
    sz("Arrays NFT"),
    sz("NFT with array fields"),
    sz("http://example.invalid/image.png"),
    sz("http://example.invalid/info"),
    i32(10000000),
    array(HOLDERS),
    array(KEYS),
    array([i32(1), i32(2), i32(300)]),
    array([sz("alpha"), sz("beta")]),
    array(SIGNATURES),
  ]);
  assert.equal(Buffer.from(rom).toString("hex"), expected.toString("hex"));
});

test("series_metadata takes a JSON array for an array field", () => {
  const cfg = withConfig(nftMetadata(), (configPath) => loadConfig({ argv: [], configPath }));
  const holderSet = cfg.seriesMetadata?.find((f) => f.name === "holderSet");
  assert.deepEqual(holderSet?.value, HOLDERS.map((b) => b.toString("hex")));
});

test("an object, or an array holding one, is refused when the config is read", () => {
  for (const value of [{ a: 1 }, [{ a: 1 }]]) {
    assert.throws(
      () => withConfig(nftMetadata({ holders: value }), (configPath) => loadConfig({ argv: [], configPath })),
      /nft_metadata\.holders must be a string, number, bigint, Uint8Array or an array of them/,
    );
  }
});

test("an item of the wrong size is refused with its place in the array before anything is signed", () => {
  const short = [HOLDERS[0].toString("hex"), pattern(31, 9).toString("hex")];
  const cfg = withConfig(nftMetadata({ holders: short }), (configPath) => loadConfig({ argv: [], configPath }));
  assert.ok(cfg.tokenSchemas);
  assert.ok(cfg.nftMetadata);
  assert.throws(
    () => PhantasmaNftRomBuilder.buildAndSerialize(cfg.tokenSchemas!.rom, cfg.nftMetadata!),
    /Metadata field 'holders\[1\]' must be exactly 32 bytes/,
  );
});
