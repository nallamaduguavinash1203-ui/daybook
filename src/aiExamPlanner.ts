export interface ExamPrepUnit {
  id: string;
  topic: string;
  title: string;
  minutes: number;
  order: number;
}

export interface ExamPrepDay {
  date: string;
  minutes: number;
  unitIds: string[];
}

export interface ExamPrepPlanResponse {
  assistantMessage: string;
  interpretation: string;
  units: ExamPrepUnit[];
  days: ExamPrepDay[];
}

export interface ExamPrepRequest {
  examName: string;
  examDate: string;
  difficulty: "easy" | "medium" | "hard";
  linkedCourse?: string;
  topics: string[];
  materialText?: string;
  materialNames?: string[];
  dailyMinutes?: number;
  userMessage: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}

const API_BASE = (import.meta.env.VITE_DAYBOOK_AI_URL || "http://localhost:8787").replace(/\/$/, "");

function offlineExamPlan(request: ExamPrepRequest): ExamPrepPlanResponse {
  const topics = request.topics.filter(Boolean);
  const units = topics.map((topic, index) => ({
    id: `offline-exam-unit-${index + 1}`,
    topic,
    title: topic,
    minutes: Math.max(30, Math.round((request.dailyMinutes || 60) / Math.max(1, Math.min(2, topics.length)))),
    order: index + 1,
  }));
  const exam = new Date(`${request.examDate}T00:00:00`);
  const dates: string[] = [];
  const cursor = new Date(exam);
  cursor.setDate(cursor.getDate() - 1);
  while (cursor >= new Date(new Date().toISOString().slice(0,10) + "T00:00:00") && dates.length < Math.max(1, units.length)) {
    dates.unshift(cursor.toISOString().slice(0,10));
    cursor.setDate(cursor.getDate() - 1);
  }
  const days = dates.map((date, index) => ({
    date,
    minutes: units[index]?.minutes || Math.max(30, request.dailyMinutes || 60),
    unitIds: units[index] ? [units[index].id] : [],
  }));
  return {
    assistantMessage: "Offline development exam plan created from the supplied topics. No OpenAI API request was made.",
    interpretation: request.userMessage || `Prepare ${request.examName} by ${request.examDate}.`,
    units,
    days,
  };
}

export async function planExamWithAI(request: ExamPrepRequest): Promise<ExamPrepPlanResponse> {
  if (import.meta.env.VITE_DAYBOOK_OFFLINE_AI === "true") return offlineExamPlan(request);
  const response = await fetch(`${API_BASE}/api/exam-plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "The AI exam planner could not complete the request.");
  return payload as ExamPrepPlanResponse;
}
