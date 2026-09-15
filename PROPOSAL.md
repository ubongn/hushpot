# HushPot — Product Proposal

**Idea Category:** Private Payroll / Splits

## Problem

In communities across West Africa (and globally), group savings circles — known as esusu, ajo, tandan, or chit funds — are a daily financial reality. Members pool fixed contributions each cycle; one member takes the pot each round until everyone has received once.

The problem: **everyone can see everyone else's contribution amount.** In a traditional cash circle this is tolerable because the group is small and trusted. On-chain, it is a dealbreaker. Publishing pledge amounts on a public ledger exposes members to social pressure, targeted scams, and financial profiling. A teacher contributing 5,000 NGN alongside a business owner contributing 50,000 NGN faces awkward optics — even though both meet the agreed minimum. The information asymmetry discourages participation from the people who need these tools most.

Existing DeFi "split" and payroll tools (Sablier, Superfluid, Gnosis Payroll) expose every payment amount on-chain. There is no way to prove you paid your share without showing the number.

## Solution

HushPot is a **privacy-preserving group savings pool** on Midnight. A host opens a pot with a fixed number of seats and a minimum pledge threshold. Members join by committing a salted hash of their pledge amount — the actual number never crosses the chain boundary. Before claiming, each member proves via a zero-knowledge circuit (`provePledgeAtLeast`) that their pledge meets the minimum, without revealing the amount.

**What stays public:** pot open/closed state, seat count, that a commitment joined, that a proof was verified, pot-level totals at settlement.

**What stays private:** every member's actual pledge amount, wallet balances, member identities (only anchors are stored, never addresses).

The result: a savings circle where participation is verifiable but amounts are confidential. The host can enforce minimums. Members can prove compliance. No one — not other members, not an on-chain observer, not the host — learns what anyone else put in.

## Technical Approach

- **Smart contract:** Compact language on Midnight Preprod. Five circuits: `join`, `pledge`, `provePledgeAtLeast`, `closeEntries`, `claim`. The ZK circuit (`provePledgeAtLeast`) is the core privacy primitive — it proves a committed value ≥ a threshold without disclosing the value.
- **Frontend:** React 18 + Vite, deployed on Vercel. Connects to Midnight via the dapp-connector API (Lace / 1AM wallet). ZK proofs run entirely in-browser using the `@midnight-ntwrk/zkir-v2` WASM prover — no server-side proving, no trusted third party.
- **Private state:** Each member's pledge amount and secret key exist only in their browser's private state provider. They are never transmitted to any server or written to the chain.
- **Proof server:** Midnight's canonical proof server (Docker, port 6300) handles transaction finalization; the heavy ZK computation happens client-side.

## Differentiation

HushPot is not a generic payment splitter. It is purpose-built for **community savings circles** where the social dynamics of money make privacy a requirement, not a feature. The esusu/ajo framing matters: these are trust-based, recurring, community-anchored financial instruments used by hundreds of millions of people. Existing DeFi tooling ignores this use case entirely, and existing privacy solutions (Tornado Cash, Aztec) focus on individual transactions, not group coordination with verifiable compliance.

The `provePledgeAtLeast` circuit is the key innovation: it lets a group enforce a collective rule (minimum contribution) without any member exposing their private financial situation. This pattern — **verifiable compliance without disclosure** — extends beyond savings circles to payroll, grant disbursements, cooperative dues, and any scenario where "did you pay your share?" must be answerable without "how much do you have?" being exposed.
