[private]
just:
    just -l

[group('test')]
test:
    npm run test

[group('manage')]
reinstall:
    rm -rf node_modules package-lock.json
    npm install

[group('manage')]
outdated:
    npm outdated --omit=dev

[group('manage')]
update-dev:
    npx npm-check-updates -u --dep dev --target minor

[group('manage')]
update-prod:
    npx npm-check-updates -u --dep prod --target minor

[group('manage')]
check:
    npx eslint . --ext .ts

[group('build')]
clean:
    rm -rf dist

[group('build')]
build:
    npm run build

# Rebuild
[group('build')]
rb:
    just clean & just build

# Create NFT token
[group('run')]
ct: build
    npm start -- --create-token

# Create fungible token
[group('run')]
ctf: build
    npm start -- --create-token --token-type=fungible

[group('run')]
ctd: build
    npm start -- --create-token --rpc-log --settings-log --dry-run

[group('run')]
cs: build
    npm start -- --create-series

[group('run')]
csd: build
    npm start -- --create-series --rpc-log --settings-log --dry-run

[group('run')]
mn: build
    npm start -- --mint-nft

[group('run')]
mnd: build
    npm start -- --mint-nft --rpc-log --settings-log --dry-run

[group('run')]
mf: build
    npm start -- --mint-fungible

[group('run')]
mfd: build
    npm start -- --mint-fungible --rpc-log --settings-log --dry-run

[group('manage')]
switch-to-local-ts-sdk:
    cd ../phantasma-sdk-ts && just rb && cd - && rm -r --force node_modules/phantasma-sdk-ts && cp -r ../phantasma-sdk-ts node_modules/ && just rb

[group('publish')]
publish: build
    npm publish
