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
from langchain import hub
from langchain.schema import Document
from langgraph.graph import StateGraph, START, END


load_dotenv()

embeddings = OpenAIEmbeddings(model="text-embedding-3-large")

pc = Pinecone(api_key=os.getenv('PINECONE_API_KEY'))
index = pc.Index("vac")

vector_store = PineconeVectorStore(embedding=embeddings, index=index)

llm = ChatOpenAI(model="gpt-4o-mini")

rag_prompt = hub.pull("rlm/rag-prompt")


# Define state for application
class State(TypedDict):
    question: str
    context: List[Document]
    answer: str


def retrieve(state: State):
    retrieved_docs = vector_store.similarity_search(state["question"])
    return {"context": retrieved_docs}



def generate(state: State):
    docs_content = "\n\n".join(doc.page_content for doc in state["context"])
    messages = rag_prompt.invoke({"question": state["question"],
                              "context": docs_content})
    llm = ChatOpenAI(temperature=0, model_name="gpt-4o-mini-2024-07-18")
    response = llm.invoke(messages)
    return {"answer": response.content}



# Compile application and test
graph_builder = StateGraph(State).add_sequence([retrieve, generate])
graph_builder.add_edge(START, "retrieve")
graph = graph_builder.compile()