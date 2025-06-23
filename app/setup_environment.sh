#!/bin/bash

# Setup script for UCSD Course Advisory API
# This creates a virtual environment and installs all dependencies

echo "🚀 Setting up UCSD Course Advisory API environment..."
echo "=" * 60

# Change to the app directory
cd "$(dirname "$0")"
APP_DIR=$(pwd)
echo "📁 Working in directory: $APP_DIR"

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
    echo "✅ Virtual environment created"
else
    echo "✅ Virtual environment already exists"
fi

# Activate virtual environment
echo "🔌 Activating virtual environment..."
source venv/bin/activate

# Upgrade pip
echo "⬆️ Upgrading pip..."
pip install --upgrade pip

# Install requirements
echo "📚 Installing Python dependencies..."
pip install -r requirements.txt

# Verify installation
echo "🔍 Verifying installation..."
python -c "import fastapi; print('✅ FastAPI installed successfully')" || echo "❌ FastAPI installation failed"
python -c "import uvicorn; print('✅ Uvicorn installed successfully')" || echo "❌ Uvicorn installation failed"
python -c "import langchain_openai; print('✅ LangChain OpenAI installed successfully')" || echo "❌ LangChain OpenAI installation failed"
python -c "import pinecone; print('✅ Pinecone installed successfully')" || echo "❌ Pinecone installation failed"

echo ""
echo "🎉 Setup complete!"
echo ""
echo "To activate the environment in the future, run:"
echo "    cd $APP_DIR"
echo "    source venv/bin/activate"
echo ""
echo "To start the server:"
echo "    python start_server.py"
echo ""
echo "To deactivate the environment:"
echo "    deactivate"