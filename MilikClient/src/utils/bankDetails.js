// Shared bank-detail constants for the landlord, service-provider and payment-voucher forms.

// Banks commonly used in Kenya. Banks added in a form, and banks already on other records,
// are offered alongside these.
export const KENYAN_BANKS = [
  "ABSA Bank Kenya",
  "Access Bank Kenya",
  "Bank of Africa Kenya",
  "Bank of Baroda Kenya",
  "Bank of India Kenya",
  "Citibank Kenya",
  "Co-operative Bank of Kenya",
  "Consolidated Bank of Kenya",
  "Credit Bank",
  "Diamond Trust Bank",
  "Ecobank Kenya",
  "Equity Bank",
  "Family Bank",
  "First Community Bank",
  "Guardian Bank",
  "Gulf African Bank",
  "I&M Bank",
  "KCB Bank",
  "Prime Bank",
  "NCBA Bank",
  "National Bank of Kenya",
  "Sidian Bank",
  "Spire Bank",
  "Stanbic Bank Kenya",
  "Standard Chartered Kenya",
  "Victoria Commercial Bank",
];

export const bankInputClass = (hasError = false) =>
  `h-7 w-full border bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-500 outline-none transition focus:ring-1 ${
    hasError
      ? "border-red-500 focus:border-red-500 focus:ring-red-500/20"
      : "border-slate-300 focus:border-[#0B3B2E] focus:ring-[#0B3B2E]/20"
  }`;

export const bankLabelClass = "mb-1 block text-xs font-bold text-slate-900";
