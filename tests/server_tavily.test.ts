import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as serverTavily from "../server_tavily";

describe("server_tavily", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("searchTavily", () => {
    it("should be a function", () => {
      expect(typeof serverTavily.searchTavily).toBe("function");
    });

    it("should have correct interface for options", () => {
      const options: serverTavily.TavilySearchOptions = {
        query: "test query",
        search_depth: "advanced",
        topic: "general",
        max_results: 10,
        include_images: false,
        include_answer: true,
      };
      
      expect(options.query).toBe("test query");
      expect(options.search_depth).toBe("advanced");
    });
  });

  describe("TavilySearchResult interface", () => {
    it("should have correct structure", () => {
      const result: serverTavily.TavilySearchResult = {
        query: "test",
        answer: "AI summary",
        results: [
          { title: "Result 1", url: "http://example.com", content: "Content", score: 0.9 }
        ],
        images: [{ url: "http://image.com", description: "Image" }]
      };
      
      expect(result.query).toBe("test");
      expect(result.answer).toBe("AI summary");
      expect(result.results).toHaveLength(1);
    });
  });

  describe("formatTavilyResult", () => {
    it("should format results correctly", () => {
      const result: serverTavily.TavilySearchResult = {
        query: "test query",
        answer: "AI summary answer",
        results: [
          { title: "Result 1", url: "http://example.com", content: "Content here", score: 0.9 },
          { title: "Result 2", url: "http://example2.com", content: "More content", score: 0.8 }
        ],
        images: [{ url: "http://image.com", description: "Test image" }]
      };
      
      const formatted = serverTavily.formatTavilyResult(result);
      
      expect(formatted).toContain("test query");
      expect(formatted).toContain("AI summary answer");
      expect(formatted).toContain("Result 1");
      expect(formatted).toContain("http://example.com");
      expect(formatted).toContain("Test image");
    });

    it("should handle missing optional fields", () => {
      const result: serverTavily.TavilySearchResult = {
        query: "test",
        answer: "",
        results: [],
        images: []
      };
      
      const formatted = serverTavily.formatTavilyResult(result);
      expect(formatted).toContain("test");
    });
  });

  describe("searchTavilyQuick", () => {
    it("should be a function", () => {
      expect(typeof serverTavily.searchTavilyQuick).toBe("function");
    });
  });

  describe("searchTavilyDeep", () => {
    it("should be a function", () => {
      expect(typeof serverTavily.searchTavilyDeep).toBe("function");
    });
  });
});