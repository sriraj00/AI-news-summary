"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUpRight, BookOpen, Check, ChevronDown, CircleHelp, Clock3, Copy, FileText, Filter, Globe2, Layers3, LoaderCircle, Menu, Plus, Quote, Search, ShieldCheck, Sparkles, Upload, X } from "lucide-react";
import { jsPDF } from "jspdf";

type Article = { id: string; title: string; publisher: string; text: string; url?: string; filename?: string };
type Evidence = { article_id?: string; article_title?: string; publisher?: string; paragraph?: number; text?: string; score?: number };
type ClaimStatus = "ENTAILED" | "SUPPORTED" | "CONTRADICTED" | "INSUFFICIENT EVIDENCE";
type Claim = { id: string; text: string; status?: ClaimStatus; confidence?: number; explanation?: string; evidence?: Evidence[] };
type Report = { id?: string; summary?: string; article_summaries?: { title: string; summary: string }[]; findings?: string[]; common_information?: string[]; conflicts?: string[]; claims?: Claim[]; created_at?: string; persisted?: boolean; history_message?: string };
type Stage = "idle" | "processing" | "summarizing" | "extracting" | "retrieving" | "verifying" | "auditing";
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const initial: Article[] = [{ id: "article-1", title: "Paste a news article to begin", publisher: "Publication", text: "" }];
const demoArticle: Article = { id: "demo-1", title: "A quieter way to power the grid", publisher: "The Daily Ledger", text: "A new grid battery project began operating outside Redstone on Tuesday, according to the regional energy authority. The 240-megawatt-hour facility can store enough electricity to serve about 18,000 homes for four hours. It was built by Northstar Energy and will supply stored power to the local utility under a 12-year agreement. The authority said the project cost $86 million and is expected to reduce reliance on gas peaker plants during evening demand. Northstar said the battery uses lithium iron phosphate cells and has a planned operating life of 20 years. The project is the first of three storage sites approved in the region this year." };

function uid() { return `${Date.now()}-${Math.random().toString(16).slice(2, 7)}`; }
function displayStatus(status?: ClaimStatus) { return status === "SUPPORTED" ? "ENTAILED" : status || "INSUFFICIENT EVIDENCE"; }
function statusClass(status?: ClaimStatus) { const normalized = displayStatus(status); return normalized === "ENTAILED" ? "supported" : normalized.toLowerCase().replaceAll(" ", "-"); }
async function api(path: string, body?: unknown, method = "POST") {
  const response = await fetch(`${API}${path}`, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || `Request failed (${response.status})`);
  return data;
}

export default function Home() {
  const [articles, setArticles] = useState<Article[]>(initial);
  const [report, setReport] = useState<Report | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState("ALL");
  const [menuOpen, setMenuOpen] = useState(false);
  const [history, setHistory] = useState<Report[]>([]);
  const [historyMessage, setHistoryMessage] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [urlTitle, setUrlTitle] = useState("");
  const [activeTab, setActiveTab] = useState("home");
  const [uploadProgress, setUploadProgress] = useState("");
  const busy = stage !== "idle";
  const validArticles = articles.filter(a => a.text.trim().length > 25);
  const filteredClaims = useMemo(() => (report?.claims || []).filter(c => filter === "ALL" || displayStatus(c.status) === filter), [report, filter]);
  const counts = useMemo(() => ({ entailed: report?.claims?.filter(c => displayStatus(c.status) === "ENTAILED").length || 0, contradicted: report?.claims?.filter(c => c.status === "CONTRADICTED").length || 0, insufficient: report?.claims?.filter(c => c.status === "INSUFFICIENT EVIDENCE").length || 0 }), [report]);

  const loadHistory = useCallback(async () => {
    try {
      const data = await api("/history", undefined, "GET");
      setHistory(Array.isArray(data.items) ? data.items : []);
      setHistoryMessage(data.message || "");
    } catch (e) {
      setHistory([]);
      setHistoryMessage(`History could not be loaded. ${e instanceof Error ? e.message : "Check that the API is available."}`);
    }
  }, []);
  useEffect(() => {
    loadHistory();
    const targets = ["home", "analyze", "how"]
      .map(id => document.getElementById(id))
      .filter((item): item is HTMLElement => Boolean(item));
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible?.target.id) setActiveTab(visible.target.id);
    }, { rootMargin: "-20% 0px -65% 0px", threshold: [0, .15, .4] });
    targets.forEach(target => observer.observe(target));
    return () => observer.disconnect();
  }, [loadHistory]);

  function updateArticle(id: string, key: keyof Article, value: string) { setArticles(old => old.map(a => a.id === id ? { ...a, [key]: value } : a)); }
  function addArticle() { setArticles(old => [...old, { id: uid(), title: "", publisher: "", text: "" }]); }
  async function addFiles(files: FileList | null) {
    if (!files) return;
    setError("");
    const selected = Array.from(files);
    for (const [index, file] of selected.entries()) {
      setUploadProgress(`Reading ${file.name} · ${index + 1} of ${selected.length}`);
      try {
        const form = new FormData(); form.append("file", file);
        const data = await fetch(`${API}/articles/upload`, { method: "POST", body: form }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.detail || "Upload failed"); return d; });
        setArticles(old => [...old.filter(a => a.text.trim() || a.title), { id: data.id || uid(), title: data.title || file.name.replace(/\.[^.]+$/, ""), publisher: "Uploaded document", text: data.text, filename: file.name }]);
      } catch (e) { setError(e instanceof Error ? e.message : "Could not read this file."); }
    }
    setUploadProgress("");
  }
  async function addUrl() {
    if (!urlInput.trim()) return;
    setError(""); setStage("processing");
    try {
      const data = await api("/articles/process", { url: urlInput });
      const source = data.articles?.[0] as Article | undefined;
      if (!source?.text) throw new Error("The API returned no article text for that URL.");
      setArticles(old => [...old.filter(a => a.text.trim() || a.title), { ...source, title: urlTitle.trim() || source.title, url: source.url || urlInput }]);
      setUrlInput(""); setUrlTitle("");
    }
    catch (e) { setError(e instanceof Error ? e.message : "Could not fetch that article. Paste its text instead."); }
    finally { setStage("idle"); }
  }
  async function analyze() {
    if (!validArticles.length) { setError("Add at least one article with a few paragraphs before analyzing."); return; }
    setError(""); setReport(null);
    try {
      setStage("processing"); const processed = await api("/articles/process", { articles: validArticles.map(({ id, title, publisher, text, url }) => ({ id, title, publisher, text, url })) });
      const sourceArticles: Article[] = processed.articles || validArticles;
      setStage("summarizing"); const summary = await api("/summarize", { articles: sourceArticles });
      setStage("extracting"); const extracted = await api("/claims/extract", { summary, articles: sourceArticles });
      setStage("retrieving"); const retrieved = await api("/sources/retrieve", { claims: extracted.claims, passages: processed.passages });
      setStage("verifying"); const verified = await api("/claims/verify", { claims: retrieved.claims });
      setStage("auditing"); const finalReport = await api("/audit/generate", { summary, articles: sourceArticles, claims: verified.claims, findings: summary.findings, common_information: summary.common_information, conflicts: summary.conflicts });
      setReport(finalReport); setExpanded(finalReport.claims?.[0]?.id || null); setFilter("ALL"); await loadHistory();
      document.getElementById("results")?.scrollIntoView({ behavior: "smooth" });
    } catch (e) { setError(e instanceof Error ? e.message : "Analysis failed. Check your API settings and try again."); }
    finally { setStage("idle"); }
  }
  async function openHistory(id: string) { try { const data = await api(`/history/${id}`, undefined, "GET"); setReport(data); setHistoryOpen(false); document.getElementById("results")?.scrollIntoView({ behavior: "smooth" }); } catch (e) { setError(e instanceof Error ? e.message : "Could not load this analysis."); } }
  async function deleteHistory(id: string) { try { await api(`/history/${id}`, undefined, "DELETE"); await loadHistory(); } catch { setError("Could not delete this history item."); } }
  async function copy(text: string) { try { await navigator.clipboard.writeText(text); } catch { setError("Clipboard access was unavailable."); } }
  function exportPdf() {
    if (!report) return;
    const pdf = new jsPDF(); let y = 18;
    const line = (txt: string, size = 10, gap = 6) => { pdf.setFontSize(size); const rows = pdf.splitTextToSize(txt, 175); if (y + rows.length * gap > 280) { pdf.addPage(); y = 18; } pdf.text(rows, 18, y); y += rows.length * gap + 3; };
    pdf.setTextColor(13, 36, 54); line("AI NEWS TRACE", 10); line("Verification report", 24, 10); line(new Date().toLocaleString(), 9); y += 4; line("SUMMARY", 12); line(report.summary || "");
    line(`CLAIMS  ${report.claims?.length || 0}     ENTAILED  ${counts.entailed}     CONTRADICTED  ${counts.contradicted}     INSUFFICIENT  ${counts.insufficient}`, 9); y += 4;
    (report.claims || []).forEach(c => { line(`${displayStatus(c.status)} · ${c.text}`, 11); line(c.explanation || ""); c.evidence?.forEach(e => line(`Source: ${e.article_title || "Article"}, paragraph ${e.paragraph || "—"}\n“${e.text || "No passage retrieved"}”`, 9)); y += 3; });
    pdf.save(`ai-news-trace-${report.id || "report"}.pdf`);
  }

  const steps = [{ key: "processing", text: "Preparing source passages" }, { key: "summarizing", text: "Writing article summaries" }, { key: "extracting", text: "Extracting factual claims" }, { key: "retrieving", text: "Finding original evidence" }, { key: "verifying", text: "Checking evidence against claims" }, { key: "auditing", text: "Building the audit report" }];
  const sectionLink = (id: string, label: string) => <a className={activeTab === id || (id === "history" && historyOpen) ? "nav-link active" : "nav-link"} href={`#${id}`} onClick={e => { if (id === "history") e.preventDefault(); setActiveTab(id); setMenuOpen(false); if (id === "history") setHistoryOpen(true); }}>{label}</a>;

  return <>
    <header className="topbar"><a href="#home" className="brand" aria-label="AI News Trace home"><span className="brand-mark"><span /><span /><span /></span><span>AI News <b>Trace</b></span></a><nav className={menuOpen ? "nav-links open" : "nav-links"}>{sectionLink("home", "Home")}{sectionLink("analyze", "Analyze")}{sectionLink("how", "How it works")}{sectionLink("history", "History")}</nav><a href="#analyze" className="nav-cta">Get started <ArrowUpRight size={15} /></a><button className="mobile-toggle" onClick={() => setMenuOpen(v => !v)} aria-label="Toggle menu">{menuOpen ? <X /> : <Menu />}</button></header>

    <main>
      <section className="hero wrap" id="home"><div className="hero-copy"><div className="eyebrow"><span className="eyebrow-dot" /> INTELLIGENT NEWS VERIFICATION</div><h1>Read less.<br /><em>Understand more.</em><br />Verify everything.</h1><p className="hero-lede">A clearer view of the news. Turn multiple articles into a grounded summary, then trace every claim back to the words that support it.</p><div className="hero-actions"><a className="button primary" href="#analyze">Analyze news <ArrowRight size={16} /></a><a className="button secondary" href="#how">Explore how it works <ArrowDown size={15} /></a></div><div className="hero-note"><span className="note-rule" /> Evidence comes first. Every time.</div></div>
        <div className="hero-art" aria-label="Illustration of news stories being checked against their sources"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-paper paper-back"><span className="paper-tag">FIELD NOTES / 04</span><i /><i /><i /><i /></div><div className="art-paper paper-front"><span className="paper-tag">THE DAILY LEDGER</span><strong>What the<br />numbers say</strong><i /><i /><div className="highlight-line" /><i /></div><div className="trace-line line-a" /><div className="trace-line line-b" /><div className="ai-seal"><span className="seal-ring"><Sparkles size={25} strokeWidth={1.5} /></span><small>TRACE<br />ENGINE</small></div><div className="evidence-chip"><span className="chip-check"><Check size={12} /></span><div><b>Source found</b><small>Paragraph 03 · 94% match</small></div></div><div className="art-caption">ONE CLAIM, BACK TO ITS SOURCE <span>01 — 03</span></div></div>
        <div className="hero-index"><span>01</span> / 04 <span className="index-line" /></div></section>

      <section className="ticker"><div className="ticker-inner"><span>BUILT FOR CURIOSITY</span><i /> <span>GROUNDED IN SOURCES</span><i /> <span>TRANSPARENT BY DESIGN</span><i /> <span>BUILT FOR CURIOSITY</span></div></section>

      <section className="features wrap" aria-label="Platform features"><div className="section-kicker">A BETTER WAY TO FOLLOW THE STORY <span>01 / 03</span></div><div className="feature-grid"><article className="feature"><span className="feature-icon"><BookOpen size={18} /></span><div><h3>Smart summarization</h3><p>Get the substance across multiple articles, without losing the details that matter.</p><a href="#analyze">See it in action <ArrowRight size={14} /></a></div></article><article className="feature"><span className="feature-icon"><Layers3 size={18} /></span><div><h3>Source traceability</h3><p>Every extracted claim points back to a specific paragraph in its original article.</p><a href="#example">Follow a claim <ArrowRight size={14} /></a></div></article><article className="feature"><span className="feature-icon"><ShieldCheck size={18} /></span><div><h3>Evidence verification</h3><p>Find what the evidence supports, contradicts, or leaves unresolved.</p><a href="#how">How we check <ArrowRight size={14} /></a></div></article></div></section>

      <section className="how-section" id="how"><div className="wrap how-layout"><div className="how-intro"><div className="eyebrow"><span className="eyebrow-dot" /> A METHOD YOU CAN INSPECT</div><h2>From a stack of stories<br />to a <em>clearer picture.</em></h2><p>AI can move quickly. Trust takes a little more work. That’s why every step in Trace is visible, from the first source to the final finding.</p><a className="text-link" href="#analyze">Bring your articles <ArrowRight size={15} /></a></div><div className="steps-list"><article><span className="step-num">01</span><div><h3>Bring the reporting together</h3><p>Paste, upload or link the articles you want to understand.</p></div><span className="step-mark"><FileText size={17} /></span></article><article><span className="step-num">02</span><div><h3>Build a sourced summary</h3><p>Extract key facts and claims, each anchored to source passages.</p></div><span className="step-mark"><Sparkles size={17} /></span></article><article><span className="step-num">03</span><div><h3>Check what holds up</h3><p>Compare claims to retrieved evidence and inspect the reasoning.</p></div><span className="step-mark"><ShieldCheck size={17} /></span></article></div></div></section>

      <section className="example-section wrap" id="example"><div className="example-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> THE THREAD THAT CONNECTS IT</div><h2>Nothing gets a free pass.</h2></div><p>A look at how one summary claim connects to the original reporting. Evidence stays in view.</p></div><div className="example-panel"><div className="example-claim"><div className="panel-label">SUMMARY CLAIM <span>CLAIM 02</span></div><blockquote>“The facility can provide four hours of stored power to roughly 18,000 homes.”</blockquote><div className="claim-status"><span className="status-dot supported" /> ENTAILED BY SOURCE</div></div><div className="example-connector"><span /><ArrowRight size={16} /><span /></div><div className="example-source"><div className="panel-label">ORIGINAL PASSAGE <span><Quote size={12} /> PARAGRAPH 01</span></div><p>“The 240-megawatt-hour facility can store enough electricity to serve about <mark>18,000 homes for four hours</mark>.”</p><div className="source-meta"><span>THE DAILY LEDGER</span><span>↗ SOURCE 01</span></div></div></div><div className="example-foot"><span><ShieldCheck size={14} /> Evidence is retrieved from submitted articles</span><a href="#analyze">Try with your sources <ArrowRight size={14} /></a></div></section>

      <section className="analyze-section" id="analyze"><div className="wrap analyze-wrap"><div className="analyze-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> YOUR READING DESK</div><h2>Bring the story <em>into focus.</em></h2><p>Start with the articles. We’ll do the cross-checking.</p></div><button className="quiet-action" onClick={() => setHistoryOpen(true)}><Clock3 size={15} /> Recent analyses <span>{history.length || "—"}</span></button></div>
        <div className="workspace"><div className="workspace-main"><div className="workspace-top"><div><span className="workspace-number">01</span><div><h3>Source material</h3><p>Add at least one full article to get a grounded result.</p></div></div><button className="text-button" onClick={() => { setArticles([{ ...demoArticle }]); setError(""); }}>Use sample article <ArrowRight size={14} /></button></div>
          <div className="article-list">{articles.map((a, i) => <article className="article-input" key={a.id}><div className="article-number">{String(i + 1).padStart(2, "0")}</div><div className="article-fields"><div className="article-meta-input"><input value={a.title} onChange={e => updateArticle(a.id, "title", e.target.value)} placeholder="Article title" aria-label="Article title" /><input value={a.publisher} onChange={e => updateArticle(a.id, "publisher", e.target.value)} placeholder="Publisher" aria-label="Publisher" /></div><textarea value={a.text} onChange={e => updateArticle(a.id, "text", e.target.value)} placeholder="Paste the full article text here…" aria-label="Article text" rows={4} /><div className="article-foot"><span>{a.filename ? <><FileText size={12} /> {a.filename}</> : a.url ? <><Globe2 size={12} /> {a.url}</> : `${a.text.trim().split(/\s+/).filter(Boolean).length} words`}</span>{articles.length > 1 && <button aria-label="Remove article" onClick={() => setArticles(old => old.filter(item => item.id !== a.id))}><X size={14} /> Remove</button>}</div></div></article>)}</div>
          <div className="workspace-tools"><button className="add-article" onClick={addArticle}><Plus size={15} /> Add another article</button><label className="upload-action"><Upload size={14} /> Upload PDF, TXT or DOCX<input type="file" accept=".pdf,.txt,.docx" multiple onChange={e => { void addFiles(e.target.files); e.currentTarget.value = ""; }} /></label>{uploadProgress && <span className="upload-progress"><LoaderCircle className="spin" size={12} /> {uploadProgress}</span>}</div>
          <div className="url-row"><div className="url-label"><Globe2 size={14} /> ADD A WEB ARTICLE</div><input value={urlTitle} onChange={e => setUrlTitle(e.target.value)} placeholder="Title (optional)" aria-label="URL article title" /><input value={urlInput} onChange={e => setUrlInput(e.target.value)} placeholder="https://publication.com/story…" aria-label="Article URL" /><button onClick={() => void addUrl()} disabled={!urlInput || busy}>Add URL <ArrowRight size={14} /></button></div>
          {error && <div className="error-box"><CircleHelp size={16} /> <span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error"><X size={14} /></button></div>}
          <div className="analyze-footer"><span><ShieldCheck size={14} /> Your sources are the evidence base.</span><button className="button primary analyze-button" onClick={() => void analyze()} disabled={busy || validArticles.length === 0}>{busy ? <><LoaderCircle className="spin" size={16} /> Analyzing…</> : <>Analyze {validArticles.length || ""} article{validArticles.length === 1 ? "" : "s"} <ArrowRight size={16} /></>}</button></div>
          {busy && <div className="progress-box"><div className="progress-head"><LoaderCircle className="spin" size={15} /> {steps.find(s => s.key === stage)?.text || "Working"}<span>PLEASE KEEP THIS TAB OPEN</span></div><div className="progress-steps">{steps.map((s, i) => <span className={steps.findIndex(x => x.key === stage) >= i ? "done" : ""} key={s.key}><i>{steps.findIndex(x => x.key === stage) > i ? <Check size={10} /> : i + 1}</i>{s.text}</span>)}</div></div>}
        </div><aside className="workspace-aside"><div className="aside-index">A NOTE ON METHOD <span>↘</span></div><h4>Evidence before confidence.</h4><p>We retrieve passages from the articles you provide and compare claims against those passages. A semantic match alone never counts as proof.</p><div className="aside-rule" /><div className="aside-detail"><span>INPUTS</span><b>Paste · Upload · URL</b></div><div className="aside-detail"><span>OUTPUT</span><b>Summary · Claims · Audit</b></div><div className="aside-detail"><span>TRACE</span><b>Article · Paragraph · Quote</b></div><div className="privacy-note"><ShieldCheck size={15} /> Configure Supabase for persistent, private history.</div></aside></div></div></section>

      {report && <section className="results-section wrap" id="results"><div className="results-header"><div><div className="eyebrow"><span className="eyebrow-dot" /> ANALYSIS COMPLETE <span className="report-id">{report.id ? `REPORT ${report.id.slice(0, 8).toUpperCase()}` : "LOCAL REPORT"}</span></div><h2>What the evidence <em>shows.</em></h2></div><div className="report-actions"><button className="quiet-action" onClick={() => void copy(`${report.summary || ""}\n\n${(report.claims || []).map(c => `${displayStatus(c.status)}: ${c.text}`).join("\n")}`)}><Copy size={14} /> Copy report</button><button className="button primary" onClick={exportPdf}>Export PDF <ArrowDown size={15} /></button></div></div>
        <div className="summary-block"><div className="result-label">ACROSS {validArticles.length} SOURCE{validArticles.length === 1 ? "" : "S"} <span>SUMMARY</span></div><p>{report.summary || "Summary unavailable."}</p>{report.article_summaries?.length ? <div className="per-article">{report.article_summaries.map((a, i) => <details key={i}><summary>{a.title}<ChevronDown size={15} /></summary><p>{a.summary}</p></details>)}</div> : null}</div>
        <div className="findings-grid"><div className="finding-col"><div className="result-label">KEY FINDINGS <span>{report.findings?.length || 0}</span></div>{report.findings?.length ? <ul>{report.findings.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="muted-copy">No key findings returned.</p>}</div><div className="finding-col"><div className="result-label">COMMON THREADS <span>{report.common_information?.length || 0}</span></div>{report.common_information?.length ? <ul>{report.common_information.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="muted-copy">No shared details identified.</p>}</div><div className="finding-col"><div className="result-label">CONFLICTS <span>{report.conflicts?.length || 0}</span></div>{report.conflicts?.length ? <ul>{report.conflicts.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="muted-copy">No conflicting information reported.</p>}</div></div>
        <div className="audit-heading"><div><div className="result-label">CLAIM AUDIT <span>{report.claims?.length || 0} CLAIMS</span></div><h3>Trace each statement.</h3></div><button className="quiet-action" onClick={exportPdf}><ArrowDown size={14} /> Download report</button></div>
        <div className="audit-stats"><div className="stat-total"><strong>{report.claims?.length || 0}</strong><span>CLAIMS EXTRACTED</span></div><div className="stat supported-stat"><strong>{counts.entailed}</strong><span><i /> ENTAILED</span></div><div className="stat contradicted-stat"><strong>{counts.contradicted}</strong><span><i /> CONTRADICTED</span></div><div className="stat insufficient-stat"><strong>{counts.insufficient}</strong><span><i /> INSUFFICIENT EVIDENCE</span></div></div>
        <div className="audit-controls"><div className="filter-label"><Filter size={14} /> FILTER BY STATUS</div><div className="filter-pills">{["ALL", "ENTAILED", "CONTRADICTED", "INSUFFICIENT EVIDENCE"].map(f => <button className={filter === f ? "selected" : ""} key={f} onClick={() => setFilter(f)}>{f === "INSUFFICIENT EVIDENCE" ? "INSUFFICIENT" : f}{f === "ALL" && <span>{report.claims?.length || 0}</span>}</button>)}</div></div>
        <div className="claims-list">{filteredClaims.map((c, i) => <article className="claim-item" key={c.id}><button className="claim-summary" onClick={() => setExpanded(expanded === c.id ? null : c.id)}><span className="claim-id">{String(i + 1).padStart(2, "0")}</span><span className={`claim-state state-${statusClass(c.status)}`}><i /> {displayStatus(c.status)}</span><strong>{c.text}</strong><span className="claim-confidence">{typeof c.confidence === "number" ? `${Math.round(c.confidence * 100)}%` : "—"}<small>CONFIDENCE</small></span><ChevronDown className={expanded === c.id ? "chevron up" : "chevron"} size={17} /></button>{expanded === c.id && <div className="claim-detail"><div className="verification-note"><span className="result-label">VERIFICATION REASONING</span><p>{c.explanation || "No explanation was returned for this claim."}</p></div><div className="evidence-list"><div className="result-label">RETRIEVED EVIDENCE <span>{c.evidence?.length || 0} PASSAGES</span></div>{c.evidence?.length ? c.evidence.map((ev, j) => <div className="evidence-card" key={j}><div className="evidence-source"><span><FileText size={13} /> {ev.article_title || "Source article"}</span><span>PARAGRAPH {ev.paragraph || "—"}</span></div><blockquote>“{ev.text || "No original passage available."}”</blockquote><div className="evidence-mark">{ev.publisher || "Submitted source"}{ev.score !== undefined && ` · retrieval score ${Math.round(ev.score * 100)}%`}</div></div>) : <div className="no-evidence">No source passage could be retrieved. This claim is not treated as verified.</div>}</div></div>}</article>)}{!filteredClaims.length && <div className="empty-state">No claims match this filter.</div>}</div>
        {report.history_message && <div className="report-footnote" role="status"><Clock3 size={15} /> {report.history_message}</div>}
        <div className="report-footnote"><ShieldCheck size={15} /> Statuses reflect model comparisons with retrieved passages. Read each passage and reasoning before drawing conclusions.</div></section>}

      <section className="tech-section"><div className="wrap tech-layout"><div><div className="eyebrow"><span className="eyebrow-dot" /> A TRANSPARENT STACK</div><h2>Useful AI.<br /><em>Visible sources.</em></h2></div><div className="tech-copy"><p>Trace combines language models with retrieval and entailment checks. The model writes and classifies; your submitted reporting remains the source of truth.</p><div className="tech-tags"><span>GROQ · SUMMARIZATION</span><span>SENTENCE TRANSFORMERS · RETRIEVAL</span><span>HUGGING FACE · NLI</span><span>SUPABASE · HISTORY</span></div></div></div></section>
    </main>
    <footer className="footer"><div className="wrap footer-inner"><a href="#home" className="brand"><span className="brand-mark"><span /><span /><span /></span><span>AI News <b>Trace</b></span></a><p>Read with context. Verify with care.</p><div><a href="#how">Method</a><a href="#analyze">Analyze</a><a href="#home">Back to top ↑</a></div><small>© {new Date().getFullYear()} AI News Trace</small></div></footer>

    {historyOpen && <div className="drawer-backdrop" onClick={() => setHistoryOpen(false)}><aside className="history-drawer" onClick={e => e.stopPropagation()}><div className="drawer-head"><div><div className="eyebrow"><span className="eyebrow-dot" /> YOUR LIBRARY</div><h2>Recent analyses</h2></div><button onClick={() => setHistoryOpen(false)} aria-label="Close history"><X size={18} /></button></div><div className="history-search"><Search size={15} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search your history" /></div><div className="history-list">{history.filter(item => JSON.stringify(item).toLowerCase().includes(query.toLowerCase())).map((item, i) => <article key={item.id || i}><button className="history-open" onClick={() => item.id && void openHistory(item.id)}><span className="history-date">{item.created_at ? new Date(item.created_at).toLocaleDateString() : "RECENT"} <ArrowUpRight size={12} /></span><strong>{item.summary?.slice(0, 110) || "News analysis"}{(item.summary?.length || 0) > 110 ? "…" : ""}</strong><span>{item.claims?.length || 0} claims · {item.id?.slice(0, 8) || "local"}</span></button>{item.id && <button className="history-delete" onClick={() => void deleteHistory(item.id!)} title="Delete analysis"><X size={14} /></button>}</article>)}{!history.length && <div className="history-empty"><Clock3 size={21} /><strong>No saved analyses yet</strong><p>{historyMessage || "Completed reports will appear here when history storage is configured."}</p></div>}</div><div className="drawer-foot" role="status"><ShieldCheck size={14} /> {historyMessage || "History is stored only when Supabase is configured."}</div></aside></div>}
  </>;
}
