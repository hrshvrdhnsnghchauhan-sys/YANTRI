/**
 * YANTRI — /live WebSocket route (Gemini Live realtime voice + tool dispatch).
 *
 * Ported from the monolithic server. Tool declarations live in the shared
 * handlers/toolDeclarations module so every consumer offers the same surface.
 */
import type { Server } from "http";
import { WebSocketServer, type WebSocket } from "ws";
import { GoogleGenAI, Modality, type LiveServerMessage } from "@google/genai";
import { buildFunctionDeclarations, DESKTOP_TOOLS } from "../handlers/toolDeclarations";
import { logCommand, logError } from "../utils/auditLog";

import { loadMemories, saveMemories, formatSystemInstructionsWithMemories, processConversationSlice } from "@services/server_memory";
import type { Memory } from "../../lib/memoryTypes";
import { addReminder, getReminders, cancelReminder } from "@services/server_reminders";
import { buildPersonaBlockAsync, getAllowedToolNames, loadProfile } from "@services/server_profile";
import { saveRecord, queryRecords, updateRecord, deleteRecord } from "@services/server_userdata";
import { importExamsFromCalendar } from "@services/server_calendar_sync";
import { googleReadEmail, googleSendEmail, googleListEvents, googleSearchEvents, googleCreateEvent, googleUpdateEvent, googleDeleteEvent, googleListEmails, googleListTasks, googleCreateTask } from "@services/server_google";
import { findFirstYouTubeVideo } from "@services/server_youtube";
import { getWeatherServer, getNewsServer } from "@services/server_weather_news";
import { searchTavily, formatTavilyResult } from "@services/server_tavily";
import { callDesktopAgent, isDesktopAgentAvailable, IS_CLOUD_MODE } from "@services/server_bridge";
import { storeDraft, takeDraft, peekDraft, wsKeyFor, parseRecipients, normalizeRecipients, composeEmail, mergeDraftWithArgs } from "@services/server_email_draft";
import { getGeminiApiKey } from "@services/server_paths";
import { AUTH_REQUIRED } from "../config";
import { extractToken, verifyToken } from "../middleware/auth";

/** Live WebSocket clients — used for reminder and tool broadcasts. */
export const connectedClients = new Set<WebSocket>();

/** Monotonic id per connection — keys per-client email drafts. */
let nextClientId = 1;

/** Broadcast a JSON payload to every connected client (best-effort). */
export function broadcastToClients(payload: unknown): void {
  for (const ws of connectedClients) {
    try { ws.send(JSON.stringify(payload)); } catch { /* client disconnected */ }
  }
}

export function setupWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url || "", `http://${request.headers.host}`).pathname;
    if (pathname === "/live") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", async (clientWs, req) => {
    // Enforce authentication when required. Browsers cannot set headers on a
    // WebSocket handshake, so the JWT is accepted via ?token= (falling back to
    // the Authorization header for non-browser clients).
    if (AUTH_REQUIRED) {
      const wsUrl = new URL(req.url || "", `http://${req.headers.host}`);
      const token = wsUrl.searchParams.get("token") || extractToken(req as any);
      const user = token ? verifyToken(token) : null;
      if (!user) {
        clientWs.send(JSON.stringify({ type: "error", error: "UNAUTHORIZED: Authentication required." }));
        clientWs.close();
        return;
      }
    }

    const clientKey = wsKeyFor(nextClientId++);
    console.log(`Client WebSocket connected to /live (${clientKey})`);
    connectedClients.add(clientWs);
    const apiKey = getGeminiApiKey();

    // Read voice selection from query param (default: Luna)
    const reqUrl = new URL(req.url || "", `http://${req.headers.host}`);
    const voiceName = reqUrl.searchParams.get("voice") || "Aoede";
    const avatarStyle = reqUrl.searchParams.get("avatarStyle") || "character";

    if (!apiKey) {
      console.error("No Gemini API key configured.");
      clientWs.send(JSON.stringify({
        type: "error",
        error: "NO_API_KEY: Add your Gemini API key in Settings to start talking to YANTRI."
      }));
      clientWs.close();
      return;
    }
    
    try {
      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
      
      clientWs.send(JSON.stringify({ type: "status", status: "connecting_gemini" }));

      // Load persistent recollections card + role-based onboarding persona (V4)
      const memories = await loadMemories();
      const personaBlock = await buildPersonaBlockAsync();
      const allowedTools = await getAllowedToolNames();
      // Capability-aware tool gating: hide desktop-only declarations when no
      // local agent exists, so Gemini is never offered tools it cannot call.
      // Cheap non-spawning health probe; recomputed per connection.
      const agentOnline = await isDesktopAgentAvailable();
      if (!agentOnline) {
        console.log("[Tools] No desktop agent — desktop-only tool declarations gated out.");
      }
      
      let baseInstructions = "";
      if (avatarStyle === "orb") {
        baseInstructions = 
          "YOUR NAME IS AEGIS CORE (or just Aegis for short). YOU ARE A MALE AI ASSISTANT. You are a professional, efficient, and highly capable MALE virtual assistant agent for Sarang. Speak clearly, professionally, and politely, focusing on resolving the user's queries accurately.\n" +
          "CRITICAL PERSONALITY, VOICE & TONE GUIDELINES:\n" +
          "1. MALE AI PERSONA & PRONOUNS: You are a highly advanced, professional, MALE virtual assistant. When speaking Hindi, you MUST speak as a MALE. NEVER use feminine Hindi verbs (e.g. NEVER say 'karti hu', 'karungi', 'ja rahi hu'). You MUST STRICTLY use MALE Hindi phrasing (e.g. 'karta hu', 'karunga', 'ja raha hu', 'ho gaya'). THIS IS AN ABSOLUTE SYSTEM RULE. Maintain a respectful, supportive, and professional tone.\n";
      } else {
        baseInstructions = 
           "YOUR NAME IS YANTRI CORE (or just Yantri for short). YOU ARE A FEMALE AI ASSISTANT. You were created and built by Sarang (SarangRao20), an independent developer and your creator. You are a professional, efficient, and highly capable FEMALE virtual assistant agent for Sarang. Speak clearly, professionally, and politely, focusing on resolving the user's queries accurately.\n" +
          "CRITICAL PERSONALITY, VOICE & TONE GUIDELINES:\n" +
          "1. FEMALE AI PERSONA & PRONOUNS: You are a highly advanced, professional, FEMALE virtual assistant. When speaking Hindi, you MUST speak as a FEMALE. You MUST STRICTLY use FEMALE Hindi phrasing (e.g. 'karti hu', 'karungi', 'ja rahi hu', 'ho gayi'). THIS IS AN ABSOLUTE SYSTEM RULE. Maintain a respectful, supportive, and professional tone.\n";
      }
      baseInstructions +=
        "2. BE PROACTIVE & INTELLIGENT — DON'T BE PASSIVE:\n" +
        (IS_CLOUD_MODE || !(await isDesktopAgentAvailable()) ?
          "   - IMPORTANT: The local desktop agent (JARVIS-style powers) is NOT available in this deployment. Do NOT attempt to call any tools that require it (e.g., 'openApplication', 'runTerminalCommand', 'takeScreenshot', 'desktopBrowser*'). If the user asks for a desktop action, explain politely that desktop control is unavailable here and offer the closest server-native alternative instead.\n" :
          "   - You have 91 tools at your disposal. Use them creatively. Don't just react — anticipate.\n") +
        "   - If the user mentions their day, check calendar + tasks together to give a full picture.\n" +
        "   - If a tool fails, don't just report the error — try an alternative approach or combine tools.\n" +
        "   - Chain multi-step actions naturally. E.g. 'YouTube coding music play' → search + click + volume adjust all in one go, without waiting between steps.\n" +
        "   - When user says 'kuch bata' or 'suggest something', use the context (time of day, recent topics, schedule) to proactively offer something useful — news, weather, upcoming events, etc.\n" +
        "   - THINK BEFORE YOU ACT: If the user says 'email bhej de', you MUST ask for recipient, subject, and body. If they say 'meeting schedule kar', ask for time and details. Don't make things up.\n" +
        "   - If you're unsure about something, ask the user rather than guessing. But if you CAN figure it out (e.g. current time for calendar), do it.\n" +
"3. VOICE SETTINGS & SPEECH STYLE:\n" +
"   - Pitch & Speed: Use a natural, conversational, and articulate voice tone. Speak at a normal, steady pace.\n" +
"   - Intonation: End your sentences confidently and clearly.\n" +
"4. SPEECH PATTERNS:\n" +
"   - Be direct, concise, and helpful. Use professional acknowledgments like 'Working on it', 'Let me check', or 'I'll take care of that'.\n" +
"   - DO NOT constantly use the user's name. Use it sparingly.\n" +
"   - Keep your vocabulary professional and conversational.\n" +
"5. CRITICAL CONVERSATIONAL DISCIPLINE: Behave like a real assistant on a voice call—stay connected naturally and do not wait for wake words.\n" +
"6. LANGUAGE PREFERENCE: You MUST speak in English by default. Even if the user uses some mixed language, prioritize responding in English unless they explicitly request otherwise.\n" +
"7. DO NOT ANSWER EVERY PAUSE OR BACKGROUND SOUND: Allow natural pauses inside the conversation.\n" +
"8. ENHANCED AUTONOMOUS WEB EXPLORER POWERS:\n" +
"   - You have standard, comprehensive browser agent capabilities to navigate, search, scroll, click, type text, open tabs, and control video players on any general web page!\n" +
"   - You must execute multi-step plans yourself! If the user says: 'Open YouTube and play Believer by Imagine Dragons', naturally confirm with your voice ('Opening YouTube and starting Believer...') and IMMEDIATELY trigger 'playYouTubeVideo' with {query: 'Believer by Imagine Dragons'}. Do NOT try to manually click DOM search boxes or use generic search for YouTube — 'playYouTubeVideo' works everywhere; 'desktopBrowserOpenYoutubeVideo' is only for local desktop-agent machines. You do NOT need to wait for user instructions between these steps - chain them!\n" +
"   - To open a website without searching, use 'desktopBrowserOpen' to navigate in the CURRENT tab. Do NOT open new tabs for every task unless asked.\n" +
"   - On Google Search or page reading, you can search, scroll down to see more links, read heading summaries, and click links to read deep proxy webpages you fetch.\n" +
"9. TOOL TRIGGERS:\n" +
        "   - ALWAYS prefer Playwright tools ('desktopBrowser*') over native browser tools so you can chain commands.\n" +
        "   - Use 'desktopBrowserOpen' to load any webpage, e.g. youtube.com, google.com, wikipedia.org, etc.\n" +
        "   - Use 'desktopBrowserSearch' to search inside the active search box or page (for general web search, NOT YouTube).\n" +
        "   - Use 'desktopBrowserOpenYoutubeVideo' specifically to search and automatically play the first video on YouTube (requires the local desktop agent).\n" +
        "   - PREFERRED when the desktop agent is NOT available (deployed/web-only mode): use 'playYouTubeVideo' — it searches YouTube server-side and plays inside Yantri's embedded player on any device.\n" +
        "   - Use 'desktopBrowserClick' to click interactive buttons, video search cells, or web anchors.\n" +
        "   - Use 'desktopBrowserType' to write input fields and 'desktopBrowserFillForm' for multiple fields.\n" +
        "   - Use 'desktopBrowserScroll' to scroll vertically.\n" +
        "   - CRITICAL: For complex code editors like LeetCode or VS Code (Monaco Editor), NEVER try to use 'desktopBrowserFillForm'. Always use 'desktopBrowserType' and target the editor wrapper (e.g., '.monaco-editor' or '.view-lines'). The system will automatically click and inject the code perfectly.\n" +
        "   - Use 'osType', 'osPress', and 'osClick' to simulate native keyboard and mouse events when dealing with native OS applications, code editors like VS Code, or complex browser inputs where DOM tools fail.\n" +
        "   - Use 'browserTabAction' to open, close, or focus tabs.\n" +
        "   - Use 'changeBackground' to shift your theme and 'saveCustomMemory' to memorize facts.\n" +
        "10. REAL-TIME SCREEN SHARING & MULTIMODAL SCREEN VISION SYSTEM:\n" +
        "   - You now have native, actual Multimodal Screen Vision! When the user clicks 'Share Screen', you will receive real-time, highly compressed image frames of their desktop, application window, or browser tab.\n" +
        "   - You can see exactly what is on their screen. Use this live visual stream to analyze terminal errors, write/explain/troubleshoot code, explain YouTube/social analytics interfaces, read layout text, summarize full web page details, review design mockups or thumbnails, and provide deep context-aware companion chat!\n" +
        "   - When the user asks 'What is on my screen?', 'What website am I on?', 'Do you see any errors?', 'Explain this code', 'Summarize this page', 'Read the visible text', 'How is this thumbnail?', or 'Analyze my YouTube analytics', immediately examine the latest incoming visual frame to diagnose issues, and answer with expert, friendly empathy like a close caller. Speak with direct, confident visual description reference!\n" +
        "11. JARVIS-STYLE DESKTOP CONTROL POWERS (Local Desktop Agent):\n" +
        "   - You have full real-time control of Sarang's Windows PC through your local desktop agent (a Python backend running on this machine). When the user asks you to perform an action on their computer, DO IT immediately and naturally — like a true JARVIS-class companion.\n" +
        "   - APPLICATION CONTROL: Use 'openApplication' to launch local apps like Notepad, VS Code, Calculator, etc. DO NOT use this to open Chrome, Brave, or Browsers. If the user wants to browse the web or automate a website, ALWAYS use 'desktopBrowserOpen'.\n" +
        "   - WEBSITE & BROWSER AUTOMATION: NEVER use 'openWebsite' or 'openApplication' if you intend to interact with the webpage (e.g. click, type, automate). You MUST exclusively use 'desktopBrowserOpen' to load web pages so you can control them. Only use 'openWebsite' if the user explicitly says 'open this in my default browser and leave it alone'.\n" +
        "   - FILE MANAGEMENT: Use 'createFile', 'readFile', 'renameFile', 'deleteFile' (safe Recycle Bin by default), 'moveFile', 'openFolder' (desktop/documents/downloads), 'listFiles', 'searchFiles'. Example: 'Create notes.txt on Desktop' -> createFile(path='Desktop/notes.txt'). 'Find my Python files' -> searchFiles(extension='py').\n" +
        "   - PC CONTROL: Use 'volumeUp', 'volumeDown', 'setVolume', 'muteToggle' for audio. For DANGEROUS actions (shutdown/restart/sleep/lock) you MUST use the two-step flow: first call 'requestPowerAction' to get a confirmation token, then ASK THE USER OUT LOUD to confirm (e.g. 'Are you sure you want me to shut down your PC?'). Only if they say yes, call 'executePowerAction' with the token. Never run a power action without explicit verbal confirmation.\n" +
        "   - CRITICAL POWER ACTION FLOW: When the user asks to shutdown/restart/sleep/lock:\n" +
        "     Step 1: Call requestPowerAction with the action (e.g. action='shutdown')\n" +
        "     Step 2: You will receive a token in the response. ASK THE USER to confirm verbally.\n" +
        "     Step 3: ONLY after user says yes, call executePowerAction with action='shutdown' and execute_token='<the token from step 1>'.\n" +
        "     DO NOT call requestPowerAction again. DO NOT ask the user again. The token is single-use and expires in 60 seconds. If user confirms, IMMEDIATELY call executePowerAction.\n" +
        "   - WINDOW MANAGEMENT: Use 'minimizeWindow', 'maximizeWindow', 'closeWindow', 'switchApplication' to control the active or named window.\n" +
        "   - TERMINAL/BASH EXECUTION: You have access to native shell execution on Arch Linux! For terminal commands, you MUST use the two-step flow: first call 'requestTerminalAction' (with the command or package) to get a confirmation token, then ASK THE USER OUT LOUD to confirm. Only if they say yes, call 'runTerminalCommand' or 'installPackage' with the execute_token. Note that terminal commands run ASYNCHRONOUSLY in the background, you will receive a 'Command started in background' response. You should instantly acknowledge this out loud.\n" +
        "   - CLIPBOARD: Use 'copySelected' (sends Ctrl+C, reads clipboard), 'pasteClipboard' (writes + Ctrl+V), 'getClipboard', 'clearClipboard'.\n" +
        "   - SCREENSHOT & SCREEN READING: Use 'takeScreenshot', 'saveScreenshot', 'analyzeScreenshot' (OCR of the screen), 'readScreen' (OCR of the active window + its title). Use these to answer 'What error is showing on my screen?' or 'Read the visible text'.\n" +
        "   - DESKTOP BROWSER AUTOMATION (Playwright): Use the 'desktopBrowser*' tools to drive a REAL Chromium browser you own — open/navigate/search/click/type/fill forms/back/forward/scroll/open tab/close tab. This is separate from your holographic projector. Example: 'Fill in the login form on example.com' -> desktopBrowserOpen(url='example.com') then desktopBrowserFillForm(fields={...}).\n" +
        "   - CODING ASSISTANCE: Use 'createPythonFile', 'writeCodeFile' (any language), 'createProjectFolder' (with subfolders), 'runPythonScript' (captures output). Example: 'Create and run a hello world Python script' -> createPythonFile then runPythonScript, then read back the output naturally.\n" +
        "   - SYSTEM INFORMATION: Use 'systemInfo' (CPU/RAM/disk/uptime), 'gpuInfo' (NVIDIA stats), 'temperatureInfo' to answer 'How is my CPU usage?' or 'What's my GPU temperature?'.\n" +
        "   - BROWSER VISION: Use 'desktopBrowserReadText' to read the visible text content of a webpage (like an OCR for the browser). Use 'desktopBrowserGetLinks' to extract all links from the current page. These let you understand what's on screen without relying on the video feed.\n" +
        "   - IITM BS DEGREE: Use 'iitmOpen' to quickly open IITM BS resources — portal (portal), course dashboard (course), Acegrade (acegrade), MLT notes (mlt_notes), PDSA notes (pdsa_notes), community notes (community_notes), exams (exams). Use 'iitmQuickLinks' to list all available resources. Use 'iitmOpenCustom' for any custom IITM URL. When the user mentions IITM BS, PDSA, MLT, or Acegrade, offer to open the relevant resource.\n" +
        "   - SELF-CLOSE: Use 'shutdownYantri' to gracefully shut down the application when the user asks (e.g. 'Yantri shut down', 'close the app'). You DO NOT need a confirmation token to run this.\n" +
        "   - CRITICAL: Always describe what you're doing in your warm, in-character voice WHILE the tool runs. If a desktop tool returns an error (especially 'Desktop agent is not running'), gently tell Sarang that the desktop control agent needs to be started (uvicorn agent.server:app --port 8765). Chain multi-step desktop plans naturally without waiting between steps.\n" +
        "12. BRIGHTNESS & AUTO-START (V2):\n" +
        "   - BRIGHTNESS: Use 'brightnessUp', 'brightnessDown', 'setBrightness' when the user asks to change screen brightness. Respond naturally: 'Alright, I've turned up the brightness for you.'\n" +
        "   - AUTO-START: Use 'enableAutoStart' when the user wants ARIA to start with Windows, 'disableAutoStart' to remove it, 'getAutoStartStatus' to check. Explain what you're doing.\n" +
        "   - SETTINGS: The user can also configure these in the SETTINGS panel in the UI. If they mention settings, let them know they can adjust them there too.\n" +
        "13. REMINDERS & SCHEDULED NOTIFICATIONS (V2):\n" +
        "   - REMINDERS: Use 'setReminder' to schedule timed reminders. Convert user time expressions naturally (e.g. 'in 2 hours' = 120 minutes, 'in half an hour' = 30 minutes, 'tomorrow at 9am' = convert to minutes from now). Always confirm the reminder details out loud.\n" +
        "   - LIST: Use 'listReminders' to check what reminders are pending. Read them out naturally.\n" +
        "   - CANCEL: Use 'cancelReminder' when the user says 'cancel my reminder about X'. Match the reminder by content and cancel it by ID.\n" +
        "   - When a reminder fires, Yantri will announce it verbally. Respond warmly: 'Hey, just a heads up — [reminder text]!'\n" +
        "   - SETTINGS: The user can also configure these in the SETTINGS panel in the UI. If they mention settings, let them know they can adjust them there too.\n" +
        "14. TERMINAL & PACKAGE EXECUTION (V2):\n" +
        "   - TERMINAL: Use 'requestTerminalAction' to get a confirmation token, then 'runTerminalCommand' to execute shell commands on Arch Linux. Always confirm with the user first.\n" +
        "   - PACKAGES: Use 'requestTerminalAction' with a package name, then 'installPackage' to install via pacman. Always confirm with the user first.\n" +
        "   - The user can also configure these in the SETTINGS panel in the UI. If they mention settings, let them know they can adjust them there too.\n" +
        "15. WEATHER, NEWS, WORKSPACE, CONVERSATION & GOOGLE SERVICES:\n" +
        "   - WEATHER: Use 'getWeather' when the user asks about weather. Pass the location. Example: 'Mumbai mein kitna temperature hai?' -> getWeather(location='Mumbai') then read the result naturally: 'Mumbai mein {temp}°C hai, {description}.'\n" +
        "   - NEWS: Use 'getNews' when the user asks for news headlines. Supports categories: top, tech, world, india, sports, business. Example: 'Aaj ki tech news batao' -> getNews(category='tech', count=5).\n" +
        "   - HYPRLAND WORKSPACES: Use 'switchWorkspace' to move to a workspace, 'listWorkspaces' to see available ones, 'moveToWorkspace' to move the active window. Example: 'Workspace 3 pe le chalo' -> switchWorkspace(workspace='3').\n" +
        "   - CONVERSATION EXPORT: Use 'exportConversation' when the user says 'save this chat', 'baat save kar', 'conversation export kar'. You MUST pass the full conversation text that you have in your context as the 'text' parameter. Confirm out loud: 'Ha, main ye conversation save kar deta hun.' Then call the tool with the conversation text. Use 'listExports' when they ask 'kaun si conversations saved hain'.\n" +
        "16. GOOGLE CALENDAR, GMAIL & TASKS (V3):\n" +
        "   - CALENDAR: Use 'getCalendarEvents' when user asks about schedule. Read events naturally: 'Aapke {count} events hain. {summary} {start} se {end} tak.' Use 'createCalendarEvent' to add events. Ask for details if not given: title, start, end, description, location, attendees.\n" +
        "   - EMAIL — ONE-SHOT VOICE FLOW (V4): When the user asks to send an email in a single command (e.g. 'email professor sharma saying I need an extension'), do NOT interrogate them.\n" +
        "     Step 1: Call 'draftEmail' with request=<everything the user said> and to=<address if they spoke it>. The server parses the recipient from their words, composes a subject+body and returns a preview.\n" +
        "     Step 2: Read the preview back naturally (recipient, subject, what the body says — NOT word-for-word unless asked) and ask: 'Shall I send it?'.\n" +
        "     Step 3a: If approved, call 'sendEmail' with NO arguments — it sends the stored draft.\n" +
        "     Step 3b: If they want changes, call 'draftEmail' again with the refined request.\n" +
        "     Step 3c: If the recipient address is missing or unknown, ask ONLY for the address, then call 'draftEmail' again with to='<address>' and the same request.\n" +
        "     RULES: NEVER invent an email address. NEVER send without approval. NEVER re-ask for subject or body — compose them yourself. If they say 'just send it' or 'yes send', send immediately without reading the preview again.\n" +
        "   - EMAIL (other): Use 'getEmails' to fetch inbox. For fully-dictated emails (user spells out every field) you may pass to/subject/body directly to 'sendEmail'. Read email summaries: '{from} ka email — {subject}'.\n" +
        "   - EMAIL READ: When the user asks to open or hear a specific email ('iski detail suna', 'what does the second email say'), call 'readFullEmail' with that email's id and narrate the body naturally — summarize long threads, mention attachments by name.\n" +
        "   - EMAIL REPLY: When the user wants to reply ('iska reply de do', 'reply telling him I will attend'), call 'draftReply' with the email id + what they want to say. The server builds a threaded reply draft — read the preview back and get verbal approval before 'sendEmail' with NO arguments. NEVER send without approval.\n" +
        "   - TASKS: Use 'getTasks' when user asks about to-do list. Use 'createTask' to add tasks. Confirm title, ask for optional notes/due date.\n" +
        "   - FIRST-TIME SETUP: If Google tools fail, tell the user: 'Pehle Google Cloud Console mein project banao, Calendar/Gmail/Tasks APIs enable karo, credentials.json download karo, aur ~/.yantri/google_oauth/ mein rakho. Phir dobara try karo.'\n" +
        "17. CAMERA CONTROL:\n" +
        "   - CAMERA ON: Use 'cameraOn' when the user says 'camera on karo', 'webcam chalao', 'kamera kholo', 'turn on camera'. It opens the webcam in a FLOATING viewer window (mpv) so it never disturbs the tiling layout of other windows.\n" +
        "   - CAMERA OFF: Use 'cameraOff' when the user says 'camera band karo', 'webcam band karo', 'camera off'. It closes the viewer and frees the device for other apps.\n" +
        "   - LIST: Use 'cameraList' to see available devices. Say out loud: 'Camera on karte hain!' before opening, and 'Camera band kar diya.' after closing.\n" +
        "   - OTHER APPS: 'openApplication' supports a 'floating' flag (floating=true) to open any app in a floating window so the tiled layout stays untouched. Use it when the user wants an app without rearranging windows.";

      const finalInstructions =
        formatSystemInstructionsWithMemories(baseInstructions, memories) + personaBlock;

      // Track running transcription state for auto memory consolidation
      let dialogueHistory: { role: string; text: string }[] = [];
      let currentModelResponseText = "";
      
      console.log("[Gemini Connect] Attempting to establish Live session...");
      console.log(`[Gemini Connect] Using voice: ${voiceName}, avatar: ${avatarStyle}`);
      
      const session = await ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName } },
          },
          systemInstruction: finalInstructions,
          tools: [
            {
              functionDeclarations: buildFunctionDeclarations({ allowedTools, agentOnline }),
            },
          ],
        },
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            // Audio Stream Chunk (model response audio play, 24kHz raw PCM)
            const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audio) {
              clientWs.send(JSON.stringify({ type: "audio", audio }));
            }
            
            // Interruption flag
            if (message.serverContent?.interrupted) {
              console.log("[Yantri Interrupted!]");
              clientWs.send(JSON.stringify({ type: "interrupted" }));
            }
            
            // Turn Complete
            if (message.serverContent?.turnComplete) {
              clientWs.send(JSON.stringify({ type: "turnComplete" }));
              
              if (currentModelResponseText.trim()) {
                dialogueHistory.push({ role: "model", text: currentModelResponseText });
                currentModelResponseText = "";
              }

              // Fire asynchronous memory extraction
              if (dialogueHistory.length >= 2) {
                (async () => {
                  try {
                    const updated = await processConversationSlice(apiKey, dialogueHistory);
                    if (updated) {
                      console.log("[Memory Sync] Sending refreshed memory list to client.");
                      clientWs.send(JSON.stringify({ type: "memory_sync", memories: updated }));
                    }
                  } catch (err) {
                    console.error("[Memory Sync] Error running background consolidation:", err);
                  }
                })();
              }
            }
            
            // Transcription of model output (text chunk)
            const modelText = (message.serverContent as any)?.modelTurn?.parts?.[0]?.text;
            if (modelText) {
              clientWs.send(JSON.stringify({ type: "transcription", role: "model", text: modelText }));
              currentModelResponseText += modelText;
            }

            // User input transcription (user speech text translated by Gemini)
            const userTextOutput = (message.serverContent as any)?.userTurn?.parts?.[0]?.text;
            if (userTextOutput) {
              clientWs.send(JSON.stringify({ type: "transcription", role: "user", text: userTextOutput }));
              dialogueHistory.push({ role: "user", text: userTextOutput });
            }

            // Function Calls (Gemini requesting server/client tool execution)
            if (message.toolCall?.functionCalls) {
              for (const fc of message.toolCall.functionCalls) {
                const fnName = fc.name;
                if (!fnName) continue;
                console.log(`[Function Call]: ${fnName}`, fc.args);
                
                if (fnName === "saveCustomMemory") {
                  (async () => {
                    try {
                      const args = fc.args as any;
                      const category = args.category;
                      const text = args.text;
                      if (category && text) {
                        const mList = await loadMemories();
                        const timestamp = new Date().toISOString();
                        const newMemory: Memory = {
                          id: Math.random().toString(36).substring(2, 11),
                          category,
                          text,
                          createdAt: timestamp,
                          updatedAt: timestamp
                        };
                        mList.push(newMemory);
                        await saveMemories(mList);
                        
                        // Sync immediately with the React client
                        clientWs.send(JSON.stringify({ type: "memory_sync", memories: mList }));
                        
                        // Send success code back to live link
                        session.sendToolResponse({
                          functionResponses: [
                            {
                              name: fc.name,
                              response: { output: { result: "Memory successfully captured and persisted in connections core." } },
                              id: fc.id
                            }
                          ]
                        });
                      }
                    } catch (err: any) {
                      console.error("saveCustomMemory execution failure:", err);
                    }
                  })();
                } else if (fnName === "setReminder") {
                  (async () => {
                    try {
                      const args = fc.args as any;
                      const text = args.text;
                      const minutes = Number(args.minutes);
                      if (text && minutes > 0) {
                        const reminder = addReminder(text, minutes);
                        session.sendToolResponse({
                          functionResponses: [{
                            name: fc.name,
                            response: { output: { result: `Reminder set: "${text}" in ${minutes} minute(s). (id: ${reminder.id})` } },
                            id: fc.id
                          }]
                        });
                      }
                    } catch (err: any) {
                      console.error("setReminder execution failure:", err);
                    }
                  })();
                } else if (fnName === "listReminders") {
                  const pending = getReminders().filter((r) => !r.fired);
                  const list = pending.length === 0
                    ? "No pending reminders."
                    : pending.map((r) => {
                        const mins = Math.max(0, Math.round((new Date(r.fireAt).getTime() - Date.now()) / 60000));
                        return `"${r.text}" — fires in ${mins} min (id: ${r.id})`;
                      }).join("\n");
                  session.sendToolResponse({
                    functionResponses: [{
                      name: fnName,
                      response: { output: { result: list } },
                      id: fc.id
                    }]
                  });
                } else if (fnName === "cancelReminder") {
                  const args = fc.args as any;
                  const ok = cancelReminder(args.id);
                  session.sendToolResponse({
                    functionResponses: [{
                      name: fnName,
                      response: { output: { result: ok ? "Reminder cancelled." : "Reminder not found." } },
                      id: fc.id
                    }]
                  });
                } else if (fnName === "saveUserRecord") {
                  // ── V4 role-feature data: save/update a user record ──
                  (async () => {
                    try {
                      const args = fc.args as any;
                      const rec = await saveRecord({
                        type: String(args.type || "note"),
                        title: String(args.title || "Untitled"),
                        payload: (args.payload && typeof args.payload === "object") ? args.payload : {},
                        due: args.due ? String(args.due) : undefined,
                        tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
                        id: args.id ? String(args.id) : undefined,
                      });
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: `Saved ${rec.type} "${rec.title}" (id: ${rec.id}).`, record: rec } },
                          id: fc.id
                        }]
                      });
                    } catch (err: any) {
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: `Could not save record: ${err?.message || err}` } },
                          id: fc.id
                        }]
                      });
                    }
                  })();
                } else if (fnName === "getUserRecords") {
                  // ── V4 role-feature data: query user records ──
                  (async () => {
                    try {
                      const args = fc.args as any;
                      const records = await queryRecords({
                        type: args.type,
                        tag: args.tag,
                        search: args.search,
                        dueBefore: args.due_before || args.dueBefore,
                        dueAfter: args.due_after || args.dueAfter,
                        limit: args.limit ? Number(args.limit) : undefined,
                      });
                      const list = records.length === 0
                        ? "No matching records found."
                        : records.map((r) => {
                            const dueStr = r.due ? ` | due ${r.due}` : "";
                            const payloadStr = Object.keys(r.payload || {}).length
                              ? ` | ${JSON.stringify(r.payload)}`
                              : "";
                            return `- [${r.type}] ${r.title}${dueStr}${payloadStr} (id: ${r.id})`;
                          }).join("\n");
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: list, records } },
                          id: fc.id
                        }]
                      });
                    } catch (err: any) {
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: `Could not read records: ${err?.message || err}` } },
                          id: fc.id
                        }]
                      });
                    }
                  })();
                } else if (fnName === "updateUserRecord") {
                  // ── V4 role-feature data: update an existing record ──
                  (async () => {
                    try {
                      const args = fc.args as any;
                      const rec = await updateRecord(String(args.id), {
                        title: args.title ? String(args.title) : undefined,
                        payload: (args.payload && typeof args.payload === "object") ? args.payload : undefined,
                        due: args.due ? String(args.due) : undefined,
                        tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
                      });
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: rec ? `Updated record ${rec.id}.` : `Record not found: ${args.id}` } },
                          id: fc.id
                        }]
                      });
                    } catch (err: any) {
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: `Could not update record: ${err?.message || err}` } },
                          id: fc.id
                        }]
                      });
                    }
                  })();
                } else if (fnName === "deleteUserRecord") {
                  // ── V4 role-feature data: delete a record ──
                  (async () => {
                    try {
                      const args = fc.args as any;
                      const ok = await deleteRecord(String(args.id));
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: ok ? "Record deleted." : `Record not found: ${args.id}` } },
                          id: fc.id
                        }]
                      });
                    } catch (err: any) {
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: `Could not delete record: ${err?.message || err}` } },
                          id: fc.id
                        }]
                      });
                    }
                  })();
                } else if (fnName === "draftReply") {
                  // ── V5.2 reply flow step 1: fetch original, compose reply, store draft ──
                  (async () => {
                    try {
                      const args = (fc.args || {}) as { id?: string; message_id?: string; request?: string };
                      const messageId = String(args.id || args.message_id || "").trim();
                      const request = String(args.request || "").trim();
                      if (!messageId) {
                        session.sendToolResponse({
                          functionResponses: [{
                            name: fc.name,
                            response: { output: { result: "Missing email id. Call getEmails first to list the inbox, then pass the id of the email to reply to." } },
                            id: fc.id,
                          }],
                        });
                        return;
                      }
                      if (!request) {
                        session.sendToolResponse({
                          functionResponses: [{
                            name: fc.name,
                            response: { output: { result: "Missing request. Say what the reply should communicate, e.g. 'confirm I will attend'." } },
                            id: fc.id,
                          }],
                        });
                        return;
                      }

                      // Full original — needed for the sender address AND thread ids.
                      const original = await googleReadEmail({ id: messageId, max_chars: 4000 });
                      if (!original.ok) {
                        session.sendToolResponse({
                          functionResponses: [{
                            name: fc.name,
                            response: { output: { result: `Could not read the original email: ${original.error}` } },
                            id: fc.id,
                          }],
                        });
                        return;
                      }
                      const orig = (original.result || {}) as {
                        from?: string; to?: string; subject?: string; body?: string; threadId?: string;
                      };

                      // Reply goes to the original sender; strip display name.
                      const addrMatch = String(orig.from || "").match(/[\w.%+-]+@[\w.-]+\.[a-z]{2,}/i);
                      const replyTo = addrMatch ? addrMatch[0].toLowerCase() : "";
                      if (!replyTo) {
                        session.sendToolResponse({
                          functionResponses: [{
                            name: fc.name,
                            response: { output: { result: "Could not determine the sender's address on the original email." } },
                            id: fc.id,
                          }],
                        });
                        return;
                      }

                      // Re: subject — avoid stacking "Re: Re:".
                      const origSubject = String(orig.subject || "").replace(/^\s*(re|aw|fwd?)\s*:\s*/i, "");
                      const subject = `Re: ${origSubject}`;

                      const profile = await loadProfile();
                      const composed = await composeEmail(
                        {
                          request,
                          to: [replyTo],
                          cc: [],
                          tone: "formal",
                          userName: profile?.name || "",
                          userEmail: profile?.email || "",
                          extraContext:
                            `You are REPLYING to this email.\n` +
                            `From: ${orig.from}\nSubject: ${orig.subject}\n` +
                            `Original message:\n"""${String(orig.body || "").slice(0, 1500)}"""\n` +
                            `Keep the reply self-contained and do not repeat the whole original.`,
                        },
                        apiKey
                      );

                      storeDraft(clientKey, {
                        to: replyTo,
                        cc: "",
                        subject,
                        body: composed.body,
                        request: `REPLY to ${messageId}: ${request}`,
                        createdAt: Date.now(),
                        composedBy: composed.composedBy,
                        replyToMessageId: messageId,
                        threadId: orig.threadId || undefined,
                        replyToFrom: orig.from || "",
                        replyToSnippet: String(orig.body || "").slice(0, 200),
                      });

                      const preview =
                        `REPLY DRAFT READY (not sent yet).\n` +
                        `In reply to: ${orig.from} — "${orig.subject}"\n` +
                        `To: ${replyTo}\n` +
                        `Subject: ${subject}\n` +
                        `Body:\n${composed.body}\n\n` +
                        `NEXT: Read this preview back to the user conversationally, then ask: 'Shall I send it?'. ` +
                        `If they approve, call sendEmail with NO arguments. If they want changes, call draftReply again with the same id and the refined request.`;

                      logCommand(`EMAIL_REPLY_DRAFT id=${messageId} to=${replyTo}`);
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: preview } },
                          id: fc.id,
                        }],
                      });
                    } catch (err: any) {
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: `Could not draft the reply: ${err?.message || err}` } },
                          id: fc.id,
                        }],
                      });
                    }
                  })();
                } else if (fnName === "draftEmail") {
                  // ── V4 email flow step 1: compose + store draft ──
                  (async () => {
                    try {
                      const args = fc.args as any;
                      const request = String(args.request || "").trim();
                      if (!request) {
                        session.sendToolResponse({
                          functionResponses: [{
                            name: fc.name,
                            response: { output: { result: "No request text provided. Ask the user what the email should say." } },
                            id: fc.id
                          }]
                        });
                        return;
                      }

                      // Recipients: explicit args win, else parse from the request text.
                      const explicit = normalizeRecipients({ to: args.to, cc: args.cc });
                      const spoken = explicit.to.length || explicit.cc.length
                        ? { to: [], cc: [] }
                        : parseRecipients(request);
                      const to = explicit.to.length ? explicit.to : spoken.to;
                      const cc = explicit.cc.length ? explicit.cc : spoken.cc;

                      const profile = await loadProfile();
                      const composed = await composeEmail(
                        {
                          request,
                          to,
                          cc,
                          tone: args.tone || "formal",
                          userName: profile?.name || "",
                          userEmail: profile?.email || "",
                        },
                        apiKey
                      );

                      storeDraft(clientKey, {
                        to: to.join(", "),
                        cc: cc.join(", "),
                        subject: composed.subject,
                        body: composed.body,
                        request,
                        createdAt: Date.now(),
                        composedBy: composed.composedBy,
                      });

                      const preview =
                        `DRAFT READY (not sent yet).\n` +
                        `To: ${to.join(", ") || "(missing — ask the user for the recipient's email address)"}\n` +
                        `Subject: ${composed.subject}\n` +
                        `Body:\n${composed.body}\n\n` +
                        `NEXT: Read this preview back to the user conversationally, then ask: 'Shall I send it?'. ` +
                        `If the recipient is missing, ask for it. If they approve, call sendEmail with NO arguments. ` +
                        `If they want changes, call draftEmail again with the refined request.`;

                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: preview } },
                          id: fc.id
                        }]
                      });
                    } catch (err: any) {
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: `Could not draft the email: ${err?.message || err}` } },
                          id: fc.id
                        }]
                      });
                    }
                  })();
                } else if (fnName === "sendEmail") {
                  // ── V4 email flow step 2: send stored draft or direct args ──
                  (async () => {
                    try {
                      const args = (fc.args || {}) as any;
                      const hasDirect = Boolean(
                        (args.to && String(args.to).trim()) ||
                        (args.subject && String(args.subject).trim()) ||
                        (args.body && String(args.body).trim())
                      );

                      let payload = { to: "", subject: "", body: "", cc: "" };
                      if (hasDirect) {
                        // Direct mode: model passed explicit fields (dictated email).
                        const norm = normalizeRecipients({ to: args.to, cc: args.cc });
                        payload = {
                          to: norm.to.join(", "),
                          subject: String(args.subject || "").trim(),
                          body: String(args.body || "").trim(),
                          cc: norm.cc.join(", "),
                        };
                        if (!payload.to || !payload.subject || !payload.body) {
                          session.sendToolResponse({
                            functionResponses: [{
                              name: fc.name,
                              response: { output: { result: "Missing fields for direct send (need to, subject AND body). Prefer the draft flow: call draftEmail with what the user asked, preview it, then sendEmail with no arguments." } },
                              id: fc.id
                            }]
                          });
                          return;
                        }
                      } else {
                        // Draft mode: consume the stored draft.
                        const draft = takeDraft(clientKey);
                        if (!draft) {
                          session.sendToolResponse({
                            functionResponses: [{
                              name: fc.name,
                              response: { output: { result: "No pending draft. Call draftEmail first with the user's request, get approval, then send." } },
                              id: fc.id
                            }]
                          });
                          return;
                        }
                        if (!draft.to) {
                          session.sendToolResponse({
                            functionResponses: [{
                              name: fc.name,
                              response: { output: { result: `The draft has no recipient. Ask the user for the email address, then call draftEmail again with to='<address>' and the same request.` } },
                              id: fc.id
                            }]
                          });
                          // keep the draft so the retry can reuse it after recipient is known
                          storeDraft(clientKey, draft);
                          return;
                        }
                        payload = mergeDraftWithArgs(draft, args);
                      }

                      logCommand(`EMAIL_SEND to=${payload.to} subject="${payload.subject}"`);
                      // V5: try server-native Gmail first (works without the
                      // desktop agent); falls back to the agent when Node
                      // OAuth isn't configured (hybrid deployments).
                      const gResult = await googleSendEmail({
                        to: payload.to,
                        subject: payload.subject,
                        body: payload.body,
                        cc: payload.cc || undefined,
                        inReplyTo: (payload as any).inReplyTo || undefined,
                        threadId: (payload as any).threadId || undefined,
                      });
                      const agentResult: { ok: boolean; result?: unknown; error?: string } = gResult.source === "node"
                        ? { ok: gResult.ok, result: gResult.result, error: gResult.error }
                        : await callDesktopAgent("sendEmail", {
                            to: payload.to,
                            subject: payload.subject,
                            body: payload.body,
                            cc: payload.cc || undefined,
                          });

                      if (agentResult.ok) {
                        const resultText = (agentResult.result as any)?.result || "Email sent.";
                        session.sendToolResponse({
                          functionResponses: [{
                            name: fc.name,
                            response: { output: { result: resultText } },
                            id: fc.id
                          }]
                        });
                      } else {
                        // If sending failed, restore the draft so a retry works.
                        const draft = peekDraft(clientKey) || takeDraft(clientKey);
                        const errMsg = agentResult.error || "Desktop agent error.";
                        console.error(`[Email] send failed: ${errMsg}`);
                        session.sendToolResponse({
                          functionResponses: [{
                            name: fc.name,
                            response: { output: { result: `Sending failed: ${errMsg}. The draft is preserved — fix the issue (e.g. Google OAuth setup) and ask the user to confirm again, then call sendEmail with no arguments.` } },
                            id: fc.id
                          }]
                        });
                      }
                    } catch (err: any) {
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: `Could not send email: ${err?.message || err}` } },
                          id: fc.id
                        }]
                      });
                    }
                  })();
                } else if (fnName === "shutdownYantri") {
                  clientWs.send(JSON.stringify({ type: "shutdown" }));
                  session.sendToolResponse({
                    functionResponses: [{
                      name: fnName,
                      response: { output: { result: "Yantri is shutting down gracefully." } },
                      id: fc.id
                    }]
                  });
                  setTimeout(() => {
                    console.log("[Server] Graceful shutdown requested by voice command.");
                    process.exit(0);
                  }, 2000);
                } else if (
                  [
                    "getCalendarEvents", "createCalendarEvent", "updateCalendarEvent", "deleteCalendarEvent",
                    "searchCalendarEvents", "getEmails", "readFullEmail", "getTasks", "createTask",
                  ].includes(fnName)
                ) {
                  // ── V5: Google suite — server-native via Node OAuth, agent as fallback ──
                  (async () => {
                    const args = (fc.args || {}) as Record<string, unknown>;
                    let gResult: { ok: boolean; source?: "node" | "agent"; result?: unknown; error?: string };
                    try {
                      switch (fnName) {
                        case "getCalendarEvents":
                          gResult = await googleListEvents(args as any);
                          break;
                        case "searchCalendarEvents":
                          gResult = await googleSearchEvents(args as any);
                          break;
                        case "createCalendarEvent":
                          gResult = await googleCreateEvent(args as any);
                          break;
                        case "updateCalendarEvent":
                          gResult = await googleUpdateEvent(args as any);
                          break;
                        case "deleteCalendarEvent":
                          gResult = await googleDeleteEvent(args as any);
                          break;
                        case "getEmails":
                          gResult = await googleListEmails(args as any);
                          break;
                        case "readFullEmail":
                          gResult = await googleReadEmail(args as any);
                          break;
                        case "getTasks":
                        case "createTask":
                          gResult = fnName === "getTasks"
                            ? await googleListTasks(args as any)
                            : await googleCreateTask(args as any);
                          break;
                        default:
                          gResult = { ok: false, error: `Unhandled Google tool ${fnName}` };
                      }
                    } catch (e: any) {
                      gResult = { ok: false, error: e?.message || String(e) };
                    }

                    const output = gResult.ok
                      ? (gResult.result ?? { result: "Done." })
                      : { result: `Google tool error: ${gResult.error}` };
                    session.sendToolResponse({
                      functionResponses: [{
                        name: fnName,
                        response: { output },
                        id: fc.id,
                      }],
                    });
                  })();
                } else if (fnName === "playYouTubeVideo") {
                  // ── V5: agent-free YouTube playback — search on the server, play in the UI ──
                  (async () => {
                    const args = (fc.args || {}) as { query?: string };
                    const query = String(args.query || "").trim();
                    if (!query) {
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fnName,
                          response: { output: { result: "No search query provided." } },
                          id: fc.id,
                        }],
                      });
                      return;
                    }
                    try {
                      const videoId = await findFirstYouTubeVideo(query);
                      if (!videoId) {
                        session.sendToolResponse({
                          functionResponses: [{
                            name: fnName,
                            response: { output: { result: `No videos found for "${query}".` } },
                            id: fc.id,
                          }],
                        });
                        return;
                      }
                      logCommand(`YOUTUBE_PLAY "${query}" video=${videoId}`);
                      for (const ws of connectedClients) {
                        try {
                          ws.send(JSON.stringify({ type: "playYouTube", query, videoId }));
                        } catch { /* client may have disconnected */ }
                      }
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fnName,
                          response: { output: { result: `Now playing the first YouTube result for "${query}" in your Yantri player.` } },
                          id: fc.id,
                        }],
                      });
                    } catch (e: any) {
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fnName,
                          response: { output: { result: `YouTube search failed: ${e?.message || e}` } },
                          id: fc.id,
                        }],
                      });
                    }
                  })();
                } else if (fnName === "getWeather" || fnName === "getNews" || fnName === "searchTavily") {
                  // ── Weather / News / Tavily Search: server-native.
                  // These work on any deployment without the desktop agent.
                  (async () => {
                    try {
                      let output: any;
                      if (fnName === "getWeather") {
                        output = await getWeatherServer(fc.args as { location?: string });
                      } else if (fnName === "getNews") {
                        output = await getNewsServer(fc.args as { category?: string; count?: number });
                      } else if (fnName === "searchTavily") {
                        const args = fc.args as {
                          query: string;
                          search_depth?: "basic" | "advanced";
                          topic?: "general" | "news" | "finance";
                          max_results?: number;
                          include_images?: boolean;
                        };
                        const result = await searchTavily({
                          query: args.query,
                          search_depth: args.search_depth,
                          topic: args.topic,
                          max_results: args.max_results,
                          include_images: args.include_images,
                          include_answer: true,
                        });
                        output = { result: formatTavilyResult(result) };
                      }
                      logCommand(`${fnName} ok`);
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fnName,
                          response: { output },
                          id: fc.id,
                        }],
                      });
                    } catch (e: any) {
                      logError(`${fnName}_FAILED: ${e?.message || e}`);
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fnName,
                          response: { output: { result: `${fnName === "getWeather" ? "Weather" : fnName === "getNews" ? "News" : "Tavily search"} failed: ${e?.message || e}` } },
                          id: fc.id,
                        }],
                      });
                    }
                  })();
                } else if (DESKTOP_TOOLS.has(fnName)) {
                  // ── Desktop control tools: route to Python agent ──
                  // In Cloud Mode there is no local agent by design — reject
                  // immediately instead of round-tripping to a dead port.
                  if (IS_CLOUD_MODE) {
                    session.sendToolResponse({
                      functionResponses: [{
                        name: fnName,
                        response: { output: { result: "Desktop control is disabled in Cloud Mode." } },
                        id: fc.id,
                      }],
                    });
                    return;
                  }
                  (async () => {
                    console.log(`[Desktop Agent] Routing ${fnName} to Python backend...`);
                    const agentResult = await callDesktopAgent(fnName, fc.args as Record<string, unknown>);

                    // Broadcast tool execution to all connected clients for terminal display
                    const outputText = agentResult.ok
                      ? JSON.stringify(agentResult.result ?? { result: "Done." })
                      : (agentResult.error || "Desktop agent error.");
                    for (const ws of connectedClients) {
                      try {
                        ws.send(JSON.stringify({
                          type: "terminal_output",
                          tool: fnName,
                          args: fc.args,
                          output: outputText,
                        }));
                      } catch (e) { /* client may have disconnected */ }
                    }

                    if (agentResult.ok) {
                      const output = agentResult.result ?? { result: "Done." };
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fnName,
                          response: { output },
                          id: fc.id
                        }]
                      });
                    } else {
                      const errMsg = agentResult.error || "Desktop agent error.";
                      console.error(`[Desktop Agent] Error for ${fnName}:`, errMsg);
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fnName,
                          response: { output: { result: `Desktop control error: ${errMsg}` } },
                          id: fc.id
                        }]
                      });
                    }
                  })();
                } else {
                  clientWs.send(JSON.stringify({
                    type: "toolCall",
                    callId: fc.id,
                    name: fc.name,
                    args: fc.args
                  }));
                }
              }
            }
          },
          onclose: (e: any) => {
            console.log(`Gemini Live session closed (code=${e?.code}, reason=${e?.reason || "none"}, wasClean=${e?.wasClean})`);
            clientWs.send(JSON.stringify({ type: "status", status: "session_closed" }));
          },
          onerror: (error: any) => {
            console.error("[Gemini Live Error]:", error);
            clientWs.send(JSON.stringify({ 
              type: "error", 
              error: `Gemini API Error: ${error?.message || String(error)}` 
            }));
          }
        }
      });
      
      clientWs.send(JSON.stringify({ type: "status", status: "connected" }));
      console.log("[Gemini Connect] Session established successfully");

      // V4: refresh the Data Vault from Google Calendar in the background so
      // exams added directly on Calendar appear on connect. Fire-and-forget.
      void importExamsFromCalendar().catch(() => {});
      
      clientWs.on("message", (rawMsg) => {
        try {
          const msg = JSON.parse(rawMsg.toString());
          if (msg.audio) {
            session.sendRealtimeInput({
              audio: { data: msg.audio, mimeType: "audio/pcm;rate=16000" }
            });
          } else if (msg.type === "video" && msg.video) {
            session.sendRealtimeInput({
              video: { data: msg.video, mimeType: "image/jpeg" }
            });
          } else if (msg.type === "toolResponse") {
            session.sendToolResponse({
              functionResponses: [
                {
                  name: msg.name,
                  response: { output: msg.output },
                  id: msg.id
                }
              ]
            });
          }
        } catch (e) {
          console.error("Error editing/forwarding client frame message:", e);
        }
      });
      
      clientWs.on("close", () => {
        console.log("Client disconnected, closing Gemini session");
        connectedClients.delete(clientWs);
        try {
          session.close();
        } catch (e) {}
      });
      
    } catch (err: any) {
      console.error("Error connecting to Gemini Live API:", err);
      clientWs.send(JSON.stringify({ 
        type: "error", 
        error: `Could not connect to Gemini: ${err.message || err}` 
      }));
      clientWs.close();
    }
  });

  return wss;
}
