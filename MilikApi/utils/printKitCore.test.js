// The print engine core lives in the client and the API (the API renders the PDFs with it). They must stay identical.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { amountInWords, documentPageHtml, listPageHtml } from "./printKitCore.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientCopy = path.resolve(here, "../../MilikClient/src/utils/printKitCore.js");

describe("print kit core", () => {
  it.skipIf(!fs.existsSync(clientCopy))("is identical to the client copy", () => {
    const norm = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
    expect(norm(path.join(here, "printKitCore.js"))).toBe(norm(clientCopy));
  });

  it("writes amounts in words", () => {
    expect(amountInWords(1250.5)).toBe("Kenya Shillings One Thousand Two Hundred and Fifty and Fifty Cents Only");
    expect(amountInWords(21000)).toBe("Kenya Shillings Twenty-One Thousand Only");
    expect(amountInWords(0)).toBe("Kenya Shillings Zero Only");
    expect(amountInWords(1_000_001, "USD")).toBe("US Dollars One Million One Only");
  });

  it("escapes everything a user can type and always carries the Powered by Milik stamp", () => {
    const html = documentPageHtml({
      company: { companyName: "<script>alert(1)</script> Ltd", logo: "javascript:alert(1)" },
      docType: "Receipt", docNumber: "R-1",
      parties: [{ heading: "From", name: "\"><img src=x onerror=alert(1)>" }],
      table: { columns: [{ label: "Item", value: (r) => r }], rows: ["<b>x</b>"] },
    });
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("javascript:alert");
    expect(html).toContain("Powered by");
    expect(listPageHtml({ title: "T", columns: [], rows: [] })).toContain("Powered by");
  });
});
