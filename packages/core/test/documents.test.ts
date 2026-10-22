import { describe, expect, it } from "vitest";
import { addDays, amountInWords, financialYear, formatDocumentNumber, paymentStatus } from "../src";

describe("documents", () => {
  it("labels financial years from April", () => {
    expect(financialYear("2026-10-22")).toBe("2026-27");
    expect(financialYear("2027-03-31")).toBe("2026-27");
    expect(financialYear("2027-04-01")).toBe("2027-28");
    expect(financialYear("2099-12-01")).toBe("2099-00");
    expect(financialYear("2026-10-22", 1)).toBe("2026");
  });

  it("formats GST-compliant document numbers", () => {
    expect(formatDocumentNumber("INV", "2026-27", 7)).toBe("INV/26-27/0007");
    expect(formatDocumentNumber("BILL", "2026-27", 12)).toBe("BILL/26-27/0012");
    expect(() => formatDocumentNumber("PURCHASE", "2026-27", 1)).toThrow(/16 characters/);
  });

  it("writes amounts in Indian words", () => {
    expect(amountInWords(0)).toBe("Rupees Zero Only");
    expect(amountInWords(118000)).toBe("Rupees One Thousand One Hundred Eighty Only");
    expect(amountInWords(12_34_56_789_05)).toBe(
      "Rupees Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine and Five Paise Only",
    );
    expect(amountInWords(10_00_000_00)).toBe("Rupees Ten Lakh Only");
  });

  it("derives payment status and due dates", () => {
    expect(paymentStatus(1000, 0)).toBe("unpaid");
    expect(paymentStatus(1000, 400)).toBe("partial");
    expect(paymentStatus(1000, 1000)).toBe("paid");
    expect(addDays("2026-10-22", 15)).toBe("2026-11-06");
    expect(addDays("2027-02-20", 10)).toBe("2027-03-02");
  });
});
