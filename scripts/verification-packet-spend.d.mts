export interface VerificationGrantReservation {
  caseDir: string; packetId: string; packetDigest: string; repository: string;
  runId: string; attempt: number; sourceSha: string; reservationUsd: number;
}
export function reserveVerificationGrant(input: VerificationGrantReservation): Promise<void>;
export interface VerificationBillingReceipt {
  source: 'authoritative-provider-billing'; complete: true; actualUsd: number;
  receiptSha256: string; receiptReference: string;
}
/** Caller must obtain and validate the named complete authoritative billing receipt first. */
export function reconcileVerificationGrant(input: VerificationGrantReservation & { receipt: VerificationBillingReceipt }): Promise<void>;
