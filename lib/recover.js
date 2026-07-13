// EIP-191 personal_sign address recovery using only @noble libs (edge/node safe,
// tiny, no viem). Mirrors what MetaMask's personal_sign produces.

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';

function toBytes(hex) {
  hex = hex.replace(/^0x/, '');
  const a = new Uint8Array(hex.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(hex.substr(i * 2, 2), 16);
  return a;
}
function toHex(bytes) {
  return '0x' + [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

function hashMessage(message) {
  const msgBytes = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode('\x19Ethereum Signed Message:\n' + msgBytes.length);
  const full = new Uint8Array(prefix.length + msgBytes.length);
  full.set(prefix, 0);
  full.set(msgBytes, prefix.length);
  return keccak_256(full);
}

// Returns the lowercase 0x address that signed `message`, or null on any error.
export function recoverAddress(message, signature) {
  try {
    const sig = toBytes(signature);
    if (sig.length !== 65) return null;
    const r = sig.slice(0, 32), s = sig.slice(32, 64);
    let v = sig[64];
    if (v >= 27) v -= 27;
    if (v !== 0 && v !== 1) return null;
    const rHex = [...r].map(b => b.toString(16).padStart(2, '0')).join('');
    const sHex = [...s].map(b => b.toString(16).padStart(2, '0')).join('');
    const sigObj = new secp256k1.Signature(BigInt('0x' + rHex), BigInt('0x' + sHex)).addRecoveryBit(v);
    const point = sigObj.recoverPublicKey(hashMessage(message));
    const pubUncompressed = point.toBytes(false).slice(1); // drop 0x04 -> 64 bytes
    const addr = keccak_256(pubUncompressed).slice(-20);
    return toHex(addr).toLowerCase();
  } catch (e) {
    return null;
  }
}
