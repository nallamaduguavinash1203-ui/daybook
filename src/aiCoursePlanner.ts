export interface CoursePlanSubtopic {
  id: string;
  parentTopic: string;
  title: string;
  minutes: number;
  order: number;
}

export interface CoursePlanDay {
  day: number;
  minutes: number;
  subtopicIds: string[];
}

export interface CoursePlanResponse {
  assistantMessage: string;
  interpretation: string;
  subtopics: CoursePlanSubtopic[];
  days: CoursePlanDay[];
}

export interface CoursePlanRequest {
  courseName: string;
  courseType: "academic" | "non-academic";
  startDate: string;
  endDate: string;
  dailyMinutes: number;
  weekendWeight: number;
  topics: string[];
  userMessage: string;
  history: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
}

export async function planCourseWithAI(
  request: CoursePlanRequest
): Promise<CoursePlanResponse> {
  console.log("🔥 OFFLINE COURSE PLANNER IS RUNNING");
  return {
    assistantMessage: "TEST: OFFLINE PLANNER IS WORKING",
    interpretation: "This response came directly from the local frontend.",
    subtopics: [],
    days: [],
  };
  // Offline development mode.
  // This does NOT call OpenAI or use API credits.

  const start = new Date(request.startDate);
  const end = new Date(request.endDate);

  const totalDays = Math.max(
    1,
    Math.ceil(
      (end.getTime() - start.getTime()) /
        (1000 * 60 * 60 * 24)
    ) + 1
  );

  const topics = request.topics.filter(
    (topic: string) => topic.trim().length > 0
  );

  if (topics.length === 0) {
    return {
      assistantMessage:
        "Add some course topics first, then I can create a development plan.",
      interpretation:
        "No course topics were supplied.",
      subtopics: [],
      days: [],
    };
  }

  const subtopics: CoursePlanSubtopic[] = topics.map(
    (topic: string, index: number) => ({
      id: `offline-subtopic-${index + 1}`,
      parentTopic: topic,
      title: topic,
      minutes: request.dailyMinutes,
      order: index + 1,
    })
  );

  const days: CoursePlanDay[] = [];

  for (let day = 1; day <= totalDays; day++) {
    const subtopic =
      subtopics[(day - 1) % subtopics.length];

    days.push({
      day,
      minutes: Math.min(
        request.dailyMinutes,
        subtopic.minutes
      ),
      subtopicIds: [subtopic.id],
    });
  }

  return {
    assistantMessage:
      "Offline development mode: I created a test course plan without contacting the OpenAI API.",
    interpretation:
      `Plan distributed across ${totalDays} days using the requested daily study time of ${request.dailyMinutes} minutes.`,
    subtopics,
    days,
  };
}