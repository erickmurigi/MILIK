import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Photo handling shared by the sales forms (listing, project).
 *  - Before the record exists (no entityId) picked files are staged locally as previews and uploaded by uploadStaged()
 *    right after the record is created.
 *  - Once it exists, picked files upload immediately and deletes happen immediately.
 * `upload(id, formData)` and `remove(id, url)` must resolve to `{ images }` (the record's full photo list), which
 * becomes the saved list, so the form never depends on a list refetch to show the photos.
 * `onChanged` runs after any change so the caller can refresh its lists.
 */
export default function useSalePhotoDraft({ entityId, initialImages = [], upload, remove, onChanged }) {
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
      valid.forEach((f) => fd.append("images", f));
      const res = await upload(entityId, fd);
      if (res?.images) setSaved(res.images);
      await onChanged?.();
      toast.success(`${valid.length} photo${valid.length > 1 ? "s" : ""} uploaded`);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }, [entityId, upload, onChanged]);

  const removeStaged = useCallback((preview) => {
    URL.revokeObjectURL(preview);
    setStaged((prev) => prev.filter((f) => f.preview !== preview));
  }, []);

  const deleteSaved = useCallback(async (url) => {
    if (!entityId) return;
    setBusy(true);
    try {
      const res = await remove(entityId, url);
      if (res?.images) setSaved(res.images);
      await onChanged?.();
      toast.success("Photo removed");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to remove photo");
    } finally {
      setBusy(false);
    }
  }, [entityId, remove, onChanged]);

  // Upload the staged previews to a record that was just created. A failure here is not fatal: the record exists.
  const uploadStaged = useCallback(async (newId) => {
    const files = stagedRef.current;
    if (!files.length || !newId) return;
    try {
      const fd = new FormData();
      files.forEach(({ file }) => fd.append("images", file));
      const res = await upload(newId, fd);
      if (res?.images) setSaved(res.images);
    } catch {
      toast.warning("Saved, but the photos could not be uploaded — add them again from the edit form");
    }
    clearStaged();
  }, [upload, clearStaged]);

  return { saved, staged, busy, addFiles, removeStaged, deleteSaved, uploadStaged, clearStaged };
}
