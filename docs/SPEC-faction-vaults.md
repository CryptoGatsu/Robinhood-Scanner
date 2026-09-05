# Faction Vaults — Product and Protocol Specification

Working title. Version 0.1, 5 September 2026. Target chain: Robinhood Chain mainnet (chain id 4663).

## 1. Summary

Faction Vaults is a prediction-paired coin protocol. Each series has a small set of permanent faction coins (for example $BULL and $BEAR). Every round, the factions face each other on a question that settles from data (for example: did BTC close the week up or down). Users join a faction by minting its coin at $1 USDG. The coins are always fully collateralized. At resolution, the round's pot streams to the winning faction's holders, weighted by how much and how long they held. Nobody loses principal. The pot is made of mint fees, early-exit penalties and the yield the pooled collateral earns in Morpho while it sits in the vault.

The coins are never worth less than $1 and never more than $1. What changes is which coin earned this week, each faction's record, and the standings across the season. The product is the scoreboard, not the chart.

Launch scope is crypto prices, on-chain metrics and macro events. Sports and single-stock outcomes are explicitly out of scope for v1.

## 2. Goals and non-goals

Goals

- Ship the first prediction-paired coin protocol on Robinhood Chain.
- Every round settles from a source we do not control, preferring fully on-chain data.
- No user can lose principal in v1. The only money at risk is a round's fees and yield.
- Every phase transition is permissionless and time-based. No admin key can decide an outcome or block a redemption after resolution.
- Contracts are small enough to audit in one pass.

Non-goals for v1

- Sports markets of any kind.
- Outcome markets on single stocks or stock tokens, even where a Chainlink feed exists. These are security-based swaps and are out of scope until counsel says otherwise.
- Bonding curves, graduation, or fixed-supply memecoins.
- User-created series. All v1 series and factions are platform-issued.
- A parimutuel tier where losers forfeit principal. Designed for, not shipped.

## 3. Glossary

| Term | Meaning |
|---|---|
| Series | A recurring question with a fixed set of factions, a resolver and a schedule. Example: BTC weekly close. |
| Faction | A permanent ERC-20 in a series. Example: $BULL. |
| Round | One instance of the series question, with a start, a resolution time and a pot. |
| Vault | The contract holding a faction's USDG collateral. One per faction. |
| Pot | The USDG paid to the winning faction's holders for a round. |
| Resolver | The contract that reports a round's outcome. |
| TWAB | Time-weighted average balance. A holder's balance integrated over the round window. |
| Phase | The state a faction is in for the current round: Dormant, Listed, Locked, Frozen, Settling. |

## 4. How a round works

1. The round opens. The series' factions enter Listed. Anyone can mint a faction coin for $1 USDG plus a 1% fee, and anyone can redeem at $1 with no fee.
2. Late in the round the factions enter Locked. Minting stays open at $1. Free redemption closes. Holders who want out use the early-exit path and pay a penalty that rises as resolution approaches.
3. Shortly before resolution the factions enter Frozen. No mints, redemptions, exits or transfers.
4. At resolution time the resolver reports the outcome. The controller computes the pot and opens a stream to the winning faction's holders.
5. The pot streams over seven days. A holder's share is their TWAB over the round divided by the winning faction's total TWAB. Holders who reduce their balance during the stream forfeit the unstreamed portion of what they reduced.
6. Both factions return to $1 mint and redeem. For weekly series the next round opens immediately. For irregular series the factions sit Dormant, still earning yield, until the next round is listed.

Because minting is always open at $1 during Listed and Locked, the coin can never trade above $1. Because redemption at $1 is open during Listed and Dormant, it can never trade below $1 outside a Locked window. The peg is enforced by arbitrage against the vault, not by a market maker.

## 5. Launch series

Four series at launch. Two settle fully on-chain and ship first. Two need an optimistic resolver and ship in the second release.

### 5.1 BTC weekly close: $BULL vs $BEAR

- Question: is the Chainlink BTC/USD price at Monday 00:00 UTC higher than it was the previous Monday 00:00 UTC.
- Resolver: ChainlinkUpDownResolver. Reference price is the first feed round with `updatedAt >= T_open`. Settlement price is the first feed round with `updatedAt >= T_resolve`. If no such round appears within 6 hours of `T_resolve`, the round is void.
- Tie: settlement price equals reference price at feed precision. Pot rolls into the next round.
- Cadence: weekly, 52 rounds a year.

### 5.2 Maxi wars: one faction per major asset

- Factions: $BTCMAXI, $ETHMAXI, $SOLMAXI at launch. Add factions only where a Chainlink feed exists on Robinhood Chain.
- Question: which asset had the highest percentage change between `T_open` and `T_resolve`.
- Resolver: ChainlinkRankResolver. Same reference and settlement rules as 5.1, applied per asset. Any asset whose feed is missing a valid settlement round voids the whole round.
- Payout: rank split 60/25/15 for three factions. Winner-take-all is a series-level option.
- Cadence: weekly.

### 5.3 Launchpad wars: one faction per Robinhood Chain launchpad

- Factions: one per launchpad with a measurable on-chain fee flow. Candidates at time of writing: Pons, Pools.trade, PAIR, Hook Labs. Faction names are fan names, not the launchpads' marks.
- Question: which launchpad collected the most protocol fees in USDG-equivalent terms between `T_open` and `T_resolve`.
- Resolver: OnchainMetricResolver where a launchpad exposes a cumulative fee counter or a stable fee-recipient address that can be snapshotted at `T_open` and `T_resolve`. Where it does not, the series falls back to the OptimisticResolver. Decide per launchpad during Phase 0.
- Payout: winner-take-all.
- Cadence: weekly.

### 5.4 Macro factions

- Fed decision: $CUT vs $HOLD vs $HIKE, one round per FOMC meeting, eight a year.
- CPI print: $HOT vs $COLD, monthly. Hot means headline CPI year-over-year above the consensus figure fixed at listing.
- Resolver: OptimisticResolver for both.
- Payout: winner-take-all.
- Cadence: irregular. Factions are Dormant between rounds and their yield accrues to the next pot, so a Fed round opens with six weeks of yield already in it.

## 6. Economics

### 6.1 Collateral and peg

Every faction coin is backed 1:1 by USDG held by its vault. Supply is elastic. Mint creates coins and deposits USDG. Redeem and early exit burn coins and withdraw USDG. There is no other way to create or destroy coins.

### 6.2 Yield

Each vault deposits collateral into an ERC-4626 Morpho USDG vault on Robinhood Chain and keeps a liquidity buffer of 15% of collateral idle for redemptions. When the buffer is below 10% the vault withdraws from Morpho to refill to 15%. When it is above 20% the vault deposits the excess.

Yield earned by a faction's collateral during a round is attributed to that round's pot. Yield earned while Dormant is attributed to the faction's next round.

If a Morpho withdrawal reverts or returns less than requested, redemptions are served from the buffer until it is exhausted and then queue. The queue is served first-in first-out as liquidity returns. The controller cannot resolve a round while any vault in the series has a non-empty queue.

### 6.3 Fees and penalties

| Item | Amount | Destination |
|---|---|---|
| Mint fee | 1% of USDG minted, in Listed and Locked | Round pot |
| Redemption fee | 0 | n/a |
| Early exit penalty | Linear from 10% at Locked start to 40% at Frozen start | 70% round pot, 30% platform |
| Platform share of pot | 20% of the pot at resolution | Platform treasury |
| Series listing fee | 0 in v1 (all series platform-issued) | n/a |

### 6.4 Pot composition and payout

For round r with factions F:

pot(r) = sum over F of mint fees during r + sum over F of yield attributed to r + 70% of exit penalties during r + rollover from any prior tied or void round

winners' pool = 80% of pot(r). platform = 20% of pot(r).

A winning holder's claimable amount = winners' pool × holder TWAB / winning faction total TWAB.

TWAB is measured from `T_open` to `T_resolve` and counts only balances held in ordinary addresses. Balances held by the vault, the distributor, the platform treasury and any address on the exclusion list are excluded.

For rank-split series the winners' pool is divided across ranks by the configured split and each rank is paid on the same TWAB basis within that faction.

### 6.5 Stream and forfeiture

The winners' pool streams linearly over 7 days from resolution. A holder's accrual is scaled by min(current balance, balance at resolution) / balance at resolution, evaluated at each claim. The unstreamed portion attributable to any reduction is forfeited and added to the next round's pot. Claims are pull-based and can be made at any time, including after the stream ends.

### 6.6 What the numbers look like

Illustrative BTC weekly round. All inputs are assumptions and should be replaced with live data as soon as it exists.

| Input | Value |
|---|---|
| $BULL collateral | $900,000 |
| $BEAR collateral | $400,000 |
| New mints during the round | $520,000 (40% of collateral) |
| Mint fees | $5,200 |
| Morpho yield, one week at 6% APY on $1.3M | $1,500 |
| Early exits | $30,000 at an average 20% penalty |
| Penalties to pot (70%) | $4,200 |
| Pot | $10,900 |
| Platform (20%) | $2,180 |
| Winners' pool | $8,720 |
| Return if $BEAR wins | 2.2% on $400k for the week |
| Return if $BULL wins | 1.0% on $900k for the week |

These are yield-scale returns with variance, not memecoin returns. The excitement is in the standings, the underdog premium and the multi-way rounds, and platform revenue scales with total collateral and churn. A stakes tier where losers forfeit principal would change this profile and is deferred to Phase 3 pending legal review.

## 7. Round lifecycle

### 7.1 Phases for a weekly series (UTC)

| Phase | Window | Mint | Redeem | Early exit | Transfer |
|---|---|---|---|---|---|
| Listed | Mon 00:00 to Sat 00:00 | Yes, 1% fee | Yes, at $1 | n/a | Yes |
| Locked | Sat 00:00 to Sun 12:00 | Yes, 1% fee | No | Yes, with penalty | No |
| Frozen | Sun 12:00 to Mon 00:00 | No | No | No | No |
| Settling | Mon 00:00 to next Mon 00:00 | (as next round) | (as next round) | (as next round) | (as next round) |
| Dormant | Between rounds, irregular series only | Yes, no fee | Yes, at $1 | n/a | Yes |

Settling overlaps with the next round's Listed phase. Each round has its own pot and stream, so overlapping rounds never share state.

Transfers are disabled in Locked and Frozen so that an over-the-counter transfer cannot be used to exit without the penalty.

### 7.2 Phase transitions

Transitions are functions of block timestamp against the round's schedule. Anyone can call `advance(seriesId)`. A keeper calls it on schedule as a convenience and is refunded gas from the platform share. No phase can be skipped or reversed by any role.

### 7.3 Resolution

At or after `T_resolve`, anyone can call `resolve(seriesId, roundId)`. The controller calls the series' resolver. The resolver returns one of: `Winner(factionIndex)`, `Ranked(factionIndices[])`, `Tie(factionIndices[])`, `Void`, or `NotReady`.

- Winner or Ranked: compute pot, open streams, set factions to the next round's Listed or to Dormant.
- Tie: pot rolls to the next round. No stream.
- Void: pot rolls to the next round. Penalties already collected roll with it. No stream.
- NotReady: no state change. Callable again later. If `NotReady` persists past `T_resolve + voidAfter`, anyone can call `voidRound`.

## 8. Contract architecture

Five contract types. Token and Vault are non-upgradeable. Controller, Resolvers and Distributor are deployed behind a 48-hour timelock for parameter changes and are replaced, not upgraded in place.

### 8.1 FactionToken

ERC-20 with permit. Mint and burn callable only by its vault. Maintains per-account TWAB checkpoints (cumulative balance-seconds with a timestamp, PoolTogether style) and a total-supply TWAB. Transfer hook reads the faction's current phase from the controller and reverts in Locked and Frozen. Exposes `twabBetween(account, from, to)` and `totalTwabBetween(from, to)`.

```solidity
interface IFactionToken {
    function mint(address to, uint256 amount) external;      // vault only
    function burn(address from, uint256 amount) external;    // vault only
    function twabBetween(address a, uint64 from, uint64 to) external view returns (uint256);
    function totalTwabBetween(uint64 from, uint64 to) external view returns (uint256);
}
```

### 8.2 FactionVault

One per faction. Holds USDG, talks to the yield adapter, enforces phase rules on mint, redeem and exit.

```solidity
interface IFactionVault {
    function mint(uint256 usdgIn, address to) external returns (uint256 minted);
    function redeem(uint256 amount, address to) external returns (uint256 usdgOut);
    function exitEarly(uint256 amount, address to) external returns (uint256 usdgOut, uint256 penalty);
    function collateral() external view returns (uint256 total, uint256 buffer, uint256 inYield);
    function accrueYield() external returns (uint256 yieldSinceLast);   // controller calls at phase edges
    function pullFees(address to, uint256 amount) external;              // controller only
    function queueLength() external view returns (uint256);
}
```

Mint: transfer USDG in, mint coins 1:1 against the principal, and take the 1% fee on top into `feeAccumulator`, so $100 USDG plus $1 fee mints 100 coins. The fee is a surcharge, not a haircut, so the peg stays exactly 1:1.

Redeem: allowed in Listed and Dormant. Burn coins, pay USDG 1:1 from buffer, pulling from yield if needed.

ExitEarly: allowed in Locked only. Burn coins, compute penalty from the linear schedule, pay the remainder, split penalty 70/30 between `feeAccumulator` and platform.

### 8.3 SeriesController

Owns series and round definitions, drives phases, calls resolvers, computes pots, opens streams.

```solidity
struct Series {
    address[] factions;          // FactionToken addresses
    address[] vaults;
    address resolver;
    PayoutMode payoutMode;       // WinnerTakeAll | RankSplit
    uint16[] rankSplitBps;       // e.g. [6000, 2500, 1500]
    Schedule schedule;           // weekly or explicit list of (T_open, T_lock, T_freeze, T_resolve)
    uint64 voidAfter;            // seconds after T_resolve before voidRound is allowed
}

struct Round {
    uint64 tOpen; uint64 tLock; uint64 tFreeze; uint64 tResolve;
    uint256 rollover;
    RoundState state;            // Open, Locked, Frozen, Resolved, Void
    Outcome outcome;
}

interface ISeriesController {
    function advance(uint256 seriesId) external;
    function resolve(uint256 seriesId, uint256 roundId) external;
    function voidRound(uint256 seriesId, uint256 roundId) external;
    function phaseOf(address faction) external view returns (Phase);
    function currentRound(uint256 seriesId) external view returns (uint256 roundId, Round memory);
}
```

At `resolve`: call `accrueYield` on every vault, sum fee accumulators and attributed yield, add rollover, take 20% to treasury, and call `PotDistributor.open(roundId, winners, amounts, tOpen, tResolve)`.

### 8.4 Resolvers

```solidity
enum OutcomeKind { NotReady, Winner, Ranked, Tie, Void }
struct Outcome { OutcomeKind kind; uint8[] factions; }

interface IResolver {
    function resolve(uint256 seriesId, uint256 roundId, uint64 tOpen, uint64 tResolve)
        external returns (Outcome memory);
}
```

ChainlinkUpDownResolver: two feeds or one feed, reads `getRoundData` walking forward from the stored reference round id to find the first round at or after each timestamp. Stores the reference round id at `T_open` when `advance` first runs, so the settlement lookup at `T_resolve` is bounded.

ChainlinkRankResolver: per-asset percentage change with the same lookup, sorts factions descending. Any missing settlement round returns `Void`.

OnchainMetricResolver: per faction, an adapter contract with `snapshot() returns (uint256)`. Snapshots taken at `T_open` and `T_resolve` by `advance`. Outcome is the argmax of the deltas.

OptimisticResolver: after `T_resolve`, anyone posts an outcome with a bond (500 USDG). A 24-hour challenge window follows. An unchallenged outcome is final. A challenged outcome goes to a 3-of-5 council with a further 48 hours. Wrong proposers lose the bond to the challenger. This is a trust assumption and is documented as such. If UMA's Optimistic Oracle V3 is deployed on Robinhood Chain by Phase 2, use it instead.

### 8.5 PotDistributor

```solidity
interface IPotDistributor {
    function open(uint256 roundId, address[] calldata factions, uint256[] calldata pools, uint64 tOpen, uint64 tResolve) external; // controller only
    function claimable(uint256 roundId, address account) external view returns (uint256);
    function claim(uint256 roundId, address to) external returns (uint256 paid);
    function forfeited(uint256 roundId) external view returns (uint256);   // swept into next round by controller
}
```

Claimable = pool × twab(account) / totalTwab × min(1, elapsed / 7 days) × min(1, balanceNow / balanceAtResolve) − alreadyClaimed. The forfeited remainder is computed at stream end and swept by the controller into the next round's rollover.

### 8.6 Roles and admin

| Role | Powers | Holder |
|---|---|---|
| Timelock (48h) | Change fee parameters within hard bounds, add or retire series, replace resolver for a series with no open round, set exclusion list | Multisig behind timelock |
| Guardian | Pause minting for a series. Cannot pause redemption, exit, resolve or claim. | 2-of-3 multisig, no timelock |
| Keeper | None beyond what anyone can call. | Bot |

Hard bounds: mint fee 0 to 2%, platform share 0 to 25%, exit penalty start 0 to 20% and end 20 to 50%, stream 3 to 14 days. Nothing outside these bounds is settable by any role.

## 9. Off-chain system

- Indexer: subscribes to controller, vault, token and distributor events, writes rounds, positions, standings and claims to a database. This repository's Blockscout and RPC layer in `lib/chain.js` is the starting point.
- API: round state, implied payout per faction at the current moment, wallet positions and claims, series standings. Vercel functions in the same style as the existing `api/` directory.
- Keeper: cron that calls `advance` and `resolve` on schedule, with alerts if a transition is more than 10 minutes late.
- Frontend: series standings page sorted by holder return, round page with a live implied-return figure per faction, wallet page with positions, streams and claims. Every mint screen shows the current implied return for that faction if it wins, computed from the live pot and TWAB.
- Notifications: round open, lock, freeze, result and stream milestones via the existing Telegram webhook in `api/tg/webhook.js`.
- Geofence: IP blocking plus a signed terms attestation at first mint, with the country list set by counsel. At minimum US, UK, Canada and Switzerland at launch, matching the Stock Token restrictions on the same chain. Wallet screening against a sanctions list before serving the mint screen.

## 10. Security and risk

- Escrow concentration. The vaults hold all collateral. Token and Vault are non-upgradeable, have no admin withdraw path, and are audited before mainnet. Guardian can stop new deposits but cannot touch existing ones.
- Yield venue risk. Morpho vault curator risk and withdrawal liquidity risk are real. The 15% buffer, the redemption queue and the rule that rounds cannot resolve with a non-empty queue contain it. Vault selection is a timelock parameter with a 7-day notice.
- Oracle. Chainlink feeds on Robinhood Chain are the single point of truth for on-chain series. Staleness and void rules are defined above. No feed is read at an arbitrary block; the resolver always finds the first round at or after the target timestamp.
- Optimistic resolver. The bond and council are a trust assumption. Keep macro pots small until UMA or an equivalent is available on the chain, or cap macro series collateral.
- TWAB gaming. Splitting across wallets gains nothing because payout is pro rata. Late minting is discouraged by TWAB weight rather than by rules. Flash-mint around `T_open` is impossible because TWAB is integrated over time.
- Exit timing. The penalty schedule handles information-driven exits during Locked. Frozen exists because the last twelve hours of a price market are where the outcome is most knowable.
- Phase timing and MEV. Transitions are timestamp-based and permissionless, so there is nothing to front-run except the `resolve` call, which has no economic consequence for the caller.
- Rounding. All pot math in USDG base units with TWAB in token-seconds. Dust remains in the distributor and is swept with forfeits.
- Reentrancy. All external token transfers after state updates. Vault and distributor are non-reentrant.

## 11. Legal and compliance posture

- No-loss structure. Principal is always redeemable at $1. The only amount at stake is fees and yield, which is the structure that survived litigation for prize-linked savings products. This is a defensible posture, not a safe harbour, and a written opinion is a launch requirement.
- Event contracts. A pot paid on a crypto price or macro outcome is still an event contract. Geofence and terms as above. No single-stock or stock-token outcomes.
- Sanctions. Robinhood Chain's sequencer screens sanctioned addresses. The frontend screens independently.
- Names. All faction names are generic or fan names. No trademarks of launchpads, exchanges or leagues.

## 12. Parameters

| Parameter | Default | Bounds |
|---|---|---|
| Mint fee | 1.0% | 0 to 2% |
| Platform share of pot | 20% | 0 to 25% |
| Exit penalty at Locked start | 10% | 0 to 20% |
| Exit penalty at Frozen start | 40% | 20 to 50% |
| Penalty split to pot | 70% | fixed |
| Stream length | 7 days | 3 to 14 days |
| Liquidity buffer target | 15% | 10 to 30% |
| Void window after T_resolve | 6h (Chainlink), 72h (optimistic) | per resolver |
| Optimistic bond | 500 USDG | 100 to 5,000 |
| Optimistic challenge window | 24h | 12 to 72h |
| Weekly schedule | Open Mon 00:00, Lock Sat 00:00, Freeze Sun 12:00, Resolve Mon 00:00 UTC | per series |

## 13. Delivery plan

Phase 0, contracts and testnet, weeks 1 to 6

- Token, Vault, Controller, Distributor, ChainlinkUpDownResolver, Morpho adapter.
- Foundry test suite with fuzzing on phase transitions, TWAB accounting and stream forfeiture.
- Deploy $BULL/$BEAR on Robinhood Chain testnet with a mock feed and a real weekly schedule. Run at least four rounds.
- Decide per launchpad whether an on-chain metric adapter is feasible.

Phase 1, audit and mainnet

- External audit of Token, Vault, Controller, Distributor and the Chainlink resolvers.
- Mainnet launch: BTC weekly and Maxi wars. Launchpad wars if every faction has a clean on-chain adapter, otherwise it moves to Phase 2.
- Collateral cap per series for the first eight weeks.

Phase 2

- OptimisticResolver, macro factions, Launchpad wars with optimistic fallback.
- Uniswap v4 secondary pool per faction with a hook that only permits swaps in Listed and Locked, applies the exit penalty as a dynamic sell fee routed to the pot, and rejects prices above $1. This gives factions a chart between $0 and $1 during rounds without changing the peg.

Phase 3

- Community-created series with a creator share of the pot.
- Stakes tier where losers forfeit principal, if and only if counsel clears it.
- Sports, with city names rather than team marks, once an on-chain sports resolver exists on the chain.

## 14. Verify before build

These are facts the design depends on that were not confirmed at the time of writing.

- The list of Chainlink Data Feeds live on Robinhood Chain mainnet, specifically BTC/USD, ETH/USD and SOL/USD, with their heartbeat and deviation settings.
- The address and terms of the Morpho USDG vault used by Robinhood Earn, its withdrawal liquidity profile, and whether third-party contracts can deposit.
- The USDG token address on chain 4663 and any transfer restrictions.
- Whether UMA Optimistic Oracle V3 or an equivalent is deployed on Robinhood Chain.
- Uniswap v4 PoolManager and hook deployment details on chain 4663, for Phase 2.
- Whether each candidate launchpad exposes a cumulative fee counter or stable fee recipient that can be snapshotted on-chain.
- The name and faucet of the current Robinhood Chain testnet.
- Gas cost of TWAB checkpointing per transfer on the chain, to size the fee model.
