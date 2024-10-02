import { Annotation, MessagesAnnotation } from "@langchain/langgraph";
import { z } from "zod";

export interface DatabaseConfig {
  type: "mysql" | "postgresql";
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionString?: string;
}

export type QueryType = "answer_query" | "generate_sql" | "unknown";

export const QueryClassificationSchema = z.object({
  classification: z.enum(["answer_query", "generate_sql"]),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1)
});

export const SafetyCheckSchema = z.object({
  safetyLevel: z.enum(["safe", "warning", "dangerous"]),
  warnings: z.array(z.string()),
  needsApproval: z.boolean(),
  explanation: z.string()
});

export type SafetyLevel = "safe" | "warning" | "dangerous";

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export const GraphAnnotationState = Annotation.Root({
  ...MessagesAnnotation.spec,

  connectionConfig: Annotation<DatabaseConfig | null>({
    default: () => null,
    reducer: (_prev, next) => next,
  }),

  connectionStatus: Annotation<ConnectionStatus>({
    default: () => "disconnected",
    reducer: (_prev, next) => next,
  }),

  connectionId: Annotation<string | null>({
    default: () => null,
    reducer: (_prev, next) => next,
  }),

  schemaInfo: Annotation<any>({
    default: () => null,
    reducer: (_prev, next) => next,
  }),

  sqlSchema: Annotation<string | null>({
    default: () => null,
    reducer: (_prev, next) => next,
  }),

  queryType: Annotation<QueryType>({
    default: () => "unknown",
    reducer: (_prev, next) => next,
  }),

  generatedSQL: Annotation<string | null>({
    default: () => null,
    reducer: (_prev, next) => next,
  }),

  safetyLevel: Annotation<SafetyLevel>({
    default: () => "safe",
    reducer: (_prev, next) => next,
  }),

  safetyWarnings: Annotation<string[]>({
    default: () => [],
    reducer: (_prev, next) => next,
  }),

  humanApproval: Annotation<"pending" | "approved" | "rejected">({
    default: () => "pending",
    reducer: (_prev, next) => next,
  }),

  queryResults: Annotation<any>({
    default: () => null,
    reducer: (_prev, next) => next,
  }),

  lastError: Annotation<string | null>({
    default: () => null,
    reducer: (_prev, next) => next,
  }),

  needsApproval: Annotation<boolean>({
    default: () => false,
    reducer: (_prev, next) => next,
  }),

  isSchemaQuery: Annotation<boolean>({
    default: () => false,
    reducer: (_prev, next) => next,
  }),
});

export type GraphState = typeof GraphAnnotationState.State;
export type UpdateGraphState = typeof GraphAnnotationState.Update;