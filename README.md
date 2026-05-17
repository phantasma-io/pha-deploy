# pha-deploy

CLI for Phantasma token flows and contract lifecycle workflows.

Current surface area:
- Token actions:
  - `--create-token`
  - `--create-series`
  - `--mint-fungible`
  - `--mint-nft`
- Contract actions:
  - `contract compile`
  - `contract deploy`
  - `contract upgrade`
  - `contract attach`
- `--version` prints both the `pha-deploy` version and the resolved `pha-tomb` version/path.
- Dry-run mode is available for token and contract transactions.

## Requirements

- Node.js `>=22`
- `pha-tomb >= 2.1.0` must be available for `contract compile`, either in `PATH` or through `--compiler` / `PHA_TOMB_PATH`

`contract deploy`, `contract upgrade`, and `contract attach` do not invoke the compiler directly. They work from a compiled artifact bundle or explicit `--script` / `--abi` inputs.

## Installation

```bash
# global install
npm i -g pha-deploy

# inspect the installed CLI and compiler binding
pha-deploy --version

# local development install
npm install
npm run build
node dist/cli.js --help
```

Example version output:

```text
pha-deploy 0.5.1
pha-tomb version 2.1.0
pha-tomb path /usr/local/bin/pha-tomb
```

## Usage

```bash
pha-deploy contract <compile|deploy|upgrade|attach> [options]
pha-deploy --create-token [options]
pha-deploy --create-series [options]
pha-deploy --mint-fungible [options]
pha-deploy --mint-nft [options]
```

## Token Workflow

Token actions still support the config-first TOML flow.

Typical setup:

```bash
cp config/config.example.toml config.toml
pha-deploy --create-token --config config.toml
```

Common token flags:

- `--config <path>`: load TOML config, default `config.toml`
- `--dry-run`: build/sign but do not broadcast
- `--rpc-log`: enable SDK JSON-RPC logging
- `--settings-log`: print the resolved configuration before execution
- `--rpc <url>`
- `--nexus <name>`
- `--wif <wif>`
- `--symbol <symbol>`
- `--token-type <nft|fungible>`
- `--token-max-supply <int>`
- `--fungible-max-supply <int>`
- `--fungible-decimals <0..255>`
- `--carbon-token-id <int>`
- `--phantasma-series-id <int>`
- `--mint-fungible-to <address>`
- `--mint-fungible-amount <int>`
- `--rom <hex>`
- `--token-schemas <json>`
- `--token-metadata <json>`
- `--series-metadata <json>`
- `--nft-metadata <json>`
- `--create-token-max-data <int>`
- `--create-token-series-max-data <int>`
- `--mint-token-max-data <int>`
- `--gas-fee-base <int>`
- `--gas-fee-create-token-base <int>`
- `--gas-fee-create-token-symbol <int>`
- `--gas-fee-create-token-series <int>`
- `--gas-fee-multiplier <int>`

Required token inputs by action:

- `--create-token`
  - requires `rpc`, `nexus`, `wif`, `symbol`
  - NFT path requires `token_schemas`
  - fungible path requires `token_max_supply` and `fungible_decimals`
- `--create-series`
  - requires `carbon_token_id`, `token_schemas`, `series_metadata`
- `--mint-nft`
  - requires `carbon_token_id`, `phantasma_series_id`, `token_schemas`, `nft_metadata`
- `--mint-fungible`
  - requires `carbon_token_id`, `mint_fungible_amount`
  - `mint_fungible_to` defaults to the signer address when omitted

`series_metadata` and `nft_metadata` accept either:
- a JSON object of `name -> value`
- an array of `{ "name": "...", "value": ... }`

## Contract Workflow

### 1. Compile

Compile a `.tomb` source file through `pha-tomb` from `PATH`, or pin an exact local compiler with `--compiler` / `PHA_TOMB_PATH`.

```bash
pha-deploy contract compile \
  --source ./contracts/demo.tomb \
  --compiler /path/to/pha-tomb \
  --out ./dist/contracts/demo \
  --debug \
  --protocol 16 \
  --nativecheck warn
```

Supported compile flags:

- `--source <path>`: required `.tomb` source file
- `--compiler <path>`: optional explicit `pha-tomb` executable path; takes precedence over `PHA_TOMB_PATH` and `PATH`
- `--out <dir>`: final artifact bundle directory
- `--contract-name <name>`: required when the compiler emits multiple modules and you need to pick one
- `--protocol <number>`: passed through to `pha-tomb`
- `--debug`: request debug artifacts
- `--nativecheck <off|warn|error>`
- `--libpath <path>`: repeatable additional library search path

`PHA_TOMB_PATH=/path/to/pha-tomb` is also supported when `--compiler` is omitted and you want to avoid whichever `pha-tomb` happens to be first in `PATH`.

Compile output:

- prints the exact compiler command and cwd
- prints separated `pha-tomb stdout` / `pha-tomb stderr`
- materializes an artifact bundle in the selected output directory
- writes `manifest.json`
- copies:
  - `<contract>.pvm`
  - `<contract>.abi`
  - optional `<contract>.debug`
  - optional `<contract>.asm`
  - optional `<contract>.pvm.hex`
  - optional `<contract>.abi.hex`

`manifest.json` is the preferred handoff format for later deploy/upgrade/attach commands.

### 2. Deploy

Deploy a compiled contract bundle.

Using the manifest produced by `contract compile`:

```bash
pha-deploy contract deploy \
  --rpc https://testnet.phantasma.info/rpc \
  --nexus testnet \
  --chain main \
  --wif <WIF> \
  --manifest ./dist/contracts/demo/manifest.json \
  --dry-run
```

Using explicit artifact paths instead of a manifest:

```bash
pha-deploy contract deploy \
  --rpc https://testnet.phantasma.info/rpc \
  --nexus testnet \
  --wif <WIF> \
  --contract-name demo \
  --script ./dist/contracts/demo/demo.pvm \
  --abi ./dist/contracts/demo/demo.abi
```

### 3. Upgrade

Upgrade an already deployed contract using the same artifact inputs:

```bash
pha-deploy contract upgrade \
  --rpc https://testnet.phantasma.info/rpc \
  --nexus testnet \
  --chain main \
  --wif <WIF> \
  --manifest ./dist/contracts/demo/manifest.json \
  --dry-run
```

### 4. Attach

Attach a compiled VM contract bundle to an already existing token symbol:

```bash
pha-deploy contract attach \
  --rpc https://testnet.phantasma.info/rpc \
  --nexus testnet \
  --chain main \
  --wif <WIF> \
  --manifest ./dist/contracts/demo/manifest.json \
  --symbol DEMO \
  --dry-run
```

When `--symbol` is omitted, `contract attach` defaults to the bundle contract name from the manifest or direct artifact inputs.

Shared deploy/upgrade/attach flags:

- `--rpc <url>`: required
- `--nexus <name>`: required
- `--chain <name>`: optional, defaults to `main`
- `--wif <wif>`: required
- `--manifest <path>`: preferred compiled bundle input
- `--contract-name <name>`: required when using direct `--script` / `--abi`
- `--script <path>`: compiled `.pvm`
- `--abi <path>`: compiled `.abi`
- `--debug <path>`: optional `.debug`
- `--gas-price <int>`
- `--gas-limit <int>`
- `--pow <int>`
- `--payload-hex <hex>`
- `--dry-run`

Attach-only flag:

- `--symbol <symbol>`: existing token symbol to attach to; defaults to the bundle contract name when omitted

Deploy/upgrade output always includes:

- operation
- contract name
- signer address
- script byte count
- ABI byte count
- generated VM script hex
- signed transaction hex

Attach output also prints the resolved token symbol used for the interop call.

When `--dry-run` is omitted, the CLI also broadcasts the transaction, waits for the tx result, and prints the tx hash.

## Quick Examples

Create an NFT token from config:

```bash
pha-deploy --create-token --config ./config.toml
```

Mint fungible tokens without editing the config file:

```bash
pha-deploy --mint-fungible \
  --config ./config.toml \
  --carbon-token-id 123 \
  --mint-fungible-amount 100000000
```

Compile, then deploy from the emitted manifest:

```bash
pha-deploy contract compile --source ./contracts/demo.tomb
pha-deploy contract deploy \
  --rpc https://testnet.phantasma.info/rpc \
  --nexus testnet \
  --wif <WIF> \
  --manifest ./dist/contracts/demo/manifest.json \
  --dry-run
```

## Dev Shortcuts

This repo ships a `justfile` with the current documented shortcuts:

- `just build`
- `just test`
- `just ct`
- `just ctf`
- `just ctd`
- `just cs`
- `just csd`
- `just mn`
- `just mnd`
- `just mf`
- `just mfd`

Run `just --list` to inspect the full local helper set.
