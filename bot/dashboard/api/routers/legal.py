from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

router = APIRouter(prefix="/legal", tags=["legal"])

LEGAL_CSS = """
:root {
  --bg: #0a0a0a;
  --surface: #1a1a1a;
  --border: rgba(255,255,255,0.08);
  --text-primary: #f5f5f5;
  --text-secondary: #a0a0a0;
  --text-muted: #6b6b6b;
  --accent: #5b8def;
  --accent-dim: rgba(91,141,239,0.12);
  --radius: 12px;
  --font-sans: 'Geist Sans', system-ui, -apple-system, sans-serif;
  --font-mono: 'Geist Mono', monospace;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  background: var(--bg);
  color: var(--text-primary);
  font-family: var(--font-sans);
  line-height: 1.7;
  min-height: 100vh;
}
.container {
  max-width: 780px;
  margin: 0 auto;
  padding: 48px 24px 96px;
}
.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 40px;
  text-decoration: none;
  color: inherit;
}
.logo-mark {
  width: 36px;
  height: 36px;
  background: var(--accent);
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 14px;
  color: #fff;
}
.logo-text {
  font-size: 18px;
  font-weight: 600;
}
h1 {
  font-size: 28px;
  font-weight: 700;
  margin-bottom: 8px;
  letter-spacing: -0.5px;
}
.last-updated {
  color: var(--text-muted);
  font-size: 13px;
  margin-bottom: 36px;
}
h2 {
  font-size: 18px;
  font-weight: 600;
  margin: 36px 0 12px;
  color: var(--text-primary);
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
h3 {
  font-size: 15px;
  font-weight: 600;
  margin: 24px 0 8px;
  color: var(--text-secondary);
}
p {
  margin-bottom: 14px;
  color: var(--text-secondary);
  font-size: 14px;
}
ul, ol {
  margin: 0 0 14px 20px;
  color: var(--text-secondary);
  font-size: 14px;
}
li { margin-bottom: 6px; }
a {
  color: var(--accent);
  text-decoration: none;
}
a:hover { text-decoration: underline; }
.placeholder-notice {
  background: rgba(234,179,8,0.1);
  border: 1px solid rgba(234,179,8,0.2);
  border-radius: var(--radius);
  padding: 12px 16px;
  margin-bottom: 32px;
  font-size: 13px;
  color: #facc15;
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.placeholder-notice-icon { font-size: 18px; flex-shrink: 0; }
.nav-links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  margin-top: 48px;
  padding-top: 20px;
  border-top: 1px solid var(--border);
}
.nav-links a {
  font-size: 13px;
  color: var(--text-muted);
  transition: color 0.2s;
}
.nav-links a:hover { color: var(--text-primary); text-decoration: none; }
.nav-links a.active { color: var(--accent); }
footer {
  margin-top: 16px;
  font-size: 12px;
  color: var(--text-muted);
}
@media (max-width: 640px) {
  .container { padding: 32px 16px 80px; }
  h1 { font-size: 24px; }
  h2 { font-size: 16px; }
}
"""


def legal_page(title: str, last_updated: str, content: str, active_page: str = "") -> str:
    pages = [
        ("/legal/tos", "Terms of Service"),
        ("/legal/privacy", "Privacy Policy"),
        ("/legal/cookies", "Cookie Policy"),
        ("/legal/disclaimer", "Disclaimer"),
        ("/legal/refund", "Refund Policy"),
        ("/legal/contact", "Contact"),
        ("/legal/data-deletion", "Data Deletion"),
        ("/legal/aup", "Acceptable Use Policy"),
    ]
    nav = "\n".join(
        f'      <a href="{url}" class="{"active" if url == active_page else ""}">{label}</a>'
        for url, label in pages
    )
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0a0a0a">
<meta name="description" content="{title} — MadarBot">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://madar.hamedco.com{active_page}">
<meta property="og:title" content="{title} — MadarBot">
<meta property="og:description" content="Legal information for MadarBot, the Telegram automation platform.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://madar.hamedco.com{active_page}">
<title>{title} — MadarBot</title>
<link rel="preconnect" href="https://cdn.jsdelivr.net">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/geist@1.3.0/dist/fonts/geist-sans/style.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/geist@1.3.0/dist/fonts/geist-mono/style.css">
<style>{LEGAL_CSS}</style>
</head>
<body>
<div class="container">
  <a class="logo" href="/dashboard">
    <div class="logo-mark">MB</div>
    <div class="logo-text">MadarBot</div>
  </a>
  <div class="placeholder-notice">
    <span class="placeholder-notice-icon">&#9888;</span>
    <span>This is a placeholder legal page. The final legal text is pending review by qualified legal counsel. Content below is a standard template and may not reflect the final terms.</span>
  </div>
  <h1>{title}</h1>
  <div class="last-updated">Last updated: {last_updated}</div>
  {content}
  <nav class="nav-links">
{nav}
  </nav>
  <footer>&copy; {last_updated.split()[-1] if last_updated else "2026"} MadarBot. All rights reserved.</footer>
</div>
</body>
</html>"""


@router.get("/tos", response_class=HTMLResponse)
async def tos_page(request: Request) -> str:
    _ = request
    return legal_page(
        "Terms of Service",
        "May 2026",
        """
<h2>1. Acceptance of Terms</h2>
<p>By accessing or using MadarBot ("the Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, you may not access or use the Service.</p>
<p>MadarBot is a Telegram automation platform designed to help users manage groups, send messages, and analyze engagement. The Service is provided by MadarBot ("we", "us", "our").</p>

<h2>2. Eligibility</h2>
<p>You must be at least 16 years of age to use the Service. By using the Service, you represent and warrant that you meet this age requirement and that you have the legal capacity to enter into these Terms.</p>

<h2>3. Account Registration</h2>
<p>To access certain features of the Service, you must authenticate via Telegram. You are responsible for maintaining the confidentiality of your Telegram account and for all activities that occur under your account.</p>
<p>You agree to provide accurate and complete information during registration and to keep your account information up to date.</p>

<h2>4. Acceptable Use</h2>
<p>You agree not to use the Service for any unlawful purpose or in violation of any applicable laws or regulations, including but not limited to:</p>
<ul>
  <li>Sending unsolicited spam messages</li>
  <li>Harassing, threatening, or intimidating others</li>
  <li>Impersonating any person or entity</li>
  <li>Violating Telegram's Terms of Service</li>
  <li>Scraping groups without proper authorization</li>
  <li>Using automated tools for malicious purposes</li>
  <li>Distributing malware, viruses, or other harmful code</li>
</ul>
<p>We reserve the right to suspend or terminate your access to the Service for any violation of these Terms, at our sole discretion.</p>

<h2>5. Platform Limitations</h2>
<p>MadarBot operates within the Telegram platform and is subject to Telegram's API limitations, rate limits, and policies. We are not responsible for any restrictions or actions taken by Telegram that may affect your use of the Service.</p>

<h2>6. AI-Generated Content</h2>
<p>Some features of the Service may use AI (Artificial Intelligence) to generate responses, summarize content, or analyze data. AI-generated content is provided for informational purposes only and should not be relied upon as professional advice. We do not guarantee the accuracy, completeness, or appropriateness of AI-generated content.</p>

<h2>7. Intellectual Property</h2>
<p>The Service and its original content, features, and functionality are and will remain the exclusive property of MadarBot. The Service is protected by copyright, trademark, and other applicable laws.</p>

<h2>8. Third-Party Services</h2>
<p>The Service may integrate with or link to third-party services (such as Telegram, payment processors, AI providers). We are not responsible for the content, privacy practices, or availability of these third-party services.</p>

<h2>9. Termination</h2>
<p>We may terminate or suspend your access to the Service immediately, without prior notice or liability, for any reason, including breach of these Terms. Upon termination, your right to use the Service will cease immediately. Data retention after termination is governed by our Privacy Policy.</p>

<h2>10. Limitation of Liability</h2>
<p>To the fullest extent permitted by applicable law, MadarBot shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including without limitation loss of profits, data, use, goodwill, or other intangible losses, resulting from your use or inability to use the Service.</p>

<h2>11. Disclaimer of Warranties</h2>
<p>The Service is provided on an "AS IS" and "AS AVAILABLE" basis. We make no warranties, expressed or implied, regarding the reliability, accuracy, or availability of the Service.</p>

<h2>12. Changes to Terms</h2>
<p>We reserve the right to modify or replace these Terms at any time. We will provide notice of material changes by updating the "Last Updated" date at the top of this page. Your continued use of the Service after any changes constitutes acceptance of the new Terms.</p>

<h2>13. Governing Law</h2>
<p>These Terms shall be governed by and construed in accordance with applicable laws, without regard to conflict of law principles.</p>

<h2>14. Contact</h2>
<p>For questions about these Terms, please contact us through our <a href="/legal/contact">Contact page</a>.</p>
""",
        active_page="/legal/tos",
    )


@router.get("/privacy", response_class=HTMLResponse)
async def privacy_page(request: Request) -> str:
    _ = request
    return legal_page(
        "Privacy Policy",
        "May 2026",
        """
<h2>1. Introduction</h2>
<p>This Privacy Policy describes how MadarBot ("we", "us", "our") collects, uses, and shares your personal information when you use our Telegram automation platform ("the Service").</p>
<p>We are committed to protecting your privacy and ensuring the security of your data. By using the Service, you consent to the data practices described in this policy.</p>

<h2>2. Information We Collect</h2>
<h3>2.1 Information You Provide</h3>
<ul>
  <li><strong>Telegram account data</strong>: When you authenticate via Telegram, we receive your Telegram user ID, first name, last name, username, and language preference from the Telegram API.</li>
  <li><strong>Linked accounts</strong>: When you link additional Telegram accounts to the Service, we store the phone number and authentication credentials required to operate those accounts.</li>
  <li><strong>Group data</strong>: We store information about Telegram groups you manage through the Service, including group metadata and member information.</li>
</ul>
<h3>2.2 Information Collected Automatically</h3>
<ul>
  <li><strong>Usage data</strong>: We collect information about how you interact with the Service, including pages visited, features used, and actions performed.</li>
  <li><strong>Message data</strong>: When using our scraping or messaging features, we may temporarily process message content to provide the requested service.</li>
  <li><strong>Device information</strong>: We may collect basic device information for security and optimization purposes.</li>
</ul>

<h2>3. How We Use Your Information</h2>
<p>We use the collected information for the following purposes:</p>
<ul>
  <li>To provide, maintain, and improve the Service</li>
  <li>To authenticate your identity and manage your account</li>
  <li>To process your requests and deliver the services you have requested</li>
  <li>To communicate with you about your account, updates, and support inquiries</li>
  <li>To detect, prevent, and address technical issues or abuse</li>
  <li>To comply with legal obligations</li>
</ul>

<h2>4. Data Sharing and Disclosure</h2>
<p>We do not sell your personal information. We may share your information in the following circumstances:</p>
<ul>
  <li><strong>Service Providers</strong>: We may engage third-party companies to facilitate the Service (e.g., hosting providers, AI API providers, payment processors). These providers have access to your data only to perform tasks on our behalf.</li>
  <li><strong>Legal Requirements</strong>: We may disclose your information if required by law or in response to valid legal requests.</li>
  <li><strong>Business Transfers</strong>: In the event of a merger, acquisition, or sale of assets, your data may be transferred as part of that transaction.</li>
</ul>

<h2>5. Data Storage and Security</h2>
<p>Your data is stored on secure servers with industry-standard encryption. We implement appropriate technical and organizational measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction.</p>
<p>While we strive to protect your data, no method of electronic storage or transmission is 100% secure. We cannot guarantee absolute security.</p>

<h2>6. Data Retention</h2>
<p>We retain your personal information for as long as your account is active or as needed to provide the Service. When you request account deletion, we will delete or anonymize your data within a reasonable timeframe, except where retention is required by law.</p>
<p>Scraped group and message data is retained according to your plan's data retention settings and may be automatically purged after the retention period expires.</p>

<h2>7. Your Rights</h2>
<p>Depending on your jurisdiction, you may have the following rights regarding your personal data:</p>
<ul>
  <li><strong>Access</strong>: Request a copy of your personal data</li>
  <li><strong>Rectification</strong>: Request correction of inaccurate data</li>
  <li><strong>Erasure</strong>: Request deletion of your personal data</li>
  <li><strong>Restriction</strong>: Request restriction of processing</li>
  <li><strong>Portability</strong>: Request transfer of your data to another service</li>
  <li><strong>Objection</strong>: Object to processing of your data</li>
</ul>
<p>To exercise these rights, please visit our <a href="/legal/data-deletion">Data Deletion Request</a> page or contact us through our <a href="/legal/contact">Contact page</a>.</p>

<h2>8. Cookies and Tracking</h2>
<p>We use essential cookies necessary for the Service to function properly. We may also use analytics cookies to understand how the Service is used. You can manage cookie preferences through your browser settings. See our <a href="/legal/cookies">Cookie Policy</a> for details.</p>

<h2>9. Children's Privacy</h2>
<p>The Service is not intended for individuals under the age of 16. We do not knowingly collect personal information from children. If we become aware that a child has provided us with personal information, we will delete such information.</p>

<h2>10. International Data Transfers</h2>
<p>Your data may be transferred to and processed in countries other than your country of residence. We ensure that appropriate safeguards are in place to protect your data in accordance with applicable data protection laws.</p>

<h2>11. GDPR Compliance</h2>
<p>For users in the European Economic Area (EEA), we are the data controller of your personal information. Our legal basis for processing your data includes:</p>
<ul>
  <li>Performance of a contract (providing the Service)</li>
  <li>Legitimate interests (improving and securing the Service)</li>
  <li>Consent (where explicitly provided)</li>
  <li>Legal obligations</li>
</ul>

<h2>12. Changes to This Policy</h2>
<p>We may update this Privacy Policy from time to time. We will notify you of material changes by posting the new policy on this page and updating the "Last Updated" date. Continued use of the Service after changes constitutes acceptance of the updated policy.</p>

<h2>13. Contact Information</h2>
<p>For privacy-related inquiries, please visit our <a href="/legal/contact">Contact page</a>.</p>
""",
        active_page="/legal/privacy",
    )


@router.get("/cookies", response_class=HTMLResponse)
async def cookies_page(request: Request) -> str:
    _ = request
    return legal_page(
        "Cookie Policy",
        "May 2026",
        """
<h2>1. What Are Cookies</h2>
<p>Cookies are small text files placed on your device when you visit a website. They are widely used to make websites work efficiently and provide information to the website owners.</p>

<h2>2. How We Use Cookies</h2>
<p>MadarBot uses cookies for the following purposes:</p>
<ul>
  <li><strong>Essential Cookies</strong>: Required for the Service to function properly. These include authentication cookies that maintain your session and security cookies that protect your account.</li>
  <li><strong>Preference Cookies</strong>: Remember your preferences, such as language selection (English/Arabic) and UI settings.</li>
  <li><strong>Analytics Cookies</strong>: Help us understand how users interact with the Service, so we can improve performance and user experience. These cookies collect anonymous usage data.</li>
</ul>

<h2>3. Third-Party Cookies</h2>
<p>Some features of the Service may use third-party services that set their own cookies:</p>
<ul>
  <li><strong>Telegram WebApp</strong>: When using the Telegram mini-app version, Telegram may set cookies as part of the WebApp framework.</li>
  <li><strong>Payment Processors</strong>: Our payment processing partner (Stripe) may set cookies to process payments securely.</li>
  <li><strong>CDN Services</strong>: We use jsDelivr CDN for font delivery, which may set performance cookies.</li>
</ul>
<p>We do not control these third-party cookies. Please refer to the respective privacy policies of these services for more information.</p>

<h2>4. Managing Cookies</h2>
<p>You can control and manage cookies through your browser settings:</p>
<ul>
  <li>Block all cookies</li>
  <li>Delete existing cookies</li>
  <li>Set preferences for specific websites</li>
  <li>Enable "Do Not Track" signals</li>
</ul>
<p>Please note that disabling essential cookies may affect the functionality of the Service and prevent certain features from working properly.</p>

<h2>5. Cookie Duration</h2>
<ul>
  <li><strong>Session Cookies</strong>: Temporary cookies that expire when you close your browser. Used for maintaining your active session.</li>
  <li><strong>Persistent Cookies</strong>: Remain on your device for a set period. Used for remembering preferences and authentication state.</li>
</ul>

<h2>6. Updates to This Policy</h2>
<p>We may update this Cookie Policy to reflect changes in our practices or for operational, legal, or regulatory reasons. We encourage you to periodically review this page.</p>

<h2>7. Contact</h2>
<p>For questions about our use of cookies, please visit our <a href="/legal/contact">Contact page</a>.</p>
""",
        active_page="/legal/cookies",
    )


@router.get("/disclaimer", response_class=HTMLResponse)
async def disclaimer_page(request: Request) -> str:
    _ = request
    return legal_page(
        "Disclaimer",
        "May 2026",
        """
<h2>1. General Disclaimer</h2>
<p>The information and services provided by MadarBot are for general informational and operational purposes only. While we strive to keep the information accurate and up to date, we make no representations or warranties of any kind about the completeness, accuracy, reliability, suitability, or availability of the Service.</p>

<h2>2. AI-Generated Content Disclaimer</h2>
<p>MadarBot uses artificial intelligence (AI) technologies for certain features including but not limited to message analysis, content summarization, FAQ responses, and knowledge extraction. AI-generated content:</p>
<ul>
  <li>May contain inaccuracies, errors, or biases</li>
  <li>Should not be relied upon as professional, legal, medical, or financial advice</li>
  <li>Is generated based on patterns in training data and may not reflect current facts or circumstances</li>
  <li>Should be verified by a qualified human before taking any actions based on it</li>
</ul>
<p>Users are solely responsible for reviewing and validating any AI-generated content before use or distribution.</p>

<h2>3. Automation Disclaimer</h2>
<p>MadarBot provides tools for Telegram automation including bulk messaging, scheduled tasks, and auto-replies. Users are responsible for ensuring their use of these tools complies with:</p>
<ul>
  <li>Telegram's Terms of Service and Acceptable Use Policy</li>
  <li>Applicable laws regarding electronic communications and spam</li>
  <li>Group rules and member consent where applicable</li>
</ul>
<p>We are not responsible for any consequences resulting from your use of automation features, including account restrictions or bans by Telegram.</p>

<h2>4. Third-Party Content Disclaimer</h2>
<p>The Service may display, include, or make available content from third-party sources (including scraped Telegram group content). We do not endorse, guarantee, or assume responsibility for the accuracy or reliability of any third-party content.</p>

<h2>5. No Professional Relationship</h2>
<p>Use of the Service does not create any professional relationship between you and MadarBot. The Service is a tool, and any decisions made based on its output are the sole responsibility of the user.</p>

<h2>6. Limitation of Liability</h2>
<p>To the maximum extent permitted by law, MadarBot and its operators shall not be liable for any direct, indirect, incidental, special, consequential, or exemplary damages arising from the use of or inability to use the Service.</p>

<h2>7. Contact</h2>
<p>For questions about this disclaimer, please visit our <a href="/legal/contact">Contact page</a>.</p>
""",
        active_page="/legal/disclaimer",
    )


@router.get("/refund", response_class=HTMLResponse)
async def refund_page(request: Request) -> str:
    _ = request
    return legal_page(
        "Refund & Cancellation Policy",
        "May 2026",
        """
<h2>1. Subscription Plans</h2>
<p>MadarBot offers subscription plans with recurring billing. By subscribing, you agree to pay the fees associated with your selected plan.</p>

<h2>2. Cancellation</h2>
<p>You may cancel your subscription at any time through your account settings or by contacting us. Upon cancellation:</p>
<ul>
  <li>Your subscription will remain active until the end of the current billing period</li>
  <li>You will not be charged for subsequent billing periods</li>
  <li>Your account will be downgraded to the free tier at the end of the billing period</li>
  <li>Some data and features may become unavailable according to your plan's limitations</li>
</ul>

<h2>3. Refund Policy</h2>
<h3>3.1 Eligibility</h3>
<p>Refunds may be issued under the following circumstances:</p>
<ul>
  <li><strong>Technical Issues</strong>: If the Service experiences prolonged downtime or critical malfunctions that prevent core functionality for an extended period</li>
  <li><strong>Billing Errors</strong>: If you were charged incorrectly or charged after cancellation</li>
  <li><strong>Duplicate Charges</strong>: If you were charged multiple times for the same subscription period</li>
</ul>
<h3>3.2 Non-Refundable Circumstances</h3>
<p>Refunds are generally not provided for:</p>
<ul>
  <li>Change of mind or no longer needing the Service</li>
  <li>Partial use of the subscription period</li>
  <li>Account suspensions due to Terms of Service violations</li>
  <li>Actions taken by Telegram that affect Service functionality</li>
  <li>Promotional or discounted subscriptions (unless required by law)</li>
</ul>

<h2>4. Refund Process</h2>
<p>To request a refund, please contact us through our <a href="/legal/contact">Contact page</a> within 14 days of the charge. Include your account information and a description of the issue. We will review your request and respond within 5 business days.</p>
<p>Approved refunds will be processed to the original payment method within 10 business days.</p>

<h2>5. Free Tier</h2>
<p>MadarBot may offer a free tier with limited features. The free tier does not require payment and is not subject to this refund policy. We reserve the right to modify or discontinue the free tier at any time.</p>

<h2>6. Changes to Pricing</h2>
<p>We reserve the right to modify our pricing with reasonable notice. Price changes will take effect at the start of your next billing cycle. Continued use after a price change constitutes acceptance of the new pricing.</p>

<h2>7. Contact</h2>
<p>For billing and refund inquiries, please visit our <a href="/legal/contact">Contact page</a>.</p>
""",
        active_page="/legal/refund",
    )


@router.get("/contact", response_class=HTMLResponse)
async def contact_page(request: Request) -> str:
    _ = request
    return legal_page(
        "Legal Contact",
        "May 2026",
        """
<h2>1. Contact Information</h2>
<p>For legal inquiries, privacy concerns, data requests, or any questions about our policies, please use the following contact methods:</p>

<h3>1.1 Telegram</h3>
<p>The most direct way to reach us is through the MadarBot platform via Telegram. Authenticated users can access support features within the dashboard.</p>

<h3>1.2 Email</h3>
<p>For formal legal correspondence, you may contact us at the email address provided on the MadarBot platform or Telegram channel.</p>

<h3>1.3 Response Time</h3>
<p>We aim to respond to all inquiries within 2-5 business days. Legal and data-related requests may require additional processing time.</p>

<h2>2. Types of Inquiries</h2>
<h3>2.1 General Support</h3>
<p>For technical support, account issues, or product questions, use the in-app support features.</p>

<h3>2.2 Legal Inquiries</h3>
<p>For matters related to Terms of Service, Privacy Policy, or legal compliance, clearly indicate the legal nature of your inquiry for prioritization.</p>

<h3>2.3 Data Requests</h3>
<p>For data access, deletion, or portability requests under applicable data protection laws (including GDPR), please specify your request type and jurisdiction. See our <a href="/legal/data-deletion">Data Deletion Request</a> page for the dedicated process.</p>

<h3>2.4 Abuse Reports</h3>
<p>To report abuse, spam, or Terms of Service violations, please provide as much detail as possible including relevant group IDs, timestamps, and screenshots.</p>

<h2>3. Required Information</h2>
<p>To help us respond efficiently, please include:</p>
<ul>
  <li>Your Telegram user ID or username</li>
  <li>A clear description of your inquiry</li>
  <li>Any relevant error messages or screenshots</li>
  <li>Your preferred contact method for follow-up</li>
</ul>

<h2>4. Data Protection Officer</h2>
<p>For GDPR-related inquiries, you may contact our Data Protection Officer through the contact methods listed above, specifying "DPO Inquiry" in your message.</p>
""",
        active_page="/legal/contact",
    )


@router.get("/data-deletion", response_class=HTMLResponse)
async def data_deletion_page(request: Request) -> str:
    _ = request
    return legal_page(
        "Data Deletion Request",
        "May 2026",
        """
<h2>1. Your Right to Deletion</h2>
<p>Under applicable data protection laws, including GDPR (EU/EEA), you have the right to request the deletion of your personal data. This page outlines the process for submitting a data deletion request.</p>

<h2>2. What Data Can Be Deleted</h2>
<p>Upon verification of your identity, we can delete:</p>
<ul>
  <li>Your account information and profile data</li>
  <li>Linked Telegram account credentials</li>
  <li>Scraped group data associated with your account</li>
  <li>Message history and lead data</li>
  <li>Automation task configurations</li>
  <li>Analytics and usage logs associated with your account</li>
</ul>
<p>Please note that some data may be retained as required by law or for legitimate business purposes (e.g., fraud prevention, legal obligations, dispute resolution).</p>

<h2>3. How to Submit a Request</h2>
<h3>3.1 In-App Request</h3>
<p>Authenticated users can request account deletion directly through the dashboard settings page. This is the fastest method as your identity is already verified through Telegram authentication.</p>
<ol>
  <li>Navigate to Settings in your dashboard</li>
  <li>Select the account you wish to delete</li>
  <li>Use the "Delete Account" option</li>
  <li>Confirm your request</li>
</ol>
<h3>3.2 Manual Request</h3>
<p>If you cannot access your account, you may submit a deletion request through our <a href="/legal/contact">Contact page</a>. Include:</p>
<ul>
  <li>Your Telegram user ID</li>
  <li>A clear statement requesting data deletion</li>
  <li>Any additional information to help us verify your identity</li>
</ul>

<h2>4. Processing Timeline</h2>
<p>We will acknowledge your request within 5 business days and process it within 30 days, as required by applicable law. Complex requests may take up to 90 days, in which case we will notify you of the extension.</p>

<h2>5. Consequences of Deletion</h2>
<p>Upon completion of your data deletion request:</p>
<ul>
  <li>You will lose access to all features and data associated with your account</li>
  <li>Scheduled tasks and automations will be terminated</li>
  <li>Active subscriptions will be cancelled</li>
  <li>Data deletion is irreversible</li>
</ul>

<h2>6. Exceptions</h2>
<p>We may deny or partially fulfill deletion requests if:</p>
<ul>
  <li>We cannot verify your identity</li>
  <li>The data is required for compliance with legal obligations</li>
  <li>The data is necessary for establishment, exercise, or defense of legal claims</li>
  <li>The request is manifestly unfounded or excessive</li>
</ul>

<h2>7. Contact</h2>
<p>For questions about data deletion, please visit our <a href="/legal/contact">Contact page</a>.</p>
""",
        active_page="/legal/data-deletion",
    )


@router.get("/aup", response_class=HTMLResponse)
async def aup_page(request: Request) -> str:
    _ = request
    return legal_page(
        "Acceptable Use Policy",
        "May 2026",
        """
<h2>1. Purpose</h2>
<p>This Acceptable Use Policy ("AUP") outlines the rules and guidelines for using MadarBot ("the Service"). By using the Service, you agree to comply with this AUP. Violation of this policy may result in account suspension or termination.</p>

<h2>2. Prohibited Activities</h2>
<h3>2.1 Illegal Activities</h3>
<p>You may not use the Service for any illegal purpose or in violation of any applicable local, national, or international laws. This includes but is not limited to:</p>
<ul>
  <li>Fraud, phishing, or deceptive practices</li>
  <li>Distribution of illegal content</li>
  <li>Violation of intellectual property rights</li>
  <li>Unauthorized access to computer systems</li>
</ul>

<h3>2.2 Harmful Activities</h3>
<ul>
  <li>Harassment, bullying, or threatening behavior</li>
  <li>Hate speech or discrimination based on race, religion, gender, or other protected characteristics</li>
  <li>Distribution of malware, viruses, or harmful code</li>
  <li>Doxxing or sharing private information without consent</li>
</ul>

<h3>2.3 Spam and Abuse</h3>
<ul>
  <li>Sending unsolicited bulk messages (spam)</li>
  <li>Excessive or abusive use of automation features</li>
  <li>Creating fake accounts or impersonating others</li>
  <li>Coordinated inauthentic behavior</li>
</ul>

<h3>2.4 Platform Violations</h3>
<ul>
  <li>Violating Telegram's Terms of Service or Acceptable Use Policy</li>
  <li>Circumventing Telegram's rate limits in an abusive manner</li>
  <li>Using the Service to bypass Telegram account restrictions or bans</li>
</ul>

<h3>2.5 Service Abuse</h3>
<ul>
  <li>Attempting to reverse engineer, decompile, or extract the source code of the Service</li>
  <li>Interfering with or disrupting the Service's infrastructure</li>
  <li>Accessing the Service through unauthorized means (bots, scrapers) not provided by MadarBot</li>
  <li>Exceeding reasonable usage limits that impact other users</li>
  <li>Reselling or redistributing the Service without authorization</li>
</ul>

<h2>3. Scraping and Messaging Guidelines</h2>
<h3>3.1 Group Scraping</h3>
<p>When using the group scraping feature:</p>
<ul>
  <li>Only scrape groups where you have legitimate administrative or operational interest</li>
  <li>Do not scrape private groups without proper authorization</li>
  <li>Respect group member privacy</li>
  <li>Comply with the scraped group's rules and policies</li>
</ul>

<h3>3.2 Bulk Messaging</h3>
<p>When using bulk messaging features:</p>
<ul>
  <li>Messages must be relevant and appropriate for recipients</li>
  <li>Do not send unsolicited promotional content</li>
  <li>Include opt-out mechanisms where applicable</li>
  <li>Respect time zones and reasonable messaging hours</li>
</ul>

<h2>4. Content Guidelines</h2>
<p>You are responsible for all content sent, uploaded, or processed through the Service. Content must not:</p>
<ul>
  <li>Be illegal, fraudulent, or deceptive</li>
  <li>Infringe on third-party intellectual property rights</li>
  <li>Contain sexually explicit material or adult content (unless clearly disclosed and compliant with applicable laws)</li>
  <li>Promote violence, terrorism, or illegal activities</li>
  <li>Contain misinformation or disinformation intended to cause harm</li>
</ul>

<h2>5. Enforcement</h2>
<p>We reserve the right to investigate violations of this AUP and take appropriate action, including:</p>
<ul>
  <li>Issuing warnings</li>
  <li>Temporary suspension of access</li>
  <li>Permanent account termination</li>
  <li>Reporting illegal activities to law enforcement</li>
  <li>Removing offending content</li>
</ul>
<p>We may also limit or restrict features for accounts that demonstrate patterns of abuse, even if a specific rule has not been explicitly violated.</p>

<h2>6. Reporting Violations</h2>
<p>To report a violation of this AUP, please contact us through our <a href="/legal/contact">Contact page</a> with a detailed description of the violation. Include relevant information such as timestamps, user IDs, and evidence.</p>

<h2>7. Changes to This Policy</h2>
<p>We may update this AUP from time to time. Continued use of the Service after changes constitutes acceptance of the updated policy.</p>

<h2>8. Contact</h2>
<p>For questions about this Acceptable Use Policy, please visit our <a href="/legal/contact">Contact page</a>.</p>
""",
        active_page="/legal/aup",
    )
