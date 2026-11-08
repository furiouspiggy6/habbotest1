# Habbo NFT Market Radar (Windows)

Local dashboard for **Habbo NFT collections on Immutable zkEVM only**. Tracks listings, recorded fills, price-history candles and underpriced offers. Includes automatic **paper** purchases, and a guarded, **experimental** real-money order execution module. It does not support ordinary Habbo furniture/credits, in-game Silver/Emerald sales, or Ethereum-mainnet premium Avatar/Portrait/Room NFTs.

## Launch on Windows

1. Extract the zip into a permanent folder.
2. Install **Node.js 24 LTS or newer** from https://nodejs.org/en/download. The app checks your installed version before attempting to load the Immutable SDK.
3. Double-click `START_WINDOWS.bat`. On first launch it downloads the official `@imtbl/sdk` and `ethers` dependencies using `npm install`. You need internet for this and for live data.
4. Your browser opens `http://127.0.0.1:38571`. If it opens too soon, refresh the page.
5. The dashboard starts in **Live market data** mode, scanning real Immutable zkEVM NFT orders. The initial connection may fail if the SDK needs a valid Immutable Hub publishable key; see the scan diagnostics below the listing table. **Real-money buying remains OFF.**

Run `npm test` from the extracted folder to check the pure-price and risk tests.

## v1.0.4: live-market scanner first

The original v1.0.3 intentionally started with eight synthetic NFT listings. On the first v1.0.4 launch, existing demo-only settings are migrated to live scanning once; you can still choose Demo in settings later. New installations default to Live. The dashboard shows orderbook request success/fail counts, raw orders received, and errors rather than silently showing invented offers. No live purchase permission changes.

If you get **0 offers**, check the diagnostic text below the table, and if the errors mention `401` or `403` create a *publishable* key at https://hub.immutable.com/ and paste it into Settings → Immutable publishable API key → Save. Never paste a secret API key or wallet private key there. If the API returned raw orders but none are displayed, the diagnostics show observed payment token types, so we can adapt parsing safely. **No current live connection or purchase was verified by the authoring environment.**

The app only scans external Immutable WETH-priced NFT orders, not the separate in-game Emerald collectibles market.

## What you'll see

- Market scanner for Furni, Clothes, Addons, Pets and Tokens (optional legacy ERC1155).
- ERC20 WETH quotes only, not incorrectly labelled IMX/native tokens.
- Previous completed order sales, metadata-grouped by identical NFT types (never compare unrelated token IDs).
- Daily **OHLC candlestick** price charts. Each day's candles are constructed only from actual orderbook fill prices; no made-up days.
- 30-day sale count, median reference, expected post-fee resale edge, minimum discount and per-purchase spending limits.
- Paper autobuyer with local activity history and CSV export.
- Local persistent metadata cache and sale ledger at `data/state.json`. Never upload this file if you don't want to share your trading activity.

## Fixes in v1.0.1

- Windows launcher checks for Node.js 24+ and stops with clear upgrade instructions rather than proceeding with incompatible SDK dependencies.
- Demo sales stay separate from real market sale history and cannot affect live trade signals. Older fake demo sale records are discarded when loading the previous app state.
- This patch does not resolve `npm audit` security advisories in transitive dependencies. Avoid using real funds until the SDK and runtime dependencies have been independently security-reviewed. Do **not** run `npm audit fix --force` blindly.

## IMPORTANT: Limits of market data

- This is not a tick-perfect market-wide sniper. It polls orderbook listings about every 90 seconds. Orderbook pagination is capped by your setting. Existing or historic orders can be absent from a scan. The dashboard shows coverage warnings.
- The Immutable SDK, collection-address catalogue and metadata shapes may change. **Real API connectivity and real purchases were NOT tested in the creation environment**; if live data fails, review logs rather than assuming it's working.
- Historical FILLED order timestamps may represent order update times rather than the precise moment of a trade; candlesticks are an approximation. Some types may have too few verifiable sales to value; the app refuses to fire signals for them.
- Unresolved metadata is explicitly excluded from buy signals rather than treating unrelated token IDs as identical.
- Pricing in bridged WETH does not include all possible costs: resale estimates use a configurable fee, buyer fees seen in the listing, and do **not** account for future gas, price impact, or inability to resell. Low liquidity makes apparent discounts deceptive.
- This is not a guaranteed profit machine and does not automatically list or resell purchased NFTs.

## Live autobuying: advanced and experimental

**Do not turn this on until you've observed live market prices for a while, checked at least a few against TokenTrove, and tested with funds you can lose.** No live execution was performed or proven in this environment.

Real autobuying requires a separate low-balance wallet and an API key if Immutable requires one. Never use the private key of your main MetaMask wallet.

1. Copy `.env.example` to `.env` in the extracted directory. If you choose to enable trading later, use a dedicated wallet private key in `HABBO_BOT_PRIVATE_KEY` and set `HABBO_ENABLE_LIVE_BUYS=YES`. The key stays local to this computer and is never sent to the browser or the API status response, but `.env` is plaintext and must be secured.
2. Fund the wallet with a strictly limited amount of **WETH on Immutable zkEVM** for purchases plus the network's native **IMX** for transaction gas. The app does not bridge funds.
3. The bot **will not auto-grant ERC20 token approvals**. Approve a *limited* WETH allowance for the Immutable settlement contract manually using an audited wallet interface if needed. If an approval is required, the bot refuses the order and disarms rather than granting unlimited allowances.
4. Switch dashboard to **Live market data**, set a conservative daily budget and maximum single buy, and save. The live orderbook must have been scanned successfully.
5. Type `ENABLE LIVE NFT BUYING` into the live-buying lock and click Arm. The app NEVER auto-arms when it starts. It buys at most one item per scan, checks that its order is still live, checks total price/fees, gas estimate, chain ID and wallet balance, and records every attempted transaction. It stops and disarms on error.
6. Disarm instantly from Strategy & settings, or close the app. Closing the terminal process stops future scheduled scans.

**WARNING**: This implementation is experimental and the marketplace SDK flow may need version-specific adjustments before a real purchase can succeed. It has not been audit-reviewed. The developer assumes responsibility for adapting/upgrading SDK integrations and validating the exact settlement transactions against test trades. The bot never guarantees a price or a resale profit.

## Under the hood

- `core.mjs` pure pricing, metadata group keys, candles, safety limits
- `market.mjs` Immutable Orderbook active/filled order polling and Blockchain Data metadata retrieval
- `trade.mjs` explicitly gated on-chain purchase attempt using Immutable's `fulfillOrder` and ethers wallet, with pre-send rechecks
- `server.mjs` localhost-only API and scanner scheduler, persistent ledger
- `public/` offline-capable dashboard UI (no web/CDN chart dependencies)
- `tests/` deterministic unit tests using sample NFT orderbook data

### References
- Immutable Orderbook SDK: https://devsupport.immutable.com/build/typescript/usage/orderbook/get-orders/
- Immutable fill listing: https://devsupport.immutable.com/v1/products/zkevm/orderbook/fill/
- Immutable ERC20 WETH zkEVM address: https://github.com/immutable/zkevm-bridge-contracts
- Habbo Collection trading: https://collectibles.habbo.com/imx/
- NFT marketplace: https://tokentrove.com/collection/Habbo

## GitHub versioning & updater (v1.0.2)

The **Strategy & settings → Software updates** section has a **Check for updates** button. It checks the *latest published GitHub Release*, not unreleased code on `main`. Updates are **manual opt-in**: after review, **Install verified update & restart** downloads the release ZIP, reads its `.sha256` checksum, verifies the bytes, stages dependencies, waits for the scanner to stop, backs up code, installs and restarts. A failed staged dependency install leaves current files untouched. A source backup and updater log are stored in `data/updates`. Live buying must be disarmed before installation, and remains disarmed after restart. The updater **never overwrites** `.env` (wallet configuration) or `data/` (local settings and trade history). SHA-256 guards against corruption but is not a substitute for code review or a secure GitHub account.

GitHub repository: **`furiouspiggy6/habbotest1`**, preferably public to allow unauthenticated release checks. The code intentionally doesn't include your `.env`, private keys, personal trade ledger, `node_modules`, or any other `data/` contents. The project is separate from `habbo-companion` and `habbo-chat-reader`.

After uploading this project into the repository's **main** branch, GitHub Actions (`.github/workflows/publish-release.yml`) runs the tests and creates a release with a version-named ZIP plus checksum. **Each subsequent published update must increase `package.json`'s version**; pushes with the same version skip publishing. GitHub Actions needs permission to write repository contents and workflows must be enabled. If the repository is private, unauthenticated update checks cannot work and require a different authenticated design.

The updater is Windows-specific. `npm install` runs during the update using your installed Node.js 24+ runtime. Since live trades and updater execution could not be tested on a real Windows wallet in this environment, keep live autobuying off until independently reviewed.

## Live scanner diagnostics (v1.0.5)

- **Live vs demo:** in live mode the UI does not claim that market data was retrieved until it actually sees raw orders. There is no automatic fallback to invented sample listings.
- The scan diagnostics panel displays per-collection raw/accepted counts, API failures, rejected order reasons and the first API response field names (without disclosing private credentials).
- Fixed Unix-second timestamps arriving as strings and pagination nested in SDK result envelopes. These previously could drop completed sales or limit scans to one page.
- A publishable key from Immutable Hub may be required for live API access; without one API errors will be shown instead of fake prices.
- Real-money trading is still experimental and OFF until deliberately enabled. Do not put private keys into GitHub.

## Automatic GitHub updates (v1.0.6)

**Automatic updates are ON by default** and configurable under Strategy & settings → Software updates. On Windows, the app checks the latest `furiouspiggy6/habbotest1` GitHub release after startup and about every six hours. If a newer version is published, it downloads the ZIP directly, checks the accompanying SHA-256 checksum, starts the existing staged Windows updater, closes and restarts itself. No manual ZIP download or install confirmation is needed when this option is on. Checks are deferred during market scans, when live buying is armed, or while another update is running. Failures are shown in the app and retried later; no silent fallback to demo trading occurs.

**Existing installations:** v1.0.5 already has the **Check for updates → Install verified update & restart** buttons, so use them *once* to install v1.0.6. After that updates are automatic unless disabled in settings. The `data/` folder and `.env` wallet configuration remain local and unchanged. The updater does not enable real-money NFT buying. Auto-installing software from GitHub trusts the repository's published releases and is not a substitute for reviewing code.

## v1.0.7: Read-only REST market connection

The Habbo NFT scanner no longer loads `@imtbl/sdk`. It uses public, read-only Immutable zkEVM REST endpoints:

- `GET https://api.immutable.com/v1/chains/imtbl-zkevm-mainnet/orders/listings?status=ACTIVE&sell_item_contract_address=...`
- The same endpoint with `status=FILLED` for order history.
- `GET https://api.immutable.com/v1/chains/imtbl-zkevm-mainnet/collections/{address}/nfts/{tokenId}` for item metadata.

Node 24+ includes the required `fetch` API. The Windows launcher does not run `npm install` or download hundreds of packages just to scan listings. An optional **publishable** Immutable Hub key can be added in the dashboard; do not enter secret keys or wallet seeds. Failed requests display their real HTTP status and short reason, rather than an inaccurate "SDK is not installed" error. No fallback to fictional demo data occurs in live mode.

**Experimental live buying remains OFF by default.** Its existing code uses the separate Immutable transaction SDK and ethers, which are not installed by default in v1.0.7 and have not been validated for real-money execution. Leave live buying disabled while checking price-history quality, liquidity, marketplace coverage and security. Installing the optional trading dependencies is a separate step for future audited releases, not a requirement for market scanning.

The first v1.0.7 scan and auto-updater still require internet access; the GitHub release installs through the app's automatic updater if v1.0.6 is installed and auto-update is enabled.
