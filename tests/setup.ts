import { beforeAll, afterAll, vi } from "vitest";
import { TextEncoder, TextDecoder } from "util";

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

Object.defineProperty(global, "window", {
  value: {
    btoa: (str: string) => Buffer.from(str, "binary").toString("base64"),
    atob: (str: string) => Buffer.from(str, "base64").toString("binary"),
    localStorage: {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    },
    AudioContext: vi.fn().mockImplementation(() => ({
      createGain: vi.fn().mockReturnValue({
        connect: vi.fn(),
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }
      }),
      createAnalyser: vi.fn().mockReturnValue({ connect: vi.fn() }),
      createBuffer: vi.fn().mockReturnValue({ getChannelData: vi.fn() }),
      createBufferSource: vi.fn().mockReturnValue({
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null
      }),
      createOscillator: vi.fn().mockReturnValue({
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        frequency: { value: 0 },
        type: "sine"
      }),
      createScriptProcessor: vi.fn().mockReturnValue({
        connect: vi.fn(),
        onaudioprocess: null
      }),
      createMediaStreamSource: vi.fn().mockReturnValue({ connect: vi.fn() }),
      destination: {},
      currentTime: 0,
      state: "running",
      resume: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    })),
    webkitAudioContext: vi.fn(),
    SpeechRecognition: vi.fn().mockImplementation(() => ({
      continuous: true,
      interimResults: true,
      lang: "en-US",
      maxAlternatives: 3,
      start: vi.fn(),
      stop: vi.fn(),
      abort: vi.fn(),
      onresult: null,
      onerror: null,
      onend: null,
      onstart: null,
    })),
    webkitSpeechRecognition: vi.fn(),
    navigator: {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue({
          getAudioTracks: () => [{ enabled: true, stop: vi.fn() }]
        })
      }
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  },
  writable: true
});

Object.defineProperty(global, "fetch", {
  value: vi.fn(),
  writable: true
});

process.env.GEMINI_API_KEY = "test-api-key";
process.env.CLOUD_MODE = "false";
process.env.YANTRI_DATA_DIR = "/tmp/yantri-test";

beforeAll(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(() => {
  vi.restoreAllMocks();
});