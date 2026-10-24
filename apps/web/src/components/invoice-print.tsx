import { amountInWords, formatINR, stateName, type DocumentType } from "@tevah/core";
import type { CSSProperties, ReactNode } from "react";
import type { InvoiceDesign } from "@/lib/invoice-design";
import { formatRate } from "@/lib/products";

/**
 * The printed face of a sales or purchase document. Pure markup with no data
 * loading, so the document page and the invoice designer's live preview
 * render exactly the same thing.
 */

const PRINT_TITLE = { invoice: "Tax Invoice", credit_note: "Credit Note", bill: "Purchase Bill", debit_note: "Debit Note" } as const;

export interface PrintParty {
  name: string;
  legalName?: string;
  gstin: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  pincode: string | null;
  stateCode: string | null;
  email: string | null;
  phone: string | null;
}

export interface PrintDoc {
  type: DocumentType;
  number: string | null;
  date: string;
  dueDate: string | null;
  vendorReference: string | null;
  placeOfSupply: string;
  supplyType: "intra" | "inter";
  reverseCharge: boolean;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  roundOff: number;
  total: number;
  tdsAmount: number;
  tdsSection: string | null;
  tdsRateBps: number;
  notes: string | null;
}

export interface PrintLine {
  id: string;
  description: string;
  hsnSac: string | null;
  quantityMilli: number;
  unit: string;
  unitPrice: number;
  discountBps: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  gstRateBps: number;
  total: number;
}

const fmtDate = (iso: string) => iso.split("-").reverse().join("/");
const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

export function InvoicePrint({
  design,
  doc,
  lines,
  seller,
  buyer,
  sales,
  upiQrSvg,
  against,
}: {
  design: InvoiceDesign;
  doc: PrintDoc;
  lines: readonly PrintLine[];
  seller: PrintParty;
  buyer: PrintParty;
  /** Our own document: the design's logo, bank details and signature apply. */
  sales: boolean;
  /** Pre-rendered SVG of the UPI payment QR code, when there is an amount to collect. */
  upiQrSvg?: string | null;
  against?: { number: string | null; href?: string } | null;
}) {
  const t = design.template;
  const boxed = t === "boxed";
  const modern = t === "modern";
  const logo = sales ? design.logo : null;
  const style = { "--accent": design.accentColor } as CSSProperties;
  const showDiscount = design.showDiscount && lines.some((l) => l.discountBps > 0);
  const bank = sales && doc.type === "invoice" ? bankLines(design) : [];
  const qr = sales && doc.type === "invoice" && design.showUpiQr ? upiQrSvg : null;

  const meta: [string, ReactNode][] = [
    ["Number", <span className="font-medium">{doc.number ?? "Draft"}</span>],
    ["Date", fmtDate(doc.date)],
  ];
  if (doc.dueDate) meta.push(["Due date", fmtDate(doc.dueDate)]);
  if (doc.vendorReference) meta.push(["Vendor bill no.", doc.vendorReference]);
  if (against)
    meta.push([
      "Against",
      against.href ? (
        <a href={against.href} className="text-brand-700 hover:underline print:text-inherit">
          {against.number}
        </a>
      ) : (
        against.number
      ),
    ]);
  meta.push(["Place of supply", `${stateName(doc.placeOfSupply)} (${doc.placeOfSupply})`]);
  meta.push(["Reverse charge", doc.reverseCharge ? "Yes" : "No"]);

  const metaList = (
    <dl className={cx("grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-sm", !boxed && "justify-end")}>
      {meta.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className={modern ? "text-white/75" : "text-stone-500"}>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );

  return (
    <div
      style={style}
      className={cx(
        "bg-white text-stone-900 [print-color-adjust:exact]",
        boxed ? "border border-stone-400 text-[13px]" : "rounded-lg border border-stone-200 print:rounded-none print:border-0",
      )}
    >
      {/* Header */}
      {modern ? (
        <div className="flex flex-wrap items-start justify-between gap-6 rounded-t-lg bg-(--accent) px-6 py-5 text-white print:rounded-none">
          <div className="flex items-center gap-4">
            {logo && (
              <div className="rounded-md bg-white p-2">
                <img src={logo} alt="" className="max-h-14 max-w-40 object-contain" />
              </div>
            )}
            <div>
              <div className="text-lg font-semibold">{seller.legalName ?? seller.name}</div>
              <div className="font-mono text-xs text-white/80">{seller.gstin ? `GSTIN ${seller.gstin}` : "Unregistered"}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold tracking-tight uppercase">{PRINT_TITLE[doc.type]}</div>
            <div className="mt-2">{metaList}</div>
          </div>
        </div>
      ) : boxed ? (
        <>
          <div className="border-b border-stone-400 py-2 text-center text-base font-bold tracking-widest text-(--accent) uppercase">
            {PRINT_TITLE[doc.type]}
          </div>
          <div className="grid border-b border-stone-400 sm:grid-cols-2 print:grid-cols-2">
            <div className="flex gap-3 border-stone-400 p-3 sm:border-r print:border-r">
              {logo && <img src={logo} alt="" className="max-h-16 max-w-32 object-contain" />}
              <Party party={seller} label={sales ? undefined : "Supplier"} large={sales} />
            </div>
            <div className="p-3">{metaList}</div>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap justify-between gap-6 border-b border-stone-200 p-5">
          <div className="flex items-start gap-4">
            {logo && <img src={logo} alt="" className="max-h-16 max-w-40 object-contain" />}
            <Party party={seller} label={sales ? undefined : "Supplier"} large={sales} />
          </div>
          <div className="text-right">
            <div className="text-xl font-semibold tracking-tight text-(--accent)">{PRINT_TITLE[doc.type]}</div>
            <div className="mt-2">{metaList}</div>
          </div>
        </div>
      )}

      {/* Parties */}
      <div className={cx("grid gap-4", boxed ? "border-b border-stone-400 p-3" : "border-b border-stone-200 px-5 py-4", modern && "px-6")}>
        {modern && <Party party={seller} label="From" compact />}
        <Party party={buyer} label={sales ? "Bill to" : "Billed to"} />
      </div>

      {/* Lines */}
      <div className="overflow-x-auto">
        <table className={cx("w-full text-sm", boxed && "border-collapse")}>
          <thead
            className={cx(
              "text-left text-xs tracking-wide uppercase",
              modern ? "bg-[color-mix(in_srgb,var(--accent)_10%,white)] text-stone-700" : "text-stone-500",
              !boxed && "border-b-2 border-(--accent)",
              boxed && "bg-stone-50",
            )}
          >
            <tr className={cx("[&_th]:px-3 [&_th]:py-2 [&_th]:font-medium", boxed && "[&_th]:border [&_th]:border-stone-300")}>
              <th className="pl-5">#</th>
              <th>Item</th>
              {design.showHsn && <th>HSN/SAC</th>}
              <th className="text-right">Qty</th>
              <th className="text-right">Rate</th>
              {showDiscount && <th className="text-right">Disc</th>}
              <th className="text-right">Taxable</th>
              <th className="text-right">GST</th>
              <th className="pr-5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className={cx("[&_td]:px-3 [&_td]:py-2", !boxed && "divide-y divide-stone-100")}>
            {lines.map((l, i) => (
              <tr key={l.id} className={cx(boxed && "[&_td]:border [&_td]:border-stone-300")}>
                <td className="pl-5 text-stone-500">{i + 1}</td>
                <td>{l.description}</td>
                {design.showHsn && <td className="font-mono text-xs">{l.hsnSac ?? "—"}</td>}
                <td className="text-right whitespace-nowrap tabular-nums">
                  {Number((l.quantityMilli / 1000).toFixed(3))} {l.unit}
                </td>
                <td className="text-right tabular-nums">{formatINR(l.unitPrice)}</td>
                {showDiscount && <td className="text-right tabular-nums">{l.discountBps ? `${l.discountBps / 100}%` : "—"}</td>}
                <td className="text-right tabular-nums">{formatINR(l.taxable)}</td>
                <td className="text-right whitespace-nowrap tabular-nums">
                  {formatRate(l.gstRateBps)}
                  <span className="block text-xs text-stone-500">{formatINR(l.cgst + l.sgst + l.igst)}</span>
                </td>
                <td className="pr-5 text-right tabular-nums">{formatINR(l.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals, words, bank */}
      <div className={cx("flex flex-wrap justify-between gap-6", boxed ? "border-t border-stone-400 p-3" : "border-t border-stone-200 p-5", modern && "px-6")}>
        <div className="max-w-md flex-1 space-y-3 text-sm">
          {design.showAmountInWords && (
            <p>
              <span className="text-stone-500">Amount in words: </span>
              {amountInWords(doc.total)}
            </p>
          )}
          {doc.reverseCharge && <p className="text-amber-800">Tax on this supply is payable by the recipient under reverse charge.</p>}
          {doc.notes && <p className="whitespace-pre-line text-stone-600">{doc.notes}</p>}
          {(bank.length > 0 || qr) && (
            <div className="flex flex-wrap items-start gap-5">
              {bank.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-semibold tracking-wide text-(--accent) uppercase">Bank details</div>
                  <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
                    {bank.map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-stone-500">{k}</dt>
                        <dd className={k === "Account no." || k === "IFSC" ? "font-mono text-xs leading-5" : undefined}>{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
              {qr && (
                <div className="text-center">
                  <div className="h-24 w-24 [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} />
                  <div className="mt-1 text-xs text-stone-500">Scan to pay by UPI</div>
                </div>
              )}
            </div>
          )}
        </div>
        <dl className="min-w-64 space-y-1 text-sm">
          <Total label="Taxable value" value={doc.taxable} />
          {doc.supplyType === "intra" ? (
            <>
              <Total label="CGST" value={doc.cgst} />
              <Total label="SGST" value={doc.sgst} />
            </>
          ) : (
            <Total label="IGST" value={doc.igst} />
          )}
          {doc.roundOff !== 0 && <Total label="Round off" value={doc.roundOff} />}
          <Total label="Total" value={doc.total} strong accent={modern} />
          {doc.tdsAmount > 0 && (
            <>
              <Total label={`TDS ${doc.tdsSection ?? ""} @ ${doc.tdsRateBps / 100}%`} value={-doc.tdsAmount} />
              <Total label="Net payable" value={doc.total - doc.tdsAmount} strong />
            </>
          )}
        </dl>
      </div>

      {/* Terms and signature */}
      {sales && (
        <div className={cx("flex flex-wrap items-end justify-between gap-6 text-sm", boxed ? "border-t border-stone-400 p-3" : "px-5 pb-5", modern && "px-6")}>
          <div className="max-w-md flex-1">
            {design.terms && (
              <>
                <div className="mb-1 text-xs font-semibold tracking-wide text-(--accent) uppercase">Terms and conditions</div>
                <p className="text-xs whitespace-pre-line text-stone-600">{design.terms}</p>
              </>
            )}
          </div>
          <div className="min-w-48 text-right">
            <div>For {seller.legalName ?? seller.name}</div>
            {design.signature ? (
              <img src={design.signature} alt="Signature" className="my-1 ml-auto max-h-16 max-w-48 object-contain" />
            ) : (
              <div className="h-14" />
            )}
            <div className="border-t border-stone-300 pt-1 text-stone-600">{design.signatoryLabel ?? "Authorised signatory"}</div>
          </div>
        </div>
      )}
      {sales && design.footer && (
        <div className={cx("text-center text-xs text-stone-500", boxed ? "border-t border-stone-400 p-2" : "border-t border-stone-100 px-5 py-3")}>
          {design.footer}
        </div>
      )}
    </div>
  );
}

function bankLines(d: InvoiceDesign): [string, string][] {
  const rows: [string, string | null][] = [
    ["Account name", d.bankAccountName],
    ["Bank", [d.bankName, d.bankBranch].filter(Boolean).join(", ") || null],
    ["Account no.", d.bankAccountNumber],
    ["IFSC", d.bankIfsc],
    ["UPI", d.upiId],
  ];
  return rows.filter((r): r is [string, string] => Boolean(r[1]));
}

function Party({
  label,
  party,
  large,
  compact,
}: {
  label?: string;
  party: PrintParty;
  large?: boolean;
  compact?: boolean;
}) {
  const place = [party.city, party.pincode].filter(Boolean).join(" ");
  if (compact) {
    // Modern template: the name and GSTIN are already in the colour band.
    const address = [party.addressLine1, party.addressLine2, place, party.stateCode && `${stateName(party.stateCode)} (${party.stateCode})`]
      .filter(Boolean)
      .join(", ");
    const reach = [party.email, party.phone].filter(Boolean).join(" · ");
    if (!address && !reach) return null;
    return (
      <div className="text-sm leading-relaxed">
        {label && <div className="text-xs tracking-wide text-stone-500 uppercase">{label}</div>}
        {address && <div>{address}</div>}
        {reach && <div className="text-stone-600">{reach}</div>}
      </div>
    );
  }
  return (
    <div className="text-sm leading-relaxed">
      {label && <div className="text-xs tracking-wide text-stone-500 uppercase">{label}</div>}
      <div className={large ? "text-lg font-semibold" : "font-semibold"}>{party.legalName ?? party.name}</div>
      {party.addressLine1 && <div>{party.addressLine1}</div>}
      {party.addressLine2 && <div>{party.addressLine2}</div>}
      {place && <div>{place}</div>}
      {party.stateCode && (
        <div>
          {stateName(party.stateCode)} ({party.stateCode})
        </div>
      )}
      <div className="font-mono text-xs">{party.gstin ? `GSTIN ${party.gstin}` : "Unregistered"}</div>
      {(party.email || party.phone) && <div className="text-stone-600">{[party.email, party.phone].filter(Boolean).join(" · ")}</div>}
    </div>
  );
}

function Total({ label, value, strong, accent }: { label: string; value: number; strong?: boolean; accent?: boolean }) {
  return (
    <div
      className={cx(
        "flex justify-between gap-6",
        strong && "border-t border-stone-200 pt-1 font-semibold",
        accent && "-mx-2 rounded bg-(--accent) px-2 py-1 text-white",
      )}
    >
      <dt className={strong ? undefined : "text-stone-500"}>{label}</dt>
      <dd className="tabular-nums">{formatINR(value, { symbol: true })}</dd>
    </div>
  );
}
