#!/usr/bin/env python3
"""
Simple test script to verify the FastAPI server can start
"""

import requests
import time
import subprocess
import sys
import os

def test_server():
    """Test if the server starts and responds to basic requests."""
    
    # Test basic endpoints without starting RAG system
    try:
        
        # Test root endpoint
        response = requests.get("http://localhost:8000", timeout=5)
        if response.status_code == 200:
        else:
            
        # Test health endpoint
        response = requests.get("http://localhost:8000/health", timeout=5)
        if response.status_code == 200:
            health_data = response.json()
        else:
            
        # Test chat endpoint (should fail gracefully without API keys)
        chat_data = {
            "message": "Hello",
            "thread_id": "test-123"
        }
        response = requests.post("http://localhost:8000/chat", json=chat_data, timeout=10)
        if response.status_code == 200:
            chat_response = response.json()
            if "messages" in chat_response:
        else:
            
    except requests.exceptions.ConnectionError:
        return False
    except Exception as e:
        return False
        
    return True

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--help":
        sys.exit(0)
        
    test_server()