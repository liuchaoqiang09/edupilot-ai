export const renewalOutcomes = ["TO_CONTACT", "CONTACTED", "NEXT_BOOKED", "DECLINED", "RENEWED"] as const;

export type RenewalOutcomeName = (typeof renewalOutcomes)[number];

export const renewalOutcomeLabel: Record<RenewalOutcomeName, string> = {
  TO_CONTACT: "待联系",
  CONTACTED: "已联系",
  NEXT_BOOKED: "已约下次",
  DECLINED: "已拒绝",
  RENEWED: "已续费",
};

export function isRenewalOutcome(value: string): value is RenewalOutcomeName {
  return renewalOutcomes.includes(value as RenewalOutcomeName);
}
