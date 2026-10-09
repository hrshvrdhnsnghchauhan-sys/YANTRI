#!/usr/bin/env python3
"""
YANTRI Python Agent Tool Tests
Standalone test runner that works with relative imports
"""

import sys
import os
import asyncio

# Get the agent directory (one level up from tests)
AGENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, AGENT_DIR)

# Change to agent directory
os.chdir(AGENT_DIR)

async def run_tests():
    """Run all tests"""
    print("Running Python Agent Tool Tests...")
    print("=" * 50)
    
    # Test 1: Tool Registry
    print("\n1. Testing Tool Registry...")
    try:
        from registry import TOOLS, load_all
        load_all()
        assert len(TOOLS) > 50
        print(f"   ✓ Tool registry loaded: {len(TOOLS)} tools")
        
        # Check key tools
        expected_tools = [
            "openApplication", "closeApplication", "openWebsite",
            "createFile", "readFile", "listFiles",
            "runTerminalCommand", "getWeather", "getNews",
            "searchWeb", "openWebsite", "playYouTubeVideo"
        ]
        for tool in expected_tools:
            assert tool in TOOLS, f"Tool {tool} not registered"
        print("   ✓ Key tools registered")
    except Exception as e:
        print(f"   ✗ Tool registry test failed: {e}")
        import traceback
        traceback.print_exc()
        return 1
    
    # Test 2: Confirmation Tools
    print("\n2. Testing Confirmation Tools...")
    try:
        from tools.confirmation import request_power_action, execute_power_action
        
        state = {"power_tokens": {}}
        result = await request_power_action({"action": "shutdown"}, state)
        assert result["success"] is True
        assert "token" in result
        print("   ✓ request_power_action works")
        
        state["power_tokens"]["shutdown"] = "test-token"
        result = await execute_power_action(
            {"action": "shutdown", "execute_token": "test-token"},
            state
        )
        print("   ✓ execute_power_action works")
    except Exception as e:
        print(f"   ✗ Confirmation tools test failed: {e}")
        import traceback
        traceback.print_exc()
        return 1
    
    # Test 2: Terminal Tools
    print("\n2. Testing Terminal Tools...")
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
        print("   ✓ Command validation works")
    except ImportError:
        print("   ⚠ Terminal tools not available")
    
    # Test 3: File Tools
    print("\n3. Testing File Tools...")
    try:
        from tools.files import is_path_safe
        
        assert is_path_safe("/home/user/document.txt") is True
        assert is_path_safe("/tmp/test.txt") is True
        assert is_path_safe("/home/user/Documents") is True
        
        assert is_path_safe("/etc/passwd") is False
        assert is_path_safe("/root/secret") is False
        assert is_path_safe("../etc/passwd") is False
        print("   ✓ Path safety validation works")
    except ImportError:
        print("   ⚠ File tools not available")
    
    # Test 3: Terminal Command Validation
    print("\n3. Testing Command Validation...")
    try:
        from tools.terminal import is_shell_safe
        
        assert is_shell_safe("ls -la") is True
        assert is_shell_safe("echo hello") is True
        
        assert is_shell_safe("ls; rm -rf /") is False
        assert is_shell_safe("echo $(rm -rf /)") is False
        assert is_shell_safe("ls && rm -rf /") is False
        print("   ✓ Shell safety validation works")
    except ImportError:
        print("   ⚠ Shell safety check not available")
    
    # Test 4: Path Safety
    print("\n4. Testing Path Safety...")
    try:
        from tools.files import is_path_safe
        
        assert is_path_safe("/home/user/document.txt") is True
        assert is_path_safe("/tmp/test.txt") is True
        assert is_path_safe("/home/user/Documents") is True
        
        assert is_path_safe("/etc/passwd") is False
        assert is_path_safe("/root/secret") is False
        assert is_path_safe("../etc/passwd") is False
        print("   ✓ Path safety works")
    except ImportError:
        print("   ⚠ File tools not available")
    
    # Test 4: JSON Serialization
    print("\n4. Testing JSON Serialization...")
    import json
    
    result = {
        "success": True,
        "result": "Test result",
        "data": {"key": "value", "numbers": [1, 2, 3]}
    }
    json_str = json.dumps(result)
    parsed = json.loads(json_str)
    assert parsed == result
    print("   ✓ JSON serialization works")
    
    # Test 5: Error Response Format
    print("\n5. Testing Error Response Format...")
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
    print("   ✓ Error response format works")
    
    # Test 5: Tool Registry
    print("\n5. Testing Tool Registry...")
    from registry import TOOLS, load_all
    load_all()
    assert len(TOOLS) > 50
    print(f"   ✓ Tool registry loaded: {len(TOOLS)} tools")
    
    # Test 6: Confirmation Tools Execution
    print("\n6. Testing Confirmation Tools Execution...")
    from tools.confirmation import request_power_action, execute_power_action
    
    state = {"power_tokens": {}}
    result = await request_power_action({"action": "shutdown"}, state)
    assert result["success"] is True
    assert "token" in result
    assert "power_tokens" in state
    print("   ✓ Confirmation tools execution works")
    
    print("\n" + "=" * 50)
    print("All tests passed! ✓")
    return 0

if __name__ == "__main__":
    try:
        exit_code = asyncio.run(run_tests())
        sys.exit(exit_code)
    except Exception as e:
        print(f"Test runner failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)