import fs from "fs";
import path from "path";
import toml from "@iarna/toml";
import yargs from "yargs/yargs";
import { Metadata, MetadataFields } from "./actions/helpers";
import { MetadataField, TokenSchemas, TokenSchemasBuilder } from "phantasma-sdk-ts";

export type TokenType = "nft" | "fungible";

export interface Config {
  // Core / connection
  rpc: string;
  nexus?: string | null;
  wif?: string | null;

  // Token
  symbol?: string | null;
  carbonTokenId?: bigint | null;
  rom?: string | null;
  tokenSchemas?: TokenSchemas | null;
  tokenMetadata: Metadata;
  tokenType?: TokenType | null;
  tokenMaxSupply?: bigint | null;
  fungibleDecimals?: number | null;

  // Series
  carbonTokenSeriesId?: number | null;
  seriesMetadata?: MetadataField[] | null;

  // NFT-specific
  nftMetadata?: MetadataField[] | null;

  // Mint fungible
  mintFungibleTo?: string | null;
  mintFungibleAmount?: bigint | null;

  // Limits / sizes
  createTokenMaxData?: bigint | null;
  createTokenSeriesMaxData?: bigint | null;
  mintTokenMaxData?: bigint | null;

  // Gas / fees
  gasFeeBase?: bigint | null;
  gasFeeCreateTokenBase?: bigint | null;
  gasFeeCreateTokenSymbol?: bigint | null;
  gasFeeCreateTokenSeries?: bigint | null;
  gasFeeMultiplier?: bigint | null;

  // Runtime flags
  configPath?: string | null;
  dryRun?: boolean;
}

/**
 * Try to parse a JSON string, returning undefined if parsing fails.
 */
function tryParseJSON<T = unknown>(value?: string | null): T | undefined {
  if (!value) return undefined;
  try {
    // Some users may provide single-quoted JSON; normalize quotes if necessary
    const trimmed = value.trim();
    return JSON.parse(trimmed) as T;
  } catch(e) {
    console.error("JSON parsing error: ", e);
    // ignore parse errors; caller will handle fallback
    return undefined;
  }
}

function makeMetadataField(
  name: string,
  value: unknown,
  context: string,
): MetadataField {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error(`${context}: metadata field name cannot be empty`);
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    value instanceof Uint8Array
  ) {
    const field = new MetadataField();
    field.name = trimmed;
    field.value = value;
    return field;
  }

  throw new Error(
    `${context}.${trimmed} must be a string, number, bigint or Uint8Array`,
  );
}

function parseMetadataFieldArray(
  raw: string | undefined,
  context: string,
): MetadataField[] | undefined {
  if (!raw) {
    return undefined;
  }

  const parsed = tryParseJSON<unknown>(raw);
  if (parsed === undefined) {
    return undefined;
  }

  if (Array.isArray(parsed)) {
    return parsed.map((entry, idx) => {
      if (
        entry &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        "name" in entry &&
        "value" in entry &&
        typeof (entry as any).name === "string"
      ) {
        return makeMetadataField(
          (entry as any).name,
          (entry as any).value,
          `${context}[${idx}]`,
        );
      }
      throw new Error(
        `${context}[${idx}] must be an object like { name: string; value: ... }`,
      );
    });
  }

  if (parsed && typeof parsed === "object") {
    return Object.entries(parsed as Record<string, unknown>).map(
      ([name, value]) => makeMetadataField(name, value, context),
    );
  }

  throw new Error(`${context} must be a JSON object or array`);
}

/**
 * Parse a numeric-ish value into a number or undefined.
 */
function parseNumber(value?: string | number | null): number | undefined {
  if (value == null) return undefined;

  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  const v = value.toString().trim();
  if (v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function parseBigInt(value?: string | bigint | null): bigint | undefined {
  if (value == null) return undefined;

  if (typeof value === "bigint") return value;

  const v = value.toString().trim();
  if (v === "") return undefined;
  return BigInt(v);
}

/**
 * Load TOML configuration from a provided path (if exists) or from default `config.toml`.
 * The parsed result is stored in the module-scoped `tomlConfig` object and used as
 * the source of truth for configuration values unless overridden by CLI flags.
 */
let tomlConfig: Record<string, any> = {};

function loadToml(configPath?: string | null) {
  const file = configPath ? configPath : "config.toml";
  try {
    const resolved = path.resolve(process.cwd(), file);
    if (fs.existsSync(resolved)) {
      const raw = fs.readFileSync(resolved, { encoding: "utf8" });
      // Parse TOML into a plain object. If parse fails, keep an empty config.
      try {
        tomlConfig = toml.parse(raw) as Record<string, any>;
      } catch {
        tomlConfig = {};
      }
    } else {
      tomlConfig = {};
    }
  } catch {
    tomlConfig = {};
  }
}

/**
 * Helper to obtain a value by preferring CLI args -> TOML config -> fallback.
 * Accepts multiple possible CLI keys (kebab-case and camelCase).
 */
function pickValue<T = string | undefined>(
  argv: Record<string, unknown>,
  cliKey: string, // prefer these (kebab/camel)
  tomlKey: string,
): T | undefined {
  // try as-is from CLI
  if (Object.prototype.hasOwnProperty.call(argv, cliKey)) {
    const v = argv[cliKey];
    // yargs may map flags to boolean when not provided with value
    if (!(v === undefined)) {
      return v as unknown as T;
    }
  }

  // Fall back to TOML configuration.
  if (tomlConfig) {
    return tomlConfig[tomlKey] as unknown as T;
  }

  return undefined;
}

/**
 * Build Config by merging:
 *  - TOML config file (config.toml) values
 *  - CLI flags (override TOML)
 *  - defaults (where applicable)
 *
 * Usage:
 *  loadConfig(); // uses process.argv and config.toml if present
 *  loadConfig({ argv: ['--rpc','https://...'], configPath: 'custom-config.toml' })
 */
export function loadConfig(options?: {
  argv?: string[];
  configPath?: string | null;
}): Config {
  // Load TOML config (if any)
  loadToml(options?.configPath ?? null);

  // Parse CLI args using yargs; pass provided argv or process.argv
  const rawArgv = options?.argv ?? process.argv.slice(2);
  const argv = yargs(rawArgv)
    .help(false)
    .version(false)
    .parseSync();

  const cfg: Config = {
    rpc: "",
    nexus: "",
    wif: null,
    symbol: null,
    carbonTokenId: null,
    carbonTokenSeriesId: null,
    rom: null,
    tokenSchemas: null,
    tokenMetadata: new Metadata(undefined, "token_metadata"),
    seriesMetadata: null,
    tokenType: null,
    tokenMaxSupply: null,
    fungibleDecimals: null,
    nftMetadata: null,
    mintFungibleTo: null,
    mintFungibleAmount: null,
    createTokenMaxData: null,
    createTokenSeriesMaxData: null,
    mintTokenMaxData: null,
    gasFeeBase: null,
    gasFeeCreateTokenBase: null,
    gasFeeCreateTokenSymbol: null,
    gasFeeCreateTokenSeries: null,
    gasFeeMultiplier: null,
    configPath: null,
    dryRun: false,
  };

  // Core / connection
  cfg.rpc =
    (pickValue(argv, "rpc", "rpc") as string | undefined) ??
    "https://testnet.phantasma.info/rpc";
  cfg.nexus = (pickValue(argv, "nexus", "nexus") as string | undefined) ?? null;
  cfg.wif = (pickValue(argv, "wif", "wif") as string | undefined) ?? null;

  // Token defaults
  cfg.symbol =
    (pickValue(argv, "symbol", "symbol") as string | undefined) ?? null;
  cfg.carbonTokenId =
    parseBigInt(
      pickValue(argv, "carbon-token-id", "carbon_token_id") as
        | string
        | bigint
        | undefined,
    ) ?? null;
  cfg.carbonTokenSeriesId =
    parseNumber(
      pickValue(argv, "carbon-token-series-id", "carbon_token_series_id") as
        | string
        | number
        | undefined,
    ) ?? null;

  // Mint-fungible args (optional; required only for --mint-fungible action).
  cfg.mintFungibleTo =
    (pickValue(argv, "mint-fungible-to", "mint_fungible_to") as
      | string
      | undefined) ?? null;
  cfg.mintFungibleAmount =
    parseBigInt(
      pickValue(argv, "mint-fungible-amount", "mint_fungible_amount") as
        | string
        | bigint
        | undefined,
    ) ?? null;

  cfg.rom = (pickValue(argv, "rom", "rom") as string | undefined) ?? null;

  const tokenTypeRaw = pickValue(argv, "token-type", "token_type") as
    | string
    | undefined;
  if (tokenTypeRaw) {
    const lowered = tokenTypeRaw.trim().toLowerCase();
    if (lowered === "fungible" || lowered === "nft") {
      cfg.tokenType = lowered;
    } else {
      throw Error(`Unsupported token type ${lowered}`);
    }
  }

  // tokenSchemas
  const tokenSchemasRaw = pickValue<string>(
    argv,
    "token-schemas",
    "token_schemas",
  );
  if (tokenSchemasRaw) {
    cfg.tokenSchemas = TokenSchemasBuilder.fromJson(tokenSchemasRaw);
  }


  // tokenMetadata
  const tmfRaw = pickValue<string>(
    argv,
    "token-metadata",
    "token_metadata",
  );
  if (tmfRaw) {
    const tokenMetadataFields = tryParseJSON<MetadataFields>(tmfRaw);
    if (!tokenMetadataFields) {
      throw new Error("token_metadata must be valid JSON");
    }
    cfg.tokenMetadata = new Metadata(tokenMetadataFields, "token_metadata");
  }

  const smfRaw = pickValue(
    argv,
    "series-metadata",
    "series_metadata",
  );
  cfg.seriesMetadata = parseMetadataFieldArray(smfRaw, "series_metadata") ?? null;

  const rawMaxSupply =
    (pickValue(argv, "token-max-supply", "token_max_supply") as
      | string
      | bigint
      | undefined) ??
    (pickValue(argv, "fungible-max-supply", "fungible_max_supply") as
      | string
      | bigint
      | undefined);
  cfg.tokenMaxSupply = parseBigInt(rawMaxSupply) ?? null;
  cfg.fungibleDecimals =
    parseNumber(
      pickValue(argv, "fungible-decimals", "fungible_decimals") as
        | string
        | number
        | undefined,
    ) ?? null;

  // NFT metadata
  const nmfRaw = pickValue(
    argv,
    "nft-metadata",
    "nft_metadata",
  );
  cfg.nftMetadata = parseMetadataFieldArray(nmfRaw, "nft_metadata") ?? null;

  // Limits and sizes
  cfg.createTokenMaxData =
    parseBigInt(
      pickValue(argv, "create-token-max-data", "create_token_max_data") as
        | string
        | bigint
        | undefined,
    ) ?? null;
  cfg.createTokenSeriesMaxData =
    parseBigInt(
      pickValue(
        argv,
        "create-token-series-max-data",
        "create_token_series_max_data",
      ) as string | bigint | undefined,
    ) ?? null;
  cfg.mintTokenMaxData =
    parseBigInt(
      pickValue(argv, "mint-token-max-data", "mint_token_max_data") as
        | string
        | bigint
        | undefined,
    ) ?? null;

  // Gas / fees
  cfg.gasFeeBase =
    parseBigInt(
      pickValue(argv, "gas-fee-base", "gas_fee_base") as
        | string
        | bigint
        | undefined,
    ) ?? null;
  cfg.gasFeeCreateTokenBase =
    parseBigInt(
      pickValue(
        argv,
        "gas-fee-create-token-base",
        "gas_fee_create_token_base",
      ) as string | bigint | undefined,
    ) ?? null;
  cfg.gasFeeCreateTokenSymbol =
    parseBigInt(
      pickValue(
        argv,
        "gas-fee-create-token-symbol",
        "gas_fee_create_token_symbol",
      ) as string | bigint | undefined,
    ) ?? null;
  cfg.gasFeeCreateTokenSeries =
    parseBigInt(
      pickValue(
        argv,
        "gas-fee-create-token-series",
        "gas_fee_create_token_series",
      ) as string | bigint | undefined,
    ) ?? null;
  cfg.gasFeeMultiplier =
    parseBigInt(
      pickValue(argv, "gas-fee-multiplier", "gas_fee_multiplier") as
        | string
        | bigint
        | undefined,
    ) ?? null;

  // Runtime flags
  cfg.configPath =
    (pickValue(argv, "config", "CONFIG_PATH") as string | undefined) ??
    options?.configPath ??
    null;
  cfg.dryRun = Boolean(pickValue(argv, "dry-run", "dry_run")) || false;

  return cfg;
}

export default loadConfig;
