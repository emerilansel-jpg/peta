import { RedditLegalLayout } from '../components/RedditLegalLayout';

export function PrivacyPage() {
  return (
    <RedditLegalLayout title="Privacy Policy">
      <p>
        This Privacy Policy explains how Straight Ltd collects, uses, and protects your personal information when you use our website and services.
      </p>

      <h2>1. Information We Collect</h2>
      <p>
        We collect information you provide directly, such as your name, email address, and any optional website or role information during signup.
        We also collect data about your orders, credit balance, and support conversations.
      </p>
      <p>
        When you place an order, we store the target URL, service type, quantity, and delivery status necessary to fulfill the order.
      </p>

      <h2>2. How We Use Your Information</h2>
      <p>
        We use your information to provide and improve our services, process orders, communicate with you about your orders,
        send transactional emails, and detect fraud or abuse.
      </p>
      <p>
        We do not sell your personal information to third parties. We may share information with service providers who help us operate the platform,
        such as payment processors (PayPal) and cloud hosting providers, under strict confidentiality obligations.
      </p>

      <h2>3. Cookies & Analytics</h2>
      <p>
        We use essential cookies to keep you signed in and maintain your session. We may use analytics tools to understand how visitors use our site
        and improve the user experience. You can disable non-essential cookies through your browser settings.
      </p>

      <h2>4. Data Security</h2>
      <p>
        We use industry-standard encryption and access controls to protect your data. Passwords are stored using secure hashing.
        Credit card data is never stored on our servers; all payments are processed securely by PayPal.
      </p>

      <h2>5. Data Retention</h2>
      <p>
        We retain your account information and order history for as long as your account is active or as needed to provide services,
        comply with legal obligations, resolve disputes, and enforce our agreements.
      </p>

      <h2>6. Your Rights</h2>
      <p>
        You may access, update, or delete your account information by contacting us. Depending on your jurisdiction, you may have additional rights
        regarding your personal data.
      </p>

      <h2>7. Children's Privacy</h2>
      <p>
        Our services are not intended for individuals under the age of 18. We do not knowingly collect personal information from children.
      </p>

      <h2>8. Changes</h2>
      <p>
        We may update this Privacy Policy from time to time. We will notify you of significant changes by posting the updated policy on our website.
      </p>

      <h2>9. Contact</h2>
      <p>
        For privacy-related questions, contact us at{' '}
        <a href="mailto:care@straight.ltd">care@straight.ltd</a>.
      </p>
    </RedditLegalLayout>
  );
}
