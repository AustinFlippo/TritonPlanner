from langgraph.graph import  StateGraph
from langgraph.graph import MessagesState, StateGraph
from langchain_core.tools import tool
from langchain_core.messages import SystemMessage
from langgraph.graph import END
from langgraph.prebuilt import ToolNode, tools_condition
from langgraph.checkpoint.memory import MemorySaver
from langchain_openai import ChatOpenAI
from langchain_openai import OpenAIEmbeddings
from langchain_pinecone import PineconeVectorStore
from pinecone import Pinecone
import os
from dotenv import load_dotenv
from typing_extensions import TypedDict, List
import langchainhub as hub
from langchain_core.documents import Document
from langgraph.graph import StateGraph, START, END


load_dotenv()


embeddings = OpenAIEmbeddings(model="text-embedding-3-small")
index_name = "openaicourses"
pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
index = pc.Index(index_name)
vector_store = PineconeVectorStore(embedding=embeddings, index=index)


# Get RAG prompt from hub
try:
    rag_prompt = hub.pull("rlm/rag-prompt")
except Exception as e:
    # Fallback to manual prompt
    from langchain.prompts import ChatPromptTemplate
    rag_prompt = ChatPromptTemplate.from_messages([
        ("system", "You are a helpful course advisor for UC San Diego. Use the following context to answer questions about courses, degree requirements, and academic planning. If you cannot find relevant information in the context, say so clearly.\n\nContext:\n{context}"),
        ("human", "{question}")
    ])

# Define state for application
class State(TypedDict):
    question: str
    context: List[Document]
    answer: str


def retrieve(state: State):
    """Retrieve relevant course documents from Pinecone vector store."""
    try:
        # Get top 5 most relevant documents
        retrieved_docs = vector_store.similarity_search(
            state["question"], 
            k=5  # Get top 5 results
        )
        return {"context": retrieved_docs}
    except Exception:
        return {"context": []}



def generate(state: State):
    """Generate answer using LLM based on retrieved context."""
    try:
        if not state["context"]:
            return {"answer": "I couldn't find relevant information to answer your question. Please try rephrasing or asking about UCSD courses, degree requirements, or academic planning."}
        
        # Format context with course information
        context_parts = []
        for doc in state["context"]:
            course_id = doc.metadata.get('course_id', 'Unknown Course')
            content = doc.page_content
            context_parts.append(f"Course: {course_id}\n{content}")
        
        docs_content = "\n\n---\n\n".join(context_parts)
        
        # Generate response using LLM
        messages = rag_prompt.invoke({
            "question": state["question"],
            "context": docs_content
        })
        
        llm = ChatOpenAI(temperature=0.1, model_name="gpt-4o-mini-2024-07-18")
        response = llm.invoke(messages)
        
        return {"answer": response.content}
        
    except Exception as e:
        return {"answer": f"Sorry, I encountered an error while generating the response: {str(e)}"}



# Compile application and test
graph_builder = StateGraph(State).add_sequence([retrieve, generate])
graph_builder.add_edge(START, "retrieve")
graph = graph_builder.compile()