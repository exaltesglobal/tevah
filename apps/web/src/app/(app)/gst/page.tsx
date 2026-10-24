import { formatINR, stateName, totalTax, type Gstr1Invoice, type TaxAmounts } from "@tevah/core";
import Link from "next/link";
import type { ReactNode } from "react";
import { ButtonLink, Card, EmptyState, Input, PageHeader, Table, Th, Button } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { requireSession } from "@/lib/auth";
import { getOrg } from "@/lib/org";
import { fmtDate, today } from "../reports/period";
import { Check } from "../reports/status";
import { loadReturns, readMonth } from "./data";

export const metadata = { title: "GST returns" };

const pct = (bps: number) => `${bps / 100}%`;
const amt = (n: number) => formatINR(n);

export default async function GstPage({ searchParams }: { searchParams: Promise<{ month?: string; tab?: string }> }) {
  const session = await requireSession();
  const org = await getOrg(session.orgId);
  const params = await searchParams;
  const month = readMonth(params.month, today());
  const tab = params.tab === "3b" ? "3b" : "1";
  const { period, gstr1, gstr3b, ledger, docs } = await loadReturns(session.orgId, month);
  const label = new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

  // The return should match what the GST accounts in the ledger moved by in the month.
  const outputLedger = ledger.output.igst + ledger.output.cgst + ledger.output.sgst;
  const inputLedger = ledger.input.igst + ledger.input.cgst + ledger.input.sgst;
  const outputReturn = totalTax(gstr1.totals);
  const inputReturn = totalTax(gstr3b.itcNet);
  const ties = outputLedger === outputReturn && inputLedger === inputReturn;

  return (
    <>
      <PageHeader
        title="GST returns"
        subtitle={`${org.legalName} · GSTIN ${org.gstin ?? "not set"} · ${label}`}
        actions={<PrintButton />}
      />
      <div className="mb-5 flex flex-wrap items-end gap-3 print:hidden">
        <form className="flex items-end gap-2">
          <input type="hidden" name="tab" value={tab} />
          <label className="text-xs text-stone-500">
            Return period
            <Input type="month" name="month" defaultValue={month} className="mt-1 w-auto!" />
          </label>
          <Button variant="secondary">Show</Button>
        </form>
        <nav className="flex gap-1 rounded-lg bg-stone-100 p-1 text-sm">
          {(["1", "3b"] as const).map((t) => (
            <Link
              key={t}
              href={`?month=${month}&tab=${t}`}
              className={`rounded-md px-3 py-1.5 ${tab === t ? "bg-white font-medium text-brand-700 shadow-xs" : "text-stone-600"}`}
            >
              GSTR-{t.toUpperCase()}
            </Link>
          ))}
        </nav>
      </div>

      {docs.length === 0 && <Card className="mb-4 text-sm text-stone-500">No invoices or bills dated {fmtDate(period.from)} to {fmtDate(period.to)}.</Card>}

      {tab === "1" ? (
        <>
          <div className="mb-4 flex flex-wrap gap-2 print:hidden">
            <ButtonLink href={`/gst/export?month=${month}&format=json`} prefetch={false}>
              Download JSON for the GST portal
            </ButtonLink>
            {["b2b", "b2cl", "b2cs", "cdnr", "exp", "hsn", "docs"].map((s) => (
              <ButtonLink key={s} variant="secondary" href={`/gst/export?month=${month}&format=csv&section=${s}`} prefetch={false}>
                {s.toUpperCase()} CSV
              </ButtonLink>
            ))}
          </div>
          <p className="mb-6 text-xs text-stone-500 print:hidden">
            Upload the JSON in the GST portal under Returns › GSTR-1 › Prepare offline, or open it in the GST offline tool first to review.
          </p>

          <InvoiceTable title="4A · B2B invoices (registered customers)" rows={gstr1.b2b} showGstin />
          <InvoiceTable title="5 · B2C large (inter-state, over ₹1 lakh, unregistered)" rows={gstr1.b2cl} />
          <Section title="7 · B2C others (unregistered, by state and rate)">
            <Table
              head={
                <tr>
                  <Th>Place of supply</Th>
                  <Th>Supply</Th>
                  <Th className="text-right">Rate</Th>
                  <TaxHead />
                </tr>
              }
              empty={gstr1.b2cs.length === 0 && <EmptyState>None</EmptyState>}
            >
              {gstr1.b2cs.map((b) => (
                <tr key={`${b.placeOfSupply}${b.supplyType}${b.rateBps}`}>
                  <td>
                    {b.placeOfSupply} {stateName(b.placeOfSupply)}
                  </td>
                  <td>{b.supplyType === "inter" ? "Inter-state" : "Intra-state"}</td>
                  <td className="text-right">{pct(b.rateBps)}</td>
                  <TaxCells t={b} />
                </tr>
              ))}
            </Table>
          </Section>
          <InvoiceTable title="6A · Exports under LUT (without payment of IGST)" rows={gstr1.exp} />
          <InvoiceTable title="9B · Credit notes to registered customers" rows={gstr1.cdnr} showGstin />
          {gstr1.cdnur.length > 0 && <InvoiceTable title="9B · Credit notes against exports" rows={gstr1.cdnur} />}
          <Section title="8 · Nil-rated supplies">
            {gstr1.nil.length === 0 ? (
              <p className="text-sm text-stone-500">None</p>
            ) : (
              <ul className="text-sm">
                {gstr1.nil.map((n) => (
                  <li key={`${n.supplyType}${n.registered}`}>
                    {n.supplyType === "inter" ? "Inter-state" : "Intra-state"} to {n.registered ? "registered" : "unregistered"} buyers: {formatINR(n.nilRated, { symbol: true })}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          {(["B2B", "B2C"] as const).map((t) => {
            const rows = t === "B2B" ? gstr1.hsnB2b : gstr1.hsnB2c;
            return (
              <Section key={t} title={`12 · HSN/SAC summary, ${t}`}>
                <Table
                  head={
                    <tr>
                      <Th>HSN/SAC</Th>
                      <Th>Description</Th>
                      <Th>UQC</Th>
                      <Th className="text-right">Qty</Th>
                      <Th className="text-right">Rate</Th>
                      <TaxHead />
                    </tr>
                  }
                  empty={rows.length === 0 && <EmptyState>None</EmptyState>}
                >
                  {rows.map((h) => (
                    <tr key={`${h.hsnSac}${h.rateBps}${h.uqc}`}>
                      <td className="font-mono text-xs">{h.hsnSac || <span className="text-amber-700">missing</span>}</td>
                      <td>{h.description}</td>
                      <td>{h.uqc}</td>
                      <td className="text-right tabular-nums">{h.uqc === "NA" ? "" : h.quantityMilli / 1000}</td>
                      <td className="text-right">{pct(h.rateBps)}</td>
                      <TaxCells t={h} />
                    </tr>
                  ))}
                </Table>
              </Section>
            );
          })}
          <Section title="13 · Documents issued">
            <Table
              head={
                <tr>
                  <Th>Document</Th>
                  <Th>From</Th>
                  <Th>To</Th>
                  <Th className="text-right">Total</Th>
                  <Th className="text-right">Cancelled</Th>
                </tr>
              }
              empty={gstr1.documents.length === 0 && <EmptyState>None</EmptyState>}
            >
              {gstr1.documents.map((d) => (
                <tr key={`${d.kind}${d.prefix}`}>
                  <td>{d.kind === "invoice" ? "Invoices" : "Credit notes"}</td>
                  <td>{d.from}</td>
                  <td>{d.to}</td>
                  <td className="text-right">{d.total}</td>
                  <td className="text-right">{d.cancelled}</td>
                </tr>
              ))}
            </Table>
          </Section>
        </>
      ) : (
        <Card className="max-w-4xl">
          <Table3b
            rows={[
              ["3.1(a) Outward taxable supplies", gstr3b.outwardTaxable],
              ["3.1(b) Zero-rated supplies (exports under LUT)", { taxable: gstr3b.outwardZeroRated, igst: 0, cgst: 0, sgst: 0 }],
              ["3.1(c) Nil-rated and exempt supplies", { taxable: gstr3b.outwardNil, igst: 0, cgst: 0, sgst: 0 }],
              ["3.1(d) Inward supplies liable to reverse charge", gstr3b.inwardReverseCharge],
            ]}
            title="3.1 Tax on outward and reverse-charge inward supplies"
          />
          <Table3b
            title="4 Eligible input tax credit"
            noTaxable
            rows={[
              ["4(A)(3) Inward supplies liable to reverse charge", gstr3b.itcReverseCharge],
              ["4(A)(5) All other ITC", gstr3b.itcOther],
              ["4(C) Net ITC available", gstr3b.itcNet],
            ]}
          />
          <Table3b
            title="Tax payable"
            noTaxable
            rows={[
              ["Liability (outward tax plus reverse charge)", gstr3b.liability],
              ["Less ITC", { ...gstr3b.itcNet }],
              ["Net payable before set-off", gstr3b.netPayable],
            ]}
          />
          <p className="mt-2 text-xs text-stone-500">
            Reverse-charge tax must be paid in cash. The portal applies the IGST/CGST/SGST set-off order when you file; a negative figure is credit carried forward.
          </p>
          {gstr3b.interStateUnregistered.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-1 font-semibold">3.2 Inter-state supplies to unregistered persons</h3>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-stone-100">
                  {gstr3b.interStateUnregistered.map((r) => (
                    <tr key={r.placeOfSupply}>
                      <td className="py-1.5">
                        {r.placeOfSupply} {stateName(r.placeOfSupply)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{amt(r.taxable)}</td>
                      <td className="py-1.5 text-right tabular-nums">IGST {amt(r.igst)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Check ok={ties}>
        {ties
          ? `Ties out to the ledger: output GST ${formatINR(outputLedger, { symbol: true })}, input GST ${formatINR(inputLedger, { symbol: true })}.`
          : `The ledger's GST accounts moved by output ${formatINR(outputLedger, { symbol: true })} and input ${formatINR(inputLedger, { symbol: true })} this month, but the return shows ${formatINR(outputReturn, { symbol: true })} and ${formatINR(inputReturn, { symbol: true })}. A manual journal on a GST account would explain the gap.`}
      </Check>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function TaxHead() {
  return (
    <>
      <Th className="text-right">Taxable</Th>
      <Th className="text-right">IGST</Th>
      <Th className="text-right">CGST</Th>
      <Th className="text-right">SGST</Th>
    </>
  );
}

function TaxCells({ t }: { t: TaxAmounts }) {
  return (
    <>
      <td className="text-right tabular-nums">{amt(t.taxable)}</td>
      <td className="text-right tabular-nums">{amt(t.igst)}</td>
      <td className="text-right tabular-nums">{amt(t.cgst)}</td>
      <td className="text-right tabular-nums">{amt(t.sgst)}</td>
    </>
  );
}

function InvoiceTable({ title, rows, showGstin }: { title: string; rows: Gstr1Invoice[]; showGstin?: boolean }) {
  return (
    <Section title={title}>
      <Table
        head={
          <tr>
            {showGstin && <Th>GSTIN</Th>}
            <Th>Party</Th>
            <Th>Number</Th>
            <Th>Date</Th>
            <Th>POS</Th>
            <Th className="text-right">Value</Th>
            <Th className="text-right">Rate</Th>
            <TaxHead />
          </tr>
        }
        empty={rows.length === 0 && <EmptyState>None</EmptyState>}
      >
        {rows.flatMap((i) =>
          i.items.map((it, n) => (
            <tr key={`${i.number}${it.rateBps}`}>
              {showGstin && <td className="font-mono text-xs">{n === 0 ? i.gstin : ""}</td>}
              <td>{n === 0 ? i.contactName : ""}</td>
              <td>{n === 0 ? i.number : ""}</td>
              <td className="whitespace-nowrap">{n === 0 ? fmtDate(i.date) : ""}</td>
              <td>{n === 0 ? i.placeOfSupply : ""}</td>
              <td className="text-right tabular-nums">{n === 0 ? amt(i.value) : ""}</td>
              <td className="text-right">{pct(it.rateBps)}</td>
              <TaxCells t={it} />
            </tr>
          )),
        )}
      </Table>
    </Section>
  );
}

function Table3b({ title, rows, noTaxable }: { title: string; rows: [string, TaxAmounts][]; noTaxable?: boolean }) {
  return (
    <div className="mb-6">
      <h3 className="mb-1 font-semibold">{title}</h3>
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wide text-stone-500">
          <tr>
            <th className="py-1.5 text-left font-medium" />
            {!noTaxable && <th className="py-1.5 text-right font-medium">Taxable</th>}
            <th className="py-1.5 text-right font-medium">IGST</th>
            <th className="py-1.5 text-right font-medium">CGST</th>
            <th className="py-1.5 text-right font-medium">SGST</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {rows.map(([label, t]) => (
            <tr key={label}>
              <td className="py-1.5">{label}</td>
              {!noTaxable && <td className="py-1.5 text-right tabular-nums">{amt(t.taxable)}</td>}
              <td className="py-1.5 text-right tabular-nums">{amt(t.igst)}</td>
              <td className="py-1.5 text-right tabular-nums">{amt(t.cgst)}</td>
              <td className="py-1.5 text-right tabular-nums">{amt(t.sgst)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
