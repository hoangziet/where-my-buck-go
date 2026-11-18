import { LegalPage } from "@/components/LegalPage";

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy notice">
      <section className="flex flex-col gap-3">
        <h2>Information this app handles</h2>
        <p>Where My Buck Go stores the account details you provide, your chat messages, transaction records, and receipt images you submit. The app uses session cookies to keep you signed in and protect requests. Do not submit information that you do not want processed as part of your personal finance records.</p>
      </section>
      <section className="flex flex-col gap-3">
        <h2>How information is used</h2>
        <p>Your information is used to provide chat, receipt extraction, transaction history, and reports. When you use AI features, relevant message text or receipt images are sent to Google Gemini for processing. Gemini results can be inaccurate; review them before confirming a transaction.</p>
        <p>If you connect a personal Telegram bot, messages sent to the paired private chat are processed by this app and Telegram. The bot token is stored encrypted and is used to receive bot updates and send replies. Disconnecting the bot removes the saved connection and webhook.</p>
      </section>
      <section className="flex flex-col gap-3">
        <h2>Storage and service providers</h2>
        <p>The service uses a hosted application, database, and object storage infrastructure to operate. These providers process information only as needed to host and secure the service. We do not sell personal information or use it for third-party advertising.</p>
      </section>
      <section className="flex flex-col gap-3">
        <h2>Retention and your choices</h2>
        <p>Records remain stored so the app can provide transaction history. You can delete chats and manage transactions from the app. A receipt connected to a saved transaction may remain with that transaction. To ask about access, correction, or deletion of account data, contact <a className="text-accent underline" href="mailto:hoangziet22@gmail.com">hoangziet22@gmail.com</a>.</p>
      </section>
      <section className="flex flex-col gap-3">
        <h2>Changes and contact</h2>
        <p>This notice may be updated as the product changes. For privacy questions, contact <a className="text-accent underline" href="mailto:hoangziet22@gmail.com">hoangziet22@gmail.com</a>.</p>
      </section>
    </LegalPage>
  );
}
