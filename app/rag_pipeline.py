"""
Advanced RAG Pipeline for Course Advisory System
==============================================

This module implements a complete Retrieval-Augmented Generation (RAG) pipeline
for the UCSD course advisory system using Pinecone and OpenAI/Claude.

Author: Claude Assistant
Date: 2025-01-21
"""

import os
import asyncio
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass
from datetime import datetime

# LangChain imports
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_anthropic import ChatAnthropic
from langchain_pinecone import PineconeVectorStore
from langchain.schema import Document
from langchain.prompts import ChatPromptTemplate

# Pinecone imports
from pinecone import Pinecone

# Environment and logging
from dotenv import load_dotenv
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

load_dotenv()


@dataclass
class RAGConfig:
    """Configuration for the RAG pipeline."""
    # Pinecone settings
    pinecone_api_key: str
    pinecone_index_name: str
    embedding_model: str = "text-embedding-3-small"
    
    # LLM settings
    llm_provider: str = "openai"  # "openai" or "anthropic"
    llm_model: str = "gpt-4o-mini-2024-07-18"
    temperature: float = 0.1
    max_tokens: int = 1500
    
    # Retrieval settings
    top_k: int = 5
    similarity_threshold: float = 0.7
    
    # System prompt
    system_prompt: str = """You are an expert academic advisor for UC San Diego specializing in course planning and degree requirements.

Your role is to help students with:
- Course selection and prerequisites
- Degree requirement planning
- Academic scheduling
- Course content and difficulty

Use ONLY the provided context to answer questions. If the context doesn't contain relevant information, clearly state that you don't have that information and suggest how the student might find it.

Be specific, helpful, and concise in your responses. Always cite specific course codes when relevant.

Context Information:
{context}

Student Question: {question}"""


class PineconeRAG:
    """
    Advanced RAG system using Pinecone vector database and LLMs.
    
    This class provides a complete pipeline for:
    1. Query embedding
    2. Similarity search in Pinecone
    3. Context formatting 
    4. LLM response generation
    """
    
    def __init__(self, config: RAGConfig):
        """Initialize the RAG system with configuration."""
        self.config = config
        self.embeddings = None
        self.vector_store = None
        self.llm = None
        self.prompt_template = None
        
        # Initialize components
        self._setup_embeddings()
        self._setup_vector_store()
        self._setup_llm()
        self._setup_prompt()
        
        logger.info("RAG pipeline initialized successfully")
    
    def _setup_embeddings(self):
        """Initialize the embedding model."""
        try:
            self.embeddings = OpenAIEmbeddings(
                model=self.config.embedding_model,
                openai_api_key=os.getenv("OPENAI_API_KEY")
            )
            logger.info(f"Embeddings initialized: {self.config.embedding_model}")
        except Exception as e:
            logger.error(f"Failed to initialize embeddings: {e}")
            raise
    
    def _setup_vector_store(self):
        """Initialize Pinecone vector store."""
        try:
            pc = Pinecone(api_key=self.config.pinecone_api_key)
            index = pc.Index(self.config.pinecone_index_name)
            
            self.vector_store = PineconeVectorStore(
                embedding=self.embeddings,
                index=index
            )
            logger.info(f"Vector store initialized: {self.config.pinecone_index_name}")
        except Exception as e:
            logger.error(f"Failed to initialize vector store: {e}")
            raise
    
    def _setup_llm(self):
        """Initialize the LLM based on provider."""
        try:
            if self.config.llm_provider.lower() == "anthropic":
                self.llm = ChatAnthropic(
                    model=self.config.llm_model,
                    temperature=self.config.temperature,
                    max_tokens=self.config.max_tokens,
                    anthropic_api_key=os.getenv("ANTHROPIC_API_KEY")
                )
                logger.info(f"Anthropic LLM initialized: {self.config.llm_model}")
            else:
                self.llm = ChatOpenAI(
                    model=self.config.llm_model,
                    temperature=self.config.temperature,
                    max_tokens=self.config.max_tokens,
                    openai_api_key=os.getenv("OPENAI_API_KEY")
                )
                logger.info(f"OpenAI LLM initialized: {self.config.llm_model}")
        except Exception as e:
            logger.error(f"Failed to initialize LLM: {e}")
            raise
    
    def _setup_prompt(self):
        """Initialize the prompt template."""
        self.prompt_template = ChatPromptTemplate.from_messages([
            ("system", self.config.system_prompt),
            ("human", "{question}")
        ])
        logger.info("Prompt template initialized")
    
    async def embed_query(self, query: str) -> List[float]:
        """
        Create embedding for the user query.
        
        Args:
            query: User's question/query
            
        Returns:
            List of embedding values
        """
        try:
            embedding = await self.embeddings.aembed_query(query)
            logger.info(f"Query embedded: {len(embedding)} dimensions")
            return embedding
        except Exception as e:
            logger.error(f"Failed to embed query: {e}")
            raise
    
    async def get_relevant_courses(
        self, 
        query: str, 
        k: Optional[int] = None,
        filter_dict: Optional[Dict[str, Any]] = None
    ) -> List[Document]:
        """
        Retrieve relevant course documents from Pinecone.
        
        Args:
            query: User's question
            k: Number of documents to retrieve (defaults to config.top_k)
            filter_dict: Optional metadata filters for Pinecone
            
        Returns:
            List of relevant documents
        """
        try:
            k = k or self.config.top_k
            
            # Perform similarity search
            if filter_dict:
                documents = await self.vector_store.asimilarity_search(
                    query, 
                    k=k,
                    filter=filter_dict
                )
            else:
                documents = await self.vector_store.asimilarity_search(query, k=k)
            
            logger.info(f"Retrieved {len(documents)} relevant documents")
            
            # Log retrieved courses for debugging
            for i, doc in enumerate(documents):
                course_id = doc.metadata.get('course_id', 'Unknown')
                logger.info(f"Retrieved doc {i+1}: {course_id}")
            
            return documents
            
        except Exception as e:
            logger.error(f"Failed to retrieve documents: {e}")
            return []
    
    def format_context(self, documents: List[Document]) -> str:
        """
        Format retrieved documents into context for the LLM.
        
        Args:
            documents: List of retrieved documents
            
        Returns:
            Formatted context string
        """
        if not documents:
            return "No relevant course information found."
        
        context_parts = []
        for i, doc in enumerate(documents, 1):
            # Extract metadata
            course_id = doc.metadata.get('course_id', 'Unknown Course')
            course_name = doc.metadata.get('course_name', '')
            credits = doc.metadata.get('credits', '')
            prerequisites = doc.metadata.get('prerequisites', '')
            
            # Format document
            doc_context = f"Document {i} - {course_id}"
            if course_name:
                doc_context += f": {course_name}"
            if credits:
                doc_context += f" ({credits} credits)"
            
            doc_context += f"\nContent: {doc.page_content}"
            
            if prerequisites:
                doc_context += f"\nPrerequisites: {prerequisites}"
            
            context_parts.append(doc_context)
        
        return "\n\n" + "="*50 + "\n\n".join(context_parts)
    
    async def generate_answer(
        self, 
        query: str, 
        context: str
    ) -> str:
        """
        Generate answer using LLM with the retrieved context.
        
        Args:
            query: Original user question
            context: Formatted context from retrieved documents
            
        Returns:
            Generated answer
        """
        try:
            # Format prompt
            messages = self.prompt_template.format_messages(
                context=context,
                question=query
            )
            
            # Generate response
            response = await self.llm.ainvoke(messages)
            
            logger.info(f"Answer generated: {len(response.content)} characters")
            return response.content
            
        except Exception as e:
            logger.error(f"Failed to generate answer: {e}")
            return f"Sorry, I encountered an error while generating the response: {str(e)}"
    
    async def query(
        self, 
        user_query: str,
        filters: Optional[Dict[str, Any]] = None,
        top_k: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Complete RAG pipeline: retrieve relevant documents and generate answer.
        
        Args:
            user_query: User's question
            filters: Optional Pinecone filters
            top_k: Number of documents to retrieve
            
        Returns:
            Dictionary with answer, context, and metadata
        """
        start_time = datetime.now()
        
        try:
            logger.info(f"Processing query: {user_query}")
            
            # Step 1: Retrieve relevant documents
            documents = await self.get_relevant_courses(
                user_query, 
                k=top_k,
                filter_dict=filters
            )
            
            if not documents:
                return {
                    "answer": "I couldn't find relevant course information for your question. Please try rephrasing or asking about specific UCSD courses, degree requirements, or academic planning.",
                    "context": "",
                    "sources": [],
                    "processing_time": (datetime.now() - start_time).total_seconds()
                }
            
            # Step 2: Format context
            context = self.format_context(documents)
            
            # Step 3: Generate answer
            answer = await self.generate_answer(user_query, context)
            
            # Step 4: Extract sources
            sources = []
            for doc in documents:
                source = {
                    "course_id": doc.metadata.get('course_id', 'Unknown'),
                    "course_name": doc.metadata.get('course_name', ''),
                    "snippet": doc.page_content[:200] + "..." if len(doc.page_content) > 200 else doc.page_content
                }
                sources.append(source)
            
            processing_time = (datetime.now() - start_time).total_seconds()
            logger.info(f"Query processed in {processing_time:.2f} seconds")
            
            return {
                "answer": answer,
                "context": context,
                "sources": sources,
                "processing_time": processing_time
            }
            
        except Exception as e:
            logger.error(f"RAG pipeline failed: {e}")
            return {
                "answer": f"Sorry, I encountered an error: {str(e)}",
                "context": "",
                "sources": [],
                "processing_time": (datetime.now() - start_time).total_seconds()
            }


def create_rag_system(
    pinecone_api_key: str,
    pinecone_index_name: str,
    llm_provider: str = "openai",
    llm_model: str = "gpt-4o-mini-2024-07-18"
) -> PineconeRAG:
    """
    Factory function to create a RAG system with common configurations.
    
    Args:
        pinecone_api_key: Pinecone API key
        pinecone_index_name: Name of the Pinecone index
        llm_provider: "openai" or "anthropic"
        llm_model: Model name
        
    Returns:
        Configured PineconeRAG instance
    """
    config = RAGConfig(
        pinecone_api_key=pinecone_api_key,
        pinecone_index_name=pinecone_index_name,
        llm_provider=llm_provider,
        llm_model=llm_model
    )
    
    return PineconeRAG(config)


# Example usage and testing
async def test_rag_system():
    """Test function for the RAG system."""
    # Create RAG system
    rag = create_rag_system(
        pinecone_api_key=os.getenv("PINECONE_API_KEY"),
        pinecone_index_name="openaicourses",
        llm_provider="openai"
    )
    
    # Test queries
    test_queries = [
        "What are the prerequisites for DSC 100?",
        "Tell me about machine learning courses",
        "What math courses do I need for data science?",
        "How many credits is DSC 30?",
        "What courses should I take in my first year?"
    ]
    
    for query in test_queries:
        
        result = await rag.query(query)
        


if __name__ == "__main__":
    asyncio.run(test_rag_system())