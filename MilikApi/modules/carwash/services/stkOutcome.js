// What happened to an STK push, in words a cashier can act on. The push itself is accepted by Safaricom straight away
// ("request sent"); the real result (prompt shown, PIN entered, refused) arrives later on the callback, so the screen has to
// ask for it.
const FAILURES = {
  1: "The customer's M-Pesa balance is too low.",
  1032: "The customer cancelled the request on their phone.",
  1037: "The customer's phone did not respond (it may be off, out of coverage, or the prompt timed out). Try again.",
  2001: "The customer entered the wrong M-Pesa PIN.",
  17: "M-Pesa refused the request (transaction limit or a rule on the customer's account).",
};

/**
 * @param {object|null} notification the CarWashMpesaNotification for a CheckoutRequestID
 * @returns {{ state: "pending"|"paid"|"failed"|"unknown", message: string, shortCode?: string, resultCode?: number }}
 */
export const describeStkOutcome = (notification) => {
  if (!notification) return { state: "unknown", message: "No record of this request was found." };
  const shortCode = String(notification.shortCode || "");
  const raw = notification.rawPayload?.Body?.stkCallback;
  const resultCode = Number(notification.resultCode ?? raw?.ResultCode);
  const base = { shortCode, resultCode: Number.isFinite(resultCode) ? resultCode : undefined };

  if (notification.status === "stk_pending") return { ...base, state: "pending", message: "Waiting for the customer to enter their PIN." };
  if (["matched", "paid", "duplicate", "unmatched"].includes(notification.status) && (resultCode === 0 || !Number.isFinite(resultCode))) {
    return { ...base, state: "paid", message: "Payment received." };
  }
  if (notification.status === "error") {
    if (resultCode === 4999 || /wrong credentials/i.test(String(notification.resultDesc))) {
      return {
        ...base,
        state: "failed",
        message: `M-Pesa rejected the credentials for paybill ${shortCode}, so no prompt was sent. An admin must re-check that paybill's consumer key, consumer secret and passkey in Setup → M-Pesa.`,
      };
    }
    if (FAILURES[resultCode]) return { ...base, state: "failed", message: FAILURES[resultCode] };
    return { ...base, state: "failed", message: notification.resultDesc || "The M-Pesa request failed." };
  }
  return { ...base, state: "unknown", message: notification.resultDesc || "Status unknown." };
};
