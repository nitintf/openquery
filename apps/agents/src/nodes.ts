import { AIMessage, SystemMessage } from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { SqlToolkit } from "langchain/agents/toolkits/sql";
import {
  generateQuerySystemPrompt,
  queryClassifierPrompt,
  safetyCheckerPrompt,
  answerQueryPrompt,
} from "./lib/prompts.js";
import {
  GraphState,
  QueryClassificationSchema,
  SafetyCheckSchema,
} from "./state.js";
import { z } from "zod";
import { NodeInterrupt } from "@langchain/langgraph";

export function createSqlNodes(toolkit: SqlToolkit, llm: BaseChatModel) {
  const tools = toolkit.tools;

  const querySqlTool = tools.find((tool) => tool.name === "query-sql");
  const infoSqlTool = tools.find((tool) => tool.name === "info-sql");
  const listTablesTool = tools.find((tool) => tool.name === "list-tables-sql");
  const queryCheckerTool = tools.find((tool) => tool.name === "query-checker");

  if (!querySqlTool || !infoSqlTool || !listTablesTool || !queryCheckerTool) {
    throw new Error("Required SQL tools not found in toolkit");
  }

  async function connectionHandler(
    state: GraphState
  ): Promise<Partial<GraphState>> {
    try {
      if (state.connectionStatus === "connected") {
        return {
          messages: [
            ...state.messages,
            new AIMessage("Database connection already established"),
          ],
        };
      }

      return {
        connectionStatus: "connected",
        connectionId: `conn_${Date.now()}`,
        messages: [
          ...state.messages,
          new AIMessage("Database connection established and ready"),
        ],
      };
    } catch (error: any) {
      return {
        connectionStatus: "error",
        lastError: error.message,
        messages: [
          ...state.messages,
          new AIMessage(`Connection error: ${error.message}`),
        ],
      };
    }
  }

  async function schemaAnalyzer(
    state: GraphState
  ): Promise<Partial<GraphState>> {
    if (!listTablesTool || !infoSqlTool) {
      return {
        lastError: "Schema analysis not possible",
        messages: [
          ...state.messages,
          new AIMessage("Schema analysis not possible"),
        ],
      };
    }

    try {
      const tableNames = await listTablesTool.invoke({});

      if (!tableNames || typeof tableNames !== "string") {
        return {
          sqlSchema: "No tables found in database",
          schemaInfo:
            "📊 **Database Schema Loaded**\n\nNo tables found in database",
          messages: [
            ...state.messages,
            new AIMessage(
              "📊 **Database Schema Loaded**\n\nNo tables found in database"
            ),
          ],
        };
      }

      const schema = await infoSqlTool.invoke({ input: tableNames });

      return {
        sqlSchema: schema,
        messages: [...state.messages],
      };
    } catch (error: any) {
      console.error("Schema analysis error:", error);
      return {
        lastError: `Schema analysis error: ${error.message}`,
        sqlSchema: "Schema analysis failed",
        messages: [
          ...state.messages,
          new AIMessage(`Schema analysis failed: ${error.message}`),
        ],
      };
    }
  }

  async function queryClassifier(
    state: GraphState
  ): Promise<Partial<GraphState>> {
    try {
      const lastUserMessage = state.messages.findLast(
        (m) => m.getType() === "human"
      );

      if (!lastUserMessage) {
        return {
          queryType: "unknown",
          messages: [
            ...state.messages,
            new AIMessage("No user query found to classify"),
          ],
        };
      }

      console.log(lastUserMessage);

      const userQuery =
        typeof lastUserMessage.content === "string"
          ? lastUserMessage.content
          : "";

      const systemPrompt = await queryClassifierPrompt.format({
        schema: state.sqlSchema || "No schema available",
        user_query: userQuery,
      });

      const response = await llm
        .withStructuredOutput(QueryClassificationSchema)
        .invoke([new SystemMessage(systemPrompt)]);

      const queryType =
        response.classification === "answer_query"
          ? "answer_query"
          : "generate_sql";

      return {
        queryType,
        messages: [
          ...state.messages,
          new AIMessage(
            `Query classified as: ${queryType.toUpperCase()} (${response.reasoning})`
          ),
        ],
      };
    } catch (error: any) {
      return {
        queryType: "unknown",
        lastError: `Classification error: ${error.message}`,
        messages: [
          ...state.messages,
          new AIMessage(`Query classification failed: ${error.message}`),
        ],
      };
    }
  }

  async function answerQuery(state: GraphState): Promise<Partial<GraphState>> {
    try {
      const lastUserMessage = state.messages.findLast(
        (m) => m.getType() === "human"
      );

      if (!lastUserMessage) {
        return {
          messages: [
            ...state.messages,
            new AIMessage("No user query found to answer"),
          ],
        };
      }

      const userQuery =
        typeof lastUserMessage.content === "string"
          ? lastUserMessage.content
          : "";

      const systemPrompt = await answerQueryPrompt.format({
        schema: state.sqlSchema || "No schema available",
        user_query: userQuery,
      });

      const response = await llm.invoke([new SystemMessage(systemPrompt)]);

      return {
        messages: [...state.messages, response],
      };
    } catch (error: any) {
      return {
        lastError: `Answer query error: ${error.message}`,
        messages: [
          ...state.messages,
          new AIMessage(`Failed to answer query: ${error.message}`),
        ],
      };
    }
  }

  async function generateQuery(
    state: GraphState
  ): Promise<Partial<GraphState>> {
    try {
      const systemPrompt = await generateQuerySystemPrompt.format({
        dialect: "sql",
        top_k: 5,
        schema: state.sqlSchema || "No schema available",
      });

      const sqlSchema = z.object({
        query: z.string(),
      });

      const response = await llm
        .withStructuredOutput(sqlSchema)
        .invoke([new SystemMessage(systemPrompt), ...state.messages]);

      const generatedSQL = response?.query;

      if (!generatedSQL) {
        return {
          lastError: "No SQL query generated",
          messages: [
            ...state.messages,
            new AIMessage("No SQL query generated"),
          ],
        };
      }

      return {
        generatedSQL,
        messages: [...state.messages, new AIMessage(generatedSQL)],
      };
    } catch (error: any) {
      console.log(error)
      return {
        lastError: `SQL generation error: ${error.message}`,
        messages: [
          ...state.messages,
          new AIMessage(`SQL generation failed: ${error.message}`),
        ],
      };
    }
  }

  async function safetyChecker(
    state: GraphState
  ): Promise<Partial<GraphState>> {
    try {
      if (!state.generatedSQL) {
        return {
          safetyLevel: "safe",
          needsApproval: false,
          messages: [...state.messages],
        };
      }

      const systemPrompt = await safetyCheckerPrompt.format({
        sql_query: state.generatedSQL,
      });

      const response = await llm
        .withStructuredOutput(SafetyCheckSchema)
        .invoke([new SystemMessage(systemPrompt)]);

      return {
        safetyLevel: response.safetyLevel,
        safetyWarnings: response.warnings,
        needsApproval: response.needsApproval,
      };
    } catch (error: any) {
      return {
        safetyLevel: "warning",
        safetyWarnings: ["Safety check failed"],
        needsApproval: true,
        lastError: `Safety check error: ${error.message}`,
        messages: [
          ...state.messages,
          new AIMessage(`Safety check failed: ${error.message}`),
        ],
      };
    }
  }

  async function queryExecutor(
    state: GraphState
  ): Promise<Partial<GraphState>> {
    try {
      if (state.humanApproval === "rejected") {
        return {
          messages: [
            ...state.messages,
            new AIMessage("Query execution cancelled by user."),
          ],
        };
      }

      if (state.humanApproval === "pending" && state.needsApproval) {
        const safetyLevel = state.safetyLevel;
        if (safetyLevel === "dangerous") {
          throw new NodeInterrupt(
            "This query is dangerous and requires human approval. Please review the query and confirm."
          );
        }
      }

      if (!querySqlTool || !llm.bindTools) {
        return {
          lastError: "Query execution not possible",
          messages: [
            ...state.messages,
            new AIMessage("Query execution not possible"),
          ],
        };
      }

      if (state.generatedSQL) {
        const llmWithTools = llm.bindTools([querySqlTool], {
          tool_choice: "any",
        });

        const response = await llmWithTools.invoke(state.messages);

        console.log(response)

        return {
          messages: [...state.messages, response],
        };
      } else {
        return {
          lastError: "No SQL query to execute",
          messages: [
            ...state.messages,
            new AIMessage("No SQL query to execute"),
          ],
        };
      }
    } catch (error: any) {
      return {
        lastError: `Query execution error: ${error.message}`,
        messages: [
          ...state.messages,
          new AIMessage(`Query execution failed: ${error.message}`),
        ],
      };
    }
  }

  return {
    connectionHandler,
    schemaAnalyzer,
    queryClassifier,
    answerQuery,
    generateQuery,
    safetyChecker,
    queryExecutor,
  };
}
