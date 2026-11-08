import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PhantasmaNftRomBuilder } from "phantasma-sdk-ts";
import { loadConfig } from "../src/config";

const STANDARD_ROM_FIELDS = [
  { name: "name", type: "String" },
  { name: "description", type: "String" },
  { name: "imageURL", type: "String" },
  { name: "infoURL", type: "String" },
  { name: "royalties", type: "Int32" },
];

const TOKEN_SCHEMAS = JSON.stringify({
  seriesMetadata: [{ name: "holderSet", type: "Array_Bytes32" }],
  rom: [
    ...STANDARD_ROM_FIELDS,
    { name: "holders", type: "Array_Bytes32" },
    { name: "keys", type: "Array_Bytes16" },
    { name: "counts", type: "Array_Int32" },
    { name: "labels", type: "Array_String" },
    { name: "signatures", type: "Array_Bytes64" },
  ],
  ram: [],
});

// A schema with a field of each kind that takes an object, a typed value or a number above 2^53 - 1.
const TYPED_TOKEN_SCHEMAS = JSON.stringify({
  seriesMetadata: [{ name: "holderSet", type: "Array_Bytes32" }],
  rom: [
    ...STANDARD_ROM_FIELDS,
    {
      name: "stats",
      type: "Struct",
      fields: [
        { name: "level", type: "Int32" },
        { name: "class", type: "String" },
      ],
    },
    { name: "items", type: "Array_Struct", fields: [{ name: "id", type: "Int64" }] },
    { name: "extra", type: "Dynamic" },
    { name: "extras", type: "Array_Dynamic" },
    { name: "big", type: "Int256" },
    { name: "bigs", type: "Array_Int64" },
  ],
  ram: [],
});

const pattern = (size: number, seed: number): Buffer =>
  Buffer.from(Array.from({ length: size }, (_v, i) => (seed + i * 7) & 0xff));

const HOLDERS = [pattern(32, 1), pattern(32, 101)];
const KEYS = [pattern(16, 3)];
const SIGNATURES = [pattern(64, 5)];

const STANDARD_VALUES = {
  name: "Arrays NFT",
  description: "NFT with array fields",
  imageURL: "http://example.invalid/image.png",
  infoURL: "http://example.invalid/info",
  royalties: 10000000,
};

function nftMetadata(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ...STANDARD_VALUES,
    holders: HOLDERS.map((b) => b.toString("hex")),
    keys: KEYS.map((b) => b.toString("hex")),
    counts: [1, 2, 300],
    labels: ["alpha", "beta"],
    signatures: SIGNATURES.map((b) => b.toString("hex")),
    ...overrides,
  });
}

function withConfig<T>(
  metadata: string,
  read: (configPath: string) => T,
  schemas: string = TOKEN_SCHEMAS,
): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pha-deploy-values-"));
  const configPath = path.join(dir, "config.toml");
  fs.writeFileSync(
    configPath,
    [
      `token_schemas = '''${schemas}'''`,
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

// The chain's layout: a string is its UTF-8 bytes and a zero byte, an Int32 four and an Int64 eight
// little-endian bytes, and an array a four-byte little-endian count followed by its items. A Dynamic
// value is the byte of its VM type followed by the value.
const sz = (s: string) => Buffer.concat([Buffer.from(s, "utf8"), Buffer.from([0])]);
const i32 = (v: number) => {
  const b = Buffer.alloc(4);
  b.writeInt32LE(v);
  return b;
};
const i64 = (v: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(v);
  return b;
};
const array = (items: Buffer[]) => Buffer.concat([i32(items.length), ...items]);
const VM_TYPE_INT32 = Buffer.from([10]);
const VM_TYPE_INT64 = Buffer.from([12]);
const VM_TYPE_STRING = Buffer.from([22]);
const STANDARD_ROM = Buffer.concat([
  sz("Arrays NFT"),
  sz("NFT with array fields"),
  sz("http://example.invalid/image.png"),
  sz("http://example.invalid/info"),
  i32(10000000),
]);

test("nft_metadata takes JSON arrays for array fields, and the ROM holds each array as the chain reads it", () => {
  const cfg = withConfig(nftMetadata(), (configPath) => loadConfig({ argv: [], configPath }));
  assert.ok(cfg.tokenSchemas);
  assert.ok(cfg.nftMetadata);

  // The same call mint-nft makes with the loaded config.
  const rom = PhantasmaNftRomBuilder.buildAndSerialize(cfg.tokenSchemas.rom, cfg.nftMetadata);

  const expected = Buffer.concat([
    STANDARD_ROM,
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

test("nft_metadata takes objects for struct and Dynamic fields and digit strings for big integers, and the ROM holds them as the chain reads them", () => {
  const metadata = JSON.stringify({
    ...STANDARD_VALUES,
    // The keys of a struct can come in any order; the ROM follows the struct's schema.
    stats: { class: "mage", level: 3 },
    items: [{ id: 1 }, { id: "9007199254740993" }],
    extra: { type: "Int64", value: "9007199254740993" },
    extras: [
      { type: "String", value: "a" },
      { type: "Int32", value: 7 },
    ],
    big: "9007199254740993",
    bigs: ["9007199254740993"],
  });
  const cfg = withConfig(metadata, (configPath) => loadConfig({ argv: [], configPath }), TYPED_TOKEN_SCHEMAS);
  assert.ok(cfg.tokenSchemas);
  assert.ok(cfg.nftMetadata);

  const rom = PhantasmaNftRomBuilder.buildAndSerialize(cfg.tokenSchemas.rom, cfg.nftMetadata);

  const expected = Buffer.concat([
    STANDARD_ROM,
    // A struct by its schema: the values only, in the schema's order.
    i32(3),
    sz("mage"),
    array([i64(1n), i64(9007199254740993n)]),
    Buffer.concat([VM_TYPE_INT64, i64(9007199254740993n)]),
    array([Buffer.concat([VM_TYPE_STRING, sz("a")]), Buffer.concat([VM_TYPE_INT32, i32(7)])]),
    // An Int256 is a header byte with the length of the value and its sign, then the value's
    // little-endian bytes without the high zero bytes: 2^53 + 1 takes seven bytes.
    Buffer.from("0701000000000020", "hex"),
    array([i64(9007199254740993n)]),
  ]);
  assert.equal(Buffer.from(rom).toString("hex"), expected.toString("hex"));
});

test("true, false and null are refused when the config is read", () => {
  for (const value of [true, false, null, [true]]) {
    assert.throws(
      () => withConfig(nftMetadata({ holders: value }), (configPath) => loadConfig({ argv: [], configPath })),
      /nft_metadata\.holders must be a string, a number, or an array or object of them/,
    );
  }
});

test("a value of the wrong shape for its field is refused before anything is signed", () => {
  const cases: Array<[unknown, RegExp]> = [
    [{ a: 1 }, /Metadata field 'holders' must be provided as an array/],
    [[{ a: 1 }], /Metadata field 'holders\[0\]' must be a byte array or hex string/],
  ];
  for (const [value, message] of cases) {
    const cfg = withConfig(nftMetadata({ holders: value }), (configPath) => loadConfig({ argv: [], configPath }));
    assert.ok(cfg.tokenSchemas);
    assert.ok(cfg.nftMetadata);
    assert.throws(() => PhantasmaNftRomBuilder.buildAndSerialize(cfg.tokenSchemas!.rom, cfg.nftMetadata!), message);
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
