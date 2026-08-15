import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are Georgie, a sophisticated personal AI assistant.
You are fast, calm, capable, proactive, and highly practical.
Your job is to understand the user's goal, reason carefully, guide them toward the best next action, and use connected capabilities when available.
Keep spoken responses natural and concise unless detail is requested.
Never pretend an external action succeeded unless the system confirms it.`;

export async function askGeorgie(input, history = []) {
  if (!input?.trim()) throw new Error("Input is required");

  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5.6",
    instructions: SYSTEM_PROMPT,
    input: [
      ...history.slice(-12),
      { role: "user", content: input.trim() }
    ]
  });

  return {
    text: response.output_text,
    responseId: response.id
  };
}
