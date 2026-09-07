import { logger } from "./logger";

const model = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";

export async function generateGemini(prompt: string): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.35, maxOutputTokens: 8192 },
        }),
      },
    );
    if (!response.ok) {
      logger.warn({ status: response.status }, "Gemini request failed");
      return null;
    }
    const payload = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() || null;
  } catch (error) {
    logger.warn({ error }, "Gemini request errored");
    return null;
  }
}