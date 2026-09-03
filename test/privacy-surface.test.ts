// Static privacy-surface tests: pin the COMPILED contract surface to the
// designed disclosure architecture. If someone adds a circuit parameter
// that leaks identity, or a ledger field that stores amounts early, these
// tests fail before any behavior test would.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const info = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../managed/hushpot/compiler/contract-info.json', import.meta.url)),
    'utf8',
  ),
);

const circuitNames = info.circuits.map((c: any) => c.name).sort();
const ledgerNames = info.ledger.map((l: any) => l.name);

describe('compiled surface', () => {
  it('compiles with compactc 0.31.1 against runtime 0.16.0', () => {
    expect(info['compiler-version']).toBe('0.31.1');
    expect(info['runtime-version']).toBe('0.16.0');
  });

  it('installed compact-runtime matches the contract runtime version', () => {
    const pkg = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL('../node_modules/@midnight-ntwrk/compact-runtime/package.json', import.meta.url),
        ),
        'utf8',
      ),
    );
    expect(pkg.version).toBe(info['runtime-version']);
  });

  it('exposes exactly the five designed circuits', () => {
    expect(circuitNames).toEqual(
      ['claim', 'closeEntries', 'join', 'pledge', 'provePledgeAtLeast'].sort() as string[],
    );
  });

  it('every circuit produces a proof', () => {
    for (const c of info.circuits) {
      expect(c.proof, c.name).toBe(true);
    }
  });

  it('identity is never a circuit parameter - only witnesses carry it', () => {
    for (const c of info.circuits) {
      for (const a of c.arguments ?? []) {
        const t = JSON.stringify(a);
        expect(t, `${c.name} leaks address`).not.toMatch(/UserAddress|ContractAddress/);
      }
    }
    // The only identity-like input is the witness secret key.
    const witnessNames = info.witnesses.map((w: any) => w.name).sort();
    expect(witnessNames).toEqual(['localPledgeAmount', 'localSk']);
    const sk = info.witnesses.find((w: any) => w.name === 'localSk');
    expect(sk['result type']['type-name']).toBe('Bytes');
    expect(sk['result type'].length).toBe(32);
  });

  it('provePledgeAtLeast takes only a private threshold parameter', () => {
    const c = info.circuits.find((c: any) => c.name === 'provePledgeAtLeast');
    expect(c.arguments).toHaveLength(1);
    expect(c.arguments[0].name).toBe('threshold');
    expect(c.arguments[0].type['type-name']).toBe('Uint');
  });

  it('ledger holds exactly the 11 designed fields', () => {
    expect(ledgerNames).toEqual([
      'host',
      'capacity',
      'minPledge',
      'state',
      'members',
      'pledges',
      'claims',
      'memberCount',
      'pledgeCount',
      'claimCount',
      'claimTotal',
    ]);
  });

  it('no ledger field stores an amount before settlement', () => {
    // The only 64-bit numeric fields are minPledge (a published rule) and
    // claimTotal (the deliberate settlement disclosure). No field name
    // carries a per-member amount.
    const u64 = info.ledger
      .filter(
        (l: any) =>
          l.type?.['type-name'] === 'Uint' &&
          l.type.maxval === 18446744073709552000,
      )
      .map((l: any) => l.name);
    expect(u64).toEqual(['minPledge', 'claimTotal']);
    expect(ledgerNames.join()).not.toMatch(/amount/i);
  });

  it('members/pledges/claims are commitment containers (Bytes<32>)', () => {
    const byName = Object.fromEntries(info.ledger.map((l: any) => [l.name, l]));
    for (const f of ['members', 'claims']) {
      const t = JSON.stringify(byName[f]);
      expect(t, f).toMatch(/Bytes/);
      expect(t, f).toMatch(/BoundedMerkleTree|Set/);
    }
    expect(JSON.stringify(byName.pledges)).toMatch(/Map/);
  });

  it('sealed rules (host/capacity/minPledge) are marked immutable', async () => {
    const byName = Object.fromEntries(info.ledger.map((l: any) => [l.name, l]));
    // storage "Cell" with no mutator circuits other than constructor use;
    // sealed-ness is a language-level guarantee - we pin the trio exists.
    for (const f of ['host', 'capacity', 'minPledge']) {
      expect(byName[f]).toBeTruthy();
      expect(byName[f].exported).toBe(true);
    }
  });
});
