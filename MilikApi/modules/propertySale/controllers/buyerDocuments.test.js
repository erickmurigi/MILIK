// KYC document upload/removal — the new real-file replacement for the old free-text kycDocuments
// labels. multer itself isn't exercised here (third-party, already proven elsewhere); req.files is
// supplied directly, exactly as buyerDocumentUpload middleware would hand it to the controller.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, it, expect, afterAll } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestUser } from "../../../test/factories.js";
import SaleBuyer from "../models/SaleBuyer.js";
import { uploadBuyerDocuments, removeBuyerDocument } from "./buyersController.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.resolve(__dirname, "../../../uploads/sale-buyers");

const fakeFile = (overrides = {}) => ({
  filename: `test-${Math.random().toString(36).slice(2)}.pdf`,
  originalname: "National ID.pdf",
  size: 12_345,
  mimetype: "application/pdf",
  ...overrides,
});

describe("buyer KYC document upload/removal", () => {
  afterAll(() => {
    // Clean up any stray files this suite's "successful upload" tests wrote to disk
    if (fs.existsSync(UPLOAD_DIR)) {
      for (const f of fs.readdirSync(UPLOAD_DIR)) {
        if (f.startsWith("test-")) fs.unlinkSync(path.join(UPLOAD_DIR, f));
      }
    }
  });

  const setup = async () => {
    const company = await createTestCompany({ modules: { propertySale: true } });
    const user = await createTestUser({ company });
    const business = company._id;
    const call = (fn, opts = {}) => callController(fn, { user, ...opts });
    const buyer = await SaleBuyer.create({ business, buyerNumber: "BYR-1", fullName: "Jane Buyer", phone: "0711000111" });
    return { business, call, buyer };
  };

  it("uploads real files into kycFiles, leaving legacy kycDocuments untouched", async () => {
    const { call, buyer } = await setup();
    const file = fakeFile();
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, file.filename), "dummy pdf bytes");

    const res = await call(uploadBuyerDocuments, { params: { id: String(buyer._id) }, files: [file] });
    expect(res.statusCode).toBe(200);
    expect(res.payload.documents).toHaveLength(1);
    expect(res.payload.documents[0]).toMatchObject({ name: "National ID.pdf", size: 12_345, url: `/uploads/sale-buyers/${file.filename}` });

    const reloaded = await SaleBuyer.findById(buyer._id).lean();
    expect(reloaded.kycFiles).toHaveLength(1);
    expect(reloaded.kycDocuments).toEqual([]);
  });

  it("rejects an upload with no files", async () => {
    const { call, buyer } = await setup();
    await expect(
      call(uploadBuyerDocuments, { params: { id: String(buyer._id) }, files: [] })
    ).rejects.toThrow(/no valid documents/i);
  });

  it("404s for a buyer that doesn't exist, and discards the already-written file", async () => {
    const { call } = await setup();
    const file = fakeFile();
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const filePath = path.join(UPLOAD_DIR, file.filename);
    fs.writeFileSync(filePath, "dummy pdf bytes");

    await expect(
      call(uploadBuyerDocuments, { params: { id: "000000000000000000000000" }, files: [file] })
    ).rejects.toThrow(/buyer not found/i);
    expect(fs.existsSync(filePath)).toBe(false); // discardUploads cleaned it up
  });

  it("removes a document by url and deletes its file from disk", async () => {
    const { call, buyer } = await setup();
    const file = fakeFile();
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const filePath = path.join(UPLOAD_DIR, file.filename);
    fs.writeFileSync(filePath, "dummy pdf bytes");

    const uploaded = await call(uploadBuyerDocuments, { params: { id: String(buyer._id) }, files: [file] });
    const url = uploaded.payload.documents[0].url;
    expect(fs.existsSync(filePath)).toBe(true);

    const res = await call(removeBuyerDocument, { params: { id: String(buyer._id) }, body: { url } });
    expect(res.statusCode).toBe(200);
    expect(res.payload.documents).toHaveLength(0);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("404s removing a document url that isn't on this buyer", async () => {
    const { call, buyer } = await setup();
    await expect(
      call(removeBuyerDocument, { params: { id: String(buyer._id) }, body: { url: "/uploads/sale-buyers/nonexistent.pdf" } })
    ).rejects.toThrow(/document not found/i);
  });
});
