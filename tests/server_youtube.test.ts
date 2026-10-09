import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as serverYouTube from "../server_youtube";

describe("server_youtube", () => {
  beforeEach(() => {
    vi.resetModules();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("searchYouTubeVideos", () => {
    it("should be a function", () => {
      expect(typeof serverYouTube.searchYouTubeVideos).toBe("function");
    });

    it("should return empty array for empty query", async () => {
      const result = await serverYouTube.searchYouTubeVideos("");
      expect(result).toEqual([]);
    });

    it("should return empty array for whitespace query", async () => {
      const result = await serverYouTube.searchYouTubeVideos("   ");
      expect(result).toEqual([]);
    });

    it("should have correct return type", () => {
      const result: serverYouTube.YouTubeResult[] = [{
        videoId: "abc123",
        title: "Test Video",
        thumbnail: "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
        author: "Test Channel",
        duration: "3:45",
        views: "1.2M views"
      }];
      
      expect(result[0].videoId).toBe("abc123");
    });
  });

  describe("findFirstYouTubeVideo", () => {
    it("should be a function", () => {
      expect(typeof serverYouTube.findFirstYouTubeVideo).toBe("function");
    });

    it("should return null when no results", async () => {
      vi.spyOn(serverYouTube, "searchYouTubeVideos").mockResolvedValue([]);
      
      const result = await serverYouTube.findFirstYouTubeVideo("test query");
      expect(result).toBeNull();
    });

    it("should return first video id", async () => {
      vi.spyOn(serverYouTube, "searchYouTubeVideos").mockResolvedValue([
        { videoId: "first", title: "First", thumbnail: "", author: "", duration: "", views: "" },
        { videoId: "second", title: "Second", thumbnail: "", author: "", duration: "", views: "" }
      ]);
      
      const result = await serverYouTube.findFirstYouTubeVideo("test query");
      expect(result).toBe("first");
    });
  });

  describe("YouTubeResult interface", () => {
    it("should have all required fields", () => {
      const result: serverYouTube.YouTubeResult = {
        videoId: "test",
        title: "Test",
        thumbnail: "thumb.jpg",
        author: "Author",
        duration: "1:00",
        views: "100"
      };
      
      expect(result.videoId).toBe("test");
      expect(result.title).toBe("Test");
      expect(result.thumbnail).toBe("thumb.jpg");
      expect(result.author).toBe("Author");
      expect(result.duration).toBe("1:00");
      expect(result.views).toBe("100");
    });
  });
});