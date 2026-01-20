/* pages/privacy.js
   Privacy Policy Page - GDPR Compliant Template
   
   Note: This is a template. Legal review recommended before production.
*/

import Head from "next/head";
import Link from "next/link";

export default function Privacy() {
  return (
    <>
      <Head>
        <title>Privacy Policy - FrostDesk</title>
        <meta
          name="description"
          content="FrostDesk Privacy Policy - How we collect, process, and protect your data."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
        <style>{`
          * {
            box-sizing: border-box;
          }
          body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #1a1a1a;
          }
          .container {
            max-width: 800px;
            margin: 0 auto;
            padding: 24px;
          }
          .content {
            background: white;
            border-radius: 16px;
            padding: 40px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            margin-top: 24px;
            line-height: 1.6;
          }
          .header {
            text-align: center;
            margin-bottom: 32px;
            color: white;
          }
          .header h1 {
            font-size: 36px;
            font-weight: 800;
            margin: 0 0 8px 0;
            text-shadow: 0 2px 4px rgba(0,0,0,0.2);
          }
          .header p {
            font-size: 18px;
            margin: 0;
            opacity: 0.9;
          }
          .back-link {
            display: inline-block;
            margin-bottom: 24px;
            color: white;
            text-decoration: none;
            font-weight: 600;
            opacity: 0.9;
          }
          .back-link:hover {
            opacity: 1;
          }
          h2 {
            color: #667eea;
            margin-top: 32px;
            margin-bottom: 16px;
            font-size: 24px;
          }
          h3 {
            color: #4a5568;
            margin-top: 24px;
            margin-bottom: 12px;
            font-size: 18px;
          }
          p {
            margin-bottom: 16px;
            color: #2d3748;
          }
          ul {
            margin-bottom: 16px;
            padding-left: 24px;
          }
          li {
            margin-bottom: 8px;
            color: #2d3748;
          }
          .last-updated {
            color: #718096;
            font-size: 14px;
            font-style: italic;
            margin-bottom: 24px;
          }
        `}</style>
      </Head>

      <div className="container">
        <div className="header">
          <Link href="/" className="back-link">
            ← Back to Home
          </Link>
          <h1>Privacy Policy</h1>
          <p>How we protect and process your data</p>
        </div>

        <div className="content">
          <p className="last-updated">Last updated: {new Date().toLocaleDateString()}</p>

          <h2>1. Introduction</h2>
          <p>
            FrostDesk ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy
            explains how we collect, use, disclose, and safeguard your information when you use our
            website and services.
          </p>

          <h2>2. Information We Collect</h2>
          <h3>2.1 Information You Provide</h3>
          <p>When you use our chat widget or contact us, we may collect:</p>
          <ul>
            <li>Messages and communications you send through our chat interface</li>
            <li>Instructor selection and preferences</li>
            <li>Thread identifiers stored locally in your browser</li>
          </ul>

          <h3>2.2 Automatically Collected Information</h3>
          <p>We may automatically collect certain information about your device and usage:</p>
          <ul>
            <li>IP address and location data</li>
            <li>Browser type and version</li>
            <li>Device information</li>
            <li>Usage patterns and interactions with our service</li>
          </ul>

          <h2>3. How We Use Your Information</h2>
          <p>We use the collected information for the following purposes:</p>
          <ul>
            <li>To provide and maintain our chat and booking services</li>
            <li>To process your requests and connect you with instructors</li>
            <li>To improve our services and user experience</li>
            <li>To monitor and analyze usage patterns</li>
            <li>To detect, prevent, and address technical issues</li>
            <li>To comply with legal obligations</li>
          </ul>

          <h2>4. Data Processing and Legal Basis</h2>
          <p>
            We process your personal data based on the following legal bases under GDPR:
          </p>
          <ul>
            <li>
              <strong>Legitimate Interest:</strong> To provide and improve our services, ensure security,
              and prevent fraud
            </li>
            <li>
              <strong>Consent:</strong> When you voluntarily provide information through our chat interface
            </li>
            <li>
              <strong>Contractual Necessity:</strong> To fulfill our obligations in connecting you with
              instructors
            </li>
          </ul>

          <h2>5. Data Sharing and Disclosure</h2>
          <p>We may share your information in the following circumstances:</p>
          <ul>
            <li>
              <strong>With Instructors:</strong> Your messages and booking requests are shared with the
              selected instructor to facilitate lesson booking
            </li>
            <li>
              <strong>Service Providers:</strong> We may share data with third-party service providers who
              assist in operating our platform (e.g., hosting, analytics)
            </li>
            <li>
              <strong>Legal Requirements:</strong> When required by law or to protect our rights and safety
            </li>
          </ul>
          <p>
            We do not sell your personal information to third parties.
          </p>

          <h2>6. Data Retention</h2>
          <p>
            We retain your personal data only for as long as necessary to fulfill the purposes outlined in
            this Privacy Policy, unless a longer retention period is required or permitted by law. Chat
            messages and thread data are typically retained for the duration of the booking process and
            may be retained for up to 12 months for service improvement purposes.
          </p>

          <h2>7. Your Rights Under GDPR</h2>
          <p>If you are located in the European Economic Area (EEA), you have the following rights:</p>
          <ul>
            <li>
              <strong>Right to Access:</strong> Request a copy of the personal data we hold about you
            </li>
            <li>
              <strong>Right to Rectification:</strong> Request correction of inaccurate or incomplete data
            </li>
            <li>
              <strong>Right to Erasure:</strong> Request deletion of your personal data ("right to be
              forgotten")
            </li>
            <li>
              <strong>Right to Restrict Processing:</strong> Request limitation of how we process your data
            </li>
            <li>
              <strong>Right to Data Portability:</strong> Receive your data in a structured, machine-readable
              format
            </li>
            <li>
              <strong>Right to Object:</strong> Object to processing of your personal data
            </li>
            <li>
              <strong>Right to Withdraw Consent:</strong> Withdraw consent at any time where processing is
              based on consent
            </li>
          </ul>
          <p>
            To exercise these rights, please contact us using the information provided in the Contact
            section below.
          </p>

          <h2>8. Cookies and Local Storage</h2>
          <p>
            We use browser local storage to maintain chat thread continuity and remember your instructor
            selection. This data is stored locally on your device and is not transmitted to our servers
            except as part of your chat messages.
          </p>
          <p>
            We do not currently use cookies for tracking or analytics. If this changes, we will update
            this policy and provide appropriate consent mechanisms.
          </p>

          <h2>9. Data Security</h2>
          <p>
            We implement appropriate technical and organizational measures to protect your personal data
            against unauthorized access, alteration, disclosure, or destruction. However, no method of
            transmission over the Internet or electronic storage is 100% secure.
          </p>

          <h2>10. International Data Transfers</h2>
          <p>
            Your information may be transferred to and processed in countries other than your country of
            residence. We ensure that appropriate safeguards are in place to protect your data in accordance
            with this Privacy Policy and applicable data protection laws.
          </p>

          <h2>11. Children's Privacy</h2>
          <p>
            Our service is not intended for individuals under the age of 18. We do not knowingly collect
            personal information from children. If you believe we have collected information from a child,
            please contact us immediately.
          </p>

          <h2>12. Changes to This Privacy Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of any changes by
            posting the new Privacy Policy on this page and updating the "Last updated" date. You are
            advised to review this Privacy Policy periodically for any changes.
          </p>

          <h2>13. Contact Us</h2>
          <p>
            If you have any questions about this Privacy Policy or wish to exercise your rights, please
            contact us:
          </p>
          <ul>
            <li>Email: [Your contact email]</li>
            <li>Website: [Your website URL]</li>
          </ul>
          <p>
            <strong>Note:</strong> Please update the contact information above with your actual contact
            details before going to production.
          </p>
        </div>
      </div>
    </>
  );
}
