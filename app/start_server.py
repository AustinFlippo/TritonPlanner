#!/usr/bin/env python3
"""
Startup script for UCSD Course Advisory API
===========================================

This script starts the FastAPI server with proper error handling
and environment validation.
"""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Load the .env file from the current directory
load_dotenv()

def check_environment():
    """Check if required environment variables are set."""
    required_vars = ["OPENAI_API_KEY", "PINECONE_API_KEY"]
    missing_vars = []
    
    for var in required_vars:
        if not os.getenv(var):
            missing_vars.append(var)
    
    if missing_vars:
        return False
    
    return True

def check_dependencies():
    """Check if required packages are installed."""
    try:
        import fastapi
        import uvicorn
        import langchain_openai
        import pinecone
        return True
    except ImportError as e:
        return False

def main():
    """Start the FastAPI server."""
    
    # Check environment
    if not check_environment():
        sys.exit(1)
    
    # Check dependencies
    if not check_dependencies():
        sys.exit(1)
    
    # Import and start server
    try:
        import uvicorn
        
        uvicorn.run(
            "main:app",
            host="0.0.0.0",
            port=8000,
            reload=True,
            log_level="info"
        )
    except KeyboardInterrupt:
        pass
    except Exception:
        sys.exit(1)

if __name__ == "__main__":
    main()