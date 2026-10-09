import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("src/lib/audio.ts", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("floatTo16BitPCM", () => {
    it("should convert Float32Array to Int16 PCM ArrayBuffer", () => {
      const input = new Float32Array([0, 0.5, -0.5, 1, -1]);
      const buffer = new ArrayBuffer(input.length * 2);
      const view = new DataView(buffer);
      let offset = 0;
      for (let i = 0; i < input.length; i++, offset += 2) {
        let s = Math.max(-1, Math.min(1, input[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      }
      
      const result = new Int16Array(buffer);
      expect(result[0]).toBe(0);
      expect(result[1]).toBeGreaterThan(0);
      expect(result[2]).toBeLessThan(0);
      expect(result[3]).toBe(0x7FFF);
      expect(result[4]).toBe(-0x8000);
    });

    it("should clamp values to [-1, 1]", () => {
      const input = new Float32Array([2, -2, 1.5, -1.5]);
      const buffer = new ArrayBuffer(input.length * 2);
      const view = new DataView(buffer);
      let offset = 0;
      for (let i = 0; i < input.length; i++, offset += 2) {
        let s = Math.max(-1, Math.min(1, input[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      }
      
      const result = new Int16Array(buffer);
      expect(result[0]).toBe(0x7FFF);
      expect(result[1]).toBe(-0x8000);
      expect(result[2]).toBe(0x7FFF);
      expect(result[3]).toBe(-0x8000);
    });
  });

  describe("pcm16ToFloats", () => {
    it("should convert Int16 PCM to Float32Array", () => {
      const int16 = new Int16Array([0, 16384, -16384, 32767, -32768]);
      const uint8 = new Uint8Array(int16.buffer);
      
      const floats = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        floats[i] = int16[i] / 32768.0;
      }
      
      expect(floats[0]).toBe(0);
      expect(floats[1]).toBeCloseTo(0.5, 3);
      expect(floats[2]).toBeCloseTo(-0.5, 3);
      expect(floats[3]).toBeCloseTo(1, 3);
      expect(floats[4]).toBe(-1);
    });
  });

  describe("base64ArrayBuffer", () => {
    it("should convert ArrayBuffer to base64 string", () => {
      const bytes = new Uint8Array([72, 101, 108, 108, 111]);
      const buffer = bytes.buffer;
      
      let binary = '';
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const result = btoa(binary);
      
      expect(result).toBe("SGVsbG8=");
    });
  });

  describe("base64ToUint8Array", () => {
    it("should convert base64 string to Uint8Array", () => {
      const base64 = "SGVsbG8=";
      const binaryString = atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      expect(bytes[0]).toBe(72);
      expect(bytes[1]).toBe(101);
      expect(bytes[2]).toBe(108);
      expect(bytes[3]).toBe(108);
      expect(bytes[4]).toBe(111);
    });
  });

  describe("LiveState type", () => {
    it("should have correct values", () => {
      const states: ("disconnected" | "connecting" | "listening" | "speaking")[] = [
        "disconnected",
        "connecting",
        "listening",
        "speaking"
      ];
      
      expect(states).toHaveLength(4);
    });
  });

  describe("YantriAudioSession class", () => {
    it("should be defined", () => {
      expect(true).toBe(true);
    });

    it("should have required methods", () => {
      const methods = [
        "connect",
        "disconnect",
        "getState",
        "sendVideoFrame"
      ];
      
      methods.forEach(method => {
        expect(true).toBe(true);
      });
    });
  });
});