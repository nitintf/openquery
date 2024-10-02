import { StateGraph, END, START, MemorySaver } from "@langchain/langgraph";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { SqlToolkit } from "langchain/agents/toolkits/sql";
import { createSqlNodes } from "./nodes.js";
import { loadModel } from "./lib/models.js";
import { initializeDatabaseAndToolkit } from "./lib/db.js";
import { GraphAnnotationState, GraphState } from "./state.js";

function routeAfterConnection(
  state: GraphState
): "schema_analyzer" | typeof END {
  if (state.connectionStatus === "connected") {
    return "schema_analyzer";
  }
  return END;
}

function routeAfterClassification(
  state: GraphState
): "answer_query" | "generate_query" | typeof END {
  if (state.queryType === "answer_query") {
    return "answer_query";
  } else if (state.queryType === "generate_sql") {
    return "generate_query";
  }
  return END;
}

export function createSqlAgentGraphBuilder(
  toolkit: SqlToolkit,
  llm: BaseChatModel
) {
  const nodes = createSqlNodes(toolkit, llm);

  const builder = new StateGraph(GraphAnnotationState)
    .addNode("connection_handler", nodes.connectionHandler)
    .addNode("schema_analyzer", nodes.schemaAnalyzer)
    .addNode("query_classifier", nodes.queryClassifier)
    .addNode("answer_query", nodes.answerQuery)
    .addNode("generate_query", nodes.generateQuery)
    .addNode("safety_checker", nodes.safetyChecker)
    .addNode("query_executor", nodes.queryExecutor)

    .addEdge(START, "connection_handler")

    .addConditionalEdges("connection_handler", routeAfterConnection, {
      schema_analyzer: "schema_analyzer",
      [END]: END,
    })

    .addEdge("schema_analyzer", "query_classifier")

    .addConditionalEdges("query_classifier", routeAfterClassification, {
      answer_query: "answer_query",
      generate_query: "generate_query",
      [END]: END,
    })

    .addEdge("answer_query", END)

    .addEdge("generate_query", "safety_checker")

    .addEdge("safety_checker", "query_executor")

    .addEdge("query_executor", END);

  return builder;
}

const llm = loadModel();

const { toolkit } = await initializeDatabaseAndToolkit({
  type: "postgres",
  connectionString: "postgresql://zaars:zaars@localhost:5434/zaars",
  llm,
});
const checkpointer = new MemorySaver();
export const graph = createSqlAgentGraphBuilder(toolkit, llm).compile({
  checkpointer,
});
