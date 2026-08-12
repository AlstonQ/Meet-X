import { Controller, Get, Header, Headers, Param } from "@nestjs/common";
import { escapeHtml, requirePrototypeSession, renderSaasShell } from "./auth.controller.js";

const liveStyles = [
  "<style>",
  ".live-list { display:grid; gap:14px; }",
  ".live-session { display:flex; justify-content:space-between; gap:18px; align-items:center; border:1px solid var(--line); border-radius:22px; padding:18px; background:rgba(255,255,255,.72); }",
  ".live-session h3 { margin-bottom:4px; } .live-session p { margin:0; }",
  ".live-stream { max-width:900px; } .live-meta { display:flex; flex-wrap:wrap; gap:9px; margin:0 0 18px; }",
  ".live-copy { display:grid; grid-template-columns:72px 1fr; gap:12px; padding:14px 0; border-bottom:1px solid var(--line); }",
  ".live-copy time { color:var(--accent); font-weight:800; font-variant-numeric:tabular-nums; }",
  ".live-copy p { margin:0; color:var(--ink); font-size:17px; }",
  "@media (max-width:600px) { .live-session { align-items:flex-start; flex-direction:column; } .live-copy { grid-template-columns:52px 1fr; } .live-copy p { font-size:15px; } }",
  "</style>"
].join("\n");

const listScript = [
  "<script>",
  "const sessionsRoot = document.getElementById(\"liveSessions\");",
  "function makeSessionCard(session) {",
  " const card=document.createElement(\"a\"); card.className=\"live-session\"; card.href=\"/live/\"+encodeURIComponent(session.sessionId);",
  " const copy=document.createElement(\"div\"); const title=document.createElement(\"h3\"); title.textContent=session.metadata.title;",
  " const detail=document.createElement(\"p\"); detail.textContent=session.metadata.sourceApp+\" Â· \"+new Date(session.startedAt).toLocaleString(); copy.append(title,detail);",
  " const badge=document.createElement(\"span\"); badge.className=\"status \"+(session.status===\"recording\"?\"\":\"blue\"); badge.textContent=session.status; card.append(copy,badge); return card;",
  "}",
  "async function refreshLiveSessions(){try{const response=await fetch(\"/api/live-transcription\",{cache:\"no-store\"});if(!response.ok)throw new Error(\"Live sessions unavailable\");const data=await response.json();sessionsRoot.replaceChildren();if(!data.sessions.length){const empty=document.createElement(\"p\");empty.textContent=\"No live meetings right now. Start the desktop recorder in Live while recording mode.\";sessionsRoot.append(empty);}else{for(const session of data.sessions)sessionsRoot.append(makeSessionCard(session));}}catch(error){sessionsRoot.textContent=error.message;}}",
  "refreshLiveSessions(); setInterval(refreshLiveSessions,3000);",
  "</script>"
].join("\n");

const detailScript = [
  "<script>",
  "const liveRoot=document.getElementById(\"liveMeeting\");const sessionId=liveRoot.dataset.sessionId;const titleNode=document.getElementById(\"liveTitle\");const statusNode=document.getElementById(\"liveStatus\");const metaNode=document.getElementById(\"liveMeta\");const transcriptNode=document.getElementById(\"liveTranscript\");const resultNode=document.getElementById(\"liveResult\");",
  "function liveTime(ms){const seconds=Math.max(0,Math.floor(ms/1000));return String(Math.floor(seconds/60)).padStart(2,\"0\")+\":\"+String(seconds%60).padStart(2,\"0\");}",
  "function speakerName(id){if(id===\"speaker_user\")return \"You\";const numbered=/^speaker_(\\d+)$/u.exec(id||\"\");if(numbered)return \"Speaker \"+numbered[1];return id&&id.startsWith(\"speaker_\")?id.slice(8).replaceAll(\"_\",\" \"):id||\"Speaker\";}",
  "function renderSegment(segment){const row=document.createElement(\"div\");row.className=\"live-copy\";const time=document.createElement(\"time\");time.textContent=liveTime(segment.startMs);const text=document.createElement(\"p\");const speaker=document.createElement(\"strong\");speaker.textContent=speakerName(segment.speakerId)+\"  \";text.append(speaker,document.createTextNode(segment.text));row.append(time,text);return row;}",
  "async function refreshLiveMeeting(){try{const response=await fetch(\"/api/live-transcription/\"+encodeURIComponent(sessionId),{cache:\"no-store\"});if(!response.ok)throw new Error(\"Live meeting is no longer available.\");const session=await response.json();titleNode.textContent=session.metadata.title;statusNode.textContent=session.status;statusNode.className=\"status \"+(session.status===\"recording\"?\"\":\"blue\");metaNode.textContent=session.metadata.sourceApp+\" Â· \"+(session.metadata.screenVideo?\"screen + audio\":\"audio only\")+\" Â· \"+session.metadata.languageHint.toUpperCase();transcriptNode.replaceChildren();if(!session.segments.length){const empty=document.createElement(\"p\");empty.textContent=\"Listening for speech. The first local Whisper chunk normally appears in 10â€“20 seconds.\";transcriptNode.append(empty);}else{for(const segment of session.segments)transcriptNode.append(renderSegment(segment));}resultNode.replaceChildren();if(session.detailUrl){const link=document.createElement(\"a\");link.className=\"button\";link.href=session.detailUrl;link.textContent=\"Open completed meeting\";resultNode.append(link);}if(session.error){const error=document.createElement(\"p\");error.textContent=session.error;resultNode.append(error);}}catch(error){statusNode.textContent=\"offline\";statusNode.className=\"status warn\";transcriptNode.textContent=error.message;}}",
  "refreshLiveMeeting(); setInterval(refreshLiveMeeting,2500);",
  "</script>"
].join("\n");

@Controller()
export class LiveViewController {
  @Get("/live")
  @Header("Content-Type", "text/html; charset=utf-8")
  list(@Headers("cookie") cookieHeader: string | undefined): string {
    const session = requirePrototypeSession(cookieHeader);
    const body = liveStyles + "<section class='card'><h2>Live meetings</h2><p>Open the same rolling transcript from this computer, a phone, or another browser on the local network.</p><div id='liveSessions' class='live-list'><p>Loading live meetingsâ€¦</p></div></section>" + listScript;
    return renderSaasShell({ title: "Live meetings", active: "live", session, body });
  }

  @Get("/live/:sessionId")
  @Header("Content-Type", "text/html; charset=utf-8")
  detail(@Param("sessionId") sessionId: string, @Headers("cookie") cookieHeader: string | undefined): string {
    const session = requirePrototypeSession(cookieHeader);
    const body = liveStyles + "<section id='liveMeeting' class='card live-stream' data-session-id='" + escapeHtml(sessionId) + "'><div class='topbar'><div><h2 id='liveTitle'>Live meeting</h2><p id='liveMeta'>Connectingâ€¦</p></div><span id='liveStatus' class='status blue'>connecting</span></div><div id='liveTranscript'><p>Loading transcriptâ€¦</p></div><div id='liveResult' class='pill-row' style='margin-top:18px'></div></section>" + detailScript;
    return renderSaasShell({ title: "Live transcript", active: "live", session, body });
  }
}



