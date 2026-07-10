// Server-side holder check: reads balanceOf with our RPC key.
import { call, toBig, padAddr } from './chain.js';

const TOKEN_CA = (process.env.TOKEN_CA || '0xd3aF2D5d83Ff14Ed78Ce4ff9f8f98027B37cF47a').toLowerCase();
const MIN_HOLD = BigInt(process.env.MIN_HOLD || 1000);
const SEL_BALANCE = '70a08231', SEL_DECIMALS = '313ce567';

let _dec = null;
async function decimals() {
  if (_dec !== null) return _dec;
  try { _dec = Number(toBig(await call(TOKEN_CA, SEL_DECIMALS))) || 18; }
  catch { _dec = 18; }
  return _dec;
}

export async function isHolder(wallet) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet || '')) return false;
  try {
    const dec = await decimals();
    const bal = toBig(await call(TOKEN_CA, SEL_BALANCE + padAddr(wallet)));
    return bal >= MIN_HOLD * (10n ** BigInt(dec));
  } catch { return false; }
}

export async function holderBalance(wallet) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet || '')) return { balance: '0', holder: false };
  try {
    const dec = await decimals();
    const bal = toBig(await call(TOKEN_CA, SEL_BALANCE + padAddr(wallet)));
    return { balance: (bal / (10n ** BigInt(dec))).toString(), holder: bal >= MIN_HOLD * (10n ** BigInt(dec)) };
  } catch { return { balance: '0', holder: false }; }
}
