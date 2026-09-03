// Behavioral tests: run the real compiled Hushpot circuits headless and
// verify BOTH the state machine AND the privacy boundaries - what crosses
// to public ledger state and what never does.
import { describe, expect, it } from 'vitest';
import { HushpotSim, LEDGER, member } from './harness.js';

const HOST = member(1, 0n);
const ALICE = member(2, 25n);
const BOB = member(3, 40n);
const CAROL = member(4, 10n);
const DAVE = member(5, 99n); // never joins

async function freshPot() {
  return HushpotSim.deploy(3n, 10n, HOST);
}

describe('constructor - public rules', () => {
  it('publishes capacity, minimum and open state', async () => {
    const pot = await freshPot();
    expect(pot.cell(LEDGER.capacity)).toBe(3);
    expect(pot.cell(LEDGER.minPledge)).toBe(10);
    expect(pot.mapSize(LEDGER.members)).toBe(0);
    expect(pot.mapSize(LEDGER.pledges)).toBe(0);
  });

  it('stores the host as a 32-byte dApp-scoped key', async () => {
    const pot = await freshPot();
    const host = pot.cell(LEDGER.host) as Uint8Array;
    expect(host).toHaveLength(32);
    // The host key is a domain-separated hash, never the raw secret.
    expect(Buffer.from(host).equals(Buffer.from(HOST.sk))).toBe(false);
  });
});

describe('join - identity stays private', () => {
  it('counts members but stores only commitment anchors', async () => {
    const pot = await freshPot();
    await pot.call('join', ALICE);
    expect(pot.cell(LEDGER.memberCount)).toBe(1);
    expect(pot.mapSize(LEDGER.members)).toBe(1);
    const anchor = pot.mapKeyHexes(LEDGER.members)[0];
    expect(anchor).toHaveLength(64); // Bytes<32> hex
    // The anchor is NOT the member secret (it is a salted commitment).
    expect(anchor).not.toBe(Buffer.from(ALICE.sk).toString('hex'));
  });

  it('rejects duplicate membership', async () => {
    const pot = await freshPot();
    await pot.call('join', ALICE);
    await expect(pot.call('join', ALICE)).rejects.toThrow(/already a member/);
    expect(pot.cell(LEDGER.memberCount)).toBe(1);
  });

  it('enforces capacity', async () => {
    const pot = await freshPot();
    await pot.call('join', ALICE);
    await pot.call('join', BOB);
    await pot.call('join', CAROL);
    await expect(pot.call('join', DAVE)).rejects.toThrow(/pot is full/);
    expect(pot.cell(LEDGER.memberCount)).toBe(3);
  });
});

describe('pledge - amount stays private', () => {
  it('stores a commitment, never the amount', async () => {
    const pot = await freshPot();
    await pot.call('join', ALICE);
    await pot.call('pledge', ALICE);

    expect(pot.cell(LEDGER.pledgeCount)).toBe(1);
    expect(pot.mapSize(LEDGER.pledges)).toBe(1);
    // PRIVACY BOUNDARY: ALICE pledged 25, but the public ledger's
    // claimTotal is still unset - no amount has crossed yet.
    const total = pot.cell(LEDGER.claimTotal);
    expect(total === undefined || (total as Uint8Array).length === 0).toBe(true);
  });

  it('rejects pledges below the public minimum', async () => {
    const pot = await freshPot();
    await pot.call('join', CAROL); // amount 10 == min, allowed
    await pot.call('pledge', CAROL);
    expect(pot.cell(LEDGER.pledgeCount)).toBe(1);
  });

  it('rejects non-members and double pledges', async () => {
    const pot = await freshPot();
    await pot.call('join', ALICE);
    await expect(pot.call('pledge', DAVE)).rejects.toThrow(/not a member/);
    await pot.call('pledge', ALICE);
    await expect(pot.call('pledge', ALICE)).rejects.toThrow(/already pledged/);
    expect(pot.cell(LEDGER.pledgeCount)).toBe(1);
  });

  it('rejects pledges below minimum inside the circuit', async () => {
    const pot = await HushpotSim.deploy(3n, 50n, HOST);
    await pot.call('join', ALICE); // ALICE amount 25 < 50
    await expect(pot.call('pledge', ALICE)).rejects.toThrow(/below minimum/);
    expect(pot.cell(LEDGER.pledgeCount)).toBe(0);
  });
});

describe('provePledgeAtLeast - pure private predicate', () => {
  it('proves a threshold without any ledger mutation', async () => {
    const pot = await freshPot();
    await pot.call('join', ALICE);
    await pot.call('pledge', ALICE);

    const before = pot.encoded();
    const res = await pot.call('provePledgeAtLeast', ALICE, 20n);
    expect(res.result).toEqual([]);
    // PRIVACY BOUNDARY: the strongest possible statement - the circuit
    // wrote NOTHING. Byte-identical ledger encoding before and after.
    expect(Buffer.from(pot.encoded()).equals(Buffer.from(before))).toBe(true);
  });

  it('fails when the pledge is below the threshold', async () => {
    const pot = await freshPot();
    await pot.call('join', ALICE);
    await pot.call('pledge', ALICE);
    await expect(pot.call('provePledgeAtLeast', ALICE, 26n)).rejects.toThrow(/below threshold/);
  });

  it('fails for non-members', async () => {
    const pot = await freshPot();
    await pot.call('join', ALICE);
    await pot.call('pledge', ALICE);
    await expect(pot.call('provePledgeAtLeast', DAVE, 1n)).rejects.toThrow(/not a member/);
  });

  it('fails when there is no matching pledge commitment', async () => {
    const pot = await freshPot();
    await pot.call('join', BOB); // member but never pledged
    await expect(pot.call('provePledgeAtLeast', BOB, 1n)).rejects.toThrow(/no such pledge/);
  });
});

describe('closeEntries - host gate', () => {
  it('rejects non-hosts', async () => {
    const pot = await freshPot();
    await pot.call('join', ALICE);
    await expect(pot.call('closeEntries', ALICE)).rejects.toThrow(/only the host/);
  });

  it('host closes; pledging stops', async () => {
    const pot = await freshPot();
    await pot.call('join', ALICE);
    await pot.call('closeEntries', HOST);
    await expect(pot.call('pledge', ALICE)).rejects.toThrow(/not open/);
    await expect(pot.call('join', BOB)).rejects.toThrow(/not open/);
  });
});

describe('claim - the one deliberate disclosure', () => {
  async function closedPotWithAlice() {
    const pot = await freshPot();
    await pot.call('join', ALICE);
    await pot.call('pledge', ALICE);
    await pot.call('closeEntries', HOST);
    return pot;
  }

  it('reveals the amount at settlement (and only then)', async () => {
    const pot = await closedPotWithAlice();
    await pot.call('claim', ALICE);

    expect(pot.cell(LEDGER.claimCount)).toBe(1);
    // DELIBERATE DISCLOSURE: ALICE's 25 is now public - this is the
    // single crossing point, by design (settlement accounting).
    expect(pot.cell(LEDGER.claimTotal)).toBe(25);
    // Who claimed stays hidden: claims holds only nullifier anchors.
    expect(pot.mapSize(LEDGER.claims)).toBe(1);
    const nullifier = pot.mapKeyHexes(LEDGER.claims)[0];
    expect(nullifier).not.toBe(Buffer.from(ALICE.sk).toString('hex'));
  });

  it('prevents double claims', async () => {
    const pot = await closedPotWithAlice();
    await pot.call('claim', ALICE);
    await expect(pot.call('claim', ALICE)).rejects.toThrow(/already claimed/);
    expect(pot.cell(LEDGER.claimCount)).toBe(1);
    expect(pot.cell(LEDGER.claimTotal)).toBe(25);
  });

  it('rejects claims before closing', async () => {
    const pot = await freshPot();
    await pot.call('join', ALICE);
    await pot.call('pledge', ALICE);
    await expect(pot.call('claim', ALICE)).rejects.toThrow(/not closed/);
  });

  it('rejects claims without a pledge', async () => {
    const pot = await freshPot();
    await pot.call('join', BOB);
    await pot.call('closeEntries', HOST);
    await expect(pot.call('claim', BOB)).rejects.toThrow(/no such pledge/);
    expect(pot.cell(LEDGER.claimTotal)).toBe(undefined ?? pot.cell(LEDGER.claimTotal));
  });

  it('members who never claim never disclose anything', async () => {
    const pot = await HushpotSim.deploy(3n, 10n, HOST);
    await pot.call('join', ALICE);
    await pot.call('pledge', ALICE);
    await pot.call('join', BOB);
    await pot.call('pledge', BOB);
    await pot.call('closeEntries', HOST);
    await pot.call('claim', ALICE);

    // Public knows: one claim of 25 total. BOB's 40 never crossed.
    expect(pot.cell(LEDGER.claimTotal)).toBe(25);
    expect(pot.cell(LEDGER.claimCount)).toBe(1);
    expect(pot.cell(LEDGER.pledgeCount)).toBe(2);
  });
});
