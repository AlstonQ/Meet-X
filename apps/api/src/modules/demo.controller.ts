import { Controller, Get, Header } from "@nestjs/common";
import { runDefaultLocalSimulation } from "@meet-x/capture-orchestrator";
import { LocalFixtureTranscriptionProvider, summarizeWithCitations } from "@meet-x/transcription";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

@Controller()
export class DemoController {
  @Get("/")
  @Header("Content-Type", "text/html; charset=utf-8")
  async home(): Promise<string> {
    return this.demo();
  }

  @Get("/demo")
  @Header("Content-Type", "text/html; charset=utf-8")
  async demo(): Promise<string> {
    const capture = await runDefaultLocalSimulation();
    const provider = new LocalFixtureTranscriptionProvider();
    const transcript = await provider.transcribe({
      meetingId: "mtg_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      audioUrl: capture.artifacts?.audio ?? "memory://missing/audio.opus",
      languageHint: "en"
    });
    const summary = summarizeWithCitations(transcript.segments);

    const timelineHtml = capture.timeline
      .map(
        (entry) => `<li><span>${escapeHtml(entry.state)}</span><p>${escapeHtml(entry.message)}</p></li>`
      )
      .join("");

    const transcriptHtml = transcript.segments
      .map(
        (segment) => `<article class="segment" id="${escapeHtml(segment.segmentId)}">
          <div><strong>${escapeHtml(segment.speakerId)}</strong><span>${formatTime(segment.startMs)}-${formatTime(segment.endMs)}</span></div>
          <p>${escapeHtml(segment.text)}</p>
          <small>${String(segment.words.length)} words · ${escapeHtml(segment.language)}</small>
        </article>`
      )
      .join("");

    const keyPointsHtml = summary.keyPoints
      .map(
        (point) => `<li>${escapeHtml(point.text)} <a href="#${escapeHtml(point.citation.segmentId)}">${formatTime(point.citation.startMs)}</a></li>`
      )
      .join("");

    const decisionsHtml = summary.decisions.length === 0
      ? "<li>No decisions detected.</li>"
      : summary.decisions
          .map(
            (decision) => `<li>${escapeHtml(decision.text)} <a href="#${escapeHtml(decision.citation.segmentId)}">citation</a></li>`
          )
          .join("");

    const actionsHtml = summary.actionItems.length === 0
      ? "<li>No action items detected.</li>"
      : summary.actionItems
          .map(
            (item) => `<li><strong>${escapeHtml(item.owner)}</strong>: ${escapeHtml(item.task)} <a href="#${escapeHtml(item.citation.segmentId)}">citation</a></li>`
          )
          .join("");

    const artifactAudio = capture.artifacts?.audio ?? "not available";
    const artifactVideo = capture.artifacts?.video ?? "not available";
    const artifactEvents = capture.artifacts?.events ?? "not available";

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Meet-X Demo Workspace</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #070a12; color: #eef4ff; }
      body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 20% 0%, rgba(105, 123, 255, .32), transparent 34rem), radial-gradient(circle at 100% 20%, rgba(87, 255, 210, .16), transparent 28rem), #070a12; }
      main { width: min(1180px, calc(100vw - 32px)); margin: 0 auto; padding: 34px 0 64px; }
      nav { display: flex; justify-content: space-between; gap: 16px; align-items: center; margin-bottom: 28px; }
      a { color: #80ffdd; text-decoration: none; }
      .brand { font-size: 22px; font-weight: 900; letter-spacing: -.04em; }
      .hero { display: grid; grid-template-columns: 1.2fr .8fr; gap: 18px; align-items: stretch; }
      .card { border: 1px solid rgba(255,255,255,.13); border-radius: 26px; background: rgba(14, 20, 35, .84); box-shadow: 0 24px 90px rgba(0,0,0,.28); padding: 24px; }
      h1 { margin: 0 0 12px; font-size: clamp(36px, 6vw, 76px); line-height: .9; letter-spacing: -.07em; }
      h2 { margin: 0 0 14px; font-size: 22px; letter-spacing: -.03em; }
      p, li, small { color: #b7c4dc; line-height: 1.55; }
      .pill { display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; padding: 8px 12px; background: rgba(128,255,221,.12); color: #dffef6; border: 1px solid rgba(128,255,221,.25); font-weight: 700; }
      .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 18px; }
      .two { display: grid; grid-template-columns: .8fr 1.2fr; gap: 18px; margin-top: 18px; align-items: start; }
      .metric { font-size: 34px; font-weight: 900; color: #fff; }
      ol.timeline { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
      ol.timeline li { display: grid; grid-template-columns: 120px 1fr; gap: 12px; border-bottom: 1px solid rgba(255,255,255,.08); padding-bottom: 10px; }
      ol.timeline span { color: #80ffdd; font-weight: 800; }
      .segment { border: 1px solid rgba(255,255,255,.1); border-radius: 18px; padding: 14px; margin-bottom: 10px; background: rgba(255,255,255,.04); }
      .segment:target { outline: 2px solid #80ffdd; background: rgba(128,255,221,.1); }
      .segment div { display: flex; justify-content: space-between; gap: 12px; color: #eaf2ff; }
      code { display: block; white-space: pre-wrap; word-break: break-word; color: #cbd6ee; background: rgba(0,0,0,.2); border-radius: 14px; padding: 12px; }
      .actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 20px; }
      .button { display: inline-flex; border-radius: 999px; padding: 12px 16px; background: #80ffdd; color: #061018; font-weight: 900; }
      .button.secondary { background: #d7ddff; }
      @media (max-width: 840px) { .hero, .grid, .two { grid-template-columns: 1fr; } ol.timeline li { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <main>
      <nav><div class="brand">Meet-X</div><a href="/recorder">Open recorder</a></nav>
      <section class="hero">
        <div class="card">
          <span class="pill">Phase 1 + Phase 2 demo</span>
          <h1>Meeting intelligence you can click through.</h1>
          <p>This page simulates capture, transcription, and cited summarisation using local deterministic providers. It is the first substantial UX slice before real Whisper/audio upload is connected.</p>
          <div class="actions"><a class="button" href="/recorder">Record a local meeting</a><a class="button secondary" href="/demo">Rerun demo pipeline</a></div>
        </div>
        <div class="card">
          <h2>Current meeting</h2>
          <p><strong>Status:</strong> ${escapeHtml(capture.timeline.at(-1)?.state ?? "unknown")}</p>
          <p><strong>Auto-join:</strong> ${capture.decision.shouldJoin ? "Allowed" : "Blocked"}</p>
          <p><strong>Disclosure required:</strong> ${capture.decision.disclosureRequired ? "Yes" : "No"}</p>
          <p><strong>ASR:</strong> ${escapeHtml(transcript.provider)}</p>
        </div>
      </section>

      <section class="grid">
        <div class="card"><h2>Segments</h2><div class="metric">${String(transcript.segments.length)}</div><p>Speaker-attributed transcript segments.</p></div>
        <div class="card"><h2>Words</h2><div class="metric">${String(transcript.segments.reduce((total, segment) => total + segment.words.length, 0))}</div><p>Word-level timestamp entries.</p></div>
        <div class="card"><h2>Citations</h2><div class="metric">${String(summary.keyPoints.length + summary.decisions.length + summary.actionItems.length + 1)}</div><p>Every summary claim links back to transcript evidence.</p></div>
      </section>

      <section class="two">
        <div class="card">
          <h2>Capture lifecycle</h2>
          <ol class="timeline">${timelineHtml}</ol>
          <h2>Artifacts</h2>
          <code>video: ${escapeHtml(artifactVideo)}
audio: ${escapeHtml(artifactAudio)}
events: ${escapeHtml(artifactEvents)}</code>
        </div>
        <div class="card">
          <h2>AI summary with citations</h2>
          <p><strong>TL;DR:</strong> ${escapeHtml(summary.tldr.text)} <a href="#${escapeHtml(summary.tldr.citation.segmentId)}">${formatTime(summary.tldr.citation.startMs)}</a></p>
          <h2>Key points</h2><ul>${keyPointsHtml}</ul>
          <h2>Decisions</h2><ul>${decisionsHtml}</ul>
          <h2>Action items</h2><ul>${actionsHtml}</ul>
        </div>
      </section>

      <section class="card" style="margin-top:18px">
        <h2>Transcript</h2>
        ${transcriptHtml}
      </section>
    </main>
  </body>
</html>`;
  }
}

