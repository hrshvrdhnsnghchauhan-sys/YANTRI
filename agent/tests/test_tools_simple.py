"""
YANTRI Python Agent Tool Tests
Simple unit tests that work with the existing structure
"""

import sys
import os
import pytest
import asyncio

# Add the agent directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

# Import after path is set
from registry import TOOLS, load_all, ToolError, register
from tools.confirmation import request_power_action


class TestToolRegistry:
    """Tests for the tool registry system"""
    
    def test_tool_registration(self):
        """Test that tools are properly registered"""
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
    
    def test_tool_execution_flow(self):
        """Test that we can look up and call a tool"""
        load_all()
        
        # Test that we can look up and call a tool
        tool_name = "requestPowerAction"
        assert tool_name in TOOLS
        
        tool_func = TOOLS[tool_name]
        assert callable(tool_func)


class TestConfirmationTools:
    """Tests for confirmation/power tools"""
    
    @pytest.mark.asyncio
    async def test_request_power_action(self):
        """Test requesting a power action token"""
        state = {"power_tokens": {}}
        
        # Import the actual function
        from tools.confirmation import request_power_action
        
        result = await request_power_action({"action": "shutdown"}, state)
        
        assert result["success"] is True
        assert "token" in result
        assert "power_tokens" in state
        assert "shutdown" in state["power_tokens"]
    
    @pytest.mark.asyncio
    async def test_execute_power_action(self):
        """Test executing a power action with valid token"""
        state = {"power_tokens": {"shutdown": "test-token-123"}}
        
        from tools.confirmation import execute_power_action
        
        # This will fail because it tries to actually execute, but we can test token validation
        result = await execute_power_action(
            {"action": "shutdown", "execute_token": "test-token-123"}, 
            state
        )
        
        # Token should be consumed
        assert "shutdown" not in state.get("power_tokens", {})


class TestTerminalTools:
    """Tests for terminal/command tools"""
    
    def test_command_validation(self):
        """Test command allow/block logic"""
        # Import the actual function
        try:
            from tools.terminal import is_command_allowed
            
            # Allowed commands
            assert is_command_allowed("ls") is True
            assert is_command_allowed("pwd") is True
            assert is_command_allowed("echo hello") is True
            
            # Blocked commands
            assert is_command_allowed("rm -rf /") is False
            assert is_command_allowed("sudo rm") is False
            assert is_command_allowed("mkfs.ext4") is False
        except ImportError:
            pytest.skip("Terminal tools not available")
    
    def test_command_blacklist(self):
        """Test that dangerous commands are blocked"""
        try:
            from tools.terminal import is_command_allowed
            
            dangerous_commands = [
                "rm -rf /",
                "dd if=/dev/zero of=/dev/sda",
                "mkfs.ext4 /dev/sda1",
                ":(){ :|:& };:",
                "chmod -R 777 /",
                "> /dev/sda",
                "sudo rm -rf /",
            ]
            
            for cmd in dangerous_commands:
                assert is_command_allowed(cmd) is False, f"Command should be blocked: {cmd}"
        except ImportError:
            pytest.skip("Terminal tools not available")


class TestFileTools:
    """Tests for file tools"""
    
    def test_path_safety(self):
        """Test path safety validation"""
        try:
            from tools.files import is_path_safe
            
            # Safe paths
            assert is_path_safe("/home/user/document.txt") is True
            assert is_path_safe("/tmp/test.txt") is True
            assert is_path_safe("/home/user/Documents") is True
            assert is_path_safe("/home/user/Downloads/file.pdf") is True
            
            # Unsafe paths
            assert is_path_safe("/etc/passwd") is False
            assert is_path_safe("/root/secret") is False
            assert is_path_safe("../etc/passwd") is False
            assert is_path_safe("/etc/shadow") is False
            assert is_path_safe("/boot/grub/grub.cfg") is False
        except ImportError:
            pytest.skip("File tools not available")


class TestCommandValidation:
    """Tests for command validation utilities"""
    
    def test_shell_safety(self):
        """Test shell command safety checks"""
        try:
            from tools.terminal import is_shell_safe
            
            # Safe commands
            assert is_shell_safe("ls -la") is True
            assert is_shell_safe("echo hello") is True
            
            # Unsafe commands with shell metacharacters
            assert is_shell_safe("ls; rm -rf /") is False
            assert is_shell_safe("echo $(rm -rf /)") is False
            assert is_shell_safe("ls && rm -rf /") is False
            assert is_shell_safe("ls | rm -rf /") is False
        except ImportError:
            pytest.skip("Terminal tools not available")


class TestUtilities:
    """Tests for utility functions"""
    
    def test_json_serialization(self):
        """Test that tool results are JSON serializable"""
        import json
        
        # Test typical tool result structures
        result = {
            "success": True,
            "result": "Test result",
            "data": {"key": "value", "numbers": [1, 2, 3]}
        }
        
        json_str = json.dumps(result)
        parsed = json.loads(json_str)
        assert parsed == result
    
    def test_error_response_format(self):
        """Test error response format"""
        import json
        
        error_response = {
            "success": False,
            "error": "Something went wrong",
            "tool": "test_tool"
        }
        
        json_str = json.dumps(error_response)
        parsed = json.loads(json_str)
        assert parsed["success"] is False
        assert "error" in parsed


if __name__ == "__main__":
    pytest.main([__file__, "-v"])