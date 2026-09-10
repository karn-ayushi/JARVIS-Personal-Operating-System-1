import { logger } from "./logger";

const model = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";

export async function generateGemini(prompt: string): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;

  if (!key) {
    logger.warn("GEMINI_API_KEY is not configured");
    return null;
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": key,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.35,
            maxOutputTokens: 8192,
          },
        }),
      },
    );

    if (!response.ok) {
      const errorBody = await response.text();

      logger.warn(
        {
          status: response.status,
          model,
          error: errorBody,
        },
        "Gemini request failed",
      );

      return null;
    }

    const payload = await response.json() as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string;
          }>;
        };
      }>;
    };

    const answer = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim();

    if (!answer) {
      logger.warn({ model }, "Gemini returned an empty response");
      return null;
    }

    return answer;
  } catch (error) {
    logger.warn({ error, model }, "Gemini request errored");
    return null;
  }
}
