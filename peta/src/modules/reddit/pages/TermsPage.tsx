import { RedditLegalLayout } from '../components/RedditLegalLayout';

export function TermsPage() {
  return (
    <RedditLegalLayout title="Terms of Service">
      <p>
        Welcome to Straight Ltd. These Terms of Service govern your use of our website, dashboard, and services.
        By creating an account or placing an order, you agree to these terms. If you do not agree, please do not use our services.
      </p>

      <h2>1. Services</h2>
      <p>
        Straight Ltd provides engagement services for Reddit and other public forums, including upvotes and comments.
        All services are delivered by real, aged accounts operated by our network. We do not use bots or throwaway accounts.
      </p>
      <p>
        We reserve the right to refuse any order that violates the target platform's terms of service, promotes illegal content,
        or targets private communities, hate speech, harassment, or spam.
      </p>

      <h2>2. Accounts & Credits</h2>
      <p>
        You must provide accurate information when creating an account. You are responsible for maintaining the confidentiality of your password.
        Credits are purchased in USD via PayPal and are stored in your account balance. Credits do not expire while your account is active.
      </p>
      <p>
        Credits are deducted when an order is placed, not when delivery is completed. Cancelled orders may be refunded to your credit balance
        at our discretion, unless the work has already started or been completed.
      </p>

      <h2>3. Orders & Delivery</h2>
      <p>
        Orders are placed through the dashboard by submitting a target URL and selecting a quantity. Delivery typically begins within 6 hours,
        but we do not guarantee delivery times. You can track order status in your dashboard.
      </p>
      <p>
        You are responsible for ensuring the target URL is public, accessible, and compliant with the target platform's rules.
        We are not liable if the target post or account is removed, restricted, or banned by the platform.
      </p>

      <h2>4. Prohibited Use</h2>
      <p>
        You may not use our services to manipulate votes or comments in a way that violates applicable laws or the target platform's terms.
        You may not submit shortened URLs, private community links, or URLs to illegal, fraudulent, or harmful content.
      </p>

      <h2>5. Refunds</h2>
      <p>
        Unused credits may be refunded within 30 days of purchase. Completed orders are non-refundable unless we fail to deliver.
        Refunds are processed to the original PayPal account within 24 business hours when approved.
      </p>

      <h2>6. Limitation of Liability</h2>
      <p>
        Straight Ltd is provided "as is" without warranties of any kind. To the maximum extent permitted by law, our liability is limited
        to the amount you paid for the specific order in question.
      </p>

      <h2>7. Changes</h2>
      <p>
        We may update these terms from time to time. Continued use of the service after changes constitutes acceptance of the updated terms.
      </p>

      <h2>8. Contact</h2>
      <p>
        For questions about these terms, contact us at{' '}
        <a href="mailto:care@straight.ltd">care@straight.ltd</a>.
      </p>
    </RedditLegalLayout>
  );
}
