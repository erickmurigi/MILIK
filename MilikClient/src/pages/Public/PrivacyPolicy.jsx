import React from "react";

const Section = ({ title, children }) => (
  <section className="mb-8">
    <h2 className="text-lg font-black text-slate-900 mb-2">{title}</h2>
    <div className="text-sm leading-relaxed text-slate-700 space-y-3">{children}</div>
  </section>
);

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-[#0B3B2E] px-6 py-8">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-2xl font-black text-white">Milik Privacy Policy</h1>
          <p className="text-xs text-emerald-200 mt-1">Last updated: 15 October 2026</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10 bg-white">
        <Section title="Overview">
          <p>
            This Privacy Policy explains how Milik ("we", "us", "our") collects, uses, shares and
            protects information through the Milik business management platform, including the
            Milik mobile app and web application (together, the "Service"). Milik provides
            property management, car wash management, property sales, accounting, HR and
            inventory tools to businesses ("Customers") and their staff.
          </p>
          <p>
            Milik is business software: your organization (your employer or the business you work
            with) typically creates your account and controls what data is entered into the
            Service. If you are an end customer of a Milik Customer (for example, a tenant, car
            wash customer, or property buyer whose records are kept in the system by that
            business), your data is held on behalf of that business, which is responsible for its
            own use of the Service.
          </p>
        </Section>

        <Section title="Information We Collect">
          <p><strong>Account information.</strong> Name, phone number, email address, role and the business/company your account belongs to.</p>
          <p><strong>Business records entered into the Service.</strong> Depending on which Milik modules your business uses, this can include tenant and lease records, property and unit details, car wash customer and vehicle records, sales leads and deals, invoices, receipts, payment and M-Pesa transaction records, employee and HR records, and inventory/stock records.</p>
          <p><strong>Photos.</strong> With your permission, the app can use your device's camera or photo library to attach images to records (for example, property photos, vehicle condition photos, or receipts).</p>
          <p><strong>Device and usage information.</strong> Basic technical information such as device type, operating system version, and app version, collected automatically to keep the Service running reliably and to diagnose crashes.</p>
          <p>We do not collect precise location data, and the app does not use your microphone.</p>
        </Section>

        <Section title="How We Use Your Information">
          <ul className="list-disc pl-5 space-y-1">
            <li>Provide the Service: create and manage accounts, record and display business transactions, and generate invoices, receipts and reports.</li>
            <li>Send transactional SMS and notifications you or your business has configured (for example, payment confirmations, invoice reminders, or job status updates).</li>
            <li>Maintain accurate financial and operational records for the business that owns the account.</li>
            <li>Keep the Service secure, prevent fraud, and diagnose technical problems.</li>
            <li>Communicate with you about your account or respond to support requests.</li>
          </ul>
          <p>We do not sell personal information, and we do not use your data to show you advertising.</p>
        </Section>

        <Section title="Data Sharing & Third Parties">
          <p>We share information only as needed to run the Service:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Payment processing.</strong> Transactions made via M-Pesa are processed through Safaricom's payment infrastructure; M-Pesa transaction references and amounts are recorded in the Service.</li>
            <li><strong>SMS delivery.</strong> Transactional SMS messages are sent through a third-party SMS gateway provider on behalf of your business.</li>
            <li><strong>Hosting and infrastructure.</strong> Data is stored with cloud infrastructure and database providers who process it only to provide hosting and storage services to us.</li>
            <li><strong>Legal requirements.</strong> We may disclose information if required by law, regulation, or a valid legal process.</li>
          </ul>
          <p>We do not use any third-party advertising or analytics SDKs in the Milik app, and we do not share personal information with third parties for their own marketing purposes.</p>
        </Section>

        <Section title="Data Security">
          <p>
            All data sent between the Milik app and our servers is encrypted in transit
            (HTTPS/TLS). Account access requires authentication, and access to a business's data
            is restricted to authorized users of that business. No method of transmission or
            storage is 100% secure, and we cannot guarantee absolute security, but we take
            reasonable technical and organizational measures to protect your information against
            unauthorized access, loss, or misuse.
          </p>
        </Section>

        <Section title="Data Retention">
          <p>
            We retain account and business records for as long as the account is active, and
            afterward for as long as needed to meet legitimate business, accounting, and legal
            record-keeping requirements (for example, financial records may need to be retained
            for a statutory period after a transaction). When a business stops using the Service,
            its data is retained by us on its behalf unless and until that business requests
            deletion, subject to any retention we are legally required to keep.
          </p>
        </Section>

        <Section title="Your Rights & Account Deletion">
          <p>
            You may request access to, correction of, or deletion of your personal information by
            contacting us at the email below. Because Milik is business software, most data is
            entered and controlled by the business you work for or deal with; we will direct
            deletion requests about business records to that business where appropriate.
          </p>
          <p>
            To request deletion of your Milik account and associated personal data, email{" "}
            <strong>[support email — add your real contact here]</strong> with your name, phone
            number, and the business/company your account is under. We will confirm your identity
            and process deletion requests within a reasonable time, except for information we are
            required to retain by law.
          </p>
        </Section>

        <Section title="Children's Privacy">
          <p>
            The Service is intended for business use by adults and is not directed at children. We
            do not knowingly collect personal information from children under 18. If you believe a
            child has provided us with personal information, please contact us and we will take
            steps to delete it.
          </p>
        </Section>

        <Section title="Changes to This Policy">
          <p>
            We may update this Privacy Policy from time to time. The "last updated" date at the
            top of this page will reflect the most recent changes. Material changes will be
            communicated through the app or by other reasonable means.
          </p>
        </Section>

        <Section title="Contact Us">
          <p>If you have questions about this Privacy Policy or how your information is handled, contact us at:</p>
          <p className="font-bold">
            [Your company legal name — add here]<br />
            [support email — add here]<br />
            [physical/postal address — add here]
          </p>
        </Section>
      </div>
    </div>
  );
}
