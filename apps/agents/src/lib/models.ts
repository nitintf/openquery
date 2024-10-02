import { ChatGroq } from "@langchain/groq";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

/**
 * Loads a Groq model for use with LangGraph or LangChain.
 *
 * @param options - Model options. You can specify a model name (defaults to 'llama-3.3-70b-versatile') and any other ChatGroq options.
 * @returns An instance of ChatGroq ready for use.
 */
export function loadModel(provider: "groq" | "google" = "groq") {
  if (provider === "groq") {
    return new ChatGroq({
      model: "llama3-8b-8192",
    });
  }

  return new ChatGoogleGenerativeAI({
    model: "gemini-2.0-flash",
    temperature: 0,
  });
}
