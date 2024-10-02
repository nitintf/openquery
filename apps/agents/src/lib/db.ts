import { DataSource } from "typeorm";
import { SqlDatabase } from "langchain/sql_db";
import { SqlToolkit } from "langchain/agents/toolkits/sql";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

export async function initializeDatabaseAndToolkit({
  type,
  connectionString,
  llm,
}: {
  type: "mysql" | "postgres";
  connectionString: string;
  llm: BaseChatModel;
}): Promise<{ db: SqlDatabase; toolkit: SqlToolkit }> {
  const dataSourceInstance = new DataSource({
    type: type,
    url: connectionString,
  });

  await dataSourceInstance.initialize();
  console.log("Data Source initialized!");

  const sqlDatabaseInstance = await SqlDatabase.fromDataSourceParams({
    appDataSource: dataSourceInstance,
  });
  console.log("SQL Database initialized!");

  const sqlToolkitInstance = new SqlToolkit(sqlDatabaseInstance, llm);

  return {
    db: sqlDatabaseInstance,
    toolkit: sqlToolkitInstance,
  };
}