import { LegalPage } from "@/components/LegalPage";

export default function ContactPage() {
  return (
    <LegalPage title="Contact">
      <section className="flex flex-col gap-3">
        <h2>Get in touch</h2>
        <p>For product questions, privacy requests, or help with your account, email:</p>
        <p><a className="text-accent underline" href="mailto:hoangziet22@gmail.com">hoangziet22@gmail.com</a></p>
      </section>
    </LegalPage>
  );
}
