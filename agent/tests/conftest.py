"""
pytest configuration for YANTRI Python agent tests
"""

import sys
import os
import pytest

# Add project root to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

# Configure pytest
pytest_plugins = []

def pytest_configure(config):
    """Configure pytest with custom markers"""
    config.addinivalue_line(
        "markers", "integration: mark test as integration test"
    )
    config.addinivalue_line(
        "markers", "unit: mark test as unit test"
    )
    config.addinivalue_line(
        "markers", "slow: mark test as slow running"
    )

@pytest.fixture(scope="session")
def event_loop():
    """Create event loop for async tests"""
    import asyncio
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def mock_state():
    """Provide a mock state dictionary for tools"""
    return {
        "running_apps": {},
        "allowed_paths": ["/home/user", "/tmp"],
        "allowed_commands": ["ls", "pwd", "echo", "cat"],
        "blocked_commands": ["rm", "sudo", "mkfs", "dd"],
        "browser_mode": "managed",
        "browser_context": None,
        "windows": {},
        "power_tokens": {},
    }


@pytest.fixture
def sample_memory():
    """Sample memory for testing"""
    return {
        "id": "test123",
        "category": "identity",
        "text": "User is a developer",
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-01T00:00:00.000Z",
    }


@pytest.fixture
def sample_reminder():
    """Sample reminder for testing"""
    return {
        "id": "rem123",
        "text": "Test reminder",
        "fireAt": "2024-12-31T23:59:00.000Z",
        "createdAt": "2024-01-01T00:00:00.000Z",
        "fired": False,
    }


@pytest.fixture
def sample_user_record():
    """Sample user record for testing"""
    return {
        "id": "rec123",
        "email": "test@example.com",
        "type": "deadline",
        "title": "Test deadline",
        "payload": {"subject": "Test", "marks": 100},
        "due": "2024-12-31T23:59:00.000Z",
        "tags": ["urgent", "test"],
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-01T00:00:00.000Z",
    }