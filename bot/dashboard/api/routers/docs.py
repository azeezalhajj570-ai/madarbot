"""Documentation pages with EN/AR bilingual support."""

from __future__ import annotations

import html as html_mod
import re

from fastapi import APIRouter, Request, Query
from fastapi.responses import HTMLResponse

from bot.dashboard.api.routers.translations import t as tr

router = APIRouter(prefix="/docs", tags=["docs"])

DOCS_CSS = """
:root {
  --bg: #0a0a0a;
  --surface: #141414;
  --surface-hover: #1a1a1a;
  --border: rgba(255,255,255,0.06);
  --border-strong: rgba(255,255,255,0.10);
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
  --orange: #f97316;
  --radius: 6px;
  --radius-lg: 10px;
  --font-sans: 'Geist Sans', system-ui, -apple-system, sans-serif;
  --font-mono: 'Geist Mono', 'SF Mono', monospace;
  --sidebar-width: 260px;
  --toc-width: 200px;
  --header-height: 56px;
}
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
body {
  background: var(--bg);
  color: var(--text-primary);
  font-family: var(--font-sans);
  line-height: 1.7;
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
}
/* RTL */
[dir="rtl"] .sidebar { border-right: none; border-left: 1px solid var(--border); }
[dir="rtl"] .content { margin-left: 0; margin-right: var(--sidebar-width); }
[dir="rtl"] .toc-sidebar { right: auto; left: 0; padding: 40px 12px 48px 20px; }
[dir="rtl"] .toc-sidebar a { border-left: none; border-right: 2px solid transparent; padding-left: 0; padding-right: 10px; }
[dir="rtl"] .toc-sidebar a:hover { border-right-color: var(--border-strong); }
[dir="rtl"] .toc-sidebar a.toc-active { border-right-color: var(--accent); }
@media (max-width: 1024px) { [dir="rtl"] .content { margin-right: 0; } }
/* Header */
.header {
  position: fixed; top: 0; left: 0; right: 0; z-index: 100;
  background: rgba(10,10,10,0.88); backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border); height: var(--header-height);
}
.header-inner {
  max-width: 100%; margin: 0 auto; padding: 0 24px; height: 100%;
  display: flex; align-items: center; justify-content: space-between;
}
.header-logo { display: flex; align-items: center; gap: 10px; text-decoration: none; color: var(--text-primary); font-weight: 700; font-size: 16px; letter-spacing: -0.3px; }
.header-logo-mark { width: 28px; height: 28px; background: var(--accent); border-radius: 7px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 12px; color: #fff; }
.header-actions { display: flex; align-items: center; gap: 6px; }
.header-actions a, .header-actions button {
  padding: 6px 12px; border-radius: 6px; color: var(--text-secondary);
  text-decoration: none; font-size: 13px; font-weight: 500; transition: all 0.15s;
  background: none; border: 1px solid transparent; cursor: pointer; font-family: inherit;
}
.header-actions a:hover, .header-actions button:hover { color: var(--text-primary); background: var(--surface-hover); }
.header-actions a.primary { background: var(--accent); color: #fff; border-color: transparent; }
.header-actions a.primary:hover { background: var(--accent-hover); }
.header-actions .lang-toggle { min-width: 32px; text-align: center; }
/* Layout */
.layout { display: flex; padding-top: var(--header-height); min-height: calc(100vh - var(--header-height)); }
/* Sidebar */
.sidebar {
  position: fixed; top: var(--header-height); left: 0; bottom: 0;
  width: var(--sidebar-width); overflow-y: auto; padding: 24px 16px 48px;
  border-right: 1px solid var(--border); z-index: 40;
}
[dir="rtl"] .sidebar { left: auto; right: 0; }
.sidebar::-webkit-scrollbar { width: 4px; }
.sidebar::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 4px; }
.sidebar-section { margin-bottom: 20px; }
.sidebar-section-title {
  font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.6px; color: var(--text-muted); margin-bottom: 6px; padding: 0 8px;
}
.sidebar-link {
  display: block; padding: 6px 8px; border-radius: var(--radius); font-size: 13px;
  color: var(--text-secondary); text-decoration: none; transition: all 0.1s;
}
.sidebar-link:hover { color: var(--text-primary); background: var(--surface-hover); }
.sidebar-link.active { color: var(--text-primary); background: var(--surface); font-weight: 500; }
/* Main content */
.content {
  flex: 1; margin-left: var(--sidebar-width); padding: 40px 48px 96px;
  max-width: 860px;
}
/* Table of Contents sidebar */
.toc-sidebar {
  position: fixed; top: var(--header-height); right: 0; bottom: 0;
  width: var(--toc-width); overflow-y: auto; padding: 40px 20px 48px 12px;
  display: none;
}
@media (min-width: 1400px) { .toc-sidebar { display: block; } }
.toc-title { font-size: 13px; font-weight: 600; color: var(--text-secondary); margin-bottom: 12px; }
.toc-sidebar a { display: block; padding: 4px 0; font-size: 12px; color: var(--text-muted); text-decoration: none; border-left: 2px solid transparent; padding-left: 10px; transition: all 0.15s; }
.toc-sidebar a:hover { color: var(--text-secondary); border-left-color: var(--border-strong); }
.toc-sidebar a.toc-active { color: var(--accent); border-left-color: var(--accent); }
/* Typography */
h1 { font-size: 36px; font-weight: 700; letter-spacing: -1px; line-height: 1.15; margin-bottom: 10px; }
h1.hero { font-size: 44px; letter-spacing: -1.5px; }
.hero-desc { color: var(--text-secondary); font-size: 16px; margin-bottom: 40px; max-width: 640px; line-height: 1.6; }
h2 { font-size: 22px; font-weight: 600; margin: 44px 0 14px; padding-top: 24px; border-top: 1px solid var(--border); letter-spacing: -0.3px; scroll-margin-top: 80px; }
h3 { font-size: 17px; font-weight: 600; margin: 28px 0 10px; scroll-margin-top: 80px; }
h4 { font-size: 14px; font-weight: 600; margin: 20px 0 8px; color: var(--text-secondary); }
p { margin-bottom: 14px; color: var(--text-secondary); font-size: 14px; }
ul, ol { margin: 0 0 14px 22px; color: var(--text-secondary); font-size: 14px; }
[dir="rtl"] ul, [dir="rtl"] ol { margin: 0 22px 14px 0; }
li { margin-bottom: 8px; }
a { color: var(--accent); text-decoration: none; transition: color 0.15s; }
a:hover { color: var(--accent-hover); }
strong { color: var(--text-primary); font-weight: 600; }
code {
  background: var(--surface); border: 1px solid var(--border-strong); border-radius: 4px;
  padding: 2px 6px; font-family: var(--font-mono); font-size: 12px; color: #e2e8f0;
}
pre {
  background: #0d0d0d; border: 1px solid var(--border-strong); border-radius: var(--radius-lg);
  padding: 16px 20px; overflow-x: auto; margin: 16px 0 20px; font-size: 13px; line-height: 1.6;
  direction: ltr; text-align: left;
}
pre code { background: none; border: none; padding: 0; font-size: inherit; color: #d4d4d4; }
/* Callouts */
.callout {
  border-radius: var(--radius-lg); padding: 14px 18px; margin: 20px 0;
  font-size: 13px; line-height: 1.6; display: flex; gap: 10px; align-items: flex-start;
}
.callout-icon { font-size: 17px; flex-shrink: 0; margin-top: 1px; font-weight: 700; }
.callout-info { background: var(--accent-dim); border: 1px solid rgba(99,91,255,0.15); color: var(--text-secondary); }
.callout-info .callout-icon { color: var(--accent); }
.callout-warning { background: var(--yellow-dim); border: 1px solid rgba(250,204,21,0.15); color: var(--text-secondary); }
.callout-warning .callout-icon { color: var(--yellow); }
.callout-tip { background: var(--green-dim); border: 1px solid rgba(34,197,94,0.15); color: var(--text-secondary); }
.callout-tip .callout-icon { color: var(--green); }
/* Tables */
.table-wrap { overflow-x: auto; margin: 20px 0 28px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
thead th {
  text-align: left; padding: 10px 14px; background: var(--surface);
  color: var(--text-primary); font-weight: 600; border-bottom: 1px solid var(--border-strong); white-space: nowrap;
}
[dir="rtl"] thead th { text-align: right; }
tbody td { padding: 10px 14px; border-bottom: 1px solid var(--border); color: var(--text-secondary); vertical-align: top; }
tbody tr:hover td { background: var(--surface-hover); }
/* Feature cards */
.feature-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; margin: 28px 0; }
.feature-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 20px; transition: border-color 0.15s; }
.feature-card:hover { border-color: var(--border-strong); }
.feature-card h4 { font-size: 14px; margin: 0 0 6px; }
.feature-card p { font-size: 13px; margin: 0; }
/* Endpoint */
.endpoint { margin: 16px 0 24px; }
.endpoint-header {
  display: inline-flex; align-items: center; gap: 10px; margin-bottom: 8px;
  background: var(--surface); border: 1px solid var(--border-strong); border-radius: var(--radius);
  padding: 6px 14px; font-family: var(--font-mono); font-size: 13px;
}
.endpoint-method { font-weight: 700; color: var(--accent); }
.endpoint-path { color: var(--text-secondary); }
.endpoint p { font-size: 13px; margin: 4px 0 0 0; }
/* Steps */
.step { display: flex; gap: 14px; margin-bottom: 20px; }
.step-num { flex-shrink: 0; width: 28px; height: 28px; background: var(--accent-dim); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; color: var(--accent); }
.step-body h4 { margin: 0 0 4px; }
.step-body p { font-size: 13px; margin: 0; }
/* Section intro */
.section-intro { color: var(--text-secondary); font-size: 14px; margin-bottom: 24px; }
/* Feedback */
.feedback { border-top: 1px solid var(--border); margin-top: 56px; padding-top: 28px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.feedback-label { font-size: 13px; color: var(--text-muted); }
.feedback-btns { display: flex; gap: 8px; }
.feedback-btn { padding: 6px 16px; border-radius: 6px; border: 1px solid var(--border); background: transparent; color: var(--text-secondary); font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.15s; font-family: inherit; }
.feedback-btn:hover { border-color: var(--border-strong); color: var(--text-primary); }
.feedback-btn.voted { border-color: var(--accent); color: var(--accent-hover); background: var(--accent-dim); }
.feedback-thanks { font-size: 13px; color: var(--green); display: none; }
.feedback-thanks.show { display: inline; }
.feedback-copy { margin-left: auto; font-size: 13px; color: var(--text-muted); cursor: pointer; background: none; border: 1px solid var(--border); padding: 6px 14px; border-radius: 6px; font-family: inherit; transition: all 0.15s; }
[dir="rtl"] .feedback-copy { margin-left: 0; margin-right: auto; }
.feedback-copy:hover { border-color: var(--border-strong); color: var(--text-primary); }
/* Quick links row */
.quick-links { display: flex; gap: 12px; flex-wrap: wrap; margin: 32px 0; }
.quick-link { padding: 10px 18px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); text-decoration: none; color: var(--text-secondary); font-size: 13px; font-weight: 500; transition: all 0.15s; }
.quick-link:hover { border-color: var(--border-strong); color: var(--text-primary); }
.quick-link strong { display: block; color: var(--text-primary); }
/* Mobile */
.mobile-menu-btn { display: none; background: none; border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; color: var(--text-secondary); cursor: pointer; font-size: 18px; }
@media (max-width: 1024px) {
  .sidebar { display: none; }
  .sidebar.open { display: block; position: fixed; top: var(--header-height); left: 0; bottom: 0; width: 280px; background: var(--bg); z-index: 90; border-right: 1px solid var(--border-strong); }
  [dir="rtl"] .sidebar.open { left: auto; right: 0; border-right: none; border-left: 1px solid var(--border-strong); }
  .content { margin-left: 0; padding: 32px 20px 64px; }
  [dir="rtl"] .content { margin-right: 0; }
  .mobile-menu-btn { display: block; }
  h1 { font-size: 28px; }
  h1.hero { font-size: 32px; }
}
@media (max-width: 640px) {
  .content { padding: 24px 16px 64px; }
  .feature-grid { grid-template-columns: 1fr; }
}
"""


def _sidebar_nav(lang: str) -> list[tuple[str, list[tuple[str, str]]]]:
    return [
        (tr("doc_section_docs", lang), [
            ("/docs", tr("home", lang)),
            ("/docs/getting-started", tr("getting_started", lang)),
            ("/docs/accounts", tr("accounts_setup", lang)),
            ("/docs/groups", tr("group_management", lang)),
            ("/docs/scraping", tr("scraping_engine", lang)),
            ("/docs/campaigns", tr("bulk_campaigns", lang)),
            ("/docs/automation", tr("automation_tasks", lang)),
            ("/docs/leads", tr("leads_management", lang)),
            ("/docs/analytics", tr("analytics", lang)),
            ("/docs/subscription", tr("subscription_plans", lang)),
        ]),
        (tr("doc_section_api", lang), [
            ("/docs/mcp", tr("mcp_server", lang)),
            ("/docs/agents", tr("ai_agent_integration", lang)),
        ]),
        (tr("doc_section_resources", lang), [
            ("/docs/faq", tr("faq", lang)),
            ("/legal/tos", tr("terms_of_service", lang)),
            ("/legal/privacy", tr("privacy_policy", lang)),
            ("/legal/contact", tr("contact_us", lang)),
        ]),
    ]


def _render_sidebar(active_page: str, lang: str) -> str:
    parts = []
    nav = _sidebar_nav(lang)
    for section_title, links in nav:
        parts.append(f'<div class="sidebar-section"><div class="sidebar-section-title">{section_title}</div>')
        for url, label in links:
            cls = "active" if url == active_page or (active_page.startswith(url) and url != "/docs") else ""
            lang_url = f"{url}?lang={lang}" if "?" not in url else f"{url}&lang={lang}"
            parts.append(f'<a class="sidebar-link {cls}" href="{lang_url}">{label}</a>')
        parts.append("</div>")
    return "\n".join(parts)


def _extract_toc(content: str) -> list[tuple[str, str]]:
    headings = re.findall(r'<h2[^>]*>(.*?)</h2>', content)
    toc = []
    for h in headings:
        clean = re.sub(r'<[^>]+>', '', h).strip()
        slug = re.sub(r'[^a-z0-9]+', '-', clean.lower()).strip('-')
        toc.append((slug, clean))
    return toc


def _render_toc(content: str, lang: str) -> str:
    toc = _extract_toc(content)
    if not toc:
        return ""
    items = "\n".join(
        f'<a href="#{slug}">{html_mod.escape(label)}</a>'
        for slug, label in toc
    )
    return f"""<aside class="toc-sidebar">
<div class="toc-title">{tr('on_this_page', lang)}</div>
{items}
</aside>"""


def docs_page(
    page: str,
    title: str,
    description: str,
    content: str,
    lang: str = "en",
    jsonld: str = "",
    hero: bool = False,
    title_ar: str = "",
    description_ar: str = "",
    content_ar: str = "",
) -> str:
    active = ("/docs/" + page) if page != "home" else "/docs"
    sidebar = _render_sidebar(active, lang)
    toc = _render_toc(content, lang) if lang == "en" else _render_toc(content_ar, lang)

    is_rtl = lang == "ar"
    dir_attr = 'dir="rtl"' if is_rtl else ""
    display_title = title_ar if is_rtl and title_ar else title
    display_desc = description_ar if is_rtl and description_ar else description
    display_content = content_ar if is_rtl and content_ar else content

    h1_class = ' class="hero"' if hero else ""

    other_lang = "ar" if lang == "en" else "en"
    other_label = "عربي" if lang == "en" else "EN"
    current_url = f"/docs/{'' if page == 'home' else page}"

    return f"""<!doctype html>
<html lang="{lang}" {dir_attr}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0a0a0a">
<meta name="description" content="{html_mod.escape(display_desc)}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://madar.hamedco.com/docs/{'' if page == 'home' else page}">
<meta property="og:title" content="{html_mod.escape(display_title)} — MadarBot">
<meta property="og:description" content="{html_mod.escape(display_desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="https://madar.hamedco.com/docs/{'' if page == 'home' else page}">
<title>{html_mod.escape(display_title)} — MadarBot</title>
{jsonld}
<link rel="preconnect" href="https://cdn.jsdelivr.net">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/geist@1.3.0/dist/fonts/geist-sans/style.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/geist@1.3.0/dist/fonts/geist-mono/style.css">
<style>{DOCS_CSS}</style>
</head>
<body>
<header class="header">
  <div class="header-inner">
    <div style="display:flex;align-items:center;gap:14px;">
      <button class="mobile-menu-btn" onclick="document.querySelector('.sidebar').classList.toggle('open')" aria-label="Menu">☰</button>
      <a class="header-logo" href="/docs?lang={lang}">
        <div class="header-logo-mark">MB</div>
        MadarBot
      </a>
    </div>
    <div class="header-actions">
      <a href="{current_url}?lang={other_lang}" class="lang-toggle" title="{other_label}">{other_label}</a>
      <a href="/legal/contact?lang={lang}">{tr('support', lang)}</a>
      <a href="/webapp/agents" class="primary">{tr('dashboard', lang)}</a>
    </div>
  </div>
</header>
<div class="layout">
  <nav class="sidebar" onclick="event.target.tagName==='A'&&document.querySelector('.sidebar').classList.remove('open')">
{sidebar}
  </nav>
  <main class="content">
    <h1{h1_class}>{html_mod.escape(display_title)}</h1>
    <p class="hero-desc">{html_mod.escape(display_desc)}</p>
    <div style="display:flex;justify-content:flex-end;margin-bottom:24px;">
      <button class="feedback-copy" onclick="copyPageForLLM()" title="{tr('copy_llm', lang)}">{tr('copy_llm', lang)}</button>
    </div>
{display_content}
    <div class="feedback">
      <span class="feedback-label">{tr('was_helpful', lang)}</span>
      <div class="feedback-btns">
        <button class="feedback-btn" onclick="this.classList.add('voted');document.getElementById('fb-thanks').classList.add('show')" aria-label="{tr('yes', lang)}">{tr('yes', lang)}</button>
        <button class="feedback-btn" onclick="this.classList.add('voted');document.getElementById('fb-thanks').classList.add('show')" aria-label="{tr('no', lang)}">{tr('no', lang)}</button>
      </div>
      <span class="feedback-thanks" id="fb-thanks">{tr('thanks_feedback', lang)}</span>
    </div>
  </main>
  {toc}
</div>
<script>
function copyPageForLLM() {{
  const main = document.querySelector('main.content');
  const text = main ? main.innerText : document.body.innerText;
  navigator.clipboard.writeText(text).then(() => {{
    const btn = document.querySelector('.feedback-copy');
    const orig = btn.textContent;
    btn.textContent = '{tr('copied', lang)}';
    setTimeout(() => btn.textContent = orig, 2000);
  }});
}}

document.querySelectorAll('a[href^="#"]').forEach(a => {{
  a.addEventListener('click', function(e) {{
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) target.scrollIntoView({{ behavior: 'smooth' }});
  }});
}});

const tocLinks = document.querySelectorAll('.toc-sidebar a');
const headings = document.querySelectorAll('h2[id]');
if (tocLinks.length && headings.length) {{
  const observer = new IntersectionObserver(entries => {{
    entries.forEach(entry => {{
      if (entry.isIntersecting) {{
        tocLinks.forEach(l => l.classList.remove('toc-active'));
        const active = document.querySelector('.toc-sidebar a[href="#' + entry.target.id + '"]');
        if (active) active.classList.add('toc-active');
      }}
    }});
  }}, {{ rootMargin: '-80px 0px -60% 0px' }});
  headings.forEach(h => observer.observe(h));
}}

document.addEventListener('click', function(e) {{
  if (!e.target.closest('.sidebar') && !e.target.closest('.mobile-menu-btn')) {{
    document.querySelector('.sidebar')?.classList.remove('open');
  }}
}});
</script>
</body>
</html>"""


# ═══════════════════════════════════════════════════════════════════════════════
# HOME
# ═══════════════════════════════════════════════════════════════════════════════

HOME_EN = """
<div class="feature-grid">
  <div class="feature-card"><h4>Group Management</h4><p>Monitor and manage your Telegram groups from a unified dashboard. Track member activity, roles, and growth.</p></div>
  <div class="feature-card"><h4>Scraping Engine</h4><p>Extract member lists, message history, and engagement metrics from groups you administer.</p></div>
  <div class="feature-card"><h4>Bulk Campaigns</h4><p>Send targeted messages to group members with scheduling, personalization, and delivery tracking.</p></div>
  <div class="feature-card"><h4>Automation Tasks</h4><p>Auto-reply, welcome flows, lead capture, escalation alerts, and keyword-triggered notifications.</p></div>
  <div class="feature-card"><h4>AI-Powered Features</h4><p>Spam detection, FAQ auto-answering, content summarization, and knowledge extraction using LLMs.</p></div>
  <div class="feature-card"><h4>MCP Server</h4><p>Expose your workspace to AI agents like Claude, ChatGPT, and Cursor via the Model Context Protocol.</p></div>
  <div class="feature-card"><h4>Analytics & Insights</h4><p>View engagement metrics, group activity summaries, agent performance, and lead conversion data.</p></div>
  <div class="feature-card"><h4>Multi-Account Support</h4><p>Link multiple Telegram accounts for distributed scraping, messaging, and moderation.</p></div>
</div>

<h2>Quick Start</h2>
<div class="quick-links">
  <a class="quick-link" href="/docs/getting-started"><strong>Getting Started</strong>Set up MadarBot in 5 minutes</a>
  <a class="quick-link" href="/docs/accounts"><strong>Link Accounts</strong>Connect your Telegram accounts</a>
  <a class="quick-link" href="/docs/automation"><strong>Automation</strong>Configure auto-replies & tasks</a>
  <a class="quick-link" href="/docs/mcp"><strong>MCP Server</strong>Connect AI agents to your workspace</a>
</div>

<h2>How It Works</h2>
<div class="step"><div class="step-num">1</div><div class="step-body"><h4>Authenticate</h4><p>Sign in via Telegram WebApp. Your identity is verified through Telegram's secure authentication system.</p></div></div>
<div class="step"><div class="step-num">2</div><div class="step-body"><h4>Link Accounts</h4><p>Connect one or more Telegram accounts for scraping, messaging, and automation. Credentials are encrypted at rest.</p></div></div>
<div class="step"><div class="step-num">3</div><div class="step-body"><h4>Add Groups</h4><p>Add the Telegram groups and channels you manage. The platform fetches group metadata and member lists.</p></div></div>
<div class="step"><div class="step-num">4</div><div class="step-body"><h4>Configure & Automate</h4><p>Set up scraping jobs, automation tasks, bulk campaigns, or connect an AI agent via MCP.</p></div></div>

<h2>Human + AI Support</h2>
<p>MadarBot is designed for both <strong>human operators</strong> and <strong>AI agents</strong>:</p>
<ul>
  <li><strong>Human operators</strong>: Use the Telegram WebApp dashboard or the browser dashboard to manage groups, run campaigns, and review analytics. In-app support is available for registered users.</li>
  <li><strong>AI agents</strong>: Connect via the <a href="/docs/mcp">MCP Server</a> using the Model Context Protocol. AI assistants can read group data, manage leads, send messages, create tasks, and generate analytics — all through a standardized JSON-RPC API.</li>
  <li><strong>Hybrid</strong>: Humans and AI agents share the same workspace. AI handles data processing and drafting while humans review and approve actions.</li>
</ul>
<p>See <a href="/docs/agents">AI Agent Integration</a> for detailed instructions on connecting AI assistants to your workspace.</p>
"""

HOME_AR = """
<div class="feature-grid">
  <div class="feature-card"><h4>إدارة المجموعات</h4><p>راقب وأدر مجموعات تيليغرام من لوحة تحكم موحدة. تتبع نشاط الأعضاء والأدوار والنمو.</p></div>
  <div class="feature-card"><h4>محرك الاستخراج</h4><p>استخرج قوائم الأعضاء وسجل الرسائل ومقاييس التفاعل من المجموعات التي تديرها.</p></div>
  <div class="feature-card"><h4>الحملات الجماعية</h4><p>أرسل رسائل مستهدفة لأعضاء المجموعات مع جدولة وتخصيص وتتبع التسليم.</p></div>
  <div class="feature-card"><h4>مهام الأتمتة</h4><p>ردود تلقائية، تدفقات ترحيب، التقاط عملاء، تنبيهات تصعيد، وإشعارات بالكلمات المفتاحية.</p></div>
  <div class="feature-card"><h4>ميزات الذكاء الاصطناعي</h4><p>اكتشاف البريد المزعج، إجابة الأسئلة الشائعة، تلخيص المحتوى، واستخراج المعرفة باستخدام نماذج لغوية.</p></div>
  <div class="feature-card"><h4>خادم MCP</h4><p>اعرض مساحة عملك لوكلاء الذكاء الاصطناعي مثل Claude و ChatGPT و Cursor عبر بروتوكول MCP.</p></div>
  <div class="feature-card"><h4>التحليلات والرؤى</h4><p>اعرض مقاييس التفاعل وملخصات نشاط المجموعات وأداء الوكيل وبيانات تحويل العملاء.</p></div>
  <div class="feature-card"><h4>دعم الحسابات المتعددة</h4><p>اربط حسابات تيليغرام متعددة للاستخراج الموزع والمراسلة والإشراف.</p></div>
</div>

<h2>بداية سريعة</h2>
<div class="quick-links">
  <a class="quick-link" href="/docs/getting-started"><strong>ابدأ الآن</strong>إعداد مداربوت في 5 دقائق</a>
  <a class="quick-link" href="/docs/accounts"><strong>اربط الحسابات</strong>اربط حسابات تيليغرام الخاصة بك</a>
  <a class="quick-link" href="/docs/automation"><strong>الأتمتة</strong>إعداد الردود التلقائية والمهام</a>
  <a class="quick-link" href="/docs/mcp"><strong>خادم MCP</strong>اربط وكلاء الذكاء الاصطناعي بمساحة عملك</a>
</div>

<h2>كيف يعمل</h2>
<div class="step"><div class="step-num">١</div><div class="step-body"><h4>توثيق الدخول</h4><p>سجل الدخول عبر تطبيق تيليغرام المصغر. يتم التحقق من هويتك من خلال نظام توثيق تيليغرام الآمن.</p></div></div>
<div class="step"><div class="step-num">٢</div><div class="step-body"><h4>ربط الحسابات</h4><p>اربط حساب تيليغرام واحد أو أكثر للاستخراج والمراسلة والأتمتة. بيانات الاعتماد مشفرة.</p></div></div>
<div class="step"><div class="step-num">٣</div><div class="step-body"><h4>إضافة المجموعات</h4><p>أضف مجموعات وقنوات تيليغرام التي تديرها. المنصة تجلب بيانات المجموعة وقوائم الأعضاء.</p></div></div>
<div class="step"><div class="step-num">٤</div><div class="step-body"><h4>التكوين والأتمتة</h4><p>قم بإعداد مهام الاستخراج والأتمتة والحملات الجماعية، أو اربط وكيل ذكاء اصطناعي عبر MCP.</p></div></div>

<h2>دعم الإنسان والذكاء الاصطناعي</h2>
<p>صُمم مداربوت لكل من <strong>المشغلين البشريين</strong> و<strong>وكلاء الذكاء الاصطناعي</strong>:</p>
<ul>
  <li><strong>المشغلون البشريون</strong>: استخدم لوحة تحكم تطبيق تيليغرام المصغر أو لوحة تحكم المتصفح لإدارة المجموعات وتشغيل الحملات ومراجعة التحليلات.</li>
  <li><strong>وكلاء الذكاء الاصطناعي</strong>: اتصل عبر <a href="/docs/mcp">خادم MCP</a> باستخدام بروتوكول MCP. يمكن للمساعدين الذكيين قراءة بيانات المجموعات وإدارة العملاء وإرسال الرسائل وإنشاء المهام والتحليلات.</li>
  <li><strong>هجين</strong>: يتشارك البشر ووكلاء الذكاء الاصطناعي نفس مساحة العمل. الذكاء الاصطناعي يعالج البيانات والصياغة بينما يراجع البشر الإجراءات ويوافقون عليها.</li>
</ul>
"""


@router.get("", response_class=HTMLResponse)
@router.get("/", response_class=HTMLResponse)
async def docs_home(request: Request, lang: str = Query(default="en")) -> str:
    _ = request
    return docs_page(
        "home", "MadarBot Documentation",
        "Everything you need to automate, analyze, and manage your Telegram communities with MadarBot.",
        HOME_EN, lang=lang, hero=True,
        title_ar="توثيق مداربوت",
        description_ar="كل ما تحتاجه لأتمتة وتحليل وإدارة مجتمعات تيليغرام باستخدام مداربوت.",
        content_ar=HOME_AR,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# GETTING STARTED
# ═══════════════════════════════════════════════════════════════════════════════

GS_EN = """
<h2 id="authentication">1. Authentication</h2>
<p>MadarBot uses Telegram WebApp authentication. You don't need a separate username or password — your Telegram account is your identity.</p>
<div class="step"><div class="step-num">1</div><div class="step-body"><h4>Open the WebApp</h4><p>Navigate to <code>/webapp/agents</code> from within Telegram or visit the web URL directly.</p></div></div>
<div class="step"><div class="step-num">2</div><div class="step-body"><h4>Authorize</h4><p>Telegram prompts you to share your basic profile. Accept to continue.</p></div></div>
<div class="step"><div class="step-num">3</div><div class="step-body"><h4>Choose Your Plan</h4><p>Free tier gives view-only access. Upgrade to Pro or Business for full features.</p></div></div>

<h2 id="link-account">2. Link a Telegram Account</h2>
<ol><li>Navigate to <strong>Accounts</strong> in the sidebar</li><li>Click <strong>Link New Account</strong></li><li>Enter the phone number</li><li>Verify with the code sent to Telegram</li><li>Enter 2FA password if enabled</li></ol>
<div class="callout callout-info"><span class="callout-icon">i</span><span>Credentials are encrypted at rest. You can unlink accounts anytime.</span></div>

<h2 id="add-group">3. Add Your First Group</h2>
<ol><li>Go to <strong>Groups</strong></li><li>Click <strong>Add Group</strong></li><li>Enter the group username or invite link</li><li>Select which linked account should join</li></ol>

<h2 id="first-scrape">4. Run Your First Scrape</h2>
<ol><li>Open the group from Groups list</li><li>Click <strong>Scrape Members</strong></li><li>Optionally, click <strong>Scrape Messages</strong></li><li>Monitor progress in the <strong>Jobs</strong> panel</li></ol>
<div class="callout callout-warning"><span class="callout-icon">!</span><span>Scraping respects Telegram rate limits. Large groups may take several minutes.</span></div>

<h2 id="first-automation">5. Set Up Your First Automation</h2>
<ol><li>Go to a group's <strong>Automation</strong> tab</li><li>Click <strong>Add Task</strong></li><li>Choose a task type: Auto-Reply, Welcome Flow, Lead Capture, Escalation Alert, or Notify</li><li>Configure triggers and template</li><li>Enable the task</li></ol>

<h2 id="next-steps">Next Steps</h2>
<ul><li><a href="/docs/mcp">Connect an AI agent</a> via MCP</li><li><a href="/docs/campaigns">Create a bulk campaign</a></li><li><a href="/docs/accounts">Link more accounts</a></li><li><a href="/docs/automation">Explore all task types</a></li></ul>
"""

GS_AR = """
<h2 id="authentication">١. توثيق الدخول</h2>
<p>يستخدم مداربوت توثيق تطبيق تيليغرام المصغر. لا تحتاج لاسم مستخدم أو كلمة مرور منفصلة — حساب تيليغرام هو هويتك.</p>
<div class="step"><div class="step-num">١</div><div class="step-body"><h4>افتح التطبيق المصغر</h4><p>انتقل إلى <code>/webapp/agents</code> من داخل تيليغرام أو زر الرابط مباشرة.</p></div></div>
<div class="step"><div class="step-num">٢</div><div class="step-body"><h4>الترخيص</h4><p>يطلب تيليغرام مشاركة ملفك الأساسي. اقبل للمتابعة.</p></div></div>
<div class="step"><div class="step-num">٣</div><div class="step-body"><h4>اختر باقتك</h4><p>الباقة المجانية تمنح وصول للعرض فقط. قم بالترقية إلى Pro أو Business للميزات الكاملة.</p></div></div>

<h2 id="link-account">٢. ربط حساب تيليغرام</h2>
<ol><li>انتقل إلى <strong>الحسابات</strong> في القائمة الجانبية</li><li>انقر <strong>ربط حساب جديد</strong></li><li>أدخل رقم الهاتف</li><li>تحقق بالرمز المرسل إلى تيليغرام</li><li>أدخل كلمة مرور التحقق بعاملين إذا كانت مفعلة</li></ol>
<div class="callout callout-info"><span class="callout-icon">i</span><span>بيانات الاعتماد مشفرة. يمكنك إلغاء ربط الحسابات في أي وقت.</span></div>

<h2 id="add-group">٣. أضف مجموعتك الأولى</h2>
<ol><li>اذهب إلى <strong>المجموعات</strong></li><li>انقر <strong>إضافة مجموعة</strong></li><li>أدخل معرف المجموعة أو رابط الدعوة</li><li>اختر الحساب المرتبط الذي سينضم</li></ol>

<h2 id="first-scrape">٤. شغّل أول عملية استخراج</h2>
<ol><li>افتح المجموعة من قائمة المجموعات</li><li>انقر <strong>استخراج الأعضاء</strong></li><li>اختيارياً، انقر <strong>استخراج الرسائل</strong></li><li>تابع التقدم في لوحة <strong>المهام</strong></li></ol>
<div class="callout callout-warning"><span class="callout-icon">!</span><span>الاستخراج يحترم حدود معدل تيليغرام. قد تستغرق المجموعات الكبيرة عدة دقائق.</span></div>

<h2 id="first-automation">٥. إعداد أول أتمتة</h2>
<ol><li>اذهب إلى تبويب <strong>الأتمتة</strong> في المجموعة</li><li>انقر <strong>إضافة مهمة</strong></li><li>اختر نوع المهمة: رد تلقائي، تدفق ترحيب، التقاط عملاء، تنبيه تصعيد، أو إشعار</li><li>اضبط المحفزات والقالب</li><li>فعّل المهمة</li></ol>

<h2 id="next-steps">الخطوات التالية</h2>
<ul><li><a href="/docs/mcp">اربط وكيل ذكاء اصطناعي</a> عبر MCP</li><li><a href="/docs/campaigns">أنشئ حملة جماعية</a></li><li><a href="/docs/accounts">اربط حسابات إضافية</a></li><li><a href="/docs/automation">استكشف جميع أنواع المهام</a></li></ul>
"""


@router.get("/getting-started", response_class=HTMLResponse)
async def docs_getting_started(request: Request, lang: str = Query(default="en")) -> str:
    _ = request
    return docs_page(
        "getting-started", "Getting Started",
        "Set up MadarBot in 5 minutes: authenticate, link accounts, add groups, and run your first scrape.",
        GS_EN, lang=lang,
        title_ar="البدء",
        description_ar="إعداد مداربوت في 5 دقائق: توثيق الدخول، ربط الحسابات، إضافة المجموعات، وتشغيل أول استخراج.",
        content_ar=GS_AR,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# REMAINING PAGES (abbreviated with AR translations)
# ═══════════════════════════════════════════════════════════════════════════════

ACCOUNTS_EN = """
<h2 id="overview">Overview</h2>
<p>Linked Telegram accounts are the backbone of MadarBot's automation. Each linked account can perform scraping, messaging, and moderation tasks on your behalf.</p>
<h2 id="roles">Account Roles</h2>
<div class="table-wrap"><table>
<thead><tr><th>Role</th><th>Purpose</th><th>Capabilities</th></tr></thead>
<tbody>
<tr><td><strong>Primary</strong></td><td>Your main Telegram account</td><td>Full access — scraping, messaging, moderation, group management</td></tr>
<tr><td><strong>Scraper</strong></td><td>Dedicated scraping account</td><td>Read-only operations — member/message scraping, group browsing</td></tr>
<tr><td><strong>Moderator</strong></td><td>Automated moderation</td><td>Delete messages, ban users, manage join requests</td></tr>
<tr><td><strong>Backup</strong></td><td>Fallback account</td><td>Used when primary account hits rate limits</td></tr>
</tbody></table></div>
<h2 id="linking">Linking an Account</h2>
<ol><li>Go to <strong>Accounts</strong> → <strong>Link New Account</strong></li><li>Enter phone in international format</li><li>Enter verification code</li><li>Enter 2FA password if needed</li><li>Assign a role and label</li></ol>
<h2 id="plan-limits">Plan Limits</h2>
<div class="table-wrap"><table>
<thead><tr><th>Feature</th><th>Free</th><th>Pro</th><th>Business</th></tr></thead>
<tbody>
<tr><td>Linked accounts</td><td>1</td><td>5</td><td>25</td></tr>
<tr><td>Groups per account</td><td>5</td><td>50</td><td>Unlimited</td></tr>
<tr><td>Scraping jobs/day</td><td>3</td><td>50</td><td>Unlimited</td></tr>
<tr><td>Bulk messages/day</td><td>0</td><td>500</td><td>10,000</td></tr>
<tr><td>Automation tasks</td><td>5</td><td>50</td><td>500</td></tr>
<tr><td>Data retention</td><td>30 days</td><td>90 days</td><td>Custom</td></tr>
</tbody></table></div>
"""

ACCOUNTS_AR = """
<h2 id="overview">نظرة عامة</h2>
<p>حسابات تيليغرام المرتبطة هي العمود الفقري لأتمتة مداربوت. كل حساب مرتبط يمكنه تنفيذ مهام الاستخراج والمراسلة والإشراف نيابة عنك.</p>
<h2 id="roles">أدوار الحسابات</h2>
<div class="table-wrap"><table>
<thead><tr><th>الدور</th><th>الغرض</th><th>القدرات</th></tr></thead>
<tbody>
<tr><td><strong>أساسي</strong></td><td>حساب تيليغرام الرئيسي</td><td>وصول كامل — استخراج، مراسلة، إشراف، إدارة مجموعات</td></tr>
<tr><td><strong>مستخرج</strong></td><td>حساب استخراج مخصص</td><td>عمليات قراءة فقط — استخراج الأعضاء والرسائل</td></tr>
<tr><td><strong>مشرف</strong></td><td>إشراف آلي</td><td>حذف رسائل، حظر مستخدمين، إدارة طلبات الانضمام</td></tr>
<tr><td><strong>احتياطي</strong></td><td>حساب بديل</td><td>يُستخدم عندما يصل الحساب الأساسي لحدود المعدل</td></tr>
</tbody></table></div>
<h2 id="linking">ربط حساب</h2>
<ol><li>اذهب إلى <strong>الحسابات</strong> → <strong>ربط حساب جديد</strong></li><li>أدخل رقم الهاتف بالتنسيق الدولي</li><li>أدخل رمز التحقق</li><li>أدخل كلمة مرور التحقق بعاملين إذا لزم</li><li>حدد دوراً وعلامة</li></ol>
<h2 id="plan-limits">حدود الخطط</h2>
<div class="table-wrap"><table>
<thead><tr><th>الميزة</th><th>مجاني</th><th>محترف</th><th>أعمال</th></tr></thead>
<tbody>
<tr><td>حسابات مرتبطة</td><td>1</td><td>5</td><td>25</td></tr>
<tr><td>مجموعات لكل حساب</td><td>5</td><td>50</td><td>غير محدود</td></tr>
<tr><td>مهام استخراج/يوم</td><td>3</td><td>50</td><td>غير محدود</td></tr>
<tr><td>رسائل جماعية/يوم</td><td>0</td><td>500</td><td>10,000</td></tr>
<tr><td>مهام أتمتة</td><td>5</td><td>50</td><td>500</td></tr>
<tr><td>حفظ البيانات</td><td>30 يوم</td><td>90 يوم</td><td>مخصص</td></tr>
</tbody></table></div>
"""


@router.get("/accounts", response_class=HTMLResponse)
async def docs_accounts(request: Request, lang: str = Query(default="en")) -> str:
    return docs_page("accounts", "Accounts & Setup", "Learn how to link Telegram accounts, manage roles, and understand safety limits.", ACCOUNTS_EN, lang=lang, title_ar="الحسابات والإعداد", description_ar="تعلم كيفية ربط حسابات تيليغرام وإدارة الأدوار وفهم حدود الأمان.", content_ar=ACCOUNTS_AR)


GROUPS_EN = """<h2 id="overview">Overview</h2><p>The Groups section gives you a unified view of all Telegram groups you manage through MadarBot.</p><h2 id="adding">Adding Groups</h2><div class="endpoint"><div class="endpoint-header"><span class="endpoint-method">POST</span><span class="endpoint-path">/webapp/scraper/groups</span></div><p>Add a group by username or invite link.</p></div><h2 id="sync">Syncing Admins and Bots</h2><div class="endpoint"><div class="endpoint-header"><span class="endpoint-method">POST</span><span class="endpoint-path">/webapp/agents/{agent_id}/groups/{group_id}/sync-admins-bots</span></div><p>Synchronize admin list and bot members.</p></div><h2 id="daily-summaries">Daily Summaries & Knowledge</h2><div class="endpoint"><div class="endpoint-header"><span class="endpoint-method">GET</span><span class="endpoint-path">/webapp/scraper/groups/{id}/daily-summaries</span></div><p>AI-generated daily summaries of group activity.</p></div>"""
GROUPS_AR = """<h2 id="overview">نظرة عامة</h2><p>قسم المجموعات يمنحك رؤية موحدة لجميع مجموعات تيليغرام التي تديرها عبر مداربوت.</p><h2 id="adding">إضافة مجموعات</h2><div class="endpoint"><div class="endpoint-header"><span class="endpoint-method">POST</span><span class="endpoint-path">/webapp/scraper/groups</span></div><p>أضف مجموعة بمعرف المستخدم أو رابط الدعوة.</p></div><h2 id="sync">مزامنة المشرفين والبوتات</h2><div class="endpoint"><div class="endpoint-header"><span class="endpoint-method">POST</span><span class="endpoint-path">/webapp/agents/{agent_id}/groups/{group_id}/sync-admins-bots</span></div><p>مزامنة قائمة المشرفين وأعضاء البوتات.</p></div><h2 id="daily-summaries">الملخصات اليومية والمعرفة</h2><div class="endpoint"><div class="endpoint-header"><span class="endpoint-method">GET</span><span class="endpoint-path">/webapp/scraper/groups/{id}/daily-summaries</span></div><p>ملخصات يومية لنشاط المجموعة مولدة بالذكاء الاصطناعي.</p></div>"""


@router.get("/groups", response_class=HTMLResponse)
async def docs_groups(request: Request, lang: str = Query(default="en")) -> str:
    return docs_page("groups", "Group Management", "Add, monitor, and manage Telegram groups with member lists and admin sync.", GROUPS_EN, lang=lang, title_ar="إدارة المجموعات", description_ar="أضف وراقب وأدر مجموعات تيليغرام مع قوائم الأعضاء ومزامنة المشرفين.", content_ar=GROUPS_AR)


SCRAPING_EN = """<h2 id="overview">Overview</h2><p>The Scraping Engine extracts data from Telegram groups you administer including member lists and message history.</p><h2 id="api">API Endpoints</h2><div class="endpoint"><div class="endpoint-header"><span class="endpoint-method">POST</span><span class="endpoint-path">/webapp/scraper/scrape-members</span></div><p>Start a member scraping job.</p></div><div class="endpoint"><div class="endpoint-header"><span class="endpoint-method">POST</span><span class="endpoint-path">/webapp/scraper/scrape-messages</span></div><p>Start a message scraping job.</p></div><h2 id="limits">Rate Limits</h2><p>Use a dedicated Scraper account. Platform auto-pauses on flood wait. Page size: 100, pause: 0.2s between pages.</p></div>"""
SCRAPING_AR = """<h2 id="overview">نظرة عامة</h2><p>محرك الاستخراج يستخرج البيانات من مجموعات تيليغرام التي تديرها بما في ذلك قوائم الأعضاء وسجل الرسائل.</p><h2 id="api">نقاط النهاية</h2><div class="endpoint"><div class="endpoint-header"><span class="endpoint-method">POST</span><span class="endpoint-path">/webapp/scraper/scrape-members</span></div><p>ابدأ مهمة استخراج الأعضاء.</p></div><div class="endpoint"><div class="endpoint-header"><span class="endpoint-method">POST</span><span class="endpoint-path">/webapp/scraper/scrape-messages</span></div><p>ابدأ مهمة استخراج الرسائل.</p></div><h2 id="limits">حدود المعدل</h2><p>استخدم حساب مستخرج مخصص. المنصة تتوقف تلقائياً عند الفيضان. حجم الصفحة: 100، توقف: 0.2 ثانية.</p>"""


@router.get("/scraping", response_class=HTMLResponse)
async def docs_scraping(request: Request, lang: str = Query(default="en")) -> str:
    return docs_page("scraping", "Scraping Engine", "Extract member lists, message history, and group data.", SCRAPING_EN, lang=lang, title_ar="محرك الاستخراج", description_ar="استخرج قوائم الأعضاء وسجل الرسائل وبيانات المجموعات.", content_ar=SCRAPING_AR)


CAMPAIGNS_EN = """<h2 id="overview">Overview</h2><p>Bulk Campaigns let you send targeted messages to group members at scale.</p><h2 id="creating">Creating a Campaign</h2><div class="endpoint"><div class="endpoint-header"><span class="endpoint-method">POST</span><span class="endpoint-path">/webapp/agents/{agent_id}/campaigns</span></div><p>Create a new bulk messaging campaign.</p></div><h2 id="best-practices">Best Practices</h2><ul><li>Personalize with {first_name}</li><li>Test on small groups first</li><li>Respect rate limits (30-60 msg/min)</li><li>Include opt-out instructions</li></ul>"""
CAMPAIGNS_AR = """<h2 id="overview">نظرة عامة</h2><p>الحملات الجماعية تتيح إرسال رسائل مستهدفة لأعضاء المجموعات على نطاق واسع.</p><h2 id="creating">إنشاء حملة</h2><div class="endpoint"><div class="endpoint-header"><span class="endpoint-method">POST</span><span class="endpoint-path">/webapp/agents/{agent_id}/campaigns</span></div><p>أنشئ حملة مراسلة جماعية جديدة.</p></div><h2 id="best-practices">أفضل الممارسات</h2><ul><li>خصص باستخدام {first_name}</li><li>اختبر على مجموعات صغيرة أولاً</li><li>احترم حدود المعدل (30-60 رسالة/دقيقة)</li><li>ضمن تعليمات إلغاء الاشتراك</li></ul>"""


@router.get("/campaigns", response_class=HTMLResponse)
async def docs_campaigns(request: Request, lang: str = Query(default="en")) -> str:
    return docs_page("campaigns", "Bulk Campaigns", "Create targeted bulk messaging campaigns with delivery tracking.", CAMPAIGNS_EN, lang=lang, title_ar="الحملات الجماعية", description_ar="أنشئ حملات مراسلة جماعية مستهدفة مع تتبع التسليم.", content_ar=CAMPAIGNS_AR)


AUTOMATION_EN = """<h2 id="overview">Overview</h2><p>Automation tasks process incoming messages and trigger actions based on configurable rules.</p><h2 id="task-types">Task Types</h2><div class="table-wrap"><table><thead><tr><th>Type</th><th>Function</th></tr></thead><tbody><tr><td><code>reply_message</code></td><td>Auto-reply to keyword matches</td></tr><tr><td><code>welcome_flow</code></td><td>Send welcome to new members</td></tr><tr><td><code>lead_capture</code></td><td>Capture contact info</td></tr><tr><td><code>escalation_alert</code></td><td>Notify admins of conditions</td></tr><tr><td><code>notify_destination</code></td><td>Forward to another chat</td></tr></tbody></table></div>"""
AUTOMATION_AR = """<h2 id="overview">نظرة عامة</h2><p>مهام الأتمتة تعالج الرسائل الواردة وتطلق إجراءات بناءً على قواعد قابلة للتكوين.</p><h2 id="task-types">أنواع المهام</h2><div class="table-wrap"><table><thead><tr><th>النوع</th><th>الوظيفة</th></tr></thead><tbody><tr><td><code>reply_message</code></td><td>رد تلقائي على الكلمات المفتاحية</td></tr><tr><td><code>welcome_flow</code></td><td>ترحيب بالأعضاء الجدد</td></tr><tr><td><code>lead_capture</code></td><td>التقاط معلومات التواصل</td></tr><tr><td><code>escalation_alert</code></td><td>إشعار المشرفين بحالات معينة</td></tr><tr><td><code>notify_destination</code></td><td>إعادة توجيه لدردشة أخرى</td></tr></tbody></table></div>"""


@router.get("/automation", response_class=HTMLResponse)
async def docs_automation(request: Request, lang: str = Query(default="en")) -> str:
    return docs_page("automation", "Automation Tasks", "Configure auto-replies, welcome flows, lead capture, and more.", AUTOMATION_EN, lang=lang, title_ar="مهام الأتمتة", description_ar="إعداد الردود التلقائية وتدفقات الترحيب والتقاط العملاء والمزيد.", content_ar=AUTOMATION_AR)


LEADS_EN = """<h2 id="overview">Overview</h2><p>The Leads system captures and organizes contacts from automated lead capture tasks.</p><h2 id="api">API Endpoints</h2><div class="endpoint"><div class="endpoint-header"><span class="endpoint-method">GET</span><span class="endpoint-path">/webapp/agents/{id}/leads</span></div><p>List leads with filtering by status, source, and date.</p></div><h2 id="ai-leads">AI-Assisted Lead Management</h2><p>AI agents via MCP can read, score, and update leads automatically.</p>"""
LEADS_AR = """<h2 id="overview">نظرة عامة</h2><p>نظام العملاء يلتقط وينظم جهات الاتصال من مهام التقاط العملاء الآلية.</p><h2 id="api">نقاط النهاية</h2><div class="endpoint"><div class="endpoint-header"><span class="endpoint-method">GET</span><span class="endpoint-path">/webapp/agents/{id}/leads</span></div><p>عرض العملاء مع التصفية حسب الحالة والمصدر والتاريخ.</p></div><h2 id="ai-leads">إدارة العملاء بالذكاء الاصطناعي</h2><p>وكلاء الذكاء الاصطناعي عبر MCP يمكنهم قراءة وتقييم وتحديث العملاء تلقائياً.</p>"""


@router.get("/leads", response_class=HTMLResponse)
async def docs_leads(request: Request, lang: str = Query(default="en")) -> str:
    return docs_page("leads", "Leads Management", "Capture, track, and manage leads with AI-assisted scoring.", LEADS_EN, lang=lang, title_ar="إدارة العملاء", description_ar="التقاط وتتبع وإدارة العملاء مع تقييم بالذكاء الاصطناعي.", content_ar=LEADS_AR)


ANALYTICS_EN = """<h2 id="overview">Overview</h2><p>View platform usage metrics, group activity, agent performance, and AI feature effectiveness.</p><h2 id="api">API</h2><div class="endpoint"><div class="endpoint-header"><span class="endpoint-method">GET</span><span class="endpoint-path">/webapp/agents/{id}/analytics</span></div><p>Analytics summary for a specific agent.</p></div><h2 id="notifications">Notifications</h2><p>Alerts for new leads, escalation, subscription limits, account state changes, and campaign completion.</p>"""
ANALYTICS_AR = """<h2 id="overview">نظرة عامة</h2><p>اعرض مقاييس استخدام المنصة ونشاط المجموعات وأداء الوكيل وفعالية ميزات الذكاء الاصطناعي.</p><h2 id="api">API</h2><div class="endpoint"><div class="endpoint-header"><span class="endpoint-method">GET</span><span class="endpoint-path">/webapp/agents/{id}/analytics</span></div><p>ملخص تحليلات لوكيل محدد.</p></div><h2 id="notifications">الإشعارات</h2><p>تنبيهات للعملاء الجدد والتصعيد وحدود الاشتراك وتغييرات حالة الحساب واكتمال الحملات.</p>"""


@router.get("/analytics", response_class=HTMLResponse)
async def docs_analytics(request: Request, lang: str = Query(default="en")) -> str:
    return docs_page("analytics", "Analytics", "View platform usage, group activity, lead conversion, and AI performance.", ANALYTICS_EN, lang=lang, title_ar="التحليلات", description_ar="اعرض استخدام المنصة ونشاط المجموعات وتحويل العملاء وأداء الذكاء الاصطناعي.", content_ar=ANALYTICS_AR)


SUB_EN = """<h2 id="plans">Plans</h2><div class="table-wrap"><table><thead><tr><th>Feature</th><th>Free</th><th>Pro</th><th>Business</th></tr></thead><tbody><tr><td>Dashboard access</td><td>View only</td><td>Full</td><td>Full</td></tr><tr><td>Linked accounts</td><td>1</td><td>5</td><td>25</td></tr><tr><td>Groups</td><td>5</td><td>50</td><td>Unlimited</td></tr><tr><td>Scraping jobs/day</td><td>3</td><td>50</td><td>Unlimited</td></tr><tr><td>Bulk messages/day</td><td>—</td><td>500</td><td>10,000</td></tr><tr><td>Automation tasks</td><td>5</td><td>50</td><td>500</td></tr><tr><td>MCP Server</td><td>Read-only</td><td>Read-only</td><td>Read + Write</td></tr><tr><td>AI features</td><td>—</td><td>Basic</td><td>Full</td></tr><tr><td>Data retention</td><td>30 days</td><td>90 days</td><td>Custom</td></tr><tr><td>Priority support</td><td>—</td><td>—</td><td>Yes</td></tr></tbody></table></div><h2 id="billing">Billing</h2><p>Paid plans billed monthly/annually via Stripe. Cancel anytime from Settings → Billing.</p>"""
SUB_AR = """<h2 id="plans">الخطط</h2><div class="table-wrap"><table><thead><tr><th>الميزة</th><th>مجاني</th><th>محترف</th><th>أعمال</th></tr></thead><tbody><tr><td>الوصول للوحة التحكم</td><td>عرض فقط</td><td>كامل</td><td>كامل</td></tr><tr><td>حسابات مرتبطة</td><td>1</td><td>5</td><td>25</td></tr><tr><td>مجموعات</td><td>5</td><td>50</td><td>غير محدود</td></tr><tr><td>مهام استخراج/يوم</td><td>3</td><td>50</td><td>غير محدود</td></tr><tr><td>رسائل جماعية/يوم</td><td>—</td><td>500</td><td>10,000</td></tr><tr><td>مهام أتمتة</td><td>5</td><td>50</td><td>500</td></tr><tr><td>خادم MCP</td><td>قراءة فقط</td><td>قراءة فقط</td><td>قراءة + كتابة</td></tr><tr><td>ميزات ذكاء اصطناعي</td><td>—</td><td>أساسي</td><td>كامل</td></tr><tr><td>حفظ البيانات</td><td>30 يوم</td><td>90 يوم</td><td>مخصص</td></tr><tr><td>دعم بأولوية</td><td>—</td><td>—</td><td>نعم</td></tr></tbody></table></div><h2 id="billing">الفوترة</h2><p>الخطط المدفوعة تتم عبر Stripe شهرياً/سنوياً. يمكنك الإلغاء في أي وقت من الإعدادات → الفوترة.</p>"""


@router.get("/subscription", response_class=HTMLResponse)
async def docs_subscription(request: Request, lang: str = Query(default="en")) -> str:
    return docs_page("subscription", "Subscription Plans", "Compare Free, Pro, and Business plans.", SUB_EN, lang=lang, title_ar="خطط الاشتراك", description_ar="قارن بين الخطط المجانية والمحترفة والأعمال.", content_ar=SUB_AR)


MCP_EN = """<h2 id="overview">Overview</h2><p>The MCP Server exposes your MadarBot workspace to AI agents via JSON-RPC 2.0.</p><h2 id="enabling">Enabling</h2><ol><li>Set <code>MCP_ENABLED=true</code> in environment</li><li>Generate an MCP token in Settings → MCP Tokens</li><li>Configure your AI client with the endpoint</li></ol><h2 id="tools">Available Tools</h2><h3>Read Operations</h3><ul><li><code>health</code>, <code>list_accounts</code>, <code>list_groups</code>, <code>list_members</code>, <code>list_messages</code>, <code>list_leads</code>, <code>list_tasks</code>, <code>list_campaigns</code>, <code>get_analytics</code>, <code>get_group_knowledge</code>, <code>get_daily_summary</code></li></ul><h3>Write Operations</h3><ul><li><code>create_task</code>, <code>update_task</code>, <code>delete_task</code>, <code>update_lead</code>, <code>create_campaign</code>, <code>cancel_campaign</code>, <code>send_message</code></li></ul><h2 id="auth">Authentication</h2><pre><code>Authorization: Bearer &lt;mcp_token&gt;</code></pre><h2 id="example">Configuration Example</h2><pre><code>{{
  "mcpServers": {{
    "madarbot": {{
      "url": "https://madar.hamedco.com/mcp/",
      "headers": {{ "Authorization": "Bearer YOUR_TOKEN" }}
    }}
  }}
}}</code></pre>"""
MCP_AR = """<h2 id="overview">نظرة عامة</h2><p>خادم MCP يعرض مساحة عمل مداربوت لوكلاء الذكاء الاصطناعي عبر JSON-RPC 2.0.</p><h2 id="enabling">التفعيل</h2><ol><li>اضبط <code>MCP_ENABLED=true</code> في البيئة</li><li>أنشئ رمز MCP في الإعدادات → رموز MCP</li><li>اضبط عميل الذكاء الاصطناعي مع نقطة النهاية</li></ol><h2 id="tools">الأدوات المتاحة</h2><h3>عمليات القراءة</h3><ul><li><code>health</code>, <code>list_accounts</code>, <code>list_groups</code>, <code>list_members</code>, <code>list_messages</code>, <code>list_leads</code>, <code>list_tasks</code>, <code>list_campaigns</code>, <code>get_analytics</code>, <code>get_group_knowledge</code>, <code>get_daily_summary</code></li></ul><h3>عمليات الكتابة</h3><ul><li><code>create_task</code>, <code>update_task</code>, <code>delete_task</code>, <code>update_lead</code>, <code>create_campaign</code>, <code>cancel_campaign</code>, <code>send_message</code></li></ul><h2 id="auth">التوثيق</h2><pre><code>Authorization: Bearer &lt;mcp_token&gt;</code></pre><h2 id="example">مثال للإعداد</h2><pre><code>{{
  "mcpServers": {{
    "madarbot": {{
      "url": "https://madar.hamedco.com/mcp/",
      "headers": {{ "Authorization": "Bearer YOUR_TOKEN" }}
    }}
  }}
}}</code></pre>"""


@router.get("/mcp", response_class=HTMLResponse)
async def docs_mcp(request: Request, lang: str = Query(default="en")) -> str:
    return docs_page("mcp", "MCP Server", "Connect AI agents via Model Context Protocol (JSON-RPC API).", MCP_EN, lang=lang, title_ar="خادم MCP", description_ar="اربط وكلاء الذكاء الاصطناعي عبر بروتوكول MCP (JSON-RPC API).", content_ar=MCP_AR)


AGENTS_EN = """<h2 id="overview">Overview</h2><p>MadarBot's MCP Server enables AI agents to interact with your Telegram workspace programmatically.</p><h2 id="capabilities">What AI Agents Can Do</h2><div class="table-wrap"><table><thead><tr><th>Capability</th><th>Plan Required</th></tr></thead><tbody><tr><td>Read workspace data</td><td>Free+</td></tr><tr><td>Manage leads</td><td>Pro+</td></tr><tr><td>Create automation tasks</td><td>Pro+</td></tr><tr><td>Run campaigns</td><td>Business</td></tr><tr><td>Send messages</td><td>Business</td></tr><tr><td>View analytics</td><td>Free+</td></tr></tbody></table></div><h2 id="setup">Setup Guide</h2><h3>Claude Desktop</h3><pre><code>{{
  "mcpServers": {{
    "madarbot": {{ "url": "https://madar.hamedco.com/mcp/", "headers": {{ "Authorization": "Bearer YOUR_TOKEN" }} }}
  }}
}}</code></pre><h3>Cursor / Cline</h3><p>Same JSON-RPC config in MCP settings panel.</p><h2 id="errors">Error Codes</h2><div class="table-wrap"><table><thead><tr><th>Code</th><th>Meaning</th></tr></thead><tbody><tr><td><code>-32001</code></td><td>Authentication failed</td></tr><tr><td><code>-32002</code></td><td>Permission denied</td></tr><tr><td><code>-32003</code></td><td>Resource not found</td></tr><tr><td><code>-32004</code></td><td>Rate limited</td></tr><tr><td><code>-32007</code></td><td>Plan limit exceeded</td></tr></tbody></table></div><h2 id="human-support">Human + AI Collaboration</h2><ul><li><strong>AI agents</strong> handle data processing, lead scoring, content drafting</li><li><strong>Human operators</strong> review output, approve sensitive actions, make strategic decisions</li></ul>"""
AGENTS_AR = """<h2 id="overview">نظرة عامة</h2><p>خادم MCP في مداربوت يمكّن وكلاء الذكاء الاصطناعي من التفاعل مع مساحة عمل تيليغرام برمجياً.</p><h2 id="capabilities">ما يمكن لوكلاء الذكاء الاصطناعي فعله</h2><div class="table-wrap"><table><thead><tr><th>القدرة</th><th>الخطة المطلوبة</th></tr></thead><tbody><tr><td>قراءة بيانات مساحة العمل</td><td>مجاني+</td></tr><tr><td>إدارة العملاء</td><td>محترف+</td></tr><tr><td>إنشاء مهام أتمتة</td><td>محترف+</td></tr><tr><td>تشغيل حملات</td><td>أعمال</td></tr><tr><td>إرسال رسائل</td><td>أعمال</td></tr><tr><td>عرض التحليلات</td><td>مجاني+</td></tr></tbody></table></div><h2 id="setup">دليل الإعداد</h2><h3>Claude Desktop</h3><pre><code>{{
  "mcpServers": {{
    "madarbot": {{ "url": "https://madar.hamedco.com/mcp/", "headers": {{ "Authorization": "Bearer YOUR_TOKEN" }} }}
  }}
}}</code></pre><h3>Cursor / Cline</h3><p>نفس إعداد JSON-RPC في لوحة إعدادات MCP.</p><h2 id="errors">رموز الأخطاء</h2><div class="table-wrap"><table><thead><tr><th>الرمز</th><th>المعنى</th></tr></thead><tbody><tr><td><code>-32001</code></td><td>فشل التوثيق</td></tr><tr><td><code>-32002</code></td><td>تم رفض الإذن</td></tr><tr><td><code>-32003</code></td><td>المورد غير موجود</td></tr><tr><td><code>-32004</code></td><td>تم تقييد المعدل</td></tr><tr><td><code>-32007</code></td><td>تم تجاوز حد الخطة</td></tr></tbody></table></div><h2 id="human-support">تعاون الإنسان والذكاء الاصطناعي</h2><ul><li><strong>وكلاء الذكاء الاصطناعي</strong> يعالجون البيانات وتقييم العملاء وصياغة المحتوى</li><li><strong>المشغلون البشريون</strong> يراجعون المخرجات ويوافقون على الإجراءات الحساسة</li></ul>"""


@router.get("/agents", response_class=HTMLResponse)
async def docs_agents(request: Request, lang: str = Query(default="en")) -> str:
    return docs_page("agents", "AI Agent Integration", "Connect AI assistants to your workspace via MCP.", AGENTS_EN, lang=lang, title_ar="تكامل الذكاء الاصطناعي", description_ar="اربط مساعدي الذكاء الاصطناعي بمساحة عملك عبر MCP.", content_ar=AGENTS_AR)


FAQ_EN = """<h2 id="general">General</h2><h3>What is MadarBot?</h3><p>MadarBot is a Telegram automation platform for managing groups, scraping data, sending campaigns, and connecting AI agents.</p><h3>Is it free?</h3><p>Free plan available with limited features. Pro and Business unlock full capabilities.</p><h2 id="accounts">Accounts</h2><h3>Is my Telegram account safe?</h3><p>Yes. Credentials are encrypted at rest. You can unlink anytime.</p><h3>Can I use multiple accounts?</h3><p>Yes. Pro supports 5, Business supports 25 linked accounts.</p><h2 id="mcp-faq">MCP & AI Agents</h2><h3>What AI agents can connect?</h3><p>Any MCP-compatible client: Claude Desktop, Cursor, Cline, Windsurf, ChatGPT (via GPT Actions).</p><h3>Can AI agents send messages?</h3><p>Yes, on Business plans with MCP_READONLY=false.</p><h2 id="billing">Billing</h2><h3>How do I cancel?</h3><p>Cancel from Settings → Billing. Active until end of billing period.</p>"""
FAQ_AR = """<h2 id="general">عام</h2><h3>ما هو مداربوت؟</h3><p>مداربوت منصة أتمتة تيليغرام لإدارة المجموعات واستخراج البيانات وإرسال الحملات وربط وكلاء الذكاء الاصطناعي.</p><h3>هل هو مجاني؟</h3><p>تتوفر خطة مجانية بميزات محدودة. Pro و Business تفتحان القدرات الكاملة.</p><h2 id="accounts">الحسابات</h2><h3>هل حساب تيليغرام آمن؟</h3><p>نعم. بيانات الاعتماد مشفرة. يمكنك إلغاء الربط في أي وقت.</p><h3>هل يمكنني استخدام حسابات متعددة؟</h3><p>نعم. Pro يدعم 5 حسابات، Business يدعم 25.</p><h2 id="mcp-faq">MCP ووكلاء الذكاء الاصطناعي</h2><h3>أي وكلاء ذكاء اصطناعي يمكنهم الاتصال؟</h3><p>أي عميل متوافق مع MCP: Claude Desktop و Cursor و Cline و Windsurf و ChatGPT.</p><h3>هل يمكن لوكلاء الذكاء الاصطناعي إرسال رسائل؟</h3><p>نعم، في خطة Business مع MCP_READONLY=false.</p><h2 id="billing">الفوترة</h2><h3>كيف ألغي اشتراكي؟</h3><p>ألغِ من الإعدادات → الفوترة. يبقى نشطاً حتى نهاية فترة الفوترة.</p>"""


@router.get("/faq", response_class=HTMLResponse)
async def docs_faq(request: Request, lang: str = Query(default="en")) -> str:
    return docs_page("faq", "FAQ", "Frequently asked questions about MadarBot.", FAQ_EN, lang=lang, title_ar="الأسئلة الشائعة", description_ar="أسئلة متكررة حول مداربوت.", content_ar=FAQ_AR)
