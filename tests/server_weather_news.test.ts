import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as serverWeatherNews from "../src/server/services/server_weather_news";

describe("server_weather_news", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getWeatherServer", () => {
    it("should be a function", () => {
      expect(typeof serverWeatherNews.getWeatherServer).toBe("function");
    });

    it("should have correct interface", () => {
      const output: serverWeatherNews.WeatherOutput = {
        result: "Test",
        location: "Mumbai",
        temperature: "25",
        description: "Sunny",
        humidity: "60",
        wind_speed: "10"
      };
      
      expect(output.result).toBe("Test");
    });
  });

  describe("getNewsServer", () => {
    it("should be a function", () => {
      expect(typeof serverWeatherNews.getNewsServer).toBe("function");
    });

    it("should have correct interface", () => {
      const output: serverWeatherNews.NewsOutput = {
        result: "Test",
        headlines: [{ title: "Test", link: "http://test.com" }],
        category: "top",
        count: 1
      };
      
      expect(output.count).toBe(1);
    });
  });
});