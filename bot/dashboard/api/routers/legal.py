"""Legal pages with EN/AR bilingual support."""

from __future__ import annotations

from fastapi import APIRouter, Request, Depends, Query
from fastapi.responses import HTMLResponse, JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

import json

from bot.db.models.contact_message import ContactMessage
from bot.db.session import get_session
from bot.dashboard.api.routers.translations import t as tr

router = APIRouter(prefix="/legal", tags=["legal"])

LEGAL_CSS = """
:root {
  --bg: #0a0a0a;
  --surface: #141414;
  --surface-hover: #1a1a1a;
  --border: rgba(255,255,255,0.08);
  --border-strong: rgba(255,255,255,0.12);
  --text-primary: #f5f5f5;
  --text-secondary: #a0a0a0;
  --text-muted: #6b6b6b;
  --accent: #635bff;
  --accent-dim: rgba(99,91,255,0.12);
  --accent-hover: #7c75ff;
  --green: #22c55e;
  --green-dim: rgba(34,197,94,0.1);
  --yellow: #facc15;
  --yellow-dim: rgba(250,204,21,0.1);
  --red: #ef4444;
  --red-dim: rgba(239,68,68,0.1);
  --radius: 8px;
  --radius-lg: 12px;
  --font-sans: 'Geist Sans', system-ui, -apple-system, sans-serif;
  --font-mono: 'Geist Mono', 'SF Mono', monospace;
}
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
body {
  background: var(--bg); color: var(--text-primary); font-family: var(--font-sans);
  line-height: 1.7; min-height: 100vh; -webkit-font-smoothing: antialiased;
}
.header { position: sticky; top: 0; z-index: 50; background: rgba(10,10,10,0.85); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-bottom: 1px solid var(--border); }
.header-inner { max-width: 1280px; margin: 0 auto; padding: 0 24px; height: 56px; display: flex; align-items: center; justify-content: space-between; }
.header-logo { display: flex; align-items: center; gap: 10px; text-decoration: none; color: var(--text-primary); font-weight: 700; font-size: 16px; letter-spacing: -0.3px; }
.header-logo-mark { width: 28px; height: 28px; background: var(--accent); border-radius: 7px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 12px; color: #fff; }
.header-nav { display: flex; align-items: center; gap: 4px; }
.header-nav a, .header-nav button { padding: 8px 12px; border-radius: 6px; color: var(--text-secondary); text-decoration: none; font-size: 13px; font-weight: 500; transition: all 0.15s; background: none; border: 1px solid transparent; cursor: pointer; font-family: inherit; }
.header-nav a:hover, .header-nav button:hover { color: var(--text-primary); background: var(--surface-hover); }
.header-nav a.active { color: var(--text-primary); background: var(--surface); }
.content { max-width: 860px; margin: 0 auto; padding: 48px 24px 96px; }
h1 { font-size: 32px; font-weight: 700; letter-spacing: -0.8px; line-height: 1.2; margin-bottom: 8px; }
.last-updated { color: var(--text-muted); font-size: 13px; margin-bottom: 40px; }
.hero-desc { color: var(--text-secondary); font-size: 15px; margin-bottom: 40px; max-width: 640px; }
h2 { font-size: 20px; font-weight: 600; margin: 44px 0 14px; padding-top: 24px; border-top: 1px solid var(--border); letter-spacing: -0.3px; }
h3 { font-size: 16px; font-weight: 600; margin: 28px 0 10px; }
p { margin-bottom: 14px; color: var(--text-secondary); font-size: 14px; }
ul, ol { margin: 0 0 14px 22px; color: var(--text-secondary); font-size: 14px; }
[dir="rtl"] ul, [dir="rtl"] ol { margin: 0 22px 14px 0; }
li { margin-bottom: 8px; }
a { color: var(--accent); text-decoration: none; }
a:hover { color: var(--accent-hover); }
strong { color: var(--text-primary); font-weight: 600; }
code { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 2px 6px; font-family: var(--font-mono); font-size: 13px; color: var(--accent-hover); }
pre { background: #0d0d0d; border: 1px solid var(--border-strong); border-radius: var(--radius-lg); padding: 16px 20px; overflow-x: auto; margin: 16px 0; font-size: 13px; direction: ltr; text-align: left; }
pre code { background: none; border: none; padding: 0; font-size: inherit; color: #d4d4d4; }
.callout { border-radius: var(--radius-lg); padding: 16px 20px; margin: 24px 0; font-size: 13px; line-height: 1.6; display: flex; gap: 12px; align-items: flex-start; }
.callout-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }
.callout-info { background: var(--accent-dim); border: 1px solid rgba(99,91,255,0.15); color: var(--text-secondary); }
.callout-info .callout-icon { color: var(--accent); }
.callout-warning { background: var(--yellow-dim); border: 1px solid rgba(250,204,21,0.15); color: var(--text-secondary); }
.callout-warning .callout-icon { color: var(--yellow); }
.callout-danger { background: var(--red-dim); border: 1px solid rgba(239,68,68,0.15); color: var(--text-secondary); }
.callout-danger .callout-icon { color: var(--red); }
.table-wrap { overflow-x: auto; margin: 20px 0 28px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
thead th { text-align: left; padding: 10px 14px; background: var(--surface); color: var(--text-primary); font-weight: 600; border-bottom: 1px solid var(--border-strong); }
[dir="rtl"] thead th { text-align: right; }
tbody td { padding: 10px 14px; border-bottom: 1px solid var(--border); color: var(--text-secondary); vertical-align: top; }
tbody tr:hover td { background: var(--surface-hover); }
.feedback { border-top: 1px solid var(--border); margin-top: 56px; padding-top: 28px; }
.feedback-label { font-size: 13px; color: var(--text-muted); margin-bottom: 10px; }
.feedback-btns { display: flex; gap: 8px; }
.feedback-btn { padding: 8px 18px; border-radius: 6px; border: 1px solid var(--border); background: transparent; color: var(--text-secondary); font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.15s; font-family: inherit; }
.feedback-btn:hover { border-color: var(--border-strong); color: var(--text-primary); }
.feedback-btn.voted { border-color: var(--accent); color: var(--accent-hover); background: var(--accent-dim); }
.feedback-thanks { font-size: 13px; color: var(--green); margin-top: 8px; display: none; }
.feedback-thanks.show { display: block; }
.nav-links { display: flex; flex-wrap: wrap; gap: 8px 20px; margin-top: 48px; padding-top: 20px; border-top: 1px solid var(--border); }
.nav-links a { font-size: 13px; color: var(--text-muted); }
.nav-links a:hover { color: var(--text-primary); }
.nav-links a.active { color: var(--accent); }
.contact-methods { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin: 28px 0; }
.contact-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 20px; }
.contact-card h3 { margin: 0 0 6px; font-size: 15px; border: none; padding: 0; }
.contact-card p { font-size: 13px; margin: 0; }
.contact-card .method-label { font-size: 13px; color: var(--text-muted); margin-top: 4px; }
.contact-form-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 28px; margin: 28px 0; }
.contact-form-wrap label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 5px; color: var(--text-primary); }
.contact-form-wrap input, .contact-form-wrap textarea { width: 100%; padding: 10px 14px; margin-bottom: 18px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text-primary); font-family: var(--font-sans); font-size: 14px; }
.contact-form-wrap input:focus, .contact-form-wrap textarea:focus { outline: none; border-color: var(--accent); }
.contact-form-wrap textarea { min-height: 120px; resize: vertical; }
.contact-form-wrap button { background: var(--accent); color: #fff; border: none; border-radius: 8px; padding: 12px 28px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; }
.contact-form-wrap button:hover { background: var(--accent-hover); }
.contact-form-wrap button:disabled { opacity: 0.5; cursor: not-allowed; }
.form-result { padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; display: none; }
.form-result.success { background: var(--green-dim); border: 1px solid rgba(34,197,94,0.15); color: var(--green); display: block; }
.form-result.error { background: var(--red-dim); border: 1px solid rgba(239,68,68,0.15); color: var(--red); display: block; }
footer { max-width: 860px; margin: 0 auto; padding: 0 24px 48px; font-size: 12px; color: var(--text-muted); }
@media (max-width: 768px) { .content { padding: 32px 16px 64px; } h1 { font-size: 26px; } .contact-methods { grid-template-columns: 1fr; } }
"""


def legal_page(
    title: str,
    last_updated: str,
    description: str,
    content: str,
    active_page: str = "",
    lang: str = "en",
    title_ar: str = "",
    description_ar: str = "",
    content_ar: str = "",
) -> str:
    is_rtl = lang == "ar"
    dir_attr = 'dir="rtl"' if is_rtl else ""
    display_title = title_ar if is_rtl and title_ar else title
    display_desc = description_ar if is_rtl and description_ar else description
    display_content = content_ar if is_rtl and content_ar else content

    other_lang = "ar" if lang == "en" else "en"
    other_label = "عربي" if lang == "en" else "EN"

    pages = [
        ("/legal/tos", tr("legal_tos", lang)),
        ("/legal/privacy", tr("legal_privacy", lang)),
        ("/legal/cookies", tr("legal_cookies", lang)),
        ("/legal/disclaimer", tr("legal_disclaimer", lang)),
        ("/legal/refund", tr("legal_refund", lang)),
        ("/legal/contact", tr("legal_contact", lang)),
        ("/legal/data-deletion", tr("legal_data_deletion", lang)),
        ("/legal/aup", tr("legal_aup", lang)),
    ]
    nav = "\n".join(
        f'        <a href="{url}?lang={lang}" class="{"active" if url == active_page else ""}">{label}</a>'
        for url, label in pages
    )
    return f"""<!doctype html>
<html lang="{lang}" {dir_attr}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0a0a0a">
<meta name="description" content="{display_desc}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://madar.hamedco.com{active_page}">
<meta property="og:title" content="{display_title} — MadarBot">
<meta property="og:description" content="{display_desc}">
<meta property="og:type" content="website">
<meta property="og:url" content="https://madar.hamedco.com{active_page}">
<title>{display_title} — MadarBot</title>
<link rel="preconnect" href="https://cdn.jsdelivr.net">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/geist@1.3.0/dist/fonts/geist-sans/style.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/geist@1.3.0/dist/fonts/geist-mono/style.css">
<style>{LEGAL_CSS}</style>
</head>
<body>
<header class="header">
  <div class="header-inner">
    <a class="header-logo" href="/docs?lang={lang}">
      <div class="header-logo-mark">MB</div>
      MadarBot
    </a>
    <nav class="header-nav">
      <a href="{active_page}?lang={other_lang}">{other_label}</a>
      <a href="/docs?lang={lang}">{tr('documentation', lang)}</a>
      <a href="/webapp/agents">{tr('dashboard', lang)}</a>
    </nav>
  </div>
</header>
<main>
<div class="content">
  <h1>{display_title}</h1>
  <p class="hero-desc">{display_desc}</p>
  <div class="last-updated">{tr('last_updated', lang)}: {last_updated}</div>
  {display_content}
  <div class="feedback">
    <p class="feedback-label">{tr('was_helpful', lang)}</p>
    <div class="feedback-btns">
      <button class="feedback-btn" onclick="this.classList.add('voted');document.getElementById('thanks').classList.add('show')">{tr('yes', lang)}</button>
      <button class="feedback-btn" onclick="this.classList.add('voted');document.getElementById('thanks').classList.add('show')">{tr('no', lang)}</button>
    </div>
    <p class="feedback-thanks" id="thanks">{tr('thanks_feedback', lang)} <a href="/legal/contact?lang={lang}">{tr('contact_for_help', lang)}</a>.</p>
  </div>
  <nav class="nav-links">
{nav}
  </nav>
</div>
</main>
<footer>&copy; {last_updated.split()[-1] if last_updated else "2026"} MadarBot. {tr('all_rights', lang)}.</footer>
</body>
</html>"""


# ═══════════════════════════════════════════════════════════════════════════════
# TERMS OF SERVICE
# ═══════════════════════════════════════════════════════════════════════════════

TOS_EN = """
<h2>1. Introduction</h2>
<p>Welcome to MadarBot. These Terms of Service govern your access to and use of MadarBot's Telegram automation platform, including our web application, APIs, documentation, and related services.</p>
<p>By creating an account or accessing the Service, you agree to be bound by these Terms. If using the Service on behalf of an organization, you represent that you have authority to bind that organization.</p>
<div class="callout callout-info"><span class="callout-icon">i</span><span>MadarBot operates within the Telegram ecosystem. Your use is also subject to Telegram's <a href="https://telegram.org/tos" target="_blank">Terms of Service</a>.</span></div>
<h2>2. Eligibility</h2><p>You must be at least 16 years old. Your use must not violate any applicable laws.</p>
<h2>3. Account Registration & Security</h2><p>Authentication via Telegram WebApp login. You are responsible for maintaining the security of your Telegram account and any linked accounts.</p>
<h2>4. Service Description</h2><p>MadarBot provides group management, scraping, bulk messaging, automation, analytics, AI features, and MCP server capabilities. Feature availability depends on your subscription plan.</p>
<h2>5. Acceptable Use</h2><p>Prohibited: spam, harassment, impersonation, unauthorized scraping, Telegram ToS violations, malware, illegal activities, reverse engineering, reselling. See our <a href="/legal/aup">AUP</a> for details.</p>
<h2>6. AI-Generated Content</h2><p>AI features use LLMs. Output may contain inaccuracies. Not a substitute for professional advice. Verify before taking consequential actions.</p>
<h2>7. Intellectual Property</h2><p>The Service and its content are the exclusive property of MadarBot. No rights granted except limited use as described.</p>
<h2>8. Third-Party Services</h2><p>We integrate with Telegram, OpenAI, Google, OpenRouter, Stripe. Not responsible for their availability or practices.</p>
<h2>9. Fees and Payment</h2><p>Free, Pro, and Business plans. Paid plans billed via Stripe. 30-day notice for price changes.</p>
<h2>10. Cancellation and Termination</h2><p>Cancel anytime from Settings. Access continues until end of billing period. We may suspend/terminate for violations.</p>
<h2>11. Disclaimer of Warranties</h2><p>Service provided "AS IS" without warranties of any kind.</p>
<h2>12. Limitation of Liability</h2><p>Not liable for indirect, incidental, or consequential damages. Aggregate liability limited to fees paid in 12 months or $100.</p>
<h2>13. Changes to These Terms</h2><p>We may modify these Terms. Material changes notified via "Last Updated" date and in-app/email for significant changes.</p>
<h2>14. Contact</h2><p>Questions? Visit our <a href="/legal/contact">Contact page</a>.</p>
"""

TOS_AR = """
<h2>١. مقدمة</h2>
<p>مرحباً بك في مداربوت. تحكم شروط الخدمة هذه وصولك واستخدامك لمنصة أتمتة تيليغرام من مداربوت، بما في ذلك تطبيق الويب وواجهات برمجة التطبيقات والتوثيق والخدمات ذات الصلة.</p>
<p>بإنشاء حساب أو الوصول للخدمة، فإنك توافق على الالتزام بهذه الشروط. إذا كنت تستخدم الخدمة نيابة عن مؤسسة، فأنت تقر بأن لديك الصلاحية لإلزام تلك المؤسسة.</p>
<div class="callout callout-info"><span class="callout-icon">i</span><span>يعمل مداربوت ضمن منظومة تيليغرام. يخضع استخدامك أيضاً <a href="https://telegram.org/tos" target="_blank">لشروط خدمة تيليغرام</a>.</span></div>
<h2>٢. الأهلية</h2><p>يجب أن يكون عمرك ١٦ عاماً على الأقل. يجب ألا ينتهك استخدامك أي قوانين سارية.</p>
<h2>٣. تسجيل الحساب والأمان</h2><p>التوثيق عبر تسجيل دخول تطبيق تيليغرام المصغر. أنت مسؤول عن الحفاظ على أمان حساب تيليغرام وأي حسابات مرتبطة.</p>
<h2>٤. وصف الخدمة</h2><p>يوفر مداربوت: إدارة المجموعات، الاستخراج، المراسلة الجماعية، الأتمتة، التحليلات، ميزات الذكاء الاصطناعي، وخادم MCP. توفر الميزات يعتمد على خطة اشتراكك.</p>
<h2>٥. الاستخدام المقبول</h2><p>محظور: البريد المزعج، المضايقة، انتحال الشخصية، الاستخراج غير المصرح، انتهاك شروط تيليغرام، البرمجيات الخبيثة، الأنشطة غير القانونية. راجع <a href="/legal/aup">سياسة الاستخدام المقبول</a>.</p>
<h2>٦. المحتوى المولد بالذكاء الاصطناعي</h2><p>ميزات الذكاء الاصطناعي تستخدم نماذج لغوية كبيرة. قد تحتوي المخرجات على أخطاء. ليست بديلاً عن النصيحة المهنية.</p>
<h2>٧. الملكية الفكرية</h2><p>الخدمة ومحتواها ملكية حصرية لمداربوت. لا تمنح أي حقوق باستثناء الاستخدام المحدود الموصوف.</p>
<h2>٨. خدمات الطرف الثالث</h2><p>نتكامل مع تيليغرام و OpenAI و Google و OpenRouter و Stripe. لسنا مسؤولين عن توفرها أو ممارساتها.</p>
<h2>٩. الرسوم والدفع</h2><p>خطط مجانية و Pro و Business. الخطط المدفوعة تتم عبر Stripe. إشعار ٣٠ يوماً لتغييرات الأسعار.</p>
<h2>١٠. الإلغاء والإنهاء</h2><p>يمكنك الإلغاء في أي وقت من الإعدادات. يستمر الوصول حتى نهاية فترة الفوترة. يجوز لنا تعليق/إنهاء الحساب للمخالفات.</p>
<h2>١١. إخلاء الضمانات</h2><p>تُقدم الخدمة "كما هي" دون ضمانات من أي نوع.</p>
<h2>١٢. تحديد المسؤولية</h2><p>لسنا مسؤولين عن الأضرار غير المباشرة أو العرضية أو التبعية. المسؤولية الإجمالية محدودة بالرسوم المدفوعة في ١٢ شهراً أو ١٠٠ دولار.</p>
<h2>١٣. تغييرات الشروط</h2><p>يجوز لنا تعديل هذه الشروط. يتم إخطار التغييرات الهامة عبر تاريخ "آخر تحديث" وداخل التطبيق للتغييرات الكبيرة.</p>
<h2>١٤. اتصل بنا</h2><p>لديك أسئلة؟ تفضل بزيارة <a href="/legal/contact">صفحة اتصل بنا</a>.</p>
"""


@router.get("/tos", response_class=HTMLResponse)
async def tos_page(request: Request, lang: str = Query(default="en")) -> str:
    return legal_page("Terms of Service", "June 15, 2026", "Terms governing your use of the MadarBot platform.", TOS_EN, "/legal/tos", lang, title_ar="شروط الخدمة", description_ar="الشروط التي تحكم استخدامك لمنصة مداربوت.", content_ar=TOS_AR)


# ═══════════════════════════════════════════════════════════════════════════════
# PRIVACY POLICY
# ═══════════════════════════════════════════════════════════════════════════════

PRIVACY_EN = """
<h2>1. Introduction</h2><p>This Privacy Policy describes how MadarBot collects, uses, stores, and shares your personal information when you use our platform.</p>
<h2>2. Information We Collect</h2><h3>2.1 From Telegram</h3><p>User ID, name, username, language, profile photo (if allowed).</p><h3>2.2 You Provide</h3><p>Linked account credentials (encrypted), subscription/billing info (via Stripe), support messages.</p><h3>2.3 Automatic</h3><p>Usage data, group metadata, scraped message content (per plan retention), technical data (IP, browser).</p><h3>2.4 AI Processing</h3><p>Message content transmitted to AI providers (OpenAI, Google, OpenRouter) in real-time. Not used for model training by default.</p>
<h2>3. How We Use Your Information</h2><p>Service provision, authentication, payment processing, automation operation, service communications, improvement, fraud prevention, legal compliance.</p>
<h2>4. Data Sharing</h2><p>We do not sell personal data. Shared with: service providers, AI providers, legal compliance, business transfers (with notice), with your consent.</p>
<h2>5. Data Storage and Security</h2><p>Encrypted in transit (TLS) and at rest. Session credentials encrypted with Fernet. Regular security assessments.</p>
<h2>6. Data Retention</h2><p>Account data: until deletion + 30 days. Scraped data: per plan (30-90 days). Payment records: per tax laws. Logs: 12 months.</p>
<h2>7. Your Rights</h2><p>Access, rectification, erasure, restriction, portability, objection, withdraw consent. Contact us to exercise rights.</p>
<h2>8. GDPR/CCPA</h2><p>GDPR: Data controller, legitimate interest/contract/consent bases. CCPA: Right to know, delete, opt-out (we don't sell).</p>
<h2>9. Contact</h2><p>Email <code>legal@madarbot.com</code> or visit our <a href="/legal/contact">Contact page</a>.</p>
"""

PRIVACY_AR = """
<h2>١. مقدمة</h2><p>تصف سياسة الخصوصية هذه كيفية جمع مداربوت لمعلوماتك الشخصية واستخدامها وتخزينها ومشاركتها عند استخدامك لمنصتنا.</p>
<h2>٢. المعلومات التي نجمعها</h2><h3>٢.١ من تيليغرام</h3><p>معرف المستخدم، الاسم، اسم المستخدم، اللغة، صورة الملف الشخصي.</p><h3>٢.٢ ما تقدمه</h3><p>بيانات اعتماد الحسابات المرتبطة (مشفرة)، معلومات الاشتراك/الفوترة (عبر Stripe)، رسائل الدعم.</p><h3>٢.٣ تلقائياً</h3><p>بيانات الاستخدام، بيانات المجموعات، محتوى الرسائل المستخرجة (حسب خطة الاحتفاظ)، بيانات تقنية (IP، متصفح).</p><h3>٢.٤ معالجة الذكاء الاصطناعي</h3><p>محتوى الرسائل يُنقل لمزودي الذكاء الاصطناعي (OpenAI، Google، OpenRouter) في الوقت الفعلي. لا يُستخدم لتدريب النماذج افتراضياً.</p>
<h2>٣. كيف نستخدم معلوماتك</h2><p>تقديم الخدمة، التوثيق، معالجة الدفع، تشغيل الأتمتة، اتصالات الخدمة، التحسين، منع الاحتيال، الامتثال القانوني.</p>
<h2>٤. مشاركة البيانات</h2><p>لا نبيع البيانات الشخصية. نشارك مع: مزودي الخدمة، مزودي الذكاء الاصطناعي، الامتثال القانوني، نقل الأعمال (مع إشعار)، بموافقتك.</p>
<h2>٥. تخزين البيانات والأمان</h2><p>مشفرة أثناء النقل (TLS) وفي حالة السكون. بيانات اعتماد الجلسة مشفرة بـ Fernet. تقييمات أمنية دورية.</p>
<h2>٦. الاحتفاظ بالبيانات</h2><p>بيانات الحساب: حتى الحذف + ٣٠ يوم. البيانات المستخرجة: حسب الخطة (٣٠-٩٠ يوم). سجلات الدفع: حسب قوانين الضرائب. السجلات: ١٢ شهر.</p>
<h2>٧. حقوقك</h2><p>الوصول، التصحيح، المحو، التقييد، النقل، الاعتراض، سحب الموافقة. اتصل بنا لممارسة حقوقك.</p>
<h2>٨. GDPR/CCPA</h2><p>GDPR: مراقب البيانات، أسس المصلحة المشروعة/العقد/الموافقة. CCPA: الحق في المعرفة والحذف وإلغاء البيع (نحن لا نبيع).</p>
<h2>٩. اتصل بنا</h2><p>راسل <code>legal@madarbot.com</code> أو زر <a href="/legal/contact">صفحة اتصل بنا</a>.</p>
"""


@router.get("/privacy", response_class=HTMLResponse)
async def privacy_page(request: Request, lang: str = Query(default="en")) -> str:
    return legal_page("Privacy Policy", "June 15, 2026", "How MadarBot collects, uses, and protects your personal data.", PRIVACY_EN, "/legal/privacy", lang, title_ar="سياسة الخصوصية", description_ar="كيف يجمع مداربوت بياناتك الشخصية ويستخدمها ويحميها.", content_ar=PRIVACY_AR)


# ═══════════════════════════════════════════════════════════════════════════════
# REMAINING LEGAL PAGES (EN + AR)
# ═══════════════════════════════════════════════════════════════════════════════

COOKIES_EN = """<h2>What Are Cookies</h2><p>Small text files placed on your device for functionality, preferences, and analytics.</p><h2>How We Use Cookies</h2><div class="table-wrap"><table><thead><tr><th>Category</th><th>Purpose</th></tr></thead><tbody><tr><td>Essential</td><td>Authentication, security, session management</td></tr><tr><td>Preference</td><td>Language, UI settings</td></tr><tr><td>Analytics</td><td>Anonymous usage patterns</td></tr></tbody></table></div><h2>Third-Party Cookies</h2><p>Telegram WebApp, Stripe (payments), jsDelivr CDN (fonts).</p><h2>Managing Cookies</h2><p>Control via browser settings. Disabling essential cookies may break functionality.</p>"""
COOKIES_AR = """<h2>ما هي ملفات الارتباط</h2><p>ملفات نصية صغيرة توضع على جهازك للوظائف والتفضيلات والتحليلات.</p><h2>كيف نستخدمها</h2><div class="table-wrap"><table><thead><tr><th>الفئة</th><th>الغرض</th></tr></thead><tbody><tr><td>أساسية</td><td>التوثيق، الأمان، إدارة الجلسة</td></tr><tr><td>تفضيلات</td><td>اللغة، إعدادات الواجهة</td></tr><tr><td>تحليلات</td><td>أنماط استخدام مجهولة</td></tr></tbody></table></div><h2>ملفات ارتباط الطرف الثالث</h2><p>تطبيق تيليغرام المصغر، Stripe (المدفوعات)، jsDelivr CDN (الخطوط).</p><h2>إدارة ملفات الارتباط</h2><p>تحكم عبر إعدادات المتصفح. تعطيل الأساسية قد يعطل الوظائف.</p>"""


@router.get("/cookies", response_class=HTMLResponse)
async def cookies_page(request: Request, lang: str = Query(default="en")) -> str:
    return legal_page("Cookie Policy", "June 15, 2026", "How MadarBot uses cookies and tracking technologies.", COOKIES_EN, "/legal/cookies", lang, title_ar="سياسة ملفات الارتباط", description_ar="كيف يستخدم مداربوت ملفات الارتباط وتقنيات التتبع.", content_ar=COOKIES_AR)


DISCLAIMER_EN = """<h2>General Disclaimer</h2><p>Service provided for informational and operational purposes. No warranties of completeness or accuracy.</p><h2>AI-Generated Content</h2><p>AI features use LLMs. Output may contain errors, hallucinations, or biases. Not professional advice. Verify before acting.</p><h2>Automation Disclaimer</h2><p>You are responsible for ensuring automation use complies with Telegram ToS, applicable laws, and group rules.</p><h2>Third-Party Content</h2><p>Not responsible for accuracy or legality of third-party content (scraped messages, AI provider output).</p><h2>Service Availability</h2><p>No guarantee of uninterrupted access. Not liable for downtime-related losses.</p>"""
DISCLAIMER_AR = """<h2>إخلاء عام</h2><p>الخدمة مقدمة لأغراض معلوماتية وتشغيلية. لا توجد ضمانات للاكتمال أو الدقة.</p><h2>المحتوى المولد بالذكاء الاصطناعي</h2><p>ميزات الذكاء الاصطناعي تستخدم نماذج لغوية كبيرة. قد تحتوي المخرجات على أخطاء أو تحيزات. ليست نصيحة مهنية. تحقق قبل التصرف.</p><h2>إخلاء الأتمتة</h2><p>أنت مسؤول عن ضمان امتثال استخدام الأتمتة لشروط تيليغرام والقوانين السارية وقواعد المجموعات.</p><h2>محتوى الطرف الثالث</h2><p>لسنا مسؤولين عن دقة أو قانونية محتوى الطرف الثالث (الرسائل المستخرجة، مخرجات مزودي الذكاء الاصطناعي).</p><h2>توفر الخدمة</h2><p>لا نضمن الوصول غير المنقطع. لسنا مسؤولين عن الخسائر المرتبطة بالتوقف.</p>"""


@router.get("/disclaimer", response_class=HTMLResponse)
async def disclaimer_page(request: Request, lang: str = Query(default="en")) -> str:
    return legal_page("Disclaimer", "June 15, 2026", "Limitations and disclaimers regarding your use of MadarBot.", DISCLAIMER_EN, "/legal/disclaimer", lang, title_ar="إخلاء المسؤولية", description_ar="القيود وإخلاءات المسؤولية المتعلقة باستخدامك لمداربوت.", content_ar=DISCLAIMER_AR)


REFUND_EN = """<h2>Subscription Plans</h2><p>Free, Pro, and Business tiers. Paid plans billed monthly/annually via Stripe.</p><h2>Cancellation</h2><p>Cancel anytime from Settings → Billing. Access continues until end of billing period. Account downgrades to Free tier after.</p><h2>Refund Policy</h2><div class="table-wrap"><table><thead><tr><th>Circumstance</th><th>Refund</th></tr></thead><tbody><tr><td>Technical service failure (48h+)</td><td>Pro-rated</td></tr><tr><td>Billing error</td><td>Full</td></tr><tr><td>Duplicate charge</td><td>Full</td></tr><tr><td>Annual plan cancellation (90 days)</td><td>Pro-rated minus 10%</td></tr></tbody></table></div><h2>Non-Refundable</h2><p>Change of mind, partial use, ToS violations, Telegram actions, promotional plans, failure to cancel before renewal.</p><h2>Process</h2><p>Contact us → Review within 5 business days → Refund within 10 business days.</p>"""
REFUND_AR = """<h2>خطط الاشتراك</h2><p>مستويات مجاني و Pro و Business. الخطط المدفوعة تتم شهرياً/سنوياً عبر Stripe.</p><h2>الإلغاء</h2><p>ألغِ في أي وقت من الإعدادات → الفوترة. يستمر الوصول حتى نهاية فترة الفوترة. يتم تخفيض الحساب إلى المستوى المجاني بعدها.</p><h2>سياسة الاسترداد</h2><div class="table-wrap"><table><thead><tr><th>الظرف</th><th>الاسترداد</th></tr></thead><tbody><tr><td>فشل فني للخدمة (٤٨ ساعة+)</td><td>نسبي</td></tr><tr><td>خطأ في الفوترة</td><td>كامل</td></tr><tr><td>دفع مزدوج</td><td>كامل</td></tr><tr><td>إلغاء خطة سنوية (٩٠ يوم)</td><td>نسبي ناقص ١٠٪</td></tr></tbody></table></div><h2>غير قابل للاسترداد</h2><p>تغيير الرأي، استخدام جزئي، انتهاكات الشروط، إجراءات تيليغرام، الخطط الترويجية، عدم الإلغاء قبل التجديد.</p><h2>العملية</h2><p>اتصل بنا → مراجعة خلال ٥ أيام عمل → استرداد خلال ١٠ أيام عمل.</p>"""


@router.get("/refund", response_class=HTMLResponse)
async def refund_page(request: Request, lang: str = Query(default="en")) -> str:
    return legal_page("Refund & Cancellation Policy", "June 15, 2026", "Our subscription cancellation and refund terms.", REFUND_EN, "/legal/refund", lang, title_ar="سياسة الاسترداد والإلغاء", description_ar="شروط إلغاء الاشتراك والاسترداد الخاصة بنا.", content_ar=REFUND_AR)


# ═══════════════════════════════════════════════════════════════════════════════
# CONTACT PAGE (with form)
# ═══════════════════════════════════════════════════════════════════════════════

CONTACT_EN_CONTENT = """
<h2>{gt}</h2><p>{gtd}</p>
<div class="contact-methods">
  <div class="contact-card"><h3>{es}</h3><p><code>support@madarbot.com</code></p><p class="method-label">{esd}</p></div>
</div>
<h2>{sum}</h2><p>{sumd}</p>
<div class="contact-form-wrap">
  <div id="form-result" class="form-result"></div>
  <form id="contact-form" onsubmit="return submitForm(event)">
    <label for="name">{nm}</label>
    <input type="text" id="name" name="name" required placeholder="{nmp}" maxlength="255" autocomplete="name">
    <label for="email">{em}</label>
    <input type="email" id="email" name="email" required placeholder="{emp}" maxlength="255" autocomplete="email">
    <label for="subject">{sb}</label>
    <input type="text" id="subject" name="subject" required placeholder="{sbp}" maxlength="500">
    <label for="message">{ms}</label>
    <textarea id="message" name="message" required placeholder="{msp}" maxlength="10000"></textarea>
    <button type="submit" id="submit-btn">{sm}</button>
  </form>
</div>
<script>
var _snd = {snd_js};
var _msgok = {msgok_js};
var _msgerr = {msgerr_js};
var _msgneterr = {msgneterr_js};
var _sm = {sm_js};
async function submitForm(e) {{
  e.preventDefault();
  var btn = document.getElementById('submit-btn');
  var result = document.getElementById('form-result');
  btn.disabled = true; btn.textContent = _snd; result.className = 'form-result'; result.textContent = '';
  var payload = {{ name: document.getElementById('name').value.trim(), email: document.getElementById('email').value.trim(), subject: document.getElementById('subject').value.trim(), message: document.getElementById('message').value.trim() }};
  try {{
    var resp = await fetch('/legal/contact', {{ method: 'POST', headers: {{'Content-Type': 'application/json'}}, body: JSON.stringify(payload) }});
    var data = await resp.json();
    if (resp.ok) {{ result.className = 'form-result success'; result.textContent = data.detail || _msgok; document.getElementById('contact-form').reset(); }}
    else {{ result.className = 'form-result error'; result.textContent = data.detail || _msgerr; }}
  }} catch (err) {{ result.className = 'form-result error'; result.textContent = _msgneterr; }}
  finally {{ btn.disabled = false; btn.textContent = _sm; }}
  return false;
}}
</script>
<h2>{rt}</h2>
<div class="table-wrap"><table><thead><tr><th>{it}</th><th>{er}</th></tr></thead>
<tbody>
<tr><td>{gs}</td><td>{d12}</td></tr>
<tr><td>{tp}</td><td>{d1}</td></tr>
<tr><td>{br}</td><td>{d25}</td></tr>
<tr><td>{lpl}</td><td>{d530}</td></tr>
<tr><td>{ar}</td><td>{d13}</td></tr>
</tbody></table></div>
"""


def _contact_content(lang: str) -> str:
    return CONTACT_EN_CONTENT.format(
        gt=tr("get_in_touch", lang), gtd=tr("get_in_touch_desc", lang),
        es=tr("email_support", lang), esd=tr("email_support_desc", lang),
        sum=tr("send_us_message", lang), sumd=tr("send_us_message_desc", lang),
        nm=tr("name", lang), nmp=tr("name_placeholder", lang),
        em=tr("email", lang), emp=tr("email_placeholder", lang),
        sb=tr("subject", lang), sbp=tr("subject_placeholder", lang),
        ms=tr("message", lang), msp=tr("message_placeholder", lang),
        sm=tr("send_message", lang),
        snd_js=json.dumps(tr("sending", lang)),
        msgok_js=json.dumps(tr("msg_sent", lang)),
        msgerr_js=json.dumps(tr("msg_error", lang)),
        msgneterr_js=json.dumps(tr("msg_network_error", lang)),
        sm_js=json.dumps(tr("send_message", lang)),
        rt=tr("response_times", lang), it=tr("inquiry_type", lang), er=tr("expected_response", lang),
        gs=tr("general_support", lang), d12=tr("days_1_2", lang),
        tp=tr("tech_pro", lang), d1=tr("days_1", lang),
        br=tr("billing_refunds", lang), d25=tr("days_2_5", lang),
        lpl=tr("legal_privacy_label", lang), d530=tr("days_5_30", lang),
        ar=tr("abuse_reports", lang), d13=tr("days_1_3", lang),
    )


@router.get("/contact", response_class=HTMLResponse)
async def contact_page(request: Request, lang: str = Query(default="en")) -> str:
    contact_content = _contact_content(lang)
    return legal_page(
        "Contact Us", "June 15, 2026",
        "Get in touch with the MadarBot team for support, legal inquiries, or feedback.",
        contact_content, "/legal/contact", lang,
        title_ar="اتصل بنا",
        description_ar="تواصل مع فريق مداربوت للدعم أو الاستفسارات القانونية أو الملاحظات.",
        content_ar=contact_content,
    )


class ContactFormData(BaseModel):
    name: str
    email: str
    subject: str
    message: str


@router.post("/contact", response_class=JSONResponse)
async def contact_submit(
    data: ContactFormData,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    if not data.name.strip() or not data.email.strip() or not data.subject.strip() or not data.message.strip():
        return JSONResponse({"detail": "All fields are required."}, status_code=422)
    if len(data.message) > 10000:
        return JSONResponse({"detail": "Message is too long."}, status_code=422)
    client_ip = request.headers.get("x-forwarded-for", request.client.host if request.client else None)
    if client_ip and "," in client_ip:
        client_ip = client_ip.split(",")[0].strip()
    msg = ContactMessage(
        name=data.name.strip(), email=data.email.strip().lower(),
        subject=data.subject.strip(), message=data.message.strip(), ip_address=client_ip,
    )
    session.add(msg)
    await session.commit()
    return JSONResponse({"detail": "Message sent. We'll get back to you within 2 business days."})


# ═══════════════════════════════════════════════════════════════════════════════
# DATA DELETION
# ═══════════════════════════════════════════════════════════════════════════════

DATA_DEL_EN = """<h2>Your Right to Deletion</h2><p>Under GDPR/CCPA, you have the right to request deletion of your personal data.</p><h2>What Can Be Deleted</h2><p>Account profile, linked account credentials, scraped data, leads, campaigns, tasks, analytics, AI knowledge bases. Some data retained for legal obligations.</p><h2>How to Submit</h2><h3>In-App (Recommended)</h3><ol><li>Open <a href="/webapp/agents">WebApp</a></li><li>Settings → Account</li><li>Delete My Account</li><li>Confirm</li></ol><h3>Manual</h3><p>Email <code>legal@madarbot.com</code> with your Telegram user ID and deletion request.</p><h2>Timeline</h2><p>Acknowledgement: 5 business days. Completion: 30 calendar days. Complex: up to 90 days.</p><h2>Consequences</h2><p>Permanent loss of account and data. Tasks and campaigns terminated. Subscription cancelled. Irreversible.</p>"""
DATA_DEL_AR = """<h2>حقك في الحذف</h2><p>بموجب GDPR/CCPA، لديك الحق في طلب حذف بياناتك الشخصية.</p><h2>ما يمكن حذفه</h2><p>ملف الحساب، بيانات اعتماد الحسابات المرتبطة، البيانات المستخرجة، العملاء، الحملات، المهام، التحليلات، قواعد معرفة الذكاء الاصطناعي. بعض البيانات تحتفظ للالتزامات القانونية.</p><h2>كيفية التقديم</h2><h3>داخل التطبيق (موصى به)</h3><ol><li>افتح <a href="/webapp/agents">التطبيق المصغر</a></li><li>الإعدادات → الحساب</li><li>حذف حسابي</li><li>تأكيد</li></ol><h3>يدوياً</h3><p>راسل <code>legal@madarbot.com</code> مع معرف تيليغرام الخاص بك وطلب الحذف.</p><h2>الجدول الزمني</h2><p>الإقرار: ٥ أيام عمل. الإكمال: ٣٠ يوم تقويمي. المعقد: حتى ٩٠ يوم.</p><h2>التبعات</h2><p>فقدان دائم للحساب والبيانات. إنهاء المهام والحملات. إلغاء الاشتراك. لا رجعة فيه.</p>"""


@router.get("/data-deletion", response_class=HTMLResponse)
async def data_deletion_page(request: Request, lang: str = Query(default="en")) -> str:
    return legal_page("Data Deletion Request", "June 15, 2026", "How to request deletion of your personal data from MadarBot.", DATA_DEL_EN, "/legal/data-deletion", lang, title_ar="طلب حذف البيانات", description_ar="كيفية طلب حذف بياناتك الشخصية من مداربوت.", content_ar=DATA_DEL_AR)


AUP_EN = """<h2>Purpose</h2><p>This Acceptable Use Policy defines rules for using MadarBot. Violations may result in suspension or termination.</p><h2>Prohibited Activities</h2><h3>Illegal</h3><p>Fraud, phishing, illegal content, IP violations, unauthorized access, money laundering.</p><h3>Harmful</h3><p>Harassment, hate speech, malware, disinformation, doxxing.</p><h3>Spam & Abuse</h3><p>Unsolicited bulk messages, rate limit circumvention, fake accounts, flooding.</p><h3>Service Integrity</h3><p>Reverse engineering, infrastructure disruption, unauthorized automation, reselling.</p><h2>Scraping & Messaging Guidelines</h2><p>Only scrape groups you administer. Respect member privacy. Bulk messages must be relevant and expected.</p><h2>Enforcement</h2><p>Warning, feature suspension, account suspension, termination, legal reporting.</p><h2>Reporting</h2><p>Report violations via <a href="/legal/contact">Contact page</a>. Include user IDs, timestamps, evidence.</p>"""
AUP_AR = """<h2>الغرض</h2><p>تحدد سياسة الاستخدام المقبول هذه قواعد استخدام مداربوت. قد تؤدي المخالفات إلى التعليق أو الإنهاء.</p><h2>الأنشطة المحظورة</h2><h3>غير قانوني</h3><p>الاحتيال، التصيد، محتوى غير قانوني، انتهاكات الملكية الفكرية، الوصول غير المصرح، غسيل الأموال.</p><h3>ضار</h3><p>مضايقة، خطاب كراهية، برمجيات خبيثة، تضليل، كشف معلومات شخصية.</p><h3>بريد مزعج وإساءة</h3><p>رسائل جماعية غير مرغوبة، تجاوز حدود المعدل، حسابات وهمية، إغراق.</p><h3>سلامة الخدمة</h3><p>هندسة عكسية، تعطيل البنية التحتية، أتمتة غير مصرح بها، إعادة بيع.</p><h2>إرشادات الاستخراج والمراسلة</h2><p>استخرج فقط من المجموعات التي تديرها. احترم خصوصية الأعضاء. يجب أن تكون الرسائل الجماعية ذات صلة ومتوقعة.</p><h2>التنفيذ</h2><p>تحذير، تعليق الميزات، تعليق الحساب، إنهاء، إبلاغ قانوني.</p><h2>الإبلاغ</h2><p>أبلغ عن المخالفات عبر <a href="/legal/contact">صفحة اتصل بنا</a>. ضمن معرفات المستخدمين والطوابع الزمنية والأدلة.</p>"""


@router.get("/aup", response_class=HTMLResponse)
async def aup_page(request: Request, lang: str = Query(default="en")) -> str:
    return legal_page("Acceptable Use Policy", "June 15, 2026", "Rules and guidelines for acceptable use of the MadarBot platform.", AUP_EN, "/legal/aup", lang, title_ar="سياسة الاستخدام المقبول", description_ar="قواعد وإرشادات الاستخدام المقبول لمنصة مداربوت.", content_ar=AUP_AR)
