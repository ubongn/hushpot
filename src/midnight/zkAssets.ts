// ZK key material for the browser.
//
// The managed tree (managed/hushpot/{zkir,keys}) holds the compactc output.
// Vite bundles each artifact as a hashed asset URL; we fetch bytes lazily and
// cache them — prover keys are 2.8–5.2 MB per circuit, so only the circuit
// actually being called pays the download.

import joinZkir from '../../managed/hushpot/zkir/join.zkir?url';
import pledgeZkir from '../../managed/hushpot/zkir/pledge.zkir?url';
import proveZkir from '../../managed/hushpot/zkir/provePledgeAtLeast.zkir?url';
import closeZkir from '../../managed/hushpot/zkir/closeEntries.zkir?url';
import claimZkir from '../../managed/hushpot/zkir/claim.zkir?url';

import joinProver from '../../managed/hushpot/keys/join.prover?url';
import pledgeProver from '../../managed/hushpot/keys/pledge.prover?url';
import proveProver from '../../managed/hushpot/keys/provePledgeAtLeast.prover?url';
import closeProver from '../../managed/hushpot/keys/closeEntries.prover?url';
import claimProver from '../../managed/hushpot/keys/claim.prover?url';

import joinVerifier from '../../managed/hushpot/keys/join.verifier?url';
import pledgeVerifier from '../../managed/hushpot/keys/pledge.verifier?url';
import proveVerifier from '../../managed/hushpot/keys/provePledgeAtLeast.verifier?url';
import closeVerifier from '../../managed/hushpot/keys/closeEntries.verifier?url';
import claimVerifier from '../../managed/hushpot/keys/claim.verifier?url';

import {
  ZKConfigProvider,
  createZKIR,
  createProverKey,
  createVerifierKey,
  type ZKIR,
  type ProverKey,
  type VerifierKey,
} from '@midnight-ntwrk/midnight-js-types';

const ASSETS = {
  join: { zkir: joinZkir, prover: joinProver, verifier: joinVerifier },
  pledge: { zkir: pledgeZkir, prover: pledgeProver, verifier: pledgeVerifier },
  provePledgeAtLeast: {
    zkir: proveZkir,
    prover: proveProver,
    verifier: proveVerifier,
  },
  closeEntries: { zkir: closeZkir, prover: closeProver, verifier: closeVerifier },
  claim: { zkir: claimZkir, prover: claimProver, verifier: claimVerifier },
} as const;

type CircuitName = keyof typeof ASSETS;

/**
 * Circuit key locations arrive from midnight-js as `<tag>/<circuit>` strings
 * (tag = 'Hushpot'); resolve by the trailing circuit name.
 */
function circuitName(keyLocation: string): CircuitName {
  const name = keyLocation.split('/').pop() ?? keyLocation;
  if (!(name in ASSETS)) {
    throw new Error(`Unknown HushPot circuit key location: '${keyLocation}'`);
  }
  return name as CircuitName;
}

const bytesCache = new Map<string, Uint8Array>();

async function fetchAsset(url: string): Promise<Uint8Array> {
  const cached = bytesCache.get(url);
  if (cached) return cached;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load ZK artifact '${url}': HTTP ${res.status}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  bytesCache.set(url, bytes);
  return bytes;
}

export class HushpotZkConfigProvider extends ZKConfigProvider<string> {
  override async getZKIR(circuitId: string): Promise<ZKIR> {
    const c = circuitName(circuitId);
    return createZKIR(await fetchAsset(ASSETS[c].zkir));
  }

  override async getProverKey(circuitId: string): Promise<ProverKey> {
    const c = circuitName(circuitId);
    return createProverKey(await fetchAsset(ASSETS[c].prover));
  }

  override async getVerifierKey(circuitId: string): Promise<VerifierKey> {
    const c = circuitName(circuitId);
    return createVerifierKey(await fetchAsset(ASSETS[c].verifier));
  }
}

/** Preload a circuit's artifacts (call before a proof so the UX doesn't stall). */
export async function preloadCircuit(circuit: CircuitName): Promise<void> {
  const a = ASSETS[circuit];
  await Promise.all([fetchAsset(a.zkir), fetchAsset(a.verifier), fetchAsset(a.prover)]);
}
