#!/usr/bin/env python3
"""
Test runner for Python agent tools
Runs tests with proper Python path setup
"""

import sys
import os
import subprocess

# Get the agent directory
AGENT_DIR = os.path.dirname(os.path.abspath(__file__))

def run_tests():
    """Run pytest with proper Python path"""
    
    # Change to agent directory
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    # Set PYTHONPATH to include agent directory
    env = os.environ.copy()
    env['PYTHONPATH'] = os.getcwd() + ':' + env.get('PYTHONPATH', '')
    
    # Run pytest as module from agent directory
    cmd = [
        sys.executable, '-m', 'pytest',
        'tests/',
        '-v',
        '--tb=short',
        '--asyncio-mode=auto'
    ]
    
    result = subprocess.run(cmd, env=env, cwd=os.getcwd())
    return result.returncode


if __name__ == '__main__':
    import sys
    import subprocess
    import os
    
    # Change to agent directory
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    # Set PYTHONPATH
    env = os.environ.copy()
    env['PYTHONPATH'] = os.getcwd() + ':' + env.get('PYTHONPATH', '')
    
    # Run pytest
    result = subprocess.run([
        sys.executable, '-m', 'pytest',
        'tests/',
        '-v',
        '--tb=short',
        '--asyncio-mode=auto'
    ], env=env, cwd=os.getcwd())
    
    sys.exit(result.returncode)