# Habbo NFT Market Radar — Windows desktop edition

**Native desktop app** (v2.0.0). This replaces the previous browser-based packaging. The interface is displayed in a dedicated Windows window using Electron; the read-only Immutable NFT scanner runs locally inside that process. A normal browser or separately installed Node.js is not required.

## Install and update

1. Open [GitHub Releases](https://github.com/furiouspiggy6/habbotest1/releases) and select the most recent release labelled **Windows desktop**.
2. Install `Habbo-NFT-Market-Radar-Setup-2.0.0.exe`. This first desktop installation is required to move from the old browser-based version; do **not** install the old source ZIP.
3. Launch **Habbo NFT Market Radar** from the Windows Start menu or desktop shortcut.
4. Future versions are checked/downloaded automatically using Electron's `electron-updater` and the release's `latest.yml` (built by Windows CI). The updater waits until the current scan finishes and avoids interrupting armed real-money trading.

The desktop window includes **Strategy & Settings → Software updates → Check for updates**. Update errors appear inside the app instead of an inaccessible browser fetch. Your desktop app state is under your Windows user profile's Application Data directory. Your old browser-based installation and its `data/` folder are not overwritten or removed.

**Important:** The initial installer is unsigned until a Windows code-signing certificate is configured. Windows SmartScreen may warn. You should download only from the project's own GitHub Releases page, and never provide wallet private keys to a web page or GitHub. The auto-updater checks SHA-512 file integrity from `latest.yml` but publisher signing is not yet configured. Treat the desktop build as experimental and keep real-money buying disabled.

## Building

- `npm install`
- `npm test`
- `npm run start` for development (update checks only run in a packaged executable)
- `npm run dist:win` to build the Windows NSIS installer; `.github/workflows/desktop-windows.yml` builds/publishes automatically when a new version is pushed to `main`.

The legacy Windows ZIP-based updater remains in the codebase for users of v1.x, but **desktop v2.x does not run it**. The legacy ZIP release workflow is now manual-only so that it cannot preempt the native Windows installer release.

---

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


## Repairing a stale installation (v1.0.9)

If the dashboard still prints `Immutable SDK is not installed`, an **old copy** of the scanner is running. The v1.0.8+ REST scanner does not emit that error. The current local server version is exposed at `http://127.0.0.1:38571/api/state` under `appVersion`, with `installDirectory` on v1.0.9+.

The `REPAIR_WINDOWS.ps1` script is a one-time self-repair option for users whose old auto-updater cannot finish. From a Windows PowerShell terminal **inside the folder containing `START_WINDOWS.bat`**, run:

```powershell
irm https://raw.githubusercontent.com/furiouspiggy6/habbotest1/main/REPAIR_WINDOWS.ps1 | iex
```

The script verifies the GitHub release ZIP using its SHA-256 sidecar, checks package identity/version, protects `data/` and `.env`, refuses to run while real-money trading is armed, stops only the app on its localhost port (when it is a node server.mjs process), stages the official update script and restarts the app. It does not require manual ZIP handling. Review the script on GitHub before using a remote script command. If there are multiple installed copies, run it in the folder of the copy you launch.

New in v1.0.9: the updater checks GitHub even during a lengthy NFT scan, pauses new scans while an update is pending, then installs once the current scan finishes. If another copy owns the dashboard port, the launcher now prints that process's reported version rather than quietly opening the wrong dashboard.


## v1.0.11 - Windows updater recovery and verified restart

The update worker now launches Node **directly**, instead of passing the batch-file path to `cmd /c`.
After copying a new release it probes `http://127.0.0.1:38571/api/state` and requires the **expected version** to respond before marking the installation successful. If startup fails, it restores the previous source/dependencies and attempts to relaunch the previous version. Each attempt records `data/updates/last-update.log` and `data/updates/last-start.stderr.log`. No `.env` secrets or `data/state.json` are modified.

The live scanner has no external runtime npm dependencies. The staged installer skips npm entirely when a release has none. The browser reloads itself when it sees a server version change.

**If your browser stopped after updating:** do not refresh it repeatedly: the browser is not the application server. First try double-clicking `START_WINDOWS.bat` in the installed folder. If the updater left the install incomplete, open PowerShell in that folder and run the one-time repair command:

```powershell
irm https://raw.githubusercontent.com/furiouspiggy6/habbotest1/main/REPAIR_WINDOWS.ps1 | iex
```

The recovery tool uses the latest published GitHub ZIP and checksum automatically; no manual ZIP download is required. It verifies that the new API is running before declaring success. These Windows updater behaviors have not been end-to-end tested on a real Windows system; Node tests verify the application server and static updater protections.

## v1.0.12: Actual-sale metadata reconciliation and candidate diagnostics

The live scanner now resolves NFT metadata in balanced batches across active listings and completed sales, rather than processing all active listing IDs first. A short retry cooldown prevents permanently missing metadata from starving all subsequent IDs. Previously saved historical FILLED orders are re-hydrated when their matching NFT metadata becomes available, so their verified metadata identities can be compared with active listings. No synthetic data is introduced. Metadata resolution uses a capped request budget to avoid API flooding; coverage accumulates over subsequent scans.

The market diagnostics display verified active/sold metadata counts and a **first blocking criterion** breakdown (missing metadata, too few comparable completed sales, price outside budget, insufficient discount, insufficient net resale edge, bulk quantity). Signals remain conservative with the original thresholds, and real-money trading remains disabled unless deliberately armed.

## v1.0.13: queue updates behind live scans

The manual **Install verified update & restart** button now queues an installation if a live scan is in progress instead of returning HTTP 409. New scans are paused while the current scan finishes. The dashboard shows a waiting message and then downloads, verifies, installs, and restarts through the existing Windows recovery-capable updater. Do not close Market Radar while an update is queued. Buying remains disarmed during updates, and the updater preserves `.env` and `data/`.

## v2.0.1: broader live marketplace coverage and complete listing browser

The desktop app previously returned only the first 800 rows in its 4-second dashboard status API, even if a live scan fetched more offers. The dedicated `/api/listings` endpoint now provides the **complete fetched order set**, transferred only once per completed scan. The listing table pages through 100 real offers at a time, including search and collection filters across all fetched results; CSV exports remain untruncated. Header totals reflect the actual number of fetched supported offers.

The initial scan depth is increased from **6 to 20 pages per collection and order status** (up to 50 orders per page). Users can choose up to 40 pages in Settings if slower/deeper coverage is preferred. Legacy Habbo Furni and Clothes ERC1155 contracts are enabled in the default seven-collection scan. On first run after upgrading from an older default installation, the app migrates the six-page and standard-five-collection defaults; customized collection or scan-depth settings are left alone. Existing local records are preserved and live buying remains disarmed by default. This does not add Ethereum L1 premium collectibles or the separate Habbo in-game Emerald Marketplace. More pages increase coverage but do not guarantee every marketplace order is indexed or that eligible opportunities exist.


## v2.0.2: immediate native updates during read-only market scans

A finished desktop update download can now install without waiting for a large Immutable orderbook scan to finish. The application saves its last completed scan and closes the in-progress read-only network requests through the normal desktop restart. **Real-money buying must be disarmed**, and an in-flight real purchase always blocks automatic installation, even if disarmed during that purchase. Native downloaded updates retry installation every 15 seconds when buying becomes safe; network update checks remain on the six-hour schedule. If an older v2.0.0/v2.0.1 app already says *Update downloaded. Waiting for the scanner to finish*, close the window normally (not Task Manager): the NSIS auto-updater is configured to install the cached download on normal application exit.


## v2.0.3: progressive historical sale indexing and honest active coverage

Immutable's orderbook is cursor-paginated. A finite scan capped at 20 pages can have more
ACTIVE offers and FILLED orders beyond that limit, and it would be wrong to claim full
coverage. Market Radar now starts **every ACTIVE scan from the first page** so it does not
show stale offers as current. For completed FILLED orders it fetches the first (newest)
page on every scan, then spends up to four extra pages per collection advancing a saved
continuation cursor. That backfills older sales **across refreshes instead of rereading
the same 20 pages every time**, with local history retained between restarts.

The dashboard distinguishes active-listing caps (which still trigger a truthful partial
coverage warning) from older sale-history indexing progress. The Recorded Sales tile
shows locally cached unique sale records rather than only the newest response. Real-money
buying remains disarmed by default, and no stale ACTIVE offers are merged into the trade
feed. Immutable API failures and incomplete coverage are never suppressed.


## v2.0.4: desktop updater release-status verification

The desktop app now verifies the latest published Windows release against GitHub's Releases API independently of electron-updater. If an auto-update check incorrectly reports no update while a newer stable installer and `latest.yml` exist, the app explicitly reports the version mismatch and provides a button to open the **official GitHub installer** instead of displaying the false "up to date" message. This fallback does not execute unknown files automatically. It validates the expected Windows asset name and official GitHub URL, and does not transmit local settings or wallet information. Automatic updating remains the primary path. A successful Windows build still must publish both the installer and `latest.yml` on GitHub.

## v2.0.6: version-pinned native update feed

The desktop updater previously checked the GitHub releases API and then separately used electron-updater's default GitHub provider. Under some real-world conditions that returned a stale `latest.yml` reporting the old installed version. The updater now uses the official release API to verify the latest stable Windows release and selects a **GenericProvider pinned to that specific GitHub release tag**, so `latest.yml` and the installer come from the same version. It rejects missing/mismatched manifest URLs and declines to install an update when the downloaded version differs from the API-confirmed target. The official-installer fallback remains available if the native update fails. This needs one existing-installation upgrade to v2.0.6 before it can correct already-installed updater code. The decimal input fix from v2.0.5 is included.

## v2.0.7: precise coverage warnings and resilient Immutable reads

The desktop banner now **separates partial live-listing coverage from failed Immutable API requests**. When requests fail it shows the first concrete collection/status error, not the generic coverage warning. The *View scan details* button opens the diagnostics in the Market Scanner rather than Trade Activity. A maximum of one retry is made for transient HTTP 429/5xx read failures; permanent 401/403 credential errors are never retried. When a page later in a collection fails, already retrieved real orders are retained with an explicit partial-coverage diagnostic instead of discarding that collection. Historical sales indexing keeps the next continuation cursor when possible. This does not claim full market coverage and does not relax buying filters or enable real-money trading.


## v2.0.8: Inspect NFT and actual comparable sales

Click **Inspect →** beside any live order (especially a candidate), or select a row and click **Inspect selected NFT & sales** under the price chart. A scrollable read-only panel shows collection, token ID, order ID, asking price, observed buyer fees and total purchase cost, the existing 30-day price reference and discount, and a fee-adjusted **hypothetical** resale profit and ROI. It also displays the newest 180 verified comparable FILLED records over 90 days, with their actual order prices and update timestamps, and counts from 30/90 days. Sale evidence is taken only from the existing locally cached Immutable records, not generated price history or new simulated data.

The **Search on TokenTrove** button opens the relevant verified collection search where known (Furni, Clothes, Tokens), or the Habbo collection for other types. This is a collection search, **not a guaranteed working direct link to a particular order**. Confirm current order availability and price on TokenTrove. The profit projection assumes a sale at the previously computed 30-day reference after the configured resale fee and observed buyer fee; it does not account for gas, slippage, liquidity or future market changes. The Immutable FILLED updated timestamp may differ from true settlement time. The view never initiates a purchase and does not change live autobuying safeguards.

## v2.0.9: retry transient Immutable timeouts

Immutable REST calls now use a bounded 20-second timeout and retry one transient timeout after a one-second pause, in addition to the existing retry for HTTP 429/5xx. Expired timeouts no longer immediately terminate a collection scan. If the second request fails, the scanner retains completed pages and accurately reports the interrupted ACTIVE coverage. Authorization failures are never retried. Deep scans can still encounter API limits; no guarantee of full coverage.

## v2.0.10: $5 minimum purchase price in AUD or USD

Strategy & Settings → Spending protection now includes a **Minimum purchase price ($)** field (default **5**) and a **Dollar currency** selector (default **AUD**, also supports **USD**). The scanner uses a live public CoinGecko ETH/AUD and ETH/USD spot price, refreshed approximately every five minutes, to estimate the amount of bridged WETH corresponding to the minimum. It measures the **total purchase cost including the listing's buyer fees**, not just the nominal token price. Historical-sale discounts, WETH minimum/maximum limits, and transaction safety checks remain unchanged; a listing must pass **all** filters.

The conversion is approximate, not a live WETH redemption quote. The ETH spot rate must have been fetched within the previous 15 minutes; otherwise **every positive-fiat-floor candidate is disqualified, and live autobuying cannot be armed**. The app still shows real NFT listings, explains the quote problem, and retries the public spot feed periodically. Existing saved settings automatically receive the A$5 minimum on upgrade. Set the dollar minimum to **0** to disable the additional rule. Changing the fiat floor/currency disarms the autobuyer. This feature does not require a wallet and does not enable real-money trading.

## v2.0.12: AUD-only trading dashboard and spending limits

Market Radar shows all customer-facing prices in **Australian dollars (A$)**: live listing/median prices, price-chart OHLC values and tooltips, NFT inspection prices, resale profit estimates, today’s spending, trade journal costs, per-NFT risk limit, and CSV exports. A live **ETH/AUD spot rate** is used only for estimates; **historical sale prices are converted at today's quote, not the exchange rate on each historical sale date**. Internal NFT trade/order amounts and cached history remain WETH, because Immutable zkEVM settles the supported orders in bridged WETH.

The user-facing risk controls are now **Max spend per NFT (AUD)**, **Daily spending limit (AUD)**, **Additional minimum listing price (AUD)**, and **Minimum purchase price (AUD, including fees)**. The latter remains A$5 by default. Users can change these numeric AUD values directly—no WETH math or USD dropdown. Once saved, AUD caps remain denominated in AUD; on each scan they are translated into WETH via a fresh verified quote for the existing transaction safeguards. Existing saved WETH safety limits are *not overwritten* and continue to apply until the user saves their new AUD limits. Original maximum caps of **2 WETH per purchase** and **5 WETH daily** remain absolute ceilings.

A missing or older-than-15-minute quote **blocks all purchase signals and autobuying**; prices are shown as unavailable rather than invented. Changing AUD limits disarms the live buyer, and the AUD minimum is independently rechecked when Immutable supplies fresh order/settlement details. Confirmed purchase records save the approximate AUD cost at buying time so the AUD daily budget is not retrospectively altered by exchange-rate fluctuations; older WETH-only trade records use the current spot conversion when available. Previous USD-minimum settings are migrated to an equivalent AUD amount on the first fresh price quote, rounded upwards to avoid weakening protection.

All stored historical orders, metadata, wallet preferences, and purchase records are kept in their original formats. Only the customer-facing units and new optional AUD budget fields change. When a conversion quote is unavailable, AUD CSV prices are blank and the export carries no fabricated fiat values. Dollar estimates exclude gas, slippage, price changes and other unobserved costs.

## v2.0.13: scanner price-range visibility and empty-state clarity

The market table defaults to **Within my price range**, displaying real NFT listings whose AUD asking prices meet the saved minimum and whose fee-inclusive AUD total meets both the saved A$ minimum purchase cost and maximum spend per NFT. Other available views are **Candidates only** (requires all sales, discount and safety gates) and **All listings** (shows every downloaded offer). The price-range view is a **visibility filter**, not a relaxation of buying rules. Changing the selection resets the highlighted NFT to a row in that view. If no rows match, the app explains whether there are zero qualified candidates, zero offers within the AUD range, an unavailable exchange-rate quote, or genuinely zero live Immutable listings. A zero-candidate view no longer falsely says the API returned no live listings.
