import { isStateCode, type StateCode } from "./states";

const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Check character per the GSTN mod-36 algorithm. */
export function gstinCheckChar(first14: string): string {
  let total = 0;
  for (let i = 0; i < 14; i++) {
    const value = CHARSET.indexOf(first14[i]!);
    const product = value * (i % 2 === 0 ? 1 : 2);
    total += Math.floor(product / 36) + (product % 36);
  }
  return CHARSET[(36 - (total % 36)) % 36]!;
}

export type GstinCheck =
  | { valid: true; gstin: string; stateCode: StateCode; pan: string }
  | { valid: false; reason: string };

export function validateGstin(input: string): GstinCheck {
  const gstin = input.trim().toUpperCase();
  if (!GSTIN_PATTERN.test(gstin)) return { valid: false, reason: "GSTIN format is wrong" };
  const stateCode = gstin.slice(0, 2);
  if (!isStateCode(stateCode)) return { valid: false, reason: `Unknown state code ${stateCode}` };
  if (gstinCheckChar(gstin.slice(0, 14)) !== gstin[14]) {
    return { valid: false, reason: "GSTIN check digit does not match" };
  }
  return { valid: true, gstin, stateCode, pan: gstin.slice(2, 12) };
}

const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export function isValidPan(input: string): boolean {
  return PAN_PATTERN.test(input.trim().toUpperCase());
}
