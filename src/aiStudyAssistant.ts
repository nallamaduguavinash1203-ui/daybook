export type StudyMode = "chat" | "mcq" | "coding" | "debug" | "short-answer" | "evaluate";

export interface StudyPractice {
  type: "mcq" | "coding" | "debug" | "short-answer";
  question: string;
  options?: string[];
  score?: number;
}

export interface StudyAIResponse {
  assistantMessage: string;
  feedback?: string;
  practice?: StudyPractice | null;
}

export interface StudyAIRequest {
  courseName: string;
  courseType: "academic" | "non-academic";
  topics: string[];
  currentPlan?: unknown;
  mode: StudyMode;
  userMessage: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  attachmentName?: string;
  attachmentText?: string;
  practice?: StudyPractice;
  answer?: string;
}

const API_BASE = (import.meta.env.VITE_DAYBOOK_AI_URL || "http://localhost:8787").replace(/\/$/, "");

export async function studyWithAI(request: StudyAIRequest): Promise<StudyAIResponse> {
  const response = await fetch(`${API_BASE}/api/study`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "The AI study assistant could not complete the request.");
  return payload as StudyAIResponse;
}
