import type { PaymentMethod } from "@prisma/client";

export const paymentMethods = ["CASH", "WECHAT", "ALIPAY", "BANK", "OTHER"] as const;

export const paymentMethodLabel: Record<PaymentMethod, string> = {
  CASH: "现金",
  WECHAT: "微信",
  ALIPAY: "支付宝",
  BANK: "银行卡",
  OTHER: "其他",
};

/** 应缴金额。填写折扣时按应收 × 折扣率；没填折扣时就是应收。 */
export function payableCents(dueCents: number, discountPercent: number | null) {
  if (discountPercent == null) return dueCents;
  return Math.round(dueCents * discountPercent / 100);
}

export function enrollmentStanding(dueCents: number, netCents: number, discountPercent: number | null = null): "PAID" | "PARTIAL" | "UNPAID" {
  const payable = payableCents(dueCents, discountPercent);
  if (netCents <= 0) return payable <= 0 ? "PAID" : "UNPAID";
  if (netCents >= payable) return "PAID";
  return "PARTIAL";
}

export function arrearsCents(dueCents: number, netCents: number, discountPercent: number | null = null) {
  return Math.max(payableCents(dueCents, discountPercent) - netCents, 0);
}

export function decimalCents(value: { toString(): string }) {
  return Math.round(Number(value.toString()) * 100);
}

export function isPaymentMethod(value: string): value is PaymentMethod {
  return paymentMethods.includes(value as PaymentMethod);
}
