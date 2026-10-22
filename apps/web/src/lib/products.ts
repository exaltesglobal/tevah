import { GST_RATES_BPS, rupeesToPaise } from "@tevah/core";
import { z } from "zod";

const money = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v) return 0;
    try {
      const paise = rupeesToPaise(v);
      if (paise < 0) throw new Error();
      return paise;
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter an amount like 1500 or 1,500.50" });
      return z.NEVER;
    }
  });

export const productInput = z
  .object({
    name: z.string().min(1, "Name is required").max(200),
    type: z.enum(["service", "goods"]),
    hsnSac: z
      .string()
      .regex(/^\d{4,8}$/, "HSN/SAC is 4 to 8 digits")
      .optional(),
    unit: z.string().max(20).optional(),
    salePrice: money,
    purchasePrice: money,
    gstRateBps: z.coerce
      .number()
      .refine((v) => (GST_RATES_BPS as readonly number[]).includes(v), { message: "Choose a GST rate" }),
    incomeAccountId: z.uuid().optional(),
    expenseAccountId: z.uuid().optional(),
  })
  .transform((v) => ({
    name: v.name,
    type: v.type,
    hsnSac: v.hsnSac ?? null,
    unit: v.unit?.toUpperCase() ?? "NOS",
    salePrice: v.salePrice,
    purchasePrice: v.purchasePrice,
    gstRateBps: v.gstRateBps,
    incomeAccountId: v.incomeAccountId ?? null,
    expenseAccountId: v.expenseAccountId ?? null,
  }));

export const formatRate = (bps: number) => `${bps / 100}%`;
