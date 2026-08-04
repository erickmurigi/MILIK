/** Returns true if a payment record is a confirmed, non-cancelled, non-reversed receipt */
export const isActiveReceipt = (payment) => {
  const postingStatus = String(payment?.postingStatus || "").toLowerCase();
  return (
    payment?.ledgerType === "receipts" &&
    payment?.isConfirmed === true &&
    payment?.isCancelled !== true &&
    payment?.isReversed !== true &&
    !payment?.reversalOf &&
    postingStatus !== "reversed"
  );
};
