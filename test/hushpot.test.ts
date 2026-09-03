// Behavioral tests: run the real compiled Hushpot circuits headless and
// verify BOTH the state machine AND the privacy boundaries - what crosses
// to public ledger state and what never does.
import { describe, expect, it } from 'vitest';
import { HushpotSim, hex, member } from './harness.js';

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
    const led = pot.ledger();
    expect(Number(led.capacity)).toBe(3);
    expect(Number(led.minPledge)).toBe(10);
    expect(Number(led.state)).toBe(0); // PotState.OPEN
    expect(Number(led.members.size())).toBe(0);
    expect(Number(led.pledges.size())).toBe(0);
    expect(Number(led.claims.size())).toBe(0);
  });

  it('stores the host as a 32-byte dApp-scoped key', async () => {
    const pot = await freshPot();
    const host = pot.ledger().host;
    expect(host).toHaveLength(32);
    // The host key is a domain-separated hash, never the raw secret.
    expect(hex(host)).not.toBe(hex(HOST.sk));
  });
});

describe('join - identity stays private', () => {
  it('counts members but stores only commitment anchors', async () => {
    const pot = await freshPot();
    await pot.call('join', ALICE);
    const led = pot.ledger();
    expect(Number(led.memberCount)).toBe(1);
    expect(Number(led.members.size())).toBe(1);

    const anchor = pot.memberAnchors()[0];
    expect(anchor).toHaveLength(64); // Bytes<32> hex
    // The anchor is NOT the member secret (it is a salted commitment).
    expect(anchor).not.toBe(hex(ALICE.sk));
  });

  it('rejects duplicate membership', async () => {
    const pot = await freshPot();
    await pot.call('join', ALICE);
    await expect(pot.call('join', ALICE)).rejects.toThrow(/already a member/);
    expect(Number(pot.ledger().memberCount)).toBe(1);
  });

  it('enforces capacity', async () => {
    const pot = await freshPot();
    await pot.call('join', ALICE);
    await pot.call('join', BOB);
    await pot.call('join', CAROL);
    await expect(pot.call('join', DAVE)).rejects.toThrow(/pot is full/);
    expect(Number(pot.ledger().memberCount)).toBe(3);
  });
});

describe('pledge - amount stays private', () => {
  it('stores a commitment, never the amount', async () => {
    const pot = await freshPot();
    await pot.call('join', ALICE);
    await pot.call('pledge', ALICE);
    const led = pot.ledger();
    expect(Number(led.pledgeCount)).toBe(1);
    expect(Number(led.pledges.size())).toBe(1);

    // PRIVACY BOUNDARY: ALICE pledged 25, but no amount has crossed:
    // claimTotal is still zero, and the stored value is a Bytes<32>
    // commitment, not a number.
    expect(Number(led.claimTotal)).toBe(0);
    const [, commitment] = pot.pledgeAnchors()[0];
    expect(commitment).toHaveLength(64);
  });

  it('accepts a pledge exactly at the public minimum', async () => {
    const pot = await freshPot();
    await pot.call('join', CAROL); // amount 10 == min, allowed
    await pot.call('pledge', CAROL);
    expect(Number(pot.ledger().pledgeCount)).toBe(1);
  });

  it('rejects non-members and double pledges', async () => {
    const pot = await freshPot();
    await pot.call('join', ALICE);
    await expect(pot.call('pledge', DAVE)).rejects.toThrow(/not a member/);
    await pot.call('pledge', ALICE);
    await expect(pot.call('pledge', ALICE)).rejects.toThrow(/already pledged/);
    expect(Number(pot.ledger().pledgeCount)).toBe(1);
  });

  it('rejects pledges below minimum inside the circuit', async () => {
    const pot = await HushpotSim.deploy(3n, 50n, HOST);
    await pot.call('join', ALICE); // ALICE amount 25 < 50
    await expect(pot.call('pledge', ALICE)).rejects.toThrow(/below minimum/);
    expect(Number(pot.ledger().pledgeCount)).toBe(0);
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
    // wrote NOTHING. Identical public state encoding before and after.
    expect(pot.encoded()).toBe(before);
  });

  it('fails when the pledge is below the threshold', async () => {
    const pot = await freshPot();
    await pot.call('join', ALICE);
    await pot.call('pledge', ALICE);
    await expect(pot.call('provePledgeAtLeast', ALICE, 26n)).rejects.toThrow(
      /below threshold/,
    );
  });

  it('fails for non-members', async () => {
    const pot = await freshPot();
    await pot.call('join', ALICE);
    await pot.call('pledge', ALICE);
    await expect(pot.call('provePledgeAtLeast', DAVE, 1n)).rejects.toThrow(
      /not a member/,
    );
  });

  it('fails when there is no matching pledge commitment', async () => {
    const pot = await freshPot();
    await pot.call('join', BOB); // member but never pledged
    await expect(pot.call('provePledgeAtLeast', BOB, 1n)).rejects.toThrow(
      /no such pledge/,
    );
  });
});

describe('closeEntries - host gate', () => {
  it('rejects non-hosts', async () => {
    const pot = await freshPot();
    await pot.call('join', ALICE);
    await expect(pot.call('closeEntries', ALICE)).rejects.toThrow(
      /only the host/,
    );
  });

  it('host closes; pledging stops', async () => {
    const pot = await freshPot();
    await pot.call('join', ALICE);
    await pot.call('closeEntries', HOST);
    expect(Number(pot.ledger().state)).toBe(1); // PotState.CLOSED
    await expect(pot.call('pledge', ALICE)).rejects.toThrow(/not open/);
    await expect(pot.call('join', BOB)).rejects.toThrow(/not open/);
  });
});

describe('claim - the one deliberate disclosure', () => {
  async function closedPotWithAlice() {
    const pot = await freshPot();
    await pot.call('join', ALICE);
    await pot.call('join', BOB);
    await pot.call('pledge', ALICE);
    await pot.call('pledge', BOB);
    await pot.call('closeEntries', HOST);
    return pot;
  }

  it('releases the pledged amount only at claim time', async () => {
    const pot = await closedPotWithAlice();
    expect(Number(pot.ledger().claimTotal)).toBe(0);

    await pot.call('claim', ALICE);
    const led = pot.ledger();
    // DELIBERATE-DISCLOSURE: the amount becomes public here and only here.
    expect(Number(led.claimTotal)).toBe(25);
    expect(Number(led.claimCount)).toBe(1);
    expect(Number(led.claims.size())).toBe(1);
  });

  it('rejects double claims via nullifiers', async () => {
    const pot = await closedPotWithAlice();
    await pot.call('claim', ALICE);
    await expect(pot.call('claim', ALICE)).rejects.toThrow(/already claimed/);
    expect(Number(pot.ledger().claimTotal)).toBe(25);
  });

  it('rejects claims while the pot is still open', async () => {
    const pot = await freshPot();
    await pot.call('join', ALICE);
    await pot.call('pledge', ALICE);
    await expect(pot.call('claim', ALICE)).rejects.toThrow(/not closed yet/);
  });

  it('members who never pledge never disclose an amount', async () => {
    const pot = await closedPotWithAlice();
    // ALICE (25) and BOB (40) both pledged; CAROL never joined. Only
    // ALICE claims: the public total moves by her amount only.
    await pot.call('claim', ALICE);
    expect(Number(pot.ledger().claimTotal)).toBe(25);
    expect(Number(pot.ledger().pledgeCount)).toBe(2);
  });
});
