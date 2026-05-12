import { GoogleGenAI, Type } from "@google/genai";
import { Activity } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });

export async function generateMenteeInsight(
  menteeName: string, 
  activities: Activity[],
  incompleteTasks: string[]
) {
  const activityContext = activities.length > 0 
    ? activities.map(a => `[${a.date}] ${a.category}: ${a.content} (Spent: ${a.amountSpent}KRW)`).join('\n')
    : "No activities logged yet.";

  const tasksContext = incompleteTasks.length > 0
    ? incompleteTasks.map(t => `- ${t}`).join("\n")
    : "All standard tasks are completed!";

  const prompt = `
    Mentee Name: ${menteeName}
    Activities:
    ${activityContext}

    Available Tasks remaining in their Roadmap (Checklist):
    ${tasksContext}

    Please analyze these and provide:
    1. A short, creative character name/type for the mentee based on their activities (e.g., "열정적인 테크 리더", "성장하는 디지털 공학도").
    2. 3 main growth keywords that summarize their recent activities.
    3. 3 specific activities they should try next. IMPORTANT: Select these ONLY from the "Available Tasks remaining" list provided above if available. If none are left, recommend creative new ones related to their character type.
    4. A personal, warm feedback message for the mentee.
    
    Respond in Korean.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            characterName: { type: Type.STRING, description: "A creative character archetype name." },
            summary: { type: Type.STRING, description: "Exactly 3 growth keywords separated by commas." },
            recommendations: { 
              type: Type.ARRAY, 
              items: { type: Type.STRING },
              description: "3 recommended activities."
            },
            feedback: { type: Type.STRING, description: "Personal feedback message." }
          },
          required: ["characterName", "summary", "recommendations", "feedback"]
        }
      }
    });

    return JSON.parse(response.text || "{}");
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
}
