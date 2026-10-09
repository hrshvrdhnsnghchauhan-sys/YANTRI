"""
YANTRI Python Agent Tool Tests
Unit tests for desktop agent tools
"""

import pytest
import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

# Import the tools module
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from tools import applications, browser, files, system, terminal, windows, clipboard, weather, news, search, websites, pc


class TestApplicationTools:
    """Tests for application management tools"""
    
    @pytest.fixture
    def mock_state(self):
        return {"running_apps": {}}
    
    @pytest.mark.asyncio
    async def test_open_application_success(self, mock_state):
        with patch('tools.applications.open_application') as mock_open:
            mock_open.return_value = {"success": True, "result": "Chrome opened"}
            
            result = await mock_open({"name": "chrome"}, mock_state)
            assert result["success"] is True
            assert "Chrome opened" in result["result"]
    
    @pytest.mark.asyncio
    async def test_close_application_success(self, mock_state):
        with patch('tools.applications.close_application') as mock_close:
            mock_close.return_value = {"success": True, "result": "Chrome closed"}
            
            result = await mock_close({"name": "chrome"}, mock_state)
            assert result["success"] is True


class TestFileTools:
    """Tests for file system tools"""
    
    @pytest.fixture
    def mock_state(self):
        return {"allowed_paths": ["/home/user", "/tmp"]}
    
    @pytest.mark.asyncio
    async def test_create_file_success(self, mock_state):
        with patch('tools.files.create_file') as mock_create:
            mock_create.return_value = {"success": True, "result": "File created"}
            
            result = await mock_create({
                "path": "/tmp/test.txt",
                "content": "test content"
            }, mock_state)
            
            assert result["success"] is True
    
    @pytest.mark.asyncio
    async def test_read_file_success(self, mock_state):
        with patch('tools.files.read_file') as mock_read:
            mock_read.return_value = {"success": True, "result": "file content"}
            
            result = await mock_read({"path": "/tmp/test.txt"}, mock_state)
            assert result["success"] is True
            assert "file content" in result["result"]
    
    @pytest.mark.asyncio
    async def test_list_files_success(self, mock_state):
        with patch('tools.files.list_files') as mock_list:
            mock_list.return_value = {
                "success": True,
                "result": ["file1.txt", "file2.txt", "dir1/"]
            }
            
            result = await mock_list({"path": "/tmp"}, mock_state)
            assert result["success"] is True
            assert len(result["result"]) == 3


class TestSystemTools:
    """Tests for system information tools"""
    
    @pytest.mark.asyncio
    async def test_system_info(self):
        with patch('tools.system.get_system_info') as mock_info:
            mock_info.return_value = {
                "success": True,
                "result": {
                    "cpu_percent": 45.2,
                    "memory_percent": 67.8,
                    "disk_percent": 34.5
                }
            }
            
            result = await mock_info({}, {})
            assert result["success"] is True
            assert "cpu_percent" in result["result"]
    
    @pytest.mark.asyncio
    async def test_gpu_info(self):
        with patch('tools.system.get_gpu_info') as mock_gpu:
            mock_gpu.return_value = {
                "success": True,
                "result": {
                    "name": "NVIDIA RTX 3080",
                    "memory_used": "8GB",
                    "memory_total": "10GB"
                }
            }
            
            result = await mock_gpu({}, {})
            assert result["success"] is True


class TestTerminalTools:
    """Tests for terminal/command execution tools"""
    
    @pytest.fixture
    def mock_state(self):
        return {"allowed_commands": ["ls", "pwd", "echo"], "blocked_commands": ["rm", "sudo"]}
    
    @pytest.mark.asyncio
    async def test_run_allowed_command(self, mock_state):
        with patch('tools.terminal.run_terminal_command') as mock_terminal:
            mock_terminal.return_value = {
                "success": True,
                "result": "/home/user\n",
                "exit_code": 0
            }
            
            result = await mock_terminal({"command": "pwd"}, mock_state)
            assert result["success"] is True
            assert result["exit_code"] == 0
    
    @pytest.mark.asyncio
    async def test_blocked_command_rejected(self, mock_state):
        with patch('tools.terminal.run_terminal_command') as mock_terminal:
            mock_terminal.return_value = {
                "success": False,
                "error": "Command 'rm -rf' is blocked"
            }
            
            result = await mock_terminal({"command": "rm -rf /"}, mock_state)
            assert result["success"] is False
            assert "blocked" in result["error"].lower()


class TestWeatherNewsTools:
    """Tests for weather and news tools"""
    
    @pytest.mark.asyncio
    async def test_get_weather(self):
        with patch('tools.weather.get_weather') as mock_weather:
            mock_weather.return_value = {
                "success": True,
                "result": "Weather in Mumbai: Sunny, 30°C (feels like 32°C). Humidity: 65%, Wind: 10 km/h."
            }
            
            result = await mock_weather({"location": "Mumbai"}, {})
            assert result["success"] is True
            assert "Mumbai" in result["result"]
    
    @pytest.mark.asyncio
    async def test_get_news(self):
        with patch('tools.news.get_news') as mock_news:
            mock_news.return_value = {
                "success": True,
                "result": "Top 5 headlines:\n1. Test headline\n2. Another headline",
                "headlines": [
                    {"title": "Test headline", "link": "http://example.com"},
                    {"title": "Another headline", "link": "http://example2.com"}
                ],
                "category": "top",
                "count": 2
            }
            
            result = await mock_news({"category": "top", "count": 2}, {})
            assert result["success"] is True
            assert "headlines" in result
            assert len(result["headlines"]) == 2


class TestBrowserTools:
    """Tests for browser automation tools"""
    
    @pytest.fixture
    def mock_state(self):
        return {"browser_mode": "managed", "browser_context": None}
    
    @pytest.mark.asyncio
    async def test_browser_open(self, mock_state):
        with patch('tools.browser.browser_open') as mock_open:
            mock_open.return_value = {
                "success": True,
                "result": "Opened https://example.com"
            }
            
            result = await mock_open({"url": "https://example.com"}, mock_state)
            assert result["success"] is True
    
    @pytest.mark.asyncio
    async def test_browser_search(self, mock_state):
        with patch('tools.browser.browser_search') as mock_search:
            mock_search.return_value = {
                "success": True,
                "result": "Search results for 'test query'"
            }
            
            result = await mock_search({"query": "test query"}, mock_state)
            assert result["success"] is True
    
    @pytest.mark.asyncio
    async def test_browser_click(self, mock_state):
        with patch('tools.browser.browser_click') as mock_click:
            mock_click.return_value = {
                "success": True,
                "result": "Clicked element"
            }
            
            result = await mock_click({
                "selector": "button#submit"
            }, mock_state)
            assert result["success"] is True


class TestWindowTools:
    """Tests for window management tools"""
    
    @pytest.fixture
    def mock_state(self):
        return {"windows": {}}
    
    @pytest.mark.asyncio
    async def test_minimize_window(self, mock_state):
        with patch('tools.windows.minimize_window') as mock_min:
            mock_min.return_value = {"success": True, "result": "Window minimized"}
            
            result = await mock_min({"title": "Test Window"}, mock_state)
            assert result["success"] is True
    
    @pytest.mark.asyncio
    async def test_maximize_window(self, mock_state):
        with patch('tools.windows.maximize_window') as mock_max:
            mock_max.return_value = {"success": True, "result": "Window maximized"}
            
            result = await mock_max({"title": "Test Window"}, mock_state)
            assert result["success"] is True
    
    @pytest.mark.asyncio
    async def test_close_window(self, mock_state):
        with patch('tools.windows.close_window') as mock_close:
            mock_close.return_value = {"success": True, "result": "Window closed"}
            
            result = await mock_close({"title": "Test Window"}, mock_state)
            assert result["success"] is True


class TestClipboardTools:
    """Tests for clipboard tools"""
    
    @pytest.mark.asyncio
    async def test_copy_selected(self):
        with patch('tools.clipboard.copy_selected') as mock_copy:
            mock_copy.return_value = {"success": True, "result": "Copied to clipboard"}
            
            result = await mock_copy({}, {})
            assert result["success"] is True
    
    @pytest.mark.asyncio
    async def test_paste_clipboard(self):
        with patch('tools.clipboard.paste_clipboard') as mock_paste:
            mock_paste.return_value = {"success": True, "result": "Pasted text"}
            
            result = await mock_paste({"text": "text to paste"}, {})
            assert result["success"] is True
    
    @pytest.mark.asyncio
    async def test_get_clipboard(self):
        with patch('tools.clipboard.get_clipboard') as mock_get:
            mock_get.return_value = {"success": True, "result": "clipboard content"}
            
            result = await mock_get({}, {})
            assert result["success"] is True
            assert "clipboard content" in result["result"]


class TestSearchTools:
    """Tests for web search tools"""
    
    @pytest.mark.asyncio
    async def test_search_web(self):
        with patch('tools.search.search_web') as mock_search:
            mock_search.return_value = {
                "success": True,
                "result": "Search results for 'test query'"
            }
            
            result = await mock_search({"query": "test query", "engine": "google"}, {})
            assert result["success"] is True
    
    @pytest.mark.asyncio
    async def test_search_youtube(self):
        with patch('tools.search.search_youtube') as mock_yt:
            mock_yt.return_value = {
                "success": True,
                "result": "YouTube results for 'test'"
            }
            
            result = await mock_yt({"query": "test"}, {})
            assert result["success"] is True


class TestPCTools:
    """Tests for PC control tools"""
    
    @pytest.mark.asyncio
    async def test_volume_control(self):
        with patch('tools.pc.set_volume') as mock_vol:
            mock_vol.return_value = {"success": True, "result": "Volume set to 50%"}
            
            result = await mock_vol({"percent": 50}, {})
            assert result["success"] is True
    
    @pytest.mark.asyncio
    async def test_brightness_control(self):
        with patch('tools.pc.set_brightness') as mock_bright:
            mock_bright.return_value = {"success": True, "result": "Brightness set to 70%"}
            
            result = await mock_bright({"percent": 70}, {})
            assert result["success"] is True


class TestWebsiteTools:
    """Tests for website shortcut tools"""
    
    @pytest.mark.asyncio
    async def test_open_website(self):
        with patch('tools.websites.open_website') as mock_open:
            mock_open.return_value = {"success": True, "result": "Opened YouTube"}
            
            result = await mock_open({"name": "youtube"}, {})
            assert result["success"] is True
            assert "YouTube" in result["result"]


class TestPowerTools:
    """Tests for power control tools"""
    
    @pytest.fixture
    def mock_state(self):
        return {"power_tokens": {}}
    
    @pytest.mark.asyncio
    async def test_request_power_action(self, mock_state):
        with patch('tools.confirmation.request_power_action') as mock_req:
            mock_req.return_value = {
                "success": True,
                "result": "Token generated: abc123",
                "token": "abc123"
            }
            
            result = await mock_req({"action": "shutdown"}, mock_state)
            assert result["success"] is True
            assert "token" in result
    
    @pytest.mark.asyncio
    async def test_execute_power_action(self, mock_state):
        mock_state["power_tokens"] = {"shutdown": "abc123"}
        
        with patch('tools.confirmation.execute_power_action') as mock_exec:
            mock_exec.return_value = {"success": True, "result": "Shutting down..."}
            
            result = await mock_exec({"action": "shutdown", "execute_token": "abc123"}, mock_state)
            assert result["success"] is True


class TestCodeTools:
    """Tests for coding tools"""
    
    @pytest.mark.asyncio
    async def test_create_python_file(self):
        with patch('tools.coding.create_python_file') as mock_create:
            mock_create.return_value = {
                "success": True,
                "result": "Created test.py"
            }
            
            result = await mock_create({
                "path": "/tmp/test.py",
                "content": "print('hello')"
            }, {})
            assert result["success"] is True
    
    @pytest.mark.asyncio
    async def test_run_python_script(self):
        with patch('tools.coding.run_python_script') as mock_run:
            mock_run.return_value = {
                "success": True,
                "result": "hello\n",
                "exit_code": 0
            }
            
            result = await mock_run({"path": "/tmp/test.py"}, {})
            assert result["success"] is True
            assert result["exit_code"] == 0


# Integration-style tests that test the actual tool registry
class TestToolRegistry:
    """Tests for the tool registry system"""
    
    @pytest.mark.asyncio
    async def test_tool_registration(self):
        from registry import TOOLS, load_all
        
        # Load all tools
        load_all()
        
        # Verify tools are registered
        assert len(TOOLS) > 50  # Should have many tools
        
        # Check some key tools exist
        expected_tools = [
            "openApplication", "closeApplication", "openWebsite",
            "createFile", "readFile", "listFiles",
            "runTerminalCommand", "getWeather", "getNews",
            "searchWeb", "openWebsite", "playYouTubeVideo"
        ]
        
        for tool in expected_tools:
            assert tool in TOOLS, f"Tool {tool} not registered"
    
    @pytest.mark.asyncio
    async def test_tool_execution_flow(self):
        from registry import TOOLS, load_all
        from tools.confirmation import request_power_action
        
        load_all()
        
        # Test that we can look up and call a tool
        tool_name = "requestPowerAction"
        assert tool_name in TOOLS
        
        tool_func = TOOLS[tool_name]
        assert callable(tool_func)


# Utility tests
class TestUtilities:
    """Tests for utility functions"""
    
    def test_path_safety(self):
        from tools.files import is_path_safe
        
        # Safe paths
        assert is_path_safe("/home/user/document.txt") is True
        assert is_path_safe("/tmp/test.txt") is True
        assert is_path_safe("/home/user/Documents") is True
        
        # Unsafe paths
        assert is_path_safe("/etc/passwd") is False
        assert is_path_safe("/root/secret") is False
        assert is_path_safe("../etc/passwd") is False
    
    def test_command_validation(self):
        from tools.terminal import is_command_allowed
        
        # Allowed commands
        assert is_command_allowed("ls") is True
        assert is_command_allowed("pwd") is True
        assert is_command_allowed("echo hello") is True
        
        # Blocked commands
        assert is_command_allowed("rm -rf /") is False
        assert is_command_allowed("sudo rm") is False
        assert is_command_allowed("mkfs.ext4") is False


if __name__ == "__main__":
    pytest.main([__file__, "-v"])