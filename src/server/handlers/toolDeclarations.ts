/**
 * YANTRI — Gemini Live function declarations (shared module).
 *
 * Extracted from the monolithic server so the /live WebSocket route (and any
 * other consumer) offers Gemini the exact same tool surface. Capability and
 * role gating are applied by buildFunctionDeclarations().
 */
import { Type } from "@google/genai";
import type { FunctionDeclaration } from "@google/genai";

const DESKTOP_TOOLS: ReadonlySet<string> = new Set([
  // applications / websites / search
  "openApplication", "closeApplication", "openWebsite",
  "searchWeb", "searchYouTube", "searchGoogle", "searchGitHub",
  // files
  "createFile", "readFile", "renameFile", "deleteFile", "moveFile",
  "openFolder", "listFiles", "searchFiles",
  // pc control (volume + gated power)
  "volumeUp", "volumeDown", "muteToggle", "setVolume",
  "requestPowerAction", "executePowerAction",
  // windows
  "minimizeWindow", "maximizeWindow", "closeWindow", "switchApplication",
  // clipboard
  "copySelected", "pasteClipboard", "getClipboard", "clearClipboard",
  // screenshot / screen reading
  "takeScreenshot", "saveScreenshot", "analyzeScreenshot", "readScreen",
  // browser automation (Playwright — desktop-owned, separate from holographic UI)
  "desktopBrowserOpen", "desktopBrowserNavigate", "desktopBrowserOpenTab",
  "desktopBrowserCloseTab", "desktopBrowserSearch", "desktopBrowserOpenYoutubeVideo",
  "desktopBrowserClick", "desktopBrowserType", "desktopBrowserFillForm", "desktopBrowserGoBack",
  "desktopBrowserGoForward", "desktopBrowserScroll",
  "desktopBrowserReadText", "desktopBrowserGetLinks",
  "desktopBrowserSetMode", "browserMediaControl",
  // coding assistance
  "createPythonFile", "runPythonScript", "createProjectFolder", "writeCodeFile",
  // system information
  "systemInfo", "gpuInfo", "temperatureInfo",
  // brightness control (V2)
  "brightnessUp", "brightnessDown", "setBrightness",
  // Windows auto-start management (V2)
  "enableAutoStart", "disableAutoStart", "getAutoStartStatus",
  // terminal
  "requestTerminalAction", "runTerminalCommand", "installPackage",
  "provideSudoPassword", "isCommandAllowed",
  // IITM BS (V2)
  "iitmQuickLinks", "iitmOpen", "iitmOpenCustom",
  // client-side holographic browser tools (routed to Python agent)
  "browserTabAction",
  // self-close
  "shutdownYantri",
  // weather
  "getWeather",
  // Hyprland workspace
  "switchWorkspace", "listWorkspaces", "moveToWorkspace",
  // news
  "getNews",
  // conversation export
  "exportConversation", "listExports",
  // Google Calendar, Gmail, Tasks
  "getCalendarEvents", "createCalendarEvent",
  "sendEmail", "getEmails",
  "getTasks", "createTask",
  // OS input
  "osType", "osPress", "osClick",
  // camera control
  "cameraList", "cameraOn", "cameraOff",
  // V4 role-feature tools: study/focus + spreadsheets + document extraction
  "startPomodoro", "startFocusMode", "stopFocusMode", "getFocusStatus",
  "extractDocumentText",
  "writeSpreadsheet", "appendSpreadsheetRows", "readSpreadsheet", "summarizeSpreadsheet",
  "logInventoryEntry",
]);

const SERVER_TOOLS: ReadonlySet<string> = new Set([
  "getWeather",            // server_weather_news.ts (wttr.in)
  "getNews",              // server_weather_news.ts (Google News RSS)
  "searchTavily",          // server_tavily.ts (Tavily AI search)
  "openWebsite",           // client holographic browser (or agent's default-browser opener when present)
  "browserTabAction",      // client holographic browser tabs
  "browserMediaControl",   // client holographic player play/pause/volume/skip
]);

/**
 * Every Gemini Live tool declaration, before capability/role gating.
 * Keep in sync with the Python agent registry (agent/registry.py).
 */
const ALL_TOOL_DECLARATIONS: FunctionDeclaration[] = [
                {
                  name: "browserMediaControl",
                  description: "Controls ongoing video/audio stream media properties on YouTube, like play, pause, volume, mute, skip, and fullscreen.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      action: {
                        type: Type.STRING,
                        description: "The media controller command operation.",
                        enum: ["play", "pause", "volume", "fullscreen", "exit_fullscreen", "mute", "unmute", "skip"]
                      },
                      value: {
                        type: Type.INTEGER,
                        description: "The value parameter; only relevant for set volume level, e.g. 50 for fifty percent."
                      }
                    },
                    required: ["action"]
                  }
                },
                {
                  name: "browserTabAction",
                  description: "Performs standard browser-tab actions: open new tab, close a tab, or switch index values.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      action: {
                        type: Type.STRING,
                        description: "Tab action instruction.",
                        enum: ["new", "close", "switch"]
                      },
                      tabId: {
                        type: Type.STRING,
                        description: "The tab identifier string if closing or switching."
                      },
                      url: {
                        type: Type.STRING,
                        description: "The initial starting URL if creating a new tab."
                      }
                    },
                    required: ["action"]
                  }
                },
                {
                  name: "changeBackground",
                  description: "Changes the visual theme or atmospheric glow color of Yantri's interface.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      color: {
                        type: Type.STRING,
                        description: "The theme color name (violet, crimson, emerald, celestial, gold, rose, charcoal)"
                      }
                    },
                    required: ["color"]
                  }
                },
                // ── OS Input (native keyboard/mouse) ──
                {
                  name: "osType",
                  description: "Type text at the current cursor position using native OS keyboard events. Use for native apps (VS Code, terminal) or when Playwright DOM typing fails. Example: type code into a code editor.",
                  parameters: { type: Type.OBJECT, properties: { text: { type: Type.STRING, description: "Text to type at the current cursor position." } }, required: ["text"] }
                },
                {
                  name: "osPress",
                  description: "Press a specific keyboard key at native OS level. Example: osPress(key='enter'), osPress(key='ctrl+c'), osPress(key='alt+tab').",
                  parameters: { type: Type.OBJECT, properties: { key: { type: Type.STRING, description: "Key or key combination to press. Examples: 'enter', 'ctrl+c', 'alt+tab', 'escape', 'tab', 'f5'." } }, required: ["key"] }
                },
                {
                  name: "osClick",
                  description: "Click at a specific screen coordinate or perform a right-click at native OS level. Example: osClick(x=500, y=300) or osClick(x=500, y=300, button='right').",
                  parameters: { type: Type.OBJECT, properties: { x: { type: Type.INTEGER, description: "X coordinate on screen." }, y: { type: Type.INTEGER, description: "Y coordinate on screen." }, button: { type: Type.STRING, description: "Mouse button: 'left' (default) or 'right'." } }, required: ["x", "y"] }
                },
                {
                  name: "saveCustomMemory",
                  description: "Allows Yantri to immediately save a piece of critical user information to her persistent memory core.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      category: {
                        type: Type.STRING,
                        description: "The memory category.",
                        enum: ["identity", "preference", "goal", "project", "relationship", "emotional", "behavior"]
                      },
                      text: {
                        type: Type.STRING,
                        description: "Precise third-person statement."
                      }
                    },
                    required: ["category", "text"]
                  }
                },

                // ======== REMINDER TOOLS ========
                {
                  name: "setReminder",
                  description: "Schedule a timed reminder. Yantri will notify the user when the time is up. Use when the user says 'remind me to X in Y minutes/hours'.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      text: {
                        type: Type.STRING,
                        description: "The reminder message to deliver."
                      },
                      minutes: {
                        type: Type.NUMBER,
                        description: "Number of minutes from now to fire the reminder."
                      }
                    },
                    required: ["text", "minutes"]
                  }
                },
                {
                  name: "listReminders",
                  description: "List all pending reminders the user has set.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "cancelReminder",
                  description: "Cancel a specific reminder by its ID.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      id: {
                        type: Type.STRING,
                        description: "The reminder ID to cancel."
                      }
                    },
                    required: ["id"]
                  }
                },

                // ======== DESKTOP CONTROL TOOLS (routed to Python agent) ========
                {
                  name: "openApplication",
                  description: "Open a desktop application (e.g. Notepad, Chrome, VS Code, Calculator, File Explorer, Task Manager, Settings, CMD, PowerShell).",
                  parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING, description: "Application name, e.g. 'notepad', 'chrome', 'vscode'." } }, required: ["name"] }
                },
                {
                  name: "closeApplication",
                  description: "Close a running desktop application by name.",
                  parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING, description: "Application name." }, force: { type: Type.BOOLEAN, description: "Force close (default false)." } }, required: ["name"] }
                },
                {
                  name: "openWebsite",
                  description: "Open a named website or URL in the user's default system browser. Supports shortcuts: youtube, gmail, google, github, chatgpt, etc.",
                  parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING, description: "Site name shortcut (e.g. 'youtube', 'gmail')." }, url: { type: Type.STRING, description: "Full URL if no shortcut." } } }
                },
                {
                  name: "searchWeb",
                  description: "Search a website engine (google, youtube, github, duckduckgo, bing) and open results in the default browser.",
                  parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: "Search query." }, engine: { type: Type.STRING, description: "Engine name (default 'google')." } }, required: ["query"] }
                },
                {
                  name: "searchYouTube",
                  description: "Search YouTube and open results in the default browser.",
                  parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: "Search query." } }, required: ["query"] }
                },
                {
                  name: "searchGoogle",
                  description: "Search Google and open results in the default browser.",
                  parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: "Search query." } }, required: ["query"] }
                },
                {
                  name: "searchGitHub",
                  description: "Search GitHub repositories and open results in the default browser.",
                  parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: "Search query." } }, required: ["query"] }
                },
                {
                  name: "searchTavily",
                  description: "Search the web using Tavily AI-powered search with summarization. Provides high-quality, AI-summarized results from across the web. Use for factual questions, current events, research, or when you need accurate information from multiple sources.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      query: { type: Type.STRING, description: "Search query." },
                      search_depth: { type: Type.STRING, description: "Search depth: 'basic' (fast) or 'advanced' (comprehensive). Default: 'advanced'.", enum: ["basic", "advanced"] },
                      topic: { type: Type.STRING, description: "Topic category: 'general', 'news', or 'finance'. Default: 'general'.", enum: ["general", "news", "finance"] },
                      max_results: { type: Type.INTEGER, description: "Maximum number of results (default 10)." },
                      include_images: { type: Type.BOOLEAN, description: "Include images in results (default false)." }
                    },
                    required: ["query"]
                  }
                },
                {
                  name: "createFile",
                  description: "Create a new text file with optional content. Scoped to safe folders (Desktop, Documents, Downloads, etc.).",
                  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING, description: "File path." }, content: { type: Type.STRING, description: "File content (default empty)." }, overwrite: { type: Type.BOOLEAN, description: "Overwrite if exists (default false)." } }, required: ["path"] }
                },
                {
                  name: "readFile",
                  description: "Read the contents of a text file.",
                  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING, description: "File path." }, max_chars: { type: Type.INTEGER, description: "Max chars to return (default 8000)." } }, required: ["path"] }
                },
                {
                  name: "renameFile",
                  description: "Rename a file.",
                  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING, description: "Current file path." }, new_name: { type: Type.STRING, description: "New file name." } }, required: ["path", "new_name"] }
                },
                {
                  name: "deleteFile",
                  description: "Delete a file. Sends to Recycle Bin by default (safe). Use permanent=true for hard delete.",
                  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING, description: "File path." }, permanent: { type: Type.BOOLEAN, description: "Permanently delete (default false)." } }, required: ["path"] }
                },
                {
                  name: "moveFile",
                  description: "Move a file to a new location.",
                  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING, description: "Source file path." }, destination: { type: Type.STRING, description: "Destination path or folder." } }, required: ["path", "destination"] }
                },
                {
                  name: "openFolder",
                  description: "Open a folder in File Explorer. Supports aliases: desktop, documents, downloads, pictures, music, videos, home.",
                  parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING, description: "Folder name or alias." }, path: { type: Type.STRING, description: "Full path if no alias." } } }
                },
                {
                  name: "listFiles",
                  description: "List files in a folder.",
                  parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING, description: "Folder name or alias." }, path: { type: Type.STRING, description: "Full path." }, pattern: { type: Type.STRING, description: "Glob pattern (default '*')." } } }
                },
                {
                  name: "searchFiles",
                  description: "Search for files by name glob or extension under a folder.",
                  parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING, description: "Filename glob (e.g. '*.py')." }, extension: { type: Type.STRING, description: "File extension (e.g. 'py')." }, folder: { type: Type.STRING, description: "Folder to search (default home)." }, limit: { type: Type.INTEGER, description: "Max results (default 100)." } } }
                },
                {
                  name: "volumeUp",
                  description: "Increase system volume.",
                  parameters: { type: Type.OBJECT, properties: { amount: { type: Type.NUMBER, description: "Step amount 0-1 (default 0.1)." } } }
                },
                {
                  name: "volumeDown",
                  description: "Decrease system volume.",
                  parameters: { type: Type.OBJECT, properties: { amount: { type: Type.NUMBER, description: "Step amount 0-1 (default 0.1)." } } }
                },
                {
                  name: "setVolume",
                  description: "Set system volume to a specific percentage.",
                  parameters: { type: Type.OBJECT, properties: { percent: { type: Type.NUMBER, description: "Volume percentage 0-100." } }, required: ["percent"] }
                },
                {
                  name: "muteToggle",
                  description: "Toggle mute/unmute on the system volume.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "requestPowerAction",
                  description: "FIRST STEP for dangerous power actions. Generates a confirmation token. Tell the user verbally, then call executePowerAction with the token if they confirm. Actions: shutdown, restart, sleep, lock.",
                  parameters: { type: Type.OBJECT, properties: { action: { type: Type.STRING, description: "Power action: shutdown, restart, sleep, lock." } }, required: ["action"] }
                },
                {
                  name: "executePowerAction",
                  description: "SECOND STEP: execute a previously-confirmed power action. Requires a valid execute_token from requestPowerAction. Single-use, expires in 60 seconds.",
                  parameters: { type: Type.OBJECT, properties: { action: { type: Type.STRING, description: "The confirmed power action." }, execute_token: { type: Type.STRING, description: "Confirmation token from requestPowerAction." } }, required: ["action", "execute_token"] }
                },
                {
                  name: "minimizeWindow",
                  description: "Minimize the active window or a named window.",
                  parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING, description: "Window title to match (optional, defaults to active window)." } } }
                },
                {
                  name: "maximizeWindow",
                  description: "Maximize the active window or a named window.",
                  parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING, description: "Window title to match." } } }
                },
                {
                  name: "closeWindow",
                  description: "Close the active window or a named window.",
                  parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING, description: "Window title to match." } } }
                },
                {
                  name: "switchApplication",
                  description: "Switch to a named application window, or cycle Alt+Tab if no title given.",
                  parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING, description: "Window title to switch to." } } }
                },
                {
                  name: "copySelected",
                  description: "Copy selected text: sends Ctrl+C and reads the clipboard.",
                  parameters: { type: Type.OBJECT, properties: { wait: { type: Type.NUMBER, description: "Seconds to wait after Ctrl+C (default 0.35)." } } }
                },
                {
                  name: "pasteClipboard",
                  description: "Paste text into the active input. Writes text to clipboard then sends Ctrl+V.",
                  parameters: { type: Type.OBJECT, properties: { text: { type: Type.STRING, description: "Text to paste. If omitted, pastes current clipboard." } } }
                },
                {
                  name: "getClipboard",
                  description: "Read the current clipboard text content.",
                  parameters: { type: Type.OBJECT, properties: { max_chars: { type: Type.INTEGER, description: "Max chars (default 1000)." } } }
                },
                {
                  name: "clearClipboard",
                  description: "Empty the clipboard.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "takeScreenshot",
                  description: "Capture the full screen. Optionally include base64 image data.",
                  parameters: { type: Type.OBJECT, properties: { include_image: { type: Type.BOOLEAN, description: "Include base64 JPEG image (default false)." }, max_dim: { type: Type.INTEGER, description: "Max image dimension (default 1280)." } } }
                },
                {
                  name: "saveScreenshot",
                  description: "Save a screenshot to Pictures/YantriScreenshots.",
                  parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING, description: "Optional filename prefix." } } }
                },
                {
                  name: "analyzeScreenshot",
                  description: "Take a screenshot and run OCR to extract visible text from the screen.",
                  parameters: { type: Type.OBJECT, properties: { max_chars: { type: Type.INTEGER, description: "Max OCR chars (default 1500)." } } }
                },
                {
                  name: "readScreen",
                  description: "OCR the active window and return its title plus visible text.",
                  parameters: { type: Type.OBJECT, properties: { max_chars: { type: Type.INTEGER, description: "Max OCR chars (default 1500)." } } }
                },
                {
                  name: "desktopBrowserOpen",
                  description: "Open a URL in the desktop Playwright automation browser (real Chromium, separate from holographic UI).",
                  parameters: { type: Type.OBJECT, properties: { url: { type: Type.STRING, description: "URL to open." } }, required: ["url"] }
                },
                {
                  name: "desktopBrowserSearch",
                  description: "Search within the desktop automation browser.",
                  parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: "Search query." }, engine: { type: Type.STRING, description: "Engine: google, youtube, github, duckduckgo, bing." } }, required: ["query"] }
                },
                {
                  name: "desktopBrowserOpenYoutubeVideo",
                  description: "Search YouTube and open the first result's canonical video URL without relying on a fragile DOM click.",
                  parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: "YouTube search query." } }, required: ["query"] }
                },
                {
                  name: "desktopBrowserClick",
                  description: "Click an element in the desktop automation browser by CSS selector or text.",
                  parameters: { type: Type.OBJECT, properties: { selector: { type: Type.STRING, description: "CSS selector." }, text: { type: Type.STRING, description: "Text to find and click." } } }
                },
                {
                  name: "desktopBrowserType",
                  description: "Type text into the active element in the desktop automation browser.",
                  parameters: { type: Type.OBJECT, properties: { text: { type: Type.STRING, description: "Text to type." }, selector: { type: Type.STRING, description: "Optional CSS selector for a specific input." }, clear: { type: Type.BOOLEAN, description: "Clear before typing (default true)." } }, required: ["text"] }
                },
                {
                  name: "desktopBrowserFillForm",
                  description: "Fill multiple form fields and optionally submit in the desktop automation browser.",
                  parameters: { type: Type.OBJECT, properties: { fields: { type: Type.OBJECT, description: "Object of selector -> value pairs." }, submit: { type: Type.STRING, description: "Optional submit button selector." } }, required: ["fields"] }
                },
                {
                  name: "desktopBrowserOpenTab",
                  description: "Open a new tab in the desktop automation browser.",
                  parameters: { type: Type.OBJECT, properties: { url: { type: Type.STRING, description: "URL for the new tab." } } }
                },
                {
                  name: "desktopBrowserCloseTab",
                  description: "Close the active tab in the desktop automation browser.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "desktopBrowserGoBack",
                  description: "Navigate back in the desktop automation browser history.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "desktopBrowserGoForward",
                  description: "Navigate forward in the desktop automation browser history.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "desktopBrowserScroll",
                  description: "Scroll the desktop automation browser page.",
                  parameters: { type: Type.OBJECT, properties: { direction: { type: Type.STRING, description: "Scroll direction: up or down." }, amount: { type: Type.INTEGER, description: "Pixels to scroll (default 500)." } } }
                },
                {
                  name: "createPythonFile",
                  description: "Create a Python (.py) file with content.",
                  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING, description: "File path." }, content: { type: Type.STRING, description: "Python code content." }, overwrite: { type: Type.BOOLEAN, description: "Overwrite if exists." } }, required: ["path"] }
                },
                {
                  name: "writeCodeFile",
                  description: "Create a code file in any language with appropriate extension.",
                  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING, description: "File path." }, content: { type: Type.STRING, description: "Code content." }, language: { type: Type.STRING, description: "Language name (e.g. 'python', 'javascript', 'html')." }, overwrite: { type: Type.BOOLEAN, description: "Overwrite if exists." } }, required: ["path"] }
                },
                {
                  name: "createProjectFolder",
                  description: "Create a project folder structure with optional subfolders and starter files.",
                  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING, description: "Project root folder path." }, subfolders: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of subfolder names." }, scaffold_standard: { type: Type.BOOLEAN, description: "Create src, tests, docs subfolders." }, files: { type: Type.OBJECT, description: "Object of relative-path -> content for starter files." } }, required: ["path"] }
                },
                {
                  name: "runPythonScript",
                  description: "Execute a Python script and capture stdout, stderr, and exit code. Has a configurable timeout.",
                  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING, description: "Script path." }, args: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Script arguments." }, timeout: { type: Type.INTEGER, description: "Timeout in seconds (default 30)." } }, required: ["path"] }
                },
                {
                  name: "systemInfo",
                  description: "Get system resource usage: CPU %, RAM %, disk usage, uptime, OS info.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "gpuInfo",
                  description: "Get NVIDIA GPU stats: utilization %, VRAM usage, temperature. Graceful fallback if no NVIDIA GPU.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "temperatureInfo",
                  description: "Get available temperature readings (CPU, GPU, etc.). Best-effort on Windows.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                // --- V2: Brightness control ---
                {
                  name: "brightnessUp",
                  description: "Increase screen brightness by a step (default 10%). Use when user says 'increase brightness' or 'make screen brighter'.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      amount: { type: Type.NUMBER, description: "Percentage to increase (default 10)." }
                    }
                  }
                },
                {
                  name: "brightnessDown",
                  description: "Decrease screen brightness by a step (default 10%). Use when user says 'decrease brightness' or 'dim screen'.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      amount: { type: Type.NUMBER, description: "Percentage to decrease (default 10)." }
                    }
                  }
                },
                {
                  name: "setBrightness",
                  description: "Set screen brightness to an exact level. Use when user says 'set brightness to 50%' or 'brightness 80'.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      percent: { type: Type.NUMBER, description: "Target brightness 0-100." }
                    },
                    required: ["percent"]
                  }
                },
                // --- V2: Windows auto-start management ---
                {
                  name: "enableAutoStart",
                  description: "Enable YANTRI to launch automatically when Windows starts. Creates a silent startup entry.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "disableAutoStart",
                  description: "Disable YANTRI auto-start on Windows login. Removes the startup entry.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "getAutoStartStatus",
                  description: "Check whether YANTRI is currently configured to auto-start on Windows login.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                // --- V3: Terminal and Package execution ---
                {
                  name: "requestTerminalAction",
                  description: "FIRST STEP for terminal commands or package installation. Generates a confirmation token. Tell the user verbally, then call the execution tool if they confirm.",
                  parameters: { type: Type.OBJECT, properties: { command: { type: Type.STRING, description: "Terminal command to run." }, package: { type: Type.STRING, description: "Package name to install." } } }
                },
                {
                  name: "runTerminalCommand",
                  description: "SECOND STEP: execute a previously-confirmed terminal command. Requires a valid execute_token from requestTerminalAction.",
                  parameters: { type: Type.OBJECT, properties: { command: { type: Type.STRING, description: "The confirmed bash command." }, execute_token: { type: Type.STRING, description: "Confirmation token from requestTerminalAction." } }, required: ["command", "execute_token"] }
                },
                {
                  name: "isCommandAllowed",
                  description: "Checks whether a terminal command is allowed by the security blacklist before running. Use to validate a command before execution.",
                  parameters: { type: Type.OBJECT, properties: { command: { type: Type.STRING, description: "The terminal command to check." } }, required: ["command"] }
                },
                {
                  name: "installPackage",
                  description: "SECOND STEP: install a package using pacman. Requires a valid execute_token from requestTerminalAction.",
                  parameters: { type: Type.OBJECT, properties: { package: { type: Type.STRING, description: "The confirmed package name." }, execute_token: { type: Type.STRING, description: "Confirmation token from requestTerminalAction." } }, required: ["package", "execute_token"] }
                },
                // --- V4: Browser vision + IITM + self-close ---
                {
                  name: "desktopBrowserReadText",
                  description: "Read the visible text content of the current page in the desktop automation browser. Use when user asks 'what does this page say' or 'read this page'.",
                  parameters: { type: Type.OBJECT, properties: { max_chars: { type: Type.INTEGER, description: "Max chars to return (default 4000)." } } }
                },
                {
                  name: "desktopBrowserGetLinks",
                  description: "Extract all visible hyperlinks from the current page in the desktop automation browser.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "iitmQuickLinks",
                  description: "List all available IITM BS Degree quick links (portal, course dashboard, Acegrade, notes, etc.).",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "iitmOpen",
                  description: "Open an IITM BS Degree resource by name. Available: portal, course, academics, qualifier, exams, acegrade, mlt_notes, pdsa_notes, pdsa_notes_community, community_notes, mlt_github, portal_login.",
                  parameters: { type: Type.OBJECT, properties: { resource: { type: Type.STRING, description: "Resource key name." } }, required: ["resource"] }
                },
                {
                  name: "iitmOpenCustom",
                  description: "Open a custom IITM URL in the system browser.",
                  parameters: { type: Type.OBJECT, properties: { url: { type: Type.STRING, description: "URL to open." } }, required: ["url"] }
                },
                {
                  name: "shutdownYantri",
                  description: "Gracefully shut down YANTRI agent and server. Use only when user explicitly asks to close YANTRI. Requires confirmation token from requestTerminalAction.",
                  parameters: { type: Type.OBJECT, properties: { execute_token: { type: Type.STRING, description: "Confirmation token from requestTerminalAction." } }, required: ["execute_token"] }
                },
                {
                  name: "getWeather",
                  description: "Get current weather for a location. Use when user asks about weather, temperature, or climate.",
                  parameters: { type: Type.OBJECT, properties: { location: { type: Type.STRING, description: "City name (e.g. 'Mumbai', 'Delhi', 'New York')." } }, required: ["location"] }
                },
                {
                  name: "switchWorkspace",
                  description: "Switch to a specific Hyprland workspace by number. Use when user says 'go to workspace 3' or 'switch to workspace 1'.",
                  parameters: { type: Type.OBJECT, properties: { workspace: { type: Type.STRING, description: "Workspace number or name (e.g. '3', 'special:scratchpad')." } }, required: ["workspace"] }
                },
                {
                  name: "listWorkspaces",
                  description: "List all available Hyprland workspaces with their IDs.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "moveToWorkspace",
                  description: "Move the active window to a different Hyprland workspace.",
                  parameters: { type: Type.OBJECT, properties: { workspace: { type: Type.STRING, description: "Target workspace number." } }, required: ["workspace"] }
                },
                {
                  name: "getNews",
                  description: "Get top news headlines. Supports categories: top, tech, world, india, sports, business.",
                  parameters: { type: Type.OBJECT, properties: { category: { type: Type.STRING, description: "News category: 'top', 'tech', 'world', 'india', 'sports', 'business'." }, count: { type: Type.INTEGER, description: "Number of headlines (max 15, default 5)." } } }
                },
                {
                  name: "exportConversation",
                  description: "Save the current conversation to a text file on disk. Call this when the user says 'save this conversation', 'baat save kar', 'export chat'. Pass the full conversation text that you have from context.",
                  parameters: { type: Type.OBJECT, properties: { text: { type: Type.STRING, description: "Full conversation text to save." }, filename: { type: Type.STRING, description: "Optional filename (default auto-generated with timestamp)." } }, required: ["text"] }
                },
                {
                  name: "listExports",
                  description: "List all previously saved conversation export files.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                // ── Google Calendar, Gmail, Tasks ──
                {
                  name: "getCalendarEvents",
                  description: "List upcoming Google Calendar events. Use when user asks 'what's on my calendar', 'mera schedule bata', 'upcoming events'.",
                  parameters: { type: Type.OBJECT, properties: { max_results: { type: Type.INTEGER, description: "Number of events (default 10)." }, days_ahead: { type: Type.INTEGER, description: "Days ahead to check (default 7)." }, show_all: { type: Type.BOOLEAN, description: "Include full details (default false)." } } }
                },
                {
                  name: "createCalendarEvent",
                  description: "Create a Google Calendar event. Use when user says 'meeting schedule kar', 'event bana', 'reminder add kar'.",
                  parameters: { type: Type.OBJECT, properties: { summary: { type: Type.STRING, description: "Event title (required)." }, start_time: { type: Type.STRING, description: "Start time in ISO format, e.g. '2026-07-24T14:00:00'." }, end_time: { type: Type.STRING, description: "End time in ISO format." }, description: { type: Type.STRING, description: "Event description." }, location: { type: Type.STRING, description: "Event location." }, attendees: { type: Type.STRING, description: "Comma-separated email addresses." } }, required: ["summary"] }
                },
                {
                  name: "playYouTubeVideo",
                  description: "Agent-free YouTube playback: search YouTube for a song/video and play the first result inside Yantri's embedded player. Use for 'play Believer', 'gaana chalao', 'play lofi coding music on YouTube'. Works on ANY device — no desktop agent needed.",
                  parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: "YouTube search query, e.g. 'Believer by Imagine Dragons'." } }, required: ["query"] }
                },
                {
                  name: "draftEmail",
                  description: "FIRST STEP of sending an email from ONE spoken command. Extracts the recipient address and email request from what the user said, composes a polished subject+body, stores it as a draft and returns a preview. Read the preview back, ask for approval, then call sendEmail (with NO arguments) to send it.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      request: { type: Type.STRING, description: "Everything the user said about the email, verbatim or lightly cleaned: 'email professor sharma saying I need a 2 day extension on the MLT assignment'." },
                      to: { type: Type.STRING, description: "Recipient email address if the user spoke it (leave empty to ask)." },
                      cc: { type: Type.STRING, description: "CC address(es), comma separated if the user mentioned any." },
                      tone: { type: Type.STRING, description: "Tone: formal (default), casual or polite.", enum: ["formal", "casual", "polite"] }
                    },
                    required: ["request"]
                  }
                },
                {
                  name: "readFullEmail",
                  description: "Read the FULL body of one email by its id. Use when the user asks to 'open/read the email', 'what does it say', 'iski poori detail suna', after listing emails with getEmails. Returns sender, date, subject, plain-text body and attachment names.",
                  parameters: { type: Type.OBJECT, properties: { id: { type: Type.STRING, description: "Gmail message id from getEmails." }, max_chars: { type: Type.INTEGER, description: "Max body characters to return (default 6000)." } }, required: ["id"] }
                },
                {
                  name: "draftReply",
                  description: "FIRST STEP of replying to an email the user has heard (via getEmails/readFullEmail). Fetches the original, composes a contextual reply, stores it as a draft and returns a preview. Read the preview back, ask for approval, then call sendEmail (with NO arguments) to send the threaded reply.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING, description: "Gmail message id of the email being replied to (from getEmails)." },
                      request: { type: Type.STRING, description: "Everything the user said the reply should communicate, e.g. 'confirm I will attend and ask for the venue'." }
                    },
                    required: ["id", "request"]
                  }
                },
                {
                  name: "sendEmail",
                  description: "Send an email via Gmail. TWO modes: (1) After draftEmail was called and approved, call this with NO arguments to send the stored draft. (2) Only when the user explicitly dictates every field, pass to/subject/body directly. Never invent recipients or content.",
                  parameters: { type: Type.OBJECT, properties: { to: { type: Type.STRING, description: "Recipient email address (omit to use the approved draft)." }, subject: { type: Type.STRING, description: "Email subject (omit to use the approved draft)." }, body: { type: Type.STRING, description: "Email body text (omit to use the approved draft)." }, cc: { type: Type.STRING, description: "CC email address." } } }
                },
                {
                  name: "getEmails",
                  description: "List recent emails from Gmail inbox. Use when user says 'meri emails dikha', 'inbox check kar', 'recent emails'.",
                  parameters: { type: Type.OBJECT, properties: { max_results: { type: Type.INTEGER, description: "Number of emails (default 5, max 20)." }, query: { type: Type.STRING, description: "Gmail search filter, e.g. 'from:someone@gmail.com' or 'subject:meeting'." } } }
                },
                {
                  name: "getTasks",
                  description: "List tasks from Google Tasks. Use when user asks 'meri tasks dikha', 'to-do list bata', 'what tasks do I have'.",
                  parameters: { type: Type.OBJECT, properties: { tasklist: { type: Type.STRING, description: "Task list name (default 'My Tasks')." }, max_results: { type: Type.INTEGER, description: "Max tasks (default 10)." }, show_completed: { type: Type.BOOLEAN, description: "Include completed tasks (default false)." } } }
                },
                {
                  name: "createTask",
                  description: "Create a task in Google Tasks. Use when user says 'task add kar', 'reminder set kar', 'ek kaam yaad rakh'.",
                  parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING, description: "Task title (required)." }, notes: { type: Type.STRING, description: "Task description." }, due: { type: Type.STRING, description: "Due date in ISO format, e.g. '2026-07-30'." }, tasklist: { type: Type.STRING, description: "Task list name (default 'My Tasks')." } }, required: ["title"] }
                },
                {
                  name: "cameraList",
                  description: "List available webcam devices on this computer. Use when the user asks what cameras are available or before turning a camera on.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "cameraOn",
                  description: "Turn the webcam ON in a floating viewer window without disturbing the tiling layout of other windows. Use when user says 'camera on karo', 'webcam chalao', 'kamera kholo'. Optionally pass a specific device.",
                  parameters: { type: Type.OBJECT, properties: { device: { type: Type.STRING, description: "Camera device path, e.g. '/dev/video0'. Defaults to the first camera found." } } }
                },
                {
                  name: "cameraOff",
                  description: "Turn the webcam OFF and free the device for other applications. Use when user says 'camera band karo', 'webcam band karo'.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                // ── V4: Role-feature tools — personal data records ──
                {
                  name: "saveUserRecord",
                  description: "Save a piece of user-provided data for their selected features: assignment deadlines, exam dates, notes, flashcards, attendance, meeting notes, inventory entries, supplier dues, customer feedback, etc. One flexible store.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      type: { type: Type.STRING, description: "Record type: deadline, exam, note, flashcard, attendance, meeting, inventory, supplier, feedback, custom_reminder, task_local, work_session, or any feature-specific type." },
                      title: { type: Type.STRING, description: "Short title, e.g. 'Physics Assignment 3' or 'Restock cement bags'." },
                      payload: { type: Type.OBJECT, description: "Free-form details: subject, marks, quantity, price, supplier, items, member, status, etc." },
                      due: { type: Type.STRING, description: "Optional due date/time in ISO format, e.g. '2026-10-05' or '2026-10-05T17:00:00'." },
                      tags: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Optional tags, e.g. ['physics', 'assignment']." }
                    },
                    required: ["type", "title"]
                  }
                },
                {
                  name: "getUserRecords",
                  description: "Query the user's saved records: 'show my deadlines', 'what flashcards do I have', 'summarise my inventory entries', 'list meeting notes', etc.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      type: { type: Type.STRING, description: "Filter by record type (deadline, exam, note, flashcard, attendance, meeting, inventory, supplier, feedback, ...)." },
                      tag: { type: Type.STRING, description: "Filter by tag." },
                      search: { type: Type.STRING, description: "Free-text search over titles and payload details." },
                      due_before: { type: Type.STRING, description: "Only records due on/before this ISO date." },
                      due_after: { type: Type.STRING, description: "Only records due on/after this ISO date." },
                      limit: { type: Type.INTEGER, description: "Max records to return (default 50)." }
                    }
                  }
                },
                {
                  name: "updateUserRecord",
                  description: "Update an existing record (e.g. mark assignment submitted, update stock quantity, reschedule a meeting note). Get the id from getUserRecords first.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING, description: "Record id from getUserRecords." },
                      title: { type: Type.STRING, description: "New title." },
                      payload: { type: Type.OBJECT, description: "New payload details (replaces existing)." },
                      due: { type: Type.STRING, description: "New due date in ISO format." },
                      tags: { type: Type.ARRAY, items: { type: Type.STRING }, description: "New tags (replaces existing)." }
                    },
                    required: ["id"]
                  }
                },
                {
                  name: "deleteUserRecord",
                  description: "Delete a record by id (e.g. 'remove that deadline', 'delete this flashcard'). Get the id from getUserRecords first.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING, description: "Record id from getUserRecords." }
                    },
                    required: ["id"]
                  }
                },
                // ── V4: Study/focus tools (Python agent) ──
                {
                  name: "startPomodoro",
                  description: "Start a Pomodoro study/work timer: focus sessions with short breaks. Announce session start/break/end. Use for 'make a study plan', 'start a 25-minute focus session', 'pomodoro chalu karo'.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      work_minutes: { type: Type.INTEGER, description: "Focus session length in minutes (default 25)." },
                      break_minutes: { type: Type.INTEGER, description: "Break length in minutes (default 5)." },
                      cycles: { type: Type.INTEGER, description: "Number of work/break cycles (default 4)." },
                      label: { type: Type.STRING, description: "What you're working on, e.g. 'Physics revision'." }
                    }
                  }
                },
                {
                  name: "startFocusMode",
                  description: "Start FOCUS MODE: blocks distracting apps/websites for N minutes (best-effort on the host OS). Announce clearly before enabling.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      minutes: { type: Type.INTEGER, description: "Duration of focus mode in minutes (default 25)." },
                      block_websites: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Websites to block, e.g. ['youtube.com', 'instagram.com']." },
                      block_apps: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Process names to kill, e.g. ['steam.exe', 'vlc']." }
                    }
                  }
                },
                {
                  name: "stopFocusMode",
                  description: "End focus mode early and restore access to blocked apps/websites.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "getFocusStatus",
                  description: "Check whether focus mode / pomodoro is currently active and time remaining.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "extractDocumentText",
                  description: "Extract readable text from PDFs, DOCX, images (OCR), or plain text files. Use for 'summarise this PDF', 'key points from notes.pdf', 'read this bill'.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      path: { type: Type.STRING, description: "Path to the PDF/DOCX/image/text file." },
                      max_chars: { type: Type.INTEGER, description: "Max characters to return (default 6000)." },
                      ocr: { type: Type.BOOLEAN, description: "Force OCR on images/scanned PDFs (default auto)." }
                    },
                    required: ["path"]
                  }
                },
                // ── V4: Spreadsheet tools (Python agent) ──
                {
                  name: "writeSpreadsheet",
                  description: "Create a new CSV/XLSX spreadsheet with headers and rows of data. Use for inventory sheets, feedback logs, supplier ledgers, marks tables.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      path: { type: Type.STRING, description: "File path for the sheet, e.g. 'Documents/Business/inventory.xlsx'." },
                      sheet_name: { type: Type.STRING, description: "Sheet/tab name (XLSX only, default 'Sheet1')." },
                      headers: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Column headers, e.g. ['Date','Item','Qty','Price']." },
                      rows: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: {}, description: "Row values array." }, description: "Array of rows; each row is an array of cell values." },
                      overwrite: { type: Type.BOOLEAN, description: "Replace file if it exists (default false — appends headers only when creating)." }
                    },
                    required: ["path", "headers", "rows"]
                  }
                },
                {
                  name: "appendSpreadsheetRows",
                  description: "Append rows to an existing CSV/XLSX sheet (creates it with headers if missing). Use for logging inventory/feedback/payment entries over time.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      path: { type: Type.STRING, description: "Spreadsheet file path." },
                      sheet_name: { type: Type.STRING, description: "Sheet/tab name (XLSX only)." },
                      headers: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Headers used when creating the file fresh." },
                      rows: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: {}, description: "Row values array." }, description: "Rows to append; each row is an array of cell values." }
                    },
                    required: ["path", "headers", "rows"]
                  }
                },
                {
                  name: "readSpreadsheet",
                  description: "Read rows from a CSV/XLSX spreadsheet. Use to review inventory, feedback, marks, ledgers.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      path: { type: Type.STRING, description: "Spreadsheet file path." },
                      sheet_name: { type: Type.STRING, description: "Sheet/tab name (XLSX only, default first sheet)." },
                      max_rows: { type: Type.INTEGER, description: "Max rows to return (default 100)." },
                      max_cols: { type: Type.INTEGER, description: "Max columns (default 20)." }
                    },
                    required: ["path"]
                  }
                },
                {
                  name: "summarizeSpreadsheet",
                  description: "Summarise a CSV/XLSX sheet: row/col counts, numeric column stats (sum/avg/min/max), and a preview. Use for 'how much stock did I add this week', 'summarise my sales'.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      path: { type: Type.STRING, description: "Spreadsheet file path." },
                      sheet_name: { type: Type.STRING, description: "Sheet/tab name (XLSX only, default first sheet)." },
                      group_by: { type: Type.STRING, description: "Optional column name to group numeric sums by (e.g. 'Item')." },
                      value_column: { type: Type.STRING, description: "Numeric column to aggregate (e.g. 'Total' or 'Qty')." }
                    },
                    required: ["path"]
                  }
                },
                {
                  name: "logInventoryEntry",
                  description: "Log ONE inventory/stock entry: appends to the business inventory spreadsheet AND saves a searchable record. Use when the user dictates stock arrivals from WhatsApp: '50 bags cement at 350 each from Sharma Traders'.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      item: { type: Type.STRING, description: "Item name, e.g. 'Cement bags'." },
                      quantity: { type: Type.NUMBER, description: "Quantity received/sold." },
                      unit_price: { type: Type.NUMBER, description: "Price per unit." },
                      supplier: { type: Type.STRING, description: "Supplier or source name." },
                      direction: { type: Type.STRING, description: "'in' (stock received) or 'out' (sold/used). Default 'in'." },
                      notes: { type: Type.STRING, description: "Extra details." },
                      date: { type: Type.STRING, description: "Entry date (ISO). Defaults to today." }
                    },
                    required: ["item", "quantity"]
                  }
                }
];

/**
 * Apply role/feature gating (allowedTools) and capability gating (agentOnline)
 * to the full declaration set.
 *
 * - allowedTools: Set of tool names permitted by the user's profile, or null
 *   when no profile exists yet (no role gating).
 * - agentOnline: whether the local Python desktop agent is reachable. When
 *   false, desktop-only tools are withheld so Gemini cannot call tools that
 *   have no implementation in this deployment.
 */
export function buildFunctionDeclarations(opts: {
  allowedTools: Set<string> | null;
  agentOnline: boolean;
}): FunctionDeclaration[] {
  const { allowedTools, agentOnline } = opts;
  return ALL_TOOL_DECLARATIONS.filter((d) => {
    // V4 feature gating: offer only tools allowed by the user's
    // role + selected feature modules (null = no profile yet).
    if (allowedTools && !allowedTools.has(d.name!)) {
      console.log(`[Profile] Gating out tool: ${d.name}`);
      return false;
    }
    // Capability gating: without the desktop agent, hide declarations whose
    // implementation only exists on the user's machine. Server-native tools
    // listed in SERVER_TOOLS keep being offered, so weather/news keep working.
    if (!agentOnline && DESKTOP_TOOLS.has(d.name!) && !SERVER_TOOLS.has(d.name!)) {
      return false;
    }
    return true;
  });
}

export { DESKTOP_TOOLS, SERVER_TOOLS };
