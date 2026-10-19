import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * File-draft handling shared by the sales forms (listing/project photos, buyer KYC documents).
 *  - Before the record exists (no entityId) picked files are staged locally as previews and uploaded by uploadStaged()
 *    right after the record is created.
 *  - Once it exists, picked files upload immediately and deletes happen immediately.
 * `upload(id, formData)` and `remove(id, url)` must resolve to `{ [responseKey]: [...] }` (the record's full
 * file list), which becomes the saved list, so the form never depends on a list refetch to show them.
 * `onChanged` runs after any change so the caller can refresh its lists.
 * `itemLabel`/`responseKey` default to the original photo wording — pass itemLabel="document",
 * responseKey="documents" etc. for a non-photo caller instead of duplicating this whole hook.
 */
export default function useSalePhotoDraft({ entityId, initialImages = [], upload, remove, onChanged, itemLabel = "photo", responseKey = "images", fieldName = "images" }) {
  const [saved, setSaved] = useState(initialImages);
  const [staged, setStaged] = useState([]); // Array<{ file: File, preview: string }>
  const [busy, setBusy] = useState(false);

  // Object URLs are revoked on unmount so abandoned previews don't leak
  const stagedRef = useRef(staged);
  useEffect(() => { stagedRef.current = staged; }, [staged]);
  useEffect(() => () => stagedRef.current.forEach(({ preview }) => URL.revokeObjectURL(preview)), []);

  const clearStaged = useCallback(() => {
    stagedRef.current.forEach(({ preview }) => URL.revokeObjectURL(preview));
    setStaged([]);
  }, []);

  const addFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const valid = files.filter((f) => f.size <= MAX_BYTES);
    if (valid.length < files.length) toast.warning(`${files.length - valid.length} file(s) exceed 10 MB and were skipped`);
    if (!valid.length) return;

    if (!entityId) {
      setStaged((prev) => [...prev, ...valid.map((f) => ({ file: f, preview: URL.createObjectURL(f) }))]);
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      valid.forEach((f) => fd.append(fieldName, f));
      const res = await upload(entityId, fd);
      if (res?.[responseKey]) setSaved(res[responseKey]);
      await onChanged?.();
      toast.success(`${valid.length} ${itemLabel}${valid.length > 1 ? "s" : ""} uploaded`);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }, [entityId, upload, onChanged, fieldName, responseKey, itemLabel]);

  const removeStaged = useCallback((preview) => {
    URL.revokeObjectURL(preview);
    setStaged((prev) => prev.filter((f) => f.preview !== preview));
  }, []);

  const deleteSaved = useCallback(async (url) => {
    if (!entityId) return;
    setBusy(true);
    try {
      const res = await remove(entityId, url);
      if (res?.[responseKey]) setSaved(res[responseKey]);
      await onChanged?.();
      toast.success(`${itemLabel.charAt(0).toUpperCase()}${itemLabel.slice(1)} removed`);
    } catch (err) {
      toast.error(err?.response?.data?.message || `Failed to remove ${itemLabel}`);
    } finally {
      setBusy(false);
    }
  }, [entityId, remove, onChanged, responseKey, itemLabel]);

  // Upload the staged previews to a record that was just created. A failure here is not fatal: the record exists.
  const uploadStaged = useCallback(async (newId) => {
    const files = stagedRef.current;
    if (!files.length || !newId) return;
    try {
      const fd = new FormData();
      files.forEach(({ file }) => fd.append(fieldName, file));
      const res = await upload(newId, fd);
      if (res?.[responseKey]) setSaved(res[responseKey]);
    } catch {
      toast.warning(`Saved, but the ${itemLabel}s could not be uploaded — add them again from the edit form`);
    }
    clearStaged();
  }, [upload, clearStaged, fieldName, responseKey, itemLabel]);

  return { saved, staged, busy, addFiles, removeStaged, deleteSaved, uploadStaged, clearStaged };
}
