import { LegalPage } from "@/components/LegalPage";

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use">
      <section className="flex flex-col gap-3">
        <h2>What the service does</h2>
        <p>Where My Buck Go is a personal tool for recording expenses and income, reviewing receipt data, and viewing summaries. It is not a bank, accounting service, tax adviser, or financial adviser. The app does not provide professional financial, tax, or legal advice.</p>
      </section>
      <section className="flex flex-col gap-3">
        <h2>Review AI suggestions</h2>
        <p>AI-generated descriptions, amounts, categories, dates, and answers can be incomplete or wrong. You are responsible for reviewing each proposed transaction and confirming only records that are accurate. A draft is not saved to your ledger until you explicitly confirm it.</p>
      </section>
      <section className="flex flex-col gap-3">
        <h2>Your account and use</h2>
        <p>Keep your sign-in details and connected Telegram bot token secure. Use the service only with information you are authorized to submit, and do not attempt to disrupt, probe, or gain unauthorized access to the service or another person&apos;s data.</p>
      </section>
      <section className="flex flex-col gap-3">
        <h2>Availability and changes</h2>
        <p>The service is provided as-is and may change, be interrupted, or become unavailable. Keep your own copies of information that you need independently of the app. These terms may be updated as the service evolves; continued use after an update means you accept the revised terms.</p>
      </section>
      <section className="flex flex-col gap-3">
        <h2>Contact</h2>
        <p>Questions about these terms can be sent to <a className="text-accent underline" href="mailto:hoangziet22@gmail.com">hoangziet22@gmail.com</a>.</p>
      </section>
    </LegalPage>
  );
}
