#!/usr/bin/env node
import { hideBin } from "yargs/helpers";
import yargs from "yargs";
import loadConfig, { Config, TokenType } from "./config";
import { inspect } from "node:util";
import { createToken, createTokenCfg } from "./actions/createToken";
import { createSeries, createSeriesCfg } from "./actions/createSeries";
import { mintFungibleToken, mintFungibleTokenCfg } from "./actions/mintFungibleToken";
import { mintNftToken, mintNftTokenCfg } from "./actions/mintNftToken";
import { PhantasmaKeys, setLogger } from "phantasma-sdk-ts";
import { runContractCli } from "./cli-contract";
import { buildVersionReport, renderVersionReport } from "./version";

/**
 * CLI for pha-deploy.
 *
 * Modes:
 *  - CLI one-shot: use flags to perform actions immediately
 *  - TOML-driven: use `--config` or default `config.toml` for config values
 *
 * Actions:
 *  - create-token
 *  - create-series
 *  - mint-fungible
 *  - mint-nft
 */

function printHelp(): void {
  const text = `Usage:
  pha-deploy contract <compile|deploy|upgrade> [options]
  pha-deploy --create-token [options]
  pha-deploy --create-series [options]
  pha-deploy --mint-fungible [options]
  pha-deploy --mint-nft [options]

Actions:
  contract compile       Compile a contract through the system-installed pha-tomb
  contract deploy        Deploy a compiled contract bundle
  contract upgrade       Upgrade a compiled contract bundle
  --create-token       Create a token
  --create-series      Create a token series
  --mint-fungible      Mint fungible tokens
  --mint-nft           Mint tokens

Common flags:
  --config <path>               Path to TOML config file (default: config.toml)
  --dry-run                     Do not broadcast transactions; just show payloads
  --rpc-log                     Enable SDK JSON-RPC logging (full response payloads)
  --settings-log                Print resolved configuration before executing an action
  --help                        Show this help
  --version                     Show version number

Overrides (replace values from config.toml when provided):
  --rpc <url>                   RPC endpoint (fallback: https://testnet.phantasma.info/rpc)
  --nexus <name>                Chain nexus (example: mainnet or testnet)
  --wif <wif>                   WIF for signing
  --symbol <symbol>             Token symbol
  --token-type <nft|fungible>   Token type to create (default: nft)
  --token-max-supply <int>      Non-negative integer; required when token-type=fungible
  --fungible-max-supply <int>   Alias for --token-max-supply
  --fungible-decimals <0..255>  Decimal places; required when token-type=fungible
  --carbon-token-id <int>       Existing carbon token ID (for series or mint)
  --phantasma-series-id <int>   Existing Phantasma series ID (required for deterministic mint)
  --mint-fungible-to <address>  Recipient address for fungible mint (default: WIF owner)
  --mint-fungible-amount <int>  Amount to mint (integer atomic units)
  --rom <hex>                   Token ROM hex (optional; for token creation)
  --token-schemas <json>        JSON string with schemas (seriesMetadata, rom, ram)
  --token-metadata <json>       JSON string of token metadata fields
  --series-metadata <json>      JSON object or array of series metadata fields
  --nft-metadata <json>         JSON object or array of NFT metadata fields
  --create-token-max-data <int> Max data for create-token tx
  --create-token-series-max-data <int> Max data for create-series tx
  --mint-token-max-data <int>   Max data for mint-nft tx
  --gas-fee-base <int>          Gas fee base
  --gas-fee-create-token-base <int>   Gas fee base for create-token
  --gas-fee-create-token-symbol <int> Gas fee per symbol
  --gas-fee-create-token-series <int> Gas fee for create-series
  --gas-fee-multiplier <int>    Gas fee multiplier

pha-deploy - Phantasma token deployment and minting CLI
`;
  console.log(text);
}

function requireArg<T>(
  value: T,
  name: string,
): asserts value is NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error(`${name} is required`);
  }
}

/* ----------------------------- Actions ----------------------------- */
async function actionCreateToken(
  cfg: Config,
  dryRun: boolean,
  logSettings: boolean,
) {
  requireArg(cfg.rpc, "rpc");
  requireArg(cfg.nexus, "nexus");
  requireArg(cfg.wif, "wif");
  requireArg(cfg.symbol, "symbol");
  requireArg(cfg.gasFeeBase, "gas_fee_base");
  requireArg(cfg.gasFeeCreateTokenBase, "gas_fee_create_token_base");
  requireArg(cfg.gasFeeCreateTokenSymbol, "gas_fee_create_token_symbol");
  requireArg(cfg.gasFeeMultiplier, "gas_fee_multiplier");
  requireArg(cfg.createTokenMaxData, "create_token_max_data");

  const tokenType: TokenType =
    (cfg.tokenType ?? "nft") === "fungible" ? "fungible" : "nft";

  if (tokenType === "fungible") {
    requireArg(cfg.tokenMaxSupply, "token_max_supply");
    requireArg(cfg.fungibleDecimals, "fungible_decimals");
  } else {
    requireArg(cfg.tokenSchemas, "token_schemas");
  }

  await createToken(
    new createTokenCfg(
      cfg.rpc,
      cfg.nexus,
      cfg.wif,
      cfg.symbol,
      cfg.gasFeeBase,
      cfg.gasFeeCreateTokenBase,
      cfg.gasFeeCreateTokenSymbol,
      cfg.gasFeeMultiplier,
      cfg.createTokenMaxData,
      cfg.tokenSchemas,
      cfg.tokenMetadata,
      tokenType,
      cfg.tokenMaxSupply,
      cfg.fungibleDecimals,
    ),
    dryRun,
    logSettings,
  );
}

async function actionCreateSeries(
  cfg: Config,
  dryRun: boolean,
  logSettings: boolean,
) {
  requireArg(cfg.rpc, "rpc");
  requireArg(cfg.nexus, "nexus");
  requireArg(cfg.wif, "wif");
  requireArg(cfg.carbonTokenId, "carbon_token_id");
  requireArg(cfg.tokenSchemas, "token_schemas");
  requireArg(cfg.seriesMetadata, "series_metadata");
  requireArg(cfg.gasFeeBase, "gas_fee_base");
  requireArg(cfg.gasFeeCreateTokenSeries, "gas_fee_create_token_series");
  requireArg(cfg.gasFeeMultiplier, "gas_fee_multiplier");
  requireArg(cfg.createTokenSeriesMaxData, "create_token_series_max_data");

  await createSeries(
    new createSeriesCfg(
      cfg.rpc,
      cfg.nexus,
      cfg.wif,
      cfg.carbonTokenId,
      cfg.gasFeeBase,
      cfg.gasFeeCreateTokenSeries,
      cfg.gasFeeMultiplier,
      cfg.createTokenSeriesMaxData,
      cfg.tokenSchemas?.seriesMetadata,
      cfg.seriesMetadata
    ),
    dryRun,
    logSettings,
  );
}

async function actionMintNft(
  cfg: Config,
  dryRun: boolean,
  logSettings: boolean,
) {
  requireArg(cfg.rpc, "rpc");
  requireArg(cfg.nexus, "nexus");
  requireArg(cfg.wif, "wif");
  requireArg(cfg.carbonTokenId, "carbon_token_id");
  requireArg(cfg.phantasmaSeriesId, "phantasma_series_id");
  requireArg(cfg.tokenSchemas, "token_schemas");
  requireArg(cfg.nftMetadata, "nft_metadata");
  requireArg(cfg.gasFeeBase, "gas_fee_base");
  requireArg(cfg.gasFeeMultiplier, "gas_fee_multiplier");
  requireArg(cfg.mintTokenMaxData, "mint_token_max_data");

  await mintNftToken(
    new mintNftTokenCfg(
      cfg.rpc,
      cfg.nexus,
      cfg.wif,
      cfg.carbonTokenId,
      cfg.phantasmaSeriesId,
      cfg.tokenSchemas.rom,
      cfg.nftMetadata,
      cfg.gasFeeBase,
      cfg.gasFeeMultiplier,
      cfg.mintTokenMaxData,
    ),
    dryRun,
    logSettings,
  );
}

async function actionMintFungible(
  cfg: Config,
  dryRun: boolean,
  logSettings: boolean,
) {
  requireArg(cfg.rpc, "rpc");
  requireArg(cfg.nexus, "nexus");
  requireArg(cfg.wif, "wif");
  requireArg(cfg.carbonTokenId, "carbon_token_id");
  requireArg(cfg.mintFungibleAmount, "mint_fungible_amount");
  requireArg(cfg.gasFeeBase, "gas_fee_base");
  requireArg(cfg.gasFeeMultiplier, "gas_fee_multiplier");
  requireArg(cfg.mintTokenMaxData, "mint_token_max_data");

  const to =
    cfg.mintFungibleTo ?? PhantasmaKeys.fromWIF(cfg.wif).Address.toString();

  await mintFungibleToken(
    new mintFungibleTokenCfg(
      cfg.rpc,
      cfg.nexus,
      cfg.wif,
      cfg.carbonTokenId,
      to,
      cfg.mintFungibleAmount,
      cfg.gasFeeBase,
      cfg.gasFeeMultiplier,
      cfg.mintTokenMaxData,
    ),
    dryRun,
    logSettings,
  );
}

/* ------------------------------- Main ------------------------------- */

async function main() {
  const rawArgv = hideBin(process.argv);

  if (rawArgv.length === 1 && (rawArgv[0] === "--version" || rawArgv[0] === "-v")) {
    console.log(renderVersionReport(await buildVersionReport()));
    return;
  }

  if (rawArgv[0] === "contract") {
    await runContractCli(rawArgv.slice(1));
    return;
  }

  // Pre-parse --config and --help early so the TOML file can be loaded before the main yargs parsing.
  const pre = yargs(rawArgv)
    .option("config", {
      type: "string",
      alias: "c",
      description: "Path to TOML config file (default: config.toml)",
    })
    .option("help", {
      type: "boolean",
    })
    .alias("h", "help")
    .help(false)
    .version(false)
    .parseSync();

  if ((pre as any).help) {
    printHelp();
    return;
  }

  // Minimal yargs parsing for the top-level CLI behavior
  const parser = yargs(rawArgv)
    .scriptName("pha-deploy")
    .usage("Usage: $0 [options] [--create-token|--create-series|--mint-fungible|--mint-nft]")
    .option("rpc", { type: "string", describe: "RPC endpoint" })
    .option("nexus", { type: "string", describe: "Chain nexus" })
    .option("wif", { type: "string", describe: "WIF for signing" })
    .option("symbol", { type: "string", describe: "Token symbol" })
    .option("token-type", {
      type: "string",
      choices: ["nft", "fungible"],
      describe: "Token type to create (default: nft)",
    })
    .option("token-max-supply", {
      type: "string",
      describe:
        "Token max supply (optional for NFT; required when --token-type fungible)",
    })
    .option("fungible-decimals", {
      type: "number",
      describe:
        "Decimal places for fungible token (required when --token-type fungible)",
    })
    .option("dry-run", {
      type: "boolean",
      describe: "Do not broadcast transactions; just show payloads",
    })
    .option("rpc-log", {
      type: "boolean",
      describe:
        "Enable SDK RPC logging (prints full JSON-RPC responses for debugging)",
    })
    .option("settings-log", {
      type: "boolean",
      describe: "Print resolved configuration before executing an action",
    })
    .option("help", {
      type: "boolean",
      describe: "Show help",
    })
    .alias("h", "help")
    .option("config", {
      type: "string",
      describe:
        "Path to TOML config file (default: config.toml). Takes precedence as the file used for defaults.",
    })
    .option("create-token", { type: "boolean", describe: "Create a token" })
    .option("create-series", {
      type: "boolean",
      describe: "Create a token series",
    })
    .option("mint-fungible", { type: "boolean", describe: "Mint fungible tokens" })
    .option("mint-nft", { type: "boolean", describe: "Mint tokens" })
    .option("mint-fungible-to", {
      type: "string",
      describe: "Recipient address for fungible mint (default: WIF owner)",
    })
    .option("mint-fungible-amount", {
      type: "string",
      describe: "Amount to mint (integer atomic units)",
    })
    .version(false)
    .epilog("pha-deploy - Phantasma token deployment and minting CLI");

  const argv = await parser.parseAsync();
  if ((argv as any).help) {
    printHelp();
    return;
  }

  // Load TOML configuration (if present) before doing full parsing
  const cfg = loadConfig({ configPath: pre.config ?? null });

  const rpcLogEnabled = Boolean((argv as any)["rpc-log"]);
  const settingsLogEnabled = Boolean((argv as any)["settings-log"]);
  if (rpcLogEnabled) {
    // SDK logs JSON-RPC responses as raw objects; inspect avoids [Object] output.
    setLogger({
      log: (...args: unknown[]) => {
        const formatted = args.map((arg) =>
          typeof arg === "string"
            ? arg
            : inspect(arg, { depth: null, colors: false }),
        );
        console.log(...formatted);
      },
    });
  } else {
    // Enforce silent SDK logs unless explicitly enabled.
    setLogger();
  }

  // Determine dry-run (CLI flag overrides config)
  const dryRun = Boolean((argv as any)["dry-run"]) || cfg.dryRun || false;

  // One-shot actions: pick the first matching action
  const actions = ["create-token", "create-series", "mint-fungible", "mint-nft"];
  let foundAction = false;
  for (const action of actions) {
    if ((argv as any)[action]) {
      foundAction = true;
      switch (action) {
        case "create-token": {
          await actionCreateToken(cfg, dryRun, settingsLogEnabled);
          return;
        }
        case "create-series": {
          await actionCreateSeries(cfg, dryRun, settingsLogEnabled);
          return;
        }
        case "mint-fungible": {
          await actionMintFungible(cfg, dryRun, settingsLogEnabled);
          return;
        }
        case "mint-nft": {
          await actionMintNft(cfg, dryRun, settingsLogEnabled);
          return;
        }
      }
    }
  }

  // No action requested -> show help
  if (!foundAction) {
    printHelp();
  }
}

/* ----------------------------- Run Script ---------------------------- */

if (require.main === module) {
  main().catch((err) => {
    console.error(
      "Unhandled error in CLI:",
      err && err.stack ? err.stack : err,
    );
    process.exit(2);
  });
}

export default main;
