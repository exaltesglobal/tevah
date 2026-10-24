import { z } from "zod";
import type { invoiceDesigns } from "@/db/schema";

export const INVOICE_TEMPLATES = ["classic", "modern", "boxed"] as const;

/** What the designer edits and the printed document reads. Safe to import in client components. */
export type InvoiceDesign = Omit<typeof invoiceDesigns.$inferSelect, "id" | "orgId" | "updatedAt">;
export type InvoiceTemplate = (typeof INVOICE_TEMPLATES)[number];

export const TEMPLATE_INFO: Record<InvoiceTemplate, { label: string; description: string }> = {
  classic: { label: "Classic", description: "Clean and airy, with an accent-coloured title" },
  modern: { label: "Modern", description: "Bold colour band with your logo up top" },
  boxed: { label: "Boxed", description: "Ruled grid, the traditional GST invoice look" },
};

/** Crimson first; the rest read well on white paper and in black-and-white print. */
export const ACCENT_PRESETS = ["#A3142B", "#2A1B1E", "#1F4E79", "#1F7A4D", "#6B3FA0", "#B45309"] as const;

export const DEFAULT_DESIGN: InvoiceDesign = {
  template: "classic",
  accentColor: "#A3142B",
  logo: null,
  signature: null,
  showHsn: true,
  showDiscount: true,
  showAmountInWords: true,
  showUpiQr: true,
  bankName: null,
  bankAccountName: null,
  bankAccountNumber: null,
  bankIfsc: null,
  bankBranch: null,
  upiId: null,
  terms: null,
  footer: null,
  signatoryLabel: null,
};

/** Images are resized in the browser; this caps what a hand-made request can store. */
const MAX_IMAGE_CHARS = 700_000;
const image = z
  .string()
  .max(MAX_IMAGE_CHARS, "Image is too large; use one under 500 KB")
  .regex(/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/, "Upload a PNG, JPEG, WebP or SVG image")
  .nullable();
const optional = (max: number) =>
  z
    .string()
    .max(max, `Keep this under ${max} characters`)
    .nullable()
    .transform((v) => (v?.trim() ? v.trim() : null));

export const designInput = z.object({
  template: z.enum(INVOICE_TEMPLATES),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Pick a colour like #A3142B").transform((v) => v.toUpperCase()),
  logo: image,
  signature: image,
  showHsn: z.boolean(),
  showDiscount: z.boolean(),
  showAmountInWords: z.boolean(),
  showUpiQr: z.boolean(),
  bankName: optional(100),
  bankAccountName: optional(200),
  bankAccountNumber: optional(30).refine((v) => !v || /^[0-9A-Za-z]{6,30}$/.test(v), "Account number is 6 to 30 letters or digits"),
  bankIfsc: optional(11)
    .transform((v) => v?.toUpperCase() ?? null)
    .refine((v) => !v || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v), "IFSC looks like HDFC0001234"),
  bankBranch: optional(100),
  upiId: optional(100).refine((v) => !v || /^[\w.-]{2,}@[A-Za-z]{2,}$/.test(v), "UPI ID looks like name@okhdfcbank"),
  terms: optional(2000),
  footer: optional(300),
  signatoryLabel: optional(100),
});

/** UPI deep link that any Indian UPI app opens with the payee and amount filled in. */
export function upiPayLink({ upiId, payee, amountPaise, note }: { upiId: string; payee: string; amountPaise: number; note: string }) {
  const params = new URLSearchParams({ pa: upiId, pn: payee, am: (amountPaise / 100).toFixed(2), cu: "INR", tn: note });
  return `upi://pay?${params.toString().replace(/\+/g, "%20")}`;
}
