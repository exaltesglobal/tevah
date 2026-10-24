import { describe, expect, it } from "vitest";
import { autoHsn, HSN_CATALOGUE, suggestHsn } from "../src";

const top = (name: string, kind?: "service" | "goods") => suggestHsn(name, { kind })[0]?.code;

describe("HSN/SAC suggestions", () => {
  it("has well-formed, unique codes", () => {
    const codes = HSN_CATALOGUE.map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const e of HSN_CATALOGUE) {
      expect(e.code).toMatch(/^\d{4}(\d{2})?$/);
      expect(e.kind === "service").toBe(e.code.startsWith("99"));
    }
  });

  it("recognises common services", () => {
    expect(top("Website development")).toBe("998314");
    expect(top("Consulting (per day)")).toBe("998311");
    expect(top("ERP implementation and support")).toBe("998313");
    expect(top("Annual maintenance contract - software")).toBe("998313");
    expect(top("Web hosting for 12 months")).toBe("998315");
    expect(top("Digital marketing retainer")).toBe("998361");
    expect(top("Logo design")).toBe("998391");
    expect(top("GST return filing")).toBe("998231");
    expect(top("Office rent - October")).toBe("997212");
    expect(top("Corporate training workshop")).toBe("999293");
    expect(top("Courier charges")).toBe("996812");
  });

  it("recognises common goods", () => {
    expect(top("Dell laptop i5")).toBe("8471");
    expect(top("Cotton fabric 60 inch")).toBe("5208");
    expect(top("Office chairs")).toBe("9401");
    expect(top("A4 paper ream")).toBe("4802");
  });

  it("prefers the item kind", () => {
    expect(top("Printing", "service")).toBe("998912");
  });

  it("puts the org's own past choices first", () => {
    const history = [{ name: "Odoo consulting retainer", hsnSac: "998313" }];
    const [first] = suggestHsn("Consulting retainer for Odoo", { history });
    expect(first).toMatchObject({ code: "998313", source: "history" });
  });

  it("stays quiet when the name says nothing", () => {
    expect(suggestHsn("")).toEqual([]);
    expect(autoHsn("Item 1")).toBeNull();
    expect(autoHsn("Website development")?.code).toBe("998314");
  });
});
