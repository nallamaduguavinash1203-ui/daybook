import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
const port = Number(process.env.PORT || 8787);
const model = process.env.DAYBOOK_AI_MODEL || "gpt-5.6-luna";

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const planSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    assistantMessage: { type: "string" },
    interpretation: { type: "string" },
    subtopics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          parentTopic: { type: "string" },
          title: { type: "string" },
          minutes: { type: "integer", minimum: 5, maximum: 240 },
          order: { type: "integer", minimum: 1 }
        },
        required: ["id", "parentTopic", "title", "minutes", "order"]
      }
    },
    days: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          day: { type: "integer", minimum: 1 },
          minutes: { type: "integer", minimum: 1 },
          subtopicIds: { type: "array", items: { type: "string" } }
        },
        required: ["day", "minutes", "subtopicIds"]
      }
    }
  },
  required: ["assistantMessage", "interpretation", "subtopics", "days"]
};

const systemPrompt = `You are Daybook's course-planning engine.
Your ONLY job is to understand the user's course-planning requirements, break the supplied course topics into sensible study subtopics, estimate reasonable study minutes, and distribute those subtopics across the available course days.

Do NOT teach the course. Do NOT generate notes, explanations, quizzes, solutions, or study content.
Do NOT invent syllabus topics that are not present unless a tiny structural split is necessary to make a supplied topic manageable.
Do NOT choose clock times. Daybook's scheduler chooses actual clock times around timetable classes, lunch, exams, events, goals, and other fixed commitments.
Respect the user's explicit constraints. If the user says not to split something, keep it together. If they specify a daily limit, do not exceed it in the returned plan.
Weekend weight is distribution guidance, not priority.
Keep the plan practical: split large topics into meaningful subtopics, not artificial one-line fragments.
The returned JSON must contain a conversational response plus the structured plan.`;

function validateBody(body) {
  const required = ["courseName", "courseType", "startDate", "endDate", "dailyMinutes", "topics", "userMessage"];
  for (const key of required) {
    if (body?.[key] === undefined || body?.[key] === null) return `Missing field: ${key}`;
  }
  if (!Array.isArray(body.topics) || body.topics.length === 0) return "Add at least one course topic before asking AI to plan it.";
  if (!String(body.userMessage).trim()) return "Tell the AI what you want changed or planned.";
  return null;
}

app.get("/health", (_req, res) => res.json({ ok: true, service: "daybook-ai" }));

app.post("/api/course-plan", async (req, res) => {
  const error = validateBody(req.body);
  if (error) return res.status(400).json({ error });
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "OPENAI_API_KEY is not configured in the Daybook AI server." });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const body = req.body;
    const history = Array.isArray(body.history) ? body.history.slice(-12) : [];

    const userInput = JSON.stringify({
      course: {
        name: body.courseName,
        type: body.courseType,
        startDate: body.startDate,
        endDate: body.endDate,
        dailyMinutes: body.dailyMinutes,
        weekendWeight: body.weekendWeight
      },
      topics: body.topics,
      conversation: history,
      latestRequest: body.userMessage
    });

    const response = await client.responses.create({
      model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userInput }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "daybook_course_plan",
          strict: true,
          schema: planSchema
        }
      }
    });

    const raw = response.output_text;
    if (!raw) throw new Error("The AI returned an empty course plan.");

    let plan;
    try {
      plan = JSON.parse(raw);
    } catch {
      throw new Error("The AI returned an invalid structured course plan.");
    }

    return res.json(plan);
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "AI course planning failed.";
    return res.status(500).json({ error: message });
  }
});

const studySchema = {
  type: "object", additionalProperties: false,
  properties: {
    assistantMessage: { type: "string" },
    feedback: { type: "string" },
    practice: {
      anyOf: [
        { type: "null" },
        { type: "object", additionalProperties: false, properties: {
          type: { type: "string", enum: ["mcq", "coding", "debug", "short-answer"] },
          question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          score: { type: "integer", minimum: 0, maximum: 100 }
        }, required: ["type", "question", "options", "score"] }
      ]
    }
  }, required: ["assistantMessage", "feedback", "practice"]
};

const studySystemPrompt = `You are Daybook's course-specific AI study assistant and practice engine.
You help the user learn ONLY in the context of the supplied course, its topics, its saved plan, and any attached material.
You may explain concepts, summarize supplied material, answer questions, create quizzes, create coding/debugging/written practice, and evaluate an answer.
Do not silently change the user's timetable or schedule. Do not create a course plan unless the user explicitly asks for planning; the separate planner handles scheduling.
When attachment text is supplied, treat it as primary source material. Do not claim a detail came from the attachment unless the text supports it.
For practice mode, generate exactly one focused question. For MCQ include four options. For coding/debug/written practice, leave options empty.
For evaluate mode, assess the user's answer fairly. For coding answers, focus on correctness, logic, edge cases, and clarity; do not pretend to execute code unless an execution result is supplied.
Give hints before full solutions when the user asks for help, and do not reveal the answer merely because an attempt is wrong.
Keep the response concise enough for an interactive study session.`;

app.post("/api/study", async (req, res) => {
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "OPENAI_API_KEY is not configured in the Daybook AI server." });
  const body = req.body || {};
  if (!body.courseName || !body.userMessage) return res.status(400).json({ error: "Course name and user message are required." });
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const context = {
      course: { name: body.courseName, type: body.courseType },
      topics: Array.isArray(body.topics) ? body.topics : [],
      currentPlan: body.currentPlan || null,
      mode: body.mode || "chat",
      attachment: body.attachmentText ? { name: body.attachmentName, text: String(body.attachmentText).slice(0, 50000) } : null,
      conversation: Array.isArray(body.history) ? body.history.slice(-12) : [],
      latestRequest: body.userMessage,
      practice: body.practice || null,
      answer: body.answer || null
    };
    const response = await client.responses.create({
      model,
      input: [
        { role: "system", content: studySystemPrompt },
        { role: "user", content: JSON.stringify(context) }
      ],
      text: { format: { type: "json_schema", name: "daybook_study_response", strict: true, schema: studySchema } }
    });
    const raw = response.output_text;
    if (!raw) throw new Error("The AI returned an empty study response.");
    return res.json(JSON.parse(raw));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err instanceof Error ? err.message : "AI study request failed." });
  }
});

app.listen(port, () => {
  console.log(`Daybook AI server running at http://localhost:${port}`);
});
