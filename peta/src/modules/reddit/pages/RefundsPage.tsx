import { RedditLegalLayout } from '../components/RedditLegalLayout';

export function RefundsPage() {
  return (
    <RedditLegalLayout title="Refund Policy">
      <p>
        We want you to be confident using Straight Ltd. This Refund Policy explains when you are eligible for a refund and how to request one.
      </p>

      <h2>1. Credit Balance Refunds</h2>
      <p>
        Unused credits in your account balance may be refunded within 30 days of the original purchase date. Refunds are issued to the original PayPal account
        used for the top-up. Please allow up to 24 business hours for processing after approval.
      </p>

      <h2>2. Order Refunds</h2>
      <p>
        Completed orders are generally non-refundable. You may be eligible for a refund if:
      </p>
      <ul>
        <li>We fail to deliver the ordered service entirely.</li>
        <li>Your order was cancelled before work began.</li>
        <li>There was a duplicate charge or technical error on our side.</li>
      </ul>
      <p>
        If work has already started or the service has been delivered, a refund may not be possible. We may offer credit instead in some cases.
      </p>

      <h2>3. Drop Replacement Guarantee</h2>
      <p>
        For upvote orders, if retention falls below 95% within the first 7 days, we will replace dropped upvotes at no additional cost.
        Contact us with your order ID to claim a replacement.
      </p>

      <h2>4. How to Request a Refund</h2>
      <p>
        To request a refund, contact us at{' '}
        <a href="mailto:care@straight.ltd">care@straight.ltd</a>{' '}
        with your order ID or PayPal transaction details. We review each request and respond within 2 business days.
      </p>

      <h2>5. Non-Refundable Cases</h2>
      <p>
        Refunds are not provided for orders that were delivered as described, orders cancelled after work began, or issues caused by the target platform
        removing or restricting the target content after delivery started.
      </p>

      <h2>6. Changes</h2>
      <p>
        We may update this policy from time to time. The version posted on this page is the current policy.
      </p>
    </RedditLegalLayout>
  );
}
