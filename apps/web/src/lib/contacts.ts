import { GST_STATES, isStateCode, isValidPan, validateGstin } from "@tevah/core";
import { z } from "zod";

const optional = <T extends z.ZodType>(schema: T) => schema.optional();

export const contactInput = z
  .object({
    kind: z.enum(["customer", "vendor", "both"]),
    name: z.string().min(1, "Name is required").max(200),
    gstin: optional(z.string().refine((v) => validateGstin(v).valid, { message: "Not a valid GSTIN" })),
    pan: optional(z.string().refine(isValidPan, { message: "Not a valid PAN" })),
    email: optional(z.email("Not a valid email")),
    phone: optional(z.string().max(30)),
    addressLine1: optional(z.string().max(200)),
    addressLine2: optional(z.string().max(200)),
    city: optional(z.string().max(100)),
    stateCode: optional(z.string().refine(isStateCode, { message: "Choose a state" })),
    pincode: optional(z.string().regex(/^\d{6}$/, "PIN code has 6 digits")),
    tdsRate: optional(
      z.coerce.number().min(0, "TDS rate can't be negative").max(30, "TDS rate looks too high"),
    ),
    notes: optional(z.string().max(2000)),
  })
  .transform((v) => {
    const gst = v.gstin ? validateGstin(v.gstin) : null;
    return {
      kind: v.kind,
      name: v.name,
      gstin: gst?.valid ? gst.gstin : null,
      // GSTIN fixes the state and PAN; anything typed separately must agree.
      pan: (gst?.valid ? gst.pan : v.pan?.toUpperCase()) ?? null,
      stateCode: (gst?.valid ? gst.stateCode : v.stateCode) ?? null,
      email: v.email ?? null,
      phone: v.phone ?? null,
      addressLine1: v.addressLine1 ?? null,
      addressLine2: v.addressLine2 ?? null,
      city: v.city ?? null,
      pincode: v.pincode ?? null,
      tdsRateBps: v.tdsRate === undefined ? null : Math.round(v.tdsRate * 100),
      notes: v.notes ?? null,
    };
  });

export type ContactInput = z.output<typeof contactInput>;

export const STATE_OPTIONS = Object.entries(GST_STATES)
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name));
