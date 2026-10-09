"""
YANTRI Browser Context Pool
Manages a pool of Playwright browser contexts for efficient reuse.
"""

import asyncio
import logging
from typing import Optional
from playwright.async_api import Browser, BrowserContext, Page, async_playwright

log = logging.getLogger("yantri.browser_pool")


class BrowserContextPool:
    """
    Pool of reusable browser contexts to avoid overhead of creating/destroying
    contexts for each tool call. Maintains a pool of ready-to-use contexts.
    """
    
    def __init__(
        self,
        browser: Browser,
        max_contexts: int = 5,
        context_args: Optional[dict] = None,
    ):
        self.browser = browser
        self.max_contexts = max_contexts
        self.context_args = context_args or {}
        self._available: asyncio.Queue[BrowserContext] = asyncio.Queue(maxsize=max_contexts)
        self._in_use: set[BrowserContext] = set()
        self._lock = asyncio.Lock()
        self._initialized = False
    
    async def initialize(self) -> None:
        """Pre-create initial contexts."""
        async with self._lock:
            if self._initialized:
                return
            
            for _ in range(min(2, self.max_contexts)):  # Start with 2 contexts
                try:
                    context = await self.browser.new_context(**self.context_args)
                    await self._available.put(context)
                except Exception as e:
                    log.error(f"Failed to create initial browser context: {e}")
            
            self._initialized = True
            log.info(f"Browser context pool initialized with {self._available.qsize()} contexts")
    
    async def acquire(self) -> BrowserContext:
        """Acquire a context from the pool, creating one if needed."""
        await self.initialize()
        
        try:
            # Try to get an available context (non-blocking)
            context = self._available.get_nowait()
        except asyncio.QueueEmpty:
            # Pool exhausted, create new context if under limit
            async with self._lock:
                if len(self._in_use) < self.max_contexts:
                    context = await self.browser.new_context(**self.context_args)
                else:
                    # Wait for a context to become available
                    context = await self._available.get()
        
        self._in_use.add(context)
        return context
    
    async def release(self, context: BrowserContext) -> None:
        """Return a context to the pool."""
        if context in self._in_use:
            self._in_use.remove(context)
            
            # Clean up pages
            for page in context.pages:
                try:
                    await page.close()
                except Exception:
                    pass
            
            # Return to pool if not at capacity
            if self._available.qsize() < self.max_contexts:
                try:
                    self._available.put_nowait(context)
                except asyncio.QueueFull:
                    await context.close()
            else:
                await context.close()
    
    async def close_all(self) -> None:
        """Close all contexts in the pool."""
        # Close available contexts
        while not self._available.empty():
            try:
                context = self._available.get_nowait()
                await context.close()
            except asyncio.QueueEmpty:
                break
        
        # Close in-use contexts
        for context in list(self._in_use):
            try:
                await context.close()
            except Exception:
                pass
        
        self._in_use.clear()
        log.info("Browser context pool closed")


class BrowserManager:
    """
    High-level browser manager that handles browser lifecycle and context pooling.
    """
    
    def __init__(
        self,
        headless: bool = True,
        max_contexts: int = 5,
        context_args: Optional[dict] = None,
    ):
        self.headless = headless
        self.max_contexts = max_contexts
        self.context_args = context_args or {
            "viewport": {"width": 1280, "height": 720},
            "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        }
        self._playwright = None
        self._browser: Optional[Browser] = None
        self._pool: Optional[BrowserContextPool] = None
        self._lock = asyncio.Lock()
    
    async def start(self) -> None:
        """Start the browser and initialize the pool."""
        async with self._lock:
            if self._browser is not None:
                return
            
            self._playwright = await async_playwright().start()
            self._browser = await self._playwright.chromium.launch(
                headless=self.headless,
                args=[
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--disable-extensions",
                    "--no-first-run",
                    "--disable-default-apps",
                ],
            )
            
            self._pool = BrowserContextPool(
                browser=self._browser,
                max_contexts=self.max_contexts,
                context_args=self.context_args,
            )
            await self._pool.initialize()
            log.info("Browser manager started")
    
    async def get_context(self) -> BrowserContext:
        """Get a browser context from the pool."""
        if self._pool is None:
            await self.start()
        return await self._pool.acquire()
    
    async def release_context(self, context: BrowserContext) -> None:
        """Release a context back to the pool."""
        if self._pool:
            await self._pool.release(context)
    
    async def new_page(self) -> Page:
        """Create a new page using a pooled context."""
        context = await self.get_context()
        try:
            page = await context.new_page()
            return page
        except Exception:
            await self.release_context(context)
            raise
    
    async def close(self) -> None:
        """Close the browser and all contexts."""
        async with self._lock:
            if self._pool:
                await self._pool.close_all()
                self._pool = None
            
            if self._browser:
                try:
                    await self._browser.close()
                except Exception:
                    pass
                self._browser = None
            
            if self._playwright:
                try:
                    await self._playwright.stop()
                except Exception:
                    pass
                self._playwright = None
            
            log.info("Browser manager stopped")


# Global browser manager instance
_browser_manager: Optional[BrowserManager] = None
_browser_manager_lock = asyncio.Lock()


async def get_browser_manager(
    headless: bool = True,
    max_contexts: int = 5,
) -> BrowserManager:
    """Get or create the global browser manager."""
    global _browser_manager
    async with _browser_manager_lock:
        if _browser_manager is None:
            _browser_manager = BrowserManager(
                headless=headless,
                max_contexts=max_contexts,
            )
            await _browser_manager.start()
        return _browser_manager


async def shutdown_browser() -> None:
    """Shutdown the global browser manager."""
    global _browser_manager
    async with _browser_manager_lock:
        if _browser_manager:
            await _browser_manager.close()
            _browser_manager = None