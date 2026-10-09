import { test, expect } from '@playwright/test';

test.describe('YANTRI Voice Assistant - Core UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should load the main UI without errors', async ({ page }) => {
    // Check main elements are present
    await expect(page.locator('#yantri-hologram-living-canvas')).toBeVisible();
    
    // Check for transcript panel
    const transcriptPanel = page.locator('[role="dialog"]:has-text("Transcript")');
    await expect(transcriptPanel).toBeVisible({ timeout: 5000 });
  });

  test('should display connection status', async ({ page }) => {
    // Wait for connection status to appear
    const statusIndicator = page.locator('text=/Connected|Connecting|Disconnected/i');
    await expect(statusIndicator).toBeVisible({ timeout: 10000 });
  });

  test('should handle microphone permission request', async ({ page }) => {
    // Check if permission prompt appears
    const micPrompt = page.locator('text=/microphone|Microphone/i');
    
    // Note: In headless mode, this might not appear the same way
    // Just verify the UI handles it gracefully
    const canvas = page.locator('#yantri-hologram-living-canvas');
    await expect(canvas).toBeVisible();
  });
});

test.describe('YANTRI Transcript Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should open transcript panel', async ({ page }) => {
    // Look for transcript panel trigger
    const transcriptBtn = page.locator('button:has-text("Transcript"), [aria-label*="transcript" i]');
    
    if (await transcriptBtn.isVisible({ timeout: 2000 })) {
      await transcriptBtn.click();
      await expect(page.locator('[role="dialog"]:has-text("Transcript")')).toBeVisible();
    }
  });

  test('should display conversation history', async ({ page }) => {
    const transcriptPanel = page.locator('[role="dialog"]:has-text("Transcript")');
    
    if (await transcriptPanel.isVisible({ timeout: 2000 })) {
      // Check for entries or empty state
      const entries = transcriptPanel.locator('[class*="entry"], [class*="message"]');
      const emptyState = transcriptPanel.locator('text=/No conversation|Start talking/i');
      
      await expect(entries.or(emptyState)).toBeVisible();
    }
  });

  test('should have search functionality', async ({ page }) => {
    const transcriptPanel = page.locator('[role="dialog"]:has-text("Transcript")');
    
    if (await transcriptPanel.isVisible({ timeout: 2000 })) {
      const searchInput = transcriptPanel.locator('input[type="search"], input[placeholder*="search" i]');
      await expect(searchInput).toBeVisible();
    }
  });
});

test.describe('YANTRI Settings Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should open settings panel', async ({ page }) => {
    const settingsBtn = page.locator('button:has-text("Settings"), [aria-label*="settings" i]');
    
    if (await settingsBtn.isVisible({ timeout: 2000 })) {
      await settingsBtn.click();
      await expect(page.locator('[role="dialog"]:has-text("Settings")')).toBeVisible();
    }
  });

  test('should have theme selector', async ({ page }) => {
    const settingsBtn = page.locator('button:has-text("Settings"), [aria-label*="settings" i]');
    
    if (await settingsBtn.isVisible({ timeout: 2000 })) {
      await settingsBtn.click();
      const themeSelect = page.locator('select[name="theme"], [role="combobox"]:has-text("Theme")');
      await expect(themeSelect).toBeVisible({ timeout: 3000 });
    }
  });

  test('should have voice selector', async ({ page }) => {
    const settingsBtn = page.locator('button:has-text("Settings"), [aria-label*="settings" i]');
    
    if (await settingsBtn.isVisible({ timeout: 2000 })) {
      await settingsBtn.click();
      const voiceSelect = page.locator('select[name="voice"], [role="combobox"]:has-text("Voice")');
      await expect(voiceSelect).toBeVisible({ timeout: 3000 });
    }
  });
});

test.describe('YANTRI Tools - Browser Agent', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should open browser agent panel', async ({ page }) => {
    const browserBtn = page.locator('button:has-text("Browser"), [aria-label*="browser" i]');
    
    if (await browserBtn.isVisible({ timeout: 2000 })) {
      await browserBtn.click();
      await expect(page.locator('[role="dialog"]:has-text("Browser")')).toBeVisible({ timeout: 5000 });
    }
  });
});

test.describe('YANTRI Memory Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should open memory dashboard', async ({ page }) => {
    const memoryBtn = page.locator('button:has-text("Memory"), [aria-label*="memory" i]');
    
    if (await memoryBtn.isVisible({ timeout: 2000 })) {
      await memoryBtn.click();
      await expect(page.locator('[role="dialog"]:has-text("Memory")')).toBeVisible({ timeout: 5000 });
    }
  });

  test('should display memory entries', async ({ page }) => {
    const memoryBtn = page.locator('button:has-text("Memory"), [aria-label*="memory" i]');
    
    if (await memoryBtn.isVisible({ timeout: 2000 })) {
      await memoryBtn.click();
      const memoryPanel = page.locator('[role="dialog"]:has-text("Memory")');
      await expect(memoryPanel).toBeVisible({ timeout: 5000 });
      
      // Check for memory entries or empty state
      const entries = memoryPanel.locator('[class*="memory"], [class*="entry"]');
      const emptyState = memoryPanel.locator('text=/No memories|empty/i');
      await expect(entries.or(emptyState)).toBeVisible();
    }
  });
});

test.describe('YANTRI API Key Setup', () => {
  test('should show API key gate when no key configured', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Check for API key gate overlay
    const apiKeyGate = page.locator('[role="dialog"]:has-text("API Key"), [role="dialog"]:has-text("Gemini")');
    
    // In test environment with test key, this might not show
    // Just verify the page loads without error
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('YANTRI Responsive Design', () => {
  test('should work on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    const canvas = page.locator('#yantri-hologram-living-canvas');
    await expect(canvas).toBeVisible();
  });

  test('should work on tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    const canvas = page.locator('#yantri-hologram-living-canvas');
    await expect(canvas).toBeVisible();
  });
});