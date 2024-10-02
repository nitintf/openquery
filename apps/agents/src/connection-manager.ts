import { SqlToolkit } from "langchain/agents/toolkits/sql";
import { SqlDatabase } from "langchain/sql_db";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { initializeDatabaseAndToolkit } from "./lib/db.js";

interface CachedConnection {
  connectionString: string;
  type: "mysql" | "postgres";
  toolkit: SqlToolkit;
  db: SqlDatabase;
  lastUsed: Date;
  isActive: boolean;
}

/**
 * Simple connection manager that caches database toolkits to avoid
 * recreating connections for every chat request.
 */
export class ConnectionManager {
  private connections: Map<string, CachedConnection> = new Map();
  private cleanupInterval: NodeJS.Timeout;
  private readonly CACHE_TIMEOUT = 30 * 60 * 1000; // 30 minutes

  constructor() {
    // Cleanup inactive connections every 10 minutes
    this.cleanupInterval = setInterval(
      () => {
        this.cleanupInactiveConnections();
      },
      10 * 60 * 1000
    );
  }

  /**
   * Get or create a database toolkit for the given connection string.
   * This caches the toolkit to avoid recreating connections.
   */
  async getOrCreateToolkit(
    connectionString: string,
    type: "mysql" | "postgres",
    llm: BaseChatModel
  ): Promise<{ toolkit: SqlToolkit; db: SqlDatabase }> {
    const cacheKey = `${type}:${connectionString}`;
    
    // Check if we have a cached connection
    const cached = this.connections.get(cacheKey);
    if (cached && cached.isActive) {
      // Update last used time
      cached.lastUsed = new Date();
      return { toolkit: cached.toolkit, db: cached.db };
    }

    try {
      // Create new connection
      const { db, toolkit } = await initializeDatabaseAndToolkit({
        type,
        connectionString,
        llm,
      });

      // Cache the connection
      this.connections.set(cacheKey, {
        connectionString,
        type,
        toolkit,
        db,
        lastUsed: new Date(),
        isActive: true,
      });

      console.log(`✅ Created and cached new ${type} connection`);
      return { toolkit, db };
    } catch (error: any) {
      console.error(`❌ Failed to create ${type} connection:`, error.message);
      throw error;
    }
  }

  /**
   * Clean up inactive connections
   */
  private cleanupInactiveConnections(): void {
    const now = new Date();
    
    for (const [cacheKey, connection] of this.connections.entries()) {
      if (now.getTime() - connection.lastUsed.getTime() > this.CACHE_TIMEOUT) {
        console.log(`🗑️ Cleaning up inactive connection: ${connection.type}`);
        connection.isActive = false;
        this.connections.delete(cacheKey);
      }
    }
  }

  /**
   * Get connection statistics
   */
  getStats(): {
    activeConnections: number;
    connections: Array<{
      type: string;
      lastUsed: Date;
      isActive: boolean;
    }>;
  } {
    return {
      activeConnections: Array.from(this.connections.values()).filter(
        (c) => c.isActive
      ).length,
      connections: Array.from(this.connections.values()).map((connection) => ({
        type: connection.type,
        lastUsed: connection.lastUsed,
        isActive: connection.isActive,
      })),
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    clearInterval(this.cleanupInterval);
    
    // Mark all connections as inactive
    for (const connection of this.connections.values()) {
      connection.isActive = false;
    }
    
    this.connections.clear();
    console.log("📴 Connection manager shut down");
  }
}
